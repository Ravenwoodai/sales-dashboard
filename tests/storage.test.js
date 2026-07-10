"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const { loadAnalysis } = require("../src/main");
const {
  createEmptyStore,
  dashboardPersistence,
  bulkUpdateAlertLifecycle,
  persistAnalysis,
  readStore,
  saveGeneratedReport,
  saveManagerReview,
  updateManagerReview,
  bulkUpdateManagerReviews,
  updateAlertLifecycle,
  writeStore
} = require("../src/storage");

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

function tempStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-store-")), "state.json");
}

function sampleCsv() {
  const row = {
    dialled_phone_number: "4123456",
    call_id: "48500001",
    UserID: "16435",
    Mobile: "1",
    CallTotalSeconds: "62",
    call_date: "1/07/2026",
    call_time: "09:00:00",
    ring_time_seconds: "2",
    call_duration_seconds: "60",
    AllocatedLeadID: "lead-1",
    customer_id: "customer-1",
    ContactId: "contact-1",
    Baz_DetailedNotes: "Customer asked for info",
    transcription_text: "Outbound call Customer: Please email the information and call me back tomorrow. Agent: I will follow up.",
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
  return `${header.join(",")}\n${header.map((field) => row[field]).join(",")}\n`;
}

function csvRows(rows) {
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

test("persistAnalysis stores import history, evaluation artifact, and automatic report", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(sampleCsv(), { sourceName: "sample.csv" });
  const result = persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  const store = readStore({ storePath });

  assert.equal(store.imports.length, 1);
  assert.equal(store.reports.length, 2);
  assert.equal(store.imports[0].id, result.importRecord.id);
  assert.equal(store.imports[0].evaluationRowCount, 1);
  assert.ok(store.reports.some((report) => report.type === "executive_summary"));
  assert.ok(store.reports.some((report) => report.type === "lead_utilization_report"));

  const artifactPath = path.join(path.dirname(storePath), store.imports[0].artifactPath);
  assert.equal(fs.existsSync(artifactPath), true);
  const artifactText = fs.readFileSync(artifactPath, "utf8");
  assert.equal(artifactText.includes("4123456"), false);
  assert.equal(artifactText.includes("Intentionally incomplete for security"), true);
});

test("persistAnalysis stores parked allocation metadata without active allocation summaries", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(sampleCsv(), {
    sourceName: "sample.csv",
    allocationRows: [{
      "LEAD CAMPAIGN": "Fresh Leads",
      "QTY ALLOCATED": "10",
      "QTY ACTIONED": "3",
      "QTY REMAINING": "7",
      DATE: "Jul 1, 2026",
      "SALES MANAGER": "Manager One",
      SALESPERSON: "Riley Example",
      TYPE: "New Business"
    }],
    allocationMetadata: { sourceName: "allocations.xlsx", sheetName: "Sheet3" }
  });
  persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  const store = readStore({ storePath });
  const artifactPath = path.join(path.dirname(storePath), store.imports[0].artifactPath);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const executiveReport = store.reports.find((report) => report.type === "executive_summary");

  assert.equal(store.imports[0].parkedAllocation.status, "parked");
  assert.equal(store.imports[0].parkedAllocation.activeMetricsAvailable, false);
  assert.equal("allocationCoverage" in store.imports[0], false);
  assert.equal(artifact.parkedAllocation.status, "parked");
  assert.equal("allocationCoverage" in artifact, false);
  assert.doesNotMatch(JSON.stringify(artifact), /QTY ACTIONED|Leads allocated|reconciliationRows|campaignRows/);
  assert.doesNotMatch(executiveReport.content, /QTY ACTIONED|Leads allocated|Leads remaining|allocation coverage|stable lead-days/i);
});

test("saveGeneratedReport makes reports visible to dashboard persistence", () => {
  const storePath = tempStorePath();
  const saved = saveGeneratedReport({
    title: "Callback Leakage Review",
    type: "manager_report",
    summary: "Follow-up signals need attention.",
    content: "# Callback Leakage Review\n\nReview the follow-up queue."
  }, { storePath });
  const persistence = dashboardPersistence(saved.store);

  assert.equal(persistence.counts.reports, 1);
  assert.equal(persistence.reports[0].title, "Callback Leakage Review");
  assert.equal(persistence.reports[0].source, "codex");
});

