"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv } = require("../src/csvParser");
const { alertIdFor } = require("../src/alertLifecycle");
const { analyzeCsvText, buildFilteredAnalysis } = require("../src/analysis");
const { evaluateCall, parseTranscriptTurns } = require("../src/transcriptEvaluator");
const { buildCallIntelligence } = require("../src/transcriptIntelligence");
const { classifyOneDialRecord } = require("../src/leadReattemptAnalytics");

const header = [
  "dialled_phone_number",
  "call_id",
  "UserID",
  "Mobile",
  "CallTotalSeconds",
  "call_date",
  "call_time",
  "ring_time_seconds",
  "call_duration_seconds",
  "AllocatedLeadID",
  "customer_id",
  "ContactId",
  "Baz_DetailedNotes",
  "transcription_text",
  "CallType",
  "call_direction",
  "NoSaleType",
  "CustomerCreatedBy",
  "CustomerCreatedByType",
  "CustomerCreateDate",
  "CustomerImportDate",
  "CustomerImportSource",
  "Salesperson",
  "Prefix",
  "CallerID",
  "IsNZCall",
  "CallRegion",
  "FoundContactID",
  "FoundCustomerID",
  "OrderCount"
];

function row(overrides = {}) {
  const base = {
    dialled_phone_number: "4000000",
    call_id: "1",
    UserID: "10",
    Mobile: "1",
    CallTotalSeconds: "62",
    call_date: "1/07/2026",
    call_time: "09:00:00",
    ring_time_seconds: "2",
    call_duration_seconds: "60",
    AllocatedLeadID: "lead-1",
    customer_id: "customer-1",
    ContactId: "contact-1",
    Baz_DetailedNotes: "NULL",
    transcription_text: "Outbound call Customer: Yes, please send me the information and call me back tomorrow. Agent: Great, I will follow up.",
    CallType: "Click to dial",
    call_direction: "out",
    NoSaleType: "NULL",
    CustomerCreatedBy: "system",
    CustomerCreatedByType: "LG",
    CustomerCreateDate: "04:29.7",
    CustomerImportDate: "24:43.9",
    CustomerImportSource: "GoogleMaps",
    Salesperson: "Riley Example",
    Prefix: "NULL",
    CallerID: "MyMobile",
    IsNZCall: "NULL",
    CallRegion: "NULL",
    FoundContactID: "NULL",
    FoundCustomerID: "NULL",
    OrderCount: "NULL"
  };
  const values = { ...base, ...overrides };
  return header.map((field) => {
    const value = String(values[field] ?? "");
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
}

function csv(rows) {
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

test("parseCsv handles quoted commas", () => {
  const parsed = parseCsv('a,b,c\n1,"two, with comma",3\n');
  assert.deepEqual(parsed.columns, ["a", "b", "c"]);
  assert.equal(parsed.rows[0].b, "two, with comma");
});

test("analysis ignores redacted phone and treats invalid customer date fragments as missing", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "1", dialled_phone_number: "4000000", customer_id: "customer-1" }),
    row({ call_id: "2", dialled_phone_number: "4000000", customer_id: "customer-2" })
  ]));

  const ignored = analysis.ignoredFields.map((item) => item.field);
  assert.ok(ignored.includes("dialled_phone_number"));
  assert.equal(ignored.includes("CustomerCreateDate"), false);
  assert.equal(ignored.includes("CustomerImportDate"), false);
  assert.equal(analysis.totals.uniqueCalls, 2);
  assert.equal(analysis.sourceQuality.totals.callsWithImportDate, 0);
  assert.equal(analysis.sourceQuality.totals.callsWithCreateDate, 0);
  assert.equal(analysis.reviewQueue.every((item) => !("dialled_phone_number" in item)), true);
});

test("analysis classifies New Business and Warm Business from order history", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "1", OrderCount: "NULL" }),
    row({ call_id: "2", OrderCount: "0" }),
    row({ call_id: "3", OrderCount: "2" })
  ]));

  assert.equal(analysis.totals.newBusinessCalls, 2);
  assert.equal(analysis.totals.warmBusinessCalls, 1);
  assert.equal(analysis.rates.newBusiness, 66.7);
  assert.equal(analysis.rates.warmBusiness, 33.3);

  const warmRow = analysis.evaluationRows.find((item) => item.callId === "3");
  assert.equal(warmRow.orderCount, 2);
  assert.equal(warmRow.businessSegment, "warm");
  assert.equal(warmRow.businessSegmentLabel, "Warm Business");

  const newRow = analysis.explorerRows.find((item) => item.callId === "2");
  assert.equal(newRow.orderCount, 0);
  assert.equal(newRow.businessSegment, "new");
  assert.equal(newRow.businessSegmentLabel, "New Business");
  assert.deepEqual(
    analysis.businessSegmentMetrics.map((item) => [item.segment, item.calls]).sort(),
    [["new", 2], ["warm", 1]]
  );
  assert.equal(analysis.businessSegmentViews.new.totals.uniqueCalls, 2);
  assert.equal(analysis.businessSegmentViews.warm.totals.uniqueCalls, 1);
  assert.equal(analysis.businessSegmentViews.warm.drilldownRows[0].businessSegmentLabel, "Warm Business");
});

test("analysis accepts workbook-style ISO call dates", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "1", call_date: "2026-07-01", call_time: "09:00:00" })
  ]));

  assert.equal(analysis.dateRange.start.slice(0, 10), "2026-07-01");
  assert.equal(analysis.drilldownRows[0].dateTime.slice(0, 10), "2026-07-01");
});

test("analysis exposes source-call date range without browser timezone shifting", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "early", call_date: "1/07/2026", call_time: "00:30:00" }),
    row({ call_id: "late", call_date: "1/07/2026", call_time: "23:30:00" })
  ]));

  assert.equal(analysis.dateRange.sourceStart, "2026-07-01 00:30:00");
  assert.equal(analysis.dateRange.sourceEnd, "2026-07-01 23:30:00");
  assert.equal(analysis.dateRange.sourceTimezoneLabel, "Source call time (timezone not supplied)");
  assert.match(analysis.dateRange.display, /2026-07-01 00:30:00 to 2026-07-01 23:30:00/);
  assert.match(analysis.dateRange.display, /Source call time/);
  assert.doesNotMatch(analysis.dateRange.display, /2026-06-30|2026-07-02|30\/06\/2026|2\/07\/2026/);
});

