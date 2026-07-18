"use strict";

const crypto = require("crypto");
const { ENTITY_FIELDS } = require("./analysisConstants");
const { parseCsv } = require("./csvParser");
const { clean, isMissing, toInt, evaluateCall } = require("./transcriptEvaluator");
const { buildParkedAllocationDiagnostic } = require("./allocationParking");
const { buildLeadUtilizationModel } = require("./leadUtilizationReport");
const { buildCallProofRow } = require("./drilldown");
const { SOURCE_AGE_THRESHOLDS, ageBucketSort, sourceAttributionFor } = require("./sourceQuality");
const { buildAiVoiceAssistantModel, linkAiVoiceAssistantOutcomes } = require("./aiVoiceAssistantAnalytics");
const { buildLeadReattemptModel } = require("./leadReattemptAnalytics");
const { buildLeadHarvestModel } = require("./leadHarvestAnalytics");
const { buildSystemAudioModel } = require("./systemAudioAnalytics");
const { buildSelfSourcingAttributionModel } = require("./selfSourcingAttribution");
const { buildWeeklyLeadIntelligenceModel } = require("./weeklyLeadIntelligence");
const {
  SOURCE_TIMEZONE_LABEL,
  formatSourceDateParts,
  formatSourceDateTimeParts,
  formatSourceDateTimeValue,
  isoDateFromParts,
  isoTimeFromParts,
  sourceComparableFromParts
} = require("./dateTimeFormat");
const {
  applyCallFilters,
  buildFilterOptions,
  buildFilterSummary,
  normalizeFilterState
} = require("./globalFilters");
const {
  alertIdFor,
  isActiveAlertStatus,
  mergeAlertWithEvent,
  normalizeAlertEvent,
  normalizeAlertStatus,
  summarizeAlerts
} = require("./alertLifecycle");
const {
  MANAGER_REVIEW_STATUSES,
  normalizeManagerReview
} = require("./managerReview");
const { isUntrustedLegacyField } = require("./untrustedLegacyFields");
const IGNORED_FIELDS = [
  {
    field: "dialled_phone_number",
    reason: "Intentionally incomplete for security. Preserved in raw import only and ignored for matching, attribution, repeat-contact metrics, and dashboard display."
  }
];

const REQUIRED_COLUMNS = [
  "call_id",
  "call_date",
  "call_time",
  "Salesperson",
  "CallType",
  "call_direction",
  "CallTotalSeconds",
  "ring_time_seconds",
  "call_duration_seconds",
  "transcription_text",
  "CustomerImportSource"
];

function parseSourceDateParts(value) {
  const date = clean(value);
  let dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  dateMatch = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  return null;
}

function parseSourceTimeParts(value) {
  const time = clean(value);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!timeMatch) return null;
  const [, hour, minute, second] = timeMatch;
  return { hour: Number(hour), minute: Number(minute), second: Number(second) };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function sourceDateTimeParts(row) {
  const dateParts = parseSourceDateParts(row.call_date);
  const timeParts = parseSourceTimeParts(row.call_time);
  if (!dateParts || !timeParts) return null;
  const parts = { ...dateParts, ...timeParts };
  const date = isoDateFromParts(parts);
  const time = isoTimeFromParts(parts);
  return {
    ...parts,
    date,
    time,
    comparable: sourceComparableFromParts(parts),
    label: formatSourceDateTimeParts(parts),
    dateLabel: formatSourceDateParts(parts),
    secondsOfDay: (timeParts.hour * 60 * 60) + (timeParts.minute * 60) + timeParts.second
  };
}

