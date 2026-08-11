import argparse
import io
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


def parse_args():
    parser = argparse.ArgumentParser(description="Render the combined weekly Lead Management PDF.")
    parser.add_argument("--lead-data", required=True, type=Path)
    parser.add_argument("--voicemail-data", required=True, type=Path)
    parser.add_argument("--lead-pdf", required=True, type=Path)
    parser.add_argument("--voicemail-pdf", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--logo", required=True, type=Path)
    parser.add_argument("--work", type=Path)
    return parser.parse_args()


ARGS = parse_args()
OUTPUT = ARGS.output.resolve()
LEAD_JSON = ARGS.lead_data.resolve()
VM_JSON = ARGS.voicemail_data.resolve()
LEAD_PDF = ARGS.lead_pdf.resolve()
VM_PDF = ARGS.voicemail_pdf.resolve()
LOGO = ARGS.logo.resolve()
WORK = (ARGS.work or OUTPUT.parent / ".combined-pdf-work").resolve()
EXEC_PDF = WORK / "combined-executive-section.pdf"
LEAD_DATA = json.loads(LEAD_JSON.read_text(encoding="utf-8"))
VM_DATA = json.loads(VM_JSON.read_text(encoding="utf-8"))
REPORT_START = LEAD_DATA["reportingPeriod"]["startDate"]
REPORT_END = LEAD_DATA["reportingPeriod"]["endDate"]
if VM_DATA["reportingPeriod"]["start"] != REPORT_START or VM_DATA["reportingPeriod"]["end"] != REPORT_END:
    raise ValueError("Lead Utilisation and Voicemail reporting periods do not match.")


def date_label(iso_date, include_weekday=True):
    from datetime import date
    value = date.fromisoformat(iso_date)
    prefix = f"{value.strftime('%A')} " if include_weekday else ""
    return f"{prefix}{value.day} {value.strftime('%B %Y')}"


def short_period(start_iso, end_iso):
    from datetime import date
    start = date.fromisoformat(start_iso)
    end = date.fromisoformat(end_iso)
    if start.month == end.month:
        return f"{start.day}-{end.day} {end.strftime('%B %Y')}"
    return f"{start.day} {start.strftime('%B')}-{end.day} {end.strftime('%B %Y')}"


REPORT_SUBTITLE = f"{date_label(REPORT_START)} to {date_label(REPORT_END)}"
REPORT_SHORT = short_period(REPORT_START, REPORT_END)

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
BRAND_RED = colors.HexColor("#EE3424")
CHARCOAL = colors.HexColor("#231F20")
GREEN = colors.HexColor("#1F6F5B")
RED = colors.HexColor("#B42318")
AMBER = colors.HexColor("#A45A00")
PANEL = colors.HexColor("#F5F6F7")
BORDER = colors.HexColor("#D6D9DD")
SECONDARY = colors.HexColor("#5B6470")
CREAM = colors.HexColor("#FFF3F1")
GREEN_PANEL = colors.HexColor("#E8F5E9")
RED_PANEL = colors.HexColor("#FCE4E4")
WHITE = colors.white


def safe(value):
    return str(value if value is not None else "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def register_fonts():
    fonts = Path("C:/Windows/Fonts")
    for name, filename in {
        "SourceSans3": "arial.ttf",
        "SourceSans3-Semibold": "arialbd.ttf",
        "SourceSans3-Bold": "arialbd.ttf",
    }.items():
        path = fonts / filename
        if not path.is_file():
            raise FileNotFoundError(path)
        pdfmetrics.registerFont(TTFont(name, str(path)))


def fmt(value):
    return f"{int(value):,}"


def pct(value):
    return f"{float(value) * 100:.1f}%"


def wrap(text, font, size, max_width):
    words = safe(text).split()
    if not words:
        return [""]
    lines, current = [], words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(c, text, x, y_top, width, font="SourceSans3", size=9, leading=11, colour=CHARCOAL, max_lines=None):
    lines = wrap(text, font, size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(colour)
    for index, line in enumerate(lines):
        c.drawString(x, y_top - index * leading, line)
    return lines


def draw_header(c, title, subtitle):
    top = PAGE_H - 15 * mm
    title_x = MARGIN + 5 * mm
    logo_x = PAGE_W - MARGIN - 35 * mm
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, top - 12 * mm, 2.2 * mm, 12 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Bold", 19)
    c.setFillColor(CHARCOAL)
    c.drawString(title_x, top - 6 * mm, safe(title))
    c.setFont("SourceSans3", 10.5)
    c.setFillColor(SECONDARY)
    c.drawString(title_x, top - 12.5 * mm, safe(subtitle))
    c.drawImage(str(LOGO), logo_x, top - 8 * mm, width=35 * mm, height=35 * mm * 56 / 326, preserveAspectRatio=True, mask="auto")


def draw_footer(c, page, total):
    y = 13 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.line(MARGIN, y + 4 * mm, PAGE_W - MARGIN, y + 4 * mm)
    c.setFont("SourceSans3", 8.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN, y, f"Weekly Lead Management Report | {REPORT_SHORT}")
    c.drawRightString(PAGE_W - MARGIN, y, f"Page {page} of {total}")


def section_heading(c, text, y):
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, y - 4 * mm, 1.8 * mm, 5.5 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Semibold", 13)
    c.setFillColor(CHARCOAL)
    c.drawString(MARGIN + 4 * mm, y - 3 * mm, safe(text))


def kpi_cards(c, items, y, height=26 * mm):
    gap = 2 * mm
    width = (CONTENT_W - gap * (len(items) - 1)) / len(items)
    for index, (label, value, colour) in enumerate(items):
        x = MARGIN + index * (width + gap)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.roundRect(x, y, width, height, 1.5 * mm, fill=1, stroke=1)
        label_lines = wrap(label, "SourceSans3-Semibold", 8.5, width - 5 * mm)[:2]
        c.setFont("SourceSans3-Semibold", 8.5)
        c.setFillColor(SECONDARY)
        for line_index, line in enumerate(label_lines):
            c.drawCentredString(x + width / 2, y + height - 7 * mm - line_index * 9, line)
        c.setFont("SourceSans3-Bold", 20)
        c.setFillColor(colour)
        c.drawCentredString(x + width / 2, y + 5.3 * mm, safe(value))


def direction_style(label):
    lower = label.lower()
    if "improved" in lower:
        return GREEN_PANEL, GREEN
    if "regressed" in lower:
        return RED_PANEL, RED
    return CREAM, AMBER


def draw_manager_table(c, rows, y_top):
    headers = ["Manager team", "Lead allocations", "Lead utilisation", "Lead WoW", "VM customers", "VM followed", "VM follow-up", "VM WoW"]
    widths = [42, 32, 30, 34, 30, 30, 30, 36]
    widths = [w * mm for w in widths]
    header_h = 13 * mm
    row_h = 11 * mm
    x = MARGIN
    c.setFillColor(CHARCOAL)
    c.setStrokeColor(BORDER)
    c.rect(x, y_top - header_h, sum(widths), header_h, fill=1, stroke=1)
    cursor = x
    for index, (header, width) in enumerate(zip(headers, widths)):
        if index:
            c.line(cursor, y_top - header_h, cursor, y_top)
        lines = wrap(header, "SourceSans3-Semibold", 8, width - 3 * mm)[:2]
        c.setFont("SourceSans3-Semibold", 8)
        c.setFillColor(WHITE)
        for line_index, line in enumerate(lines):
            c.drawCentredString(cursor + width / 2, y_top - 5 * mm - line_index * 8.5, line)
        cursor += width
    y = y_top - header_h
    for row_index, row in enumerate(rows):
        y -= row_h
        c.setFillColor(PANEL if row_index % 2 else WHITE)
        c.rect(x, y, sum(widths), row_h, fill=1, stroke=1)
        cursor = x
        for col_index, (value, width) in enumerate(zip(row, widths)):
            if col_index in (3, 7):
                fill, colour = direction_style(value)
                c.setFillColor(fill)
                c.rect(cursor, y, width, row_h, fill=1, stroke=0)
                c.setFillColor(colour)
                c.setFont("SourceSans3-Semibold", 7.6)
            else:
                c.setFillColor(CHARCOAL)
                c.setFont("SourceSans3", 8)
            if col_index == 0:
                c.drawString(cursor + 2 * mm, y + 3.9 * mm, safe(value))
            else:
                c.drawCentredString(cursor + width / 2, y + 3.9 * mm, safe(value))
            cursor += width
    return y


def create_executive_pdf(lead, vm, total_pages):
    WORK.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(EXEC_PDF), pagesize=(PAGE_W, PAGE_H))
    c.setTitle(f"Weekly Lead Management Report - {REPORT_SHORT}")
    c.setAuthor("Official Media Group")

    draw_header(c, "WEEKLY LEAD MANAGEMENT REPORT", REPORT_SUBTITLE)
    scope_y = PAGE_H - 55 * mm
    c.setFillColor(CREAM)
    c.setStrokeColor(BRAND_RED)
    c.roundRect(MARGIN, scope_y, CONTENT_W, 22 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "One weekly pack, two separate cohorts. Lead Utilisation measures allocations received during the week. Voicemail Follow-up measures New Business voicemail encounters observed during the week. The rates must not be blended or treated as sharing one denominator.", MARGIN + 4 * mm, scope_y + 17 * mm, CONTENT_W - 8 * mm, size=9.2, leading=11, colour=SECONDARY, max_lines=2)
    exclusion_display = vm.get("exclusionPolicy", {}).get("display", "")
    if not exclusion_display:
        raise ValueError("The configured exclusion display is missing.")
    draw_wrapped(c, f"Scope exclusions: {exclusion_display}.", MARGIN + 4 * mm, scope_y + 7 * mm, CONTENT_W - 8 * mm, font="SourceSans3-Semibold", size=8.8, leading=10, colour=AMBER, max_lines=2)

    section_heading(c, "Lead Utilisation - allocation cohort", PAGE_H - 86 * mm)
    totals = lead["totals"]
    kpi_cards(c, [
        ("Allocations received", fmt(totals["received"]), CHARCOAL),
        ("Allocations called", fmt(totals["called"]), GREEN),
        ("Allocations wasted", fmt(totals["wasted"]), RED),
        ("Lead utilisation", pct(totals["utilisation"]), GREEN),
        ("Adjusted after follow-up failures", pct(totals["adjustedUtilisation"]), AMBER),
    ], PAGE_H - 119 * mm)

    section_heading(c, "Voicemail Follow-up - voicemail encounter cohort", PAGE_H - 134 * mm)
    vm_totals = vm["totals"]
    kpi_cards(c, [
        ("Voicemails checked", fmt(vm_totals["checked"]), CHARCOAL),
        ("Followed by Friday", fmt(vm_totals["followed"]), GREEN),
        ("No qualifying follow-up", fmt(vm_totals["notByFriday"]), RED),
        ("Follow-up rate", pct(vm_totals["followed"] / vm_totals["checked"]), GREEN),
        ("No later call found", fmt(vm_totals["noLater"]), RED),
    ], PAGE_H - 167 * mm)

    c.setFillColor(PANEL)
    c.setStrokeColor(BORDER)
    c.roundRect(MARGIN, 23 * mm, CONTENT_W, 16 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "Use the manager view on page 2 to see where both measures moved. Detailed lead trends, qualifying-person lines and outlier prompts are retained in the Lead Utilisation section; team and individual voicemail movement is retained in the Voicemail section.", MARGIN + 4 * mm, 33 * mm, CONTENT_W - 8 * mm, size=8.7, leading=10, colour=SECONDARY, max_lines=2)
    draw_footer(c, 1, total_pages)
    c.showPage()

    draw_header(c, "CROSS-REPORT MANAGER VIEW", "Separate measures shown side by side; no blended score")
    lead_teams = {item["name"]: item for item in lead["ongoingTrends"]["teams"]}
    vm_teams = {item["manager"]: item for item in vm["teamComparisons"]}
    rows = []
    for manager in [item["manager"] for item in lead["managers"]]:
        lead_item = lead_teams[manager]
        vm_item = vm_teams[manager]
        rows.append([
            manager,
            fmt(lead_item["current"]["received"]),
            pct(lead_item["current"]["utilisation"]),
            lead_item["comparison"]["label"],
            fmt(vm_item["currentTotal"]),
            fmt(round(vm_item["currentTotal"] * vm_item["currentRate"])),
            pct(vm_item["currentRate"]),
            f"{vm_item['direction']} {abs(vm_item['change']) * 100:.1f} pp" if vm_item["direction"] != "Broadly stable" else f"Broadly stable {abs(vm_item['change']) * 100:.1f} pp",
        ])
    table_bottom = draw_manager_table(c, rows, PAGE_H - 49 * mm)

    box_y = table_bottom - 29 * mm
    gap = 3 * mm
    box_w = (CONTENT_W - gap) / 2
    lead_current = [(item["name"], item["current"]["utilisation"]) for item in lead["ongoingTrends"]["teams"]]
    vm_current = [(item["manager"], item["currentRate"]) for item in vm["teamComparisons"]]
    lead_high, lead_low = max(lead_current, key=lambda item: item[1]), min(lead_current, key=lambda item: item[1])
    vm_high, vm_low = max(vm_current, key=lambda item: item[1]), min(vm_current, key=lambda item: item[1])
    insights = [
        ("Lead allocation signal", f"{lead_high[0]} led current team utilisation at {pct(lead_high[1])}; {lead_low[0]} was lowest at {pct(lead_low[1])}. Lead movement uses each team's allocation denominator and the +/-5 percentage-point threshold.", GREEN),
        ("Voicemail signal", f"{vm_high[0]} led current voicemail follow-up at {pct(vm_high[1])}; {vm_low[0]} was lowest at {pct(vm_low[1])}. Friday voicemails require same-day follow-up under this reporting contract.", AMBER),
    ]
    for index, (title, body, colour) in enumerate(insights):
        x = MARGIN + index * (box_w + gap)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.roundRect(x, box_y, box_w, 24 * mm, 1.5 * mm, fill=1, stroke=1)
        c.setFont("SourceSans3-Semibold", 10)
        c.setFillColor(colour)
        c.drawString(x + 4 * mm, box_y + 17 * mm, title)
        draw_wrapped(c, body, x + 4 * mm, box_y + 11.5 * mm, box_w - 8 * mm, size=8.3, leading=9.2, colour=SECONDARY, max_lines=3)

    c.setFillColor(CREAM)
    c.setStrokeColor(BRAND_RED)
    c.roundRect(MARGIN, 23 * mm, CONTENT_W, 15 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "Interpretation guardrail: the lead and voicemail columns answer different questions. Compare direction and operational patterns, but never average the rates or create a combined performance score.", MARGIN + 4 * mm, 32 * mm, CONTENT_W - 8 * mm, font="SourceSans3-Semibold", size=8.7, leading=10, colour=AMBER, max_lines=2)
    draw_footer(c, 2, total_pages)
    c.save()


def page_number_overlay(width, height, page_number, total_pages):
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(float(width), float(height)))
    # Remove the source section's old standalone page number only.
    c.setFillColor(WHITE)
    c.rect(float(width) - 58 * mm, 8 * mm, 47 * mm, 9 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3", 8.5)
    c.setFillColor(SECONDARY)
    c.drawRightString(float(width) - MARGIN, 13 * mm, f"Page {page_number} of {total_pages}")
    c.save()
    stream.seek(0)
    return PdfReader(stream).pages[0]


def assemble():
    source_readers = [PdfReader(str(EXEC_PDF)), PdfReader(str(LEAD_PDF)), PdfReader(str(VM_PDF))]
    total_pages = sum(len(reader.pages) for reader in source_readers)
    writer = PdfWriter()
    for reader_index, reader in enumerate(source_readers):
        for page in reader.pages:
            page_number = len(writer.pages) + 1
            if reader_index:
                page.merge_page(page_number_overlay(page.mediabox.width, page.mediabox.height, page_number, total_pages))
            writer.add_page(page)
    writer.add_outline_item("Executive overview", 0)
    writer.add_outline_item("Manager cross-report view", 1)
    writer.add_outline_item("Lead Utilisation", 2)
    writer.add_outline_item("Voicemail Follow-up", 2 + len(source_readers[1].pages))
    writer.add_metadata({
        "/Title": f"Weekly Lead Management Report - {REPORT_SHORT}",
        "/Author": "Official Media Group",
        "/Subject": "Combined Lead Utilisation and Voicemail Follow-up weekly report",
    })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("wb") as handle:
        writer.write(handle)
    return total_pages


def main():
    register_fonts()
    lead = LEAD_DATA
    vm = VM_DATA
    total_pages = 2 + len(PdfReader(str(LEAD_PDF)).pages) + len(PdfReader(str(VM_PDF)).pages)
    create_executive_pdf(lead, vm, total_pages)
    assembled_pages = assemble()
    check = PdfReader(str(OUTPUT))
    if len(check.pages) != assembled_pages:
        raise RuntimeError(f"Page count mismatch: expected {assembled_pages}, got {len(check.pages)}")
    print(json.dumps({"output": str(OUTPUT), "pages": len(check.pages), "bookmarks": 4}, indent=2))


if __name__ == "__main__":
    main()
