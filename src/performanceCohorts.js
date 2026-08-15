"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readTabularFileColumns } = require("./sourceFile");
const { readApprovedSalesHistorySummary } = require("./approvedSalesHistory");
const { buildSourceAttributionCoverage } = require("./sourceAttributionCoverage");
const {
  EXCLUDED_PERSONNEL,
  isExcludedPersonnel,
  visibleManagerLabel
} = require("./personnelExclusions");
const {
  ALL_APPROVED_SALES_POPULATION_CONTRACT,
  APPROVAL_TIMESTAMP_EXPLICIT,
  APPROVAL_TIMESTAMP_WITHHELD,
  ATTRIBUTION_WITHHELD,
  CARMA_APPROVAL_TIME_SEMANTICS,
  readValidatedCarmaFacts,
  validCarmaApprovalTimestamp
} = require("./carmaEvidence");

const REPORT_SCHEMA_VERSION = "performance_cohorts.v1";
const LEAD_SOURCE_EVIDENCE_RECONCILIATION_VERSION = "governed_history_plus_exact_weekly_allocation.v1";
const COMPANY_SOURCED = "Company Sourced";
const SELF_SOURCED = "Self Sourced";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "data", "store", "performance-cohorts.json");
const MINIMUM_COMPARISON_ALLOCATIONS = 100;
const REPORT_TIME_ZONE = "Australia/Sydney";
const REQUIRED_ALLOCATION_COLUMNS = [
  "CustomerID",
  "FullName",
  "SalesManager",
  "DateSentToSalesperson_Date",
  "DateSentToSalesperson_Time",
  "AllocationName",
  "AllocationItemID"
];
const REQUIRED_CALL_COLUMNS = ["call_id", "customer_id", "UserID", "call_date", "call_time", "Salesperson"];
const CALL_INPUT_COLUMNS = [
  ...REQUIRED_CALL_COLUMNS,
  "FoundCustomerID",
  "FoundContactID",
  "call_direction",
  "CallType",
  "CallTotalSeconds",
  "ring_time_seconds",
  "call_duration_seconds"
];
const SHORT_CALL_SECONDS = 30;
const LONG_CALL_SECONDS = 5 * 60;
const ALLOCATION_INPUT_COLUMNS = [
  ...REQUIRED_ALLOCATION_COLUMNS,
  "CompanyName",
  "DataSource",
  "CustomerImportSource",
  "LeadImportDate_Date",
  "CustomerCreateDate",
  "SalesPersonID"
];

function clean(value) {
  return String(value ?? "").trim();
}

function optionalNonNegativeNumber(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function exactSourceId(value) {
  const cleaned = clean(value);
  if (!cleaned) return "";
  return /^(?:null|undefined|n\/a|na|none|not available|missing)$/i.test(cleaned)
    ? ""
    : cleaned;
}

function normalizePerson(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function validIsoDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function dateIso(value, order = "day_first") {
  const text = clean(value);
  if (!text) return "";
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return validIsoDate(iso) ? iso : "";
  }
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  const first = match[1].padStart(2, "0");
  const second = match[2].padStart(2, "0");
  const iso = order === "month_first"
    ? `${match[3]}-${first}-${second}`
    : `${match[3]}-${second}-${first}`;
  return validIsoDate(iso) ? iso : "";
}

const zonedFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function zonedParts(date) {
  return Object.fromEntries(
    zonedFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function zonedLocalTimestamp(date, time) {
  const dateMatch = clean(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = clean(time).match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (
    !dateMatch
    || !timeMatch
    || Number(timeMatch[1]) > 23
    || Number(timeMatch[2]) > 59
    || Number(timeMatch[3] || 0) > 59
  ) return null;
  const expected = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] || 0)
  };
  const targetWallClockUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second
  );
  let candidate = new Date(targetWallClockUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(candidate);
    const observedWallClockUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    const adjusted = new Date(candidate.getTime() + targetWallClockUtc - observedWallClockUtc);
    if (adjusted.getTime() === candidate.getTime()) break;
    candidate = adjusted;
  }
  const finalParts = zonedParts(candidate);
  return Object.entries(expected).every(([key, value]) => finalParts[key] === value) ? candidate : null;
}

function timestamp(value, time = "", order = "day_first") {
  const source = clean(value);
  if (!clean(time) && /^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}/.test(source)) {
    const date = dateIso(source);
    if (!date) return null;
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) {
      const direct = new Date(source);
      return Number.isNaN(direct.getTime()) ? null : direct;
    }
    const directTime = source.match(/T(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/)?.[1] || "";
    return zonedLocalTimestamp(date, directTime);
  }
  const date = dateIso(value, order);
  if (!date) return null;
  const timeText = clean(time) || "00:00:00";
  return zonedLocalTimestamp(date, timeText);
}

function carmaApprovalBusinessDate(value) {
  return validCarmaApprovalTimestamp(value) ? clean(value).slice(0, 10) : "";
}

function carmaApprovalTimestamp(value) {
  const source = clean(value);
  const businessDate = carmaApprovalBusinessDate(source);
  const businessTime = source.match(/T(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/)?.[1] || "";
  if (!businessDate || !businessTime) return null;
  return zonedLocalTimestamp(businessDate, businessTime);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 10000) / 100;
}

function roundedMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function opaqueEvidenceRef(kind, scope, ...parts) {
  return crypto
    .createHash("sha256")
    .update([kind, scope, ...parts].map(clean).join("|"))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
}

function normalizeDimension(value, fallback = "Unknown") {
  const label = clean(value).normalize("NFKC").replace(/\s+/g, " ") || fallback;
  return {
    key: label.toLowerCase(),
    label
  };
}

function acquisitionSourceDimension(order = {}) {
  const hasProofFlag = order.acquisition_source_proven !== null
    && order.acquisition_source_proven !== undefined
    && clean(order.acquisition_source_proven) !== "";
  if (hasProofFlag && Number(order.acquisition_source_proven) !== 1) {
    return normalizeDimension("Source not recorded");
  }
  return normalizeDimension(order.acquisition_source_type || "Unknown");
}

function allocationSource(row = {}) {
  const hasDataSource = Boolean(clean(row.DataSource));
  const hasImportSource = Boolean(clean(row.CustomerImportSource));
  return {
    ...normalizeDimension(
      hasDataSource
        ? row.DataSource
        : hasImportSource
          ? row.CustomerImportSource
          : "Unknown"
    ),
    conflict: false
  };
}

function buildWeeklyAllocationProofIndex(rows = []) {
  const index = new Map();
  rows.forEach((row) => {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName);
    const normalizedSalesperson = normalizePerson(salesperson);
    const sentAt = timestamp(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time);
    if (!customerId || !normalizedSalesperson || !sentAt) return;
    const key = `${customerId}|${normalizedSalesperson}`;
    const candidate = {
      customerId,
      salesperson,
      normalizedSalesperson,
      manager: visibleManagerLabel(row.SalesManager),
      sentAt,
      sentDate: dateIso(row.DateSentToSalesperson_Date),
      sentTime: clean(row.DateSentToSalesperson_Time),
      allocationName: clean(row.AllocationName) || "Unknown",
      allocationItemId: clean(row.AllocationItemID),
      leadSource: allocationSource(row)
    };
    const existing = index.get(key);
    if (!existing || candidate.sentAt < existing.sentAt) index.set(key, candidate);
  });
  return index;
}

function reconcileLeadSourceOrder(order = {}, weeklyAllocationProofIndex = new Map()) {
  const storedClassification = clean(order.lead_source_classification);
  if (storedClassification === ATTRIBUTION_WITHHELD) {
    const timestampExplicit = clean(order.approval_timestamp_status) === APPROVAL_TIMESTAMP_EXPLICIT;
    return {
      ...order,
      stored_lead_source_classification: ATTRIBUTION_WITHHELD,
      lead_source_classification: ATTRIBUTION_WITHHELD,
      lead_source_classification_reason: timestampExplicit
        ? "Source attribution withheld because complete exact-customer allocation history was unavailable and no exact weekly positive proof existed."
        : "Source attribution withheld because no explicit approval timestamp was available after two independent read-only captures.",
      lead_source_classification_reconciled_from_weekly: 0,
      lead_source_classification_evidence_source: timestampExplicit ? "allocation_coverage_exception" : "approval_timestamp_exception",
      exact_weekly_pre_sale_allocation: null
    };
  }
  if (![COMPANY_SOURCED, SELF_SOURCED].includes(storedClassification)) {
    throw new Error(`Approved order ${clean(order.order_id) || "unknown"} has an unsupported lead-source classification`);
  }
  const approvedAt = order.approvedAt || carmaApprovalTimestamp(order.sale_approved_at);
  const normalizedSeller = normalizePerson(order.actual_seller);
  const weeklyAllocation = weeklyAllocationProofIndex.get(
    `${clean(order.customer_id)}|${normalizedSeller}`
  ) || null;
  const exactWeeklyPreSaleProof = Boolean(
    weeklyAllocation
    && approvedAt
    && weeklyAllocation.sentAt <= approvedAt
  );
  const reconciledFromWeekly = storedClassification === SELF_SOURCED && exactWeeklyPreSaleProof;
  return {
    ...order,
    stored_lead_source_classification: storedClassification,
    lead_source_classification: reconciledFromWeekly ? COMPANY_SOURCED : storedClassification,
    lead_source_classification_reason: reconciledFromWeekly
      ? "Company Sourced - the selected weekly allocation export contains an exact customer-ID and exact seller match sent before approval."
      : order.lead_source_classification_reason,
    lead_source_classification_reconciled_from_weekly: reconciledFromWeekly ? 1 : 0,
    lead_source_classification_evidence_source: reconciledFromWeekly
      ? "exact_weekly_allocation_export"
      : storedClassification === COMPANY_SOURCED
        ? "governed_carma_allocation_history"
        : "combined_sources_no_exact_pre_sale_seller_match",
    exact_weekly_pre_sale_allocation: exactWeeklyPreSaleProof ? weeklyAllocation : null
  };
}

function leadAgeDays(sentDate, importDate) {
  if (!validIsoDate(sentDate) || !validIsoDate(importDate)) return null;
  return Math.round((
    new Date(`${sentDate}T00:00:00.000Z`).getTime()
    - new Date(`${importDate}T00:00:00.000Z`).getTime()
  ) / (24 * 60 * 60 * 1000));
}

function leadAgeBucket(days) {
  if (days === null || days < 0) return "unknown";
  if (days === 0) return "same_day";
  if (days <= 7) return "1_7_days";
  if (days <= 30) return "8_30_days";
  if (days <= 90) return "31_90_days";
  if (days <= 365) return "91_365_days";
  return "366_plus_days";
}

const LEAD_AGE_BUCKETS = Object.freeze([
  { key: "same_day", label: "Same day" },
  { key: "1_7_days", label: "1–7 days" },
  { key: "8_30_days", label: "8–30 days" },
  { key: "31_90_days", label: "31–90 days" },
  { key: "91_365_days", label: "91–365 days" },
  { key: "366_plus_days", label: "366+ days" },
  { key: "unknown", label: "Unknown / invalid" }
]);

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function nextIsoDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function coverageContainsRange(coverageRows, startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return false;
  let cursor = startDate;
  for (const coverage of coverageRows) {
    if (coverage.periodEnd < cursor) continue;
    if (coverage.periodStart > cursor) return false;
    if (coverage.periodEnd >= endDate) return true;
    cursor = nextIsoDay(coverage.periodEnd);
  }
  return false;
}