function parseDateTime(row) {
  const parts = sourceDateTimeParts(row);
  if (!parts) return null;
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildDateRange(items, minDateTime, maxDateTime) {
  const datedItems = items.filter((item) => item.dateTime);
  const startParts = datedItems.length ? sourceDateTimeParts(datedItems[0].row) : null;
  const endParts = datedItems.length ? sourceDateTimeParts(datedItems[datedItems.length - 1].row) : null;
  const display = startParts && endParts
    ? `${startParts.label} to ${endParts.label} (${SOURCE_TIMEZONE_LABEL})`
    : "";
  return {
    start: minDateTime ? minDateTime.toISOString() : null,
    end: maxDateTime ? maxDateTime.toISOString() : null,
    sourceStart: startParts?.label || null,
    sourceEnd: endParts?.label || null,
    sourceTimezoneLabel: SOURCE_TIMEZONE_LABEL,
    display
  };
}

function buildDataWindow(items, totals = {}) {
  const datedItems = items
    .filter((item) => item.dateTime)
    .map((item) => ({ item, parts: sourceDateTimeParts(item.row) }))
    .filter((item) => item.parts);
  const start = datedItems[0]?.parts || null;
  const end = datedItems[datedItems.length - 1]?.parts || null;
  const sourceDates = new Set(datedItems.map((item) => item.parts.date));
  const dayCount = sourceDates.size;
  const durationHours = datedItems.length >= 2
    ? (datedItems[datedItems.length - 1].item.dateTime.getTime() - datedItems[0].item.dateTime.getTime()) / (60 * 60 * 1000)
    : 0;
  const singleDay = dayCount === 1;
  const partialDay = Boolean(singleDay && datedItems.length > 0 && (
    durationHours < 20 ||
    (start && start.secondsOfDay > 2 * 60 * 60) ||
    (end && end.secondsOfDay < 22 * 60 * 60)
  ));
  const insufficientTrendHistory = Boolean(dayCount > 0 && dayCount < 7);
  const followUpFutureDataUnavailable = Number(totals.followUpIndeterminate || 0) > 0;
  const warnings = [];

  if (singleDay) {
    warnings.push({
      code: "single_day_dataset",
      severity: "warning",
      message: `This dataset covers a single source call date (${start?.dateLabel || "unknown"} AEST). Treat trend and comparison views as a same-day snapshot.`
    });
  }
  if (partialDay) {
    warnings.push({
      code: "partial_day_dataset",
      severity: "warning",
      message: `This dataset appears to cover only part of a source day (${start?.label || "unknown"} to ${end?.label || "unknown"}). Daily totals and comparisons may be incomplete.`
    });
  }
  if (insufficientTrendHistory) {
    warnings.push({
      code: "insufficient_trend_history",
      severity: "notice",
      message: `Trend alerts and comparisons need more history. The active call data contains ${dayCount} source call ${dayCount === 1 ? "date" : "dates"}.`
    });
  }
  if (followUpFutureDataUnavailable) {
    warnings.push({
      code: "follow_up_future_data_unavailable",
      severity: "notice",
      message: `Follow-up overdue status may be indeterminate because the active data ends at ${end?.label || "the latest loaded call"} and later calls are not available in this dataset.`
    });
  }

  return {
    sourceTimezoneLabel: SOURCE_TIMEZONE_LABEL,
    sourceStart: start?.label || null,
    sourceEnd: end?.label || null,
    sourceDates: Array.from(sourceDates).sort(),
    dayCount,
    durationHours: Math.round(durationHours * 10) / 10,
    singleDay,
    partialDay,
    insufficientTrendHistory,
    followUpFutureDataUnavailable,
    callDataOnly: true,
    warnings
  };
}

function attachInternalItems(analysis, items) {
  Object.defineProperty(analysis, "_items", {
    value: items,
    enumerable: false,
    configurable: true
  });
  return analysis;
}

function internalItemsFor(analysis) {
  return Array.isArray(analysis?._items) ? analysis._items : [];
}

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

function buildIntelligenceGovernance(items, totals = {}) {
  const counts = { high: 0, medium: 0, low: 0, unusable: 0, unknown: 0 };
  items.forEach((item) => {
    const band = confidenceBandForItem(item);
    counts[band] = (counts[band] || 0) + 1;
  });
  const total = Number(totals.uniqueCalls || items.length || 0);
  const rate = (value) => percent(value, total);
  return {
    schemaVersion: "sales_dashboard_intelligence_governance.v1",
    processing: {
      totalCalls: total,
      transcriptsAvailable: Number(totals.transcriptAvailable || 0),
      deterministicEvaluationsCompleted: items.length,
      llmEvaluationsCompleted: 0,
      llmNotRequested: items.length,
      llmFailed: 0,
      managerReviewedCalls: 0,
      unprocessedCalls: Math.max(0, total - items.length),
      transcriptDerivedMetricsCoverageRate: percent(totals.transcriptUsableForCoaching || 0, total),
      lowOrUnusableTranscriptCount: counts.low + counts.unusable
    },
    confidence: {
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      unusable: counts.unusable,
      unknown: counts.unknown,
      highRate: rate(counts.high),
      mediumRate: rate(counts.medium),
      lowRate: rate(counts.low),
      unusableRate: rate(counts.unusable),
      unknownRate: rate(counts.unknown)
    },
    provenance: {
      rawImportedFields: ["transcription_text"],
      deterministicFields: ["contactClassification", "localOutcome", "followUpRequired", "alerts", "scorecards"],
      llmReviewedOnlyWhen: "llm_status is completed and a usable LLM result is stored.",
      managerReviewedOnlyWhen: "a saved manager review exists for the call."
    }
  };
}

function rowGovernance(item) {
  const band = confidenceBandForItem(item);
  const deterministicConfidence = Number(item?.evaluation?.outcome?.confidence ?? item?.evaluation?.contact?.confidence ?? 0);
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
    deterministicConfidence,
    confidenceBand: band,
    confidenceLabel: confidenceLabelForBand(band),
    evidenceAvailable: Boolean(item?.evaluation?.evidence?.length)
  };
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function inc(counter, key, by = 1) {
  const safeKey = key || "Unknown";
  counter[safeKey] = (counter[safeKey] || 0) + by;
}

function orderCount(row) {
  const value = toInt(row.OrderCount);
  return value === null ? 0 : value;
}

function businessSegmentFor(row) {
  return orderCount(row) > 0 ? "warm" : "new";
}

function businessSegmentLabel(segment) {
  if (segment === "warm") return "Warm Business";
  if (segment === "new") return "New Business";
  return "";
}

function orderHistoryLabel(row) {
  return orderCount(row) > 0 ? "Previous Sales History" : "No Sales History";
}

function entityKeys(row) {
  return ENTITY_FIELDS
    .map((field) => {
      const value = clean(row[field]);
      return isMissing(value) ? null : `${field}:${value}`;
    })
    .filter(Boolean);
}

function matchingEntityIdentifiers(left = {}, right = {}) {
  return ENTITY_FIELDS.map((field) => {
    const leftValue = clean(left[field]);
    const rightValue = clean(right[field]);
    return !isMissing(leftValue) && leftValue === rightValue ? { field, value: leftValue } : null;
  }).filter(Boolean);
}

function buildDurationStats(rows, field) {
  const values = rows.map((row) => toInt(row[field])).filter((value) => value !== null).sort((a, b) => a - b);
  if (!values.length) {
    return { count: 0, min: 0, median: 0, p90: 0, max: 0, zero: 0, shortUnder30: 0, longOver300: 0 };
  }
  const at = (p) => values[Math.round((values.length - 1) * p)];
  return {
    count: values.length,
    min: values[0],
    median: at(0.5),
    p90: at(0.9),
    max: values[values.length - 1],
    zero: values.filter((value) => value === 0).length,
    shortUnder30: values.filter((value) => value < 30).length,
    longOver300: values.filter((value) => value >= 300).length
  };
}

function summarizeBy(items, keyFn, seedFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || "Unknown";
    if (!groups.has(key)) groups.set(key, seedFn(key));
    const group = groups.get(key);
    group.calls += 1;
    if (item.evaluation.transcript.available) group.transcriptAvailable += 1;
    if (item.evaluation.contact.telephonyConnected) group.telephonyConnected += 1;
    if (item.evaluation.contact.probableLiveHuman) group.probableLiveHuman += 1;
    if (item.evaluation.contact.meaningfulConversation) group.meaningfulConversation += 1;
    if (item.evaluation.contact.actionableConversation) group.actionableConversation += 1;
    if (item.evaluation.opportunity.followUpRequired) group.followUpRequired += 1;
    if (item.evaluation.risk.reviewRequired) group.riskReviews += 1;
    const confidenceBand = confidenceBandForItem(item);
    if (confidenceBand === "high") group.highConfidence = (group.highConfidence || 0) + 1;
    else if (confidenceBand === "medium") group.mediumConfidence = (group.mediumConfidence || 0) + 1;
    else if (confidenceBand === "low") group.lowConfidence = (group.lowConfidence || 0) + 1;
    else if (confidenceBand === "unusable") group.unusableTranscript = (group.unusableTranscript || 0) + 1;
    else group.unknownConfidence = (group.unknownConfidence || 0) + 1;
    if (item.evaluation.aiVoiceAssistant?.detected) {
      group.aiVoiceAssistantEncounters = (group.aiVoiceAssistantEncounters || 0) + 1;
      if (item.evaluation.aiVoiceAssistant.handledSuccessfully) group.aiVoiceAssistantHandled = (group.aiVoiceAssistantHandled || 0) + 1;
      if (item.evaluation.aiVoiceAssistant.bailed) group.aiVoiceAssistantBailed = (group.aiVoiceAssistantBailed || 0) + 1;
      if (item.evaluation.aiVoiceAssistant.followThrough?.futureHumanContact) group.aiVoiceAssistantFutureHuman = (group.aiVoiceAssistantFutureHuman || 0) + 1;
    }
    group.totalDuration += item.evaluation.durationSeconds;
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      transcriptCoverageRate: percent(group.transcriptAvailable, group.calls),
      telephonyConnectedRate: percent(group.telephonyConnected, group.calls),
      probableLiveHumanRate: percent(group.probableLiveHuman, group.calls),
      meaningfulConversationRate: percent(group.meaningfulConversation, group.calls),
      actionableConversationRate: percent(group.actionableConversation, group.calls),
      followUpRequiredRate: percent(group.followUpRequired, group.calls),
      highConfidence: group.highConfidence || 0,
      mediumConfidence: group.mediumConfidence || 0,
      lowConfidence: group.lowConfidence || 0,
      unusableTranscript: group.unusableTranscript || 0,
      unknownConfidence: group.unknownConfidence || 0,
      reviewOnlySignals: (group.lowConfidence || 0) + (group.unusableTranscript || 0),
      aiVoiceAssistantEncounterRate: percent(group.aiVoiceAssistantEncounters || 0, group.calls),
      aiVoiceAssistantBailRate: percent(group.aiVoiceAssistantBailed || 0, group.aiVoiceAssistantEncounters || 0),
      aiVoiceAssistantHandledRate: percent(group.aiVoiceAssistantHandled || 0, group.aiVoiceAssistantEncounters || 0),
      aiVoiceAssistantFutureHumanRate: percent(group.aiVoiceAssistantFutureHuman || 0, group.aiVoiceAssistantEncounters || 0),
      averageDurationSeconds: group.calls ? Math.round(group.totalDuration / group.calls) : 0
    }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function seedSourceQualityGroup(name, extras = {}) {
  const group = {
    name,
    calls: 0,
    newBusinessCalls: 0,
    warmBusinessCalls: 0,
    callsWithBulkSource: 0,
    callsWithImportDate: 0,
    totalImportAgeDays: 0,
    callsWithRecordAge: 0,
    totalRecordAgeDays: 0,
    callsWithManualCreator: 0,
    callsMissingSourceAttribution: 0,
    callsWithCreateDate: 0,
    totalCreateAgeDays: 0,
    leadGeneratorCreatedCalls: 0,
    salespersonCreatedCalls: 0,
    transcriptAvailable: 0,
    telephonyConnected: 0,
    probableLiveHuman: 0,
    meaningfulConversation: 0,
    actionableConversation: 0,
    followUpRequired: 0,
    riskReviews: 0,
    noHumanAnswerCalls: 0,
    ...extras
  };
  SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
    group[`newBusinessImportedOlderThan${threshold}`] = 0;
    group[`newBusinessRecordOlderThan${threshold}`] = 0;
  });
  return group;
}

