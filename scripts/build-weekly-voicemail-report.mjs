import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../src/csvParser.js");
const { evaluateCall } = require("../src/transcriptEvaluator.js");

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

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ISO date: ${isoDate}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requireMonday(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "")) throw new Error("--start must use YYYY-MM-DD.");
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCDay() !== 1) throw new Error(`--start must be a Monday: ${isoDate}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.start || !args.output) {
  throw new Error("Usage: --start YYYY-MM-DD --output <directory> [--source-config <performance-cohorts.json>] [--reference <template.xlsx>] [--manager-exclusions <semicolon-list>] [--salesperson-exclusions <semicolon-list>]");
}
requireMonday(String(args.start));
const root = path.resolve(String(args.root || process.cwd()));
const reportStart = String(args.start);
const reportEnd = addDays(reportStart, 4);
const previousStart = addDays(reportStart, -7);
const previousEnd = addDays(reportStart, -3);
const runId = `${reportStart}_to_${reportEnd}`;
const workDir = path.resolve(String(args.work || path.join(root, "work", "weekly-voicemail-follow-up", runId)));
const outputDir = path.resolve(String(args.output));
const outputPath = path.join(outputDir, String(args.filename || `Voicemail_Follow_Up_Report_${runId}.xlsx`));
const referencePath = path.resolve(String(args.reference || path.join(root, "assets", "report-templates", "weekly-voicemail-follow-up-reference.xlsx")));
const sourceConfigPath = path.resolve(String(args["source-config"] || path.join(root, "data", "store", "performance-cohorts.json")));
const reportDataPath = path.resolve(String(args["report-data"] || path.join(outputDir, "voicemail_report_data.json")));
const qaPath = path.resolve(String(args.qa || path.join(outputDir, "voicemail_qa.json")));
const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_LEADS = 20;
const RED_THRESHOLD = 0.4;
const GREEN_THRESHOLD = 0.6;
const MOVEMENT_THRESHOLD = 0.05;
const listArg = (value) => String(value || "").trim() ? String(value).split(";").map((item) => item.trim()).filter(Boolean) : [];
const MANAGER_TEAM_EXCLUSION_LABELS = listArg(args["manager-exclusions"]);
const SALESPERSON_EXCLUSION_LABELS = listArg(args["salesperson-exclusions"]);
const MANAGER_TEAM_EXCLUSIONS = new Set(MANAGER_TEAM_EXCLUSION_LABELS.map((name) => name.toLowerCase()));
const SALESPERSON_EXCLUSIONS = new Set(SALESPERSON_EXCLUSION_LABELS.map((name) => name.toLowerCase()));
const EXCLUSION_DISPLAY = String(args["exclusion-display"] || "").trim();
if (!MANAGER_TEAM_EXCLUSION_LABELS.length || !SALESPERSON_EXCLUSION_LABELS.length || !EXCLUSION_DISPLAY) {
  throw new Error("Manager exclusions, salesperson exclusions and --exclusion-display are required.");
}

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function norm(value) {
  return clean(value).toLowerCase();
}

function managerLabel(value) {
  return clean(value) || "Unassigned / Missing Manager";
}

function isManagerTeamExcluded(value) {
  return MANAGER_TEAM_EXCLUSIONS.has(norm(value));
}

function isSalespersonExcluded(value) {
  return SALESPERSON_EXCLUSIONS.has(norm(value));
}

function blankMatrix(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function parseClock(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const ampm = String(match[4] || "").toUpperCase();
  if (ampm === "AM" && hour === 12) hour = 0;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function parseSourceTimestamp(row, dateOrder) {
  const rawDate = clean(row.call_date).split(/\s+/)[0];
  const parts = rawDate.split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [first, second, year] = parts;
  const month = dateOrder === "day_first" ? second : first;
  const day = dateOrder === "day_first" ? first : second;
  const clock = parseClock(row.call_time) || { hour: 0, minute: 0, second: 0 };
  const timestamp = Date.UTC(year, month - 1, day, clock.hour, clock.minute, clock.second);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timestamp;
}

function isoDayTimestamp(isoDate, endOfDay = false) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function periodLabel(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startMonth = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" }).format(end);
  const year = end.getUTCFullYear();
  return startMonth === endMonth ? `${startDay}–${endDay} ${endMonth} ${year}` : `${startDay} ${startMonth}–${endDay} ${endMonth} ${year}`;
}

function shortDate(iso) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));
}

function isNewBusiness(orderCount) {
  const value = clean(orderCount);
  if (!value || /^(?:null|none|n\/a)$/i.test(value)) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

function classifyResult(total, followed) {
  const rate = total ? followed / total : 0;
  if (total < MINIMUM_LEADS) return "Too few leads";
  if (rate < RED_THRESHOLD) return "Needs attention";
  if (rate >= GREEN_THRESHOLD) return "Following well";
  return "Mixed";
}

function outcomeSort(outcome) {
  if (outcome === "No qualifying follow-up by Friday — no later call found") return 0;
  if (outcome === "Other call only — no qualifying follow-up by Friday") return 1;
  return 2;
}

async function loadCallBundle() {
  const config = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
  const requiredRoles = (config.callSources || []).filter((source) => ["primary_history", "weekly_supplement"].includes(source.role));
  const loaded = [];
  for (const source of requiredRoles) {
    const text = await fs.readFile(source.path, "utf8");
    const parsed = parseCsv(text);
    for (const row of parsed.rows) {
      loaded.push({ row, timestamp: parseSourceTimestamp(row, source.dateOrder), sourcePath: source.path, dateOrder: source.dateOrder });
    }
  }
  const managerByAllocationId = new Map();
  const managerCountsBySalesperson = new Map();
  for (const source of config.allocationSources || []) {
    const parsed = parseCsv(await fs.readFile(source.path, "utf8"));
    for (const row of parsed.rows) {
      const salesperson = clean(row.FullName || row.OwningSalesperson);
      const manager = managerLabel(row.SalesManager || row.OwningSalesManager);
      const allocationId = clean(row.AllocationItemID);
      if (allocationId && !managerByAllocationId.has(allocationId)) managerByAllocationId.set(allocationId, manager);
      if (!salesperson) continue;
      const key = norm(salesperson);
      if (!managerCountsBySalesperson.has(key)) managerCountsBySalesperson.set(key, new Map());
      const counts = managerCountsBySalesperson.get(key);
      counts.set(manager, (counts.get(manager) || 0) + 1);
    }
  }
  const managerBySalesperson = new Map();
  for (const [salesperson, counts] of managerCountsBySalesperson) {
    const manager = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (manager) managerBySalesperson.set(salesperson, manager);
  }
  return {
    loaded,
    sourcePaths: requiredRoles.map((source) => source.path),
    managerLookup: { managerByAllocationId, managerBySalesperson },
  };
}

function deduplicateThrough(loaded, cutoff) {
  const rows = loaded.filter((item) => Number.isFinite(item.timestamp) && item.timestamp <= cutoff);
  const byId = new Map();
  let missingCallId = 0;
  let duplicates = 0;
  const conflicts = [];
  for (const item of rows) {
    const callId = clean(item.row.call_id);
    if (!callId) {
      missingCallId += 1;
      continue;
    }
    const existing = byId.get(callId);
    if (!existing) {
      byId.set(callId, item);
      continue;
    }
    duplicates += 1;
    const fingerprint = (entry) => [entry.timestamp, clean(entry.row.customer_id), norm(entry.row.Salesperson), norm(entry.row.call_direction)].join("|");
    if (fingerprint(existing) !== fingerprint(item)) conflicts.push(callId);
  }
  if (conflicts.length) throw new Error(`Conflicting duplicate call IDs: ${conflicts.slice(0, 10).join(", ")}`);
  return { rows: [...byId.values()].sort((a, b) => a.timestamp - b.timestamp || clean(a.row.call_id).localeCompare(clean(b.row.call_id))), sourceRows: rows.length, validUniqueCalls: byId.size, duplicates, missingCallId };
}

function buildCohort(uniqueRows, startIso, endIso, checkThroughIso, managerLookup, applyReportExclusions = true) {
  const start = isoDayTimestamp(startIso);
  const end = isoDayTimestamp(endIso, true);
  const cutoff = isoDayTimestamp(checkThroughIso, true);
  const callsByCustomer = new Map();
  for (const item of uniqueRows) {
    const customerId = clean(item.row.customer_id);
    if (!customerId || item.timestamp > cutoff) continue;
    if (!callsByCustomer.has(customerId)) callsByCustomer.set(customerId, []);
    callsByCustomer.get(customerId).push(item);
  }
  const anchorsByCustomer = new Map();
  let excludedManagerTeamAnchors = 0;
  let excludedSalespersonAnchors = 0;
  let missingCustomerAnchors = 0;
  let exactAllocationManagerAnchors = 0;
  let salespersonManagerAnchors = 0;
  let unresolvedManagerAnchors = 0;
  for (const item of uniqueRows) {
    const row = item.row;
    if (item.timestamp < start || item.timestamp > end) continue;
    if (norm(row.call_direction) !== "out") continue;
    if (!isNewBusiness(row.OrderCount)) continue;
    const evaluation = evaluateCall(row);
    const literalNoContactType = evaluation.contact?.classification;
    if (!["no_answer", "voicemail", "system_audio"].includes(literalNoContactType)) continue;
    const customerId = clean(row.customer_id);
    if (!customerId) {
      missingCustomerAnchors += 1;
      continue;
    }
    const managerFromAllocation = managerLookup.managerByAllocationId.get(clean(row.AllocatedLeadID));
    const managerFromSalesperson = managerLookup.managerBySalesperson.get(norm(row.Salesperson));
    const manager = managerLabel(managerFromAllocation || managerFromSalesperson);
    const managerResolution = managerFromAllocation ? "Exact allocation ID" : managerFromSalesperson ? "Salesperson mapping" : "Unassigned / Missing Manager";
    if (managerResolution === "Exact allocation ID") exactAllocationManagerAnchors += 1;
    else if (managerResolution === "Salesperson mapping") salespersonManagerAnchors += 1;
    else unresolvedManagerAnchors += 1;
    if (applyReportExclusions && isManagerTeamExcluded(manager)) {
      excludedManagerTeamAnchors += 1;
      continue;
    }
    if (applyReportExclusions && isSalespersonExcluded(row.Salesperson)) {
      excludedSalespersonAnchors += 1;
      continue;
    }
    const prior = anchorsByCustomer.get(customerId);
    if (!prior || item.timestamp < prior.timestamp || (item.timestamp === prior.timestamp && clean(row.call_id).localeCompare(clean(prior.row.call_id)) < 0)) {
      anchorsByCustomer.set(customerId, { ...item, literalNoContactType, manager, managerResolution });
    }
  }
  const evidence = [];
  for (const [customerId, anchor] of anchorsByCustomer) {
    if (anchor.literalNoContactType !== "voicemail") continue;
    const laterCalls = (callsByCustomer.get(customerId) || []).filter((item) => item.timestamp > anchor.timestamp && item.timestamp <= cutoff);
    const salespersonKey = norm(anchor.row.Salesperson);
    const qualifying = laterCalls.find((item) => norm(item.row.call_direction) === "out" && norm(item.row.Salesperson) === salespersonKey) || null;
    const other = laterCalls.find((item) => !(norm(item.row.call_direction) === "out" && norm(item.row.Salesperson) === salespersonKey)) || null;
    const followed = Boolean(qualifying);
    const noLater = laterCalls.length === 0;
    const outcome = followed ? "Followed up by Friday"
      : noLater ? "No qualifying follow-up by Friday — no later call found"
        : "Other call only — no qualifying follow-up by Friday";
    evidence.push({
      manager: anchor.manager,
      managerResolution: anchor.managerResolution,
      salesperson: clean(anchor.row.Salesperson) || "Unknown",
      customerId,
      leadId: clean(anchor.row.AllocatedLeadID),
      anchorAt: anchor.timestamp,
      firstCallId: clean(anchor.row.call_id),
      nextAt: qualifying?.timestamp ?? null,
      nextCallId: qualifying ? clean(qualifying.row.call_id) : "",
      hoursLater: qualifying ? (qualifying.timestamp - anchor.timestamp) / 3_600_000 : null,
      otherAt: other?.timestamp ?? null,
      otherCallId: other ? clean(other.row.call_id) : "",
      otherSalesperson: other ? clean(other.row.Salesperson) : "",
      otherDirection: other ? (norm(other.row.call_direction) === "out" ? "Outbound" : "Inbound") : "",
      followed,
      noLater,
      outcome,
      dayReceived: new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long" }).format(new Date(anchor.timestamp)),
      hoursAvailable: (cutoff - anchor.timestamp) / 3_600_000,
    });
  }
  evidence.sort((a, b) => outcomeSort(a.outcome) - outcomeSort(b.outcome) || a.salesperson.localeCompare(b.salesperson) || a.anchorAt - b.anchorAt || a.customerId.localeCompare(b.customerId));
  const peopleMap = new Map();
  for (const item of evidence) {
    const key = norm(item.salesperson);
    if (!peopleMap.has(key)) peopleMap.set(key, { salesperson: item.salesperson, managerCounts: new Map(), total: 0, followed: 0, noLater: 0 });
    const person = peopleMap.get(key);
    person.managerCounts.set(item.manager, (person.managerCounts.get(item.manager) || 0) + 1);
    person.total += 1;
    person.followed += item.followed ? 1 : 0;
    person.noLater += item.noLater ? 1 : 0;
  }
  const statusOrder = new Map([["Needs attention", 0], ["Mixed", 1], ["Following well", 2], ["Too few leads", 3]]);
  const people = [...peopleMap.values()].map((person) => {
    const manager = [...person.managerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unassigned / Missing Manager";
    return {
      manager,
      salesperson: person.salesperson,
      total: person.total,
      followed: person.followed,
      noLater: person.noLater,
      notByFriday: person.total - person.followed,
      rate: person.total ? person.followed / person.total : 0,
      noLaterRate: person.total ? person.noLater / person.total : 0,
      status: classifyResult(person.total, person.followed),
    };
  }).sort((a, b) => statusOrder.get(a.status) - statusOrder.get(b.status)
    || (a.status === "Following well" ? b.rate - a.rate : b.noLater - a.noLater)
    || b.total - a.total || a.salesperson.localeCompare(b.salesperson));
  const teamMap = new Map();
  for (const item of evidence) {
    const key = norm(item.manager);
    if (!teamMap.has(key)) teamMap.set(key, { manager: item.manager, salespersonKeys: new Set(), total: 0, followed: 0, noLater: 0 });
    const team = teamMap.get(key);
    team.salespersonKeys.add(norm(item.salesperson));
    team.total += 1;
    team.followed += item.followed ? 1 : 0;
    team.noLater += item.noLater ? 1 : 0;
  }
  const teams = [...teamMap.values()].map((team) => ({
    manager: team.manager,
    salespeople: team.salespersonKeys.size,
    total: team.total,
    followed: team.followed,
    noLater: team.noLater,
    notByFriday: team.total - team.followed,
    rate: team.total ? team.followed / team.total : 0,
    noLaterRate: team.total ? team.noLater / team.total : 0,
    status: classifyResult(team.total, team.followed),
  })).sort((a, b) => statusOrder.get(a.status) - statusOrder.get(b.status)
    || (a.status === "Following well" ? b.rate - a.rate : b.noLater - a.noLater)
    || b.total - a.total || a.manager.localeCompare(b.manager));
  return {
    startIso, endIso, checkThroughIso, evidence, people, teams,
    totals: {
      checked: evidence.length,
      followed: evidence.filter((item) => item.followed).length,
      notByFriday: evidence.filter((item) => !item.followed).length,
      noLater: evidence.filter((item) => item.noLater).length,
    },
    quality: {
      excludedManagerTeamAnchors,
      excludedSalespersonAnchors,
      missingCustomerAnchors,
      exactAllocationManagerAnchors,
      salespersonManagerAnchors,
      unresolvedManagerAnchors,
      completeReportingWeek: cutoff === end,
    },
  };
}

function comparisonRows(current, previous) {
  const previousByName = new Map(previous.people.map((person) => [norm(person.salesperson), person]));
  return current.people.map((person) => {
    const prior = previousByName.get(norm(person.salesperson)) || null;
    const change = prior ? person.rate - prior.rate : null;
    let direction = "No previous result";
    if (prior && (person.total < MINIMUM_LEADS || prior.total < MINIMUM_LEADS)) direction = "Too few leads";
    else if (prior && change >= MOVEMENT_THRESHOLD) direction = "Improved";
    else if (prior && change <= -MOVEMENT_THRESHOLD) direction = "Regressed";
    else if (prior) direction = "Broadly stable";
    const explanation = direction === "Improved" ? "Follow-up rate rose by at least 5 percentage points."
      : direction === "Regressed" ? "Follow-up rate fell by at least 5 percentage points."
        : direction === "Broadly stable" ? "The movement was smaller than 5 percentage points."
          : direction === "Too few leads" ? "At least one period had fewer than 20 leads."
            : "No matching salesperson result exists in the previous period.";
    return { person, prior, change, direction, explanation };
  });
}

function teamComparisonRows(current, previous) {
  const previousByManager = new Map(previous.teams.map((team) => [norm(team.manager), team]));
  return current.teams.map((team) => {
    const prior = previousByManager.get(norm(team.manager)) || null;
    const change = prior ? team.rate - prior.rate : null;
    let direction = "No previous result";
    if (prior && (team.total < MINIMUM_LEADS || prior.total < MINIMUM_LEADS)) direction = "Too few leads";
    else if (prior && change >= MOVEMENT_THRESHOLD) direction = "Improved";
    else if (prior && change <= -MOVEMENT_THRESHOLD) direction = "Regressed";
    else if (prior) direction = "Broadly stable";
    const explanation = direction === "Improved" ? "Team follow-up rate rose by at least 5 percentage points."
      : direction === "Regressed" ? "Team follow-up rate fell by at least 5 percentage points."
        : direction === "Broadly stable" ? "The movement was smaller than 5 percentage points."
          : direction === "Too few leads" ? "At least one period had fewer than 20 voicemail customers."
            : "No matching manager-team result exists in the previous period.";
    return { team, prior, change, direction, explanation };
  });
}

function assertCohort(cohort, label) {
  const start = isoDayTimestamp(cohort.startIso);
  const end = isoDayTimestamp(cohort.endIso, true);
  const cutoff = isoDayTimestamp(cohort.checkThroughIso, true);
  const checks = [
    ["evidence rows reconcile", cohort.evidence.length === cohort.totals.checked],
    ["unique exact customers", new Set(cohort.evidence.map((item) => item.customerId)).size === cohort.totals.checked],
    ["followed rows reconcile", cohort.evidence.filter((item) => item.followed).length === cohort.totals.followed],
    ["not-followed rows reconcile", cohort.evidence.filter((item) => !item.followed).length === cohort.totals.notByFriday],
    ["no-later rows reconcile", cohort.evidence.filter((item) => item.noLater).length === cohort.totals.noLater],
    ["person totals reconcile", cohort.people.reduce((sum, item) => sum + item.total, 0) === cohort.totals.checked],
    ["person followed reconcile", cohort.people.reduce((sum, item) => sum + item.followed, 0) === cohort.totals.followed],
    ["person no-later reconcile", cohort.people.reduce((sum, item) => sum + item.noLater, 0) === cohort.totals.noLater],
    ["team totals reconcile", cohort.teams.reduce((sum, item) => sum + item.total, 0) === cohort.totals.checked],
    ["team followed reconcile", cohort.teams.reduce((sum, item) => sum + item.followed, 0) === cohort.totals.followed],
    ["team no-later reconcile", cohort.teams.reduce((sum, item) => sum + item.noLater, 0) === cohort.totals.noLater],
    ["excluded manager teams absent", !cohort.evidence.some((item) => isManagerTeamExcluded(item.manager))],
    ["excluded salespeople absent", !cohort.evidence.some((item) => isSalespersonExcluded(item.salesperson))],
    ["every row has a manager bucket", cohort.evidence.every((item) => clean(item.manager))],
    ["Friday cutoff complete", cohort.quality.completeReportingWeek],
    ["no-later is within not-followed", cohort.totals.noLater <= cohort.totals.notByFriday],
    ["anchors fall inside reporting week", cohort.evidence.every((item) => item.anchorAt >= start && item.anchorAt <= end)],
    ["qualifying follow-ups fall after anchor and by Friday", cohort.evidence.every((item) => !item.followed || (item.nextAt > item.anchorAt && item.nextAt <= cutoff))],
    ["no-later rows have no qualifying or other call", cohort.evidence.every((item) => !item.noLater || (!item.nextAt && !item.otherAt))],
    ["outcome labels reconcile", cohort.evidence.every((item) => item.followed === (item.outcome === "Followed up by Friday"))],
  ];
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`${label} cohort QA failed: ${failed.join(", ")}`);
  return checks.map(([name]) => name);
}

function setSingle(sheet, address, value) {
  sheet.getRange(address).values = [[value]];
}

function resetMerged(sheet, range, rows, columns) {
  sheet.unmergeCells(range);
  sheet.getRange(range).values = blankMatrix(rows, columns);
  sheet.mergeCells(range);
}

function replaceTable(sheet, name, range, style = "TableStyleMedium2") {
  const existing = sheet.tables.getItemOrNullObject(name);
  if (!existing.isNullObject) existing.delete();
  const table = sheet.tables.add(range, true, name);
  table.style = style;
  return table;
}

const { loaded, sourcePaths, managerLookup } = await loadCallBundle();
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(workDir, { recursive: true });
const currentCutoff = isoDayTimestamp(reportEnd, true);
const currentBundle = deduplicateThrough(loaded, currentCutoff);
const previous = buildCohort(currentBundle.rows, previousStart, previousEnd, previousEnd, managerLookup);
const current = buildCohort(currentBundle.rows, reportStart, reportEnd, reportEnd, managerLookup);
if (!current.quality.completeReportingWeek || !previous.quality.completeReportingWeek) throw new Error("A reporting cohort lacks a complete Monday-to-Friday reporting window.");
const cohortChecks = { current: assertCohort(current, "Current"), previous: assertCohort(previous, "Previous") };
const comparisons = comparisonRows(current, previous);
const teamComparisons = teamComparisonRows(current, previous);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(referencePath));
const startHere = workbook.worksheets.getItem("Start Here");
const allPeople = workbook.worksheets.getItem("All Salespeople");
const evidenceSheet = workbook.worksheets.getItem("Lead Evidence");
const methodSheet = workbook.worksheets.getItem("How We Checked");
const comparisonSheet = workbook.worksheets.getItem("Week-on-Week");
const previousSheet = workbook.worksheets.getItem("Previous Period");
const teamSheet = workbook.worksheets.add("Team Follow-up");
const teamComparisonSheet = workbook.worksheets.add("Team Week-on-Week");

const rate = current.totals.checked ? current.totals.followed / current.totals.checked : 0;
const noLaterRate = current.totals.checked ? current.totals.noLater / current.totals.checked : 0;
for (const [range, rows, columns] of [
  ["A3:I3", 1, 9], ["A4:B4", 1, 2], ["C4:D4", 1, 2], ["E4:F4", 1, 2], ["G4:I4", 1, 3],
  ["A5:B5", 1, 2], ["C5:D5", 1, 2], ["E5:F5", 1, 2], ["G5:I5", 1, 3],
  ["A6:B6", 1, 2], ["C6:D6", 1, 2], ["E6:F6", 1, 2], ["G6:I6", 1, 3],
  ["A8:I8", 1, 9], ["A24:C24", 1, 3], ["D24:F24", 1, 3], ["G24:I24", 1, 3],
]) resetMerged(startHere, range, rows, columns);
setSingle(startHere, "A1", `Voicemail Follow-Up — ${periodLabel(current.startIso, current.endIso)}`);
setSingle(startHere, "A3", `We checked whether customers who reached voicemail or an answering machine received another outbound call from the same salesperson by the end of Friday. Scope matches Lead Utilisation: excluded ${EXCLUSION_DISPLAY}.`);
setSingle(startHere, "A4", "VOICEMAILS CHECKED");
setSingle(startHere, "C4", "FOLLOWED UP BY FRIDAY");
setSingle(startHere, "E4", "NO QUALIFYING FOLLOW-UP BY FRIDAY");
setSingle(startHere, "G4", "NO LATER CALL OF ANY KIND BY FRIDAY");
setSingle(startHere, "A5", current.totals.checked);
setSingle(startHere, "C5", current.totals.followed);
setSingle(startHere, "E5", current.totals.notByFriday);
setSingle(startHere, "G5", current.totals.noLater);
setSingle(startHere, "A6", 1);
setSingle(startHere, "C6", rate);
setSingle(startHere, "E6", 1 - rate);
setSingle(startHere, "G6", noLaterRate);
setSingle(startHere, "A8", `Bottom line: ${(rate * 100).toFixed(0)}% received a qualifying same-salesperson outbound follow-up by Friday. The other ${((1 - rate) * 100).toFixed(0)}% need checking.`);
setSingle(startHere, "C11", "Followed");
setSingle(startHere, "D11", "No follow-up");
setSingle(startHere, "B11", "Voicemails");
setSingle(startHere, "H11", "Followed");
setSingle(startHere, "I11", "No follow-up");
setSingle(startHere, "G11", "Voicemails");
startHere.getRange("A12:D21").values = blankMatrix(10, 4);
startHere.getRange("F12:I21").values = blankMatrix(10, 4);
const attention = current.people.filter((person) => person.status === "Needs attention").slice(0, 10);
if (attention.length) startHere.getRange(`A12:D${11 + attention.length}`).values = attention.map((person) => [person.salesperson, person.total, person.followed, person.notByFriday]);
const strongest = current.people.filter((person) => person.status === "Following well").sort((a, b) => b.rate - a.rate || b.total - a.total).slice(0, 8);
if (strongest.length) startHere.getRange(`F12:I${11 + strongest.length}`).values = strongest.map((person) => [person.salesperson, person.total, person.followed, person.notByFriday]);
setSingle(startHere, "F20", `Top ${strongest.length} shown. All green names are on the All Salespeople tab. Green means 60% or more received a qualifying follow-up by Friday.`);
setSingle(startHere, "A24", "Colour guide: red means fewer than 40% received a qualifying follow-up by Friday; amber means 40% to under 60%; green means 60% or more.");
setSingle(startHere, "D24", "AMBER — Mixed\n40% to 59% followed up by Friday.");
setSingle(startHere, "G24", "GREEN — Following well\n60% or more followed up by Friday.");
setSingle(startHere, "A27", "Manager use: open Team Follow-up for the aggregated manager-team view, then Lead Evidence to distinguish no later call from calls that did not meet the same-salesperson outbound rule.");
setSingle(startHere, "A29", `Open Team Week-on-Week and Week-on-Week to see team and individual movement versus ${periodLabel(previous.startIso, previous.endIso)}.`);
setSingle(startHere, "A30", `Important: “No later call found” means no matching call was found in the available call data through ${shortDate(current.checkThroughIso)}. It is a strong reason to investigate, but it is not automatic proof that nothing happened elsewhere.`);

setSingle(startHere, "A30", `Important: "No later call found" means no later call of any kind was found by Friday in the available call data. Monday voicemails have the longest follow-up window; Friday voicemails must be followed up the same day.`);
startHere.getRange("C12:C21").format.numberFormat = "0";
startHere.getRange("H12:H21").format.numberFormat = "0";

allPeople.getRange("A7:H100").values = blankMatrix(94, 8);
allPeople.getRange("A1:H100").conditionalFormats.deleteAll();
const allLastRow = 6 + current.people.length;
resetMerged(allPeople, "A5:H5", 1, 8);
setSingle(allPeople, "A1", "All Salespeople — Voicemail Follow-Up by Friday");
setSingle(allPeople, "A3", "Each row uses the same Monday-to-Friday cohort and Friday cutoff. Day-of-week mix matters because later-week voicemails have less time available.");
setSingle(allPeople, "A5", "A qualifying follow-up is a later outbound call by the same salesperson to the same customer by Friday 11:59:59 pm. Inbound calls and calls by another employee are context only.");
allPeople.getRange("A6:H6").values = [["Salesperson", "Voicemails", "Followed up by Friday", "No follow-up by Friday", "No later call by Friday", "Follow-up rate", "No-later-call rate", "Simple result"]];
allPeople.getRange(`A7:C${allLastRow}`).values = current.people.map((person) => [person.salesperson, person.total, person.followed]);
allPeople.getRange(`E7:E${allLastRow}`).values = current.people.map((person) => [person.noLater]);
allPeople.getRange(`D7:D${allLastRow}`).formulas = current.people.map((_, index) => [`=B${7 + index}-C${7 + index}`]);
allPeople.getRange(`F7:F${allLastRow}`).formulas = current.people.map((_, index) => [`=IFERROR(C${7 + index}/B${7 + index},0)`]);
allPeople.getRange(`G7:G${allLastRow}`).formulas = current.people.map((_, index) => [`=IFERROR(E${7 + index}/B${7 + index},0)`]);
allPeople.getRange(`H7:H${allLastRow}`).values = current.people.map((person) => [person.status]);
allPeople.getRange(`F7:G${allLastRow}`).format.numberFormat = "0.0%";
for (let index = 0; index < current.people.length; index += 1) {
  const row = 7 + index;
  const status = current.people[index].status;
  const palette = status === "Needs attention" ? { fill: "#FCE8E6", color: "#C62828" }
    : status === "Mixed" ? { fill: "#FFF2CC", color: "#9C6500" }
      : status === "Following well" ? { fill: "#E2F0D9", color: "#2E7D32" }
        : { fill: "#EAF2F8", color: "#5B6770" };
  allPeople.getRange(`F${row}`).format.fill = palette.fill;
  allPeople.getRange(`F${row}`).format.font = { color: palette.color };
  allPeople.getRange(`H${row}`).format.fill = palette.fill;
  allPeople.getRange(`H${row}`).format.font = { color: palette.color, bold: true };
}
allPeople.getRange("A5:H5").format.wrapText = true;
allPeople.getRange("A5:H5").format.rowHeight = 32;
replaceTable(allPeople, "AllSalespeopleTable", `A6:H${allLastRow}`);
for (let index = 0; index < current.people.length; index += 1) {
  const row = 7 + index;
  const status = current.people[index].status;
  const palette = status === "Needs attention" ? { fill: "#FCE8E6", color: "#C62828" }
    : status === "Mixed" ? { fill: "#FFF2CC", color: "#9C6500" }
      : status === "Following well" ? { fill: "#E2F0D9", color: "#2E7D32" }
        : { fill: "#EAF2F8", color: "#5B6770" };
  allPeople.getRange(`F${row}`).format.fill = palette.fill;
  allPeople.getRange(`F${row}`).format.font = { color: palette.color };
  allPeople.getRange(`H${row}`).format.fill = palette.fill;
  allPeople.getRange(`H${row}`).format.font = { color: palette.color, bold: true };
}

const evidenceClearRows = Math.max(2200, current.evidence.length + 20);
evidenceSheet.getRange("A1:O5000").conditionalFormats.deleteAll();
evidenceSheet.getRange("F6:F1895").conditionalFormats.deleteAll();
evidenceSheet.unmergeCells("A1:J1");
evidenceSheet.getRange("A1:O1").values = blankMatrix(1, 15);
evidenceSheet.mergeCells("A1:O1");
evidenceSheet.unmergeCells("A3:J3");
evidenceSheet.getRange("A3:O3").values = blankMatrix(1, 15);
evidenceSheet.mergeCells("A3:O3");
setSingle(evidenceSheet, "A1", "Lead Evidence — Follow-Up Required by Friday");
setSingle(evidenceSheet, "A3", "One row per voicemail-only customer. Qualifying follow-up is same-salesperson outbound by Friday; other calls are shown separately as context and do not count.");
evidenceSheet.getRange(`A6:O${5 + evidenceClearRows}`).values = blankMatrix(evidenceClearRows, 15);
const evidenceLastRow = 5 + current.evidence.length;
evidenceSheet.getRange("A5:O5").values = [[
  "Salesperson", "Customer ID", "Lead ID", "First voicemail call", "Day received", "Hours available to Friday", "Follow-up result",
  "Qualifying follow-up", "Hours later", "Follow-up Call ID", "Other call by Friday", "Other caller", "Other direction", "Other Call ID", "First Call ID",
]];
evidenceSheet.getRange(`A6:O${evidenceLastRow}`).values = current.evidence.map((item) => [
  item.salesperson, item.customerId, item.leadId || null, new Date(item.anchorAt), item.dayReceived, item.hoursAvailable, item.outcome,
  item.nextAt ? new Date(item.nextAt) : null, item.hoursLater, item.nextCallId || null,
  item.otherAt ? new Date(item.otherAt) : null, item.otherSalesperson || null, item.otherDirection || null, item.otherCallId || null, item.firstCallId,
]);
evidenceSheet.getRange(`D6:D${evidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm";
evidenceSheet.getRange(`F6:F${evidenceLastRow}`).format.numberFormat = "0.0";
evidenceSheet.getRange(`H6:H${evidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm";
evidenceSheet.getRange(`I6:I${evidenceLastRow}`).format.numberFormat = "0.0";
evidenceSheet.getRange(`K6:K${evidenceLastRow}`).format.numberFormat = "d mmm yyyy h:mm";
for (const [column, width] of [["A",22],["B",14],["C",14],["D",20],["E",12],["F",16],["G",36],["H",20],["I",12],["J",18],["K",20],["L",20],["M",14],["N",18],["O",18]]) {
  evidenceSheet.getRange(`${column}:${column}`).format.columnWidth = width;
}
replaceTable(evidenceSheet, "LeadEvidenceTable", `A5:O${evidenceLastRow}`);

for (const [range, rows, columns] of [
  ["A3:H3", 1, 8], ["E7:H7", 1, 4], ["E9:H9", 1, 4], ["E10:H10", 1, 4], ["E16:G16", 1, 3],
  ["A19:H19", 1, 8], ["A20:H20", 1, 8], ["A21:H21", 1, 8], ["A22:H22", 1, 8], ["A23:H23", 1, 8], ["A24:H24", 1, 8],
]) resetMerged(methodSheet, range, rows, columns);
setSingle(methodSheet, "A3", "Question answered: did a customer whose first literal no-contact result was voicemail receive a later outbound call from the same salesperson by Friday?");
setSingle(methodSheet, "E7", `Calls from the Monday-to-Friday cohort ${periodLabel(current.startIso, current.endIso)} that reached voicemail or an answering machine.`);
setSingle(methodSheet, "E9", `All qualifying follow-ups had to occur by Friday ${shortDate(current.checkThroughIso)} at 11:59:59 pm. Monday voicemails therefore have more time available than Friday voicemails.`);
setSingle(methodSheet, "E10", "Only a later outbound call by the same salesperson to the same customer qualifies. Inbound calls and calls by another employee are retained as context only.");
setSingle(methodSheet, "H13", currentBundle.sourceRows);
setSingle(methodSheet, "H14", currentBundle.validUniqueCalls);
setSingle(methodSheet, "H15", current.totals.checked);
setSingle(methodSheet, "H16", "Yes");
setSingle(methodSheet, "E16", "Friday cutoff applied to every row");
setSingle(methodSheet, "A19", "1. A qualifying follow-up must be a later outbound call by the same salesperson to the same customer, timestamped no later than Friday 11:59:59 pm.");
setSingle(methodSheet, "A20", "2. Inbound calls and calls by another employee are visible as context in Lead Evidence but do not count as the assigned salesperson's follow-up.");
setSingle(methodSheet, "A21", `3. “No later call found” means none was found through ${shortDate(current.checkThroughIso)}. Another channel or an action outside this data may not be visible.`);
setSingle(methodSheet, "A24", `Sources: governed primary call history plus retained weekly call exports, deduplicated by exact Call ID. Exclusions match Lead Utilisation exactly: ${EXCLUSION_DISPLAY}. Manager attribution uses exact Allocation Item ID where available, then the modal salesperson-to-manager relationship in the same weekly allocation exports; unresolved rows remain visible as Unassigned / Missing Manager.`);
setSingle(methodSheet, "A21", `3. "No later call found" means no later call of any kind was found by Friday ${shortDate(current.checkThroughIso)} in the available data. Activity in another channel may not be visible.`);
setSingle(methodSheet, "A22", "4. Exposure is intentionally unequal within the reporting week: Monday has the longest window and Friday requires same-day follow-up. Review day-of-week mix when comparing people.");
setSingle(methodSheet, "A23", `Week-on-Week compares ${periodLabel(current.startIso, current.endIso)} with ${periodLabel(previous.startIso, previous.endIso)} using this same Monday-to-Friday cohort and Friday-cutoff contract.`);
methodSheet.getRange("A24:H24").format.wrapText = true;
methodSheet.getRange("A24:H24").format.rowHeight = 34;

previousSheet.unmergeCells("A58:E59");
previousSheet.getRange("A6:E100").values = blankMatrix(95, 5);
setSingle(previousSheet, "A1", "Previous Period — Week-on-Week Comparison");
setSingle(previousSheet, "A1", "Previous Period — Week-on-Week Comparison");
setSingle(previousSheet, "B3", periodLabel(previous.startIso, previous.endIso));
setSingle(previousSheet, "E3", shortDate(previous.checkThroughIso));
const previousLastRow = 5 + previous.people.length;
previousSheet.getRange("A5:E5").values = [["Salesperson", "Voicemails", "Followed by Friday", "Follow-up rate", "Simple result"]];
previousSheet.getRange(`A6:C${previousLastRow}`).values = previous.people.map((person) => [person.salesperson, person.total, person.followed]);
previousSheet.getRange(`D6:D${previousLastRow}`).formulas = previous.people.map((_, index) => [`=IFERROR(C${6 + index}/B${6 + index},0)`]);
previousSheet.getRange(`E6:E${previousLastRow}`).values = previous.people.map((person) => [person.status]);
replaceTable(previousSheet, "PreviousPeriodTable", `A5:E${previousLastRow}`);
previousSheet.getRange("A58:E58").format.fill = "#D9EEF7";
previousSheet.getRange("A59:E59").format.fill = "#FFFFFF";
previousSheet.getRange("A58:E59").format.font = { italic: false, color: "#344054", fontSize: 10 };
const previousFooterStart = previousLastRow + 2;
const previousFooterEnd = previousFooterStart + 1;
previousSheet.mergeCells(`A${previousFooterStart}:E${previousFooterEnd}`);
setSingle(previousSheet, `A${previousFooterStart}`, "This is the immediately previous complete Monday-to-Friday cohort using the same Friday cutoff. Week-on-Week matches salespeople by exact full name and calculates percentage-point movement.");
previousSheet.getRange(`A${previousFooterStart}:E${previousFooterEnd}`).format = { fill: "#FFF2CC", font: { italic: true, color: "#A45A00" }, wrapText: true, verticalAlignment: "middle" };

comparisonSheet.unmergeCells("A67:H67");
comparisonSheet.getRange("A15:H100").values = blankMatrix(86, 8);
resetMerged(comparisonSheet, "A3:H3", 1, 8);
resetMerged(comparisonSheet, "A11:H11", 1, 8);
setSingle(comparisonSheet, "A3", "This compares by-Friday follow-up rates under the same Monday-to-Friday cohort rule. A person's weekday mix can still affect the result because Friday voicemails have less time available.");
setSingle(comparisonSheet, "C5", periodLabel(current.startIso, current.endIso));
setSingle(comparisonSheet, "G5", periodLabel(previous.startIso, previous.endIso));
const comparisonLastRow = 14 + comparisons.length;
comparisonSheet.getRange(`A15:H${comparisonLastRow}`).values = comparisons.map((item) => [
  item.person.salesperson, item.person.total, item.person.rate, item.prior?.total ?? null, item.prior?.rate ?? null, item.change, item.direction, item.explanation,
]);
setSingle(comparisonSheet, "A8", comparisons.filter((item) => item.direction === "Improved").length);
setSingle(comparisonSheet, "C8", comparisons.filter((item) => item.direction === "Regressed").length);
setSingle(comparisonSheet, "E8", comparisons.filter((item) => item.direction === "Broadly stable").length);
setSingle(comparisonSheet, "G8", comparisons.filter((item) => !["Improved", "Regressed", "Broadly stable"].includes(item.direction)).length);
const improved = comparisons.filter((item) => item.direction === "Improved").length;
const regressed = comparisons.filter((item) => item.direction === "Regressed").length;
const stable = comparisons.filter((item) => item.direction === "Broadly stable").length;
setSingle(comparisonSheet, "A11", `${improved} improved, ${regressed} regressed and ${stable} stayed broadly stable under the 20-lead / 5-percentage-point comparison rule.`);
comparisonSheet.getRange(`C15:C${comparisonLastRow}`).format.numberFormat = "0.0%";
comparisonSheet.getRange(`E15:F${comparisonLastRow}`).format.numberFormat = "0.0%";
comparisonSheet.getRange(`A15:H${comparisonLastRow}`).format.font = { italic: false, color: "#344054", fontSize: 10 };
comparisonSheet.getRange(`H15:H${comparisonLastRow}`).format.wrapText = true;
comparisonSheet.getRange(`A15:H${comparisonLastRow}`).format.rowHeight = 18;
for (let row = 15; row <= comparisonLastRow; row += 1) {
  comparisonSheet.getRange(`A${row}:H${row}`).format.fill = row % 2 ? "#D9EEF7" : "#FFFFFF";
}
const comparisonFooterRow = comparisonLastRow + 2;
comparisonSheet.mergeCells(`A${comparisonFooterRow}:H${comparisonFooterRow}`);
setSingle(comparisonSheet, `A${comparisonFooterRow}`, "Why 5 percentage points? It is large enough to avoid calling very small week-to-week movement an improvement or regression. Managers should still review the lead evidence and workload context.");
comparisonSheet.getRange(`A${comparisonFooterRow}:H${comparisonFooterRow}`).format = { fill: "#FFF2CC", font: { italic: true, color: "#A45A00" }, wrapText: true, verticalAlignment: "middle" };

teamSheet.mergeCells("A1:I1");
teamSheet.mergeCells("A2:I2");
teamSheet.mergeCells("A3:I3");
setSingle(teamSheet, "A1", "Manager Team Voicemail Follow-Up by Friday");
setSingle(teamSheet, "A2", `Monday ${shortDate(current.startIso)} to Friday ${shortDate(current.endIso)}; rates are calculated from aggregated counts, not averages of salesperson percentages.`);
setSingle(teamSheet, "A3", `Scope matches Lead Utilisation exactly: excluded ${EXCLUSION_DISPLAY}. Blank manager values remain visible as Unassigned / Missing Manager.`);
const teamLastRow = 5 + current.teams.length;
teamSheet.getRange("A5:I5").values = [["Manager team", "Salespeople", "Voicemails", "Followed by Friday", "No follow-up by Friday", "No later call by Friday", "Follow-up rate", "No-later-call rate", "Simple result"]];
teamSheet.getRange(`A6:D${teamLastRow}`).values = current.teams.map((team) => [team.manager, team.salespeople, team.total, team.followed]);
teamSheet.getRange(`F6:F${teamLastRow}`).values = current.teams.map((team) => [team.noLater]);
teamSheet.getRange(`E6:E${teamLastRow}`).formulas = current.teams.map((_, index) => [`=C${6 + index}-D${6 + index}`]);
teamSheet.getRange(`G6:G${teamLastRow}`).formulas = current.teams.map((_, index) => [`=IFERROR(D${6 + index}/C${6 + index},0)`]);
teamSheet.getRange(`H6:H${teamLastRow}`).formulas = current.teams.map((_, index) => [`=IFERROR(F${6 + index}/C${6 + index},0)`]);
teamSheet.getRange(`I6:I${teamLastRow}`).values = current.teams.map((team) => [team.status]);
teamSheet.getRange(`G6:H${teamLastRow}`).format.numberFormat = "0.0%";
replaceTable(teamSheet, "TeamFollowUpTable", `A5:I${teamLastRow}`, "TableStyleLight1");
for (const [column, width] of [["A",27],["B",13],["C",14],["D",17],["E",18],["F",18],["G",15],["H",17],["I",19]]) teamSheet.getRange(`${column}:${column}`).format.columnWidth = width;
teamSheet.freezePanes.freezeRows(5);

teamComparisonSheet.mergeCells("A1:H1");
teamComparisonSheet.mergeCells("A2:H2");
teamComparisonSheet.mergeCells("A3:H3");
setSingle(teamComparisonSheet, "A1", "Manager Team Week-on-Week Voicemail Follow-Up");
setSingle(teamComparisonSheet, "A2", `${periodLabel(current.startIso, current.endIso)} compared with ${periodLabel(previous.startIso, previous.endIso)} under the same Friday cutoff.`);
setSingle(teamComparisonSheet, "A3", "Team rates use aggregated voicemail and qualifying-follow-up counts. They are not averages of individual salesperson rates. Meaningful movement requires at least 20 voicemail customers in both weeks and at least 5 percentage points change.");
const teamComparisonLastRow = 5 + teamComparisons.length;
teamComparisonSheet.getRange("A5:H5").values = [["Manager team", "Current voicemails", "Current rate", "Previous voicemails", "Previous rate", "Change", "Direction", "Explanation"]];
teamComparisonSheet.getRange(`A6:H${teamComparisonLastRow}`).values = teamComparisons.map((item) => [
  item.team.manager, item.team.total, item.team.rate, item.prior?.total ?? null, item.prior?.rate ?? null, item.change, item.direction, item.explanation,
]);
teamComparisonSheet.getRange(`C6:C${teamComparisonLastRow}`).format.numberFormat = "0.0%";
teamComparisonSheet.getRange(`E6:F${teamComparisonLastRow}`).format.numberFormat = "0.0%";
replaceTable(teamComparisonSheet, "TeamWeekOnWeekTable", `A5:H${teamComparisonLastRow}`, "TableStyleLight1");
for (const [column, width] of [["A",27],["B",17],["C",15],["D",18],["E",15],["F",13],["G",18],["H",50]]) teamComparisonSheet.getRange(`${column}:${column}`).format.columnWidth = width;
teamComparisonSheet.freezePanes.freezeRows(5);

// Match the retained Lead Utilisation report's visual system.
const brandRed = "#EE3424";
const charcoal = "#231F20";
const calledGreen = "#1F6F5B";
const wastedRed = "#B42318";
const amber = "#A45A00";
const panel = "#F5F6F7";
const border = "#D6D9DD";
const secondary = "#5B6470";
const cream = "#FFF3F1";
const greenPanel = "#E8F5E9";
const redPanel = "#FCE4E4";
const reportSubtitle = `Monday ${shortDate(current.startIso)} to Friday ${shortDate(current.endIso)}`;

function leadTitle(sheet, endColumn, text, subtitle) {
  sheet.getRange(`A1:${endColumn}1`).format = {
    fill: "#FFFFFF",
    font: { name: "Source Sans 3", bold: true, color: charcoal, size: 18 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
    borders: { left: { style: "thick", color: brandRed } },
  };
  sheet.getRange("A1").values = [[text]];
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.getRange(`A2:${endColumn}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endColumn}2`).format = {
    fill: "#FFFFFF",
    font: { name: "Source Sans 3", italic: true, color: secondary, size: 10 },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("A2").format.rowHeight = 24;
}

function leadHeader(range) {
  range.format = {
    fill: charcoal,
    font: { name: "Source Sans 3", bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
  range.format.rowHeight = 34;
}

function leadBody(range) {
  range.format.font = { name: "Source Sans 3", size: 9, color: charcoal };
  range.format.verticalAlignment = "center";
  range.format.borders = { insideHorizontal: { style: "thin", color: border } };
}

for (const sheet of workbook.worksheets.items) sheet.showGridLines = false;
for (const table of [
  ...allPeople.tables.items,
  ...evidenceSheet.tables.items,
  ...previousSheet.tables.items,
]) table.style = "TableStyleLight1";

leadTitle(startHere, "I", "VOICEMAIL FOLLOW-UP REPORT", reportSubtitle);
startHere.getRange("A3:I3").format = { fill: panel, font: { name: "Source Sans 3", color: secondary, size: 10 }, wrapText: true, verticalAlignment: "center" };
startHere.getRange("A3:I3").format.rowHeight = 42;
for (const [range, fill, colour] of [
  ["A4:B6", panel, charcoal],
  ["C4:D6", greenPanel, calledGreen],
  ["E4:F6", redPanel, wastedRed],
  ["G4:I6", redPanel, wastedRed],
]) {
  startHere.getRange(range).format.fill = fill;
  startHere.getRange(range).format.borders = { preset: "outside", style: "thin", color: border };
  startHere.getRange(range).format.font = { name: "Source Sans 3", color: colour };
  startHere.getRange(range).format.horizontalAlignment = "center";
  startHere.getRange(range).format.verticalAlignment = "center";
}
startHere.getRange("A4:I4").format.font = { name: "Source Sans 3", bold: true, color: secondary, size: 9 };
startHere.getRange("A5:I5").format.font = { name: "Source Sans 3", bold: true, size: 18 };
startHere.getRange("A6:I6").format.font = { name: "Source Sans 3", bold: true, size: 11 };
startHere.getRange("A8:I8").format = { fill: cream, font: { name: "Source Sans 3", bold: true, color: wastedRed, size: 10 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: brandRed } };
for (const range of ["A10:D10", "F10:I10", "A23:I23", "A26:I26"]) {
  startHere.getRange(range).format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 11 }, borders: { left: { style: "thick", color: brandRed } } };
}
leadHeader(startHere.getRange("A11:D11"));
leadHeader(startHere.getRange("F11:I11"));
leadBody(startHere.getRange("A12:D21"));
leadBody(startHere.getRange("F12:I19"));
startHere.getRange("A24:C24").format = { fill: redPanel, font: { name: "Source Sans 3", bold: true, color: wastedRed, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
startHere.getRange("D24:F24").format = { fill: cream, font: { name: "Source Sans 3", bold: true, color: amber, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
startHere.getRange("G24:I24").format = { fill: greenPanel, font: { name: "Source Sans 3", bold: true, color: calledGreen, size: 9 }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center" };
startHere.getRange("A27:I28").format = { fill: panel, font: { name: "Source Sans 3", color: charcoal, size: 9 }, wrapText: true, verticalAlignment: "center" };
startHere.getRange("A29:I29").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 9 }, wrapText: true, verticalAlignment: "center" };
startHere.getRange("A30:I31").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };

leadTitle(allPeople, "H", "SALESPERSON VOICEMAIL FOLLOW-UP", "One row per included salesperson; the Friday cutoff is applied to every voicemail customer.");
allPeople.getRange("A3:H3").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
allPeople.getRange("A5:H5").format = { fill: panel, font: { name: "Source Sans 3", color: secondary, size: 9 }, wrapText: true, verticalAlignment: "center" };
leadHeader(allPeople.getRange("A6:H6"));
leadBody(allPeople.getRange(`A7:H${allLastRow}`));

leadTitle(evidenceSheet, "O", "VOICEMAIL LEAD EVIDENCE", "One auditable row per voicemail-only customer in the reporting week.");
evidenceSheet.getRange("A3:O3").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
leadHeader(evidenceSheet.getRange("A5:O5"));
leadBody(evidenceSheet.getRange(`A6:O${evidenceLastRow}`));

leadTitle(methodSheet, "H", "METHODOLOGY & QA", "Definitions, evidence rules and validation checks for the Friday-cutoff report.");
methodSheet.getRange("A3:H3").format = { fill: panel, font: { name: "Source Sans 3", color: secondary, size: 10 }, wrapText: true, verticalAlignment: "center" };
methodSheet.getRange("A5:H5").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 11 }, borders: { left: { style: "thick", color: brandRed } } };
leadHeader(methodSheet.getRange("A6:H6"));
leadBody(methodSheet.getRange("A7:H10"));
methodSheet.getRange("A12:D12").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 10 } };
methodSheet.getRange("E12:H12").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 10 } };
methodSheet.getRange("A18:H18").format = { fill: cream, font: { name: "Source Sans 3", bold: true, color: amber, size: 10 }, borders: { left: { style: "thick", color: brandRed } } };
leadBody(methodSheet.getRange("A19:H24"));

leadTitle(comparisonSheet, "H", "WEEK-ON-WEEK VOICEMAIL FOLLOW-UP", `${reportSubtitle}; compared with Monday ${shortDate(previous.startIso)} to Friday ${shortDate(previous.endIso)}.`);
comparisonSheet.getRange("A3:H3").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
comparisonSheet.getRange("A5:H5").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 9 }, horizontalAlignment: "center" };
comparisonSheet.getRange("A7:B9").format.fill = greenPanel;
comparisonSheet.getRange("C7:D9").format.fill = redPanel;
comparisonSheet.getRange("E7:F9").format.fill = cream;
comparisonSheet.getRange("G7:H9").format.fill = panel;
comparisonSheet.getRange("A11:H11").format = { fill: cream, font: { name: "Source Sans 3", bold: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };
comparisonSheet.getRange("A13:H13").format = { fill: panel, font: { name: "Source Sans 3", bold: true, color: charcoal, size: 11 }, borders: { left: { style: "thick", color: brandRed } } };
leadHeader(comparisonSheet.getRange("A14:H14"));
leadBody(comparisonSheet.getRange(`A15:H${comparisonLastRow}`));
for (let row = 15; row <= comparisonLastRow; row += 1) {
  const fill = row % 2 === 0 ? panel : "#FFFFFF";
  comparisonSheet.getRange(`A${row}:F${row}`).format.fill = fill;
  comparisonSheet.getRange(`H${row}`).format.fill = fill;
  const direction = comparisons[row - 15]?.direction;
  const directionStyle = direction === "Improved" ? { fill: greenPanel, color: calledGreen }
    : direction === "Regressed" ? { fill: redPanel, color: wastedRed }
      : direction === "Broadly stable" ? { fill: cream, color: amber }
        : { fill: panel, color: secondary };
  comparisonSheet.getRange(`G${row}`).format.fill = directionStyle.fill;
  comparisonSheet.getRange(`G${row}`).format.font = { name: "Source Sans 3", color: directionStyle.color, size: 9 };
}
comparisonSheet.getRange(`A${comparisonFooterRow}:H${comparisonFooterRow}`).format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };

leadTitle(previousSheet, "E", "PREVIOUS PERIOD", `Monday ${shortDate(previous.startIso)} to Friday ${shortDate(previous.endIso)} under the same Friday-cutoff contract.`);
previousSheet.getRange("A3:E3").format = { fill: panel, font: { name: "Source Sans 3", color: secondary, size: 9 } };
leadHeader(previousSheet.getRange("A5:E5"));
leadBody(previousSheet.getRange(`A6:E${previousLastRow}`));
for (let row = 6; row <= previousLastRow; row += 1) previousSheet.getRange(`A${row}:E${row}`).format.fill = row % 2 === 0 ? "#FFFFFF" : panel;
previousSheet.getRange(`A${previousFooterStart}:E${previousFooterEnd}`).format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center" };

leadTitle(teamSheet, "I", "MANAGER TEAM VOICEMAIL FOLLOW-UP", "Aggregated manager-team results under the same Monday-to-Friday Friday-cutoff contract.");
teamSheet.getRange("A3:I3").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: brandRed } };
teamSheet.getRange("A3:I3").format.rowHeight = 34;
leadHeader(teamSheet.getRange("A5:I5"));
leadBody(teamSheet.getRange(`A6:I${teamLastRow}`));
for (let row = 6; row <= teamLastRow; row += 1) {
  const fill = row % 2 === 0 ? "#FFFFFF" : panel;
  teamSheet.getRange(`A${row}:H${row}`).format.fill = fill;
  const status = current.teams[row - 6].status;
  const palette = status === "Needs attention" ? { fill: redPanel, color: wastedRed }
    : status === "Mixed" ? { fill: cream, color: amber }
      : status === "Following well" ? { fill: greenPanel, color: calledGreen }
        : { fill: panel, color: secondary };
  teamSheet.getRange(`G${row}`).format.fill = palette.fill;
  teamSheet.getRange(`G${row}`).format.font = { name: "Source Sans 3", color: palette.color, size: 9 };
  teamSheet.getRange(`I${row}`).format.fill = palette.fill;
  teamSheet.getRange(`I${row}`).format.font = { name: "Source Sans 3", bold: true, color: palette.color, size: 9 };
}

leadTitle(teamComparisonSheet, "H", "MANAGER TEAM WEEK-ON-WEEK", "Aggregated team movement; current week compared with the immediately previous complete Monday-to-Friday period.");
teamComparisonSheet.getRange("A3:H3").format = { fill: cream, font: { name: "Source Sans 3", italic: true, color: amber, size: 9 }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: brandRed } };
teamComparisonSheet.getRange("A3:H3").format.rowHeight = 38;
leadHeader(teamComparisonSheet.getRange("A5:H5"));
leadBody(teamComparisonSheet.getRange(`A6:H${teamComparisonLastRow}`));
teamComparisonSheet.getRange(`H6:H${teamComparisonLastRow}`).format.wrapText = true;
for (let row = 6; row <= teamComparisonLastRow; row += 1) {
  const fill = row % 2 === 0 ? "#FFFFFF" : panel;
  teamComparisonSheet.getRange(`A${row}:F${row}`).format.fill = fill;
  teamComparisonSheet.getRange(`H${row}`).format.fill = fill;
  const direction = teamComparisons[row - 6].direction;
  const palette = direction === "Improved" ? { fill: greenPanel, color: calledGreen }
    : direction === "Regressed" ? { fill: redPanel, color: wastedRed }
      : direction === "Broadly stable" ? { fill: cream, color: amber }
        : { fill: panel, color: secondary };
  teamComparisonSheet.getRange(`G${row}`).format.fill = palette.fill;
  teamComparisonSheet.getRange(`G${row}`).format.font = { name: "Source Sans 3", bold: true, color: palette.color, size: 9 };
}

await fs.writeFile(reportDataPath, JSON.stringify({
  title: "VOICEMAIL FOLLOW-UP REPORT",
  subtitle: reportSubtitle,
  reportingPeriod: { start: current.startIso, end: current.endIso },
  previousPeriod: { start: previous.startIso, end: previous.endIso },
  exclusionPolicy: {
    managerTeams: MANAGER_TEAM_EXCLUSION_LABELS,
    salespeople: SALESPERSON_EXCLUSION_LABELS,
    display: EXCLUSION_DISPLAY,
  },
  totals: current.totals,
  previousTotals: previous.totals,
  people: current.people,
  previousPeople: previous.people,
  teams: current.teams,
  previousTeams: previous.teams,
  comparisons: comparisons.map((item) => ({
    manager: item.person.manager,
    salesperson: item.person.salesperson,
    currentTotal: item.person.total,
    currentRate: item.person.rate,
    previousTotal: item.prior?.total ?? null,
    previousRate: item.prior?.rate ?? null,
    change: item.change,
    direction: item.direction,
    explanation: item.explanation,
  })),
  teamComparisons: teamComparisons.map((item) => ({
    manager: item.team.manager,
    currentTotal: item.team.total,
    currentRate: item.team.rate,
    previousTotal: item.prior?.total ?? null,
    previousRate: item.prior?.rate ?? null,
    change: item.change,
    direction: item.direction,
    explanation: item.explanation,
  })),
  source: { rows: currentBundle.sourceRows, uniqueCalls: currentBundle.validUniqueCalls, duplicatesRemoved: currentBundle.duplicates },
  qaChecks: cohortChecks,
}, null, 2));

await fs.mkdir(path.join(workDir, "previews"), { recursive: true });
const previewRanges = {
  "Start Here": "A1:I31",
  "All Salespeople": `A1:H${Math.min(allLastRow + 3, 70)}`,
  "Lead Evidence": "A1:O40",
  "How We Checked": "A1:H24",
  "Week-on-Week": `A1:H${comparisonFooterRow}`,
  "Previous Period": `A1:E${previousFooterEnd}`,
  "Team Follow-up": `A1:I${teamLastRow}`,
  "Team Week-on-Week": `A1:H${teamComparisonLastRow}`,
};
for (const sheet of workbook.worksheets.items) {
  const rendered = await workbook.render({ sheetName: sheet.name, range: previewRanges[sheet.name], scale: 1, format: "png" });
  await fs.writeFile(path.join(workDir, "previews", `${sheet.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`), new Uint8Array(await rendered.arrayBuffer()));
}
const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
const errorLines = formulaErrors.ndjson.split(/\r?\n/).filter((line) => line.includes('"kind":"match"'));
if (errorLines.length) throw new Error(`Formula errors detected: ${errorLines.slice(0, 10).join("\n")}`);
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const qa = {
  generatedAt: new Date().toISOString(), outputPath, sourcePaths,
  current: { period: [current.startIso, current.endIso], checkedThrough: current.checkThroughIso, totals: current.totals, people: current.people.length, teams: current.teams.length, quality: current.quality },
  previous: { period: [previous.startIso, previous.endIso], checkedThrough: previous.checkThroughIso, totals: previous.totals, people: previous.people.length, teams: previous.teams.length, quality: previous.quality },
  source: { rowsThroughCutoff: currentBundle.sourceRows, validUniqueCalls: currentBundle.validUniqueCalls, duplicatesRemoved: currentBundle.duplicates, missingCallId: currentBundle.missingCallId },
  comparisons: { improved, regressed, broadlyStable: stable, notComparable: comparisons.length - improved - regressed - stable },
  teamComparisons: {
    improved: teamComparisons.filter((item) => item.direction === "Improved").length,
    regressed: teamComparisons.filter((item) => item.direction === "Regressed").length,
    broadlyStable: teamComparisons.filter((item) => item.direction === "Broadly stable").length,
    notComparable: teamComparisons.filter((item) => !["Improved", "Regressed", "Broadly stable"].includes(item.direction)).length,
  },
  cohortChecks,
  formulaErrorMatches: errorLines.length,
};
await fs.writeFile(qaPath, JSON.stringify(qa, null, 2));
console.log(JSON.stringify({ ...qa, reportDataPath, qaPath }, null, 2));
