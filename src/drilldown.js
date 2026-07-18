"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { clean, isMissing, parseTranscriptTurns, toInt } = require("./transcriptEvaluator");
const { SOURCE_AGE_THRESHOLDS, regionNameFor, sourceAttributionFor } = require("./sourceQuality");
const { formatSourceDateTimeValue } = require("./dateTimeFormat");
const { isUntrustedLegacyField } = require("./untrustedLegacyFields");

const EXCLUDED_RAW_FIELDS = new Set([
  "__rowNumber",
  "dialled_phone_number",
  "CustomerCreateDate",
  "CustomerImportDate"
]);

function confidenceBandForItem(item) {
  const quality = item?.evaluation?.transcript?.qualityBand || "";
  if (["high", "medium", "low", "unusable"].includes(quality)) return quality;
  const confidence = Number(item?.evaluation?.outcome?.confidence ?? item?.evaluation?.contact?.confidence);
  if (!Number.isFinite(confidence) || confidence <= 0) return "unknown";
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

function confidenceLabelForBand(band) {
  if (band === "high") return "High confidence";
  if (band === "medium") return "Medium confidence";
  if (band === "low") return "Low confidence";
  if (band === "unusable") return "Unusable transcript";
  return "Confidence unavailable";
}

function rowGovernance(item) {
  const band = confidenceBandForItem(item);
  return {
    intelligenceProvenance: "Deterministic",
    llmStatus: "not_requested",
    llmProvenance: "Unprocessed",
    managerReviewProvenance: "Unprocessed",
    rawImportedProvenance: "Raw imported",
    contactClassificationProvenance: "Deterministic",
    localOutcomeProvenance: "Deterministic",
    followUpProvenance: "Deterministic",
    alertProvenance: "Deterministic",
    deterministicConfidence: Number(item?.evaluation?.outcome?.confidence ?? item?.evaluation?.contact?.confidence ?? 0),
    confidenceBand: band,
    confidenceLabel: confidenceLabelForBand(band),
    evidenceAvailable: Boolean(item?.evaluation?.evidence?.length)
  };
}

const METRICS = {
  "calls.unique": {
    title: "Unique Calls",
    description: "Every deduplicated call row included in this import.",
    kind: "call"
  },
  "calls.newBusiness": {
    title: "New Business Calls",
    description: "Calls where OrderCount is blank, NULL, or zero, meaning No Sales History.",
    kind: "call"
  },
  "calls.warmBusiness": {
    title: "Warm Business Calls",
    description: "Calls where OrderCount is greater than zero.",
    kind: "call"
  },
  "calls.transcriptAvailable": {
    title: "Transcript Available",
    description: "Calls where the transcription field contains text. Blank transcripts are treated as no pickup/no answer in this dataset.",
    kind: "call"
  },
  "calls.transcriptUsableForCoaching": {
    title: "Transcript-Derived Coverage",
    description: "Calls whose transcript quality is sufficient for coaching-style deterministic conclusions.",
    kind: "call"
  },
  "calls.lowOrUnusableTranscript": {
    title: "Low Or Unusable Transcripts",
    description: "Calls in the low-confidence or unusable transcript bands. These rows require proof review before coaching conclusions.",
    kind: "call"
  },
  "calls.probableLiveHuman": {
    title: "Probable Live-Human Calls",
    description: "Calls where transcript evidence suggests the salesperson reached a person.",
    kind: "call"
  },
  "calls.meaningfulConversation": {
    title: "Meaningful Conversations",
    description: "Calls with probable live-human contact and enough duration or transcript substance to review.",
    kind: "call"
  },
  "calls.followUpRequired": {
    title: "Follow-Up Signals",
    description: "Calls where the local evaluator found a callback, information, quote, appointment, or interest signal.",
    kind: "call"
  },
  "calls.followUpIndeterminate": {
    title: "Follow-Ups Needing More Future Data",
    description: "Follow-up signals where the current upload does not contain enough later data to prove completion.",
    kind: "call"
  },
  "calls.aiVoiceAssistant": {
    title: "AI Call Assistant Encounters",
    description: "Calls where explicit AI assistant, call assistant, or screened-call language was detected.",
    kind: "call"
  },
  "calls.aiVoiceAssistantHandled": {
    title: "AI Call Assistant Handled Well",
    description: "AI call assistant encounters where the salesperson left a structured response.",
    kind: "call"
  },
  "calls.aiVoiceAssistantBailed": {
    title: "AI Call Assistant Bail Events",
    description: "AI call assistant encounters where the salesperson did not leave a useful response.",
    kind: "call"
  },
  "calls.aiVoiceAssistantFutureHuman": {
    title: "AI Call Assistant Future Human Contact",
    description: "AI call assistant encounters followed by a later probable live-human call to the same stable customer or lead.",
    kind: "call"
  },
  "calls.systemAudio": {
    title: "System Audio Barriers",
    description: "Calls where automated/system audio was detected, including call screening, carrier phone-system audio, and machine voicemail.",
    kind: "systemAudio"
  },
  "calls.systemAudio.call_screening": {
    title: "Call Screening / AI Assistant",
    description: "System-audio barriers where the transcript asks the caller to identify themselves, give a reason, or pass through a call assistant.",
    kind: "systemAudio"
  },
  "calls.systemAudio.carrier_phone_system": {
    title: "Carrier / Phone System",
    description: "System-audio barriers such as busy, unavailable, disconnected, or could-not-connect messages.",
    kind: "systemAudio"
  },
  "calls.systemAudio.machine_voicemail": {
    title: "Machine Voicemail",
    description: "Machine voicemail greetings and mailbox messages.",
    kind: "systemAudio"
  },
  "calls.systemAudio.ambiguous_system_audio": {
    title: "Ambiguous System Audio",
    description: "Automated/system audio that needs a more specific subtype rule.",
    kind: "systemAudio"
  },
  "calls.systemAudioHandled": {
    title: "System Audio Handled Well",
    description: "Call-screening encounters where the salesperson left a useful response.",
    kind: "systemAudio"
  },
  "calls.systemAudioBailed": {
    title: "System Audio Bail Events",
    description: "Call-screening encounters where the salesperson did not leave a useful response.",
    kind: "systemAudio"
  },
  "calls.systemAudioRecovered": {
    title: "System Audio Recovered Later",
    description: "System-audio encounters followed by a later probable live-human call to the same stable customer or lead.",
    kind: "systemAudio"
  },
  "calls.riskReviews": {
    title: "Risk Reviews",
    description: "Calls with complaint or opt-out style transcript signals.",
    kind: "call"
  },
  "source.bulkSourced": {
    title: "Bulk Sourced Calls",
    description: "Calls with a CustomerImportSource or valid CustomerImportDate from bulk lead sourcing.",
    kind: "call"
  },
  "source.manualCreated": {
    title: "Manual LG/SP Created Calls",
    description: "Calls with CustomerCreatedBy, CustomerCreatedByType, or valid CustomerCreateDate from manual entry.",
    kind: "call"
  },
  "source.missingAttribution": {
    title: "Self Sourced Without Raw Attribution",
    description: "Calls categorized as Self Sourced because both bulk import evidence and manual creator evidence are blank.",
    kind: "call"
  },
  "source.recordAgeAvailable": {
    title: "Calls With Record Age",
    description: "Calls with a valid CustomerImportDate or fallback CustomerCreateDate that can be used to calculate record age.",
    kind: "call"
  },
  "source.newBusinessImportedOlderThan": {
    title: "New Business Record Age Older Than Threshold",
    description: "New Business calls where Record Age is more than the selected number of days before the call date. Record Age uses CustomerImportDate first, then CustomerCreateDate.",
    kind: "call"
  },
  "source.newBusinessRecordOlderThan": {
    title: "New Business Record Age Older Than Threshold",
    description: "New Business calls where Record Age is more than the selected number of days before the call date. Record Age uses CustomerImportDate first, then CustomerCreateDate.",
    kind: "call"
  },
  "alerts.critical": {
    title: "Critical Alerts",
    description: "Critical alert events and the calls that produced them.",
    kind: "call"
  },
  "alerts.warning": {
    title: "Warning Alerts",
    description: "Warning alert events and the calls that produced them.",
    kind: "call"
  },
  "alerts.notice": {
    title: "Notice Alerts",
    description: "Notice alert events and the calls that produced them.",
    kind: "call"
  },
  "lead.stableLeadDaysWorked": {
    title: "Matched Records Worked",
    description: "Matched customer/contact records built from source IDs. Redacted phone values are not used.",
    kind: "lead"
  },
  "lead.callbackSameDayRequired": {
    title: "Explicit Same-Day Callback Duties",
    description: "Explicit customer callback requests or salesperson callback promises without future-day wording.",
    kind: "lead"
  },
  "lead.callbackCompletedSameDay": {
    title: "Callbacks With Later Same-Day Call",
    description: "Explicit callback duties with a later same-day call to the same matched target.",
    kind: "lead"
  },
  "lead.callbackMissedSameDay": {
    title: "Callbacks Missed Same Day",
    description: "Explicit callback duties with no later same-day call to the same matched target.",
    kind: "lead"
  },
  "lead.callbackFutureNeedsUpload": {
    title: "Future Callback Pending",
    description: "Callback duties with future-day wording that require later CSV uploads before judgement.",
    kind: "lead"
  },
  "lead.noContactLeadDays": {
    title: "No-Contact Matched Records",
    description: "Matched records where every call attempt was no-answer, voicemail, system audio, unknown, or otherwise not live-human.",
    kind: "lead"
  },
  "lead.noContactRetriedSameDay": {
    title: "No-Contact Records Retried Same Day",
    description: "No-contact matched records with more than one same-day attempt.",
    kind: "lead"
  },
  "lead.singleAttemptNoContact": {
    title: "Single-Attempt No-Contact Records",
    description: "No-contact matched records with only one attempt and no same-day retry.",
    kind: "lead"
  },
  "lead.wastedLeadIndicators": {
    title: "Legacy Utilisation Review Indicators",
    description: "Legacy matched-record proof rows retained for older reports. Use the one-dial no-contact/no-later drill-down for conservative manager reporting.",
    kind: "lead"
  },
  "reattempt.leadsTouched": {
    title: "Reattempt Records",
    description: "Matched customer/contact records dialed by each salesperson.",
    kind: "reattempt"
  },
  "reattempt.personalRetried": {
    title: "Personally Retried Records",
    description: "Matched records where the same salesperson made more than one call in the current upload.",
    kind: "reattempt"
  },
  "reattempt.oneAndDone": {
    title: "One-Dial Records",
    description: "Matched records where the salesperson made exactly one call in the current upload. This is neutral until split into valid, risky, and review buckets.",
    kind: "reattempt"
  },
  "reattempt.oneDialValidOutcome": {
    title: "Valid One-Dial Outcomes",
    description: "One-dial records with deterministic evidence of a clear terminal outcome such as wrong number, not interested, complaint, or opt-out.",
    kind: "reattempt"
  },
  "reattempt.oneDialRiskyNoContact": {
    title: "One-Dial No-Contact",
    description: "One-dial records with clear no-contact evidence: no answer, voicemail, system audio, or no usable speech evidence.",
    kind: "reattempt"
  },
  "reattempt.oneDialNoContactNoLater": {
    title: "Potential Lead Under-Utilisation",
    description: "One-dial no-contact records with no later matching call observed for the same stable customer/contact/lead ID.",
    kind: "reattempt"
  },
  "reattempt.oneDialNeedsReview": {
    title: "Ambiguous One-Dial Records Excluded",
    description: "One-dial records that are ambiguous or contain follow-up/interest signals. These are excluded from the no-contact utilisation-risk score.",
    kind: "reattempt"
  },
  "reattempt.noLaterCallByAnyone": {
    title: "No Later Call By Anyone",
    description: "Matched records where no later call by any salesperson appears after this salesperson's first dial in the current upload.",
    kind: "reattempt"
  },
  "reattempt.maxAttemptsOnOneLead": {
    title: "Max Attempts On One Record",
    description: "Matched records matching the highest same-salesperson attempt count in this scope.",
    kind: "reattempt"
  },
  "harvest.newBusinessCandidates": {
    title: "New Business Lead Harvest Candidates",
    description: "New Business calls with deterministic live-human, positive-response, and callback/follow-up evidence. These are review candidates, not confirmed sales.",
    kind: "harvest"
  },
  "harvest.warmBusinessCandidates": {
    title: "Warm Business Lead Harvest Candidates",
    description: "Warm Business calls with deterministic live-human, positive-response, and callback/follow-up evidence. These are review candidates, not confirmed sales.",
    kind: "harvest"
  },
  "harvest.openCandidates": {
    title: "Open Lead Harvest Candidates",
    description: "Lead harvest candidates where no later matching call appears in the active call data. Stable IDs are used for matching; phone values and allocation data are not used.",
    kind: "harvest"
  },
  "harvest.reviewQueue": {
    title: "Lead Harvest Review Queue",
    description: "Lead harvest candidates that need manager review: no later matching call observed or matching unavailable from the active stable IDs.",
    kind: "harvest"
  },
  "harvest.laterObserved": {
    title: "Harvest Candidates With Later Matching Call Observed",
    description: "Lead harvest candidates where a later call to the same stable customer/contact/lead ID appears in the active data. This does not prove completion.",
    kind: "harvest"
  },
  "harvest.matchingUnavailable": {
    title: "Harvest Candidates With Matching Unavailable",
    description: "Lead harvest candidates missing a stable matching ID, so later-call follow-up cannot be proven from the active data.",
    kind: "harvest"
  }
};

function stableIdsFor(row) {
  return ENTITY_FIELDS
    .map((field) => {
      const value = clean(row[field]);
      return isMissing(value) ? null : { field, value };
    })
    .filter(Boolean);
}

function customerIdFor(row) {
  const value = clean(row.customer_id);
  return isMissing(value) ? "" : value;
}

function contactIdFor(row) {
  const value = clean(row.ContactId);
  return isMissing(value) ? "" : value;
}

function rawFieldsFor(row) {
  return Object.keys(row)
    .filter((field) => !EXCLUDED_RAW_FIELDS.has(field) && !isUntrustedLegacyField(field) && field !== "transcription_text")
    .reduce((fields, field) => {
      fields[field] = clean(row[field]);
      return fields;
    }, {});
}

function orderCountFor(row) {
  const value = toInt(row.OrderCount);
  return value === null ? 0 : value;
}

function orderHistoryLabel(row) {
  return orderCountFor(row) > 0 ? "Previous Sales History" : "No Sales History";
}

function businessSegmentForRow(row) {
  return orderCountFor(row) > 0 ? "warm" : "new";
}

function businessSegmentLabel(segment) {
  if (segment === "warm") return "Warm Business";
  if (segment === "new") return "New Business";
  return "";
}

function normalizeBusinessSegment(value) {
  const text = clean(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(text)) return "warm";
  if (["new", "new_business"].includes(text)) return "new";
  return "";
}

function normalizeMinImportAgeDays(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(number, 36500));
}

