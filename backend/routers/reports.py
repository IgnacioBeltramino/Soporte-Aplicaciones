import re
import unicodedata
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from glpi_client import glpi, FIELD_TECH, FIELD_GROUP, FIELD_FORM_NAME
from pdf_generator import generate_report_pdf
from excel_generator import generate_report_excel

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Lo que Windows no admite en un nombre de archivo. La barra es el caso que se
# da de verdad: hay formularios que se llaman "Pase a Testing / Producción".
_PROHIBIDOS = re.compile(r'[\\/:*?"<>|]+')


def _nombre_archivo(prefijo: str, etiqueta: str, desde: str, hasta: str, ext: str) -> str:
    """Nombre del archivo que se descarga, con el periodo adentro."""
    limpio = _PROHIBIDOS.sub("-", etiqueta).strip()
    limpio = re.sub(r"\s+", "_", limpio)
    periodo = f"_{desde}_a_{hasta}" if desde and hasta else ""
    return f"reporte_{prefijo}_{limpio}{periodo}.{ext}"


def _descarga(contenido: bytes, mime: str, filename: str) -> Response:
    """Respuesta de descarga con el nombre en las dos formas que define el RFC 6266.

    Los headers HTTP viajan en latin-1, asi que un nombre con caracteres que no
    entren ahi tira el request entero al armar la respuesta. Va entonces una
    version sin acentos como `filename`, que entiende cualquier cliente, y la
    real en `filename*`, que es la que terminan usando los navegadores.
    """
    ascii_fallback = (
        unicodedata.normalize("NFKD", filename)
        .encode("ascii", "ignore")
        .decode("ascii")
        or "reporte"
    )
    disposicion = (
        f'attachment; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return Response(
        content=contenido,
        media_type=mime,
        headers={
            "Content-Disposition": disposicion,
            # Sin esto el navegador no ve el header y no puede ponerle el
            # nombre al archivo: fetch() solo expone los headers de esta lista.
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )

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


# ── Como se buscan los tickets de cada reporte ────────────────────────────────
#
# Las tres busquedas viven en una sola funcion cada una porque las usan tres
# endpoints: el que muestra en pantalla, el del PDF y el del Excel. Estaban
# escritas tres veces, y asi fue como el filtro por formulario quedo mal en las
# tres a la vez sin que se notara.

async def _tickets_de_tecnico(tech_id: str, date_from, date_to) -> list[dict]:
    return await glpi.get_report_tickets(
        filters=[{"field": FIELD_TECH, "searchtype": "equals", "value": tech_id}],
        date_from=date_from,
        date_to=date_to,
    )


async def _tickets_de_area(group_id: int, date_from, date_to) -> list[dict]:
    return await glpi.get_report_tickets(
        filters=[{"field": FIELD_GROUP, "searchtype": "equals", "value": group_id}],
        date_from=date_from,
        date_to=date_to,
    )


async def _formulario_o_404(form_id: int) -> dict:
    forms = await glpi.get_forms()
    form = next((f for f in forms if f["id"] == form_id), None)
    if not form:
        raise HTTPException(status_code=404, detail="Formulario no encontrado")
    return form


async def _tickets_de_formulario(form: dict, date_from, date_to) -> list[dict]:
    """Solo los del formulario pedido.

    El `contains` es lo unico que acepta GLPI sobre el campo 120, y arrastra los
    formularios cuyo nombre contiene al pedido: "RAFAM" traia tambien "Errores
    en RAFAM", "Alta de usuario de RAFAM" y cuatro mas, 288 tickets ajenos sobre
    296. El recorte exacto lo hace get_report_tickets con solo_formulario.
    """
    return await glpi.get_report_tickets(
        filters=[{"field": FIELD_FORM_NAME, "searchtype": "contains", "value": form["name"]}],
        date_from=date_from,
        date_to=date_to,
        solo_formulario=form["name"],
    )


# ── Report data endpoints ──────────────────────────────────────────────────────

@router.get("/by-technician")
async def report_by_technician(
    tech_id: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = _label_statuses(await _tickets_de_tecnico(tech_id, date_from, date_to))
    return {"summary": _summarize(tickets), "tickets": tickets}


@router.get("/by-area")
async def report_by_area(
    group_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = _label_statuses(await _tickets_de_area(group_id, date_from, date_to))
    return {"summary": _summarize(tickets), "tickets": tickets}


@router.get("/by-form")
async def report_by_form(
    form_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    form = await _formulario_o_404(form_id)
    tickets = _label_statuses(await _tickets_de_formulario(form, date_from, date_to))
    return {"summary": _summarize(tickets), "tickets": tickets, "form_name": form["name"]}


# ── PDF endpoints ─────────────────────────────────────────────────────────────

@router.get("/pdf/by-technician")
async def pdf_by_technician(
    tech_id: str = Query(...),
    tech_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await _tickets_de_tecnico(tech_id, date_from, date_to)
    pdf = generate_report_pdf("by_technician", f"Técnico: {tech_name}", date_from or "", date_to or "", tickets)
    return _descarga(pdf, "application/pdf",
                     _nombre_archivo("tecnico", tech_name, date_from, date_to, "pdf"))


@router.get("/pdf/by-area")
async def pdf_by_area(
    group_id: int = Query(...),
    group_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await _tickets_de_area(group_id, date_from, date_to)
    pdf = generate_report_pdf("by_area", f"Área: {group_name}", date_from or "", date_to or "", tickets)
    return _descarga(pdf, "application/pdf",
                     _nombre_archivo("area", group_name, date_from, date_to, "pdf"))


@router.get("/pdf/by-form")
async def pdf_by_form(
    form_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    form = await _formulario_o_404(form_id)
    tickets = await _tickets_de_formulario(form, date_from, date_to)
    pdf = generate_report_pdf("by_form", f"Formulario: {form['name']}", date_from or "", date_to or "", tickets)
    return _descarga(pdf, "application/pdf",
                     _nombre_archivo("formulario", form["name"], date_from, date_to, "pdf"))


# ── Excel endpoints ───────────────────────────────────────────────────────────
#
# Mismos filtros y mismos datos que los de PDF: lo unico que cambia es con que
# se arma el archivo. El Excel existe para lo que el PDF no puede, que es
# filtrar, ordenar y sumar sin volver a pedir el reporte.

@router.get("/excel/by-technician")
async def excel_by_technician(
    tech_id: str = Query(...),
    tech_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await _tickets_de_tecnico(tech_id, date_from, date_to)
    xlsx = generate_report_excel("by_technician", f"Técnico: {tech_name}", date_from or "", date_to or "", tickets)
    return _descarga(xlsx, XLSX_MIME,
                     _nombre_archivo("tecnico", tech_name, date_from, date_to, "xlsx"))


@router.get("/excel/by-area")
async def excel_by_area(
    group_id: int = Query(...),
    group_name: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    tickets = await _tickets_de_area(group_id, date_from, date_to)
    xlsx = generate_report_excel("by_area", f"Área: {group_name}", date_from or "", date_to or "", tickets)
    return _descarga(xlsx, XLSX_MIME,
                     _nombre_archivo("area", group_name, date_from, date_to, "xlsx"))


@router.get("/excel/by-form")
async def excel_by_form(
    form_id: int = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    form = await _formulario_o_404(form_id)
    tickets = await _tickets_de_formulario(form, date_from, date_to)
    xlsx = generate_report_excel("by_form", f"Formulario: {form['name']}", date_from or "", date_to or "", tickets)
    return _descarga(xlsx, XLSX_MIME,
                     _nombre_archivo("formulario", form["name"], date_from, date_to, "xlsx"))
