"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const { loadAnalysis } = require("../src/main");
const {
  dashboardPersistence,
  persistAnalysis,
  readStore,
  saveGeneratedReport,
  saveManagerReview
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
