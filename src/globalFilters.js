"use strict";

const { clean, isMissing } = require("./transcriptEvaluator");
const { businessRelationshipFor } = require("./businessRelationship");
const {
  SOURCE_TIMEZONE_LABEL,
  formatSourceDateTimeParts,
  formatSourceDateTimeValue,
  formatSourceDateValue,
  isoDateFromParts,
  isoTimeFromParts,
  sourceComparableFromParts
} = require("./dateTimeFormat");

const FILTER_SCHEMA_VERSION = "sales_dashboard_filter_state.v1";

const EMPTY_VALUES = new Set(["", "all", "any", "*"]);

const VALUE_FILTERS = [
  { key: "salesperson", label: "Salesperson", multi: true },
  { key: "userId", label: "User ID", multi: true },
  { key: "callDirection", label: "Call direction", multi: true },
  { key: "callType", label: "Call type", multi: true },
  { key: "customerImportSource", label: "Call CSV source", multi: true },
  { key: "callerId", label: "Caller ID", multi: true },
  { key: "mobile", label: "Mobile", multi: true },
  { key: "contactClassification", label: "Contact classification", multi: true },
  { key: "localOutcome", label: "Derived outcome", multi: true },
  { key: "followUpStatus", label: "Follow-up status", multi: true },
  { key: "followUpChannel", label: "Follow-up channel", multi: true },
  { key: "transcriptState", label: "Transcript state", multi: true },
  { key: "intelligenceProvenance", label: "Intelligence provenance", multi: true },
  { key: "confidenceBand", label: "Confidence band", multi: true },
  { key: "llmStatus", label: "LLM status", multi: true },
  { key: "managerReviewStatus", label: "Manager review", multi: true },
  { key: "alertSeverity", label: "Alert severity", multi: true },
  { key: "alertStatus", label: "Alert status", multi: true },
  { key: "sourceQualityBucket", label: "Source data quality", multi: true }
];

const VALUE_FILTER_MAP = new Map(VALUE_FILTERS.map((filter) => [filter.key, filter]));
const FILTER_QUERY_KEYS = new Set([
  "dateFrom",
  "dateTo",
  "dateTimeFrom",
  "dateTimeTo",
  "businessSegment",
  "segment",
  ...VALUE_FILTERS.map((filter) => filter.key)
]);

function splitValues(value) {
  return String(value || "")
    .split(/[,\n|]/)
    .map((part) => part.trim())
    .filter((part) => !EMPTY_VALUES.has(part.toLowerCase()));
}

function valuesFromQuery(query = {}, key) {
  const rawValues = typeof query.getAll === "function"
    ? query.getAll(key)
    : Array.isArray(query[key])
      ? query[key]
      : [query[key]];
  return Array.from(new Set(rawValues.flatMap(splitValues)));
}

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const au = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) {
    const [, day, month, year] = au;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return "";
}

function normalizeDateTimeValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace("T", " ");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(normalized)
    ? normalized.length === 16 ? `${normalized}:00` : normalized
    : "";
}

