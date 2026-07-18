"use strict";

const { clean, isMissing, toInt } = require("./transcriptEvaluator");
const { sourceAttributionFor } = require("./sourceQuality");

const LONG_HELD_THRESHOLDS = [90, 365];

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function recordKeyFor(item) {
  const row = item.row || {};
  const customerId = clean(row.customer_id);
  if (!isMissing(customerId)) return `customer:${customerId}`;
  const contactId = clean(row.ContactId);
  if (!isMissing(contactId)) return `contact:${contactId}`;
  return `call:${clean(row.call_id) || "unknown"}`;
}

function buildSelfSourcingAttributionModel(items = [], options = {}) {
  const newBusiness = items.filter((item) => {
    const orderCount = toInt(item.row?.OrderCount);
    return (orderCount === null ? 0 : orderCount) === 0;
  });
  const totalNewBusinessCalls = newBusiness.length;
  const totals = {
    newBusinessCalls: totalNewBusinessCalls,
    knownRecordAgeCalls: 0,
    unknownRecordAgeCalls: 0,
    confirmedImportedCalls: 0,
    salespersonCreatedCalls: 0
  };
  const thresholdCounts = new Map(LONG_HELD_THRESHOLDS.map((threshold) => [threshold, {
    thresholdDays: threshold,
    longHeldRecordCalls: 0,
    confirmedLegacyImportCalls: 0,
    salespersonCreatedLongHeldCalls: 0,
    longHeldRecordKeys: new Set(),
    confirmedLegacyImportKeys: new Set(),
    salespersonCreatedLongHeldKeys: new Set()
  }]));
  const legacySourceGroups = new Map();

  newBusiness.forEach((item) => {
    const attribution = item.sourceAttribution || sourceAttributionFor(item.row, item.dateTime);
    const recordKey = recordKeyFor(item);
    if (attribution.daysSinceRecord === null) totals.unknownRecordAgeCalls += 1;
    else totals.knownRecordAgeCalls += 1;
    if (attribution.daysSinceImport !== null) totals.confirmedImportedCalls += 1;
    if (attribution.customerCreatedByType === "SP" && attribution.daysSinceImport === null) totals.salespersonCreatedCalls += 1;

    LONG_HELD_THRESHOLDS.forEach((threshold) => {
      const group = thresholdCounts.get(threshold);
      if (attribution.daysSinceRecord !== null && attribution.daysSinceRecord > threshold) {
        group.longHeldRecordCalls += 1;
        group.longHeldRecordKeys.add(recordKey);
      }
      if (attribution.daysSinceImport !== null && attribution.daysSinceImport > threshold) {
        group.confirmedLegacyImportCalls += 1;
        group.confirmedLegacyImportKeys.add(recordKey);
        if (threshold === 90) {
          const source = attribution.customerImportSourceRaw || "Import date present; source blank";
          if (!legacySourceGroups.has(source)) legacySourceGroups.set(source, { source, calls: 0, keys: new Set() });
          const sourceGroup = legacySourceGroups.get(source);
          sourceGroup.calls += 1;
          sourceGroup.keys.add(recordKey);
        }
      }
      if (attribution.customerCreatedByType === "SP" && attribution.daysSinceImport === null && attribution.daysSinceCreated !== null && attribution.daysSinceCreated > threshold) {
        group.salespersonCreatedLongHeldCalls += 1;
        group.salespersonCreatedLongHeldKeys.add(recordKey);
      }
    });
  });

  const thresholds = LONG_HELD_THRESHOLDS.map((threshold) => {
    const group = thresholdCounts.get(threshold);
    return {
      thresholdDays: threshold,
      longHeldRecordCalls: group.longHeldRecordCalls,
      longHeldRecordRate: percent(group.longHeldRecordCalls, totalNewBusinessCalls),
      longHeldDistinctRecords: group.longHeldRecordKeys.size,
      confirmedLegacyImportCalls: group.confirmedLegacyImportCalls,
      confirmedLegacyImportRate: percent(group.confirmedLegacyImportCalls, totalNewBusinessCalls),
      confirmedLegacyImportDistinctRecords: group.confirmedLegacyImportKeys.size,
      salespersonCreatedLongHeldCalls: group.salespersonCreatedLongHeldCalls,
      salespersonCreatedLongHeldRate: percent(group.salespersonCreatedLongHeldCalls, totalNewBusinessCalls),
      salespersonCreatedLongHeldDistinctRecords: group.salespersonCreatedLongHeldKeys.size
    };
  });
  const ninetyDay = thresholds.find((row) => row.thresholdDays === 90) || thresholds[0];
  const legacyImportSources = Array.from(legacySourceGroups.values())
    .map((group) => ({
      source: group.source,
      legacyImportCalls: group.calls,
      legacyImportDistinctRecords: group.keys.size,
      shareOfConfirmedLegacyImports: percent(group.calls, ninetyDay?.confirmedLegacyImportCalls || 0)
    }))
    .sort((a, b) => b.legacyImportCalls - a.legacyImportCalls || a.source.localeCompare(b.source));

  return {
    schemaVersion: "sales_dashboard_self_sourcing_attribution.v1",
    title: "Self-Sourcing Attribution Audit",
    scope: "New Business calls only (OrderCount is blank, NULL, or zero).",
    totals: {
      ...totals,
      knownRecordAgeRate: percent(totals.knownRecordAgeCalls, totalNewBusinessCalls),
      unknownRecordAgeRate: percent(totals.unknownRecordAgeCalls, totalNewBusinessCalls),
      confirmedImportedRate: percent(totals.confirmedImportedCalls, totalNewBusinessCalls),
      salespersonCreatedRate: percent(totals.salespersonCreatedCalls, totalNewBusinessCalls)
    },
    thresholds,
    legacyImportSources,
    conclusion: {
      longHeldRecordsAreMajority: Boolean(ninetyDay && ninetyDay.longHeldRecordRate > 50),
      statement: ninetyDay?.longHeldRecordRate > 50
        ? `More than half of New Business calls were to records already older than 90 days at call time.`
        : `Long-held records did not make up more than half of New Business calls in this import.`,
      attributionStatement: `A confirmed historical import date supports an attribution-review candidate; it does not prove that a salesperson found the number online or that any sale should be reattributed.`
    },
    limitations: [
      "Record age uses CustomerImportDate first and CustomerCreateDate only when no valid import date exists.",
      "A record being old, imported, or salesperson-created is not proof of online self-sourcing, neglect, a sale, or revenue ownership.",
      "This report does not use phone values, CRM activity history, value, order revenue, or legacy disposition/note fields.",
      "Crystal Report attachments are not a supported ingestion format; the report continues to work from the active call export if they are unavailable or change."
    ],
    attachmentStatus: options.attachmentStatus || "not_used"
  };
}

module.exports = { LONG_HELD_THRESHOLDS, buildSelfSourcingAttributionModel };
