"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const {
  buildAllocationOwnershipEvidence,
  buildFollowUpReports,
  buildIndividualFollowUpReport,
  individualReportRecord,
  overviewReportRecord
} = require("../src/followUpReports");
const { createServer } = require("../src/main");
const { evaluateCall } = require("../src/transcriptEvaluator");
const { buildCallIntelligence } = require("../src/transcriptIntelligence");
const { rowsToCsv } = require("../src/sourceFile");

const BASE_ROW = {
  dialled_phone_number: "4999999",
  UserID: "10",
  Mobile: "1",
  CallTotalSeconds: "20",
  ring_time_seconds: "2",
  call_duration_seconds: "18",
  CallType: "Click to dial",
  call_direction: "out",
  CustomerCreatedBy: "system",
  CustomerCreatedByType: "LG",
  CustomerImportSource: "GoogleMaps",
  Prefix: "",
  CallerID: "MyMobile",
  IsNZCall: "",
  CallRegion: "NSW",
  FoundContactID: "",
  FoundCustomerID: "",
  OrderCount: "0"
};

function call(id, customerId, salesperson, date, transcript, overrides = {}) {
  return {
    ...BASE_ROW,
    call_id: id,
    call_date: date,
    call_time: overrides.call_time || "09:00:00",
    AllocatedLeadID: `lead-${customerId}`,
    customer_id: customerId,
    ContactId: `contact-${customerId}`,
    transcription_text: transcript,
    Salesperson: salesperson,
    ...overrides
  };
}

const VOICEMAIL = "Outbound call Voicemail: You have reached the office. Please leave a message after the tone.";
const UNKNOWN = "Outbound call Agent: Hello. Customer: Hello, who is calling?";

function fixtureRows() {
  return [
    call("candidate-1", "candidate", "Seller A", "1/07/2026", VOICEMAIL),
    call("retry-1", "retry", "Seller A", "1/07/2026", "[No answer]", { call_time: "10:00:00" }),
    call("retry-2", "retry", "Seller A", "2/07/2026", VOICEMAIL),
    call("cycle-1", "cycle", "Seller A", "1/07/2026", "[No answer]", { call_time: "11:00:00" }),
    call("cycle-2", "cycle", "Seller A", "2/07/2026", VOICEMAIL, { call_time: "11:00:00" }),
    call("cycle-3", "cycle", "Seller A", "3/07/2026", "[No answer]", { call_time: "11:00:00" }),
    call("cycle-4", "cycle", "Seller A", "4/07/2026", VOICEMAIL, { call_time: "11:00:00" }),
    call("terminal-1", "terminal", "Seller A", "1/07/2026", "Outbound call Agent: Hello. Customer: I am not interested. Agent: Understood.", { call_time: "12:00:00" }),
    call("waiting-1", "waiting", "Seller A", "9/07/2026", VOICEMAIL),
    call("other-1", "other", "Seller A", "1/07/2026", VOICEMAIL, { call_time: "13:00:00" }),
    call("other-2", "other", "Seller B", "5/07/2026", UNKNOWN),
    call("ambiguous-1", "ambiguous", "Seller A", "1/07/2026", UNKNOWN, { call_time: "14:00:00" }),
    call("window-end", "window-end", "Seller C", "10/07/2026", UNKNOWN)
  ];
}

function fixtureCsv(rows = fixtureRows()) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return rowsToCsv(columns, rows);
}

function fixtureAnalysis() {
  return analyzeCsvText(fixtureCsv(), {
    sourceName: "follow-up-fixture.csv"
  });
}

test("direct Customer not-interested wording is a restricted literal terminal state", () => {
  const direct = evaluateCall(call(
    "direct",
    "direct",
    "Seller A",
    "1/07/2026",
    "Outbound call Agent: Hello. Customer: I am not interested. Agent: Understood."
  ));
  assert.equal(direct.outcome.localCategory, "not_interested");
  assert.equal(direct.evidence.some((item) => item.signal === "literal_not_interested"), true);
  const analysis = fixtureAnalysis();
  const proof = analysis.drilldownRows.find((row) => row.callId === "terminal-1");
  const intelligence = buildCallIntelligence(proof);
  assert.equal(intelligence.call.overallCallOutcome, "not_interested");
  assert.equal(intelligence.events.some((event) => event.eventType === "not_interested"), true);

  const sellerOnly = evaluateCall(call(
    "seller-only",
    "seller-only",
    "Seller A",
    "1/07/2026",
    "Outbound call Agent: If you are not interested, let me know. Customer: Who is this?"
  ));
  assert.equal(sellerOnly.outcome.localCategory, "unknown");
  assert.equal(sellerOnly.evidence.some((item) => item.signal === "literal_not_interested"), false);
});

