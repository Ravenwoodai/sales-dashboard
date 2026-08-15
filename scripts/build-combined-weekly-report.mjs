import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return result;
}

function displayDate(isoDate) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T00:00:00Z`));
}

function compactPeriod(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startMonth = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" }).format(end);
  return startMonth === endMonth ? `${startDay}-${endDay} ${endMonth}` : `${startDay} ${startMonth}-${endDay} ${endMonth}`;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ["lead-workbook", "voicemail-workbook", "lead-data", "voicemail-data", "call-data", "output"]) {
  if (!args[required]) throw new Error(`Missing required --${required} argument.`);
}
const root = path.resolve(String(args.root || process.cwd()));
const outputPath = path.resolve(String(args.output));
const outputDir = path.dirname(outputPath);
const workDir = path.resolve(String(args.work || path.join(root, "work", "combined-weekly-report", path.basename(outputPath, ".xlsx"))));
const leadWorkbookPath = path.resolve(String(args["lead-workbook"]));
const voicemailWorkbookPath = path.resolve(String(args["voicemail-workbook"]));
const leadDataPath = path.resolve(String(args["lead-data"]));
const voicemailDataPath = path.resolve(String(args["voicemail-data"]));
const callDataPath = path.resolve(String(args["call-data"]));
const qaPath = path.resolve(String(args.qa || path.join(outputDir, "combined_workbook_qa.json")));
const leadTypeScope = String(args["lead-type-scope"] || "").trim();

const BRAND_RED = "#EE3424";
const CHARCOAL = "#231F20";
const CALLED_GREEN = "#1F6F5B";
const WASTED_RED = "#B42318";
const AMBER = "#A45A00";
const TEAL = "#147D78";
const PANEL = "#F5F6F7";
const BORDER = "#D6D9DD";
const SECONDARY = "#5B6470";
const CREAM = "#FFF3F1";
const GREEN_PANEL = "#E8F5E9";
const RED_PANEL = "#FCE4E4";

const [leadData, voicemailData, callData] = await Promise.all([
  fs.readFile(leadDataPath, "utf8").then(JSON.parse),
  fs.readFile(voicemailDataPath, "utf8").then(JSON.parse),
  fs.readFile(callDataPath, "utf8").then(JSON.parse),
]);
const reportStart = leadData.reportingPeriod.startDate;
const reportEnd = leadData.reportingPeriod.endDate;
const previousStart = voicemailData.previousPeriod.start;
const previousEnd = voicemailData.previousPeriod.end;
if (voicemailData.reportingPeriod.start !== reportStart || voicemailData.reportingPeriod.end !== reportEnd) {
  throw new Error("Lead Utilisation and Voicemail reporting periods do not match.");
}
if (callData.scope?.currentPeriod?.[0] !== reportStart || callData.scope?.currentPeriod?.[1] !== reportEnd) {
  throw new Error("Lead Utilisation and Call Activity reporting periods do not match.");
}
const reportSubtitle = `${displayDate(reportStart)} to ${displayDate(reportEnd)}`;
const previousSubtitle = `${displayDate(previousStart)} to ${displayDate(previousEnd)} under the same Friday-cutoff contract.`;
const exclusionDisplay = voicemailData.exclusionPolicy?.display;
if (!exclusionDisplay) {
  throw new Error("Voicemail report data is missing the configured exclusion display.");
}
const vmTeamLastRow = 5 + voicemailData.teams.length;
const vmTeamWowLastRow = 5 + voicemailData.teamComparisons.length;
const vmPeopleLastRow = 6 + voicemailData.people.length;
const vmWowLastRow = 14 + voicemailData.comparisons.length;
const vmWowFooterRow = vmWowLastRow + 2;
const vmPreviousLastRow = 5 + voicemailData.previousPeople.length;
const vmPreviousFooterStart = vmPreviousLastRow + 2;
const vmPreviousFooterEnd = vmPreviousFooterStart + 1;
const vmEvidenceLastRow = 5 + voicemailData.totals.checked;
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(leadWorkbookPath));
const voicemailWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(voicemailWorkbookPath));

function excelColumn(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function mergeAndWrite(sheet, range, value) {
  sheet.mergeCells(range);
  const cell = range.split(":")[0];
  sheet.getRange(cell).values = [[value]];
}

function directionStyle(label) {
  const text = String(label || "");
  if (text.startsWith("Improved")) return { fill: GREEN_PANEL, colour: CALLED_GREEN };
  if (text.startsWith("Regressed")) return { fill: RED_PANEL, colour: WASTED_RED };
  return { fill: CREAM, colour: AMBER };
}

function resultStyle(label) {
  const text = String(label || "");
  if (text === "Following well") return { fill: GREEN_PANEL, colour: CALLED_GREEN };
  if (text === "Needs attention") return { fill: RED_PANEL, colour: WASTED_RED };
  if (text === "Mixed") return { fill: CREAM, colour: AMBER };
  return { fill: PANEL, colour: SECONDARY };
}

function ppLabel(item) {
  if (!item || item.change == null) return item?.direction || "No prior result";
  const absolute = Math.abs(Number(item.change) * 100).toFixed(1);
  return `${item.direction} ${absolute}%`;
}

function cloneWorksheet(sourceWorkbook, sourceName, targetName, rows, columns, freezeRows = null) {
  const source = sourceWorkbook.worksheets.getItem(sourceName);
  const target = workbook.worksheets.add(targetName);
  const sourceRange = source.getRangeByIndexes(0, 0, rows, columns);
  const targetRange = target.getRangeByIndexes(0, 0, rows, columns);
  targetRange.copyFrom(sourceRange, "all");
  target.showGridLines = false;
  if (freezeRows) target.freezePanes.freezeRows(freezeRows);
  return target;
}

function ensureMerge(sheet, range) {
  sheet.unmergeCells(range);
  sheet.mergeCells(range);
}

function reportTitle(sheet, endColumn, title, subtitle) {
  ensureMerge(sheet, `A1:${endColumn}1`);
  ensureMerge(sheet, `A2:${endColumn}2`);
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A1:${endColumn}1`).format = { fill: "#FFFFFF", font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 18 }, verticalAlignment: "center", borders: { left: { style: "thick", color: BRAND_RED } } };
  sheet.getRange(`A1:${endColumn}1`).format.rowHeight = 30;
  sheet.getRange(`A2:${endColumn}2`).format = { fill: "#FFFFFF", font: { name: "Source Sans 3", italic: true, color: SECONDARY, size: 10 }, verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A2:${endColumn}2`).format.rowHeight = 24;
}

function tableHeader(range) {
  range.format = { fill: CHARCOAL, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 9 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: BORDER } };
  range.format.rowHeight = 34;
}

function tableBody(range) {
  range.format.font = { name: "Source Sans 3", size: 9, color: CHARCOAL };
  range.format.verticalAlignment = "center";
  range.format.borders = { insideHorizontal: { style: "thin", color: BORDER } };
}

function setWidths(sheet, widths) {
  for (const [column, width] of widths) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function styleVoicemailSheets() {
  const summarySheet = workbook.worksheets.getItem("VM Summary");
  for (const range of ["A3:I3", "A4:B4", "C4:D4", "E4:F4", "G4:I4", "A5:B5", "C5:D5", "E5:F5", "G5:I5", "A6:B6", "C6:D6", "E6:F6", "G6:I6", "A8:I8", "A10:D10", "F10:I10", "F20:I21", "A23:I23", "A24:C24", "D24:F24", "G24:I24", "A26:I26", "A27:I28", "A29:I29", "A30:I31"]) ensureMerge(summarySheet, range);
  reportTitle(summarySheet, "I", "VOICEMAIL FOLLOW-UP REPORT", reportSubtitle);
  summarySheet.getRange("A3:I3").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, size: 10 }, wrapText: true, verticalAlignment: "center" };
  summarySheet.getRange("A3:I3").format.rowHeight = 42;
  for (const [range, fill, colour] of [["A4:B6", PANEL, CHARCOAL], ["C4:D6", GREEN_PANEL, CALLED_GREEN], ["E4:F6", RED_PANEL, WASTED_RED], ["G4:I6", RED_PANEL, WASTED_RED]]) {
    summarySheet.getRange(range).format.fill = fill;
    summarySheet.getRange(range).format.borders = { preset: "outside", style: "thin", color: BORDER };
    summarySheet.getRange(range).format.font = { name: "Source Sans 3", color: colour };
    summarySheet.getRange(range).format.horizontalAlignment = "center";
    summarySheet.getRange(range).format.verticalAlignment = "center";
  }
  summarySheet.getRange("A4:I4").format.font = { name: "Source Sans 3", bold: true, color: SECONDARY, size: 9 };
  summarySheet.getRange("A5:I5").format.font = { name: "Source Sans 3", bold: true, size: 18 };
  summarySheet.getRange("A6:I6").format.font = { name: "Source Sans 3", bold: true, size: 11 };
  summarySheet.getRange("A6:I6").format.numberFormat = "0%";
  summarySheet.getRange("A8:I8").format = { fill: CREAM, font: { name: "Source Sans 3", bold: true, color: WASTED_RED, size: 10 }, wrapText: true, verticalAlignment: "center", horizontalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };
  for (const range of ["A10:D10", "F10:I10", "A23:I23", "A26:I26"]) summarySheet.getRange(range).format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 11 }, borders: { left: { style: "thick", color: BRAND_RED } } };
  tableHeader(summarySheet.getRange("A11:D11"));
  tableHeader(summarySheet.getRange("F11:I11"));
  tableBody(summarySheet.getRange("A12:D21"));
  tableBody(summarySheet.getRange("F12:I21"));
  summarySheet.getRange("A24:C24").format = { fill: RED_PANEL, font: { name: "Source Sans 3", bold: true, color: WASTED_RED, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
  summarySheet.getRange("D24:F24").format = { fill: CREAM, font: { name: "Source Sans 3", bold: true, color: AMBER, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
  summarySheet.getRange("G24:I24").format = { fill: GREEN_PANEL, font: { name: "Source Sans 3", bold: true, color: CALLED_GREEN, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
  summarySheet.getRange("A27:I28").format = { fill: PANEL, font: { name: "Source Sans 3", color: CHARCOAL, size: 9 }, wrapText: true, verticalAlignment: "center" };
  summarySheet.getRange("A29:I29").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 9 }, wrapText: true, verticalAlignment: "center", horizontalAlignment: "center" };
  summarySheet.getRange("A30:I31").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  setWidths(summarySheet, [["A",22],["B",14],["C",14],["D",14],["E",10],["F",22],["G",14],["H",14],["I",14]]);

  const teams = workbook.worksheets.getItem("VM Teams");
  for (const range of ["A1:I1", "A2:I2", "A3:I3"]) ensureMerge(teams, range);
  reportTitle(teams, "I", "MANAGER TEAM VOICEMAIL FOLLOW-UP", "Aggregated manager-team results under the same Monday-to-Friday Friday-cutoff contract.");
  teams.getRange("A3:I3").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };
  teams.getRange("A3:I3").format.rowHeight = 34;
  tableHeader(teams.getRange("A5:I5")); tableBody(teams.getRange(`A6:I${vmTeamLastRow}`));
  teams.getRange(`G6:H${vmTeamLastRow}`).format.numberFormat = "0.0%";
  for (let row = 6; row <= vmTeamLastRow; row += 1) {
    const style = resultStyle(teams.getRange(`I${row}`).values[0][0]);
    teams.getRange(`I${row}`).format.fill = style.fill;
    teams.getRange(`I${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
  setWidths(teams, [["A",27],["B",13],["C",14],["D",17],["E",18],["F",18],["G",15],["H",17],["I",19]]);

  const teamWow = workbook.worksheets.getItem("VM Team WoW");
  for (const range of ["A1:H1", "A2:H2", "A3:H3"]) ensureMerge(teamWow, range);
  reportTitle(teamWow, "H", "MANAGER TEAM WEEK-ON-WEEK", "Aggregated team movement; current week compared with the immediately previous complete Monday-to-Friday period.");
  teamWow.getRange("A3:H3").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };
  teamWow.getRange("A3:H3").format.rowHeight = 38;
  tableHeader(teamWow.getRange("A5:H5")); tableBody(teamWow.getRange(`A6:H${vmTeamWowLastRow}`));
  teamWow.getRange(`C6:C${vmTeamWowLastRow}`).format.numberFormat = "0.0%"; teamWow.getRange(`E6:F${vmTeamWowLastRow}`).format.numberFormat = "0.0%"; teamWow.getRange(`H6:H${vmTeamWowLastRow}`).format.wrapText = true;
  for (let row = 6; row <= vmTeamWowLastRow; row += 1) {
    const style = directionStyle(teamWow.getRange(`G${row}`).values[0][0]);
    teamWow.getRange(`G${row}`).format.fill = style.fill;
    teamWow.getRange(`G${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
  setWidths(teamWow, [["A",27],["B",17],["C",15],["D",18],["E",15],["F",13],["G",18],["H",50]]);

  const people = workbook.worksheets.getItem("VM Salespeople");
  for (const range of ["A1:H1", "A2:H2", "A3:H3", "A5:H5"]) ensureMerge(people, range);
  reportTitle(people, "H", "SALESPERSON VOICEMAIL FOLLOW-UP", "One row per included salesperson; the Friday cutoff is applied to every voicemail customer.");
  people.getRange("A3:H3").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  people.getRange("A5:H5").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, size: 9 }, wrapText: true, verticalAlignment: "center" };
  tableHeader(people.getRange("A6:H6")); tableBody(people.getRange(`A7:H${vmPeopleLastRow}`));
  people.getRange(`F7:G${vmPeopleLastRow}`).format.numberFormat = "0.0%";
  for (let row = 7; row <= vmPeopleLastRow; row += 1) {
    const style = resultStyle(people.getRange(`H${row}`).values[0][0]);
    people.getRange(`H${row}`).format.fill = style.fill;
    people.getRange(`H${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
  setWidths(people, [["A",24],["B",14],["C",18],["D",18],["E",18],["F",15],["G",17],["H",19]]);

  const wow = workbook.worksheets.getItem("VM Individual WoW");
  for (const range of ["A1:H1", "A2:H2", "A3:H3", "A5:B5", "C5:D5", "E5:F5", "G5:H5", "A7:B7", "A8:B9", "C7:D7", "C8:D9", "E7:F7", "E8:F9", "G7:H7", "G8:H9", "A11:H11", "A13:H13", `A${vmWowFooterRow}:H${vmWowFooterRow}`]) ensureMerge(wow, range);
  reportTitle(wow, "H", "WEEK-ON-WEEK VOICEMAIL FOLLOW-UP", "Current Monday-to-Friday cohort compared with the immediately previous complete week.");
  wow.getRange("A3:H3").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  wow.getRange("A5:H5").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 9 }, horizontalAlignment: "center" };
  wow.getRange("A7:B9").format.fill = GREEN_PANEL; wow.getRange("C7:D9").format.fill = RED_PANEL; wow.getRange("E7:F9").format.fill = CREAM; wow.getRange("G7:H9").format.fill = PANEL;
  wow.getRange("A11:H11").format = { fill: CREAM, font: { name: "Source Sans 3", bold: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", horizontalAlignment: "center" };
  wow.getRange("A13:H13").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 11 }, borders: { left: { style: "thick", color: BRAND_RED } } };
  tableHeader(wow.getRange("A14:H14")); tableBody(wow.getRange(`A15:H${vmWowLastRow}`));
  wow.getRange(`C15:C${vmWowLastRow}`).format.numberFormat = "0.0%"; wow.getRange(`E15:F${vmWowLastRow}`).format.numberFormat = "0.0%"; wow.getRange(`H15:H${vmWowLastRow}`).format.wrapText = true;
  for (let row = 15; row <= vmWowLastRow; row += 1) {
    const style = directionStyle(wow.getRange(`G${row}`).values[0][0]);
    wow.getRange(`G${row}`).format.fill = style.fill;
    wow.getRange(`G${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
  wow.getRange(`A${vmWowFooterRow}:H${vmWowFooterRow}`).format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  setWidths(wow, [["A",24],["B",15],["C",17],["D",16],["E",17],["F",13],["G",18],["H",50]]);

  const previous = workbook.worksheets.getItem("VM Previous");
  for (const range of ["A1:E1", "A2:E2", `A${vmPreviousFooterStart}:E${vmPreviousFooterEnd}`]) ensureMerge(previous, range);
  reportTitle(previous, "E", "PREVIOUS PERIOD", previousSubtitle);
  previous.getRange("A3:E3").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, size: 9 } };
  tableHeader(previous.getRange("A5:E5")); tableBody(previous.getRange(`A6:E${vmPreviousLastRow}`)); previous.getRange(`D6:D${vmPreviousLastRow}`).format.numberFormat = "0.0%";
  for (let row = 6; row <= vmPreviousLastRow; row += 1) {
    const style = resultStyle(previous.getRange(`E${row}`).values[0][0]);
    previous.getRange(`E${row}`).format.fill = style.fill;
    previous.getRange(`E${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
  previous.getRange(`A${vmPreviousFooterStart}:E${vmPreviousFooterEnd}`).format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  setWidths(previous, [["A",26],["B",15],["C",18],["D",16],["E",20]]);

  const evidence = workbook.worksheets.getItem("VM Evidence");
  for (const range of ["A1:O1", "A2:O2", "A3:O3"]) ensureMerge(evidence, range);
  reportTitle(evidence, "O", "VOICEMAIL LEAD EVIDENCE", "One auditable row per voicemail-only customer in the reporting week.");
  evidence.getRange("A3:O3").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
  tableHeader(evidence.getRange("A5:O5")); tableBody(evidence.getRange(`A6:O${vmEvidenceLastRow}`));
  evidence.getRange(`D6:D${vmEvidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm"; evidence.getRange(`F6:F${vmEvidenceLastRow}`).format.numberFormat = "0.0"; evidence.getRange(`H6:H${vmEvidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm"; evidence.getRange(`I6:I${vmEvidenceLastRow}`).format.numberFormat = "0.0"; evidence.getRange(`K6:K${vmEvidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm";
  setWidths(evidence, [["A",22],["B",14],["C",14],["D",20],["E",12],["F",16],["G",36],["H",20],["I",12],["J",18],["K",20],["L",20],["M",14],["N",18],["O",18]]);

  const method = workbook.worksheets.getItem("VM Methodology");
  for (const range of [
    "A1:H1", "A2:H2", "A3:H3", "A5:H5",
    "B6:D6", "E6:H6",
    "B7:D7", "E7:H7", "B8:D8", "E8:H8", "B9:D9", "E9:H9", "B10:D10", "E10:H10",
    "A12:D12", "E12:H12",
    "A13:C13", "E13:G13", "A14:C14", "E14:G14", "A15:C15", "E15:G15", "A16:C16", "E16:G16",
    "A18:H18", "A19:H19", "A20:H20", "A21:H21", "A22:H22", "A23:H23", "A24:H24",
  ]) ensureMerge(method, range);
  reportTitle(method, "H", "METHODOLOGY & QA", "Definitions, evidence rules and validation checks for the Friday-cutoff report.");
  method.getRange("A3:H3").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, size: 10 }, wrapText: true, verticalAlignment: "center" };
  method.getRange("A5:H5").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 11 }, borders: { left: { style: "thick", color: BRAND_RED } } };
  tableHeader(method.getRange("A6:H6")); tableBody(method.getRange("A7:H10"));
  method.getRange("A7:H10").format.wrapText = true;
  method.getRange("A7:H10").format.rowHeight = 36;
  method.getRange("A12:D12").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 10 } }; method.getRange("E12:H12").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 10 } };
  method.getRange("A18:H18").format = { fill: CREAM, font: { name: "Source Sans 3", bold: true, color: AMBER, size: 10 }, borders: { left: { style: "thick", color: BRAND_RED } } };
  tableBody(method.getRange("A19:H24")); method.getRange("A19:H24").format.wrapText = true;
  method.getRange("A19:H23").format.rowHeight = 24;
  method.getRange("A24:H24").format.rowHeight = 54;
  setWidths(method, [["A",12],["B",18],["C",18],["D",18],["E",22],["F",22],["G",22],["H",18]]);
}