test("analysis reports call-data-only reporting-window warnings", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "single-day-follow-up", call_date: "1/07/2026", call_time: "09:00:00" })
  ]));
  const codes = analysis.dataWindow.warnings.map((warning) => warning.code);

  assert.equal(analysis.dataWindow.callDataOnly, true);
  assert.equal(analysis.dataWindow.singleDay, true);
  assert.equal(analysis.dataWindow.partialDay, true);
  assert.equal(analysis.dataWindow.insufficientTrendHistory, true);
  assert.equal(analysis.dataWindow.followUpFutureDataUnavailable, true);
  assert.ok(codes.includes("single_day_dataset"));
  assert.ok(codes.includes("partial_day_dataset"));
  assert.ok(codes.includes("insufficient_trend_history"));
  assert.ok(codes.includes("follow_up_future_data_unavailable"));
});

test("analysis labels deterministic provenance and confidence without LLM review", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "deterministic", NoSaleType: "Did Not Answer" }),
    row({
      call_id: "unusable",
      transcription_text: "",
      CallTotalSeconds: "0",
      call_duration_seconds: "0",
      NoSaleType: ""
    })
  ]));
  const deterministic = analysis.explorerRows.find((item) => item.callId === "deterministic");
  const unusable = analysis.explorerRows.find((item) => item.callId === "unusable");

  assert.equal(deterministic.intelligenceProvenance, "Deterministic");
  assert.equal(deterministic.llmStatus, "not_requested");
  assert.equal(deterministic.llmProvenance, "Unprocessed");
  assert.equal(deterministic.localOutcomeProvenance, "Deterministic");
  assert.equal(deterministic.rawImportedProvenance, "Raw imported");
  assert.notEqual(deterministic.intelligenceProvenance, "LLM-reviewed");
  assert.equal(analysis.intelligenceGovernance.processing.deterministicEvaluationsCompleted, 2);
  assert.equal(analysis.intelligenceGovernance.processing.llmNotRequested, 2);
  assert.equal(analysis.intelligenceGovernance.confidence.unusable >= 1, true);
  assert.equal(unusable.confidenceLabel, "Unusable transcript");
});

test("allocation inputs are parked and do not affect active metrics", () => {
  const csvText = csv([
    row({
      call_id: "1",
      call_date: "1/07/2026",
      call_time: "09:00:00",
      Salesperson: "Riley Example",
      AllocatedLeadID: "lead-live",
      customer_id: "customer-live",
      OrderCount: "0"
    }),
    row({
      call_id: "2",
      call_date: "1/07/2026",
      call_time: "10:00:00",
      Salesperson: "Riley Example",
      AllocatedLeadID: "lead-no-contact",
      customer_id: "customer-no-contact",
      CallTotalSeconds: "0",
      ring_time_seconds: "0",
      call_duration_seconds: "0",
      transcription_text: "",
      OrderCount: "0"
    }),
    row({
      call_id: "3",
      call_date: "1/07/2026",
      call_time: "11:00:00",
      Salesperson: "Self Source Seller",
      AllocatedLeadID: "lead-calls-only",
      customer_id: "customer-calls-only",
      OrderCount: "0"
    })
  ]);
  const baseline = analyzeCsvText(csvText, { sourceName: "calls.csv" });
  const withAllocation = analyzeCsvText(csvText, {
    sourceName: "calls.csv",
    allocationRows: [
      {
        "LEAD CAMPAIGN": "Fresh Leads",
        "QTY ALLOCATED": "10",
        "QTY ACTIONED": "3",
        "QTY REMAINING": "7",
        DATE: "Jul 1, 2026",
        "SALES MANAGER": "Manager One",
        SALESPERSON: "Riley Example",
        TYPE: "New Business"
      },
      {
        "LEAD CAMPAIGN": "Warm Save",
        "QTY ALLOCATED": "5",
        "QTY ACTIONED": "1",
        "QTY REMAINING": "4",
        DATE: "Jul 1, 2026",
        "SALES MANAGER": "Manager One",
        SALESPERSON: "Warm Seller",
        TYPE: "Warm"
      }
    ],
    allocationMetadata: { sourceName: "allocations.xlsx", sheetName: "Sheet3" }
  });

  assert.equal(baseline.parkedAllocation.configured, false);
  assert.equal(withAllocation.allocationCoverage, undefined);
  assert.equal(withAllocation.parkedAllocation.status, "parked");
  assert.equal(withAllocation.parkedAllocation.configured, true);
  assert.equal(withAllocation.parkedAllocation.activeMetricsAvailable, false);
  assert.equal(withAllocation.activeDataSources.allocationImports, false);

  assert.deepEqual(withAllocation.totals, baseline.totals);
  assert.deepEqual(withAllocation.rates, baseline.rates);
  assert.deepEqual(withAllocation.dateRange, baseline.dateRange);
  assert.deepEqual(withAllocation.dataWindow, baseline.dataWindow);
  assert.deepEqual(withAllocation.sourceQuality.totals, baseline.sourceQuality.totals);
  assert.deepEqual(withAllocation.sourceQuality.sourceRows, baseline.sourceQuality.sourceRows);
  assert.deepEqual(withAllocation.alerts, baseline.alerts);
  assert.equal(withAllocation.leadUtilization.totals.stableLeadDaysWorked, baseline.leadUtilization.totals.stableLeadDaysWorked);
  assert.equal(withAllocation.leadReattempt.totals.leadsTouched, baseline.leadReattempt.totals.leadsTouched);
  assert.equal(withAllocation.leadUtilization.totals.stableLeadDaysWorked, 3);
});