function addSourceQualityCounts(group, item) {
  const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
  const segment = businessSegmentFor(item.row);
  group.calls += 1;
  if (segment === "new") group.newBusinessCalls += 1;
  if (segment === "warm") group.warmBusinessCalls += 1;
  if (attribution.hasBulkSource) group.callsWithBulkSource += 1;
  if (attribution.daysSinceImport !== null) {
    group.callsWithImportDate += 1;
    group.totalImportAgeDays += attribution.daysSinceImport;
  }
  if (attribution.daysSinceRecord !== null) {
    group.callsWithRecordAge += 1;
    group.totalRecordAgeDays += attribution.daysSinceRecord;
  }
  if (attribution.hasManualCreator) group.callsWithManualCreator += 1;
  if (!attribution.hasBulkSource && !attribution.hasManualCreator) group.callsMissingSourceAttribution += 1;
  if (attribution.daysSinceCreated !== null) {
    group.callsWithCreateDate += 1;
    group.totalCreateAgeDays += attribution.daysSinceCreated;
  }
  if (attribution.customerCreatedByType === "LG") group.leadGeneratorCreatedCalls += 1;
  if (attribution.customerCreatedByType === "SP") group.salespersonCreatedCalls += 1;
  if (item.evaluation.transcript.available) group.transcriptAvailable += 1;
  if (item.evaluation.contact.telephonyConnected) group.telephonyConnected += 1;
  if (item.evaluation.contact.probableLiveHuman) group.probableLiveHuman += 1;
  if (item.evaluation.contact.meaningfulConversation) group.meaningfulConversation += 1;
  if (item.evaluation.contact.actionableConversation) group.actionableConversation += 1;
  if (item.evaluation.opportunity.followUpRequired) group.followUpRequired += 1;
  if (item.evaluation.risk.reviewRequired) group.riskReviews += 1;
  if (!item.evaluation.contact.probableLiveHuman) group.noHumanAnswerCalls += 1;
  if (segment === "new" && attribution.daysSinceImport !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (attribution.daysSinceImport > threshold) {
        group[`newBusinessImportedOlderThan${threshold}`] += 1;
      }
    });
  }
  if (segment === "new" && attribution.daysSinceRecord !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (attribution.daysSinceRecord > threshold) {
        group[`newBusinessRecordOlderThan${threshold}`] += 1;
      }
    });
  }
}

function finalizeSourceQualityGroup(group) {
  return {
    ...group,
    transcriptCoverageRate: percent(group.transcriptAvailable, group.calls),
    telephonyConnectedRate: percent(group.telephonyConnected, group.calls),
    probableLiveHumanRate: percent(group.probableLiveHuman, group.calls),
    noHumanAnswerRate: percent(group.noHumanAnswerCalls, group.calls),
    meaningfulConversationRate: percent(group.meaningfulConversation, group.calls),
    actionableConversationRate: percent(group.actionableConversation, group.calls),
    followUpRequiredRate: percent(group.followUpRequired, group.calls),
    riskReviewRate: percent(group.riskReviews, group.calls),
    bulkSourceCoverageRate: percent(group.callsWithBulkSource, group.calls),
    importDateCoverageRate: percent(group.callsWithImportDate, group.calls),
    recordAgeCoverageRate: percent(group.callsWithRecordAge, group.calls),
    manualCreatorCoverageRate: percent(group.callsWithManualCreator, group.calls),
    missingSourceAttributionRate: percent(group.callsMissingSourceAttribution, group.calls),
    createDateCoverageRate: percent(group.callsWithCreateDate, group.calls),
    averageImportAgeDays: group.callsWithImportDate ? Math.round(group.totalImportAgeDays / group.callsWithImportDate) : null,
    averageCreateAgeDays: group.callsWithCreateDate ? Math.round(group.totalCreateAgeDays / group.callsWithCreateDate) : null,
    averageRecordAgeDays: group.callsWithRecordAge ? Math.round(group.totalRecordAgeDays / group.callsWithRecordAge) : null
  };
}

function groupBy(items, keyFn, seedFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, seedFn(key, item));
    addSourceQualityCounts(groups.get(key), item);
  });
  return Array.from(groups.values()).map(finalizeSourceQualityGroup);
}

function buildSourceQualityModel(items) {
  const totals = seedSourceQualityGroup("All calls");
  items.forEach((item) => addSourceQualityCounts(totals, item));
  const finalizedTotals = finalizeSourceQualityGroup(totals);

  const sourceRows = groupBy(
    items,
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).customerImportSource,
    (name) => seedSourceQualityGroup(name)
  ).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));

  const creatorRows = groupBy(
    items,
    (item) => {
      const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
      if (!attribution.hasManualCreator) return "";
      return `${attribution.customerCreatedByType || "Unknown"}:${attribution.customerCreatedBy || "Unknown creator"}`;
    },
    (key, item) => {
      const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
      const type = attribution.customerCreatedByType || "Unknown";
      const createdBy = attribution.customerCreatedBy || "Unknown creator";
      return seedSourceQualityGroup(`${createdBy} (${type})`, {
        createdBy,
        createdByType: type,
        createdByTypeLabel: attribution.customerCreatedByTypeLabel
      });
    }
  ).sort((a, b) => b.calls - a.calls || a.createdBy.localeCompare(b.createdBy));

  const createdByTypeRows = groupBy(
    items,
    (item) => {
      const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
      return attribution.hasManualCreator ? attribution.customerCreatedByType || "Unknown" : "";
    },
    (type, item) => {
      const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
      return seedSourceQualityGroup(type, {
        createdByType: type,
        createdByTypeLabel: attribution.customerCreatedByTypeLabel
      });
    }
  ).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));

  const recordAgeBuckets = groupBy(
    items,
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).recordAgeBucket,
    (bucket) => seedSourceQualityGroup(bucket, { bucket, sortOrder: ageBucketSort(bucket) })
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  const importAgeBuckets = groupBy(
    items,
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).importAgeBucket,
    (bucket) => seedSourceQualityGroup(bucket, { bucket, sortOrder: ageBucketSort(bucket) })
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  const creatorAgeBuckets = groupBy(
    items.filter((item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).hasManualCreator),
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).createAgeBucket,
    (bucket) => seedSourceQualityGroup(bucket, { bucket, sortOrder: ageBucketSort(bucket) })
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  const newBusinessImportAgeThresholds = SOURCE_AGE_THRESHOLDS.map((thresholdDays) => ({
    thresholdDays,
    calls: finalizedTotals[`newBusinessImportedOlderThan${thresholdDays}`],
    rate: percent(finalizedTotals[`newBusinessImportedOlderThan${thresholdDays}`], finalizedTotals.newBusinessCalls),
    metric: "source.newBusinessImportedOlderThan"
  }));

  const newBusinessRecordAgeThresholds = SOURCE_AGE_THRESHOLDS.map((thresholdDays) => ({
    thresholdDays,
    calls: finalizedTotals[`newBusinessRecordOlderThan${thresholdDays}`],
    rate: percent(finalizedTotals[`newBusinessRecordOlderThan${thresholdDays}`], finalizedTotals.newBusinessCalls),
    metric: "source.newBusinessRecordOlderThan"
  }));

  const rankedSources = sourceRows
    .filter((row) => row.calls >= 25 && row.name !== "Unknown source")
    .sort((a, b) => a.probableLiveHumanRate - b.probableLiveHumanRate || b.calls - a.calls || a.name.localeCompare(b.name));

  return {
    schemaVersion: "sales_dashboard_source_quality.v1",
    thresholds: SOURCE_AGE_THRESHOLDS,
    definitions: {
      bulkSource: "CustomerImportDate and CustomerImportSource from bulk lead sourcing operations.",
      manualCreator: "CustomerCreatedBy, CustomerCreatedByType, and CustomerCreateDate from manual LG/SP entry.",
      missingSourceAttribution: "Records missing both bulk import evidence and manual creator evidence.",
      humanAnswerRate: "Probable live-human calls divided by total calls for that source or creator.",
      recordAge: "Record Age uses CustomerImportDate where valid, otherwise CustomerCreateDate where valid.",
      newBusinessRecordAge: "New Business calls where Record Age is more than X days before the call date."
    },
    totals: finalizedTotals,
    sourceRows,
    creatorRows,
    createdByTypeRows,
    recordAgeBuckets,
    importAgeBuckets,
    creatorAgeBuckets,
    newBusinessRecordAgeThresholds,
    newBusinessImportAgeThresholds,
    lowestHumanAnswerSource: rankedSources[0] || null,
    lowestHumanAnswerSources: rankedSources.slice(0, 5)
  };
}

