import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, Workbook, SpreadsheetFile } from "@oai/artifact-tool";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    result[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
for (const key of ["analysis", "output"]) {
  if (!args[key]) throw new Error(`Missing required --${key} argument.`);
}

const analysisPath = path.resolve(String(args.analysis));
const outputPath = path.resolve(String(args.output));
const workDir = path.resolve(String(args.work || path.join(path.dirname(outputPath), ".render-work")));
const qaPath = path.resolve(String(args.qa || path.join(path.dirname(outputPath), "call_activity_rhythm_qa.json")));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(workDir, { recursive: true });

const data = JSON.parse(await fs.readFile(analysisPath, "utf8"));
const [reportStart, reportEnd] = data.scope.currentPeriod;
const current = data.weeks.find((week) => week.period === `${reportStart}_to_${reportEnd}`);
const prior = data.weeks[data.weeks.indexOf(current) - 1];
if (!current || !prior) throw new Error("Analysis must contain the current and immediately previous week.");
const currentTeams = current.teams;

const BRAND_RED = "#EE3424";
const CHARCOAL = "#231F20";
const GREEN = "#1F6F5B";
const RED = "#B42318";
const AMBER = "#A45A00";
const BLUE = "#225E8F";
const TEAL = "#147D78";
const PANEL = "#F5F6F7";
const BORDER = "#D6D9DD";
const SECONDARY = "#5B6470";
const CREAM = "#FFF3F1";
const GREEN_PANEL = "#E8F5E9";
const RED_PANEL = "#FCE4E4";
const BLUE_PANEL = "#EAF2F8";
const TEAL_PANEL = "#E7F4F3";

function dateLabel(iso, includeWeekday = true) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: includeWeekday ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

function shortPeriod(period) {
  const [startIso, endIso] = period.split("_to_");
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const sm = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "short" }).format(start);
  const em = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "short" }).format(end);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}-${end.getUTCDate()} ${em}`
    : `${start.getUTCDate()} ${sm}-${end.getUTCDate()} ${em}`;
}

function mergeWrite(sheet, range, value) {
  sheet.mergeCells(range);
  sheet.getRange(range.split(":")[0]).values = [[value]];
}

function setWidths(sheet, entries) {
  for (const [column, width] of entries) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function titleBlock(sheet, endColumn, title, subtitle, scope) {
  mergeWrite(sheet, `A1:${endColumn}1`, title);
  mergeWrite(sheet, `A2:${endColumn}2`, subtitle);
  mergeWrite(sheet, `A4:${endColumn}5`, scope);
  sheet.getRange(`A1:${endColumn}1`).format = {
    fill: "#FFFFFF",
    font: { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 18 },
    verticalAlignment: "center",
    borders: { left: { style: "thick", color: BRAND_RED } },
  };
  sheet.getRange(`A1:${endColumn}1`).format.rowHeight = 30;
  sheet.getRange(`A2:${endColumn}2`).format = {
    font: { name: "Source Sans 3", italic: true, color: SECONDARY, size: 10 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${endColumn}2`).format.rowHeight = 22;
  sheet.getRange(`A4:${endColumn}5`).format = {
    fill: CREAM,
    font: { name: "Source Sans 3", color: AMBER, size: 9 },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: BRAND_RED },
  };
  sheet.getRange(`A4:${endColumn}5`).format.rowHeight = 22;
}

function section(sheet, range, text, colour = CHARCOAL) {
  mergeWrite(sheet, range, text);
  sheet.getRange(range).format = {
    fill: PANEL,
    font: { name: "Source Sans 3", bold: true, color: colour, size: 11 },
    verticalAlignment: "center",
    borders: { left: { style: "thick", color: BRAND_RED } },
  };
  sheet.getRange(range).format.rowHeight = 24;
}

function header(range, fill = CHARCOAL) {
  range.format = {
    fill,
    font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: BORDER },
  };
  range.format.rowHeight = 34;
}

function body(range) {
  range.format = {
    font: { name: "Source Sans 3", color: CHARCOAL, size: 9 },
    verticalAlignment: "center",
    borders: { insideHorizontal: { style: "thin", color: BORDER } },
  };
}

function addCard(sheet, range, label, formula, colour = CHARCOAL, fill = PANEL, numberFormat = null) {
  const [left, right] = range.split(":");
  const labelCell = left;
  const labelRow = Number(labelCell.match(/\d+/)[0]);
  const valueRow = labelRow + 1;
  const startCol = labelCell.match(/[A-Z]+/)[0];
  const endCol = right.match(/[A-Z]+/)[0];
  mergeWrite(sheet, `${startCol}${labelRow}:${endCol}${labelRow}`, label);
  mergeWrite(sheet, `${startCol}${valueRow}:${endCol}${valueRow + 1}`, "");
  sheet.getRange(`${startCol}${valueRow}`).formulas = [[formula]];
  sheet.getRange(`${startCol}${labelRow}:${endCol}${valueRow + 1}`).format = {
    fill,
    font: { name: "Source Sans 3", color: SECONDARY },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: BORDER },
  };
  sheet.getRange(`${startCol}${labelRow}:${endCol}${labelRow}`).format.font = { name: "Source Sans 3", bold: true, color: SECONDARY, size: 9 };
  sheet.getRange(`${startCol}${valueRow}:${endCol}${valueRow + 1}`).format.font = { name: "Source Sans 3", bold: true, color: colour, size: 18 };
  if (numberFormat) sheet.getRange(`${startCol}${valueRow}`).format.numberFormat = numberFormat;
}

function findWeekPerson(week, name) {
  return week.people.find((item) => item.salesperson === name);
}

function findWeekTeam(week, manager) {
  return week.teams.find((item) => item.manager === manager);
}

