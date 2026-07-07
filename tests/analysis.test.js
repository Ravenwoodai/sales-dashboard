"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv } = require("../src/csvParser");
const { analyzeCsvText } = require("../src/analysis");
const { evaluateCall, parseTranscriptTurns } = require("../src/transcriptEvaluator");
const { buildCallIntelligence } = require("../src/transcriptIntelligence");

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
    })
  ]));

  assert.equal(analysis.sourceQuality.totals.callsWithImportDate, 3);
  assert.equal(analysis.sourceQuality.totals.callsWithManualCreator, 2);
  assert.equal(analysis.sourceQuality.totals.leadGeneratorCreatedCalls, 1);
  assert.equal(analysis.sourceQuality.totals.salespersonCreatedCalls, 1);
  assert.equal(analysis.sourceQuality.newBusinessImportAgeThresholds.find((item) => item.thresholdDays === 30).calls, 2);
  assert.equal(analysis.sourceQuality.newBusinessImportAgeThresholds.find((item) => item.thresholdDays === 90).calls, 1);

  const google = analysis.sourceQuality.sourceRows.find((item) => item.name === "GoogleMaps");
  assert.equal(google.calls, 2);
  assert.equal(google.newBusinessCalls, 2);
  assert.equal(google.newBusinessImportedOlderThan90, 1);

  const lg = analysis.sourceQuality.createdByTypeRows.find((item) => item.createdByType === "LG");
  assert.equal(lg.calls, 1);
  assert.equal(lg.createdByTypeLabel, "Lead Generator");

  const oldNew = analysis.drilldownRows.find((item) => item.callId === "source-old-new");
  assert.equal(oldNew.businessSegment, "new");
  assert.equal(oldNew.daysSinceImport, 181);
  assert.equal(oldNew.customerCreatedByType, "LG");
  assert.equal(oldNew.customerImportDateIso, "2026-01-01");
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