function metricKeysForItem(item) {
  const keys = ["calls.unique"];
  const businessSegment = businessSegmentForRow(item.row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
  keys.push(businessSegment === "warm" ? "calls.warmBusiness" : "calls.newBusiness");
  if (item.evaluation.transcript.available) keys.push("calls.transcriptAvailable");
  if (item.evaluation.transcript.usableForCoaching) keys.push("calls.transcriptUsableForCoaching");
  if (["low", "unusable"].includes(confidenceBandForItem(item))) keys.push("calls.lowOrUnusableTranscript");
  if (item.evaluation.contact.probableLiveHuman) keys.push("calls.probableLiveHuman");
  if (item.evaluation.contact.meaningfulConversation) keys.push("calls.meaningfulConversation");
  if (item.evaluation.opportunity.followUpRequired) keys.push("calls.followUpRequired");
  if (item.followUpStatus === "indeterminate_insufficient_future_data") keys.push("calls.followUpIndeterminate");
  if (item.evaluation.aiVoiceAssistant?.detected) keys.push("calls.aiVoiceAssistant");
  if (item.evaluation.aiVoiceAssistant?.handledSuccessfully) keys.push("calls.aiVoiceAssistantHandled");
  if (item.evaluation.aiVoiceAssistant?.bailed) keys.push("calls.aiVoiceAssistantBailed");
  if (item.evaluation.aiVoiceAssistant?.followThrough?.futureHumanContact) keys.push("calls.aiVoiceAssistantFutureHuman");
  if (item.evaluation.systemAudio?.detected) {
    keys.push("calls.systemAudio", `calls.systemAudio.${item.evaluation.systemAudio.subtype}`);
  }
  if (item.evaluation.risk.reviewRequired) keys.push("calls.riskReviews");
  if (sourceAttribution.hasBulkSource) keys.push("source.bulkSourced");
  if (sourceAttribution.hasManualCreator) keys.push("source.manualCreated");
  if (!sourceAttribution.hasBulkSource && !sourceAttribution.hasManualCreator) keys.push("source.missingAttribution");
  if (sourceAttribution.daysSinceRecord !== null) keys.push("source.recordAgeAvailable");
  if (businessSegment === "new" && sourceAttribution.daysSinceImport !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (sourceAttribution.daysSinceImport > threshold) keys.push(`source.newBusinessImportedOlderThan${threshold}`);
    });
  }
  if (businessSegment === "new" && sourceAttribution.daysSinceRecord !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (sourceAttribution.daysSinceRecord > threshold) keys.push(`source.newBusinessRecordOlderThan${threshold}`);
    });
  }
  return keys;
}