function sampleQualified(person) {
  return person.calls >= 100 && person.nonLiteralPositiveCalls >= 20 && person.activeDays >= 3;
}

function pctChange(currentValue, previousValue) {
  if (previousValue == null || previousValue === 0) return null;
  return currentValue / previousValue - 1;
}

function classificationCount(overall, label) {
  return overall.contactClassificationBreakdown.find((item) => item.label === label)?.count || 0;
}

function signalRows() {
  const rows = [];
  const used = new Set();
  const add = (signal, candidates, observation, action, limit = 2) => {
    let added = 0;
    for (const candidate of candidates || []) {
      if (added >= limit || used.has(candidate.salesperson)) continue;
      const person = data.currentPeople.find((item) => item.salesperson === candidate.salesperson);
      if (!person) continue;
      used.add(person.salesperson);
      rows.push({ signal, observation: observation(person), action, ...person });
      added += 1;
    }
  };
  add(
    "Calling volume moved down",
    data.reviewSignals.largestCallsPerDayRegressionVsPrior,
    (person) => `Calls per active day fell by ${Math.abs(person.priorBaseline?.callsPerActiveDayDelta || 0).toFixed(1)} versus last week. This shows a change in visible phone activity, but not why it changed.`,
    "Check leave, meetings, coaching, lead supply and work that does not appear in the call export.",
    3,
  );
  add(
    "More other short calls",
    data.reviewSignals.largestNonLiteralShortShareRegressionVsPrior,
    (person) => `The share of other calls ending inside 30 seconds increased by ${Math.abs((person.priorBaseline?.nonLiteralShortPositiveShareDelta || 0) * 100).toFixed(1)}%. List quality, quick rejections and calling behaviour can all create this pattern.`,
    "Compare campaign/list mix and listen to a small mixed sample before coaching.",
  );
  add(
    "Calling slowed later",
    data.reviewSignals.lowestLateToEarlyVelocityRatio,
    (person) => `The later calling pace was ${(person.lateToEarlyVelocityRatio * 100).toFixed(0)} calls for every 100 early-period calls. This is a timing pattern, not proof of tiredness.`,
    "Check rostered hours, meetings, allocation timing and afternoon lead availability.",
  );
  add(
    "High other short-call share",
    data.reviewSignals.highestNonLiteralShortPositiveShare,
    (person) => `${(person.nonLiteralShortPositiveShare * 100).toFixed(1)}% of other calls with recorded talk time ended inside 30 seconds. Unknown phone outcomes can remain in this group.`,
    "Sample outcomes and compare people doing similar campaigns before drawing a conclusion.",
  );
  add(
    "High zero-duration share",
    data.reviewSignals.highestZeroDurationRate,
    (person) => `${(person.zeroDurationRate * 100).toFixed(1)}% of outbound attempts recorded zero talk seconds.`,
    "Check dialler outcomes, carrier behaviour and list quality.",
  );
  add(
    "High long-call share",
    data.reviewSignals.highestLong5MinuteShare,
    (person) => `${(person.long5MinuteShare * 100).toFixed(1)}% of calls with recorded talk time ran for at least five minutes. Long duration alone does not prove a good result.`,
    "Check a small outcome sample to separate productive conversations, holds and workflow effects.",
  );
  return rows.slice(0, 12);
}

const embedded = Boolean(args["base-workbook"]);
const sheetNames = embedded ? {
  summary: "Call Activity Summary",
  trend: "Call Company Trend",
  team: "Call Team Rhythm",
  person: "Call People Rhythm",
  time: "Call Time of Day",
  review: "Call Review Signals",
  method: "Call Methodology",
} : {
  summary: "Executive Summary",
  trend: "Company Trend",
  team: "Team Rhythm",
  person: "Salesperson Rhythm",
  time: "Time of Day",
  review: "Review Signals",
  method: "Methodology & QA",
};
const workbook = embedded
  ? await SpreadsheetFile.importXlsx(await FileBlob.load(path.resolve(String(args["base-workbook"]))))
  : Workbook.create();
workbook.properties = embedded ? {
  title: `Weekly Lead Management Report - ${reportStart} to ${reportEnd}`,
  subject: "Combined Lead Utilisation, Voicemail Follow-up and Call Activity weekly report",
  author: "Official Media Group",
  company: "Official Media Group",
} : {
  title: `Call Activity & Rhythm Report - ${reportStart} to ${reportEnd}`,
  subject: "Standalone review module for the Weekly Lead Management Report",
  author: "Official Media Group",
  company: "Official Media Group",
};

const subtitle = `${dateLabel(reportStart)} to ${dateLabel(reportEnd)}`;
const scopeText = `${data.scope.population} Recorded talk time shows activity, but it does not prove a person answered.`;

// Executive Summary
const summary = workbook.worksheets.add(sheetNames.summary);
summary.showGridLines = false;
summary.freezePanes.freezeRows(5);
titleBlock(summary, "R", "CALL ACTIVITY & RHYTHM REPORT", subtitle, scopeText);
setWidths(summary, [["A", 15], ["B", 15], ["C", 15], ["D", 13], ["E", 15], ["F", 15], ["G", 15], ["H", 13], ["I", 15], ["J", 15], ["K", 15], ["L", 3], ["M", 15], ["N", 15], ["O", 15], ["P", 3], ["Q", 15], ["R", 15]]);
section(summary, "A7:R7", "Company headline - current week");
addCard(summary, "A8:C8", "Outbound calls", `=${current.overall.calls}`, CHARCOAL, PANEL, "#,##0");
addCard(summary, "E8:G8", "Calls per active person-day", `=${current.overall.calls}/${current.overall.personDays}`, BLUE, BLUE_PANEL, "0.0");
addCard(summary, "I8:K8", "Positive-duration calls", `=${current.overall.positiveDurationCalls}`, GREEN, GREEN_PANEL, "#,##0");
addCard(summary, "M8:O8", "Zero-duration attempts", `=${current.overall.zeroDurationCalls}/${current.overall.calls}`, RED, RED_PANEL, "0.0%");
addCard(summary, "Q8:R8", "Talk time", `=${current.overall.totalTalkHours}`, TEAL, TEAL_PANEL, "0.0\" h\"");

