from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from glpi_client import glpi, FIELD_TECH, FIELD_GROUP, FIELD_FORM_NAME
from pdf_generator import generate_report_pdf

router = APIRouter(prefix="/api/reports", tags=["reports"])

EN_CURSO   = {1, 2, 3}
PENDIENTES = {4}
FINALIZADOS = {5, 6}

STATUS_LABELS = {
    1: "Nuevo", 2: "En curso", 3: "En curso (Plan.)",
    4: "Pendiente", 5: "Resuelto", 6: "Cerrado",
}


def _summarize(tickets: list[dict]) -> dict:
    def st(t):
        try:
            return int(t.get("status", 0))
        except Exception:
            return 0

    return {
        "open":    sum(1 for t in tickets if st(t) in EN_CURSO),
        "pending": sum(1 for t in tickets if st(t) in PENDIENTES),
        "closed":  sum(1 for t in tickets if st(t) in FINALIZADOS),
        "total":   len(tickets),
    }


def _label_statuses(tickets: list[dict]) -> list[dict]:
    result = []
    for t in tickets:
        try:
            sv = int(t.get("status", 0))
        except Exception:
            sv = 0
        result.append({**t, "status_label": STATUS_LABELS.get(sv, str(sv))})
    return result


# ── Lookup endpoints ───────────────────────────────────────────────────────────

@router.get("/groups")
async def get_groups():
    return await glpi.get_all_groups()


@router.get("/forms")
async def get_forms():
    return await glpi.get_forms()


@router.get("/technicians")
async def get_technicians():
    return await glpi.get_technicians()


# ── Report data endpoints ──────────────────────────────────────────────────────

@router.get("/by-technician")
async def report_by_technician(
    tech_id: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_TECH, "searchtype": "equals", "value": tech_id}],
        date_from=date_from,
        date_to=date_to,
    )
    tickets = _label_statuses(tickets)
    return {"summary": _summarize(tickets), "tickets": tickets}


@router.get("/by-area")
async def report_by_area(
    group_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_GROUP, "searchtype": "equals", "value": group_id}],
        date_from=date_from,
        date_to=date_to,
    )
    tickets = _label_statuses(tickets)
    return {"summary": _summarize(tickets), "tickets": tickets}


@router.get("/by-form")
async def report_by_form(
    form_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    forms = await glpi.get_forms()
    form = next((f for f in forms if f["id"] == form_id), None)
    if not form:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")

    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_FORM_NAME, "searchtype": "contains", "value": form["name"]}],
        date_from=date_from,
        date_to=date_to,
    )
    tickets = _label_statuses(tickets)
    return {"summary": _summarize(tickets), "tickets": tickets, "form_name": form["name"]}


# ── PDF endpoints ─────────────────────────────────────────────────────────────

@router.get("/pdf/by-technician")
async def pdf_by_technician(
    tech_id: str = Query(...),
    tech_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_TECH, "searchtype": "equals", "value": tech_id}],
        date_from=date_from,
        date_to=date_to,
    )
    pdf = generate_report_pdf("by_technician", f"Técnico: {tech_name}", date_from or "", date_to or "", tickets)
    filename = f"reporte_tecnico_{tech_name.replace(' ', '_')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/pdf/by-area")
async def pdf_by_area(
    group_id: int = Query(...),
    group_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_GROUP, "searchtype": "equals", "value": group_id}],
        date_from=date_from,
        date_to=date_to,
    )
    pdf = generate_report_pdf("by_area", f"Área: {group_name}", date_from or "", date_to or "", tickets)
    filename = f"reporte_area_{group_name.replace(' ', '_')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/pdf/by-form")
async def pdf_by_form(
    form_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    forms = await glpi.get_forms()
    form = next((f for f in forms if f["id"] == form_id), None)
    if not form:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")

    tickets = await glpi.get_report_tickets(
        filters=[{"field": FIELD_FORM_NAME, "searchtype": "contains", "value": form["name"]}],
        date_from=date_from,
        date_to=date_to,
    )
    pdf = generate_report_pdf("by_form", f"Formulario: {form['name']}", date_from or "", date_to or "", tickets)
    filename = f"reporte_formulario_{form['name'].replace(' ', '_')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
