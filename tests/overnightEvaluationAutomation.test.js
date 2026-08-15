"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ADHOC_FOUNDATION_SOURCE_TYPE,
  ADHOC_SPECIALIST_RECOVERY_SOURCE_TYPE,
  activeRuns,
  beforeSubmissionCutoff,
  buildTypedSpecialistRecoveryBacklog,
  latestFoundationBoundary,
  latestSpecialistRecoveryBoundary,
  melbourneClock,
  selectTypedSpecialistRecoveryBatch,
  withinOvernightWindow
} = require("../src/overnightEvaluationAutomation");

function parent(patch = {}) {
  return {
    id: "foundation-1",
    importId: "import-1",
    runType: "batch",
    status: "completed",
    createdAt: "2026-07-18T12:00:00Z",
    plannedCallCount: 500,
    completedCallCount: 499,
    failedCallCount: 1,
    templateSnapshot: { evaluationGoal: "call_intelligence_foundation" },
    specialistRouting: { status: "completed", errors: [] },
    ...patch
  };
}

function child(patch = {}) {
  return {
    id: "specialist-1",
    importId: "import-1",
    status: "completed",
    plannedCallCount: 100,
    completedCallCount: 100,
    failedCallCount: 0,
    callSelection: { parentFoundationRunId: "foundation-1" },
    ...patch
  };
}

test("Melbourne overnight window wraps midnight and submission cutoff leaves completion time", () => {
  assert.equal(withinOvernightWindow({ hour: 22 }), true);
  assert.equal(withinOvernightWindow({ hour: 5 }), true);
  assert.equal(withinOvernightWindow({ hour: 6 }), false);
  assert.equal(withinOvernightWindow({ hour: 12 }), false);
  assert.equal(beforeSubmissionCutoff({ hour: 4, minute: 29 }), true);
  assert.equal(beforeSubmissionCutoff({ hour: 4, minute: 30 }), false);
  assert.equal(beforeSubmissionCutoff({ hour: 23, minute: 0 }), true);
});

test("Melbourne clock applies daylight-saving timezone rather than the PC timezone", () => {
  const winter = melbourneClock(new Date("2026-07-18T12:30:00Z"));
  const summer = melbourneClock(new Date("2026-12-18T11:30:00Z"));
  assert.equal(winter.hour, 22);
  assert.equal(summer.hour, 22);
});

test("clean foundation and specialist boundary permits the next batch", () => {
  const boundary = latestFoundationBoundary({ evaluationRuns: [parent(), child()] }, "import-1");
  assert.equal(boundary.safe, true);
  assert.equal(boundary.reason, "boundary_passed");
  assert.equal(boundary.failureRate, 0.002);
});

test("boundary waits for running specialists and halts on quality failures", () => {
  const waiting = latestFoundationBoundary({ evaluationRuns: [parent(), child({ status: "running" })] }, "import-1");
  const failedParent = latestFoundationBoundary({ evaluationRuns: [parent({ failedCallCount: 10 })] }, "import-1");
  const failedSpecialists = latestFoundationBoundary({ evaluationRuns: [parent(), child({ failedCallCount: 2, completedCallCount: 98 })] }, "import-1");
  assert.equal(waiting.waiting, true);
  assert.equal(failedParent.reason, "foundation_failure_rate_at_or_above_2_percent");
  assert.equal(failedSpecialists.reason, "specialist_failure_rate_at_or_above_2_percent");
});

test("active run detection is scoped to the active import", () => {
  const studio = { evaluationRuns: [
    parent({ status: "running" }),
    parent({ id: "other", importId: "import-2", status: "running" }),
    child({ status: "completed" })
  ] };
  assert.deepEqual(activeRuns(studio, "import-1").map((run) => run.id), ["foundation-1"]);
});

test("empty queued run records do not block a controller when they contain no execution jobs", () => {
  const orphan = parent({
    status: "queued",
    queuedJobCount: 0,
    queuedJobs: [],
    completedCallCount: 0,
    failedCallCount: 0
  });
  assert.deepEqual(activeRuns({ evaluationRuns: [orphan] }, "import-1"), []);
});

test("once automation starts, a newer manual Foundation run cannot replace its quality boundary", () => {
  const automated = parent({
    id: "automated",
    createdAt: "2026-07-18T12:00:00Z",
    callSelection: { sourceType: "overnight_foundation_backlog" },
    specialistRouting: { status: "completed", errors: [{ goal: "callback_opportunity", error: "route failed" }] }
  });
  const manual = parent({ id: "manual", createdAt: "2026-07-18T13:00:00Z" });
  const boundary = latestFoundationBoundary({ evaluationRuns: [automated, manual] }, "import-1");
  assert.equal(boundary.parent.id, "automated");
  assert.equal(boundary.reason, "specialist_routing_errors");
});