function linkFollowUps(items, maxDateTime) {
  const keyToLaterItems = new Map();
  [...items].reverse().forEach((item) => {
    const keys = entityKeys(item.row);
    const laterMatches = keys.flatMap((key) => keyToLaterItems.get(key) || []);
    const uniqueLaterMatches = Array.from(new Map(laterMatches.map((match) => [match.row.call_id, match])).values())
      .map((match) => ({ match, matchingIdentifiers: matchingEntityIdentifiers(item.row, match.row) }))
      .filter((candidate) => candidate.matchingIdentifiers.length)
      .sort((left, right) => {
        const leftTime = left.match.dateTime instanceof Date ? left.match.dateTime.getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.match.dateTime instanceof Date ? right.match.dateTime.getTime() : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });

    if (item.evaluation.opportunity.followUpRequired) {
      if (uniqueLaterMatches.length > 0) {
        const selected = uniqueLaterMatches[0];
        const later = selected.match;
        const laterCallId = clean(later.row.call_id);
        const laterLiveContact = Boolean(later.evaluation.contact.probableLiveHuman);
        item.followUpStatus = "later_attempt_observed";
        item.followUpMatchedCallId = laterCallId;
        item.followUpMatch = {
          status: "later_attempt_observed",
          relationStatus: "confirmed_related_call",
          matchMethod: "exact_stable_identifier",
          matchingIdentifiers: selected.matchingIdentifiers,
          conflictingIdentifiers: [],
          matchedCallId: laterCallId,
          laterCallDate: clean(later.row.call_date),
          laterCallTime: clean(later.row.call_time),
          laterCallOutcome: clean(later.evaluation.outcome.localCategory) || "unknown",
          laterCallContactState: laterLiveContact ? "live_contact_observed" : "no_live_contact_observed",
          laterCallDurationSeconds: Number(later.evaluation.durationSeconds || 0),
          completionState: "not_established",
          paymentState: "not_established",
          verificationStatus: laterLiveContact
            ? "related_live_call_observed_completion_not_verified"
            : "related_attempt_observed_completion_not_verified"
        };
      } else if (!item.dateTime || !maxDateTime || maxDateTime.getTime() - item.dateTime.getTime() < 48 * 60 * 60 * 1000) {
        item.followUpStatus = "indeterminate_insufficient_future_data";
      } else {
        item.followUpStatus = "overdue";
      }
    } else {
      item.followUpStatus = "not_required";
    }

    keys.forEach((key) => {
      const existing = keyToLaterItems.get(key) || [];
      existing.push(item);
      keyToLaterItems.set(key, existing);
    });
  });
}

function buildAlerts(items) {
  const alerts = [];
  items.forEach((item) => {
    const callId = clean(item.row.call_id) || `row-${item.row.__rowNumber}`;
    const customerId = clean(item.row.customer_id);
    const owner = clean(item.row.Salesperson) || "Unknown";
    const businessSegment = businessSegmentFor(item.row);
    const baseAlert = {
      customerId: isMissing(customerId) ? "" : customerId,
      orderCount: orderCount(item.row),
      businessSegment,
      businessSegmentLabel: businessSegmentLabel(businessSegment)
    };

    if (item.evaluation.risk.reviewRequired) {
      const evidence = item.evaluation.evidence.find((entry) => ["complaint", "opt_out"].includes(entry.signal));
      alerts.push({
        ...baseAlert,
        severity: "critical",
        category: item.evaluation.risk.optOut ? "Opt-out detected" : "Complaint or risk signal",
        callId,
        owner,
        message: "A risk signal needs manager review.",
        evidence: evidence?.text || "",
        evidenceSummary: evidence?.summary || "Risk signal needs manager review"
      });
    }

    if (item.evaluation.opportunity.followUpRequired) {
      const evidence = item.evaluation.evidence.find((entry) => entry.signal === "follow_up");
      alerts.push({
        ...baseAlert,
        severity: item.followUpStatus === "overdue" ? "critical" : "notice",
        category: "Follow-up needs review",
        callId,
        owner,
        message: item.followUpStatus === "indeterminate_insufficient_future_data"
          ? "Follow-up signal found, but the upload does not contain enough future data to prove completion."
          : item.followUpStatus === "later_attempt_observed"
            ? "A later matching call attempt exists, but its presence does not prove follow-up completion."
            : "Follow-up signal found with no later matching action in the available data.",
        evidence: evidence?.text || item.evaluation.preview,
        evidenceSummary: evidence?.summary || "Follow-up signal found"
      });
    }
  });

  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, notice: 2 };
    return order[a.severity] - order[b.severity];
  });
}

function durationRelationMatchesFor(rows) {
  return rows.filter((row) => {
    const total = toInt(row.CallTotalSeconds);
    const ring = toInt(row.ring_time_seconds);
    const duration = toInt(row.call_duration_seconds);
    return total !== null && ring !== null && duration !== null && total === ring + duration;
  }).length;
}

function buildFieldCoverage(columns = [], rows = []) {
  return columns.filter((column) => !isUntrustedLegacyField(column)).reduce((coverage, column) => {
    const present = rows.filter((row) => !isMissing(row[column])).length;
    coverage[column] = {
      present,
      missing: rows.length - present,
      coverageRate: percent(present, rows.length)
    };
    return coverage;
  }, {});
}

