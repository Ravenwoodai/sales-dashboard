"use strict";

const fs = require("fs");
const path = require("path");
const {
  FOUNDATION_GOAL,
  SPECIALIST_RECOVERY_SOURCE_TYPE,
  activeRuns,
  appendJsonLine,
  beforeSubmissionCutoff,
  latestFoundationBoundary,
  latestSpecialistRecoveryBoundary,
  melbourneClock,
  withinOvernightWindow,
  writeJsonAtomic
} = require("../src/overnightEvaluationAutomation");
const { assertLocalModelSubmissionAllowed } = require("../src/localModelCapability");

const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_BASE_URL = process.env.SALES_DASHBOARD_BASE_URL || "http://127.0.0.1:3040";
const EXECUTION_BASE_URL = process.env.SALES_DASHBOARD_AI_EXECUTION_BASE_URL || "http://127.0.0.1:8080";
const STATE_PATH = process.env.SALES_DASHBOARD_OVERNIGHT_STATE_PATH || path.join(ROOT, "runtime", "evaluation-overnight-state.json");
const LOG_PATH = process.env.SALES_DASHBOARD_OVERNIGHT_LOG_PATH || path.join(ROOT, "runtime", "evaluation-overnight.log");
const LOCK_PATH = process.env.SALES_DASHBOARD_OVERNIGHT_LOCK_PATH || path.join(ROOT, "runtime", "evaluation-overnight.lock");
const BATCH_SIZE = Math.min(500, Math.max(1, Number(process.env.SALES_DASHBOARD_OVERNIGHT_BATCH_SIZE || 500)));
const SPECIALIST_BATCH_SIZE = Math.min(250, Math.max(1, Number(process.env.SALES_DASHBOARD_OVERNIGHT_SPECIALIST_BATCH_SIZE || 100)));
const POLL_SECONDS = Math.max(10, Number(process.env.SALES_DASHBOARD_OVERNIGHT_POLL_SECONDS || 30));
const ONCE = process.argv.includes("--once");

