import asyncio
import httpx
import os
from typing import Optional
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GLPI_URL = os.getenv("GLPI_URL")
GLPI_WEB_URL = GLPI_URL.split("/apirest.php")[0] if GLPI_URL else ""
APP_TOKEN = os.getenv("GLPI_APP_TOKEN")
USER_TOKEN = os.getenv("GLPI_USER_TOKEN")

# Campos confirmados para esta instalaciÃ³n de GLPI
FIELD_STATUS = "12"
FIELD_TECH = "5"
FIELD_GROUP = "8"
FIELD_TITLE = "1"
FIELD_ID = "2"
FIELD_DATE_OPEN  = "15"
FIELD_DATE_SOLVE = "17"  # solvedate (fecha de resoluciÃ³n)
FIELD_REQUESTER = "4"
FIELD_DATE_DUE = "18"   # time_to_resolve
FIELD_FORM_NAME = "120" # nombre del formulario (GLPI 11 nativo)

# Estados GLPI
STATUS_NEW = 1
STATUS_PROCESSING_A = 2
STATUS_PROCESSING_P = 3
STATUS_PENDING = 4
STATUS_SOLVED = 5
STATUS_CLOSED = 6

EN_CURSO = [STATUS_NEW, STATUS_PROCESSING_A, STATUS_PROCESSING_P]
PENDIENTES = [STATUS_PENDING]
FINALIZADOS = [STATUS_SOLVED, STATUS_CLOSED]


def _ticket_params(group_id: int, status: int, extra: dict = None) -> dict:
    p = {
        "criteria[0][field]": FIELD_GROUP,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(group_id),
        "criteria[1][link]": "AND",
        "criteria[1][field]": FIELD_STATUS,
        "criteria[1][searchtype]": "equals",
        "criteria[1][value]": str(status),
    }
    if extra:
        p.update(extra)
    return p


