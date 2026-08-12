"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HISTORY_SCHEMA = "lead_utilisation_trend_history.v1";
const DEFAULT_PERSON_MINIMUM_ALLOCATIONS = 100;
const DEFAULT_MEANINGFUL_CHANGE = 0.05;
const DEFAULT_OUTLIER_PRIOR_WEEKS = 5;
const DEFAULT_VISIBLE_WEEKS = 12;

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function norm(value) {
  return clean(value).toLowerCase();
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function metricsFromRow(row = {}) {
  const received = Number(row.received || 0);
  const called = Number(row.called || 0);
  const wasted = Number(row.wasted || 0);
  const followUpFailures = Number(row.followUpFailures || 0);
  const outboundCalls = Number(row.outboundCalls || 0);
  return {
    received,
    called,
    wasted,
    utilisation: rate(called, received),
    wastage: rate(wasted, received),
    firstCallVoicemails: Number(row.firstCallVoicemails || 0),
    followUpFailures,
    adjustedUtilisation: rate(called - followUpFailures, received),
    outboundCalls,
    allocatedLeadCallAttempts: Number(row.allocatedLeadCallAttempts || 0),
    otherOutboundCalls: Number(row.otherOutboundCalls || 0),
    callsPerAllocation: rate(outboundCalls, received),
    otherCallRatio: rate(Number(row.otherOutboundCalls || 0), outboundCalls),
  };
}

function policyRecord(reportData) {
  const managerTeams = (reportData.exclusions?.managerTeams || []).map(clean).sort((a, b) => a.localeCompare(b));
  const salespeople = (reportData.exclusions?.salespeople || []).map(clean).sort((a, b) => a.localeCompare(b));
  const key = JSON.stringify({ managerTeams: managerTeams.map(norm), salespeople: salespeople.map(norm) });
  return { managerTeams, salespeople, key };
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshotFromReportData(reportData, createdAt = new Date().toISOString()) {
  const startDate = clean(reportData.reportingPeriod?.startDate);
  const endDate = clean(reportData.reportingPeriod?.endDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Lead Utilisation trend snapshot requires an ISO reporting period.");
  }
  const qaPassed = (reportData.qaChecks || []).length > 0
    && reportData.qaChecks.every((row) => row.result === "PASS");
  if (!qaPassed) throw new Error(`Lead Utilisation trend snapshot rejected because QA did not pass for ${startDate}.`);
  const overall = metricsFromRow(reportData.totals);
  if (overall.received !== overall.called + overall.wasted) {
    throw new Error(`Lead Utilisation trend snapshot does not reconcile for ${startDate}.`);
  }
  const policy = policyRecord(reportData);
  const core = {
    period: { startDate, endDate, label: clean(reportData.subtitle) || `${startDate} to ${endDate}` },
    exclusionPolicy: policy,
    qaPassed,
    overall,
    teams: (reportData.managers || []).map((row) => ({
      key: norm(row.manager),
      manager: clean(row.manager),
      salespeople: Number(row.salespeople || 0),
      ...metricsFromRow(row),
    })).sort((a, b) => a.manager.localeCompare(b.manager)),
    people: (reportData.salespeople || []).map((row) => ({
      key: norm(row.salesperson),
      salesperson: clean(row.salesperson),
      manager: clean(row.manager),
      ...metricsFromRow(row),
    })).sort((a, b) => a.salesperson.localeCompare(b.salesperson)),
  };
  return { ...core, createdAt, contentHash: contentHash(core) };
}

function loadHistory(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { schemaVersion: HISTORY_SCHEMA, snapshots: [] };
  const history = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (history.schemaVersion !== HISTORY_SCHEMA || !Array.isArray(history.snapshots)) {
    throw new Error(`Unsupported Lead Utilisation trend history: ${history.schemaVersion || "missing"}`);
  }
  return history;
}

function appendSnapshot(filePath, reportData, createdAt = new Date().toISOString()) {
  const absolutePath = path.resolve(filePath);
  const history = loadHistory(absolutePath);
  const snapshot = snapshotFromReportData(reportData, createdAt);
  if (!history.snapshots.some((row) => row.contentHash === snapshot.contentHash)) {
    history.snapshots.push(snapshot);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, absolutePath);
  }
  return { history, snapshot };
}

function latestComparableSnapshots(history, currentSnapshot) {
  const latestByPeriod = new Map();
  for (const snapshot of history.snapshots || []) {
    if (!snapshot.qaPassed || snapshot.exclusionPolicy?.key !== currentSnapshot.exclusionPolicy.key) continue;
    if (snapshot.period?.startDate > currentSnapshot.period.startDate) continue;
    latestByPeriod.set(snapshot.period.startDate, snapshot);
  }
  latestByPeriod.set(currentSnapshot.period.startDate, currentSnapshot);
  return [...latestByPeriod.values()].sort((a, b) => a.period.startDate.localeCompare(b.period.startDate));
}

function weekLabel(period) {
  const start = new Date(`${period.startDate}T00:00:00Z`);
  const end = new Date(`${period.endDate}T00:00:00Z`);
  const month = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" }).format(end);
  return `${start.getUTCDate()}-${end.getUTCDate()} ${month}`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quartiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 4) return null;
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, middle);
  const upper = sorted.slice(sorted.length % 2 ? middle + 1 : middle);
  return { q1: median(lower), q3: median(upper) };
}

