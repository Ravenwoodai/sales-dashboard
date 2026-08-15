import argparse
import json
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfdoc import PDFString
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


WORK_DIR = Path(__file__).resolve().parent


def parse_args():
    parser = argparse.ArgumentParser(description="Render the governed Lead Utilisation report PDF.")
    parser.add_argument("--report-data", required=True, type=Path)
    parser.add_argument("--sales-split", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--logo", required=True, type=Path)
    parser.add_argument("--font-dir", type=Path)
    return parser.parse_args()


ARGS = parse_args()
DATA = json.loads(ARGS.report_data.resolve().read_text(encoding="utf-8"))
SALES_SPLIT = json.loads(ARGS.sales_split.resolve().read_text(encoding="utf-8"))
OUTPUT_PATH = ARGS.output.resolve()
LOGO_PATH = ARGS.logo.resolve()
FONT_DIR = ARGS.font_dir.resolve() if ARGS.font_dir else None
REPORT_PERIOD = DATA.get("reportingPeriod", {})
REPORT_SUBTITLE = DATA.get("subtitle", "")


def display_iso_date(value):
    parsed = date.fromisoformat(value)
    return f"{parsed.strftime('%A')} {parsed.day} {parsed.strftime('%B %Y')}"

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

BRAND_RED = colors.HexColor("#EE3424")
CHARCOAL = colors.HexColor("#231F20")
CALLED_GREEN = colors.HexColor("#1F6F5B")
WASTED_RED = colors.HexColor("#B42318")
NEUTRAL = colors.HexColor("#607080")
TREND_BLUE = colors.HexColor("#2563A6")
ADJUSTED_AMBER = colors.HexColor("#C47A12")
PANEL = colors.HexColor("#F5F6F7")
BORDER = colors.HexColor("#D6D9DD")
SECONDARY = colors.HexColor("#5B6470")
WHITE = colors.white
PAGE_TAGS = []
CURRENT_TAGS = []


def register_fonts():
    configured = {
        "SourceSans3": "SourceSans3-Regular.ttf",
        "SourceSans3-Medium": "SourceSans3-Medium.ttf",
        "SourceSans3-Semibold": "SourceSans3-Semibold.ttf",
        "SourceSans3-Bold": "SourceSans3-Bold.ttf",
    }
    windows_fonts = Path("C:/Windows/Fonts")
    fallback = {
        "SourceSans3": windows_fonts / "arial.ttf",
        "SourceSans3-Medium": windows_fonts / "arial.ttf",
        "SourceSans3-Semibold": windows_fonts / "arialbd.ttf",
        "SourceSans3-Bold": windows_fonts / "arialbd.ttf",
    }
    for reportlab_name, filename in configured.items():
        candidate = FONT_DIR / filename if FONT_DIR else fallback[reportlab_name]
        if not candidate.is_file():
            candidate = fallback[reportlab_name]
        if not candidate.is_file():
            raise FileNotFoundError(f"Required PDF font is unavailable: {candidate}")
        pdfmetrics.registerFont(TTFont(reportlab_name, str(candidate)))


def fmt(value):
    return f"{int(value):,}"


def pct(value):
    return f"{float(value) * 100:.1f}%"


def norm_name(value):
    return " ".join(str(value or "").strip().split()).casefold()


SALES_SPLIT_BY_PERSON = {norm_name(row["salesperson"]): row for row in SALES_SPLIT["salespeople"]}


def text_width(text, font, size):
    return pdfmetrics.stringWidth(str(text), font, size)


def wrap_text(text, font, size, max_width):
    words = str(text).split()
    if not words:
        return [""]
    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if text_width(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(c, text, x, y_top, max_width, font="SourceSans3", size=10, leading=12, colour=CHARCOAL, max_lines=None):
    lines = wrap_text(text, font, size, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(colour)
    for index, line in enumerate(lines):
        c.drawString(x, y_top - index * leading, line)
    return len(lines)


def draw_footer(c, page_number):
    c.addLiteral("/Artifact BMC")
    y = 13 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.line(MARGIN, y + 4 * mm, PAGE_W - MARGIN, y + 4 * mm)
    c.setFont("SourceSans3", 8.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN, y, f"Lead Utilisation & Wastage Report | {REPORT_SUBTITLE}")
    c.drawRightString(PAGE_W - MARGIN, y, f"Page {page_number}")
    c.addLiteral("EMC")


def begin_tag(c, role, alt=None):
    mcid = len(CURRENT_TAGS)
    CURRENT_TAGS.append({"role": role, "mcid": mcid, "alt": alt})
    c.addLiteral(f"/{role} <</MCID {mcid}>> BDC")


def end_tag(c):
    c.addLiteral("EMC")


def draw_header(c, title, subtitle=None, title_size=20):
    top = PAGE_H - 15 * mm
    title_x = MARGIN + 5 * mm
    logo_x = PAGE_W - MARGIN - 35 * mm
    title_max_width = logo_x - title_x - 5 * mm
    fitted_title_size = title_size
    while fitted_title_size > 14 and text_width(title, "SourceSans3-Bold", fitted_title_size) > title_max_width:
        fitted_title_size -= 0.5
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, top - 12 * mm, 2.2 * mm, 12 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Bold", fitted_title_size)
    c.setFillColor(CHARCOAL)
    c.drawString(title_x, top - 6 * mm, title)
    if subtitle:
        c.setFont("SourceSans3", 10.5)
        c.setFillColor(SECONDARY)
        c.drawString(MARGIN + 5 * mm, top - 12.5 * mm, subtitle)
    c.drawImage(str(LOGO_PATH), logo_x, top - 8 * mm, width=35 * mm, height=35 * mm * 56 / 326, preserveAspectRatio=True, mask="auto")


def draw_section_heading(c, text, x, y, size=13.5):
    c.setFillColor(BRAND_RED)
    c.rect(x, y - 4 * mm, 1.8 * mm, 5.5 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Semibold", size)
    c.setFillColor(CHARCOAL)
    c.drawString(x + 4 * mm, y - 3 * mm, text)


def draw_kpi_cards(c, items, y, height=31 * mm, value_size=24):
    gap = 2 * mm
    width = (CONTENT_W - gap * (len(items) - 1)) / len(items)
    for index, (label, value, colour) in enumerate(items):
        x = MARGIN + index * (width + gap)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.6)
        c.roundRect(x, y, width, height, 1.6 * mm, fill=1, stroke=1)
        lines = wrap_text(label, "SourceSans3-Semibold", 9.5, width - 8 * mm)
        c.setFont("SourceSans3-Semibold", 9.5)
        c.setFillColor(SECONDARY)
        label_y = y + height - 7.5 * mm
        for line_index, line in enumerate(lines[:2]):
            c.drawCentredString(x + width / 2, label_y - line_index * 10.5, line)
        c.setFont("SourceSans3-Bold", value_size)
        c.setFillColor(colour)
        c.drawCentredString(x + width / 2, y + 6.3 * mm, value)


def draw_line_plot(c, labels, series, x, y, width, height, percent_axis=True, show_legend=True, compact=False):
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.roundRect(x, y, width, height, 1.5 * mm, fill=1, stroke=1)
    left = x + (8 if compact else 12) * mm
    right = x + width - 4 * mm
    bottom = y + (6 if compact else 9) * mm
    top = y + height - (6 if compact else 9) * mm
    values = [value for _, points, _ in series for value in points if value is not None]
    axis_max = 1.0 if percent_axis else max(values or [1]) * 1.08
    axis_max = axis_max or 1
    ticks = [0, 0.25, 0.5, 0.75, 1.0]
    c.setFont("SourceSans3", 6.5 if compact else 7.5)
    for fraction in ticks:
        tick_y = bottom + (top - bottom) * fraction
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.35)
        c.line(left, tick_y, right, tick_y)
        c.setFillColor(SECONDARY)
        label = f"{fraction * 100:.0f}%" if percent_axis else f"{axis_max * fraction:,.0f}"
        c.drawRightString(left - 1.5 * mm, tick_y - 1.8, label)
    point_count = max(1, len(labels))
    def point_x(index):
        return left + (right - left) * (index / max(1, point_count - 1))
    for name, points, colour in series:
        previous = None
        c.setStrokeColor(colour)
        c.setFillColor(colour)
        c.setLineWidth(1.4 if compact else 1.8)
        for index, value in enumerate(points):
            if value is None:
                previous = None
                continue
            current = (point_x(index), bottom + (top - bottom) * max(0, min(float(value) / axis_max, 1)))
            if previous is not None:
                c.line(previous[0], previous[1], current[0], current[1])
            c.circle(current[0], current[1], 1.25 if compact else 1.7, fill=1, stroke=0)
            previous = current
    if labels:
        shown = range(len(labels)) if len(labels) <= 6 else [0, len(labels) - 1]
        c.setFont("SourceSans3", 6.2 if compact else 7.2)
        c.setFillColor(SECONDARY)
        for index in shown:
            c.drawCentredString(point_x(index), y + 2.2 * mm, labels[index])
    if show_legend and series:
        legend_x = left
        legend_y = y + height - 4.3 * mm
        c.setFont("SourceSans3", 7.5)
        for name, _, colour in series:
            c.setFillColor(colour)
            c.rect(legend_x, legend_y - 1.7 * mm, 4 * mm, 1.2 * mm, fill=1, stroke=0)
            c.setFillColor(SECONDARY)
            c.drawString(legend_x + 5 * mm, legend_y - 1.9 * mm, name)
            legend_x += text_width(name, "SourceSans3", 7.5) + 14 * mm


def hatch_rect(c, x, y, width, height):
    if width <= 0:
        return
    c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.72))
    c.setLineWidth(0.5)
    spacing = 3 * mm
    offset = -height
    while offset <= width:
        x1 = x + max(0, offset)
        y1 = y + max(0, -offset)
        x2 = x + min(width, offset + height)
        y2 = y + min(height, width - offset)
        if x2 >= x1 and y2 >= y1:
            c.line(x1, y1, x2, y2)
        offset += spacing