test("global filters default to all active calls and update shared denominators", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "filter-a",
      call_date: "1/07/2026",
      call_time: "00:30:00",
      Salesperson: "Seller A",
      UserID: "user-a",
      CallType: "Click to dial",
      call_direction: "out",
      CustomerImportSource: "GoogleMaps",
      NoSaleType: "Did Not Answer"
    }),
    row({
      call_id: "filter-b",
      call_date: "1/07/2026",
      call_time: "23:30:00",
      Salesperson: "Seller B",
      UserID: "user-b",
      CallType: "Incoming",
      call_direction: "in",
      CustomerImportSource: "",
      Baz_DetailedNotes: "",
      transcription_text: "",
      CallTotalSeconds: "0",
      ring_time_seconds: "0",
      call_duration_seconds: "0",
      NoSaleType: ""
    }),
    row({
      call_id: "filter-c",
      call_date: "2/07/2026",
      call_time: "10:00:00",
      Salesperson: "Seller A",
      UserID: "user-a",
      CustomerImportSource: "Referral",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    })
  ]));

  const unfiltered = buildFilteredAnalysis(analysis, {});
  assert.equal(unfiltered.filterState.active, false);
  assert.equal(unfiltered.totals.uniqueCalls, 3);
  assert.equal(unfiltered.filterSummary.totalRecords, 3);
  assert.equal(unfiltered.filterSummary.filteredRecords, 3);
  assert.deepEqual(unfiltered.totals, analysis.totals);
  assert.ok(unfiltered.filterOptions.customerImportSource.some((option) => option.value === "Not supplied"));
  assert.ok(unfiltered.filterOptions.rawNoSaleType.some((option) => option.value === "Raw NoSaleType missing"));
  assert.ok(unfiltered.filterOptions.bazNotes.some((option) => option.value === "missing"));

  const sellerA = buildFilteredAnalysis(analysis, { salesperson: "Seller A" });
  assert.equal(sellerA.filterState.active, true);
  assert.equal(sellerA.totals.uniqueCalls, 2);
  assert.equal(sellerA.datasetTotals.uniqueCalls, 3);
  assert.equal(sellerA.filterSummary.filteredRecords, 2);
  assert.equal(sellerA.filterSummary.excludedRecords, 1);
  assert.equal(sellerA.filterSummary.warnings[0].code, "very_low_sample");
  assert.deepEqual(sellerA.salespersonScorecards.map((row) => row.name), ["Seller A"]);
  assert.equal(sellerA.sourceQuality.totals.calls, 2);
  assert.equal(sellerA.explorerRows.length, 2);

  const inbound = buildFilteredAnalysis(analysis, { callDirection: "in" });
  assert.equal(inbound.totals.uniqueCalls, 1);
  assert.equal(inbound.drilldownRows[0].callId, "filter-b");

  const incoming = buildFilteredAnalysis(analysis, { callType: "Incoming" });
  assert.equal(incoming.totals.uniqueCalls, 1);
  assert.equal(incoming.drilldownRows[0].callId, "filter-b");

  const missingSource = buildFilteredAnalysis(analysis, { customerImportSource: "Not supplied" });
  assert.equal(missingSource.totals.uniqueCalls, 1);
  assert.equal(missingSource.drilldownRows[0].callId, "filter-b");
  assert.equal(missingSource.sourceQuality.totals.calls, 1);
  assert.equal(missingSource.fieldCoverage.CustomerImportSource.missing, 1);

  const unusable = buildFilteredAnalysis(analysis, { confidenceBand: "unusable" });
  assert.equal(unusable.totals.uniqueCalls, 1);
  assert.equal(unusable.drilldownRows[0].callId, "filter-b");
});

test("global date filters use source call days without browser timezone shifts", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "early", call_date: "1/07/2026", call_time: "00:30:00" }),
    row({ call_id: "late", call_date: "1/07/2026", call_time: "23:30:00" }),
    row({ call_id: "next-day", call_date: "2/07/2026", call_time: "01:00:00" })
  ]));

  const julyFirst = buildFilteredAnalysis(analysis, { dateFrom: "2026-07-01", dateTo: "2026-07-01" });
  assert.deepEqual(julyFirst.drilldownRows.map((row) => row.callId), ["early", "late"]);
  assert.equal(julyFirst.dateRange.sourceStart, "2026-07-01 00:30:00");
  assert.equal(julyFirst.dateRange.sourceEnd, "2026-07-01 23:30:00");
  assert.equal(julyFirst.dateRange.sourceTimezoneLabel, "Source call time (timezone not supplied)");
  assert.doesNotMatch(julyFirst.dateRange.display, /2026-06-30|2026-07-02|30\/06\/2026|2\/07\/2026/);

  const lateOnly = buildFilteredAnalysis(analysis, {
    dateTimeFrom: "2026-07-01 23:00:00",
    dateTimeTo: "2026-07-02 01:00:00"
  });
  assert.deepEqual(lateOnly.drilldownRows.map((row) => row.callId), ["late", "next-day"]);
});

test("global intelligence and alert filters preserve provenance confidence and active alert linkage", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "llm-ok",
      Salesperson: "Seller A",
      transcription_text: "Outbound call Voicemail: You have reached the office. Please leave a message.",
      NoSaleType: "Did Not Answer"
    }),
    row({
      call_id: "llm-failed",
      Salesperson: "Seller B",
      transcription_text: "",
      CallTotalSeconds: "0",
      ring_time_seconds: "0",
      call_duration_seconds: "0",
      NoSaleType: ""
    }),
    row({
      call_id: "manager-reviewed",
      Salesperson: "Seller C",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    })
  ]));
  const context = {
    llmStatusByCallId: new Map([
      ["llm-ok", "completed"],
      ["llm-failed", "failed"]
    ]),
    llmReviewLabelByCallId: new Map([
      ["llm-ok", "LLM-reviewed"],
      ["llm-failed", "Failed"]
    ]),
    managerReviewStatusByCallId: new Map([
      ["manager-reviewed", "manager_reviewed"]
    ])
  };

  const llmReviewed = buildFilteredAnalysis(analysis, { intelligenceProvenance: "LLM-reviewed" }, context);
  assert.deepEqual(llmReviewed.drilldownRows.map((row) => row.callId), ["llm-ok"]);

  const failed = buildFilteredAnalysis(analysis, { llmStatus: "failed" }, context);
  assert.deepEqual(failed.drilldownRows.map((row) => row.callId), ["llm-failed"]);

  const managerReviewed = buildFilteredAnalysis(analysis, { intelligenceProvenance: "Manager-reviewed" }, context);
  assert.deepEqual(managerReviewed.drilldownRows.map((row) => row.callId), ["manager-reviewed"]);

  const criticalAlerts = buildFilteredAnalysis(analysis, { alertSeverity: "critical" }, context);
  assert.equal(criticalAlerts.totals.uniqueCalls, 1);
  assert.equal(criticalAlerts.alerts.length, 1);
  assert.equal(criticalAlerts.alerts[0].callId, "manager-reviewed");
  assert.equal(criticalAlerts.filterOptions.alertStatus[0].value, "new");

  const newAlerts = buildFilteredAnalysis(analysis, { alertStatus: "new" }, context);
  assert.equal(newAlerts.totals.uniqueCalls, 1);
  assert.equal(newAlerts.alerts[0].severity, "critical");
});

test("alert lifecycle context removes closed alerts from active defaults but keeps them filterable", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "closed-risk",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    })
  ]));
  const alert = analysis.alerts[0];
  const importId = "import-test";
  const alertId = alertIdFor(importId, alert);
  const context = {
    currentImportId: importId,
    alertEventById: new Map([
      [alertId, {
        ...alert,
        id: alertId,
        importId,
        status: "resolved",
        resolvedBy: "local_manager",
        resolvedAt: "2026-07-08T00:00:00.000Z"
      }]
    ])
  };

  const defaultView = buildFilteredAnalysis(analysis, {}, context);
  assert.equal(defaultView.alerts.length, 0);
  assert.equal(defaultView.alertLifecycleSummary.active, 0);
  assert.equal(defaultView.alertLifecycleSummary.resolved, 1);

  const resolvedView = buildFilteredAnalysis(analysis, { alertStatus: "resolved" }, context);
  assert.equal(resolvedView.alerts.length, 1);
  assert.equal(resolvedView.alerts[0].status, "resolved");
  assert.equal(resolvedView.totals.uniqueCalls, 1);
});