function dateInReportTimeZone(value) {
  const date = value instanceof Date ? value : timestamp(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function withinPeriod(date, startDate, endDate) {
  const iso = date instanceof Date ? dateInReportTimeZone(date) : dateIso(date);
  return Boolean(iso && iso >= startDate && iso <= endDate);
}

function resolvePerformanceConfig(argv = process.argv.slice(2), env = process.env, options = {}) {
  const configPath = path.resolve(options.performanceConfigPath || DEFAULT_CONFIG_PATH);
  let local = {};
  if (fs.existsSync(configPath)) {
    try {
      local = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      return { configured: true, configPath, error: `Performance configuration is invalid: ${error.message}` };
    }
  }
  const flagValue = (...names) => {
    const index = argv.findIndex((arg) => names.includes(arg));
    return index >= 0 && argv[index + 1] ? argv[index + 1] : "";
  };
  const explicitSupplementPath = options.performanceCallPath
    || flagValue("--performance-calls")
    || env.SALES_DASHBOARD_PERFORMANCE_CALLS_PATH
    || "";
  const explicitPrimaryPath = options.performancePrimaryCallPath
    || flagValue("--performance-primary-calls")
    || env.SALES_DASHBOARD_PERFORMANCE_PRIMARY_CALLS_PATH
    || "";
  const explicitAllocationPath = options.performanceAllocationPath
    || flagValue("--performance-allocations", "--performance-allocation-log")
    || env.SALES_DASHBOARD_PERFORMANCE_ALLOCATIONS_PATH
    || "";
  const localAllocationSources = Array.isArray(local.allocationSources) ? local.allocationSources : [];
  const allocationSources = [];
  const addAllocationSource = (sourcePath, role = "weekly_allocation") => {
    const cleanedPath = clean(sourcePath);
    if (!cleanedPath) return;
    const resolvedPath = path.resolve(cleanedPath);
    if (allocationSources.some((candidate) => candidate.path === resolvedPath)) return;
    allocationSources.push({ path: resolvedPath, role: clean(role) || "weekly_allocation" });
  };
  if (explicitAllocationPath) {
    addAllocationSource(explicitAllocationPath);
  } else {
    localAllocationSources.forEach((source) => addAllocationSource(source?.path, source?.role));
    addAllocationSource(local.allocationLogPath);
  }
  const localCallSources = Array.isArray(local.callSources) ? local.callSources : [];
  const localPrimarySource = localCallSources.find((source) => clean(source?.role) === "primary_history");
  const localSupplementSource = localCallSources.find((source) => clean(source?.role) === "weekly_supplement");
  const primaryCallCsvPath = explicitPrimaryPath
    || (!explicitSupplementPath ? (local.primaryCallCsvPath || localPrimarySource?.path) : "")
    || "";
  const callCsvPath = explicitSupplementPath
    || local.callCsvPath
    || localSupplementSource?.path
    || "";
  const callSources = [];
  if (primaryCallCsvPath) {
    callSources.push({
      path: path.resolve(primaryCallCsvPath),
      role: "primary_history",
      dateOrder: "day_first"
    });
  }
  if (callCsvPath && path.resolve(callCsvPath) !== path.resolve(primaryCallCsvPath || callCsvPath)) {
    callSources.push({
      path: path.resolve(callCsvPath),
      role: "weekly_supplement",
      dateOrder: "month_first"
    });
  } else if (callCsvPath && !primaryCallCsvPath) {
    callSources.push({
      path: path.resolve(callCsvPath),
      role: "weekly_supplement",
      dateOrder: "month_first"
    });
  }
  (!explicitSupplementPath && !explicitPrimaryPath ? localCallSources : []).forEach((source) => {
    const sourcePath = clean(source?.path);
    if (!sourcePath) return;
    const resolvedPath = path.resolve(sourcePath);
    if (callSources.some((candidate) => candidate.path === resolvedPath)) return;
    callSources.push({
      path: resolvedPath,
      role: clean(source.role) || "supplement",
      dateOrder: clean(source.dateOrder) === "day_first" ? "day_first" : "month_first"
    });
  });
  const resolved = {
    configured: Boolean(
      allocationSources.length
    ),
    configPath,
    allocationLogPath: explicitAllocationPath || local.allocationLogPath || allocationSources[0]?.path || "",
    allocationSources,
    primaryCallCsvPath,
    callCsvPath,
    callSources,
    startDate: options.performanceStartDate
      || flagValue("--performance-start")
      || env.SALES_DASHBOARD_PERFORMANCE_START_DATE
      || local.startDate
      || "",
    endDate: options.performanceEndDate
      || flagValue("--performance-end")
      || env.SALES_DASHBOARD_PERFORMANCE_END_DATE
      || local.endDate
      || "",
    approvedSalesHistoryPath: options.approvedSalesHistoryPath
      || flagValue("--approved-sales-history")
      || env.SALES_DASHBOARD_APPROVED_SALES_HISTORY_PATH
      || local.approvedSalesHistoryPath
      || ""
  };
  return {
    ...resolved,
    allocationLogPath: resolved.allocationLogPath ? path.resolve(resolved.allocationLogPath) : "",
    allocationSources: resolved.allocationSources.map((source) => ({
      ...source,
      path: path.resolve(source.path)
    })),
    primaryCallCsvPath: resolved.primaryCallCsvPath ? path.resolve(resolved.primaryCallCsvPath) : "",
    callCsvPath: resolved.callCsvPath ? path.resolve(resolved.callCsvPath) : "",
    approvedSalesHistoryPath: resolved.approvedSalesHistoryPath
      ? path.resolve(resolved.approvedSalesHistoryPath)
      : ""
  };
}

function emptyPerformanceReport({ configured = false, error = "", code = "" } = {}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    configured,
    available: false,
    status: configured ? "unavailable" : "not_configured",
    error,
    code,
    period: { startDate: "", endDate: "", label: "" },
    comparison: {
      label: "Same-week approved-sales productivity proxy",
      minimumAllocations: MINIMUM_COMPARISON_ALLOCATIONS,
      rows: [],
      fullSampleRows: 0,
      salesCoverageStatus: "not_verified",
      rankingApplied: false
    },
    totals: {},
    leadAnalytics: {
      sourceAllocationRows: [],
      approvedSalesByAcquisitionSource: [],
      dailyAllocations: [],
      leadAgeBuckets: [],
      usage: {},
      linkage: {}
    },
    cohortWindows: [],
    history: [],
    approvedSalesHistory: {
      configured: false,
      available: false,
      status: "not_configured",
      rows: [],
      definitions: {}
    },
    dataQuality: {},
    definitions: {},
    limitations: []
  };
}

function seedPerson(person, manager = "") {
  const initialManager = clean(manager) || "Unknown";
  return {
    salesperson: person,
    normalizedSalesperson: normalizePerson(person),
    _managers: new Set([initialManager]),
    sentAllocationEvents: 0,
    uniqueCustomers: 0,
    reallocationEvents: 0,
    approvedSales: 0,
    approvedSalesValue: 0,
    companySourcedSales: 0,
    selfSourcedSales: 0,
    attributionWithheldSales: 0,
    sameDayCalls: 0,
    callsWithin24Hours: 0,
    callsWithin72Hours: 0,
    customersCalledAfterAllocation: 0,
    weeklyCallCount: 0,
    weeklyOutboundCallCount: 0,
    weeklyDurationObservedCalls: 0,
    weeklyZeroDurationCalls: 0,
    weeklyShortCallCount: 0,
    weeklyLongCallCount: 0,
    weeklyTotalCallDurationSeconds: 0,
    _weeklyCallDurations: [],
    _customers: new Map()
  };
}

function buildPerformanceCohortsReport({
  allocationRows = [],
  allocationColumns = [],
  callRows = [],
  callColumns = [],
  salesRows = [],
  coverageRows = [],
  approvedSalesHistory = {
    configured: false,
    available: false,
    status: "not_configured",
    rows: [],
    definitions: {}
  },
  provenance = {},
  startDate = "",
  endDate = "",
  availableStartDate = "",
  availableEndDate = "",
  configured = true
} = {}) {
  const missingAllocationColumns = REQUIRED_ALLOCATION_COLUMNS.filter((column) => !allocationColumns.includes(column));
  const missingCallColumns = callRows.length
    ? REQUIRED_CALL_COLUMNS.filter((column) => !callColumns.includes(column))
    : [];
  if (missingAllocationColumns.length) {
    return emptyPerformanceReport({
      configured,
      error: `Allocation log is missing required columns: ${missingAllocationColumns.join(", ")}`,
      code: "PERFORMANCE_ALLOCATION_CONTRACT_INVALID"
    });
  }

  const excludedAllocationRows = allocationRows.filter((row) => isExcludedPersonnel(row.FullName));
  const eligibleAllocationRows = allocationRows.filter((row) => !isExcludedPersonnel(row.FullName));
  const allocationDates = eligibleAllocationRows
    .map((row) => dateIso(row.DateSentToSalesperson_Date))
    .filter(Boolean)
    .sort();
  const reportStart = startDate || allocationDates[0] || "";
  const reportEnd = endDate || allocationDates[allocationDates.length - 1] || "";
  if (!validIsoDate(reportStart) || !validIsoDate(reportEnd) || reportEnd < reportStart) {
    return emptyPerformanceReport({
      configured,
      error: "Performance period is missing or invalid.",
      code: "PERFORMANCE_PERIOD_INVALID"
    });
  }

  const invalidAllocationDateRows = eligibleAllocationRows.filter((row) => (
    clean(row.DateSentToSalesperson_Date) && !dateIso(row.DateSentToSalesperson_Date)
  )).length;
  const includedAllocationRows = eligibleAllocationRows.filter((row) => (
    withinPeriod(row.DateSentToSalesperson_Date, reportStart, reportEnd)
  ));
  const weeklyAllocationProofIndex = buildWeeklyAllocationProofIndex(eligibleAllocationRows);
  const logicalEvents = new Map();
  const duplicateEventEvidence = [];
  const allocationItemIds = new Map();
  let missingAllocationKeys = 0;
  let invalidAllocationTimestamps = 0;
  let logicalDimensionConflictRows = 0;
  includedAllocationRows.forEach((row) => {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName);
    if (!customerId || !salesperson) {
      missingAllocationKeys += 1;
      return;
    }
    const sentAt = timestamp(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time);
    if (!sentAt) {
      invalidAllocationTimestamps += 1;
      return;
    }
    const source = allocationSource(row);
    const sentDate = dateIso(row.DateSentToSalesperson_Date);
    const leadImportDateRaw = clean(row.LeadImportDate_Date);
    const leadImportDate = dateIso(leadImportDateRaw);
    const leadImportDateStatus = !leadImportDateRaw
      ? "missing"
      : !leadImportDate
        ? "invalid"
        : leadImportDate > sentDate
          ? "future"
          : "valid";
    const event = {
      customerId,
      companyName: clean(row.CompanyName),
      salesperson,
      normalizedSalesperson: normalizePerson(salesperson),
      manager: visibleManagerLabel(row.SalesManager),
      normalizedManager: normalizePerson(row.SalesManager),
      sentAt,
      sentDate,
      sentTime: clean(row.DateSentToSalesperson_Time),
      leadImportDate,
      leadImportDateStatus,
      customerCreateDate: dateIso(row.CustomerCreateDate),
      leadSource: source,
      dimensionConflict: source.conflict,
      allocationName: clean(row.AllocationName) || "Unknown",
      allocationItemId: clean(row.AllocationItemID)
    };
    const logicalKey = [
      event.customerId,
      event.normalizedSalesperson,
      event.normalizedManager,
      event.sentDate,
      clean(row.DateSentToSalesperson_Time),
      event.allocationName
    ].join("|");
    if (!logicalEvents.has(logicalKey)) {
      logicalEvents.set(logicalKey, event);
    } else {
      const existing = logicalEvents.get(logicalKey);
      duplicateEventEvidence.push({
        ...event,
        duplicateOfSentDate: existing.sentDate
      });
      if (
        existing.leadSource.key !== event.leadSource.key
        || existing.leadImportDate !== event.leadImportDate
      ) {
        logicalDimensionConflictRows += 1;
        logicalEvents.set(logicalKey, {
          ...existing,
          leadSource: normalizeDimension("Conflicting source values"),
          leadImportDate: "",
          leadImportDateStatus: "conflicting",
          dimensionConflict: true
        });
      }
    }
    if (event.allocationItemId) {
      allocationItemIds.set(event.allocationItemId, (allocationItemIds.get(event.allocationItemId) || 0) + 1);
    }
  });

  const people = new Map();
  logicalEvents.forEach((event) => {
    if (!people.has(event.normalizedSalesperson)) {
      people.set(event.normalizedSalesperson, seedPerson(event.salesperson, event.manager));
    }
    const person = people.get(event.normalizedSalesperson);
    person._managers.add(event.manager);
    person.sentAllocationEvents += 1;
    if (!person._customers.has(event.customerId)) person._customers.set(event.customerId, []);
    person._customers.get(event.customerId).push(event);
  });
  people.forEach((person) => {
    person.uniqueCustomers = person._customers.size;
    person.reallocationEvents = Array.from(person._customers.values())
      .reduce((total, events) => total + Math.max(0, events.length - 1), 0);
  });

  const allocationByCustomerAndPerson = new Map();
  people.forEach((person) => {
    person._customers.forEach((events, customerId) => {
      const dated = events.filter((event) => event.sentAt).sort((a, b) => a.sentAt - b.sentAt);
      if (!dated[0]) return;
      const sourceKeys = new Set(dated.map((event) => event.leadSource.key));
      const sourceConflict = sourceKeys.size > 1 || dated.some((event) => event.dimensionConflict);
      allocationByCustomerAndPerson.set(`${customerId}|${person.normalizedSalesperson}`, {
        ...dated[0],
        leadSource: !sourceConflict
          ? dated[0].leadSource
          : normalizeDimension("Conflicting source values"),
        sourceConflict,
        sentEventCount: dated.length
      });
    });
  });

  const uniqueCalls = new Map();
  const excludedCallRows = callRows.filter((row) => isExcludedPersonnel(row.Salesperson));
  const eligibleCallRows = callRows.filter((row) => !isExcludedPersonnel(row.Salesperson));
  let invalidCallTimestamps = 0;
  let missingCallIds = 0;
  let rawMissingCallJoinKeys = 0;
  let missingCallJoinKeys = 0;
  let foundCustomerIdPositiveRepairs = 0;
  let foundCustomerIdPositiveRepairPairs = 0;
  let foundCustomerIdNewlyObservedPairs = 0;
  let unlinkedSelfSourcingCallAttempts = 0;
  let conflictingCallCustomerIds = 0;
  let duplicateCallIds = 0;
  let conflictingDuplicateCallIds = 0;
  eligibleCallRows.forEach((row) => {
    const callDateOrder = row.__callDateOrder === "day_first" ? "day_first" : "month_first";
    const callDate = dateIso(row.call_date, callDateOrder);
    if (callDate && callDate < reportStart) return;
    const callId = clean(row.call_id);
    if (!callId) {
      missingCallIds += 1;
      return;
    }
    const callAt = timestamp(row.call_date, row.call_time, callDateOrder);
    const rawCustomerId = exactSourceId(row.customer_id);
    const foundCustomerId = exactSourceId(row.FoundCustomerID);
    const normalizedSalesperson = normalizePerson(row.Salesperson);
    const candidate = {
      callId,
      rawCustomerId,
      foundCustomerId,
      effectiveCustomerId: "",
      customerIdProvenance: "",
      identifierConflict: Boolean(rawCustomerId && foundCustomerId && rawCustomerId !== foundCustomerId),
      duplicateConflict: false,
      normalizedSalesperson,
      salesperson: clean(row.Salesperson),
      userId: clean(row.UserID),
      callAt,
      callDate,
      callDirection: clean(row.call_direction).toLowerCase(),
      callDurationSeconds: optionalNonNegativeNumber(row.call_duration_seconds),
      callSourceRole: clean(row.__callSourceRole) || "supplement"
    };
    if (uniqueCalls.has(callId)) {
      duplicateCallIds += 1;
      const existing = uniqueCalls.get(callId);
      const rawCustomerConflict = Boolean(existing.rawCustomerId && candidate.rawCustomerId && existing.rawCustomerId !== candidate.rawCustomerId);
      const foundCustomerConflict = Boolean(existing.foundCustomerId && candidate.foundCustomerId && existing.foundCustomerId !== candidate.foundCustomerId);
      const salespersonConflict = Boolean(existing.normalizedSalesperson && candidate.normalizedSalesperson && existing.normalizedSalesperson !== candidate.normalizedSalesperson);
      const timestampConflict = Boolean(existing.callAt && candidate.callAt && existing.callAt.getTime() !== candidate.callAt.getTime());
      if (rawCustomerConflict || foundCustomerConflict || salespersonConflict || timestampConflict) {
        conflictingDuplicateCallIds += 1;
        existing.duplicateConflict = true;
      } else {
        if (!existing.rawCustomerId && candidate.rawCustomerId) existing.rawCustomerId = candidate.rawCustomerId;
        if (!existing.foundCustomerId && candidate.foundCustomerId) existing.foundCustomerId = candidate.foundCustomerId;
        if (!existing.normalizedSalesperson && candidate.normalizedSalesperson) {
          existing.normalizedSalesperson = candidate.normalizedSalesperson;
          existing.salesperson = candidate.salesperson;
        }
        if (!existing.callAt && candidate.callAt) {
          existing.callAt = candidate.callAt;
          existing.callDate = candidate.callDate;
        }
        if (existing.callDurationSeconds === null && candidate.callDurationSeconds !== null) {
          existing.callDurationSeconds = candidate.callDurationSeconds;
        }
        if (!existing.callDirection && candidate.callDirection) existing.callDirection = candidate.callDirection;
      }
      return;
    }
    if (!callAt) invalidCallTimestamps += 1;
    uniqueCalls.set(callId, candidate);
  });
  const foundRepairPairKeys = new Set();
  uniqueCalls.forEach((call) => {
    if (!call.rawCustomerId || !call.normalizedSalesperson) rawMissingCallJoinKeys += 1;
    if (call.identifierConflict) conflictingCallCustomerIds += 1;
    if (call.identifierConflict || call.duplicateConflict || !call.normalizedSalesperson || !call.callAt) {
      missingCallJoinKeys += 1;
      return;
    }
    if (call.rawCustomerId) {
      call.effectiveCustomerId = call.rawCustomerId;
      call.customerIdProvenance = "customer_id";
      return;
    }
    const foundKey = call.foundCustomerId
      ? `${call.foundCustomerId}|${call.normalizedSalesperson}`
      : "";
    const exactAllocation = foundKey ? allocationByCustomerAndPerson.get(foundKey) : null;
    if (exactAllocation?.sentAt && call.callAt >= exactAllocation.sentAt) {
      call.effectiveCustomerId = call.foundCustomerId;
      call.customerIdProvenance = "found_customer_id_exact_allocation_match";
      foundCustomerIdPositiveRepairs += 1;
      foundRepairPairKeys.add(foundKey);
      return;
    }
    call.customerIdProvenance = "unlinked_self_sourcing_attempt_no_customer_id";
    unlinkedSelfSourcingCallAttempts += 1;
  });
  foundCustomerIdPositiveRepairPairs = foundRepairPairKeys.size;
  let invalidWeeklyCallDurations = 0;
  let weeklyCallsInPeriod = 0;
  uniqueCalls.forEach((call) => {
    if (!call.callDate || call.callDate < reportStart || call.callDate > reportEnd) return;
    const person = people.get(call.normalizedSalesperson);
    if (!person || call.duplicateConflict || !call.callAt) return;
    weeklyCallsInPeriod += 1;
    person.weeklyCallCount += 1;
    if (/^(?:out|outbound)$/.test(call.callDirection)) person.weeklyOutboundCallCount += 1;
    if (call.callDurationSeconds === null) {
      invalidWeeklyCallDurations += 1;
      return;
    }
    const duration = call.callDurationSeconds;
    person.weeklyDurationObservedCalls += 1;
    person.weeklyTotalCallDurationSeconds += duration;
    person._weeklyCallDurations.push(duration);
    if (duration === 0) person.weeklyZeroDurationCalls += 1;
    if (duration > 0 && duration < SHORT_CALL_SECONDS) person.weeklyShortCallCount += 1;
    if (duration >= LONG_CALL_SECONDS) person.weeklyLongCallCount += 1;
  });
  const callDurationColumnPresent = callColumns.includes("call_duration_seconds");
  const callDurationCoverageComplete = callDurationColumnPresent
    && weeklyCallsInPeriod > 0
    && invalidWeeklyCallDurations === 0;
  const callsByCustomerAndPerson = new Map();
  uniqueCalls.forEach((call) => {
    if (!call.effectiveCustomerId || !call.normalizedSalesperson || !call.callAt) return;
    const key = `${call.effectiveCustomerId}|${call.normalizedSalesperson}`;
    if (!callsByCustomerAndPerson.has(key)) callsByCustomerAndPerson.set(key, []);
    callsByCustomerAndPerson.get(key).push(call);
  });
  callsByCustomerAndPerson.forEach((calls) => calls.sort((a, b) => a.callAt - b.callAt));
  const allocationDateSet = Array.from(new Set(includedAllocationRows.map((row) => dateIso(row.DateSentToSalesperson_Date)).filter(Boolean))).sort();
  const callDateSet = Array.from(new Set(Array.from(uniqueCalls.values()).map((call) => call.callDate).filter(Boolean))).sort();
  const callCoverageComplete = !missingCallColumns.length
    && invalidCallTimestamps === 0
    && missingCallIds === 0
    && missingCallJoinKeys === 0
    && conflictingCallCustomerIds === 0
    && conflictingDuplicateCallIds === 0
    && allocationDateSet.length > 0
    && allocationDateSet.every((date) => callDateSet.includes(date));

  allocationByCustomerAndPerson.forEach((allocation, key) => {
    const person = people.get(allocation.normalizedSalesperson);
    const calls = (callsByCustomerAndPerson.get(key) || []).filter((call) => call.callAt >= allocation.sentAt);
    allocation.observedCallsAfterAllocation = calls.length;
    allocation.firstObservedCallAt = calls[0]?.callAt || null;
    allocation.firstObservedCallDate = calls[0]?.callDate || "";
    allocation.firstObservedCallIdProvenance = calls[0]?.customerIdProvenance || "";
    allocation.callObservationStatus = calls.length
      ? "exact_call_observed"
      : "no_matching_call_observed";
    if (
      calls.length
      && !calls.some((call) => call.customerIdProvenance === "customer_id")
      && calls.some((call) => call.customerIdProvenance === "found_customer_id_exact_allocation_match")
    ) foundCustomerIdNewlyObservedPairs += 1;
    if (!person || !calls.length) return;
    const first = calls[0];
    const elapsed = first.callAt - allocation.sentAt;
    person.customersCalledAfterAllocation += 1;
    if (first.callDate === allocation.sentDate) person.sameDayCalls += 1;
    if (elapsed <= 24 * 60 * 60 * 1000) person.callsWithin24Hours += 1;
    if (elapsed <= 72 * 60 * 60 * 1000) person.callsWithin72Hours += 1;
  });

  const authoritativeCoverageRows = coverageRows.filter((row) => (
    clean(row.dataset_type) === "approved_sales"
    && clean(row.population_contract) === ALL_APPROVED_SALES_POPULATION_CONTRACT
    && Number(row.show_new_customers_only) === 0
    && clean(row.completeness_status) === "complete"
    && /^[a-f0-9]{64}$/i.test(clean(row.source_report_sha256))
    && /^[a-f0-9]{64}$/i.test(clean(row.source_manifest_sha256))
    && /^[a-f0-9]{64}$/i.test(clean(row.extraction_audit_sha256))
  ));
  const authoritativeRunIds = new Set(authoritativeCoverageRows.map((row) => clean(row.run_id)));
  const authoritativeCoverageByRun = new Map(authoritativeCoverageRows.map((row) => [clean(row.run_id), row]));
  const authoritativeSalesRows = salesRows.filter((order) => authoritativeRunIds.has(clean(order.run_id)));
  const excludedSalesRows = authoritativeSalesRows.filter((order) => isExcludedPersonnel(order.actual_seller));
  const eligibleAuthoritativeSalesRows = authoritativeSalesRows
    .filter((order) => !isExcludedPersonnel(order.actual_seller));
  const ordersByCustomer = new Map();
  let invalidSalesTimestamps = 0;
  let attributionWithheldSales = 0;
  const sameWeekSales = [];
  eligibleAuthoritativeSalesRows.forEach((order) => {
    const timestampStatus = clean(order.approval_timestamp_status) || APPROVAL_TIMESTAMP_EXPLICIT;
    if (timestampStatus === APPROVAL_TIMESTAMP_WITHHELD) {
      const coverage = authoritativeCoverageByRun.get(clean(order.run_id));
      const periodStart = dateIso(coverage?.period_start);
      const periodEnd = dateIso(coverage?.period_end);
      if (periodStart >= reportStart && periodEnd <= reportEnd) {
        attributionWithheldSales += 1;
        sameWeekSales.push(reconcileLeadSourceOrder({
          ...order,
          approvedAt: null,
          approvedDate: "",
          approvalPeriodStart: periodStart,
          approvalPeriodEnd: periodEnd
        }, weeklyAllocationProofIndex));
      }
      return;
    }
    const approvedAt = carmaApprovalTimestamp(order.sale_approved_at);
    const approvedDate = carmaApprovalBusinessDate(order.sale_approved_at);
    if (!approvedAt || !approvedDate) {
      invalidSalesTimestamps += 1;
      return;
    }
    const reconciledOrder = reconcileLeadSourceOrder(
      { ...order, approvedAt, approvedDate },
      weeklyAllocationProofIndex
    );
    if (clean(order.lead_source_classification) === ATTRIBUTION_WITHHELD) attributionWithheldSales += 1;
    if (!ordersByCustomer.has(clean(order.customer_id))) ordersByCustomer.set(clean(order.customer_id), []);
    ordersByCustomer.get(clean(order.customer_id)).push(reconciledOrder);
    if (approvedDate >= reportStart && approvedDate <= reportEnd) sameWeekSales.push(reconciledOrder);
  });
  ordersByCustomer.forEach((orders) => orders.sort((a, b) => a.approvedAt - b.approvedAt));
  const weeklyAllocationClassificationCorrections = sameWeekSales.filter((order) => (
    Number(order.lead_source_classification_reconciled_from_weekly) === 1
  )).length;
  const unresolvedExactWeeklyClassificationContradictions = sameWeekSales.filter((order) => (
    order.exact_weekly_pre_sale_allocation
    && clean(order.lead_source_classification) !== COMPANY_SOURCED
  )).length;
  if (unresolvedExactWeeklyClassificationContradictions) {
    throw new Error("Exact weekly pre-sale seller allocation proof did not reconcile to Company Sourced");
  }

  let unmatchedSalesOrders = 0;
  sameWeekSales.forEach((order) => {
    const normalizedSeller = normalizePerson(order.actual_seller);
    const person = people.get(normalizedSeller);
    if (!person) {
      unmatchedSalesOrders += 1;
      return;
    }
    person.approvedSales += 1;
    person.approvedSalesValue += Number(order.sale_value || 0);
    if (clean(order.lead_source_classification) === "Company Sourced") person.companySourcedSales += 1;
    if (clean(order.lead_source_classification) === "Self Sourced") person.selfSourcedSales += 1;
    if (clean(order.lead_source_classification) === ATTRIBUTION_WITHHELD) person.attributionWithheldSales += 1;
  });

  const salesByRunId = salesRows.reduce((counts, order) => {
    const runId = clean(order.run_id);
    if (runId) {
      if (!counts.has(runId)) counts.set(runId, []);
      counts.get(runId).push(order);
    }
    return counts;
  }, new Map());
  const approvedSalesCoverage = coverageRows
    .filter((row) => clean(row.dataset_type) === "approved_sales")
    .map((row) => ({
      periodStart: dateIso(row.period_start),
      periodEnd: dateIso(row.period_end),
      rowCount: Number(row.row_count || 0),
      notes: clean(row.notes),
      runId: clean(row.run_id),
      populationContract: clean(row.population_contract),
      showNewCustomersOnly: Number(row.show_new_customers_only),
      completenessStatus: clean(row.completeness_status),
      populationAuthoritative: authoritativeRunIds.has(clean(row.run_id)),
      observedRowCount: (salesByRunId.get(clean(row.run_id)) || []).length,
      invalidOrderTimestamps: (salesByRunId.get(clean(row.run_id)) || [])
        .filter((order) => (
          (clean(order.approval_timestamp_status) || APPROVAL_TIMESTAMP_EXPLICIT) === APPROVAL_TIMESTAMP_EXPLICIT
          && !carmaApprovalTimestamp(order.sale_approved_at)
        )).length,
      withheldApprovalTimestamps: (salesByRunId.get(clean(row.run_id)) || [])
        .filter((order) => clean(order.approval_timestamp_status) === APPROVAL_TIMESTAMP_WITHHELD).length,
      sourceAttributionWithheld: (salesByRunId.get(clean(row.run_id)) || [])
        .filter((order) => clean(order.lead_source_classification) === ATTRIBUTION_WITHHELD).length,
      ordersOutsidePeriod: (salesByRunId.get(clean(row.run_id)) || [])
        .filter((order) => {
          const businessDate = carmaApprovalBusinessDate(order.sale_approved_at);
          return businessDate && (businessDate < dateIso(row.period_start) || businessDate > dateIso(row.period_end));
        }).length
    }))
    .filter((row) => row.periodStart && row.periodEnd)
    .map((row) => ({
      ...row,
      coverageStatus: !row.populationAuthoritative
        ? "population_not_authoritative"
        : row.rowCount !== row.observedRowCount
          ? "row_count_mismatch"
          : row.invalidOrderTimestamps
            ? "invalid_order_timestamps"
            : row.ordersOutsidePeriod
              ? "orders_outside_coverage"
              : "reconciled"
    }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const reconciledSalesCoverage = approvedSalesCoverage.filter((row) => row.coverageStatus === "reconciled");
  const currentCoverageVerified = coverageContainsRange(reconciledSalesCoverage, reportStart, reportEnd);
  const evidenceThrough = reconciledSalesCoverage
    .map((row) => row.periodEnd)
    .sort()
    .at(-1) || "";
  const latestEvidenceDate = evidenceThrough
    ? zonedLocalTimestamp(evidenceThrough, "23:59:59")
    : null;

  const sourceFacts = new Map();
  const sourceFact = (source = normalizeDimension("")) => {
    if (!sourceFacts.has(source.key)) {
      sourceFacts.set(source.key, {
        source: source.label,
        sentAllocationEvents: 0,
        uniqueCustomerRecipientPairs: 0,
        uniqueCustomers: new Set(),
        exactConvertedCustomerRecipientPairs: 0,
        exactApprovedOrders: 0,
        exactApprovedValue: 0
      });
    }
    return sourceFacts.get(source.key);
  };
  const dailySourceFacts = new Map();
  const ageCounts = new Map(LEAD_AGE_BUCKETS.map((bucket) => [bucket.key, 0]));
  const leadAgeStatusCounts = new Map();
  const customerRecipients = new Map();
  logicalEvents.forEach((event) => {
    const source = sourceFact(event.leadSource);
    source.sentAllocationEvents += 1;
    source.uniqueCustomers.add(event.customerId);
    if (!dailySourceFacts.has(event.sentDate)) dailySourceFacts.set(event.sentDate, new Map());
    const dailySources = dailySourceFacts.get(event.sentDate);
    dailySources.set(event.leadSource.key, {
      source: source.source,
      sentAllocationEvents: (dailySources.get(event.leadSource.key)?.sentAllocationEvents || 0) + 1
    });
    leadAgeStatusCounts.set(
      event.leadImportDateStatus,
      (leadAgeStatusCounts.get(event.leadImportDateStatus) || 0) + 1
    );
    const ageDays = event.leadImportDateStatus === "valid"
      ? leadAgeDays(event.sentDate, event.leadImportDate)
      : null;
    const bucket = leadAgeBucket(ageDays);
    ageCounts.set(bucket, (ageCounts.get(bucket) || 0) + 1);
    if (!customerRecipients.has(event.customerId)) customerRecipients.set(event.customerId, new Set());
    customerRecipients.get(event.customerId).add(event.normalizedSalesperson);
  });
  allocationByCustomerAndPerson.forEach((allocation) => {
    const source = sourceFact(allocation.leadSource);
    source.uniqueCustomerRecipientPairs += 1;
    allocation.exactMatchingOrders = [];
    if (!currentCoverageVerified || allocation.sourceConflict) return;
    const matchingOrders = (ordersByCustomer.get(allocation.customerId) || []).filter((order) => (
      normalizePerson(order.actual_seller) === allocation.normalizedSalesperson
      && order.approvedAt >= allocation.sentAt
      && order.approvedDate <= reportEnd
    ));
    allocation.exactMatchingOrders = matchingOrders;
    if (!matchingOrders.length) return;
    source.exactConvertedCustomerRecipientPairs += 1;
    source.exactApprovedOrders += matchingOrders.length;
    source.exactApprovedValue += matchingOrders.reduce((sum, order) => sum + Number(order.sale_value || 0), 0);
  });

  const sourceAllocationRows = Array.from(sourceFacts.values())
    .map((source) => {
      const sourceScored = currentCoverageVerified && source.source !== "Conflicting source values";
      return {
        source: source.source,
        sentAllocationEvents: source.sentAllocationEvents,
        uniqueCustomerRecipientPairs: source.uniqueCustomerRecipientPairs,
        uniqueCustomers: source.uniqueCustomers.size,
        exactConvertedCustomerRecipientPairs: sourceScored
          ? source.exactConvertedCustomerRecipientPairs
          : null,
        exactApprovedOrders: sourceScored ? source.exactApprovedOrders : null,
        exactApprovedValue: sourceScored ? roundedMoney(source.exactApprovedValue) : null,
        observedConversionRate: sourceScored
          ? percent(source.exactConvertedCustomerRecipientPairs, source.uniqueCustomerRecipientPairs)
          : null,
        conversionStatus: source.source === "Conflicting source values"
          ? "not_scored_source_conflict"
          : currentCoverageVerified
            ? "observed_same_week_immature"
            : "not_scored_sales_coverage_unverified"
      };
    })
    .sort((a, b) => (
      b.sentAllocationEvents - a.sentAllocationEvents
      || a.source.localeCompare(b.source)
    ));
  const approvedSalesSourceFacts = new Map();
  if (currentCoverageVerified) {
    sameWeekSales.forEach((order) => {
      const source = acquisitionSourceDimension(order);
      if (!approvedSalesSourceFacts.has(source.key)) {
        approvedSalesSourceFacts.set(source.key, {
          source: source.label,
          approvedOrders: 0,
          approvedValue: 0
        });
      }
      const fact = approvedSalesSourceFacts.get(source.key);
      fact.approvedOrders += 1;
      fact.approvedValue += Number(order.sale_value || 0);
    });
  }
  const approvedSalesByAcquisitionSource = Array.from(approvedSalesSourceFacts.values())
    .map((source) => ({
      source: source.source,
      approvedOrders: source.approvedOrders,
      approvedValue: roundedMoney(source.approvedValue),
      orderShare: percent(source.approvedOrders, sameWeekSales.length)
    }))
    .sort((a, b) => b.approvedOrders - a.approvedOrders || a.source.localeCompare(b.source));
  const salesHeatmapFacts = new Map();
  if (currentCoverageVerified) {
    sameWeekSales.forEach((order) => {
      const date = carmaApprovalBusinessDate(order.sale_approved_at)
        || (clean(order.approval_timestamp_status) === APPROVAL_TIMESTAMP_WITHHELD
          ? "Timestamp unavailable"
          : "Approval date unavailable");
      const classification = normalizeDimension(
        order.lead_source_classification,
        "Classification unavailable"
      );
      const key = `${date}|${classification.key}`;
      if (!salesHeatmapFacts.has(key)) {
        salesHeatmapFacts.set(key, {
          approvalDate: date,
          source: classification.label,
          approvedOrders: 0,
          approvedValue: 0
        });
      }
      const cell = salesHeatmapFacts.get(key);
      cell.approvedOrders += 1;
      cell.approvedValue += Number(order.sale_value || 0);
    });
  }
  const salesHeatmap = Array.from(salesHeatmapFacts.values())
    .map((cell) => ({
      ...cell,
      approvedValue: roundedMoney(cell.approvedValue)
    }))
    .sort((a, b) => (
      a.approvalDate.localeCompare(b.approvalDate)
      || b.approvedOrders - a.approvedOrders
      || a.source.localeCompare(b.source)
    ));
  const dailyAllocations = Array.from(dailySourceFacts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sources]) => ({
      date,
      sentAllocationEvents: Array.from(sources.values())
        .reduce((sum, source) => sum + source.sentAllocationEvents, 0),
      sources: Array.from(sources.values())
        .sort((a, b) => b.sentAllocationEvents - a.sentAllocationEvents || a.source.localeCompare(b.source))
    }));
  const leadAgeBuckets = LEAD_AGE_BUCKETS.map((bucket) => ({
    ...bucket,
    sentAllocationEvents: ageCounts.get(bucket.key) || 0,
    share: percent(ageCounts.get(bucket.key) || 0, logicalEvents.size)
  }));
  const crossRecipientCustomers = Array.from(customerRecipients.values())
    .filter((recipients) => recipients.size > 1).length;
  const crossRecipientAssignments = Array.from(customerRecipients.values())
    .reduce((sum, recipients) => sum + Math.max(0, recipients.size - 1), 0);
  const repeatSentEventsSameRecipient = Math.max(0, logicalEvents.size - allocationByCustomerAndPerson.size);
  const observedCalledPairs = Array.from(allocationByCustomerAndPerson.values())
    .filter((allocation) => allocation.callObservationStatus === "exact_call_observed").length;
  const noMatchingCallObservedPairs = Math.max(0, allocationByCustomerAndPerson.size - observedCalledPairs);
  const callEvidenceThrough = callDateSet.at(-1) || "";
  const conflictingSourcePairs = Array.from(allocationByCustomerAndPerson.values())
    .filter((allocation) => allocation.sourceConflict).length;
  const sourceEligibleCustomerRecipientPairs = Math.max(
    0,
    allocationByCustomerAndPerson.size - conflictingSourcePairs
  );
  const allocationFrequencyCounts = Array.from(allocationByCustomerAndPerson.values())
    .reduce((counts, allocation) => {
      const key = allocation.sentEventCount >= 4 ? "4_plus" : String(allocation.sentEventCount);
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());
  const allocationFrequency = [
    { key: "1", label: "1 sent event" },
    { key: "2", label: "2 sent events" },
    { key: "3", label: "3 sent events" },
    { key: "4_plus", label: "4+ sent events" }
  ].map((bucket) => ({
    ...bucket,
    customerRecipientPairs: allocationFrequencyCounts.get(bucket.key) || 0,
    share: percent(allocationFrequencyCounts.get(bucket.key) || 0, allocationByCustomerAndPerson.size)
  }));
  const exactSourceLinkedConvertedCustomerRecipientPairs = currentCoverageVerified
    ? sourceAllocationRows.reduce(
      (sum, source) => sum + Number(source.exactConvertedCustomerRecipientPairs || 0),
      0
    )
    : null;
  const exactSourceLinkedApprovedOrders = sourceAllocationRows
    .reduce((sum, source) => sum + Number(source.exactApprovedOrders || 0), 0);
  const exactSourceLinkedApprovedValue = sourceAllocationRows
    .reduce((sum, source) => sum + Number(source.exactApprovedValue || 0), 0);

  const cohortWindows = [30, 60, 90].map((days) => {
    let matureCustomers = 0;
    let convertedCustomers = 0;
    allocationByCustomerAndPerson.forEach((allocation) => {
      const windowEnd = dateInReportTimeZone(addDays(allocation.sentAt, days));
      if (
        !latestEvidenceDate
        || addDays(allocation.sentAt, days) > latestEvidenceDate
        || !coverageContainsRange(reconciledSalesCoverage, allocation.sentDate, windowEnd)
      ) return;
      matureCustomers += 1;
      const matchingOrder = (ordersByCustomer.get(allocation.customerId) || []).find((order) => (
        normalizePerson(order.actual_seller) === allocation.normalizedSalesperson
        && order.approvedAt >= allocation.sentAt
        && order.approvedAt <= addDays(allocation.sentAt, days)
      ));
      if (matchingOrder) convertedCustomers += 1;
    });
    return {
      days,
      status: matureCustomers ? "measured" : "not_mature",
      matureCustomers,
      convertedCustomers,
      conversionRate: percent(convertedCustomers, matureCustomers),
      evidenceThrough
    };
  });

  const totalSent = Array.from(people.values()).reduce((sum, person) => sum + person.sentAllocationEvents, 0);
  const totalUniqueCustomers = Array.from(people.values()).reduce((sum, person) => sum + person.uniqueCustomers, 0);
  const totalSales = Array.from(people.values()).reduce((sum, person) => sum + person.approvedSales, 0);
  const totalValue = Array.from(people.values()).reduce((sum, person) => sum + person.approvedSalesValue, 0);
  const teamRate = currentCoverageVerified ? percent(totalSales, totalSent) : null;
  const rows = Array.from(people.values()).map((person) => {
    const comparisonEligible = person.sentAllocationEvents >= MINIMUM_COMPARISON_ALLOCATIONS;
    const rate = currentCoverageVerified ? percent(person.approvedSales, person.sentAllocationEvents) : null;
    const managers = Array.from(person._managers).sort();
    return {
      salesperson: person.salesperson,
      manager: managers.length === 1 ? managers[0] : "Multiple managers",
      managers,
      sentAllocationEvents: person.sentAllocationEvents,
      uniqueCustomers: person.uniqueCustomers,
      reallocationEvents: person.reallocationEvents,
      reallocationRate: percent(person.reallocationEvents, person.sentAllocationEvents),
      approvedSales: person.approvedSales,
      approvedSalesValue: Math.round(person.approvedSalesValue * 100) / 100,
      approvedSalesPerSentEvent: rate,
      approvedSalesPerUniqueCustomer: currentCoverageVerified
        ? percent(person.approvedSales, person.uniqueCustomers)
        : null,
      companySourcedSales: Number(person.companySourcedSales || 0),
      selfSourcedSales: Number(person.selfSourcedSales || 0),
      attributionWithheldSales: Number(person.attributionWithheldSales || 0),
      customersCalledAfterAllocation: person.customersCalledAfterAllocation,
      sameDayCalls: person.sameDayCalls,
      callsWithin24Hours: person.callsWithin24Hours,
      callsWithin72Hours: person.callsWithin72Hours,
      weeklyCallCount: person.weeklyCallCount,
      weeklyOutboundCallCount: person.weeklyOutboundCallCount,
      weeklyDurationObservedCalls: person.weeklyDurationObservedCalls,
      weeklyZeroDurationCalls: person.weeklyZeroDurationCalls,
      weeklyShortCallCount: person.weeklyShortCallCount,
      weeklyLongCallCount: person.weeklyLongCallCount,
      weeklyTotalCallDurationSeconds: Math.round(person.weeklyTotalCallDurationSeconds),
      weeklyAverageCallDurationSeconds: person.weeklyDurationObservedCalls
        ? person.weeklyTotalCallDurationSeconds / person.weeklyDurationObservedCalls
        : null,
      weeklyMedianCallDurationSeconds: median(person._weeklyCallDurations),
      weeklyCallsPerApprovedSale: person.approvedSales ? person.weeklyCallCount / person.approvedSales : null,
      callDurationCoverageStatus: callDurationCoverageComplete ? "measured" : "not_scored_incomplete_duration_coverage",
      callCoverageStatus: callCoverageComplete ? "measured" : "not_scored_incomplete_call_dates",
      observedCallCoverageRate: callCoverageComplete ? percent(person.customersCalledAfterAllocation, person.uniqueCustomers) : null,
      sameDayCallRate: callCoverageComplete ? percent(person.sameDayCalls, person.uniqueCustomers) : null,
      callWithin24HoursRate: callCoverageComplete ? percent(person.callsWithin24Hours, person.uniqueCustomers) : null,
      callWithin72HoursRate: callCoverageComplete ? percent(person.callsWithin72Hours, person.uniqueCustomers) : null,
      comparisonEligible,
      comparisonStatus: comparisonEligible ? "full_sample" : "low_sample",
      salesCoverageStatus: currentCoverageVerified ? "verified" : "not_scored_sales_coverage_unverified",
      personnelRoleStatus: "not_verified"
    };
  }).sort((a, b) => a.salesperson.localeCompare(b.salesperson));
  const allocationPersonIds = new Set(includedAllocationRows.map((row) => clean(row.SalesPersonID)).filter(Boolean));
  const callUserIds = new Set(eligibleCallRows.map((row) => clean(row.UserID)).filter(Boolean));
  const sharedUserIds = Array.from(allocationPersonIds).filter((id) => callUserIds.has(id)).length;
  const excludedSalesInPeriod = excludedSalesRows.filter((order) => {
    if (clean(order.approval_timestamp_status) === APPROVAL_TIMESTAMP_WITHHELD) {
      const coverage = authoritativeCoverageByRun.get(clean(order.run_id));
      const periodStart = dateIso(coverage?.period_start);
      const periodEnd = dateIso(coverage?.period_end);
      return Boolean(periodStart && periodEnd && periodStart >= reportStart && periodEnd <= reportEnd);
    }
    const approvedDate = carmaApprovalBusinessDate(order.sale_approved_at);
    return approvedDate && approvedDate >= reportStart && approvedDate <= reportEnd;
  }).length;
  const evidenceScope = provenance.allocationLogSha256 || `${reportStart}|${reportEnd}|performance`;
  const allocationEventEvidence = Array.from(logicalEvents.values()).map((event) => ({
    evidenceRef: opaqueEvidenceRef(
      "allocation-event",
      evidenceScope,
      event.customerId,
      event.normalizedSalesperson,
      event.sentDate,
      event.sentTime,
      event.allocationName
    ),
    recordType: "allocation_event",
    salesperson: event.salesperson,
    manager: event.manager,
    source: event.leadSource.label,
    sentDate: event.sentDate,
    sentTime: event.sentTime,
    allocationName: event.allocationName,
    leadImportDate: event.leadImportDate,
    leadImportDateStatus: event.leadImportDateStatus,
    leadAgeBucket: leadAgeBucket(
      event.leadImportDateStatus === "valid"
        ? leadAgeDays(event.sentDate, event.leadImportDate)
        : null
    )
  }));
  const sentLeadEvidence = Array.from(logicalEvents.values()).map((event, index) => ({
    ...allocationEventEvidence[index],
    customerId: event.customerId,
    companyName: event.companyName,
    customerCreateDate: event.customerCreateDate,
    sentAt: event.sentAt,
    allocationItemId: event.allocationItemId
  }));
  const allocationPairEvidence = Array.from(allocationByCustomerAndPerson.values()).map((allocation) => {
    const matchingOrders = allocation.exactMatchingOrders || [];
    const classifications = Array.from(new Set(
      matchingOrders.map((order) => clean(order.lead_source_classification)).filter(Boolean)
    )).sort();
    const acquisitionSources = Array.from(new Set(
      matchingOrders.map((order) => acquisitionSourceDimension(order).label)
    )).sort();
    return {
      evidenceRef: opaqueEvidenceRef(
        "allocation-pair",
        evidenceScope,
        allocation.customerId,
        allocation.normalizedSalesperson
      ),
      recordType: "allocation_pair",
      customerId: allocation.customerId,
      companyName: allocation.companyName,
      salesperson: allocation.salesperson,
      manager: allocation.manager,
      source: allocation.leadSource.label,
      firstSentDate: allocation.sentDate,
      firstSentTime: allocation.sentTime,
      sentEventCount: allocation.sentEventCount,
      recipientCountForLead: customerRecipients.get(allocation.customerId)?.size || 1,
      sourceConflict: Boolean(allocation.sourceConflict),
      callObservationStatus: allocation.callObservationStatus,
      observedCallsAfterAllocation: allocation.observedCallsAfterAllocation,
      firstObservedCallDate: allocation.firstObservedCallDate,
      firstObservedCallIdProvenance: allocation.firstObservedCallIdProvenance,
      observedConversionStatus: !currentCoverageVerified || allocation.sourceConflict
        ? "not_scored"
        : matchingOrders.length
          ? "observed_converted"
          : "no_approved_order_observed",
      exactApprovedOrders: currentCoverageVerified && !allocation.sourceConflict
        ? matchingOrders.length
        : null,
      exactApprovedValue: currentCoverageVerified && !allocation.sourceConflict
        ? roundedMoney(matchingOrders.reduce((sum, order) => sum + Number(order.sale_value || 0), 0))
        : null,
      leadSourceClassifications: classifications,
      acquisitionSources
    };
  });
  const repeatSentEvidence = [];
  people.forEach((person) => {
    person._customers.forEach((events, customerId) => {
      const ordered = events.filter((event) => event.sentAt).sort((a, b) => a.sentAt - b.sentAt);
      ordered.slice(1).forEach((event, index) => {
        repeatSentEvidence.push({
          evidenceRef: opaqueEvidenceRef(
            "repeat-allocation",
            evidenceScope,
            customerId,
            event.normalizedSalesperson,
            event.normalizedManager,
            event.sentDate,
            event.sentTime,
            event.allocationName,
            index + 1
          ),
          recordType: "repeat_allocation_event",
          salesperson: event.salesperson,
          manager: event.manager,
          source: event.leadSource.label,
          firstSentDate: ordered[0].sentDate,
          repeatSentDate: event.sentDate,
          repeatSentTime: event.sentTime,
          allocationName: event.allocationName,
          repeatNumber: index + 1
        });
      });
    });
  });
  const callObservedByCustomer = new Map();
  allocationByCustomerAndPerson.forEach((allocation) => {
    if (!callObservedByCustomer.has(allocation.customerId)) {
      callObservedByCustomer.set(allocation.customerId, false);
    }
    if (allocation.callObservationStatus === "exact_call_observed") {
      callObservedByCustomer.set(allocation.customerId, true);
    }
  });
  const eventsByCustomer = new Map();
  logicalEvents.forEach((event) => {
    if (!eventsByCustomer.has(event.customerId)) eventsByCustomer.set(event.customerId, []);
    eventsByCustomer.get(event.customerId).push(event);
  });
  const distinctLeadEvidence = Array.from(customerRecipients.entries()).map(([customerId, recipients]) => {
    const events = (eventsByCustomer.get(customerId) || []).sort((a, b) => a.sentAt - b.sentAt);
    return {
      evidenceRef: opaqueEvidenceRef("allocated-lead", evidenceScope, customerId),
      recordType: "allocated_lead",
      firstSentDate: events[0]?.sentDate || "",
      sentEventCount: events.length,
      recipientCount: recipients.size,
      recipients: Array.from(new Set(events.map((event) => event.salesperson))).sort(),
      sources: Array.from(new Set(events.map((event) => event.leadSource.label))).sort(),
      anyExactCallObserved: callObservedByCustomer.get(customerId) === true
    };
  });
  const historicalAllocationLinkEvidence = [];
  const weeklyAllocationLinkEvidence = [];
  const salesEvidence = sameWeekSales.map((order) => {
    const allocation = order.exact_weekly_pre_sale_allocation;
    const weeklyAllocationMatch = Boolean(allocation);
    const orderNumber = clean(order.order_id);
    const customerId = clean(order.customer_id);
    const businessName = clean(order.customer_name) || "Unknown";
    const acquisitionSource = acquisitionSourceDimension(order);
    const leadSourceClassification = clean(order.lead_source_classification);
    const approvalTimestampStatus = clean(order.approval_timestamp_status) || APPROVAL_TIMESTAMP_EXPLICIT;
    const historicalAllocationProof = (
      clean(order.stored_lead_source_classification) === COMPANY_SOURCED
      && Number(order.seller_allocated_before_sale) === 1
      && Boolean(clean(order.historical_allocation_id))
    );
    const weeklyClassificationProof = (
      Number(order.lead_source_classification_reconciled_from_weekly) === 1
      && weeklyAllocationMatch
    );
    const saleEvidence = {
      evidenceRef: opaqueEvidenceRef("approved-sale", evidenceScope, order.order_id),
      recordType: "approved_sale",
      orderNumber,
      businessName,
      customerId,
      seller: clean(order.actual_seller) || "Unknown",
      approvalDate: carmaApprovalBusinessDate(order.sale_approved_at),
      approvalPeriod: approvalTimestampStatus === APPROVAL_TIMESTAMP_WITHHELD
        ? `${order.approvalPeriodStart} to ${order.approvalPeriodEnd}`
        : carmaApprovalBusinessDate(order.sale_approved_at),
      approvalTimestampStatus,
      approvedValue: roundedMoney(order.sale_value),
      acquisitionSource: acquisitionSource.label,
      acquisitionSourceProven: Number(order.acquisition_source_proven) === 1,
      leadSourceClassification,
      storedLeadSourceClassification: clean(order.stored_lead_source_classification),
      leadSourceClassificationReconciled: weeklyClassificationProof,
      leadSourceClassificationEvidenceSource: clean(order.lead_source_classification_evidence_source),
      leadSourceProofStatus: approvalTimestampStatus === APPROVAL_TIMESTAMP_WITHHELD
        ? "withheld_approval_timestamp_unavailable_after_two_read_only_captures"
        : historicalAllocationProof
        ? "exact_governed_history_pre_sale_seller_allocation"
        : weeklyClassificationProof
          ? "exact_weekly_pre_sale_seller_allocation"
          : "no_exact_pre_sale_seller_allocation_in_combined_sources",
      historicalAllocationProofStatus: approvalTimestampStatus === APPROVAL_TIMESTAMP_WITHHELD
        ? "not_evaluated_approval_timestamp_unavailable"
        : historicalAllocationProof
        ? "exact_pre_sale_seller_allocation"
        : clean(order.stored_lead_source_classification) === SELF_SOURCED
          ? "no_pre_sale_seller_allocation_in_governed_history"
          : "historical_allocation_proof_unavailable",
      weeklyAllocationMatchStatus: approvalTimestampStatus === APPROVAL_TIMESTAMP_WITHHELD
        ? "not_evaluated_approval_timestamp_unavailable"
        : weeklyAllocationMatch
        ? "matched_in_selected_week"
        : "not_present_in_selected_week",
      allocationSource: approvalTimestampStatus === APPROVAL_TIMESTAMP_WITHHELD
        ? "Not evaluated - approval timestamp unavailable"
        : allocation && !allocation.sourceConflict
        ? allocation.leadSource.label
        : "Not exactly linked",
      firstAllocationDate: allocation?.sentDate || ""
    };
    if (historicalAllocationProof) {
      historicalAllocationLinkEvidence.push({
        evidenceRef: opaqueEvidenceRef(
          "historical-allocation-link",
          evidenceScope,
          orderNumber,
          order.historical_allocation_id
        ),
        recordType: "historical_allocation_link",
        orderNumber,
        businessName,
        customerId,
        seller: saleEvidence.seller,
        approvalDate: saleEvidence.approvalDate,
        approvedValue: saleEvidence.approvedValue,
        acquisitionSource: saleEvidence.acquisitionSource,
        acquisitionSourceProven: saleEvidence.acquisitionSourceProven,
        leadSourceClassification: saleEvidence.leadSourceClassification,
        leadSourceClassificationEvidenceSource: saleEvidence.leadSourceClassificationEvidenceSource,
        allocationItemId: clean(order.historical_allocation_id),
        allocationHistoryId: clean(order.historical_allocation_history_id),
        allocationRecipient: clean(order.historical_allocation_recipient),
        allocationManager: clean(order.historical_allocation_manager),
        allocationDescription: clean(order.historical_allocation_description),
        allocationEffectiveStart: clean(order.historical_allocation_effective_start_at),
        allocationInactivatedAt: clean(order.historical_allocation_inactivated_at),
        allocationActiveAtSale: Number(order.historical_allocation_active_at_sale) === 1,
        linkRule: "Complete governed Carma history: exact actual seller allocation started before approval; latest qualifying allocation selected"
      });
    }
    if (weeklyAllocationMatch) {
      weeklyAllocationLinkEvidence.push({
        evidenceRef: opaqueEvidenceRef(
          "weekly-allocation-link",
          evidenceScope,
          orderNumber,
          allocation.allocationItemId
        ),
        recordType: "weekly_allocation_link",
        orderNumber,
        businessName,
        customerId,
        seller: saleEvidence.seller,
        approvalDate: saleEvidence.approvalDate,
        approvedValue: saleEvidence.approvedValue,
        acquisitionSource: saleEvidence.acquisitionSource,
        acquisitionSourceProven: saleEvidence.acquisitionSourceProven,
        leadSourceClassification: saleEvidence.leadSourceClassification,
        leadSourceClassificationEvidenceSource: saleEvidence.leadSourceClassificationEvidenceSource,
        classificationProof: weeklyClassificationProof,
        allocationItemId: allocation.allocationItemId || "",
        allocationRecipient: allocation.salesperson,
        allocationManager: allocation.manager,
        allocationSource: allocation.leadSource.label,
        allocationName: allocation.allocationName,
        allocationSentDate: allocation.sentDate,
        allocationSentTime: allocation.sentTime,
        linkRule: "Selected weekly log: exact customer ID + exact normalized seller, with allocation sent on or before approval"
      });
    }
    return saleEvidence;
  });
  const duplicateEvidence = duplicateEventEvidence.map((event) => ({
    evidenceRef: opaqueEvidenceRef(
      "duplicate-allocation",
      evidenceScope,
      event.customerId,
      event.normalizedSalesperson,
      event.sentDate,
      event.sentTime,
      event.allocationName,
      event.allocationItemId
    ),
    recordType: "duplicate_allocation",
    salesperson: event.salesperson,
    manager: event.manager,
    source: event.leadSource.label,
    sentDate: event.sentDate,
    sentTime: event.sentTime,
    allocationName: event.allocationName,
    exclusionReason: "Logical duplicate row"
  }));

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    configured,
    available: true,
    status: "available",
    period: {
      startDate: reportStart,
      endDate: reportEnd,
      label: `${reportStart} to ${reportEnd}`,
      timezone: REPORT_TIME_ZONE
    },
    availablePeriod: {
      startDate: availableStartDate || reportStart,
      endDate: availableEndDate || reportEnd,
      timezone: REPORT_TIME_ZONE
    },
    provenance,
    comparison: {
      label: "Same-week approved-sales productivity proxy",
      minimumAllocations: MINIMUM_COMPARISON_ALLOCATIONS,
      rows,
      fullSampleRows: rows.filter((row) => row.comparisonEligible).length,
      salesCoverageStatus: currentCoverageVerified ? "verified" : "not_verified",
      salesCoverage: currentCoverageVerified
        ? reconciledSalesCoverage
          .filter((row) => row.periodEnd >= reportStart && row.periodStart <= reportEnd)
          .map(({ periodStart, periodEnd, rowCount, observedRowCount, withheldApprovalTimestamps, coverageStatus }) => ({
            periodStart,
            periodEnd,
            rowCount,
            observedRowCount,
            withheldApprovalTimestamps,
            coverageStatus
          }))
        : [],
      rankingApplied: false
    },
    totals: {
      rawAllocationRows: includedAllocationRows.length,
      excludedPersonnelAllocationRows: excludedAllocationRows.length,
      deduplicatedSentEvents: totalSent,
      logicalDuplicateRows: includedAllocationRows.length - logicalEvents.size - missingAllocationKeys - invalidAllocationTimestamps,
      uniqueCustomerRecipientPairs: totalUniqueCustomers,
      uniqueCustomers: customerRecipients.size,
      salespeople: people.size,
      approvedSalesInPeriod: sameWeekSales.length,
      sourceAttributionExceptionsInPeriod: attributionWithheldSales,
      approvalTimestampExceptionsInPeriod: attributionWithheldSales,
      excludedPersonnelApprovedSalesInPeriod: excludedSalesInPeriod,
      approvedSalesWithRecipientLabelMatch: totalSales,
      approvedSalesWithoutRecipientLabelMatch: unmatchedSalesOrders,
      approvedSalesValueWithRecipientLabelMatch: Math.round(totalValue * 100) / 100,
      approvedSalesPerSentEvent: teamRate,
      approvedSalesPerUniqueCustomer: currentCoverageVerified ? percent(totalSales, totalUniqueCustomers) : null,
      uniqueCallsInSupplement: uniqueCalls.size,
      excludedPersonnelCallRows: excludedCallRows.length
    },
    leadAnalytics: {
      sourceRule: "Allocation DataSource; CustomerImportSource fallback; missing values grouped as Unknown.",
      conversionRule: "Exact customer plus exact normalized seller, approved after the pair's first sent allocation and by the reporting-period end.",
      conversionWindowStatus: currentCoverageVerified
        ? "observed_same_week_immature"
        : "not_scored_sales_coverage_unverified",
      allocationDateCoverageStatus: "observed_dates_only",
      sourceAllocationRows,
      approvedSalesByAcquisitionSource,
      salesHeatmap,
      geographyStatus: "not_available_no_authoritative_geography",
      geographyReason: "The governed allocation and approved-sales contracts do not contain authoritative customer state, postcode, country or coordinates.",
      dailyAllocations,
      leadAgeBuckets,
      allocationFrequency,
      usage: {
        uniqueCustomers: customerRecipients.size,
        uniqueCustomerRecipientPairs: allocationByCustomerAndPerson.size,
        repeatSentEventsSameRecipient,
        crossRecipientCustomers,
        crossRecipientAssignments,
        conflictingSourcePairs,
        logicalDimensionConflictRows,
        usagePartitionReconciled: logicalEvents.size === (
          customerRecipients.size
          + repeatSentEventsSameRecipient
          + crossRecipientAssignments
        ),
        logicalDuplicateRows: includedAllocationRows.length - logicalEvents.size - missingAllocationKeys - invalidAllocationTimestamps,
        unknownSourceSentEvents: sourceAllocationRows.find((source) => source.source === "Unknown")?.sentAllocationEvents || 0
      },
      callObservation: {
        status: callCoverageComplete
          ? "complete_exact_join_evidence"
          : "incomplete_call_supplement",
        observedCalledCustomerRecipientPairs: observedCalledPairs,
        foundCustomerIdPositiveRepairs,
        foundCustomerIdPositiveRepairPairs,
        foundCustomerIdNewlyObservedPairs,
        unlinkedSelfSourcingCallAttempts,
        noExactCallObservedCustomerRecipientPairs: noMatchingCallObservedPairs,
        authoritativeNotCalledCustomerRecipientPairs: null,
        observationThrough: callEvidenceThrough,
        definition: "Exact customer plus exact normalized allocation recipient, with a call at or after first allocation in the selected period.",
        limitation: "Calls without a customer ID are treated as separate unsuccessful self-sourcing attempts and do not block company-supplied lead call coverage. They are activity, not Self-Sourced Sales, and are never attached to an allocated customer by phone or fuzzy matching."
      },
      linkage: {
        exactSourceLinkedConvertedCustomerRecipientPairs,
        exactSourceLinkedApprovedOrders: currentCoverageVerified
          ? exactSourceLinkedApprovedOrders
          : null,
        exactSourceLinkedApprovedValue: currentCoverageVerified
          ? roundedMoney(exactSourceLinkedApprovedValue)
          : null,
        observedConversionRate: currentCoverageVerified
          ? percent(
            exactSourceLinkedConvertedCustomerRecipientPairs,
            sourceEligibleCustomerRecipientPairs
          )
          : null,
        sourceEligibleCustomerRecipientPairs,
        approvedOrdersInPeriod: currentCoverageVerified ? sameWeekSales.length : 0,
        approvedOrdersWithoutExactSourceLink: currentCoverageVerified
          ? Math.max(0, sameWeekSales.length - exactSourceLinkedApprovedOrders)
          : 0,
        coverageStatus: currentCoverageVerified ? "verified" : "not_verified"
      },
      personnelExclusions: {
        policyVersion: "performance_personnel_exclusions.v1",
        excludedLabels: EXCLUDED_PERSONNEL.length,
        allocationRows: excludedAllocationRows.length,
        callRows: excludedCallRows.length,
        approvedOrdersInPeriod: excludedSalesInPeriod
      }
    },
    cohortWindows,
    approvedSalesHistory,
    history: reconciledSalesCoverage.map((coverage) => {
      const coveredOrders = authoritativeSalesRows.filter((order) => clean(order.run_id) === coverage.runId);
      return {
        period: `${coverage.periodStart} to ${coverage.periodEnd}`,
        approvedSales: coverage.rowCount,
        observedApprovedSales: coveredOrders.length,
        approvedSalesValue: Math.round(coveredOrders.reduce((sum, order) => sum + Number(order.sale_value || 0), 0) * 100) / 100,
        coverageStatus: coverage.coverageStatus,
        sourceLabel: coverage.populationAuthoritative
          ? "Carma all-approved-sales extraction"
          : "Carma scoped approved-sales extraction (excluded)"
      };
    }),
    dataQuality: {
      allocationDates: allocationDateSet,
      callDates: callDateSet,
      dateWindowMismatch: callDateSet.some((date) => date < reportStart || date > reportEnd),
      callCoverageComplete,
      callCoverageStatus: callCoverageComplete ? "measured" : "not_scored_incomplete_call_dates",
      authoritativeNotCalledStatus: callCoverageComplete
        ? "measured_exact_allocated_lead_business_week_coverage"
        : "not_scored_incomplete_allocated_lead_call_coverage",
      callEvidenceThrough,
      observedCalledPairs,
      noExactCallObservedPairs: noMatchingCallObservedPairs,
      callDurationColumnPresent,
      callDurationCoverageComplete,
      weeklyCallsInPeriod,
      invalidWeeklyCallDurations,
      shortCallSeconds: SHORT_CALL_SECONDS,
      longCallSeconds: LONG_CALL_SECONDS,
      excludedPersonnelAllocationRows: excludedAllocationRows.length,
      excludedPersonnelCallRows: excludedCallRows.length,
      excludedPersonnelApprovedSalesInPeriod: excludedSalesInPeriod,
      missingAllocationKeys,
      invalidAllocationDateRows,
      invalidAllocationTimestamps,
      invalidCallTimestamps,
      invalidSalesTimestamps,
      attributionWithheldSales,
      missingCallIds,
      rawMissingCallJoinKeys,
      missingCallJoinKeys,
      unlinkedSelfSourcingCallAttempts,
      foundCustomerIdPositiveRepairs,
      foundCustomerIdPositiveRepairPairs,
      foundCustomerIdNewlyObservedPairs,
      conflictingCallCustomerIds,
      duplicateCallIds,
      conflictingDuplicateCallIds,
      duplicateAllocationItemIds: Array.from(allocationItemIds.values()).filter((count) => count > 1).length,
      logicalDimensionConflictRows,
      allocationSourceColumnPresent: allocationColumns.includes("DataSource")
        || allocationColumns.includes("CustomerImportSource"),
      leadImportDateColumnPresent: allocationColumns.includes("LeadImportDate_Date"),
      validLeadImportDateEvents: leadAgeStatusCounts.get("valid") || 0,
      missingLeadImportDateEvents: leadAgeStatusCounts.get("missing") || 0,
      invalidLeadImportDateEvents: leadAgeStatusCounts.get("invalid") || 0,
      futureLeadImportDateEvents: leadAgeStatusCounts.get("future") || 0,
      conflictingLeadImportDateEvents: leadAgeStatusCounts.get("conflicting") || 0,
      missingCallColumns,
      allocationPersonIds: allocationPersonIds.size,
      callUserIds: callUserIds.size,
      sharedUserIds,
      multipleManagerSalespeople: rows.filter((row) => row.managers.length > 1).length,
      salespersonIdentityRule: "Normalized exact salesperson label; source user IDs are not cross-system identifiers.",
      exactCustomerJoinOnly: true,
      salesGeographyStatus: "not_available_no_authoritative_geography",
      approvedSalesCoverageStatus: currentCoverageVerified ? "verified" : "not_verified",
      approvedSalesCoverage: approvedSalesCoverage
        .filter((row) => row.periodEnd >= reportStart && row.periodStart <= reportEnd)
        .map(({ periodStart, periodEnd, rowCount, observedRowCount, withheldApprovalTimestamps, coverageStatus }) => (
          coverageStatus === "reconciled"
            ? { periodStart, periodEnd, rowCount, observedRowCount, withheldApprovalTimestamps, coverageStatus }
            : { periodStart, periodEnd, coverageStatus }
        )),
      leadSourcePolicyVersions: Array.from(new Set(authoritativeSalesRows.map((order) => clean(order.lead_source_classification_rule_version)).filter(Boolean))).sort(),
      leadSourceEvidenceReconciliationVersion: LEAD_SOURCE_EVIDENCE_RECONCILIATION_VERSION,
      weeklyAllocationClassificationCorrections,
      unresolvedExactWeeklyClassificationContradictions,
      leadSourcePolicyMismatchOrders: authoritativeSalesRows.filter((order) => (
        clean(order.lead_source_classification_rule_version)
        && clean(order.lead_source_classification_rule_version) !== "actual_seller_any_pre_sale_allocation.v1"
      )).length
    },
    definitions: {
      sentAllocationEvent: "A logical allocation event deduplicated by customer, recipient, manager, sent date/time and allocation name.",
      leadSource: "The allocation export DataSource, falling back to CustomerImportSource; it remains separate from Carma acquisition source and campaign.",
      observedSourceConversion: "Unique customer-recipient pairs with an exact-customer, exact-seller approved order after first allocation and by week end, divided by unique customer-recipient pairs for that source. This one-week view is immature.",
      leadReuse: "Repeat sends and cross-recipient assignments are source-record quantities for investigation; neither proves waste, neglect or loss.",
      leadAge: "Calendar days from LeadImportDate_Date to the sent allocation date. Missing, invalid and future dates remain Unknown / invalid.",
      callObservation: "A positive exact-customer, exact-recipient call at or after first allocation in the selected period. Direct customer_id is primary. When it is missing, FoundCustomerID may contribute only when it exactly matches the same recipient's selected-period CustomerID and the call occurred after allocation; raw source data remains unchanged. A valid call without a customer ID is a separate self-sourcing attempt, not a company-supplied lead call and not a Self-Sourced Sale.",
      salesHeatmap: "Approved order count and approved amount by Company Sourced/Self Sourced classification and approval date after combining governed Carma history with positive exact weekly allocation proof. Source-attribution exceptions are shown separately and are not source-classified. Acquisition channel remains separate.",
      approvalTimestampException: "An order remains in Approved Sales and value totals when source attribution cannot be decided safely. This can occur when the approval timestamp is unavailable or when exact-customer allocation-history coverage is incomplete and no positive weekly proof exists.",
      sameWeekProxy: "Approved orders in the reporting week divided by deduplicated sent allocation events in that week.",
      uniqueCustomerRate: "Approved orders in the reporting week divided by unique customer-recipient pairs sent in that week.",
      cohortConversion: "Exact customer and exact seller approved within the stated number of days after allocation, using only fully matured customers.",
      callCoverage: "An exact-customer call by the exact normalized allocation-recipient label after allocation. Direct customer_id is primary; a missing value may use an exact FoundCustomerID/customer-recipient/allocation-time match only as positive evidence. Valid calls without a customer ID are reported separately as self-sourcing attempts and do not block company-supplied lead scoring. Phone numbers and fuzzy names are never used.",
      weeklyCallActivity: `Deduplicated calls assigned by exact salesperson label and call date inside the selected reporting period. Average and median call time use call_duration_seconds. Short calls are more than zero and under ${SHORT_CALL_SECONDS} seconds; long calls are at least ${LONG_CALL_SECONDS} seconds. Calls per Approved Sale is a workload ratio, not causal conversion.`,
      approvedSalesValue: "CRM approved-sale amount; not payment, profit or recognised revenue.",
      leadSourcePolicy: "Company Sourced/Self Sourced uses actual_seller_any_pre_sale_allocation.v1 and stays separate from acquisition source and campaign.",
      historicalAllocationProof: "Complete governed Carma history is the primary classification source. An exact customer-ID plus exact full-seller weekly allocation sent before approval can safely correct a first-name-truncated history mismatch.",
      weeklyAllocationMatch: "A positive exact match in the configured weekly allocation export can prove Company Sourced. Absence from the weekly export never downgrades a governed Company Sourced order or independently proves Self Sourced.",
      approvalTime: `Carma approval date/time components are source Australia/Sydney business time under ${CARMA_APPROVAL_TIME_SEMANTICS}; the stored trailing Z is not reinterpreted as a UTC business date.`
    },
    limitations: [
      "The same-week proxy is a workload/productivity comparison, not lead-cohort conversion or proof that a particular call caused a sale.",
      "Observed source conversion covers only approvals visible by the reporting-period end; later approvals can increase these rates as the cohort matures.",
      "Daily allocation columns show dates with observed sent events; an absent date is not silently treated as zero.",
      "The selected-range cohort uses the first observed allocation inside the selected period; earlier allocations outside the selected range are not represented in this weekly source file.",
      "A missing match in the configured weekly allocation export is not evidence of Self Sourced and never downgrades governed history. Only a positive exact customer-ID, exact full-seller, pre-approval weekly match can supplement the governed history.",
      "Orders with incomplete source-attribution evidence remain in complete Approved Sales totals but are excluded from Company/Self attribution. Pre-sale timing is also withheld when the approval timestamp itself is unavailable.",
      "Repeat sends and cross-recipient allocations are lead-usage signals, not proof that a lead was wasted.",
      "No authoritative customer geography exists in the governed allocation or approved-sales contracts, so no geographic sales map is produced.",
      "Configured personnel exclusions are applied by exact normalized primary salesperson/seller label before analytical denominators; management and ownership labels do not remove another recipient's row.",
      "Unmatured allocation cohorts are excluded from 30/60/90-day conversion denominators.",
      "Personnel matching uses normalized exact source labels because allocation SalesPersonID and call UserID are different identifier systems.",
      "All source recipient labels remain visible, the table is alphabetical, and no personnel rank or automated performance band is applied.",
      "Call dates outside the allocation reporting window are disclosed and are used only for bounded post-allocation execution timing.",
      "Historical is_new_customer means exact order membership in Carma's new-customer-only report for that period; false is not independent proof of an existing customer.",
      "The Carma new-customer marker becomes extremely sparse before the observed 2024 boundary, so those earlier false values retain a data-quality warning."
    ]
  };
  Object.defineProperty(report, "_evidence", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: {
      allocationEvents: allocationEventEvidence,
      allocationPairs: allocationPairEvidence,
      repeatSends: repeatSentEvidence,
      distinctLeads: distinctLeadEvidence,
      approvedSales: salesEvidence,
      historicalAllocationLinks: historicalAllocationLinkEvidence,
      weeklyAllocationLinks: weeklyAllocationLinkEvidence,
      duplicateAllocations: duplicateEvidence,
      salespeople: rows.map((row) => ({
        evidenceRef: opaqueEvidenceRef("performance-salesperson", evidenceScope, row.salesperson),
        recordType: "salesperson_summary",
        salesperson: row.salesperson,
        manager: row.manager,
        managers: row.managers,
        sentAllocationEvents: row.sentAllocationEvents,
        uniqueCustomers: row.uniqueCustomers,
        reallocationEvents: row.reallocationEvents,
        approvedSales: row.approvedSales,
        approvedSalesValue: row.approvedSalesValue,
        companySourcedSales: row.companySourcedSales,
        selfSourcedSales: row.selfSourcedSales,
        attributionWithheldSales: row.attributionWithheldSales,
        customersCalledAfterAllocation: row.customersCalledAfterAllocation,
        weeklyCallCount: row.weeklyCallCount,
        weeklyOutboundCallCount: row.weeklyOutboundCallCount,
        weeklyAverageCallDurationSeconds: row.weeklyAverageCallDurationSeconds,
        weeklyMedianCallDurationSeconds: row.weeklyMedianCallDurationSeconds,
        weeklyShortCallCount: row.weeklyShortCallCount,
        weeklyLongCallCount: row.weeklyLongCallCount,
        weeklyZeroDurationCalls: row.weeklyZeroDurationCalls,
        weeklyCallsPerApprovedSale: row.weeklyCallsPerApprovedSale,
        callDurationCoverageStatus: row.callDurationCoverageStatus,
        callCoverageStatus: row.callCoverageStatus,
        salesCoverageStatus: row.salesCoverageStatus
      }))
    }
  });
  Object.defineProperty(report, "_sentLeadEvidence", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: sentLeadEvidence
  });
  return report;
}

