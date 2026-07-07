"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { clean, isMissing, parseTranscriptTurns, toInt } = require("./transcriptEvaluator");
const { SOURCE_AGE_THRESHOLDS, sourceAttributionFor } = require("./sourceQuality");

const EXCLUDED_RAW_FIELDS = new Set([
  "__rowNumber",
  "dialled_phone_number",
  "CustomerCreateDate",
  "CustomerImportDate"
]);

const METRICS = {
  "calls.unique": {
    title: "Unique Calls",
    description: "Every deduplicated call row included in this import.",
    kind: "call"
  },
  "calls.newBusiness": {
    title: "New Business Calls",
    description: "Calls where OrderCount is blank, NULL, or zero.",
    kind: "call"
  },
  "calls.warmBusiness": {
    title: "Warm Business Calls",
    description: "Calls where OrderCount is greater than zero.",
    kind: "call"
  },
  "calls.transcriptAvailable": {
    title: "Transcript Available",
    description: "Calls where the transcription field contains usable text or a transcript placeholder.",
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
  "calls.outcomeMismatches": {
    title: "Outcome Mismatches",
    description: "Calls where imported disposition and local transcript evidence do not align.",
    kind: "call"
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
  "source.newBusinessImportedOlderThan": {
    title: "New Business Imported Older Than Threshold",
    description: "New Business calls where CustomerImportDate is more than the selected number of days before the call date.",
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
    title: "Stable Lead-Days Worked",
    description: "Lead-day groups built from stable lead, contact, or customer IDs. Redacted phone values are not used.",
    kind: "lead"
  },
  "lead.callbackSameDayRequired": {
    title: "Explicit Same-Day Callback Duties",
    description: "Explicit customer callback requests or salesperson callback promises without future-day wording.",
    kind: "lead"
  },
  "lead.callbackCompletedSameDay": {
    title: "Callbacks Completed Same Day",
    description: "Explicit callback duties with a later same-day call to the same stable lead target.",
    kind: "lead"
  },
  "lead.callbackMissedSameDay": {
    title: "Callbacks Missed Same Day",
    description: "Explicit callback duties with no later same-day call to the same stable lead target.",
    kind: "lead"
  },
  "lead.callbackFutureNeedsUpload": {
    title: "Future Callback Pending",
    description: "Callback duties with future-day wording that require later CSV uploads before judgement.",
    kind: "lead"
  },
  "lead.noContactLeadDays": {
    title: "No-Contact Lead-Days",
    description: "Lead-days where every call attempt was no-answer, voicemail, system audio, unknown, or otherwise not live-human.",
    kind: "lead"
  },
  "lead.noContactRetriedSameDay": {
    title: "No-Contact Lead-Days Retried Same Day",
    description: "No-contact lead-days with more than one same-day attempt.",
    kind: "lead"
  },
  "lead.singleAttemptNoContact": {
    title: "Single-Attempt No-Contact Lead-Days",
    description: "No-contact lead-days with only one attempt and no same-day retry.",
    kind: "lead"
  },
  "lead.wastedLeadIndicators": {
    title: "Potential Wasted Lead-Day Indicators",
    description: "Lead-day groups counted because they had either a missed explicit callback or a single-attempt no-contact outcome.",
    kind: "lead"
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

function rawFieldsFor(row) {
  return Object.keys(row)
    .filter((field) => !EXCLUDED_RAW_FIELDS.has(field) && field !== "transcription_text")
    .reduce((fields, field) => {
      fields[field] = clean(row[field]);
      return fields;
    }, {});
}

function orderCountFor(row) {
  const value = toInt(row.OrderCount);
  return value === null ? 0 : value;
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
  if (item.evaluation.contact.probableLiveHuman) keys.push("calls.probableLiveHuman");
  if (item.evaluation.contact.meaningfulConversation) keys.push("calls.meaningfulConversation");
  if (item.evaluation.opportunity.followUpRequired) keys.push("calls.followUpRequired");
  if (item.followUpStatus === "indeterminate_insufficient_future_data") keys.push("calls.followUpIndeterminate");
  if (item.evaluation.outcome.mismatch) keys.push("calls.outcomeMismatches");
  if (item.evaluation.risk.reviewRequired) keys.push("calls.riskReviews");
  if (sourceAttribution.hasBulkSource) keys.push("source.bulkSourced");
  if (sourceAttribution.hasManualCreator) keys.push("source.manualCreated");
  if (businessSegment === "new" && sourceAttribution.daysSinceImport !== null) {
    SOURCE_AGE_THRESHOLDS.forEach((threshold) => {
      if (sourceAttribution.daysSinceImport > threshold) keys.push(`source.newBusinessImportedOlderThan${threshold}`);
    });
  }
  return keys;
}

function buildCallProofRow(item) {
  const row = item.row;
  const businessSegment = businessSegmentForRow(row);
  const sourceAttribution = item.sourceAttribution || sourceAttributionFor(row, item.dateTime);
  return {
    type: "call",
    callId: clean(row.call_id),
    customerId: customerIdFor(row),
    date: clean(row.call_date),
    time: clean(row.call_time),
    dateTime: item.dateTime ? item.dateTime.toISOString() : null,
    salesperson: clean(row.Salesperson) || "Unknown",
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
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    orderCount: orderCountFor(row),
    businessSegment,
    businessSegmentLabel: businessSegmentLabel(businessSegment),
    durationSeconds: item.evaluation.durationSeconds,
    totalSeconds: item.evaluation.totalSeconds,
    contactClassification: item.evaluation.contact.classification,
    localOutcome: item.evaluation.outcome.localCategory,
    importedNoSale: item.evaluation.outcome.importedNoSale || "Blank",
    followUpStatus: item.followUpStatus,
    followUpMatchedCallId: item.followUpMatchedCallId || "",
    followUpChannel: item.evaluation.opportunity.followUpChannel,
    transcriptQuality: item.evaluation.transcript.qualityBand,
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
  if (metricKey === "source.newBusinessImportedOlderThan") {
    const threshold = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, 90);
    return row.businessSegment === "new" && row.daysSinceImport !== null && Number(row.daysSinceImport) > threshold;
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
  const importAgeBucket = clean(query.importAgeBucket);
  const createAgeBucket = clean(query.createAgeBucket || query.creatorAgeBucket);
  const minImportAgeDays = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, null);

  return rows.filter((row) => {
    if (metric && !metricMatches(row, metric, { minImportAgeDays })) return false;
    if (salesperson && row.salesperson !== salesperson) return false;
    if (source && row.source !== source) return false;
    if (customerId && row.customerId !== customerId) return false;
    if (businessSegment && row.businessSegment !== businessSegment) return false;
    if (createdBy && row.customerCreatedBy !== createdBy) return false;
    if (createdByType && row.customerCreatedByType !== createdByType) return false;
    if (importAgeBucket && row.importAgeBucket !== importAgeBucket) return false;
    if (createAgeBucket && row.createAgeBucket !== createAgeBucket) return false;
    if (minImportAgeDays !== null && !(row.daysSinceImport !== null && Number(row.daysSinceImport) > minImportAgeDays)) return false;
    return true;
  });
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
  const minImportAgeDays = normalizeMinImportAgeDays(query.minImportAgeDays || query.days || query.importAgeDays, metric === "source.newBusinessImportedOlderThan" ? 90 : null);
  const leadUtilization = definition.kind === "lead" && businessSegment && analysis.businessSegmentViews?.[businessSegment]?.leadUtilization
    ? analysis.businessSegmentViews[businessSegment].leadUtilization
    : analysis.leadUtilization;
  const sourceRows = metric.startsWith("alerts.")
    ? alertRowsForMetric(analysis, metric)
    : definition.kind === "lead"
      ? leadUtilization?.records || []
      : analysis.drilldownRows || [];
  const rows = filterRows(sourceRows, {
    ...query,
    metric,
    businessSegment: definition.kind === "lead" ? "" : businessSegment,
    segment: definition.kind === "lead" ? "" : query.segment
  });
  const limit = Math.max(1, Math.min(Number(query.limit || 500), 10000));
  const offset = Math.max(0, Number(query.offset || 0));
  const displayedRows = rows.slice(offset, offset + limit);

  return {
    schemaVersion: "sales_dashboard_drilldown.v1",
    metric,
    title: metric === "source.newBusinessImportedOlderThan" ? `New Business Imported Older Than ${minImportAgeDays} Days` : definition.title,
    description: metric === "source.newBusinessImportedOlderThan"
      ? `New Business calls where CustomerImportDate is more than ${minImportAgeDays} days before the call date.`
      : definition.description,
    kind: definition.kind,
    filters: {
      salesperson: clean(query.salesperson),
      source: clean(query.source),
      customerId: clean(query.customerId || query.customer_id),
      createdBy: clean(query.createdBy || query.customerCreatedBy),
      createdByType: clean(query.createdByType || query.customerCreatedByType).toUpperCase(),
      importAgeBucket: clean(query.importAgeBucket),
      createAgeBucket: clean(query.createAgeBucket || query.creatorAgeBucket),
      minImportAgeDays,
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
    excludedRawFields: Array.from(EXCLUDED_RAW_FIELDS)
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
