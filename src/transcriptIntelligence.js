"use strict";

const crypto = require("crypto");
const { clean, isMissing } = require("./transcriptEvaluator");
const { isOfferPaymentOrOrderIntent } = require("./paymentIntentGuardrails");

const EXTRACTION_VERSION = "call_intelligence.v1";
const NO_CONTACT_CLASSIFICATIONS = new Set(["no_answer", "system_audio", "voicemail", "unknown"]);
const STABLE_LEAD_PRIORITY = ["customer_id", "AllocatedLeadID", "ContactId", "FoundContactID", "FoundCustomerID"];

const PROFANITY_PATTERN = /\b(?:fuck|fucking|shit|bullshit|bastard|bloody hell)\b/gi;
const PAYMENT_OR_ORDER_INTENT_PATTERNS = [
  /\bcustomer\s*:\s*.{0,180}\b(?:invoice|tax invoice|receipt|credit card|card details|bank transfer|payment details|pay for|payment for|take (?:my|the)? payment|process (?:my|the)? payment|book it|place (?:an? |the |my |our )?order|order (?:it|that|this|the|a|an)|put (?:me|us) down|sign (?:me|us) up|go ahead|sounds good|proceed)\b.{0,120}/gi,
  /\bcustomer\s*:\s*.{0,180}\b(?:pay|paying|payment|paid)\b.{0,90}\b(?:journal|publication|advertising|advertisement|advert|ad\b|campaign|sponsorship|package|listing|order|invoice)\b.{0,80}/gi,
  /\bcustomer\s*:\s*.{0,180}\b(?:journal|publication|advertising|advertisement|advert|ad\b|campaign|sponsorship|package|listing|order|invoice)\b.{0,90}\b(?:pay|paying|payment|paid)\b.{0,80}/gi
];

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function lower(value) {
  return clean(value).toLowerCase();
}

function bool(value) {
  return value ? 1 : 0;
}

