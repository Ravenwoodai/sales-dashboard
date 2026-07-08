"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { regionNameFor, sourceNameFor } = require("./sourceQuality");
const { clean, isMissing } = require("./transcriptEvaluator");

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 10;
}

const ONE_DIAL_BUCKETS = {
  notOneDial: "not_one_dial",
  validOutcome: "valid_one_dial_outcome",
  riskyNoContact: "risky_one_dial_no_contact",
  needsReview: "needs_review"
};

const ONE_DIAL_BUCKET_LABELS = {
  [ONE_DIAL_BUCKETS.notOneDial]: "Not one-dial",
  [ONE_DIAL_BUCKETS.validOutcome]: "Valid one-dial outcome",
  [ONE_DIAL_BUCKETS.riskyNoContact]: "One-dial no-contact",
  [ONE_DIAL_BUCKETS.needsReview]: "Ambiguous one-dial excluded"
};

const VALID_ONE_DIAL_OUTCOMES = new Set([
  "wrong_number",
  "not_interested",
  "complaint",
  "opt_out"
]);

const EXPLICIT_NO_CONTACT_CLASSIFICATIONS = new Set([
  "no_answer",
  "voicemail",
  "system_audio"
]);

function orderCount(row) {
  const value = Number.parseInt(clean(row?.OrderCount), 10);
  return Number.isFinite(value) ? value : 0;
}

function businessSegmentFor(row) {
  return orderCount(row) > 0 ? "warm" : "new";
}

function businessSegmentLabel(segment) {
  if (segment === "warm") return "Warm Business";
  if (segment === "new") return "New Business";
  if (segment === "mixed") return "Mixed Business";
  return "Unknown";
}

function sourceFor(item) {
  const attribution = item.sourceAttribution || {};
  const value = clean(attribution.customerImportSource);
  return isMissing(value) ? sourceNameFor(item.row || {}) : value;
}

