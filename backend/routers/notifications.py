import asyncio
import html
import json
import logging
import os
import re
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends

import db
from auth import usuario_actual
from glpi_client import glpi, FIELD_ID, FIELD_TITLE, FIELD_DATE_OPEN, FIELD_GROUP, FIELD_TECH, GLPI_WEB_URL, STATUS_CLOSED

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

log = logging.getLogger("notif")
log_telegram = logging.getLogger("telegram")

# Cada cuantos segundos se le pregunta a GLPI si hay novedades. En el server
# quizas convenga subirlo para no castigarlo: que sea una variable y no un
# numero escrito aca significa no tener que tocar codigo para eso.
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL") or 30)

# El token es del bot, no de las personas: sigue siendo config del entorno.
# A quien se le manda, en cambio, se administra desde Usuarios (tabla usuarios,
# columnas telegram_chat_id y telegram_activo). TELEGRAM_TECH_IDS y
# TELEGRAM_BOSS_CHAT_ID del .env ya no se leen: se importaron una sola vez a la
# base en la migracion de db.py y quedaron para historia.
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

_state = {
    "last_ticket_id": 0,
    "last_followup_id": 0,
    "last_solution_id": 0,
    "initialized": False,
}

def _destinatarios_dashboard(tech_id: str | None) -> set[int]:
    """Quienes deben ver esta notificacion dentro del dashboard.

    Los jefes ven todo lo del grupo. Tecnicos y pasantes, solo lo de los
    tickets que tienen asignados. Es la misma regla que ya se usaba para
    Telegram, aplicada a los usuarios del dashboard.
    """
    destinatarios = set(db.ids_por_rol(db.ROL_JEFE))
    if tech_id:
        try:
            uid = int(tech_id)
        except (TypeError, ValueError):
            return destinatarios
        usuario = db.get_usuario(uid)
        if usuario and usuario["habilitado"]:
            destinatarios.add(uid)
    return destinatarios


def _encolar(evento: dict, tech_id: str | None):
    """Guarda una copia del evento para cada destinatario que corresponda."""
    payload = json.dumps(evento)
    for uid in _destinatarios_dashboard(tech_id):
        db.guardar_notificacion(uid, evento["type"], int(evento["id"]), payload)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _esc(texto) -> str:
    """Escapa el texto que se mete en un mensaje de Telegram.

    Los avisos se mandan con parse_mode="HTML", asi que Telegram lee las etiquetas
    del mensaje. El titulo de un ticket lo escribe cualquiera que abra un ticket
    en GLPI: si trae un `<`, un `>` o un `&` suelto, Telegram contesta 400
    ("can't parse entities") y el aviso se pierde en silencio, porque el envio
    corre en el loop de fondo y ahi los errores solo se loguean.

    Escapando queda el texto tal cual lo escribieron, y las unicas etiquetas que
    Telegram interpreta son las que pone este archivo (el <b> del titulo y el
    <a> del link al ticket)."""
    return html.escape(str(texto or ""), quote=False)


