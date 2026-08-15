import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


def parse_args():
    parser = argparse.ArgumentParser(description="Render the weekly voicemail follow-up PDF.")
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--logo", required=True, type=Path)
    return parser.parse_args()


ARGS = parse_args()
DATA = json.loads(ARGS.data.resolve().read_text(encoding="utf-8"))
OUTPUT = ARGS.output.resolve()
LOGO = ARGS.logo.resolve()

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
BRAND_RED = colors.HexColor("#EE3424")
CHARCOAL = colors.HexColor("#231F20")
CALLED_GREEN = colors.HexColor("#1F6F5B")
WASTED_RED = colors.HexColor("#B42318")
AMBER = colors.HexColor("#A45A00")
PANEL = colors.HexColor("#F5F6F7")
BORDER = colors.HexColor("#D6D9DD")
SECONDARY = colors.HexColor("#5B6470")
CREAM = colors.HexColor("#FFF3F1")
GREEN_PANEL = colors.HexColor("#E8F5E9")
RED_PANEL = colors.HexColor("#FCE4E4")
WHITE = colors.white


def safe(value):
    return str(value if value is not None else "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-").replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')


def register_fonts():
    windows = Path("C:/Windows/Fonts")
    candidates = {
        "SourceSans3": windows / "arial.ttf",
        "SourceSans3-Medium": windows / "arial.ttf",
        "SourceSans3-Semibold": windows / "arialbd.ttf",
        "SourceSans3-Bold": windows / "arialbd.ttf",
    }
    for name, path in candidates.items():
        if not path.is_file():
            raise FileNotFoundError(f"Required PDF font unavailable: {path}")
        pdfmetrics.registerFont(TTFont(name, str(path)))


def fmt(value):
    return f"{int(value):,}"


def pct(value):
    return "" if value is None else f"{float(value) * 100:.1f}%"


def text_width(text, font, size):
    return pdfmetrics.stringWidth(safe(text), font, size)


def wrap_text(text, font, size, max_width):
    words = safe(text).split()
    if not words:
        return [""]
    lines, current = [], words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if text_width(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(c, text, x, y_top, max_width, font="SourceSans3", size=9, leading=10.5, colour=CHARCOAL, max_lines=None):
    lines = wrap_text(text, font, size, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(colour)
    for index, line in enumerate(lines):
        c.drawString(x, y_top - index * leading, line)
    return len(lines)


def draw_header(c, title, subtitle=None, title_size=20):
    top = PAGE_H - 15 * mm
    title_x = MARGIN + 5 * mm
    logo_x = PAGE_W - MARGIN - 35 * mm
    max_width = logo_x - title_x - 5 * mm
    fitted = title_size
    while fitted > 14 and text_width(title, "SourceSans3-Bold", fitted) > max_width:
        fitted -= 0.5
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, top - 12 * mm, 2.2 * mm, 12 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Bold", fitted)
    c.setFillColor(CHARCOAL)
    c.drawString(title_x, top - 6 * mm, safe(title))
    if subtitle:
        c.setFont("SourceSans3", 10.5)
        c.setFillColor(SECONDARY)
        c.drawString(title_x, top - 12.5 * mm, safe(subtitle))
    c.drawImage(str(LOGO), logo_x, top - 8 * mm, width=35 * mm, height=35 * mm * 56 / 326, preserveAspectRatio=True, mask="auto")


def draw_footer(c, page_number):
    y = 13 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.line(MARGIN, y + 4 * mm, PAGE_W - MARGIN, y + 4 * mm)
    c.setFont("SourceSans3", 8.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN, y, f"Voicemail Follow-up Report | {safe(DATA['subtitle'])}")
    c.drawRightString(PAGE_W - MARGIN, y, f"Page {page_number}")


def draw_section_heading(c, text, x, y, size=13.5):
    c.setFillColor(BRAND_RED)
    c.rect(x, y - 4 * mm, 1.8 * mm, 5.5 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Semibold", size)
    c.setFillColor(CHARCOAL)
    c.drawString(x + 4 * mm, y - 3 * mm, safe(text))


def draw_kpi_cards(c, items, y, height=31 * mm, value_size=23):
    gap = 2 * mm
    width = (CONTENT_W - gap * (len(items) - 1)) / len(items)
    for index, (label, value, colour) in enumerate(items):
        x = MARGIN + index * (width + gap)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.6)
        c.roundRect(x, y, width, height, 1.6 * mm, fill=1, stroke=1)
        lines = wrap_text(label, "SourceSans3-Semibold", 9.3, width - 7 * mm)[:2]
        c.setFont("SourceSans3-Semibold", 9.3)
        c.setFillColor(SECONDARY)
        for line_index, line in enumerate(lines):
            c.drawCentredString(x + width / 2, y + height - 8 * mm - line_index * 10, line)
        c.setFont("SourceSans3-Bold", value_size)
        c.setFillColor(colour)
        c.drawCentredString(x + width / 2, y + 6.2 * mm, safe(value))


def hatch_rect(c, x, y, width, height):
    if width <= 0:
        return
    c.saveState()
    path = c.beginPath()
    path.rect(x, y, width, height)
    c.clipPath(path, stroke=0, fill=0)
    c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.75))
    c.setLineWidth(0.5)
    step = 4 * mm
    offset = -height
    while offset < width:
        c.line(x + offset, y, x + offset + height, y + height)
        offset += step
    c.restoreState()