test("dashboardPersistence excludes parked allocation reports and alert events from active counts", () => {
  const store = {
    ...createEmptyStore(),
    alertEvents: [
      { id: "active", importId: "import-test", status: "new", parkedDataRelated: false },
      { id: "closed", importId: "import-test", status: "resolved", parkedDataRelated: false },
      { id: "parked", importId: "import-test", status: "new", parkedDataRelated: true }
    ],
    reports: [
      {
        id: "active-report",
        title: "Callback Review",
        summary: "Call-data follow-up review.",
        content: "# Callback Review",
        updatedAt: "2026-07-02T00:00:00.000Z"
      },
      {
        id: "parked-report",
        title: "Lead Allocation Coverage",
        summary: "Leads allocated and leads remaining.",
        content: "# Lead Allocation Coverage",
        updatedAt: "2026-07-03T00:00:00.000Z"
      },
      {
        id: "stale-target-report",
        title: "Average Calls Per Stable Target By Salesperson",
        summary: "Stable target reporting has been superseded.",
        content: "# Average Calls Per Stable Target By Salesperson",
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      {
        id: "stale-lead-day-report",
        title: "Lead Utilization Snapshot",
        summary: "Potential wasted lead-day indicators.",
        content: "# Lead Utilization Snapshot\n\nstable lead-days reviewed.",
        updatedAt: "2026-07-05T00:00:00.000Z"
      },
      {
        id: "raw-allocated-lead-id-report",
        title: "Raw Field Context",
        summary: "AllocatedLeadID is preserved as a raw call CSV matching field.",
        content: "# Raw Field Context\n\nAllocatedLeadID is a canonical call field for entity matching only.",
        updatedAt: "2026-07-06T00:00:00.000Z"
      }
    ]
  };
  const persistence = dashboardPersistence(store, "import-test");

  assert.equal(persistence.counts.currentAlertEvents, 1);
  assert.equal(persistence.counts.alertEvents, 1);
  assert.equal(persistence.counts.currentTotalAlertEvents, 2);
  assert.equal(persistence.counts.currentClosedAlertEvents, 1);
  assert.equal(persistence.counts.resolvedAlerts, 1);
  assert.equal(persistence.counts.parkedAlertEvents, 1);
  assert.equal(persistence.counts.reports, 2);
  assert.equal(persistence.counts.hiddenParkedReports, 3);
  assert.deepEqual(persistence.reports.map((report) => report.id), ["raw-allocated-lead-id-report", "active-report"]);
});

test("alert lifecycle actions save status, actors, notes, and active-count changes", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(sampleCsv(), { sourceName: "sample.csv" });
  const persisted = persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  let store = readStore({ storePath });
  const alertId = store.alertEvents[0].id;
  const initialActiveAlerts = store.alertEvents.filter((event) => !event.parkedDataRelated).length;

  const acknowledged = updateAlertLifecycle(alertId, {
    action: "acknowledge",
    actor: "manager-a",
    note: "Seen by manager.",
    importId: persisted.importRecord.id,
    now: "2026-07-08T01:00:00.000Z"
  }, { storePath });
  assert.equal(acknowledged.alertEvent.status, "acknowledged");
  assert.equal(acknowledged.alertEvent.acknowledgedBy, "local_manager");
  assert.equal(acknowledged.alertEvent.lifecycleHistory[0].actor, "local_manager");
  assert.match(acknowledged.alertEvent.managerNotes, /Seen by manager/);
  assert.equal(acknowledged.alertEvent.lifecycleHistory.length, 1);
  assert.equal(dashboardPersistence(acknowledged.store, persisted.importRecord.id).counts.currentAlertEvents, initialActiveAlerts);
  assert.equal(dashboardPersistence(acknowledged.store, persisted.importRecord.id).counts.acknowledgedAlerts, 1);

  const inProgress = updateAlertLifecycle(alertId, {
    action: "in_progress",
    actor: "manager-b",
    importId: persisted.importRecord.id,
    now: "2026-07-08T01:05:00.000Z"
  }, { storePath });
  assert.equal(inProgress.alertEvent.status, "in_progress");
  assert.equal(inProgress.alertEvent.inProgressBy, "local_manager");
  assert.equal(dashboardPersistence(inProgress.store, persisted.importRecord.id).counts.currentAlertEvents, initialActiveAlerts);
  assert.equal(dashboardPersistence(inProgress.store, persisted.importRecord.id).counts.inProgressAlerts, 1);

  const resolved = updateAlertLifecycle(alertId, {
    action: "resolve",
    actor: "manager-c",
    note: "Handled outside the CSV.",
    importId: persisted.importRecord.id,
    now: "2026-07-08T01:10:00.000Z"
  }, { storePath });
  const resolvedPersistence = dashboardPersistence(resolved.store, persisted.importRecord.id);
  assert.equal(resolved.alertEvent.status, "resolved");
  assert.equal(resolved.alertEvent.resolvedBy, "local_manager");
  assert.equal(resolvedPersistence.counts.currentAlertEvents, initialActiveAlerts - 1);
  assert.equal(resolvedPersistence.counts.currentClosedAlertEvents, 1);

  const reopened = updateAlertLifecycle(alertId, {
    action: "reopen",
    actor: "manager-d",
    note: "Needs another look.",
    importId: persisted.importRecord.id,
    now: "2026-07-08T01:15:00.000Z"
  }, { storePath });
  assert.equal(reopened.alertEvent.status, "new");
  assert.equal(dashboardPersistence(reopened.store, persisted.importRecord.id).counts.currentAlertEvents, initialActiveAlerts);
  assert.equal(reopened.alertEvent.lifecycleHistory.length, 4);

  const falsePositive = updateAlertLifecycle(alertId, {
    action: "false_positive",
    actor: "manager-e",
    note: "Rule was too broad.",
    importId: persisted.importRecord.id,
    now: "2026-07-08T01:20:00.000Z"
  }, { storePath });
  assert.equal(falsePositive.alertEvent.status, "false_positive");
  assert.equal(falsePositive.alertEvent.falsePositiveBy, "local_manager");
  assert.equal(dashboardPersistence(falsePositive.store, persisted.importRecord.id).counts.currentAlertEvents, initialActiveAlerts - 1);

  assert.throws(() => updateAlertLifecycle(alertId, {
    action: "not_a_status",
    importId: persisted.importRecord.id
  }, { storePath }), /Invalid alert lifecycle action/);
});

