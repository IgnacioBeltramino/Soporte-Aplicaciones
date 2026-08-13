from io import BytesIO
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

# ── Palette ──────────────────────────────────────────────────────────────────

WHITE     = colors.white
GRAY_100  = colors.HexColor("#f5f5f5")
GRAY_200  = colors.HexColor("#e5e5e5")
GRAY_400  = colors.HexColor("#a1a1a1")
GRAY_700  = colors.HexColor("#404040")
GRAY_900  = colors.HexColor("#171717")
BLUE      = colors.HexColor("#3a81f6")
YELLOW    = colors.HexColor("#d97706")
GREEN     = colors.HexColor("#16a34a")
RED       = colors.HexColor("#dc2626")

STATUS_LABELS = {1: "Nuevo", 2: "En curso", 3: "En curso", 4: "Pendiente", 5: "Resuelto", 6: "Cerrado"}
STATUS_COLORS = {1: BLUE, 2: BLUE, 3: BLUE, 4: YELLOW, 5: GREEN, 6: GREEN}

EN_CURSO   = {1, 2, 3}
PENDIENTES = {4}
FINALIZADOS = {5, 6}

REPORT_TITLES = {
    "by_technician": "Reporte por Técnico",
    "by_area":       "Reporte por Área",
    "by_form":       "Reporte por Formulario",
}


def _st(status_val):
    try:
        return int(status_val)
    except Exception:
        return 0


def _fmt_date(val):
    if not val:
        return "—"
    s = str(val)[:10]
    try:
        d = datetime.strptime(s, "%Y-%m-%d")
        return d.strftime("%d/%m/%Y")
    except Exception:
        return s


def _para(text, style):
    return Paragraph(str(text or ""), style)


# ── Styles ────────────────────────────────────────────────────────────────────

def _styles():
    base = dict(fontName="Helvetica", textColor=GRAY_900, leading=12)
    bold = {**base, "fontName": "Helvetica-Bold"}

    def s(name, **kw):
        merged = {**base, **kw}
        return ParagraphStyle(name, **merged)

    return {
        "title":    s("title",    fontName="Helvetica-Bold", fontSize=16, textColor=GRAY_900, leading=20),
        "subtitle": s("subtitle", fontSize=10, textColor=GRAY_700, leading=13),
        "meta":     s("meta",     fontSize=8,  textColor=GRAY_400),
        "meta_r":   s("meta_r",   fontSize=8,  textColor=GRAY_400, alignment=TA_RIGHT),
        "date_r":   s("date_r",   fontSize=9,  textColor=GRAY_700, alignment=TA_RIGHT),
        "lbl":      s("lbl",      fontName="Helvetica-Bold", fontSize=7, textColor=GRAY_400, leading=9),
        "cell":     s("cell",     fontSize=8,  textColor=GRAY_900, leading=10),
        "cell_m":   s("cell_m",   fontSize=8,  textColor=GRAY_400, leading=10),
        "th":       s("th",       fontName="Helvetica-Bold", fontSize=7, textColor=GRAY_400, leading=9),
        "footer":   s("footer",   fontSize=7,  textColor=GRAY_400, alignment=TA_CENTER),
    }


# ── PDF builder ───────────────────────────────────────────────────────────────