function compact(value, maxLength = 260) {
  const text = clean(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function speakerForIndex(transcript, index) {
  const before = transcript.slice(Math.max(0, index - 90), index).toLowerCase();
  const customer = Math.max(before.lastIndexOf("customer:"), before.lastIndexOf("voicemail:"));
  const agent = Math.max(before.lastIndexOf("agent:"), before.lastIndexOf("(cwa):"));
  if (customer > agent) return before.lastIndexOf("voicemail:") >= customer ? "voicemail" : "customer";
  if (agent >= 0) return "salesperson";
  return "unknown";
}

function evidenceFor(transcript, match, radius = 120) {
  if (!match) return "";
  const index = typeof match.index === "number" ? match.index : 0;
  const raw = match[0] || "";
  const start = Math.max(0, index - radius);
  const end = Math.min(transcript.length, index + raw.length + radius);
  return compact(transcript.slice(start, end));
}

function matches(pattern, transcript) {
  pattern.lastIndex = 0;
  return Array.from(transcript.matchAll(pattern));
}

function stableLeadKey(call) {
  const ids = Array.isArray(call.stableIds) ? call.stableIds : [];
  const byField = new Map(ids.map((item) => [item.field, item.value]));
  for (const field of STABLE_LEAD_PRIORITY) {
    const value = clean(byField.get(field));
    if (value) return { leadKeyType: field, leadKey: `${field}:${value}` };
  }
  return { leadKeyType: "call_id", leadKey: `call_id:${call.callId || "unknown"}` };
}

function customerIdFor(call) {
  const direct = clean(call.customerId);
  if (direct) return direct;
  const ids = Array.isArray(call.stableIds) ? call.stableIds : [];
  const customerId = ids.find((item) => item.field === "customer_id");
  return clean(customerId?.value);
}

function addEntity(entities, call, entityType, match, normalizedValue = "", confidence = 0.78) {
  const transcript = call.transcript || "";
  const rawValue = clean(match?.[0] || match);
  if (!rawValue) return;
  entities.push({
    callId: call.callId,
    entityType,
    rawValue,
    normalizedValue: clean(normalizedValue) || rawValue,
    speaker: typeof match?.index === "number" ? speakerForIndex(transcript, match.index) : "unknown",
    evidence: typeof match?.index === "number" ? evidenceFor(transcript, match) : compact(rawValue),
    confidence,
    source: "deterministic"
  });
}

function addEvent(events, call, eventType, match, options = {}) {
  const transcript = call.transcript || "";
  events.push({
    callId: call.callId,
    eventType,
    speaker: options.speaker || (typeof match?.index === "number" ? speakerForIndex(transcript, match.index) : "unknown"),
    rawValue: clean(options.rawValue || match?.[0] || ""),
    normalizedValue: clean(options.normalizedValue || ""),
    followUpRequired: bool(options.followUpRequired),
    dueAt: clean(options.dueAt || ""),
    evidence: typeof match?.index === "number" ? evidenceFor(transcript, match) : clean(options.evidence || ""),
    confidence: options.confidence ?? 0.76,
    source: "deterministic"
  });
}

function addRiskFlag(flags, call, flagType, severity, match, options = {}) {
  const transcript = call.transcript || "";
  flags.push({
    callId: call.callId,
    flagType,
    severity,
    speaker: options.speaker || (typeof match?.index === "number" ? speakerForIndex(transcript, match.index) : "unknown"),
    evidence: typeof match?.index === "number" ? evidenceFor(transcript, match) : clean(options.evidence || ""),
    confidence: options.confidence ?? 0.78,
    managerReviewRecommended: bool(options.managerReviewRecommended !== false),
    source: "deterministic"
  });
}

function aiAssistantEvidenceFor(call) {
  const evidence = Array.isArray(call.evidence)
    ? call.evidence.find((item) => item.signal === "ai_voice_assistant")
    : null;
  return clean(evidence?.text || call.transcriptPreview || call.transcript || "");
}

function extractEntities(call) {
  const transcript = call.transcript || "";
  const entities = [];
  matches(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, transcript)
    .forEach((match) => addEntity(entities, call, "email_address", match, lower(match[0]), 0.9));
  matches(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, transcript)
    .forEach((match) => addEntity(entities, call, "phone_number_mentioned", match, match[0].replace(/\D/g, ""), 0.72));
  matches(/\$\s?\d[\d,]*(?:\.\d{2})?|\b\d+\s?(?:dollars|bucks)\b/gi, transcript)
    .forEach((match) => addEntity(entities, call, "price_amount", match, "", 0.74));
  matches(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|later today|this afternoon|after lunch)\b/gi, transcript)
    .forEach((match) => addEntity(entities, call, "date_or_relative_date", match, lower(match[0]), 0.72));
  matches(/\b(?:after\s+)?(?:[1-9]|1[0-2])(?::[0-5]\d)?\s?(?:am|pm)\b|\bafter\s+[1-9]\b/gi, transcript)
    .forEach((match) => addEntity(entities, call, "time_or_relative_time", match, lower(match[0]), 0.74));
  matches(/\b(?:journal|publication|advertising|advert|ad size|campaign|sponsorship|charity|cause|feature|package)\b/gi, transcript)
    .forEach((match) => addEntity(entities, call, "product_or_offer", match, lower(match[0]), 0.66));
  return entities;
}

function extractPaymentOrOrderIntentEvents(call, events) {
  const transcript = call.transcript || "";
  const seen = new Set();
  PAYMENT_OR_ORDER_INTENT_PATTERNS.forEach((pattern) => {
    matches(pattern, transcript).slice(0, 5).forEach((match) => {
      const evidence = evidenceFor(transcript, match);
      if (!isOfferPaymentOrOrderIntent({ rawValue: match[0], evidence })) return;
      const key = `${match.index || 0}:${compact(match[0], 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      addEvent(events, call, "payment_or_order_intent", match, {
        followUpRequired: true,
        evidence
      });
    });
  });
}

function extractEventsAndFlags(call) {
  const transcript = call.transcript || "";
  const events = [];
  const flags = [];

  [
    ["customer_requested_callback", /\bcustomer\s*:\s*.{0,180}\b(?:call|ring|try).{0,60}\b(?:back|again|later|tomorrow|friday|after|next week)\b/gi],
    ["salesperson_promised_callback", /\b(?:agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:\s*.{0,180}\b(?:i|we)(?:'ll| will).{0,60}\b(?:call|ring|try).{0,40}\b(?:back|again|later|tomorrow|then)\b/gi],
    ["customer_requested_email", /\bcustomer\s*:\s*.{0,180}\b(?:email|send).{0,80}\b(?:info|information|details|through|email)\b/gi],
    ["salesperson_promised_email", /\b(?:agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:\s*.{0,180}\b(?:email|send).{0,80}\b(?:info|information|details|through|email)\b/gi],
    ["customer_refused", /\bcustomer\s*:\s*.{0,120}\b(?:not interested|no thanks|don't want|do not want)\b/gi],
    ["wrong_number", /\b(?:wrong number|incorrect number|not their number)\b/gi],
    ["voicemail_left_or_detected", /\b(?:voicemail|mailbox|leave a message|after the tone)\b/gi],
    ["no_answer_detected", /\b(?:no answer|not available|person you are calling is unavailable|call could not be connected)\b/gi],
    ["customer_requested_invoice", /\bcustomer\s*:\s*.{0,180}\b(?:invoice|tax invoice|receipt)\b/gi],
    ["decision_maker_unavailable", /\b(?:owner|manager|decision maker|boss).{0,80}\b(?:not here|unavailable|away|out|not in)\b/gi],
    ["reason_or_pitch_explained", /\b(?:reason (?:for|of) (?:my|the) call|calling (?:about|regarding)|official journal|local area|advertising|publication|campaign|supporting)\b/gi]
  ].forEach(([eventType, pattern]) => {
    matches(pattern, transcript).slice(0, 5).forEach((match) => {
      const followUpRequired = ["customer_requested_callback", "salesperson_promised_callback", "customer_requested_email", "salesperson_promised_email", "customer_requested_invoice", "payment_or_order_intent"].includes(eventType);
      addEvent(events, call, eventType, match, { followUpRequired });
    });
  });

  if (call.aiVoiceAssistantDetected) {
    const evidence = aiAssistantEvidenceFor(call);
    addEvent(events, call, "ai_call_assistant_encountered", null, {
      speaker: "system",
      rawValue: call.aiVoiceAssistantResponse || "ai_call_assistant",
      normalizedValue: call.aiVoiceAssistantResponse || "detected",
      evidence,
      confidence: Number(call.aiVoiceAssistantConfidence || 0.86)
    });

    if (call.aiVoiceAssistantBailed) {
      addEvent(events, call, "ai_assistant_bail", null, {
        speaker: "salesperson",
        rawValue: "bailed",
        normalizedValue: "bailed",
        evidence,
        confidence: Number(call.aiVoiceAssistantConfidence || 0.76)
      });
    } else if (call.aiVoiceAssistantHandledSuccessfully) {
      addEvent(events, call, "ai_assistant_handled_well", null, {
        speaker: "salesperson",
        rawValue: "handled_well",
        normalizedValue: "handled_well",
        evidence,
        confidence: Number(call.aiVoiceAssistantConfidence || 0.76)
      });
    }

    (call.aiVoiceAssistantTactics || []).forEach((label) => {
      addEvent(events, call, "ai_assistant_tactic", null, {
        speaker: "salesperson",
        rawValue: label,
        normalizedValue: label,
        evidence,
        confidence: Number(call.aiVoiceAssistantConfidence || 0.7)
      });
    });
  }

  extractPaymentOrOrderIntentEvents(call, events);

  [
    ["scam_or_fraud_mentioned", "high", /\b(?:scam|fraud|dodgy|fake|legit|legitimate|real company)\b/gi],
    ["complaint_or_harassment", "high", /\b(?:complaint|complain|harassment|harassing|stop calling|remove me|do not call|don't call)\b/gi],
    ["legal_threat", "critical", /\b(?:legal action|lawyer|solicitor|police|report you|accc)\b/gi],
    ["profanity_used", "medium", PROFANITY_PATTERN],
    ["poor_transcript_quality", "medium", /\b(?:failed transcription|inaudible|unintelligible)\b/gi]
  ].forEach(([flagType, severity, pattern]) => {
    matches(pattern, transcript).slice(0, 5).forEach((match) => addRiskFlag(flags, call, flagType, severity, match));
  });

  if (call.transcriptQuality === "low" && Number(call.durationSeconds || 0) >= 30) {
    addRiskFlag(flags, call, "poor_transcript_quality", "medium", null, {
      evidence: call.transcriptPreview || "Long call has low-quality transcript.",
      confidence: 0.66
    });
  }

  return { events, flags };
}

function sentimentFor(events, flags) {
  if (flags.some((flag) => ["legal_threat", "complaint_or_harassment", "profanity_used"].includes(flag.flagType))) return "angry_or_hostile";
  if (flags.some((flag) => flag.flagType === "scam_or_fraud_mentioned")) return "skeptical";
  if (events.some((event) => ["payment_or_order_intent", "customer_requested_callback", "customer_requested_email", "customer_requested_invoice"].includes(event.eventType))) return "interested";
  if (events.some((event) => event.eventType === "customer_refused")) return "not_interested";
  return "neutral_or_unclear";
}

function decisionMakerStatus(events) {
  if (events.some((event) => event.eventType === "decision_maker_unavailable")) return "unavailable";
  return "unknown";
}

function utilizationScore(call, events, flags) {
  const classification = clean(call.contactClassification);
  const transcriptQuality = clean(call.transcriptQuality);
  const hasHuman = !NO_CONTACT_CLASSIFICATIONS.has(classification) && classification !== "";
  const hasNextStep = events.some((event) => event.followUpRequired);
  const pitchExplained = events.some((event) => event.eventType === "reason_or_pitch_explained");
  const validDisqualification = events.some((event) => ["customer_refused", "wrong_number", "voicemail_left_or_detected", "no_answer_detected"].includes(event.eventType));
  const highIntent = events.some((event) => ["payment_or_order_intent", "customer_requested_invoice", "customer_requested_callback", "customer_requested_email"].includes(event.eventType));

  if (!call.transcript || transcriptQuality === "unusable" || Number(call.durationSeconds || 0) <= 0) return 0;
  if (NO_CONTACT_CLASSIFICATIONS.has(classification) || events.some((event) => ["no_answer_detected", "voicemail_left_or_detected"].includes(event.eventType))) return 1;
  if (!hasHuman) return 1;
  if (!pitchExplained && !hasNextStep && !validDisqualification) return 2;
  if (pitchExplained && !hasNextStep && !validDisqualification) return 3;
  if (pitchExplained || hasNextStep || validDisqualification) return highIntent ? 5 : 4;
  return 3;
}

function buildReason(call, score, events, flags) {
  if (flags.some((flag) => flag.severity === "critical" || flag.severity === "high")) {
    return "Risk or compliance language appears in the transcript and needs review.";
  }
  if (score >= 5) return "Strong lead use: transcript shows a meaningful next step or high-intent customer signal.";
  if (score === 4) return "Good lead use: meaningful attempt, valid disqualification, or clear next step evidence.";
  if (score === 3) return "Basic professional attempt detected, but no strong next step was captured.";
  if (score === 2) return "Human contact appears likely, but the transcript lacks a clear pitch, qualification, or next step.";
  if (score === 1) return "No-answer, voicemail, or system-audio style attempt.";
  return "No usable attempt or transcript evidence available.";
}

function buildCallIntelligence(call, options = {}) {
  const transcript = call.transcript || "";
  const entities = extractEntities(call);
  const { events, flags } = extractEventsAndFlags(call);
  const score = utilizationScore(call, events, flags);
  const hasNextStep = events.some((event) => event.followUpRequired);
  const hasRisk = flags.some((flag) => flag.managerReviewRecommended);
  const hasHuman = !NO_CONTACT_CLASSIFICATIONS.has(clean(call.contactClassification)) && Boolean(clean(call.contactClassification));
  const validNoSale = events.some((event) => ["customer_refused", "wrong_number", "voicemail_left_or_detected", "no_answer_detected"].includes(event.eventType));
  const { leadKeyType, leadKey } = stableLeadKey(call);
  const reason = buildReason(call, score, events, flags);
  const confidence = call.transcriptQuality === "high" ? 0.84 : call.transcriptQuality === "medium" ? 0.68 : call.transcriptQuality === "low" ? 0.48 : 0.24;

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
      transcriptQuality: call.transcriptQuality || "unknown",
      connectedToHuman: bool(hasHuman),
      decisionMakerStatus: decisionMakerStatus(events),
      overallCallOutcome: call.localOutcome || "unknown",
      customerSentiment: sentimentFor(events, flags),
      nextStepExists: bool(hasNextStep),
      riskFlagExists: bool(hasRisk),
      validNoSale: bool(validNoSale),
      leadUtilizationScore: score,
      salespersonQualityScore: Math.max(0, Math.min(100, score * 20 - (hasRisk ? 10 : 0))),
      managerReviewRequired: bool(hasRisk || (hasHuman && score <= 2)),
      llmConfidence: 0,
      deterministicConfidence: confidence,
      briefReason: reason,
      evidenceSnippet: compact(flags[0]?.evidence || events[0]?.evidence || call.transcriptPreview || transcript),
      llmStatus: "not_requested",
      llmJobId: ""
    },
    entities,
    events,
    riskFlags: flags
  };
}

module.exports = {
  EXTRACTION_VERSION,
  buildCallIntelligence,
  stableLeadKey
};
