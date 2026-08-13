from fastapi import APIRouter
from glpi_client import glpi, FIELD_ID, FIELD_TITLE, FIELD_STATUS, FIELD_DATE_OPEN, FIELD_TECH
from glpi_client import EN_CURSO, PENDIENTES

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


def _extract_tech_ids(raw) -> list[str]:
    """GLPI puede devolver el campo técnico como ID único o como lista de IDs."""
    if isinstance(raw, list):
        return [str(x) for x in raw if x]
    return [str(raw)] if raw else []


def _raw_ticket(t: dict) -> dict:
    return {
        "id": t.get(FIELD_ID),
        "title": t.get(FIELD_TITLE),
        "status": t.get(FIELD_STATUS),
        "opened_at": t.get(FIELD_DATE_OPEN),
        "tech_ids": _extract_tech_ids(t.get(FIELD_TECH)),
    }


@router.get("/open")
async def get_open_tickets():
    result = await glpi.get_open_tickets()
    raw_tickets = [_raw_ticket(t) for t in result.get("data", [])]

    # Resolver todos los IDs (un ticket puede tener varios técnicos)
    all_ids = {tid for t in raw_tickets for tid in t["tech_ids"]}
    name_map = await glpi.resolve_user_names(all_ids)

    def resolve(t: dict) -> dict:
        names = [name_map.get(tid, tid) for tid in t["tech_ids"]]
        tech = ", ".join(n for n in names if n) or "Sin asignar"
        return {**t, "tech": tech}

    tickets = [resolve(t) for t in raw_tickets]
    en_curso  = [t for t in tickets if t["status"] in EN_CURSO]
    pendientes = [t for t in tickets if t["status"] in PENDIENTES]

    return {
        "en_curso": en_curso,
        "pendientes": pendientes,
        "total": result.get("totalcount", 0),
    }
