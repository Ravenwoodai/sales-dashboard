"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLeadDistributionRows,
  buildManagerChartGuidance,
  buildManagerRows,
  buildPerformanceViews,
  selectPreviousSnapshot
} = require("../src/leadResultDashboardMetrics");

function person(overrides = {}) {
  return {
    salesperson: "Alex Example",
    manager: "Morgan Manager",
    sentAllocationEvents: 100,
    uniqueCustomers: 100,
    reallocationEvents: 0,
    approvedSales: 10,
    approvedSalesValue: 5000,
    companySourcedSales: 8,
    selfSourcedSales: 2,
    ...overrides
  };
}

test("manager metrics count observed recipients and calculate maintenance-free per-head workload", () => {
  const rows = buildManagerRows([
    person(),
    person({ salesperson: "Blair Example", sentAllocationEvents: 300, uniqueCustomers: 280, approvedSales: 15 }),
    person({ salesperson: "Casey Example", manager: "Taylor Manager", sentAllocationEvents: 200, approvedSales: 5 }),
    person({ salesperson: "No Leads Example", manager: "Taylor Manager", sentAllocationEvents: 0, approvedSales: 2 })
  ]);
  const morgan = rows.find((row) => row.manager === "Morgan Manager");
  assert.equal(morgan.activeSalespeople, 2);
  assert.equal(morgan.sent, 400);
  assert.equal(morgan.leadsPerActiveSalesperson, 200);
  assert.equal(morgan.ratePer1000, 62.5);
  assert.equal(rows.reduce((sum, row) => sum + row.activeSalespeople, 0), 3);
  assert.equal(rows.some((row) => row.manager === "Taylor Manager" && row.activeSalespeople === 2), false);
});

test("lead distribution uses an explicit equal-share reference without claiming a fairness verdict", () => {
  const people = [
    person({ salesperson: "Alex Example", sentAllocationEvents: 100 }),
    person({ salesperson: "Blair Example", sentAllocationEvents: 300 })
  ];
  const distribution = buildLeadDistributionRows(people, buildManagerRows(people));
  assert.equal(distribution.find((row) => row.salesperson === "Blair Example").status, "25%+ above equal-share reference");
  assert.equal(distribution.find((row) => row.salesperson === "Alex Example").status, "25%+ below equal-share reference");
});