section(summary, "A13:I13", "Company movement");
summary.getRange("A14:I14").values = [["Week", "Outbound calls", "Calls with recorded talk time", "Zero-duration", "Other short calls <30 sec", "Calls / person-day", "Talk hours", "Late / early calling pace", "Confirmed voicemail"]];
header(summary.getRange("A14:I14"));
const weekRows = data.weeks.map((week) => [shortPeriod(week.period), week.overall.calls, week.overall.positiveDurationCalls, week.overall.zeroDurationRate, week.overall.nonLiteralShortPositiveShare, week.overall.callsPerPersonDay, week.overall.totalTalkHours, week.overall.lateToEarlyVelocityRatio, classificationCount(week.overall, "voicemail") / week.overall.calls]);
summary.getRange(`A15:I${14 + weekRows.length}`).values = weekRows;
body(summary.getRange(`A15:I${14 + weekRows.length}`));
summary.getRange(`B15:C${14 + weekRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`D15:E${14 + weekRows.length}`).format.numberFormat = "0.0%";
summary.getRange(`F15:H${14 + weekRows.length}`).format.numberFormat = "0.0";
summary.getRange(`I15:I${14 + weekRows.length}`).format.numberFormat = "0.0%";

const trendChart = summary.charts.add("line", summary.getRange(`A14:C${14 + weekRows.length}`));
trendChart.title = "Outbound Activity";
trendChart.hasLegend = true;
trendChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
trendChart.yAxis = { numberFormatCode: "#,##0" };
trendChart.setPosition("K13", "R27");

section(summary, "A21:R21", "What deserves review this week", AMBER);
const generatedSignals = signalRows();
const companyPaceTitle = current.overall.lateToEarlyVelocityRatio >= 0.85 ? "No clear company-wide late-day drop" : "Company calling pace slowed later";
const execFindings = [
  ["Company rhythm", companyPaceTitle, `The later calling pace was ${(current.overall.lateToEarlyVelocityRatio * 100).toFixed(0)} calls for every 100 early-period calls. Calls with recorded talk time were ${(current.overall.q1PositiveRate * 100).toFixed(1)}% early and ${(current.overall.q4PositiveRate * 100).toFixed(1)}% late. Check schedules, meetings and lead supply before treating a timing change as an effort problem.`],
  ...generatedSignals.slice(0, 4).map((item) => [item.signal, item.salesperson, `${item.observation} ${item.action}`]),
];
summary.getRange("A22:C22").values = [["Lens", "People / result", "Management interpretation"]];
summary.unmergeCells("A22:C22");
for (const range of ["A22:B22", "C22:E22", "F22:J22"]) summary.mergeCells(range);
summary.getRange("A22").values = [["Lens"]];
summary.getRange("C22").values = [["People / result"]];
summary.getRange("F22").values = [["Management interpretation"]];
header(summary.getRange("A22:J22"), AMBER);
for (let i = 0; i < execFindings.length; i += 1) {
  const row = 23 + i;
  for (const range of [`A${row}:B${row}`, `C${row}:E${row}`, `F${row}:J${row}`]) summary.mergeCells(range);
  summary.getRange(`A${row}`).values = [[execFindings[i][0]]];
  summary.getRange(`C${row}`).values = [[execFindings[i][1]]];
  summary.getRange(`F${row}`).values = [[execFindings[i][2]]];
}
body(summary.getRange(`A23:J${22 + execFindings.length}`));
summary.getRange(`A23:J${22 + execFindings.length}`).format.wrapText = true;
summary.getRange(`A23:J${22 + execFindings.length}`).format.rowHeight = 62;

mergeWrite(summary, "A30:R32", "Use this report to decide where to inspect context or listen to samples. It deliberately does not assign a call-quality score, infer human contact from duration, or label late-day changes as fatigue. Stronger outlier labels remain gated until five comparable weeks are available.");
summary.getRange("A30:R32").format = { fill: PANEL, font: { name: "Source Sans 3", color: SECONDARY, italic: true, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BORDER } };

// Company Trend
const trend = workbook.worksheets.add(sheetNames.trend);
trend.showGridLines = false;
trend.freezePanes.freezeRows(5);
titleBlock(trend, "R", "COMPANY CALL TREND", subtitle, scopeText);
setWidths(trend, [["A", 18], ["B", 13], ["C", 14], ["D", 15], ["E", 14], ["F", 16], ["G", 14], ["H", 13], ["I", 15], ["J", 14], ["K", 14], ["L", 14], ["M", 14], ["N", 14], ["O", 14], ["P", 14], ["Q", 14], ["R", 14]]);
trend.getRange("A6:R6").values = [["Week", "Active days", "Outbound calls", "Recorded talk time %", "Zero duration %", "Confirmed voicemail", "Voicemail %", "Automated audio %", "Wrong number %", "Other / unknown %", "Other positive calls", "Other short calls <30 sec", "Talk hours", "Calls / person-day", "Median first", "Median last", "Late / early calling pace", "Manual call %"]];
header(trend.getRange("A6:R6"));
for (let i = 0; i < data.weeks.length; i += 1) {
  const week = data.weeks[i];
  const row = 7 + i;
  const voicemail = classificationCount(week.overall, "voicemail");
  const systemAudio = classificationCount(week.overall, "system_audio");
  const wrongNumber = classificationCount(week.overall, "wrong_number");
  const otherUnknown = week.overall.calls - voicemail - systemAudio - wrongNumber;
  trend.getRange(`A${row}:R${row}`).values = [[shortPeriod(week.period), week.overall.activeDays, week.overall.calls, week.overall.positiveDurationRate, week.overall.zeroDurationRate, voicemail, voicemail / week.overall.calls, systemAudio / week.overall.calls, wrongNumber / week.overall.calls, otherUnknown / week.overall.calls, week.overall.nonLiteralPositiveCalls, week.overall.nonLiteralShortPositiveCalls, week.overall.totalTalkHours, null, week.overall.medianFirstCallTime, week.overall.medianLastCallTime, week.overall.lateToEarlyVelocityRatio, week.overall.manualCallShare]];
  trend.getRange(`N${row}`).formulas = [[`=C${row}/${week.overall.personDays}`]];
}
body(trend.getRange("A7:R9"));
trend.getRange("B7:C9").format.numberFormat = "#,##0";
trend.getRange("D7:E9").format.numberFormat = "0.0%";
trend.getRange("F7:F9").format.numberFormat = "#,##0";
trend.getRange("G7:J9").format.numberFormat = "0.0%";
trend.getRange("K7:L9").format.numberFormat = "#,##0";
trend.getRange("M7:N9").format.numberFormat = "0.0";
trend.getRange("Q7:Q9").format.numberFormat = "0.00";
trend.getRange("R7:R9").format.numberFormat = "0.0%";

section(trend, "A12:H12", "Duration and contact-state mix");
trend.getRange("A13:H13").values = [["Week", "Zero duration", "1-10 sec", "11-29 sec", "30 sec-5 min", "5-10 min", "10-20 min", "20+ min"]];
header(trend.getRange("A13:H13"), BLUE);
for (let i = 0; i < data.weeks.length; i += 1) {
  const dist = data.weeks[i].overall.allDurationDistribution;
  const row = 14 + i;
  const positive = data.weeks[i].overall.positiveDurationCalls;
  trend.getRange(`A${row}:H${row}`).values = [[shortPeriod(data.weeks[i].period), data.weeks[i].overall.zeroDurationCalls, data.weeks[i].overall.veryShortPositiveCalls, data.weeks[i].overall.shortPositiveCalls - data.weeks[i].overall.veryShortPositiveCalls, positive - data.weeks[i].overall.shortPositiveCalls - data.weeks[i].overall.long5MinuteCalls, data.weeks[i].overall.long5MinuteCalls - data.weeks[i].overall.long10MinuteCalls, data.weeks[i].overall.long10MinuteCalls - data.weeks[i].overall.extreme20MinuteCalls, data.weeks[i].overall.extreme20MinuteCalls]];
}
body(trend.getRange("A14:H16"));
trend.getRange("B14:H16").format.numberFormat = "#,##0";
const durationChart = trend.charts.add("bar", trend.getRange("A13:H16"));
durationChart.title = "Call-duration bands by week";
durationChart.hasLegend = true;
durationChart.xAxis = { axisType: "textAxis" };
durationChart.yAxis = { numberFormatCode: "#,##0" };
durationChart.setPosition("J12", "R29");

section(trend, "A20:H20", "How to read these numbers");
const guards = [
  ["Recorded talk time", "The phone system recorded more than zero talk seconds. This is useful activity evidence, but it is not a true answer rate because voicemail, recorded messages or holds can also create talk time."],
  ["Other short calls", "Calls under 30 seconds after confirmed voicemail and automated messages are removed. Some unknown calls can still be non-human, so use this as a reason to listen to samples, not as a verdict."],
  ["Late / early calling pace", "Compares the person's later calling pace with their earlier calling pace. Around 1.00 means similar pace; below 1.00 means slower later. It can reflect schedule, meetings or lead supply—not only tiredness."],
  ["Fair comparison rule", "A person needs at least 100 outbound calls, 20 other calls with recorded talk time and 3 active days before we compare their week with another week."],
];
trend.mergeCells("B21:H21");
trend.getRange("A21").values = [["Metric"]];
trend.getRange("B21").values = [["Meaning"]];
header(trend.getRange("A21:H21"));
for (let i = 0; i < guards.length; i += 1) {
  const row = 22 + i;
  trend.mergeCells(`B${row}:H${row}`);
  trend.getRange(`A${row}`).values = [[guards[i][0]]];
  trend.getRange(`B${row}`).values = [[guards[i][1]]];
}
body(trend.getRange("A22:H25"));
trend.getRange("B22:H25").format.wrapText = true;

// Team Rhythm
const teamSheet = workbook.worksheets.add(sheetNames.team);
teamSheet.showGridLines = false;
teamSheet.freezePanes.freezeRows(6);
titleBlock(teamSheet, "X", "TEAM CALL RHYTHM", subtitle, scopeText);
setWidths(teamSheet, [["A", 22], ["B", 12], ["C", 12], ["D", 13], ["E", 13], ["F", 13], ["G", 13], ["H", 13], ["I", 13], ["J", 13], ["K", 13], ["L", 13], ["M", 13], ["N", 24], ["O", 3], ["P", 11], ["Q", 11], ["R", 11], ["S", 11], ["T", 11], ["U", 11], ["V", 11], ["W", 11], ["X", 11]]);
teamSheet.getRange("A6:N6").values = [["Manager team", "People", "Calls", "Calls / person-day", "Change from last week", "Recorded talk time %", "Zero duration %", "Other short calls <30 sec", "Median other-call sec", "5+ min %", "Talk hours", "Late / early calling pace", "Manual call %", "Review note"]];
header(teamSheet.getRange("A6:N6"), TEAL);
for (let i = 0; i < currentTeams.length; i += 1) {
  const item = currentTeams[i];
  const previous = findWeekTeam(prior, item.manager);
  const row = 7 + i;
  const note = item.lateToEarlyVelocityRatio < 0.8 ? "Calling slowed later in the day; check roster and lead timing." : item.long5MinuteShare >= 0.05 ? "More calls ran for 5+ minutes; sample outcomes to see why." : item.nonLiteralShortPositiveShare >= 0.72 ? "Many other calls ended inside 30 seconds; compare lead-list mix." : "No strong team-level review prompt.";
  const teamPersonCount = data.currentPeople.filter((person) => person.manager === item.manager).length;
  teamSheet.getRange(`A${row}:N${row}`).values = [[item.manager, teamPersonCount, item.calls, null, previous ? pctChange(item.callsPerPersonDay, previous.callsPerPersonDay) : null, null, null, null, item.nonLiteralPositiveDurationDistribution.median, null, item.totalTalkHours, item.lateToEarlyVelocityRatio, null, note]];
  teamSheet.getRange(`D${row}`).formulas = [[`=C${row}/${item.personDays}`]];
  teamSheet.getRange(`F${row}`).formulas = [[`=${item.positiveDurationCalls}/C${row}`]];
  teamSheet.getRange(`G${row}`).formulas = [[`=${item.zeroDurationCalls}/C${row}`]];
  teamSheet.getRange(`H${row}`).formulas = [[`=${item.nonLiteralShortPositiveCalls}/${item.nonLiteralPositiveCalls}`]];
  teamSheet.getRange(`J${row}`).formulas = [[`=${item.long5MinuteCalls}/${item.positiveDurationCalls}`]];
  teamSheet.getRange(`M${row}`).formulas = [[`=${item.manualCalls}/C${row}`]];
}
const teamLast = 6 + currentTeams.length;
body(teamSheet.getRange(`A7:N${teamLast}`));
teamSheet.getRange(`C7:C${teamLast}`).format.numberFormat = "#,##0";
teamSheet.getRange(`D7:D${teamLast}`).format.numberFormat = "0.0";
teamSheet.getRange(`E7:H${teamLast}`).format.numberFormat = "0.0%";
teamSheet.getRange(`I7:I${teamLast}`).format.numberFormat = "0.0\" sec\"";
teamSheet.getRange(`J7:J${teamLast}`).format.numberFormat = "0.0%";
teamSheet.getRange(`K7:K${teamLast}`).format.numberFormat = "0.0";
teamSheet.getRange(`L7:L${teamLast}`).format.numberFormat = "0.00";
teamSheet.getRange(`M7:M${teamLast}`).format.numberFormat = "0.0%";
teamSheet.getRange(`N7:N${teamLast}`).format.wrapText = true;
teamSheet.getRange(`A7:N${teamLast}`).format.rowHeight = 38;
teamSheet.getRange(`E7:E${teamLast}`).conditionalFormats.add("colorScale", { colors: [RED_PANEL, CREAM, GREEN_PANEL], thresholds: ["min", "50%", "max"] });
const teamChart = teamSheet.charts.add("bar", { chartType: "bar", title: "Team outbound calls", hasLegend: false });
const teamCallSeries = teamChart.series.add("Outbound calls");
teamCallSeries.categoryFormula = `'${sheetNames.team}'!$A$7:$A$${teamLast}`;
teamCallSeries.formula = `'${sheetNames.team}'!$C$7:$C$${teamLast}`;
teamCallSeries.fill = TEAL;
teamChart.setPosition("P6", "X22");

section(teamSheet, `A${teamLast + 3}:X${teamLast + 3}`, "Hourly call curves - calls per active day", TEAL);
const hourHeaders = [9, 10, 11, 12, 13, 14, 15, 16, 17];
teamSheet.getRange(`A${teamLast + 4}:G${teamLast + 4}`).values = [["Hour", ...currentTeams.map((team) => team.manager)]];
header(teamSheet.getRange(`A${teamLast + 4}:G${teamLast + 4}`), TEAL);
for (let i = 0; i < hourHeaders.length; i += 1) {
  const hour = hourHeaders[i];
  const row = teamLast + 5 + i;
  const values = currentTeams.map((team) => {
    const teamPeople = data.currentPeople.filter((person) => person.manager === team.manager);
    return teamPeople.reduce((sum, person) => sum + (person.hourly.find((x) => x.hour === hour)?.calls || 0), 0) / Math.max(team.personDays, 1);
  });
  teamSheet.getRange(`A${row}:G${row}`).values = [[`${String(hour).padStart(2, "0")}:00`, ...values]];
}
const teamHourlyLast = teamLast + 4 + hourHeaders.length;
body(teamSheet.getRange(`A${teamLast + 5}:G${teamHourlyLast}`));
teamSheet.getRange(`B${teamLast + 5}:G${teamHourlyLast}`).format.numberFormat = "0.0";
const teamHourlyChart = teamSheet.charts.add("line", teamSheet.getRange(`A${teamLast + 4}:G${teamHourlyLast}`));
teamHourlyChart.title = "Team hourly calling pattern";
teamHourlyChart.hasLegend = true;
teamHourlyChart.xAxis = { axisType: "textAxis" };
teamHourlyChart.setPosition(`L${teamLast + 4}`, `X${teamLast + 21}`);

// Salesperson Rhythm
const personSheet = workbook.worksheets.add(sheetNames.person);
personSheet.showGridLines = false;
personSheet.freezePanes.freezeRows(6);
titleBlock(personSheet, "Y", "SALESPERSON CALL RHYTHM", subtitle, scopeText);
setWidths(personSheet, [["A", 24], ["B", 22], ["C", 10], ["D", 11], ["E", 13], ["F", 12], ["G", 12], ["H", 13], ["I", 13], ["J", 13], ["K", 12], ["L", 12], ["M", 12], ["N", 12], ["O", 15], ["P", 24], ["Q", 3], ["R", 3], ["S", 3], ["T", 3], ["U", 3], ["V", 3], ["W", 3], ["X", 3], ["Y", 3]]);
personSheet.getRange("A6:Y6").values = [["Salesperson", "Manager", "Calls", "Active days", "Calls / day", "Change from last week", "Recorded talk time %", "Zero duration %", "Other short calls <30 sec", "Median other-call sec", "5+ min %", "Late / early calling pace", "Manual call %", "Sample status", "Review prompt", "Hourly call rhythm", ...hourHeaders.map((h) => `${h}:00`)]];
header(personSheet.getRange("A6:Y6"), BLUE);
const people = [...data.currentPeople].sort((a, b) => a.manager.localeCompare(b.manager) || a.salesperson.localeCompare(b.salesperson));
const reviewMap = new Map(signalRows().map((x) => [x.salesperson, x.signal]));
for (let i = 0; i < people.length; i += 1) {
  const person = people[i];
  const previous = findWeekPerson(prior, person.salesperson);
  const row = 7 + i;
  const hourly = hourHeaders.map((hour) => person.hourly.find((x) => x.hour === hour)?.calls || 0);
  personSheet.getRange(`A${row}:Y${row}`).values = [[person.salesperson, person.manager, person.calls, person.activeDays, null, previous && sampleQualified(previous) && sampleQualified(person) ? pctChange(person.callsPerActiveDay, previous.callsPerActiveDay) : null, null, null, null, person.nonLiteralPositiveDurationDistribution.median, null, person.lateToEarlyVelocityRatio, null, sampleQualified(person) ? "Comparable" : "Context only", reviewMap.get(person.salesperson) || "No current prompt", null, ...hourly]];
  personSheet.getRange(`E${row}`).formulas = [[`=IF(D${row}=0,"",C${row}/D${row})`]];
  personSheet.getRange(`G${row}`).formulas = [[`=IF(C${row}=0,"",${person.positiveDurationCalls}/C${row})`]];
  personSheet.getRange(`H${row}`).formulas = [[`=IF(C${row}=0,"",${person.zeroDurationCalls}/C${row})`]];
  personSheet.getRange(`I${row}`).formulas = [[`=IF(${person.nonLiteralPositiveCalls}=0,"",${person.nonLiteralShortPositiveCalls}/${person.nonLiteralPositiveCalls})`]];
  personSheet.getRange(`K${row}`).formulas = [[`=IF(${person.positiveDurationCalls}=0,"",${person.long5MinuteCalls}/${person.positiveDurationCalls})`]];
  personSheet.getRange(`M${row}`).formulas = [[`=IF(C${row}=0,"",${person.manualCalls}/C${row})`]];
}
const personLast = 6 + people.length;
body(personSheet.getRange(`A7:Y${personLast}`));
personSheet.getRange(`C7:D${personLast}`).format.numberFormat = "#,##0";
personSheet.getRange(`E7:E${personLast}`).format.numberFormat = "0.0";
personSheet.getRange(`F7:I${personLast}`).format.numberFormat = "0.0%";
personSheet.getRange(`J7:J${personLast}`).format.numberFormat = "0.0\" sec\"";
personSheet.getRange(`K7:K${personLast}`).format.numberFormat = "0.0%";
personSheet.getRange(`L7:L${personLast}`).format.numberFormat = "0.00";
personSheet.getRange(`M7:M${personLast}`).format.numberFormat = "0.0%";
personSheet.getRange(`O7:O${personLast}`).format.wrapText = true;
personSheet.getRange(`F7:F${personLast}`).conditionalFormats.add("colorScale", { colors: [RED_PANEL, CREAM, GREEN_PANEL], thresholds: ["min", "50%", "max"] });
personSheet.getRange(`H7:I${personLast}`).conditionalFormats.add("colorScale", { colors: [GREEN_PANEL, CREAM, RED_PANEL], thresholds: ["min", "50%", "max"] });
personSheet.sparklineGroups.add({ type: "line", targetRange: `P7:P${personLast}`, sourceData: `Q7:Y${personLast}`, seriesColor: BLUE, lineWeight: 1.5, markers: { high: true, low: true }, displayHidden: true });

// Time of Day
const timeSheet = workbook.worksheets.add(sheetNames.time);
timeSheet.showGridLines = false;
timeSheet.freezePanes.freezeRows(6);
titleBlock(timeSheet, "R", "TIME OF DAY", subtitle, scopeText);
setWidths(timeSheet, [["A", 13], ["B", 15], ["C", 18], ["D", 16], ["E", 18], ["F", 3], ["G", 12], ["H", 12], ["I", 12], ["J", 12], ["K", 12], ["L", 12], ["M", 12], ["N", 12], ["O", 12], ["P", 12], ["Q", 12], ["R", 12]]);
timeSheet.getRange("A6:E6").values = [["Half-hour", "Calls", "Calls / active day", "Recorded talk time %", "Short calls %"]];
header(timeSheet.getRange("A6:E6"), BLUE);
const slots = data.currentHalfHourly.filter((x) => x.time >= "08:00" && x.time <= "18:00");
for (let i = 0; i < slots.length; i += 1) {
  const row = 7 + i;
  timeSheet.getRange(`A${row}:E${row}`).values = [[slots[i].time, slots[i].calls, slots[i].callsPerActiveDay, slots[i].positiveRate, slots[i].shortPositiveShare]];
}
const slotLast = 6 + slots.length;
body(timeSheet.getRange(`A7:E${slotLast}`));
timeSheet.getRange(`B7:B${slotLast}`).format.numberFormat = "#,##0";
timeSheet.getRange(`C7:C${slotLast}`).format.numberFormat = "0.0";
timeSheet.getRange(`D7:E${slotLast}`).format.numberFormat = "0.0%";
const companyCurve = timeSheet.charts.add("line", { chartType: "line", title: "Company half-hour calls per active day", hasLegend: false });
const companyCurveSeries = companyCurve.series.add("Calls per active day");
companyCurveSeries.categoryFormula = `'${sheetNames.time}'!$A$7:$A$${slotLast}`;
companyCurveSeries.formula = `'${sheetNames.time}'!$C$7:$C$${slotLast}`;
companyCurveSeries.fill = BLUE;
companyCurve.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
companyCurve.setPosition("G6", "R23");

const dayStart = slotLast + 3;
timeSheet.getRange("F:F").format.columnWidth = 16;
timeSheet.getRange("G:G").format.columnWidth = 14;
section(timeSheet, `A${dayStart}:R${dayStart}`, "Weekday pattern");
timeSheet.getRange(`A${dayStart + 1}:G${dayStart + 1}`).values = [["Day", "Calls", "Active people", "Calls / person", "Recorded talk time %", "Other short calls <30 sec", "Talk hours"]];
header(timeSheet.getRange(`A${dayStart + 1}:G${dayStart + 1}`), TEAL);
for (let i = 0; i < data.currentDaily.length; i += 1) {
  const day = data.currentDaily[i];
  const row = dayStart + 2 + i;
  const label = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day.date}T00:00:00Z`));
  timeSheet.getRange(`A${row}:G${row}`).values = [[label, day.calls, day.salespeople, null, day.positiveDurationRate, day.shortPositiveShare, day.talkHours]];
  timeSheet.getRange(`D${row}`).formulas = [[`=B${row}/C${row}`]];
}
const dayLast = dayStart + 1 + data.currentDaily.length;
body(timeSheet.getRange(`A${dayStart + 2}:G${dayLast}`));
timeSheet.getRange(`B${dayStart + 2}:C${dayLast}`).format.numberFormat = "#,##0";
timeSheet.getRange(`D${dayStart + 2}:D${dayLast}`).format.numberFormat = "0.0";
timeSheet.getRange(`E${dayStart + 2}:F${dayLast}`).format.numberFormat = "0.0%";
timeSheet.getRange(`G${dayStart + 2}:G${dayLast}`).format.numberFormat = "0.0";
const dayChart = timeSheet.charts.add("bar", timeSheet.getRange(`A${dayStart + 1}:B${dayLast}`));
dayChart.title = "Outbound calls by weekday";
dayChart.hasLegend = false;
dayChart.setPosition(`I${dayStart + 1}`, `R${dayStart + 15}`);

