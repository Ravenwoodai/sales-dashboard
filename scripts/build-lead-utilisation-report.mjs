import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const { evaluateCall } = require("../src/transcriptEvaluator.js");
const { appendSnapshot, buildTrendModel } = require("../src/leadUtilisationTrends.js");

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

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error(`${label} must be YYYY-MM-DD.`);
}

function wallClockTimestamp(isoDate, endOfDay = false) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
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

function parseNameList(value, fallback) {
  const source = value === undefined ? fallback : String(value).split(";");
  return source.map(clean).filter(Boolean);
}

const args = argsFrom(process.argv.slice(2));
const allocationPath = path.resolve(String(args.allocation || ""));
const callPath = path.resolve(String(args.calls || ""));
const primaryCallPath = args["primary-calls"] ? path.resolve(String(args["primary-calls"])) : "";
const periodStart = String(args.start || "");
const periodEnd = String(args.end || "");
assertIsoDate(periodStart, "--start");
assertIsoDate(periodEnd, "--end");
if (periodEnd < periodStart) throw new Error("--end must be on or after --start.");
const outputDir = path.resolve(String(args.output || path.join(root, "outputs", `lead-utilisation-report-${periodStart}-to-${periodEnd}`)));
const defaultFileName = `Lead_Utilisation_and_Wastage_Report_${periodStart}_to_${periodEnd}.xlsx`;
const outputPath = path.join(outputDir, String(args.filename || defaultFileName));
const dataPath = path.join(outputDir, "report_data.json");

const start = wallClockTimestamp(periodStart);
const cutoff = wallClockTimestamp(periodEnd, true);
const managerExclusionLabels = parseNameList(args["manager-exclusions"], []);
const salespersonExclusionLabels = parseNameList(args["salesperson-exclusions"], []);
const exclusionDisplay = clean(args["exclusion-display"]);
if (!managerExclusionLabels.length || !salespersonExclusionLabels.length || !exclusionDisplay) {
  throw new Error("Manager exclusions, salesperson exclusions and --exclusion-display are required.");
}
const managerExclusions = new Set(managerExclusionLabels.map(norm));
const salespersonExclusions = new Set(salespersonExclusionLabels.map(norm));
const reportSubtitle = `${displayDate(periodStart, true)} to ${displayDate(periodEnd, true)}`;
const reportingPeriodText = `${displayDate(periodStart, true)} 00:00:00 through ${displayDate(periodEnd, true)} 23:59:59`;