test("global filters ignore allocation and campaign query dimensions", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "call-only" })
  ]), {
    allocationRows: [
      {
        "LEAD CAMPAIGN": "Fresh Leads",
        "QTY ALLOCATED": "10",
        "QTY ACTIONED": "3",
        "QTY REMAINING": "7"
      }
    ]
  });
  const filtered = buildFilteredAnalysis(analysis, {
    allocationCoverage: "anything",
    campaign: "Fresh Leads",
    "QTY ACTIONED": "3"
  });

  assert.equal(filtered.filterState.active, false);
  assert.equal(filtered.totals.uniqueCalls, 1);
  assert.equal(filtered.parkedAllocation.status, "parked");
  assert.equal(filtered.allocationCoverage, undefined);
  assert.equal("allocationCoverage" in filtered.filterState.query, false);
  assert.equal("campaign" in filtered.filterState.query, false);
});

test("analysis tracks lead reattempt rates and retry patterns by segment source and region", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "a1",
      call_time: "09:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a2",
      call_time: "10:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a3",
      call_time: "09:30:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller A",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      OrderCount: "0"
    }),
    row({
      call_id: "b1",
      call_time: "11:00:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller B",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      transcription_text: "Outbound call Customer: Sorry, you have got the wrong number. Agent: No worries, thanks for letting me know.",
      OrderCount: "0"
    }),
    row({
      call_id: "b2",
      call_time: "12:00:00",
      customer_id: "customer-warm",
      AllocatedLeadID: "lead-warm",
      ContactId: "contact-warm",
      Salesperson: "Seller B",
      CustomerImportSource: "Referral",
      CallRegion: "QLD",
      transcription_text: "[No answer]",
      call_duration_seconds: "0",
      OrderCount: "2"
    })
  ]));

  assert.equal(analysis.leadReattempt.totals.leadsTouched, 4);
  assert.equal(analysis.leadReattempt.totals.personallyRetriedLeads, 1);
  assert.equal(analysis.leadReattempt.totals.oneAndDoneLeads, 3);
  assert.equal(analysis.leadReattempt.totals.validOneDialOutcomeLeads, 1);
  assert.equal(analysis.leadReattempt.totals.riskyOneDialNoContactLeads, 1);
  assert.equal(analysis.leadReattempt.totals.oneDialNoContactNoLaterLeads, 1);
  assert.equal(analysis.leadReattempt.totals.oneDialNeedsReviewLeads, 1);
  assert.equal(analysis.leadReattempt.totals.noLaterCallByAnyoneLeads, 2);
  assert.equal(analysis.leadReattempt.totals.personalRetryRate, 25);
  assert.equal(analysis.leadReattempt.totals.oneAndDoneRate, 75);
  assert.equal(analysis.leadReattempt.totals.validOneDialOutcomeRate, 33.3);
  assert.equal(analysis.leadReattempt.totals.riskyOneDialNoContactRate, 33.3);
  assert.equal(analysis.leadReattempt.totals.oneDialNoContactNoLaterRate, 25);
  assert.equal(analysis.leadReattempt.totals.oneDialNeedsReviewRate, 33.3);
  assert.equal(analysis.leadReattempt.totals.noLaterCallByAnyoneRate, 50);
  assert.equal(analysis.leadReattempt.totals.averageCallsPerLead, 1.25);
  assert.equal(analysis.leadReattempt.totals.maxAttemptsOnOneLead, 2);

  const sellerA = analysis.leadReattempt.salespersonRows.find((item) => item.salesperson === "Seller A");
  const sellerB = analysis.leadReattempt.salespersonRows.find((item) => item.salesperson === "Seller B");
  assert.equal(sellerA.leadsTouched, 2);
  assert.equal(sellerA.personalRetryRate, 50);
  assert.equal(sellerA.oneAndDoneRate, 50);
  assert.equal(sellerA.oneDialNeedsReviewLeads, 1);
  assert.equal(sellerA.noLaterCallByAnyoneRate, 0);
  assert.equal(sellerA.maxAttemptsOnOneLead, 2);
  assert.equal(sellerB.leadsTouched, 2);
  assert.equal(sellerB.personalRetryRate, 0);
  assert.equal(sellerB.oneAndDoneRate, 100);
  assert.equal(sellerB.validOneDialOutcomeLeads, 1);
  assert.equal(sellerB.riskyOneDialNoContactLeads, 1);
  assert.equal(sellerB.oneDialNoContactNoLaterLeads, 1);
  assert.equal(sellerB.oneDialNoContactNoLaterRate, 50);
  assert.equal(sellerB.noLaterCallByAnyoneRate, 100);

  const newBusiness = analysis.leadReattempt.businessSegmentRows.find((item) => item.businessSegment === "new");
  const warmBusiness = analysis.leadReattempt.businessSegmentRows.find((item) => item.businessSegment === "warm");
  assert.equal(newBusiness.leadsTouched, 3);
  assert.equal(newBusiness.personalRetryRate, 33.3);
  assert.equal(warmBusiness.leadsTouched, 1);
  assert.equal(warmBusiness.oneAndDoneRate, 100);

  const google = analysis.leadReattempt.sourceRows.find((item) => item.source === "GoogleMaps");
  const nsw = analysis.leadReattempt.regionRows.find((item) => item.region === "NSW");
  assert.equal(google.leadsTouched, 2);
  assert.equal(google.oneAndDoneRate, 100);
  assert.equal(google.validOneDialOutcomeLeads, 1);
  assert.equal(google.oneDialNeedsReviewLeads, 1);
  assert.equal(nsw.leadsTouched, 1);
  assert.equal(nsw.personalRetryRate, 100);

  const retriedRecord = analysis.leadReattempt.records.find((item) => item.customerId === "customer-retried" && item.salesperson === "Seller A");
  const laterRecord = analysis.leadReattempt.records.find((item) => item.customerId === "customer-later" && item.salesperson === "Seller A");
  assert.deepEqual(retriedRecord.callIds, ["a1", "a2"]);
  assert.equal(retriedRecord.stableLeadSource, "customer_id");
  assert.equal(retriedRecord.personallyRetried, true);
  assert.equal(retriedRecord.oneDialBucket, "not_one_dial");
  assert.deepEqual(laterRecord.laterCallIdsByAnyone, ["b1"]);
  assert.equal(laterRecord.noLaterCallByAnyone, false);
  assert.equal(laterRecord.oneDialBucket, "needs_review");
  const validOneDialRecord = analysis.leadReattempt.records.find((item) => item.firstCallId === "b1");
  const riskyOneDialRecord = analysis.leadReattempt.records.find((item) => item.firstCallId === "b2");
  assert.equal(validOneDialRecord.oneDialBucket, "valid_one_dial_outcome");
  assert.equal("spielDeliveredLikely" in validOneDialRecord, false);
  assert.equal(riskyOneDialRecord.oneDialBucket, "risky_one_dial_no_contact");
  assert.equal(riskyOneDialRecord.metricKeys.includes("reattempt.oneDialNoContactNoLater"), true);
  assert.equal("spielDeliveredLikely" in riskyOneDialRecord, false);
});