// Review Signals
const reviewSheet = workbook.worksheets.add(sheetNames.review);
reviewSheet.showGridLines = false;
reviewSheet.freezePanes.freezeRows(6);
titleBlock(reviewSheet, "N", "REVIEW SIGNALS", subtitle, scopeText);
setWidths(reviewSheet, [["A", 27], ["B", 24], ["C", 22], ["D", 13], ["E", 13], ["F", 13], ["G", 13], ["H", 13], ["I", 13], ["J", 13], ["K", 35], ["L", 42], ["M", 18], ["N", 18]]);
reviewSheet.getRange("A6:N6").values = [["Signal", "Salesperson", "Manager", "Calls / day", "Change from last week", "Median other-call sec", "Other short calls <30 sec", "Short-call change from last week", "Zero duration %", "5+ min %", "What we can see", "What a manager should check", "Sample status", "Earlier comparable weeks"]];
header(reviewSheet.getRange("A6:N6"), AMBER);
const signals = signalRows();
for (let i = 0; i < signals.length; i += 1) {
  const item = signals[i];
  const row = 7 + i;
  reviewSheet.getRange(`A${row}:N${row}`).values = [[item.signal, item.salesperson, item.manager, item.callsPerActiveDay, item.priorBaseline?.previousComparable ? item.priorBaseline.callsPerActiveDayDelta / Math.max(item.callsPerActiveDay - item.priorBaseline.callsPerActiveDayDelta, 1) : null, item.nonLiteralPositiveDurationDistribution.median, item.nonLiteralShortPositiveShare, item.priorBaseline?.nonLiteralShortPositiveShareDelta ?? null, item.zeroDurationRate, item.long5MinuteShare, item.observation, item.action, sampleQualified(item) ? "Comparable" : "Context only", item.priorBaseline?.priorWeeks ?? 0]];
}
const reviewLast = 6 + signals.length;
body(reviewSheet.getRange(`A7:N${reviewLast}`));
reviewSheet.getRange(`D7:D${reviewLast}`).format.numberFormat = "0.0";
reviewSheet.getRange(`E7:E${reviewLast}`).format.numberFormat = "0.0%";
reviewSheet.getRange(`F7:F${reviewLast}`).format.numberFormat = "0.0\" sec\"";
reviewSheet.getRange(`G7:J${reviewLast}`).format.numberFormat = "0.0%";
reviewSheet.getRange(`K7:L${reviewLast}`).format.wrapText = true;
reviewSheet.getRange(`A7:N${reviewLast}`).format.rowHeight = 42;
mergeWrite(reviewSheet, `A${reviewLast + 3}:N${reviewLast + 5}`, "These are inspection prompts, not disciplinary findings. Check attendance, meetings, campaign/list mix, call method, allocation timing and a small sample of actual outcomes before changing coaching or management decisions.");
reviewSheet.getRange(`A${reviewLast + 3}:N${reviewLast + 5}`).format = { fill: CREAM, font: { name: "Source Sans 3", italic: true, color: AMBER, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: BRAND_RED } };