def draw_chart(c, managers, x, y, width, height):
    label_width = 43 * mm
    end_width = 50 * mm
    plot_width = width - label_width - end_width
    max_received = max(row["received"] for row in managers)
    bar_height = 8 * mm
    # Keep every manager bar above the footer on a one-page management chart.
    gap = 2 * mm
    top = y + height - 10 * mm

    legend_x = x + width - 54 * mm
    c.setFillColor(CALLED_GREEN)
    c.rect(legend_x, y + height - 5.5 * mm, 5 * mm, 3.2 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3", 9)
    c.setFillColor(SECONDARY)
    c.drawString(legend_x + 7 * mm, y + height - 5 * mm, "Called")
    c.setFillColor(WASTED_RED)
    c.rect(legend_x + 27 * mm, y + height - 5.5 * mm, 5 * mm, 3.2 * mm, fill=1, stroke=0)
    hatch_rect(c, legend_x + 27 * mm, y + height - 5.5 * mm, 5 * mm, 3.2 * mm)
    c.setFillColor(SECONDARY)
    c.drawString(legend_x + 34 * mm, y + height - 5 * mm, "Wasted")

    for index, manager in enumerate(managers):
        bar_y = top - (index + 1) * (bar_height + gap)
        c.setFont("SourceSans3-Medium", 9.5)
        c.setFillColor(CHARCOAL)
        c.drawString(x, bar_y + 2.5 * mm, manager["manager"])

        called_width = plot_width * manager["called"] / max_received
        wasted_width = plot_width * manager["wasted"] / max_received
        bar_x = x + label_width
        c.setFillColor(CALLED_GREEN)
        c.rect(bar_x, bar_y, called_width, bar_height, fill=1, stroke=0)
        c.setFillColor(WASTED_RED)
        c.rect(bar_x + called_width, bar_y, wasted_width, bar_height, fill=1, stroke=0)
        hatch_rect(c, bar_x + called_width, bar_y, wasted_width, bar_height)
        c.setStrokeColor(WHITE)
        c.setLineWidth(0.7)
        c.line(bar_x + called_width, bar_y, bar_x + called_width, bar_y + bar_height)

        c.setFont("SourceSans3-Semibold", 8.7)
        c.setFillColor(WHITE)
        if called_width > 15 * mm:
            c.drawCentredString(bar_x + called_width / 2, bar_y + 2.6 * mm, fmt(manager["called"]))
        if wasted_width > 15 * mm:
            c.drawCentredString(bar_x + called_width + wasted_width / 2, bar_y + 2.6 * mm, fmt(manager["wasted"]))

        end_text = f'{fmt(manager["received"])} total  |  {pct(manager["called"] / manager["received"])} utilised'
        c.setFont("SourceSans3", 9.2)
        c.setFillColor(SECONDARY)
        c.drawString(bar_x + called_width + wasted_width + 3 * mm, bar_y + 2.5 * mm, end_text)


def draw_table(c, headers, rows, widths_mm, x, y_top, header_height_mm, row_height_mm, font_size=9.5, left_columns=None, centre_columns=None, header_max_lines=2):
    left_columns = set(left_columns or [])
    centre_columns = set(centre_columns or [])
    widths = [value * mm for value in widths_mm]
    total_width = sum(widths)
    header_height = header_height_mm * mm
    row_height = row_height_mm * mm
    c.setFillColor(CHARCOAL)
    c.rect(x, y_top - header_height, total_width, header_height, fill=1, stroke=0)
    current_x = x
    for column, (header, width) in enumerate(zip(headers, widths)):
        lines = wrap_text(header, "SourceSans3-Semibold", font_size - 0.25, width - 3 * mm)
        c.setFont("SourceSans3-Semibold", font_size - 0.25)
        c.setFillColor(WHITE)
        visible_lines = lines[:header_max_lines]
        block_height = len(visible_lines) * (font_size + 1.2)
        base = y_top - header_height / 2 + block_height / 2 - font_size
        for line_index, line in enumerate(visible_lines):
            c.drawCentredString(current_x + width / 2, base - line_index * (font_size + 1.2), line)
        current_x += width

    y = y_top - header_height
    for row_index, row in enumerate(rows):
        row_y = y - (row_index + 1) * row_height
        c.setFillColor(WHITE if row_index % 2 == 0 else PANEL)
        c.rect(x, row_y, total_width, row_height, fill=1, stroke=0)
        current_x = x
        for column, (value, width) in enumerate(zip(row, widths)):
            c.setFont("SourceSans3-Medium" if column in left_columns else "SourceSans3", font_size)
            c.setFillColor(CHARCOAL)
            text = str(value)
            baseline = row_y + (row_height - font_size) / 2 + 1
            if column in left_columns:
                c.drawString(current_x + 2 * mm, baseline, text)
            elif column in centre_columns:
                c.drawCentredString(current_x + width / 2, baseline, text)
            else:
                c.drawRightString(current_x + width - 2 * mm, baseline, text)
            current_x += width

    bottom = y_top - header_height - len(rows) * row_height
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.45)
    c.rect(x, bottom, total_width, header_height + len(rows) * row_height, fill=0, stroke=1)
    current_x = x
    for width in widths[:-1]:
        current_x += width
        c.line(current_x, bottom, current_x, y_top)
    c.line(x, y_top - header_height, x + total_width, y_top - header_height)
    for index in range(1, len(rows) + 1):
        row_line = y_top - header_height - index * row_height
        c.line(x, row_line, x + total_width, row_line)
    return bottom