function normalizeBusinessSegment(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["new", "new_business"].includes(text)) return "new";
  if (["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(text)) return "warm";
  return "";
}

function normalizeFilterState(input = {}) {
  const businessSegment = normalizeBusinessSegment(
    typeof input.get === "function" ? input.get("businessSegment") || input.get("segment") : input.businessSegment || input.segment
  );
  const values = {};
  VALUE_FILTERS.forEach((filter) => {
    values[filter.key] = valuesFromQuery(input, filter.key);
  });
  const dateFrom = normalizeDateValue(typeof input.get === "function" ? input.get("dateFrom") : input.dateFrom);
  const dateTo = normalizeDateValue(typeof input.get === "function" ? input.get("dateTo") : input.dateTo);
  const dateTimeFrom = normalizeDateTimeValue(typeof input.get === "function" ? input.get("dateTimeFrom") : input.dateTimeFrom);
  const dateTimeTo = normalizeDateTimeValue(typeof input.get === "function" ? input.get("dateTimeTo") : input.dateTimeTo);
  const query = filterQueryFromState({ businessSegment, dateFrom, dateTo, dateTimeFrom, dateTimeTo, values });
  const active = Boolean(Object.keys(query).length);
  return {
    schemaVersion: FILTER_SCHEMA_VERSION,
    businessSegment,
    dateFrom,
    dateTo,
    dateTimeFrom,
    dateTimeTo,
    values,
    active,
    query
  };
}

function filterQueryFromState(state = {}) {
  const query = {};
  if (state.businessSegment) query.businessSegment = state.businessSegment;
  if (state.dateFrom) query.dateFrom = state.dateFrom;
  if (state.dateTo) query.dateTo = state.dateTo;
  if (state.dateTimeFrom) query.dateTimeFrom = state.dateTimeFrom;
  if (state.dateTimeTo) query.dateTimeTo = state.dateTimeTo;
  Object.entries(state.values || {}).forEach(([key, values]) => {
    const cleanValues = Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
    if (cleanValues.length) query[key] = cleanValues.join(",");
  });
  return query;
}

function filterQueryOnly(query = {}) {
  const entries = typeof query.entries === "function" ? Array.from(query.entries()) : Object.entries(query);
  return entries.reduce((result, [key, value]) => {
    if (FILTER_QUERY_KEYS.has(key) && value !== undefined && value !== null && String(value).trim()) {
      if (result[key]) result[key] = `${result[key]},${value}`;
      else result[key] = value;
    }
    return result;
  }, {});
}

function parseDateParts(value) {
  const text = clean(value);
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) {
    const [, year, month, day] = match;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  return null;
}

function parseTimeParts(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return { hour: 0, minute: 0, second: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) };
}

function sourceDateTimeParts(subject) {
  const row = subject?.row || subject || {};
  const dateValue = row.call_date || row.date || "";
  const timeValue = row.call_time || row.time || "";
  const dateParts = parseDateParts(dateValue);
  if (!dateParts) return null;
  const timeParts = parseTimeParts(timeValue);
  const parts = { ...dateParts, ...timeParts };
  const date = isoDateFromParts(parts);
  const time = isoTimeFromParts(parts);
  const serial = Number(`${date.replace(/-/g, "")}${time.replace(/:/g, "")}`);
  return {
    ...parts,
    date,
    time,
    comparable: sourceComparableFromParts(parts),
    label: formatSourceDateTimeParts(parts),
    serial
  };
}

function valueOrBucket(value, bucket) {
  const text = clean(value);
  return isMissing(text) ? bucket : text;
}

function callIdFor(subject) {
  const row = subject?.row || subject || {};
  return clean(row.call_id || row.callId || row.call_id || "");
}

function contextSet(context = {}, key, callId) {
  const source = context[key];
  if (!source || !callId) return new Set();
  if (source instanceof Map) return new Set(source.get(callId) || []);
  const value = source[callId];
  return new Set(Array.isArray(value) ? value : value ? [value] : []);
}

function contextValue(context = {}, key, callId, fallback = "") {
  const source = context[key];
  if (!source || !callId) return fallback;
  if (source instanceof Map) return source.get(callId) || fallback;
  return source[callId] || fallback;
}

function llmStatusFor(subject, context = {}) {
  const callId = callIdFor(subject);
  return contextValue(context, "llmStatusByCallId", callId, "not_requested");
}

function llmReviewLabelFor(subject, context = {}) {
  const callId = callIdFor(subject);
  return contextValue(context, "llmReviewLabelByCallId", callId, "Unprocessed");
}

function managerReviewStatusFor(subject, context = {}) {
  const callId = callIdFor(subject);
  const stored = contextValue(context, "managerReviewStatusByCallId", callId, "");
  if (stored) return stored;
  const reviewRequired = Boolean(
    subject?.evaluation?.outcome?.reviewRequired ||
    subject?.evaluation?.risk?.reviewRequired ||
    subject?.evaluation?.opportunity?.followUpRequired ||
    subject?.reviewRequired ||
    subject?.riskReviewRequired ||
    subject?.manager_review_required
  );
  return reviewRequired ? "review_needed" : "unreviewed";
}

