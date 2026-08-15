import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const {
  buildUncalledLeadReview,
  datePlus,
} = require("../src/uncalledLeadReview.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return args;
}

function displayDate(isoDate, includeWeekday = false) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    ...(includeWeekday ? { weekday: "long" } : {}),
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function excelColumn(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeFormulaText(value) {
  return String(value).replaceAll('"', '""');
}

const args = argsFrom(process.argv.slice(2));
if (args.help) {
  process.stdout.write("Usage: --start YYYY-MM-DD --manifest <manifest.json> --config <config.json> --rules <rules.json> --output <folder> [--output-root <folder>]\n");
  process.exit(0);
}
for (const required of ["start", "manifest", "config", "rules", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}

const startDate = String(args.start);
const endDate = datePlus(startDate, 4);
const runId = `${startDate}_to_${endDate}`;
const outputDir = path.resolve(String(args.output));
const outputRoot = path.resolve(String(args["output-root"] || path.dirname(outputDir)));
const dataPath = path.join(outputDir, "report_data.json");
const qaPath = path.join(outputDir, "qa.json");
const workbookPath = path.join(outputDir, `Uncalled_Lead_Review_${runId}.xlsx`);

await fs.mkdir(outputDir, { recursive: true });
const payload = buildUncalledLeadReview({
  root,
  manifestPath: path.resolve(String(args.manifest)),
  configPath: path.resolve(String(args.config)),
  rulesPath: path.resolve(String(args.rules)),
  startDate,
});

async function loadTrend() {
  const reports = new Map([[startDate, payload]]);
  let entries = [];
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(outputRoot, entry.name, "report_data.json");
    try {
      const data = JSON.parse(await fs.readFile(candidate, "utf8"));
      const week = data.reportingPeriod?.startDate;
      if (week && week <= startDate) reports.set(week, data);
    } catch {}
  }
  const available = [...reports.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-4)
    .map(([week, data]) => ({
      week,
      endDate: data.reportingPeriod.endDate,
      status: "Available",
      uncalled: data.totals.uncalled,
      missed: data.totals.missed,
      explainableNonCalls: data.totals.explainableNonCalls,
      uncertain: data.totals.uncertain,
    }));
  if (startDate <= "2026-08-03" && !available.some((row) => row.week === "2026-07-13")) {
    available.unshift({ week: "2026-07-13", endDate: "2026-07-17", status: "Allocation export unavailable", uncalled: null, missed: null, explainableNonCalls: null, uncertain: null });
  }
  return available.slice(-4);
}

payload.trend = await loadTrend();
payload.generatedAt = new Date().toISOString();
await fs.writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`);

const workbook = Workbook.create();
const executive = workbook.worksheets.add("Executive Review");
const categorySheet = workbook.worksheets.add("Category & Suitability");
const explainableSheet = workbook.worksheets.add("Explainable Non-calls");
const peopleSheet = workbook.worksheets.add("Salespeople & Teams");
const sourceSheet = workbook.worksheets.add("Source Batch Timing");
const trendSheet = workbook.worksheets.add("Four-Week Trend");
const classifiedSheet = workbook.worksheets.add("Classified Leads");
const methodSheet = workbook.worksheets.add("Method & QA");

const charcoal = "#231F20";
const red = "#B42318";
const redBright = "#EE3424";
const green = "#1F6F5B";
const amber = "#A45A00";
const grey = "#F5F6F7";
const darkGrey = "#5B6470";
const border = "#D6D9DD";
const cream = "#FFF3F1";
const paleGreen = "#E7F3ED";

function title(sheet, endColumn, text, subtitle) {
  sheet.getRange(`A1:${endColumn}1`).merge();
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endColumn}1`).format = {
    fill: "#FFFFFF",
    font: { name: "Source Sans 3", bold: true, color: charcoal, size: 18 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    borders: { left: { style: "thick", color: redBright } },
  };
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.getRange(`A2:${endColumn}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endColumn}2`).format = { font: { name: "Source Sans 3", italic: true, color: darkGrey, size: 10 }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange("A2").format.rowHeight = 24;
  sheet.showGridLines = false;
}

function styleHeader(range) {
  range.format = {
    fill: charcoal,
    font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { bottom: { style: "thin", color: border } },
  };
  range.format.rowHeight = 34;
}

function styleBody(range) {
  range.format = {
    font: { name: "Source Sans 3", color: charcoal, size: 9 },
    verticalAlignment: "center",
    borders: { insideHorizontal: { style: "thin", color: border } },
  };
}

function setWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function writeTable(sheet, startRow, startColumn, headers, rows, options = {}) {
  const startColNumber = startColumn.charCodeAt(0) - 64;
  const endColumn = excelColumn(startColNumber + headers.length - 1);
  const endRow = startRow + rows.length;
  sheet.getRange(`${startColumn}${startRow}:${endColumn}${endRow}`).values = [headers, ...rows];
  styleHeader(sheet.getRange(`${startColumn}${startRow}:${endColumn}${startRow}`));
  if (rows.length) styleBody(sheet.getRange(`${startColumn}${startRow + 1}:${endColumn}${endRow}`));
  if (options.numberFormats) {
    for (const [relativeIndex, format] of Object.entries(options.numberFormats)) {
      const column = excelColumn(startColNumber + Number(relativeIndex));
      if (rows.length) sheet.getRange(`${column}${startRow + 1}:${column}${endRow}`).format.numberFormat = format;
    }
  }
  return { endColumn, endRow };
}

const subtitle = `${displayDate(startDate, true)} to ${displayDate(endDate, true)}`;
const dataStartRow = 7;
const dataEndRow = dataStartRow + payload.uncalledRows.length - 1;
const dataRange = `'Classified Leads'!$A$${dataStartRow}:$Y$${dataEndRow}`;

title(executive, "N", "UNCALLED LEAD REVIEW", subtitle);
executive.getRange("A3:N4").merge();
executive.getRange("A3").values = [["This companion report explains the uncalled population. It uses the same receiving-salesperson, customer-ID, outbound-call, Friday-cutoff and exclusion rules as the Weekly Lead Management Report. Business categories use simple deterministic name rules; unclear records remain Uncertain."]];
executive.getRange("A3:N4").format = { fill: grey, font: { name: "Source Sans 3", color: darkGrey, size: 9 }, wrapText: true, verticalAlignment: "center" };

const cards = [
  ["A6:C6", "A7:C8", "Uncalled leads", `=COUNTA('Classified Leads'!$A$${dataStartRow}:$A$${dataEndRow})`, charcoal, grey, "#,##0"],
  ["D6:F6", "D7:F8", "Missed A/B opportunities", `=COUNTIF('Classified Leads'!$O$${dataStartRow}:$O$${dataEndRow},\"Missed commercial opportunity\")`, green, paleGreen, "#,##0"],
  ["G6:I6", "G7:I8", "Explainable non-calls", `=COUNTIF('Classified Leads'!$O$${dataStartRow}:$O$${dataEndRow},\"Should not have been called\")+COUNTIF('Classified Leads'!$O$${dataStartRow}:$O$${dataEndRow},\"Could not practically be called\")`, amber, cream, "#,##0"],
  ["J6:L6", "J7:L8", "Uncertain / manual research", `=COUNTIF('Classified Leads'!$O$${dataStartRow}:$O$${dataEndRow},\"Uncertain / manual research\")`, red, cream, "#,##0"],
];
for (const [labelRange, valueRange, label, formula, colour, fill, format] of cards) {
  executive.getRange(labelRange).merge();
  executive.getRange(labelRange.split(":")[0]).values = [[label]];
  executive.getRange(labelRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: darkGrey, size: 9 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: border } };
  executive.getRange(valueRange).merge();
  const valueCell = valueRange.split(":")[0];
  executive.getRange(valueCell).formulas = [[formula]];
  executive.getRange(valueRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: colour, size: 22 }, horizontalAlignment: "center", verticalAlignment: "center", numberFormat: format, borders: { preset: "outside", style: "thin", color: border } };
}

