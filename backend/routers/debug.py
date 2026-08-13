"""Endpoints de diagnostico contra la API de GLPI.

Exponen tokens, configuracion interna y datos crudos, asi que el router entero
exige rol jefe: la dependencia se declara una sola vez a nivel de APIRouter y
aplica a todas las rutas de este archivo, incluidas las que se agreguen despues.

Las rutas conservan su path completo (no se usa prefix) para no romper URLs
que ya estaban en uso.
"""
from fastapi import APIRouter, Depends

from auth import solo_jefe
from glpi_client import glpi

router = APIRouter(dependencies=[Depends(solo_jefe)], tags=["debug"])


@router.get("/api/debug/group")
async def debug_group():
    """Busca el grupo y devuelve el ID resuelto."""
    group_id = await glpi.get_group_id()
    return {"group_id": group_id}


@router.get("/api/debug/search-options/ticket")
async def debug_ticket_fields():
    """Devuelve los campos disponibles para buscar tickets en esta instalacion de GLPI."""
    return await glpi._get("listSearchOptions/Ticket")


@router.get("/api/debug/search-options/group")
async def debug_group_fields():
    """Devuelve los campos disponibles para buscar grupos."""
    return await glpi._get("listSearchOptions/Group")


@router.get("/api/debug/followup-raw")
async def debug_followup_raw():
    return await glpi._get("search/ITILFollowup", {"range": "0-1"})


@router.get("/api/debug/followup-options")
async def debug_followup_options():
    return await glpi._get("listSearchOptions/ITILFollowup")


@router.get("/api/debug/ticket-raw")
async def debug_ticket_raw():
    """Devuelve los primeros 2 tickets finalizados con todos sus campos para debuggear."""
    from glpi_client import FIELD_GROUP, STATUS_SOLVED
    group_id = await glpi.get_group_id()
    return await glpi._get("search/Ticket", {
        "criteria[0][field]": FIELD_GROUP,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(group_id),
        "criteria[1][link]": "AND",
        "criteria[1][field]": "12",
        "criteria[1][searchtype]": "equals",
        "criteria[1][value]": str(STATUS_SOLVED),
        "range": "0-1",
    })


@router.get("/api/debug/ticket/{ticket_id}")
async def debug_ticket_detail(ticket_id: int):
    """Devuelve todos los campos de un ticket especifico."""
    return await glpi._get(f"Ticket/{ticket_id}")


@router.get("/api/debug/ticket-search/{ticket_id}")
async def debug_ticket_search(ticket_id: int):
    """Busca un ticket por ID y devuelve todos los campos incluyendo form (campo 120)."""
    return await glpi._get("search/Ticket", {
        "criteria[0][field]": "2",
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(ticket_id),
        "range": "0-0",
    })


@router.get("/api/notifications/status")
async def notifications_status():
    """Muestra el estado actual del sistema de notificaciones."""
    from routers.notifications import _state
    return {
        "state": _state,
        "group_id": glpi._group_id,
        "group_member_ids_cached": glpi._group_member_ids is not None,
    }


@router.get("/api/debug/telegram-config")
async def debug_telegram():
    from routers.notifications import TELEGRAM_BOT_TOKEN, BOSS_CHAT_ID, TECH_ID_MAP
    return {
        "token_cargado": bool(TELEGRAM_BOT_TOKEN),
        "boss_chat_id": BOSS_CHAT_ID,
        "tech_id_map": TECH_ID_MAP,
    }


@router.get("/api/debug/solution-options")
async def debug_solution_options():
    return await glpi._get("listSearchOptions/ITILSolution")


@router.get("/api/debug/ticket-groups/{ticket_id}")
async def debug_ticket_groups(ticket_id: int):
    """Devuelve los grupos asignados a un ticket (campo 8 = asignado, campo 71 = solicitante)."""
    return await glpi._get("search/Ticket", {
        "criteria[0][field]": "2",
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(ticket_id),
        "forcedisplay[0]": "2",
        "forcedisplay[1]": "8",
        "forcedisplay[2]": "71",
        "range": "0-0",
    })


@router.get("/api/debug/get-open-tickets")
async def debug_get_open_tickets():
    """Llama directamente a get_open_tickets() igual que el polling y devuelve los primeros 5."""
    result = await glpi.get_open_tickets()
    data = result.get("data", [])
    return {
        "totalcount": result.get("totalcount", 0),
        "count_returned": len(data),
        "primeros_5": data[:5],
        "last_ticket_id_en_estado": max((int(t.get("2", 0) or 0) for t in data), default=0),
    }


@router.get("/api/debug/open-tickets-raw")
async def debug_open_tickets_raw():
    """Ejecuta la misma query que get_open_tickets() y devuelve los primeros 5 resultados."""
    from glpi_client import (
        FIELD_DATE_OPEN,
        FIELD_GROUP,
        FIELD_ID,
        FIELD_STATUS,
        FIELD_TITLE,
        STATUS_PROCESSING_A,
    )
    group_id = await glpi.get_group_id()
    return await glpi._get("search/Ticket", {
        "criteria[0][field]":      FIELD_GROUP,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]":      str(group_id),
        "criteria[1][link]":       "AND",
        "criteria[1][field]":      FIELD_STATUS,
        "criteria[1][searchtype]": "equals",
        "criteria[1][value]":      str(STATUS_PROCESSING_A),
        "forcedisplay[0]":         FIELD_ID,
        "forcedisplay[1]":         FIELD_TITLE,
        "forcedisplay[2]":         FIELD_DATE_OPEN,
        "forcedisplay[3]":         FIELD_GROUP,
        "order":                   "DESC",
        "sort":                    FIELD_DATE_OPEN,
        "range":                   "0-4",
    })


@router.get("/api/debug/ticket-user/{ticket_id}")
async def debug_ticket_user(ticket_id: int):
    """Usuarios asignados a un ticket via Ticket_User (1=solicitante, 2=asignado, 3=observador)."""
    result = await glpi._get(f"Ticket/{ticket_id}/Ticket_User", {"range": "0-9"})
    tech_id = await glpi.get_ticket_assigned_tech(ticket_id)
    return {"ticket_user_raw": result, "tech_id_detectado": tech_id}