function alertSeveritiesFor(subject, context = {}) {
  const severities = contextSet(context, "alertSeverityByCallId", callIdFor(subject));
  return severities.size ? severities : new Set(["none"]);
}

function alertStatusesFor(subject, context = {}) {
  const statuses = contextSet(context, "alertStatusByCallId", callIdFor(subject));
  return statuses.size ? statuses : new Set(["no_alert"]);
}

function transcriptStatesFor(subject) {
  const row = subject?.row || subject || {};
  const transcript = subject?.evaluation?.transcript;
  const quality = subject.confidenceBand || subject.transcriptQuality || transcript?.qualityBand || "";
  const available = transcript ? transcript.available : !isMissing(row.transcription_text || subject.transcript || subject.transcriptPreview);
  const usable = transcript ? transcript.usableForCoaching : !["unusable", "unknown"].includes(quality) && available;
  const states = [];
  states.push(available ? "available" : "missing");
  states.push(usable ? "usable" : "unusable");
  return states;
}

function sourceQualityBucketsFor(subject) {
  const row = subject?.row || subject || {};
  const rawSource = row.CustomerImportSource ?? row.customerImportSourceRaw ?? row.rawFields?.CustomerImportSource ?? "";
  const buckets = [];
  if (isMissing(rawSource)) buckets.push("raw_source_missing");
  else buckets.push("raw_source_present");
  if (subject.hasBulkSource) buckets.push("bulk_source");
  if (subject.hasManualCreator) buckets.push("manual_creator");
  if (subject.customerImportSourceInferred) buckets.push("inferred_from_call_csv");
  if (!subject.hasBulkSource && !subject.hasManualCreator && isMissing(rawSource)) buckets.push("missing_source_attribution");
  return buckets;
}

function subjectValue(subject, key, context = {}) {
  const row = subject?.row || subject || {};
  if (key === "salesperson") return valueOrBucket(row.Salesperson ?? subject.salesperson, "Unknown");
  if (key === "userId") return valueOrBucket(row.UserID ?? subject.userId ?? subject.rawFields?.UserID, "Not supplied");
  if (key === "callDirection") return valueOrBucket(row.call_direction ?? subject.direction, "Unknown");
  if (key === "callType") return valueOrBucket(row.CallType ?? subject.callType, "Unknown");
  if (key === "customerImportSource") return valueOrBucket(row.CustomerImportSource ?? subject.customerImportSourceRaw ?? subject.rawFields?.CustomerImportSource, "Not supplied");
  if (key === "callerId") return valueOrBucket(row.CallerID ?? subject.rawFields?.CallerID, "Not supplied");
  if (key === "mobile") return valueOrBucket(row.Mobile ?? subject.rawFields?.Mobile, "Not supplied");
  if (key === "contactClassification") return valueOrBucket(subject.evaluation?.contact?.classification ?? subject.contactClassification, "Unknown");
  if (key === "localOutcome") return valueOrBucket(subject.evaluation?.outcome?.localCategory ?? subject.localOutcome, "Unknown");
  if (key === "followUpStatus") return valueOrBucket(subject.followUpStatus, "not_required");
  if (key === "followUpChannel") return valueOrBucket(subject.evaluation?.opportunity?.followUpChannel ?? subject.followUpChannel, "Not supplied");
  if (key === "confidenceBand") return valueOrBucket(subject.confidenceBand || subject.evaluation?.transcript?.qualityBand, "unknown");
  if (key === "llmStatus") return llmStatusFor(subject, context);
  if (key === "managerReviewStatus") return managerReviewStatusFor(subject, context);
  return "";
}