const voicemailSheets = [
  { source: "Start Here", target: "VM Summary", rows: 31, columns: 9 },
  { source: "Team Follow-up", target: "VM Teams", rows: vmTeamLastRow, columns: 9, freeze: 5, table: [`A5:I${vmTeamLastRow}`, "CombinedVMTeamsTable"] },
  { source: "Team Week-on-Week", target: "VM Team WoW", rows: vmTeamWowLastRow, columns: 8, freeze: 5, table: [`A5:H${vmTeamWowLastRow}`, "CombinedVMTeamWoWTable"] },
  { source: "All Salespeople", target: "VM Salespeople", rows: vmPeopleLastRow, columns: 8, freeze: 6, table: [`A6:H${vmPeopleLastRow}`, "CombinedVMSalespeopleTable"] },
  { source: "Week-on-Week", target: "VM Individual WoW", rows: vmWowFooterRow, columns: 8, freeze: 14 },
  { source: "Previous Period", target: "VM Previous", rows: vmPreviousFooterEnd, columns: 5, freeze: 5, table: [`A5:E${vmPreviousLastRow}`, "CombinedVMPreviousTable"] },
  { source: "Lead Evidence", target: "VM Evidence", rows: vmEvidenceLastRow, columns: 15, freeze: 5, table: [`A5:O${vmEvidenceLastRow}`, "CombinedVMEvidenceTable"] },
  { source: "How We Checked", target: "VM Methodology", rows: 24, columns: 8 },
];

