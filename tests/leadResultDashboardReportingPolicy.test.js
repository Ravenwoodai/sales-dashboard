const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const generatorPath = path.join(__dirname, "..", "scripts", "build-lead-result-dashboard.mjs");

test("Lead Result Dashboard gates Leads Uncalled to complete reporting-window coverage", () => {
  const source = fs.readFileSync(generatorPath, "utf8");

  assert.match(source, /Leads Uncalled Within Reporting Window/);
  assert.match(source, /Allocated Leads With No Recorded Call by Evidence Cutoff/);
  assert.match(source, /call gate did not pass, so the uncalled ranking is intentionally withheld/);
  assert.match(source, /leadBurnersByUncalled/);
  assert.match(source, /personCallHelperStart/);
  assert.match(source, /salespersonNoExactCallObserved/);
  assert.match(source, /teamNoExactCallObserved/);
});

test("Lead Result Dashboard omits unsupported customer-history lead labels", () => {
  const source = fs.readFileSync(generatorPath, "utf8");

  assert.doesNotMatch(source, /classifyLeadTypeForAllocationEvent|LEAD_TYPE_RULE_VERSION|buildUnclassifiedReviewWorkbook/);
  assert.doesNotMatch(source, /New Business sent leads|Warm sent leads|Unclassified sent leads|Unclassified Leads|no clear allocation/i);
  assert.match(source, /Sales From Allocated Leads/);
  assert.match(source, /Self Sourced sales/);
  assert.match(source, /Salespeople Receiving Leads/);
  assert.doesNotMatch(source, /Observed Active Salespeople/);
  assert.match(source, /model\.sentLeadRows/);
});

test("Lead Result Dashboard separates salesperson and manager-team performance evidence", () => {
  const source = fs.readFileSync(generatorPath, "utf8");

  assert.match(source, /Performance & Trophies/);
  assert.match(source, /Salesperson Results Worthy of Investigation/);
  assert.match(source, /Team Results Worthy of Investigation/);
  assert.match(source, /Lead Burners — High Allocation \/ Weak Result Mix/);
  assert.match(source, /Lead Burners — Highest Uncalled %/);
  assert.doesNotMatch(source, /Best Performing Salespeople|Best Performing Teams/);
  assert.match(source, /Salesperson Trophy Candidates/);
  assert.match(source, /Team Trophy Candidates/);
  assert.match(source, /summed team Sales From Allocated Leads .* summed team classified Approved Sales/);
  assert.match(source, /manager's own Sent Leads, Approved Sales, Value and share of team sales/i);
});

test("Lead Result Dashboard explains the exact allocated-lead calculation and timing boundary", () => {
  const source = fs.readFileSync(generatorPath, "utf8");

  assert.match(source, /Team Sales From Allocated Leads % = summed team Sales From Allocated Leads .* summed team classified Approved Sales/);
  assert.match(source, /Under 3% unresolved remains comparable; 3% or more is provisional/);
  assert.doesNotMatch(source, /Not scored - source attribution incomplete/);
  assert.match(source, /There is no allocation-age limit/);
  assert.match(source, /not conversion of this week's Sent Leads/i);
  assert.match(source, /at least 100 weekly Sent Leads and at least 5 Approved Sales/);
  assert.match(source, /Versatility and Lead Utilisation require at least 12 Approved Sales/);
  assert.doesNotMatch(source, /Most Improved/);
  assert.doesNotMatch(source, /Salesperson Performance - Same-Week Workload Proxy/);
});

test("Lead Result Dashboard uses a persistent visual key for individual and team sections", () => {
  const source = fs.readFileSync(generatorPath, "utf8");

  assert.match(source, /blue panels show individual salesperson results; teal panels show manager-team results/i);
  assert.match(source, /blue sections are individual salesperson results; teal sections are manager-team results/i);
  assert.match(source, /titleFill: COLORS\.teamTeal, headerFill: COLORS\.teamDark/);
  assert.match(source, /Team Results Worthy of Investigation", COLORS\.teamTeal/);
  assert.match(source, /Complete Team Calculations — Manager field defines the team", COLORS\.teamTeal/);
});