function buildCallProofRow(item) {
  const row = item.row;
  const businessSegment = businessSegmentForRow(row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(row, item.dateTime);
  const governance = rowGovernance(item);
  return {
    type: "call",
    callId: clean(row.call_id),
    customerId: customerIdFor(row),
    contactId: contactIdFor(row),
    date: clean(row.call_date),
    time: clean(row.call_time),
    sourceTime: formatSourceDateTimeValue(row.call_date, row.call_time),
    dateTime: item.dateTime ? item.dateTime.toISOString() : null,
    salesperson: clean(row.Salesperson) || "Unknown",
    source: sourceAttribution.customerImportSource,
    region: regionNameFor(row),
    customerImportSource: sourceAttribution.customerImportSource,
    customerImportSourceRaw: sourceAttribution.customerImportSourceRaw,
    customerImportSourceInferred: sourceAttribution.customerImportSourceInferred,
    customerImportSourceInferenceReason: sourceAttribution.customerImportSourceInferenceReason,
    customerImportDate: sourceAttribution.customerImportDate,
    customerImportDateIso: sourceAttribution.customerImportDateIso,
    customerCreatedBy: sourceAttribution.customerCreatedBy,
    customerCreatedByType: sourceAttribution.customerCreatedByType,
    customerCreatedByTypeLabel: sourceAttribution.customerCreatedByTypeLabel,
    customerCreateDate: sourceAttribution.customerCreateDate,
    customerCreateDateIso: sourceAttribution.customerCreateDateIso,
    daysSinceImport: sourceAttribution.daysSinceImport,
    daysSinceCreated: sourceAttribution.daysSinceCreated,
    daysSinceRecord: sourceAttribution.daysSinceRecord,
    recordAgeBasis: sourceAttribution.recordAgeBasis,
    recordAgeBasisLabel: sourceAttribution.recordAgeBasisLabel,
    importAgeBucket: sourceAttribution.importAgeBucket,
    createAgeBucket: sourceAttribution.createAgeBucket,
    recordAgeBucket: sourceAttribution.recordAgeBucket,
    hasBulkSource: sourceAttribution.hasBulkSource,
    hasManualCreator: sourceAttribution.hasManualCreator,
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    orderCount: orderCountFor(row),
    orderHistoryLabel: orderHistoryLabel(row),
    businessSegment,
    businessSegmentLabel: businessSegmentLabel(businessSegment),
    durationSeconds: item.evaluation.durationSeconds,
    totalSeconds: item.evaluation.totalSeconds,
    contactClassification: item.evaluation.contact.classification,
    localOutcome: item.evaluation.outcome.localCategory,
    followUpStatus: item.followUpStatus,
    followUpMatchedCallId: item.followUpMatchedCallId || "",
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    aiVoiceAssistantDetected: Boolean(item.evaluation.aiVoiceAssistant?.detected),
    aiVoiceAssistantConfidence: item.evaluation.aiVoiceAssistant?.confidence || 0,
    aiVoiceAssistantResponse: item.evaluation.aiVoiceAssistant?.responseClassification || "not_encountered",
    aiVoiceAssistantHandledSuccessfully: Boolean(item.evaluation.aiVoiceAssistant?.handledSuccessfully),
    aiVoiceAssistantBailed: Boolean(item.evaluation.aiVoiceAssistant?.bailed),
    aiVoiceAssistantResponseWordCount: item.evaluation.aiVoiceAssistant?.responseWordCount || 0,
    aiVoiceAssistantTactics: item.evaluation.aiVoiceAssistant?.tacticLabels || [],
    aiVoiceAssistantFutureStatus: item.evaluation.aiVoiceAssistant?.followThrough?.status || "not_applicable",
    aiVoiceAssistantFutureCallId: item.evaluation.aiVoiceAssistant?.followThrough?.futureCallId || "",
    systemAudioDetected: Boolean(item.evaluation.systemAudio?.detected),
    systemAudioSubtype: item.evaluation.systemAudio?.subtype || "none",
    systemAudioSubtypeLabel: item.evaluation.systemAudio?.label || "None",
    transcriptQuality: item.evaluation.transcript.qualityBand,
    ...governance,
    stableIds: stableIdsFor(row),
    metricKeys: metricKeysForItem(item),
    evidence: item.evaluation.evidence.map((evidence) => ({
      signal: evidence.signal,
      summary: evidence.summary,
      text: evidence.text,
      turns: evidence.turns || [],
      matchText: evidence.matchText || "",
      confidence: evidence.confidence
    })),
    rawFields: rawFieldsFor(row),
    transcript: clean(row.transcription_text),
    transcriptTurns: parseTranscriptTurns(row.transcription_text).map((turn) => ({
      speaker: turn.speaker,
      text: turn.text
    })),
    transcriptPreview: item.evaluation.preview
  };
}

function metricFor(key) {
  return METRICS[key] || {
    title: key || "Drill-Down",
    description: "Rows contributing to the selected value.",
    kind: "call"
  };
}

function metricMatches(row, metricKey, query = {}) {
  if (metricKey === "source.newBusinessImportedOlderThan" || metricKey === "source.newBusinessRecordOlderThan") {
    const threshold = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, 90);
    const ageDays = metricKey === "source.newBusinessImportedOlderThan" ? row.daysSinceImport : row.daysSinceRecord;
    return row.businessSegment === "new" && ageDays !== null && Number(ageDays) > threshold;
  }
  if (metricKey === "reattempt.maxAttemptsOnOneLead") {
    const attempts = normalizeMinImportAgeDays(query.maxAttempts || query.attempts || query.personalCallCount, null);
    if (attempts !== null) return Number(row.personalCallCount || 0) === attempts;
  }
  return !metricKey || row.metricKeys?.includes(metricKey);
}

