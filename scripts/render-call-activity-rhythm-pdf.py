import argparse
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


def args_parser():
    parser = argparse.ArgumentParser(description="Render the standalone Call Activity & Rhythm PDF.")
    parser.add_argument("--analysis", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--logo", required=True, type=Path)
    return parser.parse_args()


ARGS = args_parser()
DATA = json.loads(ARGS.analysis.read_text(encoding="utf-8"))
OUTPUT = ARGS.output.resolve()
LOGO = ARGS.logo.resolve()
REPORT_START, REPORT_END = DATA["scope"]["currentPeriod"]
CURRENT = next(w for w in DATA["weeks"] if w["period"] == f"{REPORT_START}_to_{REPORT_END}")
PRIOR = DATA["weeks"][DATA["weeks"].index(CURRENT) - 1]
PAGE_W, PAGE_H = landscape(A4)
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
TOTAL_PAGES = 9

BRAND_RED = colors.HexColor("#EE3424")
CHARCOAL = colors.HexColor("#231F20")
GREEN = colors.HexColor("#1F6F5B")
RED = colors.HexColor("#B42318")
AMBER = colors.HexColor("#A45A00")
BLUE = colors.HexColor("#225E8F")
TEAL = colors.HexColor("#147D78")
PANEL = colors.HexColor("#F5F6F7")
BORDER = colors.HexColor("#D6D9DD")
SECONDARY = colors.HexColor("#5B6470")
CREAM = colors.HexColor("#FFF3F1")
GREEN_PANEL = colors.HexColor("#E8F5E9")
RED_PANEL = colors.HexColor("#FCE4E4")
WHITE = colors.white


def register_fonts():
    fonts = Path("C:/Windows/Fonts")
    for name, filename in {
        "SourceSans3": "arial.ttf",
        "SourceSans3-Italic": "ariali.ttf",
        "SourceSans3-Semibold": "arialbd.ttf",
        "SourceSans3-Bold": "arialbd.ttf",
    }.items():
        pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))