executive.getRange("A11:N11").merge();
executive.getRange("A11").values = [["Material findings"]];
executive.getRange("A11:N11").format = { fill: charcoal, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 10 }, verticalAlignment: "center" };
const topCategory = payload.categories[0];
const topSource = payload.sources[0];
const topPerson = payload.people[0];
const topDay = payload.days[0];
const findings = [
  ["Largest category", topCategory ? `${topCategory.label}: ${topCategory.count.toLocaleString()} uncalled leads (${(topCategory.share * 100).toFixed(1)}%).` : "No category result."],
  ["Largest source", topSource ? `${topSource.name}: ${topSource.uncalled.toLocaleString()} uncalled leads, including ${topSource.missed.toLocaleString()} missed A/B opportunities.` : "No source result."],
  ["Largest salesperson review", topPerson ? `${topPerson.name}: ${topPerson.missed.toLocaleString()} missed A/B opportunities among ${topPerson.uncalled.toLocaleString()} uncalled leads.` : "No salesperson result."],
  ["Timing", topDay ? `${topDay.label} contained the most uncalled allocations (${topDay.count.toLocaleString()}). ${payload.totals.lateFriday.toLocaleString()} were allocated Friday after 3 pm.` : "No timing result."],
];
writeTable(executive, 12, "A", ["Finding", "What it means"], findings);
executive.getRange("B13:B16").format.wrapText = true;
executive.getRange("A18:N18").merge();
executive.getRange("A18").values = [["Recommended actions"]];
executive.getRange("A18:N18").format = { fill: charcoal, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 10 }, verticalAlignment: "center" };
const actions = [
  ["Manager follow-up", `${payload.totals.missed.toLocaleString()} clear A/B opportunities were left uncalled. Review the highest-count people and batches first.`],
  ["Lead-gate cleaning", `${payload.totals.shouldNot.toLocaleString()} records matched a clear should-not-call rule. Confirm them before suppressing future allocations.`],
  ["Source-data repair", `${payload.totals.blocked.toLocaleString()} records lacked a usable business identity and should be fixed before reallocation.`],
  ["Manual research", `${payload.totals.uncertain.toLocaleString()} records were not clear enough to classify reliably from the allocation data.`],
];
writeTable(executive, 19, "A", ["Action", "Reason"], actions);
executive.getRange("B20:B23").format.wrapText = true;
executive.freezePanes.freezeRows(4);
setWidths(executive, { A: 24, B: 28, C: 4, D: 18, E: 18, F: 4, G: 18, H: 18, I: 4, J: 18, K: 18, L: 4, M: 12, N: 12 });