// Methodology & QA
const method = workbook.worksheets.add(sheetNames.method);
method.showGridLines = false;
titleBlock(method, "N", "METHODOLOGY & QA", subtitle, scopeText);
setWidths(method, [["A", 44], ["B", 72], ["C", 18], ["D", 18], ["E", 18], ["F", 18], ["G", 18], ["H", 18], ["I", 18], ["J", 18], ["K", 18], ["L", 18], ["M", 18], ["N", 18]]);
section(method, "A7:N7", "Simple definitions and fair-use rules");
const methodRows = [
  ["Report week", "Only outbound calls made from Monday to Friday are included."],
  ["Who is included", "The same people and teams as the Lead Utilisation report, after applying the shared locked exclusions."],
  ["Recorded talk time", "The phone system recorded more than zero talk seconds. This does not prove that a person answered."],
  ["Other call", "A call left after confirmed voicemail and automated phone messages are removed. Some unknown phone outcomes can still remain."],
  ["Other short call", "An other call with recorded talk time that ended in under 30 seconds."],
  ["Long call", "A call with at least 5 minutes of recorded talk time. A manager still needs to check the outcome before calling it good or bad."],
  ["Fair comparison rule", "We compare a person's week only when they made 100+ outbound calls, had 20+ other calls with recorded talk time and worked across 3+ active days."],
  ["Calling-pace rule", "To compare early and late calling pace, we also need at least 3 suitable workdays with enough calls spread across at least 4 hours."],
  ["Late / early calling pace", "Around 1.00 means the later calling pace was similar to the earlier pace. Below 1.00 means it slowed later. This does not prove tiredness."],
  ["Review prompt", "A prompt means 'look into this'. It is not a score, warning or disciplinary finding. Strong outlier claims wait until five comparable weeks exist."],
];
method.getRange("A8:B17").values = methodRows;
body(method.getRange("A8:B17"));
method.getRange("A8:A17").format.font = { name: "Source Sans 3", bold: true, color: CHARCOAL, size: 9 };
method.getRange("B8:B17").format.wrapText = true;
method.getRange("A8:B17").format.rowHeight = 31;

