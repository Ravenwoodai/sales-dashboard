"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activeRuns,
  beforeSubmissionCutoff,
  latestFoundationBoundary,
  melbourneClock,
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
