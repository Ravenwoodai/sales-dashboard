"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { regionNameFor, sourceNameFor } = require("./sourceQuality");
const { clean, isMissing, parseTranscriptTurns, toInt } = require("./transcriptEvaluator");
const { formatSourceDateTimeValue } = require("./dateTimeFormat");

const TERMINAL_OUTCOMES = new Set(["wrong_number", "not_interested", "complaint", "opt_out"]);

const CALLBACK_PATTERNS = [
  /\bcall\s+(?:me|us|him|her|them|the owner|the boss)?\s*back\b/i,
  /\b(?:give|gimme)\s+(?:me|us|him|her|them)?\s*(?:a\s*)?(?:call|ring)\b/i,
  /\bring\s+(?:me|us|him|her|them)?\s*back\b/i,
  /\btry\s+(?:me|us|him|her|them)?\s*(?:again|back)?\b/i,
  /\b(?:owner|boss|manager|decision maker).{0,80}\b(?:back|in|available|here)\b/i,
  /\b(?:i|we|he|she|they)'?ll\s+(?:be\s+)?back\b/i,
  /\bcall\s+(?:tomorrow|today|tonight|next week|next month|later|in the morning|this afternoon)\b/i
];

const POSITIVE_PATTERNS = [
  /\b100\s*%\b/i,
  /\byeah,?\s*100\b/i,
  /\babsolutely\b/i,
  /\bsounds good\b/i,
  /\byes please\b/i,
  /\bhappy to\b/i,
  /\bgo ahead\b/i,
  /\bsend (?:it|that|through|me|an email|the email|some info|information)\b/i,
  /\bemail (?:it|that|through|me|the details|the information)\b/i,
  /\bread (?:it|that|over|through)\b/i,
  /\blook (?:at|over|through) (?:it|that|the email|the details)\b/i,
  /\bhow much\b/i,
  /\bwhat do you need\b/i,
  /\binterested\b/i,
  /\bsupport\b/i,
  /\bsponsorship\b/i,
  /\badvertis(?:e|ing)\b/i,
  /\bowner will reply\b/i,
  /\bboss will handle\b/i
];

const TERMINAL_NEGATIVE_PATTERNS = [
  /\bnot interested\b/i,
  /\bnot really interested\b/i,
  /\bno thanks\b/i,
  /\bno thank you\b/i,
  /\bcan't do (?:that|it)\b/i,
  /\bcannot do (?:that|it)\b/i,
  /\bcan't afford\b/i,
  /\bdon't have (?:the )?money\b/i,
  /\bnot in a position\b/i,
  /\bnot (?:right )?now\b/i,
  /\btoo tight\b/i,
  /\bleave it for now\b/i,
  /\btry again (?:this time )?next year\b/i,
  /\bnext year\b/i,
  /\bnot doing the business\b/i,
  /\bclosed (?:it|the business) (?:all )?up\b/i,
  /\bdon't call\b/i,
  /\bdo not call\b/i,
  /\bremove me\b/i,
  /\bwrong number\b/i,
  /\bscam\b/i,
  /\bfraud\b/i,
  /\bcomplaint\b/i
];

