"use strict";

const fs = require("fs");
const path = require("path");

const FOUNDATION_GOAL = "call_intelligence_foundation";
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "partially_completed", "failed"]);

function melbourneClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    display: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second} Australia/Melbourne`
  };
}

function withinOvernightWindow(clock, startHour = 22, endHour = 6) {
  return startHour > endHour
    ? clock.hour >= startHour || clock.hour < endHour
    : clock.hour >= startHour && clock.hour < endHour;
}

function beforeSubmissionCutoff(clock, cutoffHour = 4, cutoffMinute = 30) {
  if (clock.hour >= 22) return true;
  return clock.hour < cutoffHour || (clock.hour === cutoffHour && clock.minute < cutoffMinute);
}

function runGoal(run = {}) {
  return String(run.templateSnapshot?.evaluationGoal || run.evaluationGoal || "").trim();
}

function currentRuns(studio = {}, importId = "") {
  return (studio.evaluationRuns || []).filter((run) => !importId || run.importId === importId);
}

function activeRuns(studio = {}, importId = "") {
  return currentRuns(studio, importId).filter((run) => ACTIVE_RUN_STATUSES.has(String(run.status || "").toLowerCase()));
}

function latestFoundationBoundary(studio = {}, importId = "") {
  const foundations = currentRuns(studio, importId)
    .filter((run) => run.runType === "batch" && runGoal(run) === FOUNDATION_GOAL)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const automated = foundations.filter((run) => run.callSelection?.sourceType === "overnight_foundation_backlog");
  const parent = (automated.length ? automated : foundations)[0] || null;
  if (!parent) return { safe: true, reason: "no_previous_foundation_run", parent: null, children: [] };
  const children = currentRuns(studio, importId).filter((run) => run.callSelection?.parentFoundationRunId === parent.id);
  const parentStatus = String(parent.status || "").toLowerCase();
  if (!TERMINAL_RUN_STATUSES.has(parentStatus)) {
    return { safe: false, waiting: true, reason: "foundation_run_not_terminal", parent, children };
  }
  if (children.some((run) => !TERMINAL_RUN_STATUSES.has(String(run.status || "").toLowerCase()))) {
    return { safe: false, waiting: true, reason: "specialist_runs_not_terminal", parent, children };
  }
  const planned = Math.max(1, Number(parent.plannedCallCount || 0));
  const failed = Number(parent.failedCallCount || 0);
  const failureRate = failed / planned;
  const routing = parent.specialistRouting || {};
  const routingErrors = Array.isArray(routing.errors) ? routing.errors : [];
  if (failureRate >= 0.02) {
    return { safe: false, reason: "foundation_failure_rate_at_or_above_2_percent", failureRate, parent, children };
  }
  if (Number(parent.completedCallCount || 0) > 0 && !["completed", "completed_with_errors"].includes(routing.status)) {
    return { safe: false, waiting: true, reason: "specialist_routing_not_finished", failureRate, parent, children };
  }
  if (routingErrors.length) {
    return { safe: false, reason: "specialist_routing_errors", failureRate, routingErrors, parent, children };
  }
  if (children.some((run) => String(run.status || "").toLowerCase() === "failed")) {
    return { safe: false, reason: "specialist_run_failed", failureRate, parent, children };
  }
  const specialistPlanned = children.reduce((total, run) => total + Number(run.plannedCallCount || 0), 0);
  const specialistFailed = children.reduce((total, run) => total + Number(run.failedCallCount || 0), 0);
  const specialistFailureRate = specialistPlanned ? specialistFailed / specialistPlanned : 0;
  if (specialistFailureRate >= 0.02) {
    return {
      safe: false,
      reason: "specialist_failure_rate_at_or_above_2_percent",
      failureRate,
      specialistFailureRate,
      parent,
      children
    };
  }
  return { safe: true, reason: "boundary_passed", failureRate, specialistFailureRate, parent, children };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

module.exports = {
  FOUNDATION_GOAL,
  activeRuns,
  appendJsonLine,
  beforeSubmissionCutoff,
  latestFoundationBoundary,
  melbourneClock,
  withinOvernightWindow,
  writeJsonAtomic
};
