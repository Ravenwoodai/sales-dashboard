import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const performance = require("../src/performanceCohorts");
const { configurePersonnelExclusions, isExcludedPersonnel } = require("../src/personnelExclusions");
const {
  buildLeadResultDashboardModel,
  makeLeadResultSnapshot,
  resolvePreviousLeadResultSnapshot
} = require("../src/leadResultDashboard");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLORS = {
  navy: "#173A55",
  blue: "#2878A6",
  teal: "#2A9D8F",
  teamDark: "#0F5F5A",
  teamTeal: "#0F766E",
  paleBlue: "#EAF4F8",
  paleTeal: "#E8F6F3",
  paleAmber: "#FFF4CE",
  paleRed: "#FCE8E6",
  paleGrey: "#F4F7F9",
  white: "#FFFFFF",
  ink: "#17324D",
  muted: "#5F6B76",
  border: "#D6E0E6"
};

function argsFrom(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalizePerson(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isoToDisplay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function writeMatrix(sheet, startRow, startCol, matrix) {
  if (!matrix.length || !matrix[0].length) return null;
  const range = sheet.getRangeByIndexes(startRow, startCol, matrix.length, matrix[0].length);
  range.values = matrix;
  return range;
}

function titleBand(sheet, range, text, size = 18) {
  const target = sheet.getRange(range);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white, size },
    verticalAlignment: "center"
  };
}

function sectionBand(sheet, range, text, fill = COLORS.blue) {
  const target = sheet.getRange(range);
  target.merge();
  target.values = [[text]];
  target.format = {
    fill,
    font: { bold: true, color: COLORS.white, size: 11 },
    verticalAlignment: "center"
  };
}