test("chart guidance names only threshold-backed standouts and preserves caveats", () => {
  const people = [
    person({ salesperson: "Alex Example", sentAllocationEvents: 100, uniqueCustomers: 90, customersCalledAfterAllocation: 80, approvedSales: 20, companySourcedSales: 18, selfSourcedSales: 2 }),
    person({ salesperson: "Blair Example", manager: "Taylor Manager", sentAllocationEvents: 300, uniqueCustomers: 280, customersCalledAfterAllocation: 100, approvedSales: 10, companySourcedSales: 2, selfSourcedSales: 8 })
  ];
  const managers = buildManagerRows(people);
  const guidance = buildManagerChartGuidance(managers, buildLeadDistributionRows(people, managers), {
    callEvidenceThrough: "2026-07-28",
    unresolvedCallJoinKeys: 12
  });
  assert.match(guidance.efficiency.whatToKnow, /Sales highlight: Morgan Manager/);
  assert.match(guidance.efficiency.whatItShows, /company-supplied customers/);
  assert.match(guidance.efficiency.howToRead, /not conversion of the leads sent this week/);
  assert.match(guidance.shares.whatToKnow, /Sales review point: Taylor Manager/);
  assert.match(guidance.shares.whatItShows, /this week's lead allocation/);
  assert.match(guidance.shares.howToRead, /not a conversion rate/);
  assert.match(guidance.active.whatToKnow, /cannot identify an active salesperson who received zero leads/);
  assert.match(guidance.callBacklog.whatToKnow, /Largest review backlog: Taylor Manager/);
  assert.match(guidance.callBacklog.whatToKnow, /12 calls still lack a reliable exact customer join/);
  assert.match(guidance.callBacklog.howToRead, /not proven failure to call/);
});

test("manager call backlogs aggregate unique allocation pairs without asserting an authoritative negative", () => {
  const rows = buildManagerRows([
    person({ salesperson: "Alex Example", uniqueCustomers: 100, customersCalledAfterAllocation: 60 }),
    person({ salesperson: "Blair Example", uniqueCustomers: 80, customersCalledAfterAllocation: 70 })
  ]);
  assert.equal(rows[0].exactCallsObserved, 130);
  assert.equal(rows[0].noExactCallObserved, 50);
  assert.equal(rows[0].unique, 180);
});

test("previous snapshot selection uses the newest fully prior period and ignores same-period output", () => {
  const snapshot = (startDate, endDate) => ({
    schemaVersion: "lead_result_dashboard_snapshot.v1",
    period: { startDate, endDate },
    salespeople: []
  });
  const selected = selectPreviousSnapshot([
    { sourcePath: "older.json", snapshot: snapshot("2026-07-06", "2026-07-12") },
    { sourcePath: "prior.json", snapshot: snapshot("2026-07-13", "2026-07-19") },
    { sourcePath: "same.json", snapshot: snapshot("2026-07-20", "2026-07-26") }
  ], "2026-07-20");
  assert.equal(selected.sourcePath, "prior.json");
});

test("team rates use aggregated counts and expose manager self-contribution separately", () => {
  const people = [
    person({ salesperson: "Morgan Manager", sentAllocationEvents: 100, uniqueCustomers: 100, approvedSales: 10, approvedSalesValue: 5000 }),
    person({ salesperson: "Blair Example", sentAllocationEvents: 900, uniqueCustomers: 850, approvedSales: 9, approvedSalesValue: 4500, selfSourcedSales: 1 })
  ];
  const team = buildManagerRows(people)[0];
  assert.equal(team.sent, 1000);
  assert.equal(team.sales, 19);
  assert.equal(team.salesPerLead, 0.019);
  assert.equal(team.ratePer1000, 19);
  assert.equal(team.valuePerLead, 9.5);
  assert.equal(team.managerOwnSent, 100);
  assert.equal(team.managerOwnSales, 10);
  assert.equal(team.allocatedLeadSales, 16);
  assert.equal(team.allocatedLeadShare, 16 / 19);
  assert.notEqual(team.salesPerLead, (0.10 + 0.01) / 2);
  assert.notEqual(team.allocatedLeadShare, (0.8 + (8 / 9)) / 2);
});

test("performance views create separate team attention and trophy candidates with safeguards", () => {
  const people = [
    person({ salesperson: "Alex Example", manager: "Morgan Manager", sentAllocationEvents: 800, uniqueCustomers: 800, approvedSales: 5, approvedSalesValue: 1000, companySourcedSales: 0, selfSourcedSales: 5 }),
    person({ salesperson: "Blair Example", manager: "Morgan Manager", sentAllocationEvents: 800, uniqueCustomers: 800, approvedSales: 5, approvedSalesValue: 1000, companySourcedSales: 0, selfSourcedSales: 5 }),
    person({ salesperson: "Casey Example", manager: "Taylor Manager", sentAllocationEvents: 400, uniqueCustomers: 400, approvedSales: 20, approvedSalesValue: 10000, companySourcedSales: 18, selfSourcedSales: 2 }),
    person({ salesperson: "Drew Example", manager: "Taylor Manager", sentAllocationEvents: 400, uniqueCustomers: 400, approvedSales: 10, approvedSalesValue: 5000, companySourcedSales: 8, selfSourcedSales: 2 }),
    person({ salesperson: "Hidden Example", manager: "Manager withheld by policy", sentAllocationEvents: 200, approvedSales: 50 })
  ];
  const managers = buildManagerRows(people);
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: managers, callCoverageComplete: false });
  const morgan = views.teams.find((row) => row.manager === "Morgan Manager");
  assert.ok(morgan.concerns.some((item) => /below 70%/.test(item)));
  assert.ok(morgan.concerns.some((item) => /Self Sourced/.test(item)));
  assert.ok(views.teamResultsWorthyOfInvestigation.some((row) => row.manager === "Morgan Manager"));
  assert.equal(views.teamTrophies.some((row) => row.candidate === "Manager withheld by policy team"), false);
  assert.equal(views.teamTrophies.find((row) => row.trophy.startsWith("Lead Utilisation")).candidate, "No eligible team candidate this week");
  assert.match(views.teamTrophies.find((row) => row.trophy.startsWith("Self-Sourcing")).context, /contributing salespeople/);
});

test("self-sourced sales are not credited as allocated-lead performance", () => {
  const people = [
    person({ salesperson: "Mac Example", sentAllocationEvents: 187, approvedSales: 8, approvedSalesValue: 8000, companySourcedSales: 0, selfSourcedSales: 8 }),
    person({ salesperson: "Allocated Example", sentAllocationEvents: 200, approvedSales: 10, approvedSalesValue: 9000, companySourcedSales: 8, selfSourcedSales: 2 })
  ];
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people) });
  const mac = views.salespeople.find((row) => row.displayName === "Mac Example");
  assert.equal(mac.allocatedLeadSales, 0);
  assert.equal(mac.allocatedLeadShare, 0);
  assert.equal(views.leadBurnersByResult.some((row) => row.displayName === "Mac Example"), true);
  assert.ok(mac.concerns.some((item) => /Self Sourced/.test(item)));
  assert.equal(views.salespersonTrophies.find((row) => row.trophy.startsWith("Sales From Allocated Leads")).candidate, "Allocated Example");
});

