"use strict";

const fs = require("fs");
const path = require("path");
const {
  ADHOC_FOUNDATION_SOURCE_TYPE,
  ADHOC_SPECIALIST_RECOVERY_SOURCE_TYPE,
  FOUNDATION_GOAL,
  activeRuns,
  appendJsonLine,
  latestFoundationBoundary,
  latestSpecialistRecoveryBoundary,
  melbourneClock,
  writeJsonAtomic
} = require("../src/overnightEvaluationAutomation");
const { assertLocalModelSubmissionAllowed } = require("../src/localModelCapability");

const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_BASE_URL = process.env.SALES_DASHBOARD_BASE_URL || "http://127.0.0.1:3040";
const EXECUTION_BASE_URL = process.env.SALES_DASHBOARD_AI_EXECUTION_BASE_URL || "http://127.0.0.1:8080";
const STATE_PATH = process.env.SALES_DASHBOARD_ADHOC_STATE_PATH || path.join(ROOT, "runtime", "evaluation-adhoc-state.json");
const LOG_PATH = process.env.SALES_DASHBOARD_ADHOC_LOG_PATH || path.join(ROOT, "runtime", "evaluation-adhoc.log");
const LOCK_PATH = process.env.SALES_DASHBOARD_EVALUATION_LOCK_PATH || path.join(ROOT, "runtime", "evaluation-overnight.lock");
const STOP_PATH = process.env.SALES_DASHBOARD_ADHOC_STOP_PATH || path.join(ROOT, "runtime", "evaluation-adhoc.stop");
const BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.SALES_DASHBOARD_ADHOC_BATCH_SIZE || 25)));
const SPECIALIST_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.SALES_DASHBOARD_ADHOC_SPECIALIST_BATCH_SIZE || 25)));
const POLL_SECONDS = Math.max(10, Number(process.env.SALES_DASHBOARD_ADHOC_POLL_SECONDS || 20));
const ONCE = process.argv.includes("--once");
const STATUS = process.argv.includes("--status");
const STOP = process.argv.includes("--stop");

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
    schemaVersion: "sales_dashboard_adhoc_evaluations.v1",
    updatedAt: new Date().toISOString(),
    controllerPid: process.pid,
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    executionBaseUrl: EXECUTION_BASE_URL,
    batchSize: BATCH_SIZE,
    specialistBatchSize: SPECIALIST_BATCH_SIZE,
    ...patch
  };
  writeJsonAtomic(STATE_PATH, value);
  return value;
}

function stopRequested() {
  return fs.existsSync(STOP_PATH);
}

function printStatus() {
  if (!fs.existsSync(STATE_PATH)) {
    process.stdout.write(`${JSON.stringify({ status: "not_started", statePath: STATE_PATH }, null, 2)}\n`);
    return;
  }
  process.stdout.write(fs.readFileSync(STATE_PATH, "utf8"));
}

function requestStop() {
  writeJsonAtomic(STOP_PATH, {
    schemaVersion: "sales_dashboard_adhoc_stop.v1",
    requestedAt: new Date().toISOString(),
    requestedByPid: process.pid
  });
  log("stop_requested", { stopPath: STOP_PATH });
  process.stdout.write("Stop requested. No new batch will be submitted; any in-flight run will finish safely.\n");
}

async function tick() {
  const clock = melbourneClock();
  const dashboardHealth = await requestJson(`${DASHBOARD_BASE_URL}/health`);
  if (!dashboardHealth.csv_loaded || !dashboardHealth.current_import_id) {
    throw new Error("Dashboard has no active transcript import.");
  }

  const executionHealth = await requestJson(`${EXECUTION_BASE_URL}/health`);
  const worker = executionHealth.evaluation_studio_worker;
  const admission = executionHealth.evaluation_studio_admission;
  if (worker?.status !== "active") throw new Error("Execution Layer Evaluation Studio worker lease is not active.");
  if (!admission?.enabled) throw new Error("Execution Layer Evaluation Studio admission gate is not enabled.");

  const activeWorkers = Number(executionHealth.job_runner?.active_workers || 0);
  const importId = dashboardHealth.current_import_id;
  if (!admission.eligible && activeWorkers === 0) {
    safeState({
      status: "paused_for_pc",
      localTime: clock.display,
      importId,
      reason: admission.reason,
      admission
    });
    return { status: "paused_for_pc" };
  }

  await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/progress?currentOnly=true`, { timeoutMs: 120000 });
  const studio = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio?currentOnly=true&limit=1`, { timeoutMs: 120000 });
  const running = activeRuns(studio, importId);
  if (running.length) {
    const stopping = stopRequested();
    safeState({
      status: stopping ? "stopping_after_inflight" : "processing",
      localTime: clock.display,
      importId,
      activeRunIds: running.map((run) => run.id),
      reason: stopping ? "Stop requested; waiting for the active run to finish and harvest." : "A run is active.",
      admission
    });
    return { status: stopping ? "stopping_after_inflight" : "processing" };
  }

  if (stopRequested()) {
    safeState({ status: "stopped", localTime: clock.display, importId, reason: "Operator stop completed at a clean batch boundary.", admission });
    log("stopped_at_clean_boundary", { importId });
    return { stop: true, status: "stopped" };
  }

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

  const boundary = latestFoundationBoundary(studio, importId);
  if (!boundary.safe) {
    const status = boundary.waiting ? "waiting_for_clean_boundary" : "halted_on_quality_gate";
    safeState({ status, localTime: clock.display, importId, reason: boundary.reason, parentRunId: boundary.parent?.id || null, admission });
    log(status, { reason: boundary.reason, parentRunId: boundary.parent?.id || null });
    return { stop: !boundary.waiting, status };
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
    const submitted = await requestJson(`${DASHBOARD_BASE_URL}/api/evaluation-studio/runs`, {
      method: "POST",
      body: JSON.stringify({
        templateId: template.id,
        importId,
        evaluationState: "all",
        selectionMode: "call_ids",
        callIds: recovery.nextBatch.callIds.join(","),
        limit: recovery.nextBatch.selectedCount,
        submitNow: true,
        autoRouteSpecialists: false,
        callSelection: {
          sourceType: ADHOC_SPECIALIST_RECOVERY_SOURCE_TYPE,
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
      callSelection: { sourceType: ADHOC_FOUNDATION_SOURCE_TYPE }
    }),
    timeoutMs: 300000
  });
  const runId = submitted.evaluationRun?.id || null;
  safeState({ status: "foundation_submitted", localTime: clock.display, importId, parentRunId: runId, selectedCount, admission });
  log("foundation_batch_submitted", { importId, runId, selectedCount });
  return { status: "foundation_submitted" };
}

async function main() {
  if (STATUS) {
    printStatus();
    return;
  }
  if (STOP) {
    requestStop();
    return;
  }

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
      if (alive) {
        safeState({ status: "already_running", reason: `Evaluation controller ${previousPid} already owns the shared lock.` });
        return;
      }
      try { fs.unlinkSync(LOCK_PATH); } catch {}
    }
  }
  if (lock === undefined) throw new Error("Could not acquire the shared evaluation controller lock.");

  try { fs.unlinkSync(STOP_PATH); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const release = () => {
    try { fs.closeSync(lock); } catch {}
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  };
  process.once("SIGINT", () => { release(); process.exit(130); });
  process.once("SIGTERM", () => { release(); process.exit(143); });

  safeState({ status: "starting", reason: "Operator-authorized ad hoc evaluation controller is starting." });
  log("controller_started", { controllerPid: process.pid, batchSize: BATCH_SIZE, specialistBatchSize: SPECIALIST_BATCH_SIZE });
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