def draw_methodology_table(c, rows, x, y_top, width):
    check_width = width * 0.17
    result_width = width - check_width
    header_h = 11 * mm
    c.setFillColor(CHARCOAL)
    c.rect(x, y_top - header_h, width, header_h, fill=1, stroke=0)
    c.setFont("SourceSans3-Semibold", 10)
    c.setFillColor(WHITE)
    c.drawString(x + 3 * mm, y_top - 7 * mm, "Check")
    c.drawString(x + check_width + 3 * mm, y_top - 7 * mm, "Result")
    current_top = y_top - header_h
    for index, (check, result, height_mm) in enumerate(rows):
        height = height_mm * mm
        y = current_top - height
        c.setFillColor(WHITE if index % 2 == 0 else PANEL)
        c.rect(x, y, width, height, fill=1, stroke=0)
        c.setFont("SourceSans3-Medium", 10)
        c.setFillColor(CHARCOAL)
        c.drawString(x + 3 * mm, y + height - 6.5 * mm, check)
        draw_wrapped(c, result, x + check_width + 3 * mm, y + height - 4.5 * mm, result_width - 6 * mm, font="SourceSans3", size=10, leading=11.7, colour=CHARCOAL, max_lines=3)
        current_top = y
    bottom = current_top
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.rect(x, bottom, width, y_top - bottom, fill=0, stroke=1)
    c.line(x + check_width, bottom, x + check_width, y_top)
    c.line(x, y_top - header_h, x + width, y_top - header_h)
    current_top = y_top - header_h
    for _, _, height_mm in rows:
        current_top -= height_mm * mm
        c.line(x, current_top, x + width, current_top)