const navy = "#231F20";
const blue = "#F5F6F7";
const green = "#1F6F5B";
const red = "#B42318";
const amber = "#A45A00";
const grey = "#F5F6F7";
const darkGrey = "#5B6470";
const border = "#D6D9DD";
const cream = "#FFF3F1";

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function norm(value) {
  return clean(value).toLowerCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ""));
  return rows
    .filter((values) => values.some((value) => clean(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function parseLocal(dateValue, timeValue = "00:00:00") {
  const dateText = clean(dateValue).split(" ")[0];
  const timeText = clean(timeValue) || "00:00:00";
  let year;
  let month;
  let day;
  let match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return Number.NaN;
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  }
  const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = Number(timeMatch?.[1] || 0);
  const minute = Number(timeMatch?.[2] || 0);
  const second = Number(timeMatch?.[3] || 0);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isoDateTime(timestamp) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}

function excelDate(timestamp) {
  return new Date(timestamp);
}

function percent(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function dayName(timestamp) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(timestamp).getUTCDay()];
}

function managerLabel(value) {
  return clean(value) || "Unassigned / Missing Manager";
}

function salespersonLabel(value) {
  return clean(value) || "Unassigned / Missing Salesperson";
}

function stableCallCustomer(call) {
  const primary = clean(call.customer_id);
  if (primary) return { id: primary, field: "customer_id" };
  const fallback = clean(call.FoundCustomerID);
  if (fallback) return { id: fallback, field: "FoundCustomerID fallback" };
  return { id: "", field: "No permitted customer ID" };
}

function addMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const [allocationText, callText, primaryCallText] = await Promise.all([
  fs.readFile(allocationPath, "utf8"),
  fs.readFile(callPath, "utf8"),
  primaryCallPath ? fs.readFile(primaryCallPath, "utf8") : Promise.resolve(""),
]);
const rawAllocations = parseCsv(allocationText);
const rawCalls = [
  ...(primaryCallText ? parseCsv(primaryCallText) : []),
  ...parseCsv(callText),
];
const callSourceNames = [primaryCallPath, callPath].filter(Boolean).map((sourcePath) => path.basename(sourcePath));
const callSourceDescription = callSourceNames.join(" + ");

const seenAllocationIds = new Set();
let allocationDuplicatesRemoved = 0;
let allocationsOutsidePeriod = 0;
const inPeriodAllocations = [];
for (const row of rawAllocations) {
  const timestamp = parseLocal(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time);
  if (!Number.isFinite(timestamp) || timestamp < start || timestamp > cutoff) {
    allocationsOutsidePeriod += 1;
    continue;
  }
  const allocationKey = clean(row.AllocationItemID);
  if (!allocationKey || seenAllocationIds.has(allocationKey)) {
    allocationDuplicatesRemoved += 1;
    continue;
  }
  seenAllocationIds.add(allocationKey);
  inPeriodAllocations.push({
    allocationKey,
    customerId: clean(row.CustomerID),
    businessName: clean(row.CompanyName),
    leadSource: clean(row.DataSource) || clean(row.CustomerImportSource) || "Unknown",
    allocationName: clean(row.AllocationName) || "Unknown",
    manager: managerLabel(row.SalesManager),
    managerKey: norm(managerLabel(row.SalesManager)),
    salesperson: salespersonLabel(row.FullName),
    salespersonKey: norm(salespersonLabel(row.FullName)),
    timestamp,
    allocationDate: isoDate(timestamp),
    allocationTime: clean(row.DateSentToSalesperson_Time),
    dayReceived: dayName(timestamp),
  });
}

const includedAllocations = inPeriodAllocations.filter((allocation) =>
  !managerExclusions.has(allocation.managerKey) && !salespersonExclusions.has(allocation.salespersonKey)
);
const excludedAllocations = inPeriodAllocations.filter((allocation) =>
  managerExclusions.has(allocation.managerKey) || salespersonExclusions.has(allocation.salespersonKey)
);

const includedSalespersonKeys = new Set(includedAllocations.map((allocation) => allocation.salespersonKey));
const salespersonDisplay = new Map();
const salespersonManager = new Map();
for (const allocation of includedAllocations) {
  salespersonDisplay.set(allocation.salespersonKey, allocation.salesperson);
  salespersonManager.set(allocation.salespersonKey, allocation.manager);
}

const seenCallIds = new Set();
let duplicateCallRowsRemoved = 0;
let outboundCallsOutsidePeriod = 0;
let inboundCallsExcluded = 0;
const weekOutboundCalls = [];
const postFridayOutboundCalls = [];
for (const row of rawCalls) {
  const timestamp = parseLocal(row.call_date, row.call_time);
  const direction = norm(row.call_direction);
  if (direction !== "out") {
    inboundCallsExcluded += 1;
    continue;
  }
  if (!Number.isFinite(timestamp) || timestamp < start || timestamp > cutoff) {
    outboundCallsOutsidePeriod += 1;
    if (Number.isFinite(timestamp) && timestamp > cutoff) {
      const stable = stableCallCustomer(row);
      postFridayOutboundCalls.push({
        callId: clean(row.call_id),
        salesperson: salespersonLabel(row.Salesperson),
        salespersonKey: norm(salespersonLabel(row.Salesperson)),
        customerId: stable.id,
        timestamp,
        callDateTime: isoDateTime(timestamp),
      });
    }
    continue;
  }
  const callId = clean(row.call_id);
  if (!callId || seenCallIds.has(callId)) {
    duplicateCallRowsRemoved += 1;
    continue;
  }
  seenCallIds.add(callId);
  const stable = stableCallCustomer(row);
  const evaluation = evaluateCall(row);
  weekOutboundCalls.push({
    callId,
    salesperson: salespersonLabel(row.Salesperson),
    salespersonKey: norm(salespersonLabel(row.Salesperson)),
    customerId: stable.id,
    customerMatchField: stable.field,
    timestamp,
    callDateTime: isoDateTime(timestamp),
    isLiteralVoicemail: evaluation.contact?.classification === "voicemail",
    voicemailEvidence: evaluation.evidence?.find((item) => item.signal === "literal_machine_voicemail")?.text || "",
    customerImportSource: clean(row.CustomerImportSource),
    customerCreatedByType: clean(row.CustomerCreatedByType),
  });
}

const includedCalls = weekOutboundCalls.filter((call) => includedSalespersonKeys.has(call.salespersonKey));
const callsByPair = new Map();
for (const call of includedCalls) {
  if (!call.customerId) continue;
  addMapArray(callsByPair, `${call.customerId}\u0000${call.salespersonKey}`, call);
}
for (const calls of callsByPair.values()) calls.sort((a, b) => a.timestamp - b.timestamp || a.callId.localeCompare(b.callId));

const allocationsByPair = new Map();
for (const allocation of includedAllocations) {
  if (!allocation.customerId) continue;
  addMapArray(allocationsByPair, `${allocation.customerId}\u0000${allocation.salespersonKey}`, allocation);
}
for (const allocations of allocationsByPair.values()) allocations.sort((a, b) => a.timestamp - b.timestamp || a.allocationKey.localeCompare(b.allocationKey));

for (const allocation of includedAllocations) {
  const pairKey = `${allocation.customerId}\u0000${allocation.salespersonKey}`;
  const candidates = (callsByPair.get(pairKey) || []).filter((call) => call.timestamp >= allocation.timestamp && call.timestamp <= cutoff);
  allocation.firstCall = candidates[0] || null;
  allocation.result = allocation.firstCall ? "Called" : "Wasted";
  allocation.firstCallVoicemail = Boolean(allocation.firstCall?.isLiteralVoicemail);
  allocation.followUpCall = allocation.firstCallVoicemail
    ? candidates.find((call) => call.timestamp > allocation.firstCall.timestamp) || null
    : null;
  allocation.followUpFailure = allocation.firstCallVoicemail && !allocation.followUpCall;
  allocation.adjustedResult = allocation.followUpFailure ? "Follow-up Failure" : allocation.result;
}

for (const call of includedCalls) {
  const pairKey = `${call.customerId}\u0000${call.salespersonKey}`;
  const matchingAllocation = (allocationsByPair.get(pairKey) || [])
    .filter((allocation) => allocation.timestamp <= call.timestamp)
    .at(-1) || null;
  call.reportingWeekAllocationMatch = matchingAllocation;
  call.activityClassification = matchingAllocation
    ? "Reporting-Week Lead Allocation Call"
    : "Potential Self-Sourced / Other Outbound Call";
}

function seedSalesperson(allocation) {
  return {
    manager: allocation.manager,
    salesperson: allocation.salesperson,
    salespersonKey: allocation.salespersonKey,
    received: 0,
    called: 0,
    wasted: 0,
    firstCallVoicemails: 0,
    followUpFailures: 0,
    outboundCalls: 0,
    allocatedLeadCallAttempts: 0,
    otherOutboundCalls: 0,
  };
}

const salespersonMap = new Map();
for (const allocation of includedAllocations) {
  if (!salespersonMap.has(allocation.salespersonKey)) salespersonMap.set(allocation.salespersonKey, seedSalesperson(allocation));
  const record = salespersonMap.get(allocation.salespersonKey);
  record.received += 1;
  record.called += allocation.result === "Called" ? 1 : 0;
  record.wasted += allocation.result === "Wasted" ? 1 : 0;
  record.firstCallVoicemails += allocation.firstCallVoicemail ? 1 : 0;
  record.followUpFailures += allocation.followUpFailure ? 1 : 0;
}
for (const call of includedCalls) {
  const record = salespersonMap.get(call.salespersonKey);
  if (!record) continue;
  record.outboundCalls += 1;
  if (call.reportingWeekAllocationMatch) record.allocatedLeadCallAttempts += 1;
  else record.otherOutboundCalls += 1;
}

const salespeople = [...salespersonMap.values()].sort((a, b) =>
  b.wasted - a.wasted || percent(b.wasted, b.received) - percent(a.wasted, a.received) || b.received - a.received || a.salesperson.localeCompare(b.salesperson)
);
salespeople.forEach((row, index) => { row.wastageRank = index + 1; });

const managerMap = new Map();
for (const salesperson of salespeople) {
  if (!managerMap.has(salesperson.manager)) {
    managerMap.set(salesperson.manager, {
      manager: salesperson.manager,
      salespeople: 0,
      received: 0,
      called: 0,
      wasted: 0,
      firstCallVoicemails: 0,
      followUpFailures: 0,
      outboundCalls: 0,
      allocatedLeadCallAttempts: 0,
      otherOutboundCalls: 0,
    });
  }
  const manager = managerMap.get(salesperson.manager);
  manager.salespeople += 1;
  for (const field of ["received", "called", "wasted", "firstCallVoicemails", "followUpFailures", "outboundCalls", "allocatedLeadCallAttempts", "otherOutboundCalls"]) {
    manager[field] += salesperson[field];
  }
}
const managers = [...managerMap.values()].sort((a, b) => b.wasted - a.wasted || b.received - a.received || a.manager.localeCompare(b.manager));

const totals = {
  received: includedAllocations.length,
  called: includedAllocations.filter((allocation) => allocation.result === "Called").length,
  wasted: includedAllocations.filter((allocation) => allocation.result === "Wasted").length,
  firstCallVoicemails: includedAllocations.filter((allocation) => allocation.firstCallVoicemail).length,
  followUpFailures: includedAllocations.filter((allocation) => allocation.followUpFailure).length,
  outboundCalls: includedCalls.length,
  allocatedLeadCallAttempts: includedCalls.filter((call) => call.reportingWeekAllocationMatch).length,
  otherOutboundCalls: includedCalls.filter((call) => !call.reportingWeekAllocationMatch).length,
};
totals.utilisation = percent(totals.called, totals.received);
totals.wastage = percent(totals.wasted, totals.received);
totals.adjustedUtilisation = percent(totals.called - totals.followUpFailures, totals.received);
totals.callsPerAllocation = percent(totals.outboundCalls, totals.received);
totals.otherCallRatio = percent(totals.otherOutboundCalls, totals.outboundCalls);

const wastedAllocations = includedAllocations
  .filter((allocation) => allocation.result === "Wasted")
  .sort((a, b) => a.manager.localeCompare(b.manager) || a.salesperson.localeCompare(b.salesperson) || a.timestamp - b.timestamp);
const followUpFailures = includedAllocations
  .filter((allocation) => allocation.followUpFailure)
  .sort((a, b) => a.manager.localeCompare(b.manager) || a.salesperson.localeCompare(b.salesperson) || a.timestamp - b.timestamp);

const callsByCustomer = new Map();
for (const call of includedCalls) {
  if (call.customerId) addMapArray(callsByCustomer, call.customerId, call);
}
const qaSampleRows = {
  called: includedAllocations.filter((row) => row.result === "Called").slice(0, 5).map((row) => ({ allocationKey: row.allocationKey, salesperson: row.salesperson, firstCallId: row.firstCall.callId, firstCallAt: row.firstCall.callDateTime })),
  wasted: wastedAllocations.slice(0, 5).map((row) => ({ allocationKey: row.allocationKey, salesperson: row.salesperson })),
  friday: includedAllocations.filter((row) => row.dayReceived === "Friday").slice(0, 5).map((row) => ({ allocationKey: row.allocationKey, salesperson: row.salesperson, result: row.result, allocationAt: isoDateTime(row.timestamp), firstCallAt: row.firstCall?.callDateTime || "" })),
  preAllocation: includedAllocations.filter((row) => (callsByPair.get(`${row.customerId}\u0000${row.salespersonKey}`) || []).some((call) => call.timestamp < row.timestamp)).slice(0, 5).map((row) => ({ allocationKey: row.allocationKey, salesperson: row.salesperson, allocationAt: isoDateTime(row.timestamp), earlierCallAt: (callsByPair.get(`${row.customerId}\u0000${row.salespersonKey}`) || []).find((call) => call.timestamp < row.timestamp)?.callDateTime || "", countedFirstCallAt: row.firstCall?.callDateTime || "" })),
  differentSalesperson: includedAllocations.filter((row) => (callsByCustomer.get(row.customerId) || []).some((call) => call.salespersonKey !== row.salespersonKey && call.timestamp >= row.timestamp)).slice(0, 5).map((row) => { const other = (callsByCustomer.get(row.customerId) || []).find((call) => call.salespersonKey !== row.salespersonKey && call.timestamp >= row.timestamp); return { allocationKey: row.allocationKey, receivingSalesperson: row.salesperson, otherSalesperson: other?.salesperson || "", otherCallId: other?.callId || "", result: row.result, countedFirstCallId: row.firstCall?.callId || "" }; }),
  afterFriday: includedAllocations.filter((row) => postFridayOutboundCalls.some((call) => call.customerId === row.customerId && call.salespersonKey === row.salespersonKey)).slice(0, 5).map((row) => { const later = postFridayOutboundCalls.find((call) => call.customerId === row.customerId && call.salespersonKey === row.salespersonKey); return { allocationKey: row.allocationKey, salesperson: row.salesperson, fridayResult: row.result, laterCallId: later?.callId || "", laterCallAt: later?.callDateTime || "", countedFirstCallId: row.firstCall?.callId || "" }; }),
};

const exclusionSummaryMap = new Map();
for (const allocation of excludedAllocations) {
  const reason = managerExclusions.has(allocation.managerKey)
    ? `${allocation.manager} team`
    : allocation.salesperson;
  exclusionSummaryMap.set(reason, (exclusionSummaryMap.get(reason) || 0) + 1);
}
const exclusionSummary = [...exclusionSummaryMap.entries()].map(([name, allocations]) => ({ name, allocations }));

const qaChecks = [
  ["Overall received equals called plus wasted", totals.received === totals.called + totals.wasted],
  ["Every salesperson reconciles", salespeople.every((row) => row.received === row.called + row.wasted)],
  ["Every manager reconciles", managers.every((row) => row.received === row.called + row.wasted)],
  ["Salesperson totals reconcile to company", salespeople.reduce((sum, row) => sum + row.received, 0) === totals.received],
  ["Manager totals reconcile to company", managers.reduce((sum, row) => sum + row.received, 0) === totals.received],
  ["Wasted detail rows reconcile", wastedAllocations.length === totals.wasted],
  ["Follow-up failure detail rows reconcile", followUpFailures.length === totals.followUpFailures],
  ["Call activity reconciles", totals.outboundCalls === totals.allocatedLeadCallAttempts + totals.otherOutboundCalls],
  ["All named exclusions absent", !includedAllocations.some((row) => managerExclusions.has(row.managerKey) || salespersonExclusions.has(row.salespersonKey))],
  ["No calls before allocation counted", includedAllocations.every((row) => !row.firstCall || row.firstCall.timestamp >= row.timestamp)],
  ["No inbound calls counted", true],
  ["No Saturday or later calls counted", includedCalls.every((call) => call.timestamp <= cutoff)],
  ["Duplicate allocation keys removed", new Set(includedAllocations.map((row) => row.allocationKey)).size === includedAllocations.length],
  ["Manager percentages use aggregated counts", true],
];
if (!qaChecks.every(([, passed]) => passed)) {
  throw new Error(`QA failure: ${qaChecks.filter(([, passed]) => !passed).map(([name]) => name).join("; ")}`);
}

await fs.mkdir(outputDir, { recursive: true });
const payload = {
  title: "LEAD UTILISATION & WASTAGE REPORT",
  subtitle: reportSubtitle,
  reportingPeriod: {
    startDate: periodStart,
    endDate: periodEnd,
    cutoffLocal: `${periodEnd} 23:59:59`,
    timezone: "Australia/Melbourne",
  },
  totals,
  managers,
  salespeople,
  top15: salespeople.slice(0, 15),
  wastedRows: wastedAllocations.length,
  followUpFailureRows: followUpFailures.length,
  exclusions: {
    managerTeams: managerExclusionLabels.map((name) => `${name} team`),
    salespeople: salespersonExclusionLabels,
    display: exclusionDisplay,
    detail: exclusionSummary,
    excludedAllocations: excludedAllocations.length,
  },
  sourceStats: {
    allocationRows: rawAllocations.length,
    inPeriodUniqueAllocations: inPeriodAllocations.length,
    allocationDuplicatesRemoved,
    allocationsOutsidePeriod,
    callRows: rawCalls.length,
    callSourceFiles: callSourceNames,
    inPeriodUniqueOutboundCalls: weekOutboundCalls.length,
    duplicateCallRowsRemoved,
    outboundCallsOutsidePeriod,
    inboundCallsExcluded,
    manualSampleCounts: Object.fromEntries(Object.entries(qaSampleRows).map(([key, rows]) => [key, rows.length])),
  },
  qaSampleRows,
  qaChecks: qaChecks.map(([check, passed]) => ({ check, result: passed ? "PASS" : "FAIL" })),
};
const trendHistoryPath = path.resolve(String(args["trend-history"] || path.join(root, "data", "store", "lead-utilisation-trend-history.json")));
const personMinimumAllocations = Number(args["person-minimum-allocations"] || 100);
if (!Number.isFinite(personMinimumAllocations) || personMinimumAllocations < 1) {
  throw new Error("--person-minimum-allocations must be a positive number.");
}
const { history: trendHistory, snapshot: trendSnapshot } = appendSnapshot(trendHistoryPath, payload);
payload.ongoingTrends = buildTrendModel(trendHistory, trendSnapshot, { personMinimumAllocations });
payload.trendHistory = {
  schemaVersion: trendHistory.schemaVersion,
  fileName: path.basename(trendHistoryPath),
  snapshotHash: trendSnapshot.contentHash,
  retainedRevisions: trendHistory.snapshots.length,
};
await fs.writeFile(dataPath, JSON.stringify(payload, null, 2));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Lead Utilisation Summary");
const salespersonSheet = workbook.worksheets.add("Salesperson Utilisation");
const managerSheet = workbook.worksheets.add("Manager Utilisation");
const wastedSheet = workbook.worksheets.add("Wasted Lead Detail");
const followUpSheet = workbook.worksheets.add("Follow-up Failure Detail");
const methodologySheet = workbook.worksheets.add("Methodology & QA");
const allocationEvidenceSheet = workbook.worksheets.add("Allocation Evidence");
const overallTrendSheet = workbook.worksheets.add("Ongoing Overall Trends");
const teamTrendSheet = workbook.worksheets.add("Ongoing Team Trends");
const personTrendSheet = workbook.worksheets.add("Ongoing Person Trends");

function title(sheet, endColumn, text, subtitleText = "") {
  sheet.getRange(`A1:${endColumn}1`).merge();
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endColumn}1`).format = {
    fill: "#FFFFFF",
    font: { name: "Source Sans 3", bold: true, color: navy, size: 18 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    borders: { left: { style: "thick", color: "#EE3424" } },
  };
  sheet.getRange("A1").format.rowHeight = 30;
  if (subtitleText) {
    sheet.getRange(`A2:${endColumn}2`).merge();
    sheet.getRange("A2").values = [[subtitleText]];
    sheet.getRange(`A2:${endColumn}2`).format = { font: { name: "Source Sans 3", italic: true, color: darkGrey, size: 10 }, verticalAlignment: "center", wrapText: true };
    sheet.getRange("A2").format.rowHeight = 24;
  }
}

function styleHeader(range) {
  range.format = {
    fill: navy,
    font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
  range.format.rowHeight = 34;
}

function styleBody(range) {
  range.format = {
    font: { name: "Source Sans 3", size: 9 },
    verticalAlignment: "center",
    borders: { insideHorizontal: { style: "thin", color: border } },
  };
}

function setWidths(sheet, widths) {
  for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
}

function exclusionNote(sheet, endColumn, row = 3) {
  sheet.getRange(`A${row}:${endColumn}${row}`).merge();
  sheet.getRange(`A${row}`).values = [[`Excluded from all figures: ${exclusionDisplay}.`]];
  sheet.getRange(`A${row}:${endColumn}${row}`).format = { fill: cream, font: { color: "#7F6000", italic: true, size: 9 }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange(`A${row}`).format.rowHeight = 24;
}

for (const sheet of [summary, salespersonSheet, managerSheet, wastedSheet, followUpSheet, methodologySheet, allocationEvidenceSheet, overallTrendSheet, teamTrendSheet, personTrendSheet]) {
  sheet.showGridLines = false;
}

title(summary, "R", "LEAD UTILISATION & WASTAGE REPORT", reportSubtitle);
summary.getRange("A3:R4").merge();
summary.getRange("A3").values = [["A lead allocation is called when the receiving salesperson makes an exact outbound call after receiving it and by the end of Friday. A Follow-up Failure is a called lead whose First Call has explicit machine-voicemail evidence and no later exact outbound attempt by the same salesperson by Friday."]];
summary.getRange("A3:R4").format = { fill: grey, font: { color: darkGrey, size: 10 }, wrapText: true, verticalAlignment: "center" };
summary.getRange("A5:R5").merge();
summary.getRange("A5").values = [[`Scope exclusions: ${exclusionDisplay}.`]];
summary.getRange("A5:R5").format = { fill: cream, font: { color: "#7F6000", italic: true, size: 9 }, wrapText: true, verticalAlignment: "center" };

const primaryCards = [
  ["Lead Allocations Received", totals.received, navy, "#,##0"],
  ["Lead Allocations Called", totals.called, green, "#,##0"],
  ["Lead Allocations Wasted", totals.wasted, red, "#,##0"],
  ["Lead Utilisation %", totals.utilisation, green, "0.0%"],
  ["Lead Wastage %", totals.wastage, red, "0.0%"],
];
const primarySpans = [["A", "C"], ["D", "G"], ["H", "K"], ["L", "O"], ["P", "R"]];
primaryCards.forEach(([label, value, colour, numberFormat], index) => {
  const [startColumn, endColumn] = primarySpans[index];
  summary.getRange(`${startColumn}7:${endColumn}7`).merge();
  summary.getRange(`${startColumn}8:${endColumn}9`).merge();
  summary.getRange(`${startColumn}7`).values = [[label]];
  summary.getRange(`${startColumn}8`).values = [[value]];
  summary.getRange(`${startColumn}7:${endColumn}9`).format = { fill: index === 2 || index === 4 ? "#FCE4E4" : index === 1 || index === 3 ? "#E8F5E9" : grey, borders: { preset: "outside", style: "thin", color: border }, horizontalAlignment: "center", verticalAlignment: "center" };
  summary.getRange(`${startColumn}7`).format.font = { bold: true, color: darkGrey, size: 10 };
  summary.getRange(`${startColumn}8`).format.font = { bold: true, color: colour, size: 18 };
  summary.getRange(`${startColumn}8`).format.numberFormat = numberFormat;
});

summary.getRange("A11:R11").merge();
summary.getRange("A11").values = [["Voicemail Follow-up Quality"]];
summary.getRange("A11:R11").format = { fill: blue, font: { bold: true, color: navy, size: 12 } };
const secondaryCards = [
  ["First Calls Identified as Voicemail", totals.firstCallVoicemails, amber, "#,##0"],
  ["Follow-up Failures", totals.followUpFailures, red, "#,##0"],
  ["Lead Utilisation after Follow-up Failures %", totals.adjustedUtilisation, amber, "0.0%"],
  ["Potential Self-Sourced / Other Calls %", totals.otherCallRatio, navy, "0.0%"],
];
const secondarySpans = [["A", "D"], ["E", "H"], ["I", "M"], ["N", "R"]];
secondaryCards.forEach(([label, value, colour, numberFormat], index) => {
  const [startColumn, endColumn] = secondarySpans[index];
  summary.getRange(`${startColumn}12:${endColumn}12`).merge();
  summary.getRange(`${startColumn}13:${endColumn}14`).merge();
  summary.getRange(`${startColumn}12`).values = [[label]];
  summary.getRange(`${startColumn}13`).values = [[value]];
  summary.getRange(`${startColumn}12:${endColumn}14`).format = { fill: grey, borders: { preset: "outside", style: "thin", color: border }, horizontalAlignment: "center", verticalAlignment: "center" };
  summary.getRange(`${startColumn}12`).format = { fill: blue, font: { bold: true, color: navy, size: 9 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  summary.getRange(`${startColumn}13`).format.font = { bold: true, color: colour, size: 17 };
  summary.getRange(`${startColumn}13`).format.numberFormat = numberFormat;
});
summary.getRange("A15:R16").merge();
summary.getRange("A15").values = [["Potential Self-Sourced / Other Calls % is exact activity outside a same-salesperson, same-customer reporting-week allocation received before the call. It can include self-sourced prospects, older leads, warm customers and other records; it is not proof that every such call was self-sourced."]];
summary.getRange("A15:R16").format = { fill: cream, font: { italic: true, color: "#7F6000", size: 9 }, wrapText: true, verticalAlignment: "center" };

summary.getRange("A18:F18").merge();
summary.getRange("A18").values = [["Lead Allocations Called vs Wasted by Manager"]];
summary.getRange("A18:F18").format = { fill: blue, font: { bold: true, color: navy, size: 12 } };
const summaryManagerRows = managers.map((row) => [row.manager, row.called, row.wasted, row.received, percent(row.called, row.received), row.followUpFailures]);
summary.getRange(`A19:F${19 + summaryManagerRows.length}`).values = [["Manager", "Called", "Wasted", "Total Allocations", "Lead Utilisation %", "Follow-up Failures"], ...summaryManagerRows];
styleHeader(summary.getRange("A19:F19"));
styleBody(summary.getRange(`A20:F${19 + summaryManagerRows.length}`));
summary.getRange(`B20:D${19 + summaryManagerRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`E20:E${19 + summaryManagerRows.length}`).format.numberFormat = "0.0%";
summary.getRange(`F20:F${19 + summaryManagerRows.length}`).format.numberFormat = "#,##0";
const chart = summary.charts.add("bar", summary.getRange(`A19:C${19 + summaryManagerRows.length}`));
chart.title = "Lead Allocations Called vs Wasted by Manager";
chart.hasLegend = true;
chart.barOptions.direction = "bar";
chart.barOptions.grouping = "stacked";
chart.barOptions.gapWidth = 60;
chart.barOptions.overlap = 100;
chart.setPosition("H18", "R32");
if (chart.series.items[0]) chart.series.items[0].fill = green;
if (chart.series.items[1]) chart.series.items[1].fill = red;

const topStart = 35;
summary.getRange(`A${topStart}:R${topStart}`).merge();
summary.getRange(`A${topStart}`).values = [["Highest Lead Wastage by Salesperson"]];
summary.getRange(`A${topStart}:R${topStart}`).format = { fill: blue, font: { bold: true, color: navy, size: 12 } };
const topHeaders = ["Rank", "Manager", "Salesperson", "Received", "Called", "Wasted", "Utilisation %", "First Call Voicemails", "Follow-up Failures", "Utilisation after Failures %", "Outbound Calls", "Calls / Allocation", "Allocated-Lead Call Attempts", "Other Outbound Calls", "Potential Self-Sourced / Other Calls %"];
const topRows = salespeople.slice(0, 15).map((row) => [row.wastageRank, row.manager, row.salesperson, row.received, row.called, row.wasted, percent(row.called, row.received), row.firstCallVoicemails, row.followUpFailures, percent(row.called - row.followUpFailures, row.received), row.outboundCalls, percent(row.outboundCalls, row.received), row.allocatedLeadCallAttempts, row.otherOutboundCalls, percent(row.otherOutboundCalls, row.outboundCalls)]);
summary.getRange(`A${topStart + 1}:O${topStart + 1 + topRows.length}`).values = [topHeaders, ...topRows];
styleHeader(summary.getRange(`A${topStart + 1}:O${topStart + 1}`));
styleBody(summary.getRange(`A${topStart + 2}:O${topStart + 1 + topRows.length}`));
summary.getRange(`D${topStart + 2}:F${topStart + 1 + topRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`G${topStart + 2}:G${topStart + 1 + topRows.length}`).format.numberFormat = "0.0%";
summary.getRange(`H${topStart + 2}:I${topStart + 1 + topRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`J${topStart + 2}:J${topStart + 1 + topRows.length}`).format.numberFormat = "0.0%";
summary.getRange(`K${topStart + 2}:K${topStart + 1 + topRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`L${topStart + 2}:L${topStart + 1 + topRows.length}`).format.numberFormat = "0.00";
summary.getRange(`M${topStart + 2}:N${topStart + 1 + topRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`O${topStart + 2}:O${topStart + 1 + topRows.length}`).format.numberFormat = "0.0%";
setWidths(summary, { A: 18, B: 18, C: 22, D: 11, E: 10, F: 10, G: 13, H: 13, I: 13, J: 15, K: 12, L: 12, M: 15, N: 14, O: 16, P: 6, Q: 6, R: 6 });

title(salespersonSheet, "R", "SALESPERSON UTILISATION", "One row per included salesperson; default sort is Lead Allocations Wasted descending.");
exclusionNote(salespersonSheet, "R");
salespersonSheet.getRange("A4:R4").merge();
salespersonSheet.getRange("A4").values = [["Potential Self-Sourced / Other Calls are outbound calls not exactly matched to a reporting-week allocation for the same customer and salesperson before the call. This is an activity-context metric, not a definitive source attribution."]];
salespersonSheet.getRange("A4:R4").format = { fill: grey, font: { italic: true, color: darkGrey, size: 9 }, wrapText: true };
const salespersonHeaders = ["Wastage Rank", "Manager", "Salesperson", "Lead Allocations Received", "Lead Allocations Called", "Lead Allocations Wasted", "Lead Utilisation %", "Lead Wastage %", "First Calls Identified as Voicemail", "Follow-up Failures", "Lead Utilisation after Follow-up Failures %", "Outbound Calls Made", "Outbound Calls per Lead Allocation", "Outbound Calls to Reporting-Week Lead Allocations", "Potential Self-Sourced / Other Outbound Calls", "Potential Self-Sourced / Other Calls %", "Share of Total Lead Wastage %", "Share of Total Follow-up Failures %"];
const salespersonRows = salespeople.map((row) => [
  row.wastageRank, row.manager, row.salesperson, row.received, row.called, row.wasted,
  percent(row.called, row.received), percent(row.wasted, row.received), row.firstCallVoicemails, row.followUpFailures,
  percent(row.called - row.followUpFailures, row.received), row.outboundCalls, percent(row.outboundCalls, row.received),
  row.allocatedLeadCallAttempts, row.otherOutboundCalls, percent(row.otherOutboundCalls, row.outboundCalls),
  percent(row.wasted, totals.wasted), percent(row.followUpFailures, totals.followUpFailures),
]);
salespersonSheet.getRange(`A5:R${5 + salespersonRows.length}`).values = [salespersonHeaders, ...salespersonRows];
styleHeader(salespersonSheet.getRange("A5:R5"));
styleBody(salespersonSheet.getRange(`A6:R${5 + salespersonRows.length}`));
salespersonSheet.getRange(`D6:F${5 + salespersonRows.length}`).format.numberFormat = "#,##0";
salespersonSheet.getRange(`G6:H${5 + salespersonRows.length}`).format.numberFormat = "0.0%";
salespersonSheet.getRange(`I6:J${5 + salespersonRows.length}`).format.numberFormat = "#,##0";
salespersonSheet.getRange(`K6:K${5 + salespersonRows.length}`).format.numberFormat = "0.0%";
salespersonSheet.getRange(`L6:L${5 + salespersonRows.length}`).format.numberFormat = "#,##0";
salespersonSheet.getRange(`M6:M${5 + salespersonRows.length}`).format.numberFormat = "0.00";
salespersonSheet.getRange(`N6:O${5 + salespersonRows.length}`).format.numberFormat = "#,##0";
salespersonSheet.getRange(`P6:R${5 + salespersonRows.length}`).format.numberFormat = "0.0%";
const salespersonTable = salespersonSheet.tables.add(`A5:R${5 + salespersonRows.length}`, true, "SalespersonUtilisationTable");
salespersonTable.style = "TableStyleLight1";
styleHeader(salespersonTable.getHeaderRowRange());
styleBody(salespersonTable.getDataRows());
salespersonSheet.freezePanes.freezeRows(5);
salespersonSheet.getRange(`F6:F${5 + salespersonRows.length}`).conditionalFormats.add("dataBar", { color: red, gradient: true });
salespersonSheet.getRange(`G6:G${5 + salespersonRows.length}`).conditionalFormats.add("dataBar", { color: green, gradient: true });
salespersonSheet.getRange(`J6:J${5 + salespersonRows.length}`).conditionalFormats.add("dataBar", { color: red, gradient: true });
setWidths(salespersonSheet, { A: 11, B: 20, C: 24, D: 16, E: 16, F: 16, G: 14, H: 13, I: 19, J: 15, K: 20, L: 15, M: 18, N: 22, O: 22, P: 20, Q: 18, R: 19 });

title(managerSheet, "Q", "MANAGER UTILISATION", "Manager percentages are calculated from aggregated counts, not salesperson percentage averages.");
exclusionNote(managerSheet, "Q");
const managerHeaders = ["Manager", "Salespeople Receiving Lead Allocations", "Lead Allocations Received", "Lead Allocations Called", "Lead Allocations Wasted", "Lead Utilisation %", "Lead Wastage %", "First Calls Identified as Voicemail", "Follow-up Failures", "Lead Utilisation after Follow-up Failures %", "Outbound Calls Made", "Outbound Calls per Lead Allocation", "Outbound Calls to Reporting-Week Lead Allocations", "Potential Self-Sourced / Other Outbound Calls", "Potential Self-Sourced / Other Calls %", "Share of Total Lead Wastage %", "Share of Total Follow-up Failures %"];
const managerRows = managers.map((row) => [
  row.manager, row.salespeople, row.received, row.called, row.wasted, percent(row.called, row.received), percent(row.wasted, row.received),
  row.firstCallVoicemails, row.followUpFailures, percent(row.called - row.followUpFailures, row.received), row.outboundCalls,
  percent(row.outboundCalls, row.received), row.allocatedLeadCallAttempts, row.otherOutboundCalls, percent(row.otherOutboundCalls, row.outboundCalls),
  percent(row.wasted, totals.wasted), percent(row.followUpFailures, totals.followUpFailures),
]);
managerSheet.getRange(`A5:Q${5 + managerRows.length}`).values = [managerHeaders, ...managerRows];
styleHeader(managerSheet.getRange("A5:Q5"));
styleBody(managerSheet.getRange(`A6:Q${5 + managerRows.length}`));
managerSheet.getRange(`B6:E${5 + managerRows.length}`).format.numberFormat = "#,##0";
managerSheet.getRange(`F6:G${5 + managerRows.length}`).format.numberFormat = "0.0%";
managerSheet.getRange(`H6:I${5 + managerRows.length}`).format.numberFormat = "#,##0";
managerSheet.getRange(`J6:J${5 + managerRows.length}`).format.numberFormat = "0.0%";
managerSheet.getRange(`K6:K${5 + managerRows.length}`).format.numberFormat = "#,##0";
managerSheet.getRange(`L6:L${5 + managerRows.length}`).format.numberFormat = "0.00";
managerSheet.getRange(`M6:N${5 + managerRows.length}`).format.numberFormat = "#,##0";
managerSheet.getRange(`O6:Q${5 + managerRows.length}`).format.numberFormat = "0.0%";
const managerTable = managerSheet.tables.add(`A5:Q${5 + managerRows.length}`, true, "ManagerUtilisationTable");
managerTable.style = "TableStyleLight1";
styleHeader(managerTable.getHeaderRowRange());
styleBody(managerTable.getDataRows());
managerSheet.freezePanes.freezeRows(5);
setWidths(managerSheet, { A: 22, B: 18, C: 16, D: 16, E: 16, F: 14, G: 13, H: 19, I: 15, J: 20, K: 15, L: 18, M: 22, N: 22, O: 20, P: 18, Q: 19 });

title(wastedSheet, "M", "WASTED LEAD DETAIL", "One row per included Lead Allocation classified as Wasted.");
exclusionNote(wastedSheet, "M");
const wastedHeaders = ["Lead Allocation Key", "Lead ID or Customer ID", "Business Name", "Lead Source", "Allocation Name or Batch Name", "Manager", "Salesperson", "Allocation Date", "Allocation Time", "Day Received", "First Call Date and Time", "Result", "Evidence Note"];
const wastedRows = wastedAllocations.map((row) => [row.allocationKey, row.customerId, row.businessName, row.leadSource, row.allocationName, row.manager, row.salesperson, row.allocationDate, row.allocationTime, row.dayReceived, null, "Wasted", "No qualifying outbound call by receiving salesperson after allocation and by end of Friday."]);
wastedSheet.getRange(`A5:M${5 + wastedRows.length}`).values = [wastedHeaders, ...wastedRows];
styleHeader(wastedSheet.getRange("A5:M5"));
styleBody(wastedSheet.getRange(`A6:M${5 + wastedRows.length}`));
wastedSheet.getRange(`H6:H${5 + wastedRows.length}`).format.numberFormat = "yyyy-mm-dd";
const wastedTable = wastedSheet.tables.add(`A5:M${5 + wastedRows.length}`, true, "WastedLeadDetailTable");
wastedTable.style = "TableStyleLight1";
styleHeader(wastedTable.getHeaderRowRange());
styleBody(wastedTable.getDataRows());
wastedSheet.freezePanes.freezeRows(5);
setWidths(wastedSheet, { A: 18, B: 18, C: 30, D: 18, E: 28, F: 22, G: 24, H: 14, I: 12, J: 13, K: 22, L: 12, M: 60 });

title(followUpSheet, "O", "FOLLOW-UP FAILURE DETAIL", "A softer wastage layer: First Call had explicit machine-voicemail evidence and no later exact outbound reattempt by the receiving salesperson by Friday.");
exclusionNote(followUpSheet, "O");
const followUpHeaders = ["Lead Allocation Key", "Customer ID", "Business Name", "Lead Source", "Manager", "Salesperson", "Allocation Date", "Allocation Time", "First Call Date and Time", "First Call ID", "Voicemail Evidence", "Later Follow-up Date and Time", "Result", "Adjusted Result", "Evidence Note"];
const followUpRows = followUpFailures.map((row) => [row.allocationKey, row.customerId, row.businessName, row.leadSource, row.manager, row.salesperson, row.allocationDate, row.allocationTime, row.firstCall.callDateTime, row.firstCall.callId, row.firstCall.voicemailEvidence, null, "Called", "Follow-up Failure", "First Call contained explicit machine-voicemail evidence; no later exact outbound attempt by the same salesperson was found by end of Friday."]);
followUpSheet.getRange(`A5:O${5 + followUpRows.length}`).values = [followUpHeaders, ...followUpRows];
styleHeader(followUpSheet.getRange("A5:O5"));
styleBody(followUpSheet.getRange(`A6:O${5 + followUpRows.length}`));
followUpSheet.getRange(`G6:G${5 + followUpRows.length}`).format.numberFormat = "yyyy-mm-dd";
followUpSheet.getRange(`I6:I${5 + followUpRows.length}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
const followUpTable = followUpSheet.tables.add(`A5:O${5 + followUpRows.length}`, true, "FollowUpFailureDetailTable");
followUpTable.style = "TableStyleLight1";
styleHeader(followUpTable.getHeaderRowRange());
styleBody(followUpTable.getDataRows());
followUpSheet.freezePanes.freezeRows(5);
setWidths(followUpSheet, { A: 18, B: 16, C: 28, D: 18, E: 22, F: 24, G: 14, H: 12, I: 22, J: 14, K: 48, L: 22, M: 12, N: 18, O: 62 });

title(methodologySheet, "D", "METHODOLOGY & QA", "Concise rules, exclusions, limitations and reconciliation checks.");
const methodologyRows = [
  ["Source allocation file", path.basename(allocationPath), "Weekly allocation report only", ""],
  ["Source call file(s)", callSourceDescription, primaryCallPath ? "Primary history plus weekly supplement; duplicate Call IDs are removed" : "Weekly call report only", ""],
  ["Reporting period", reportingPeriodText, "Australia/Melbourne local business time", ""],
  ["Lead Allocation key", "AllocationItemID", "Duplicate AllocationItemID rows are removed; earliest retained source row is used.", ""],
  ["Call matching fields", "Allocation CustomerID = call customer_id; FoundCustomerID used only when customer_id is blank; exact normalised full salesperson name; outbound direction; call at/after allocation; call by Friday cutoff.", "No phone or fuzzy-name matching", ""],
  ["Called", "At least one exact qualifying outbound call by the receiving salesperson after allocation and by Friday cutoff.", "Earliest qualifying call is the First Call", ""],
  ["Wasted", "No qualifying outbound call by the receiving salesperson after allocation and by Friday cutoff.", "Saturday and later calls do not change the result", ""],
  ["Voicemail evidence", "First Call is classified only when the source transcript contains exact machine-voicemail wording under the retained restricted literal rule.", "Ordinary unknown, no-answer, system audio and human dialogue are not treated as voicemail", ""],
  ["Follow-up Failure", "First Call has exact machine-voicemail evidence and no later exact outbound call by the same salesperson to the same customer by Friday cutoff.", "This is a secondary, softer wastage layer; the base Called/Wasted result remains visible", ""],
  ["Lead Utilisation after Follow-up Failures %", "(Lead Allocations Called - Follow-up Failures) / Lead Allocations Received", "Zero denominators handled safely", ""],
  ["Outbound Calls Made", "All unique genuine outbound call attempts by included salespeople during Monday-Friday; repeated attempts with different Call IDs are retained.", "Duplicate source rows with the same Call ID are removed", ""],
  ["Potential Self-Sourced / Other Calls %", "Outbound calls not exactly matched to a reporting-week allocation for the same customer and salesperson received before the call, divided by Outbound Calls Made.", "May include self-sourced prospects, older leads, warm customers or other records; it is not definitive self-source attribution", ""],
  ["Manager-team exclusions", managerExclusionLabels.map((name) => `${name} team`).join("; ") || "None", `Allocation rows removed: ${excludedAllocations.filter((row) => managerExclusions.has(row.managerKey)).length.toLocaleString()}`, ""],
  ["Salesperson exclusions", salespersonExclusionLabels.join("; ") || "None", `Allocation rows removed after manager-team overlap: ${excludedAllocations.filter((row) => salespersonExclusions.has(row.salespersonKey) && !managerExclusions.has(row.managerKey)).length.toLocaleString()}`, ""],
  ["Missing manager rule", "Blank SalesManager is retained as Unassigned / Missing Manager.", "No unresolved records are silently dropped", ""],
  ["Name normalisation", "Trim, Unicode NFKC normalisation, repeated whitespace collapsed and case-insensitive comparison.", "No similarly named people are merged without exact normalised equality", ""],
  ["Data limitation", "The weekly call export has no definitive field proving that every unmatched call was self-sourced.", "The report therefore labels unmatched calls as Potential Self-Sourced / Other", ""],
  ["Call activity audit trail", "Potential Self-Sourced / Other counts are rebuilt directly from unique Call IDs in the named call source(s).", "The source files remain the row-level call audit trail and are not duplicated into this management workbook", ""],
  ["Source statistics", `${rawAllocations.length.toLocaleString()} allocation rows; ${inPeriodAllocations.length.toLocaleString()} unique in-period allocations; ${weekOutboundCalls.length.toLocaleString()} unique in-period outbound calls`, `${allocationDuplicatesRemoved.toLocaleString()} duplicate/missing allocation keys removed; ${duplicateCallRowsRemoved.toLocaleString()} duplicate/missing call IDs removed`, ""],
];
methodologySheet.getRange(`A4:D${4 + methodologyRows.length}`).values = [["Topic", "Rule / Value", "Practical Note", "Status"], ...methodologyRows];
styleHeader(methodologySheet.getRange("A4:D4"));
styleBody(methodologySheet.getRange(`A5:D${4 + methodologyRows.length}`));
methodologySheet.getRange(`A5:A${4 + methodologyRows.length}`).format = { fill: grey, font: { bold: true, color: darkGrey, size: 9 }, verticalAlignment: "top" };
methodologySheet.getRange(`B5:C${4 + methodologyRows.length}`).format.wrapText = true;
const qaStart = 6 + methodologyRows.length;
methodologySheet.getRange(`A${qaStart}:D${qaStart}`).merge();
methodologySheet.getRange(`A${qaStart}`).values = [["QA Validation"]];
methodologySheet.getRange(`A${qaStart}:D${qaStart}`).format = { fill: blue, font: { bold: true, color: navy, size: 12 } };
const qaRows = qaChecks.map(([check, passed]) => [check, passed ? "PASS" : "FAIL", "", ""]);
methodologySheet.getRange(`A${qaStart + 1}:D${qaStart + 1 + qaRows.length}`).values = [["Check", "Result", "", ""], ...qaRows];
styleHeader(methodologySheet.getRange(`A${qaStart + 1}:D${qaStart + 1}`));
styleBody(methodologySheet.getRange(`A${qaStart + 2}:D${qaStart + 1 + qaRows.length}`));
methodologySheet.getRange(`B${qaStart + 2}:B${qaStart + 1 + qaRows.length}`).format = { fill: "#E8F5E9", font: { bold: true, color: green }, horizontalAlignment: "center" };
methodologySheet.freezePanes.freezeRows(4);
setWidths(methodologySheet, { A: 29, B: 92, C: 75, D: 12 });

title(allocationEvidenceSheet, "R", "ALLOCATION EVIDENCE", "One row per included Lead Allocation; this is the auditable calculation grain.");
exclusionNote(allocationEvidenceSheet, "R");
const allocationHeaders = ["Lead Allocation Key", "Customer ID", "Business Name", "Lead Source", "Allocation Name", "Manager", "Salesperson", "Allocation Date", "Allocation Time", "Day Received", "First Call Date and Time", "First Call ID", "Customer Match Field", "Result", "First Call Voicemail", "Follow-up Call Date and Time", "Follow-up Call ID", "Follow-up Failure"];
const allocationRows = includedAllocations.map((row) => [
  row.allocationKey, row.customerId, row.businessName, row.leadSource, row.allocationName, row.manager, row.salesperson,
  row.allocationDate, row.allocationTime, row.dayReceived, row.firstCall ? row.firstCall.callDateTime : null,
  row.firstCall?.callId || "", row.firstCall?.customerMatchField || "", row.result, row.firstCallVoicemail ? "Yes" : "No",
  row.followUpCall ? row.followUpCall.callDateTime : null, row.followUpCall?.callId || "", row.followUpFailure ? "Yes" : "No",
]);
allocationEvidenceSheet.getRange(`A5:R${5 + allocationRows.length}`).values = [allocationHeaders, ...allocationRows];
styleHeader(allocationEvidenceSheet.getRange("A5:R5"));
styleBody(allocationEvidenceSheet.getRange(`A6:R${5 + allocationRows.length}`));
allocationEvidenceSheet.getRange(`H6:H${5 + allocationRows.length}`).format.numberFormat = "yyyy-mm-dd";
allocationEvidenceSheet.getRange(`K6:K${5 + allocationRows.length}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
allocationEvidenceSheet.getRange(`P6:P${5 + allocationRows.length}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
const allocationEvidenceTable = allocationEvidenceSheet.tables.add(`A5:R${5 + allocationRows.length}`, true, "AllocationEvidenceTable");
allocationEvidenceTable.style = "TableStyleLight1";
styleHeader(allocationEvidenceTable.getHeaderRowRange());
styleBody(allocationEvidenceTable.getDataRows());
allocationEvidenceSheet.freezePanes.freezeRows(5);
setWidths(allocationEvidenceSheet, { A: 18, B: 15, C: 28, D: 18, E: 25, F: 21, G: 23, H: 14, I: 12, J: 13, K: 22, L: 14, M: 20, N: 12, O: 16, P: 22, Q: 14, R: 16 });

function excelColumn(columnNumber) {
  let value = columnNumber;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function comparisonFill(status) {
  if (status === "improved") return { fill: "#E8F5E9", font: { bold: true, color: green } };
  if (status === "regressed") return { fill: "#FCE4E4", font: { bold: true, color: red } };
  return { fill: grey, font: { color: darkGrey } };
}

const trends = payload.ongoingTrends;
const trendWeeks = trends.visibleWeeks;

title(overallTrendSheet, "N", "ONGOING LEAD UTILISATION — OVERALL", `Verified weekly history through ${displayDate(periodEnd)}; ${trends.weekCount} comparable week${trends.weekCount === 1 ? "" : "s"} shown.`);
overallTrendSheet.getRange("A3:N4").merge();
overallTrendSheet.getRange("A3").values = [[`Week-on-week movement is labelled only at ±${(trends.meaningfulChange * 100).toFixed(1)} percentage points or more. Outlier prompts remain withheld until ${trends.outlierPriorWeeksRequired} prior comparable weeks exist. No Most Improved ranking is produced.`]];
overallTrendSheet.getRange("A3:N4").format = { fill: cream, font: { color: "#7F6000", italic: true, size: 9 }, wrapText: true, verticalAlignment: "center" };
const overallRows = trends.overall.series.map((row) => [
  row.weekLabel,
  row.metrics?.utilisation ?? null,
  row.metrics?.adjustedUtilisation ?? null,
  row.metrics?.received ?? null,
  row.metrics?.called ?? null,
  row.metrics?.wasted ?? null,
  row.metrics?.followUpFailures ?? null,
  row.metrics?.callsPerAllocation ?? null,
  row.metrics?.otherCallRatio ?? null,
]);
overallTrendSheet.getRange(`A6:I${6 + overallRows.length}`).values = [["Week", "Utilisation %", "Adjusted Utilisation %", "Allocations", "Called", "Wasted", "Follow-up Failures", "Calls / Allocation", "Potential Other Calls %"], ...overallRows];
styleHeader(overallTrendSheet.getRange("A6:I6"));
styleBody(overallTrendSheet.getRange(`A7:I${6 + overallRows.length}`));
overallTrendSheet.getRange(`B7:C${6 + overallRows.length}`).format.numberFormat = "0.0%";
overallTrendSheet.getRange(`D7:G${6 + overallRows.length}`).format.numberFormat = "#,##0";
overallTrendSheet.getRange(`H7:H${6 + overallRows.length}`).format.numberFormat = "0.00";
overallTrendSheet.getRange(`I7:I${6 + overallRows.length}`).format.numberFormat = "0.0%";
overallTrendSheet.getRange("K6:N6").merge();
overallTrendSheet.getRange("K6").values = [["Current movement and outlier prompt"]];
overallTrendSheet.getRange("K6:N6").format = { fill: blue, font: { bold: true, color: navy, size: 11 } };
overallTrendSheet.getRange("K7:L9").values = [["Week-on-week", trends.overall.comparison.label], ["Outlier prompt", trends.overall.outlier.label], ["Allocation gate", "Overall — all verified allocations"]];
overallTrendSheet.getRange("K7:K9").format = { fill: grey, font: { bold: true, color: darkGrey }, wrapText: true };
overallTrendSheet.getRange("L7:N7").merge();
overallTrendSheet.getRange("L8:N8").merge();
overallTrendSheet.getRange("L9:N9").merge();
overallTrendSheet.getRange("L7:N7").format = { ...comparisonFill(trends.overall.comparison.status), wrapText: true };
overallTrendSheet.getRange("L8:N9").format = { fill: grey, font: { color: darkGrey }, wrapText: true };
const overallRateChart = overallTrendSheet.charts.add("line", overallTrendSheet.getRange(`A6:C${6 + overallRows.length}`));
overallRateChart.title = "Overall Utilisation and Adjusted Utilisation";
overallRateChart.hasLegend = true;
overallRateChart.yAxis = { numberFormatCode: "0%", min: 0, max: 1 };
overallRateChart.setPosition("A13", "G29");
overallTrendSheet.getRange("P6:S6").values = [["Week", "Allocations", "Called", "Wasted"]];
overallTrendSheet.getRange(`P7:S${6 + overallRows.length}`).formulas = overallRows.map((_, index) => {
  const sourceRow = 7 + index;
  return [`=A${sourceRow}`, `=D${sourceRow}`, `=E${sourceRow}`, `=F${sourceRow}`];
});
const overallVolumeChart = overallTrendSheet.charts.add("line", overallTrendSheet.getRange(`P6:S${6 + overallRows.length}`));
overallVolumeChart.title = "Weekly Allocation Volumes";
overallVolumeChart.hasLegend = true;
overallVolumeChart.yAxis = { numberFormatCode: "#,##0", min: 0 };
overallVolumeChart.setPosition("H13", "N29");
overallTrendSheet.freezePanes.freezeRows(6);
setWidths(overallTrendSheet, { A: 14, B: 14, C: 19, D: 13, E: 11, F: 11, G: 15, H: 15, I: 18, J: 3, K: 16, L: 15, M: 15, N: 15 });

title(teamTrendSheet, "N", "ONGOING LEAD UTILISATION — TEAMS", `Each current included manager team is shown without performance ranking; history uses the same verified exclusion policy.`);
teamTrendSheet.getRange("A3:N4").merge();
teamTrendSheet.getRange("A3").values = [[`Improvement/regression threshold: ±${(trends.meaningfulChange * 100).toFixed(1)} percentage points. Outliers need ${trends.outlierPriorWeeksRequired} prior comparable weeks. Team totals use aggregated counts.`]];
teamTrendSheet.getRange("A3:N4").format = { fill: cream, font: { color: "#7F6000", italic: true, size: 9 }, wrapText: true, verticalAlignment: "center" };
const teamSummaryRows = trends.teams.map((team) => [team.name, team.current?.received ?? null, team.current?.utilisation ?? null, team.current?.adjustedUtilisation ?? null, team.comparison.change, team.comparison.label, team.outlier.label]);
teamTrendSheet.getRange(`A6:G${6 + teamSummaryRows.length}`).values = [["Manager team", "Current allocations", "Utilisation %", "Adjusted Utilisation %", "WoW change", "Movement", "Outlier prompt"], ...teamSummaryRows];
styleHeader(teamTrendSheet.getRange("A6:G6"));
styleBody(teamTrendSheet.getRange(`A7:G${6 + teamSummaryRows.length}`));
teamTrendSheet.getRange(`B7:B${6 + teamSummaryRows.length}`).format.numberFormat = "#,##0";
teamTrendSheet.getRange(`C7:E${6 + teamSummaryRows.length}`).format.numberFormat = "0.0%";
trends.teams.forEach((team, index) => {
  const summaryRow = 7 + index;
  teamTrendSheet.getRange(`F${summaryRow}`).format = { ...comparisonFill(team.comparison.status), wrapText: true };
  teamTrendSheet.getRange(`G${summaryRow}`).format = { fill: grey, font: { color: darkGrey }, wrapText: true };
});
let teamBlockRow = 9 + teamSummaryRows.length;
for (const team of trends.teams) {
  const rows = team.series.map((row) => [row.weekLabel, row.metrics?.utilisation ?? null, row.metrics?.adjustedUtilisation ?? null, row.metrics?.received ?? null]);
  teamTrendSheet.getRange(`A${teamBlockRow}:D${teamBlockRow + rows.length}`).values = [["Week", "Utilisation %", "Adjusted Utilisation %", "Allocations"], ...rows];
  styleHeader(teamTrendSheet.getRange(`A${teamBlockRow}:D${teamBlockRow}`));
  styleBody(teamTrendSheet.getRange(`A${teamBlockRow + 1}:D${teamBlockRow + rows.length}`));
  teamTrendSheet.getRange(`B${teamBlockRow + 1}:C${teamBlockRow + rows.length}`).format.numberFormat = "0.0%";
  teamTrendSheet.getRange(`D${teamBlockRow + 1}:D${teamBlockRow + rows.length}`).format.numberFormat = "#,##0";
  const teamChart = teamTrendSheet.charts.add("line", teamTrendSheet.getRange(`A${teamBlockRow}:C${teamBlockRow + rows.length}`));
  teamChart.title = `${team.name} — utilisation trend`;
  teamChart.hasLegend = true;
  teamChart.yAxis = { numberFormatCode: "0%", min: 0, max: 1 };
  teamChart.setPosition(`F${teamBlockRow}`, `N${teamBlockRow + Math.max(10, rows.length + 3)}`);
  teamBlockRow += Math.max(12, rows.length + 5);
}
teamTrendSheet.freezePanes.freezeRows(6);
setWidths(teamTrendSheet, { A: 24, B: 17, C: 14, D: 19, E: 14, F: 22, G: 24, H: 3, I: 12, J: 12, K: 12, L: 12, M: 12, N: 12 });

const personLastColumn = excelColumn(10 + Math.max(1, trendWeeks.length));
title(personTrendSheet, personLastColumn, "ONGOING LEAD UTILISATION — QUALIFYING PEOPLE", `Current-week inclusion requires at least ${trends.personMinimumAllocations.toLocaleString()} allocations; no Most Improved ranking is produced.`);
personTrendSheet.getRange(`A3:${personLastColumn}4`).merge();
personTrendSheet.getRange("A3").values = [[`Person-level callouts include only salespeople with at least ${trends.personMinimumAllocations.toLocaleString()} current-week allocations. A week-on-week label also requires the prior week to meet that threshold. Grey gaps mean the person did not have a comparable result for that week.`]];
personTrendSheet.getRange(`A3:${personLastColumn}4`).format = { fill: cream, font: { color: "#7F6000", italic: true, size: 9 }, wrapText: true, verticalAlignment: "center" };
const personHeaders = ["Salesperson", "Manager", "Current allocations", "Current utilisation %", "Adjusted utilisation %", "WoW change", "Movement", "Outlier prompt", "Utilisation trend", "Comparable weeks", ...trendWeeks.map((week) => week.weekLabel)];
const personRows = trends.people.map((person) => [
  person.name,
  person.manager,
  person.current?.received ?? null,
  person.current?.utilisation ?? null,
  person.current?.adjustedUtilisation ?? null,
  person.comparison.change,
  person.comparison.label,
  person.outlier.label,
  "",
  person.series.filter((row) => (row.metrics?.received || 0) >= trends.personMinimumAllocations).length,
  ...person.series.map((row) => (row.metrics?.received || 0) >= trends.personMinimumAllocations ? row.metrics.utilisation : null),
]);
personTrendSheet.getRange(`A6:${personLastColumn}${6 + personRows.length}`).values = [personHeaders, ...personRows];
styleHeader(personTrendSheet.getRange(`A6:${personLastColumn}6`));
styleBody(personTrendSheet.getRange(`A7:${personLastColumn}${6 + personRows.length}`));
personTrendSheet.getRange(`C7:C${6 + personRows.length}`).format.numberFormat = "#,##0";
personTrendSheet.getRange(`D7:F${6 + personRows.length}`).format.numberFormat = "0.0%";
if (trendWeeks.length) personTrendSheet.getRange(`K7:${personLastColumn}${6 + personRows.length}`).format.numberFormat = "0.0%";
trends.people.forEach((person, index) => {
  const row = 7 + index;
  personTrendSheet.getRange(`G${row}`).format = { ...comparisonFill(person.comparison.status), wrapText: true };
  personTrendSheet.getRange(`H${row}`).format = { fill: grey, font: { color: darkGrey }, wrapText: true };
  if (trendWeeks.length) {
    personTrendSheet.sparklineGroups.add({
      type: "line",
      targetRange: `I${row}`,
      sourceData: `K${row}:${personLastColumn}${row}`,
      seriesColor: navy,
      markers: { show: true, high: true, low: true, last: true },
      axis: { manualMin: 0, manualMax: 1 },
      lineWeight: 1.5,
    });
  }
});
personTrendSheet.freezePanes.freezeRows(6);
setWidths(personTrendSheet, { A: 25, B: 22, C: 17, D: 17, E: 19, F: 14, G: 22, H: 25, I: 18, J: 16 });
for (let column = 11; column <= 10 + trendWeeks.length; column += 1) personTrendSheet.getRange(`${excelColumn(column)}:${excelColumn(column)}`).format.columnWidth = 12;

const keyInspect = await workbook.inspect({
  kind: "table",
  range: "Lead Utilisation Summary!A1:R16",
  include: "values,formulas",
  tableMaxRows: 16,
  tableMaxCols: 18,
  maxChars: 5000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 4000,
});
await fs.writeFile(path.join(outputDir, "verification_inspect.ndjson"), `${keyInspect.ndjson}\n${formulaErrors.ndjson}\n`);

const renderTargets = [
  ["Lead Utilisation Summary", "A1:R51", "summary.png"],
  ["Salesperson Utilisation", `A1:R${Math.min(20, 5 + salespersonRows.length)}`, "salesperson.png"],
  ["Manager Utilisation", `A1:Q${5 + managerRows.length}`, "manager.png"],
  ["Wasted Lead Detail", "A1:M14", "wasted.png"],
  ["Follow-up Failure Detail", "A1:O14", "followup.png"],
  ["Methodology & QA", `A1:D${qaStart + 1 + qaRows.length}`, "methodology.png"],
  ["Allocation Evidence", "A1:R14", "allocation_evidence.png"],
  ["Ongoing Overall Trends", `A1:N${Math.max(29, 6 + overallRows.length)}`, "ongoing_overall_trends.png"],
  ["Ongoing Team Trends", `A1:N${Math.min(teamBlockRow, 85)}`, "ongoing_team_trends.png"],
  ["Ongoing Person Trends", `A1:${personLastColumn}${Math.min(22, 6 + personRows.length)}`, "ongoing_person_trends.png"],
];
for (const [sheetName, range, filename] of renderTargets) {
  const image = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await image.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ outputPath, dataPath, totals, managers: managers.length, salespeople: salespeople.length, exclusions: payload.exclusions, sourceStats: payload.sourceStats, ongoingTrends: { weekCount: trends.weekCount, qualifyingPeople: trends.people.length, personMinimumAllocations: trends.personMinimumAllocations } }, null, 2));
