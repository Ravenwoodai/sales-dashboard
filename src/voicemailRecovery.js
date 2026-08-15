"use strict";

const crypto = require("crypto");

const APPROVED_CALLBACK_MESSAGE_TEMPLATE = "Hi, this is {salesperson}. If you could give me a call back when you get a chance, that would be great. Thanks.";
const TRUSTWORTHY_VOICEMAIL_PROMPTS = [
  /\byou have reached\b/i,
  /\bplease leave (?:a )?message\b/i,
  /\bleave (?:a )?message\b/i,
  /\bafter the tone\b/i,
  /\bmailbox\b/i,
  /\bmessage bank\b/i,
  /\brecord(?:ing)? (?:your )?message\b/i
];
const CALLBACK_REQUEST_PATTERNS = [
  /\bgive (?:me|us) (?:a )?(?:quick )?(?:call|ring|bell|buzz) back\b/i,
  /\bgive (?:me|us) (?:a )?(?:quick )?call (?:on|at) (?:this|the) (?:number|phone)\b/i,
  /\bgive (?:me|us) (?:a )?(?:quick )?call\s*[,;:-]?\s*0\d(?:[\s.-]?\d){7,}\b/i,
  /\bcall (?:me|us) back\b/i,
  /\bring (?:me|us) back\b/i,
  /\bbuzz (?:me|us)? ?back\b/i,
  /\breturn (?:my|our|the) call\b/i,
  /\bget back to (?:me|us)\b/i
];
const CORRUPT_MESSAGE_CHRONOLOGY_PATTERNS = [
  /\bplease give me a call back\b[\s\S]*\bi don['’]?t want to\b/i
];

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizedWords(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSalespersonTurn(turn = {}) {
  const speaker = clean(turn.speaker);
  return speaker === "Agent" || /\(CWA\)$/i.test(speaker);
}

function trustworthyPrompt(turn = {}) {
  const text = clean(turn.text);
  return TRUSTWORTHY_VOICEMAIL_PROMPTS.some((pattern) => pattern.test(text));
}

function callbackRequestQuote(turn = {}) {
  if (!isSalespersonTurn(turn)) return "";
  const text = clean(turn.text);
  return CALLBACK_REQUEST_PATTERNS.some((pattern) => pattern.test(text)) ? text : "";
}

function isExactApprovedCallbackMessage(turn = {}) {
  if (!isSalespersonTurn(turn)) return false;
  const text = normalizedWords(turn.text);
  return /^hi this is [a-z][a-z0-9' -]{0,60} if you could give me a call back when you get a chance that would be great thanks$/.test(text);
}

function messageEvidenceFor(call = {}) {
  const turns = Array.isArray(call.transcriptTurns) ? call.transcriptTurns : [];
  const promptIndex = turns.findIndex(trustworthyPrompt);
  if (promptIndex < 0) {
    return {
      status: "not_scored",
      reason: "trustworthy_voicemail_prompt_not_observed",
      prompt: null,
      callbackRequest: null,
      exactApprovedMessage: false
    };
  }
  const sellerAfterPromptIndex = turns.findIndex((turn, index) => index > promptIndex && callbackRequestQuote(turn));
  const sellerAfterPrompt = sellerAfterPromptIndex >= 0 ? turns[sellerAfterPromptIndex] : null;
  if (sellerAfterPrompt && CORRUPT_MESSAGE_CHRONOLOGY_PATTERNS.some((pattern) => pattern.test(clean(sellerAfterPrompt.text)))) {
    return {
      status: "not_scored",
      reason: "post_prompt_turn_contains_contradictory_dialogue_and_corrupt_chronology",
      prompt: {
        turnIndex: promptIndex,
        speaker: clean(turns[promptIndex].speaker),
        quote: clean(turns[promptIndex].text)
      },
      callbackRequest: null,
      exactApprovedMessage: false
    };
  }
  return {
    status: sellerAfterPrompt ? "observed" : "not_observed",
    reason: sellerAfterPrompt ? "literal_callback_request_after_trustworthy_prompt" : "no_literal_callback_request_after_prompt",
    prompt: {
      turnIndex: promptIndex,
      speaker: clean(turns[promptIndex].speaker),
      quote: clean(turns[promptIndex].text)
    },
    callbackRequest: sellerAfterPrompt ? {
      turnIndex: sellerAfterPromptIndex,
      speaker: clean(sellerAfterPrompt.speaker),
      quote: clean(sellerAfterPrompt.text)
    } : null,
    exactApprovedMessage: Boolean(sellerAfterPrompt && isExactApprovedCallbackMessage(sellerAfterPrompt))
  };
}

function stableIdMap(call = {}) {
  return new Map((Array.isArray(call.stableIds) ? call.stableIds : [])
    .map((item) => [clean(item?.field), clean(item?.value)])
    .filter(([field, value]) => field && value));
}

function sharedStableIds(left = {}, right = {}) {
  const leftIds = stableIdMap(left);
  return Array.from(stableIdMap(right).entries())
    .filter(([field, value]) => leftIds.get(field) === value)
    .map(([field, value]) => ({ field, value }));
}

function sourceTimeMs(call = {}) {
  const value = clean(call.dateTime);
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceAssignedHandlerEvidence(call = {}) {
  const salesperson = clean(call.salesperson);
  if (!salesperson || salesperson.toLowerCase() === "unknown") {
    return { observed: false, reason: "salesperson_source_field_missing", quote: null };
  }
  const exactSpeaker = (Array.isArray(call.transcriptTurns) ? call.transcriptTurns : [])
    .find((turn) => isSalespersonTurn(turn) && clean(turn.speaker).replace(/\s*\(CWA\)$/i, "") === salesperson);
  if (!exactSpeaker) return { observed: false, reason: "source_speaker_turn_not_observed", quote: null };
  return {
    observed: true,
    reason: "source_salesperson_and_matching_speaker_turn_observed",
    quote: { speaker: clean(exactSpeaker.speaker), quote: clean(exactSpeaker.text) }
  };
}

function inboundStableIdIndex(calls = []) {
  const index = new Map();
  (calls || []).forEach((call) => {
    if (clean(call.direction).toLowerCase() !== "in") return;
    const inboundTime = sourceTimeMs(call);
    if (inboundTime === null) return;
    stableIdMap(call).forEach((value, field) => {
      const key = `${field}:${value}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ call, inboundTime });
    });
  });
  index.forEach((rows) => rows.sort((a, b) => a.inboundTime - b.inboundTime || clean(a.call.callId).localeCompare(clean(b.call.callId))));
  return index;
}

function stableIdActivityIndex(calls = []) {
  const index = new Map();
  (calls || []).forEach((call) => {
    const time = sourceTimeMs(call);
    if (time === null) return;
    stableIdMap(call).forEach((value, field) => {
      const key = `${field}:${value}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ call, time });
    });
  });
  index.forEach((rows) => rows.sort((a, b) => a.time - b.time || clean(a.call.callId).localeCompare(clean(b.call.callId))));
  return index;
}

function linkLaterInbound(outbound, allCalls = [], options = {}) {
  const outboundTime = sourceTimeMs(outbound);
  if (outboundTime === null) return { status: "not_scored", reason: "outbound_chronology_invalid", candidates: [] };
  const outboundIds = stableIdMap(outbound);
  if (!outboundIds.size) return { status: "not_scored", reason: "stable_id_missing", candidates: [] };

  const inboundIndex = options.inboundIndex || inboundStableIdIndex(allCalls);
  const activityIndex = options.activityIndex || stableIdActivityIndex(allCalls);
  const candidateByCallId = new Map();
  outboundIds.forEach((value, field) => {
    (inboundIndex.get(`${field}:${value}`) || []).forEach(({ call, inboundTime }) => {
      if (inboundTime <= outboundTime) return;
      const callId = clean(call.callId);
      if (!candidateByCallId.has(callId)) candidateByCallId.set(callId, { call, inboundTime });
    });
  });
  const candidates = Array.from(candidateByCallId.values()).map(({ call, inboundTime }) => ({
    call,
    matchedIds: sharedStableIds(outbound, call),
    inboundTime,
    elapsedSeconds: Math.floor((inboundTime - outboundTime) / 1000)
  })).sort((a, b) => a.inboundTime - b.inboundTime || clean(a.call.callId).localeCompare(clean(b.call.callId)));

  if (!candidates.length) return { status: "not_observed", reason: "no_later_inbound_with_shared_stable_id", candidates: [] };
  if (candidates.length > 1) {
    return {
      status: "not_scored",
      reason: "multiple_later_inbound_records_make_event_attribution_ambiguous",
      candidates: candidates.map(publicInboundCandidate)
    };
  }

  const candidate = candidates[0];
  const interveningByCallId = new Map();
  outboundIds.forEach((value, field) => {
    (activityIndex.get(`${field}:${value}`) || []).forEach(({ call, time }) => {
      if (time <= outboundTime || time >= candidate.inboundTime) return;
      if (clean(call.direction).toLowerCase() !== "out") return;
      if (clean(call.callId) === clean(outbound.callId)) return;
      interveningByCallId.set(clean(call.callId), call);
    });
  });
  const interveningOutboundCallIds = Array.from(interveningByCallId.keys()).sort();
  const eventAttributionStatus = interveningOutboundCallIds.length ? "not_scored" : "observed";
  const handlerEvidence = sourceAssignedHandlerEvidence(candidate.call);
  const sameSalesperson = handlerEvidence.observed && eventAttributionStatus === "observed"
    ? clean(candidate.call.salesperson) === clean(outbound.salesperson)
    : null;
  return {
    status: "observed",
    reason: "one_later_inbound_record_with_shared_stable_id",
    candidates: [publicInboundCandidate(candidate)],
    inboundCallId: clean(candidate.call.callId),
    inboundSourceTime: clean(candidate.call.sourceTime),
    elapsedSeconds: candidate.elapsedSeconds,
    matchedStableIds: candidate.matchedIds,
    eventAttributionStatus,
    eventAttributionReason: eventAttributionStatus === "observed"
      ? "no_intervening_matching_outbound_record_observed"
      : "intervening_matching_outbound_record_makes_voicemail_event_attribution_ambiguous",
    interveningOutboundCallIds,
    sourceAssignedHandler: handlerEvidence.observed ? clean(candidate.call.salesperson) : null,
    originalSalespersonHandlingObserved: sameSalesperson,
    overflowHandlingObserved: sameSalesperson === null ? null : !sameSalesperson,
    handlerEvidence
  };
}

function publicInboundCandidate(candidate = {}) {
  return {
    callId: clean(candidate.call?.callId),
    sourceTime: clean(candidate.call?.sourceTime),
    salesperson: clean(candidate.call?.salesperson),
    elapsedSeconds: candidate.elapsedSeconds,
    matchedStableIds: candidate.matchedIds || []
  };
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / denominator) * 10000) / 10000 : null;
}