function loadPerformanceSourceContext({ config = {}, databasePath = "" } = {}) {
  if (!config.configured) {
    return {
      available: false,
      config,
      report: emptyPerformanceReport({ configured: false })
    };
  }
  if (config.error) {
    return {
      available: false,
      config,
      report: emptyPerformanceReport({
        configured: true,
        error: config.error,
        code: "PERFORMANCE_CONFIG_INVALID"
      })
    };
  }
  const configuredAllocationSources = Array.isArray(config.allocationSources) && config.allocationSources.length
    ? config.allocationSources
    : config.allocationLogPath
      ? [{ path: config.allocationLogPath, role: "weekly_allocation" }]
      : [];
  if (!configuredAllocationSources.length || configuredAllocationSources.some((source) => !clean(source?.path) || !fs.existsSync(path.resolve(source.path)))) {
    return {
      available: false,
      config,
      report: emptyPerformanceReport({
        configured: true,
        error: "The configured performance allocation log is unavailable.",
        code: "PERFORMANCE_ALLOCATION_NOT_FOUND"
      })
    };
  }
  if (!databasePath || !fs.existsSync(databasePath)) {
    return {
      available: false,
      config,
      report: emptyPerformanceReport({
        configured: true,
        error: "The read-only Carma evidence database is unavailable.",
        code: "PERFORMANCE_CARMA_NOT_FOUND"
      })
    };
  }

  try {
    const loadedAllocationSources = configuredAllocationSources.map((source) => {
      const sourcePath = path.resolve(clean(source.path));
      const loaded = readTabularFileColumns(sourcePath, ALLOCATION_INPUT_COLUMNS);
      return {
        path: sourcePath,
        role: clean(source.role) || "weekly_allocation",
        columns: loaded.columns,
        rows: loaded.rows.map((row) => ({
          ...row,
          __allocationSourceRole: clean(source.role) || "weekly_allocation"
        }))
      };
    });
    const allocations = {
      columns: Array.from(new Set(loadedAllocationSources.flatMap((source) => source.columns))),
      rows: loadedAllocationSources.flatMap((source) => source.rows)
    };
    const configuredCallSources = Array.isArray(config.callSources) && config.callSources.length
      ? config.callSources
      : config.callCsvPath
        ? [{ path: config.callCsvPath, role: "weekly_supplement", dateOrder: "month_first" }]
        : [];
    const loadedCallSources = configuredCallSources.map((source) => {
      const sourcePath = path.resolve(clean(source?.path));
      if (!sourcePath || !fs.existsSync(sourcePath)) return null;
      const role = clean(source.role) || "supplement";
      const dateOrder = clean(source.dateOrder) === "day_first" ? "day_first" : "month_first";
      const loaded = readTabularFileColumns(sourcePath, CALL_INPUT_COLUMNS);
      const missing = REQUIRED_CALL_COLUMNS.filter((column) => !loaded.columns.includes(column));
      if (missing.length) {
        throw new Error(`A configured performance call source is missing required columns: ${missing.join(", ")}`);
      }
      return {
        path: sourcePath,
        role,
        dateOrder,
        columns: loaded.columns,
        rows: loaded.rows.map((row) => ({
          ...row,
          __callDateOrder: dateOrder,
          __callSourceRole: role
        }))
      };
    }).filter(Boolean);
    const calls = {
      columns: Array.from(new Set(loadedCallSources.flatMap((source) => source.columns))),
      rows: loadedCallSources.flatMap((source) => source.rows)
    };
    const facts = readValidatedCarmaFacts({ databasePath, projection: "performance" });
    let approvedSalesHistory;
    try {
      approvedSalesHistory = readApprovedSalesHistorySummary({
        databasePath: config.approvedSalesHistoryPath || ""
      });
    } catch {
      approvedSalesHistory = {
        configured: Boolean(config.approvedSalesHistoryPath),
        available: false,
        status: config.approvedSalesHistoryPath ? "unavailable" : "not_configured",
        error: config.approvedSalesHistoryPath
          ? "Historical approved-sales evidence is unavailable."
          : "",
        schemaVersion: "",
        rows: [],
        definitions: {}
      };
    }
    if (
      approvedSalesHistory.configured
      && !approvedSalesHistory.available
      && approvedSalesHistory.error
    ) {
      approvedSalesHistory = {
        ...approvedSalesHistory,
        error: "Historical approved-sales evidence is unavailable."
      };
    }
    const callSourceFingerprints = loadedCallSources.map((source) => ({
      role: source.role,
      dateOrder: source.dateOrder,
      fileName: path.basename(source.path),
      sha256: sha256File(source.path)
    }));
    const allocationSourceFingerprints = loadedAllocationSources.map((source) => ({
      role: source.role,
      fileName: path.basename(source.path),
      sha256: sha256File(source.path)
    }));
    const provenance = {
      allocationLogSha256: crypto.createHash("sha256").update(JSON.stringify(allocationSourceFingerprints)).digest("hex"),
      allocationSourceFingerprints,
      callExportSha256: callSourceFingerprints.length
        ? crypto.createHash("sha256").update(JSON.stringify(callSourceFingerprints)).digest("hex")
        : "",
      callSourceFingerprints,
      carmaEvidenceSha256: sha256File(databasePath),
      approvedSalesHistorySha256:
        approvedSalesHistory.available && config.approvedSalesHistoryPath
          ? sha256File(config.approvedSalesHistoryPath)
          : "",
      approvedSalesHistorySchemaVersion:
        approvedSalesHistory.schemaVersion || "",
      carmaContractSchemaVersion: facts.meta.schema_version,
      carmaApprovalTimeSemantics: facts.meta.approval_timestamp_semantics,
      leadSourcePolicyVersion:
        facts.meta.lead_source_classification_rule_version || facts.meta.policy_rule_version || ""
    };
    return {
      available: true,
      config,
      allocations,
      calls,
      facts,
      approvedSalesHistory,
      provenance,
      report: null
    };
  } catch (error) {
    return {
      available: false,
      config,
      report: emptyPerformanceReport({
        configured: true,
        error: "Performance sources could not be read and validated.",
        code: "PERFORMANCE_REPORT_LOAD_FAILED"
      })
    };
  }
}