function filterRows(rows, query = {}) {
  const metric = clean(query.metric);
  const salesperson = clean(query.salesperson);
  const source = clean(query.source);
  const customerId = clean(query.customerId || query.customer_id);
  const businessSegment = normalizeBusinessSegment(query.businessSegment || query.segment);
  const createdBy = clean(query.createdBy || query.customerCreatedBy);
  const createdByType = clean(query.createdByType || query.customerCreatedByType).toUpperCase();
  const recordAgeBucket = clean(query.recordAgeBucket || query.customerAgeBucket || query.leadAgeBucket);
  const importAgeBucket = clean(query.importAgeBucket);
  const createAgeBucket = clean(query.createAgeBucket || query.creatorAgeBucket);
  const region = clean(query.region || query.callRegion);
  const aiAssistantResponse = clean(query.aiAssistantResponse || query.aiVoiceAssistantResponse);
  const aiAssistantTactic = clean(query.aiAssistantTactic || query.aiVoiceAssistantTactic);
  const systemAudioSubtype = clean(query.systemAudioSubtype || query.systemAudioType);
  const harvestStatus = clean(query.harvestStatus || query.status);
  const confidenceBand = clean(query.confidenceBand || query.confidence);
  const confidenceBands = confidenceBand.split(",").map(clean).filter(Boolean);
  const objectionType = clean(query.objectionType || query.objection);
  const handlingType = clean(query.handlingType || query.salespersonHandlingType);
  const minImportAgeDays = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, null);
  const maxAttempts = normalizeMinImportAgeDays(query.maxAttempts || query.attempts || query.personalCallCount, null);

  return rows.filter((row) => {
    if (metric && !metricMatches(row, metric, { minImportAgeDays, maxAttempts })) return false;
    if (salesperson && row.salesperson !== salesperson) return false;
    if (source && row.source !== source) return false;
    if (customerId && row.customerId !== customerId) return false;
    if (businessSegment && row.businessSegment !== businessSegment) return false;
    if (createdBy && row.customerCreatedBy !== createdBy) return false;
    if (createdByType && row.customerCreatedByType !== createdByType) return false;
    if (recordAgeBucket && row.recordAgeBucket !== recordAgeBucket) return false;
    if (importAgeBucket && row.importAgeBucket !== importAgeBucket) return false;
    if (createAgeBucket && row.createAgeBucket !== createAgeBucket) return false;
    if (region && row.region !== region) return false;
    if (aiAssistantResponse && row.aiVoiceAssistantResponse !== aiAssistantResponse) return false;
    if (aiAssistantTactic && !(row.aiVoiceAssistantTactics || []).includes(aiAssistantTactic)) return false;
    if (systemAudioSubtype && row.systemAudioSubtype !== systemAudioSubtype && row.subtype !== systemAudioSubtype) return false;
    if (harvestStatus && row.status !== harvestStatus) return false;
    if (confidenceBands.length && !confidenceBands.includes(row.confidenceBand)) return false;
    if (objectionType && row.objectionType !== objectionType) return false;
    if (handlingType && row.salespersonHandlingType !== handlingType) return false;
    if (minImportAgeDays !== null && !(row.daysSinceRecord !== null && Number(row.daysSinceRecord) > minImportAgeDays)) return false;
    return true;
  });
}