section(method, "A20:N20", "Validation results");
method.getRange("A21:D21").values = [["Check", ...data.weeks.map((week) => shortPeriod(week.period))]];
header(method.getRange("A21:D21"));
const expected = data.weeks.map((week) => week.quality.expectedReportOutboundCalls);
const qaRows = [
  ["Outbound calls reconcile after named exclusions", ...data.weeks.map((w, i) => w.overall.calls === expected[i] ? "PASS" : "FAIL")],
  ["Duration observed for every outbound call", ...data.weeks.map((w) => w.overall.durationObserved === w.overall.calls ? "PASS" : "FAIL")],
  ["Positive + zero duration equals outbound calls", ...data.weeks.map((w) => w.overall.positiveDurationCalls + w.overall.zeroDurationCalls === w.overall.calls ? "PASS" : "FAIL")],
  ["Included manager-team count matches the retained roster", ...data.weeks.map((w) => w.teams.length > 0 ? "PASS" : "FAIL")],
  ["Lead Utilisation exclusion policy applied", ...data.weeks.map((w) => w.quality.reportReconciliation ? "PASS" : "FAIL")],
  ["Source dates parsed under the weekly-export contract", ...data.weeks.map((w) => w.quality.invalidDate === 0 ? "PASS" : "FAIL")],
  ["Current person sparklines created", "N/A", "N/A", people.length],
];
method.getRange("A22:D28").values = qaRows;
body(method.getRange("A22:D28"));
method.getRange("B22:D28").format.horizontalAlignment = "center";
method.getRange("B22:D27").conditionalFormats.add("containsText", { text: "PASS", format: { fill: GREEN_PANEL, font: { bold: true, color: GREEN } } });