function regionFor(row) {
  return regionNameFor(row || {});
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

function callIdFor(item) {
  return clean(item?.row?.call_id) || `row-${item?.row?.__rowNumber || "unknown"}`;
}

function itemCall(item) {
  const segment = businessSegmentFor(item.row);
  const evaluation = item.evaluation || {};
  const firstEvidence = Array.isArray(evaluation.evidence) ? evaluation.evidence[0] : null;
  return {
    callId: callIdFor(item),
    customerId: customerIdFor(item.row),
    contactId: contactIdFor(item.row),
    date: clean(item.row.call_date),
    time: clean(item.row.call_time),
    dateTime: item.dateTime ? item.dateTime.toISOString() : "",
    timestamp: item.dateTime ? item.dateTime.getTime() : 0,
    salesperson: clean(item.row.Salesperson) || "Unknown",
    source: sourceFor(item),
    region: regionFor(item.row),
    businessSegment: segment,
    businessSegmentLabel: businessSegmentLabel(segment),
    contactClassification: evaluation.contact?.classification || "unknown",
    localOutcome: evaluation.outcome?.localCategory || "unknown",
    probableLiveHuman: Boolean(evaluation.contact?.probableLiveHuman),
    meaningfulConversation: Boolean(evaluation.contact?.meaningfulConversation),
    actionableConversation: Boolean(evaluation.contact?.actionableConversation),
    followUpRequired: Boolean(evaluation.opportunity?.followUpRequired),
    transcriptAvailable: Boolean(evaluation.transcript?.available),
    transcriptQualityBand: evaluation.transcript?.qualityBand || "unknown",
    transcriptWordCount: Number(evaluation.transcript?.wordCount || 0),
    evidenceAvailable: Boolean(firstEvidence?.text),
    evidenceSummary: firstEvidence?.summary || firstEvidence?.text || "",
    confidence: Number(evaluation.outcome?.confidence ?? evaluation.contact?.confidence ?? 0),
    durationSeconds: evaluation.durationSeconds || 0
  };
}

function oneDialBucketMetricKey(bucket) {
  if (bucket === ONE_DIAL_BUCKETS.validOutcome) return "reattempt.oneDialValidOutcome";
  if (bucket === ONE_DIAL_BUCKETS.riskyNoContact) return "reattempt.oneDialRiskyNoContact";
  if (bucket === ONE_DIAL_BUCKETS.needsReview) return "reattempt.oneDialNeedsReview";
  return "";
}

function isOneDialNoContactNoLater(record) {
  return record?.oneDialBucket === ONE_DIAL_BUCKETS.riskyNoContact && Boolean(record.noLaterCallByAnyone);
}

function hasNoUsableSpeechEvidence(call = {}) {
  return !call.transcriptAvailable ||
    call.transcriptQualityBand === "unusable" ||
    Number(call.transcriptWordCount || 0) === 0;
}

function classifyOneDialRecord(record) {
  if (!record?.oneAndDone) {
    return {
      oneDialBucket: ONE_DIAL_BUCKETS.notOneDial,
      oneDialBucketLabel: ONE_DIAL_BUCKET_LABELS[ONE_DIAL_BUCKETS.notOneDial],
      oneDialReason: "More than one dial was found for this salesperson and matched record.",
      oneDialConfidence: "not_applicable"
    };
  }

  const firstCall = record.callProof?.[0] || {};
  const contact = firstCall.contactClassification || "unknown";
  const outcome = firstCall.localOutcome || "unknown";
  const hasExplicitNoContact = EXPLICIT_NO_CONTACT_CLASSIFICATIONS.has(contact) || EXPLICIT_NO_CONTACT_CLASSIFICATIONS.has(outcome);
  const validTerminalOutcome = VALID_ONE_DIAL_OUTCOMES.has(outcome) || contact === "wrong_number";
  const liveHuman = Boolean(firstCall.probableLiveHuman);
  const meaningful = Boolean(firstCall.meaningfulConversation);
  const followUpRequired = Boolean(firstCall.followUpRequired);
  const noUsableSpeechEvidence = hasNoUsableSpeechEvidence(firstCall);
  const evidenceSummary = firstCall.evidenceSummary || `${contact} / ${outcome}`;

  if (validTerminalOutcome) {
    return {
      oneDialBucket: ONE_DIAL_BUCKETS.validOutcome,
      oneDialBucketLabel: ONE_DIAL_BUCKET_LABELS[ONE_DIAL_BUCKETS.validOutcome],
      oneDialReason: "Single dial has deterministic evidence of a clear terminal outcome.",
      oneDialConfidence: firstCall.confidence >= 0.75 ? "high" : "medium",
      oneDialEvidenceSummary: evidenceSummary
    };
  }

  if (!liveHuman) {
    if (hasExplicitNoContact || noUsableSpeechEvidence) {
      return {
        oneDialBucket: ONE_DIAL_BUCKETS.riskyNoContact,
        oneDialBucketLabel: ONE_DIAL_BUCKET_LABELS[ONE_DIAL_BUCKETS.riskyNoContact],
        oneDialReason: "Single dial has clear no-contact evidence or no usable speech evidence in the active call data.",
        oneDialConfidence: hasExplicitNoContact ? "medium" : "low",
        oneDialEvidenceSummary: evidenceSummary
      };
    }
  }

  return {
    oneDialBucket: ONE_DIAL_BUCKETS.needsReview,
    oneDialBucketLabel: ONE_DIAL_BUCKET_LABELS[ONE_DIAL_BUCKETS.needsReview],
    oneDialReason: followUpRequired
      ? "Single dial contains a follow-up or interest signal, so a manager should verify what happened next."
      : meaningful
        ? "Single dial reached a possible customer but does not clearly prove a closed outcome."
        : "Single dial is ambiguous and is excluded from the no-contact utilisation-risk score.",
    oneDialConfidence: "low",
    oneDialEvidenceSummary: evidenceSummary
  };
}

function mixedValue(values, fallback = "Unknown") {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return fallback;
  if (unique.length === 1) return unique[0];
  return "Mixed";
}

function mixedSegment(calls) {
  const unique = Array.from(new Set(calls.map((call) => call.businessSegment).filter(Boolean)));
  return unique.length === 1 ? unique[0] : "mixed";
}

function sortedCalls(calls) {
  return [...calls].sort((a, b) => a.timestamp - b.timestamp || a.callId.localeCompare(b.callId));
}

function buildRecords(items) {
  const globalByLead = new Map();
  const bySalespersonLead = new Map();
  let callsWithoutStableLead = 0;

  items.forEach((item) => {
    const identity = stableLeadIdentity(item.row);
    if (!identity.stableLeadKey) {
      callsWithoutStableLead += 1;
      return;
    }

    const call = {
      ...itemCall(item),
      ...identity
    };
    if (!globalByLead.has(identity.stableLeadKey)) globalByLead.set(identity.stableLeadKey, []);
    globalByLead.get(identity.stableLeadKey).push(call);

    const salespersonLeadKey = `${call.salesperson}\u0000${identity.stableLeadKey}`;
    if (!bySalespersonLead.has(salespersonLeadKey)) {
      bySalespersonLead.set(salespersonLeadKey, {
        salesperson: call.salesperson,
        ...identity,
        calls: []
      });
    }
    bySalespersonLead.get(salespersonLeadKey).calls.push(call);
  });

  globalByLead.forEach((calls, key) => {
    globalByLead.set(key, sortedCalls(calls));
  });

  const records = Array.from(bySalespersonLead.values()).map((entry) => {
    const calls = sortedCalls(entry.calls);
    const globalCalls = globalByLead.get(entry.stableLeadKey) || [];
    const firstCall = calls[0] || {};
    const laterGlobalCalls = globalCalls.filter((call) => {
      if (call.callId === firstCall.callId) return false;
      return call.timestamp > firstCall.timestamp || (call.timestamp === firstCall.timestamp && call.callId.localeCompare(firstCall.callId) > 0);
    });
    const segment = mixedSegment(calls);
    const source = mixedValue(calls.map((call) => call.source), "Unknown source");
    const region = mixedValue(calls.map((call) => call.region), "Unknown region");
    const personalCallCount = calls.length;
    const personallyRetried = personalCallCount >= 2;
    const oneAndDone = personalCallCount === 1;
    const laterCallByAnyone = laterGlobalCalls.length > 0;
    const noLaterCallByAnyone = !laterCallByAnyone;
    const customerIds = Array.from(new Set(calls.map((call) => call.customerId).filter(Boolean)));
    const customerId = customerIds[0] || (entry.stableLeadSource === "customer_id" ? entry.stableLeadValue : "");
    const contactIds = Array.from(new Set(calls.map((call) => call.contactId).filter(Boolean)));

    const record = {
      type: "lead_reattempt",
      salesperson: entry.salesperson,
      customerId,
      contactId: contactIds[0] || (entry.stableLeadSource === "ContactId" ? entry.stableLeadValue : ""),
      stableLeadSource: entry.stableLeadSource,
      stableLeadValue: entry.stableLeadValue,
      stableLeadKey: entry.stableLeadKey,
      source,
      region,
      businessSegment: segment,
      businessSegmentLabel: businessSegmentLabel(segment),
      personalCallCount,
      allCallCount: globalCalls.length,
      personallyRetried,
      oneAndDone,
      laterCallByAnyone,
      noLaterCallByAnyone,
      laterCallCountByAnyone: laterGlobalCalls.length,
      firstCallId: firstCall.callId || "",
      lastCallId: calls[calls.length - 1]?.callId || "",
      primaryCallId: firstCall.callId || "",
      callIds: calls.map((call) => call.callId),
      allCallIds: globalCalls.map((call) => call.callId),
      laterCallIdsByAnyone: laterGlobalCalls.map((call) => call.callId),
      firstCallAt: firstCall.dateTime || "",
      lastCallAt: calls[calls.length - 1]?.dateTime || "",
      callProof: calls
    };

    const oneDialClassification = classifyOneDialRecord(record);
    const oneDialMetricKey = oneDialBucketMetricKey(oneDialClassification.oneDialBucket);
    return {
      ...record,
      ...oneDialClassification,
      metricKeys: [
        "reattempt.leadsTouched",
        personallyRetried ? "reattempt.personalRetried" : "",
        oneAndDone ? "reattempt.oneAndDone" : "",
        oneDialMetricKey,
        isOneDialNoContactNoLater({ ...record, ...oneDialClassification }) ? "reattempt.oneDialNoContactNoLater" : "",
        noLaterCallByAnyone ? "reattempt.noLaterCallByAnyone" : ""
      ].filter(Boolean)
    };
  });

  const maxAttempts = records.reduce((max, record) => Math.max(max, record.personalCallCount), 0);
  records.forEach((record) => {
    if (record.personalCallCount === maxAttempts && maxAttempts > 0) {
      record.metricKeys.push("reattempt.maxAttemptsOnOneLead");
    }
  });

  return { records, callsWithoutStableLead, maxAttempts };
}

function seedGroup(name, extras = {}) {
  return {
    name,
    leadsTouched: 0,
    personallyRetriedLeads: 0,
    oneAndDoneLeads: 0,
    validOneDialOutcomeLeads: 0,
    riskyOneDialNoContactLeads: 0,
    oneDialNoContactNoLaterLeads: 0,
    oneDialNeedsReviewLeads: 0,
    noLaterCallByAnyoneLeads: 0,
    laterCallByAnyoneLeads: 0,
    totalPersonalCalls: 0,
    maxAttemptsOnOneLead: 0,
    ...extras
  };
}

function addRecord(group, record) {
  group.leadsTouched += 1;
  if (record.personallyRetried) group.personallyRetriedLeads += 1;
  if (record.oneAndDone) group.oneAndDoneLeads += 1;
  if (record.oneDialBucket === ONE_DIAL_BUCKETS.validOutcome) group.validOneDialOutcomeLeads += 1;
  if (record.oneDialBucket === ONE_DIAL_BUCKETS.riskyNoContact) group.riskyOneDialNoContactLeads += 1;
  if (isOneDialNoContactNoLater(record)) group.oneDialNoContactNoLaterLeads += 1;
  if (record.oneDialBucket === ONE_DIAL_BUCKETS.needsReview) group.oneDialNeedsReviewLeads += 1;
  if (record.noLaterCallByAnyone) group.noLaterCallByAnyoneLeads += 1;
  if (record.laterCallByAnyone) group.laterCallByAnyoneLeads += 1;
  group.totalPersonalCalls += Number(record.personalCallCount || 0);
  group.maxAttemptsOnOneLead = Math.max(group.maxAttemptsOnOneLead, Number(record.personalCallCount || 0));
}

function finalizeGroup(group) {
  return {
    ...group,
    personalRetryRate: percent(group.personallyRetriedLeads, group.leadsTouched),
    oneAndDoneRate: percent(group.oneAndDoneLeads, group.leadsTouched),
    validOneDialOutcomeRate: percent(group.validOneDialOutcomeLeads, group.oneAndDoneLeads),
    riskyOneDialNoContactRate: percent(group.riskyOneDialNoContactLeads, group.oneAndDoneLeads),
    oneDialNoContactNoLaterRate: percent(group.oneDialNoContactNoLaterLeads, group.leadsTouched),
    oneDialNeedsReviewRate: percent(group.oneDialNeedsReviewLeads, group.oneAndDoneLeads),
    noLaterCallByAnyoneRate: percent(group.noLaterCallByAnyoneLeads, group.leadsTouched),
    laterCallByAnyoneRate: percent(group.laterCallByAnyoneLeads, group.leadsTouched),
    averageCallsPerLead: group.leadsTouched ? Math.round((group.totalPersonalCalls / group.leadsTouched) * 100) / 100 : 0
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

function patternSort(a, b) {
  return b.leadsTouched - a.leadsTouched || b.personalRetryRate - a.personalRetryRate || a.name.localeCompare(b.name);
}

function summarizeLeadReattemptRecords(records, options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const maxAttempts = rows.reduce((max, record) => Math.max(max, Number(record.personalCallCount || 0)), 0);
  const callsWithoutStableLead = Number(options.callsWithoutStableLead || 0);
  const totals = finalizeGroup(rows.reduce((group, record) => {
    addRecord(group, record);
    return group;
  }, seedGroup("All matched records", {
    callsWithoutStableLead,
    maxAttemptsOnOneLead: maxAttempts
  })));
  totals.callsWithoutStableLead = callsWithoutStableLead;
  totals.maxAttemptsOnOneLead = maxAttempts;

  const salespersonRows = groupRows(
    records,
    (record) => record.salesperson,
    (name) => seedGroup(name, { salesperson: name })
  ).sort((a, b) => b.leadsTouched - a.leadsTouched || a.salesperson.localeCompare(b.salesperson));

  const sourceRows = groupRows(
    records,
    (record) => record.source,
    (name) => seedGroup(name, { source: name })
  ).sort(patternSort);

  const regionRows = groupRows(
    records,
    (record) => record.region,
    (name) => seedGroup(name, { region: name })
  ).sort(patternSort);

  const businessSegmentRows = groupRows(
    records,
    (record) => record.businessSegment,
    (segment) => seedGroup(businessSegmentLabel(segment), {
      businessSegment: segment,
      businessSegmentLabel: businessSegmentLabel(segment)
    })
  ).sort((a, b) => b.leadsTouched - a.leadsTouched || a.name.localeCompare(b.name));

  const highestRetrySalespeople = salespersonRows
    .filter((row) => row.leadsTouched >= 25)
    .sort((a, b) => b.personalRetryRate - a.personalRetryRate || b.leadsTouched - a.leadsTouched)
    .slice(0, 12);
  const lowestRetrySalespeople = salespersonRows
    .filter((row) => row.leadsTouched >= 25)
    .sort((a, b) => a.personalRetryRate - b.personalRetryRate || b.leadsTouched - a.leadsTouched)
    .slice(0, 12);
  const highestOneDialRiskSalespeople = salespersonRows
    .filter((row) => row.leadsTouched >= 25)
    .sort((a, b) => (
      b.oneDialNoContactNoLaterLeads - a.oneDialNoContactNoLaterLeads ||
      b.oneDialNoContactNoLaterRate - a.oneDialNoContactNoLaterRate ||
      a.personalRetryRate - b.personalRetryRate ||
      b.leadsTouched - a.leadsTouched
    ))
    .slice(0, 12);
  const highestUnderUtilizationSalespeople = highestOneDialRiskSalespeople;

  return {
    totals,
    salespersonRows,
    sourceRows,
    regionRows,
    businessSegmentRows,
    highestRetrySalespeople,
    lowestRetrySalespeople,
    highestOneDialRiskSalespeople,
    highestUnderUtilizationSalespeople,
    records: rows
  };
}

function buildLeadReattemptModel(items) {
  const { records, callsWithoutStableLead } = buildRecords(items);

  return {
    schemaVersion: "sales_dashboard_lead_reattempt.v1",
    definitions: {
      lead: "A matched customer/contact anchor using customer_id first, then AllocatedLeadID, ContactId, FoundContactID, and FoundCustomerID.",
      personalRetryRate: "Matched records a salesperson called more than once divided by matched records they dialed.",
      oneDialRecordRate: "Matched records a salesperson called exactly once divided by matched records they dialed. This is neutral until split into valid, risky, and review buckets.",
      validOneDialOutcome: "One-dial records with deterministic evidence of a clear terminal outcome such as wrong number, not interested, complaint, or opt-out.",
      riskyOneDialNoContact: "One-dial records with clear no-contact evidence: no answer, voicemail, system audio, or no usable speech evidence.",
      oneDialNoContactNoLater: "Potential lead under-utilisation: one-dial no-contact records with no later matching call observed for the same stable customer/contact/lead ID.",
      oneDialNeedsReview: "One-dial records that are ambiguous or contain follow-up/interest signals. These are excluded from the no-contact utilisation-risk score.",
      noLaterCallByAnyoneRate: "Matched records where no later call to the same anchor appears after that salesperson's first dial in the current upload.",
      patternRows: "Business segment, source, and region rows show what types of matched records are retried versus left as one-dial records."
    },
    ...summarizeLeadReattemptRecords(records, { callsWithoutStableLead })
  };
}

module.exports = {
  ONE_DIAL_BUCKETS,
  buildLeadReattemptModel,
  classifyOneDialRecord,
  summarizeLeadReattemptRecords,
  stableLeadIdentity
};