def draw_result_bars(c, people, y_top):
    draw_section_heading(c, "Follow-up Result by Highest-Volume Salespeople", MARGIN, y_top)
    chart_x = MARGIN + 43 * mm
    chart_w = CONTENT_W - 88 * mm
    label_x = MARGIN
    right_x = chart_x + chart_w + 3 * mm
    max_total = max((row["total"] for row in people), default=1)
    bar_h = 8 * mm
    gap = 3 * mm
    y = y_top - 21 * mm
    c.setFont("SourceSans3", 8.7)
    for row in people:
        total = row["total"]
        followed = row["followed"]
        missed = total - followed
        width = chart_w * total / max_total
        green_w = width * followed / total if total else 0
        red_w = width - green_w
        c.setFillColor(CHARCOAL)
        c.drawString(label_x, y + 2.4 * mm, safe(row["salesperson"]))
        c.setFillColor(CALLED_GREEN)
        c.rect(chart_x, y, green_w, bar_h, fill=1, stroke=0)
        c.setFillColor(WASTED_RED)
        c.rect(chart_x + green_w, y, red_w, bar_h, fill=1, stroke=0)
        hatch_rect(c, chart_x + green_w, y, red_w, bar_h)
        if green_w > 15 * mm:
            c.setFillColor(WHITE)
            c.setFont("SourceSans3-Semibold", 8)
            c.drawCentredString(chart_x + green_w / 2, y + 2.4 * mm, fmt(followed))
        if red_w > 15 * mm:
            c.setFillColor(WHITE)
            c.setFont("SourceSans3-Semibold", 8)
            c.drawCentredString(chart_x + green_w + red_w / 2, y + 2.4 * mm, fmt(missed))
        c.setFont("SourceSans3", 8.2)
        c.setFillColor(SECONDARY)
        c.drawString(right_x, y + 2.4 * mm, f"{fmt(total)} total  |  {pct(row['rate'])} followed")
        y -= bar_h + gap


