"use strict";

const { parseTranscriptTurns } = require("./transcriptEvaluator");

const COMMERCIAL_STATE_SCHEMA_VERSION = "call_commercial_state.v1";
const CALL_INTELLIGENCE_AGGREGATE_SCHEMA_VERSION = "call_intelligence_aggregate.v1";

const SPECIALIST_GOALS = [
  "offer_acceptance_classification",
  "callback_opportunity",
  "objection_handling",
  "procedure_adherence",
  "lead_record_disposition_evidence_audit"
];

const DAY_INDEX = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6]
]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function isoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseSourceDate(call = {}) {
  const value = clean(call.date || call.callDate || call.sourceTime || call.call_date);
  const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return parsed;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function unresolvedRelativeDate(raw, reason) {
  return {
    raw: clean(raw),
    resolvedDate: "",
    sourceDate: "",
    timeZoneBasis: "Source call time (AEST)",
    resolutionStatus: "unresolved",
    ambiguity: "unknown",
    method: "none",
    reason
  };
}

function resolveRelativeDate(raw, call = {}) {
  const phrase = clean(raw);
  if (!phrase) return unresolvedRelativeDate(raw, "No relative timing phrase was supplied.");
  const sourceDate = parseSourceDate(call);
  if (!sourceDate) return unresolvedRelativeDate(raw, "The source call date was unavailable or was not valid Australian DD/MM/YYYY.");
  const lower = phrase.toLocaleLowerCase();
  let resolved = null;
  let ambiguity = "none";
  let method = "";
  if (/\btomorrow\b/.test(lower)) {
    resolved = addDays(sourceDate, 1);
    method = "relative_day";
  } else {
    const inDays = /\bin\s+(\d{1,3})\s+days?\b/.exec(lower);
    const inWeeks = /\bin\s+(\d{1,2})\s+weeks?\b/.exec(lower);
    const weekday = /\b(next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
    if (inDays) {
      resolved = addDays(sourceDate, Number(inDays[1]));
      method = "relative_day_count";
    } else if (inWeeks) {
      resolved = addDays(sourceDate, Number(inWeeks[1]) * 7);
      method = "relative_week_count";
    } else if (weekday) {
      const target = DAY_INDEX.get(weekday[2]);
      let delta = (target - sourceDate.getUTCDay() + 7) % 7;
      if (weekday[1] === "next" && delta === 0) delta = 7;
      resolved = addDays(sourceDate, delta);
      method = "next_occurring_weekday_after_source_date";
      ambiguity = "possible";
    }
  }
  if (!resolved) {
    const result = unresolvedRelativeDate(raw, "The timing phrase is retained but is outside the supported deterministic resolver.");
    result.sourceDate = isoDate(sourceDate);
    return result;
  }
  return {
    raw: phrase,
    resolvedDate: isoDate(resolved),
    sourceDate: isoDate(sourceDate),
    timeZoneBasis: "Source call time (AEST)",
    resolutionStatus: ambiguity === "none" ? "resolved" : "resolved_with_policy",
    ambiguity,
    method,
    reason: ambiguity === "possible"
      ? "Weekday wording can vary by speaker; resolved using the next-occurring-weekday policy and the raw phrase is retained."
      : "Resolved deterministically from the source call date."
  };
}

function evidenceClaim({ claimType, value, sourceType, sourceReference = "", evidence = "", explicit = false, validationStatus = "not_applicable" }) {
  return {
    claimType,
    value: value === undefined ? null : value,
    sourceType,
    sourceReference: clean(sourceReference),
    evidence: clean(evidence),
    explicit: Boolean(explicit),
    validationStatus
  };
}

function resultForGoal(results, goal) {
  return (results || [])
    .filter((result) => result && result.isLatest !== false && result.evaluationGoal === goal)
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
}

function speakerType(value) {
  const speaker = clean(value).toLocaleLowerCase();
  if (/sales|agent|caller|representative|consultant/.test(speaker)) return "salesperson";
  if (/customer|recipient|prospect|client|callee/.test(speaker)) return "customer";
  return "unknown";
}

function strongestTranscriptEvidence(call = {}, quotedValue = null) {
  const turns = parseTranscriptTurns(clean(call.transcript));
  const escapedAmount = quotedValue === null
    ? ""
    : String(quotedValue).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const amountPattern = escapedAmount ? new RegExp(`(?:\\$|aud\\s*|nzd\\s*)?${escapedAmount}\\b`, "i") : null;
  const scoredOfferTurns = turns.map((turn, index) => {
    const text = clean(turn.text);
    let score = speakerType(turn.speaker) === "salesperson" ? 2 : 0;
    if (amountPattern?.test(text)) score += 8;
    if (/\b(offer|package|option|advert|ad|support|booking|price|cost|including gst|journal|magazine)\b/i.test(text)) score += 3;
    return { index, text, score };
  }).filter((item) => item.text && item.score > 2).sort((left, right) => right.score - left.score || left.index - right.index);
  const offer = scoredOfferTurns[0] || null;
  const acceptedPattern = /\b(we(?:'|’)ll do it|we will do it|go ahead|i agree|yes please|send (?:me )?the invoice|book (?:it|us)|put us (?:in|down)|i(?:'|’)ll take it|sounds good,? let(?:'|’)s do it|sure,? we(?:'|’)ll do it)\b/i;
  const response = turns.map((turn, index) => ({
    index,
    text: clean(turn.text),
    speaker: speakerType(turn.speaker)
  })).filter((item) => item.text
    && item.speaker === "customer"
    && (!offer || item.index >= offer.index)
    && acceptedPattern.test(item.text))
    .sort((left, right) => left.index - right.index)[0] || null;
  return {
    offer: offer?.text || "",
    acceptance: response?.text || ""
  };
}

function specialistHasIssue(result = {}) {
  if (result.status !== "usable") return false;
  if (result.evaluationGoal === "offer_acceptance_classification") {
    return result.acceptanceAssessment?.classification === "customer_accepted_offer";
  }
  if (result.evaluationGoal === "lead_record_disposition_evidence_audit") {
    return ["supported_invalidity", "supported_operational_unusability", "contradictory_evidence"]
      .includes(result.auditAssessment?.recordEvidence?.classification);
  }
  const assessment = result.specialistAssessment || {};
  if (result.evaluationGoal === "procedure_adherence") return assessment.outcome === "issue_found";
  if (result.evaluationGoal === "objection_handling") return assessment.outcome === "handling_gap";
  if (result.evaluationGoal === "callback_opportunity") return ["requested", "promised", "timing_only"].includes(assessment.callbackState);
  return Boolean(result.managerReviewRecommended);
}

function routingState(goal, foundation, result) {
  if (result) {
    if (result.status === "failed") return "failed";
    if (result.status === "insufficient_evidence") return "evaluated_insufficient_evidence";
    if (["callback_opportunity", "procedure_adherence", "objection_handling"].includes(goal)
      && (!result.specialistAssessment || result.evaluationAudit?.validationStatus === "legacy_generic_contract")) {
      return "evaluated_legacy_untyped";
    }
    return specialistHasIssue(result) ? "evaluated_issue_found" : "evaluated_clear";
  }
  if (!foundation) return "not_evaluated";
  return foundation.specialistRoutes?.[goal] === true ? "routed_pending" : "not_routed_no_trigger";
}

function acceptanceState(offerResult, foundation) {
  const classification = offerResult?.acceptanceAssessment?.classification;
  if (classification === "customer_accepted_offer") return "accepted_offer_signal";
  if (classification === "interested_follow_up_only") return "interest_or_follow_up_only";
  if (classification === "no_sale_signal") return "no_sale_signal";
  if (foundation?.customerOutcome === "accepted_offer_signal") return "candidate_accepted_offer_signal";
  return "unknown";
}

function acceptanceStrength(offerResult) {
  const commitment = offerResult?.acceptanceAssessment?.customerCommitment;
  if (commitment === "explicit_unconditional_agreement") return "explicit";
  if (commitment === "acceptance_action_completed") return "acceptance_action_completed";
  if (commitment === "conditional_or_pending") return "conditional";
  if (commitment === "interest_only") return "tentative_interest";
  if (commitment === "none") return "none";
  return "unknown";
}

function confidenceReason(result) {
  if (!result) return { band: "unknown", reason: "No authoritative specialist result is stored.", auditValue: null };
  const offer = result.acceptanceAssessment;
  const exactOffer = clean(offer?.offerEvidence?.quote);
  const exactResponse = clean(offer?.customerResponseEvidence?.quote);
  const band = result.confidenceBand || "unknown";
  const reason = result.status !== "usable"
    ? `The evaluator status is ${result.status || "unknown"}.`
    : exactOffer && exactResponse
      ? "The presented offer and customer response both have validated transcript excerpts."
      : result.evidenceAvailability === "available"
        ? "Validated transcript evidence is available."
        : "Evidence is incomplete or unavailable.";
  return { band, reason, auditValue: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : null };
}

function buildCommercialState({ foundation, offerResult, call }) {
  const commercial = foundation?.commercialContext || {};
  const quotedAmountAvailable = commercial.quoted_amount_available === true && Number.isFinite(Number(commercial.quoted_amount));
  const currency = clean(commercial.currency) || "unknown";
  const transcript = clean(call?.transcript);
  const currencyExplicit = /\bAUD\b|\bNZD\b|A\$|NZ\$/i.test(transcript);
  const timing = resolveRelativeDate(foundation?.followUpTiming || "", call || {});
  const offerState = acceptanceState(offerResult, foundation);
  const accepted = offerState === "accepted_offer_signal";
  return {
    schemaVersion: COMMERCIAL_STATE_SCHEMA_VERSION,
    offerState,
    acceptanceStrength: acceptanceStrength(offerResult),
    quotedValue: quotedAmountAvailable ? Number(commercial.quoted_amount) : null,
    quotedValueState: quotedAmountAvailable ? "quoted_transcript_context" : "unknown",
    quotedValueReviewRequired: quotedAmountAvailable && Number(commercial.quoted_amount) >= 10000,
    quotedCurrency: quotedAmountAvailable ? currency : "unknown",
    currencyBasis: quotedAmountAvailable ? (currencyExplicit ? "explicit" : currency === "unknown" ? "unknown" : "metadata_inferred") : "unknown",
    paymentState: accepted && timing.raw ? "customer_stated_intention" : "not_established",
    intendedPaymentDateRaw: timing.raw,
    intendedPaymentDateResolved: timing.resolvedDate,
    intendedPaymentDateResolution: timing,
    paymentVerificationState: "not_verified",
    invoiceState: "unknown",
    fulfilmentState: "unknown",
    revenueState: "unknown",
    crmState: "unknown"
  };
}

function buildConflicts(foundation, offerResult) {
  if (!foundation || !offerResult?.acceptanceAssessment) return [];
  const specialistAccepted = offerResult.acceptanceAssessment.classification === "customer_accepted_offer";
  const foundationAccepted = foundation.customerOutcome === "accepted_offer_signal";
  if (specialistAccepted === foundationAccepted) return [];
  return [{
    type: "foundation_specialist_acceptance_disagreement",
    foundationValue: foundation.customerOutcome || "unknown",
    specialistValue: offerResult.acceptanceAssessment.classification || "unknown",
    resolutionRule: "offer_acceptance_specialist_authoritative",
    resolvedValue: offerResult.acceptanceAssessment.classification || "unknown",
    status: "resolved_by_policy",
    reviewRecommended: false,
    sourceResultIds: [foundation.sourceResultId, offerResult.id].filter(Boolean)
  }];
}

function buildCallIntelligenceAggregate({ results = [], call = {}, foundationContext = null, offerAcceptanceContext = null } = {}) {
  const offerResult = resultForGoal(results, "offer_acceptance_classification") || (offerAcceptanceContext ? {
    ...offerAcceptanceContext,
    id: offerAcceptanceContext.sourceResultId,
    evaluationGoal: "offer_acceptance_classification"
  } : null);
  const foundationResult = resultForGoal(results, "call_intelligence_foundation");
  const sourceFoundation = foundationContext || foundationResult?.foundationAssessment || null;
  const foundation = sourceFoundation ? {
    ...sourceFoundation,
    sourceResultId: sourceFoundation.sourceResultId || foundationResult?.id || ""
  } : null;
  const commercialState = buildCommercialState({ foundation, offerResult, call });
  const strongestEvidence = strongestTranscriptEvidence(call, commercialState.quotedValue);
  const acceptanceEvidence = offerResult?.acceptanceAssessment?.customerResponseEvidence?.quote || strongestEvidence.acceptance || "";
  const offerEvidence = offerResult?.acceptanceAssessment?.offerEvidence?.quote || strongestEvidence.offer || "";
  const timingEvidence = (foundation?.evidence || []).find((item) => item.supports === "follow_up_timing")?.quote || "";
  const routing = Object.fromEntries(SPECIALIST_GOALS.map((goal) => {
    const specialist = resultForGoal(results, goal);
    return [goal, {
      state: routingState(goal, foundation, specialist),
      routedByFoundation: foundation?.specialistRoutes?.[goal] === true,
      resultId: specialist?.id || "",
      resultStatus: specialist?.status || "not_evaluated"
    }];
  }));
  const claims = [
    evidenceClaim({ claimType: "customer_id", value: call.customerId || call.customer_id || "Not available", sourceType: "call_metadata", sourceReference: "customer_id", explicit: true }),
    evidenceClaim({ claimType: "salesperson", value: call.salesperson || "Not available", sourceType: "call_metadata", sourceReference: "Salesperson", explicit: true }),
    evidenceClaim({ claimType: "source", value: call.source || call.customerImportSource || "Not available", sourceType: "call_metadata", sourceReference: "CustomerImportSource", explicit: true }),
    evidenceClaim({ claimType: "accepted_offer", value: commercialState.offerState, sourceType: offerResult ? "specialist_result" : "foundation_result", sourceReference: offerResult?.id || foundation?.sourceResultId || "", evidence: acceptanceEvidence, explicit: Boolean(acceptanceEvidence), validationStatus: acceptanceEvidence ? "exact_transcript_excerpt" : "unverified" }),
    evidenceClaim({ claimType: "quoted_value", value: commercialState.quotedValue, sourceType: "foundation_result", sourceReference: foundation?.sourceResultId || "", evidence: offerEvidence, explicit: commercialState.quotedValue !== null, validationStatus: commercialState.quotedValueReviewRequired ? "implausible_transcript_amount_review_required" : commercialState.quotedValue !== null ? "transcript_context" : "unknown" }),
    evidenceClaim({ claimType: "payment_state", value: commercialState.paymentState, sourceType: "deterministic_derivation", sourceReference: foundation?.sourceResultId || "", evidence: timingEvidence, explicit: false, validationStatus: timingEvidence ? "derived_from_exact_transcript_excerpt" : "unknown" }),
    evidenceClaim({ claimType: "intended_payment_date", value: commercialState.intendedPaymentDateResolved || "unknown", sourceType: "deterministic_derivation", sourceReference: commercialState.intendedPaymentDateResolution.method, evidence: commercialState.intendedPaymentDateRaw, explicit: false, validationStatus: commercialState.intendedPaymentDateResolution.resolutionStatus })
  ];
  const accepted = commercialState.offerState === "accepted_offer_signal";
  const date = commercialState.intendedPaymentDateResolved;
  const quotedValueSummary = commercialState.quotedValue === null
    ? ""
    : commercialState.quotedValueReviewRequired
      ? ` Transcript-extracted quoted amount ${commercialState.quotedCurrency === "unknown" ? "" : `${commercialState.quotedCurrency} `}${commercialState.quotedValue} requires review before use.`
      : ` Quoted value ${commercialState.quotedCurrency === "unknown" ? "" : `${commercialState.quotedCurrency} `}${commercialState.quotedValue}.`;
  const authoritativeSummary = accepted
    ? `Accepted offer — payment pending verification.${quotedValueSummary}${date ? ` Customer-stated payment timing resolves to ${date}.` : ""} Payment receipt, invoicing, fulfilment, revenue and CRM closure are not established.`
    : offerResult?.managerSummary || foundationResult?.managerSummary || "No authoritative commercial outcome is established.";
  return {
    schemaVersion: CALL_INTELLIGENCE_AGGREGATE_SCHEMA_VERSION,
    authoritativeResult: {
      evaluationGoal: offerResult ? "offer_acceptance_classification" : foundation ? "call_intelligence_foundation" : "none",
      resultId: offerResult?.id || foundation?.sourceResultId || "",
      summary: authoritativeSummary
    },
    commercialState,
    keyEvidence: {
      offer: offerEvidence,
      acceptance: acceptanceEvidence,
      paymentTiming: timingEvidence
    },
    confidence: confidenceReason(offerResult || foundationResult),
    routing,
    conflicts: buildConflicts(foundation, offerResult),
    followUp: call.followUpMatch || {
      status: call.followUpStatus || "unknown",
      matchedCallId: call.followUpMatchedCallId || "",
      verificationStatus: call.followUpMatchedCallId ? "legacy_match_details_unavailable" : "not_observed"
    },
    provenanceClaims: claims,
    operationalNextAction: accepted
      ? date
        ? `Verify payment on or after ${date}; update administration or CRM only from verified external evidence.`
        : "Verify payment status through an external administration or CRM record."
      : foundation?.nextStepStatus === "actionable"
        ? "Complete the transcript-grounded next step and record its verified outcome."
        : "No verified commercial next action is established."
  };
}

module.exports = {
  CALL_INTELLIGENCE_AGGREGATE_SCHEMA_VERSION,
  COMMERCIAL_STATE_SCHEMA_VERSION,
  SPECIALIST_GOALS,
  buildCallIntelligenceAggregate,
  parseSourceDate,
  resolveRelativeDate
};