test("follow-up overview separates candidates, attempt cycles, terminal states, waiting windows, later callers, and ambiguity", () => {
  const overview = buildFollowUpReports(fixtureAnalysis(), {
    requiredAttempts: 4,
    graceDays: 3,
    generatedAt: "2026-07-11T00:00:00.000Z"
  });
  const seller = overview.salespersonRows.find((row) => row.salesperson === "Seller A");
  assert.ok(seller);
  assert.equal(seller.matchedRecords, 7);
  assert.equal(seller.personallyRetriedRecords, 2);
  assert.equal(seller.oneAttemptRecords, 5);
  assert.equal(seller.twoAttemptRecords, 1);
  assert.equal(seller.fourPlusAttemptRecords, 1);
  assert.equal(seller.evidenceBackedCandidates, 2);
  assert.equal(seller.observedAttemptCycle, 1);
  assert.equal(seller.literalTerminalExclusions, 1);
  assert.equal(seller.waitingObservationWindow, 1);
  assert.equal(seller.laterCallByOtherObserved, 1);
  assert.equal(seller.ambiguousExcluded, 1);

  const candidate = overview.records.find((record) => record.customerId === "candidate" && record.salesperson === "Seller A");
  const retry = overview.records.find((record) => record.customerId === "retry" && record.salesperson === "Seller A");
  const terminal = overview.records.find((record) => record.customerId === "terminal");
  const laterOther = overview.records.find((record) => record.customerId === "other" && record.salesperson === "Seller A");
  assert.equal(candidate.reportStatus, "evidence_backed_follow_up_candidate");
  assert.equal(candidate.nextRequiredAttempt, 2);
  assert.equal(retry.reportStatus, "evidence_backed_follow_up_candidate");
  assert.equal(retry.nextRequiredAttempt, 3);
  assert.equal(terminal.reportStatus, "literal_terminal_exclusion");
  assert.equal(terminal.literalTerminal.state, "not_interested");
  assert.equal(laterOther.reportStatus, "later_call_by_other_observed");
  assert.equal(overview.authority.allocationOwnershipEstablished, false);
  assert.match(overview.authority.statement, /established only per record/i);
});

test("manager-authored dismissal excludes a literal no-contact record without rewriting source evidence", () => {
  const analysis = fixtureAnalysis();
  analysis.drilldownRows = analysis.drilldownRows.map((row) => (
    row.callId === "candidate-1"
      ? {
        ...row,
        managerReviewId: "review-1",
        managerReviewStatus: "reviewed_corrected",
        managerFollowUpDismissed: "true",
        managerReviewNotes: "Customer is already handled through another verified channel."
      }
      : row
  ));
  const overview = buildFollowUpReports(analysis, { requiredAttempts: 4, graceDays: 3 });
  const record = overview.records.find((item) => item.customerId === "candidate");
  assert.equal(record.reportStatus, "manager_terminal_exclusion");
  assert.equal(record.managerExclusion.reviewId, "review-1");
  assert.match(record.managerExclusion.reason, /another verified channel/i);
  assert.equal(record.callProof[0].localOutcome, "voicemail");
});

test("allocation-backed candidates require exact customer, exact full salesperson, and allocation before first call", () => {
  const analysis = fixtureAnalysis();
  const allocationEvidence = buildAllocationOwnershipEvidence([
    {
      CustomerID: "candidate",
      FullName: "Seller A",
      SalesManager: "Manager One",
      DateSentToSalesperson_Date: "2026-06-30",
      DateSentToSalesperson_Time: "08:00:00",
      AllocationName: "Weekly allocation",
      AllocationItemID: "allocation-1"
    },
    {
      CustomerID: "retry",
      FullName: "Seller A Junior",
      SalesManager: "Manager One",
      DateSentToSalesperson_Date: "2026-06-30",
      DateSentToSalesperson_Time: "08:00:00",
      AllocationName: "Wrong person",
      AllocationItemID: "allocation-2"
    },
    {
      CustomerID: "other",
      FullName: "Seller-A",
      SalesManager: "Manager One",
      DateSentToSalesperson_Date: "2026-06-30",
      DateSentToSalesperson_Time: "08:00:00",
      AllocationName: "Punctuation mismatch",
      AllocationItemID: "allocation-punctuation"
    },
    {
      CustomerID: "waiting",
      FullName: "Seller A",
      SalesManager: "Manager One",
      DateSentToSalesperson_Date: "2026-07-10",
      DateSentToSalesperson_Time: "08:00:00",
      AllocationName: "After call",
      AllocationItemID: "allocation-3"
    }
  ]);
  const overview = buildFollowUpReports(analysis, {
    requiredAttempts: 4,
    graceDays: 3,
    allocationEvidence
  });
  const seller = overview.salespersonRows.find((row) => row.salesperson === "Seller A");
  const candidate = overview.records.find((record) => record.customerId === "candidate");
  const retry = overview.records.find((record) => record.customerId === "retry" && record.salesperson === "Seller A");
  const waiting = overview.records.find((record) => record.customerId === "waiting");
  const other = overview.records.find((record) => record.customerId === "other" && record.salesperson === "Seller A");
  assert.equal(candidate.allocationOwnershipEstablished, true);
  assert.equal(candidate.allocationEvidence.allocationItemId, "allocation-1");
  assert.equal(retry.allocationOwnershipEstablished, false);
  assert.equal(waiting.allocationOwnershipEstablished, false);
  assert.equal(other.allocationOwnershipEstablished, false);
  assert.equal(seller.allocationBackedCandidates, 1);
  assert.equal(overview.authority.allocationOwnershipEstablished, true);
});

