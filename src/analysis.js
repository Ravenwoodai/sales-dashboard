"use strict";

const crypto = require("crypto");
const { ENTITY_FIELDS } = require("./analysisConstants");
const { parseCsv } = require("./csvParser");
const { clean, isMissing, toInt, evaluateCall } = require("./transcriptEvaluator");
const { buildLeadUtilizationModel } = require("./leadUtilizationReport");
const { buildCallProofRow } = require("./drilldown");

const IGNORED_FIELDS = [
  {
    field: "dialled_phone_number",
    reason: "Intentionally incomplete for security. Preserved in raw import only and ignored for matching, attribution, repeat-contact metrics, and dashboard display."
  },
  {
    field: "CustomerCreateDate",
    reason: "Current export contains unusable time fragments, not a reliable customer-created timestamp."
  },
  {
    field: "CustomerImportDate",
    reason: "Current export contains unusable time fragments, not a reliable customer-import timestamp."
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
    const owner = clean(item.row.Salesperson) || "Unknown";

    if (item.evaluation.risk.reviewRequired) {
      const evidence = item.evaluation.evidence.find((entry) => ["complaint", "opt_out"].includes(entry.signal));
      alerts.push({
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

  const items = canonicalRows.map((row) => ({
    row,
    dateTime: parseDateTime(row),
    evaluation: evaluateCall(row)
  })).sort((a, b) => {
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

  const durationRelationMatches = rawRows.filter((row) => {
    const total = toInt(row.CallTotalSeconds);
    const ring = toInt(row.ring_time_seconds);
    const duration = toInt(row.call_duration_seconds);
    return total !== null && ring !== null && duration !== null && total === ring + duration;
  }).length;

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
  return {
    callId: clean(row.call_id),
    date: clean(row.call_date),
    time: clean(row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    userId: clean(row.UserID) || "",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: isMissing(row.CustomerImportSource) ? "Unknown source" : clean(row.CustomerImportSource),
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
  return {
    callId: clean(row.call_id),
    date: clean(row.call_date),
    time: clean(row.call_time),
    salesperson: clean(row.Salesperson) || "Unknown",
    callType: clean(row.CallType) || "Unknown",
    direction: clean(row.call_direction) || "Unknown",
    source: isMissing(row.CustomerImportSource) ? "Unknown source" : clean(row.CustomerImportSource),
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