function sortRows(rows = [], query = {}) {
  const sort = clean(query.sort || query.order).toLowerCase();
  if (!sort) return rows;
  const sorted = [...rows];
  if (sort === "oldest" || sort === "oldest_first") {
    return sorted.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.callId || "").localeCompare(String(b.callId || "")));
  }
  if (sort === "newest" || sort === "newest_first") {
    return sorted.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0) || String(a.callId || "").localeCompare(String(b.callId || "")));
  }
  return rows;
}

function alertRowsForMetric(analysis, metric) {
  const severity = metric.replace("alerts.", "");
  const callRowsById = new Map((analysis.drilldownRows || []).map((row) => [row.callId, row]));
  return (analysis.alerts || [])
    .filter((alert) => alert.severity === severity)
    .map((alert) => {
      const call = callRowsById.get(alert.callId);
      return call ? {
        ...call,
        metricKeys: [...(call.metricKeys || []), metric],
        alertCategory: alert.category,
        alertMessage: alert.message,
        alertEvidence: alert.evidence,
        alertEvidenceSummary: alert.evidenceSummary
      } : null;
    })
    .filter(Boolean);
}

function buildDrilldownResult(analysis, query = {}) {
  const metric = clean(query.metric) || "calls.unique";
  const definition = metricFor(metric);
  const businessSegment = normalizeBusinessSegment(query.businessSegment || query.segment);
  const minImportAgeDays = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, (metric === "source.newBusinessImportedOlderThan" || metric === "source.newBusinessRecordOlderThan") ? 90 : null);
  const maxAttempts = normalizeMinImportAgeDays(query.maxAttempts || query.attempts || query.personalCallCount, null);
  const leadUtilization = definition.kind === "lead" && businessSegment && analysis.businessSegmentViews?.[businessSegment]?.leadUtilization
    ? analysis.businessSegmentViews[businessSegment].leadUtilization
    : analysis.leadUtilization;
  const leadReattempt = definition.kind === "reattempt" && businessSegment && analysis.businessSegmentViews?.[businessSegment]?.leadReattempt
    ? analysis.businessSegmentViews[businessSegment].leadReattempt
    : analysis.leadReattempt;
  const systemAudio = definition.kind === "systemAudio" && businessSegment && analysis.businessSegmentViews?.[businessSegment]?.systemAudio
    ? analysis.businessSegmentViews[businessSegment].systemAudio
    : analysis.systemAudio;
  const leadHarvest = definition.kind === "harvest" && businessSegment && analysis.businessSegmentViews?.[businessSegment]?.leadHarvest
    ? analysis.businessSegmentViews[businessSegment].leadHarvest
    : analysis.leadHarvest;
  const sourceRows = metric.startsWith("alerts.")
    ? alertRowsForMetric(analysis, metric)
    : definition.kind === "lead"
      ? leadUtilization?.records || []
      : definition.kind === "reattempt"
        ? leadReattempt?.records || []
        : definition.kind === "harvest"
          ? leadHarvest?.records || []
        : definition.kind === "systemAudio"
          ? systemAudio?.records || []
      : analysis.drilldownRows || [];
  const rows = sortRows(filterRows(sourceRows, {
    ...query,
    metric,
    businessSegment: definition.kind === "lead" ? "" : businessSegment,
    segment: definition.kind === "lead" ? "" : query.segment
  }), query);
  const limit = Math.max(1, Math.min(Number(query.limit || 500), 10000));
  const offset = Math.max(0, Number(query.offset || 0));
  const displayedRows = rows.slice(offset, offset + limit);

  return {
    schemaVersion: "sales_dashboard_drilldown.v1",
    metric,
    title: (metric === "source.newBusinessImportedOlderThan" || metric === "source.newBusinessRecordOlderThan") ? `New Business Record Age Older Than ${minImportAgeDays} Days` : definition.title,
    description: (metric === "source.newBusinessImportedOlderThan" || metric === "source.newBusinessRecordOlderThan")
      ? `New Business calls where Record Age is more than ${minImportAgeDays} days before the call date. Record Age uses CustomerImportDate first, then CustomerCreateDate.`
      : definition.description,
    kind: definition.kind,
    filters: {
      salesperson: clean(query.salesperson),
      source: clean(query.source),
      customerId: clean(query.customerId || query.customer_id),
      createdBy: clean(query.createdBy || query.customerCreatedBy),
      createdByType: clean(query.createdByType || query.customerCreatedByType).toUpperCase(),
      recordAgeBucket: clean(query.recordAgeBucket || query.customerAgeBucket || query.leadAgeBucket),
      importAgeBucket: clean(query.importAgeBucket),
      createAgeBucket: clean(query.createAgeBucket || query.creatorAgeBucket),
      region: clean(query.region || query.callRegion),
      aiAssistantResponse: clean(query.aiAssistantResponse || query.aiVoiceAssistantResponse),
      aiAssistantTactic: clean(query.aiAssistantTactic || query.aiVoiceAssistantTactic),
      systemAudioSubtype: clean(query.systemAudioSubtype || query.systemAudioType),
      harvestStatus: clean(query.harvestStatus || query.status),
      confidenceBand: clean(query.confidenceBand || query.confidence),
      objectionType: clean(query.objectionType || query.objection),
      handlingType: clean(query.handlingType || query.salespersonHandlingType),
      sort: clean(query.sort || query.order),
      minImportAgeDays,
      maxAttempts,
      businessSegment,
      businessSegmentLabel: businessSegmentLabel(businessSegment)
    },
    count: rows.length,
    limit,
    offset,
    displayedCount: displayedRows.length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    rows: displayedRows,
    excludedRawFields: Array.from(EXCLUDED_RAW_FIELDS),
    filterState: analysis.filterState || null,
    filterSummary: analysis.filterSummary || null
  };
}

function findCallProof(analysis, callId) {
  const id = clean(callId);
  return (analysis.drilldownRows || []).find((row) => row.callId === id) || null;
}

module.exports = {
  EXCLUDED_RAW_FIELDS,
  METRICS,
  buildCallProofRow,
  buildDrilldownResult,
  findCallProof,
  metricFor
};
