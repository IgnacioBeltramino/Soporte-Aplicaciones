from datetime import date, timedelta

from fastapi import APIRouter, Depends

import db
from auth import usuario_actual
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
async def get_open_tickets(usuario: dict = Depends(usuario_actual)):
    """Tickets abiertos del grupo.

    El jefe ve los de todo el equipo; el resto solo los que tiene asignados.
    El filtro se aplica en el backend a proposito: si dependiera del frontend,
    bastaria con llamar al endpoint a mano para ver los de los demas.
    """
    result = await glpi.get_open_tickets()
    raw_tickets = [_raw_ticket(t) for t in result.get("data", [])]

    if usuario["rol"] != db.ROL_JEFE:
        mi_id = str(usuario["glpi_user_id"])
        raw_tickets = [t for t in raw_tickets if mi_id in t["tech_ids"]]

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

    # Si se filtro por tecnico, el total del grupo que devuelve GLPI ya no
    # representa lo que el usuario esta viendo.
    total = (
        result.get("totalcount", 0)
        if usuario["rol"] == db.ROL_JEFE
        else len(tickets)
    )

    return {
        "en_curso": en_curso,
        "pendientes": pendientes,
        "total": total,
    }


@router.get("/mi-semana")
async def get_mi_semana(usuario: dict = Depends(usuario_actual)):
    """Cuantos tickets cerro el usuario cada dia de la semana en curso.

    Vive en este router y no en el de soporte a proposito. El de soporte exige
    la seccion "Cerrados por dia", que es el permiso para ver la tabla de todo
    el equipo, y los tecnicos no la tienen: si esto colgara de ahi, cada uno se
    quedaria sin poder ver ni lo suyo.

    El rango lo decide el backend y no el cliente: es siempre la semana en
    curso, no hay nada que elegir.
    """
    hoy = date.today()
    lunes = hoy - timedelta(days=hoy.weekday())
    por_dia = await glpi.get_cerrados_por_dia_de(
        usuario["glpi_user_id"], lunes.isoformat(), hoy.isoformat()
    )
    return {
        "desde":   lunes.isoformat(),
        "hasta":   hoy.isoformat(),
        "por_dia": por_dia,
        "total":   sum(por_dia.values()),
    }