function subjectValues(subject, key, context = {}) {
  if (key === "transcriptState") return transcriptStatesFor(subject);
  if (key === "intelligenceProvenance") {
    const tags = ["Deterministic"];
    const llmLabel = llmReviewLabelFor(subject, context);
    const manager = managerReviewStatusFor(subject, context);
    if (llmLabel === "LLM-reviewed") tags.push("LLM-reviewed");
    if (llmLabel === "Failed") tags.push("Failed");
    if (llmLabel === "Unprocessed" || llmLabel === "Not requested") tags.push("Unprocessed");
    if (!["unreviewed", "not_reviewed", "review_needed"].includes(manager)) tags.push("Manager-reviewed");
    return tags;
  }
  if (key === "alertSeverity") return Array.from(alertSeveritiesFor(subject, context));
  if (key === "alertStatus") return Array.from(alertStatusesFor(subject, context));
  if (key === "sourceQualityBucket") return sourceQualityBucketsFor(subject);
  return [subjectValue(subject, key, context)];
}

function normalizedComparable(value) {
  return String(value || "").trim().toLowerCase();
}

function valueMatchesFilter(actualValues, selectedValues) {
  if (!selectedValues || !selectedValues.length) return true;
  const actual = new Set(actualValues.map(normalizedComparable));
  return selectedValues.some((value) => actual.has(normalizedComparable(value)));
}

function subjectMatchesDate(subject, filterState = {}) {
  const parts = sourceDateTimeParts(subject);
  if (!parts) return !(filterState.dateFrom || filterState.dateTo || filterState.dateTimeFrom || filterState.dateTimeTo);
  if (filterState.dateFrom && parts.date < filterState.dateFrom) return false;
  if (filterState.dateTo && parts.date > filterState.dateTo) return false;
  if (filterState.dateTimeFrom && parts.comparable < filterState.dateTimeFrom) return false;
  if (filterState.dateTimeTo && parts.comparable > filterState.dateTimeTo) return false;
  return true;
}

function subjectMatchesFilters(subject, filterState = {}, context = {}) {
  const state = filterState.schemaVersion ? filterState : normalizeFilterState(filterState);
  if (state.businessSegment) {
    const segment = subject.businessSegment || businessRelationshipFor(subject?.row || subject).segment;
    if (segment !== state.businessSegment) return false;
  }
  if (!subjectMatchesDate(subject, state)) return false;
  return VALUE_FILTERS.every((filter) => valueMatchesFilter(
    subjectValues(subject, filter.key, context),
    state.values?.[filter.key] || []
  ));
}

function applyCallFilters(subjects = [], filterState = {}, context = {}) {
  const state = filterState.schemaVersion ? filterState : normalizeFilterState(filterState);
  if (!state.active) return subjects.slice();
  return subjects.filter((subject) => subjectMatchesFilters(subject, state, context));
}

function displayValue(key, value) {
  const labels = {
    available: "Transcript available",
    missing: "Transcript missing",
    usable: "Transcript usable",
    unusable: "Transcript unusable",
    unknown: "Confidence unavailable",
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
    not_requested: "Not requested",
    queued: "Queued",
    completed: "Completed",
    failed: "Failed",
    active: "Active",
    acknowledged: "Acknowledged",
    in_progress: "In progress",
    resolved: "Resolved",
    dismissed: "Dismissed",
    false_positive: "Likely false positive",
    parked: "Parked",
    not_reviewed: "Not reviewed",
    unreviewed: "Unreviewed",
    review_needed: "Review needed",
    in_review: "In review",
    reviewed_confirmed: "Reviewed confirmed",
    reviewed_corrected: "Reviewed corrected",
    escalated: "Escalated",
    manager_reviewed: "Manager-reviewed",
    none: "No alert",
    no_alert: "No alert",
    new: key === "businessSegment" ? "New Business" : "New",
    warm: "Warm Business",
    present: "Present",
    raw_source_present: "Raw source present",
    raw_source_missing: "Raw source missing",
    bulk_source: "Bulk source evidence",
    manual_creator: "Manual creator evidence",
    inferred_from_call_csv: "Inferred from call CSV",
    missing_source_attribution: "Missing source attribution"
  };
  return labels[value] || String(value || "Not supplied");
}