function buildPerformanceCohortsFromContext(context = {}, selection = {}) {
  if (!context.available) return context.report || emptyPerformanceReport({ configured: false });
  const startDate = clean(selection.startDate || context.config.startDate);
  const endDate = clean(selection.endDate || context.config.endDate);
  if (
    !validIsoDate(startDate)
    || !validIsoDate(endDate)
    || endDate < startDate
    || (context.config.startDate && startDate < context.config.startDate)
    || (context.config.endDate && endDate > context.config.endDate)
  ) {
    const report = emptyPerformanceReport({
      configured: true,
      error: `Select a valid Performance date range within ${context.config.startDate} to ${context.config.endDate}.`,
      code: "PERFORMANCE_DATE_RANGE_INVALID"
    });
    report.period = {
      startDate,
      endDate,
      label: [startDate, endDate].filter(Boolean).join(" to "),
      timezone: REPORT_TIME_ZONE
    };
    report.availablePeriod = {
      startDate: context.config.startDate,
      endDate: context.config.endDate,
      timezone: REPORT_TIME_ZONE
    };
    return report;
  }
  return buildPerformanceCohortsReport({
    allocationRows: context.allocations.rows,
    allocationColumns: context.allocations.columns,
    callRows: context.calls.rows,
    callColumns: context.calls.columns,
    salesRows: context.facts.orders,
    coverageRows: context.facts.coverageRows,
    approvedSalesHistory: context.approvedSalesHistory,
    provenance: context.provenance,
    startDate,
    endDate,
    availableStartDate: context.config.startDate,
    availableEndDate: context.config.endDate,
    configured: true
  });
}

