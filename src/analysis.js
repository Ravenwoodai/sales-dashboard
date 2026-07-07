"use strict";

const crypto = require("crypto");
const { ENTITY_FIELDS } = require("./analysisConstants");
const { parseCsv } = require("./csvParser");
const { clean, isMissing, toInt, evaluateCall } = require("./transcriptEvaluator");
const { buildLeadUtilizationModel } = require("./leadUtilizationReport");
const { buildCallProofRow } = require("./drilldown");
const { SOURCE_AGE_THRESHOLDS, ageBucketSort, sourceAttributionFor } = require("./sourceQuality");

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
  "NoSaleType",
  "Baz_DetailedNotes",
  "CustomerImportSource"
];

function parseDateTime(row) {
  const date = clean(row.call_date);
  const time = clean(row.call_time);
  const dateMatch = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute, second] = timeMatch;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function entityKeys(row) {
  return ENTITY_FIELDS
    .map((field) => {
      const value = clean(row[field]);
      return isMissing(value) ? null : `${field}:${value}`;
    })
    .filter(Boolean);
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
    if (item.evaluation.outcome.mismatch) group.outcomeMismatches += 1;
    if (item.evaluation.risk.reviewRequired) group.riskReviews += 1;
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
      outcomeMismatchRate: percent(group.outcomeMismatches, group.calls),
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
    callsWithManualCreator: 0,
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
    outcomeMismatches: 0,
    riskReviews: 0,
    noHumanAnswerCalls: 0,
    ...extras
  };
  SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
    group[`newBusinessImportedOlderThan${threshold}`] = 0;
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
  if (attribution.hasManualCreator) group.callsWithManualCreator += 1;
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
  if (item.evaluation.outcome.mismatch) group.outcomeMismatches += 1;
  if (item.evaluation.risk.reviewRequired) group.riskReviews += 1;
  if (!item.evaluation.contact.probableLiveHuman) group.noHumanAnswerCalls += 1;
  if (segment === "new" && attribution.daysSinceImport !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (attribution.daysSinceImport > threshold) {
        group[`newBusinessImportedOlderThan${threshold}`] += 1;
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
    outcomeMismatchRate: percent(group.outcomeMismatches, group.calls),
    riskReviewRate: percent(group.riskReviews, group.calls),
    bulkSourceCoverageRate: percent(group.callsWithBulkSource, group.calls),
    importDateCoverageRate: percent(group.callsWithImportDate, group.calls),
    manualCreatorCoverageRate: percent(group.callsWithManualCreator, group.calls),
    createDateCoverageRate: percent(group.callsWithCreateDate, group.calls),
    averageImportAgeDays: group.callsWithImportDate ? Math.round(group.totalImportAgeDays / group.callsWithImportDate) : null,
    averageCreateAgeDays: group.callsWithCreateDate ? Math.round(group.totalCreateAgeDays / group.callsWithCreateDate) : null
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

  const rankedSources = sourceRows
    .filter((row) => row.calls >= 25 && row.name !== "Unknown source")
    .sort((a, b) => a.probableLiveHumanRate - b.probableLiveHumanRate || b.calls - a.calls || a.name.localeCompare(b.name));

  return {
    schemaVersion: "sales_dashboard_source_quality.v1",
    thresholds: SOURCE_AGE_THRESHOLDS,
    definitions: {
      bulkSource: "CustomerImportDate and CustomerImportSource from bulk lead sourcing operations.",
      manualCreator: "CustomerCreatedBy, CustomerCreatedByType, and CustomerCreateDate from manual LG/SP entry.",
      humanAnswerRate: "Probable live-human calls divided by total calls for that source or creator.",
      newBusinessImportAge: "New Business calls where CustomerImportDate is more than X days before the call date."
    },
    totals: finalizedTotals,
    sourceRows,
    creatorRows,
    createdByTypeRows,
    importAgeBuckets,
    creatorAgeBuckets,
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
    const uniqueLaterMatches = Array.from(new Map(laterMatches.map((match) => [match.row.call_id, match])).values());

    if (item.evaluation.opportunity.followUpRequired) {
      if (uniqueLaterMatches.length > 0) {
        item.followUpStatus = "completed";
        item.followUpMatchedCallId = clean(uniqueLaterMatches[0].row.call_id);
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

    if (item.evaluation.outcome.mismatch) {
      const evidence = item.evaluation.evidence.find((entry) => entry.signal === "outcome_mismatch");
      alerts.push({
        ...baseAlert,
        severity: "warning",
        category: "Imported outcome mismatch",
        callId,
        owner,
        message: `Imported disposition does not align with local outcome: ${item.evaluation.outcome.localCategory}.`,
        evidence: evidence?.text || item.evaluation.preview,
        evidenceSummary: evidence?.summary || "Imported outcome may not match the transcript"
      });
    }

    if (item.evaluation.opportunity.followUpRequired && item.followUpStatus !== "completed") {
      const evidence = item.evaluation.evidence.find((entry) => entry.signal === "follow_up");
      alerts.push({
        ...baseAlert,
        severity: item.followUpStatus === "overdue" ? "critical" : "notice",
        category: "Follow-up needs review",
        callId,
        owner,
        message: item.followUpStatus === "indeterminate_insufficient_future_data"
          ? "Follow-up signal found, but the upload does not contain enough future data to prove completion."
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
    followUpCompleted: items.filter((item) => item.followUpStatus === "completed").length,
    followUpIndeterminate: items.filter((item) => item.followUpStatus === "indeterminate_insufficient_future_data").length,
    newBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "new").length,
    warmBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "warm").length,
    outcomeMismatches: items.filter((item) => item.evaluation.outcome.mismatch).length,
    riskReviews: items.filter((item) => item.evaluation.risk.reviewRequired).length,
    noSaleCoverage: canonicalRows.filter((row) => !isMissing(row.NoSaleType)).length,
    bazNotesCoverage: canonicalRows.filter((row) => !isMissing(row.Baz_DetailedNotes)).length,
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
    newBusiness: percent(totals.newBusinessCalls, totals.uniqueCalls),
    warmBusiness: percent(totals.warmBusinessCalls, totals.uniqueCalls),
    outcomeMismatch: percent(totals.outcomeMismatches, totals.uniqueCalls),
    noSaleCoverage: percent(totals.noSaleCoverage, totals.uniqueCalls),
    bazNotesCoverage: percent(totals.bazNotesCoverage, totals.uniqueCalls),
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
      outcomeMismatches: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceMetrics = summarizeBy(
    items,
    (item) => (isMissing(item.row.CustomerImportSource) ? "Unknown source" : clean(item.row.CustomerImportSource)),
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      outcomeMismatches: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceQuality = buildSourceQualityModel(items);
  const alerts = buildAlerts(items);
  const reviewQueue = items
    .filter((item) => item.evaluation.outcome.reviewRequired || item.evaluation.opportunity.followUpRequired)
    .map((item) => buildExplorerRow(item))
    .slice(0, 250);

  return {
    segment: options.segment || "",
    segmentLabel: businessSegmentLabel(options.segment),
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
    leadUtilization: buildLeadUtilizationModel(items),
    alerts,
    reviewQueue,
    drilldownRows: items.map((item) => buildCallProofRow(item)),
    evaluationRows: items.map((item) => buildEvaluationRow(item)),
    explorerRows: items.slice(-250).reverse().map((item) => buildExplorerRow(item))
  };
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
  const leadUtilization = buildLeadUtilizationModel(items);

  const fieldCoverage = {};
  parsed.columns.forEach((column) => {
    const present = rawRows.filter((row) => !isMissing(row[column])).length;
    fieldCoverage[column] = {
      present,
      missing: rawRows.length - present,
      coverageRate: percent(present, rawRows.length)
    };
  });

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
    followUpCompleted: items.filter((item) => item.followUpStatus === "completed").length,
    followUpIndeterminate: items.filter((item) => item.followUpStatus === "indeterminate_insufficient_future_data").length,
    newBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "new").length,
    warmBusinessCalls: items.filter((item) => businessSegmentFor(item.row) === "warm").length,
    outcomeMismatches: items.filter((item) => item.evaluation.outcome.mismatch).length,
    riskReviews: items.filter((item) => item.evaluation.risk.reviewRequired).length,
    noSaleCoverage: canonicalRows.filter((row) => !isMissing(row.NoSaleType)).length,
    bazNotesCoverage: canonicalRows.filter((row) => !isMissing(row.Baz_DetailedNotes)).length,
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
    newBusiness: percent(totals.newBusinessCalls, totals.uniqueCalls),
    warmBusiness: percent(totals.warmBusinessCalls, totals.uniqueCalls),
    outcomeMismatch: percent(totals.outcomeMismatches, totals.uniqueCalls),
    noSaleCoverage: percent(totals.noSaleCoverage, totals.uniqueCalls),
    bazNotesCoverage: percent(totals.bazNotesCoverage, totals.uniqueCalls),
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
      outcomeMismatches: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const sourceMetrics = summarizeBy(
    items,
    (item) => (isMissing(item.row.CustomerImportSource) ? "Unknown source" : clean(item.row.CustomerImportSource)),
    (name) => ({
      name,
      calls: 0,
      transcriptAvailable: 0,
      telephonyConnected: 0,
      probableLiveHuman: 0,
      meaningfulConversation: 0,
      actionableConversation: 0,
      followUpRequired: 0,
      outcomeMismatches: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const businessSegmentMetrics = summarizeBy(
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
      outcomeMismatches: 0,
      riskReviews: 0,
      totalDuration: 0
    })
  );

  const businessSegmentViews = {
    new: buildDashboardView(items.filter((item) => businessSegmentFor(item.row) === "new"), { segment: "new" }),
    warm: buildDashboardView(items.filter((item) => businessSegmentFor(item.row) === "warm"), { segment: "warm" })
  };
  const sourceQuality = buildSourceQualityModel(items);

  const alerts = buildAlerts(items);
  const reviewQueue = items
    .filter((item) => item.evaluation.outcome.reviewRequired || item.evaluation.opportunity.followUpRequired)
    .map((item) => buildExplorerRow(item))
    .slice(0, 250);

  return {
    schemaVersion: "sales_dashboard_analysis.v1",
    sourceName: options.sourceName || "CSV import",
    inputHash,
    generatedAt: new Date().toISOString(),
    columns: parsed.columns,
    missingColumns,
    ignoredFields: IGNORED_FIELDS,
    unsupportedMetrics: [
      "confirmed sales conversion",
      "salesperson revenue performance",
      "won/lost commercial outcome",
      "revenue attribution",
      "order value generated by a call"
    ],
    dateRange: {
      start: minDateTime ? minDateTime.toISOString() : null,
      end: maxDateTime ? maxDateTime.toISOString() : null
    },
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
    businessSegmentMetrics,
    businessSegmentViews,
    leadUtilization,
    alerts,
    reviewQueue,
    drilldownRows: items.map((item) => buildCallProofRow(item)),
    evaluationRows: items.map((item) => buildEvaluationRow(item)),
    explorerRows: items.slice(-250).reverse().map((item) => buildExplorerRow(item))
  };
}

function buildEvaluationRow(item) {
  const row = item.row;
  const segment = businessSegmentFor(row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(row, item.dateTime);
  const customerId = clean(row.customer_id);
  return {
    callId: clean(row.call_id),
    customerId: isMissing(customerId) ? "" : customerId,
    date: clean(row.call_date),
    time: clean(row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    userId: clean(row.UserID) || "",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: isMissing(row.CustomerImportSource) ? "Unknown source" : clean(row.CustomerImportSource),
    customerImportSource: sourceAttribution.customerImportSource,
    customerImportDate: sourceAttribution.customerImportDate,
    customerImportDateIso: sourceAttribution.customerImportDateIso,
    customerCreatedBy: sourceAttribution.customerCreatedBy,
    customerCreatedByType: sourceAttribution.customerCreatedByType,
    customerCreatedByTypeLabel: sourceAttribution.customerCreatedByTypeLabel,
    customerCreateDate: sourceAttribution.customerCreateDate,
    customerCreateDateIso: sourceAttribution.customerCreateDateIso,
    daysSinceImport: sourceAttribution.daysSinceImport,
    daysSinceCreated: sourceAttribution.daysSinceCreated,
    importAgeBucket: sourceAttribution.importAgeBucket,
    createAgeBucket: sourceAttribution.createAgeBucket,
    hasBulkSource: sourceAttribution.hasBulkSource,
    hasManualCreator: sourceAttribution.hasManualCreator,
    orderCount: orderCount(row),
    businessSegment: segment,
    businessSegmentLabel: businessSegmentLabel(segment),
    durationSeconds: item.evaluation.durationSeconds,
    totalSeconds: item.evaluation.totalSeconds,
    importedNoSale: item.evaluation.outcome.importedNoSale || "Blank",
    localOutcome: item.evaluation.outcome.localCategory,
    localOutcomeConfidence: item.evaluation.outcome.confidence,
    contactClassification: item.evaluation.contact.classification,
    probableLiveHuman: item.evaluation.contact.probableLiveHuman,
    meaningfulConversation: item.evaluation.contact.meaningfulConversation,
    actionableConversation: item.evaluation.contact.actionableConversation,
    transcriptQuality: item.evaluation.transcript.qualityBand,
    transcriptWordCount: item.evaluation.transcript.wordCount,
    followUpRequired: item.evaluation.opportunity.followUpRequired,
    followUpStatus: item.followUpStatus,
    followUpMatchedCallId: item.followUpMatchedCallId || "",
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    riskReviewRequired: item.evaluation.risk.reviewRequired,
    outcomeMismatch: item.evaluation.outcome.mismatch,
    reviewRequired: item.evaluation.outcome.reviewRequired,
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
  return {
    callId: clean(row.call_id),
    customerId: isMissing(customerId) ? "" : customerId,
    date: clean(row.call_date),
    time: clean(row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: isMissing(row.CustomerImportSource) ? "Unknown source" : clean(row.CustomerImportSource),
    customerImportSource: sourceAttribution.customerImportSource,
    customerImportDate: sourceAttribution.customerImportDate,
    customerImportDateIso: sourceAttribution.customerImportDateIso,
    customerCreatedBy: sourceAttribution.customerCreatedBy,
    customerCreatedByType: sourceAttribution.customerCreatedByType,
    customerCreatedByTypeLabel: sourceAttribution.customerCreatedByTypeLabel,
    customerCreateDate: sourceAttribution.customerCreateDate,
    customerCreateDateIso: sourceAttribution.customerCreateDateIso,
    daysSinceImport: sourceAttribution.daysSinceImport,
    daysSinceCreated: sourceAttribution.daysSinceCreated,
    importAgeBucket: sourceAttribution.importAgeBucket,
    createAgeBucket: sourceAttribution.createAgeBucket,
    hasBulkSource: sourceAttribution.hasBulkSource,
    hasManualCreator: sourceAttribution.hasManualCreator,
    orderCount: orderCount(row),
    businessSegment: segment,
    businessSegmentLabel: businessSegmentLabel(segment),
    durationSeconds: item.evaluation.durationSeconds,
    importedNoSale: item.evaluation.outcome.importedNoSale || "Blank",
    localOutcome: item.evaluation.outcome.localCategory,
    contactClassification: item.evaluation.contact.classification,
    transcriptQuality: item.evaluation.transcript.qualityBand,
    followUpStatus: item.followUpStatus,
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    reviewRequired: item.evaluation.outcome.reviewRequired,
    evidence: item.evaluation.evidence.map((evidence) => evidence.summary || evidence.text).filter(Boolean).slice(0, 2),
    transcriptPreview: item.evaluation.preview
  };
}

module.exports = {
  analyzeCsvText,
  IGNORED_FIELDS,
  ENTITY_FIELDS
};
