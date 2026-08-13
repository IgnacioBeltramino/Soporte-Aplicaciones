import asyncio
import httpx
import logging
import os
import time
from typing import Optional
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

log = logging.getLogger("glpi")

GLPI_URL = os.getenv("GLPI_URL")
GLPI_WEB_URL = GLPI_URL.split("/apirest.php")[0] if GLPI_URL else ""
APP_TOKEN = os.getenv("GLPI_APP_TOKEN")
USER_TOKEN = os.getenv("GLPI_USER_TOKEN")

# Grupo de GLPI del que sale todo: los tickets que se muestran y, sobre todo,
# quien puede entrar al sistema (auth.py valida la membresia contra el).
#
# Sale del .env y no escrito aca porque de un nombre puesto en otro sistema no
# se puede depender: si alguien en GLPI renombra el grupo -le agrega "Area", le
# cambia una palabra- deja de encontrarse y **nadie puede loguearse**, con un
# error que no se parece en nada a la causa. Con la variable, eso se arregla
# editando una linea en vez de tocar el codigo.
#
# El valor por defecto es el que estaba escrito antes, asi que una instalacion
# que ya venia andando sigue igual sin agregar nada al .env.
GLPI_GROUP_NAME = os.getenv("GLPI_GROUP_NAME") or "Soporte Aplicaciones"

# Validacion del certificado de GLPI.
#
# Por esta conexion viajan el user token y el session token, que son las llaves
# de GLPI entero, no solo de este dashboard. Sin validar el certificado, quien
# se meta en el medio de la red se los queda y ademas puede contestar datos
# falsos, y nada en la app se entera.
#
# Va apagado por defecto porque el GLPI del municipio tiene certificado propio y
# prendiendolo a ciegas la app no arranca. Se resuelve exportando el certificado
# de la CA interna a un .pem y apuntando GLPI_CA_BUNDLE ahi en el .env del
# servidor; en la maquina de uno se deja vacio y todo sigue igual que siempre.
GLPI_CA_BUNDLE = (os.getenv("GLPI_CA_BUNDLE") or "").strip()


def verificacion_tls():
    """Que hacer con el certificado de GLPI: la ruta de la CA, o no validar."""
    if not GLPI_CA_BUNDLE:
        return False
    if not Path(GLPI_CA_BUNDLE).is_file():
        # Corta al arrancar y no en la primera consulta: un error de tipeo en la
        # ruta no puede terminar en que la app siga andando sin validar nada,
        # que es justo lo que se quiso evitar poniendo la variable.
        raise RuntimeError(
            f"GLPI_CA_BUNDLE apunta a un archivo que no existe: {GLPI_CA_BUNDLE}"
        )
    return GLPI_CA_BUNDLE

# Campos confirmados para esta instalacion de GLPI
FIELD_STATUS = "12"
FIELD_TECH = "5"
FIELD_GROUP = "8"
FIELD_TITLE = "1"
FIELD_ID = "2"
FIELD_DATE_OPEN  = "15"
FIELD_DATE_SOLVE = "17"  # solvedate (fecha de resolucion)
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


def ids_de_usuario(valor) -> list[str]:
    """Los ids de usuario de un campo que puede traer uno o varios.

    Cuando un ticket tiene dos tecnicos asignados, GLPI devuelve una lista en
    vez de un id suelto. Pasarla por str() daba la cadena "['78', '701']", que
    no es el id de nadie: el GET a User fallaba y el reporte terminaba
    mostrando esa cadena en la columna Tecnico.
    """
    if valor is None or valor == "":
        return []
    crudos = valor if isinstance(valor, list) else [valor]
    return [str(v) for v in crudos if v not in (None, "")]


def nombres_de_usuario(valor, name_map: dict) -> str:
    """Los nombres de `valor` separados por coma, o "Sin asignar" si no hay."""
    ids = ids_de_usuario(valor)
    if not ids:
        return "Sin asignar"
    return ", ".join(name_map.get(i, i) for i in ids)