def draw_table(c, headers, rows, widths_mm, x, y_top, row_height_mm=8.2, font_size=8.1, left_columns=None, cell_colours=None):
    left_columns = set(left_columns or [])
    widths = [value * mm for value in widths_mm]
    header_h = 12 * mm
    total_width = sum(widths)
    c.setFillColor(CHARCOAL)
    c.setStrokeColor(BORDER)
    c.rect(x, y_top - header_h, total_width, header_h, fill=1, stroke=1)
    cursor = x
    for index, (header, width) in enumerate(zip(headers, widths)):
        if index:
            c.line(cursor, y_top - header_h, cursor, y_top)
        lines = wrap_text(header, "SourceSans3-Semibold", font_size - 0.1, width - 3 * mm)[:3]
        c.setFont("SourceSans3-Semibold", font_size - 0.1)
        c.setFillColor(WHITE)
        start_y = y_top - 4.2 * mm
        for line_index, line in enumerate(lines):
            c.drawCentredString(cursor + width / 2, start_y - line_index * (font_size + 0.6), line)
        cursor += width
    row_h = row_height_mm * mm
    y = y_top - header_h
    for row_index, row in enumerate(rows):
        y -= row_h
        c.setFillColor(PANEL if row_index % 2 else WHITE)
        c.setStrokeColor(BORDER)
        c.rect(x, y, total_width, row_h, fill=1, stroke=1)
        cursor = x
        for column_index, (value, width) in enumerate(zip(row, widths)):
            if column_index:
                c.line(cursor, y, cursor, y + row_h)
            if cell_colours and column_index in cell_colours:
                fill, colour = cell_colours[column_index](value)
                c.setFillColor(fill)
                c.rect(cursor, y, width, row_h, fill=1, stroke=0)
            else:
                colour = CHARCOAL
            c.setFillColor(colour)
            c.setFont("SourceSans3-Medium" if column_index in left_columns else "SourceSans3", font_size)
            display = safe(value)
            if text_width(display, "SourceSans3", font_size) > width - 3 * mm:
                display = display[: max(3, int((width - 3 * mm) / max(1, font_size * 0.52)) - 1)] + "..."
            if column_index in left_columns:
                c.drawString(cursor + 1.5 * mm, y + row_h / 2 - font_size * 0.34, display)
            else:
                c.drawRightString(cursor + width - 1.5 * mm, y + row_h / 2 - font_size * 0.34, display)
            cursor += width
    return y


def result_colour(value):
    value = safe(value)
    if value == "Following well":
        return GREEN_PANEL, CALLED_GREEN
    if value == "Needs attention":
        return RED_PANEL, WASTED_RED
    if value == "Mixed":
        return CREAM, AMBER
    return PANEL, SECONDARY


def direction_colour(value):
    value = safe(value)
    if value == "Improved":
        return GREEN_PANEL, CALLED_GREEN
    if value == "Regressed":
        return RED_PANEL, WASTED_RED
    if value == "Broadly stable":
        return CREAM, AMBER
    return PANEL, SECONDARY


def page_summary(c, page_number):
    totals = DATA["totals"]
    checked = totals["checked"]
    rate = totals["followed"] / checked if checked else 0
    no_later_rate = totals["noLater"] / checked if checked else 0
    draw_header(c, DATA["title"], DATA["subtitle"])
    draw_wrapped(c, "A qualifying follow-up is a later outbound call by the same salesperson to the same customer by Friday 11:59:59 pm. Friday voicemails require same-day follow-up; inbound and other-employee calls are context only.", MARGIN + 5 * mm, PAGE_H - 36 * mm, CONTENT_W - 10 * mm, size=8.8, leading=10.2, colour=SECONDARY, max_lines=2)
    scope_y = PAGE_H - 57 * mm
    c.setStrokeColor(BRAND_RED)
    c.setFillColor(WHITE)
    c.roundRect(MARGIN, scope_y, CONTENT_W, 15 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "Scope exclusions (same as Lead Utilisation): " + DATA["exclusionPolicy"]["display"] + ".", MARGIN + 4 * mm, scope_y + 10 * mm, CONTENT_W - 8 * mm, font="SourceSans3-Medium", size=8.3, leading=9.3, colour=SECONDARY, max_lines=2)
    draw_kpi_cards(c, [
        ("Voicemails Checked", fmt(checked), CHARCOAL),
        ("Followed by Friday", fmt(totals["followed"]), CALLED_GREEN),
        ("No Qualifying Follow-up", fmt(totals["notByFriday"]), WASTED_RED),
        ("Follow-up Rate", pct(rate), CALLED_GREEN),
        ("No-later-call Rate", pct(no_later_rate), WASTED_RED),
    ], PAGE_H - 101 * mm)
    top_people = sorted(DATA["people"], key=lambda row: (-row["total"], row["salesperson"]))[:6]
    draw_result_bars(c, top_people, PAGE_H - 112 * mm)
    draw_footer(c, page_number)


