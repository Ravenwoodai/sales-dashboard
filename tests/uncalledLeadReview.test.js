"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { classifyLead, datePlus, timeBand } = require("../src/uncalledLeadReview");

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "uncalled-lead-review-rules.json"), "utf8"));

test("classifies a clear trade as a missed commercial opportunity", () => {
  const result = classifyLead({ businessName: "Smith Plumbing Pty Ltd" }, rules);
  assert.equal(result.operationalGroup, "Missed commercial opportunity");
  assert.equal(result.category, "Trades and construction");
  assert.equal(result.suitabilityBand, "A - Priority");
  assert.equal(result.confidence, "High");
});

test("keeps an unclear business in manual research", () => {
  const result = classifyLead({ businessName: "Blue Horizon" }, rules);
  assert.equal(result.operationalGroup, "Uncertain / manual research");
  assert.equal(result.category, "Other / uncertain");
  assert.equal(result.confidence, "Low");
});

test("uses conservative deterministic non-call rules", () => {
  assert.equal(classifyLead({ businessName: "Central Casino" }, rules).operationalGroup, "Should not have been called");
  assert.equal(classifyLead({ businessName: "-" }, rules).operationalGroup, "Could not practically be called");
});

test("date and time helpers preserve the Monday-Friday reporting contract", () => {
  assert.equal(datePlus("2026-08-03", 4), "2026-08-07");
  assert.equal(timeBand("09:59:59"), "Before 10 am");
  assert.equal(timeBand("15:00:00"), "After 3 pm");
});