def nombre_de_formulario(valor) -> str:
    """Nombre del formulario que origino un ticket, sin el numero de respuesta.

    El campo 120 viene como "Pase a Testing / Producción #204": el nombre del
    formulario y, detras del #, el numero de la respuesta. Se corta por el
    ultimo # para que un nombre que ya tenga uno adentro no se pierda.
    """
    if isinstance(valor, list):
        valor = valor[0] if valor else ""
    texto = str(valor or "").strip()
    if not texto:
        return ""
    return texto.rsplit("#", 1)[0].strip() if "#" in texto else texto


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


# Tope de conexiones simultaneas contra GLPI. Varias funciones lanzan decenas
# de consultas con asyncio.gather; sin este limite cada una abriria su propio
# socket y en Windows el selector revienta a los 512 descriptores
# ("ValueError: too many file descriptors in select()").
_LIMITES = httpx.Limits(max_connections=20, max_keepalive_connections=10)

# Cuanto vale la lista de tecnicos cacheada. Quince minutos: es el tiempo que uno
# tolera esperar a que aparezca un alta nueva, y evita rehacer el trabajo cada
# vez que se abre un reporte.
_TECHS_TTL = 15 * 60


class GLPIClient:
    def __init__(self):
        self.session_token: Optional[str] = None
        self._group_id: Optional[int] = None
        self._user_cache: dict[str, str] = {}
        self._group_member_ids: Optional[set[str]] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._techs_cache: Optional[list[dict]] = None
        self._techs_cache_ts: float = 0.0

    def _base_headers(self) -> dict:
        return {"App-Token": APP_TOKEN, "Content-Type": "application/json"}

    def _auth_headers(self) -> dict:
        return {**self._base_headers(), "Session-Token": self.session_token}

    def client(self) -> httpx.AsyncClient:
        """Cliente HTTP compartido: reutiliza conexiones en vez de abrir una por request."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                verify=verificacion_tls(),
                timeout=30.0,
                limits=_LIMITES,
            )
        return self._client

    async def aclose(self):
        """Cierra el cliente compartido. Se llama al apagar la app."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def init_session(self) -> str:
        resp = await self.client().get(
            f"{GLPI_URL}/initSession",
            headers={**self._base_headers(), "Authorization": f"user_token {USER_TOKEN}"},
        )
        resp.raise_for_status()
        self.session_token = resp.json()["session_token"]
        return self.session_token

    async def kill_session(self):
        if not self.session_token:
            return
        try:
            await self.client().get(f"{GLPI_URL}/killSession", headers=self._auth_headers())
        finally:
            self.session_token = None

    async def _get(self, endpoint: str, params: dict = None) -> dict:
        if not self.session_token:
            await self.init_session()
        client = self.client()
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
            "searchText[name]": GLPI_GROUP_NAME,
            "range": "0-5",
        })
        if isinstance(result, list) and result:
            self._group_id = result[0]["id"]
            return self._group_id
        return None

    async def get_group_member_ids(self) -> set[str]:
        """IDs de usuarios del grupo Soporte Aplicaciones (cacheado en memoria).

        Se consulta Group/{id}/Group_User y no Group_User con searchText porque
        searchText busca por coincidencia parcial: pidiendo "62" tambien
        entrarian los miembros de un eventual grupo 620 o 162. Como de este
        listado depende quien puede entrar al dashboard, la coincidencia tiene
        que ser exacta.
        """
        if self._group_member_ids is not None:
            return self._group_member_ids
        group_id = await self.get_group_id()
        if not group_id:
            return set()
        try:
            result = await self._get(f"Group/{group_id}/Group_User", {"range": "0-999"})
            if isinstance(result, list):
                self._group_member_ids = {
                    str(gu["users_id"]) for gu in result
                    if isinstance(gu, dict) and gu.get("users_id")
                }
                return self._group_member_ids
        except Exception as e:
            log.warning("Error obteniendo miembros del grupo %s: %s", group_id, e)
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

    async def _get_lista_completa(self, endpoint: str, params: dict, page_size: int = 1000) -> list:
        """Endpoints que devuelven una lista pelada (no una busqueda), paginando.

        Se pide de a page_size hasta que una pagina vuelve incompleta. Hace
        falta porque el range de GLPI no avisa que corto: Profile_User del
        perfil Solicitante tiene mas de mil filas, y pidiendo "0-999" volvian
        exactamente mil sin ninguna señal de que faltaban. La lista de tecnicos
        cambiaba de una consulta a la otra segun que mil habian entrado.
        """
        todo: list = []
        inicio = 0
        while True:
            pagina = await self._get(endpoint, {**params, "range": f"{inicio}-{inicio + page_size - 1}"})
            if not isinstance(pagina, list):
                break
            todo.extend(pagina)
            if len(pagina) < page_size:
                break
            inicio += page_size
        return todo

    async def _get_all_pages(self, endpoint: str, base_params: dict, page_size: int = 500) -> list:
        """Trae todos los resultados paginando automaticamente."""
        first = await self._get(endpoint, {**base_params, "range": f"0-{page_size - 1}"})
        data = list(first.get("data", []))
        total = first.get("totalcount", 0)

        if total <= page_size:
            return data

        # Paginas restantes en paralelo
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

        # Tickets finalizados con tecnico para ranking â€” todos, paginando
        solved_data, closed_data = await asyncio.gather(
            self._get_all_pages("search/Ticket", _ticket_params(group_id, STATUS_SOLVED, tech_display)),
            self._get_all_pages("search/Ticket", _ticket_params(group_id, STATUS_CLOSED, tech_display)),
        )

        # Contar por ID de tecnico primero
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
        """Trae los 20 seguimientos mas recientes."""
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
            log.exception("Error en get_recent_refused_solutions: %s", e)
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
        Devuelve solo usuarios con perfil de soporte/tecnico.
        Filtra por Profile_User usando perfiles cuyo nombre contenga
        keywords de soporte; fallback a todos los activos si falla.

        Cacheado: la lista tarda unos segundos en armarse y son los tecnicos de
        la organizacion, que no cambian de un minuto para el otro. El TTL existe
        para que un alta nueva aparezca sola, sin reiniciar el backend.
        """
        ahora = time.monotonic()
        if self._techs_cache is not None and ahora - self._techs_cache_ts < _TECHS_TTL:
            return self._techs_cache

        techs = await self._fetch_technicians()
        # Una lista vacia no se cachea: si GLPI fallo, el proximo pedido tiene
        # que volver a intentar y no quedarse con el vacio quince minutos.
        if techs:
            self._techs_cache = techs
            self._techs_cache_ts = ahora
        return techs

    async def _fetch_technicians(self) -> list[dict]:
        try:
            profiles = await self._get("Profile", {"range": "0-99"})
            if not isinstance(profiles, list) or not profiles:
                raise ValueError("no profiles")

            # Se fue la keyword "it": estaba adentro de "Solic-it-ante", asi que
            # el perfil Solicitante entraba como perfil tecnico y metia a toda
            # la organizacion (mil doscientas personas) en un desplegable que
            # tiene que listar tecnicos. "solicitante" queda ademas en la lista
            # de exclusion, que manda sobre la de inclusion: si algun dia se
            # suma un perfil como "Solicitante VIP", tampoco entra.
            # "técnico" y "tecnico" van las dos: GLPI puede tener el perfil
            # escrito con tilde o sin ella, y la comparacion es por substring,
            # asi que una no cubre a la otra. La primera estuvo mucho tiempo
            # corrupta ("tecnico", el mismo problema de encoding que tienen
            # algunos comentarios de este archivo) y por lo tanto muerta: no
            # matcheaba nunca. Si algun dia el unico perfil que importa se
            # llama "Técnico", de esta linea depende no caer en el fallback de
            # mas abajo, que es el que trae a toda la organizacion.
            TECH_KW    = {"técnico", "tecnico", "soporte", "super", "admin", "helpdesk"}
            EXCLUDE_KW = {"self-service", "self service", "autoservice", "observer", "solicitante"}

            tech_profile_ids = [
                p["id"] for p in profiles
                if (any(kw in p.get("name", "").lower() for kw in TECH_KW)
                    and not any(ex in p.get("name", "").lower() for ex in EXCLUDE_KW))
            ]

            # Si no matchea ningun keyword, excluir los perfiles de la lista de
            # exclusion y quedarse con el resto.
            if not tech_profile_ids:
                tech_profile_ids = [
                    p["id"] for p in profiles
                    if not any(ex in p.get("name", "").lower() for ex in EXCLUDE_KW)
                ]

            # Obtener Profile_User de cada perfil en paralelo
            pu_results = await asyncio.gather(*[
                self._get_lista_completa("Profile_User", {"searchText[profiles_id]": str(pid)})
                for pid in tech_profile_ids
            ], return_exceptions=True)

            # searchText busca por coincidencia parcial: pidiendo el perfil 4
            # tambien vuelven el 40, el 14 y el 24, con lo que se colaban
            # usuarios de perfiles que no son estos. Es el mismo cuidado que ya
            # se tiene en get_group_member_ids.
            permitidos = {str(p) for p in tech_profile_ids}
            user_ids: set[str] = set()
            for r in pu_results:
                if isinstance(r, list):
                    for pu in r:
                        if str(pu.get("profiles_id")) not in permitidos:
                            continue
                        if uid := pu.get("users_id"):
                            user_ids.add(str(uid))

            if not user_ids:
                raise ValueError("no users in tech profiles")

            # Los usuarios se traen de una sola busqueda paginada y despues se
            # filtran por los ids de perfil tecnico.
            #
            # Antes se pedia User/{id} uno por uno: con 841 tecnicos eran 841
            # requests contra GLPI de a 20 en paralelo, 16 segundos en los que
            # el desplegable decia "Cargando…". La busqueda paginada trae a
            # todos los activos en dos requests y tarda menos de 3.
            activos = await self._get_all_active_users()
            techs = [u for u in activos if u["id"] in user_ids]

            # La busqueda no devuelve absolutamente a todos: unos pocos usuarios
            # activos no aparecen (la busqueda respeta la entidad de la sesion y
            # User/{id} no). Son un puñado, asi que a esos si se les pregunta de
            # a uno. Sin esto, un tecnico activo desaparecia del desplegable.
            faltantes = user_ids - {u["id"] for u in techs}
            if faltantes:
                detalles = await asyncio.gather(*[
                    self._get(f"User/{uid}") for uid in faltantes
                ], return_exceptions=True)
                for d in detalles:
                    if not isinstance(d, dict) or not d.get("is_active") or not d.get("id"):
                        continue
                    firstname = str(d.get("firstname") or "").strip()
                    realname  = str(d.get("realname") or "").strip()
                    name = f"{firstname} {realname}".strip() or str(d.get("name") or "")
                    if name:
                        techs.append({"id": str(d["id"]), "name": name})

            return sorted(techs, key=lambda x: x["name"])

        except Exception:
            return await self._get_all_active_users()

    # Campos de busqueda de User (salen de listSearchOptions/User).
    #
    # El apellido es el 34 y no el 10: el 10 es otra cosa y venia siempre vacio,
    # asi que los usuarios quedaban con el nombre de pila solo ("Abigail" en vez
    # de "Abigail Campos"). Como esto solo se usaba de fallback, el error no se
    # veia; ahora es el camino principal de get_technicians.
    USER_ID        = "2"
    USER_FIRSTNAME = "9"
    USER_REALNAME  = "34"
    USER_LOGIN     = "1"
    USER_IS_ACTIVE = "8"

    async def _get_all_active_users(self) -> list[dict]:
        """Todos los usuarios activos, en una busqueda paginada."""
        try:
            params = {
                "forcedisplay[0]": self.USER_ID,
                "forcedisplay[1]": self.USER_FIRSTNAME,
                "forcedisplay[2]": self.USER_REALNAME,
                "forcedisplay[3]": self.USER_LOGIN,
                "criteria[0][field]": self.USER_IS_ACTIVE,
                "criteria[0][searchtype]": "equals",
                "criteria[0][value]": "1",
                "order": "ASC",
                "sort": self.USER_FIRSTNAME,
            }
            data = await self._get_all_pages("search/User", params)
            techs = []
            for u in data:
                firstname = str(u.get(self.USER_FIRSTNAME) or "").strip()
                realname  = str(u.get(self.USER_REALNAME) or "").strip()
                name = f"{firstname} {realname}".strip() or str(u.get(self.USER_LOGIN) or "")
                if name and u.get(self.USER_ID):
                    techs.append({"id": str(u[self.USER_ID]), "name": name})
            return sorted(techs, key=lambda x: x["name"])
        except Exception:
            return []

    async def get_report_tickets(
        self,
        filters: list[dict],
        date_from: str | None,
        date_to: str | None,
        solo_formulario: str | None = None,
    ) -> list[dict]:
        """Tickets para los reportes, con los nombres de tecnico y solicitante ya resueltos.

        `solo_formulario` deja unicamente los tickets de ese formulario exacto.
        Hace falta porque el campo 120 solo admite busqueda por texto: pedir
        "RAFAM" con `contains` tambien trae "Errores en RAFAM", "Alta de usuario
        de RAFAM" y cuatro formularios mas. Sobre 296 tickets, 8 eran del
        formulario pedido. GLPI no puede afinar mas que eso, asi que el recorte
        fino se hace aca.
        """
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
            "forcedisplay[8]": FIELD_FORM_NAME,
            "order": "DESC",
            "sort": FIELD_DATE_OPEN,
        }

        data = await self._get_all_pages("search/Ticket", {**criteria, **display})

        # El recorte por formulario va antes de resolver los nombres: sin esto
        # se pedirian a GLPI los nombres de gente que despues se descarta.
        if solo_formulario is not None:
            objetivo = solo_formulario.strip()
            data = [
                t for t in data
                if nombre_de_formulario(t.get(FIELD_FORM_NAME)) == objetivo
            ]

        tech_ids = {i for t in data for i in ids_de_usuario(t.get(FIELD_TECH))}
        req_ids = {i for t in data for i in ids_de_usuario(t.get(FIELD_REQUESTER))}
        name_map = await self.resolve_user_names(tech_ids | req_ids)

        tickets = []
        for t in data:
            tickets.append({
                "id": t.get(FIELD_ID),
                "title": t.get(FIELD_TITLE),
                "status": t.get(FIELD_STATUS),
                "opened_at": t.get(FIELD_DATE_OPEN),
                "due_at": t.get(FIELD_DATE_DUE),
                "tech": nombres_de_usuario(t.get(FIELD_TECH), name_map),
                "requester": nombres_de_usuario(t.get(FIELD_REQUESTER), name_map),
                "group": t.get(FIELD_GROUP),
                "form": nombre_de_formulario(t.get(FIELD_FORM_NAME)),
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
        """Devuelve titulo e ID del solicitante de un ticket."""
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
            resp = await self.client().get(
                f"{GLPI_URL}/Document/{doc_id}",
                headers={**self._auth_headers(), "Accept": "application/octet-stream"},
            )
            ct = resp.headers.get("content-type", "")
            if resp.status_code == 200 and "image" in ct:
                return resp.content
        except Exception as e:
            log.warning("Error descargando documento %s: %s", doc_id, e)
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
        agrupados por dia de resolucion y nombre de tecnico.
        Devuelve: { "YYYY-MM-DD": { "Nombre Tecnico": count, ... }, ... }

        Un ticket con varios tecnicos asignados suma uno a cada uno. Es la misma
        cuenta que hace get_cerrados_por_dia_de para "Tu Semana", asi que el
        numero que ve una persona en su inicio coincide con el de su fila en
        esta tabla. Como contrapartida, sumar toda una columna da mas que la
        cantidad de tickets del dia: los compartidos estan contados una vez por
        cada asignado, que es lo que se quiere cuando la tabla mide participacion.
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

        # ids_de_usuario y no str(): cuando un ticket tiene mas de un tecnico
        # asignado GLPI manda una lista, y str() sobre eso daba la cadena
        # "['1243', '717', '701']". Esa cadena no es el id de nadie, asi que el
        # GET a User fallaba, y la tabla terminaba con una columna llamada
        # literalmente ['1243', '717', '701'] que se quedaba con esos tickets
        # mientras los tres tecnicos de verdad no los veian aparecer.
        tech_ids = {i for t in all_tickets for i in ids_de_usuario(t.get(FIELD_TECH))}
        name_map = await self.resolve_user_names(tech_ids)

        by_day: dict[str, dict[str, int]] = {}
        for t in all_tickets:
            solve_str = str(t.get(FIELD_DATE_SOLVE) or "")
            if len(solve_str) < 10:
                continue
            day = solve_str[:10]
            by_day.setdefault(day, {})

            ids = ids_de_usuario(t.get(FIELD_TECH))
            if not ids:
                by_day[day]["Sin asignar"] = by_day[day].get("Sin asignar", 0) + 1
                continue
            # Uno para cada asignado, igual que en "Tu Semana".
            for tech_id in ids:
                tech = name_map.get(tech_id, tech_id)
                by_day[day][tech] = by_day[day].get(tech, 0) + 1

        return by_day


    async def get_cerrados_por_dia_de(self, tech_id, date_from: str, date_to: str) -> dict[str, int]:
        """Cuantos tickets cerro una persona por dia, en el rango dado.

        Filtra por el id del tecnico y no por el nombre. get_closed_by_day
        agrupa por nombre porque arma una tabla de todo el equipo, pero para
        una estadistica personal eso no alcanza: el nombre que devuelve GLPI no
        siempre coincide con el que tenemos guardado, y un numero propio que no
        cierra es peor que no mostrarlo.
        """
        group_id = await self.get_group_id()
        base = {
            "criteria[0][field]":      FIELD_GROUP,
            "criteria[0][searchtype]": "equals",
            "criteria[0][value]":      str(group_id),
            "criteria[1][link]":       "AND",
            "criteria[1][field]":      FIELD_DATE_SOLVE,
            "criteria[1][searchtype]": "morethan",
            "criteria[1][value]":      f"{date_from} 00:00:00",
            "criteria[2][link]":       "AND",
            "criteria[2][field]":      FIELD_DATE_SOLVE,
            "criteria[2][searchtype]": "lessthan",
            "criteria[2][value]":      f"{date_to} 23:59:59",
            "criteria[3][link]":       "AND",
            "criteria[3][field]":      FIELD_TECH,
            "criteria[3][searchtype]": "equals",
            "criteria[3][value]":      str(tech_id),
            "forcedisplay[0]":         FIELD_ID,
            "forcedisplay[1]":         FIELD_DATE_SOLVE,
        }

        def _con_estado(status: int) -> dict:
            return {
                **base,
                "criteria[4][link]":       "AND",
                "criteria[4][field]":      FIELD_STATUS,
                "criteria[4][searchtype]": "equals",
                "criteria[4][value]":      str(status),
            }

        resueltos, cerrados = await asyncio.gather(
            self._get_all_pages("search/Ticket", _con_estado(STATUS_SOLVED)),
            self._get_all_pages("search/Ticket", _con_estado(STATUS_CLOSED)),
        )

        por_dia: dict[str, int] = {}
        for t in resueltos + cerrados:
            solve = str(t.get(FIELD_DATE_SOLVE) or "")
            if len(solve) < 10:
                continue
            dia = solve[:10]
            por_dia[dia] = por_dia.get(dia, 0) + 1
        return por_dia

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


async def buscar_usuario_por_login(login: str) -> Optional[dict]:
    """Busca en GLPI el usuario cuyo login coincide con el de AD (ej: u60348).

    GLPI guarda el login de AD en el campo 'name'. La busqueda es por
    coincidencia parcial, asi que se filtra por igualdad exacta despues.
    """
    try:
        result = await glpi._get("User", {
            "searchText[name]": login,
            "range": "0-9",
        })
    except Exception:
        return None

    if not isinstance(result, list):
        return None

    for u in result:
        if str(u.get("name", "")).lower() == login.lower():
            nombre = f"{u.get('firstname') or ''} {u.get('realname') or ''}".strip()
            return {
                "glpi_user_id": int(u["id"]),
                "username": u.get("name"),
                "nombre": nombre or u.get("name"),
                "activo": int(u.get("is_active", 1)) == 1,
            }
    return None