test("bulk alert lifecycle updates only selected active alerts", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csvRows([
    sampleCsv().trim().split(/\r?\n/)[1],
    header.map((field) => ({
      ...Object.fromEntries(header.map((key) => [key, ""])),
      call_id: "risk-2",
      call_date: "1/07/2026",
      call_time: "10:00:00",
      Salesperson: "Casey Example",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested",
      CallTotalSeconds: "42",
      ring_time_seconds: "2",
      call_duration_seconds: "40"
    })[field]).join(",")
  ]), { sourceName: "sample.csv" });
  const persisted = persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  let store = readStore({ storePath });
  const ids = store.alertEvents.map((event) => event.id);
  assert.ok(ids.length >= 2);

  const result = bulkUpdateAlertLifecycle([ids[0]], {
    action: "dismiss",
    actor: "manager-a",
    note: "Not actionable.",
    importId: persisted.importRecord.id,
    now: "2026-07-08T02:00:00.000Z"
  }, { storePath });
  assert.deepEqual(result.alertEvents.map((event) => event.id), [ids[0]]);

  store = readStore({ storePath });
  const selected = store.alertEvents.find((event) => event.id === ids[0]);
  const unselected = store.alertEvents.find((event) => event.id === ids[1]);
  assert.equal(selected.status, "dismissed");
  assert.equal(selected.dismissedBy, "local_manager");
  assert.equal(unselected.status, "new");
  const persistence = dashboardPersistence(store, persisted.importRecord.id);
  assert.equal(persistence.counts.dismissedAlerts, 1);
  assert.equal(persistence.counts.currentAlertEvents, ids.length - 1);
});

test("bulk alert lifecycle supports selected acknowledge resolve and false-positive actions with local actor", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csvRows([
    sampleCsv().trim().split(/\r?\n/)[1],
    header.map((field) => ({
      ...Object.fromEntries(header.map((key) => [key, ""])),
      call_id: "risk-2",
      call_date: "1/07/2026",
      call_time: "10:00:00",
      Salesperson: "Casey Example",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested",
      CallTotalSeconds: "42",
      ring_time_seconds: "2",
      call_duration_seconds: "40"
    })[field]).join(",")
  ]), { sourceName: "sample.csv" });
  const persisted = persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  let store = readStore({ storePath });
  const ids = store.alertEvents.map((event) => event.id);
  assert.ok(ids.length >= 2);

  bulkUpdateAlertLifecycle([ids[0]], {
    action: "acknowledge",
    actor: "spoofed-manager",
    importId: persisted.importRecord.id,
    now: "2026-07-08T03:00:00.000Z"
  }, { storePath });
  store = readStore({ storePath });
  assert.equal(store.alertEvents.find((event) => event.id === ids[0]).status, "acknowledged");
  assert.equal(store.alertEvents.find((event) => event.id === ids[0]).acknowledgedBy, "local_manager");
  assert.equal(store.alertEvents.find((event) => event.id === ids[1]).status, "new");

  bulkUpdateAlertLifecycle([ids[1]], {
    action: "resolve",
    actor: "spoofed-manager",
    importId: persisted.importRecord.id,
    now: "2026-07-08T03:05:00.000Z"
  }, { storePath });
  store = readStore({ storePath });
  assert.equal(store.alertEvents.find((event) => event.id === ids[1]).status, "resolved");
  assert.equal(store.alertEvents.find((event) => event.id === ids[1]).resolvedBy, "local_manager");
  assert.equal(store.alertEvents.find((event) => event.id === ids[0]).status, "acknowledged");

  bulkUpdateAlertLifecycle([ids[0]], {
    action: "false_positive",
    actor: "spoofed-manager",
    importId: persisted.importRecord.id,
    now: "2026-07-08T03:10:00.000Z"
  }, { storePath });
  store = readStore({ storePath });
  assert.equal(store.alertEvents.find((event) => event.id === ids[0]).status, "false_positive");
  assert.equal(store.alertEvents.find((event) => event.id === ids[0]).falsePositiveBy, "local_manager");
  assert.equal(dashboardPersistence(store, persisted.importRecord.id).counts.currentAlertEvents, ids.length - 2);
});

