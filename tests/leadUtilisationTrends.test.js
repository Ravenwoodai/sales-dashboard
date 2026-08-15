"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildTrendModel, snapshotFromReportData } = require("../src/leadUtilisationTrends");

function report(startDate, utilisation, received = 200, salespersonReceived = received, overrides = {}) {
  const called = Math.round(received * utilisation);
  const personCalled = Math.round(salespersonReceived * utilisation);
  const endDate = new Date(`${startDate}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 4);
  return {
    subtitle: `${startDate} week`,
    reportingPeriod: { startDate, endDate: endDate.toISOString().slice(0, 10) },
    totals: { received, called, wasted: received - called, followUpFailures: 2, outboundCalls: received * 2, otherOutboundCalls: 10 },
    managers: [{ manager: "Team One", salespeople: 1, received, called, wasted: received - called, followUpFailures: 2, outboundCalls: received * 2, otherOutboundCalls: 10 }],
    salespeople: [{ manager: "Team One", salesperson: "Person One", received: salespersonReceived, called: personCalled, wasted: salespersonReceived - personCalled, followUpFailures: 1, outboundCalls: salespersonReceived * 2, otherOutboundCalls: 5 }],
    exclusions: { managerTeams: ["Excluded Manager team"], salespeople: ["Excluded Manager"] },
    qaChecks: [{ check: "reconciles", result: "PASS" }],
    ...overrides,
  };
}

test("trend model applies the 100-allocation person gate and has no Most Improved ranking", () => {
  const first = snapshotFromReportData(report("2026-07-20", 0.50, 200, 90), "2026-07-25T00:00:00Z");
  const second = snapshotFromReportData(report("2026-07-27", 0.60, 200, 120), "2026-08-01T00:00:00Z");
  const model = buildTrendModel({ snapshots: [first, second] }, second);
  assert.equal(model.people.length, 1);
  assert.equal(model.people[0].comparison.status, "not_comparable");
  assert.doesNotMatch(JSON.stringify(model), /Most Improved/i);
});

test("trend model identifies sample-gated improvement and regression without ranking entities", () => {
  const first = snapshotFromReportData(report("2026-07-20", 0.50), "2026-07-25T00:00:00Z");
  const second = snapshotFromReportData(report("2026-07-27", 0.58), "2026-08-01T00:00:00Z");
  const third = snapshotFromReportData(report("2026-08-03", 0.51), "2026-08-08T00:00:00Z");
  const improved = buildTrendModel({ snapshots: [first, second] }, second);
  assert.equal(improved.people[0].comparison.status, "improved");
  const regressed = buildTrendModel({ snapshots: [first, second, third] }, third);
  assert.equal(regressed.people[0].comparison.status, "regressed");
});

test("outlier prompts require five prior comparable observations", () => {
  const rates = [0.50, 0.51, 0.49, 0.50, 0.52, 0.80];
  const snapshots = rates.map((value, index) => {
    const start = new Date("2026-06-29T00:00:00Z");
    start.setUTCDate(start.getUTCDate() + index * 7);
    return snapshotFromReportData(report(start.toISOString().slice(0, 10), value), `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`);
  });
  const early = buildTrendModel({ snapshots: snapshots.slice(0, 5) }, snapshots[4]);
  assert.equal(early.people[0].outlier.status, "not_scored");
  const mature = buildTrendModel({ snapshots }, snapshots[5]);
  assert.equal(mature.people[0].outlier.status, "above_usual_range");
});

test("trend snapshots reject unreconciled or failed-QA inputs", () => {
  const invalid = report("2026-07-20", 0.50);
  invalid.qaChecks[0].result = "FAIL";
  assert.throws(() => snapshotFromReportData(invalid), /QA did not pass/);
});