class GLPIClient:
    def __init__(self):
        self.session_token: Optional[str] = None
        self._group_id: Optional[int] = None
        self._user_cache: dict[str, str] = {}
        self._group_member_ids: Optional[set[str]] = None

    def _base_headers(self) -> dict:
        return {"App-Token": APP_TOKEN, "Content-Type": "application/json"}

    def _auth_headers(self) -> dict:
        return {**self._base_headers(), "Session-Token": self.session_token}

    async def init_session(self) -> str:
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.get(
                f"{GLPI_URL}/initSession",
                headers={**self._base_headers(), "Authorization": f"user_token {USER_TOKEN}"},
            )
            resp.raise_for_status()
            self.session_token = resp.json()["session_token"]
            return self.session_token

    async def kill_session(self):
        if not self.session_token:
            return
        async with httpx.AsyncClient(verify=False) as client:
            await client.get(f"{GLPI_URL}/killSession", headers=self._auth_headers())
        self.session_token = None

    async def _get(self, endpoint: str, params: dict = None) -> dict:
        if not self.session_token:
            await self.init_session()
        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            resp = await client.get(
                f"{GLPI_URL}/{endpoint}", headers=self._auth_headers(), params=params
            )
            if resp.status_code == 401:
                await self.init_session()
                resp = await client.get(
                    f"{GLPI_URL}/{endpoint}", headers=self._auth_headers(), params=params
                )
            resp.raise_for_status()
            return resp.json()

    async def resolve_user_name(self, user_id: str) -> str:
        if not user_id or user_id == "Sin asignar":
            return "Sin asignar"
        if user_id in self._user_cache:
            return self._user_cache[user_id]
        try:
            data = await self._get(f"User/{user_id}")
            name = f"{data.get('firstname', '')} {data.get('realname', '')}".strip()
            if not name:
                name = data.get("name", user_id)
            self._user_cache[user_id] = name
            return name
        except Exception:
            return user_id

    async def resolve_user_names(self, user_ids: set[str]) -> dict[str, str]:
        results = await asyncio.gather(*[self.resolve_user_name(uid) for uid in user_ids])
        return dict(zip(user_ids, results))

    async def get_group_id(self) -> Optional[int]:
        if self._group_id:
            return self._group_id
        result = await self._get("Group", {
            "searchText[name]": "Soporte Aplicaciones",
            "range": "0-5",
        })
        if isinstance(result, list) and result:
            self._group_id = result[0]["id"]
            return self._group_id
        return None

    async def get_group_member_ids(self) -> set[str]:
        """IDs de usuarios del grupo Soporte Aplicaciones (cacheado en memoria)."""
        if self._group_member_ids is not None:
            return self._group_member_ids
        group_id = await self.get_group_id()
        if not group_id:
            return set()
        try:
            result = await self._get("Group_User", {
                "searchText[groups_id]": str(group_id),
                "range": "0-999",
            })
            if isinstance(result, list):
                self._group_member_ids = {
                    str(gu["users_id"]) for gu in result if gu.get("users_id")
                }
                return self._group_member_ids
        except Exception:
            pass
        return set()

    async def get_open_tickets(self) -> dict:
        group_id = await self.get_group_id()
        display = {
            "forcedisplay[0]": FIELD_ID,
            "forcedisplay[1]": FIELD_TITLE,
            "forcedisplay[2]": FIELD_STATUS,
            "forcedisplay[3]": FIELD_DATE_OPEN,
            "forcedisplay[4]": FIELD_TECH,
            "order": "DESC",
            "sort": FIELD_DATE_OPEN,
            "range": "0-99",
        }
        # Una request por estado, en paralelo
        results = await asyncio.gather(*[
            self._get("search/Ticket", _ticket_params(group_id, s, display))
            for s in (EN_CURSO + PENDIENTES)
        ])
        all_data = []
        total = 0
        for r in results:
            all_data.extend(r.get("data", []))
            total += r.get("totalcount", 0)
        return {"data": all_data, "totalcount": total}

    async def _get_all_pages(self, endpoint: str, base_params: dict, page_size: int = 500) -> list:
        """Trae todos los resultados paginando automÃ¡ticamente."""
        first = await self._get(endpoint, {**base_params, "range": f"0-{page_size - 1}"})
        data = list(first.get("data", []))
        total = first.get("totalcount", 0)

        if total <= page_size:
            return data

        # PÃ¡ginas restantes en paralelo
        starts = range(page_size, total, page_size)
        pages = await asyncio.gather(*[
            self._get(endpoint, {**base_params, "range": f"{s}-{s + page_size - 1}"})
            for s in starts
        ])
        for page in pages:
            data.extend(page.get("data", []))
        return data

    async def get_stats(self) -> dict:
        group_id = await self.get_group_id()
        count_only = {"range": "0-0"}
        tech_display = {
            "forcedisplay[0]": FIELD_ID,
            "forcedisplay[1]": FIELD_TECH,
            "range": "0-999",
        }

        # Una request por estado en paralelo
        all_statuses = EN_CURSO + PENDIENTES + FINALIZADOS  # [1,2,3,4,5,6]
        results = await asyncio.gather(*[
            self._get("search/Ticket", _ticket_params(group_id, s, count_only))
            for s in all_statuses
        ])

        counts = {s: results[i].get("totalcount", 0) for i, s in enumerate(all_statuses)}

        total_finalizados = counts[STATUS_SOLVED] + counts[STATUS_CLOSED]
        total_abiertos = sum(counts[s] for s in EN_CURSO + PENDIENTES)

        # Tickets finalizados con tÃ©cnico para ranking â€” todos, paginando
        solved_data, closed_data = await asyncio.gather(
            self._get_all_pages("search/Ticket", _ticket_params(group_id, STATUS_SOLVED, tech_display)),
            self._get_all_pages("search/Ticket", _ticket_params(group_id, STATUS_CLOSED, tech_display)),
        )

        # Contar por ID de tÃ©cnico primero
        id_counts: dict[str, int] = {}
        for r in [solved_data, closed_data]:
            for ticket in (r if isinstance(r, list) else r.get("data", [])):
                raw = ticket.get(FIELD_TECH) or "Sin asignar"
                techs = raw if isinstance(raw, list) else [raw]
                for tech_id in techs:
                    key = str(tech_id) if tech_id else "Sin asignar"
                    id_counts[key] = id_counts.get(key, 0) + 1

        # Resolver nombres en paralelo
        ids_to_resolve = {k for k in id_counts if k != "Sin asignar"}
        name_map = await self.resolve_user_names(ids_to_resolve)
        name_map["Sin asignar"] = "Sin asignar"

        tech_counts: dict[str, int] = {}
        for tech_id, count in id_counts.items():
            name = name_map.get(tech_id, tech_id)
            tech_counts[name] = tech_counts.get(name, 0) + count

        return {
            "total_finalizados": total_finalizados,
            "total_abiertos": total_abiertos,
            "by_technician": sorted(
                [{"name": k, "count": v} for k, v in tech_counts.items()],
                key=lambda x: x["count"],
                reverse=True,
            ),
        }

    async def tickets_in_group(self, ticket_ids: set[int]) -> set[int]:
        """Devuelve el subconjunto de ticket_ids que pertenecen al grupo Soporte Aplicaciones."""
        if not ticket_ids:
            return set()
        group_id = await self.get_group_id()
        checks = await asyncio.gather(*[
            self._get("search/Ticket", {
                "criteria[0][field]":      FIELD_ID,
                "criteria[0][searchtype]": "equals",
                "criteria[0][value]":      str(tid),
                "criteria[1][link]":       "AND",
                "criteria[1][field]":      FIELD_GROUP,
                "criteria[1][searchtype]": "equals",
                "criteria[1][value]":      str(group_id),
                "range": "0-0",
            })
            for tid in ticket_ids
        ], return_exceptions=True)
        return {
            tid for tid, result in zip(ticket_ids, checks)
            if isinstance(result, dict) and result.get("totalcount", 0) > 0
        }

    async def get_recent_followups(self) -> list:
        """Trae los 20 seguimientos mÃ¡s recientes."""
        params = {
            "forcedisplay[0]": "7",  # ID
            "forcedisplay[1]": "1",  # Contenido
            "forcedisplay[2]": "5",  # Usuario (ID)
            "forcedisplay[3]": "3",  # Fecha
            "order": "DESC",
            "sort": "7",
            "range": "0-19",
        }
        result = await self._get("search/ITILFollowup", params)
        return result.get("data", [])

    async def get_followup_detail(self, followup_id: int) -> dict:
        """Devuelve el detalle completo de un seguimiento (incluye items_id = ID del ticket)."""
        return await self._get(f"ITILFollowup/{followup_id}")

    async def get_recent_refused_solutions(self, since_id: int) -> list:
        """Soluciones de tickets rechazadas (status=3) con ID mayor a since_id."""
        try:
            result = await self._get("search/ITILSolution", {
                "criteria[0][field]": "2",
                "criteria[0][searchtype]": "morethan",
                "criteria[0][value]": str(since_id),
                "criteria[1][link]": "AND",
                "criteria[1][field]": "4",
                "criteria[1][searchtype]": "equals",
                "criteria[1][value]": "Ticket",
                "forcedisplay[0]": "2",
                "order": "ASC",
                "sort": "2",
                "range": "0-19",
            })
            rows = result.get("data", [])
            if not rows:
                return []
            details = await asyncio.gather(*[
                self._get(f"ITILSolution/{int(r['2'])}")
                for r in rows
            ], return_exceptions=True)
            refused = []
            for row, detail in zip(rows, details):
                if not isinstance(detail, dict):
                    continue
                if detail.get("status") == 3:
                    refused.append({
                        "id": int(row["2"]),
                        "ticket_id": detail.get("items_id"),
                        "date": detail.get("date_approval") or detail.get("date", ""),
                    })
            return [s for s in refused if s["id"] > since_id]
        except Exception as e:
            print(f"[glpi] ERROR en get_recent_refused_solutions: {e}", flush=True)
            return []

    # â”€â”€ Reportes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def get_all_groups(self) -> list[dict]:
        try:
            result = await self._get("Group", {"range": "0-199"})
            if isinstance(result, list):
                return sorted(
                    [{"id": g["id"], "name": g.get("name", "")} for g in result if g.get("name")],
                    key=lambda x: x["name"],
                )
        except Exception:
            pass
        return []

    async def get_forms(self) -> list[dict]:
        try:
            result = await self._get("Glpi\\Form\\Form", {"range": "0-999"})
            if isinstance(result, list):
                forms = [
                    {"id": f["id"], "name": f.get("name", "")}
                    for f in result
                    if f.get("is_active") and not f.get("is_deleted") and not f.get("is_draft")
                ]
                return sorted(forms, key=lambda x: x["name"])
        except Exception:
            pass
        return []

    async def get_technicians(self) -> list[dict]:
        """
        Devuelve solo usuarios con perfil de soporte/tÃ©cnico.
        Filtra por Profile_User usando perfiles cuyo nombre contenga
        keywords de soporte; fallback a todos los activos si falla.
        """
        try:
            profiles = await self._get("Profile", {"range": "0-99"})
            if not isinstance(profiles, list) or not profiles:
                raise ValueError("no profiles")

            TECH_KW    = {"tÃ©cnico", "tecnico", "soporte", "super", "admin", "helpdesk", "it"}
            EXCLUDE_KW = {"self-service", "self service", "autoservice", "observer"}

            tech_profile_ids = [
                p["id"] for p in profiles
                if (any(kw in p.get("name", "").lower() for kw in TECH_KW)
                    and not any(ex in p.get("name", "").lower() for ex in EXCLUDE_KW))
            ]

            # Si no matchea ningÃºn keyword, excluir solo Self-Service
            if not tech_profile_ids:
                tech_profile_ids = [
                    p["id"] for p in profiles
                    if not any(ex in p.get("name", "").lower() for ex in EXCLUDE_KW)
                ]

            # Obtener Profile_User de cada perfil en paralelo
            pu_results = await asyncio.gather(*[
                self._get("Profile_User", {
                    "searchText[profiles_id]": str(pid),
                    "range": "0-999",
                })
                for pid in tech_profile_ids
            ], return_exceptions=True)

            user_ids: set[str] = set()
            for r in pu_results:
                if isinstance(r, list):
                    for pu in r:
                        if uid := pu.get("users_id"):
                            user_ids.add(str(uid))

            if not user_ids:
                raise ValueError("no users in tech profiles")

            # Obtener detalles de usuarios en paralelo
            user_details = await asyncio.gather(*[
                self._get(f"User/{uid}")
                for uid in user_ids
            ], return_exceptions=True)

            techs = []
            for d in user_details:
                if isinstance(d, Exception) or not isinstance(d, dict):
                    continue
                if not d.get("is_active"):
                    continue
                firstname = str(d.get("firstname") or "").strip()
                realname  = str(d.get("realname") or "").strip()
                name = f"{firstname} {realname}".strip() or str(d.get("name") or "")
                if name and d.get("id"):
                    techs.append({"id": str(d["id"]), "name": name})

            return sorted(techs, key=lambda x: x["name"])

        except Exception:
            return await self._get_all_active_users()

    async def _get_all_active_users(self) -> list[dict]:
        """Fallback: todos los usuarios activos (sin filtrar por perfil)."""
        try:
            params = {
                "forcedisplay[0]": "2",
                "forcedisplay[1]": "9",
                "forcedisplay[2]": "10",
                "forcedisplay[3]": "1",
                "criteria[0][field]": "8",
                "criteria[0][searchtype]": "equals",
                "criteria[0][value]": "1",
                "order": "ASC",
                "sort": "9",
            }
            data = await self._get_all_pages("search/User", params)
            techs = []
            for u in data:
                firstname = str(u.get("9") or "").strip()
                realname  = str(u.get("10") or "").strip()
                name = f"{firstname} {realname}".strip() or str(u.get("1") or "")
                if name and u.get("2"):
                    techs.append({"id": str(u["2"]), "name": name})
            return sorted(techs, key=lambda x: x["name"])
        except Exception:
            return []

    async def get_report_tickets(
        self,
        filters: list[dict],
        date_from: str | None,
        date_to: str | None,
    ) -> list[dict]:
        all_filters = list(filters)
        if date_from:
            all_filters.append({"field": FIELD_DATE_OPEN, "searchtype": "morethan", "value": f"{date_from} 00:00:00"})
        if date_to:
            all_filters.append({"field": FIELD_DATE_OPEN, "searchtype": "lessthan", "value": f"{date_to} 23:59:59"})

        criteria = {}
        for i, f in enumerate(all_filters):
            if i > 0:
                criteria[f"criteria[{i}][link]"] = "AND"
            criteria[f"criteria[{i}][field]"] = f["field"]
            criteria[f"criteria[{i}][searchtype]"] = f["searchtype"]
            criteria[f"criteria[{i}][value]"] = str(f["value"])

        display = {
            "forcedisplay[0]": FIELD_ID,
            "forcedisplay[1]": FIELD_TITLE,
            "forcedisplay[2]": FIELD_STATUS,
            "forcedisplay[3]": FIELD_DATE_OPEN,
            "forcedisplay[4]": FIELD_TECH,
            "forcedisplay[5]": FIELD_REQUESTER,
            "forcedisplay[6]": FIELD_DATE_DUE,
            "forcedisplay[7]": FIELD_GROUP,
            "order": "DESC",
            "sort": FIELD_DATE_OPEN,
        }

        data = await self._get_all_pages("search/Ticket", {**criteria, **display})

        tech_ids = {str(t.get(FIELD_TECH)) for t in data if t.get(FIELD_TECH)}
        req_ids = {str(t.get(FIELD_REQUESTER)) for t in data if t.get(FIELD_REQUESTER)}
        name_map = await self.resolve_user_names(tech_ids | req_ids)

        tickets = []
        for t in data:
            tech_id = str(t.get(FIELD_TECH) or "")
            req_id = str(t.get(FIELD_REQUESTER) or "")
            tickets.append({
                "id": t.get(FIELD_ID),
                "title": t.get(FIELD_TITLE),
                "status": t.get(FIELD_STATUS),
                "opened_at": t.get(FIELD_DATE_OPEN),
                "due_at": t.get(FIELD_DATE_DUE),
                "tech": name_map.get(tech_id, "Sin asignar") if tech_id else "Sin asignar",
                "requester": name_map.get(req_id, "Sin asignar") if req_id else "Sin asignar",
                "group": t.get(FIELD_GROUP),
            })
        return tickets

    async def get_ticket_title(self, ticket_id: int) -> str:
        try:
            ticket = await self._get(f"Ticket/{ticket_id}")
            return ticket.get("name", f"Ticket #{ticket_id}")
        except Exception:
            return f"Ticket #{ticket_id}"


    async def get_ticket_assigned_tech(self, ticket_id: int) -> str:
        try:
            result = await self._get(f"Ticket/{ticket_id}/Ticket_User", {"range": "0-9"})
            if isinstance(result, list):
                for tu in result:
                    if tu.get("type") == 2 and tu.get("users_id"):
                        return str(tu["users_id"])
        except Exception:
            pass
        return ""

    async def get_ticket_info(self, ticket_id: int) -> dict:
        """Devuelve tÃ­tulo e ID del solicitante de un ticket."""
        try:
            ticket = await self._get(f"Ticket/{ticket_id}")
            return {
                "title": ticket.get("name", f"Ticket #{ticket_id}"),
                "requester_id": str(ticket.get("users_id_recipient") or ""),
            "status": ticket.get("status"),
            }
        except Exception:
            return {"title": f"Ticket #{ticket_id}", "requester_id": "", "status": None}

    async def get_ticket_content(self, ticket_id: int) -> str:
        try:
            ticket = await self._get(f"Ticket/{ticket_id}")
            return ticket.get("content", "") or ""
        except Exception:
            return ""

    async def get_ticket_image_documents(self, ticket_id: int) -> list[dict]:
        try:
            items = await self._get(f"Ticket/{ticket_id}/Document_Item", {"range": "0-20"})
            if not isinstance(items, list):
                return []
            docs = []
            for item in items:
                doc_id = item.get("documents_id")
                if not doc_id:
                    continue
                try:
                    doc = await self._get(f"Document/{doc_id}")
                    if isinstance(doc, dict) and (doc.get("mime") or "").startswith("image/"):
                        docs.append({"id": doc_id, "name": doc.get("filename") or doc.get("name", "imagen")})
                except Exception:
                    continue
            return docs
        except Exception:
            return []

    async def download_document(self, doc_id: int) -> bytes | None:
        if not self.session_token:
            await self.init_session()
        try:
            async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
                resp = await client.get(
                    f"{GLPI_URL}/Document/{doc_id}",
                    headers={**self._auth_headers(), "Accept": "application/octet-stream"},
                )
                ct = resp.headers.get("content-type", "")
                if resp.status_code == 200 and "image" in ct:
                    return resp.content
        except Exception:
            pass
        return None

    async def get_recent_validations(self, since_id: int = 0) -> list:
        params = {
            "criteria[0][field]": "1",
            "criteria[0][searchtype]": "greaterthan",
            "criteria[0][value]": str(since_id),
            "forcedisplay[0]": "1",
            "forcedisplay[1]": "2",
            "forcedisplay[2]": "3",
            "order": "DESC",
            "sort": "1",
            "range": "0-20",
        }
        result = await self._get("search/TicketValidation", params)
        return result.get("data", [])

    async def get_closed_by_day(self, date_from: str, date_to: str) -> dict[str, dict[str, int]]:
        """
        Tickets resueltos/cerrados (status 5 o 6) del grupo en [date_from, date_to],
        agrupados por dÃ­a de resoluciÃ³n y nombre de tÃ©cnico.
        Devuelve: { "YYYY-MM-DD": { "Nombre TÃ©cnico": count, ... }, ... }
        """
        group_id = await self.get_group_id()

        display = {
            "forcedisplay[0]": FIELD_ID,
            "forcedisplay[1]": FIELD_TECH,
            "forcedisplay[2]": FIELD_DATE_SOLVE,
        }
        base = {
            "criteria[0][field]":         FIELD_GROUP,
            "criteria[0][searchtype]":     "equals",
            "criteria[0][value]":          str(group_id),
            "criteria[1][link]":           "AND",
            "criteria[1][field]":          FIELD_DATE_SOLVE,
            "criteria[1][searchtype]":     "morethan",
            "criteria[1][value]":          f"{date_from} 00:00:00",
            "criteria[2][link]":           "AND",
            "criteria[2][field]":          FIELD_DATE_SOLVE,
            "criteria[2][searchtype]":     "lessthan",
            "criteria[2][value]":          f"{date_to} 23:59:59",
        }

        def _with_status(status: int) -> dict:
            return {
                **base,
                "criteria[3][link]":       "AND",
                "criteria[3][field]":      FIELD_STATUS,
                "criteria[3][searchtype]": "equals",
                "criteria[3][value]":      str(status),
                **display,
            }

        resolved, closed = await asyncio.gather(
            self._get_all_pages("search/Ticket", _with_status(5)),
            self._get_all_pages("search/Ticket", _with_status(6)),
        )
        all_tickets = resolved + closed

        tech_ids = {str(t.get(FIELD_TECH)) for t in all_tickets if t.get(FIELD_TECH)}
        name_map = await self.resolve_user_names(tech_ids)

        by_day: dict[str, dict[str, int]] = {}
        for t in all_tickets:
            solve_str = str(t.get(FIELD_DATE_SOLVE) or "")
            if len(solve_str) < 10:
                continue
            day = solve_str[:10]
            tech_id = str(t.get(FIELD_TECH) or "")
            tech = name_map.get(tech_id, "Sin asignar") if tech_id else "Sin asignar"
            by_day.setdefault(day, {})
            by_day[day][tech] = by_day[day].get(tech, 0) + 1

        return by_day


    async def get_pases_produccion(self, limit: int = 10, offset: int = 0) -> dict:
        """Tickets de la categoria Pases a Produccion (itilcategories_id=1797), mas recientes primero."""
        FIELD_CATEGORY = "7"
        params = {
            "criteria[0][field]":      FIELD_CATEGORY,
            "criteria[0][searchtype]": "equals",
            "criteria[0][value]":      "1797",
            "forcedisplay[0]":         FIELD_ID,
            "forcedisplay[1]":         FIELD_TITLE,
            "forcedisplay[2]":         FIELD_STATUS,
            "forcedisplay[3]":         FIELD_DATE_SOLVE,
            "forcedisplay[4]":         FIELD_REQUESTER,
            "order":                   "DESC",
            "sort":                    FIELD_ID,
            "range":                   f"{offset}-{offset + limit - 1}",
        }
        result = await self._get("search/Ticket", params)
        data = result.get("data", [])
        total = result.get("totalcount", 0)

        req_ids = {str(t.get(FIELD_REQUESTER)) for t in data if t.get(FIELD_REQUESTER)}
        name_map = await self.resolve_user_names(req_ids)

        tickets = []
        for t in data:
            status = t.get(FIELD_STATUS)
            is_done = status in (STATUS_SOLVED, STATUS_CLOSED)
            req_id = str(t.get(FIELD_REQUESTER) or "")
            tickets.append({
                "id":         t.get(FIELD_ID),
                "title":      t.get(FIELD_TITLE),
                "status":     "finalizado" if is_done else "pendiente",
                "close_date": t.get(FIELD_DATE_SOLVE) if is_done else None,
                "requester":  name_map.get(req_id, "â€”") if req_id else "â€”",
            })

        return {"tickets": tickets, "total": total}


glpi = GLPIClient()