test("parked alerts reject lifecycle mutation", () => {
  const storePath = tempStorePath();
  writeStore({
    ...createEmptyStore(),
    alertEvents: [
      {
        id: "parked-alert",
        alertId: "parked-alert",
        importId: "import-test",
        status: "new",
        parkedDataRelated: true
      }
    ]
  }, { storePath });

  assert.throws(() => updateAlertLifecycle("parked-alert", {
    action: "acknowledge",
    actor: "spoofed-manager",
    importId: "import-test"
  }, { storePath }), /Parked alerts are excluded/);
});

test("saveManagerReview persists review state by call ID", () => {
  const storePath = tempStorePath();
  const saved = saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    status: "confirmed",
    confirmedOutcome: "callback_requested",
    confirmedFollowUpRequired: true,
    notes: "Manager confirmed follow-up."
  }, { storePath });
  const persistence = dashboardPersistence(saved.store, "import-test");

  assert.equal(saved.review.callId, "48500001");
  assert.equal(persistence.counts.currentManagerReviews, 1);
});

test("manager review corrections are auditable and do not overwrite raw or derived outputs", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(sampleCsv(), { sourceName: "sample.csv" });
  const persisted = persistAnalysis(analysis, { csvPath: "C:/private/sample.csv", storePath });
  const saved = saveManagerReview({
    importId: persisted.importRecord.id,
    callId: "48500001",
    actor: "spoofed-manager",
    action: "correct",
    reviewScope: "outcome",
    fieldName: "local_outcome_category",
    rawValue: "NULL",
    deterministicValue: "callback_requested",
    previousDisplayValue: "callback_requested",
    managerCorrectedValue: "information_requested",
    correctionReason: "Transcript asks for information only.",
    evidenceAssessment: "evidence_accepted",
    note: "<script>alert(1)</script>",
    now: "2026-07-08T04:00:00.000Z"
  }, { storePath });

  assert.equal(saved.review.reviewStatus, "reviewed_corrected");
  assert.equal(saved.review.reviewedBy, "local_manager");
  assert.equal(saved.review.corrections.length, 1);
  assert.equal(saved.review.corrections[0].fieldName, "local_outcome_category");
  assert.equal(saved.review.corrections[0].previousDisplayValue, "callback_requested");
  assert.equal(saved.review.corrections[0].managerCorrectedValue, "information_requested");
  assert.equal(saved.review.reviewHistory[0].actor, "local_manager");
  assert.match(saved.review.managerNotes, /<script>alert\(1\)<\/script>/);

  const artifact = JSON.parse(fs.readFileSync(path.join(path.dirname(storePath), persisted.importRecord.artifactPath), "utf8"));
  const evaluation = artifact.evaluationRows.find((row) => row.callId === "48500001");
  assert.equal(evaluation.localOutcome, "callback_requested");
  assert.equal(evaluation.importedNoSaleRaw, "");
  assert.equal(saved.review.corrections[0].rawValue, "NULL");

  const persistence = dashboardPersistence(saved.store, persisted.importRecord.id);
  assert.equal(persistence.counts.currentManagerCorrectedCalls, 1);
  assert.equal(persistence.managerReviewSummaries[0].latestCorrection.managerCorrectedValue, "information_requested");
});