title(categorySheet, "S", "WHAT WAS LEFT UNCALLED", `${subtitle} | Category, suitability and operational-group composition`);
categorySheet.getRange("A3:S4").merge();
categorySheet.getRange("A3").values = [["Categories are assigned from clear words in the business name. No category keyword means Other / uncertain. Suitability bands are simple report-review priorities, not a promise that a lead will buy advertising."]];
categorySheet.getRange("A3:S4").format = { fill: grey, font: { name: "Source Sans 3", color: darkGrey, size: 9 }, wrapText: true, verticalAlignment: "center" };
const categoryRows = payload.categories.map((row, index) => [
  row.label,
  null,
  null,
]);
const categoryTable = writeTable(categorySheet, 6, "A", ["Category", "Uncalled", "Share"], categoryRows, { numberFormats: { 1: "#,##0", 2: "0.0%" } });
for (let index = 0; index < categoryRows.length; index += 1) {
  const row = 7 + index;
  categorySheet.getRange(`B${row}`).formulas = [[`=COUNTIF('Classified Leads'!$M$${dataStartRow}:$M$${dataEndRow},A${row})`]];
  categorySheet.getRange(`C${row}`).formulas = [[`=B${row}/COUNTA('Classified Leads'!$A$${dataStartRow}:$A$${dataEndRow})`]];
}
const bandRows = payload.suitability.map((row) => [row.label, null, null]);
writeTable(categorySheet, 6, "E", ["Suitability band", "Uncalled", "Share"], bandRows, { numberFormats: { 1: "#,##0", 2: "0.0%" } });
for (let index = 0; index < bandRows.length; index += 1) {
  const row = 7 + index;
  categorySheet.getRange(`F${row}`).formulas = [[`=COUNTIF('Classified Leads'!$R$${dataStartRow}:$R$${dataEndRow},E${row})`]];
  categorySheet.getRange(`G${row}`).formulas = [[`=F${row}/COUNTA('Classified Leads'!$A$${dataStartRow}:$A$${dataEndRow})`]];
}
const operationalRows = payload.operationalGroups.map((row) => [row.label, null, null]);
writeTable(categorySheet, 6, "I", ["Operational group", "Uncalled", "Share"], operationalRows, { numberFormats: { 1: "#,##0", 2: "0.0%" } });
for (let index = 0; index < operationalRows.length; index += 1) {
  const row = 7 + index;
  categorySheet.getRange(`J${row}`).formulas = [[`=COUNTIF('Classified Leads'!$O$${dataStartRow}:$O$${dataEndRow},I${row})`]];
  categorySheet.getRange(`K${row}`).formulas = [[`=J${row}/COUNTA('Classified Leads'!$A$${dataStartRow}:$A$${dataEndRow})`]];
}
const categoryChart = categorySheet.charts.add("bar", categorySheet.getRange(`A6:B${categoryTable.endRow}`));
categoryChart.title = "Uncalled leads by category";
categoryChart.hasLegend = false;
categoryChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
categoryChart.yAxis = { numberFormatCode: "#,##0", min: 0 };
categoryChart.setPosition("M6", "S22");
categorySheet.freezePanes.freezeRows(4);
setWidths(categorySheet, { A: 30, B: 13, C: 12, D: 3, E: 28, F: 13, G: 12, H: 3, I: 34, J: 13, K: 12, L: 3, M: 12, N: 12, O: 12, P: 12, Q: 12, R: 12, S: 12 });