function comparison(current, previous, minimumAllocations, meaningfulChange) {
  if (!current || !previous || current.received < minimumAllocations || previous.received < minimumAllocations) {
    return { status: "not_comparable", label: "No comparable prior week", change: null };
  }
  const change = current.utilisation - previous.utilisation;
  if (change >= meaningfulChange) return { status: "improved", label: `Improved ${Math.abs(change * 100).toFixed(1)}%`, change };
  if (change <= -meaningfulChange) return { status: "regressed", label: `Regressed ${Math.abs(change * 100).toFixed(1)}%`, change };
  return { status: "stable", label: `Stable ${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`, change };
}

function outlier(current, prior, minimumAllocations, priorWeeksRequired) {
  const baseline = prior.filter((row) => row && row.received >= minimumAllocations).map((row) => row.utilisation);
  if (!current || current.received < minimumAllocations || baseline.length < priorWeeksRequired) {
    return { status: "not_scored", label: `Needs ${priorWeeksRequired} prior comparable weeks`, lower: null, upper: null };
  }
  const window = baseline.slice(-priorWeeksRequired);
  const q = quartiles(window);
  if (!q) return { status: "not_scored", label: "Insufficient baseline spread", lower: null, upper: null };
  const iqr = q.q3 - q.q1;
  const lower = q.q1 - 1.5 * iqr;
  const upper = q.q3 + 1.5 * iqr;
  if (current.utilisation < lower) return { status: "below_usual_range", label: "Below usual range", lower, upper };
  if (current.utilisation > upper) return { status: "above_usual_range", label: "Above usual range", lower, upper };
  return { status: "within_usual_range", label: "Within usual range", lower, upper };
}

function entityMetric(snapshot, kind, key) {
  if (kind === "overall") return snapshot.overall;
  const collection = kind === "team" ? snapshot.teams : snapshot.people;
  return collection.find((row) => row.key === key) || null;
}

function entityRow({ kind, key, name, manager = "", snapshots, minimumAllocations, meaningfulChange, priorWeeksRequired }) {
  const series = snapshots.map((snapshot) => ({
    period: snapshot.period,
    weekLabel: weekLabel(snapshot.period),
    metrics: entityMetric(snapshot, kind, key),
  }));
  const current = series.at(-1)?.metrics || null;
  const previous = series.at(-2)?.metrics || null;
  const prior = series.slice(0, -1).map((row) => row.metrics);
  return {
    kind,
    key,
    name,
    manager,
    current,
    comparison: comparison(current, previous, minimumAllocations, meaningfulChange),
    outlier: outlier(current, prior, minimumAllocations, priorWeeksRequired),
    series,
  };
}

function buildTrendModel(history, currentSnapshot, options = {}) {
  const personMinimumAllocations = Number(options.personMinimumAllocations || DEFAULT_PERSON_MINIMUM_ALLOCATIONS);
  const meaningfulChange = Number(options.meaningfulChange || DEFAULT_MEANINGFUL_CHANGE);
  const priorWeeksRequired = Number(options.priorWeeksRequired || DEFAULT_OUTLIER_PRIOR_WEEKS);
  const visibleWeeks = Number(options.visibleWeeks || DEFAULT_VISIBLE_WEEKS);
  const allSnapshots = latestComparableSnapshots(history, currentSnapshot);
  const snapshots = allSnapshots.slice(-visibleWeeks);
  const overall = entityRow({
    kind: "overall", key: "overall", name: "Overall", snapshots,
    minimumAllocations: 1, meaningfulChange, priorWeeksRequired,
  });
  const teams = currentSnapshot.teams.map((team) => entityRow({
    kind: "team", key: team.key, name: team.manager, snapshots,
    minimumAllocations: 1, meaningfulChange, priorWeeksRequired,
  }));
  const people = currentSnapshot.people
    .filter((person) => person.received >= personMinimumAllocations)
    .map((person) => entityRow({
      kind: "person", key: person.key, name: person.salesperson, manager: person.manager, snapshots,
      minimumAllocations: personMinimumAllocations, meaningfulChange, priorWeeksRequired,
    }));
  return {
    schemaVersion: "lead_utilisation_trend_model.v1",
    generatedFor: currentSnapshot.period,
    policyKey: currentSnapshot.exclusionPolicy.key,
    weekCount: snapshots.length,
    allComparableWeekCount: allSnapshots.length,
    visibleWeeks: snapshots.map((snapshot) => ({ ...snapshot.period, weekLabel: weekLabel(snapshot.period) })),
    personMinimumAllocations,
    meaningfulChange,
    outlierPriorWeeksRequired: priorWeeksRequired,
    comparisonRule: `Improvement/regression requires the current and prior week to meet the applicable allocation threshold and a movement of at least ${(meaningfulChange * 100).toFixed(1)} percentage points.`,
    outlierRule: `Outlier prompts compare the current result with the entity's prior ${priorWeeksRequired} comparable weeks using a 1.5 IQR fence.`,
    overall,
    teams,
    people,
  };
}

module.exports = {
  DEFAULT_MEANINGFUL_CHANGE,
  DEFAULT_OUTLIER_PRIOR_WEEKS,
  DEFAULT_PERSON_MINIMUM_ALLOCATIONS,
  DEFAULT_VISIBLE_WEEKS,
  HISTORY_SCHEMA,
  appendSnapshot,
  buildTrendModel,
  latestComparableSnapshots,
  loadHistory,
  snapshotFromReportData,
};