test("one-dial utilisation risk counts only hard no-contact evidence", () => {
  const base = {
    oneAndDone: true,
    noLaterCallByAnyone: true
  };

  const noAnswer = classifyOneDialRecord({
    ...base,
    callProof: [{
      contactClassification: "no_answer",
      localOutcome: "no_answer",
      probableLiveHuman: false,
      transcriptAvailable: true,
      transcriptQualityBand: "low",
      transcriptWordCount: 2
    }]
  });
  assert.equal(noAnswer.oneDialBucket, "risky_one_dial_no_contact");

  const noUsableSpeech = classifyOneDialRecord({
    ...base,
    callProof: [{
      contactClassification: "unknown",
      localOutcome: "unknown",
      probableLiveHuman: false,
      transcriptAvailable: false,
      transcriptQualityBand: "unusable",
      transcriptWordCount: 0
    }]
  });
  assert.equal(noUsableSpeech.oneDialBucket, "risky_one_dial_no_contact");

  const ambiguousUnknown = classifyOneDialRecord({
    ...base,
    callProof: [{
      contactClassification: "unknown",
      localOutcome: "unknown",
      probableLiveHuman: false,
      transcriptAvailable: true,
      transcriptQualityBand: "medium",
      transcriptWordCount: 18
    }]
  });
  assert.equal(ambiguousUnknown.oneDialBucket, "needs_review");

  const wrongNumber = classifyOneDialRecord({
    ...base,
    callProof: [{
      contactClassification: "wrong_number",
      localOutcome: "wrong_number",
      probableLiveHuman: false,
      transcriptAvailable: true,
      transcriptQualityBand: "medium",
      transcriptWordCount: 12
    }]
  });
  assert.equal(wrongNumber.oneDialBucket, "valid_one_dial_outcome");
});

test("source quality tracks bulk import dates and manual LG/SP creator fields", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "source-old-new",
      call_date: "1/07/2026",
      CustomerImportSource: "GoogleMaps",
      CustomerImportDate: "1/01/2026",
      CustomerCreatedBy: "leadgen1",
      CustomerCreatedByType: "LG",
      CustomerCreateDate: "1/06/2026",
      OrderCount: "NULL"
    }),
    row({
      call_id: "source-fresh-warm",
      call_date: "1/07/2026",
      CustomerImportSource: "HiPages",
      CustomerImportDate: "20/06/2026",
      CustomerCreatedBy: "seller1",
      CustomerCreatedByType: "SP",
      CustomerCreateDate: "25/06/2026",
      OrderCount: "2"
    }),
    row({
      call_id: "source-mid-new",
      call_date: "1/07/2026",
      CustomerImportSource: "GoogleMaps",
      CustomerImportDate: "1/05/2026",
      CustomerCreatedBy: "",
      CustomerCreatedByType: "",
      CustomerCreateDate: "",
      OrderCount: "0"
    }),
    row({
      call_id: "source-manual-old-new",
      call_date: "1/07/2026",
      CustomerImportSource: "",
      CustomerImportDate: "",
      CustomerCreatedBy: "leadgen2",
      CustomerCreatedByType: "LG",
      CustomerCreateDate: "1/01/2026",
      OrderCount: "0"
    })
  ]));

  assert.equal(analysis.sourceQuality.totals.callsWithImportDate, 3);
  assert.equal(analysis.sourceQuality.totals.callsWithRecordAge, 4);
  assert.equal(analysis.sourceQuality.totals.callsWithManualCreator, 3);
  assert.equal(analysis.sourceQuality.totals.leadGeneratorCreatedCalls, 2);
  assert.equal(analysis.sourceQuality.totals.salespersonCreatedCalls, 1);
  assert.equal(analysis.sourceQuality.newBusinessImportAgeThresholds.find((item) => item.thresholdDays === 30).calls, 2);
  assert.equal(analysis.sourceQuality.newBusinessImportAgeThresholds.find((item) => item.thresholdDays === 90).calls, 1);
  assert.equal(analysis.sourceQuality.newBusinessRecordAgeThresholds.find((item) => item.thresholdDays === 30).calls, 3);
  assert.equal(analysis.sourceQuality.newBusinessRecordAgeThresholds.find((item) => item.thresholdDays === 90).calls, 2);

  const google = analysis.sourceQuality.sourceRows.find((item) => item.name === "GoogleMaps");
  assert.equal(google.calls, 2);
  assert.equal(google.newBusinessCalls, 2);
  assert.equal(google.newBusinessImportedOlderThan90, 1);
  assert.equal(google.newBusinessRecordOlderThan90, 1);

  const lg = analysis.sourceQuality.createdByTypeRows.find((item) => item.createdByType === "LG");
  assert.equal(lg.calls, 2);
  assert.equal(lg.createdByTypeLabel, "Lead Generator");

  const oldNew = analysis.drilldownRows.find((item) => item.callId === "source-old-new");
  assert.equal(oldNew.businessSegment, "new");
  assert.equal(oldNew.daysSinceImport, 181);
  assert.equal(oldNew.daysSinceRecord, 181);
  assert.equal(oldNew.recordAgeBasisLabel, "Imported");
  assert.equal(oldNew.customerCreatedByType, "LG");
  assert.equal(oldNew.customerImportDateIso, "2026-01-01");

  const manualOldNew = analysis.drilldownRows.find((item) => item.callId === "source-manual-old-new");
  assert.equal(manualOldNew.daysSinceImport, null);
  assert.equal(manualOldNew.daysSinceCreated, 181);
  assert.equal(manualOldNew.daysSinceRecord, 181);
  assert.equal(manualOldNew.recordAgeBasisLabel, "Created by LG");
  assert.equal(manualOldNew.recordAgeBucket, "181-365 days");
});