for (const definition of voicemailSheets) {
  const target = cloneWorksheet(voicemailWorkbook, definition.source, definition.target, definition.rows, definition.columns, definition.freeze);
  if (definition.table) {
    const [range, name] = definition.table;
    const table = target.tables.add(range, true, name);
    table.style = "TableStyleLight1";
  }
}
styleVoicemailSheets();

const callCurrent = callData.weeks.find((week) => week.period === `${reportStart}_to_${reportEnd}`);
if (!callCurrent) throw new Error("Call Activity data does not contain the current reporting week.");

const summary = workbook.worksheets.getItem("Lead Utilisation Summary");
summary.unmergeCells("A53:R200");
summary.getRange("A53:R200").values = Array.from({ length: 148 }, () => Array(18).fill(null));
summary.getRange("A53:R200").format = { fill: "#FFFFFF", font: { name: "Source Sans 3", color: CHARCOAL, size: 9 } };
for (const range of ["A1:P1", "A2:P2", "A3:P3", "A4:P5"]) ensureMerge(summary, range);
summary.getRange("A1").values = [[leadTypeScope ? `WEEKLY LEAD MANAGEMENT REPORT - ${leadTypeScope.toUpperCase()} ONLY` : "WEEKLY LEAD MANAGEMENT REPORT"]];
summary.getRange("A2").values = [[leadTypeScope ? `${reportSubtitle} | Campaign Lead Type: ${leadTypeScope}` : reportSubtitle]];
summary.getRange("A3").values = [["One weekly pack with three separate lenses. Lead Utilisation measures weekly allocations, Voicemail Follow-up checks weekly voicemail customers, and Call Activity & Rhythm reviews outbound phone activity. Each section keeps its own denominator and validation rules; no blended score is produced."]];
summary.getRange("A4").values = [[`Scope exclusions: ${exclusionDisplay}.`]];
summary.getRange("A1:P1").format = { fill: "#FFFFFF", font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 18 }, verticalAlignment: "center", borders: { left: { style: "thick", color: BRAND_RED } } };
summary.getRange("A1:P1").format.rowHeight = 30;
summary.getRange("A2:P2").format = { fill: "#FFFFFF", font: { name: "Source Sans 3", italic: true, color: SECONDARY, size: 10 }, verticalAlignment: "center" };
summary.getRange("A3:P3").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, size: 10 }, wrapText: true, verticalAlignment: "center" };
summary.getRange("A3:P3").format.rowHeight = 42;
summary.getRange("A4:P5").format = { fill: CREAM, font: { name: "Source Sans 3", color: SECONDARY, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };

mergeAndWrite(summary, "A53:P53", "VOICEMAIL FOLLOW-UP - SEPARATE WEEKLY COHORT");
mergeAndWrite(summary, "A54:P55", `This section is not a subset of weekly Lead Utilisation allocations. It includes New Business voicemail encounters observed during ${compactPeriod(reportStart, reportEnd)}, including customers allocated before the week. A qualifying follow-up is a later outbound call by the same salesperson to the same customer by Friday 11:59:59 pm.`);
for (const range of ["A57:C57", "D57:F57", "G57:I57", "J57:L57", "M57:P57", "A58:C60", "D58:F60", "G58:I60", "J58:L60", "M58:P60"]) summary.mergeCells(range);
for (const [cell, value] of [
  ["A57", "VOICEMAILS CHECKED"], ["D57", "FOLLOWED BY FRIDAY"], ["G57", "NO QUALIFYING FOLLOW-UP"], ["J57", "FOLLOW-UP RATE"], ["M57", "NO LATER CALL FOUND"],
]) summary.getRange(cell).values = [[value]];
summary.getRange("A58").formulas = [["='VM Summary'!A5"]];
summary.getRange("D58").formulas = [["='VM Summary'!C5"]];
summary.getRange("G58").formulas = [["='VM Summary'!E5"]];
summary.getRange("J58").formulas = [["='VM Summary'!C6"]];
summary.getRange("M58").formulas = [["='VM Summary'!G5"]];

mergeAndWrite(summary, "A62:P62", "CROSS-REPORT MANAGER VIEW");
mergeAndWrite(summary, "A63:P63", "Lead Utilisation and Voicemail Follow-up remain separate measures. Week-on-week movement uses each report's own denominator and validation rules; no blended score is produced.");
const headerPairs = [
  ["A65:B65", "MANAGER TEAM"], ["C65:D65", "LEAD ALLOCATIONS"], ["E65:F65", "LEAD UTILISATION"], ["G65:H65", "LEAD WOW"],
  ["I65:J65", "VM CUSTOMERS"], ["K65:L65", "VM FOLLOWED"], ["M65:N65", "VM FOLLOW-UP"], ["O65:P65", "VM WOW"],
];
for (const [range, label] of headerPairs) mergeAndWrite(summary, range, label);

const voicemailComparisonByManager = new Map(voicemailData.teamComparisons.map((item) => [item.manager.toLowerCase(), item]));
const leadTrendByManager = new Map(leadData.ongoingTrends.teams.map((item) => [item.name.toLowerCase(), item]));
const managerNames = leadData.managers.map((item) => item.manager);
if (!managerNames.length) throw new Error("The Lead Utilisation report has no included manager teams.");
const managerSourceLastRow = 5 + managerNames.length;
const managerSummaryLastRow = 65 + managerNames.length;
for (let index = 0; index < managerNames.length; index += 1) {
  const row = 66 + index;
  const manager = managerNames[index];
  for (const range of [`A${row}:B${row}`, `C${row}:D${row}`, `E${row}:F${row}`, `G${row}:H${row}`, `I${row}:J${row}`, `K${row}:L${row}`, `M${row}:N${row}`, `O${row}:P${row}`]) summary.mergeCells(range);
  summary.getRange(`A${row}`).values = [[manager]];
  summary.getRange(`C${row}`).formulas = [[`=SUMIF('Manager Utilisation'!$A$6:$A$${managerSourceLastRow},A${row},'Manager Utilisation'!$C$6:$C$${managerSourceLastRow})`]];
  summary.getRange(`E${row}`).formulas = [[`=IFERROR(SUMIF('Manager Utilisation'!$A$6:$A$${managerSourceLastRow},A${row},'Manager Utilisation'!$D$6:$D$${managerSourceLastRow})/C${row},0)`]];
  summary.getRange(`G${row}`).values = [[leadTrendByManager.get(manager.toLowerCase())?.comparison?.label || "No comparable prior week"]];
  summary.getRange(`I${row}`).formulas = [[`=SUMIF('VM Teams'!$A$6:$A$${vmTeamLastRow},A${row},'VM Teams'!$C$6:$C$${vmTeamLastRow})`]];
  summary.getRange(`K${row}`).formulas = [[`=SUMIF('VM Teams'!$A$6:$A$${vmTeamLastRow},A${row},'VM Teams'!$D$6:$D$${vmTeamLastRow})`]];
  summary.getRange(`M${row}`).formulas = [[`=IFERROR(K${row}/I${row},0)`]];
  summary.getRange(`O${row}`).values = [[ppLabel(voicemailComparisonByManager.get(manager.toLowerCase()))]];
}

summary.getRange("A53:P53").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 12 }, borders: { left: { style: "thick", color: BRAND_RED } }, verticalAlignment: "center" };
summary.getRange("A53:P53").format.rowHeight = 28;
summary.getRange("A54:P55").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };
summary.getRange("A54:P55").format.rowHeight = 22;
for (const [labelRange, valueRange, fill, colour] of [
  ["A57:C57", "A58:C60", PANEL, CHARCOAL],
  ["D57:F57", "D58:F60", GREEN_PANEL, CALLED_GREEN],
  ["G57:I57", "G58:I60", RED_PANEL, WASTED_RED],
  ["J57:L57", "J58:L60", GREEN_PANEL, CALLED_GREEN],
  ["M57:P57", "M58:P60", RED_PANEL, WASTED_RED],
]) {
  summary.getRange(labelRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: SECONDARY, size: 9 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: BORDER } };
  summary.getRange(valueRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: colour, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BORDER } };
}
summary.getRange("A58:I60").format.numberFormat = "#,##0";
summary.getRange("J58:L60").format.numberFormat = "0.0%";
summary.getRange("M58:P60").format.numberFormat = "#,##0";
summary.getRange("A62:P62").format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 12 }, borders: { left: { style: "thick", color: BRAND_RED } }, verticalAlignment: "center" };
summary.getRange("A63:P63").format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center" };
summary.getRange("A65:P65").format = { fill: CHARCOAL, font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 8 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: BORDER } };
summary.getRange("A65:P65").format.rowHeight = 34;
summary.getRange(`A66:P${managerSummaryLastRow}`).format = { font: { name: "Source Sans 3", color: CHARCOAL, size: 9 }, verticalAlignment: "center", borders: { insideHorizontal: { style: "thin", color: BORDER } } };
summary.getRange(`C66:F${managerSummaryLastRow}`).format.numberFormat = "#,##0";
summary.getRange(`E66:F${managerSummaryLastRow}`).format.numberFormat = "0.0%";
summary.getRange(`I66:L${managerSummaryLastRow}`).format.numberFormat = "#,##0";
summary.getRange(`M66:N${managerSummaryLastRow}`).format.numberFormat = "0.0%";
for (let row = 66; row <= managerSummaryLastRow; row += 1) {
  summary.getRange(`A${row}:F${row}`).format.fill = row % 2 === 0 ? "#FFFFFF" : PANEL;
  summary.getRange(`I${row}:N${row}`).format.fill = row % 2 === 0 ? "#FFFFFF" : PANEL;
  for (const [column, label] of [["G", summary.getRange(`G${row}`).values[0][0]], ["O", summary.getRange(`O${row}`).values[0][0]]]) {
    const style = directionStyle(label);
    const endColumn = column === "G" ? "H" : "P";
    summary.getRange(`${column}${row}:${endColumn}${row}`).format.fill = style.fill;
    summary.getRange(`${column}${row}:${endColumn}${row}`).format.font = { name: "Source Sans 3", bold: true, color: style.colour, size: 9 };
  }
}

