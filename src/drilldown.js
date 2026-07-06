"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { clean, isMissing, parseTranscriptTurns } = require("./transcriptEvaluator");

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

function rawFieldsFor(row) {
  return Object.keys(row)
    .filter((field) => !EXCLUDED_RAW_FIELDS.has(field) && field !== "transcription_text")
    .reduce((fields, field) => {
      fields[field] = clean(row[field]);
      return fields;
    }, {});
}

function metricKeysForItem(item) {
  const keys = ["calls.unique"];
  if (item.evaluation.transcript.available) keys.push("calls.transcriptAvailable");
  if (item.evaluation.contact.probableLiveHuman) keys.push("calls.probableLiveHuman");
  if (item.evaluation.contact.meaningfulConversation) keys.push("calls.meaningfulConversation");
  if (item.evaluation.opportunity.followUpRequired) keys.push("calls.followUpRequired");
  if (item.followUpStatus === "indeterminate_insufficient_future_data") keys.push("calls.followUpIndeterminate");
  if (item.evaluation.outcome.mismatch) keys.push("calls.outcomeMismatches");
  if (item.evaluation.risk.reviewRequired) keys.push("calls.riskReviews");
  return keys;
}

function buildCallProofRow(item) {
  const row = item.row;
  return {
    type: "call",
    callId: clean(row.call_id),
    date: clean(row.call_date),
    time: clean(row.call_time),
    dateTime: item.dateTime ? item.dateTime.toISOString() : null,
    salesperson: clean(row.Salesperson) || "Unknown",
    source: isMissing(row.CustomerImportSource) ? "Unknown source" : clean(row.CustomerImportSource),
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
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

function metricMatches(row, metricKey) {
  return !metricKey || row.metricKeys?.includes(metricKey);
}

function filterRows(rows, query = {}) {
  const metric = clean(query.metric);
  const salesperson = clean(query.salesperson);
  const source = clean(query.source);

  return rows.filter((row) => {
    if (metric && !metricMatches(row, metric)) return false;
    if (salesperson && row.salesperson !== salesperson) return false;
    if (source && row.source !== source) return false;
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
  const sourceRows = metric.startsWith("alerts.")
    ? alertRowsForMetric(analysis, metric)
    : definition.kind === "lead"
      ? analysis.leadUtilization?.records || []
      : analysis.drilldownRows || [];
  const rows = filterRows(sourceRows, { ...query, metric });
  const limit = Math.max(1, Math.min(Number(query.limit || 500), 10000));
  const offset = Math.max(0, Number(query.offset || 0));
  const displayedRows = rows.slice(offset, offset + limit);

  return {
    schemaVersion: "sales_dashboard_drilldown.v1",
    metric,
    title: definition.title,
    description: definition.description,
    kind: definition.kind,
    filters: {
      salesperson: clean(query.salesperson),
      source: clean(query.source)
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
