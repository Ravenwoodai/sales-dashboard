"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXCLUDED_PERSONNEL,
  configurePersonnelExclusions,
  isExcludedPersonnel,
  normalizePersonnelName,
  visibleManagerLabel,
  visiblePersonnelLabel
} = require("../src/personnelExclusions");

test("personnel exclusions use normalized exact names only", () => {
  configurePersonnelExclusions(["Excluded Admin", "Excluded Manager", "Excluded Seller"]);
  assert.deepEqual(EXCLUDED_PERSONNEL, [
    "Excluded Admin",
    "Excluded Manager",
    "Excluded Seller"
  ]);
  assert.equal(isExcludedPersonnel("  EXCLUDED   MANAGER "), true);
  assert.equal(isExcludedPersonnel("Excluded Managerson"), false);
  assert.equal(isExcludedPersonnel("excluded seller"), true);
  assert.equal(isExcludedPersonnel("Included Seller"), false);
  assert.equal(normalizePersonnelName(" Excluded\u00a0Manager "), "excluded manager");
  assert.equal(visiblePersonnelLabel("Excluded Admin"), "Excluded personnel");
  assert.equal(visiblePersonnelLabel("Riley Example"), "Riley Example");
  assert.equal(visibleManagerLabel(" Excluded\u00a0Manager "), "Excluded Manager");
  assert.equal(visibleManagerLabel(""), "Unknown");
});
