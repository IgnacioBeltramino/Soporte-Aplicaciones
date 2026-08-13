import asyncio
import json
import os
import re
import httpx
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from glpi_client import glpi, FIELD_ID, FIELD_TITLE, FIELD_DATE_OPEN, FIELD_GROUP, GLPI_WEB_URL

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

POLL_INTERVAL = 30
_last_seen_file = Path(os.path.dirname(__file__)).parent / "last_seen.json"
LAST_SEEN_FILE = _last_seen_file
MAX_CATCHUP_DAYS = 7

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_IDS  = [c.strip() for c in os.getenv("TELEGRAM_CHAT_ID", "").split(",") if c.strip()]

_state = {
    "last_ticket_id": 0,
    "last_followup_id": 0,
    "initialized": False,
}

_pending_events: list = []


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _html_to_text(html: str) -> str:
    """Convierte HTML a texto plano preservando saltos de lÃ­nea."""
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


async def _send_telegram(message: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_IDS:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    async with httpx.AsyncClient() as client:
        for chat_id in TELEGRAM_CHAT_IDS:
            try:
                await client.post(url, json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                })
            except Exception as e:
                print(f"[telegram] Error enviando a {chat_id}: {e}", flush=True)


async def _send_telegram_photo(photo_bytes: bytes, caption: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_IDS:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    async with httpx.AsyncClient() as client:
        for chat_id in TELEGRAM_CHAT_IDS:
            try:
                await client.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                    files={"photo": ("image.jpg", photo_bytes, "image/jpeg")},
                )
            except Exception as e:
                print(f"[telegram] Error enviando foto a {chat_id}: {e}", flush=True)


def _save_last_seen():
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _last_seen_file.write_text(json.dumps({"timestamp": ts}))
    except Exception as e:
        print(f"[notif] ERROR en _save_last_seen: {e}", flush=True)


def _load_last_seen():
    try:
        if not _last_seen_file.exists():
            return None
        data = json.loads(_last_seen_file.read_text())
        ts = data.get("timestamp")
        if not ts:
            return None
        dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        if dt < datetime.now() - timedelta(days=MAX_CATCHUP_DAYS):
            return None
        return ts
    except Exception:
        return None


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
        if not _last_seen_file.exists():
            _save_last_seen()
        _state["initialized"] = True
    except Exception as e:
        print(f"[notif] ERROR en _initialize_state: {e}", flush=True)


