"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv } = require("../src/csvParser");
const { analyzeCsvText } = require("../src/analysis");
const { evaluateCall } = require("../src/transcriptEvaluator");

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

test("analysis ignores redacted phone and invalid customer date fields", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "1", dialled_phone_number: "4000000", customer_id: "customer-1" }),
    row({ call_id: "2", dialled_phone_number: "4000000", customer_id: "customer-2" })
  ]));

  const ignored = analysis.ignoredFields.map((item) => item.field);
  assert.ok(ignored.includes("dialled_phone_number"));
  assert.ok(ignored.includes("CustomerCreateDate"));
  assert.ok(ignored.includes("CustomerImportDate"));
  assert.equal(analysis.totals.uniqueCalls, 2);
  assert.equal(analysis.reviewQueue.every((item) => !("dialled_phone_number" in item)), true);
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
