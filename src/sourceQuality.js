"use strict";

const { clean, isMissing, toInt } = require("./transcriptEvaluator");
const { businessRelationshipFor } = require("./businessRelationship");

const SOURCE_AGE_THRESHOLDS = [7, 30, 60, 90, 180, 365];

function orderCountFor(row) {
  const value = toInt(row.OrderCount);
  return value === null ? 0 : value;
}

function businessSegmentForRow(row) {
  return businessRelationshipFor(row).segment;
}

function parseCustomerDate(value) {
  const text = clean(value);
  if (isMissing(text)) return null;

  const auDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (auDate) {
    const [, day, month, year] = auDate;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() === Number(month) - 1 &&
      parsed.getUTCDate() === Number(day)
    ) {
      return parsed;
    }
    return null;
  }

  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const parsed = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function daysSince(sourceDate, callDateTime) {
  if (!sourceDate || !callDateTime) return null;
  const diff = callDateTime.getTime() - sourceDate.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function ageBucket(days) {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return "No valid date";
  const value = Number(days);
  if (value <= 7) return "0-7 days";
  if (value <= 30) return "8-30 days";
  if (value <= 90) return "31-90 days";
  if (value <= 180) return "91-180 days";
  if (value <= 365) return "181-365 days";
  return "365+ days";
}

function ageBucketSort(bucket) {
  return {
    "0-7 days": 0,
    "8-30 days": 1,
    "31-90 days": 2,
    "91-180 days": 3,
    "181-365 days": 4,
    "365+ days": 5,
    "No valid date": 6
  }[bucket] ?? 99;
}

function normalizeCreatedByType(value) {
  const text = clean(value).toUpperCase();
  if (text === "LG") return "LG";
  if (text === "SP") return "SP";
  if (isMissing(text)) return "";
  return text;
}

function createdByTypeLabel(value) {
  const type = normalizeCreatedByType(value);
  if (type === "LG") return "Lead Generator";
  if (type === "SP") return "Salesperson";
  return type || "Unknown";
}

function sourceCategoryFor(row) {
  const rawSource = clean(row.CustomerImportSource);
  if (!isMissing(rawSource)) {
    return {
      source: rawSource,
      rawSource,
      inferred: false,
      inferenceReason: "CustomerImportSource"
    };
  }

  const customerId = clean(row.customer_id);
  if (isMissing(customerId)) {
    return {
      source: "Self Sourced",
      rawSource: "",
      inferred: true,
      inferenceReason: "Missing CustomerImportSource and customer_id"
    };
  }

  const createdByType = normalizeCreatedByType(row.CustomerCreatedByType);
  if (createdByType === "LG") {
    return {
      source: "Facebook",
      rawSource: "",
      inferred: true,
      inferenceReason: "Missing CustomerImportSource with LG creator type"
    };
  }

  return {
    source: "Self Sourced",
    rawSource: "",
    inferred: true,
    inferenceReason: createdByType === "SP"
      ? "Missing CustomerImportSource with SP creator type"
      : "Missing CustomerImportSource without LG/SP creator type"
  };
}

function sourceNameFor(row) {
  return sourceCategoryFor(row).source;
}

function regionNameFor(row) {
  const region = clean(row.CallRegion);
  return isMissing(region) ? "Australia" : region;
}

function dateIso(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function sourceAttributionFor(row, callDateTime) {
  const importDate = parseCustomerDate(row.CustomerImportDate);
  const createDate = parseCustomerDate(row.CustomerCreateDate);
  const sourceCategory = sourceCategoryFor(row);
  const customerImportSource = sourceCategory.source;
  const customerCreatedBy = isMissing(row.CustomerCreatedBy) ? "" : clean(row.CustomerCreatedBy);
  const customerCreatedByType = normalizeCreatedByType(row.CustomerCreatedByType);
  const customerCreatedByTypeLabel = createdByTypeLabel(customerCreatedByType);
  const daysSinceImport = daysSince(importDate, callDateTime);
  const daysSinceCreated = daysSince(createDate, callDateTime);
  const daysSinceRecord = daysSinceImport !== null ? daysSinceImport : daysSinceCreated;
  const recordAgeBasis = daysSinceImport !== null
    ? "import_date"
    : daysSinceCreated !== null
      ? "create_date"
      : "none";
  const recordAgeBasisLabel = recordAgeBasis === "import_date"
    ? "Imported"
    : recordAgeBasis === "create_date"
      ? customerCreatedByType
        ? `Created by ${customerCreatedByType}`
        : "Created manually"
      : "No valid date";

  return {
    customerImportSource,
    customerImportSourceRaw: sourceCategory.rawSource,
    customerImportSourceInferred: sourceCategory.inferred,
    customerImportSourceInferenceReason: sourceCategory.inferenceReason,
    customerImportDate: isMissing(row.CustomerImportDate) ? "" : clean(row.CustomerImportDate),
    customerImportDateIso: dateIso(importDate),
    customerCreatedBy,
    customerCreatedByType,
    customerCreatedByTypeLabel,
    customerCreateDate: isMissing(row.CustomerCreateDate) ? "" : clean(row.CustomerCreateDate),
    customerCreateDateIso: dateIso(createDate),
    daysSinceImport,
    daysSinceCreated,
    daysSinceRecord,
    recordAgeBasis,
    recordAgeBasisLabel,
    importAgeBucket: ageBucket(daysSinceImport),
    createAgeBucket: ageBucket(daysSinceCreated),
    recordAgeBucket: ageBucket(daysSinceRecord),
    hasBulkSource: !isMissing(row.CustomerImportSource) || Boolean(importDate),
    hasManualCreator: Boolean(customerCreatedBy || customerCreatedByType || createDate)
  };
}

module.exports = {
  SOURCE_AGE_THRESHOLDS,
  ageBucket,
  ageBucketSort,
  businessSegmentForRow,
  createdByTypeLabel,
  orderCountFor,
  parseCustomerDate,
  regionNameFor,
  sourceCategoryFor,
  sourceAttributionFor,
  sourceNameFor
};