async def _get_catch_up_events(since):
    try:
        group_id = await glpi.get_group_id()
        if not group_id:
            return None

        t_result = await glpi._get("search/Ticket", {
            "criteria[0][field]":      FIELD_GROUP,
            "criteria[0][searchtype]": "equals",
            "criteria[0][value]":      str(group_id),
            "criteria[1][link]":       "AND",
            "criteria[1][field]":      FIELD_DATE_OPEN,
            "criteria[1][searchtype]": "morethan",
            "criteria[1][value]":      since,
            "forcedisplay[0]":         FIELD_ID,
            "forcedisplay[1]":         FIELD_TITLE,
            "forcedisplay[2]":         FIELD_DATE_OPEN,
            "order":                   "DESC",
            "sort":                    FIELD_DATE_OPEN,
            "range":                   "0-49",
        })
        tickets_data = [
            {
                "type": "new_ticket",
                "id": t.get(FIELD_ID),
                "title": t.get(FIELD_TITLE, "Sin titulo"),
                "opened_at": t.get(FIELD_DATE_OPEN, ""),
            }
            for t in t_result.get("data", [])
        ]

        f_result = await glpi._get("search/ITILFollowup", {
            "criteria[0][field]":      "3",
            "criteria[0][searchtype]": "morethan",
            "criteria[0][value]":      since,
            "forcedisplay[0]":         "7",
            "forcedisplay[1]":         "1",
            "forcedisplay[2]":         "5",
            "forcedisplay[3]":         "3",
            "order":                   "DESC",
            "sort":                    "7",
            "range":                   "0-49",
        })
        raw_followups = f_result.get("data", [])
        followups_data = []

        if raw_followups:
            details = await asyncio.gather(*[
                glpi.get_followup_detail(int(f["7"])) for f in raw_followups
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
            info_map = {}
            user_names = {}
            if group_ticket_ids:
                infos, user_names = await asyncio.gather(
                    asyncio.gather(*[glpi.get_ticket_info(tid) for tid in group_ticket_ids]),
                    glpi.resolve_user_names(user_ids),
                )
                info_map = dict(zip(group_ticket_ids, infos))
            elif user_ids:
                user_names = await glpi.resolve_user_names(user_ids)

            for detail in details:
                if not isinstance(detail, dict):
                    continue
                ticket_id = detail.get("items_id")
                user_id = str(detail.get("users_id", ""))
                info = info_map.get(ticket_id, {})
                requester_id = info.get("requester_id", "")
                is_external = user_id not in group_member_ids or (requester_id and user_id == requester_id)
                if ticket_id in group_ticket_ids and is_external:
                    followups_data.append({
                        "type": "new_followup",
                        "id": detail.get("id"),
                        "ticket_id": ticket_id,
                        "ticket_title": info.get("title", "Ticket #" + str(ticket_id)),
                        "content": detail.get("content", ""),
                        "author": user_names.get(user_id, "Desconocido"),
                    })

        if not tickets_data and not followups_data:
            return None

        n_tickets = len(tickets_data)
        n_followups = len(followups_data)
        await _send_telegram(
            f"<b>Resumen desde {since}</b>\n{n_tickets} tickets nuevos, {n_followups} seguimientos"
        )

        return {
            "type": "catch_up",
            "since": since,
            "tickets": tickets_data,
            "followups": followups_data,
        }
    except Exception:
        return None


async def _check_new_events():
    events = []
    try:
        tickets = await glpi.get_open_tickets()
        for t in tickets.get("data", []):
            tid = int(t.get(FIELD_ID, 0) or 0)
            if tid > _state["last_ticket_id"]:
                title = t.get(FIELD_TITLE, "Sin titulo")
                opened_at = t.get(FIELD_DATE_OPEN, "")
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

                msg = f"ðŸŽ« <b>Ticket nuevo #{tid}</b>\n{title}"
                if description:
                    msg += f"\n\n{description}"
                msg += f"\n\nðŸ• {_format_hhmm(opened_at)} Â· <a href=\"{_ticket_url(tid)}\">Ver ticket â†’</a>"
                await _send_telegram(msg)

                for doc in image_docs[:3]:
                    try:
                        photo = await glpi.download_document(doc["id"])
                        if photo:
                            await _send_telegram_photo(photo, f"#{tid}")
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
            ticket_infos, user_names = await asyncio.gather(
                asyncio.gather(*[glpi.get_ticket_info(tid) for tid in group_ticket_ids]),
                glpi.resolve_user_names(user_ids),
            )
            info_map = dict(zip(group_ticket_ids, ticket_infos))
            for f, detail in zip(new_followups, details):
                fid = int(f.get("7", 0) or 0)
                if isinstance(detail, dict):
                    ticket_id = detail.get("items_id")
                    user_id = str(detail.get("users_id", ""))
                    info = info_map.get(ticket_id, {})
                    requester_id = info.get("requester_id", "")
                    is_external = user_id not in group_member_ids or (requester_id and user_id == requester_id)
                    if ticket_id in group_ticket_ids and is_external:
                        ticket_title = info.get("title", "Ticket #" + str(ticket_id))
                        author = user_names.get(user_id, "Desconocido")
                        content_clean = _strip_html(detail.get("content", ""))[:200]
                        events.append({
                            "type": "new_followup",
                            "id": fid,
                            "ticket_id": ticket_id,
                            "ticket_title": ticket_title,
                            "content": detail.get("content", ""),
                            "author": author,
                        })
                        await _send_telegram(
                            f"<b>Seguimiento en Ticket #{ticket_id}</b>\n{ticket_title}\n<i>{author}</i>: {content_clean}"
                        )
                _state["last_followup_id"] = max(_state["last_followup_id"], fid)
    except Exception as e:
        print(f"[notif] ERROR en _check_new_events: {e}", flush=True)
    return events


async def _polling_loop():
    since = _load_last_seen()
    if since:
        catch_up = await _get_catch_up_events(since)
        if catch_up:
            _pending_events.append(catch_up)

    while True:
        await asyncio.sleep(POLL_INTERVAL)
        events = await _check_new_events()
        if events:
            _pending_events.extend(events)
        _save_last_seen()


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