def generate_report_pdf(
    report_type: str,
    filter_label: str,
    date_from: str,
    date_to: str,
    tickets: list[dict],
) -> bytes:
    buffer = BytesIO()
    page_w, page_h = A4
    margin = 1.5 * cm
    usable_w = page_w - 2 * margin

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=margin,  bottomMargin=margin,
    )

    st = _styles()
    story = []

    open_t    = [t for t in tickets if _st(t.get("status")) in EN_CURSO]
    pending_t = [t for t in tickets if _st(t.get("status")) in PENDIENTES]
    closed_t  = [t for t in tickets if _st(t.get("status")) in FINALIZADOS]

    date_range = f"{_fmt_date(date_from)} — {_fmt_date(date_to)}"
    generated  = f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}"

    # ── Header ────────────────────────────────────────────────────────────────
    hdr = Table(
        [
            [_para(REPORT_TITLES.get(report_type, "Reporte"), st["title"]),
             _para(generated, st["meta_r"])],
            [_para(filter_label, st["subtitle"]),
             _para(f"Período: {date_range}", st["date_r"])],
        ],
        colWidths=[usable_w * 0.65, usable_w * 0.35],
    )
    hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), GRAY_100),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (0, -1),  14),
        ("RIGHTPADDING",  (-1, 0), (-1, -1), 14),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW",     (0, 1), (-1, 1),  1, GRAY_200),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 14))

    # ── Summary cards ─────────────────────────────────────────────────────────
    def _card_num(n, color):
        return _para(str(n), ParagraphStyle("cn", fontName="Helvetica-Bold", fontSize=22,
                                             textColor=color, leading=26))

    card_w = usable_w / 4
    summary = Table(
        [
            [_para("ABIERTOS", st["lbl"]), _para("PENDIENTES", st["lbl"]),
             _para("CERRADOS", st["lbl"]),  _para("TOTAL", st["lbl"])],
            [_card_num(len(open_t), BLUE), _card_num(len(pending_t), YELLOW),
             _card_num(len(closed_t), GREEN), _card_num(len(tickets), GRAY_900)],
        ],
        colWidths=[card_w] * 4,
    )
    summary.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), WHITE),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("LINEBEFORE",    (1, 0), (3, -1),  1, GRAY_200),
        ("LINEBELOW",     (0, 1), (-1, 1),  1, GRAY_200),
        ("BOX",           (0, 0), (-1, -1), 1, GRAY_200),
    ]))
    story.append(summary)
    story.append(Spacer(1, 18))

    # ── Detail table ──────────────────────────────────────────────────────────
    if not tickets:
        story.append(_para("No se encontraron tickets para los filtros seleccionados.", st["meta"]))
    else:
        th = st["th"]
        header_row = [
            _para("ID",          th), _para("TÍTULO",       th),
            _para("ESTADO",      th), _para("TÉCNICO",      th),
            _para("SOLICITANTE", th), _para("APERTURA",     th),
            _para("VENCIMIENTO", th),
        ]

        rows = [header_row]
        for t in tickets:
            sv = _st(t.get("status"))
            s_label = STATUS_LABELS.get(sv, str(sv))
            s_color = STATUS_COLORS.get(sv, GRAY_900)
            s_style = ParagraphStyle("sv", fontName="Helvetica-Bold", fontSize=8,
                                      textColor=s_color, leading=10)
            rows.append([
                _para(f"#{t.get('id', '')}", st["cell_m"]),
                _para((t.get("title") or "")[:90], st["cell"]),
                _para(s_label, s_style),
                _para((t.get("tech") or "Sin asignar")[:35], st["cell"]),
                _para((t.get("requester") or "Sin asignar")[:35], st["cell"]),
                _para(_fmt_date(t.get("opened_at")), st["cell_m"]),
                _para(_fmt_date(t.get("due_at")), st["cell_m"]),
            ])

        col_w = [
            usable_w * 0.07,
            usable_w * 0.30,
            usable_w * 0.11,
            usable_w * 0.14,
            usable_w * 0.14,
            usable_w * 0.11,
            usable_w * 0.11,
        ]

        detail = Table(rows, colWidths=col_w, repeatRows=1)
        row_bg = [GRAY_100 if i % 2 == 0 else WHITE for i in range(len(rows) - 1)]

        detail.setStyle(TableStyle([
            # header
            ("BACKGROUND",    (0, 0),  (-1, 0),   GRAY_200),
            ("TOPPADDING",    (0, 0),  (-1, 0),   7),
            ("BOTTOMPADDING", (0, 0),  (-1, 0),   7),
            ("LINEBELOW",     (0, 0),  (-1, 0),   1, GRAY_400),
            # data rows
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [GRAY_100, WHITE]),
            ("TOPPADDING",    (0, 1),  (-1, -1),  5),
            ("BOTTOMPADDING", (0, 1),  (-1, -1),  5),
            ("LINEBELOW",     (0, 1),  (-1, -1),  0.5, GRAY_200),
            # all
            ("LEFTPADDING",   (0, 0),  (-1, -1),  6),
            ("RIGHTPADDING",  (0, 0),  (-1, -1),  6),
            ("VALIGN",        (0, 0),  (-1, -1),  "MIDDLE"),
            ("BOX",           (0, 0),  (-1, -1),  1, GRAY_200),
        ]))
        story.append(detail)

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(_para(
        f"GLPI Dashboard  •  {datetime.now().strftime('%d/%m/%Y %H:%M')}  •  {len(tickets)} ticket(s)",
        st["footer"],
    ))

    doc.build(story)
    return buffer.getvalue()