def page_one(c):
    totals = DATA["totals"]
    begin_tag(c, "H1")
    draw_header(c, DATA["title"], DATA["subtitle"], title_size=24)
    end_tag(c)
    begin_tag(c, "P")
    definition = "A lead allocation is called when the receiving salesperson makes an exact outbound call after receiving it and by the end of Friday. All other lead allocations are classified as wasted."
    draw_wrapped(c, definition, MARGIN + 5 * mm, PAGE_H - 35 * mm, CONTENT_W - 10 * mm, size=9.5, leading=11.5, colour=SECONDARY)

    scope_y = PAGE_H - 53 * mm
    c.setFillColor(WHITE)
    c.setStrokeColor(BRAND_RED)
    c.setLineWidth(0.8)
    c.roundRect(MARGIN, scope_y, CONTENT_W, 14 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "Scope exclusions: " + DATA.get("exclusions", {}).get("display", "Not supplied") + ".", MARGIN + 4 * mm, scope_y + 9 * mm, CONTENT_W - 8 * mm, font="SourceSans3-Medium", size=8.5, leading=9.5, colour=SECONDARY, max_lines=2)
    end_tag(c)

    begin_tag(c, "Div")
    draw_kpi_cards(c, [
        ("Lead Allocations Received", fmt(totals["received"]), CHARCOAL),
        ("Lead Allocations Called", fmt(totals["called"]), CALLED_GREEN),
        ("Lead Allocations Wasted", fmt(totals["wasted"]), WASTED_RED),
        ("Lead Utilisation %", pct(totals["utilisation"]), CALLED_GREEN),
        ("Lead Wastage %", pct(totals["wastage"]), WASTED_RED),
    ], PAGE_H - 93 * mm)
    end_tag(c)

    begin_tag(c, "H2")
    draw_section_heading(c, "Lead Allocations Called vs Wasted by Manager", MARGIN, PAGE_H - 102 * mm)
    end_tag(c)
    begin_tag(c, "Figure", "Called and Wasted allocation counts for each included manager team.")
    draw_chart(c, DATA["managers"], MARGIN, 24 * mm, CONTENT_W, 78 * mm)
    end_tag(c)
    draw_footer(c, 1)