def page_people(c, page_number, start, end):
    title = "Salesperson Voicemail Follow-up" + (" (continued)" if start else "")
    draw_header(c, title, f"{DATA['subtitle']} | Rows {start + 1}-{min(end, len(DATA['people']))} of {len(DATA['people'])}")
    rows = []
    for rank, row in enumerate(DATA["people"][start:end], start=start + 1):
        rows.append([rank, row["manager"], row["salesperson"], fmt(row["total"]), fmt(row["followed"]), fmt(row["notByFriday"]), fmt(row["noLater"]), pct(row["rate"]), pct(row["noLaterRate"]), row["status"]])
    draw_table(c, ["Rank", "Manager team", "Salesperson", "Voicemails", "Followed", "No follow-up", "No later call", "Follow-up %", "No-later-call %", "Result"], rows, [9, 36, 42, 20, 20, 23, 23, 24, 27, 36], MARGIN, PAGE_H - 38 * mm, row_height_mm=6.8, font_size=7.3, left_columns={1, 2, 9}, cell_colours={9: result_colour})
    draw_footer(c, page_number)


def page_teams(c, page_number):
    draw_header(c, "Manager Team Voicemail Follow-up", DATA["subtitle"] + " | Aggregated counts, not averages of salesperson rates", title_size=18)
    draw_wrapped(c, "Every included voicemail customer contributes once to a manager-team total. Blank manager values remain visible as Unassigned / Missing Manager.", MARGIN, PAGE_H - 36 * mm, CONTENT_W, size=8.4, leading=9.4, colour=SECONDARY, max_lines=2)
    current_rows = []
    for row in DATA["teams"]:
        current_rows.append([row["manager"], fmt(row["salespeople"]), fmt(row["total"]), fmt(row["followed"]), fmt(row["notByFriday"]), fmt(row["noLater"]), pct(row["rate"]), pct(row["noLaterRate"]), row["status"]])
    draw_table(c, ["Manager team", "People", "Voicemails", "Followed", "No follow-up", "No later call", "Follow-up %", "No-later-call %", "Result"], current_rows, [39, 17, 22, 22, 24, 24, 25, 28, 37], MARGIN, PAGE_H - 50 * mm, row_height_mm=6.4, font_size=7.1, left_columns={0, 8}, cell_colours={8: result_colour})
    comparison_top = PAGE_H - 116 * mm
    draw_section_heading(c, "Manager Team Week-on-Week", MARGIN, comparison_top)
    comparison_rows = []
    for row in DATA["teamComparisons"]:
        comparison_rows.append([row["manager"], fmt(row["currentTotal"]), pct(row["currentRate"]), "" if row["previousTotal"] is None else fmt(row["previousTotal"]), pct(row["previousRate"]), pct(row["change"]), row["direction"]])
    draw_table(c, ["Manager team", "Current leads", "Current rate", "Previous leads", "Previous rate", "Change", "Direction"], comparison_rows, [44, 29, 30, 31, 30, 26, 48], MARGIN, comparison_top - 10 * mm, row_height_mm=5.8, font_size=7.1, left_columns={0, 6}, cell_colours={6: direction_colour})
    draw_footer(c, page_number)