function loadPerformanceCohorts(options = {}) {
  const context = loadPerformanceSourceContext(options);
  return buildPerformanceCohortsFromContext(context);
}

const PERFORMANCE_DRILLDOWN_DEFINITIONS = Object.freeze({
  "performance.salespeople": {
    title: "Salespeople Receiving Leads",
    description: "Eligible allocation recipients with at least one valid Sent Lead in the selected period. This does not claim that a zero-lead salesperson was inactive.",
    recordType: "salesperson_summary",
    evidenceKey: "salespeople"
  },
  "performance.sentEvents": {
    title: "Sent Allocation Events",
    description: "Deduplicated sent allocation events in the selected Performance period.",
    recordType: "allocation_event",
    evidenceKey: "allocationEvents"
  },
  "performance.distinctLeads": {
    title: "Distinct Allocated Leads",
    description: "One privacy-safe evidence row per distinct allocated customer record in the selected period.",
    recordType: "allocated_lead",
    evidenceKey: "distinctLeads"
  },
  "performance.allocationPairs": {
    title: "Customer-Recipient Allocation Pairs",
    description: "One privacy-safe evidence row per exact customer and normalized allocation recipient pair.",
    recordType: "allocation_pair",
    evidenceKey: "allocationPairs"
  },
  "performance.observedConversion": {
    title: "Observed Source Conversion Evidence",
    description: "Customer-recipient pairs behind the explicitly immature observed source-conversion calculation.",
    recordType: "allocation_pair",
    evidenceKey: "allocationPairs"
  },
  "performance.repeatSends": {
    title: "Repeat Sent Allocation Events",
    description: "One privacy-safe evidence row for every deduplicated sent allocation event beyond the first customer-recipient event.",
    recordType: "repeat_allocation_event",
    evidenceKey: "repeatSends"
  },
  "performance.crossRecipient": {
    title: "Cross-Recipient Allocated Leads",
    description: "Distinct allocated leads observed under more than one normalized recipient in the selected period.",
    recordType: "allocated_lead",
    evidenceKey: "distinctLeads",
    predicate: (row) => Number(row.recipientCount || 0) > 1
  },
  "performance.duplicateRows": {
    title: "Excluded Logical Duplicate Rows",
    description: "Privacy-safe evidence rows excluded as logical duplicates before Performance aggregation.",
    recordType: "duplicate_allocation",
    evidenceKey: "duplicateAllocations"
  },
  "performance.leadAge": {
    title: "Lead Age At Allocation",
    description: "Sent allocation events behind the selected lead-age bucket.",
    recordType: "allocation_event",
    evidenceKey: "allocationEvents"
  },
  "performance.called": {
    title: "Exact Calls Observed After Allocation",
    description: "Customer-recipient pairs with at least one exact-customer, exact-recipient call observed after first allocation.",
    recordType: "allocation_pair",
    evidenceKey: "allocationPairs",
    predicate: (row) => row.callObservationStatus === "exact_call_observed"
  },
  "performance.noCallObserved": {
    title: "Allocated Leads With No Recorded Call by Evidence Cutoff",
    description: "Review the company-supplied leads that do not yet have an exact post-allocation call match in the available call evidence. Business name and customer ID are included for local auditing. Unless the governed reporting-window call gate is complete, this remains unresolved evidence rather than proof that no call occurred.",
    recordType: "allocation_pair",
    evidenceKey: "allocationPairs",
    includeLocalAllocationIdentifiers: true,
    predicate: (row) => row.callObservationStatus === "no_matching_call_observed"
  },
  "performance.approvedOrders": {
    title: "Approved Orders In Period",
    description: "Local manager approved-order evidence from the governed all-approved-sales population after personnel exclusions.",
    recordType: "approved_sale",
    evidenceKey: "approvedSales"
  },
  "performance.linkedSales": {
    title: "Selected-Week Allocation-Linked Approved Orders",
    description: "Approved orders with an exact customer-recipient match in the selected weekly allocation log.",
    recordType: "approved_sale",
    evidenceKey: "approvedSales",
    predicate: (row) => row.weeklyAllocationMatchStatus === "matched_in_selected_week"
  },
  "performance.salesHeatmap": {
    title: "Sales Activity Heatmap Evidence",
    description: "Approved orders behind a selected governed lead-classification and approval-date cell. Acquisition channel and geography are not inferred.",
    recordType: "approved_sale",
    evidenceKey: "approvedSales"
  },
  "performance.exactAllocationLink": {
    title: "Authoritative Pre-Sale Allocation Proof",
    description: "The approved order and selected exact actual-seller allocation from complete governed Carma history.",
    recordType: "historical_allocation_link",
    evidenceKey: "historicalAllocationLinks"
  },
  "performance.weeklyAllocationLink": {
    title: "Exact Weekly Allocation Proof",
    description: "The approved order and exact customer-ID plus full-seller match from the configured weekly allocation export, sent before approval.",
    recordType: "weekly_allocation_link",
    evidenceKey: "weeklyAllocationLinks"
  }
});