function log(event, details = {}) {
  appendJsonLine(LOG_PATH, { at: new Date().toISOString(), event, ...details });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(Number(options.timeoutMs || 30000))
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${payload.error || response.statusText}`);
  return payload;
}

function safeState(patch = {}) {
  const value = {
    schemaVersion: "sales_dashboard_overnight_evaluations.v1",
    updatedAt: new Date().toISOString(),
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    executionBaseUrl: EXECUTION_BASE_URL,
    batchSize: BATCH_SIZE,
    specialistBatchSize: SPECIALIST_BATCH_SIZE,
    ...patch
  };
  writeJsonAtomic(STATE_PATH, value);
  return value;
}

async function tick() {
  const clock = melbourneClock();
  if (!withinOvernightWindow(clock)) {
    safeState({ status: "outside_window", reason: "Runs only from 22:00 to 06:00 Melbourne time.", localTime: clock.display });
    return { stop: true, status: "outside_window" };
  }

  const dashboardHealth = await requestJson(`${DASHBOARD_BASE_URL}/health`);
  if (!dashboardHealth.csv_loaded || !dashboardHealth.current_import_id) {
    throw new Error("Dashboard has no active transcript import.");
  }
  const executionHealth = await requestJson(`${EXECUTION_BASE_URL}/health`);
  const admission = executionHealth.evaluation_studio_admission;
  if (!admission?.enabled) throw new Error("Execution Layer overnight admission gate is not enabled.");
  const activeWorkers = Number(executionHealth.job_runner?.active_workers || 0);
  if (!admission.eligible && activeWorkers === 0) {
    safeState({
      status: "paused_for_pc",
      localTime: clock.display,
      importId: dashboardHealth.current_import_id,
      reason: admission.reason,
      admission
    });
    return { status: "paused_for_pc" };
  }

  await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/progress?currentOnly=true`, { timeoutMs: 120000 });
  const studio = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio?currentOnly=true&limit=1`, { timeoutMs: 120000 });
  const importId = dashboardHealth.current_import_id;
  const running = activeRuns(studio, importId);
  if (running.length) {
    safeState({ status: "processing", localTime: clock.display, importId, activeRunIds: running.map((run) => run.id), admission });
    return { status: "processing" };
  }

  const boundary = latestFoundationBoundary(studio, importId);
  const recoveryBoundary = latestSpecialistRecoveryBoundary(studio, importId);
  if (!recoveryBoundary.safe) {
    const status = recoveryBoundary.waiting ? "waiting_for_specialist_recovery" : "halted_on_specialist_recovery_quality_failure";
    safeState({
      status,
      localTime: clock.display,
      importId,
      reason: recoveryBoundary.reason,
      recoveryRunId: recoveryBoundary.run?.id || null,
      recoveryQuality: {
        planned: recoveryBoundary.planned ?? null,
        completed: recoveryBoundary.completed ?? null,
        failed: recoveryBoundary.failed ?? null,
        errorCount: recoveryBoundary.errorCount ?? null
      },
      admission
    });
    log(status, { reason: recoveryBoundary.reason, recoveryRunId: recoveryBoundary.run?.id || null });
    return { stop: !recoveryBoundary.waiting, status };
  }

  if (!boundary.safe) {
    const status = boundary.waiting ? "waiting_for_clean_boundary" : "halted_on_quality_gate";
    safeState({ status, localTime: clock.display, importId, reason: boundary.reason, parentRunId: boundary.parent?.id || null, admission });
    log(status, { reason: boundary.reason, parentRunId: boundary.parent?.id || null });
    return { stop: !boundary.waiting, status };
  }

  if (!beforeSubmissionCutoff(clock)) {
    safeState({ status: "submission_cutoff", localTime: clock.display, importId, reason: "No new 500-call parent starts after 04:30 Melbourne time.", admission });
    return { status: "submission_cutoff" };
  }
  if (!admission.eligible) {
    safeState({ status: "paused_for_pc", localTime: clock.display, importId, reason: admission.reason, admission });
    return { status: "paused_for_pc" };
  }

  const recovery = await requestJson(
    `${DASHBOARD_BASE_URL}/api/evaluation-studio/specialist-recovery?importId=${encodeURIComponent(importId)}&limit=${SPECIALIST_BATCH_SIZE}`,
    { timeoutMs: 120000 }
  );
  if (recovery.nextBatch) {
    const template = (studio.evaluationTemplates || []).find((item) =>
      item.isActive && !item.containsUntrustedLegacyData && item.evaluationGoal === recovery.nextBatch.goal
    );
    if (!template) throw new Error(`No active specialist template is available for ${recovery.nextBatch.goal}.`);
    const selection = {
      templateId: template.id,
      importId,
      evaluationState: "all",
      selectionMode: "call_ids",
      callIds: recovery.nextBatch.callIds.join(","),
      limit: recovery.nextBatch.selectedCount
    };
    const submitted = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/runs`, {
      method: "POST",
      body: JSON.stringify({
        ...selection,
        submitNow: true,
        autoRouteSpecialists: false,
        callSelection: {
          sourceType: SPECIALIST_RECOVERY_SOURCE_TYPE,
          specialistGoal: recovery.nextBatch.goal
        }
      }),
      timeoutMs: 300000
    });
    const runId = submitted.evaluationRun?.id || null;
    safeState({
      status: "specialist_recovery_submitted",
      localTime: clock.display,
      importId,
      recoveryRunId: runId,
      recoveryGoal: recovery.nextBatch.goal,
      selectedCount: recovery.nextBatch.selectedCount,
      remainingMissingChecksBeforeBatch: recovery.backlog.totalMissingChecks,
      admission
    });
    log("specialist_recovery_batch_submitted", {
      importId,
      runId,
      goal: recovery.nextBatch.goal,
      selectedCount: recovery.nextBatch.selectedCount,
      remainingMissingChecksBeforeBatch: recovery.backlog.totalMissingChecks
    });
    return { status: "specialist_recovery_submitted" };
  }

  const template = (studio.evaluationTemplates || []).find((item) =>
    item.isActive && !item.containsUntrustedLegacyData && item.evaluationGoal === FOUNDATION_GOAL
  );
  if (!template) throw new Error("No active Call Intelligence Foundation template is available.");
  const selection = {
    templateId: template.id,
    importId,
    evaluationState: "unevaluated",
    selectionMode: "oldest",
    minDuration: 0,
    limit: BATCH_SIZE
  };
  const preview = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/selection-preview`, {
    method: "POST",
    body: JSON.stringify(selection),
    timeoutMs: 120000
  });
  const selectedCount = Number(preview.matchingCalls ?? 0);
  if (!selectedCount) {
    safeState({ status: "complete", localTime: clock.display, importId, reason: "No unevaluated transcript-bearing calls remain.", admission });
    log("backlog_complete", { importId });
    return { stop: true, status: "complete" };
  }

  const submitted = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/runs`, {
    method: "POST",
    body: JSON.stringify({
      ...selection,
      submitNow: true,
      autoRouteSpecialists: true,
      callSelection: { sourceType: "overnight_foundation_backlog" }
    }),
    timeoutMs: 300000
  });
  const runId = submitted.evaluationRun?.id || null;
  safeState({ status: "submitted", localTime: clock.display, importId, parentRunId: runId, selectedCount, admission });
  log("foundation_batch_submitted", { importId, runId, selectedCount });
  return { status: "submitted" };
}

async function main() {
  assertLocalModelSubmissionAllowed({
    taskType: "sales_dashboard_evaluation_studio",
    evaluationGoal: FOUNDATION_GOAL
  });
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  let lock;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = fs.openSync(LOCK_PATH, "wx");
      fs.writeFileSync(lock, `${process.pid}\n`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previousPid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
      let alive = Number.isInteger(previousPid) && previousPid > 0;
      if (alive) {
        try { process.kill(previousPid, 0); } catch { alive = false; }
      }
      if (alive) return;
      try { fs.unlinkSync(LOCK_PATH); } catch {}
    }
  }
  if (lock === undefined) throw new Error("Could not acquire the overnight evaluation controller lock.");
  const release = () => {
    try { fs.closeSync(lock); } catch {}
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  };
  process.once("SIGINT", () => { release(); process.exit(130); });
  process.once("SIGTERM", () => { release(); process.exit(143); });
  try {
    do {
      try {
        const result = await tick();
        if (result.stop) break;
      } catch (error) {
        safeState({ status: "retrying_after_error", error: String(error.message || error).slice(0, 1000) });
        log("controller_error", { error: String(error.stack || error).slice(0, 4000) });
      }
      if (ONCE) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    } while (true);
  } finally {
    release();
  }
}

main().catch((error) => {
  if (error?.code === "LOCAL_MODEL_CAPABILITY_QUARANTINED") {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  log("fatal_error", { error: String(error.stack || error).slice(0, 4000) });
  process.exitCode = 1;
});