test("3% or more unresolved attribution shows a provisional share and range without removing sales volume", () => {
  const people = [
    person({
      salesperson: "Timestamp Exception Seller",
      manager: "Exception Manager",
      sentAllocationEvents: 250,
      approvedSales: 6,
      approvedSalesValue: 6000,
      companySourcedSales: 4,
      selfSourcedSales: 1,
      attributionWithheldSales: 1
    }),
    person({
      salesperson: "Complete Seller",
      manager: "Complete Manager",
      sentAllocationEvents: 200,
      approvedSales: 5,
      approvedSalesValue: 5000,
      companySourcedSales: 3,
      selfSourcedSales: 2,
      attributionWithheldSales: 0
    })
  ];
  const managers = buildManagerRows(people);
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: managers });
  const affectedPerson = views.salespeople.find((row) => row.displayName === "Timestamp Exception Seller");
  const affectedTeam = views.teams.find((row) => row.manager === "Exception Manager");
  assert.equal(affectedPerson.sales, 6);
  assert.equal(affectedPerson.withheld, 1);
  assert.equal(affectedPerson.allocatedLeadShare, 4 / 5);
  assert.equal(affectedPerson.sourceCoverage, 5 / 6);
  assert.equal(affectedPerson.allocatedLeadShareLowerBound, 4 / 6);
  assert.equal(affectedPerson.allocatedLeadShareUpperBound, 5 / 6);
  assert.equal(affectedPerson.sourceAttributionStatus, "provisional");
  assert.equal(affectedPerson.shareEligible, false);
  assert.equal(affectedTeam.sales, 6);
  assert.equal(affectedTeam.withheld, 1);
  assert.equal(affectedTeam.allocatedLeadShare, 4 / 5);
  assert.equal(affectedTeam.sourceAttributionStatus, "provisional");
  assert.equal(affectedTeam.shareEligible, false);
  assert.equal(views.salespersonTrophies.find((row) => row.trophy.startsWith("Sales From Allocated Leads")).candidate, "Complete Seller");
  assert.equal(views.teamTrophies.find((row) => row.trophy.startsWith("Sales From Allocated Leads")).candidate, "Complete Manager team");
});

test("less than 3% unresolved attribution remains comparable while preserving the unresolved count", () => {
  const people = [
    person({
      salesperson: "High Coverage Seller",
      manager: "High Coverage Manager",
      sentAllocationEvents: 250,
      approvedSales: 101,
      companySourcedSales: 80,
      selfSourcedSales: 20,
      attributionWithheldSales: 1
    })
  ];
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people) });
  const seller = views.salespeople[0];
  assert.equal(seller.allocatedLeadShare, 0.8);
  assert.equal(seller.sourceCoverage, 100 / 101);
  assert.equal(seller.sourceAttributionStatus, "high_coverage");
  assert.equal(seller.sourceShareComparable, true);
  assert.equal(seller.shareEligible, true);
  assert.equal(views.salespersonTrophies.find((row) => row.trophy.startsWith("Sales From Allocated Leads")).candidate, "High Coverage Seller");
});

test("exactly 3% unresolved attribution is provisional", () => {
  const people = [person({
    salesperson: "Boundary Seller",
    manager: "Boundary Manager",
    sentAllocationEvents: 250,
    approvedSales: 100,
    companySourcedSales: 77,
    selfSourcedSales: 20,
    attributionWithheldSales: 3
  })];
  const seller = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people) }).salespeople[0];
  assert.equal(seller.unresolvedShare, 0.03);
  assert.equal(seller.sourceAttributionStatus, "provisional");
  assert.equal(seller.sourceShareComparable, false);
  assert.equal(seller.shareEligible, false);
});