function sourceDate(call = {}) {
  const value = clean(call.dateTime);
  return value ? value.slice(0, 10) : "";
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function buildVoicemailInboundReport(calls = []) {
  const safeCalls = Array.isArray(calls) ? calls : [];
  const outbound = safeCalls.filter((call) => clean(call.direction).toLowerCase() === "out");
  const inbound = safeCalls.filter((call) => clean(call.direction).toLowerCase() === "in");
  const exactVoicemail = outbound.filter((call) => clean(call.localOutcome).toLowerCase() === "voicemail");
  const inboundIndex = inboundStableIdIndex(safeCalls);
  const activityIndex = stableIdActivityIndex(safeCalls);
  const records = exactVoicemail.map((call) => {
    const message = messageEvidenceFor(call);
    const inboundLink = linkLaterInbound(call, safeCalls, { inboundIndex, activityIndex });
    return {
      outboundCallId: clean(call.callId),
      outboundSourceTime: clean(call.sourceTime),
      salesperson: clean(call.salesperson),
      source: clean(call.source),
      explicitImportedSource: Boolean(clean(call.customerImportSourceRaw)),
      stableIds: Array.isArray(call.stableIds) ? call.stableIds : [],
      message,
      inboundLink,
      authority: {
        voicemail: "deterministic_derived_fact",
        message: "deterministic_derived_fact",
        inboundRecord: "source_fact_with_exact_stable_id_link",
        callbackCausation: "unknown",
        sale: "unavailable_without_crm",
        grossProfit: "unavailable_without_crm"
      }
    };
  });
  const explicitSourceRecords = records.filter((record) => record.explicitImportedSource);
  const validDates = safeCalls.map(sourceDate).filter(Boolean);
  const dateCounts = validDates.reduce((result, date) => {
    result[date] = (result[date] || 0) + 1;
    return result;
  }, {});
  const coverageByDate = new Map();
  safeCalls.forEach((call) => {
    const date = sourceDate(call);
    const time = sourceTimeMs(call);
    if (!date || time === null) return;
    const coverage = coverageByDate.get(date) || { first: time, last: time };
    coverage.first = Math.min(coverage.first, time);
    coverage.last = Math.max(coverage.last, time);
    coverageByDate.set(date, coverage);
  });
  const completeDates = Object.entries(dateCounts)
    .filter(([date, count]) => count >= 1000 && ((coverageByDate.get(date)?.last || 0) - (coverageByDate.get(date)?.first || 0)) >= 8 * 60 * 60 * 1000)
    .map(([date]) => date)
    .sort();
  const daily = Array.from(new Set(validDates)).sort().map((date) => {
    const dayCalls = safeCalls.filter((call) => sourceDate(call) === date);
    const dayOutbound = dayCalls.filter((call) => clean(call.direction).toLowerCase() === "out");
    const dayInbound = dayCalls.filter((call) => clean(call.direction).toLowerCase() === "in");
    const dayVoicemail = dayOutbound.filter((call) => clean(call.localOutcome).toLowerCase() === "voicemail");
    return { date, totalCalls: dayCalls.length, outboundCalls: dayOutbound.length, inboundCalls: dayInbound.length, exactVoicemail: dayVoicemail.length, completeDate: completeDates.includes(date) };
  });
  const linkedObserved = records.filter((record) => record.inboundLink.status === "observed");
  const eventAttributionObserved = linkedObserved.filter((record) => record.inboundLink.eventAttributionStatus === "observed");
  const eventAttributionAmbiguous = linkedObserved.filter((record) => record.inboundLink.eventAttributionStatus === "not_scored");
  const linkedAmbiguous = records.filter((record) => record.inboundLink.reason === "multiple_later_inbound_records_make_event_attribution_ambiguous");
  const messageObserved = records.filter((record) => record.message.status === "observed");
  const exactApproved = records.filter((record) => record.message.exactApprovedMessage);
  const explicitMessages = explicitSourceRecords.filter((record) => record.message.status === "observed");
  const explicitLinked = explicitSourceRecords.filter((record) => record.inboundLink.status === "observed");
  const explicitAttribution = explicitLinked.filter((record) => record.inboundLink.eventAttributionStatus === "observed");
  const completeRows = daily.filter((row) => row.completeDate);
  const average = (field) => completeRows.length
    ? Math.round(completeRows.reduce((sum, row) => sum + row[field], 0) / completeRows.length)
    : null;

  return {
    schemaVersion: "sales_dashboard_voicemail_inbound_report.v1",
    generatedAt: new Date().toISOString(),
    authority: "source_and_deterministic_only",
    approvedMessageTemplate: APPROVED_CALLBACK_MESSAGE_TEMPLATE,
    totals: {
      calls: safeCalls.length,
      outboundCalls: outbound.length,
      inboundCalls: inbound.length,
      exactVoicemail: exactVoicemail.length,
      exactVoicemailRate: ratio(exactVoicemail.length, outbound.length),
      transcriptVerifiableCallbackRequests: messageObserved.length,
      callbackRequestRate: ratio(messageObserved.length, exactVoicemail.length),
      exactApprovedMessages: exactApproved.length,
      exactApprovedMessageRate: ratio(exactApproved.length, exactVoicemail.length),
      laterInboundRelationshipObserved: linkedObserved.length,
      uniquelyLinkedLaterInbound: eventAttributionObserved.length,
      ambiguousLaterInboundLinks: linkedAmbiguous.length + eventAttributionAmbiguous.length,
      originalSalespersonHandlingObserved: eventAttributionObserved.filter((record) => record.inboundLink.originalSalespersonHandlingObserved === true).length,
      overflowHandlingObserved: eventAttributionObserved.filter((record) => record.inboundLink.overflowHandlingObserved === true).length,
      handlingUnknown: eventAttributionObserved.filter((record) => record.inboundLink.originalSalespersonHandlingObserved === null).length,
      sales: null,
      grossProfit: null
    },
    explicitImportedSource: {
      outboundCalls: outbound.filter((call) => Boolean(clean(call.customerImportSourceRaw))).length,
      exactVoicemail: explicitSourceRecords.length,
      transcriptVerifiableCallbackRequests: explicitMessages.length,
      laterInboundRelationshipObserved: explicitLinked.length,
      uniquelyLinkedLaterInbound: explicitAttribution.length
    },
    completeDayAverage: {
      qualificationRule: "At least 1,000 recorded calls spanning at least eight source-time hours on the date.",
      dates: completeDates,
      totalCalls: average("totalCalls"),
      outboundCalls: average("outboundCalls"),
      inboundCalls: average("inboundCalls"),
      exactVoicemail: average("exactVoicemail")
    },
    daily,
    records,
    provenance: {
      callCount: safeCalls.length,
      callSetHash: digest(safeCalls.map((call) => `${clean(call.callId)}:${clean(call.dateTime)}:${clean(call.localOutcome)}`).sort().join("\n")),
      rules: [
        "Exact voicemail uses the existing closed literal outcome.",
        "A callback request counts only in a salesperson-labelled turn after a recognised machine prompt.",
        "The approved-message count requires the complete approved wording, allowing only the salesperson name placeholder.",
        "Inbound linkage requires later chronology and at least one exact permitted stable-ID field/value match.",
        "Multiple later inbound candidates make event attribution not_scored.",
        "A full-coverage date has at least 1,000 recorded calls spanning at least eight source-time hours; the day average uses only those dates.",
        "Callback causation, receptiveness, sale and gross profit remain unknown."
      ]
    }
  };
}

module.exports = {
  APPROVED_CALLBACK_MESSAGE_TEMPLATE,
  buildVoicemailInboundReport,
  callbackRequestQuote,
  inboundStableIdIndex,
  isExactApprovedCallbackMessage,
  linkLaterInbound,
  messageEvidenceFor,
  normalizedWords,
  sharedStableIds,
  sourceAssignedHandlerEvidence,
  stableIdActivityIndex,
  trustworthyPrompt
};