def page_comparisons(c, page_number, start, end):
    title = "Week-on-Week Voicemail Follow-up" + (" (continued)" if start else "")
    draw_header(c, title, f"Same Friday-cutoff contract | Rows {start + 1}-{min(end, len(DATA['comparisons']))} of {len(DATA['comparisons'])}")
    draw_wrapped(c, "Meaningful movement requires at least 20 voicemail customers in both weeks and a change of at least 5 percentage points. Day-of-week mix can still affect the result because Friday voicemails have less time available.", MARGIN, PAGE_H - 36 * mm, CONTENT_W, size=8.3, leading=9.4, colour=SECONDARY, max_lines=2)
    rows = []
    for row in DATA["comparisons"][start:end]:
        rows.append([row["manager"], row["salesperson"], fmt(row["currentTotal"]), pct(row["currentRate"]), "" if row["previousTotal"] is None else fmt(row["previousTotal"]), pct(row["previousRate"]), pct(row["change"]), row["direction"]])
    draw_table(c, ["Manager team", "Salesperson", "Current leads", "Current rate", "Previous leads", "Previous rate", "Change", "Direction"], rows, [36, 45, 26, 29, 28, 29, 24, 45], MARGIN, PAGE_H - 52 * mm, row_height_mm=6.7, font_size=7.3, left_columns={0, 1, 7}, cell_colours={7: direction_colour})
    draw_footer(c, page_number)


def page_methodology(c, page_number):
    draw_header(c, "Methodology & QA", "Definitions, evidence rules and validation checks for the Friday-cutoff report.")
    draw_section_heading(c, "How the report is calculated", MARGIN, PAGE_H - 38 * mm)
    rules = [
        ["Reporting cohort", "Monday-Friday voicemail customers whose first literal no-contact result was voicemail or an answering machine."],
        ["Customer match", "Exact customer ID only; names and phone numbers are not guessed."],
        ["Qualifying follow-up", "A later outbound call by the same salesperson to the same customer by Friday 11:59:59 pm."],
        ["Other calls", "Inbound calls and calls by another employee are retained as context but do not count."],
        ["No later call", "No later call of any kind was found by Friday in the available call data."],
        ["Comparison gate", "At least 20 voicemail customers in both weeks; improvement/regression begins at 5 percentage points."],
        ["Team calculation", "Manager-team rates are calculated from aggregated counts, never by averaging salesperson percentages."],
        ["Manager attribution", "Exact Allocation Item ID first, then the modal salesperson-to-manager relationship in the same weekly allocation exports; unresolved rows remain visible."],
        ["Scope exclusions", "The manager-team and individual exclusions are identical to the Lead Utilisation report."],
        ["Known limitation", "Monday voicemails have the longest window; Friday voicemails require same-day follow-up."],
    ]
    draw_table(c, ["Topic", "Rule / Value"], rules, [42, 205], MARGIN, PAGE_H - 46 * mm, row_height_mm=6.0, font_size=7.2, left_columns={0, 1})
    qa_top = PAGE_H - 124 * mm
    draw_section_heading(c, "QA validation", MARGIN, qa_top)
    checks = DATA["qaChecks"]["current"]
    split = (len(checks) + 1) // 2
    left_rows = [[check, "PASS"] for check in checks[:split]]
    right_rows = [[check, "PASS"] for check in checks[split:]]
    draw_table(c, ["Check", "Result"], left_rows, [101, 20], MARGIN, qa_top - 10 * mm, row_height_mm=4.2, font_size=6.2, left_columns={0}, cell_colours={1: lambda value: (GREEN_PANEL, CALLED_GREEN)})
    draw_table(c, ["Check", "Result"], right_rows, [101, 20], MARGIN + 126 * mm, qa_top - 10 * mm, row_height_mm=4.2, font_size=6.2, left_columns={0}, cell_colours={1: lambda value: (GREEN_PANEL, CALLED_GREEN)})
    draw_footer(c, page_number)


def build_pdf():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A4), pageCompression=1, pdfVersion=(1, 7))
    c.setTitle("Voicemail Follow-up Report")
    c.setAuthor("Official Media Group")
    page = 1
    page_summary(c, page)
    c.showPage()
    page += 1
    page_teams(c, page)
    c.showPage()
    page += 1
    for start in range(0, len(DATA["people"]), 20):
        page_people(c, page, start, min(start + 20, len(DATA["people"])))
        c.showPage()
        page += 1
    for start in range(0, len(DATA["comparisons"]), 18):
        page_comparisons(c, page, start, min(start + 18, len(DATA["comparisons"])))
        c.showPage()
        page += 1
    page_methodology(c, page)
    c.save()


if __name__ == "__main__":
    build_pdf()
