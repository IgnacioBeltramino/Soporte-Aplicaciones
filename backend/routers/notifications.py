import asyncio
import json
import os
import re
import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from glpi_client import glpi, FIELD_ID, FIELD_TITLE, FIELD_DATE_OPEN, FIELD_GROUP, FIELD_TECH, GLPI_WEB_URL, STATUS_CLOSED

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

POLL_INTERVAL = 30

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BOSS_CHAT_ID = os.getenv("TELEGRAM_BOSS_CHAT_ID", "").strip()
TECH_ID_MAP: dict[str, str] = {}
for _pair in os.getenv("TELEGRAM_TECH_IDS", "").split(","):
    _pair = _pair.strip()
    if ":" in _pair:
        _uid, _cid = _pair.split(":", 1)
        if _uid.strip() and _cid.strip():
            TECH_ID_MAP[_uid.strip()] = _cid.strip()

_state = {
    "last_ticket_id": 0,
    "last_followup_id": 0,
    "last_solution_id": 0,
    "initialized": False,
}

_pending_events: list = []


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _html_to_text(html: str) -> str:
    """Convierte HTML a texto plano preservando saltos de lÃƒÂ­nea."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>|</li>|</div>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _ticket_url(ticket_id: int) -> str:
    return f"{GLPI_WEB_URL}/index.php?redirect=/front/ticket.form.php?id={ticket_id}"


def _format_hhmm(dt_str: str) -> str:
    if not dt_str:
        return ""
    parts = str(dt_str).split()
    return parts[1][:5] if len(parts) >= 2 else str(dt_str)[:5]



def _recipients_for(tech_id) -> list[str]:
    """Boss siempre recibe. Tecnico recibe si tiene chat_id mapeado."""
    recipients = []
    if BOSS_CHAT_ID:
        recipients.append(BOSS_CHAT_ID)
    if tech_id and tech_id in TECH_ID_MAP:
        cid = TECH_ID_MAP[tech_id]
        if cid not in recipients:
            recipients.append(cid)
    return recipients


async def _send_telegram_to(message: str, chat_ids: list[str]):
    if not TELEGRAM_BOT_TOKEN or not chat_ids:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient(verify=False) as client:
        for chat_id in chat_ids:
            try:
                await client.post(url, json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                })
            except Exception as e:
                print(f"[telegram] Error enviando a {chat_id}: {e}", flush=True)


async def _send_telegram_photo_to(photo_bytes: bytes, caption: str, chat_ids: list[str]):
    if not TELEGRAM_BOT_TOKEN or not chat_ids:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    async with httpx.AsyncClient(verify=False) as client:
        for chat_id in chat_ids:
            try:
                await client.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                    files={"photo": ("image.jpg", photo_bytes, "image/jpeg")},
                )
            except Exception as e:
                print(f"[telegram] Error enviando foto a {chat_id}: {e}", flush=True)


async def _initialize_state():
    try:
        if not await glpi.get_group_id():
            return
        tickets = await glpi.get_open_tickets()
        data = tickets.get("data", [])
        if data:
            _state["last_ticket_id"] = max(int(t.get(FIELD_ID, 0) or 0) for t in data)
        followups = await glpi.get_recent_followups()
        if followups:
            _state["last_followup_id"] = max(int(f.get("7", 0) or 0) for f in followups)
        sol_result = await glpi._get("search/ITILSolution", {
            "criteria[0][field]": "4",
            "criteria[0][searchtype]": "equals",
            "criteria[0][value]": "Ticket",
            "forcedisplay[0]": "2",
            "order": "DESC",
            "sort": "2",
            "range": "0-0",
        })
        sol_data = sol_result.get("data", [])
        if sol_data:
            _state["last_solution_id"] = int(sol_data[0].get("2", 0) or 0)
        _state["initialized"] = True
    except Exception as e:
        print(f"[notif] ERROR en _initialize_state: {e}", flush=True)


async def _check_new_events():
    events = []
    try:
        tickets = await glpi.get_open_tickets()
        for t in tickets.get("data", []):
            tid = int(t.get(FIELD_ID, 0) or 0)
            if tid > _state["last_ticket_id"]:
                title = t.get(FIELD_TITLE, "Sin titulo")
                opened_at = t.get(FIELD_DATE_OPEN, "")
                tech_id = str(t.get(FIELD_TECH) or "")
                recipients = _recipients_for(tech_id)
                events.append({
                    "type": "new_ticket",
                    "id": tid,
                    "title": title,
                    "opened_at": opened_at,
                })

                content_result, image_docs_result = await asyncio.gather(
                    glpi.get_ticket_content(tid),
                    glpi.get_ticket_image_documents(tid),
                    return_exceptions=True,
                )
                content_html = content_result if isinstance(content_result, str) else ""
                image_docs = image_docs_result if isinstance(image_docs_result, list) else []
                description = _html_to_text(content_html)[:500]

                msg = f"\U0001F3AB <b>Ticket nuevo #{tid}</b>\n{title}"
                if description:
                    msg += f"\n\n{description}"
                msg += f"\n\n\U0001F557 {_format_hhmm(opened_at)} \u00B7 <a href=\"{_ticket_url(tid)}\">Ver ticket \u2192</a>"
                print(f"[notif] Ticket #{tid}, tech={tech_id!r}", flush=True)
                await _send_telegram_to(msg, recipients)

                for doc in image_docs[:3]:
                    try:
                        photo = await glpi.download_document(doc["id"])
                        if photo:
                            await _send_telegram_photo_to(photo, f"#{tid}", recipients)
                    except Exception as e:
                        print(f"[telegram] Error enviando imagen ticket #{tid}: {e}", flush=True)

                _state["last_ticket_id"] = max(_state["last_ticket_id"], tid)

        followups = await glpi.get_recent_followups()
        new_followups = [f for f in followups if int(f.get("7", 0) or 0) > _state["last_followup_id"]]

        if new_followups:
            details = await asyncio.gather(*[
                glpi.get_followup_detail(int(f["7"])) for f in new_followups
            ], return_exceptions=True)
            all_ticket_ids = {
                d["items_id"] for d in details
                if isinstance(d, dict) and d.get("items_id")
            }
            group_ticket_ids, group_member_ids = await asyncio.gather(
                glpi.tickets_in_group(all_ticket_ids),
                glpi.get_group_member_ids(),
            )
            user_ids = {
                str(d["users_id"]) for d in details
                if isinstance(d, dict) and d.get("users_id")
            }
            ticket_infos, assigned_techs, user_names = await asyncio.gather(
                asyncio.gather(*[glpi.get_ticket_info(tid) for tid in group_ticket_ids]),
                asyncio.gather(*[glpi.get_ticket_assigned_tech(tid) for tid in group_ticket_ids]),
                glpi.resolve_user_names(user_ids),
            )
            info_map = dict(zip(group_ticket_ids, ticket_infos))
            tech_map = dict(zip(group_ticket_ids, assigned_techs))
            for f, detail in zip(new_followups, details):
                fid = int(f.get("7", 0) or 0)
                if isinstance(detail, dict):
                    ticket_id = detail.get("items_id")
                    user_id = str(detail.get("users_id", ""))
                    info = info_map.get(ticket_id, {})
                    requester_id = info.get("requester_id", "")
                    is_external = user_id not in group_member_ids or (requester_id and user_id == requester_id)
                    if ticket_id in group_ticket_ids and is_external and info.get("status") != STATUS_CLOSED:
                        tech_id = tech_map.get(ticket_id, "")
                        recipients = _recipients_for(tech_id)
                        ticket_title = info.get("title", "Ticket #" + str(ticket_id))
                        author = user_names.get(user_id, "Desconocido")
                        content_clean = _strip_html(detail.get("content", ""))[:200]
                        print(f"[notif] Seg #{fid} tk #{ticket_id} tech={tech_id!r}", flush=True)
                        events.append({
                            "type": "new_followup",
                            "id": fid,
                            "ticket_id": ticket_id,
                            "ticket_title": ticket_title,
                            "content": detail.get("content", ""),
                            "author": author,
                        })
                        followup_time = _format_hhmm(detail.get("date", ""))
                        await _send_telegram_to(
                            f"\U0001F4AC <b>Nuevo seguimiento #{ticket_id}</b>\n{ticket_title}\n\U0001F464 {author}\n\n{content_clean}\n\n\U0001F557 {followup_time} \u00B7 <a href=\"{_ticket_url(ticket_id)}\">Ver ticket \u2192</a>",
                            recipients,
                        )
                _state["last_followup_id"] = max(_state["last_followup_id"], fid)

        refused_solutions = await glpi.get_recent_refused_solutions(_state["last_solution_id"])
        if refused_solutions:
            ref_ticket_ids = {s["ticket_id"] for s in refused_solutions if s.get("ticket_id")}
            if ref_ticket_ids:
                group_ticket_ids, ticket_infos_list, assigned_techs_list = await asyncio.gather(
                    glpi.tickets_in_group(ref_ticket_ids),
                    asyncio.gather(*[glpi.get_ticket_info(tid) for tid in ref_ticket_ids]),
                    asyncio.gather(*[glpi.get_ticket_assigned_tech(tid) for tid in ref_ticket_ids]),
                )
                info_map = dict(zip(ref_ticket_ids, ticket_infos_list))
                tech_map = dict(zip(ref_ticket_ids, assigned_techs_list))
            else:
                group_ticket_ids = set()
                info_map = {}
                tech_map = {}
            for sol in refused_solutions:
                sol_id = sol["id"]
                ticket_id = sol.get("ticket_id")
                if ticket_id in group_ticket_ids:
                    info = info_map.get(ticket_id, {})
                    tech_id = tech_map.get(ticket_id, "")
                    ticket_title = info.get("title", f"Ticket #{ticket_id}")
                    recipients = _recipients_for(tech_id)
                    rejection_time = _format_hhmm(sol.get("date", ""))
                    print(f"[notif] Sol rechazada sol#{sol_id} tk#{ticket_id} tech={tech_id!r}", flush=True)
                    events.append({
                        "type": "solution_rejected",
                        "id": sol_id,
                        "ticket_id": ticket_id,
                        "ticket_title": ticket_title,
                    })
                    await _send_telegram_to(
                        f"❌ <b>Solución rechazada #{ticket_id}</b>\n{ticket_title}\n\U0001F557 {rejection_time} · <a href=\"{_ticket_url(ticket_id)}\">Ver ticket →</a>",
                        recipients,
                    )
                _state["last_solution_id"] = max(_state["last_solution_id"], sol_id)
    except Exception as e:
        print(f"[notif] ERROR en _check_new_events: {e}", flush=True)
    return events


async def _polling_loop():
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        events = await _check_new_events()
        if events:
            _pending_events.extend(events)


async def _event_generator():
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        yield "data: " + json.dumps({"type": "heartbeat"}) + "\n\n"


@router.get("/stream")
async def stream_notifications():
    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/poll")
async def poll_notifications():
    if not _state["initialized"]:
        await _initialize_state()
    events = list(_pending_events)
    _pending_events.clear()
    return events