def page_two(c):
    begin_tag(c, "H1")
    draw_header(c, "Highest Lead Wastage by Salesperson")
    end_tag(c)
    headers = ["Rank", "Manager", "Salesperson", "Received", "Called", "Wasted", "Utilisation", "Wastage", "Outbound calls", "Calls / allocation"]
    rows = []
    for row in DATA["top15"]:
        rows.append([
            row["wastageRank"], row["manager"], row["salesperson"], fmt(row["received"]), fmt(row["called"]), fmt(row["wasted"]),
            pct(row["called"] / row["received"]), pct(row["wasted"] / row["received"]), fmt(row["outboundCalls"]), f'{row["outboundCalls"] / row["received"]:.2f}',
        ])
    begin_tag(c, "Table")
    draw_table(c, headers, rows, [14, 35, 51, 22, 20, 20, 22, 22, 30, 33], MARGIN, PAGE_H - 38 * mm, 12, 8.4, font_size=9.5, left_columns={1, 2}, centre_columns={0})
    end_tag(c)
    draw_footer(c, 2)


def page_highest_utilisation(c, page_number):
    begin_tag(c, "H1")
    minimum = DATA["ongoingTrends"]["personMinimumAllocations"]
    draw_header(c, "Highest Lead Utilisation by Salesperson", f"Minimum {minimum:,} lead allocations")
    end_tag(c)
    headers = ["Rank", "Manager", "Salesperson", "Received", "Called", "Wasted", "Utilisation", "Wastage", "Outbound calls", "Calls / allocation"]
    rows = []
    for row in DATA["topUtilisation15"]:
        rows.append([
            row["utilisationRank"], row["manager"], row["salesperson"], fmt(row["received"]), fmt(row["called"]), fmt(row["wasted"]),
            pct(row["called"] / row["received"]), pct(row["wasted"] / row["received"]), fmt(row["outboundCalls"]), f'{row["outboundCalls"] / row["received"]:.2f}',
        ])
    begin_tag(c, "Table")
    draw_table(c, headers, rows, [14, 35, 51, 22, 20, 20, 22, 22, 30, 33], MARGIN, PAGE_H - 38 * mm, 12, 8.4, font_size=9.5, left_columns={1, 2}, centre_columns={0})
    end_tag(c)
    draw_footer(c, page_number)


def self_source_rows():
    rows = sorted(
        DATA["salespeople"],
        key=lambda row: (
            -row["otherOutboundCalls"],
            -(row["otherOutboundCalls"] / row["outboundCalls"] if row["outboundCalls"] else 0),
            -row["outboundCalls"],
            row["salesperson"],
        ),
    )
    if sum(row["otherOutboundCalls"] for row in rows) != DATA["totals"]["otherOutboundCalls"]:
        raise ValueError("Salesperson Potential Self-Sourced / Other call counts do not reconcile to the company total")
    if set(SALES_SPLIT_BY_PERSON) != {norm_name(row["salesperson"]) for row in rows}:
        raise ValueError("Sales source split does not cover the same salesperson population as the PDF")
    sales_totals = SALES_SPLIT["totals"]
    if sales_totals["allocatedSales"] + sales_totals["selfSourcedSales"] + sales_totals["attributionWithheldSales"] != SALES_SPLIT["includedSalesRows"]:
        raise ValueError("Sales source split does not reconcile to included approved sales")
    return rows


def page_self_source(c, page_number, start, end):
    all_rows = self_source_rows()
    continued = " (continued)" if start else ""
    begin_tag(c, "H1")
    draw_header(c, f"Potential Self-Sourced / Other Call Activity by Salesperson{continued}")
    end_tag(c)

    begin_tag(c, "P")
    subtitle = f"Ranked by Potential Self-Sourced / Other Outbound Calls. Other Calls % divides by Outbound Calls Made. Sales split = Allocated-Lead Sales / Self-Sourced Sales for approvals dated {REPORT_SUBTITLE}; (n) is classified sales. Both use exact evidence; unmatched call activity is not definitive self-source attribution."
    draw_wrapped(c, subtitle, MARGIN, PAGE_H - 33 * mm, CONTENT_W, size=8.4, leading=9.6, colour=SECONDARY, max_lines=3)
    end_tag(c)

    headers = [
        "Rank",
        "Manager",
        "Salesperson",
        "Lead Allocations Received",
        "Lead Utilisation %",
        "Outbound Calls Made",
        "Outbound Calls to Lead Allocations",
        "Potential Self-Sourced / Other Calls",
        "Potential Self-Sourced / Other Calls %",
        "Allocated / Self-Sourced Sales % (n)",
    ]
    rows = []
    for index, row in enumerate(all_rows[start:end], start=start + 1):
        ratio = row["otherOutboundCalls"] / row["outboundCalls"] if row["outboundCalls"] else 0
        sales = SALES_SPLIT_BY_PERSON[norm_name(row["salesperson"])]
        sales_split = (
            f'{pct(sales["allocatedSalesShare"])} / {pct(sales["selfSourcedSalesShare"])} ({sales["classifiedSales"]})'
            if sales["classifiedSales"]
            else "No classified sales"
        )
        if sales["attributionWithheldSales"]:
            sales_split += f' + {sales["attributionWithheldSales"]} withheld'
        rows.append([
            index,
            row["manager"],
            row["salesperson"],
            fmt(row["received"]),
            pct(row["called"] / row["received"]) if row["received"] else "No allocations",
            fmt(row["outboundCalls"]),
            fmt(row["allocatedLeadCallAttempts"]),
            fmt(row["otherOutboundCalls"]),
            pct(ratio),
            sales_split,
        ])

    begin_tag(c, "Table")
    draw_table(
        c,
        headers,
        rows,
        [9, 27, 40, 20, 19, 20, 27, 27, 25, 42],
        MARGIN,
        PAGE_H - 45 * mm,
        14,
        4.15,
        font_size=7.25,
        left_columns={1, 2},
        centre_columns={0},
        header_max_lines=3,
    )
    end_tag(c)

    draw_footer(c, page_number)


