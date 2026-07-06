"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderDashboard, renderReportPage } = require("../src/dashboardRenderer");

test("dashboard report library renders a view link for saved reports", () => {
  const html = renderDashboard({
    schemaVersion: "test",
    sourceName: "test.csv",
    generatedAt: "2026-07-05T00:00:00.000Z",
    dateRange: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-01T01:00:00.000Z" },
    totals: {
      uniqueCalls: 1,
      rawRows: 1,
      duplicateCallIds: 0,
      probableLiveHuman: 1,
      meaningfulConversation: 1,
      followUpRequired: 0,
      followUpIndeterminate: 0,
      transcriptAvailable: 1,
      outcomeMismatches: 0,
      riskReviews: 0
    },
    rates: {
      probableLiveHuman: 100,
      meaningfulConversation: 100,
      transcriptCoverage: 100,
      outcomeMismatch: 0,
      durationRelationMatch: 100,
      noSaleCoverage: 100,
      bazNotesCoverage: 100,
      sourceCoverage: 100
    },
    ignoredFields: [],
    unsupportedMetrics: [],
    missingColumns: [],
    alerts: [],
    reviewQueue: [],
    salespersonScorecards: [],
    sourceMetrics: [],
    explorerRows: [],
    persistence: {
      currentImportId: "import-test",
      importHistory: [],
      reports: [
        {
          id: "report_test",
          title: "Average Calls Per Stable Target By Salesperson",
          type: "salesperson_repeat_call_report",
          source: "codex",
          summary: "Team average 1.14",
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      counts: {
        imports: 1,
        reports: 1,
        alertEvents: 0,
        managerReviews: 0,
        currentAlertEvents: 0,
        currentManagerReviews: 0,
        acknowledgedAlerts: 0
      }
    }
  });

  assert.match(html, /Reports Library/);
  assert.match(html, /href="\/reports\/report_test"/);
  assert.match(html, /Average Calls Per Stable Target By Salesperson/);
});

test("report page renders markdown table data as an HTML table", () => {
  const html = renderReportPage({
    id: "report_test",
    title: "Average Calls Per Stable Target By Salesperson",
    type: "salesperson_repeat_call_report",
    source: "codex",
    summary: "Team average 1.14",
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
    content: [
      "# Average Calls Per Stable Target By Salesperson",
      "",
      "| Salesperson | Avg calls per target |",
      "| --- | ---: |",
      "| Justin Lucas | 1.68 |",
      "| Patrick Reinemann | 1.59 |"
    ].join("\n")
  });

  assert.match(html, /Average Calls Per Stable Target By Salesperson/);
  assert.match(html, /<table>/);
  assert.match(html, /Justin Lucas/);
  assert.match(html, /Patrick Reinemann/);
  assert.match(html, /Raw report record/);
});
