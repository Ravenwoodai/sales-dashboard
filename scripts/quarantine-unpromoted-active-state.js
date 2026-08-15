"use strict";

const {
  quarantineStoredEvaluationRun,
  readStore,
  updateStore
} = require("../src/storage");

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "pending", "retrying"]);
const ACTIVE_RUN_STATUSES = new Set(["draft", "queued", "running"]);
const QUARANTINE_REASON =
  "Local-model capability quarantine applied 2026-07-22: no evaluator has a complete promoted capability contract. Historical audit record only; do not resume or consume operationally.";

function activeState(store) {
  const activeJobs = (store.aiJobs || []).filter((job) =>
    ACTIVE_JOB_STATUSES.has(String(job.status || "").toLowerCase())
  );
  const activeRuns = (store.evaluationStudio?.evaluationRuns || []).filter((run) =>
    ACTIVE_RUN_STATUSES.has(String(run.status || "").toLowerCase())
  );
  return { activeJobs, activeRuns };
}

function quarantineActiveState() {
  const before = readStore();
  const { activeJobs, activeRuns } = activeState(before);

  for (const run of activeRuns) {
    quarantineStoredEvaluationRun(run.id, {
      reason: QUARANTINE_REASON,
      metadata: {
        policy: "docs/LOCAL_MODEL_CAPABILITY_POLICY.md",
        capabilityRegister: "runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json"
      }
    });
  }

  const timestamp = new Date().toISOString();
  updateStore((store) => ({
    ...store,
    aiJobs: (store.aiJobs || []).map((job) => {
      const previousStatus = String(job.status || "").toLowerCase();
      if (!ACTIVE_JOB_STATUSES.has(previousStatus)) return job;
      return {
        ...job,
        status: "quarantined",
        updatedAt: timestamp,
        metadata: {
          ...(job.metadata || {}),
          quarantine: {
            previousStatus,
            reason: QUARANTINE_REASON,
            quarantinedAt: timestamp,
            policy: "docs/LOCAL_MODEL_CAPABILITY_POLICY.md",
            capabilityRegister: "runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json"
          }
        }
      };
    })
  }));

  const after = readStore();
  const remaining = activeState(after);
  return {
    changedAiJobIds: activeJobs.map((job) => job.id),
    changedEvaluationRunIds: activeRuns.map((run) => run.id),
    remainingActiveAiJobs: remaining.activeJobs.length,
    remainingActiveEvaluationRuns: remaining.activeRuns.length,
    quarantinedAiJobs: (after.aiJobs || []).filter((job) => job.status === "quarantined").length,
    quarantinedEvaluationRuns: (after.evaluationStudio?.evaluationRuns || [])
      .filter((run) => run.status === "quarantined").length
  };
}

if (require.main === module) {
  if (!process.argv.includes("--apply")) {
    const store = readStore();
    const current = activeState(store);
    console.log(JSON.stringify({
      applyRequired: true,
      activeAiJobs: current.activeJobs.length,
      activeEvaluationRunIds: current.activeRuns.map((run) => run.id)
    }, null, 2));
    process.exitCode = current.activeJobs.length || current.activeRuns.length ? 2 : 0;
  } else {
    console.log(JSON.stringify(quarantineActiveState(), null, 2));
  }
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  ACTIVE_RUN_STATUSES,
  QUARANTINE_REASON,
  activeState,
  quarantineActiveState
};