test("missing source and region values are categorized with business rules", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "missing-source-lg",
      customer_id: "customer-lg",
      CustomerImportSource: "",
      CustomerCreatedByType: "LG",
      CallRegion: "NULL"
    }),
    row({
      call_id: "missing-source-sp",
      customer_id: "customer-sp",
      CustomerImportSource: "",
      CustomerCreatedByType: "SP",
      CallRegion: "NULL"
    }),
    row({
      call_id: "missing-source-no-customer",
      customer_id: "",
      ContactId: "contact-self",
      CustomerImportSource: "",
      CustomerCreatedByType: "LG",
      CallRegion: "NZ"
    })
  ]));

  const facebook = analysis.sourceMetrics.find((item) => item.name === "Facebook");
  const selfSourced = analysis.sourceMetrics.find((item) => item.name === "Self Sourced");
  assert.equal(facebook.calls, 1);
  assert.equal(selfSourced.calls, 2);

  const lgRow = analysis.drilldownRows.find((item) => item.callId === "missing-source-lg");
  const spRow = analysis.drilldownRows.find((item) => item.callId === "missing-source-sp");
  const missingCustomerRow = analysis.drilldownRows.find((item) => item.callId === "missing-source-no-customer");
  assert.equal(lgRow.source, "Facebook");
  assert.equal(lgRow.customerImportSourceInferred, true);
  assert.equal(lgRow.region, "Australia");
  assert.equal(spRow.source, "Self Sourced");
  assert.equal(spRow.region, "Australia");
  assert.equal(missingCustomerRow.source, "Self Sourced");
  assert.equal(missingCustomerRow.contactId, "contact-self");
  assert.equal(missingCustomerRow.region, "NZ");

  const australia = analysis.leadReattempt.regionRows.find((item) => item.region === "Australia");
  assert.equal(australia.leadsTouched, 2);
  assert.equal(analysis.leadReattempt.sourceRows.some((item) => item.source === "Unknown source"), false);
  assert.equal(analysis.leadReattempt.regionRows.some((item) => item.region === "Unknown region"), false);
});

test("blank transcript NoSaleType and OrderCount use business-safe labels", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "blank-transcript",
      transcription_text: "",
      call_duration_seconds: "30",
      CallTotalSeconds: "35",
      NoSaleType: "",
      OrderCount: ""
    })
  ]));

  const proof = analysis.drilldownRows[0];
  assert.equal(proof.contactClassification, "no_answer");
  assert.equal(proof.localOutcome, "no_answer");
  assert.equal(proof.importedNoSale, "Unprocessed By Salesperson");
  assert.equal(proof.importedNoSaleRaw, "");
  assert.equal(proof.importedNoSaleReliability, "low_manual_process");
  assert.equal(proof.importedNoSalePriority, "secondary_to_local_ai");
  assert.equal(proof.orderHistoryLabel, "No Sales History");
  assert.equal(proof.businessSegment, "new");
});

test("local evaluator flags Did Not Answer mismatch when transcript has live follow-up evidence", () => {
  const evaluation = evaluateCall({
    call_id: "10",
    CallTotalSeconds: "63",
    call_duration_seconds: "60",
    NoSaleType: "Did Not Answer",
    transcription_text: "Outbound call Customer: Hello, yes please call me back tomorrow after three and send through the details. Agent: I will do that."
  });

  assert.equal(evaluation.contact.probableLiveHuman, true);
  assert.equal(evaluation.opportunity.followUpRequired, true);
  assert.equal(evaluation.outcome.localCategory, "callback_requested");
  assert.equal(evaluation.outcome.mismatch, true);

  const followUpEvidence = evaluation.evidence.find((item) => item.signal === "follow_up");
  assert.equal(followUpEvidence.summary, "Callback requested or promised");
  assert.match(followUpEvidence.text, /^Customer: Hello/);
  assert.deepEqual(followUpEvidence.turns.map((turn) => turn.speaker), ["Customer", "Agent"]);
});

test("local evaluator does not treat sales script later-this-year wording as a callback request", () => {
  const evaluation = evaluateCall({
    call_id: "11",
    CallTotalSeconds: "63",
    call_duration_seconds: "60",
    NoSaleType: "NULL",
    transcription_text: "Outbound call Customer: Hello. Riley Example (CWA): The reason we are calling later this year is the official journal for the local area."
  });

  assert.equal(evaluation.opportunity.requestedCallback, false);
  assert.equal(evaluation.opportunity.followUpRequired, false);
});

test("local evaluator normalizes human-like Voicemail speaker turns to Customer", () => {
  const transcript = [
    "Outbound call Lior Carter (CWA): How they support our community. Can our volunteers count on your support?",
    "Voicemail: Thank you. Thank you.",
    "Lior Carter (CWA): Would that be okay? Oh yeah. Well, how long is this break for?",
    "Voicemail: Like I said, we are taking a short break, so I'm not advertising my business for now because we don't have capacity at the moment to take on more customers.",
    "Lior Carter (CWA): No, of course I'm happy to stay in touch, mate, absolutely. When do you reckon the business will be up and going again?",
    "Voicemail: So, maybe I'll just save your number and call you when I'm ready. I have just taken a pause from that venture.",
    "Lior Carter (CWA): No stress then, mate. We'll leave you out of this journal this year. See ya.",
    "Voicemail: Sure I will. Thank you. Bye."
  ].join(" ");

  const turns = parseTranscriptTurns(transcript);
  const evaluation = evaluateCall({
    call_id: "human-voicemail-label",
    CallTotalSeconds: "160",
    call_duration_seconds: "150",
    NoSaleType: "NULL",
    transcription_text: transcript
  });

  assert.equal(turns.some((turn) => turn.speaker === "Voicemail"), false);
  assert.equal(turns.filter((turn) => turn.speaker === "Customer").length, 4);
  assert.equal(evaluation.transcript.humanLikeVoicemailDialogue, true);
  assert.equal(evaluation.contact.probableLiveHuman, true);
  assert.equal(evaluation.contact.classification, "customer");
  assert.equal(evaluation.contact.meaningfulConversation, true);
  assert.notEqual(evaluation.outcome.localCategory, "voicemail");
});

test("local evaluator keeps true machine voicemail as voicemail", () => {
  const transcript = "Outbound call Voicemail: You have reached the office. Please leave a message after the tone.";
  const turns = parseTranscriptTurns(transcript);
  const evaluation = evaluateCall({
    call_id: "machine-voicemail",
    CallTotalSeconds: "18",
    call_duration_seconds: "15",
    NoSaleType: "NULL",
    transcription_text: transcript
  });

  assert.equal(turns[0].speaker, "Voicemail");
  assert.equal(evaluation.transcript.humanLikeVoicemailDialogue, false);
  assert.equal(evaluation.contact.probableLiveHuman, false);
  assert.equal(evaluation.contact.classification, "voicemail");
});

