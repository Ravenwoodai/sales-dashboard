"use strict";

const fs = require("fs");
const path = require("path");
const {
  CALLBACK_OPPORTUNITY_GOAL,
  CALLBACK_OPPORTUNITY_SCHEMA_VERSION,
  CALL_INTELLIGENCE_FOUNDATION_GOAL,
  FOUNDATION_SPECIALIST_GOALS,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION,
  OBJECTION_HANDLING_GOAL,
  OBJECTION_HANDLING_SCHEMA_VERSION,
  OFFER_ACCEPTANCE_GOAL,
  OFFER_ACCEPTANCE_SCHEMA_VERSION,
  PROCEDURE_ADHERENCE_GOAL,
  PROCEDURE_ADHERENCE_SCHEMA_VERSION,
  listEvaluationResults,
  normalizeEvaluationStudio
} = require("./evaluationStudio");

const FOUNDATION_GOAL = CALL_INTELLIGENCE_FOUNDATION_GOAL;
const SPECIALIST_RECOVERY_SOURCE_TYPE = "overnight_specialist_recovery";
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

function isCurrentTypedSpecialistResult(result = {}, goal = "") {
  if (result.status === "failed") return false;
  if (goal === OFFER_ACCEPTANCE_GOAL) {
    return result.acceptanceAssessment?.schemaVersion === OFFER_ACCEPTANCE_SCHEMA_VERSION;
  }
  if (goal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL) {
    return result.auditAssessment?.schemaVersion === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION;
  }
  const expectedSchema = {
    [CALLBACK_OPPORTUNITY_GOAL]: CALLBACK_OPPORTUNITY_SCHEMA_VERSION,
    [OBJECTION_HANDLING_GOAL]: OBJECTION_HANDLING_SCHEMA_VERSION,
    [PROCEDURE_ADHERENCE_GOAL]: PROCEDURE_ADHERENCE_SCHEMA_VERSION
  }[goal];
  return Boolean(expectedSchema && result.specialistAssessment?.schemaVersion === expectedSchema);
}

function buildTypedSpecialistRecoveryBacklog(studioValue = {}, options = {}) {
  const studio = normalizeEvaluationStudio(studioValue);
  const importId = String(options.importId || "").trim();
  const availableCallIds = options.availableCallIds
    ? new Set(Array.from(options.availableCallIds).map((value) => String(value || "").trim()).filter(Boolean))
    : null;
  const foundationResults = listEvaluationResults(studio, {
    importId,
    evaluationGoal: FOUNDATION_GOAL
  }).filter((result) => result.status !== "failed" && result.foundationAssessment
    && (!availableCallIds || availableCallIds.has(result.callId)));
  const latestResults = listEvaluationResults(studio, { importId });
  const completed = new Set(latestResults
    .filter((result) => FOUNDATION_SPECIALIST_GOALS.includes(result.evaluationGoal)
      && isCurrentTypedSpecialistResult(result, result.evaluationGoal))
    .map((result) => `${result.evaluationGoal}:${result.callId}`));
  const groups = FOUNDATION_SPECIALIST_GOALS.map((goal) => {
    const callIds = Array.from(new Set(foundationResults
      .filter((result) => result.foundationAssessment?.specialistRoutes?.[goal]
        && !completed.has(`${goal}:${result.callId}`))
      .map((result) => result.callId)));
    return { goal, count: callIds.length, callIds };
  });
  const affectedCallIds = new Set(groups.flatMap((group) => group.callIds));
  return {
    schemaVersion: "sales_dashboard_typed_specialist_recovery_backlog.v1",
    importId,
    foundationResultCount: foundationResults.length,
    totalMissingChecks: groups.reduce((total, group) => total + group.count, 0),
    affectedCallCount: affectedCallIds.size,
    groups
  };
}

function selectTypedSpecialistRecoveryBatch(backlog = {}, limit = 100) {
  const boundedLimit = Math.max(1, Math.min(250, Number(limit || 100)));
  const group = (backlog.groups || []).find((item) => item.callIds?.length) || null;
  if (!group) return null;
  return {
    goal: group.goal,
    callIds: group.callIds.slice(0, boundedLimit),
    selectedCount: Math.min(group.callIds.length, boundedLimit),
    remainingForGoalAfterBatch: Math.max(0, group.callIds.length - boundedLimit)
  };
}

function latestSpecialistRecoveryBoundary(studio = {}, importId = "") {
  const run = currentRuns(studio, importId)
    .filter((item) => item.callSelection?.sourceType === SPECIALIST_RECOVERY_SOURCE_TYPE)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
  if (!run) return { safe: true, reason: "no_previous_specialist_recovery_run", run: null };
  const status = String(run.status || "").toLowerCase();
  if (!TERMINAL_RUN_STATUSES.has(status)) {
    return { safe: false, waiting: true, reason: "specialist_recovery_not_terminal", run };
  }
  const planned = Number(run.plannedCallCount || 0);
  const completed = Number(run.completedCallCount || 0);
  const failed = Number(run.failedCallCount || 0);
  const errors = Array.isArray(run.errors) ? run.errors : [];
  if (status !== "completed" || failed > 0 || errors.length > 0 || planned < 1 || completed !== planned) {
    return {
      safe: false,
      reason: "specialist_recovery_quality_failure",
      run,
      planned,
      completed,
      failed,
      errorCount: errors.length
    };
  }
  return { safe: true, reason: "specialist_recovery_boundary_passed", run, planned, completed, failed };
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
  SPECIALIST_RECOVERY_SOURCE_TYPE,
  activeRuns,
  appendJsonLine,
  beforeSubmissionCutoff,
  buildTypedSpecialistRecoveryBacklog,
  latestFoundationBoundary,
  latestSpecialistRecoveryBoundary,
  melbourneClock,
  selectTypedSpecialistRecoveryBatch,
  withinOvernightWindow,
  writeJsonAtomic
};
