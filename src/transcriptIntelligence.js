"use strict";

const crypto = require("crypto");
const { clean } = require("./transcriptEvaluator");

const EXTRACTION_VERSION = "call_intelligence.literal_triage.v3";
const STABLE_LEAD_PRIORITY = ["customer_id", "AllocatedLeadID", "ContactId", "FoundContactID", "FoundCustomerID"];

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function compact(value, maxLength = 260) {
  const text = clean(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function flag(value) {
  return value ? 1 : 0;
}

function stableLeadKey(call = {}) {
  const ids = Array.isArray(call.stableIds) ? call.stableIds : [];
  const byField = new Map(ids.map((item) => [item.field, item.value]));
  for (const field of STABLE_LEAD_PRIORITY) {
    const value = clean(byField.get(field));
    if (value) return { leadKeyType: field, leadKey: `${field}:${value}` };
  }
  return { leadKeyType: "call_id", leadKey: `call_id:${call.callId || "unknown"}` };
}

function customerIdFor(call = {}) {
  const direct = clean(call.customerId);
  if (direct) return direct;
  const ids = Array.isArray(call.stableIds) ? call.stableIds : [];
  return clean(ids.find((item) => item.field === "customer_id")?.value);
}

function exactEvidence(call = {}, signal) {
  const evidence = Array.isArray(call.evidence)
    ? call.evidence.find((item) => item.signal === signal)
    : null;
  return clean(evidence?.text);
}

function literalEvent(call, eventType, evidence, options = {}) {
  return {
    callId: call.callId,
    eventType,
    speaker: options.speaker || "system",
    rawValue: clean(options.rawValue),
    normalizedValue: clean(options.normalizedValue),
    followUpRequired: null,
    dueAt: "",
    evidence,
    confidence: null,
    source: "deterministic"
  };
}

function literalRiskFlag(call, evidence) {
  return {
    callId: call.callId,
    flagType: "direct_customer_opt_out",
    severity: "high",
    speaker: "customer",
    evidence,
    confidence: null,
    managerReviewRecommended: 1,
    source: "deterministic"
  };
}

function restrictedEventsAndFlags(call = {}) {
  const events = [];
  const riskFlags = [];
  const contact = clean(call.contactClassification);
  const eventConfig = {
    no_answer: { eventType: "no_answer_detected", signal: "literal_no_answer" },
    voicemail: { eventType: "voicemail_left_or_detected", signal: "literal_machine_voicemail" },
    wrong_number: { eventType: "wrong_number", signal: "literal_wrong_number", speaker: "customer" },
    system_audio: {
      eventType: "system_audio_detected",
      signal: call.aiVoiceAssistantDetected ? "ai_voice_assistant" : "literal_carrier_system"
    }
  }[contact];

  if (eventConfig) {
    const evidence = exactEvidence(call, eventConfig.signal);
    if (evidence) {
      events.push(literalEvent(call, eventConfig.eventType, evidence, {
        speaker: eventConfig.speaker,
        rawValue: contact,
        normalizedValue: contact
      }));
    }
  }

  if (clean(call.localOutcome) === "opt_out") {
    const evidence = exactEvidence(call, "opt_out");
    if (evidence) riskFlags.push(literalRiskFlag(call, evidence));
  }

  if (call.aiVoiceAssistantDetected) {
    const evidence = exactEvidence(call, "ai_voice_assistant");
    if (evidence) {
      events.push(literalEvent(call, "ai_call_assistant_encountered", evidence, {
        rawValue: call.aiVoiceAssistantResponse || "ai_call_assistant",
        normalizedValue: "detected_unscored"
      }));
    }
  }

  return { events, riskFlags };
}

function buildCallIntelligence(call = {}, options = {}) {
  const transcript = call.transcript || "";
  const { events, riskFlags } = restrictedEventsAndFlags(call);
  const managerReviewRequired = riskFlags.length > 0;
  const literalTerminalOrMachineAudio = events.some((event) => [
    "wrong_number",
    "voicemail_left_or_detected",
    "no_answer_detected",
    "system_audio_detected"
  ].includes(event.eventType));
  const { leadKeyType, leadKey } = stableLeadKey(call);
  const evidenceSnippet = compact(riskFlags[0]?.evidence || events[0]?.evidence || "");
  const reason = managerReviewRequired
    ? "Direct customer opt-out wording was found; manager verification is required."
    : literalTerminalOrMachineAudio
      ? "Restricted literal terminal or machine-audio triage only."
      : "Semantic transcript evaluation is unavailable; no lead, quality, follow-up, or outcome score was created.";

  return {
    call: {
      importId: options.importId || "current",
      inputHash: options.inputHash || "",
      sourceName: options.sourceName || "",
      extractionVersion: EXTRACTION_VERSION,
      callId: call.callId,
      customerId: customerIdFor(call),
      transcriptHash: hash(transcript),
      leadKey,
      leadKeyType,
      salesperson: call.salesperson || "Unknown",
      userId: call.rawFields?.UserID || "",
      source: call.source || "Unknown source",
      businessSegment: call.businessSegment || "",
      businessSegmentLabel: call.businessSegmentLabel || "",
      callDirection: call.direction || "",
      callType: call.callType || "",
      durationSeconds: Number(call.durationSeconds || 0),
      transcriptQuality: null,
      connectedToHuman: null,
      decisionMakerStatus: null,
      overallCallOutcome: literalTerminalOrMachineAudio || clean(call.localOutcome) === "opt_out"
        ? clean(call.localOutcome) || contactOutcome(events)
        : null,
      customerSentiment: null,
      nextStepExists: null,
      riskFlagExists: flag(managerReviewRequired),
      validNoSale: null,
      leadUtilizationScore: null,
      salespersonQualityScore: null,
      managerReviewRequired: flag(managerReviewRequired),
      llmConfidence: null,
      deterministicConfidence: null,
      briefReason: reason,
      evidenceSnippet,
      llmStatus: "not_requested",
      llmJobId: ""
    },
    entities: [],
    events,
    riskFlags
  };
}

function contactOutcome(events = []) {
  if (events.some((event) => event.eventType === "wrong_number")) return "wrong_number";
  if (events.some((event) => event.eventType === "voicemail_left_or_detected")) return "voicemail";
  if (events.some((event) => event.eventType === "system_audio_detected")) return "system_audio";
  if (events.some((event) => event.eventType === "no_answer_detected")) return "no_answer";
  return "unknown";
}

module.exports = {
  EXTRACTION_VERSION,
  buildCallIntelligence,
  stableLeadKey
};