test("local evaluator separates AI call assistants from normal voicemail and scores salesperson response", () => {
  const bailEvaluation = evaluateCall({
    call_id: "ai-bail",
    CallTotalSeconds: "33",
    call_duration_seconds: "30",
    NoSaleType: "NULL",
    transcription_text: "Outbound call Riley Example (CWA): It's Riley. Customer: Hi, I'm a call assistant recording this call for the person you're trying to reach. Please say who you are and why you're calling. The person you're calling is busy now. I'll let them know."
  });
  assert.equal(bailEvaluation.aiVoiceAssistant.detected, true);
  assert.equal(bailEvaluation.aiVoiceAssistant.bailed, true);
  assert.equal(bailEvaluation.aiVoiceAssistant.handledSuccessfully, false);
  assert.equal(bailEvaluation.contact.classification, "system_audio");
  assert.equal(bailEvaluation.evidence.some((item) => item.signal === "ai_voice_assistant"), true);

  const handledEvaluation = evaluateCall({
    call_id: "ai-handled",
    CallTotalSeconds: "70",
    call_duration_seconds: "65",
    NoSaleType: "NULL",
    transcription_text: "Outbound call Customer: Hi, I'm a call assistant recording this call. Please say who you are and why you're calling. Riley Example (CWA): Hi, this is Riley from Countrywide Austral. The reason for my call is the official journal for the local area. Please ask them to call me back on my mobile."
  });
  assert.equal(handledEvaluation.aiVoiceAssistant.detected, true);
  assert.equal(handledEvaluation.aiVoiceAssistant.handledSuccessfully, true);
  assert.equal(handledEvaluation.aiVoiceAssistant.bailed, false);
  assert.equal(handledEvaluation.aiVoiceAssistant.tactics.explained_reason, true);
  assert.equal(handledEvaluation.aiVoiceAssistant.tactics.asked_for_callback, true);
});

test("analysis tracks AI call assistant trend, salesperson bail rate, tactics, and future recovery", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "ai-bail",
      Salesperson: "Bail Seller",
      customer_id: "customer-ai-bail",
      AllocatedLeadID: "lead-ai-bail",
      ContactId: "contact-ai-bail",
      call_time: "09:00:00",
      transcription_text: "Outbound call Bail Seller (CWA): It's Bail. Customer: Hi, I'm a call assistant recording this call for the person you're trying to reach. Please say who you are and why you're calling. The person you're calling is busy now. I'll let them know."
    }),
    row({
      call_id: "ai-handled",
      Salesperson: "Strong Seller",
      customer_id: "customer-ai-handled",
      AllocatedLeadID: "lead-ai-handled",
      ContactId: "contact-ai-handled",
      call_time: "09:30:00",
      transcription_text: "Outbound call Customer: Hi, I'm a call assistant recording this call. Please say who you are and why you're calling. Strong Seller (CWA): Hi, this is Sam from Countrywide Austral. The reason for my call is the official journal for the local area. Please ask them to call me back on my mobile."
    }),
    row({
      call_id: "future-human",
      Salesperson: "Strong Seller",
      customer_id: "customer-ai-handled",
      AllocatedLeadID: "lead-ai-handled",
      ContactId: "contact-ai-handled",
      call_time: "11:00:00",
      transcription_text: "Outbound call Customer: Hi Sam, I got your message and yes, send through the details. Strong Seller (CWA): Thanks, I will email the information now."
    })
  ]));

  assert.equal(analysis.aiVoiceAssistant.totals.encounters, 2);
  assert.equal(analysis.aiVoiceAssistant.totals.bailed, 1);
  assert.equal(analysis.aiVoiceAssistant.totals.handledSuccessfully, 1);
  assert.equal(analysis.aiVoiceAssistant.totals.futureHumanContact, 1);
  assert.equal(analysis.aiVoiceAssistant.trendRows[0].encounters, 2);

  const bailSeller = analysis.aiVoiceAssistant.salespersonRows.find((item) => item.salesperson === "Bail Seller");
  const strongSeller = analysis.aiVoiceAssistant.salespersonRows.find((item) => item.salesperson === "Strong Seller");
  assert.equal(bailSeller.bailRate, 100);
  assert.equal(strongSeller.handledRate, 100);
  assert.equal(strongSeller.futureHumanContactRate, 100);

  const reasonTactic = analysis.aiVoiceAssistant.tacticRows.find((item) => item.key === "explained_reason");
  assert.equal(reasonTactic.encounters, 1);
  assert.equal(reasonTactic.handledRate, 100);

  const handledRow = analysis.drilldownRows.find((item) => item.callId === "ai-handled");
  assert.equal(handledRow.aiVoiceAssistantDetected, true);
  assert.equal(handledRow.aiVoiceAssistantHandledSuccessfully, true);
  assert.equal(handledRow.aiVoiceAssistantFutureCallId, "future-human");
  assert.ok(handledRow.metricKeys.includes("calls.aiVoiceAssistantFutureHuman"));

  const intelligence = buildCallIntelligence(handledRow);
  assert.equal(intelligence.events.some((event) => event.eventType === "ai_call_assistant_encountered"), true);
  assert.equal(intelligence.events.some((event) => event.eventType === "ai_assistant_handled_well"), true);
});

test("analysis tracks system audio subtypes and later human recovery", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "screening",
      call_time: "09:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Voicemail: Hi, if you record your name and reason for calling, I'll see if this person is available. Please stay on the line. Screen Seller (CWA): This is Sam from Countrywide Austral calling about the official journal. Please call me back."
    }),
    row({
      call_id: "screening-future",
      call_time: "10:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Hi Sam, I got your message. Yes, send through the details. Screen Seller (CWA): Thanks, I will email it now."
    }),
    row({
      call_id: "carrier",
      call_time: "11:00:00",
      customer_id: "customer-carrier",
      AllocatedLeadID: "lead-carrier",
      Salesperson: "Carrier Seller",
      CustomerImportSource: "Facebook",
      transcription_text: "Outbound call Customer: The number is busy."
    }),
    row({
      call_id: "machine-voicemail-audit",
      call_time: "12:00:00",
      customer_id: "customer-voicemail",
      AllocatedLeadID: "lead-voicemail",
      Salesperson: "Voice Seller",
      CustomerImportSource: "Self Sourced",
      transcription_text: "Outbound call Voicemail: You have reached the office. Please leave a message after the tone."
    })
  ]));

  assert.equal(analysis.systemAudio.totals.encounters, 3);
  assert.equal(analysis.systemAudio.totals.callScreening, 1);
  assert.equal(analysis.systemAudio.totals.carrierPhoneSystem, 1);
  assert.equal(analysis.systemAudio.totals.machineVoicemail, 1);
  assert.equal(analysis.systemAudio.totals.futureHumanContact, 1);

  const screening = analysis.systemAudio.records.find((item) => item.callId === "screening");
  const carrier = analysis.systemAudio.records.find((item) => item.callId === "carrier");
  const voicemail = analysis.systemAudio.records.find((item) => item.callId === "machine-voicemail-audit");
  assert.equal(screening.subtype, "call_screening");
  assert.equal(screening.handledSuccessfully, true);
  assert.equal(screening.futureCallId, "screening-future");
  assert.equal(carrier.subtype, "carrier_phone_system");
  assert.equal(voicemail.subtype, "machine_voicemail");
  assert.equal(analysis.drilldownRows.find((item) => item.callId === "screening").systemAudioSubtypeLabel, "Call Screening / AI Assistant");
});