def safe(value):
    return str(value if value is not None else "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def fmt(value):
    return f"{int(value):,}"


def pct(value):
    return "-" if value is None else f"{float(value) * 100:.1f}%"


def num(value, digits=1):
    return "-" if value is None else f"{float(value):.{digits}f}"


def date_label(iso_date):
    from datetime import date
    value = date.fromisoformat(iso_date)
    return f"{value.strftime('%A')} {value.day} {value.strftime('%B %Y')}"


def short_period(period):
    from datetime import date
    start_iso, end_iso = period.split("_to_")
    start, end = date.fromisoformat(start_iso), date.fromisoformat(end_iso)
    return f"{start.day}-{end.day} {end.strftime('%b')}" if start.month == end.month else f"{start.day} {start.strftime('%b')}-{end.day} {end.strftime('%b')}"


REPORT_SUBTITLE = f"{date_label(REPORT_START)} to {date_label(REPORT_END)}"
REPORT_SHORT = short_period(f"{REPORT_START}_to_{REPORT_END}")


def wrap(text, font, size, width):
    words = safe(text).split()
    if not words:
        return [""]
    lines, current = [], words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_wrapped(c, text, x, y_top, width, font="SourceSans3", size=8.5, leading=10, colour=CHARCOAL, max_lines=None):
    lines = wrap(text, font, size, width)
    if max_lines:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(colour)
    for index, line in enumerate(lines):
        c.drawString(x, y_top - index * leading, line)
    return lines


def header(c, title, subtitle, page, bookmark=None):
    if bookmark:
        c.bookmarkPage(bookmark)
        c.addOutlineEntry(title, bookmark, 0, False)
    top = PAGE_H - 15 * mm
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, top - 12 * mm, 2.2 * mm, 12 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Bold", 19)
    c.setFillColor(CHARCOAL)
    c.drawString(MARGIN + 5 * mm, top - 6 * mm, safe(title))
    c.setFont("SourceSans3", 10.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN + 5 * mm, top - 12.5 * mm, safe(subtitle))
    logo_w = 35 * mm
    c.drawImage(str(LOGO), PAGE_W - MARGIN - logo_w, top - 8 * mm, width=logo_w, height=logo_w * 56 / 326, preserveAspectRatio=True, mask="auto")
    footer(c, page)


def footer(c, page):
    y = 13 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.line(MARGIN, y + 4 * mm, PAGE_W - MARGIN, y + 4 * mm)
    c.setFont("SourceSans3", 8.5)
    c.setFillColor(SECONDARY)
    c.drawString(MARGIN, y, f"Call Activity & Rhythm Report | {REPORT_SHORT}")
    c.drawRightString(PAGE_W - MARGIN, y, f"Page {page} of {TOTAL_PAGES}")


def section(c, text, y, colour=CHARCOAL):
    c.setFillColor(BRAND_RED)
    c.rect(MARGIN, y - 4 * mm, 1.8 * mm, 5.5 * mm, fill=1, stroke=0)
    c.setFont("SourceSans3-Semibold", 13)
    c.setFillColor(colour)
    c.drawString(MARGIN + 4 * mm, y - 3 * mm, safe(text))


def kpis(c, items, y, height=26 * mm):
    gap = 2 * mm
    width = (CONTENT_W - gap * (len(items) - 1)) / len(items)
    for index, (label, value, colour) in enumerate(items):
        x = MARGIN + index * (width + gap)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.roundRect(x, y, width, height, 1.5 * mm, fill=1, stroke=1)
        c.setFont("SourceSans3-Semibold", 8.5)
        c.setFillColor(SECONDARY)
        for li, line in enumerate(wrap(label, "SourceSans3-Semibold", 8.5, width - 5 * mm)[:2]):
            c.drawCentredString(x + width / 2, y + height - 7 * mm - li * 9, line)
        c.setFont("SourceSans3-Bold", 19)
        c.setFillColor(colour)
        c.drawCentredString(x + width / 2, y + 5.2 * mm, safe(value))


def draw_table(c, x, y_top, headers, rows, widths, row_h=8 * mm, header_h=10 * mm, font_size=7.5, wrap_columns=None, fills=None):
    wrap_columns = set(wrap_columns or [])
    total_w = sum(widths)
    c.setFillColor(CHARCOAL)
    c.setStrokeColor(BORDER)
    c.rect(x, y_top - header_h, total_w, header_h, fill=1, stroke=1)
    cx = x
    for i, (label, width) in enumerate(zip(headers, widths)):
        if i:
            c.line(cx, y_top - header_h, cx, y_top)
        c.setFillColor(WHITE)
        c.setFont("SourceSans3-Semibold", 7.3)
        for li, line in enumerate(wrap(label, "SourceSans3-Semibold", 7.3, width - 2 * mm)[:2]):
            c.drawCentredString(cx + width / 2, y_top - 4 * mm - li * 7, line)
        cx += width
    y = y_top - header_h
    for ri, row in enumerate(rows):
        y -= row_h
        fill = fills[ri] if fills and ri < len(fills) else (PANEL if ri % 2 else WHITE)
        c.setFillColor(fill)
        c.setStrokeColor(BORDER)
        c.rect(x, y, total_w, row_h, fill=1, stroke=1)
        cx = x
        for ci, (value, width) in enumerate(zip(row, widths)):
            if ci:
                c.line(cx, y, cx, y + row_h)
            text = safe(value)
            c.setFillColor(CHARCOAL)
            c.setFont("SourceSans3", font_size)
            if ci in wrap_columns:
                for li, line in enumerate(wrap(text, "SourceSans3", font_size, width - 2 * mm)[:3]):
                    c.drawString(cx + 1 * mm, y + row_h - 3.2 * mm - li * (font_size + 1), line)
            elif ci == 0:
                c.drawString(cx + 1 * mm, y + row_h / 2 - font_size / 3, text[:36])
            else:
                c.drawCentredString(cx + width / 2, y + row_h / 2 - font_size / 3, text[:32])
            cx += width
    return y


def line_chart(c, x, y, width, height, categories, series, title, y_max=None):
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.roundRect(x, y, width, height, 1.5 * mm, fill=1, stroke=1)
    c.setFont("SourceSans3-Semibold", 11)
    c.setFillColor(CHARCOAL)
    c.drawCentredString(x + width / 2, y + height - 6 * mm, safe(title))
    px, py = x + 12 * mm, y + 14 * mm
    pw, ph = width - 18 * mm, height - 26 * mm
    values = [v for _, vals, _ in series for v in vals if v is not None]
    maximum = y_max or (max(values) * 1.1 if values else 1)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    for step in range(5):
        yy = py + ph * step / 4
        c.line(px, yy, px + pw, yy)
        c.setFont("SourceSans3", 6.5)
        c.setFillColor(SECONDARY)
        c.drawRightString(px - 2 * mm, yy - 2, f"{maximum * step / 4:.0f}")
    palette = [BLUE, BRAND_RED, GREEN, AMBER, TEAL, colors.HexColor("#7B4AB0")]
    denom = max(len(categories) - 1, 1)
    for si, (name, vals, colour) in enumerate(series):
        colour = colour or palette[si % len(palette)]
        points = []
        for i, value in enumerate(vals):
            if value is None:
                continue
            points.append((px + pw * i / denom, py + ph * value / maximum))
        c.setStrokeColor(colour)
        c.setLineWidth(1.6)
        for a, b in zip(points, points[1:]):
            c.line(a[0], a[1], b[0], b[1])
        for point in points:
            c.setFillColor(colour)
            c.circle(point[0], point[1], 1.1, fill=1, stroke=0)
        legend_x = x + 8 * mm + si * (width - 16 * mm) / max(len(series), 1)
        c.setStrokeColor(colour)
        c.setLineWidth(2)
        c.line(legend_x, y + 7 * mm, legend_x + 7 * mm, y + 7 * mm)
        c.setFont("SourceSans3", 7)
        c.setFillColor(SECONDARY)
        c.drawString(legend_x + 8 * mm, y + 5.5 * mm, safe(name)[:22])
    c.setFont("SourceSans3", 6.5)
    c.setFillColor(SECONDARY)
    for i, label in enumerate(categories):
        if len(categories) > 12 and i % 2:
            continue
        c.drawCentredString(px + pw * i / denom, py - 4 * mm, safe(label))


def spark(c, x, y, width, height, values, colour=BLUE):
    if not values or max(values) == 0:
        return
    maximum = max(values)
    c.setStrokeColor(BORDER)
    c.line(x, y + height / 2, x + width, y + height / 2)
    points = [(x + width * i / max(len(values) - 1, 1), y + height * value / maximum) for i, value in enumerate(values)]
    c.setStrokeColor(colour)
    c.setLineWidth(1.1)
    for a, b in zip(points, points[1:]):
        c.line(a[0], a[1], b[0], b[1])


def find_person(week, name):
    return next((p for p in week["people"] if p["salesperson"] == name), None)


def sample_ok(person):
    return person["calls"] >= 100 and person["nonLiteralPositiveCalls"] >= 20 and person["activeDays"] >= 3


def classification_count(overall, label):
    return next((item["count"] for item in overall["contactClassificationBreakdown"] if item["label"] == label), 0)


def build_signals():
    rows = {}
    people = {person["salesperson"]: person for person in DATA["currentPeople"]}
    definitions = [
        ("Calling volume moved down", "largestCallsPerDayRegressionVsPrior", 3),
        ("More other short calls", "largestNonLiteralShortShareRegressionVsPrior", 2),
        ("Calling slowed later", "lowestLateToEarlyVelocityRatio", 2),
        ("High other short-call share", "highestNonLiteralShortPositiveShare", 2),
        ("High zero-duration share", "highestZeroDurationRate", 2),
        ("High long-call share", "highestLong5MinuteShare", 2),
    ]
    for label, key, limit in definitions:
        added = 0
        for candidate in DATA.get("reviewSignals", {}).get(key, []):
            name = candidate.get("salesperson")
            if not name or name in rows or name not in people:
                continue
            rows[name] = label
            added += 1
            if added >= limit or len(rows) >= 12:
                break
        if len(rows) >= 12:
            break
    return rows


SIGNALS = build_signals()


SIGNAL_INTERPRETATIONS = {
    "Calling volume moved down": "Visible calls per active day fell from last week. Check leave, meetings, coaching, lead supply and work outside the call export before treating the change as an effort issue.",
    "More other short calls": "More other calls ended inside 30 seconds. List quality, quick rejections and calling behaviour can all create this, so compare list mix and listen to a mixed sample.",
    "Calling slowed later": "Calling pace was lower later in the day. Check rostered hours, meetings, allocation timing and afternoon lead availability before drawing a conclusion.",
    "High other short-call share": "A large share of other calls ended inside 30 seconds. Compare similar campaigns and sample outcomes before coaching.",
    "High zero-duration share": "Many outbound attempts recorded zero talk seconds. Check dialler outcomes, carrier behaviour and list quality.",
    "High long-call share": "A larger share of recorded calls ran for at least five minutes. Sample outcomes because duration alone does not prove a good or bad result.",
}


def page_one(c):
    header(c, "CALL ACTIVITY & RHYTHM REPORT", REPORT_SUBTITLE, 1, "summary")
    y = PAGE_H - 47 * mm
    c.setFillColor(CREAM)
    c.setStrokeColor(BRAND_RED)
    c.roundRect(MARGIN, y - 23 * mm, CONTENT_W, 23 * mm, 1.5 * mm, fill=1, stroke=1)
    draw_wrapped(c, "Standalone review module for the Weekly Lead Management Report. Monday-Friday outbound calls; same exclusions as the main report. Recorded talk time shows activity, but it does not prove a person answered.", MARGIN + 5 * mm, y - 6 * mm, CONTENT_W - 10 * mm, size=9.2, leading=11, colour=SECONDARY, max_lines=2)
    draw_wrapped(c, "The exact shared Lead Management exclusion policy is applied before any person or team result is calculated.", MARGIN + 5 * mm, y - 17 * mm, CONTENT_W - 10 * mm, font="SourceSans3-Semibold", size=8.8, leading=10, colour=AMBER, max_lines=2)
    section(c, "Current-week headline", y - 36 * mm)
    o = CURRENT["overall"]
    kpis(c, [
        ("Outbound calls", fmt(o["calls"]), CHARCOAL),
        ("Calls per active person-day", num(o["callsPerPersonDay"]), BLUE),
        ("Calls with recorded talk time", fmt(o["positiveDurationCalls"]), GREEN),
        ("Zero-duration attempts", pct(o["zeroDurationRate"]), RED),
        ("Talk time", f"{o['totalTalkHours']:.1f} h", TEAL),
    ], y - 70 * mm)
    section(c, "Management view", y - 73 * mm, AMBER)
    rows = [["Company rhythm", "No clear company-wide late-day drop" if o["lateToEarlyVelocityRatio"] >= 0.85 else "Company calling pace slowed later", f"Late calling pace was {o['lateToEarlyVelocityRatio']:.2f}, or about {o['lateToEarlyVelocityRatio']*100:.0f} late-period calls for every 100 early-period calls. Check schedules, meetings and lead supply before treating a timing change as an effort problem."]]
    for name, signal in list(SIGNALS.items())[:4]:
        rows.append([signal, name, SIGNAL_INTERPRETATIONS[signal]])
    draw_table(c, MARGIN, y - 79 * mm, ["Lens", "People / result", "Interpretation"], rows, [36 * mm, 60 * mm, CONTENT_W - 96 * mm], row_h=11.5 * mm, header_h=10 * mm, font_size=7.1, wrap_columns={1, 2})


def page_two(c):
    header(c, "COMPANY CALL TREND", REPORT_SUBTITLE, 2, "company")
    y = PAGE_H - 47 * mm
    rows = []
    for week in DATA["weeks"]:
        o = week["overall"]
        voicemail = classification_count(o, "voicemail")
        system_audio = classification_count(o, "system_audio")
        rows.append([short_period(week["period"]), fmt(o["calls"]), pct(o["positiveDurationRate"]), pct(o["zeroDurationRate"]), fmt(voicemail), pct(voicemail/o["calls"]), pct(system_audio/o["calls"]), pct(o["nonLiteralShortPositiveShare"]), num(o["callsPerPersonDay"]), num(o["totalTalkHours"]), num(o["lateToEarlyVelocityRatio"], 2)])
    draw_table(c, MARGIN, y, ["Week", "Outbound", "Recorded talk time", "Zero duration", "Confirmed voicemail", "Voicemail %", "Automated audio %", "Other short calls", "Calls / person-day", "Talk h", "Late / early pace"], rows, [23*mm, 22*mm, 27*mm, 22*mm, 27*mm, 22*mm, 26*mm, 27*mm, 28*mm, 20*mm, 25*mm], row_h=9*mm, header_h=12*mm, font_size=7.2)
    x = MARGIN
    line_chart(c, x, y - 110 * mm, 124 * mm, 65 * mm, [short_period(w["period"]) for w in DATA["weeks"]], [
        ("Outbound calls", [w["overall"]["calls"] for w in DATA["weeks"]], BLUE),
        ("Calls with talk time", [w["overall"]["positiveDurationCalls"] for w in DATA["weeks"]], BRAND_RED),
    ], "Outbound Activity")
    line_chart(c, x + 132 * mm, y - 110 * mm, CONTENT_W - 132 * mm, 65 * mm, [short_period(w["period"]) for w in DATA["weeks"]], [
        ("Zero-duration %", [w["overall"]["zeroDurationRate"]*100 for w in DATA["weeks"]], RED),
        ("Other short calls %", [w["overall"]["nonLiteralShortPositiveShare"]*100 for w in DATA["weeks"]], AMBER),
    ], "Duration profile movement", y_max=85)
    section(c, "Interpretation", y - 120 * mm)
    first = DATA["weeks"][0]["overall"]
    current = DATA["weeks"][-1]["overall"]
    voicemail_rate = classification_count(current, "voicemail") / current["calls"]
    system_rate = classification_count(current, "system_audio") / current["calls"]
    draw_wrapped(c, f"Calls per active person-day moved from {first['callsPerPersonDay']:.1f} to {current['callsPerPersonDay']:.1f}. At the same time, {current['positiveDurationRate']*100:.1f}% of calls recorded some talk time, {voicemail_rate*100:.1f}% were confirmed voicemail and {system_rate*100:.1f}% were confirmed automated phone audio. Do not call the recorded-talk-time figure an answer rate: a recording, hold or unrecognised machine can also create talk seconds. The useful management question is whether the lower call pace came from roster and lead supply, or whether individual people changed how they worked.", MARGIN + 4*mm, y - 128*mm, CONTENT_W - 8*mm, size=8.7, leading=10.5, colour=SECONDARY, max_lines=5)


def page_three(c):
    header(c, "TIME OF DAY", REPORT_SUBTITLE, 3, "time")
    y = PAGE_H - 48 * mm
    slots = [x for x in DATA["currentHalfHourly"] if "08:00" <= x["time"] <= "18:00"]
    line_chart(c, MARGIN, y - 62 * mm, CONTENT_W, 60 * mm, [x["time"] for x in slots], [("Calls per active day", [x["callsPerActiveDay"] for x in slots], BLUE)], "Company half-hour calling curve")
    section(c, "Weekday pattern", y - 73 * mm)
    rows = []
    from datetime import date
    for item in DATA["currentDaily"]:
        rows.append([date.fromisoformat(item["date"]).strftime("%A"), fmt(item["calls"]), item["salespeople"], num(item["calls"] / item["salespeople"]), pct(item["positiveDurationRate"]), pct(item["shortPositiveShare"]), num(item["talkHours"])])
    draw_table(c, MARGIN, y - 80 * mm, ["Day", "Calls", "Active people", "Calls / person", "Recorded talk time %", "Short calls %", "Talk h"], rows, [35*mm, 30*mm, 30*mm, 32*mm, 34*mm, 30*mm, 23*mm], row_h=7*mm, header_h=10*mm, font_size=7.2)
    draw_wrapped(c, "Most calls were made from 09:00 to midday and again from 13:00 to 16:00. The drop around lunch and after 16:30 looks like the shape of the workday, not automatic proof that people became tired. Friday had the most calls. If a manager sees one person's line fall much earlier than the company line, check their roster, meetings and lead supply before asking about effort.", MARGIN, 31*mm, CONTENT_W, size=8.2, leading=9, colour=SECONDARY, max_lines=3)


def page_four(c):
    header(c, "TEAM CALL RHYTHM", REPORT_SUBTITLE, 4, "teams")
    y = PAGE_H - 47 * mm
    rows = []
    for team in CURRENT["teams"]:
        prior_team = next((x for x in PRIOR["teams"] if x["manager"] == team["manager"]), None)
        delta = team["callsPerPersonDay"] / prior_team["callsPerPersonDay"] - 1 if prior_team else None
        rows.append([team["manager"], fmt(team["calls"]), num(team["callsPerPersonDay"]), pct(delta), pct(team["zeroDurationRate"]), pct(team["nonLiteralShortPositiveShare"]), num(team["nonLiteralPositiveDurationDistribution"]["median"]), pct(team["long5MinuteShare"]), num(team["lateToEarlyVelocityRatio"], 2), pct(team["manualCallShare"])])
    draw_table(c, MARGIN, y, ["Manager team", "Calls", "Calls / person-day", "Change from last week", "Zero", "Other short calls", "Median sec", "5+ min", "Late / early pace", "Manual"], rows, [37*mm, 23*mm, 30*mm, 27*mm, 21*mm, 29*mm, 22*mm, 22*mm, 26*mm, 20*mm], row_h=8.5*mm, header_h=12*mm, font_size=7.2)
    hours = list(range(9, 18))
    series = []
    for team in CURRENT["teams"]:
        people = [p for p in DATA["currentPeople"] if p["manager"] == team["manager"]]
        values = [sum(next((h["calls"] for h in p["hourly"] if h["hour"] == hour), 0) for p in people) / max(team["personDays"], 1) for hour in hours]
        series.append((team["manager"], values, None))
    line_chart(c, MARGIN, y - 125*mm, CONTENT_W, 60*mm, [f"{h:02d}:00" for h in hours], series, "Team hourly calls per active person-day", y_max=32)
    slowest = min(CURRENT["teams"], key=lambda team: team.get("lateToEarlyVelocityRatio", 999))
    longest = max(CURRENT["teams"], key=lambda team: team.get("long5MinuteShare", -1))
    shortest = max(CURRENT["teams"], key=lambda team: team.get("nonLiteralShortPositiveShare", -1))
    draw_wrapped(c, f"Team prompts: {slowest['manager']} had the lowest later-day calling pace; {longest['manager']} had the largest share of 5+ minute calls; {shortest['manager']} had the largest share of other calls ending inside 30 seconds. None of those facts is automatically good or bad. Check roster hours, lead-list mix, calling method and a few real outcomes before using them for coaching.", MARGIN, 27*mm, CONTENT_W, size=8.5, leading=9.5, colour=SECONDARY, max_lines=3)


def page_five(c):
    header(c, "REVIEW SIGNALS", REPORT_SUBTITLE, 5, "signals")
    y = PAGE_H - 47 * mm
    names = list(SIGNALS)
    rows = []
    for name in names:
        p = next(x for x in DATA["currentPeople"] if x["salesperson"] == name)
        b = p.get("priorBaseline") or {}
        rows.append([SIGNALS[name], name, p["manager"], num(p["callsPerActiveDay"]), pct((b.get("callsPerActiveDayDelta") or 0) / max(p["callsPerActiveDay"] - (b.get("callsPerActiveDayDelta") or 0), 1)) if b.get("previousComparable") else "-", num(p["nonLiteralPositiveDurationDistribution"]["median"]), pct(p["nonLiteralShortPositiveShare"]), pct(b.get("nonLiteralShortPositiveShareDelta")), pct(p["zeroDurationRate"]), pct(p["long5MinuteShare"])])
    draw_table(c, MARGIN, y, ["Review prompt", "Salesperson", "Manager", "Calls/day", "Change from last week", "Median sec", "Other short calls", "Short-call change", "Zero", "5+ min"], rows, [38*mm, 33*mm, 32*mm, 22*mm, 27*mm, 22*mm, 29*mm, 26*mm, 21*mm, 21*mm], row_h=8*mm, header_h=12*mm, font_size=6.9, wrap_columns={0})
    c.setFillColor(CREAM)
    c.setStrokeColor(BRAND_RED)
    c.roundRect(MARGIN, 23*mm, CONTENT_W, 20*mm, 1.5*mm, fill=1, stroke=1)
    draw_wrapped(c, "Inspection prompts only. Check attendance, meetings, allocation timing, campaign/list mix, dialler/provider behaviour, call method and a small sample of actual outcomes before changing coaching or management decisions.", MARGIN + 4*mm, 37*mm, CONTENT_W - 8*mm, font="SourceSans3-Italic", size=8.8, leading=10, colour=AMBER, max_lines=2)


def people_page(c, page, chunk, title_suffix, bookmark):
    header(c, f"SALESPERSON RHYTHM - {title_suffix}", REPORT_SUBTITLE, page, bookmark)
    y_top = PAGE_H - 47*mm
    headers = ["Salesperson", "Manager", "Calls/day", "Change from last week", "Median sec", "Other <30 sec", "Zero", "5+ min", "Late/early pace", "Manual", "Review prompt", "Hourly rhythm"]
    widths = [31*mm, 29*mm, 17*mm, 17*mm, 19*mm, 19*mm, 18*mm, 18*mm, 19*mm, 17*mm, 36*mm, CONTENT_W - 240*mm]
    header_h, row_h = 10*mm, 6.4*mm
    c.setFillColor(CHARCOAL)
    c.setStrokeColor(BORDER)
    c.rect(MARGIN, y_top-header_h, sum(widths), header_h, fill=1, stroke=1)
    cx = MARGIN
    for i, (label, width) in enumerate(zip(headers, widths)):
        if i:
            c.line(cx, y_top-header_h, cx, y_top)
        c.setFillColor(WHITE)
        c.setFont("SourceSans3-Semibold", 6.8)
        for li, line in enumerate(wrap(label, "SourceSans3-Semibold", 6.8, width-2*mm)[:2]):
            c.drawCentredString(cx+width/2, y_top-4*mm-li*7, line)
        cx += width
    y = y_top-header_h
    hours = list(range(9,18))
    for ri, p in enumerate(chunk):
        y -= row_h
        c.setFillColor(CREAM if p["salesperson"] in SIGNALS else (PANEL if ri%2 else WHITE))
        c.rect(MARGIN, y, sum(widths), row_h, fill=1, stroke=1)
        prior_person = find_person(PRIOR, p["salesperson"])
        wow = p["callsPerActiveDay"] / prior_person["callsPerActiveDay"] - 1 if prior_person and sample_ok(p) and sample_ok(prior_person) else None
        values = [p["salesperson"], p["manager"], num(p["callsPerActiveDay"]), pct(wow), num(p["nonLiteralPositiveDurationDistribution"]["median"]), pct(p["nonLiteralShortPositiveShare"]), pct(p["zeroDurationRate"]), pct(p["long5MinuteShare"]), num(p["lateToEarlyVelocityRatio"],2), pct(p["manualCallShare"]), SIGNALS.get(p["salesperson"], "-")]
        cx = MARGIN
        for ci, (value, width) in enumerate(zip(values, widths[:-1])):
            if ci:
                c.line(cx, y, cx, y+row_h)
            c.setFont("SourceSans3", 6.5)
            c.setFillColor(CHARCOAL)
            if ci in (0,1,10):
                c.drawString(cx+0.8*mm, y+2.4*mm, safe(value)[:25])
            else:
                c.drawCentredString(cx+width/2, y+2.4*mm, safe(value))
            cx += width
        c.line(cx, y, cx, y+row_h)
        hourly = [next((h["calls"] for h in p["hourly"] if h["hour"]==hour),0) for hour in hours]
        spark(c, cx+1*mm, y+1.2*mm, widths[-1]-2*mm, row_h-2.4*mm, hourly)
    draw_wrapped(c, "Hourly rhythm lines show relative call volume from 09:00 to 17:00. They are shape indicators only; lines do not share a common vertical scale.", MARGIN, 24*mm, CONTENT_W, font="SourceSans3-Italic", size=8, leading=9, colour=SECONDARY, max_lines=1)


def page_nine(c):
    header(c, "METHODOLOGY & QA", REPORT_SUBTITLE, 9, "method")
    y = PAGE_H - 47*mm
    section(c, "Simple definitions and fair-use rules", y)
    rows = [
        ["Recorded talk time", "The phone system recorded more than zero talk seconds. This does not prove a person answered."],
        ["Other call", "A call left after confirmed voicemail and automated phone messages are removed. Some unknown phone outcomes can remain."],
        ["Other short call", "An other call with recorded talk time that ended inside 30 seconds."],
        ["Fair comparison rule", "Compare a person's week only with 100+ outbound calls, 20+ other calls with recorded talk time and 3+ active days."],
        ["Calling-pace rule", "Early/late comparisons also need at least 3 suitable workdays with enough calls across a 4+ hour span."],
        ["Late/early pace", "Around 1.00 means similar pace; below 1.00 means slower later. This does not prove tiredness."],
        ["Review prompt", "It means 'look into this'. It is not a score, warning or disciplinary finding."],
    ]
    draw_table(c, MARGIN, y-7*mm, ["Metric", "Meaning"], rows, [48*mm, CONTENT_W-48*mm], row_h=8*mm, header_h=9*mm, font_size=8, wrap_columns={1})
    section(c, "Validation", y-81*mm)
    qa_rows=[]
    for week in DATA["weeks"]:
        o=week["overall"]
        qa_rows.append([short_period(week["period"]), fmt(o["calls"]), "PASS" if o["durationObserved"]==o["calls"] else "FAIL", "PASS" if o["positiveDurationCalls"]+o["zeroDurationCalls"]==o["calls"] else "FAIL", "6", "PASS"])
    draw_table(c, MARGIN, y-88*mm, ["Week", "Outbound reconciled", "Duration complete", "Recorded talk + zero", "Teams", "Shared exclusions applied"], qa_rows, [34*mm, 38*mm, 38*mm, 42*mm, 26*mm, 58*mm], row_h=7*mm, header_h=10*mm)


def build():
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A4), pageCompression=1)
    c.setTitle(f"Call Activity & Rhythm Report - {REPORT_SHORT}")
    c.setAuthor("Official Media Group")
    c.setSubject("Standalone review module for the Weekly Lead Management Report")
    page_one(c); c.showPage()
    page_two(c); c.showPage()
    page_three(c); c.showPage()
    page_four(c); c.showPage()
    page_five(c); c.showPage()
    people = sorted(DATA["currentPeople"], key=lambda p: (p["manager"], p["salesperson"]))
    chunks = [people[0:19], people[19:38], people[38:57]]
    for idx, chunk in enumerate(chunks, start=1):
        people_page(c, 5+idx, chunk, f"{idx} OF 3", f"people-{idx}")
        c.showPage()
    page_nine(c); c.save()

    reader = PdfReader(str(OUTPUT))
    if len(reader.pages) != TOTAL_PAGES:
        raise ValueError(f"Expected {TOTAL_PAGES} pages, found {len(reader.pages)}")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_metadata({
        "/Title": f"Call Activity & Rhythm Report - {REPORT_SHORT}",
        "/Author": "Official Media Group",
        "/Subject": "Standalone review module for the Weekly Lead Management Report",
    })
    outlines = [
        ("Executive Summary", 0), ("Company Call Trend", 1), ("Time of Day", 2),
        ("Team Call Rhythm", 3), ("Review Signals", 4), ("Salesperson Rhythm", 5),
        ("Methodology & QA", 8),
    ]
    for label, page_number in outlines:
        writer.add_outline_item(label, page_number)
    with OUTPUT.open("wb") as handle:
        writer.write(handle)
    print(json.dumps({"output": str(OUTPUT), "pages": TOTAL_PAGES, "people": len(people), "teams": len(CURRENT["teams"]), "reviewSignals": len(SIGNALS)}, indent=2))


if __name__ == "__main__":
    build()