function activeFilterEntries(filterState = {}) {
  const state = filterState.schemaVersion ? filterState : normalizeFilterState(filterState);
  const entries = [];
  if (state.businessSegment) entries.push({ key: "businessSegment", label: "Business", value: state.businessSegment, display: displayValue("businessSegment", state.businessSegment) });
  if (state.dateFrom) entries.push({ key: "dateFrom", label: "From", value: state.dateFrom, display: formatSourceDateValue(state.dateFrom) });
  if (state.dateTo) entries.push({ key: "dateTo", label: "To", value: state.dateTo, display: formatSourceDateValue(state.dateTo) });
  if (state.dateTimeFrom) entries.push({ key: "dateTimeFrom", label: "From time", value: state.dateTimeFrom, display: formatSourceDateTimeValue(state.dateTimeFrom.slice(0, 10), state.dateTimeFrom.slice(11)) });
  if (state.dateTimeTo) entries.push({ key: "dateTimeTo", label: "To time", value: state.dateTimeTo, display: formatSourceDateTimeValue(state.dateTimeTo.slice(0, 10), state.dateTimeTo.slice(11)) });
  VALUE_FILTERS.forEach((filter) => {
    (state.values?.[filter.key] || []).forEach((value) => {
      entries.push({ key: filter.key, label: filter.label, value, display: displayValue(filter.key, value) });
    });
  });
  return entries;
}

function incrementOption(map, key, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (!map.has(key)) map.set(key, new Map());
  const options = map.get(key);
  options.set(text, (options.get(text) || 0) + 1);
}

function buildFilterOptions(subjects = [], context = {}) {
  const maps = new Map();
  subjects.forEach((subject) => {
    VALUE_FILTERS.forEach((filter) => {
      subjectValues(subject, filter.key, context).forEach((value) => incrementOption(maps, filter.key, value));
    });
  });
  const options = {};
  VALUE_FILTERS.forEach((filter) => {
    const rows = Array.from((maps.get(filter.key) || new Map()).entries())
      .map(([value, count]) => ({ value, label: displayValue(filter.key, value), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    options[filter.key] = rows;
  });
  return options;
}

function filterWarnings(filteredCount, totalCount) {
  if (!totalCount) return [];
  if (filteredCount === 0) {
    return [{ code: "empty_filter_result", severity: "critical", message: "No calls match the selected filters. Clear or loosen filters before interpreting performance." }];
  }
  if (filteredCount < 10) {
    return [{ code: "very_low_sample", severity: "critical", message: "Very low sample size; rates may be unstable." }];
  }
  if (filteredCount < 30) {
    return [{ code: "low_sample", severity: "warning", message: "Low sample size; interpret rates cautiously." }];
  }
  return [];
}

function buildFilterSummary(totalCount, filteredCount, filterState = {}) {
  const includedRate = totalCount ? Math.round((filteredCount / totalCount) * 1000) / 10 : 0;
  return {
    schemaVersion: "sales_dashboard_filter_summary.v1",
    active: Boolean(filterState.active),
    totalRecords: totalCount,
    filteredRecords: filteredCount,
    excludedRecords: Math.max(0, totalCount - filteredCount),
    includedRate,
    sourceTimezoneLabel: SOURCE_TIMEZONE_LABEL,
    activeFilters: activeFilterEntries(filterState),
    warnings: filterWarnings(filteredCount, totalCount)
  };
}

module.exports = {
  FILTER_SCHEMA_VERSION,
  FILTER_QUERY_KEYS,
  SOURCE_TIMEZONE_LABEL,
  VALUE_FILTERS,
  VALUE_FILTER_MAP,
  activeFilterEntries,
  applyCallFilters,
  buildFilterOptions,
  buildFilterSummary,
  displayValue,
  filterQueryOnly,
  filterQueryFromState,
  normalizeFilterState,
  sourceDateTimeParts,
  subjectMatchesFilters
};
