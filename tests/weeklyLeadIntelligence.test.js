"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWeeklyLeadIntelligenceModel } = require("../src/weeklyLeadIntelligence");

test("weekly lead intelligence keeps attached weekly data isolated and labels the cohort rule", () => {
  const model = buildWeeklyLeadIntelligenceModel();
  assert.equal(model.status, "attached_snapshot");
  assert.equal(model.totals.totalImported, 92870);
  assert.equal(model.totals.weeksCovered, 15);
  assert.equal(model.originRows.find((row) => row.origin === "Imported sources").shareOfImportedLeads, 70.8);
  assert.match(model.cohortRule, /following week/i);
  assert.match(model.limitations.join(" "), /does not change current call, sales, revenue, attribution, allocation, or CRM records/i);
});