const callSummaryStartRow = managerSummaryLastRow + 3;
const callCardLabelRow = callSummaryStartRow + 4;
const callCardValueStartRow = callCardLabelRow + 1;
const callSummaryLastRow = callCardValueStartRow + 2;
mergeAndWrite(summary, `A${callSummaryStartRow}:P${callSummaryStartRow}`, "CALL ACTIVITY & RHYTHM - TELEPHONY ACTIVITY REVIEW");
mergeAndWrite(summary, `A${callSummaryStartRow + 1}:P${callSummaryStartRow + 2}`, "This section uses the same included salesperson roster and Monday-to-Friday window. Recorded talk time, short calls and calling pace are review prompts only: they do not prove who answered, call quality, effort or fatigue.");
for (const range of [
  `A${callCardLabelRow}:C${callCardLabelRow}`, `D${callCardLabelRow}:F${callCardLabelRow}`, `G${callCardLabelRow}:I${callCardLabelRow}`, `J${callCardLabelRow}:L${callCardLabelRow}`, `M${callCardLabelRow}:P${callCardLabelRow}`,
  `A${callCardValueStartRow}:C${callSummaryLastRow}`, `D${callCardValueStartRow}:F${callSummaryLastRow}`, `G${callCardValueStartRow}:I${callSummaryLastRow}`, `J${callCardValueStartRow}:L${callSummaryLastRow}`, `M${callCardValueStartRow}:P${callSummaryLastRow}`,
]) summary.mergeCells(range);
for (const [cell, value] of [
  [`A${callCardLabelRow}`, "OUTBOUND CALLS"], [`D${callCardLabelRow}`, "CALLS / PERSON-DAY"], [`G${callCardLabelRow}`, "RECORDED TALK-TIME CALLS"], [`J${callCardLabelRow}`, "CONFIRMED VOICEMAIL"], [`M${callCardLabelRow}`, "TOTAL TALK TIME"],
]) summary.getRange(cell).values = [[value]];
const confirmedVoicemail = callCurrent.overall.contactClassificationBreakdown.find((item) => item.label === "voicemail")?.count || 0;
summary.getRange(`A${callCardValueStartRow}`).values = [[callCurrent.overall.calls]];
summary.getRange(`D${callCardValueStartRow}`).values = [[callCurrent.overall.callsPerPersonDay]];
summary.getRange(`G${callCardValueStartRow}`).values = [[callCurrent.overall.positiveDurationCalls]];
summary.getRange(`J${callCardValueStartRow}`).values = [[confirmedVoicemail]];
summary.getRange(`M${callCardValueStartRow}`).values = [[callCurrent.overall.totalTalkHours]];
summary.getRange(`A${callSummaryStartRow}:P${callSummaryStartRow}`).format = { fill: PANEL, font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 12 }, borders: { left: { style: "thick", color: BRAND_RED } }, verticalAlignment: "center" };
summary.getRange(`A${callSummaryStartRow + 1}:P${callSummaryStartRow + 2}`).format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };
for (const [labelRange, valueRange, fill, colour] of [
  [`A${callCardLabelRow}:C${callCardLabelRow}`, `A${callCardValueStartRow}:C${callSummaryLastRow}`, PANEL, CHARCOAL],
  [`D${callCardLabelRow}:F${callCardLabelRow}`, `D${callCardValueStartRow}:F${callSummaryLastRow}`, "#EAF2F8", "#225E8F"],
  [`G${callCardLabelRow}:I${callCardLabelRow}`, `G${callCardValueStartRow}:I${callSummaryLastRow}`, GREEN_PANEL, CALLED_GREEN],
  [`J${callCardLabelRow}:L${callCardLabelRow}`, `J${callCardValueStartRow}:L${callSummaryLastRow}`, CREAM, AMBER],
  [`M${callCardLabelRow}:P${callCardLabelRow}`, `M${callCardValueStartRow}:P${callSummaryLastRow}`, "#E7F4F3", TEAL],
]) {
  summary.getRange(labelRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: SECONDARY, size: 9 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: BORDER } };
  summary.getRange(valueRange).format = { fill, font: { name: "Source Sans 3", bold: true, color: colour, size: 18 }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BORDER } };
}
summary.getRange(`A${callCardValueStartRow}:C${callSummaryLastRow}`).format.numberFormat = "#,##0";
summary.getRange(`D${callCardValueStartRow}:F${callSummaryLastRow}`).format.numberFormat = "0.0";
summary.getRange(`G${callCardValueStartRow}:L${callSummaryLastRow}`).format.numberFormat = "#,##0";
summary.getRange(`M${callCardValueStartRow}:P${callSummaryLastRow}`).format.numberFormat = "0.0\" h\"";

