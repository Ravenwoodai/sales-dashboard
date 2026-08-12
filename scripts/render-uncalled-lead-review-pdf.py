#!/usr/bin/env python3
"""Render the concise manager PDF for the weekly Uncalled Lead Review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

CHARCOAL = colors.HexColor("#231F20")
RED = colors.HexColor("#C52A20")
GREEN = colors.HexColor("#126B5B")
AMBER = colors.HexColor("#A55B00")
GREY = colors.HexColor("#F2F3F4")
PALE_GREEN = colors.HexColor("#E7F2ED")
PALE_RED = colors.HexColor("#FFF0ED")
CREAM = colors.HexColor("#FFF4EA")
MID_GREY = colors.HexColor("#5F6875")
GRID = colors.HexColor("#D9DDE2")


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf"), Path("C:/Windows/Fonts/ariali.ttf")),
    ]
    for regular, bold, italic in candidates:
        if regular.exists() and bold.exists() and italic.exists():
            pdfmetrics.registerFont(TTFont("ReportRegular", str(regular)))
            pdfmetrics.registerFont(TTFont("ReportBold", str(bold)))
            pdfmetrics.registerFont(TTFont("ReportItalic", str(italic)))
            return "ReportRegular", "ReportBold", "ReportItalic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


REGULAR, BOLD, ITALIC = register_fonts()


def esc(value) -> str:
    return str(value if value is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def pct(value) -> str:
    return f"{float(value or 0) * 100:.1f}%"


def num(value) -> str:
    return f"{int(value or 0):,}"


def p(value, style):
    return Paragraph(esc(value), style)


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontName=BOLD, fontSize=22, leading=25, textColor=CHARCOAL, alignment=TA_LEFT, spaceAfter=3 * mm),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontName=ITALIC, fontSize=10, leading=13, textColor=MID_GREY, spaceAfter=4 * mm),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName=REGULAR, fontSize=8.5, leading=11, textColor=CHARCOAL),
        "small": ParagraphStyle("small", parent=base["Normal"], fontName=REGULAR, fontSize=7, leading=8.5, textColor=CHARCOAL),
        "tiny": ParagraphStyle("tiny", parent=base["Normal"], fontName=REGULAR, fontSize=6.4, leading=7.5, textColor=CHARCOAL),
        "white": ParagraphStyle("white", parent=base["Normal"], fontName=BOLD, fontSize=7.3, leading=8.5, textColor=colors.white, alignment=TA_CENTER),
        "section": ParagraphStyle("section", parent=base["Heading2"], fontName=BOLD, fontSize=13, leading=15, textColor=CHARCOAL, spaceBefore=2 * mm, spaceAfter=2 * mm),
        "kpi_label": ParagraphStyle("kpi_label", parent=base["Normal"], fontName=BOLD, fontSize=8, leading=10, textColor=MID_GREY, alignment=TA_CENTER),
        "kpi": ParagraphStyle("kpi", parent=base["Normal"], fontName=BOLD, fontSize=19, leading=22, textColor=CHARCOAL, alignment=TA_CENTER),
    }


def heading(story, styles, title, subtitle):
    story.append(Paragraph(esc(title), styles["title"]))
    story.append(Paragraph(esc(subtitle), styles["subtitle"]))


def styled_table(rows, widths, styles, header=True, font_size="small", row_backgrounds=None):
    wrapped = []
    for row_index, row in enumerate(rows):
        style = styles["white"] if header and row_index == 0 else styles[font_size]
        wrapped.append([p(value, style) for value in row])
    table = Table(wrapped, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.3, GRID),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), CHARCOAL))
    for row_number, colour in row_backgrounds or []:
        commands.append(("BACKGROUND", (0, row_number), (-1, row_number), colour))
    table.setStyle(TableStyle(commands))
    return table


def page_footer(canvas, doc):
    canvas.saveState()
    width, _ = landscape(A4)
    canvas.setStrokeColor(RED)
    canvas.setLineWidth(1.2)
    canvas.line(14 * mm, 11 * mm, 18 * mm, 11 * mm)
    canvas.setFont(REGULAR, 7)
    canvas.setFillColor(MID_GREY)
    canvas.drawString(20 * mm, 9.2 * mm, "Countrywide Austral | Uncalled Lead Review")
    canvas.drawRightString(width - 14 * mm, 9.2 * mm, f"Page {doc.page}")
    canvas.restoreState()


def render(data_path: Path, output_path: Path):
    data = json.loads(data_path.read_text(encoding="utf-8"))
    styles = build_styles()
    period = data["reportingPeriod"]
    subtitle = f'{period["startDate"]} to {period["endDate"]}'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=16 * mm,
        title=f"Uncalled Lead Review - {subtitle}",
        author="Countrywide Austral",
        subject="Weekly uncalled lead review",
    )
    story = []

    heading(story, styles, "UNCALLED LEAD REVIEW", subtitle)
    story.append(Paragraph(
        "A simple review of leads that had no qualifying outbound call by the receiving salesperson after allocation and by Friday 11:59:59 pm. The same exclusions as the Weekly Lead Management Report are applied.",
        styles["body"],
    ))
    story.append(Spacer(1, 5 * mm))
    kpis = [
        ("Uncalled leads", num(data["totals"]["uncalled"]), GREY, CHARCOAL),
        ("Missed A/B opportunities", num(data["totals"]["missed"]), PALE_GREEN, GREEN),
        ("Explainable non-calls", num(data["totals"]["explainableNonCalls"]), CREAM, AMBER),
        ("Uncertain / manual research", num(data["totals"]["uncertain"]), PALE_RED, RED),
    ]
    kpi_cells = []
    for label, value, _, colour in kpis:
        value_style = ParagraphStyle("k", parent=styles["kpi"], textColor=colour)
        kpi_cells.append([Paragraph(label, styles["kpi_label"]), Paragraph(value, value_style)])
    kpi_table = Table([kpi_cells], colWidths=[65 * mm] * 4)
    kpi_style = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (0, 0), (-1, -1), 0.5, GRID)]
    for index, (_, _, fill, _) in enumerate(kpis):
        kpi_style.extend([("BACKGROUND", (index, 0), (index, 0), fill), ("BOX", (index, 0), (index, 0), 0.5, GRID), ("TOPPADDING", (index, 0), (index, 0), 7), ("BOTTOMPADDING", (index, 0), (index, 0), 7)])
    kpi_table.setStyle(TableStyle(kpi_style))
    story.append(kpi_table)
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("What needs attention", styles["section"]))
    top_person = data["people"][0] if data["people"] else {}
    top_source = data["sources"][0] if data["sources"] else {}
    top_day = data["days"][0] if data["days"] else {}
    findings = [
        ["Finding", "What it means"],
        ["Clear missed opportunities", f'{num(data["totals"]["missed"])} A/B leads were uncalled. Start with the largest people and batches in the workbook.'],
        ["Largest salesperson review", f'{top_person.get("name", "-")}: {num(top_person.get("missed"))} missed A/B opportunities among {num(top_person.get("uncalled"))} uncalled leads.'],
        ["Largest source concentration", f'{top_source.get("name", "-")}: {num(top_source.get("uncalled"))} uncalled leads, including {num(top_source.get("missed"))} missed A/B opportunities.'],
        ["Timing", f'{top_day.get("label", "-")} contained the most uncalled allocations ({num(top_day.get("count"))}). {num(data["totals"]["lateFriday"])} were allocated Friday after 3 pm.'],
    ]
    story.append(styled_table(findings, [53 * mm, 207 * mm], styles))

    story.append(PageBreak())
    heading(story, styles, "WHAT WAS LEFT UNCALLED", f"{subtitle} | Category and suitability mix")
    story.append(Paragraph("Only clear business-name signals receive a category. If the allocation record is unclear, it stays in manual research.", styles["body"]))
    story.append(Spacer(1, 3 * mm))
    category_rows = [["Category", "Uncalled", "Share"]] + [[r["label"], num(r["count"]), pct(r["share"])] for r in data["categories"]]
    suitability_rows = [["Suitability band", "Uncalled", "Share"]] + [[r["label"], num(r["count"]), pct(r["share"])] for r in data["suitability"]]
    group_rows = [["Operational group", "Uncalled", "Share"]] + [[r["label"], num(r["count"]), pct(r["share"])] for r in data["operationalGroups"]]
    mix = Table([
        [styled_table(category_rows, [54 * mm, 18 * mm, 16 * mm], styles), styled_table(suitability_rows, [51 * mm, 18 * mm, 16 * mm], styles), styled_table(group_rows, [57 * mm, 18 * mm, 16 * mm], styles)]
    ], colWidths=[91 * mm, 86 * mm, 91 * mm], hAlign="LEFT")
    mix.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story.append(mix)

    story.append(PageBreak())
    heading(story, styles, "SALESPERSON AND TEAM SIGNALS", f"{subtitle} | Uncalled population only")
    story.append(Paragraph("Counts and percentages are shown together. This is a review list, not a general performance leaderboard.", styles["body"]))
    story.append(Spacer(1, 3 * mm))
    team_rows = [["Manager team", "Uncalled", "A/B missed", "A/B %", "Should not", "Blocked", "Uncertain"]]
    team_rows += [[r["name"], num(r["uncalled"]), num(r["missed"]), pct(r["missedShare"]), num(r["shouldNot"]), num(r["blocked"]), num(r["uncertain"])] for r in data["teams"]]
    story.append(styled_table(team_rows, [45 * mm, 24 * mm, 24 * mm, 21 * mm, 24 * mm, 21 * mm, 25 * mm], styles))
    story.append(Spacer(1, 4 * mm))
    people_rows = [["Salesperson", "Manager", "Uncalled", "A/B missed", "A/B %", "Should not", "Blocked", "Uncertain", "Sample"]]
    people_rows += [[r["name"], r["manager"], num(r["uncalled"]), num(r["missed"]), pct(r["missedShare"]), num(r["shouldNot"]), num(r["blocked"]), num(r["uncertain"]), r["comparisonStatus"]] for r in data["people"][:15]]
    story.append(styled_table(people_rows, [34 * mm, 31 * mm, 20 * mm, 21 * mm, 18 * mm, 20 * mm, 17 * mm, 21 * mm, 22 * mm], styles, font_size="tiny"))
    story.append(Paragraph("The 15 largest salesperson review populations are shown here. The workbook contains every salesperson and team.", styles["small"]))

    story.append(PageBreak())
    heading(story, styles, "SOURCE, BATCH AND TIMING", f"{subtitle} | Where uncalled records are concentrated")
    story.append(Paragraph("These counts show concentration only. They do not prove that a source or batch is poor without comparing its full allocation volume.", styles["body"]))
    story.append(Spacer(1, 3 * mm))
    source_rows = [["Lead source", "Uncalled", "A/B missed", "Should not", "Blocked", "Uncertain"]]
    source_rows += [[r["name"], num(r["uncalled"]), num(r["missed"]), num(r["shouldNot"]), num(r["blocked"]), num(r["uncertain"])] for r in data["sources"][:14]]
    batch_rows = [["Allocation batch", "Uncalled", "A/B missed", "Should not", "Blocked", "Uncertain"]]
    batch_rows += [[r["name"], num(r["uncalled"]), num(r["missed"]), num(r["shouldNot"]), num(r["blocked"]), num(r["uncertain"])] for r in data["batches"][:14]]
    split = Table([[styled_table(source_rows, [32 * mm, 18 * mm, 18 * mm, 18 * mm, 14 * mm, 17 * mm], styles, font_size="tiny"), styled_table(batch_rows, [58 * mm, 18 * mm, 18 * mm, 18 * mm, 14 * mm, 19 * mm], styles, font_size="tiny")]], colWidths=[120 * mm, 148 * mm])
    split.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    story.append(split)

    story.append(PageBreak())
    heading(story, styles, "TREND, METHOD AND QA", f"{subtitle} | Available weeks only")
    trend_rows = [["Week", "Status", "Uncalled", "A/B missed", "Explainable", "Uncertain"]]
    for row in data["trend"]:
        trend_rows.append([f'{row["week"]} to {row["endDate"]}', row["status"], num(row["uncalled"]) if row["uncalled"] is not None else "-", num(row["missed"]) if row["missed"] is not None else "-", num(row["explainableNonCalls"]) if row["explainableNonCalls"] is not None else "-", num(row["uncertain"]) if row["uncertain"] is not None else "-"])
    story.append(styled_table(trend_rows, [48 * mm, 55 * mm, 25 * mm, 25 * mm, 28 * mm, 25 * mm], styles))
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Simple method", styles["section"]))
    method_rows = [
        ["Rule", "Plain-language meaning"],
        ["Uncalled", "No qualifying outbound call by the receiving salesperson after allocation and by Friday 11:59:59 pm."],
        ["Categories", "Clear business-name keywords only. Unclear records remain Other / uncertain."],
        ["Exclusions", data["exclusions"]["display"]],
        ["Minimum comparison sample", f'{data["ruleModel"]["minimumComparisonSample"]} uncalled leads; smaller results remain visible and are marked Small sample.'],
    ]
    story.append(styled_table(method_rows, [52 * mm, 208 * mm], styles))
    story.append(Spacer(1, 5 * mm))
    qa_rows = [["QA check", "Result"]] + [[r["check"], r["result"]] for r in data["qaChecks"]]
    story.append(styled_table(qa_rows, [190 * mm, 35 * mm], styles, row_backgrounds=[(i, PALE_GREEN) for i in range(1, len(qa_rows))]))

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    render(args.data.resolve(), args.output.resolve())
    print(json.dumps({"status": "complete", "pdfPath": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