function buildPerformanceDrilldown(report = {}, query = {}) {
  const metric = clean(query.metric);
  const definition = PERFORMANCE_DRILLDOWN_DEFINITIONS[metric];
  if (!definition) {
    return {
      schemaVersion: "performance_drilldown.v1",
      available: false,
      status: "unknown_metric",
      code: "PERFORMANCE_DRILLDOWN_METRIC_UNKNOWN",
      metric,
      title: "Performance drill-down unavailable",
      description: "The requested Performance metric is not supported.",
      kind: "performanceAggregate",
      recordType: "",
      count: 0,
      rows: [],
      excludedFields: []
    };
  }
  const governedUncalled = metric === "performance.noCallObserved" && report.dataQuality?.callCoverageComplete === true;
  const definitionTitle = governedUncalled ? "Leads Uncalled Within Reporting Window" : definition.title;
  const definitionDescription = governedUncalled
    ? "Company-supplied leads with no exact customer-recipient call recorded inside the complete governed reporting window. Business name and customer ID are included for local auditing."
    : definition.description;
  if (!report.available || !report._evidence) {
    return {
      schemaVersion: "performance_drilldown.v1",
      available: false,
      status: "report_unavailable",
      code: report.code || "PERFORMANCE_DRILLDOWN_REPORT_UNAVAILABLE",
      metric,
      title: definitionTitle,
      description: report.error || definitionDescription,
      kind: "performanceAggregate",
      recordType: definition.recordType,
      period: report.period,
      availablePeriod: report.availablePeriod,
      count: 0,
      rows: [],
      excludedFields: []
    };
  }
  const filters = {
    source: clean(query.source),
    acquisitionSource: clean(query.acquisitionSource),
    salesperson: clean(query.salesperson || query.seller),
    manager: clean(query.manager),
    approvalDate: clean(query.approvalDate || query.date),
    sentDate: clean(query.sentDate),
    classification: clean(query.classification || query.sourceClassification),
    leadAgeBucket: clean(query.leadAgeBucket || query.ageBucket),
    callObservationStatus: clean(query.callObservationStatus || query.callStatus),
    conversionStatus: clean(query.conversionStatus),
    allocationFrequency: clean(query.allocationFrequency || query.frequency),
    orderNumber: clean(query.orderNumber || query.orderId || query.invoiceNumber)
  };
  const managerSalespeople = new Set((report.comparison?.rows || [])
    .filter((row) => filters.manager && (row.managers || [row.manager]).includes(filters.manager))
    .map((row) => row.salesperson));
  let rows = [...(report._evidence[definition.evidenceKey] || [])];
  if (definition.predicate) rows = rows.filter(definition.predicate);
  rows = rows.filter((row) => {
    if (filters.source && row.source !== filters.source && row.allocationSource !== filters.source) return false;
    if (filters.acquisitionSource && row.acquisitionSource !== filters.acquisitionSource) return false;
    if (filters.orderNumber && row.orderNumber !== filters.orderNumber) return false;
    if (
      filters.salesperson
      && row.salesperson !== filters.salesperson
      && row.seller !== filters.salesperson
      && !(row.recipients || []).includes(filters.salesperson)
    ) return false;
    if (filters.manager) {
      const directManagerMatch = row.manager === filters.manager || row.allocationManager === filters.manager;
      const teamMemberMatch = managerSalespeople.has(row.salesperson)
        || managerSalespeople.has(row.seller)
        || (row.recipients || []).some((recipient) => managerSalespeople.has(recipient));
      if (!directManagerMatch && !teamMemberMatch) return false;
    }
    if (filters.approvalDate && row.approvalDate !== filters.approvalDate) return false;
    if (
      filters.sentDate
      && row.sentDate !== filters.sentDate
      && row.firstSentDate !== filters.sentDate
      && row.repeatSentDate !== filters.sentDate
    ) return false;
    if (filters.classification && row.leadSourceClassification !== filters.classification) return false;
    if (filters.leadAgeBucket && row.leadAgeBucket !== filters.leadAgeBucket) return false;
    if (filters.callObservationStatus && row.callObservationStatus !== filters.callObservationStatus) return false;
    if (filters.conversionStatus && row.observedConversionStatus !== filters.conversionStatus) return false;
    if (filters.allocationFrequency) {
      const frequency = Number(row.sentEventCount || 0);
      if (filters.allocationFrequency === "4_plus" ? frequency < 4 : frequency !== Number(filters.allocationFrequency)) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => (
    String(b.approvalDate || b.repeatSentDate || b.sentDate || b.firstSentDate || "").localeCompare(
      String(a.approvalDate || a.repeatSentDate || a.sentDate || a.firstSentDate || "")
    )
    || String(a.evidenceRef).localeCompare(String(b.evidenceRef))
  ));
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100) || 100));
  const offset = Math.max(0, Number(query.offset || 0) || 0);
  const includesLocalIdentifiers = definition.includeLocalAllocationIdentifiers === true
    || definition.recordType === "approved_sale"
    || definition.recordType === "historical_allocation_link"
    || definition.recordType === "weekly_allocation_link";
  const visibleRows = includesLocalIdentifiers
    ? rows
    : rows.map((row) => {
        const { customerId, companyName, ...privacySafeRow } = row;
        return privacySafeRow;
      });
  const aggregate = {
    count: rows.length,
    approvedValue: roundedMoney(rows.reduce((sum, row) => sum + Number(row.approvedValue || row.approvedSalesValue || 0), 0)),
    allocatedLeadSales: rows.filter((row) => row.leadSourceClassification === COMPANY_SOURCED).length,
    selfSourcedSales: rows.filter((row) => row.leadSourceClassification === SELF_SOURCED).length,
    attributionWithheldSales: rows.filter((row) => row.leadSourceClassification === "Attribution Withheld").length
  };
  Object.assign(aggregate, buildSourceAttributionCoverage({
    companySourcedSales: aggregate.allocatedLeadSales,
    selfSourcedSales: aggregate.selfSourcedSales,
    attributionWithheldSales: aggregate.attributionWithheldSales,
    totalSales: aggregate.count
  }));
  return {
    schemaVersion: "performance_drilldown.v1",
    available: true,
    status: "available",
    metric,
    returnView: clean(query.returnView),
    title: definitionTitle,
    description: definitionDescription,
    kind: "performanceAggregate",
    recordType: definition.recordType,
    authorityStatus: includesLocalIdentifiers
      ? "local_manager_identified_source_evidence"
      : "privacy_safe_source_evidence",
    aggregateOnly: false,
    privacyMode: includesLocalIdentifiers
      ? "local_manager_identifiers"
      : "opaque_evidence_references",
    period: report.period,
    availablePeriod: report.availablePeriod,
    filters,
    reconciliation: clean(query.reconcile) === "allocatedLeadShare"
      ? {
          metric: "allocatedLeadShare",
          numerator: aggregate.allocatedLeadSales,
          denominator: aggregate.classifiedSales,
          value: aggregate.allocatedLeadShare,
          attributionWithheldSales: aggregate.attributionWithheldSales,
          sourceCoverage: aggregate.sourceCoverage,
          unresolvedShare: aggregate.unresolvedShare,
          lowerBound: aggregate.allocatedLeadShareLowerBound,
          upperBound: aggregate.allocatedLeadShareUpperBound,
          comparable: aggregate.sourceShareComparable,
          status: aggregate.sourceAttributionStatus
        }
      : null,
    aggregate,
    count: rows.length,
    limit,
    offset,
    displayedCount: visibleRows.slice(offset, offset + limit).length,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
    previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    rows: visibleRows.slice(offset, offset + limit),
    excludedFields: [
      "ContactID",
      "SalesPersonID",
      "AllocatedUserId",
      "phone",
      "address",
      "transcript",
      "notes",
      ...(!includesLocalIdentifiers ? [
        "CustomerID",
        "CompanyName",
        "AllocationItemID",
        "order_id",
        "customer_name"
      ] : [])
    ],
    limitations: [
      ...(includesLocalIdentifiers
        ? [definition.includeLocalAllocationIdentifiers
          ? "Local manager evidence includes the allocation business name and customer ID so the operational backlog can be audited. Keep this screen on loopback until authentication and role-based access control are implemented."
          : "Local manager evidence includes the Carma order number, business name and customer ID. Keep this screen on loopback until authentication and role-based access control are implemented."]
        : ["Opaque references identify rows only within this source evidence; raw customer, company, order and contact identifiers are not exposed."]),
      ...(definition.recordType === "historical_allocation_link"
        ? ["This classification proof is selected from complete governed Carma history: the exact actual seller had an allocation that started before approval. It does not prove that the allocation or a call caused the sale."]
        : []),
      ...(definition.recordType === "weekly_allocation_link"
        ? ["A positive exact customer-ID and full-seller match sent before approval can prove Company Sourced. A missing weekly match never downgrades governed Company Sourced evidence or independently proves Self Sourced."]
        : []),
      "Approved value is a CRM approved amount, not payment, profit or recognised revenue.",
      ...(metric === "performance.noCallObserved"
        ? [governedUncalled
          ? "Leads Uncalled is limited to the complete governed reporting window; it does not assert behavior outside that window."
          : "A missing exact recorded call in incomplete evidence is not an authoritative not-called finding."]
        : [])
    ]
  };
}

