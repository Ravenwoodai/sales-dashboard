"use strict";

const WEEKLY_LEAD_SUPPLY_ROWS = [
  { weekStarting: "05/04/2026", leadsImported: 14054 },
  { weekStarting: "12/04/2026", leadsImported: 9014 },
  { weekStarting: "19/04/2026", leadsImported: 21954 },
  { weekStarting: "26/04/2026", leadsImported: 2633 },
  { weekStarting: "03/05/2026", leadsImported: 3195 },
  { weekStarting: "10/05/2026", leadsImported: 2679 },
  { weekStarting: "17/05/2026", leadsImported: 2669 },
  { weekStarting: "24/05/2026", leadsImported: 11869 },
  { weekStarting: "31/05/2026", leadsImported: 2358 },
  { weekStarting: "07/06/2026", leadsImported: 8525 },
  { weekStarting: "14/06/2026", leadsImported: 2046 },
  { weekStarting: "21/06/2026", leadsImported: 2666 },
  { weekStarting: "28/06/2026", leadsImported: 6188 },
  { weekStarting: "05/07/2026", leadsImported: 1909 },
  { weekStarting: "12/07/2026", leadsImported: 1111 }
];

const LEAD_ORIGIN_ROWS = [
  { origin: "Imported sources", leadsImported: 65706, description: "Imported lead sources such as Google Maps and HiPages." },
  { origin: "Lead generators", leadsImported: 25643, description: "Records entered by lead generators." },
  { origin: "Sales team", leadsImported: 1521, description: "Records entered by the sales team." }
];

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function buildWeeklyLeadIntelligenceModel() {
  const totalImported = LEAD_ORIGIN_ROWS.reduce((sum, row) => sum + row.leadsImported, 0);
  const highestWeek = WEEKLY_LEAD_SUPPLY_ROWS.reduce((highest, row) => row.leadsImported > highest.leadsImported ? row : highest, WEEKLY_LEAD_SUPPLY_ROWS[0]);
  const latestWeek = WEEKLY_LEAD_SUPPLY_ROWS[WEEKLY_LEAD_SUPPLY_ROWS.length - 1];
  const sourceRows = LEAD_ORIGIN_ROWS.map((row) => ({
    ...row,
    shareOfImportedLeads: percent(row.leadsImported, totalImported)
  }));

  return {
    schemaVersion: "sales_dashboard_weekly_lead_intelligence.v1",
    title: "Weekly Lead Intelligence",
    status: "attached_snapshot",
    statusLabel: "Attached export snapshot",
    periodLabel: "Lead supply: 05/04/2026–12/07/2026; workflow report: last 120 days",
    sourceFiles: [
      "New Business Leads Mobile Only - Last 100 days.xls",
      "Salesperson & Lead Generator Sales Last 120 Days.xls"
    ],
    totals: {
      totalImported,
      weeksCovered: WEEKLY_LEAD_SUPPLY_ROWS.length,
      latestWeekImported: latestWeek.leadsImported,
      highestWeekImported: highestWeek.leadsImported,
      highestWeekStarting: highestWeek.weekStarting,
      latestVsPeakChange: percent(latestWeek.leadsImported - highestWeek.leadsImported, highestWeek.leadsImported)
    },
    originRows: sourceRows,
    weeklyRows: WEEKLY_LEAD_SUPPLY_ROWS.slice().reverse(),
    workflowFields: [
      "Customers", "Searches", "All orders", "Cancelled orders", "Approved", "Returned lead called", "Called", "Allocated"
    ],
    cohortRule: "Lead-generator records are handed out in the week after entry. Compare lead-generator supply with the following week’s allocation/calling activity, not the same week.",
    limitations: [
      "This is a fixed snapshot from the two attached spreadsheet exports; it does not change current call, sales, revenue, attribution, allocation, or CRM records.",
      "The spreadsheet headings do not define commercial terms or every merged sub-column, so workflow fields are shown as available measures rather than sales or revenue claims.",
      "These reports are summaries. A future lead-level CSV with a stable CRM/lead ID is required to connect supply, allocation, calls, and attribution for an individual record."
    ]
  };
}

module.exports = { buildWeeklyLeadIntelligenceModel };
