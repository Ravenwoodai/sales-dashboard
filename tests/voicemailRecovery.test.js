"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVoicemailInboundReport,
  linkLaterInbound,
  messageEvidenceFor
} = require("../src/voicemailRecovery");

function call(overrides = {}) {
  return {
    callId: "10000001",
    dateTime: "2026-07-02T01:00:00.000Z",
    sourceTime: "02/07/2026 11:00:00 AEST",
    direction: "out",
    localOutcome: "voicemail",
    salesperson: "Drew Example",
    source: "GoogleMaps",
    customerImportSourceRaw: "GoogleMaps",
    stableIds: [{ field: "customer_id", value: "200" }],
    transcriptTurns: [
      { speaker: "Voicemail", text: "Please leave a message after the tone." },
      { speaker: "Drew Example (CWA)", text: "Hi, this is Drew. If you could give me a call back when you get a chance, that would be great. Thanks." }
    ],
    ...overrides
  };
}

test("callback wording counts only after a trustworthy voicemail prompt", () => {
  const observed = messageEvidenceFor(call());
  assert.equal(observed.status, "observed");
  assert.equal(observed.exactApprovedMessage, true);
  assert.equal(observed.prompt.turnIndex, 0);
  assert.equal(observed.callbackRequest.turnIndex, 1);

  const beforePrompt = messageEvidenceFor(call({
    transcriptTurns: [
      { speaker: "Drew Example (CWA)", text: "Please give me a call back." },
      { speaker: "Voicemail", text: "Please leave a message after the tone." }
    ]
  }));
  assert.equal(beforePrompt.status, "not_observed");
  assert.equal(beforePrompt.exactApprovedMessage, false);

  const noPrompt = messageEvidenceFor(call({
    transcriptTurns: [{ speaker: "Drew Example (CWA)", text: "Please give me a call back." }]
  }));
  assert.equal(noPrompt.status, "not_scored");

  const corruptChronology = messageEvidenceFor(call({
    transcriptTurns: [
      { speaker: "Voicemail", text: "Please leave a message after the tone." },
      { speaker: "Drew Example (CWA)", text: "Please give me a call back later on. I don't want to. Thank you." }
    ]
  }));
  assert.equal(corruptChronology.status, "not_scored");
  assert.match(corruptChronology.reason, /corrupt_chronology/);
});

test("later inbound linkage requires valid chronology and exact stable IDs", () => {
  const outbound = call();
  const inbound = call({
    callId: "10000002",
    dateTime: "2026-07-02T02:00:00.000Z",
    sourceTime: "02/07/2026 12:00:00 AEST",
    direction: "in",
    localOutcome: "unknown",
    transcriptTurns: [
      { speaker: "Drew Example (CWA)", text: "Thanks for returning my call." },
      { speaker: "Customer", text: "I saw the missed call." }
    ]
  });
  const linked = linkLaterInbound(outbound, [outbound, inbound]);
  assert.equal(linked.status, "observed");
  assert.equal(linked.inboundCallId, "10000002");
  assert.equal(linked.elapsedSeconds, 3600);
  assert.equal(linked.originalSalespersonHandlingObserved, true);
  assert.equal(linked.overflowHandlingObserved, false);

  const wrongId = linkLaterInbound(outbound, [outbound, { ...inbound, stableIds: [{ field: "customer_id", value: "other" }] }]);
  assert.equal(wrongId.status, "not_observed");

  const invalidChronology = linkLaterInbound({ ...outbound, dateTime: "bad" }, [inbound]);
  assert.equal(invalidChronology.status, "not_scored");
  assert.equal(invalidChronology.reason, "outbound_chronology_invalid");
});

test("ambiguous inbound records are not attributed and different source handlers are explicit overflow evidence", () => {
  const outbound = call();
  const inbound = call({
    callId: "10000002",
    dateTime: "2026-07-02T02:00:00.000Z",
    direction: "in",
    salesperson: "Alex Overflow",
    transcriptTurns: [
      { speaker: "Alex Overflow (CWA)", text: "Hello, Alex speaking." },
      { speaker: "Customer", text: "I am returning a call." }
    ]
  });
  const unique = linkLaterInbound(outbound, [outbound, inbound]);
  assert.equal(unique.status, "observed");
  assert.equal(unique.originalSalespersonHandlingObserved, false);
  assert.equal(unique.overflowHandlingObserved, true);

  const secondInbound = { ...inbound, callId: "10000003", dateTime: "2026-07-02T03:00:00.000Z" };
  const ambiguous = linkLaterInbound(outbound, [outbound, inbound, secondInbound]);
  assert.equal(ambiguous.status, "not_scored");
  assert.equal(ambiguous.reason, "multiple_later_inbound_records_make_event_attribution_ambiguous");
  assert.equal(ambiguous.candidates.length, 2);

  const intervening = call({ callId: "10000004", dateTime: "2026-07-02T01:30:00.000Z", transcriptTurns: [] });
  const interrupted = linkLaterInbound(outbound, [outbound, intervening, inbound]);
  assert.equal(interrupted.status, "observed");
  assert.equal(interrupted.eventAttributionStatus, "not_scored");
  assert.deepEqual(interrupted.interveningOutboundCallIds, ["10000004"]);
  assert.equal(interrupted.originalSalespersonHandlingObserved, null);
});

test("report keeps commercial and causal claims unavailable", () => {
  const outbound = call();
  const inbound = call({
    callId: "10000002",
    dateTime: "2026-07-02T02:00:00.000Z",
    direction: "in",
    localOutcome: "unknown",
    transcriptTurns: [{ speaker: "Drew Example (CWA)", text: "Thanks for returning my call." }]
  });
  const report = buildVoicemailInboundReport([outbound, inbound]);
  assert.equal(report.totals.calls, 2);
  assert.equal(report.totals.exactVoicemail, 1);
  assert.equal(report.totals.transcriptVerifiableCallbackRequests, 1);
  assert.equal(report.totals.exactApprovedMessages, 1);
  assert.equal(report.totals.uniquelyLinkedLaterInbound, 1);
  assert.equal(report.totals.sales, null);
  assert.equal(report.totals.grossProfit, null);
  assert.equal(report.records[0].authority.callbackCausation, "unknown");
});