test("a provisional prior snapshot cannot drive change or improvement trophies", () => {
  const people = [person({
    salesperson: "Current Seller",
    manager: "Current Manager",
    sentAllocationEvents: 250,
    approvedSales: 100,
    companySourcedSales: 85,
    selfSourcedSales: 15,
    attributionWithheldSales: 0
  })];
  const previousSnapshot = {
    period: { startDate: "2026-07-20", endDate: "2026-07-26" },
    salespeople: [{
      salesperson: "Current Seller",
      manager: "Current Manager",
      sentAllocationEvents: 250,
      approvedSales: 100,
      allocatedLeadSales: 77,
      selfSourcedSales: 20,
      attributionWithheldSales: 3,
      allocatedLeadShare: 77 / 97,
      sourceShareComparable: false
    }]
  };
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people), previousSnapshot, currentPeriod: { startDate: "2026-07-27", endDate: "2026-08-02" } });
  assert.equal(views.salespeople[0].priorRate, null);
  assert.equal(views.salespeople[0].change, null);
  assert.equal(views.salespersonTrophies.some((row) => row.trophy.startsWith("Most Improved")), false);
  assert.equal(views.salespersonTrophies.find((row) => row.trophy.startsWith("Consistency Champion")).candidate, "Current Seller");
});

test("Versatility uses the closest eligible 50/50 classified-sales split", () => {
  const people = [
    person({ salesperson: "Balanced Seller", approvedSales: 14, companySourcedSales: 7, selfSourcedSales: 7 }),
    person({ salesperson: "Near Seller", approvedSales: 14, companySourcedSales: 8, selfSourcedSales: 6 }),
    person({ salesperson: "Too Small Seller", approvedSales: 10, companySourcedSales: 5, selfSourcedSales: 5 })
  ];
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people) });
  const trophy = views.salespersonTrophies.find((row) => row.trophy.startsWith("Versatility Champion"));
  assert.equal(trophy.candidate, "Balanced Seller");
  assert.match(trophy.context, /both sales sources represented/);
  assert.equal(trophy.runnersUp.includes("Too Small Seller"), false);
});

test("Lead Utilisation requires 12 Approved Sales", () => {
  const people = [
    person({ salesperson: "Low-Sales Caller", approvedSales: 11, uniqueCustomers: 100, customersCalledAfterAllocation: 100 }),
    person({ salesperson: "Eligible Caller", approvedSales: 12, uniqueCustomers: 100, customersCalledAfterAllocation: 80 })
  ];
  const views = buildPerformanceViews({ salespersonRows: people, managerRows: buildManagerRows(people), callCoverageComplete: true });
  const trophy = views.salespersonTrophies.find((row) => row.trophy.startsWith("Lead Utilisation"));
  assert.equal(trophy.candidate, "Eligible Caller");
  assert.match(trophy.context, /12-sale gate/);
});

test("Consistency compares Approved Sales percentage change across contiguous equal-length periods", () => {
  const people = [
    person({ salesperson: "Steady Seller", approvedSales: 13, companySourcedSales: 10, selfSourcedSales: 3 }),
    person({ salesperson: "Changing Seller", approvedSales: 18, companySourcedSales: 15, selfSourcedSales: 3 })
  ];
  const previousSnapshot = {
    period: { startDate: "2026-07-20", endDate: "2026-07-26" },
    salespeople: [
      { salesperson: "Steady Seller", manager: "Morgan Manager", sentAllocationEvents: 100, approvedSales: 12, allocatedLeadSales: 9, selfSourcedSales: 3, sourceShareComparable: true },
      { salesperson: "Changing Seller", manager: "Morgan Manager", sentAllocationEvents: 100, approvedSales: 12, allocatedLeadSales: 9, selfSourcedSales: 3, sourceShareComparable: true }
    ]
  };
  const views = buildPerformanceViews({
    salespersonRows: people,
    managerRows: buildManagerRows(people),
    previousSnapshot,
    currentPeriod: { startDate: "2026-07-27", endDate: "2026-08-02" }
  });
  const trophy = views.salespersonTrophies.find((row) => row.trophy.startsWith("Consistency Champion"));
  assert.equal(trophy.candidate, "Steady Seller");
  assert.match(trophy.metric, /week-to-week sales difference/);
});

test("Lead Burners publish an uncalled ranking only when the call gate passes", () => {
  const people = [
    person({ salesperson: "High Waste", approvedSales: 12, uniqueCustomers: 100, customersCalledAfterAllocation: 20 }),
    person({ salesperson: "Lower Waste", approvedSales: 12, uniqueCustomers: 100, customersCalledAfterAllocation: 70 })
  ];
  const managerRows = buildManagerRows(people);
  const incomplete = buildPerformanceViews({ salespersonRows: people, managerRows, callCoverageComplete: false });
  const complete = buildPerformanceViews({ salespersonRows: people, managerRows, callCoverageComplete: true });
  assert.deepEqual(incomplete.leadBurnersByUncalled, []);
  assert.equal(complete.leadBurnersByUncalled[0].displayName, "High Waste");
  assert.equal(complete.leadBurnersByUncalled[0].uncalledRate, 0.8);
});