test("manager review suggested corrections persist separately from confirmed corrections", () => {
  const storePath = tempStorePath();
  const saved = saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    action: "mark_review_needed",
    source: "evaluation_studio",
    suggestedCorrections: [
      {
        fieldName: "follow_up_required",
        previousDisplayValue: "indeterminate",
        managerSuggestedValue: "true",
        evidence: "Customer: please call me tomorrow.",
        confidence: 0.82,
        sourceResultId: "eval-result-1"
      }
    ]
  }, { storePath });

  assert.equal(saved.review.reviewStatus, "review_needed");
  assert.equal(saved.review.corrections.length, 0);
  assert.equal(saved.review.suggestedCorrections.length, 1);
  assert.equal(saved.review.suggestedCorrections[0].fieldName, "follow_up_required");
  assert.equal(saved.review.suggestedCorrections[0].managerSuggestedValue, "true");

  const persistence = dashboardPersistence(saved.store, "import-test");
  assert.equal(persistence.managerReviewSummaries[0].correctionCount, 0);
  assert.equal(persistence.managerReviewSummaries[0].suggestedCorrectionCount, 1);
  assert.equal(persistence.managerReviewSummaries[0].latestSuggestedCorrection.fieldName, "follow_up_required");

  assert.throws(() => saveManagerReview({
    importId: "import-test",
    callId: "48500002",
    action: "mark_review_needed",
    suggestedCorrections: [{ fieldName: "campaign_allocation", managerSuggestedValue: "bad" }]
  }, { storePath }), /Invalid or protected manager correction field/);
});

test("manager review validation rejects invalid statuses scopes protected fields and allocation fields", () => {
  const storePath = tempStorePath();
  assert.throws(() => saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    status: "not_a_real_status"
  }, { storePath }), /Invalid manager review status/);

  assert.throws(() => saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    reviewScope: "allocation"
  }, { storePath }), /Invalid manager review scope/);

  assert.throws(() => saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    action: "correct",
    fieldName: "raw_NoSaleType",
    managerCorrectedValue: "Do Not Call"
  }, { storePath }), /Invalid or protected manager correction field/);

  assert.throws(() => saveManagerReview({
    importId: "import-test",
    callId: "48500001",
    action: "correct",
    fieldName: "campaign_allocation",
    managerCorrectedValue: "Fresh Leads"
  }, { storePath }), /Invalid or protected manager correction field/);
});

test("manager review status transitions and bulk updates are selected-only", () => {
  const storePath = tempStorePath();
  const first = saveManagerReview({
    importId: "import-test",
    callId: "call-1",
    action: "mark_review_needed",
    now: "2026-07-08T04:00:00.000Z"
  }, { storePath }).review;
  const second = saveManagerReview({
    importId: "import-test",
    callId: "call-2",
    action: "mark_review_needed",
    now: "2026-07-08T04:01:00.000Z"
  }, { storePath }).review;

  const inReview = updateManagerReview(first.reviewId, {
    importId: "import-test",
    action: "start_review",
    actor: "spoofed",
    now: "2026-07-08T04:02:00.000Z"
  }, { storePath }).review;
  assert.equal(inReview.reviewStatus, "in_review");
  assert.equal(inReview.reviewedBy, "local_manager");

  const confirmed = updateManagerReview(first.reviewId, {
    importId: "import-test",
    action: "confirm",
    now: "2026-07-08T04:03:00.000Z"
  }, { storePath }).review;
  assert.equal(confirmed.reviewStatus, "reviewed_confirmed");
  assert.equal(confirmed.reviewHistory.length, 3);

  const bulk = bulkUpdateManagerReviews([second.reviewId], {
    importId: "import-test",
    action: "dismiss",
    actor: "spoofed-bulk",
    note: "Selected only.",
    now: "2026-07-08T04:04:00.000Z"
  }, { storePath });
  assert.deepEqual(bulk.reviews.map((review) => review.reviewId), [second.reviewId]);
  assert.equal(bulk.reviews[0].reviewStatus, "dismissed");
  assert.equal(bulk.reviews[0].reviewedBy, "local_manager");

  const store = readStore({ storePath });
  assert.equal(store.managerReviews.find((review) => review.reviewId === first.reviewId).reviewStatus, "reviewed_confirmed");
  assert.equal(store.managerReviews.find((review) => review.reviewId === second.reviewId).reviewStatus, "dismissed");
});

test("loadAnalysis persists a configured CSV into the selected store", () => {
  const storePath = tempStorePath();
  const csvPath = path.join(path.dirname(storePath), "sample.csv");
  fs.writeFileSync(csvPath, sampleCsv(), "utf8");

  const state = loadAnalysis(csvPath, { storePath });

  assert.equal(state.error, null);
  assert.equal(state.analysis.persistence.counts.imports, 1);
  assert.equal(state.analysis.persistence.counts.reports, 2);
  assert.ok(state.importRecord.id.startsWith("import_"));
});