def page_three(c, page_number):
    totals = DATA["totals"]
    begin_tag(c, "H1")
    draw_header(c, "Manager Utilisation")
    end_tag(c)
    headers = ["Manager", "Salespeople", "Received", "Called", "Wasted", "Utilisation", "Wastage", "Outbound calls", "Calls / allocation", "Share of wastage"]
    rows = []
    for row in DATA["managers"]:
        rows.append([
            row["manager"], row["salespeople"], fmt(row["received"]), fmt(row["called"]), fmt(row["wasted"]),
            pct(row["called"] / row["received"]), pct(row["wasted"] / row["received"]), fmt(row["outboundCalls"]),
            f'{row["outboundCalls"] / row["received"]:.2f}', pct(row["wasted"] / totals["wasted"]),
        ])
    begin_tag(c, "Table")
    draw_table(c, headers, rows, [44, 25, 23, 22, 22, 23, 22, 29, 31, 28], MARGIN, PAGE_H - 40 * mm, 14, 11.5, font_size=10, left_columns={0})
    end_tag(c)
    begin_tag(c, "P")
    c.setFont("SourceSans3", 9.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN, 67 * mm, "Manager utilisation is calculated from aggregated team counts; salesperson percentages are not averaged.")
    end_tag(c)
    draw_footer(c, page_number)


def page_four(c, page_number):
    totals = DATA["totals"]
    begin_tag(c, "H1")
    draw_header(c, "Management Reconciliation")
    end_tag(c)
    begin_tag(c, "Div")
    draw_kpi_cards(c, [
        ("Lead Allocations Received", fmt(totals["received"]), CHARCOAL),
        ("Outbound Calls Made", fmt(totals["outboundCalls"]), NEUTRAL),
        ("Outbound Calls per Lead Allocation", f'{totals["callsPerAllocation"]:.2f}', NEUTRAL),
        ("Lead Utilisation %", pct(totals["utilisation"]), CALLED_GREEN),
        ("Lead Allocations Wasted", fmt(totals["wasted"]), WASTED_RED),
    ], PAGE_H - 69 * mm, height=31 * mm, value_size=19)
    end_tag(c)

    begin_tag(c, "H2")
    draw_section_heading(c, "Methodology and QA", MARGIN, PAGE_H - 82 * mm)
    end_tag(c)
    excluded_scope = [*DATA.get("exclusions", {}).get("managerTeams", []), *DATA.get("exclusions", {}).get("salespeople", [])]
    rows = [
        ("Included scope", f"Excluded from every figure: {', '.join(excluded_scope) if excluded_scope else 'none'}.", 10),
        ("Allocation key", "AllocationItemID", 9),
        ("Called basis", "Exact CustomerID to call customer_id, or FoundCustomerID only where customer_id is blank; exact normalised salesperson; outbound only; at or after allocation; by the Friday cutoff.", 11),
        ("Friday cutoff", f"{display_iso_date(REPORT_PERIOD['endDate'])}, 11:59:59 PM Australia/Melbourne; Saturday and later calls excluded.", 10),
        ("Reconciliation", f'PASS - {fmt(totals["received"])} received = {fmt(totals["called"])} called + {fmt(totals["wasted"])} wasted.', 9),
        ("Wasted detail", f'PASS - {fmt(totals["wasted"])} detail rows reconcile to total wasted.', 9),
        ("Voicemail metric", f'PASS - {fmt(totals["firstCallVoicemails"])} First Calls were exact voicemail; {fmt(totals["followUpFailures"])} had no later exact outbound attempt by the same salesperson to the same customer by Friday and are Follow-up Failures. Lead Utilisation after Follow-up Failures is {pct(totals["adjustedUtilisation"])}.', 13),
        ("Outbound call context", f'{fmt(totals["allocatedLeadCallAttempts"])} calls exactly matched reporting-week lead allocations; {fmt(totals["otherOutboundCalls"])} ({pct(totals["otherCallRatio"])}) were Potential Self-Sourced / Other Calls. This is activity context, not definitive source attribution.', 12),
    ]
    begin_tag(c, "Table")
    draw_methodology_table(c, rows, MARGIN, PAGE_H - 94 * mm, CONTENT_W)
    end_tag(c)
    draw_footer(c, page_number)