title(explainableSheet, "M", "GENUINE EXPLAINABLE NON-CALLS", `${subtitle} | Representative records; the complete population remains in Classified Leads`);
explainableSheet.getRange("A3:M4").merge();
explainableSheet.getRange("A3").values = [["Should-not-call and could-not-call labels appear only when a clear deterministic business-name rule matches. Unclear records stay in manual research. Late allocation alone never makes a lead uncallable."]];
explainableSheet.getRange("A3:M4").format = { fill: cream, font: { name: "Source Sans 3", color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
let exampleRow = 6;
for (const group of ["Missed commercial opportunity", "Should not have been called", "Could not practically be called", "Uncertain / manual research"]) {
  explainableSheet.getRange(`A${exampleRow}:M${exampleRow}`).merge();
  explainableSheet.getRange(`A${exampleRow}`).values = [[group]];
  explainableSheet.getRange(`A${exampleRow}:M${exampleRow}`).format = { fill: charcoal, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 10 } };
  exampleRow += 1;
  const rows = (payload.examples[group] || []).map((row) => [row.allocationKey, row.businessName || "[blank]", row.salesperson, row.manager, row.category, row.suitabilityBand, row.confidence, row.classificationBasis, row.recommendedHandling]);
  writeTable(explainableSheet, exampleRow, "A", ["Allocation key", "Business", "Salesperson", "Manager", "Category", "Band", "Confidence", "Evidence", "Recommended handling"], rows);
  if (rows.length) explainableSheet.getRange(`H${exampleRow + 1}:I${exampleRow + rows.length}`).format.wrapText = true;
  exampleRow += rows.length + 3;
}
setWidths(explainableSheet, { A: 16, B: 28, C: 24, D: 22, E: 26, F: 20, G: 12, H: 42, I: 38, J: 3, K: 3, L: 3, M: 3 });
explainableSheet.freezePanes.freezeRows(4);

title(peopleSheet, "P", "SALESPERSON AND TEAM SIGNALS", `${subtitle} | Composition of uncalled leads only; no general performance leaderboard`);
peopleSheet.getRange("A3:P4").merge();
peopleSheet.getRange("A3").values = [[`Counts and percentages are shown together. Comparative interpretation is marked Small sample below ${payload.ruleModel.minimumComparisonSample} uncalled leads.`]];
peopleSheet.getRange("A3:P4").format = { fill: grey, font: { name: "Source Sans 3", color: darkGrey, size: 9 }, wrapText: true, verticalAlignment: "center" };
const teamRows = payload.teams.map((row) => [row.name, row.uncalled, row.missed, row.missedShare, row.shouldNot, row.shouldNotShare, row.blocked, row.blockedShare, row.uncertain, row.uncertainShare, row.topCategory, row.topSource, row.friday, row.ownershipMismatch, row.comparisonStatus]);
const teamEnd = writeTable(peopleSheet, 6, "A", ["Manager team", "Uncalled", "A/B missed", "A/B %", "Should not", "Should not %", "Blocked", "Blocked %", "Uncertain", "Uncertain %", "Top category", "Top source", "Friday", "Owner mismatch", "Sample"], teamRows, { numberFormats: { 1: "#,##0", 2: "#,##0", 3: "0.0%", 4: "#,##0", 5: "0.0%", 6: "#,##0", 7: "0.0%", 8: "#,##0", 9: "0.0%", 12: "#,##0", 13: "#,##0" } });
const peopleStart = teamEnd.endRow + 3;
const peopleRows = payload.people.map((row) => [row.name, row.manager, row.uncalled, row.missed, row.missedShare, row.shouldNot, row.shouldNotShare, row.blocked, row.blockedShare, row.uncertain, row.uncertainShare, row.topCategory, row.topSource, row.friday, row.ownershipMismatch, row.comparisonStatus]);
writeTable(peopleSheet, peopleStart, "A", ["Salesperson", "Manager", "Uncalled", "A/B missed", "A/B %", "Should not", "Should not %", "Blocked", "Blocked %", "Uncertain", "Uncertain %", "Top category", "Top source", "Friday", "Owner mismatch", "Sample"], peopleRows, { numberFormats: { 2: "#,##0", 3: "#,##0", 4: "0.0%", 5: "#,##0", 6: "0.0%", 7: "#,##0", 8: "0.0%", 9: "#,##0", 10: "0.0%", 13: "#,##0", 14: "#,##0" } });
peopleSheet.freezePanes.freezeRows(4);
setWidths(peopleSheet, { A: 26, B: 23, C: 13, D: 13, E: 12, F: 13, G: 13, H: 12, I: 12, J: 13, K: 13, L: 28, M: 18, N: 11, O: 15, P: 14 });

title(sourceSheet, "R", "SOURCE, BATCH AND TIMING SIGNALS", `${subtitle} | The largest concentrations inside the uncalled population`);
sourceSheet.getRange("A3:R4").merge();
sourceSheet.getRange("A3").values = [["These tables show where uncalled records are concentrated. They do not claim that a source or batch is poor without comparing it with its full allocation volume in the Weekly Lead Management Report."]];
sourceSheet.getRange("A3:R4").format = { fill: grey, font: { name: "Source Sans 3", color: darkGrey, size: 9 }, wrapText: true, verticalAlignment: "center" };
const sourceRows = payload.sources.slice(0, 15).map((row) => [row.name, row.uncalled, row.missed, row.shouldNot, row.blocked, row.uncertain, row.topCategory]);
writeTable(sourceSheet, 6, "A", ["Lead source", "Uncalled", "A/B missed", "Should not", "Blocked", "Uncertain", "Top category"], sourceRows, { numberFormats: { 1: "#,##0", 2: "#,##0", 3: "#,##0", 4: "#,##0", 5: "#,##0" } });
const batchRows = payload.batches.slice(0, 15).map((row) => [row.name, row.uncalled, row.missed, row.shouldNot, row.blocked, row.uncertain, row.topCategory]);
writeTable(sourceSheet, 6, "I", ["Allocation batch", "Uncalled", "A/B missed", "Should not", "Blocked", "Uncertain", "Top category"], batchRows, { numberFormats: { 1: "#,##0", 2: "#,##0", 3: "#,##0", 4: "#,##0", 5: "#,##0" } });
const timingStart = 24;
writeTable(sourceSheet, timingStart, "A", ["Day received", "Uncalled", "Share"], payload.days.map((row) => [row.label, row.count, row.share]), { numberFormats: { 1: "#,##0", 2: "0.0%" } });
writeTable(sourceSheet, timingStart, "E", ["Time received", "Uncalled", "Share"], payload.times.map((row) => [row.label, row.count, row.share]), { numberFormats: { 1: "#,##0", 2: "0.0%" } });
sourceSheet.getRange(`I${timingStart}:R${timingStart + 4}`).merge();
sourceSheet.getRange(`I${timingStart}`).values = [[`${payload.totals.lateFriday.toLocaleString()} uncalled leads were allocated on Friday after 3 pm. This means limited same-day opportunity; it does not prove that the lead could not be called.`]];
sourceSheet.getRange(`I${timingStart}:R${timingStart + 4}`).format = { fill: cream, font: { name: "Source Sans 3", color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
sourceSheet.freezePanes.freezeRows(4);
setWidths(sourceSheet, { A: 24, B: 13, C: 13, D: 13, E: 18, F: 13, G: 28, H: 3, I: 38, J: 13, K: 13, L: 13, M: 13, N: 13, O: 28, P: 3, Q: 3, R: 3 });

title(trendSheet, "N", "FOUR-WEEK TREND", `${subtitle} | Available weeks only; missing source periods remain visible`);
trendSheet.getRange("A3:N4").merge();
trendSheet.getRange("A3").values = [["The first requested week is shown as unavailable because no governed weekly allocation export was found after refreshing the data catalogue. No result is estimated for that week."]];
trendSheet.getRange("A3:N4").format = { fill: cream, font: { name: "Source Sans 3", color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
const trendRows = payload.trend.map((row) => [`${row.week} to ${row.endDate}`, row.status, row.uncalled, row.missed, row.explainableNonCalls, row.uncertain]);
const trendTable = writeTable(trendSheet, 6, "A", ["Week", "Status", "Uncalled", "A/B missed", "Explainable non-calls", "Uncertain"], trendRows, { numberFormats: { 2: "#,##0", 3: "#,##0", 4: "#,##0", 5: "#,##0" } });
const availableTrend = payload.trend.filter((row) => row.status === "Available");
if (availableTrend.length > 0) {
  trendSheet.getRange(`H31:L${31 + availableTrend.length}`).values = [
    ["Week", "Uncalled", "A/B missed", "Explainable non-calls", "Uncertain"],
    ...availableTrend.map((row) => [`${row.week} to ${row.endDate}`, row.uncalled, row.missed, row.explainableNonCalls, row.uncertain]),
  ];
  const trendChart = trendSheet.charts.add("line", trendSheet.getRange(`H31:L${31 + availableTrend.length}`));
  trendChart.title = "Uncalled lead review trend";
  trendChart.hasLegend = true;
  trendChart.yAxis = { numberFormatCode: "#,##0", min: 0 };
  trendChart.xAxis = { axisType: "textAxis" };
  trendChart.setPosition("H6", "N21");
}
trendSheet.getRange("A24:N24").merge();
trendSheet.getRange("A24").values = [["Actions"]];
trendSheet.getRange("A24:N24").format = { fill: charcoal, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 10 } };
writeTable(trendSheet, 25, "A", ["Action", "Current reason"], actions);
trendSheet.getRange("B26:B29").format.wrapText = true;
trendSheet.freezePanes.freezeRows(4);
setWidths(trendSheet, { A: 28, B: 27, C: 14, D: 16, E: 22, F: 16, G: 3, H: 12, I: 12, J: 12, K: 12, L: 12, M: 12, N: 12 });

title(classifiedSheet, "Y", "CLASSIFIED UNCALLED LEADS", `${subtitle} | One row per unique uncalled allocation; filters are enabled`);
classifiedSheet.getRange("A3:Y4").merge();
classifiedSheet.getRange("A3").values = [["This is the complete auditable population. Classification uses the versioned deterministic rule shown in Method & QA. Low-confidence records should be manually checked before any operational decision."]];
classifiedSheet.getRange("A3:Y4").format = { fill: grey, font: { name: "Source Sans 3", color: darkGrey, size: 9 }, wrapText: true, verticalAlignment: "center" };
const classifiedHeaders = ["Lead Allocation Key", "Customer ID", "Business Name", "Manager", "Salesperson", "Owning Salesperson", "Lead Source", "Allocation Batch", "Allocation Date", "Allocation Time", "Day Received", "Time Band", "Primary Category", "Confidence", "Operational Group", "Suitability Score", "Suitability Rank", "Suitability Band", "Classification Basis", "Alternative Category Signal", "Quality / Allocation Flags", "Recommended Handling", "Best-fitting CWA Audience", "Suitability Rationale", "Evidence Note"];
const classifiedRows = payload.uncalledRows.map((row) => [
  row.allocationKey, row.customerId, row.businessName, row.manager, row.salesperson, row.owningSalesperson, row.leadSource, row.allocationName,
  new Date(`${row.allocationDate}T00:00:00Z`), row.allocationTime, row.dayReceived, row.timeBand, row.category, row.confidence,
  row.operationalGroup, row.suitabilityScore, row.suitabilityRank, row.suitabilityBand, row.classificationBasis, row.alternativeCategorySignal,
  row.qualityFlags, row.recommendedHandling, row.bestAudience, row.suitabilityRationale, row.evidenceNote,
]);
classifiedSheet.getRange(`A6:Y${dataEndRow}`).values = [classifiedHeaders, ...classifiedRows];
styleHeader(classifiedSheet.getRange("A6:Y6"));
styleBody(classifiedSheet.getRange(`A7:Y${dataEndRow}`));
classifiedSheet.getRange(`I7:I${dataEndRow}`).format.numberFormat = "yyyy-mm-dd";
classifiedSheet.getRange(`P7:Q${dataEndRow}`).format.numberFormat = "#,##0";
classifiedSheet.getRange(`S7:Y${dataEndRow}`).format.wrapText = true;
const evidenceTable = classifiedSheet.tables.add(`A6:Y${dataEndRow}`, true, "ClassifiedUncalledLeads");
evidenceTable.style = "TableStyleMedium2";
evidenceTable.showFilterButton = true;
classifiedSheet.freezePanes.freezeRows(6);
classifiedSheet.freezePanes.freezeColumns(3);
setWidths(classifiedSheet, { A: 18, B: 15, C: 30, D: 23, E: 24, F: 24, G: 17, H: 38, I: 14, J: 13, K: 14, L: 18, M: 28, N: 12, O: 31, P: 15, Q: 15, R: 23, S: 45, T: 28, U: 38, V: 42, W: 38, X: 48, Y: 52 });

title(methodSheet, "H", "SOURCES, METHOD AND QA", `${subtitle} | Plain-language definitions and validation`);
methodSheet.getRange("A4:H4").values = [["Item", "Result", "What it means", "Source / version", "", "", "", ""]];
styleHeader(methodSheet.getRange("A4:D4"));
const methodRows = [
  ["Uncalled rule", "No qualifying outbound call", "Same receiving salesperson, same exact CustomerID, after allocation and by Friday 11:59:59 pm.", "Weekly Lead Management rule"],
  ["Category rule", payload.ruleModel.schemaVersion, "Clear business-name keywords only; unclear records remain Other / uncertain.", payload.ruleModel.sha256],
  ["Exclusions", "Applied", payload.exclusions.display, payload.exclusions.policySha256],
  ["Allocation source", path.basename(payload.sourceReceipt.allocation.path), `${payload.sourceReceipt.allocation.rowCount.toLocaleString()} retained rows`, payload.sourceReceipt.allocation.sha256],
  ["Weekly call source", path.basename(payload.sourceReceipt.calls.path), `${payload.sourceReceipt.calls.rowCount.toLocaleString()} retained rows`, payload.sourceReceipt.calls.sha256],
  ["Primary call history", payload.sourceReceipt.primaryCalls ? path.basename(payload.sourceReceipt.primaryCalls.path) : "Not needed", payload.sourceReceipt.primaryCalls ? `Used to cover ${payload.sourceReceipt.primaryCalls.missingWeeklyCallDates.join(", ")}` : "Weekly call export covered every Monday-Friday date.", payload.sourceReceipt.primaryCalls?.sha256 || ""],
  ["Evidence cutoff", payload.reportingPeriod.cutoffLocal, "Saturday and later calls do not change this weekly result.", payload.reportingPeriod.timezone],
  ["Minimum comparison sample", payload.ruleModel.minimumComparisonSample, "Smaller salesperson or team samples remain visible but are marked Small sample.", "uncalled leads"],
];
methodSheet.getRange(`A5:D${4 + methodRows.length}`).values = methodRows;
styleBody(methodSheet.getRange(`A5:D${4 + methodRows.length}`));
methodSheet.getRange(`B5:D${4 + methodRows.length}`).format.wrapText = true;
const qaStart = 15;
const qaRows = payload.qaChecks.map((row) => [row.check, row.result]);
writeTable(methodSheet, qaStart, "A", ["QA check", "Result"], qaRows);
for (let index = 0; index < qaRows.length; index += 1) {
  const row = qaStart + 1 + index;
  methodSheet.getRange(`B${row}`).format = { fill: paleGreen, font: { name: "Source Sans 3", bold: true, color: green, size: 9 }, horizontalAlignment: "center" };
}
methodSheet.freezePanes.freezeRows(4);
setWidths(methodSheet, { A: 32, B: 30, C: 65, D: 55, E: 3, F: 3, G: 3, H: 3 });

const keyInspect = await workbook.inspect({ kind: "table", range: "Executive Review!A1:N23", include: "values,formulas", tableMaxRows: 23, tableMaxCols: 14, maxChars: 7000 });
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan", maxChars: 5000 });
const sheetInspect = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 5000 });
await fs.writeFile(path.join(outputDir, "workbook.inspect.ndjson"), `${sheetInspect.ndjson}\n${keyInspect.ndjson}\n${formulaErrors.ndjson}\n`);

const renderTargets = [
  ["Executive Review", "A1:N23", "executive-review.png"],
  ["Category & Suitability", `A1:S${Math.max(22, 7 + payload.categories.length)}`, "category-suitability.png"],
  ["Explainable Non-calls", `A1:M${Math.min(exampleRow, 55)}`, "explainable-noncalls.png"],
  ["Salespeople & Teams", `A1:P${Math.min(peopleStart + 14, peopleStart + payload.people.length)}`, "salespeople-teams.png"],
  ["Source Batch Timing", "A1:R31", "source-batch-timing.png"],
  ["Four-Week Trend", "A1:N29", "four-week-trend.png"],
  ["Classified Leads", "A1:Y18", "classified-leads.png"],
  ["Method & QA", `A1:H${qaStart + 1 + qaRows.length}`, "method-qa.png"],
];
for (const [sheetName, range, filename] of renderTargets) {
  const image = await workbook.render({ sheetName, range, scale: 1.1, format: "png" });
  await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await image.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

const qa = {
  generatedAt: new Date().toISOString(),
  workbookPath,
  reportingPeriod: payload.reportingPeriod,
  totals: payload.totals,
  qaChecks: payload.qaChecks,
  formulaErrorMatches: (formulaErrors.ndjson.match(/"kind":"match"/g) || []).length,
  sheets: ["Executive Review", "Category & Suitability", "Explainable Non-calls", "Salespeople & Teams", "Source Batch Timing", "Four-Week Trend", "Classified Leads", "Method & QA"],
  renderedSheets: renderTargets.map(([sheetName]) => sheetName),
};
await fs.writeFile(qaPath, `${JSON.stringify(qa, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: "complete", workbookPath, dataPath, qaPath, totals: payload.totals }, null, 2)}\n`);