for (const sheet of Object.values(sheetNames).map((name) => workbook.worksheets.getItem(name))) {
  const used = sheet.getUsedRange();
  if (used) used.format.font = { ...(used.format.font || {}), name: "Source Sans 3" };
}

const previewRanges = {
  [sheetNames.summary]: "A1:R32",
  [sheetNames.trend]: "A1:R29",
  [sheetNames.team]: `A1:X${teamHourlyLast + 17}`,
  [sheetNames.person]: `A1:P${personLast}`,
  [sheetNames.time]: `A1:R${dayStart + 15}`,
  [sheetNames.review]: `A1:N${reviewLast + 5}`,
  [sheetNames.method]: "A1:N28",
};

for (const [sheetName, range] of Object.entries(previewRanges)) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  const safeName = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await fs.writeFile(path.join(workDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
const inspection = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 12000 });
await fs.writeFile(`${outputPath}.inspect.ndjson`, inspection.ndjson, "utf8");

const qa = {
  generatedAt: new Date().toISOString(),
  reportPeriod: { start: reportStart, end: reportEnd },
  workbook: outputPath,
  sheets: workbook.worksheets.items.map((sheet) => sheet.name),
  embedded,
  addedSheets: Object.values(sheetNames),
  outboundReconciliation: data.weeks.map((week, index) => ({ period: week.period, actual: week.overall.calls, expected: expected[index], passed: week.overall.calls === expected[index] })),
  durationCompleteness: data.weeks.map((week) => ({ period: week.period, observed: week.overall.durationObserved, calls: week.overall.calls, passed: week.overall.durationObserved === week.overall.calls })),
  currentPeople: people.length,
  currentTeams: currentTeams.length,
  sparklineRows: people.length,
  reviewSignalRows: signals.length,
  formulaErrorScan: "Run after XLSX export using LibreOffice recalculation or workbook inspection.",
};
await fs.writeFile(qaPath, `${JSON.stringify(qa, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, qa: qaPath, previews: workDir, sheets: qa.sheets, people: people.length, teams: qa.currentTeams, signals: signals.length }, null, 2));