def page_overall_trends(c, page_number):
    trends = DATA["ongoingTrends"]
    overall = trends["overall"]
    begin_tag(c, "H1")
    draw_header(c, "Ongoing Lead Utilisation — Overall", f'{trends["weekCount"]} verified comparable weeks shown')
    end_tag(c)
    current = overall.get("current") or {}
    outlier_value = overall["outlier"]["label"] if overall["outlier"]["status"] != "not_scored" else f'Needs {trends["outlierPriorWeeksRequired"]} prior weeks'
    begin_tag(c, "Div")
    draw_kpi_cards(c, [
        ("Current Lead Utilisation", pct(current.get("utilisation", 0)), CALLED_GREEN),
        ("Adjusted Utilisation", pct(current.get("adjustedUtilisation", 0)), ADJUSTED_AMBER),
        ("Week-on-week movement", overall["comparison"]["label"], CALLED_GREEN if overall["comparison"]["status"] == "improved" else WASTED_RED if overall["comparison"]["status"] == "regressed" else NEUTRAL),
        ("Outlier prompt", outlier_value, NEUTRAL),
    ], PAGE_H - 67 * mm, height=28 * mm, value_size=13)
    end_tag(c)
    labels = [row["weekLabel"] for row in overall["series"]]
    utilisation = [row.get("metrics", {}).get("utilisation") if row.get("metrics") else None for row in overall["series"]]
    adjusted = [row.get("metrics", {}).get("adjustedUtilisation") if row.get("metrics") else None for row in overall["series"]]
    allocations = [row.get("metrics", {}).get("received") if row.get("metrics") else None for row in overall["series"]]
    called = [row.get("metrics", {}).get("called") if row.get("metrics") else None for row in overall["series"]]
    wasted = [row.get("metrics", {}).get("wasted") if row.get("metrics") else None for row in overall["series"]]
    begin_tag(c, "Figure", "Weekly overall utilisation and adjusted utilisation line chart.")
    draw_section_heading(c, "Utilisation rate trend", MARGIN, PAGE_H - 78 * mm)
    draw_line_plot(c, labels, [("Utilisation", utilisation, CALLED_GREEN), ("Adjusted", adjusted, ADJUSTED_AMBER)], MARGIN, 84 * mm, CONTENT_W, 54 * mm, percent_axis=True)
    end_tag(c)
    begin_tag(c, "Figure", "Weekly overall allocations, called and wasted line chart.")
    draw_section_heading(c, "Allocation volume trend", MARGIN, 75 * mm)
    draw_line_plot(c, labels, [("Allocations", allocations, TREND_BLUE), ("Called", called, CALLED_GREEN), ("Wasted", wasted, WASTED_RED)], MARGIN, 24 * mm, CONTENT_W, 43 * mm, percent_axis=False)
    end_tag(c)
    draw_footer(c, page_number)


def page_team_trends(c, page_number):
    trends = DATA["ongoingTrends"]
    begin_tag(c, "H1")
    draw_header(c, "Ongoing Lead Utilisation — Teams", "Same verified exclusion policy; no performance ranking")
    end_tag(c)
    begin_tag(c, "P")
    draw_wrapped(c, f'Improvement/regression uses a ±{trends["meaningfulChange"] * 100:.1f}% threshold. Outlier prompts are withheld until {trends["outlierPriorWeeksRequired"]} prior comparable weeks exist.', MARGIN, PAGE_H - 34 * mm, CONTENT_W, size=8.8, leading=10.5, colour=SECONDARY, max_lines=2)
    end_tag(c)
    teams = trends["teams"]
    columns = 2
    gap_x = 5 * mm
    gap_y = 4 * mm
    panel_width = (CONTENT_W - gap_x) / columns
    panel_height = 34 * mm
    top_y = PAGE_H - 45 * mm
    for index, team in enumerate(teams):
        column = index % columns
        row = index // columns
        x = MARGIN + column * (panel_width + gap_x)
        y = top_y - (row + 1) * panel_height - row * gap_y
        current = team.get("current") or {}
        c.setFont("SourceSans3-Semibold", 9)
        c.setFillColor(CHARCOAL)
        c.drawString(x + 2 * mm, y + panel_height + 1.2 * mm, f'{team["name"]} — {pct(current.get("utilisation", 0))} | {team["comparison"]["label"]}')
        labels = [entry["weekLabel"] for entry in team["series"]]
        utilisation = [entry.get("metrics", {}).get("utilisation") if entry.get("metrics") else None for entry in team["series"]]
        adjusted = [entry.get("metrics", {}).get("adjustedUtilisation") if entry.get("metrics") else None for entry in team["series"]]
        begin_tag(c, "Figure", f'{team["name"]} weekly utilisation line chart.')
        draw_line_plot(c, labels, [("Utilisation", utilisation, CALLED_GREEN), ("Adjusted", adjusted, ADJUSTED_AMBER)], x, y, panel_width, panel_height, percent_axis=True, show_legend=False, compact=True)
        end_tag(c)
    draw_footer(c, page_number)