if (leadData.totals.received !== leadData.totals.called + leadData.totals.wasted) throw new Error("Lead Utilisation totals do not reconcile.");
if (!(leadData.qaChecks || []).every((item) => item.result === "PASS")) throw new Error("Lead Utilisation source QA is not fully passed.");
if (voicemailData.totals.checked !== voicemailData.totals.followed + voicemailData.totals.notByFriday) throw new Error("Voicemail totals do not reconcile.");
if (voicemailData.totals.noLater > voicemailData.totals.notByFriday) throw new Error("Voicemail no-later count exceeds the not-followed count.");
if (!voicemailData.qaChecks?.current?.length || !voicemailData.qaChecks?.previous?.length) throw new Error("Voicemail source QA is incomplete.");
if (callData.schemaVersion !== "call_activity_analysis.v1") throw new Error("Call Activity analysis schema is invalid.");
if (!callData.weeks?.every((week) => week.quality?.reportReconciliation)) throw new Error("Call Activity does not reconcile to Lead Utilisation.");
if (!callData.weeks?.every((week) => week.overall.durationObserved === week.overall.calls)) throw new Error("Call Activity duration coverage is incomplete.");

const keyInspection = await workbook.inspect({ kind: "region", sheetId: "Lead Utilisation Summary", range: `A53:P${callSummaryLastRow}`, include: "values,formulas", maxChars: 16000 });
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "combined workbook formula error scan" });
const errorLines = formulaErrors.ndjson.split(/\r?\n/).filter((line) => line.includes('"kind":"match"'));
if (errorLines.length) throw new Error(`Formula errors detected: ${errorLines.slice(0, 10).join("\n")}`);