const LONG_TERM_DEFERRAL_PATTERNS = [
  /\b(?:call|ring|phone|get back to|try|contact|reach)\s+(?:me|us|him|her|them|the owner|the boss)?\s*(?:back|again)?\s*(?:in|after|within)?\s*(?:about|around|roughly)?\s*(?:12|twelve)\s+months?(?:'?\s*time)?\b/i,
  /\b(?:in|after|within)\s+(?:about|around|roughly)?\s*(?:12|twelve)\s+months?(?:'?\s*time)?\b/i,
  /\bnext financial year\b/i,
  /\bbefore (?:the )?next financial year\b/i,
  /\b(?:try|call|ring|contact|get back to|reach)\s+(?:me|us|him|her|them)?\s*(?:again|back)?\s+(?:this time )?next year\b/i,
  /\bthis time next year\b/i
];

const TIMING_PATTERNS = [
  /\btomorrow\b/i,
  /\btoday\b/i,
  /\btonight\b/i,
  /\bthis\s+(?:morning|afternoon|evening)\b/i,
  /\b(?:in the|tomorrow)\s+(?:morning|afternoon|evening)\b/i,
  /\bafter\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|one|two|three|four|five|lunch)\b/i,
  /\b(?:before|around|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,
  /\b(?:7\.30|7:30|730)\b/i,
  /\bnext\s+(?:week|month|monday|tuesday|wednesday|thursday|friday)\b/i,
  /\bin a couple of months\b/i,
  /\ba couple of months\b/i,
  /\blater (?:today|tomorrow|on)\b/i
];

const DECISION_MAKER_PATTERNS = [
  /\b(?:owner|boss|manager|decision maker)\s+(?:is\s+)?(?:called|named)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  /\b(?:speak|talk)\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
  /\bask\s+for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i
];

const NAME_PATTERNS = [
  /\bmy name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  /\bthis is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
  /\byou(?:'re| are)\s+(?:speaking|talking)\s+(?:with|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i
];

const OBJECTION_DEFINITIONS = [
  {
    type: "not_decision_maker",
    label: "Not decision maker / decision maker unavailable",
    patterns: [
      /\b(?:owner|boss|manager|decision maker|director|accounts?|bookkeeper|husband|wife|partner)\b.{0,90}\b(?:not here|not in|away|busy|back|available|handles?|looks? after|will reply|will call|speak|talk|ask)\b/i,
      /\b(?:i|we)\s+(?:don't|do not)\s+(?:handle|look after|make|decide|approve)\b/i,
      /\b(?:need|needs|have|has)\s+to\s+(?:speak|talk|check|ask)\s+(?:with\s+)?(?:the\s+)?(?:owner|boss|manager|director|decision maker|accounts?|bookkeeper|husband|wife|partner)\b/i
    ]
  },
  {
    type: "budget_affordability",
    label: "Budget / affordability",
    patterns: [
      /\b(?:can't|cannot|can not)\s+afford\b/i,
      /\b(?:don't|do not)\s+have\s+(?:the\s+)?money\b/i,
      /\b(?:money|budget|cash\s*flow|finances?)\s+(?:is|are|isn't|aren't|not|too|a bit|really)?\s*(?:tight|low|short|bad|poor|not good|an issue|a problem)\b/i,
      /\b(?:too expensive|costs? too much|not in a position|no funds|financial year)\b/i
    ]
  },
  {
    type: "timing_busy",
    label: "Timing / busy",
    patterns: [
      /\b(?:busy|driving|in a meeting|with a customer|not a good time|can't talk|cannot talk|call back later|ring back later|try me later)\b/i,
      /\b(?:tomorrow|after lunch|this afternoon|next week|monday|tuesday|wednesday|thursday|friday).{0,60}\b(?:call|ring|try|available|free)\b/i
    ]
  },
  {
    type: "needs_information_or_review",
    label: "Needs information / wants to review",
    patterns: [
      /\b(?:send|email|text|sms)\s+(?:me\s+)?(?:the\s+)?(?:info|information|details|email|quote|pricing)\b/i,
      /\b(?:look|read|think)\s+(?:at|over|through|about)\s+(?:it|that|the email|the details|the information)?\b/i,
      /\b(?:need|needs|want|wants)\s+(?:to\s+)?(?:see|review|check|think)\b/i
    ]
  }
];

const SALES_HANDLING_DEFINITIONS = [
  {
    type: "clear_next_step",
    label: "Handled with clear next step",
    patterns: [
      /\b(?:i|we)'?ll\s+(?:call|ring|send|email|text|follow up|get back|try)\b/i,
      /\b(?:i|we)\s+will\s+(?:call|ring|send|email|text|follow up|get back|try)\b/i,
      /\b(?:i|we)\s+can\s+(?:call|ring|send|email|text|follow up|get back|try)\b/i,
      /\b(?:send|email|call|ring|follow up|get back)\s+(?:that|it|through|tomorrow|then|later)\b/i
    ]
  },
  {
    type: "clarified_next_step",
    label: "Clarified next step",
    patterns: [
      /\b(?:who|when|what time|which day|is there|would tomorrow|would next|best time|better time)\b/i,
      /\b(?:should I|can I|do you want me to|would you like me to)\s+(?:call|send|email|follow up)\b/i
    ]
  },
  {
    type: "acknowledged_only",
    label: "Acknowledged only",
    patterns: [
      /\b(?:no worries|no stress|fair enough|understood|all good|that's fine|that is fine|not a problem|thanks for your time|appreciate it|take care)\b/i
    ]
  }
];

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 10;
}

function orderCount(row) {
  const value = toInt(row?.OrderCount);
  return value === null ? 0 : value;
}

function businessSegmentFor(row) {
  return orderCount(row) > 0 ? "warm" : "new";
}

function businessSegmentLabel(segment) {
  if (segment === "warm") return "Warm Business";
  if (segment === "new") return "New Business";
  return "Unknown";
}

function callIdFor(item) {
  return clean(item?.row?.call_id) || `row-${item?.row?.__rowNumber || "unknown"}`;
}

function sourceFor(item) {
  const value = clean(item?.sourceAttribution?.customerImportSource);
  return isMissing(value) ? sourceNameFor(item.row || {}) : value;
}

function stableLeadIdentity(row) {
  for (const field of ENTITY_FIELDS) {
    const value = clean(row?.[field]);
    if (!isMissing(value)) {
      return {
        stableLeadSource: field,
        stableLeadValue: value,
        stableLeadKey: `${field}:${value}`
      };
    }
  }
  return {
    stableLeadSource: "",
    stableLeadValue: "",
    stableLeadKey: ""
  };
}

function customerIdFor(row) {
  const value = clean(row?.customer_id);
  return isMissing(value) ? "" : value;
}

function contactIdFor(row) {
  const value = clean(row?.ContactId);
  return isMissing(value) ? "" : value;
}

function sourceTimeLabel(item) {
  const date = clean(item?.row?.call_date);
  const time = clean(item?.row?.call_time);
  return formatSourceDateTimeValue(date, time);
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function matchedPatternCount(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function redactSensitive(text) {
  return clean(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b(?:\+?\d[\d\s().-]{6,}\d)\b/g, "[phone redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text, limit = 220) {
  const value = redactSensitive(text);
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function turnSpeaker(turn = {}) {
  const speaker = clean(turn.speaker);
  if (!speaker) return "Transcript";
  return speaker;
}

function isSalespersonSpeaker(speaker) {
  const text = clean(speaker);
  return text === "Agent" || /\(CWA\)$/i.test(text);
}

function signalTurnsFor(turns = []) {
  const labelledTurns = turns.filter((turn) => clean(turn.speaker) && clean(turn.speaker) !== "Transcript");
  if (!labelledTurns.length) return turns;
  return labelledTurns.filter((turn) => !isSalespersonSpeaker(turn.speaker) && !/^voicemail$/i.test(clean(turn.speaker)));
}

function turnsText(turns = []) {
  return turns.map((turn) => clean(turn.text)).filter(Boolean).join(" ");
}

function snippetForTurn(turn = {}) {
  const speaker = turnSpeaker(turn);
  return `${speaker}: ${truncateText(turn.text)}`;
}

function evidenceSnippets(turns = [], patterns = []) {
  const snippets = [];
  turns.forEach((turn) => {
    if (snippets.length >= 3) return;
    const text = clean(turn.text);
    if (text && hasAny(text, patterns)) {
      snippets.push(snippetForTurn(turn));
    }
  });
  return Array.from(new Set(snippets)).slice(0, 3);
}

function findDefinitionMatch(turns = [], definitions = []) {
  for (const definition of definitions) {
    for (const turn of turns) {
      const text = clean(turn.text);
      if (text && hasAny(text, definition.patterns)) {
        return {
          ...definition,
          evidence: snippetForTurn(turn)
        };
      }
    }
  }
  return null;
}

function classifyCustomerObjection(signalTurns = []) {
  const match = findDefinitionMatch(signalTurns, OBJECTION_DEFINITIONS);
  if (match) {
    return {
      objectionType: match.type,
      objectionLabel: match.label,
      objectionEvidence: match.evidence
    };
  }
  return {
    objectionType: "no_clear_objection_callback_requested",
    objectionLabel: "No clear objection; callback requested",
    objectionEvidence: "No clear objection phrase detected in customer turns."
  };
}

function classifySalespersonHandling(turns = []) {
  const salespersonTurns = turns.filter((turn) => isSalespersonSpeaker(turn.speaker));
  const match = findDefinitionMatch(salespersonTurns, SALES_HANDLING_DEFINITIONS);
  if (match) {
    return {
      salespersonHandlingType: match.type,
      salespersonHandlingLabel: match.label,
      salespersonHandlingEvidence: match.evidence
    };
  }
  return {
    salespersonHandlingType: "not_visible",
    salespersonHandlingLabel: "No clear handling visible",
    salespersonHandlingEvidence: "No clear salesperson response pattern was detected; open call evidence before judging."
  };
}

function findFirstPatternText(turns = [], patterns = []) {
  for (const turn of turns) {
    const text = clean(turn.text);
    if (text && hasAny(text, patterns)) return truncateText(text, 160);
  }
  return "";
}

function extractByPatterns(turns = [], patterns = []) {
  for (const turn of turns) {
    const text = clean(turn.text);
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const value = clean(match[1])
          .replace(/\b(?:is|was|will|would|can|could|back|available|here|in|on|at)$/i, "")
          .replace(/[.,!?;:]+$/, "")
          .trim();
        if (value && !/^(countrywide|austral|agent|customer|hello|hi)$/i.test(value)) return value;
      }
    }
  }
  return "";
}

function extractCallbackTiming(turns = []) {
  const timing = findFirstPatternText(turns, TIMING_PATTERNS);
  if (!timing) return "";
  return timing;
}

function callbackTimingSummary(timingText) {
  const text = clean(timingText);
  if (!text) return "Timing not specified";
  if (/\btomorrow\b/i.test(text)) return "Tomorrow mentioned";
  if (/\btoday\b|\btonight\b|\bthis\s+(?:morning|afternoon|evening)\b/i.test(text)) return "Same-day timing mentioned";
  if (/\bnext\s+/i.test(text)) return "Future date/week mentioned";
  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|\b(?:7\.30|7:30|730)\b/i.test(text)) return "Specific time mentioned";
  return "Callback timing mentioned";
}

function positiveSignalSummary(item, turns = []) {
  const opportunity = item?.evaluation?.opportunity || {};
  if (opportunity.requestedQuote) return "Quote/pricing requested";
  if (opportunity.appointmentOrMeeting) return "Meeting or appointment discussed";
  if (opportunity.requestedEmailOrSms) return "Asked for information by email/SMS";
  if (opportunity.positiveInterest) return "Positive interest detected";
  const text = findFirstPatternText(turns, POSITIVE_PATTERNS);
  return text ? "Positive response detected" : "Positive signal needs review";
}

function objectionSummary(turns = []) {
  const objection = classifyCustomerObjection(turns);
  return objection.objectionType === "no_clear_objection_callback_requested" ? "" : objection.objectionEvidence;
}

function confidenceBandFor(item, snippets = []) {
  const quality = item?.evaluation?.transcript?.qualityBand || "unknown";
  if (quality === "high" && snippets.length >= 2) return "high";
  if (quality === "high" || quality === "medium") return "medium";
  if (quality === "low") return "low";
  return "unusable";
}

function candidateSignals(item) {
  const evaluation = item.evaluation || {};
  const transcript = clean(item.row?.transcription_text);
  const turns = parseTranscriptTurns(transcript);
  const signalTurns = signalTurnsFor(turns);
  const signalText = turnsText(signalTurns) || transcript;
  const opportunity = evaluation.opportunity || {};
  const contact = evaluation.contact || {};
  const outcome = evaluation.outcome || {};
  const callbackSignal = hasAny(signalText, CALLBACK_PATTERNS);
  const positiveSignal = Boolean(
    hasAny(signalText, POSITIVE_PATTERNS) ||
    (opportunity.requestedQuote && /\b(?:quote|price|pricing|how much)\b/i.test(signalText)) ||
    (opportunity.requestedEmailOrSms && /\b(?:send|email|text|sms|information|details)\b/i.test(signalText)) ||
    (opportunity.appointmentOrMeeting && /\b(?:meet|meeting|appointment)\b/i.test(signalText))
  );
  const terminalNegativeCount = matchedPatternCount(signalText, TERMINAL_NEGATIVE_PATTERNS);
  const positiveCount = matchedPatternCount(signalText, POSITIVE_PATTERNS);
  const terminalOutcome = TERMINAL_OUTCOMES.has(outcome.localCategory);
  const longTermDeferral = Boolean(opportunity.longTermDeferral || hasAny(signalText, LONG_TERM_DEFERRAL_PATTERNS));
  const liveUsefulConversation = Boolean(contact.probableLiveHuman && (contact.meaningfulConversation || contact.actionableConversation));
  const hasRisk = Boolean(evaluation.risk?.complaint || evaluation.risk?.optOut);
  const terminalNegativeDominates = terminalNegativeCount > 0 && positiveCount === 0;
  const qualifies = Boolean(
    liveUsefulConversation &&
    callbackSignal &&
    positiveSignal &&
    !terminalOutcome &&
    !longTermDeferral &&
    !terminalNegativeDominates &&
    !hasRisk
  );
  return {
    qualifies,
    turns,
    signalTurns,
    callbackSignal,
    positiveSignal,
    terminalOutcome,
    longTermDeferral,
    terminalNegativeCount,
    positiveCount,
    liveUsefulConversation,
    reason: qualifies
      ? "Positive response with callback/follow-up evidence"
      : "Does not meet strict positive callback candidate rules"
  };
}

function laterCallsFor(candidate, byStableKey) {
  if (!candidate.stableLeadKey) return [];
  const calls = byStableKey.get(candidate.stableLeadKey) || [];
  return calls.filter((call) => {
    if (call.callId === candidate.callId) return false;
    if (call.timestamp > candidate.timestamp) return true;
    if (call.timestamp === candidate.timestamp) return call.callId.localeCompare(candidate.callId) > 0;
    return false;
  });
}

function buildCallIndex(items = []) {
  const byStableKey = new Map();
  items.forEach((item) => {
    const identity = stableLeadIdentity(item.row);
    if (!identity.stableLeadKey) return;
    const call = {
      callId: callIdFor(item),
      timestamp: item.dateTime ? item.dateTime.getTime() : 0,
      dateTime: item.dateTime ? item.dateTime.toISOString() : "",
      salesperson: clean(item.row.Salesperson) || "Unknown",
      probableLiveHuman: Boolean(item.evaluation?.contact?.probableLiveHuman),
      meaningfulConversation: Boolean(item.evaluation?.contact?.meaningfulConversation)
    };
    if (!byStableKey.has(identity.stableLeadKey)) byStableKey.set(identity.stableLeadKey, []);
    byStableKey.get(identity.stableLeadKey).push(call);
  });
  byStableKey.forEach((calls, key) => {
    byStableKey.set(key, calls.sort((a, b) => a.timestamp - b.timestamp || a.callId.localeCompare(b.callId)));
  });
  return byStableKey;
}

function buildCandidateRecord(item, byStableKey) {
  const row = item.row || {};
  const identity = stableLeadIdentity(row);
  const signals = candidateSignals(item);
  if (!signals.qualifies) return null;

  const signalTurns = signals.signalTurns?.length ? signals.signalTurns : signals.turns;
  const snippets = evidenceSnippets(signalTurns, [...CALLBACK_PATTERNS, ...POSITIVE_PATTERNS, ...TIMING_PATTERNS]);
  const laterCalls = laterCallsFor({
    callId: callIdFor(item),
    timestamp: item.dateTime ? item.dateTime.getTime() : 0,
    ...identity
  }, byStableKey);
  const laterMeaningfulCalls = laterCalls.filter((call) => call.probableLiveHuman || call.meaningfulConversation);
  const callbackText = extractCallbackTiming(signalTurns);
  const contactName = extractByPatterns(signalTurns, NAME_PATTERNS);
  const decisionMakerName = extractByPatterns(signalTurns, DECISION_MAKER_PATTERNS);
  const objection = classifyCustomerObjection(signalTurns);
  const handling = classifySalespersonHandling(signals.turns);
  const confidenceBand = confidenceBandFor(item, snippets);
  const businessSegment = businessSegmentFor(row);
  const status = !identity.stableLeadKey
    ? "matching_unavailable"
    : laterCalls.length
      ? "later_matching_call_observed"
      : "open_no_later_matching_call";

  return {
    type: "lead_harvest_candidate",
    callId: callIdFor(item),
    customerId: customerIdFor(row),
    contactId: contactIdFor(row),
    stableLeadSource: identity.stableLeadSource,
    stableLeadValue: identity.stableLeadValue,
    stableLeadKey: identity.stableLeadKey,
    date: clean(row.call_date),
    time: clean(row.call_time),
    sourceTime: sourceTimeLabel(item),
    dateTime: item.dateTime ? item.dateTime.toISOString() : "",
    timestamp: item.dateTime ? item.dateTime.getTime() : 0,
    salesperson: clean(row.Salesperson) || "Unknown",
    source: sourceFor(item),
    region: regionNameFor(row),
    businessSegment,
    businessSegmentLabel: businessSegmentLabel(businessSegment),
    localOutcome: item.evaluation?.outcome?.localCategory || "unknown",
    contactClassification: item.evaluation?.contact?.classification || "unknown",
    followUpChannel: item.evaluation?.opportunity?.followUpChannel || "unknown",
    possibleContactName: contactName,
    possibleDecisionMakerName: decisionMakerName,
    callbackTimingText: callbackText,
    callbackTimingSummary: callbackTimingSummary(callbackText),
    positiveSignalSummary: positiveSignalSummary(item, signalTurns),
    objectionType: objection.objectionType,
    objectionLabel: objection.objectionLabel,
    objectionEvidence: objection.objectionEvidence,
    objectionSummary: objection.objectionEvidence,
    salespersonHandlingType: handling.salespersonHandlingType,
    salespersonHandlingLabel: handling.salespersonHandlingLabel,
    salespersonHandlingEvidence: handling.salespersonHandlingEvidence,
    handoverSummary: [
      contactName ? `Possible contact: ${contactName}` : "",
      decisionMakerName ? `Possible decision-maker: ${decisionMakerName}` : "",
      objection.objectionLabel ? `Objection: ${objection.objectionLabel}` : "",
      handling.salespersonHandlingLabel ? `Handling: ${handling.salespersonHandlingLabel}` : "",
      callbackText ? `Callback context: ${truncateText(callbackText, 120)}` : "Callback requested; timing needs review",
      objection.objectionEvidence && objection.objectionType !== "no_clear_objection_callback_requested" ? `Context: ${truncateText(objection.objectionEvidence, 120)}` : ""
    ].filter(Boolean).join(" | "),
    evidenceSnippets: snippets,
    evidenceSummary: snippets[0] || "Evidence snippet unavailable; open call proof before action",
    confidenceBand,
    confidenceLabel: confidenceBand === "high" ? "High confidence" : confidenceBand === "medium" ? "Medium confidence" : confidenceBand === "low" ? "Low confidence" : "Unusable transcript",
    status,
    statusLabel: status === "later_matching_call_observed"
      ? "Later matching call observed"
      : status === "matching_unavailable"
        ? "Matching unavailable"
        : "No later matching call observed",
    laterCallObserved: laterCalls.length > 0,
    laterMeaningfulCallObserved: laterMeaningfulCalls.length > 0,
    laterCallId: laterCalls[0]?.callId || "",
    laterMeaningfulCallId: laterMeaningfulCalls[0]?.callId || "",
    laterSalesperson: laterCalls[0]?.salesperson || "",
    matchingConfidence: identity.stableLeadKey ? "stable_id" : "unavailable",
    reviewPriority: status === "open_no_later_matching_call" && ["high", "medium"].includes(confidenceBand)
      ? "high"
      : status === "matching_unavailable"
        ? "manual_check"
        : "normal",
    metricKeys: [
      "harvest.candidates",
      businessSegment === "new" ? "harvest.newBusinessCandidates" : "harvest.warmBusinessCandidates",
      status !== "later_matching_call_observed" ? "harvest.reviewQueue" : "",
      status === "open_no_later_matching_call" ? "harvest.openCandidates" : "",
      status === "later_matching_call_observed" ? "harvest.laterObserved" : "",
      status === "matching_unavailable" ? "harvest.matchingUnavailable" : ""
    ].filter(Boolean)
  };
}

function seedGroup(name, extras = {}) {
  return {
    name,
    candidateCalls: 0,
    newBusinessCandidateCalls: 0,
    warmBusinessCandidateCalls: 0,
    openCandidates: 0,
    newBusinessOpenCandidates: 0,
    warmBusinessOpenCandidates: 0,
    laterMatchingCallObserved: 0,
    newBusinessLaterMatchingCallObserved: 0,
    warmBusinessLaterMatchingCallObserved: 0,
    matchingUnavailable: 0,
    newBusinessMatchingUnavailable: 0,
    warmBusinessMatchingUnavailable: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    ...extras
  };
}

function addRecord(group, record) {
  group.candidateCalls += 1;
  if (record.businessSegment === "new") group.newBusinessCandidateCalls += 1;
  if (record.businessSegment === "warm") group.warmBusinessCandidateCalls += 1;
  if (record.status === "open_no_later_matching_call") group.openCandidates += 1;
  if (record.businessSegment === "new" && record.status === "open_no_later_matching_call") group.newBusinessOpenCandidates += 1;
  if (record.businessSegment === "warm" && record.status === "open_no_later_matching_call") group.warmBusinessOpenCandidates += 1;
  if (record.status === "later_matching_call_observed") group.laterMatchingCallObserved += 1;
  if (record.businessSegment === "new" && record.status === "later_matching_call_observed") group.newBusinessLaterMatchingCallObserved += 1;
  if (record.businessSegment === "warm" && record.status === "later_matching_call_observed") group.warmBusinessLaterMatchingCallObserved += 1;
  if (record.status === "matching_unavailable") group.matchingUnavailable += 1;
  if (record.businessSegment === "new" && record.status === "matching_unavailable") group.newBusinessMatchingUnavailable += 1;
  if (record.businessSegment === "warm" && record.status === "matching_unavailable") group.warmBusinessMatchingUnavailable += 1;
  if (record.confidenceBand === "high") group.highConfidence += 1;
  else if (record.confidenceBand === "medium") group.mediumConfidence += 1;
  else group.lowConfidence += 1;
}

function finalizeGroup(group) {
  return {
    ...group,
    openCandidateRate: percent(group.openCandidates, group.candidateCalls),
    laterMatchingCallObservedRate: percent(group.laterMatchingCallObserved, group.candidateCalls),
    matchingUnavailableRate: percent(group.matchingUnavailable, group.candidateCalls),
    highOrMediumConfidence: Number(group.highConfidence || 0) + Number(group.mediumConfidence || 0)
  };
}

function groupRows(records, keyFn, seedFn) {
  const groups = new Map();
  records.forEach((record) => {
    const key = keyFn(record);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, seedFn(key, record));
    addRecord(groups.get(key), record);
  });
  return Array.from(groups.values()).map(finalizeGroup);
}

function summarizeLeadHarvestRecords(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const totals = finalizeGroup(rows.reduce((group, record) => {
    addRecord(group, record);
    return group;
  }, seedGroup("All harvest candidates")));
  totals.openNewBusinessCandidates = rows.filter((record) => record.businessSegment === "new" && record.status === "open_no_later_matching_call").length;
  totals.newBusinessMatchingUnavailable = rows.filter((record) => record.businessSegment === "new" && record.status === "matching_unavailable").length;
  totals.newBusinessLaterMatchingCallObserved = rows.filter((record) => record.businessSegment === "new" && record.status === "later_matching_call_observed").length;
  totals.newBusinessHarvestQueue = totals.openNewBusinessCandidates + totals.newBusinessMatchingUnavailable;
  totals.highPriorityNewBusiness = rows.filter((record) => record.businessSegment === "new" && record.reviewPriority === "high").length;

  const salespersonRows = groupRows(
    rows,
    (record) => record.salesperson,
    (name) => seedGroup(name, { salesperson: name })
  ).sort((a, b) => b.openCandidates - a.openCandidates || b.candidateCalls - a.candidateCalls || a.salesperson.localeCompare(b.salesperson));

  const sourceRows = groupRows(
    rows,
    (record) => record.source,
    (name) => seedGroup(name, { source: name })
  ).sort((a, b) => b.openCandidates - a.openCandidates || b.candidateCalls - a.candidateCalls || a.source.localeCompare(b.source));

  const statusRows = groupRows(
    rows,
    (record) => record.status,
    (status) => seedGroup(status, { status, statusLabel: rows.find((record) => record.status === status)?.statusLabel || status })
  ).sort((a, b) => b.candidateCalls - a.candidateCalls || a.status.localeCompare(b.status));

  const priorityRows = groupRows(
    rows,
    (record) => record.reviewPriority,
    (priority) => seedGroup(priority, { priority })
  ).sort((a, b) => b.candidateCalls - a.candidateCalls || a.priority.localeCompare(b.priority));

  const objectionRows = groupRows(
    rows,
    (record) => record.objectionType,
    (type, record) => seedGroup(type, { objectionType: type, objectionLabel: record.objectionLabel || type })
  ).sort((a, b) => b.candidateCalls - a.candidateCalls || a.objectionLabel.localeCompare(b.objectionLabel));

  const handlingRows = groupRows(
    rows,
    (record) => record.salespersonHandlingType,
    (type, record) => seedGroup(type, { salespersonHandlingType: type, salespersonHandlingLabel: record.salespersonHandlingLabel || type })
  ).sort((a, b) => b.candidateCalls - a.candidateCalls || a.salespersonHandlingLabel.localeCompare(b.salespersonHandlingLabel));

  return {
    totals,
    salespersonRows,
    sourceRows,
    statusRows,
    priorityRows,
    objectionRows,
    handlingRows,
    latestRows: rows
      .filter((record) => record.status !== "later_matching_call_observed")
      .sort((a, b) => b.timestamp - a.timestamp || a.callId.localeCompare(b.callId))
      .slice(0, 40),
    records: rows
  };
}

function buildLeadHarvestModel(items = []) {
  const byStableKey = buildCallIndex(items);
  const records = items
    .map((item) => buildCandidateRecord(item, byStableKey))
    .filter(Boolean)
    .sort((a, b) => {
      const priorityOrder = { high: 0, manual_check: 1, normal: 2 };
      return (priorityOrder[a.reviewPriority] ?? 9) - (priorityOrder[b.reviewPriority] ?? 9) ||
        b.timestamp - a.timestamp ||
        a.callId.localeCompare(b.callId);
    });

  return {
    schemaVersion: "sales_dashboard_lead_harvest.v1",
    definitions: {
      leadHarvestCandidate: "New Business call-data record with deterministic live-human, positive-response, and callback/follow-up evidence. It is a review queue, not a confirmed sale.",
      recordMatching: "Later matching calls use stable customer/contact/lead IDs only. Redacted phone values and parked allocation data are not used.",
      openCandidate: "Candidate where no later matching call appears in the active call data.",
      matchingUnavailable: "Candidate with no stable matching ID. It can still be reviewed, but the dashboard cannot prove whether a later call happened.",
      laterMatchingCallObserved: "A later call to the same stable ID appears in the active data. This does not prove the follow-up was completed.",
      objectionTags: "Objection tags are deterministic transcript indicators from customer turns only, not final manager-confirmed truth.",
      salespersonHandlingTags: "Salesperson handling tags are deterministic transcript indicators from salesperson turns only, not final coaching judgements."
    },
    ...summarizeLeadHarvestRecords(records)
  };
}

module.exports = {
  buildLeadHarvestModel,
  candidateSignals,
  summarizeLeadHarvestRecords
};