test("individual report is generated only for the selected exact salesperson and retains call proof links", () => {
  const analysis = fixtureAnalysis();
  const individual = buildIndividualFollowUpReport(analysis, "Seller A", {
    requiredAttempts: 4,
    graceDays: 3,
    generatedAt: "2026-07-11T00:00:00.000Z"
  });
  assert.equal(individual.available, true);
  assert.equal(individual.records.length, 7);
  assert.ok(individual.records.every((record) => record.salesperson === "Seller A"));
  const report = individualReportRecord(individual, analysis);
  assert.match(report.content, /Records needing review for another call/);
  assert.match(report.content, /\[1: 1\/07\/2026\]\(\/calls\/candidate-1\)/);
  assert.match(report.content, /not interested/i);

  const missing = buildIndividualFollowUpReport(analysis, "Missing Seller");
  assert.equal(missing.available, false);
  assert.equal(missing.code, "SALESPERSON_NOT_FOUND");
  assert.equal(individualReportRecord(missing, analysis), null);

  const overviewRecord = overviewReportRecord(buildFollowUpReports(analysis), analysis);
  assert.match(overviewRecord.content, /Salesperson \| Records called/);
  assert.match(overviewRecord.content, /follow-up-individual\?reportSalesperson=Seller(?:%20|\+)A/);
});

test("follow-up overview and individual routes expose the same scoped evidence on demand", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-follow-up-"));
  const csvPath = path.join(tempDir, "calls.csv");
  const storePath = path.join(tempDir, "state.json");
  fs.writeFileSync(csvPath, fixtureCsv(), "utf8");
  const server = createServer({ csvPath, storePath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const overviewResponse = await fetch(`${baseUrl}/api/follow-up-reports/overview?requiredAttempts=4&graceDays=3`);
    const overview = await overviewResponse.json();
    assert.equal(overviewResponse.status, 200);
    assert.equal(overview.salespersonRows.find((row) => row.salesperson === "Seller A").evidenceBackedCandidates, 2);

    const individualResponse = await fetch(`${baseUrl}/api/follow-up-reports/individual?reportSalesperson=Seller%20A&requiredAttempts=4&graceDays=3`);
    const individual = await individualResponse.json();
    assert.equal(individualResponse.status, 200);
    assert.equal(individual.records.length, 7);
    assert.ok(individual.records.every((record) => record.salesperson === "Seller A"));

    const overviewHtml = await fetch(`${baseUrl}/reports/follow-up-overview?requiredAttempts=4&graceDays=3`).then((response) => response.text());
    assert.match(overviewHtml, /Salesperson Reattempt Evidence Overview/);
    assert.match(overviewHtml, /Update report/);
    assert.match(overviewHtml, /What happened to the records/);
    assert.match(overviewHtml, /Needs another call/);
    assert.match(overviewHtml, /not automatic non-compliance or disciplinary findings/i);

    const rangedOverviewHtml = await fetch(`${baseUrl}/reports/follow-up-overview?dateFrom=2026-07-01&dateTo=2026-07-04&requiredAttempts=4&graceDays=3`).then((response) => response.text());
    assert.match(rangedOverviewHtml, /value="2026-07-01"/);
    assert.match(rangedOverviewHtml, /value="2026-07-04"/);
    assert.match(rangedOverviewHtml, /follow-up-individual\?[^"]*dateFrom=2026-07-01[^"]*dateTo=2026-07-04/);

    const individualHtml = await fetch(`${baseUrl}/reports/follow-up-individual?reportSalesperson=Seller%20A&requiredAttempts=4&graceDays=3`).then((response) => response.text());
    assert.match(individualHtml, /Individual Reattempt Evidence/);
    assert.match(individualHtml, /Records needing review for another call/);
    assert.match(individualHtml, /name="dateFrom"/);
    assert.match(individualHtml, /\/calls\/candidate-1/);

    const dashboardHtml = await fetch(`${baseUrl}/?view=follow_up`).then((response) => response.text());
    assert.match(dashboardHtml, /Open defensible overview report/);
    assert.match(dashboardHtml, /follow-up-individual\?[^"]*reportSalesperson=Seller(?:%20|\+)A/);

    const missingResponse = await fetch(`${baseUrl}/api/follow-up-reports/individual?salesperson=Missing`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