const previewDir = path.join(workDir, "xlsx-previews-final");
await fs.mkdir(previewDir, { recursive: true });
const previewRanges = {
  "Lead Utilisation Summary": `A1:R${callSummaryLastRow}`,
  "Salesperson Utilisation": "A1:R63",
  "Manager Utilisation": "A1:Q11",
  "Wasted Lead Detail": "A1:M40",
  "Follow-up Failure Detail": "A1:O40",
  "Methodology & QA": "A1:D40",
  "Allocation Evidence": "A1:R40",
  "Ongoing Overall Trends": "A1:S9",
  "Ongoing Team Trends": "A1:N50",
  "Ongoing Person Trends": "A1:M50",
  "VM Summary": "A1:I31",
  "VM Teams": `A1:I${vmTeamLastRow}`,
  "VM Team WoW": `A1:H${vmTeamWowLastRow}`,
  "VM Salespeople": `A1:H${Math.min(vmPeopleLastRow + 3, 70)}`,
  "VM Individual WoW": `A1:H${vmWowFooterRow}`,
  "VM Previous": `A1:E${vmPreviousFooterEnd}`,
  "VM Evidence": "A1:O40",
  "VM Methodology": "A1:H24",
};
for (const sheet of workbook.worksheets.items) {
  const rendered = await workbook.render({ sheetName: sheet.name, range: previewRanges[sheet.name], scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheet.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`), new Uint8Array(await rendered.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const qa = {
  generatedAt: new Date().toISOString(),
  outputPath,
  sheets: workbook.worksheets.items.map((sheet) => sheet.name),
  leadTotals: leadData.totals,
  voicemailTotals: voicemailData.totals,
  callActivityTotals: {
    outboundCalls: callCurrent.overall.calls,
    recordedTalkTimeCalls: callCurrent.overall.positiveDurationCalls,
    confirmedVoicemail,
    people: callData.currentPeople.length,
    teams: callData.currentTeams.length,
  },
  managerTeams: managerNames,
  formulaErrorMatches: errorLines.length,
  keyInspection: keyInspection.ndjson,
  sourceFiles: [leadWorkbookPath, voicemailWorkbookPath, leadDataPath, voicemailDataPath, callDataPath],
};
await fs.writeFile(qaPath, JSON.stringify(qa, null, 2));
console.log(JSON.stringify({ outputPath, sheetCount: qa.sheets.length, leadTotals: qa.leadTotals, voicemailTotals: qa.voicemailTotals, callActivityTotals: qa.callActivityTotals, formulaErrorMatches: qa.formulaErrorMatches }, null, 2));
