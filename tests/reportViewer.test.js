"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderDashboard, renderReportPage } = require("../src/dashboardRenderer");

function dashboardFixture(overrides = {}) {
  return {
    schemaVersion: "test",
    sourceName: "test.csv",
    generatedAt: "2026-07-05T00:00:00.000Z",
    inputHash: "abcdef1234567890",
    dateRange: {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-01T01:00:00.000Z",
      sourceStart: "01/07/2026 00:00:00 AEST",
      sourceEnd: "01/07/2026 01:00:00 AEST",
      sourceTimezoneLabel: "Source call time (AEST)",
      display: "01/07/2026 00:00:00 AEST to 01/07/2026 01:00:00 AEST (Source call time (AEST))"
    },
    totals: {
      uniqueCalls: 2,
      rawRows: 2,
      duplicateCallIds: 0,
      probableLiveHuman: 1,
      meaningfulConversation: 1,
      followUpRequired: 1,
      followUpIndeterminate: 0,
      transcriptAvailable: 2,
      outcomeMismatches: 0,
      riskReviews: 0
    },
    rates: {
      probableLiveHuman: 50,
      meaningfulConversation: 50,
      transcriptCoverage: 100,
      transcriptUsableForCoaching: 50,
      outcomeMismatch: 0,
      durationRelationMatch: 100,
      noSaleCoverage: 100,
      bazNotesCoverage: 100,
      sourceCoverage: 100
    },
    intelligenceGovernance: {
      processing: {
        totalCalls: 2,
        transcriptsAvailable: 2,
        deterministicEvaluationsCompleted: 2,
        lowOrUnusableTranscriptCount: 1,
        transcriptDerivedMetricsCoverageRate: 50
      },
      confidence: { high: 1, medium: 0, low: 1, unusable: 0, unknown: 0 }
    },
    intelligence: {
      totals: {
        callsIndexed: 2,
        leadsIndexed: 2,
        wasteRiskLeads: 0,
        highQualityLeads: 0,
        repeatedShortAttemptLeads: 0,
        managerReviewCalls: 0,
        riskFlagCalls: 0,
        llmQueued: 0,
        llmCompleted: 1,
        llmFailed: 0,
        llmNotRequested: 1
      },
      salespeople: [],
      sources: []
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
      managerReviewedCallIds: [],
      importHistory: [],
      reports: [],
      counts: {
        imports: 1,
        reports: 0,
        alertEvents: 0,
        managerReviews: 0,
        currentAlertEvents: 0,
        currentManagerReviews: 0,
        acknowledgedAlerts: 0
      }
    },
    ...overrides
  };
}

test("dashboard report library renders a view link for saved reports", () => {
  const html = renderDashboard(dashboardFixture({
    totals: {
      ...dashboardFixture().totals,
      uniqueCalls: 1,
      rawRows: 1
    },
    persistence: {
      ...dashboardFixture().persistence,
      reports: [
        {
          id: "report_test",
          title: "Callback Leakage Review",
          type: "manager_report",
          source: "codex",
          summary: "Review callback leakage using active call data.",
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      counts: {
        ...dashboardFixture().persistence.counts,
        reports: 1,
      }
    }
  }));

  assert.match(html, /Reports Library/);
  assert.match(html, /href="\/reports\/report_test"/);
  assert.match(html, /Callback Leakage Review/);
});

test("dashboard labels LLM-reviewed only for usable completed LLM output", () => {
  const html = renderDashboard(dashboardFixture(), {
    intelligenceQueue: "llm_completed",
    intelligenceCalls: [
      {
        call_id: "llm-valid",
        customer_id: "customer-valid",
        business_segment: "new",
        business_segment_label: "New Business",
        salesperson: "Riley",
        source: "Web",
        lead_utilization_score: 4,
        lead_waste_risk: 0,
        lead_high_quality_utilized: 1,
        manager_review_required: 0,
        llm_status: "completed",
        llm_confidence: 0.9,
        llm_result_json: JSON.stringify({ call_summary: { confidence: 0.9 }, events: [], entities: [], risk_flags: [] }),
        llm_result_quality: "complete_json",
        llm_result_quality_label: "Complete",
        brief_reason: "Valid model summary."
      },
      {
        call_id: "llm-missing",
        customer_id: "customer-missing",
        business_segment: "new",
        business_segment_label: "New Business",
        salesperson: "Riley",
        source: "Web",
        lead_utilization_score: 2,
        lead_waste_risk: 1,
        lead_high_quality_utilized: 0,
        manager_review_required: 0,
        llm_status: "completed",
        llm_confidence: 0,
        llm_result_json: "",
        llm_result_quality: "missing",
        llm_result_quality_label: "Missing result",
        brief_reason: ""
      }
    ]
  });

  assert.match(html, /llm-valid[\s\S]*LLM-reviewed/);
  assert.match(html, /llm-valid[\s\S]*90%/);
  assert.match(html, /llm-missing[\s\S]*Failed/);
  assert.match(html, /llm-missing[\s\S]*Confidence unavailable/);
});

test("report page renders markdown table data as an HTML table", () => {
  const html = renderReportPage({
    id: "report_test",
    title: "Callback Leakage Review",
    type: "manager_report",
    source: "codex",
    summary: "Review callback leakage using active call data.",
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
    content: [
      "# Callback Leakage Review",
      "",
      "| Salesperson | Missed callbacks |",
      "| --- | ---: |",
      "| Justin Lucas | 3 |",
      "| Patrick Reinemann | 2 |"
    ].join("\n")
  });

  assert.match(html, /Callback Leakage Review/);
  assert.match(html, /<table>/);
  assert.match(html, /Justin Lucas/);
  assert.match(html, /Patrick Reinemann/);
  assert.match(html, /Raw report record/);
});