test("a newer ad hoc Foundation run becomes the shared automated quality boundary", () => {
  const overnight = parent({
    id: "overnight",
    createdAt: "2026-07-18T12:00:00Z",
    callSelection: { sourceType: "overnight_foundation_backlog" }
  });
  const adhoc = parent({
    id: "adhoc",
    createdAt: "2026-07-18T13:00:00Z",
    failedCallCount: 10,
    callSelection: { sourceType: ADHOC_FOUNDATION_SOURCE_TYPE }
  });
  const boundary = latestFoundationBoundary({ evaluationRuns: [overnight, adhoc] }, "import-1");
  assert.equal(boundary.parent.id, "adhoc");
  assert.equal(boundary.reason, "foundation_failure_rate_at_or_above_2_percent");
});

test("typed specialist recovery derives missing checks from Foundation routes and ignores legacy placeholders", () => {
  const studio = {
    evaluationRuns: [],
    evaluationResults: [
      {
        id: "foundation-result-1",
        runId: "foundation-1",
        importId: "import-1",
        callId: "call-1",
        templateId: "template_call_intelligence_foundation_v6",
        evaluationGoal: "call_intelligence_foundation",
        status: "usable",
        isLatest: true,
        foundationAssessment: {
          specialistRoutes: {
            offer_acceptance_classification: true,
            callback_opportunity: true,
            objection_handling: false,
            procedure_adherence: true,
            lead_record_disposition_evidence_audit: false
          }
        }
      },
      {
        id: "legacy-callback",
        runId: "legacy-run",
        importId: "import-1",
        callId: "call-1",
        templateId: "template_callback_opportunity_v1",
        evaluationGoal: "callback_opportunity",
        status: "usable",
        isLatest: true,
        findings: [{ field: "callback_opportunity", value: "not_supplied" }]
      },
      {
        id: "typed-offer",
        runId: "offer-run",
        importId: "import-1",
        callId: "call-1",
        templateId: "template_offer_acceptance_classification_v3",
        evaluationGoal: "offer_acceptance_classification",
        status: "usable",
        isLatest: true,
        acceptanceAssessment: { schemaVersion: "offer_acceptance_classification.v1" }
      }
    ]
  };
  const backlog = buildTypedSpecialistRecoveryBacklog(studio, { importId: "import-1" });
  assert.equal(backlog.totalMissingChecks, 2);
  assert.equal(backlog.affectedCallCount, 1);
  assert.deepEqual(backlog.groups.filter((group) => group.count).map((group) => [group.goal, group.callIds]), [
    ["callback_opportunity", ["call-1"]],
    ["procedure_adherence", ["call-1"]]
  ]);
  assert.deepEqual(selectTypedSpecialistRecoveryBatch(backlog, 1), {
    goal: "callback_opportunity",
    callIds: ["call-1"],
    selectedCount: 1,
    remainingForGoalAfterBatch: 0
  });
});

test("specialist recovery boundary stops on any failed or incomplete call", () => {
  const clean = {
    id: "recovery-1",
    importId: "import-1",
    status: "completed",
    createdAt: "2026-07-18T14:00:00Z",
    plannedCallCount: 10,
    completedCallCount: 10,
    failedCallCount: 0,
    errors: [],
    callSelection: { sourceType: "overnight_specialist_recovery" }
  };
  assert.equal(latestSpecialistRecoveryBoundary({ evaluationRuns: [clean] }, "import-1").safe, true);
  const failed = latestSpecialistRecoveryBoundary({ evaluationRuns: [{ ...clean, failedCallCount: 1, completedCallCount: 9 }] }, "import-1");
  assert.equal(failed.safe, false);
  assert.equal(failed.reason, "specialist_recovery_quality_failure");
  const partial = latestSpecialistRecoveryBoundary({ evaluationRuns: [{ ...clean, status: "partially_completed" }] }, "import-1");
  assert.equal(partial.reason, "specialist_recovery_quality_failure");

  const adhoc = latestSpecialistRecoveryBoundary({
    evaluationRuns: [{ ...clean, id: "recovery-adhoc", callSelection: { sourceType: ADHOC_SPECIALIST_RECOVERY_SOURCE_TYPE } }]
  }, "import-1");
  assert.equal(adhoc.safe, true);
  assert.equal(adhoc.run.id, "recovery-adhoc");
});