function styleHeader(range, fill = COLORS.navy) {
  range.format = {
    fill,
    font: { bold: true, color: COLORS.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { color: COLORS.white, style: "thin" }
  };
}

function styleBody(range, fill = null) {
  const format = {
    font: { color: COLORS.ink },
    borders: { color: COLORS.border, style: "thin" },
    verticalAlignment: "center"
  };
  if (fill) format.fill = fill;
  range.format = format;
}

function addChartCallouts(sheet, howRange, knowRange, guidance) {
  const how = sheet.getRange(howRange);
  how.merge();
  how.values = [[`How to read\n${guidance.howToRead}`]];
  how.format = {
    fill: COLORS.paleBlue,
    font: { color: COLORS.ink },
    wrapText: true,
    verticalAlignment: "top",
    borders: { color: COLORS.border, style: "thin" }
  };
  const know = sheet.getRange(knowRange);
  know.merge();
  know.values = [[`What this chart shows\n${guidance.whatItShows}\n\nWhat to know\n${guidance.whatToKnow}`]];
  know.format = {
    fill: COLORS.paleAmber,
    font: { color: "#6B4A10" },
    wrapText: true,
    verticalAlignment: "top",
    borders: { color: COLORS.border, style: "thin" }
  };
}

function setColumnWidths(sheet, widths) {
  widths.forEach(([range, width]) => { sheet.getRange(range).format.columnWidth = width; });
}

function addKpi(sheet, labelRange, valueRange, label, formula, fill, numberFormat = "#,##0") {
  const l = sheet.getRange(labelRange);
  l.merge();
  l.values = [[label]];
  l.format = { fill: COLORS.navy, font: { bold: true, color: COLORS.white }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  const v = sheet.getRange(valueRange);
  v.merge();
  v.formulas = [[formula]];
  v.format = { fill, font: { bold: true, color: COLORS.ink, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", numberFormat };
}

function addDashboardPanel(sheet, {
  row,
  col,
  title,
  headers,
  rows,
  fill = COLORS.paleBlue,
  titleFill = COLORS.blue,
  headerFill = COLORS.navy
}) {
  const spans = [2, 2, 3];
  const titleRange = sheet.getRangeByIndexes(row - 1, col - 1, 1, spans.reduce((sum, value) => sum + value, 0));
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = { fill: titleFill, font: { bold: true, color: COLORS.white }, verticalAlignment: "center" };
  [headers, ...rows].forEach((values, index) => {
    let offset = 0;
    values.forEach((value, valueIndex) => {
      const target = sheet.getRangeByIndexes(row + index, col - 1 + offset, 1, spans[valueIndex]);
      target.merge();
      target.values = [[value]];
      target.format = index === 0
        ? { fill: headerFill, font: { bold: true, color: COLORS.white }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { color: COLORS.white, style: "thin" } }
        : { fill, font: { color: COLORS.ink }, verticalAlignment: "top", wrapText: true, borders: { color: COLORS.border, style: "thin" } };
      offset += spans[valueIndex];
    });
  });
  return row + rows.length + 1;
}

function loadReport(selection = {}) {
  const config = performance.resolvePerformanceConfig();
  const storedCarmaConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "store", "carma-evidence.json"), "utf8"));
  const carmaConfig = {
    ...storedCarmaConfig,
    databasePath: selection.databasePath
      ? path.resolve(selection.databasePath)
      : storedCarmaConfig.databasePath,
  };
  const context = performance.loadPerformanceSourceContext({ config, databasePath: carmaConfig.databasePath });
  const report = performance.buildPerformanceCohortsFromContext(context, {
    startDate: selection.start || config.startDate,
    endDate: selection.end || config.endDate
  });
  if (!report.available) throw new Error(report.error || "Performance report sources are unavailable.");
  if (report.dataQuality?.approvedSalesCoverageStatus !== "verified") {
    throw new Error(`Approved-sales coverage is not reconciled for ${report.period.label}. The Lead Result Dashboard was not generated because zero or partial sales would be misleading.`);
  }
  return { config, carmaConfig, context, report };
}

function buildModel({ config, carmaConfig, report, previousSnapshot, previousSnapshotSource = "" }) {
  return buildLeadResultDashboardModel({
    config,
    carmaConfig,
    report,
    previousSnapshot,
    previousSnapshotSource
  });
}

async function resolvePreviousSnapshot(args, currentStartDate) {
  return resolvePreviousLeadResultSnapshot({
    rootPath: ROOT,
    currentStartDate,
    explicitSnapshotPath: args["previous-snapshot"] || ""
  });
}

function buildWorkbook(model) {
  const { report } = model;
  const classifiedSales = model.companySales.length + model.selfSales.length;
  const approvedSales = report.totals.approvedSalesInPeriod;
  const sourceCoverage = approvedSales ? classifiedSales / approvedSales : 1;
  const unresolvedShare = approvedSales ? model.withheldSales.length / approvedSales : 0;
  const allocatedLeadShare = classifiedSales ? model.companySales.length / classifiedSales : 0;
  const allocatedLeadShareLowerBound = approvedSales ? model.companySales.length / approvedSales : 0;
  const allocatedLeadShareUpperBound = approvedSales ? (model.companySales.length + model.withheldSales.length) / approvedSales : 0;
  const sourceStatus = model.withheldSales.length === 0 ? "Complete" : unresolvedShare < 0.03 ? "High coverage" : "Provisional";
  const wb = Workbook.create();
  const dashboard = wb.worksheets.add("Dashboard");
  const rankings = wb.worksheets.add("Performance Rankings");
  const trophiesSheet = wb.worksheets.add("Performance & Trophies");
  const leadBurnersSheet = wb.worksheets.add("Lead Burners");
  const managerSheet = wb.worksheets.add("Manager Analysis");
  const distributionSheet = wb.worksheets.add("Lead Distribution");
  const callSheet = wb.worksheets.add("Call Coverage");
  const salesSheet = wb.worksheets.add("Approved Sales");
  const evidenceSheet = wb.worksheets.add("Sent Lead Evidence");
  const checksSheet = wb.worksheets.add("Checks");
  const notesSheet = wb.worksheets.add("Data Notes");
  const dataSheet = wb.worksheets.add("Report Data");

  const summaryRows = [
    ["Metric", "Value"],
    ["Period start", report.period.startDate],
    ["Period end", report.period.endDate],
    ["Total Sent Leads", report.totals.deduplicatedSentEvents],
    ["Unique Leads Sent", report.totals.uniqueCustomerRecipientPairs],
    ["Distinct Customers", report.totals.uniqueCustomers],
    ["Approved Sales", report.totals.approvedSalesInPeriod],
    ["Approved Sales Value", model.salesValue],
    ["Salesperson-label-matched sales", report.totals.approvedSalesWithRecipientLabelMatch],
    ["Matched sales value", report.totals.approvedSalesValueWithRecipientLabelMatch],
    ["Off-roster approved sales", model.offRoster.length],
    ["Off-roster approved value", model.offRoster.reduce((sum, row) => sum + row.approvedValue, 0)],
    ["Off-roster Sales From Allocated Leads", model.offRoster.filter((row) => row.leadSourceClassification === "Company Sourced").length],
    ["Off-roster Self Sourced", model.offRoster.filter((row) => row.leadSourceClassification === "Self Sourced").length],
    ["Sales From Allocated Leads", model.companySales.length],
    ["Self Sourced sales", model.selfSales.length],
    ["Confirmed exact call pairs", report.dataQuality.observedCalledPairs],
    ["Call coverage complete", report.dataQuality.callCoverageComplete],
    ["Included raw allocation rows", report.totals.rawAllocationRows],
    ["Logical duplicate rows removed", report.totals.logicalDuplicateRows],
    ["Same-recipient repeat sends", report.leadAnalytics.usage.repeatSentEventsSameRecipient],
    ["Cross-salesperson extra assignments", report.leadAnalytics.usage.crossRecipientAssignments],
    ["Salespeople Receiving Leads", model.managerRows.reduce((sum, row) => sum + row.activeSalespeople, 0)],
    ["Equal-share material band", 0.25],
    ["Previous comparison period start", model.previousSnapshot?.period?.startDate || ""],
    ["Previous comparison period end", model.previousSnapshot?.period?.endDate || ""],
    ["Source attribution exceptions", model.withheldSales.length],
    ["Classified Approved Sales", classifiedSales],
    ["Source attribution coverage", sourceCoverage],
    ["Sales From Allocated Leads % lower bound", allocatedLeadShareLowerBound],
    ["Sales From Allocated Leads % upper bound", allocatedLeadShareUpperBound],
    ["Source attribution status", sourceStatus],
    [report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff", report.dataQuality.noExactCallObservedPairs],
    ["Weekly Calls", report.dataQuality.weeklyCallsInPeriod],
    ["Short-call threshold seconds", report.dataQuality.shortCallSeconds],
    ["Long-call threshold seconds", report.dataQuality.longCallSeconds],
    ["Unlinked self-sourcing call attempts", report.dataQuality.unlinkedSelfSourcingCallAttempts],
    ["Blocking call identity issues", report.dataQuality.missingCallJoinKeys],
    ["Generated at", model.generatedAt]
  ];
  const withheldSummaryRow = summaryRows.findIndex((row) => row[0] === "Source attribution exceptions") + 1;
  const sourceCoverageSummaryRow = summaryRows.findIndex((row) => row[0] === "Source attribution coverage") + 1;
  const lowerBoundSummaryRow = summaryRows.findIndex((row) => row[0] === "Sales From Allocated Leads % lower bound") + 1;
  const upperBoundSummaryRow = summaryRows.findIndex((row) => row[0] === "Sales From Allocated Leads % upper bound") + 1;
  const noExactCallSummaryRow = summaryRows.findIndex((row) => /Leads Uncalled|No Recorded Call/.test(row[0])) + 1;
  writeMatrix(dataSheet, 0, 0, summaryRows);
  styleHeader(dataSheet.getRange("A1:B1"));
  styleBody(dataSheet.getRange(`A2:B${summaryRows.length}`));
  dataSheet.getRange("B8:B16").format.numberFormat = "#,##0.00";
  dataSheet.getRange("B24").format.numberFormat = "0%";
  dataSheet.getRange(`B${sourceCoverageSummaryRow}:B${upperBoundSummaryRow}`).format.numberFormat = "0.0%";
  setColumnWidths(dataSheet, [["A:A", 37], ["B:B", 22]]);

  const managerStart = summaryRows.length + 1;
  const managerMatrix = [["Manager", "Salespeople Receiving Leads", "Weekly Sent Leads", "Sent Leads per Recipient", "Unique Leads Sent", "Reallocations", "Approved Sales", "Sales Value", "Sales From Allocated Leads", "Sales From Allocated Leads % of Classified Sales", "Weekly Lead Share", "Sales From Allocated Leads Share", "Sample", "Exact Calls Observed", report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff"]];
  model.managerRows.forEach((row) => managerMatrix.push([
    row.manager,
    row.activeSalespeople,
    row.sent,
    null,
    row.unique,
    row.reallocations,
    row.sales,
    row.value,
    row.allocatedLeadSales,
    null,
    null,
    null,
    `${row.sourceAttributionStatusLabel}${row.withheld ? ` - ${(row.sourceCoverage * 100).toFixed(1)}% classified - possible range ${(row.allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(row.allocatedLeadShareUpperBound * 100).toFixed(1)}%` : ""}${row.lowSample || row.sales < 5 ? " - low sample" : " - full sample"}`,
    row.exactCallsObserved,
    null
  ]));
  writeMatrix(dataSheet, managerStart, 0, managerMatrix);
  const managerFirstData = managerStart + 2;
  const managerLastData = managerStart + managerMatrix.length;
  for (let row = managerFirstData; row <= managerLastData; row += 1) {
    dataSheet.getRange(`D${row}`).formulas = [[`=IFERROR(C${row}/B${row},0)`]];
    const manager = model.managerRows[row - managerFirstData];
    dataSheet.getRange(`J${row}`).values = [[manager.allocatedLeadShare]];
    dataSheet.getRange(`K${row}`).formulas = [[`=IFERROR(C${row}/SUM($C$${managerFirstData}:$C$${managerLastData}),0)`]];
    dataSheet.getRange(`L${row}`).values = [[manager.allocatedSalesShare]];
    dataSheet.getRange(`O${row}`).formulas = [[`=MAX(E${row}-N${row},0)`]];
  }
  styleHeader(dataSheet.getRange(`A${managerStart + 1}:O${managerStart + 1}`));
  styleBody(dataSheet.getRange(`A${managerFirstData}:O${managerLastData}`));
  dataSheet.getRange(`D${managerFirstData}:D${managerLastData}`).format.numberFormat = "0.0";
  dataSheet.getRange(`H${managerFirstData}:H${managerLastData}`).format.numberFormat = "$#,##0.00";
  dataSheet.getRange(`J${managerFirstData}:L${managerLastData}`).format.numberFormat = "0.0%";

  const comparableManagerRows = model.managerRows.filter((row) => row.sourceShareComparable);
  const reversedEfficiencyRows = [...comparableManagerRows].reverse();
  dataSheet.getRange("N1:O1").values = [["Manager", "Sales From Allocated Leads % of Classified Sales"]];
  reversedEfficiencyRows.forEach((manager, index) => {
    const sourceRow = managerFirstData + model.managerRows.findIndex((row) => row.manager === manager.manager);
    dataSheet.getRange(`N${index + 2}:O${index + 2}`).formulas = [[`=A${sourceRow}`, `=J${sourceRow}`]];
  });
  dataSheet.getRange("N11:P11").values = [["Manager", "Weekly Lead Share", "Sales From Allocated Leads Share"]];
  reversedEfficiencyRows.forEach((manager, index) => {
    const sourceRow = managerFirstData + model.managerRows.findIndex((row) => row.manager === manager.manager);
    dataSheet.getRange(`N${index + 12}:P${index + 12}`).formulas = [[`=A${sourceRow}`, `=K${sourceRow}`, `=L${sourceRow}`]];
  });
  const activeManagerRows = [...model.managerRows].sort((a, b) => b.leadsPerActiveSalesperson - a.leadsPerActiveSalesperson || a.manager.localeCompare(b.manager));
  dataSheet.getRange("N21:P21").values = [["Manager", "Sent Leads per Salesperson Receiving Leads", "Weighted Company Average"]];
  [...activeManagerRows].reverse().forEach((manager, index) => {
    const sourceRow = managerFirstData + model.managerRows.findIndex((row) => row.manager === manager.manager);
    dataSheet.getRange(`N${index + 22}:P${index + 22}`).values = [[manager.manager, manager.leadsPerActiveSalesperson, manager.companyObservedPerRecipientAverage]];
  });
  styleHeader(dataSheet.getRange("N1:O1"));
  styleHeader(dataSheet.getRange("N11:P11"));
  styleHeader(dataSheet.getRange("N21:P21"));
  dataSheet.getRange(`O2:O${1 + comparableManagerRows.length}`).format.numberFormat = "0.0%";
  dataSheet.getRange(`O12:P${11 + comparableManagerRows.length}`).format.numberFormat = "0.0%";
  dataSheet.getRange(`O22:P${21 + model.managerRows.length}`).format.numberFormat = "0.0";

  const callBacklogManagerRows = [...model.managerRows].sort((a, b) => b.noExactCallObserved - a.noExactCallObserved || b.unique - a.unique || a.manager.localeCompare(b.manager));
  dataSheet.getRange("Q31:S31").values = [["Manager", "Unique Leads Sent", report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff"]];
  [...callBacklogManagerRows].reverse().forEach((manager, index) => {
    const sourceRow = managerFirstData + model.managerRows.findIndex((row) => row.manager === manager.manager);
    dataSheet.getRange(`Q${index + 32}:S${index + 32}`).formulas = [[`=A${sourceRow}`, `=E${sourceRow}`, `=O${sourceRow}`]];
  });
  styleHeader(dataSheet.getRange("Q31:S31"));

  const personCallHelperStart = 41;
  dataSheet.getRange(`Q${personCallHelperStart}:T${personCallHelperStart}`).values = [["Salesperson", "Unique Leads Sent", "Exact Calls Observed", report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff"]];
  model.salespersonRows.forEach((row, index) => {
    const helperRow = personCallHelperStart + 1 + index;
    dataSheet.getRange(`Q${helperRow}:S${helperRow}`).values = [[row.salesperson, row.uniqueCustomers, row.exactCallsObserved]];
    dataSheet.getRange(`T${helperRow}`).formulas = [[`=MAX(R${helperRow}-S${helperRow},0)`]];
  });
  styleHeader(dataSheet.getRange(`Q${personCallHelperStart}:T${personCallHelperStart}`));
  styleBody(dataSheet.getRange(`Q${personCallHelperStart + 1}:T${personCallHelperStart + model.salespersonRows.length}`));

  const dailyStart = managerLastData + 3;
  const dailyMatrix = [["Date", "Sent Leads"], ...(report.leadAnalytics.dailyAllocations || []).map((row) => [row.date, row.sentAllocationEvents])];
  writeMatrix(dataSheet, dailyStart - 1, 0, dailyMatrix);
  styleHeader(dataSheet.getRange(`A${dailyStart}:B${dailyStart}`));
  styleBody(dataSheet.getRange(`A${dailyStart + 1}:B${dailyStart + dailyMatrix.length - 1}`));

  titleBand(dashboard, "A1:N2", "LEAD RESULT DASHBOARD", 20);
  dashboard.getRange("A3:N3").merge();
  dashboard.getRange("A3:N3").values = [[`${isoToDisplay(report.period.startDate)} to ${isoToDisplay(report.period.endDate)}`]];
  dashboard.getRange("A3:N3").format = { fill: COLORS.paleBlue, font: { bold: true, color: COLORS.ink }, verticalAlignment: "center" };
  dashboard.getRange("A4:N5").merge();
  dashboard.getRange("A4:N5").values = [[`Allocation events are available for ${(report.dataQuality.allocationDates || []).map(isoToDisplay).join(", ")}. Sales From Allocated Leads require the exact customer, exact seller and an allocation before an explicit approval timestamp, with no allocation-age limit. Sales From Allocated Leads represent ${(allocatedLeadShare * 100).toFixed(1)}% of ${classifiedSales} classified Approved Sales; ${(sourceCoverage * 100).toFixed(1)}% of ${approvedSales} Approved Sales are classified. ${model.withheldSales.length ? `${model.withheldSales.length} unresolved sale${model.withheldSales.length === 1 ? " creates" : "s create"} a possible range of ${(allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(allocatedLeadShareUpperBound * 100).toFixed(1)}%; status is ${sourceStatus}. Unknown orders remain withheld, never guessed. ` : ""}This is not conversion of this week's Sent Leads. ${report.dataQuality.callCoverageComplete ? "The governed weekday call gate is complete, so Leads Uncalled is limited to the reporting window and utilisation may be scored." : "Call coverage is incomplete, so utilisation is not scored; Allocated Leads With No Recorded Call remains a review backlog, not proof that no call occurred."}`]];
  dashboard.getRange("A4:N5").format = { fill: COLORS.paleAmber, font: { italic: true, color: "#7A5312" }, wrapText: true, verticalAlignment: "center" };
  addKpi(dashboard, "A7:C7", "A8:C10", "Total Sent Leads", "='Report Data'!B4", COLORS.paleBlue);
  addKpi(dashboard, "D7:F7", "D8:F10", "Unique Leads Sent", "='Report Data'!B5", COLORS.paleTeal);
  addKpi(dashboard, "G7:I7", "G8:I10", "Approved Sales", "='Report Data'!B7", COLORS.paleTeal);
  addKpi(dashboard, "J7:N7", "J8:N10", "Approved Sales Value", "='Report Data'!B8", COLORS.paleBlue, "$#,##0.00");
  addKpi(dashboard, "A12:C12", "A13:C15", `Sales From Allocated Leads % of Classified Sales (${(sourceCoverage * 100).toFixed(1)}% coverage)`, `=IFERROR('Report Data'!B15/('Report Data'!B15+'Report Data'!B16),0)`, COLORS.paleBlue, "0.0%");
  addKpi(dashboard, "D12:F12", "D13:F15", "Sales From Allocated Leads", "='Report Data'!B15", COLORS.paleTeal);
  addKpi(dashboard, "G12:I12", "G13:I15", "Self Sourced sales", "='Report Data'!B16", COLORS.paleAmber);
  addKpi(dashboard, "J12:N12", "J13:N15", "Salespeople Receiving Leads", "='Report Data'!B23", COLORS.paleBlue);

  sectionBand(dashboard, "A17:N17", "What the numbers mean");
  const expl = [
    ["Sent Leads", "Every deduplicated allocation sent during the week. A later reallocation is another sent lead because it created another salesperson workload event."],
    ["Unique Leads Sent", "One customer + one receiving salesperson. If the same customer was sent twice to the same salesperson, it counts once here; if sent to two salespeople, it counts twice."],
    ["Approved Sales", "All approved orders in the selected week after the configured personnel exclusions. The sale may relate to a lead sent earlier than this week."],
    ["Company supplied / Self", "Sales From Allocated Leads require exact customer-and-seller allocation evidence before an explicit approval timestamp. Self Sourced requires complete evidence showing no qualifying exact seller-customer allocation. Incomplete timestamp or allocation-history evidence is withheld rather than guessed."],
    ["Sales From Allocated Leads %", "Sales From Allocated Leads divided by classified Approved Sales for the same salesperson or team. Coverage and a possible lower-to-upper range disclose unresolved attribution. Under 3% unresolved remains comparable; 3% or more is provisional and excluded from source-share awards. It does not divide sales by this week's Sent Leads."],
    ["Off-roster reconciliation", `${model.offRoster.length} approved sales ($${model.offRoster.reduce((sum, row) => sum + row.approvedValue, 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}) are included in the complete total but not named manager comparisons.`]
  ];
  dashboard.getRange("A18:C23").merge(true);
  dashboard.getRange("D18:N23").merge(true);
  expl.forEach(([label, explanation], index) => {
    const row = 18 + index;
    dashboard.getRange(`A${row}`).values = [[label]];
    dashboard.getRange(`D${row}`).values = [[explanation]];
  });
  dashboard.getRange("A18:C23").format = { fill: COLORS.paleBlue, font: { bold: true, color: COLORS.ink }, borders: { color: COLORS.border, style: "thin" }, verticalAlignment: "center" };
  dashboard.getRange("D18:N23").format = { font: { color: COLORS.ink }, borders: { color: COLORS.border, style: "thin" }, wrapText: true, verticalAlignment: "center" };

  sectionBand(dashboard, "A24:N24", "Manager Sales From Allocated Leads % of Classified Sales");
  const dashManagerHeaders = [["Manager", "Weekly Sent Leads", "Approved Sales", "Sales From Allocated Leads", "Sales From Allocated Leads %", "Sample"]];
  writeMatrix(dashboard, 24, 0, dashManagerHeaders);
  styleHeader(dashboard.getRange("A25:F25"));
  model.managerRows.forEach((row, index) => {
    const sourceRow = managerFirstData + index;
    const targetRow = 26 + index;
    dashboard.getRange(`A${targetRow}:F${targetRow}`).formulas = [[
      `='Report Data'!A${sourceRow}`,
      `='Report Data'!C${sourceRow}`,
      `='Report Data'!G${sourceRow}`,
      `='Report Data'!I${sourceRow}`,
      `='Report Data'!J${sourceRow}`,
      `='Report Data'!M${sourceRow}`
    ]];
  });
  const dashManagerLast = 25 + model.managerRows.length;
  styleBody(dashboard.getRange(`A26:F${dashManagerLast}`));
  dashboard.getRange(`E26:E${dashManagerLast}`).format.numberFormat = "0.0%";
  const efficiencyChart = dashboard.charts.add("bar", { title: "Sales From Allocated Leads % of Classified Sales by Manager", hasLegend: false });
  const efficiencySeries = efficiencyChart.series.add("Sales From Allocated Leads %");
  efficiencySeries.categoryFormula = `'Report Data'!$N$2:$N$${1 + comparableManagerRows.length}`;
  efficiencySeries.formula = `'Report Data'!$O$2:$O$${1 + comparableManagerRows.length}`;
  efficiencySeries.fill = COLORS.blue;
  efficiencyChart.yAxis = { numberFormatCode: "0%" };
  efficiencyChart.setPosition("G25", "N36");
  addChartCallouts(dashboard, "A37:F44", "G37:N44", model.chartGuidance.efficiency);

  sectionBand(dashboard, "A46:N46", "Weekly lead share compared with Sales From Allocated Leads share");
  dashboard.getRange("A47:C47").values = [["Manager", "Weekly Lead Share", "Sales From Allocated Leads Share"]];
  styleHeader(dashboard.getRange("A47:C47"));
  model.managerRows.forEach((row, index) => {
    const sourceRow = managerFirstData + index;
    const targetRow = 48 + index;
    dashboard.getRange(`A${targetRow}:C${targetRow}`).formulas = [[`='Report Data'!A${sourceRow}`, `='Report Data'!K${sourceRow}`, `='Report Data'!L${sourceRow}`]];
  });
  const shareLast = 47 + model.managerRows.length;
  styleBody(dashboard.getRange(`A48:C${shareLast}`));
  dashboard.getRange(`B48:C${shareLast}`).format.numberFormat = "0.0%";
  const shareChart = dashboard.charts.add("bar", { title: "Weekly Lead Share vs Sales From Allocated Leads Share", hasLegend: true });
  const leadShareSeries = shareChart.series.add("Weekly Lead Share");
  leadShareSeries.categoryFormula = `'Report Data'!$N$12:$N$${11 + comparableManagerRows.length}`;
  leadShareSeries.formula = `'Report Data'!$O$12:$O$${11 + comparableManagerRows.length}`;
  leadShareSeries.fill = COLORS.blue;
  const salesShareSeries = shareChart.series.add("Sales From Allocated Leads Share");
  salesShareSeries.categoryFormula = leadShareSeries.categoryFormula;
  salesShareSeries.formula = `'Report Data'!$P$12:$P$${11 + comparableManagerRows.length}`;
  salesShareSeries.fill = COLORS.teal;
  shareChart.yAxis = { numberFormatCode: "0%" };
  shareChart.setPosition("G47", "N58");
  addChartCallouts(dashboard, "A59:F66", "G59:N66", model.chartGuidance.shares);

  sectionBand(dashboard, "A68:N68", "Sent Leads per Salesperson Receiving Leads by Manager");
  dashboard.getRange("A69:E69").values = [["Manager", "Salespeople Receiving Leads", "Sent Leads", "Sent Leads per Recipient", "Weighted Company Average"]];
  styleHeader(dashboard.getRange("A69:E69"));
  activeManagerRows.forEach((row, index) => {
    const targetRow = 70 + index;
    dashboard.getRange(`A${targetRow}:E${targetRow}`).values = [[
      row.manager,
      row.activeSalespeople,
      row.sent,
      row.leadsPerActiveSalesperson,
      row.companyObservedPerRecipientAverage
    ]];
  });
  const activeLast = 69 + activeManagerRows.length;
  styleBody(dashboard.getRange(`A70:E${activeLast}`));
  dashboard.getRange(`D70:E${activeLast}`).format.numberFormat = "0.0";
  const activeChart = dashboard.charts.add("bar", { title: "Sent Leads per Salesperson Receiving Leads", hasLegend: true });
  const activeSeries = activeChart.series.add("Team per-recipient load");
  activeSeries.categoryFormula = `'Report Data'!$N$22:$N$${21 + model.managerRows.length}`;
  activeSeries.formula = `'Report Data'!$O$22:$O$${21 + model.managerRows.length}`;
  activeSeries.fill = COLORS.teal;
  const activeBaselineSeries = activeChart.series.add("Weighted company average");
  activeBaselineSeries.categoryFormula = activeSeries.categoryFormula;
  activeBaselineSeries.formula = `'Report Data'!$P$22:$P$${21 + model.managerRows.length}`;
  activeBaselineSeries.fill = COLORS.paleAmber;
  activeChart.yAxis = { numberFormatCode: "#,##0" };
  activeChart.setPosition("G69", "N80");
  addChartCallouts(dashboard, "A81:F92", "G81:N92", model.chartGuidance.active);

  const uncalledLabel = report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff";
  sectionBand(dashboard, "A94:N94", `${uncalledLabel} by Team`, COLORS.teamTeal);
  dashboard.getRange("A95:C95").values = [["Manager", "Unique Leads Sent", uncalledLabel]];
  styleHeader(dashboard.getRange("A95:C95"), COLORS.teamDark);
  callBacklogManagerRows.forEach((row, index) => {
    const sourceRow = managerFirstData + model.managerRows.findIndex((manager) => manager.manager === row.manager);
    const targetRow = 96 + index;
    dashboard.getRange(`A${targetRow}:C${targetRow}`).formulas = [[
      `='Report Data'!A${sourceRow}`,
      `='Report Data'!E${sourceRow}`,
      `='Report Data'!O${sourceRow}`
    ]];
  });
  const callBacklogLast = 95 + callBacklogManagerRows.length;
  styleBody(dashboard.getRange(`A96:C${callBacklogLast}`), COLORS.paleTeal);
  const callBacklogChart = dashboard.charts.add("bar", { title: `${uncalledLabel} by Team`, hasLegend: false });
  const callBacklogSeries = callBacklogChart.series.add(uncalledLabel);
  callBacklogSeries.categoryFormula = `'Report Data'!$Q$32:$Q$${31 + model.managerRows.length}`;
  callBacklogSeries.formula = `'Report Data'!$S$32:$S$${31 + model.managerRows.length}`;
  callBacklogSeries.fill = COLORS.teamTeal;
  callBacklogChart.yAxis = { numberFormatCode: "#,##0" };
  callBacklogChart.setPosition("G95", "N106");
  addChartCallouts(dashboard, "A107:F116", "G107:N116", model.chartGuidance.callBacklog);

  const attentionPeoplePanel = model.performanceViews.salespeopleResultsWorthyOfInvestigation.map((row) => [
    row.displayName,
    `${row.allocatedLeadSales} of ${row.classifiedSales} classified | ${(row.allocatedLeadShare * 100).toFixed(1)}%`,
    (row.concerns?.length ? row.concerns : ["Review the selected-period source context before action."]).join("\n")
  ]);
  const attentionTeamPanel = model.performanceViews.teamResultsWorthyOfInvestigation.map((row) => [
    row.displayName,
    `${row.allocatedLeadSales} of ${row.classifiedSales} classified | ${(row.allocatedLeadShare * 100).toFixed(1)}%`,
    row.concerns.join("\n")
  ]);
  const leadBurnersResultPanel = model.performanceViews.leadBurnersByResult.map((row) => [
    row.displayName,
    `${row.sent} Sent Leads`,
    `${(row.allocatedLeadShare * 100).toFixed(1)}% of classified sales from allocated leads\n${(row.concerns?.length ? row.concerns : ["Investigate workload and source context before action."]).join("\n")}`
  ]);
  const leadBurnersUncalledPanel = model.performanceViews.leadBurnersByUncalled.map((row) => [
    row.displayName,
    `${(row.uncalledRate * 100).toFixed(1)}%`,
    `${row.noExactCallObserved} of ${row.unique} allocated pairs uncalled within the governed reporting window`
  ]);
  const individualTrophyPanel = model.performanceViews.salespersonTrophies.map((row) => [row.trophy.replace(" — Salesperson", ""), row.candidate, row.metric]);
  const teamTrophyPanel = model.performanceViews.teamTrophies.map((row) => [row.trophy.replace(" — Team", ""), row.candidate, row.metric]);
  let dashboardPanelRow = 118;
  const personInvestigationEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 1, title: "Salesperson Results Worthy of Investigation", headers: ["Salesperson", "Company-supplied result", "Full investigation reasons"], rows: attentionPeoplePanel, fill: COLORS.paleAmber });
  const teamInvestigationEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 8, title: "Team Results Worthy of Investigation", headers: ["Manager team", "Company-supplied result", "Full investigation reasons"], rows: attentionTeamPanel, fill: COLORS.paleTeal, titleFill: COLORS.teamTeal, headerFill: COLORS.teamDark });
  dashboardPanelRow = Math.max(personInvestigationEnd, teamInvestigationEnd) + 1;
  const resultBurnerEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 1, title: "Lead Burners — High Allocation / Weak Company-Supplied Sales Mix", headers: ["Salesperson", "Weekly allocation", "Investigation context"], rows: leadBurnersResultPanel, fill: COLORS.paleAmber });
  const uncalledBurnerEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 8, title: "Lead Burners — Highest Uncalled %", headers: ["Salesperson", "Uncalled %", "Reporting-window evidence"], rows: leadBurnersUncalledPanel, fill: COLORS.paleTeal, titleFill: COLORS.teamTeal, headerFill: COLORS.teamDark });
  dashboardPanelRow = Math.max(resultBurnerEnd, uncalledBurnerEnd) + 1;
  const individualTrophyEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 1, title: "Individual Trophy Candidates", headers: ["Trophy", "Candidate", "Result"], rows: individualTrophyPanel, fill: COLORS.paleBlue });
  const teamTrophyEnd = addDashboardPanel(dashboard, { row: dashboardPanelRow, col: 8, title: "Team Trophy Candidates", headers: ["Trophy", "Candidate", "Result"], rows: teamTrophyPanel, fill: COLORS.paleTeal, titleFill: COLORS.teamTeal, headerFill: COLORS.teamDark });
  const dashboardNoteRow = Math.max(individualTrophyEnd, teamTrophyEnd) + 1;
  dashboard.getRange(`A${dashboardNoteRow}:N${dashboardNoteRow + 2}`).merge();
  dashboard.getRange(`A${dashboardNoteRow}:N${dashboardNoteRow + 2}`).values = [[`Colour key: blue panels show individual salesperson results; teal panels show manager-team results. Sales From Allocated Leads % = Sales From Allocated Leads ÷ classified Approved Sales; coverage and the possible range disclose unresolved attribution. Under 3% unresolved remains comparable; 3% or more is provisional. Allocations may be from any earlier date. Share candidates require at least 100 weekly Sent Leads and 5 Approved Sales. Lead Utilisation and Consistency require 12+ Approved Sales, and Versatility requires both sources plus 12+ classified sales. ${report.dataQuality.callCoverageComplete ? "Leads Uncalled is limited to the governed reporting window." : "Allocated Leads With No Recorded Call is a review backlog, not proof no call occurred."} Awards and investigation flags are evidence prompts, not disciplinary decisions.`]];
  dashboard.getRange(`A${dashboardNoteRow}:N${dashboardNoteRow + 2}`).format = { fill: COLORS.paleGrey, font: { italic: true, color: COLORS.muted }, wrapText: true, verticalAlignment: "center", borders: { color: COLORS.border, style: "thin" } };
  dashboard.freezePanes.freezeRows(5);
  dashboard.getRange(`1:${dashboardNoteRow + 2}`).format.rowHeight = 18;
  dashboard.getRange("1:2").format.rowHeight = 28;
  dashboard.getRange("4:5").format.rowHeight = 25;
  dashboard.getRange("18:20").format.rowHeight = 24;
  dashboard.getRange("21:21").format.rowHeight = 44;
  dashboard.getRange("22:22").format.rowHeight = 28;
  dashboard.getRange("107:116").format.rowHeight = 24;
  dashboard.getRange(`118:${dashboardNoteRow - 1}`).format.autofitRows();
  setColumnWidths(dashboard, [["A:A", 26], ["B:E", 14], ["F:F", 12], ["G:N", 12]]);

  titleBand(rankings, "A1:AA2", "Salesperson Performance — Company-Supplied Lead Results and Call Activity", 17);
  rankings.getRange("A3:AA4").merge();
  rankings.getRange("A3:AA4").values = [[model.previousSnapshot
    ? `Compared with ${isoToDisplay(model.previousSnapshot.period.startDate)} to ${isoToDisplay(model.previousSnapshot.period.endDate)}. Sales From Allocated Leads % = Sales From Allocated Leads ÷ classified Approved Sales. Coverage and the possible range disclose unresolved attribution; results with 3% or more unresolved are provisional. A 5 percentage-point source-share change is labelled Share increased or Share reduced. ${report.dataQuality.callCoverageComplete ? "Leads Uncalled is limited to the governed reporting window." : "Allocated Leads With No Recorded Call remains an operational backlog, not proof no call occurred."} Call duration uses call_duration_seconds; calls per Approved Sale is workload context, not conversion.`
    : `This is the source-share baseline because no earlier compatible governed snapshot was available. Sales From Allocated Leads count approvals where the exact customer was allocated to the exact seller before approval, regardless of allocation age. ${report.dataQuality.callCoverageComplete ? "Leads Uncalled is limited to the governed reporting window." : "Allocated Leads With No Recorded Call remains an operational backlog, not proof no call occurred."} This is not conversion of this week's Sent Leads.`]];
  rankings.getRange("A3:AA4").format = { fill: COLORS.paleAmber, font: { color: "#7A5312", italic: true }, wrapText: true, verticalAlignment: "center" };
  const rankHeaders = ["Salesperson", "Manager", "Weekly Sent Leads", "Unique Leads Sent", uncalledLabel, "Weekly Calls", "Outbound Calls", "Average Call Time (sec)", "Median Call Time (sec)", "Total Call Time (hours)", `Short Calls (>0 & <${report.dataQuality.shortCallSeconds}s)`, `Long Calls (≥${report.dataQuality.longCallSeconds / 60}m)`, "Zero-Duration Calls", "Calls per Approved Sale (workload)", "Reallocations", "Approved Sales", "Sales Value", "Sales From Allocated Leads % of Classified Sales", "Sales From Allocated Leads", "Self-Sourced Sales", "Prior Sent Leads", "Prior Approved Sales", "Prior Sales From Allocated Leads %", "Change in Sales From Allocated Leads %", "Company-Supplied Sales Share Outcome", "Source Attribution Withheld", "Source Attribution Status"];
  writeMatrix(rankings, 5, 0, [rankHeaders]);
  styleHeader(rankings.getRange("A6:AA6"));
  model.salespersonRows.forEach((row, index) => {
    const excelRow = 7 + index;
    const helperRow = personCallHelperStart + 1 + index;
    rankings.getRange(`A${excelRow}:D${excelRow}`).values = [[row.salesperson, row.manager, row.sentAllocationEvents, row.uniqueCustomers]];
    rankings.getRange(`E${excelRow}`).formulas = [[`='Report Data'!T${helperRow}`]];
    rankings.getRange(`F${excelRow}:N${excelRow}`).values = [[row.weeklyCallCount, row.weeklyOutboundCallCount, row.weeklyAverageCallDurationSeconds, row.weeklyMedianCallDurationSeconds, row.weeklyTotalCallDurationSeconds / 3600, row.weeklyShortCallCount, row.weeklyLongCallCount, row.weeklyZeroDurationCalls, row.weeklyCallsPerApprovedSale]];
    rankings.getRange(`O${excelRow}:Q${excelRow}`).values = [[row.reallocationEvents, row.approvedSales, row.approvedSalesValue]];
    rankings.getRange(`R${excelRow}`).values = [[row.allocatedLeadShare]];
    rankings.getRange(`S${excelRow}:W${excelRow}`).values = [[row.companySourcedSales, row.selfSourcedSales, row.priorSent, row.priorApprovedSales, row.priorRate]];
    rankings.getRange(`X${excelRow}`).formulas = [[`=IF(OR(W${excelRow}="",LEFT(AA${excelRow},11)="Provisional"),"",R${excelRow}-W${excelRow})`]];
    rankings.getRange(`Y${excelRow}`).formulas = [[`=IF(LEFT(AA${excelRow},11)="Provisional","Provisional - 3%+ unresolved attribution",IF(W${excelRow}="","Baseline - no compatible prior week",IF(OR(C${excelRow}<100,U${excelRow}<100,P${excelRow}<5,V${excelRow}<5),"Low sample - not compared",IF(X${excelRow}>=0.05,"Share increased",IF(X${excelRow}<=-0.05,"Share reduced","No material change")))))`]];
    const attributionStatus = row.attributionWithheldSales
      ? `${row.sourceAttributionStatusLabel} - ${(row.sourceCoverage * 100).toFixed(1)}% classified - possible range ${(row.allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(row.allocatedLeadShareUpperBound * 100).toFixed(1)}%`
      : "Complete";
    rankings.getRange(`Z${excelRow}:AA${excelRow}`).values = [[row.attributionWithheldSales || 0, attributionStatus]];
  });
  const rankLast = 6 + model.salespersonRows.length;
  styleBody(rankings.getRange(`A7:AA${rankLast}`));
  rankings.getRange(`H7:J${rankLast}`).format.numberFormat = "0.0";
  rankings.getRange(`N7:N${rankLast}`).format.numberFormat = "0.0";
  rankings.getRange(`Q7:Q${rankLast}`).format.numberFormat = "$#,##0.00";
  rankings.getRange(`R7:R${rankLast}`).format.numberFormat = "0.00%";
  rankings.getRange(`W7:X${rankLast}`).format.numberFormat = "0.00%";
  rankings.getRange(`Y7:Y${rankLast}`).conditionalFormats.addCustom(`=$Y7="Share increased"`, { fill: "#D9EAD3", font: { color: "#256029", bold: true } });
  rankings.getRange(`Y7:Y${rankLast}`).conditionalFormats.addCustom(`=$Y7="Share reduced"`, { fill: COLORS.paleRed, font: { color: "#A61B1B", bold: true } });
  rankings.getRange(`AA7:AA${rankLast}`).conditionalFormats.addCustom(`=$AA7<>"Complete"`, { fill: COLORS.paleAmber, font: { color: "#7A5312", bold: true } });
  rankings.tables.add(`A6:AA${rankLast}`, true, "PerformanceRankingsTable").style = "TableStyleMedium2";
  rankings.freezePanes.freezeRows(6);
  setColumnWidths(rankings, [["A:B", 24], ["C:P", 16], ["Q:Q", 16], ["R:X", 20], ["Y:Y", 38], ["Z:Z", 20], ["AA:AA", 42]]);

  const performanceViews = model.performanceViews;
  titleBand(trophiesSheet, "A1:Q2", "PERFORMANCE & TROPHIES — SALESPEOPLE AND MANAGER TEAMS", 17);
  trophiesSheet.getRange("A3:Q4").merge();
  trophiesSheet.getRange("A3:Q4").values = [[`Colour key: blue sections are individual salesperson results; teal sections are manager-team results. Sales From Allocated Leads require exact customer, seller and pre-approval allocation evidence. Sales From Allocated Leads % always uses classified Approved Sales as its denominator. Coverage and the possible range disclose unresolved attribution; under 3% remains comparable, while 3% or more is provisional and excluded from source-share comparisons and trophies. ${model.withheldSales.length} sale${model.withheldSales.length === 1 ? " is" : "s are"} unresolved overall. Team shares divide aggregated counts; they never average salesperson percentages. Versatility, Lead Utilisation and Consistency candidates require 12+ Approved Sales under their stated rules. This is not conversion of this week's Sent Leads. ${report.dataQuality.callCoverageComplete ? "Complete weekday call coverage permits utilisation and 72-hour follow-up candidates." : "Call coverage is incomplete, so utilisation and follow-up trophies are not awarded."}`]];
  trophiesSheet.getRange("A3:Q4").format = { fill: COLORS.paleAmber, font: { color: "#7A5312" }, wrapText: true, verticalAlignment: "center", borders: { color: COLORS.border, style: "thin" } };

  sectionBand(trophiesSheet, "A6:H6", "Salesperson Results Worthy of Investigation");
  const investigationPersonHeaders = ["Rank", "Salesperson", "Manager", "Weekly Sent Leads", "Approved Sales", "Sales From Allocated Leads", "% of Classified Sales", "Full investigation reasons"];
  const investigationPersonRows = performanceViews.salespeopleResultsWorthyOfInvestigation.slice(0, 5).map((row, index) => [index + 1, row.displayName, row.manager, row.sent, row.sales, row.allocatedLeadSales, row.allocatedLeadShare, row.concerns.join("\n")]);
  writeMatrix(trophiesSheet, 6, 0, [investigationPersonHeaders, ...investigationPersonRows]);
  styleHeader(trophiesSheet.getRange("A7:H7"));
  if (investigationPersonRows.length) {
    styleBody(trophiesSheet.getRange(`A8:H${7 + investigationPersonRows.length}`));
    trophiesSheet.getRange(`G8:G${7 + investigationPersonRows.length}`).format.numberFormat = "0.0%";
    trophiesSheet.getRange(`H8:H${7 + investigationPersonRows.length}`).format.wrapText = true;
  }

  sectionBand(trophiesSheet, "J6:Q6", "Team Results Worthy of Investigation", COLORS.teamTeal);
  const investigationTeamHeaders = ["Rank", "Manager Team", "Salespeople Receiving Leads", "Weekly Sent Leads", "Approved Sales", "Sales From Allocated Leads", "% of Classified Sales", "Full investigation reasons"];
  const investigationTeamRows = performanceViews.teamResultsWorthyOfInvestigation.slice(0, 5).map((row, index) => [index + 1, row.displayName, row.activeSalespeople, row.sent, row.sales, row.allocatedLeadSales, row.allocatedLeadShare, row.concerns.join("\n")]);
  writeMatrix(trophiesSheet, 6, 9, [investigationTeamHeaders, ...investigationTeamRows]);
  styleHeader(trophiesSheet.getRange("J7:Q7"), COLORS.teamDark);
  if (investigationTeamRows.length) {
    styleBody(trophiesSheet.getRange(`J8:Q${7 + investigationTeamRows.length}`), COLORS.paleTeal);
    trophiesSheet.getRange(`P8:P${7 + investigationTeamRows.length}`).format.numberFormat = "0.0%";
    trophiesSheet.getRange(`Q8:Q${7 + investigationTeamRows.length}`).format.wrapText = true;
  }

  sectionBand(trophiesSheet, "A15:H15", "Lead Burners — High Allocation / Weak Result Mix");
  const burnerResultHeaders = ["Rank", "Salesperson", "Manager", "Weekly Sent Leads", "Approved Sales", "Sales From Allocated Leads", "% of Classified Sales", "Investigation context"];
  const burnerResultRows = performanceViews.leadBurnersByResult.slice(0, 5).map((row, index) => [index + 1, row.displayName, row.manager, row.sent, row.sales, row.allocatedLeadSales, row.allocatedLeadShare, row.concerns.join("\n") || "High lead allocation with a weak company-supplied sales mix; investigate context before action."]);
  writeMatrix(trophiesSheet, 15, 0, [burnerResultHeaders, ...burnerResultRows]);
  styleHeader(trophiesSheet.getRange("A16:H16"));
  if (burnerResultRows.length) {
    styleBody(trophiesSheet.getRange(`A17:H${16 + burnerResultRows.length}`));
    trophiesSheet.getRange(`G17:G${16 + burnerResultRows.length}`).format.numberFormat = "0.0%";
    trophiesSheet.getRange(`H17:H${16 + burnerResultRows.length}`).format.wrapText = true;
  }

  sectionBand(trophiesSheet, "J15:Q15", "Lead Burners — Highest Uncalled %", COLORS.teamTeal);
  const burnerUncalledHeaders = ["Rank", "Salesperson", "Manager", "Unique Allocated Leads", "Uncalled Leads", "Uncalled %", "Weekly Sent Leads", "Evidence boundary"];
  const burnerUncalledRows = performanceViews.leadBurnersByUncalled.slice(0, 5).map((row, index) => [index + 1, row.displayName, row.manager, row.unique, row.noExactCallObserved, row.uncalledRate, row.sent, report.dataQuality.callCoverageComplete ? "Complete reporting-window call coverage" : "Not ranked — call coverage incomplete"]);
  writeMatrix(trophiesSheet, 15, 9, [burnerUncalledHeaders, ...burnerUncalledRows]);
  styleHeader(trophiesSheet.getRange("J16:Q16"), COLORS.teamDark);
  if (burnerUncalledRows.length) {
    styleBody(trophiesSheet.getRange(`J17:Q${16 + burnerUncalledRows.length}`), COLORS.paleTeal);
    trophiesSheet.getRange(`O17:O${16 + burnerUncalledRows.length}`).format.numberFormat = "0.0%";
    trophiesSheet.getRange(`Q17:Q${16 + burnerUncalledRows.length}`).format.wrapText = true;
  }

  sectionBand(trophiesSheet, "A24:E24", "Salesperson Trophy Candidates");
  const trophyHeaders = ["Trophy", "Candidate", "Result", "Why", "Runners-up"];
  const salespersonTrophyRows = performanceViews.salespersonTrophies.map((row) => [row.trophy, row.candidate, row.metric, row.context, row.runnersUp]);
  writeMatrix(trophiesSheet, 24, 0, [trophyHeaders, ...salespersonTrophyRows]);
  styleHeader(trophiesSheet.getRange("A25:E25"));
  styleBody(trophiesSheet.getRange(`A26:E${25 + salespersonTrophyRows.length}`));
  trophiesSheet.getRange(`A26:E${25 + salespersonTrophyRows.length}`).format.wrapText = true;

  sectionBand(trophiesSheet, "J24:N24", "Team Trophy Candidates", COLORS.teamTeal);
  const teamTrophyRows = performanceViews.teamTrophies.map((row) => [row.trophy, row.candidate, row.metric, row.context, row.runnersUp]);
  writeMatrix(trophiesSheet, 24, 9, [trophyHeaders, ...teamTrophyRows]);
  styleHeader(trophiesSheet.getRange("J25:N25"), COLORS.teamDark);
  styleBody(trophiesSheet.getRange(`J26:N${25 + teamTrophyRows.length}`), COLORS.paleTeal);
  trophiesSheet.getRange(`J26:N${25 + teamTrophyRows.length}`).format.wrapText = true;

  sectionBand(trophiesSheet, "A38:Q38", "Rules and safeguards");
  const safeguardRows = [
    ["Sales From Allocated Leads", "Counts Approved Sales in the report week where exact history proves that the same customer was allocated to the same seller before the sale. There is no allocation-age limit."],
    ["Sales From Allocated Leads %", "Sales From Allocated Leads ÷ classified Approved Sales for the salesperson or team. Example: 6 sales from allocated leads ÷ 10 classified Approved Sales = 60%. Coverage and a possible range are shown when attribution is unresolved. It is not sales divided by this week's Sent Leads."],
    ["Meaningful sample", "Source-share comparisons require at least 100 weekly Sent Leads and at least 5 Approved Sales. Versatility and Lead Utilisation require at least 12 Approved Sales. Consistency requires at least 12 Approved Sales in each of two contiguous equal-length periods."],
    ["Weighted team shares", "Team Sales From Allocated Leads % = summed team Sales From Allocated Leads ÷ summed team classified Approved Sales. Team percentages always divide aggregated team totals; salesperson percentages are never averaged."],
    ["Investigation threshold", `A high-volume weak-result team must have at least ${Math.ceil(performanceViews.benchmarks.substantialTeamLeadVolume).toLocaleString("en-AU")} weekly Sent Leads and a Sales From Allocated Leads % below 70% of the manager-comparable benchmark.`],
    ["Lead Burners", `The high-allocation list requires at least 100 Sent Leads and comparable source attribution. The uncalled list requires complete call coverage and at least ${performanceViews.minimumUncalledReviewPairs || 25} allocated customer-recipient pairs. Both are investigation prompts, not performance verdicts.`],
    ["Versatility", "Closest to a 50/50 split of Self Sourced and company-supplied classified Approved Sales wins; both sources and at least 12 Approved Sales are required."],
    ["Consistency", "Smallest absolute week-over-week percentage change in Approved Sales wins. Current and prior periods must be contiguous, equal length, and each contain at least 12 Approved Sales."],
    ["Concentration", "Flagged only when a team has more than one observed recipient and one person produces more than 50% of team Approved Sales or Approved Sales Value."],
    ["Self sourcing", "Self-Sourcing trophies count Self-Sourced Approved Sales. Valid calls without a Customer ID are reported separately as unsuccessful self-sourcing attempts; they are activity, not sales, and never block company-supplied lead call scoring."],
    ["Manager activity", "A manager's own salesperson activity is included only when the Salesperson and Manager labels genuinely match. Separate columns show the manager's own Sent Leads, Approved Sales, Value and share of team sales."],
    ["Call awards", report.dataQuality.callCoverageComplete ? "Calculated from aggregated exact call-event counts and aggregated unique leads." : "No utilisation or follow-up candidate is eligible because call coverage is incomplete."],
    ["Timing limitation", "Weekly Sent Leads are current workload. Sales From Allocated Leads may trace to allocations from any earlier week, so the report does not claim this week's Sent Leads caused this week's sales or were wasted."],
    ["Source-attribution exceptions", "An order with incomplete timestamp or allocation-history evidence remains in Approved Sales and value totals and remains explicitly unresolved. The classified-sales percentage is always shown with coverage and a possible range. Under 3% unresolved stays comparable; 3% or more is provisional and excluded from source-share comparisons and trophies."],
    ["Use", "Recognition candidates and attention flags are deterministic evidence prompts. Check leave, capacity, role, territory and source context before any personnel decision."]
  ];
  writeMatrix(trophiesSheet, 38, 0, safeguardRows);
  safeguardRows.forEach((_, index) => trophiesSheet.mergeCells(`B${39 + index}:Q${39 + index}`));
  styleBody(trophiesSheet.getRange(`A39:Q${38 + safeguardRows.length}`));
  trophiesSheet.getRange(`A39:A${38 + safeguardRows.length}`).format = { fill: COLORS.paleBlue, font: { bold: true, color: COLORS.ink }, borders: { color: COLORS.border, style: "thin" }, verticalAlignment: "top" };
  trophiesSheet.getRange(`B39:Q${38 + safeguardRows.length}`).format.wrapText = true;
  trophiesSheet.getRange(`A39:Q${38 + safeguardRows.length}`).format.rowHeight = 34;

  const personCalcTitleRow = 40 + safeguardRows.length;
  sectionBand(trophiesSheet, `A${personCalcTitleRow}:AB${personCalcTitleRow}`, "Complete Salesperson Calculations");
  const personCalcHeaders = ["Salesperson", "Manager", "Weekly Sent Leads", "Unique Leads", "Reallocations", "Approved Sales", "Approved Sales Value", "Sales From Allocated Leads", "Self-Sourced Sales", "Called After Allocation", "Calls Within 72 Hours", "Sales From Allocated Leads % of Classified Sales", "Sales From Allocated Leads per 1,000 Weekly Leads (context)", "Approved Value per Weekly Lead (context)", "Weekly Leads per Approved Sale (context)", "Weekly Lead Share", "Sales From Allocated Leads Share", "Company-Supplied Sales Share Index", "Reallocation %", "Self-Sourced %", "Utilisation", "72-Hour Follow-Up", "Prior Weekly Sent", "Prior Allocated Leads Sold %", "Change", "Full Investigation Reasons", "Source Attribution Withheld", "Source Attribution Status"];
  writeMatrix(trophiesSheet, personCalcTitleRow, 0, [personCalcHeaders]);
  styleHeader(trophiesSheet.getRange(`A${personCalcTitleRow + 1}:AB${personCalcTitleRow + 1}`));
  const personCalcFirst = personCalcTitleRow + 2;
  performanceViews.salespeople.forEach((row, index) => {
    const excelRow = personCalcFirst + index;
    trophiesSheet.getRange(`A${excelRow}:K${excelRow}`).values = [[row.displayName, row.manager, row.sent, row.unique, row.reallocationEvents, row.sales, row.value, row.company, row.self, row.customersCalledAfterAllocation, row.callsWithin72Hours]];
    trophiesSheet.getRange(`L${excelRow}:V${excelRow}`).formulas = [[
      `=IFERROR(H${excelRow}/(H${excelRow}+I${excelRow}),0)`,
      `=IFERROR(H${excelRow}/C${excelRow}*1000,0)`,
      `=IFERROR(G${excelRow}/C${excelRow},0)`,
      `=IFERROR(C${excelRow}/F${excelRow},"")`,
      `=IFERROR(C${excelRow}/SUM($C$${personCalcFirst}:$C$${personCalcFirst + performanceViews.salespeople.length - 1}),0)`,
      `=IFERROR(H${excelRow}/SUM($H$${personCalcFirst}:$H$${personCalcFirst + performanceViews.salespeople.length - 1}),0)`,
      row.sourceShareComparable ? `=IFERROR(L${excelRow}/${performanceViews.benchmarks.overallAllocatedLeadShare}*100,0)` : `=""`,
      `=IFERROR(E${excelRow}/C${excelRow},0)`,
      `=IFERROR(I${excelRow}/(H${excelRow}+I${excelRow}),0)`,
      `=IF('Report Data'!$B$18,IFERROR(J${excelRow}/D${excelRow},0),"")`,
      `=IF('Report Data'!$B$18,IFERROR(K${excelRow}/D${excelRow},0),"")`
    ]];
    const personStatus = row.withheld ? `${row.sourceAttributionStatusLabel} - ${(row.sourceCoverage * 100).toFixed(1)}% classified - range ${(row.allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(row.allocatedLeadShareUpperBound * 100).toFixed(1)}%` : "Complete";
    trophiesSheet.getRange(`W${excelRow}:AB${excelRow}`).values = [[row.priorSent, row.priorRate, row.change, row.concerns.join(" "), row.withheld, personStatus]];
  });
  const personCalcLast = personCalcFirst + performanceViews.salespeople.length - 1;
  styleBody(trophiesSheet.getRange(`A${personCalcFirst}:AB${personCalcLast}`));
  trophiesSheet.getRange(`G${personCalcFirst}:G${personCalcLast}`).format.numberFormat = "$#,##0.00";
  trophiesSheet.getRange(`L${personCalcFirst}:L${personCalcLast}`).format.numberFormat = "0.00%";
  trophiesSheet.getRange(`M${personCalcFirst}:M${personCalcLast}`).format.numberFormat = "0.0";
  trophiesSheet.getRange(`N${personCalcFirst}:N${personCalcLast}`).format.numberFormat = "$#,##0.00";
  trophiesSheet.getRange(`O${personCalcFirst}:O${personCalcLast}`).format.numberFormat = "#,##0.0";
  trophiesSheet.getRange(`P${personCalcFirst}:Q${personCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`R${personCalcFirst}:R${personCalcLast}`).format.numberFormat = "0.0";
  trophiesSheet.getRange(`S${personCalcFirst}:V${personCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`X${personCalcFirst}:Y${personCalcLast}`).format.numberFormat = "0.00%";
  trophiesSheet.getRange(`Z${personCalcFirst}:Z${personCalcLast}`).format.wrapText = true;
  trophiesSheet.getRange(`Z${personCalcFirst}:Z${personCalcLast}`).conditionalFormats.addCustom(`=LEN($Z${personCalcFirst})>0`, { fill: COLORS.paleAmber, font: { color: "#7A5312" } });
  trophiesSheet.getRange(`AB${personCalcFirst}:AB${personCalcLast}`).conditionalFormats.addCustom(`=$AB${personCalcFirst}<>"Complete"`, { fill: COLORS.paleAmber, font: { color: "#7A5312", bold: true } });
  trophiesSheet.tables.add(`A${personCalcTitleRow + 1}:AB${personCalcLast}`, true, "CompleteSalespersonCalculationsTable").style = "TableStyleMedium2";

  const teamCalcTitleRow = personCalcLast + 3;
  sectionBand(trophiesSheet, `A${teamCalcTitleRow}:AK${teamCalcTitleRow}`, "Complete Team Calculations — Manager field defines the team", COLORS.teamTeal);
  const teamCalcHeaders = ["Manager Team", "Salespeople Receiving Leads", "Weekly Sent Leads", "Unique Leads", "Reallocations", "Approved Sales", "Approved Sales Value", "Sales From Allocated Leads", "Self-Sourced Sales", "Called After Allocation", "Calls Within 72 Hours", "Sales From Allocated Leads % of Classified Sales", "Sales From Allocated Leads per 1,000 Weekly Leads (context)", "Approved Value per Weekly Lead (context)", "Weekly Leads per Approved Sale (context)", "Weekly Lead Share", "Sales From Allocated Leads Share", "Company-Supplied Sales Share Index", "Reallocation %", "Self-Sourced %", "Self-Sourcing Contributors", "Low-Performing Members", "Eligible Members", "Manager Own Sent", "Manager Own Sales", "Manager Own Value", "Manager Own Sales Share", "Top Sales Contributor", "Top Contributor Share", "Utilisation", "72-Hour Follow-Up", "Full Investigation Reasons", "Prior Team Sent", "Prior Allocated Leads Sold %", "Change", "Source Attribution Withheld", "Source Attribution Status"];
  writeMatrix(trophiesSheet, teamCalcTitleRow, 0, [teamCalcHeaders]);
  styleHeader(trophiesSheet.getRange(`A${teamCalcTitleRow + 1}:AK${teamCalcTitleRow + 1}`), COLORS.teamDark);
  const teamCalcFirst = teamCalcTitleRow + 2;
  performanceViews.teams.forEach((row, index) => {
    const excelRow = teamCalcFirst + index;
    trophiesSheet.getRange(`A${excelRow}:K${excelRow}`).values = [[row.displayName, row.activeSalespeople, row.sent, row.unique, row.reallocations, row.sales, row.value, row.company, row.self, row.customersCalledAfterAllocation, row.callsWithin72Hours]];
    trophiesSheet.getRange(`L${excelRow}:T${excelRow}`).formulas = [[
      `=IFERROR(H${excelRow}/(H${excelRow}+I${excelRow}),0)`,
      `=IFERROR(H${excelRow}/C${excelRow}*1000,0)`,
      `=IFERROR(G${excelRow}/C${excelRow},0)`,
      `=IFERROR(C${excelRow}/F${excelRow},"")`,
      `=IFERROR(C${excelRow}/SUM($C$${teamCalcFirst}:$C$${teamCalcFirst + performanceViews.teams.length - 1}),0)`,
      `=IFERROR(H${excelRow}/SUM($H$${teamCalcFirst}:$H$${teamCalcFirst + performanceViews.teams.length - 1}),0)`,
      row.sourceShareComparable ? `=IFERROR(L${excelRow}/${performanceViews.benchmarks.overallAllocatedLeadShare}*100,0)` : `=""`,
      `=IFERROR(E${excelRow}/C${excelRow},0)`,
      `=IFERROR(I${excelRow}/(H${excelRow}+I${excelRow}),0)`
    ]];
    trophiesSheet.getRange(`U${excelRow}:AC${excelRow}`).values = [[row.selfContributors, row.lowPerformingMembers, row.eligibleMembers, row.managerOwnSent, row.managerOwnSales, row.managerOwnValue, row.managerOwnSalesShare, row.salesLeader, row.salesLeaderShare]];
    trophiesSheet.getRange(`AD${excelRow}:AE${excelRow}`).formulas = [[
      `=IF('Report Data'!$B$18,IFERROR(J${excelRow}/D${excelRow},0),"")`,
      `=IF('Report Data'!$B$18,IFERROR(K${excelRow}/D${excelRow},0),"")`
    ]];
    const teamStatus = row.withheld ? `${row.sourceAttributionStatusLabel} - ${(row.sourceCoverage * 100).toFixed(1)}% classified - range ${(row.allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(row.allocatedLeadShareUpperBound * 100).toFixed(1)}%` : "Complete";
    trophiesSheet.getRange(`AF${excelRow}:AK${excelRow}`).values = [[row.concerns.join(" "), row.priorSent, row.priorRate, row.change, row.withheld, teamStatus]];
  });
  const teamCalcLast = teamCalcFirst + performanceViews.teams.length - 1;
  styleBody(trophiesSheet.getRange(`A${teamCalcFirst}:AK${teamCalcLast}`), COLORS.paleTeal);
  trophiesSheet.getRange(`G${teamCalcFirst}:G${teamCalcLast}`).format.numberFormat = "$#,##0.00";
  trophiesSheet.getRange(`L${teamCalcFirst}:L${teamCalcLast}`).format.numberFormat = "0.00%";
  trophiesSheet.getRange(`M${teamCalcFirst}:M${teamCalcLast}`).format.numberFormat = "0.0";
  trophiesSheet.getRange(`N${teamCalcFirst}:N${teamCalcLast}`).format.numberFormat = "$#,##0.00";
  trophiesSheet.getRange(`O${teamCalcFirst}:O${teamCalcLast}`).format.numberFormat = "#,##0.0";
  trophiesSheet.getRange(`P${teamCalcFirst}:Q${teamCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`R${teamCalcFirst}:R${teamCalcLast}`).format.numberFormat = "0.0";
  trophiesSheet.getRange(`S${teamCalcFirst}:T${teamCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`Z${teamCalcFirst}:Z${teamCalcLast}`).format.numberFormat = "$#,##0.00";
  trophiesSheet.getRange(`AA${teamCalcFirst}:AA${teamCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`AC${teamCalcFirst}:AE${teamCalcLast}`).format.numberFormat = "0.0%";
  trophiesSheet.getRange(`AH${teamCalcFirst}:AI${teamCalcLast}`).format.numberFormat = "0.00%";
  trophiesSheet.getRange(`AF${teamCalcFirst}:AF${teamCalcLast}`).format.wrapText = true;
  trophiesSheet.getRange(`AF${teamCalcFirst}:AF${teamCalcLast}`).conditionalFormats.addCustom(`=LEN($AF${teamCalcFirst})>0`, { fill: COLORS.paleAmber, font: { color: "#7A5312" } });
  trophiesSheet.getRange(`AK${teamCalcFirst}:AK${teamCalcLast}`).conditionalFormats.addCustom(`=$AK${teamCalcFirst}<>"Complete"`, { fill: COLORS.paleAmber, font: { color: "#7A5312", bold: true } });
  trophiesSheet.tables.add(`A${teamCalcTitleRow + 1}:AK${teamCalcLast}`, true, "CompleteTeamCalculationsTable").style = "TableStyleMedium2";
  styleHeader(trophiesSheet.getRange(`A${teamCalcTitleRow + 1}:AK${teamCalcTitleRow + 1}`), COLORS.teamDark);
  styleBody(trophiesSheet.getRange(`A${teamCalcFirst}:AK${teamCalcLast}`), COLORS.paleTeal);
  trophiesSheet.freezePanes.freezeRows(4);
  setColumnWidths(trophiesSheet, [["A:A", 34], ["B:B", 28], ["C:C", 22], ["D:D", 58], ["E:E", 32], ["F:I", 16], ["J:J", 34], ["K:K", 28], ["L:L", 22], ["M:M", 58], ["N:N", 32], ["O:Y", 17], ["Z:Z", 58], ["AA:AE", 20], ["AF:AF", 70], ["AG:AJ", 18], ["AK:AK", 42]]);
  trophiesSheet.getRange("H:H").format.columnWidth = 56;
  trophiesSheet.getRange("Q:Q").format.columnWidth = 56;
  trophiesSheet.getRange("26:35").format.rowHeight = 46;
  trophiesSheet.getRange(`39:${38 + safeguardRows.length}`).format.rowHeight = 34;

  titleBand(leadBurnersSheet, "A1:H2", "LEAD BURNERS — INVESTIGATION QUEUES", 17);
  leadBurnersSheet.getRange("A3:H5").merge();
  leadBurnersSheet.getRange("A3:H5").values = [[`These are deterministic investigation prompts, not disciplinary findings. High Allocation / Weak Result Mix ranks eligible salespeople with at least 100 weekly Sent Leads by a combination of high allocation volume and low company-supplied sales share. Highest Uncalled % is published only when the governed reporting-window call gate is complete and requires at least 25 allocated customer-recipient pairs. ${report.dataQuality.callCoverageComplete ? "The call gate passed for this report." : "The call gate did not pass, so the uncalled ranking is intentionally withheld."}`]];
  leadBurnersSheet.getRange("A3:H5").format = { fill: COLORS.paleAmber, font: { color: "#7A5312" }, wrapText: true, verticalAlignment: "center", borders: { color: COLORS.border, style: "thin" } };

  sectionBand(leadBurnersSheet, "A7:H7", "10 Highest-Allocation Salespeople With the Weakest Company-Supplied Sales Mix");
  const fullBurnerResultRows = performanceViews.leadBurnersByResult.slice(0, 10).map((row, index) => [index + 1, row.displayName, row.manager, row.sent, row.sales, row.allocatedLeadSales, row.allocatedLeadShare, row.concerns.join("\n") || "High lead allocation with a weak company-supplied sales mix; investigate context before action."]);
  writeMatrix(leadBurnersSheet, 7, 0, [["Rank", "Salesperson", "Manager", "Weekly Sent Leads", "Approved Sales", "Sales From Allocated Leads", "% of Classified Sales", "Full investigation context"], ...fullBurnerResultRows]);
  styleHeader(leadBurnersSheet.getRange("A8:H8"));
  if (fullBurnerResultRows.length) {
    const resultLast = 8 + fullBurnerResultRows.length;
    styleBody(leadBurnersSheet.getRange(`A9:H${resultLast}`));
    leadBurnersSheet.getRange(`G9:G${resultLast}`).format.numberFormat = "0.0%";
    leadBurnersSheet.getRange(`H9:H${resultLast}`).format.wrapText = true;
    leadBurnersSheet.tables.add(`A8:H${resultLast}`, true, "LeadBurnersWeakResultTable").style = "TableStyleMedium2";
  } else {
    leadBurnersSheet.getRange("A9:H9").merge();
    leadBurnersSheet.getRange("A9:H9").values = [["No salesperson met the volume and source-attribution eligibility rules."]];
    styleBody(leadBurnersSheet.getRange("A9:H9"));
  }

  sectionBand(leadBurnersSheet, "A22:H22", "10 Highest Uncalled Percentages — Minimum 25 Allocated Pairs", COLORS.teamTeal);
  const fullBurnerUncalledRows = performanceViews.leadBurnersByUncalled.slice(0, 10).map((row, index) => [index + 1, row.displayName, row.manager, row.unique, row.noExactCallObserved, row.uncalledRate, row.sent, "Complete reporting-window call coverage"]);
  writeMatrix(leadBurnersSheet, 22, 0, [["Rank", "Salesperson", "Manager", "Unique Allocated Leads", "Leads Uncalled", "Uncalled %", "Weekly Sent Leads", "Evidence boundary"], ...fullBurnerUncalledRows]);
  styleHeader(leadBurnersSheet.getRange("A23:H23"), COLORS.teamDark);
  if (fullBurnerUncalledRows.length) {
    const uncalledLast = 23 + fullBurnerUncalledRows.length;
    styleBody(leadBurnersSheet.getRange(`A24:H${uncalledLast}`), COLORS.paleTeal);
    leadBurnersSheet.getRange(`F24:F${uncalledLast}`).format.numberFormat = "0.0%";
    leadBurnersSheet.getRange(`H24:H${uncalledLast}`).format.wrapText = true;
    leadBurnersSheet.tables.add(`A23:H${uncalledLast}`, true, "LeadBurnersUncalledTable").style = "TableStyleMedium4";
  } else {
    leadBurnersSheet.getRange("A24:H25").merge();
    leadBurnersSheet.getRange("A24:H25").values = [[report.dataQuality.callCoverageComplete
      ? "No salesperson met the minimum 25-pair threshold with an uncalled lead."
      : "Ranking withheld: complete governed reporting-window call coverage is required before an uncalled percentage can be asserted."]];
    leadBurnersSheet.getRange("A24:H25").format = { fill: COLORS.paleAmber, font: { color: "#7A5312", italic: true }, wrapText: true, verticalAlignment: "center", borders: { color: COLORS.border, style: "thin" } };
  }
  leadBurnersSheet.freezePanes.freezeRows(8);
  setColumnWidths(leadBurnersSheet, [["A:A", 10], ["B:C", 25], ["D:G", 20], ["H:H", 74]]);

  titleBand(managerSheet, "A1:O2", "Manager Analysis", 17);
  managerSheet.getRange("A3:O4").merge();
  managerSheet.getRange("A3:O4").values = [[`Sales From Allocated Leads require exact customer, seller and pre-approval allocation evidence. Sales From Allocated Leads % always uses classified Approved Sales. Coverage and the possible range expose unresolved attribution; under 3% remains comparable, while 3% or more is provisional and excluded from source-share awards. Weekly Sent Leads remain a separate workload measure and are not used as the sales denominator. Exact Calls Observed is positive evidence only; ${report.dataQuality.callCoverageComplete ? "Leads Uncalled means no exact allocated-customer and salesperson call was recorded inside the governed reporting window." : "Allocated Leads With No Recorded Call by Evidence Cutoff means no exact match was found in the available evidence; it is not definitive proof that nobody called."} Low sample means fewer than 100 weekly Sent Leads or fewer than 5 Approved Sales.`]];
  managerSheet.getRange("A3:O4").format = { fill: COLORS.paleBlue, wrapText: true, verticalAlignment: "center", font: { color: COLORS.ink } };
  writeMatrix(managerSheet, 5, 0, [managerMatrix[0]]);
  styleHeader(managerSheet.getRange("A6:O6"));
  model.managerRows.forEach((row, index) => {
    const sourceRow = managerFirstData + index;
    const targetRow = 7 + index;
    managerSheet.getRange(`A${targetRow}:O${targetRow}`).formulas = [[..."ABCDEFGHIJKLMNO"].map((column) => `='Report Data'!${column}${sourceRow}`)];
  });
  const managerSheetLast = 6 + model.managerRows.length;
  styleBody(managerSheet.getRange(`A7:O${managerSheetLast}`));
  managerSheet.getRange(`D7:D${managerSheetLast}`).format.numberFormat = "0.0";
  managerSheet.getRange(`H7:H${managerSheetLast}`).format.numberFormat = "$#,##0.00";
  managerSheet.getRange(`J7:L${managerSheetLast}`).format.numberFormat = "0.0%";
  managerSheet.tables.add(`A6:O${managerSheetLast}`, true, "ManagerAnalysisTable").style = "TableStyleMedium2";
  managerSheet.freezePanes.freezeRows(6);
  setColumnWidths(managerSheet, [["A:A", 28], ["B:G", 17], ["H:L", 20], ["M:M", 58], ["N:O", 20]]);

  titleBand(distributionSheet, "A1:I2", "Lead Distribution by Salesperson", 17);
  distributionSheet.getRange("A3:I5").merge();
  distributionSheet.getRange("A3:I5").values = [[`Salespeople Receiving Leads means an eligible salesperson received at least one valid Sent Lead in the selected period. Equal-share reference = team Sent Leads divided by recipients. It is a comparison prompt, not a fairness verdict: capacity, leave, rostered hours and role differences may justify a different allocation. This source cannot identify an active salesperson who received zero leads.`]];
  distributionSheet.getRange("A3:I5").format = { fill: COLORS.paleAmber, font: { color: "#7A5312" }, wrapText: true, verticalAlignment: "center" };
  const distributionHeaders = ["Salesperson", "Manager", "Sent Leads", "Salespeople Receiving Leads", "Team Sent Leads", "Equal-share reference", "Difference from reference", "Share Index", "Status"];
  writeMatrix(distributionSheet, 5, 0, [distributionHeaders]);
  styleHeader(distributionSheet.getRange("A6:I6"));
  model.leadDistributionRows.forEach((row, index) => {
    const targetRow = 7 + index;
    distributionSheet.getRange(`A${targetRow}:E${targetRow}`).values = [[row.salesperson, row.manager, row.sentLeads, row.observedActiveSalespeople, row.teamSentLeads]];
    distributionSheet.getRange(`F${targetRow}`).formulas = [[`=IFERROR(E${targetRow}/D${targetRow},0)`]];
    distributionSheet.getRange(`G${targetRow}`).formulas = [[`=C${targetRow}-F${targetRow}`]];
    distributionSheet.getRange(`H${targetRow}`).formulas = [[`=IFERROR(C${targetRow}/F${targetRow},0)`]];
    distributionSheet.getRange(`I${targetRow}`).formulas = [[`=IF(D${targetRow}<2,"Single observed recipient - no within-team comparison",IF(H${targetRow}>=1+'Report Data'!$B$24,"25%+ above equal-share reference",IF(H${targetRow}<=1-'Report Data'!$B$24,"25%+ below equal-share reference","Within 25% of equal-share reference")))`]];
  });
  const distributionLast = 6 + model.leadDistributionRows.length;
  styleBody(distributionSheet.getRange(`A7:I${distributionLast}`));
  distributionSheet.getRange(`F7:G${distributionLast}`).format.numberFormat = "#,##0.0";
  distributionSheet.getRange(`H7:H${distributionLast}`).format.numberFormat = "0.00x";
  distributionSheet.getRange(`I7:I${distributionLast}`).conditionalFormats.addCustom(`=LEFT($I7,4)="25%+"`, { fill: COLORS.paleAmber, font: { color: "#7A5312", bold: true } });
  distributionSheet.getRange(`I7:I${distributionLast}`).conditionalFormats.addCustom(`=$I7="Within 25% of equal-share reference"`, { fill: COLORS.paleTeal, font: { color: "#256029", bold: true } });
  distributionSheet.tables.add(`A6:I${distributionLast}`, true, "LeadDistributionTable").style = "TableStyleMedium2";
  distributionSheet.freezePanes.freezeRows(6);
  setColumnWidths(distributionSheet, [["A:B", 25], ["C:E", 18], ["F:H", 20], ["I:I", 44]]);

  titleBand(callSheet, "A1:N2", "Call Activity & Data Coverage", 17);
  callSheet.getRange("A3:N5").merge();
  callSheet.getRange("A3:N5").values = [[report.dataQuality.callCoverageComplete
    ? `Complete weekday company-supplied lead call evidence is available through ${report.dataQuality.callEvidenceThrough}. Each allocated customer-recipient pair is counted as called only when the exact customer and exact allocated salesperson have a call after allocation. Weekly call activity uses deduplicated calls dated inside the reporting period. Short calls are over 0 and under ${report.dataQuality.shortCallSeconds} seconds; long calls are at least ${report.dataQuality.longCallSeconds} seconds; zero-duration calls are separate. Duration is activity context and does not prove a human conversation. ${Number(report.dataQuality.unlinkedSelfSourcingCallAttempts || 0).toLocaleString("en-AU")} valid calls without a Customer ID are unsuccessful self-sourcing attempts, not company-supplied lead calls or sales.`
    : `Merged call sources cover the available primary history and later supplement through ${report.dataQuality.callEvidenceThrough || "an unavailable cutoff"}. ${Number(report.dataQuality.foundCustomerIdPositiveRepairs || 0).toLocaleString("en-AU")} calls with a blank customer_id were accepted only as positive evidence because FoundCustomerID exactly matched the same salesperson's allocation before the call; raw files were not changed. ${Number(report.dataQuality.missingCallJoinKeys || 0).toLocaleString("en-AU")} genuine call identity issues still block scoring.`]];
  callSheet.getRange("A3:N5").format = { fill: COLORS.paleAmber, font: { color: "#7A5312", italic: true }, wrapText: true, verticalAlignment: "center" };
  writeMatrix(callSheet, 6, 0, [["Allocation date", "Call data status"], ...model.coverageRows]);
  styleHeader(callSheet.getRange("A7:B7"));
  styleBody(callSheet.getRange(`A8:B${7 + model.coverageRows.length}`));
  callSheet.getRange("D7:E17").values = [
    ["Coverage item", "Result"],
    ["Confirmed exact call pairs", report.dataQuality.observedCalledPairs],
    ["New pairs confirmed from FoundCustomerID", report.dataQuality.foundCustomerIdNewlyObservedPairs],
    ["Calls accepted through exact FoundCustomerID rule", report.dataQuality.foundCustomerIdPositiveRepairs],
    ["Raw calls missing customer_id", report.dataQuality.rawMissingCallJoinKeys],
    ["Unlinked self-sourcing attempts", report.dataQuality.unlinkedSelfSourcingCallAttempts],
    ["Blocking call identity issues", report.dataQuality.missingCallJoinKeys],
    ["Call evidence through", report.dataQuality.callEvidenceThrough],
    ["After-window call dates present", model.afterWindowCallDates.join(", ") || "None"],
    [report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff", report.dataQuality.noExactCallObservedPairs],
    ["Headcount basis", "Salespeople Receiving Leads is allocation-recipient based; call activity does not determine headcount"]
  ];
  styleHeader(callSheet.getRange("D7:E7"));
  styleBody(callSheet.getRange("D8:E17"));
  callSheet.getRange("E8:E13").format.numberFormat = "#,##0";
  callSheet.getRange("E16").format.numberFormat = "#,##0";
  callSheet.getRange("E8:E17").format.wrapText = true;
  callSheet.getRange("17:17").format.rowHeight = 30;
  sectionBand(callSheet, "A20:N20", "Weekly Call Activity by Salesperson");
  const callActivityHeaders = ["Salesperson", "Manager", "Weekly Calls", "Outbound Calls", "Calls With Duration", "Average Call Seconds", "Median Call Seconds", "Total Call Hours", "Short Calls", "Long Calls", "Zero-Duration Calls", "Calls per Approved Sale", "Approved Sales", "Duration Coverage"];
  const callActivityRows = model.salespersonRows
    .slice()
    .sort((a, b) => Number(b.weeklyCallCount || 0) - Number(a.weeklyCallCount || 0) || a.salesperson.localeCompare(b.salesperson))
    .map((row) => [
      row.salesperson,
      row.manager,
      row.weeklyCallCount || 0,
      row.weeklyOutboundCallCount || 0,
      row.weeklyDurationObservedCalls || 0,
      row.weeklyAverageCallDurationSeconds,
      row.weeklyMedianCallDurationSeconds,
      Number(row.weeklyTotalCallDurationSeconds || 0) / 3600,
      row.weeklyShortCallCount || 0,
      row.weeklyLongCallCount || 0,
      row.weeklyZeroDurationCalls || 0,
      row.weeklyCallsPerApprovedSale,
      row.approvedSales || 0,
      row.callDurationCoverageStatus === "measured" ? "Measured" : "Incomplete duration coverage"
    ]);
  writeMatrix(callSheet, 20, 0, [callActivityHeaders, ...callActivityRows]);
  styleHeader(callSheet.getRange("A21:N21"));
  if (callActivityRows.length) {
    const callActivityLast = 21 + callActivityRows.length;
    styleBody(callSheet.getRange(`A22:N${callActivityLast}`));
    callSheet.getRange(`F22:H${callActivityLast}`).format.numberFormat = "0.0";
    callSheet.getRange(`L22:L${callActivityLast}`).format.numberFormat = "0.0";
    callSheet.getRange(`N22:N${callActivityLast}`).format.wrapText = true;
    callSheet.tables.add(`A21:N${callActivityLast}`, true, "WeeklyCallActivityTable").style = "TableStyleMedium2";
  }
  callSheet.freezePanes.freezeRows(5);
  setColumnWidths(callSheet, [["A:B", 25], ["C:E", 18], ["F:H", 21], ["I:K", 18], ["L:M", 22], ["N:N", 32]]);
  callSheet.getRange("D:D").format.columnWidth = 46;
  callSheet.getRange("E:E").format.columnWidth = 42;

  titleBand(salesSheet, "A1:M2", "Approved Sales - Complete Team Total", 17);
  salesSheet.getRange("A3:M4").merge();
  salesSheet.getRange("A3:M4").values = [["All approved sales retained in the complete total are listed here. 'Sale From Allocated Lead' means the exact customer was allocated to the exact seller before the sale, with no allocation-age limit. 'Self Sourced' means complete timestamp and allocation-history evidence exists but no qualifying exact seller-customer allocation does. 'Attribution Withheld' means the order remains fully included in sales totals, but the evidence is insufficient to decide company-supplied versus Self Sourced safely. Sales without a matching weekly salesperson label remain in the complete total but outside named manager comparisons."]];
  salesSheet.getRange("A3:M4").format = { fill: COLORS.paleBlue, wrapText: true, verticalAlignment: "center", font: { color: COLORS.ink } };
  const salesHeaders = ["Evidence Ref", "Order", "Business", "Customer ID", "Seller", "Approval Time / Period Evidence", "Approved Value", "Source Attribution", "Acquisition Source", "Allocation Source", "Weekly match", "Manager comparison", "Complete total"];
  const salesRows = report._evidence.approvedSales.map((row) => {
    const matched = model.salespersonRows.some((person) => normalizePerson(person.salesperson) === normalizePerson(row.seller));
    const sourceLabel = row.leadSourceClassification === "Company Sourced"
      ? "Sale From Allocated Lead"
      : row.leadSourceClassification === "Self Sourced"
        ? "Self Sourced"
        : row.approvalTimestampStatus === "explicit"
          ? "Attribution Withheld - allocation history incomplete"
          : "Attribution Withheld - approval timestamp unavailable";
    const approvalEvidence = row.approvalDate || row.approvalPeriod || `${report.period.startDate} to ${report.period.endDate} (period membership only)`;
    return [row.evidenceRef, row.orderNumber, row.businessName, row.customerId, row.seller, approvalEvidence, row.approvedValue, sourceLabel, row.acquisitionSource, row.allocationSource, row.weeklyAllocationMatchStatus, matched ? "Included" : "Not included - no weekly salesperson label", "Included"];
  });
  writeMatrix(salesSheet, 5, 0, [salesHeaders, ...salesRows]);
  const salesLast = 6 + salesRows.length;
  styleHeader(salesSheet.getRange("A6:M6"));
  styleBody(salesSheet.getRange(`A7:M${salesLast}`));
  salesSheet.getRange(`G7:G${salesLast}`).format.numberFormat = "$#,##0.00";
  salesSheet.tables.add(`A6:M${salesLast}`, true, "ApprovedSalesTable").style = "TableStyleMedium2";
  salesSheet.freezePanes.freezeRows(6);
  setColumnWidths(salesSheet, [["A:B", 16], ["C:C", 34], ["D:D", 14], ["E:E", 24], ["F:F", 15], ["G:G", 16], ["H:I", 20], ["J:K", 24], ["L:L", 38], ["M:M", 14]]);

  titleBand(evidenceSheet, "A1:H2", "Sent Lead Evidence", 17);
  evidenceSheet.getRange("A3:H4").merge();
  evidenceSheet.getRange("A3:H4").values = [["One row per deduplicated Sent Lead. Evidence references are privacy-safe. This sheet shows allocation facts only and does not infer customer history."]];
  evidenceSheet.getRange("A3:H4").format = { fill: COLORS.paleBlue, wrapText: true, verticalAlignment: "center", font: { color: COLORS.ink } };
  const evidenceHeaders = ["Evidence Ref", "Salesperson", "Manager", "Sent Date", "Sent Time", "Source", "Allocation Name", "Lead age bucket"];
  const evidenceRows = model.sentLeadRows.map((row) => [row.evidenceRef, row.salesperson, row.manager, row.sentDate, row.sentTime, row.source, row.allocationName, row.leadAgeBucket]);
  writeMatrix(evidenceSheet, 5, 0, [evidenceHeaders, ...evidenceRows]);
  const evidenceLast = 6 + evidenceRows.length;
  styleHeader(evidenceSheet.getRange("A6:H6"));
  styleBody(evidenceSheet.getRange(`A7:H${evidenceLast}`));
  evidenceSheet.tables.add(`A6:H${evidenceLast}`, true, "SentLeadEvidenceTable").style = "TableStyleMedium2";
  evidenceSheet.freezePanes.freezeRows(6);
  setColumnWidths(evidenceSheet, [["A:A", 16], ["B:C", 24], ["D:E", 14], ["F:F", 18], ["G:G", 42], ["H:H", 18]]);

  titleBand(checksSheet, "A1:E2", "Automated Checks", 17);
  const checks = [
    ["Check", "Result", "Actual", "Expected", "Why it matters"],
    ["Allocation deduplication", null, null, null, "Included raw rows must equal Sent Leads plus logical duplicates removed."],
    ["Approved sales source split", null, null, null, "Sales From Allocated Leads + Self-Sourced Sales + Source Attribution Withheld must equal all Approved Sales."],
    ["Team sales reconciliation", null, null, null, "Manager-comparable sales plus off-roster sales must equal all Approved Sales."],
    ["Manager sales reconciliation", null, null, null, "Manager approved-sales sum must equal salesperson-label-matched sales."],
    ["Approved value reconciliation", null, null, null, "Matched approved value plus off-roster approved value must equal team approved value."],
    ["Call scoring gate", null, null, null, "Incomplete call dates or exact join keys must suppress utilisation and follow-up scoring."],
    ["30-day cohort gate", null, null, null, "An unmatured cohort must not display a conversion rate."],
    ["Off-roster handling", "PASS", model.offRoster.length, model.offRoster.length, "Retained in team total; no dedicated unmatched-sales review sheet."],
    ["Lead-recipient reconciliation", null, null, null, "Manager Salespeople Receiving Leads counts must equal the salesperson rows represented in the allocation evidence."],
    ["Lead distribution reconciliation", null, null, null, "Every salesperson receiving leads must appear once in Lead Distribution."],
    ["Team Sent Leads aggregation", null, null, null, "Summed team Sent Leads must equal the complete allocation population; no percentage averaging is permitted."],
    ["Team Approved Sales aggregation", null, null, null, "Summed team Approved Sales must equal the salesperson-label-matched sales population."],
    ["Call trophy gate", null, null, null, "Utilisation and follow-up trophies must be withheld when call coverage is incomplete."],
    ["Named team award gate", null, null, null, "Unknown, unidentified or policy-withheld manager groups cannot receive a named team award."],
    ["Trophy runner-up safeguard", null, null, null, "Every award with at least three eligible candidates must show at least two runners-up."],
    ["Team Sales From Allocated Leads aggregation", null, null, null, "Summed team Sales From Allocated Leads must equal the matched exact customer-and-seller allocation population."],
    ["Salesperson uncalled reconciliation", null, null, null, "Salesperson review-backlog counts must reconcile to the governed uncalled population or the available no-recorded-call population, according to the call gate."],
    ["Team uncalled reconciliation", null, null, null, "Team review-backlog counts must aggregate from the underlying salesperson allocation pairs and reconcile to the same population."],
    ["Source coverage threshold", "PASS", `${(sourceCoverage * 100).toFixed(1)}% classified`, sourceStatus, "Every Sales From Allocated Leads % is shown. Under 3% unresolved remains comparable; 3% or more is labelled provisional."],
    ["Provisional award exclusion", "PASS", [...performanceViews.salespeople, ...performanceViews.teams].filter((row) => !row.sourceShareComparable && row.shareEligible).length, 0, "A provisional salesperson or team cannot enter source-share comparisons or trophies."]
  ];
  writeMatrix(checksSheet, 4, 0, checks);
  styleHeader(checksSheet.getRange("A5:E5"));
  styleBody(checksSheet.getRange("A6:E25"));
  checksSheet.getRange("B6").formulas = [["=IF(C6=D6,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C6").formulas = [["='Report Data'!B4+'Report Data'!B20"]];
  checksSheet.getRange("D6").formulas = [["='Report Data'!B19"]];
  checksSheet.getRange("B7").formulas = [["=IF(C7=D7,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C7").formulas = [[`='Report Data'!B15+'Report Data'!B16+'Report Data'!B${withheldSummaryRow}`]];
  checksSheet.getRange("D7").formulas = [["='Report Data'!B7"]];
  checksSheet.getRange("B8").formulas = [["=IF(C8=D8,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C8").formulas = [["='Report Data'!B9+'Report Data'!B11"]];
  checksSheet.getRange("D8").formulas = [["='Report Data'!B7"]];
  checksSheet.getRange("B9").formulas = [["=IF(C9=D9,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C9").formulas = [[`=SUM('Report Data'!G${managerFirstData}:G${managerLastData})`]];
  checksSheet.getRange("D9").formulas = [["='Report Data'!B9"]];
  checksSheet.getRange("B10").formulas = [["=IF(ABS(C10-D10)<0.01,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C10").formulas = [["='Report Data'!B10+'Report Data'!B12"]];
  checksSheet.getRange("D10").formulas = [["='Report Data'!B8"]];
  const expectedCallScoring = report.dataQuality.callCoverageComplete ? "Scored" : "Not scored";
  checksSheet.getRange("B11").formulas = [["=IF(AND(C11=D11,OR(AND('Report Data'!B18=TRUE,C11=\"Scored\"),AND('Report Data'!B18=FALSE,C11=\"Not scored\"))),\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C11:D11").values = [[expectedCallScoring, expectedCallScoring]];
  checksSheet.getRange("B12").formulas = [["=IF(AND(C12=\"not_mature\",D12=\"No rate shown\"),\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C12:D12").values = [[report.cohortWindows.find((row) => row.days === 30)?.status || "not_available", "No rate shown"]];
  checksSheet.getRange("B14").formulas = [["=IF(C14=D14,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C14").formulas = [[`=SUM('Report Data'!B${managerFirstData}:B${managerLastData})`]];
  checksSheet.getRange("D14").values = [[model.salespersonRows.length]];
  checksSheet.getRange("B15").formulas = [["=IF(C15=D15,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C15").formulas = [[`=COUNTA('Lead Distribution'!A7:A${distributionLast})`]];
  checksSheet.getRange("D15").values = [[model.salespersonRows.length]];
  checksSheet.getRange("B16").formulas = [["=IF(C16=D16,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C16").formulas = [[`=SUM('Performance & Trophies'!C${teamCalcFirst}:C${teamCalcLast})`]];
  checksSheet.getRange("D16").formulas = [["='Report Data'!B4"]];
  checksSheet.getRange("B17").formulas = [["=IF(C17=D17,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C17").formulas = [[`=SUM('Performance & Trophies'!F${teamCalcFirst}:F${teamCalcLast})`]];
  checksSheet.getRange("D17").formulas = [["='Report Data'!B9"]];
  const callTrophyCandidates = [...performanceViews.salespersonTrophies, ...performanceViews.teamTrophies]
    .filter((row) => /Lead Utilisation|Follow-Up/.test(row.trophy));
  const invalidCallAwards = report.dataQuality.callCoverageComplete
    ? 0
    : callTrophyCandidates.filter((row) => !row.candidate.startsWith("No eligible")).length;
  checksSheet.getRange("B18").formulas = [["=IF(C18=D18,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C18:D18").values = [[invalidCallAwards, 0]];
  const invalidNamedTeamAwards = performanceViews.teamTrophies.filter((row) => (
    !row.candidate.startsWith("No eligible") && /(unknown|unidentified|withheld|not assigned|not available)/i.test(row.candidate)
  )).length;
  checksSheet.getRange("B19").formulas = [["=IF(C19=D19,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C19:D19").values = [[invalidNamedTeamAwards, 0]];
  const invalidRunnerUpRows = [...performanceViews.salespersonTrophies, ...performanceViews.teamTrophies]
    .filter((row) => row.eligibleCount >= 3 && row.runnersUp.split(",").length < 2).length;
  checksSheet.getRange("B20").formulas = [["=IF(C20=D20,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C20:D20").values = [[invalidRunnerUpRows, 0]];
  checksSheet.getRange("B21").formulas = [["=IF(C21=D21,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C21").formulas = [[`=SUM('Performance & Trophies'!H${teamCalcFirst}:H${teamCalcLast})`]];
  checksSheet.getRange("D21").formulas = [["='Report Data'!B15-'Report Data'!B13"]];
  checksSheet.getRange("B22").formulas = [["=IF(C22=D22,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C22").formulas = [[`=SUM('Performance Rankings'!E7:E${rankLast})`]];
  checksSheet.getRange("D22").formulas = [[`='Report Data'!B${noExactCallSummaryRow}`]];
  checksSheet.getRange("B23").formulas = [["=IF(C23=D23,\"PASS\",\"FAIL\")"]];
  checksSheet.getRange("C23").formulas = [[`=SUM('Report Data'!O${managerFirstData}:O${managerLastData})`]];
  checksSheet.getRange("D23").formulas = [[`='Report Data'!B${noExactCallSummaryRow}`]];
  checksSheet.getRange("B6:B25").conditionalFormats.addCustom("=$B6=\"PASS\"", { fill: "#D9EAD3", font: { color: "#256029", bold: true } });
  checksSheet.getRange("B6:B25").conditionalFormats.addCustom("=$B6=\"FAIL\"", { fill: COLORS.paleRed, font: { color: "#A61B1B", bold: true } });
  checksSheet.getRange("E6:E25").format.wrapText = true;
  checksSheet.getRange("6:25").format.rowHeight = 28;
  setColumnWidths(checksSheet, [["A:A", 42], ["B:B", 14], ["C:D", 24], ["E:E", 72]]);

  titleBand(notesSheet, "A1:C2", "Data Notes and Definitions", 17);
  const missingCallDates = model.coverageRows.filter((row) => row[1].startsWith("Missing")).map((row) => row[0]);
  const configuredCallSources = Array.isArray(model.config.callSources) && model.config.callSources.length
    ? model.config.callSources
    : model.config.callCsvPath
      ? [{ path: model.config.callCsvPath, role: "weekly_supplement", dateOrder: "month_first" }]
      : [];
  const callSourceNoteRows = configuredCallSources.map((source) => [
    `Call source - ${source.role || "supplement"}`,
    `${path.basename(source.path)} (${source.dateOrder || "month_first"})`,
    `SHA-256 ${sha256(source.path)}`
  ]);
  const noteRows = [
    ["Item", "Plain-English definition", "Status / source"],
    ["Report scope", "Weekly allocation workload plus Approved Sales outcomes, with exact Sales From Allocated Leads attribution that can look back to any earlier allocation date.", `${isoToDisplay(report.period.startDate)} to ${isoToDisplay(report.period.endDate)}`],
    ["Total Sent Leads", "Deduplicated allocation events. Reallocations count as another Sent Lead because another workload event occurred.", `${report.totals.deduplicatedSentEvents.toLocaleString("en-AU")} events`],
    ["Unique Leads Sent", "Unique customer + receiving salesperson pairs. One customer sent to two salespeople counts as two unique pairs.", `${report.totals.uniqueCustomerRecipientPairs.toLocaleString("en-AU")} pairs`],
    ["Approved Sales", "All approved orders in the selected week after configured personnel exclusions; not restricted to customers allocated in the same week.", `${report.totals.approvedSalesInPeriod.toLocaleString("en-AU")} orders`],
    ["Sales From Allocated Leads", "Approved Sales in the report week where exact customer-and-seller history proves that the customer was allocated to that seller before the sale. There is no age limit on the earlier allocation.", `${model.companySales.length.toLocaleString("en-AU")} sales`],
    ["Sales From Allocated Leads %", "Sales From Allocated Leads divided by classified Approved Sales for the same salesperson or team. Coverage and the possible range disclose unresolved attribution. Under 3% unresolved remains comparable; 3% or more is provisional and excluded from source-share comparisons and trophies. The denominator is never weekly Sent Leads.", `${(allocatedLeadShare * 100).toFixed(1)}% | ${(sourceCoverage * 100).toFixed(1)}% classified | range ${(allocatedLeadShareLowerBound * 100).toFixed(1)}% to ${(allocatedLeadShareUpperBound * 100).toFixed(1)}% | ${sourceStatus}`],
    ["Weekly Sent Leads vs sales", "Weekly Sent Leads measure allocation workload in the selected week. Sales From Allocated Leads may trace to allocations from any earlier week. Showing both provides context, but the report does not claim that current weekly leads caused current sales or were wasted.", "Separate measures"],
    ["Manager sales", "Approved sales are assigned to a manager only where the exact approved-seller label matches a salesperson in the weekly allocation file.", `${report.totals.approvedSalesWithRecipientLabelMatch} matched`],
    ["Salespeople Receiving Leads", "Eligible salespeople who received at least one valid Sent Lead in the selected period. This is exact from allocation evidence, but cannot identify an active person who received zero leads.", `${model.salespersonRows.length} recipients`],
    ["Sent Leads per Recipient", "Team Sent Leads divided by its Salespeople Receiving Leads. It measures average observed allocation workload per recipient.", "Manager Analysis and Dashboard"],
    ["Equal-share reference", "Team Sent Leads divided equally across its lead recipients. The 25% band highlights material differences for review; it is not a fairness verdict because capacity, leave, hours and roles may differ.", "Lead Distribution"],
    ["Call-based headcount", "Not used. The call export has no governed manager field, so allocation recipients remain the stable headcount denominator.", "Rejected as unreliable"],
    ["Off-roster sales", "Included in the complete total and whichever source category the governed evidence supports, but excluded from named manager comparisons because no matching weekly salesperson label exists.", `${model.offRoster.length} sales | $${model.offRoster.reduce((sum, row) => sum + row.approvedValue, 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`],
    ["Company-Supplied / Self Sourced", "Governed source classification uses exact Customer ID, exact seller allocation history and an explicit approval timestamp. Sales From Allocated Leads means the actual seller had qualifying exact pre-sale allocation evidence. Self Sourced requires complete evidence showing no such allocation. Incomplete evidence is withheld, never guessed.", `${model.companySales.length} Sales From Allocated Leads | ${model.selfSales.length} Self Sourced | ${model.withheldSales.length} Attribution Withheld`],
    ["Source attribution exceptions", "These orders remain in the complete Approved Sales count and value and remain explicitly unresolved. The classified-sales share is still shown with coverage and a possible range. Less than 3% unresolved remains comparable; 3% or more is provisional and excluded from source-share comparisons and trophies.", `${model.withheldSales.length} sales`],
    ["Team definition", "A team is every observed salesperson row carrying the same Manager label. Team counts are summed first; every team rate divides those aggregated counts and never averages salesperson percentages.", `${model.performanceViews.teams.length} manager teams`],
    ["Company-Supplied Sales Share Index", "The salesperson or team's Sales From Allocated Leads % divided by the comparable overall percentage, multiplied by 100. An index of 100 equals the benchmark. Team shares use summed counts before division.", `${(model.performanceViews.benchmarks.overallAllocatedLeadShare * 100).toFixed(1)}% comparable Sales From Allocated Leads %`],
    ["Manager own activity", "Included in the team total only when the salesperson label genuinely matches the Manager label. Separate columns show the manager's own Sent Leads, Approved Sales, Approved Sales Value and share of team sales.", "Performance & Trophies"],
    ["Investigation views", "Salesperson and team investigation lists use deterministic rules and display every generated reason in full. Source-share comparisons require at least 100 weekly Sent Leads and 5 Approved Sales.", "Deterministic eligibility"],
    ["Team investigation reasons", "Generated from fixed rules for high weekly lead volume with weak company-supplied sales share, weekly lead-share versus Sales From Allocated Leads-share mismatch, concentration, broad underperformance, self-sourcing dependence, excessive reallocations and complete-data call measures.", `High-volume threshold ${Math.ceil(model.performanceViews.benchmarks.substantialTeamLeadVolume).toLocaleString("en-AU")} weekly Sent Leads`],
    ["Trophy candidates", "The factual leading eligible result is shown with up to two runners-up. No candidate is shown when the required data or sample is unavailable. Candidates are recognition prompts, not automatic personnel decisions.", "Performance & Trophies"],
    ["Self-Sourcing trophy", "Counts Self-Sourced Approved Sales and contributing salespeople. It does not call sales 'self-sourced leads' or calculate lead conversion without an actual self-sourced-lead denominator.", "Sales evidence only"],
    ["Call coverage", "All available call dates after allocation are used through the displayed evidence cutoff. Direct customer_id is primary. A blank customer_id may use FoundCustomerID only as positive evidence when it exactly matches the same salesperson's allocation and the call occurred after allocation; raw files remain unchanged. Other valid calls without a Customer ID are unsuccessful self-sourcing attempts, not company-supplied lead calls or Self-Sourced Sales. Missing weekend rows are treated as no weekend activity and do not block scoring.", missingCallDates.length
      ? `Incomplete dates - missing ${missingCallDates.join(", ")}`
      : report.dataQuality.callCoverageComplete
        ? `Complete through ${report.dataQuality.callEvidenceThrough}; ${Number(report.dataQuality.unlinkedSelfSourcingCallAttempts || 0).toLocaleString("en-AU")} self-sourcing attempts reported separately`
        : `Dates merged; ${Number(report.dataQuality.foundCustomerIdPositiveRepairs || 0).toLocaleString("en-AU")} positive FoundCustomerID repairs; ${Number(report.dataQuality.missingCallJoinKeys || 0).toLocaleString("en-AU")} genuine identity issues`],
    [report.dataQuality.callCoverageComplete ? "Leads Uncalled Within Reporting Window" : "Allocated Leads With No Recorded Call by Evidence Cutoff", report.dataQuality.callCoverageComplete
      ? "Unique allocated customer-salesperson pairs with no exact same-customer, same-salesperson call recorded after allocation inside the complete governed reporting window. This windowed label does not assert what happened later."
      : "Unique allocated customer-salesperson pairs with no exact same-customer, same-salesperson call recorded after allocation through the available evidence cutoff. This remains unresolved evidence rather than proof that nobody called.", `${Number(report.dataQuality.noExactCallObservedPairs || 0).toLocaleString("en-AU")} pairs through ${report.dataQuality.callEvidenceThrough || "the available cutoff"}`],
    ["Weekly call activity", `Deduplicated calls dated inside the reporting period. Short calls are over zero and under ${report.dataQuality.shortCallSeconds} seconds; long calls are at least ${report.dataQuality.longCallSeconds} seconds; zero-duration calls are separate. Average and median use call_duration_seconds. Calls per Approved Sale is a workload ratio, not a conversion claim.`, report.dataQuality.callDurationCoverageComplete ? `${Number(report.dataQuality.weeklyCallsInPeriod || 0).toLocaleString("en-AU")} calls; duration coverage measured` : "Duration coverage incomplete"],
    ["Utilisation / follow-up", "Scored when every weekday allocation date is covered and call IDs, timestamps and allocated-customer identities reconcile. Empty weekend dates are treated as no weekend activity; customer-ID-free self-sourcing attempts are reported separately.", report.dataQuality.callCoverageComplete ? "Scored" : "Not scored"],
    ["30-day cohort conversion", "Requires each lead to have a complete 30-day outcome window and an exact customer + seller link. The current week has not matured.", report.cohortWindows.find((row) => row.days === 30)?.status || "not_available"],
    ["Chart insights", "Generated from fixed rules, not free-form AI text: 10% from the comparable Sales From Allocated Leads % benchmark, 2 percentage points for weekly-lead-share versus Sales From Allocated Leads-share gaps, and 25% from team equal-share reference for allocation workload differences. Names, values and caveats come from selected data.", "Deterministic and repeatable"],
    ["Company-Supplied Sales Share Outcome", "Uses the newest compatible governed snapshot ending before the current period. Both periods require at least 100 weekly Sent Leads and 5 Approved Sales. A movement of 5 percentage points or more is reported as Share increased or Share reduced; it is a source-mix quantity, not a performance judgment.", model.previousSnapshot ? `${model.previousSnapshot.period.startDate} to ${model.previousSnapshot.period.endDate}` : "Baseline - no compatible prior snapshot"],
    ["Previous comparison source", "Historical snapshot used for Prior Sent Leads, Prior Approved Sales, Prior Allocated Leads Sold %, Change and Company-Supplied Sales Share Outcome. Old snapshots without exact company-supplied fields are not used for salesperson share comparison.", model.previousSnapshotSource ? path.basename(model.previousSnapshotSource) : "None - baseline period"],
    ...(Array.isArray(model.config.allocationSources) && model.config.allocationSources.length
      ? model.config.allocationSources.map((source) => ["Allocation source file", path.basename(source.path), `SHA-256 ${sha256(source.path)}`])
      : [["Allocation source file", path.basename(model.config.allocationLogPath), `SHA-256 ${sha256(model.config.allocationLogPath)}`]]),
    ...callSourceNoteRows,
    ["Approved-sales evidence", path.basename(model.carmaConfig.databasePath), `SHA-256 ${sha256(model.carmaConfig.databasePath)}`]
  ];
  writeMatrix(notesSheet, 4, 0, noteRows);
  styleHeader(notesSheet.getRange("A5:C5"));
  styleBody(notesSheet.getRange(`A6:C${4 + noteRows.length}`));
  notesSheet.getRange(`A6:C${4 + noteRows.length}`).format.wrapText = true;
  setColumnWidths(notesSheet, [["A:A", 28], ["B:B", 88], ["C:C", 58]]);
  notesSheet.freezePanes.freezeRows(5);

  dataSheet.freezePanes.freezeRows(1);
  return wb;
}

function makeSnapshot(model) {
  return makeLeadResultSnapshot(model);
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (args["personnel-exclusions"]) {
    configurePersonnelExclusions(
      String(args["personnel-exclusions"]).split(";").map((value) => value.trim()).filter(Boolean),
    );
  }
  const outputDir = path.resolve(args.output || path.join(ROOT, "outputs", `lead-result-dashboard-${new Date().toISOString().slice(0, 10)}`));
  const source = loadReport({
    start: args.start,
    end: args.end,
    databasePath: args["carma-database"] || "",
  });
  const previousSnapshotRecord = await resolvePreviousSnapshot(args, source.report.period.startDate);
  const model = buildModel({
    ...source,
    previousSnapshot: previousSnapshotRecord?.snapshot || null,
    previousSnapshotSource: previousSnapshotRecord?.sourcePath || ""
  });
  const wb = buildWorkbook(model);
  await fsp.mkdir(outputDir, { recursive: true });
  const fileName = `lead-result-dashboard_${model.report.period.startDate}_to_${model.report.period.endDate}.xlsx`;
  const outputPath = path.join(outputDir, fileName);
  const xlsx = await SpreadsheetFile.exportXlsx(wb);
  await xlsx.save(outputPath);

  const previewDir = path.join(outputDir, "preview");
  await fsp.mkdir(previewDir, { recursive: true });
  const renderRanges = {
    Dashboard: "A1:N190",
    "Performance Rankings": "A1:AA30",
    "Performance & Trophies": "A1:Q55",
    "Lead Burners": "A1:H34",
    "Manager Analysis": "A1:O16",
    "Lead Distribution": "A1:I66",
    "Call Coverage": "A1:N90",
    "Approved Sales": "A1:M30",
    "Sent Lead Evidence": "A1:H30",
    Checks: "A1:E25",
    "Data Notes": "A1:C42",
    "Report Data": `A1:T${41 + model.salespersonRows.length}`
  };
  for (const [sheetName, range] of Object.entries(renderRanges)) {
    const image = await wb.render({ sheetName, range, scale: 1, format: "png" });
    await fsp.writeFile(path.join(previewDir, `${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`), new Uint8Array(await image.arrayBuffer()));
  }
  for (const [fileName, range] of Object.entries({
    "performance-trophies-salesperson-calculations": `A55:AB${56 + model.performanceViews.salespeople.length}`,
    "performance-trophies-team-calculations": `A${59 + model.performanceViews.salespeople.length}:AK${60 + model.performanceViews.salespeople.length + model.performanceViews.teams.length}`
  })) {
    const image = await wb.render({ sheetName: "Performance & Trophies", range, scale: 1, format: "png" });
    await fsp.writeFile(path.join(previewDir, `${fileName}.png`), new Uint8Array(await image.arrayBuffer()));
  }
  const inspection = await wb.inspect({ kind: "formula", maxChars: 12000, options: { maxResults: 5000 } });
  const inspectionText = inspection.ndjson || String(inspection);
  const formulaErrors = (inspectionText.match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g) || []);
  const snapshot = makeSnapshot(model);
  const semanticHash = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const checks = {
    outputPath,
    semanticHash,
    sourcePeriod: model.report.period,
    reconciliations: {
      allocationDedup: model.report.totals.rawAllocationRows === model.report.totals.deduplicatedSentEvents + model.report.totals.logicalDuplicateRows,
      salesSource: model.companySales.length + model.selfSales.length + model.withheldSales.length === model.report.totals.approvedSalesInPeriod,
      teamSales: model.report.totals.approvedSalesWithRecipientLabelMatch + model.offRoster.length === model.report.totals.approvedSalesInPeriod,
      managerSales: model.managerRows.reduce((sum, row) => sum + row.sales, 0) === model.report.totals.approvedSalesWithRecipientLabelMatch,
      approvedValue: Math.abs(model.salesValue - (model.report.totals.approvedSalesValueWithRecipientLabelMatch + model.offRoster.reduce((sum, row) => sum + row.approvedValue, 0))) < 0.01,
      activeSalespeople: model.managerRows.reduce((sum, row) => sum + row.activeSalespeople, 0) === model.salespersonRows.length,
      leadDistribution: model.leadDistributionRows.length === model.salespersonRows.length,
      teamSentLeads: model.performanceViews.teams.reduce((sum, row) => sum + row.sent, 0) === model.report.totals.deduplicatedSentEvents,
      teamMatchedSales: model.performanceViews.teams.reduce((sum, row) => sum + row.sales, 0) === model.report.totals.approvedSalesWithRecipientLabelMatch,
      teamSourceSplit: model.performanceViews.teams.every((row) => row.company + row.self + row.withheld === row.sales),
      teamAllocatedSales: model.performanceViews.teams.reduce((sum, row) => sum + row.allocatedLeadSales, 0) === model.companySales.length - model.offRoster.filter((row) => row.leadSourceClassification === "Company Sourced").length,
      allocatedTeamShares: model.performanceViews.teams.every((row) => Math.abs(row.allocatedLeadShare - (row.classifiedSales ? row.allocatedLeadSales / row.classifiedSales : 0)) < 1e-12),
      sourceCoverageThreshold: model.performanceViews.teams.every((row) => row.sourceShareComparable === (row.classifiedSales > 0 && row.unresolvedShare < 0.03)),
      provisionalAwardsExcluded: [...model.performanceViews.salespeople, ...model.performanceViews.teams]
        .filter((row) => !row.sourceShareComparable)
        .every((row) => !row.shareEligible),
      managerOwnActivitySubset: model.performanceViews.teams.every((row) => row.managerOwnSent <= row.sent && row.managerOwnSales <= row.sales && row.managerOwnValue <= row.value + 0.01),
      callTrophyGate: model.report.dataQuality.callCoverageComplete || [...model.performanceViews.salespersonTrophies, ...model.performanceViews.teamTrophies]
        .filter((row) => /Lead Utilisation|Follow-Up/.test(row.trophy))
        .every((row) => row.candidate.startsWith("No eligible")),
      namedTeamAwards: model.performanceViews.teamTrophies.every((row) => row.candidate.startsWith("No eligible") || !/(unknown|unidentified|withheld|not assigned|not available)/i.test(row.candidate)),
      trophyRunnersUp: [...model.performanceViews.salespersonTrophies, ...model.performanceViews.teamTrophies]
        .every((row) => row.eligibleCount < 3 || row.runnersUp.split(",").length >= 2),
      salespersonNoExactCallObserved: model.salespersonRows.reduce((sum, row) => sum + row.noExactCallObserved, 0) === model.report.dataQuality.noExactCallObservedPairs,
      teamNoExactCallObserved: model.managerRows.reduce((sum, row) => sum + row.noExactCallObserved, 0) === model.report.dataQuality.noExactCallObservedPairs,
      callObservationPopulation: model.report.dataQuality.observedCalledPairs + model.report.dataQuality.noExactCallObservedPairs === model.report.totals.uniqueCustomerRecipientPairs,
      excludedPersonnel: model.salespersonRows.every((row) => !isExcludedPersonnel(row.salesperson))
        && model.report._evidence.approvedSales.every((row) => !isExcludedPersonnel(row.seller)),
      weeklyCallActivity: model.salespersonRows.reduce((sum, row) => sum + Number(row.weeklyCallCount || 0), 0) === Number(model.report.dataQuality.weeklyCallsInPeriod || 0),
      leadBurnersCallGate: model.report.dataQuality.callCoverageComplete || model.performanceViews.leadBurnersByUncalled.length === 0,
      leadUtilisationTwelveSaleGate: [...model.performanceViews.salespersonTrophies, ...model.performanceViews.teamTrophies]
        .filter((row) => /Lead Utilisation/.test(row.trophy) && !row.candidate.startsWith("No eligible"))
        .every((row) => /meets the 12-sale gate/.test(row.context)),
      mostImprovedRemoved: [...model.performanceViews.salespersonTrophies, ...model.performanceViews.teamTrophies]
        .every((row) => !new RegExp(["Most", "Improved"].join(" "), "i").test(row.trophy))
    },
    callCoverageComplete: model.report.dataQuality.callCoverageComplete,
    callScoringShown: model.report.dataQuality.callCoverageComplete,
    cohort30DayStatus: model.report.cohortWindows.find((row) => row.days === 30)?.status || "not_available",
    formulaErrors
  };
  if (!Object.values(checks.reconciliations).every(Boolean) || formulaErrors.length) throw new Error(`Workbook validation failed: ${JSON.stringify(checks)}`);
  await fsp.writeFile(path.join(outputDir, "validation.json"), `${JSON.stringify(checks, null, 2)}\n`);
  await fsp.writeFile(path.join(outputDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  const historyDir = path.join(ROOT, "data", "store", "lead-result-dashboard-snapshots");
  await fsp.mkdir(historyDir, { recursive: true });
  await fsp.writeFile(path.join(historyDir, `${model.report.period.startDate}_to_${model.report.period.endDate}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, previewDir, validation: checks.reconciliations }, null, 2)}\n`);
}

async function exportLeadResultDashboardXlsx(model) {
  const workbook = buildWorkbook(model);
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  return {
    data: Buffer.from(xlsx.data),
    fileName: `lead-result-dashboard_${model.report.period.startDate}_to_${model.report.period.endDate}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

export {
  buildWorkbook,
  exportLeadResultDashboardXlsx
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`Lead Result Dashboard generation failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
