import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import tickets, stats, notifications, reports, soporte, pases
from glpi_client import glpi



@asynccontextmanager
async def lifespan(app: FastAPI):
    from routers.notifications import _initialize_state, _polling_loop
    await _initialize_state()
    task = asyncio.create_task(_polling_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

FRONTEND_PORT = os.getenv("FRONTEND_PORT") or "5173"

app = FastAPI(title="GLPI Dashboard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[f"http://localhost:{FRONTEND_PORT}"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tickets.router)
app.include_router(stats.router)
app.include_router(notifications.router)
app.include_router(reports.router)
app.include_router(soporte.router)
app.include_router(pases.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/debug/group")
async def debug_group():
    """Busca el grupo y devuelve el ID resuelto."""
    group_id = await glpi.get_group_id()
    return {"group_id": group_id}


@app.get("/api/debug/search-options/ticket")
async def debug_ticket_fields():
    """Devuelve los campos disponibles para buscar tickets en esta instalaciÃ³n de GLPI."""
    result = await glpi._get("listSearchOptions/Ticket")
    return result


@app.get("/api/debug/search-options/group")
async def debug_group_fields():
    """Devuelve los campos disponibles para buscar grupos."""
    result = await glpi._get("listSearchOptions/Group")
    return result


@app.get("/api/debug/followup-raw")
async def debug_followup_raw():
    result = await glpi._get("search/ITILFollowup", {
        "range": "0-1",
    })
    return result

@app.get("/api/debug/followup-options")
async def debug_followup_options():
    return await glpi._get("listSearchOptions/ITILFollowup")

@app.get("/api/debug/ticket-raw")
async def debug_ticket_raw():
    """Devuelve los primeros 2 tickets finalizados con todos sus campos para debuggear."""
    from glpi_client import FIELD_GROUP, STATUS_SOLVED
    group_id = await glpi.get_group_id()
    result = await glpi._get("search/Ticket", {
        "criteria[0][field]": FIELD_GROUP,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(group_id),
        "criteria[1][link]": "AND",
        "criteria[1][field]": "12",
        "criteria[1][searchtype]": "equals",
        "criteria[1][value]": str(STATUS_SOLVED),
        "range": "0-1",
    })
    return result


@app.get("/api/debug/ticket/{ticket_id}")
async def debug_ticket_detail(ticket_id: int):
    """Devuelve todos los campos de un ticket especÃ­fico."""
    return await glpi._get(f"Ticket/{ticket_id}")


@app.get("/api/debug/ticket-search/{ticket_id}")
async def debug_ticket_search(ticket_id: int):
    """Busca un ticket por ID y devuelve todos los campos incluyendo form (campo 120)."""
    return await glpi._get("search/Ticket", {
        "criteria[0][field]": "2",
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": str(ticket_id),
        "range": "0-0",
    })


@app.get("/api/notifications/status")
async def notifications_status():
    """Muestra el estado actual del sistema de notificaciones."""
    from routers.notifications import _state
    return {
        "state": _state,
        "group_id": glpi._group_id,
        "group_member_ids_cached": glpi._group_member_ids is not None,
    }


@app.get("/api/debug/telegram-config")
async def debug_telegram():
    from routers.notifications import TELEGRAM_BOT_TOKEN, BOSS_CHAT_ID, TECH_ID_MAP
    return {
        "token_cargado": bool(TELEGRAM_BOT_TOKEN),
        "boss_chat_id": BOSS_CHAT_ID,
        "tech_id_map": TECH_ID_MAP,
    }


@app.get("/api/debug/solution-options")
async def debug_solution_options():
    return await glpi._get("listSearchOptions/ITILSolution")


@app.get("/api/debug/ticket-groups/{ticket_id}")
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


@app.get("/api/debug/get-open-tickets")
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


@app.get("/api/debug/open-tickets-raw")
async def debug_open_tickets_raw():
    """Ejecuta la misma query que get_open_tickets() y devuelve los primeros 5 resultados."""
    from glpi_client import FIELD_GROUP, FIELD_STATUS, FIELD_ID, FIELD_TITLE, FIELD_DATE_OPEN, STATUS_PROCESSING_A
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


@app.get("/api/debug/ticket-user/{ticket_id}")
async def debug_ticket_user(ticket_id: int):
    """Devuelve los usuarios asignados a un ticket via Ticket_User (type 1=solicitante, 2=asignado, 3=observador)."""
    result = await glpi._get(f"Ticket/{ticket_id}/Ticket_User", {"range": "0-9"})
    tech_id = await glpi.get_ticket_assigned_tech(ticket_id)
    return {"ticket_user_raw": result, "tech_id_detectado": tech_id}



if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT") or "8000")
    uvicorn.run("main:app", host="0.0.0.0", reload=True, port=port)