function publicPerformanceCohorts(report, query = {}) {
  const minimum = Math.max(
    MINIMUM_COMPARISON_ALLOCATIONS,
    Math.min(10000, Number(query.minimumAllocations || report.comparison?.minimumAllocations || MINIMUM_COMPARISON_ALLOCATIONS) || MINIMUM_COMPARISON_ALLOCATIONS)
  );
  const manager = clean(query.manager);
  const salesperson = clean(query.salesperson);
  const status = clean(query.status);
  const rows = (report.comparison?.rows || []).filter((row) => {
    if (manager && !(row.managers || [row.manager]).includes(manager)) return false;
    if (salesperson && row.salesperson !== salesperson) return false;
    if (status && row.comparisonStatus !== status) return false;
    return true;
  }).map((row) => {
    const displayEligible = row.sentAllocationEvents >= minimum;
    return {
      ...row,
      comparisonEligible: displayEligible,
      comparisonStatus: displayEligible ? "full_sample" : "low_sample",
      displayEligible
    };
  });
  return {
    ...report,
    comparison: {
      ...report.comparison,
      minimumAllocations: minimum,
      rows,
      fullSampleRows: rows.filter((row) => row.displayEligible).length
    },
    query: { manager, salesperson, status, minimumAllocations: minimum, matchingRows: rows.length }
  };
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  MINIMUM_COMPARISON_ALLOCATIONS,
  REQUIRED_ALLOCATION_COLUMNS,
  REQUIRED_CALL_COLUMNS,
  PERFORMANCE_DRILLDOWN_DEFINITIONS,
  buildPerformanceDrilldown,
  buildPerformanceCohortsReport,
  buildPerformanceCohortsFromContext,
  emptyPerformanceReport,
  loadPerformanceCohorts,
  loadPerformanceSourceContext,
  normalizePerson,
  publicPerformanceCohorts,
  resolvePerformanceConfig
};