def _html_to_text(html: str) -> str:
    """Convierte HTML a texto plano preservando saltos de linea."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>|</li>|</div>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _ticket_url(ticket_id: int) -> str:
    # El destino va URL-encodeado. Con un solo parametro da igual, pero si
    # manana el destino lleva un segundo (&algo=x) sin encodear se cortaria ahi:
    # PHP lo leeria como parametro de index.php y no como parte del redirect.
    destino = quote(f"/front/ticket.form.php?id={ticket_id}", safe="")
    return f"{GLPI_WEB_URL}/index.php?redirect={destino}"


def _format_hhmm(dt_str: str) -> str:
    if not dt_str:
        return ""
    parts = str(dt_str).split()
    return parts[1][:5] if len(parts) >= 2 else str(dt_str)[:5]



def _recipients_for(tech_id) -> list[str]:
    """Chats a los que va este aviso: los jefes, mas el tecnico asignado.

    Es la misma regla que _destinatarios_dashboard pero en chats de Telegram, y
    sale toda de la base. Quien no tenga chat cargado simplemente no aparece.
    El pasante queda afuera por rol (lo filtra db.chat_telegram_de).
    """
    recipients = db.chats_telegram(db.ROL_JEFE)

    if tech_id:
        try:
            chat = db.chat_telegram_de(int(tech_id))
        except (TypeError, ValueError):
            chat = None
        if chat and chat not in recipients:
            recipients.append(chat)

    return recipients


async def _send_telegram_to(message: str, chat_ids: list[str]):
    if not TELEGRAM_BOT_TOKEN or not chat_ids:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    # Con validacion de certificado, a diferencia del cliente de GLPI: aquel
    # habla con un servidor interno de certificado propio, este sale a internet
    # y por aca viaja el token del bot.
    async with httpx.AsyncClient() as client:
        for chat_id in chat_ids:
            try:
                await client.post(url, json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                })
            except Exception as e:
                log_telegram.warning("Error enviando a %s: %s", chat_id, e)


async def _send_telegram_photo_to(photo_bytes: bytes, caption: str, chat_ids: list[str]):
    if not TELEGRAM_BOT_TOKEN or not chat_ids:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    async with httpx.AsyncClient() as client:
        for chat_id in chat_ids:
            try:
                await client.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                    files={"photo": ("image.jpg", photo_bytes, "image/jpeg")},
                )
            except Exception as e:
                log_telegram.warning("Error enviando foto a %s: %s", chat_id, e)


async def enviar_mensaje_de_prueba(chat_id: str) -> tuple[bool, str]:
    """Manda un mensaje suelto a un chat y devuelve (ok, detalle).

    Las otras dos funciones de envio se tragan los errores porque corren en el
    loop de fondo, donde no hay a quien avisarle. Aca interesa el motivo: es lo
    que ve el jefe cuando prueba un chat recien cargado, y la diferencia entre
    "el numero esta mal" y "falta el token" es todo lo que necesita saber.
    """
    if not TELEGRAM_BOT_TOKEN:
        return False, "El servidor no tiene TELEGRAM_BOT_TOKEN configurado en el .env."

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    mensaje = (
        "✅ <b>Prueba de Soporte Aplicaciones</b>\n"
        "Si estas viendo esto, el chat quedo bien configurado."
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(url, json={
                "chat_id": chat_id,
                "text": mensaje,
                "parse_mode": "HTML",
            })
        datos = res.json()
        if res.status_code == 200 and datos.get("ok"):
            return True, "Mensaje enviado."
        # Telegram explica bastante bien que paso ("chat not found", etc.).
        return False, datos.get("description") or f"Telegram respondio {res.status_code}."
    except Exception as e:
        return False, f"No se pudo contactar a Telegram: {e}"


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
        log.exception("Error en _initialize_state: %s", e)


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
                evento = {
                    "type": "new_ticket",
                    "id": tid,
                    "title": title,
                    "opened_at": opened_at,
                }
                events.append(evento)
                _encolar(evento, tech_id)

                content_result, image_docs_result = await asyncio.gather(
                    glpi.get_ticket_content(tid),
                    glpi.get_ticket_image_documents(tid),
                    return_exceptions=True,
                )
                content_html = content_result if isinstance(content_result, str) else ""
                image_docs = image_docs_result if isinstance(image_docs_result, list) else []
                description = _html_to_text(content_html)[:500]

                # Escapado solo aca, al armar el mensaje de Telegram. En el
                # evento del dashboard va crudo a proposito: React lo escapa
                # solo, y escaparlo dos veces mostraria "&amp;" en pantalla.
                msg = f"\U0001F3AB <b>Ticket nuevo #{tid}</b>\n{_esc(title)}"
                if description:
                    msg += f"\n\n{_esc(description)}"
                msg += f"\n\n\U0001F557 {_format_hhmm(opened_at)} \u00B7 <a href=\"{_ticket_url(tid)}\">Ver ticket \u2192</a>"
                log.info("Ticket #%s, tech=%r", tid, tech_id)
                await _send_telegram_to(msg, recipients)

                for doc in image_docs[:3]:
                    try:
                        photo = await glpi.download_document(doc["id"])
                        if photo:
                            await _send_telegram_photo_to(photo, f"#{tid}", recipients)
                    except Exception as e:
                        log_telegram.warning("Error enviando imagen ticket #%s: %s", tid, e)

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
                        log.info("Seg #%s tk #%s tech=%r", fid, ticket_id, tech_id)
                        evento = {
                            "type": "new_followup",
                            "id": fid,
                            "ticket_id": ticket_id,
                            "ticket_title": ticket_title,
                            "content": detail.get("content", ""),
                            "author": author,
                        }
                        events.append(evento)
                        _encolar(evento, tech_id)
                        followup_time = _format_hhmm(detail.get("date", ""))
                        await _send_telegram_to(
                            f"\U0001F4AC <b>Nuevo seguimiento #{ticket_id}</b>\n{_esc(ticket_title)}\n\U0001F464 {_esc(author)}\n\n{_esc(content_clean)}\n\n\U0001F557 {followup_time} \u00B7 <a href=\"{_ticket_url(ticket_id)}\">Ver ticket \u2192</a>",
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
                    log.info("Sol rechazada sol#%s tk#%s tech=%r", sol_id, ticket_id, tech_id)
                    evento = {
                        "type": "solution_rejected",
                        "id": sol_id,
                        "ticket_id": ticket_id,
                        "ticket_title": ticket_title,
                    }
                    events.append(evento)
                    _encolar(evento, tech_id)
                    await _send_telegram_to(
                        f"❌ <b>Solución rechazada #{ticket_id}</b>\n{_esc(ticket_title)}\n\U0001F557 {rejection_time} · <a href=\"{_ticket_url(ticket_id)}\">Ver ticket →</a>",
                        recipients,
                    )
                _state["last_solution_id"] = max(_state["last_solution_id"], sol_id)
    except Exception as e:
        log.exception("Error en _check_new_events: %s", e)
    return events


async def _polling_loop():
    vueltas = 0
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        await _check_new_events()   # cada evento se encola por destinatario
        vueltas += 1
        # Una vez por dia aprox: purga lo ya entregado de mas de 30 dias.
        if vueltas % (86400 // POLL_INTERVAL) == 0:
            borradas = db.limpiar_notificaciones(30)
            if borradas:
                log.info("Purgadas %s notificaciones viejas", borradas)
            # La auditoria se guarda mucho mas tiempo que las notificaciones (un
            # año contra treinta dias): una notificacion vieja no le importa a
            # nadie, y un registro de auditoria recien sirve cuando alguien
            # pregunta por algo que paso hace meses.
            viejas = db.limpiar_auditoria()
            if viejas:
                log.info("Purgados %s registros de auditoria de mas de %s dias",
                         viejas, db.AUDITORIA_DIAS)


# Aca vivia /stream, un endpoint de Server-Sent Events que quedo de una version
# anterior. No lo usaba nadie: la pantalla trae las novedades con un fetch a
# /poll cada POLL_INTERVAL segundos, y el generador de eventos ademas solo
# mandaba latidos, nunca un evento de verdad. Se fue: una conexion abierta por
# usuario, sostenida para no transmitir nada, es superficie que no hace falta.


@router.get("/poll")
async def poll_notifications(usuario: dict = Depends(usuario_actual)):
    """Notificaciones pendientes del usuario que consulta.

    Cada uno tiene su propia cola: lo que se lleva uno no se lo saca a otro.
    """
    if not _state["initialized"]:
        await _initialize_state()
    return [
        {**json.loads(n["payload"]), "receivedAt": n["creada"]}
        for n in db.tomar_notificaciones(usuario["glpi_user_id"])
    ]