function buildBusinessSegmentMetrics(items) {
  return summarizeBy(
    items,
    (item) => businessSegmentLabel(businessSegmentFor(item.row)),
    (name) => ({
      name,
      segment: name === "Warm Business" ? "warm" : "new",
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );
}

function buildDashboardView(items, options = {}) {
  const canonicalRows = items.map((item) => item.row);
  const durationRelationMatches = durationRelationMatchesFor(canonicalRows);
  const totals = {
    rawRows: canonicalRows.length,
    uniqueCalls: canonicalRows.length,
    duplicateCallIds: 0,
    salespeople: new Set(canonicalRows.map((row) => clean(row.Salesperson)).filter(Boolean)).size,
    transcriptAvailable: items.filter((item) => item.evaluation.transcript.available).length,
    transcriptUsableForCoaching: items.filter((item) => item.evaluation.transcript.usableForCoaching).length,
    telephonyConnected: items.filter((item) => item.evaluation.contact.telephonyConnected).length,
    probableLiveHuman: items.filter((item) => item.evaluation.contact.probableLiveHuman).length,
    meaningfulConversation: items.filter((item) => item.evaluation.contact.meaningfulConversation).length,
    actionableConversation: items.filter((item) => item.evaluation.contact.actionableConversation).length,
    followUpRequired: items.filter((item) => item.evaluation.opportunity.followUpRequired).length,
    followUpCompleted: 0,
    followUpLaterAttemptObserved: items.filter((item) => item.followUpStatus === "later_attempt_observed").length,
    followUpIndeterminate: items.filter((item) => item.followUpStatus === "indeterminate_insufficient_future_data").length,
    aiVoiceAssistantEncounters: items.filter((item) => item.evaluation.aiVoiceAssistant?.detected).length,
    aiVoiceAssistantHandled: items.filter((item) => item.evaluation.aiVoiceAssistant?.handledSuccessfully).length,
    aiVoiceAssistantBailed: items.filter((item) => item.evaluation.aiVoiceAssistant?.bailed).length,
    aiVoiceAssistantFutureHuman: items.filter((item) => item.evaluation.aiVoiceAssistant?.followThrough?.futureHumanContact).length,
    aiVoiceAssistantFutureMeaningful: items.filter((item) => item.evaluation.aiVoiceAssistant?.followThrough?.futureMeaningfulConversation).length,
    newBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "new").length,
    warmBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "warm").length,
    riskReviews: items.filter((item) => item.evaluation.risk.reviewRequired).length,
    sourceCoverage: canonicalRows.filter((row) => !isMissing(row.CustomerImportSource)).length
  };

  const rates = {
    transcriptCoverage: percent(totals.transcriptAvailable, totals.uniqueCalls),
    transcriptUsableForCoaching: percent(totals.transcriptUsableForCoaching, totals.uniqueCalls),
    telephonyConnected: percent(totals.telephonyConnected, totals.uniqueCalls),
    probableLiveHuman: percent(totals.probableLiveHuman, totals.uniqueCalls),
    meaningfulConversation: percent(totals.meaningfulConversation, totals.uniqueCalls),
    actionableConversation: percent(totals.actionableConversation, totals.uniqueCalls),
    followUpRequired: percent(totals.followUpRequired, totals.uniqueCalls),
    followUpCompleted: percent(totals.followUpCompleted, totals.followUpRequired),
    followUpLaterAttemptObserved: percent(totals.followUpLaterAttemptObserved, totals.followUpRequired),
    aiVoiceAssistantEncounter: percent(totals.aiVoiceAssistantEncounters, totals.uniqueCalls),
    aiVoiceAssistantHandled: percent(totals.aiVoiceAssistantHandled, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantBail: percent(totals.aiVoiceAssistantBailed, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantFutureHuman: percent(totals.aiVoiceAssistantFutureHuman, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantFutureMeaningful: percent(totals.aiVoiceAssistantFutureMeaningful, totals.aiVoiceAssistantEncounters),
    newBusiness: percent(totals.newBusinessCalls, totals.uniqueCalls),
    warmBusiness: percent(totals.warmBusinessCalls, totals.uniqueCalls),
    sourceCoverage: percent(totals.sourceCoverage, totals.uniqueCalls),
    durationRelationMatch: percent(durationRelationMatches, canonicalRows.length)
  };

  const salespersonScorecards = summarizeBy(
    items,
    (item) => clean(item.row.Salesperson),
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceMetrics = summarizeBy(
    items,
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).customerImportSource,
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceQuality = buildSourceQualityModel(items);
  const aiVoiceAssistant = buildAiVoiceAssistantModel(items);
  const leadReattempt = buildLeadReattemptModel(items);
  const leadHarvest = buildLeadHarvestModel(items);
  const systemAudio = buildSystemAudioModel(items);
  const selfSourcingAttribution = buildSelfSourcingAttributionModel(items);
  const weeklyLeadIntelligence = buildWeeklyLeadIntelligenceModel();
  const alerts = buildAlerts(items);
  const reviewQueue = items
    .filter((item) => item.evaluation.risk.reviewRequired || item.evaluation.opportunity.followUpRequired)
    .map((item) => buildExplorerRow(item))
    .slice(0, 250);
  const dateTimes = items.map((item) => item.dateTime).filter(Boolean);
  const minDateTime = dateTimes.length ? new Date(Math.min(...dateTimes.map((date) => date.getTime()))) : null;
  const maxDateTime = dateTimes.length ? new Date(Math.max(...dateTimes.map((date) => date.getTime()))) : null;
  const dateRange = buildDateRange(items, minDateTime, maxDateTime);
  const dataWindow = buildDataWindow(items, totals);
  const intelligenceGovernance = buildIntelligenceGovernance(items, totals);

  return {
    segment: options.segment || "",
    segmentLabel: businessSegmentLabel(options.segment),
    dateRange,
    dataWindow,
    intelligenceGovernance,
    totals,
    rates,
    durationStats: {
      totalSeconds: buildDurationStats(canonicalRows, "CallTotalSeconds"),
      callDurationSeconds: buildDurationStats(canonicalRows, "call_duration_seconds"),
      ringTimeSeconds: buildDurationStats(canonicalRows, "ring_time_seconds")
    },
    salespersonScorecards,
    sourceMetrics,
    sourceQuality,
    aiVoiceAssistant,
    leadReattempt,
    leadHarvest,
    systemAudio,
    selfSourcingAttribution,
    weeklyLeadIntelligence,
    leadUtilization: buildLeadUtilizationModel(items),
    alerts,
    reviewQueue,
    drilldownRows: items.map((item) => buildCallProofRow(item)),
    evaluationRows: items.map((item) => buildEvaluationRow(item)),
    explorerRows: items.slice(-250).reverse().map((item) => buildExplorerRow(item))
  };
}

function analysisWithFilterContext(analysis, filterState, context = {}) {
  const items = internalItemsFor(analysis);
  const filterContext = contextWithAnalysisAlerts(analysis, context);
  const importId = importIdForAlertContext(analysis, filterContext);
  const lifecycleAlerts = enrichAlertsWithLifecycle(analysis.alerts || [], filterContext, importId);
  const filteredAlerts = visibleAlertsForFilters(lifecycleAlerts, filterState);
  const segmentItems = {
    new: items.filter((item) => businessSegmentFor(item.row) === "new"),
    warm: items.filter((item) => businessSegmentFor(item.row) === "warm")
  };
  const businessSegmentViews = Object.fromEntries(
    Object.entries(analysis.businessSegmentViews || {}).map(([segment, view]) => [
      segment,
      applyManagerReviewGovernance(
        lifecycleAlertView(view, filterContext, filterState, importId),
        segmentItems[segment] || [],
        filterContext
      )
    ])
  );
  const filterOptions = buildFilterOptions(items, filterContext);
  const filterSummary = buildFilterSummary(items.length, items.length, filterState);
  return attachInternalItems(applyManagerReviewGovernance({
    ...analysis,
    alerts: filteredAlerts,
    alertLifecycleSummary: alertSummaryForFilters(lifecycleAlerts, filterState),
    businessSegmentViews,
    filterState,
    filterOptions,
    filterSummary,
    datasetTotals: analysis.totals
  }, items, filterContext), items);
}

function mergeContextMap(context = {}, key, callId, values) {
  if (!callId) return;
  const valueList = Array.from(new Set((values || []).filter(Boolean)));
  if (!valueList.length) return;
  if (!(context[key] instanceof Map)) context[key] = new Map();
  const existing = context[key].get(callId) || [];
  context[key].set(callId, Array.from(new Set([...existing, ...valueList])));
}

function cloneContextMap(source) {
  if (source instanceof Map) {
    return new Map(Array.from(source.entries()).map(([key, values]) => [key, Array.isArray(values) ? values.slice() : [values]]));
  }
  const map = new Map();
  Object.entries(source || {}).forEach(([key, value]) => {
    map.set(key, Array.isArray(value) ? value.slice() : value ? [value] : []);
  });
  return map;
}

function cloneAlertEventMap(source) {
  if (source instanceof Map) {
    return new Map(Array.from(source.entries()).map(([key, value]) => [key, normalizeAlertEvent(value)]));
  }
  const map = new Map();
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value) map.set(key, normalizeAlertEvent(value));
  });
  return map;
}

function importIdForAlertContext(analysis, context = {}) {
  return context.currentImportId || context.importId || analysis.persistence?.currentImportId || "current";
}

function alertEventFor(alert, context = {}, importId = "current") {
  const id = alert.id || alert.alertId || alertIdFor(importId, alert);
  const byId = context.alertEventById instanceof Map ? context.alertEventById : cloneAlertEventMap(context.alertEventById);
  return byId.get(id) || null;
}

function enrichAlertsWithLifecycle(alerts = [], context = {}, importId = "current") {
  return (alerts || [])
    .map((alert) => {
      const event = alertEventFor(alert, context, importId);
      return mergeAlertWithEvent(alert, event, importId);
    })
    .filter((alert) => !alert.parkedDataRelated && normalizeAlertStatus(alert.status) !== "parked");
}

function visibleAlertsForFilters(alerts = [], filterState = {}) {
  const severities = new Set(filterState.values?.alertSeverity || []);
  const statuses = new Set(filterState.values?.alertStatus || []);
  return alerts.filter((alert) => {
    if (severities.size && !severities.has(alert.severity || "notice")) return false;
    if (statuses.size) return statuses.has(normalizeAlertStatus(alert.status));
    return isActiveAlertStatus(alert.status);
  });
}

function alertSummaryForFilters(alerts = [], filterState = {}) {
  const severities = new Set(filterState.values?.alertSeverity || []);
  const scopedAlerts = alerts.filter((alert) => !severities.size || severities.has(alert.severity || "notice"));
  return summarizeAlerts(scopedAlerts);
}

function lifecycleAlertView(view = {}, context = {}, filterState = {}, importId = "current") {
  const lifecycleAlerts = enrichAlertsWithLifecycle(view.alerts || [], context, importId);
  return {
    ...view,
    alerts: visibleAlertsForFilters(lifecycleAlerts, filterState),
    alertLifecycleSummary: alertSummaryForFilters(lifecycleAlerts, filterState)
  };
}

function lifecycleBusinessSegmentViews(views = {}, context = {}, filterState = {}, importId = "current") {
  return Object.fromEntries(
    Object.entries(views || {}).map(([segment, view]) => [segment, lifecycleAlertView(view, context, filterState, importId)])
  );
}

function contextMapValue(context = {}, key, callId) {
  const source = context[key];
  if (!source || !callId) return null;
  if (source instanceof Map) return source.get(callId) || null;
  return source[callId] || null;
}

function reviewNeededByEvaluation(item = {}) {
  return Boolean(
    item?.evaluation?.outcome?.reviewRequired ||
    item?.evaluation?.risk?.reviewRequired ||
    item?.evaluation?.opportunity?.followUpRequired
  );
}

function managerReviewStatusForItem(item = {}, context = {}) {
  const callId = clean(item?.row?.call_id || item.callId || item.call_id);
  const stored = contextMapValue(context, "managerReviewStatusByCallId", callId);
  if (stored) return stored;
  return reviewNeededByEvaluation(item) || item.reviewRequired || item.riskReviewRequired ? "review_needed" : "unreviewed";
}

function managerReviewForCallId(context = {}, callId = "") {
  const review = contextMapValue(context, "managerReviewByCallId", callId);
  return review ? normalizeManagerReview(review) : null;
}

function correctionValue(review, fieldName) {
  const correction = (review?.corrections || []).slice().reverse().find((item) => item.fieldName === fieldName);
  return correction ? correction.managerCorrectedValue : "";
}

function managerReviewOverlayForCallId(context = {}, callId = "", item = null) {
  const review = managerReviewForCallId(context, callId);
  const status = review?.reviewStatus || managerReviewStatusForItem(item || { callId }, context);
  return {
    managerReviewStatus: status,
    managerReviewId: review?.reviewId || "",
    managerReviewScope: review?.reviewScope || "",
    managerReviewNotes: review?.managerNotes || "",
    managerReviewedBy: review?.reviewedBy || "",
    managerReviewedAt: review?.reviewedAt || "",
    managerCorrectionCount: (review?.corrections || []).length,
    managerCorrectedFields: (review?.corrections || []).map((correction) => correction.fieldName),
    managerCorrectedOutcome: correctionValue(review, "local_outcome_category"),
    managerCorrectedOutcomeDetail: correctionValue(review, "local_outcome_detail"),
    managerCorrectedContactClassification: correctionValue(review, "contact_classification"),
    managerCorrectedFollowUpStatus: correctionValue(review, "follow_up_status"),
    managerCorrectedFollowUpChannel: correctionValue(review, "follow_up_channel"),
    managerFollowUpManuallyCompleted: correctionValue(review, "follow_up_manually_completed"),
    managerFollowUpDismissed: correctionValue(review, "follow_up_dismissed"),
    managerCoachingNote: correctionValue(review, "coaching_note")
  };
}

function applyManagerReviewOverlayToRow(row = {}, context = {}, item = null) {
  return {
    ...row,
    ...managerReviewOverlayForCallId(context, row.callId || row.call_id || item?.row?.call_id || "", item)
  };
}

function applyManagerReviewOverlays(rows = [], context = {}, itemByCallId = new Map()) {
  return (rows || []).map((row) => applyManagerReviewOverlayToRow(row, context, itemByCallId.get(row.callId || row.call_id) || null));
}

function applyManagerReviewOverlayToAlert(alert = {}, context = {}) {
  return {
    ...alert,
    ...managerReviewOverlayForCallId(context, alert.callId || alert.call_id || "", null)
  };
}

function buildManagerReviewGovernance(items = [], context = {}) {
  const byStatus = Object.fromEntries(MANAGER_REVIEW_STATUSES.map((status) => [status, 0]));
  const topCorrectedFields = new Map();
  const reviewedCallIds = new Set();
  const correctedCallIds = new Set();
  const reviewNeededCallIds = new Set();
  const escalatedCallIds = new Set();
  const dismissedCallIds = new Set();
  items.forEach((item) => {
    const callId = clean(item?.row?.call_id || item.callId || item.call_id);
    const review = managerReviewForCallId(context, callId);
    const status = review?.reviewStatus || managerReviewStatusForItem(item, context);
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (review) reviewedCallIds.add(callId);
    if (status === "review_needed") reviewNeededCallIds.add(callId);
    if (status === "reviewed_corrected" || (review?.corrections || []).length) correctedCallIds.add(callId);
    if (status === "escalated") escalatedCallIds.add(callId);
    if (status === "dismissed") dismissedCallIds.add(callId);
    (review?.corrections || []).forEach((correction) => {
      topCorrectedFields.set(correction.fieldName, (topCorrectedFields.get(correction.fieldName) || 0) + 1);
    });
  });
  return {
    schemaVersion: "sales_dashboard_manager_review_governance.v1",
    totalCalls: items.length,
    callsWithAnyManagerReview: reviewedCallIds.size,
    reviewedCalls: reviewedCallIds.size,
    reviewedConfirmedCalls: byStatus.reviewed_confirmed || 0,
    reviewedCorrectedCalls: byStatus.reviewed_corrected || 0,
    correctedCalls: correctedCallIds.size,
    dismissedCalls: dismissedCallIds.size,
    escalatedCalls: escalatedCallIds.size,
    reviewNeededCalls: reviewNeededCallIds.size,
    inReviewCalls: byStatus.in_review || 0,
    correctionRate: items.length ? Math.round((correctedCallIds.size / items.length) * 1000) / 10 : 0,
    coverageRate: items.length ? Math.round((reviewedCallIds.size / items.length) * 1000) / 10 : 0,
    byStatus,
    topCorrectedFields: Array.from(topCorrectedFields.entries())
      .map(([fieldName, count]) => ({ fieldName, count }))
      .sort((a, b) => b.count - a.count || a.fieldName.localeCompare(b.fieldName))
      .slice(0, 10)
  };
}

function applyManagerReviewGovernance(analysis, items = [], context = {}) {
  const itemByCallId = new Map(items.map((item) => [clean(item.row?.call_id), item]));
  return {
    ...analysis,
    managerReviewGovernance: buildManagerReviewGovernance(items, context),
    alerts: (analysis.alerts || []).map((alert) => applyManagerReviewOverlayToAlert(alert, context)),
    reviewQueue: applyManagerReviewOverlays(analysis.reviewQueue || [], context, itemByCallId),
    explorerRows: applyManagerReviewOverlays(analysis.explorerRows || [], context, itemByCallId),
    drilldownRows: applyManagerReviewOverlays(analysis.drilldownRows || [], context, itemByCallId),
    evaluationRows: applyManagerReviewOverlays(analysis.evaluationRows || [], context, itemByCallId)
  };
}

function contextWithAnalysisAlerts(analysis, context = {}) {
  const importId = importIdForAlertContext(analysis, context);
  const alertEventById = cloneAlertEventMap(context.alertEventById);
  const merged = {
    ...context,
    currentImportId: importId,
    alertEventById,
    alertSeverityByCallId: cloneContextMap(context.alertSeverityByCallId),
    alertStatusByCallId: cloneContextMap(context.alertStatusByCallId)
  };
  (analysis.alerts || []).forEach((alert) => {
    const event = alertEventFor(alert, merged, importId);
    const status = event ? normalizeAlertStatus(event.status) : normalizeAlertStatus(alert.status || "new");
    mergeContextMap(merged, "alertSeverityByCallId", alert.callId, [alert.severity || "notice"]);
    mergeContextMap(merged, "alertStatusByCallId", alert.callId, [status]);
  });
  return merged;
}

function buildFilteredAnalysis(analysis, filterInput = {}, context = {}) {
  const filterState = filterInput?.schemaVersion ? filterInput : normalizeFilterState(filterInput);
  const items = internalItemsFor(analysis);
  const filterContext = contextWithAnalysisAlerts(analysis, context);
  if (!items.length) {
    const emptyAlerts = [];
    return {
      ...analysis,
      alerts: emptyAlerts,
      alertLifecycleSummary: summarizeAlerts(emptyAlerts),
      filterState,
      filterOptions: {},
      filterSummary: buildFilterSummary(0, 0, filterState),
      datasetTotals: analysis?.totals || {}
    };
  }
  if (!filterState.active) {
    return analysisWithFilterContext(analysis, filterState, filterContext);
  }

  const filteredItems = applyCallFilters(items, filterState, filterContext);
  const view = buildDashboardView(filteredItems);
  const importId = importIdForAlertContext(analysis, filterContext);
  const lifecycleAlerts = enrichAlertsWithLifecycle(view.alerts, filterContext, importId);
  const filteredAlerts = visibleAlertsForFilters(lifecycleAlerts, filterState);
  const canonicalRows = filteredItems.map((item) => item.row);
  const filterOptions = buildFilterOptions(filteredItems, filterContext);
  const filterSummary = buildFilterSummary(items.length, filteredItems.length, filterState);
  const businessSegmentMetrics = buildBusinessSegmentMetrics(filteredItems);
  const businessSegmentViews = {
    new: buildDashboardView(filteredItems.filter((item) => businessSegmentFor(item.row) === "new"), { segment: "new" }),
    warm: buildDashboardView(filteredItems.filter((item) => businessSegmentFor(item.row) === "warm"), { segment: "warm" })
  };
  const segmentItems = {
    new: filteredItems.filter((item) => businessSegmentFor(item.row) === "new"),
    warm: filteredItems.filter((item) => businessSegmentFor(item.row) === "warm")
  };
  const lifecycleSegmentViews = Object.fromEntries(
    Object.entries(businessSegmentViews).map(([segment, view]) => [
      segment,
      applyManagerReviewGovernance(
        lifecycleAlertView(view, filterContext, filterState, importId),
        segmentItems[segment] || [],
        filterContext
      )
    ])
  );

  return attachInternalItems(applyManagerReviewGovernance({
    ...analysis,
    ...view,
    alerts: filteredAlerts,
    alertLifecycleSummary: alertSummaryForFilters(lifecycleAlerts, filterState),
    schemaVersion: analysis.schemaVersion,
    sourceName: analysis.sourceName,
    inputHash: analysis.inputHash,
    generatedAt: analysis.generatedAt,
    columns: analysis.columns,
    missingColumns: analysis.missingColumns,
    ignoredFields: analysis.ignoredFields,
    unsupportedMetrics: analysis.unsupportedMetrics,
    activeDataSources: analysis.activeDataSources,
    parkedAllocation: analysis.parkedAllocation,
    persistence: analysis.persistence,
    intelligence: analysis.intelligence,
    fieldCoverage: buildFieldCoverage(analysis.columns || [], canonicalRows),
    businessSegmentMetrics,
    businessSegmentViews: lifecycleSegmentViews,
    filterState,
    filterOptions,
    filterSummary,
    datasetTotals: analysis.totals
  }, filteredItems, filterContext), filteredItems);
}

function analyzeCsvText(csvText, options = {}) {
  const inputHash = crypto.createHash("sha256").update(csvText).digest("hex");
  const parsed = parseCsv(csvText);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !parsed.columns.includes(column));
  const rawRows = parsed.rows;
  const callIdCounts = {};
  rawRows.forEach((row) => inc(callIdCounts, clean(row.call_id) || `missing:${row.__rowNumber}`));

  const seenCallIds = new Set();
  const duplicateCallIds = [];
  const canonicalRows = [];
  rawRows.forEach((row) => {
    const callId = clean(row.call_id) || `missing:${row.__rowNumber}`;
    if (seenCallIds.has(callId)) {
      duplicateCallIds.push(callId);
      return;
    }
    seenCallIds.add(callId);
    canonicalRows.push(row);
  });

  const items = canonicalRows.map((row) => {
    const dateTime = parseDateTime(row);
    return {
      row,
      dateTime,
      sourceAttribution: sourceAttributionFor(row, dateTime),
      evaluation: evaluateCall(row)
    };
  }).sort((a, b) => {
    const aTime = a.dateTime ? a.dateTime.getTime() : 0;
    const bTime = b.dateTime ? b.dateTime.getTime() : 0;
    return aTime - bTime;
  });

  const dateTimes = items.map((item) => item.dateTime).filter(Boolean);
  const minDateTime = dateTimes.length ? new Date(Math.min(...dateTimes.map((date) => date.getTime()))) : null;
  const maxDateTime = dateTimes.length ? new Date(Math.max(...dateTimes.map((date) => date.getTime()))) : null;
  linkFollowUps(items, maxDateTime);
  linkAiVoiceAssistantOutcomes(items, maxDateTime);
  const leadUtilization = buildLeadUtilizationModel(items);

  const activeColumns = parsed.columns.filter((column) => !isUntrustedLegacyField(column));
  const fieldCoverage = buildFieldCoverage(activeColumns, rawRows);

  const durationRelationMatches = durationRelationMatchesFor(rawRows);

  const totals = {
    rawRows: rawRows.length,
    uniqueCalls: canonicalRows.length,
    duplicateCallIds: duplicateCallIds.length,
    salespeople: new Set(canonicalRows.map((row) => clean(row.Salesperson)).filter(Boolean)).size,
    transcriptAvailable: items.filter((item) => item.evaluation.transcript.available).length,
    transcriptUsableForCoaching: items.filter((item) => item.evaluation.transcript.usableForCoaching).length,
    telephonyConnected: items.filter((item) => item.evaluation.contact.telephonyConnected).length,
    probableLiveHuman: items.filter((item) => item.evaluation.contact.probableLiveHuman).length,
    meaningfulConversation: items.filter((item) => item.evaluation.contact.meaningfulConversation).length,
    actionableConversation: items.filter((item) => item.evaluation.contact.actionableConversation).length,
    followUpRequired: items.filter((item) => item.evaluation.opportunity.followUpRequired).length,
    followUpCompleted: 0,
    followUpLaterAttemptObserved: items.filter((item) => item.followUpStatus === "later_attempt_observed").length,
    followUpIndeterminate: items.filter((item) => item.followUpStatus === "indeterminate_insufficient_future_data").length,
    aiVoiceAssistantEncounters: items.filter((item) => item.evaluation.aiVoiceAssistant?.detected).length,
    aiVoiceAssistantHandled: items.filter((item) => item.evaluation.aiVoiceAssistant?.handledSuccessfully).length,
    aiVoiceAssistantBailed: items.filter((item) => item.evaluation.aiVoiceAssistant?.bailed).length,
    aiVoiceAssistantFutureHuman: items.filter((item) => item.evaluation.aiVoiceAssistant?.followThrough?.futureHumanContact).length,
    aiVoiceAssistantFutureMeaningful: items.filter((item) => item.evaluation.aiVoiceAssistant?.followThrough?.futureMeaningfulConversation).length,
    newBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "new").length,
    warmBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "warm").length,
    riskReviews: items.filter((item) => item.evaluation.risk.reviewRequired).length,
    sourceCoverage: canonicalRows.filter((row) => !isMissing(row.CustomerImportSource)).length
  };

  const rates = {
    transcriptCoverage: percent(totals.transcriptAvailable, totals.uniqueCalls),
    transcriptUsableForCoaching: percent(totals.transcriptUsableForCoaching, totals.uniqueCalls),
    telephonyConnected: percent(totals.telephonyConnected, totals.uniqueCalls),
    probableLiveHuman: percent(totals.probableLiveHuman, totals.uniqueCalls),
    meaningfulConversation: percent(totals.meaningfulConversation, totals.uniqueCalls),
    actionableConversation: percent(totals.actionableConversation, totals.uniqueCalls),
    followUpRequired: percent(totals.followUpRequired, totals.uniqueCalls),
    followUpCompleted: percent(totals.followUpCompleted, totals.followUpRequired),
    followUpLaterAttemptObserved: percent(totals.followUpLaterAttemptObserved, totals.followUpRequired),
    aiVoiceAssistantEncounter: percent(totals.aiVoiceAssistantEncounters, totals.uniqueCalls),
    aiVoiceAssistantHandled: percent(totals.aiVoiceAssistantHandled, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantBail: percent(totals.aiVoiceAssistantBailed, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantFutureHuman: percent(totals.aiVoiceAssistantFutureHuman, totals.aiVoiceAssistantEncounters),
    aiVoiceAssistantFutureMeaningful: percent(totals.aiVoiceAssistantFutureMeaningful, totals.aiVoiceAssistantEncounters),
    newBusiness: percent(totals.newBusinessCalls, totals.uniqueCalls),
    warmBusiness: percent(totals.warmBusinessCalls, totals.uniqueCalls),
    sourceCoverage: percent(totals.sourceCoverage, totals.uniqueCalls),
    durationRelationMatch: percent(durationRelationMatches, rawRows.length)
  };

  const salespersonScorecards = summarizeBy(
    items,
    (item) => clean(item.row.Salesperson),
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceMetrics = summarizeBy(
    items,
    (item) => (item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime)).customerImportSource,
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const businessSegmentMetrics = buildBusinessSegmentMetrics(items);

  const businessSegmentViews = {
    new: buildDashboardView(items.filter((item) => businessSegmentFor(item.row) === "new"), { segment: "new" }),
    warm: buildDashboardView(items.filter((item) => businessSegmentFor(item.row) === "warm"), { segment: "warm" })
  };
  const sourceQuality = buildSourceQualityModel(items);
  const aiVoiceAssistant = buildAiVoiceAssistantModel(items);
  const leadReattempt = buildLeadReattemptModel(items);
  const leadHarvest = buildLeadHarvestModel(items);
  const systemAudio = buildSystemAudioModel(items);
  const selfSourcingAttribution = buildSelfSourcingAttributionModel(items);
  const weeklyLeadIntelligence = buildWeeklyLeadIntelligenceModel();
  const allocationRowsOption = options.allocationRows || options.allocations?.rows || [];
  const allocationConfigured = Boolean(
    options.parkedAllocation?.configured ||
    options.allocationMetadata ||
    options.allocations?.metadata ||
    options.allocationError ||
    options.allocations?.error ||
    allocationRowsOption.length
  );
  const parkedAllocation = buildParkedAllocationDiagnostic({
    ...(options.allocationMetadata || options.allocations?.metadata || {}),
    ...(options.parkedAllocation || {}),
    configured: allocationConfigured,
    error: options.parkedAllocation?.error || options.allocationError || options.allocations?.error || "",
    readStatus: options.parkedAllocation?.readStatus || (allocationConfigured ? "parked_not_used" : "")
  });

  const alerts = buildAlerts(items);
  const reviewQueue = items
    .filter((item) => item.evaluation.risk.reviewRequired || item.evaluation.opportunity.followUpRequired)
    .map((item) => buildExplorerRow(item))
    .slice(0, 250);
  const dateRange = buildDateRange(items, minDateTime, maxDateTime);
  const dataWindow = buildDataWindow(items, totals);
  const intelligenceGovernance = buildIntelligenceGovernance(items, totals);

  const result = {
    schemaVersion: "sales_dashboard_analysis.v1",
    sourceName: options.sourceName || "CSV import",
    inputHash,
    generatedAt: new Date().toISOString(),
    columns: activeColumns,
    missingColumns,
    ignoredFields: IGNORED_FIELDS,
    unsupportedMetrics: [
      "confirmed sales conversion",
      "salesperson revenue performance",
      "won/lost commercial outcome",
      "revenue attribution",
      "order value generated by a call"
    ],
    dateRange,
    dataWindow,
    intelligenceGovernance,
    totals,
    rates,
    durationStats: {
      totalSeconds: buildDurationStats(canonicalRows, "CallTotalSeconds"),
      callDurationSeconds: buildDurationStats(canonicalRows, "call_duration_seconds"),
      ringTimeSeconds: buildDurationStats(canonicalRows, "ring_time_seconds")
    },
    fieldCoverage,
    salespersonScorecards,
    sourceMetrics,
    sourceQuality,
    activeDataSources: {
      callCsv: true,
      transcriptText: true,
      canonicalCallFields: true,
      allocationImports: false
    },
    parkedAllocation,
    aiVoiceAssistant,
    leadReattempt,
    leadHarvest,
    systemAudio,
    selfSourcingAttribution,
    weeklyLeadIntelligence,
    businessSegmentMetrics,
    businessSegmentViews,
    leadUtilization,
    alerts,
    reviewQueue,
    drilldownRows: items.map((item) => buildCallProofRow(item)),
    evaluationRows: items.map((item) => buildEvaluationRow(item)),
    explorerRows: items.slice(-250).reverse().map((item) => buildExplorerRow(item))
  };
  return attachInternalItems(applyManagerReviewGovernance(result, items, {}), items);
}

function buildEvaluationRow(item) {
  const row = item.row;
  const segment = businessSegmentFor(row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(row, item.dateTime);
  const customerId = clean(row.customer_id);
  const contactId = clean(row.ContactId);
  const governance = rowGovernance(item);
  return {
    callId: clean(row.call_id),
    customerId: isMissing(customerId) ? "" : customerId,
    contactId: isMissing(contactId) ? "" : contactId,
    date: clean(row.call_date),
    time: clean(row.call_time),
    sourceTime: formatSourceDateTimeValue(row.call_date, row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    userId: clean(row.UserID) || "",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: sourceAttribution.customerImportSource,
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
    orderCount: orderCount(row),
    orderHistoryLabel: orderHistoryLabel(row),
    businessSegment: segment,
    businessSegmentLabel: businessSegmentLabel(segment),
    durationSeconds: item.evaluation.durationSeconds,
    totalSeconds: item.evaluation.totalSeconds,
    localOutcome: item.evaluation.outcome.localCategory,
    localOutcomeConfidence: item.evaluation.outcome.confidence,
    contactClassification: item.evaluation.contact.classification,
    probableLiveHuman: item.evaluation.contact.probableLiveHuman,
    meaningfulConversation: item.evaluation.contact.meaningfulConversation,
    actionableConversation: item.evaluation.contact.actionableConversation,
    transcriptQuality: item.evaluation.transcript.qualityBand,
    transcriptWordCount: item.evaluation.transcript.wordCount,
    aiVoiceAssistantDetected: Boolean(item.evaluation.aiVoiceAssistant?.detected),
    aiVoiceAssistantConfidence: item.evaluation.aiVoiceAssistant?.confidence || 0,
    aiVoiceAssistantResponse: item.evaluation.aiVoiceAssistant?.responseClassification || "not_encountered",
    aiVoiceAssistantHandledSuccessfully: Boolean(item.evaluation.aiVoiceAssistant?.handledSuccessfully),
    aiVoiceAssistantBailed: Boolean(item.evaluation.aiVoiceAssistant?.bailed),
    aiVoiceAssistantTactics: item.evaluation.aiVoiceAssistant?.tacticLabels || [],
    aiVoiceAssistantFutureStatus: item.evaluation.aiVoiceAssistant?.followThrough?.status || "not_applicable",
    aiVoiceAssistantFutureCallId: item.evaluation.aiVoiceAssistant?.followThrough?.futureCallId || "",
    systemAudioDetected: Boolean(item.evaluation.systemAudio?.detected),
    systemAudioSubtype: item.evaluation.systemAudio?.subtype || "none",
    systemAudioSubtypeLabel: item.evaluation.systemAudio?.label || "None",
    followUpRequired: item.evaluation.opportunity.followUpRequired,
    followUpStatus: item.followUpStatus,
    followUpMatchedCallId: item.followUpMatchedCallId || "",
    followUpMatch: item.followUpMatch || null,
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    riskReviewRequired: item.evaluation.risk.reviewRequired,
    reviewRequired: item.evaluation.outcome.reviewRequired,
    ...governance,
    evidence: item.evaluation.evidence.map((evidence) => ({
      signal: evidence.signal,
      summary: evidence.summary,
      text: evidence.text,
      turns: evidence.turns || [],
      matchText: evidence.matchText || "",
      confidence: evidence.confidence
    }))
  };
}

function buildExplorerRow(item) {
  const row = item.row;
  const segment = businessSegmentFor(row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(row, item.dateTime);
  const customerId = clean(row.customer_id);
  const contactId = clean(row.ContactId);
  const governance = rowGovernance(item);
  return {
    callId: clean(row.call_id),
    customerId: isMissing(customerId) ? "" : customerId,
    contactId: isMissing(contactId) ? "" : contactId,
    date: clean(row.call_date),
    time: clean(row.call_time),
    sourceTime: formatSourceDateTimeValue(row.call_date, row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: sourceAttribution.customerImportSource,
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
    orderCount: orderCount(row),
    orderHistoryLabel: orderHistoryLabel(row),
    businessSegment: segment,
    businessSegmentLabel: businessSegmentLabel(segment),
    durationSeconds: item.evaluation.durationSeconds,
    localOutcome: item.evaluation.outcome.localCategory,
    contactClassification: item.evaluation.contact.classification,
    transcriptQuality: item.evaluation.transcript.qualityBand,
    aiVoiceAssistantDetected: Boolean(item.evaluation.aiVoiceAssistant?.detected),
    aiVoiceAssistantResponse: item.evaluation.aiVoiceAssistant?.responseClassification || "not_encountered",
    aiVoiceAssistantHandledSuccessfully: Boolean(item.evaluation.aiVoiceAssistant?.handledSuccessfully),
    aiVoiceAssistantBailed: Boolean(item.evaluation.aiVoiceAssistant?.bailed),
    aiVoiceAssistantTactics: item.evaluation.aiVoiceAssistant?.tacticLabels || [],
    aiVoiceAssistantFutureStatus: item.evaluation.aiVoiceAssistant?.followThrough?.status || "not_applicable",
    aiVoiceAssistantFutureCallId: item.evaluation.aiVoiceAssistant?.followThrough?.futureCallId || "",
    systemAudioDetected: Boolean(item.evaluation.systemAudio?.detected),
    systemAudioSubtype: item.evaluation.systemAudio?.subtype || "none",
    systemAudioSubtypeLabel: item.evaluation.systemAudio?.label || "None",
    followUpStatus: item.followUpStatus,
    followUpMatchedCallId: item.followUpMatchedCallId || "",
    followUpMatch: item.followUpMatch || null,
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    reviewRequired: item.evaluation.outcome.reviewRequired,
    ...governance,
    evidence: item.evaluation.evidence.map((evidence) => evidence.summary || evidence.text).filter(Boolean).slice(0, 2),
    transcriptPreview: item.evaluation.preview
  };
}

module.exports = {
  analyzeCsvText,
  buildFilteredAnalysis,
  attachInternalItems,
  internalItemsFor,
  IGNORED_FIELDS,
  ENTITY_FIELDS
};