def page_person_trends(c, page_number, start, end):
    trends = DATA["ongoingTrends"]
    people = trends["people"][start:end]
    continued = " (continued)" if start else ""
    begin_tag(c, "H1")
    draw_header(c, f"Ongoing Lead Utilisation — Qualifying People{continued}", f'Minimum {trends["personMinimumAllocations"]:,} current-week allocations; outliers require {trends["outlierPriorWeeksRequired"]} prior comparable weeks; no Most Improved ranking')
    end_tag(c)
    columns = 3
    gap_x = 4 * mm
    gap_y = 4.5 * mm
    panel_width = (CONTENT_W - gap_x * (columns - 1)) / columns
    panel_height = 31 * mm
    top_y = PAGE_H - 43 * mm
    for index, person in enumerate(people):
        column = index % columns
        row = index // columns
        x = MARGIN + column * (panel_width + gap_x)
        y = top_y - (row + 1) * panel_height - row * gap_y
        current = person.get("current") or {}
        c.setFont("SourceSans3-Semibold", 8.4)
        c.setFillColor(CHARCOAL)
        title = f'{person["name"]} — {pct(current.get("utilisation", 0))} | {int(current.get("received", 0)):,} Leads'
        c.drawString(x + 1.5 * mm, y + panel_height + 1.2 * mm, title[:58])
        labels = [entry["weekLabel"] for entry in person["series"]]
        utilisation = [entry.get("metrics", {}).get("utilisation") if entry.get("metrics") and entry["metrics"].get("received", 0) >= trends["personMinimumAllocations"] else None for entry in person["series"]]
        begin_tag(c, "Figure", f'{person["name"]} weekly utilisation line chart for sample-qualified weeks.')
        draw_line_plot(c, labels, [("Utilisation", utilisation, CALLED_GREEN)], x, y, panel_width, panel_height, percent_axis=True, show_legend=False, compact=True)
        callout = person["outlier"]["label"] if person["outlier"]["status"] in {"above_usual_range", "below_usual_range"} else person["comparison"]["label"]
        callout_colour = CALLED_GREEN if person["comparison"]["status"] == "improved" else WASTED_RED if person["comparison"]["status"] == "regressed" else NEUTRAL
        c.setFont("SourceSans3-Semibold", 6.8)
        c.setFillColor(callout_colour)
        c.drawRightString(x + panel_width - 2 * mm, y + panel_height - 4 * mm, callout[:31])
        end_tag(c)
    draw_footer(c, page_number)


def build():
    register_fonts()
    if not LOGO_PATH.is_file():
        raise FileNotFoundError(f"Report logo is unavailable: {LOGO_PATH}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PAGE_TAGS.clear()
    c = canvas.Canvas(
        str(OUTPUT_PATH),
        pagesize=landscape(A4),
        pageCompression=1,
        pdfVersion=(1, 7),
        initialFontName="SourceSans3",
        initialFontSize=12,
        lang="en-AU",
    )
    c.setTitle(DATA["title"])
    c.setAuthor("Countrywide Austral")
    c.setSubject(f"Lead utilisation and wastage, {REPORT_SUBTITLE}")
    c._doc.Catalog.Lang = PDFString("en-AU")
    salespeople = self_source_rows()
    page_drawers = [page_one, page_two, lambda canvas_obj: page_highest_utilisation(canvas_obj, 3)]
    page_number = 4
    for start in range(0, len(salespeople), 31):
        end = min(start + 31, len(salespeople))
        page_drawers.append(lambda canvas_obj, number=page_number, first=start, last=end: page_self_source(canvas_obj, number, first, last))
        page_number += 1
    page_drawers.append(lambda canvas_obj, number=page_number: page_three(canvas_obj, number))
    page_number += 1
    page_drawers.append(lambda canvas_obj, number=page_number: page_four(canvas_obj, number))
    page_number += 1
    if DATA.get("ongoingTrends"):
        page_drawers.append(lambda canvas_obj, number=page_number: page_overall_trends(canvas_obj, number))
        page_number += 1
        page_drawers.append(lambda canvas_obj, number=page_number: page_team_trends(canvas_obj, number))
        page_number += 1
        qualifying_people = DATA["ongoingTrends"].get("people", [])
        for start in range(0, len(qualifying_people), 12):
            end = min(start + 12, len(qualifying_people))
            page_drawers.append(lambda canvas_obj, number=page_number, first=start, last=end: page_person_trends(canvas_obj, number, first, last))
            page_number += 1
    for draw_page in page_drawers:
        CURRENT_TAGS.clear()
        draw_page(c)
        PAGE_TAGS.append(list(CURRENT_TAGS))
        c.showPage()
    c.save()
    print(OUTPUT_PATH)


if __name__ == "__main__":
    build()