test("follow-up completion links through stable IDs, not partial phone", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "1",
      call_time: "09:00:00",
      dialled_phone_number: "4000000",
      customer_id: "customer-a",
      ContactId: "contact-a",
      transcription_text: "Outbound call Customer: Please call me back tomorrow and send me the information. Agent: I will follow up.",
      NoSaleType: "NULL"
    }),
    row({
      call_id: "2",
      call_time: "10:00:00",
      dialled_phone_number: "4000000",
      customer_id: "customer-b",
      ContactId: "contact-b",
      transcription_text: "Outbound call Customer: Wrong number. Agent: Sorry.",
      NoSaleType: "NULL"
    }),
    row({
      call_id: "3",
      call_time: "11:00:00",
      dialled_phone_number: "4999999",
      customer_id: "customer-a",
      ContactId: "contact-a",
      transcription_text: "Outbound call Customer: Thanks for calling back. Agent: Following up as promised.",
      NoSaleType: "NULL"
    })
  ]));

  const followUpCall = analysis.reviewQueue.find((item) => item.callId === "1");
  assert.equal(followUpCall.followUpStatus, "completed");
  const wrongNumberCall = analysis.reviewQueue.find((item) => item.callId === "2");
  assert.equal(wrongNumberCall.followUpStatus, "not_required");
});

test("follow-up remains indeterminate when upload has no future matching ID data", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "1",
      call_time: "09:00:00",
      customer_id: "customer-a",
      ContactId: "contact-a",
      transcription_text: "Outbound call Customer: Please call me back tomorrow and email the details. Agent: I will."
    })
  ]));

  assert.equal(analysis.reviewQueue[0].followUpStatus, "indeterminate_insufficient_future_data");
  assert.equal(analysis.alerts[0].category, "Imported outcome mismatch");
});

test("lead utilization report tracks strict callback leakage and future callback pending status", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "1",
      AllocatedLeadID: "lead-callback-missed",
      customer_id: "customer-callback-missed",
      ContactId: "contact-callback-missed",
      transcription_text: "Outbound call Customer: Please call me back later today. Riley Example (CWA): No worries, I will call you back then."
    }),
    row({
      call_id: "2",
      AllocatedLeadID: "lead-callback-future",
      customer_id: "customer-callback-future",
      ContactId: "contact-callback-future",
      transcription_text: "Outbound call Customer: Please call me back tomorrow. Riley Example (CWA): I will call you back tomorrow."
    }),
    row({
      call_id: "3",
      AllocatedLeadID: "lead-script",
      customer_id: "customer-script",
      ContactId: "contact-script",
      transcription_text: "Outbound call Customer: Hello. Riley Example (CWA): The reason we are calling later this year is the official journal for the local area."
    })
  ]));

  assert.equal(analysis.leadUtilization.totals.callbackRequests, 2);
  assert.equal(analysis.leadUtilization.totals.callbackSameDayRequired, 1);
  assert.equal(analysis.leadUtilization.totals.callbackMissedSameDay, 1);
  assert.equal(analysis.leadUtilization.totals.callbackFutureNeedsUpload, 1);
});

test("lead utilization report counts one-attempt no-contact lead-days", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "1",
      AllocatedLeadID: "lead-no-contact",
      customer_id: "customer-no-contact",
      ContactId: "contact-no-contact",
      call_duration_seconds: "10",
      CallTotalSeconds: "12",
      transcription_text: "Outbound call Voicemail: You have reached the office. Please leave a message."
    }),
    row({
      call_id: "2",
      AllocatedLeadID: "lead-retried",
      customer_id: "customer-retried",
      ContactId: "contact-retried",
      call_duration_seconds: "10",
      CallTotalSeconds: "12",
      transcription_text: "Outbound call Voicemail: Please leave a message."
    }),
    row({
      call_id: "3",
      AllocatedLeadID: "lead-retried",
      customer_id: "customer-retried",
      ContactId: "contact-retried",
      call_time: "11:00:00",
      call_duration_seconds: "8",
      CallTotalSeconds: "10",
      transcription_text: "Outbound call Voicemail: The person is not available."
    })
  ]));

  assert.equal(analysis.leadUtilization.totals.noContactLeadDays, 2);
  assert.equal(analysis.leadUtilization.totals.noContactRetriedSameDay, 1);
  assert.equal(analysis.leadUtilization.totals.singleAttemptNoContact, 1);
});

test("call intelligence does not treat unrelated pay wording as payment intent", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "pay-mortgage",
      transcription_text: "Outbound call Harry Markovski (CWA): The reason for my call is the official journal for the local area. Customer: Preventative medicine, that's a fraud. I don't need the journal and I need to pay my mortgage."
    })
  ]));

  const intelligence = buildCallIntelligence(analysis.drilldownRows[0]);
  assert.equal(intelligence.events.some((event) => event.eventType === "payment_or_order_intent"), false);
  assert.notEqual(intelligence.call.leadUtilizationScore, 5);
  assert.notEqual(intelligence.call.customerSentiment, "interested");
});

test("call intelligence keeps genuine offer payment and order intent", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "send-invoice",
      transcription_text: "Outbound call Riley Example (CWA): The package is for the official journal. Customer: Yes, go ahead with the journal package and send me the invoice."
    })
  ]));

  const intelligence = buildCallIntelligence(analysis.drilldownRows[0]);
  const paymentEvent = intelligence.events.find((event) => event.eventType === "payment_or_order_intent");
  assert.ok(paymentEvent);
  assert.equal(paymentEvent.followUpRequired, 1);
  assert.equal(intelligence.call.leadUtilizationScore, 5);
});
