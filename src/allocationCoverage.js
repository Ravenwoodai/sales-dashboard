"use strict";

const path = require("path");
const { readTabularFile } = require("./sourceFile");
const { clean, isMissing, toInt } = require("./transcriptEvaluator");

const REQUIRED_ALLOCATION_COLUMNS = [
  "LEAD CAMPAIGN",
  "QTY ALLOCATED",
  "QTY ACTIONED",
  "QTY REMAINING",
  "DATE",
  "SALES MANAGER",
  "SALESPERSON",
  "TYPE"
];

const STABLE_LEAD_FIELDS = ["customer_id", "AllocatedLeadID", "ContactId", "FoundContactID", "FoundCustomerID"];
const NO_CONTACT_CLASSIFICATIONS = new Set(["no_answer", "system_audio", "voicemail"]);

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 10;
}

function numberValue(value) {
  const parsed = toInt(value);
  return parsed === null ? 0 : parsed;
}

function monthIndex(value) {
  return {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  }[String(value || "").toLowerCase()];
}

function dateIso(value) {
  const text = clean(value);
  if (!text) return "";

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const [, monthName, day, year] = match;
    const month = monthIndex(monthName);
    if (month !== undefined) return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const parsed = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  return text;
}

function typeSegment(value) {
  const text = clean(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (["warm", "warm_business", "existing", "previous_sales", "previous"].includes(text)) return "warm";
  if (["new", "new_business", "nb"].includes(text)) return "new";
  return text || "unknown";
}

function typeLabel(segment) {
  if (segment === "warm") return "Warm";
  if (segment === "new") return "New Business";
  return segment ? segment.replace(/_/g, " ") : "Unknown";
}

function businessSegmentFor(row) {
  const orderCount = toInt(row.OrderCount);
  return orderCount && orderCount > 0 ? "warm" : "new";
}

function stableLeadFor(row) {
  for (const field of STABLE_LEAD_FIELDS) {
    const value = clean(row[field]);
    if (!isMissing(value)) return `${field}:${value}`;
  }
  return "";
}

function itemDate(item) {
  if (item.dateTime) return item.dateTime.toISOString().slice(0, 10);
  return dateIso(item.row.call_date);
}

function salespersonForItem(item) {
  return clean(item.row.Salesperson) || "Unknown";
}

function isNoContact(item) {
  return NO_CONTACT_CLASSIFICATIONS.has(item.evaluation.contact.classification);
}

function seedAllocationStats(key, extras = {}) {
  return {
    key,
    allocationRows: 0,
    allocated: 0,
    actioned: 0,
    remaining: 0,
    arithmeticMismatchRows: 0,
    ...extras
  };
}

function addAllocation(stats, row) {
  stats.allocationRows += 1;
  stats.allocated += row.allocated;
  stats.actioned += row.actioned;
  stats.remaining += row.remaining;
  if (row.allocated !== row.actioned + row.remaining) stats.arithmeticMismatchRows += 1;
}

function finalizeAllocationStats(stats) {
  return {
    ...stats,
    actionedRate: percent(stats.actioned, stats.allocated),
    remainingRate: percent(stats.remaining, stats.allocated)
  };
}

function seedCallStats(key, extras = {}) {
  return {
    key,
    callRows: 0,
    transcriptAvailable: 0,
    probableLiveHuman: 0,
    meaningfulConversation: 0,
    actionableConversation: 0,
    followUpRequired: 0,
    riskReviews: 0,
    totalDurationSeconds: 0,
    callsWithoutStableLead: 0,
    stableLeadDaysWorked: 0,
    noContactLeadDays: 0,
    singleAttemptNoContact: 0,
    ...extras
  };
}

function addCall(stats, item) {
  stats.callRows += 1;
  if (item.evaluation.transcript.available) stats.transcriptAvailable += 1;
  if (item.evaluation.contact.probableLiveHuman) stats.probableLiveHuman += 1;
  if (item.evaluation.contact.meaningfulConversation) stats.meaningfulConversation += 1;
  if (item.evaluation.contact.actionableConversation) stats.actionableConversation += 1;
  if (item.evaluation.opportunity.followUpRequired) stats.followUpRequired += 1;
  if (item.evaluation.risk.reviewRequired) stats.riskReviews += 1;
  stats.totalDurationSeconds += Number(item.evaluation.durationSeconds || 0);
}

function finalizeCallStats(stats) {
  return {
    ...stats,
    transcriptCoverageRate: percent(stats.transcriptAvailable, stats.callRows),
    probableLiveHuman: null,
    meaningfulConversation: null,
    actionableConversation: null,
    followUpRequired: null,
    probableLiveHumanRate: null,
    meaningfulConversationRate: null,
    actionableConversationRate: null,
    followUpRequiredRate: null,
    singleAttemptNoContactRate: percent(stats.singleAttemptNoContact, stats.stableLeadDaysWorked),
    averageDurationSeconds: stats.callRows ? Math.round(stats.totalDurationSeconds / stats.callRows) : 0
  };
}

function buildCallStatsBy(items, keyFn, extraFn = () => ({})) {
  const groups = new Map();
  const leadDayGroups = new Map();

  function getGroup(key, item) {
    const safeKey = key || "Unknown";
    if (!groups.has(safeKey)) groups.set(safeKey, seedCallStats(safeKey, extraFn(item, safeKey)));
    return groups.get(safeKey);
  }

  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    const stats = getGroup(key, item);
    addCall(stats, item);
    const stableLead = stableLeadFor(item.row);
    if (!stableLead) {
      stats.callsWithoutStableLead += 1;
      return;
    }
    const leadDayKey = `${key}|${itemDate(item)}|${stableLead}`;
    if (!leadDayGroups.has(leadDayKey)) {
      leadDayGroups.set(leadDayKey, { key, items: [] });
    }
    leadDayGroups.get(leadDayKey).items.push(item);
  });

  leadDayGroups.forEach((group) => {
    const stats = getGroup(group.key, group.items[0]);
    stats.stableLeadDaysWorked += 1;
    if (group.items.every(isNoContact)) {
      stats.noContactLeadDays += 1;
      if (group.items.length === 1) stats.singleAttemptNoContact += 1;
    }
  });

  return new Map(Array.from(groups.entries()).map(([key, stats]) => [key, finalizeCallStats(stats)]));
}

function aggregateAllocations(rows, keyFn, extraFn = () => ({})) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, seedAllocationStats(key, extraFn(row, key)));
    addAllocation(groups.get(key), row);
  });
  return new Map(Array.from(groups.entries()).map(([key, stats]) => [key, finalizeAllocationStats(stats)]));
}

function combineAllocationAndCall(allocationStats = {}, callStats = {}) {
  const allocated = Number(allocationStats.allocated || 0);
  const actioned = Number(allocationStats.actioned || 0);
  const remaining = Number(allocationStats.remaining || 0);
  const stableLeadDaysWorked = Number(callStats.stableLeadDaysWorked || 0);
  const callRows = Number(callStats.callRows || 0);
  const joinStatus = allocated && callRows
    ? "matched"
    : allocated
      ? "allocation_only"
      : callRows
        ? "calls_only"
        : "empty";

  return {
    ...allocationStats,
    ...callStats,
    allocated,
    actioned,
    remaining,
    callRows,
    stableLeadDaysWorked,
    actionedRate: percent(actioned, allocated),
    remainingRate: percent(remaining, allocated),
    observedLeadDayCoverageRate: percent(stableLeadDaysWorked, allocated),
    callsPerObservedLeadDay: stableLeadDaysWorked ? Math.round((callRows / stableLeadDaysWorked) * 100) / 100 : 0,
    observedVsActionedDelta: stableLeadDaysWorked - actioned,
    observedVsAllocatedDelta: stableLeadDaysWorked - allocated,
    joinStatus
  };
}

function normalizeAllocationRows(rows) {
  return (rows || [])
    .map((row, index) => {
      if ("campaign" in row && "allocated" in row && "actioned" in row && "remaining" in row) {
        const segment = row.segment || typeSegment(row.type || row.rawType);
        const record = {
          rowNumber: row.rowNumber || row.__rowNumber || index + 2,
          campaign: clean(row.campaign) || "Unknown campaign",
          allocated: numberValue(row.allocated),
          actioned: numberValue(row.actioned),
          remaining: numberValue(row.remaining),
          date: dateIso(row.date),
          manager: clean(row.manager) || "Unknown manager",
          salesperson: clean(row.salesperson) || "Unknown",
          type: row.type || typeLabel(segment),
          segment,
          rawType: clean(row.rawType || row.type)
        };
        record.key = `${record.salesperson}|${record.date}|${record.segment}`;
        return record;
      }

      const campaign = clean(row["LEAD CAMPAIGN"]);
      const salesperson = clean(row.SALESPERSON);
      const manager = clean(row["SALES MANAGER"]);
      const segment = typeSegment(row.TYPE);
      const record = {
        rowNumber: row.__rowNumber || index + 2,
        campaign: campaign || "Unknown campaign",
        allocated: numberValue(row["QTY ALLOCATED"]),
        actioned: numberValue(row["QTY ACTIONED"]),
        remaining: numberValue(row["QTY REMAINING"]),
        date: dateIso(row.DATE),
        manager: manager || "Unknown manager",
        salesperson: salesperson || "Unknown",
        type: typeLabel(segment),
        segment,
        rawType: clean(row.TYPE)
      };
      record.key = `${record.salesperson}|${record.date}|${record.segment}`;
      return record;
    })
    .filter((row) => row.campaign || row.allocated || row.actioned || row.remaining || row.date || row.salesperson);
}

function readAllocationFile(filePath) {
  const source = readTabularFile(filePath);
  const missingColumns = REQUIRED_ALLOCATION_COLUMNS.filter((column) => !source.columns.includes(column));
  if (missingColumns.length) {
    throw new Error(`Allocation file is missing required columns: ${missingColumns.join(", ")}`);
  }
  return {
    sourcePath: filePath,
    sourceName: path.basename(filePath),
    sourceType: source.sourceType,
    sheetName: source.sheetName,
    columns: source.columns,
    rows: normalizeAllocationRows(source.rows)
  };
}

function rowsFromMap(map, sortFn) {
  const rows = Array.from(map.values());
  return sortFn ? rows.sort(sortFn) : rows;
}

function buildAllocationCoverage(items = [], options = {}) {
  const metadata = options.metadata || {};
  const error = metadata.error || options.error || "";
  const configured = Boolean(metadata.sourcePath || metadata.sourceName || (options.rows || []).length || error);
  const normalizedRows = Array.isArray(options.rows) ? normalizeAllocationRows(options.rows) : [];
  const loaded = normalizedRows.length > 0 && !error;

  if (!loaded) {
    return {
      schemaVersion: "allocation_coverage.v1",
      configured,
      loaded: false,
      sourceName: metadata.sourceName || "",
      sheetName: metadata.sheetName || "",
      generatedAt: new Date().toISOString(),
      error,
      definitions: {
        joinGrain: "Allocation rows join to call records only by date + salesperson + type.",
        campaignAttribution: "Campaign rows are allocation-side totals only until a shared campaign/list ID or stable lead ID is provided."
      },
      totals: {},
      typeRows: [],
      dateRows: [],
      managerRows: [],
      salespersonRows: [],
      campaignRows: [],
      reconciliationRows: [],
      allocationOnlyRows: [],
      callsOnlyRows: []
    };
  }

  const allocationTotals = normalizedRows.reduce((stats, row) => {
    addAllocation(stats, row);
    return stats;
  }, seedAllocationStats("All allocations"));
  const finalizedAllocationTotals = finalizeAllocationStats(allocationTotals);

  const callAll = buildCallStatsBy(items, () => "all").get("all") || finalizeCallStats(seedCallStats("all"));
  const callsByType = buildCallStatsBy(
    items,
    (item) => businessSegmentFor(item.row),
    (item, key) => ({ segment: key, type: typeLabel(key) })
  );
  const callsByDate = buildCallStatsBy(items, itemDate, (item, key) => ({ date: key }));
  const callsBySalesperson = buildCallStatsBy(items, salespersonForItem, (item, key) => ({ salesperson: key }));
  const callsBySalespersonDateType = buildCallStatsBy(
    items,
    (item) => `${salespersonForItem(item)}|${itemDate(item)}|${businessSegmentFor(item.row)}`,
    (item) => ({
      salesperson: salespersonForItem(item),
      date: itemDate(item),
      segment: businessSegmentFor(item.row),
      type: typeLabel(businessSegmentFor(item.row))
    })
  );

  const allocationsByType = aggregateAllocations(normalizedRows, (row) => row.segment, (row) => ({ segment: row.segment, type: row.type }));
  const allocationsByDate = aggregateAllocations(normalizedRows, (row) => row.date, (row) => ({ date: row.date }));
  const allocationsByManager = aggregateAllocations(normalizedRows, (row) => row.manager, (row) => ({ manager: row.manager }));
  const allocationsBySalesperson = aggregateAllocations(normalizedRows, (row) => row.salesperson, (row) => ({ salesperson: row.salesperson }));
  const allocationsByCampaign = aggregateAllocations(normalizedRows, (row) => row.campaign, (row) => ({ campaign: row.campaign }));
  const allocationsBySalespersonDateType = aggregateAllocations(
    normalizedRows,
    (row) => row.key,
    (row) => ({ salesperson: row.salesperson, date: row.date, segment: row.segment, type: row.type })
  );

  const combinedKeys = new Set([...allocationsBySalespersonDateType.keys(), ...callsBySalespersonDateType.keys()]);
  const reconciliationRows = Array.from(combinedKeys).map((key) => combineAllocationAndCall(
    allocationsBySalespersonDateType.get(key) || seedAllocationStats(key),
    callsBySalespersonDateType.get(key) || seedCallStats(key)
  )).sort((a, b) => {
    const statusOrder = { allocation_only: 0, calls_only: 1, matched: 2, empty: 3 };
    return statusOrder[a.joinStatus] - statusOrder[b.joinStatus] ||
      b.remaining - a.remaining ||
      Math.abs(b.observedVsActionedDelta) - Math.abs(a.observedVsActionedDelta) ||
      a.salesperson.localeCompare(b.salesperson);
  });

  const totals = {
    ...finalizedAllocationTotals,
    allocationRows: normalizedRows.length,
    campaigns: new Set(normalizedRows.map((row) => row.campaign)).size,
    managers: new Set(normalizedRows.map((row) => row.manager)).size,
    salespeople: new Set(normalizedRows.map((row) => row.salesperson)).size,
    dates: new Set(normalizedRows.map((row) => row.date)).size,
    callRows: callAll.callRows,
    stableLeadDaysWorked: callAll.stableLeadDaysWorked,
    callsWithoutStableLead: callAll.callsWithoutStableLead,
    transcriptAvailable: callAll.transcriptAvailable,
    probableLiveHuman: callAll.probableLiveHuman,
    meaningfulConversation: callAll.meaningfulConversation,
    actionableConversation: callAll.actionableConversation,
    followUpRequired: callAll.followUpRequired,
    noContactLeadDays: callAll.noContactLeadDays,
    singleAttemptNoContact: callAll.singleAttemptNoContact,
    transcriptCoverageRate: callAll.transcriptCoverageRate,
    probableLiveHumanRate: callAll.probableLiveHumanRate,
    meaningfulConversationRate: callAll.meaningfulConversationRate,
    observedLeadDayCoverageRate: percent(callAll.stableLeadDaysWorked, finalizedAllocationTotals.allocated),
    callsPerObservedLeadDay: callAll.stableLeadDaysWorked ? Math.round((callAll.callRows / callAll.stableLeadDaysWorked) * 100) / 100 : 0,
    observedVsActionedDelta: callAll.stableLeadDaysWorked - finalizedAllocationTotals.actioned,
    matchedGroups: reconciliationRows.filter((row) => row.joinStatus === "matched").length,
    allocationOnlyGroups: reconciliationRows.filter((row) => row.joinStatus === "allocation_only").length,
    callsOnlyGroups: reconciliationRows.filter((row) => row.joinStatus === "calls_only").length
  };

  return {
    schemaVersion: "allocation_coverage.v1",
    configured: true,
    loaded: true,
    sourceName: metadata.sourceName || "Allocation import",
    sheetName: metadata.sheetName || "",
    generatedAt: new Date().toISOString(),
    error: "",
    definitions: {
      joinGrain: "Allocation rows join to call records only by date + salesperson + type.",
      campaignAttribution: "Campaign rows are allocation-side totals only until a shared campaign/list ID or stable lead ID is provided.",
      observedLeadDays: "Unique stable customer/lead/contact IDs worked by a salesperson on a day; redacted phone values are not used."
    },
    totals,
    typeRows: rowsFromMap(new Map(Array.from(allocationsByType.keys()).map((key) => [
      key,
      combineAllocationAndCall(allocationsByType.get(key), callsByType.get(key) || seedCallStats(key))
    ])), (a, b) => b.allocated - a.allocated),
    dateRows: rowsFromMap(new Map(Array.from(new Set([...allocationsByDate.keys(), ...callsByDate.keys()])).map((key) => [
      key,
      combineAllocationAndCall(allocationsByDate.get(key) || seedAllocationStats(key, { date: key }), callsByDate.get(key) || seedCallStats(key, { date: key }))
    ])), (a, b) => String(a.date).localeCompare(String(b.date))),
    managerRows: rowsFromMap(allocationsByManager, (a, b) => b.allocated - a.allocated),
    salespersonRows: rowsFromMap(new Map(Array.from(new Set([...allocationsBySalesperson.keys(), ...callsBySalesperson.keys()])).map((key) => [
      key,
      combineAllocationAndCall(allocationsBySalesperson.get(key) || seedAllocationStats(key, { salesperson: key }), callsBySalesperson.get(key) || seedCallStats(key, { salesperson: key }))
    ])), (a, b) => b.remaining - a.remaining || b.allocated - a.allocated || a.salesperson.localeCompare(b.salesperson)),
    campaignRows: rowsFromMap(allocationsByCampaign, (a, b) => b.allocated - a.allocated || a.campaign.localeCompare(b.campaign)),
    reconciliationRows,
    allocationOnlyRows: reconciliationRows.filter((row) => row.joinStatus === "allocation_only").slice(0, 25),
    callsOnlyRows: reconciliationRows.filter((row) => row.joinStatus === "calls_only").slice(0, 25)
  };
}

module.exports = {
  REQUIRED_ALLOCATION_COLUMNS,
  buildAllocationCoverage,
  dateIso,
  normalizeAllocationRows,
  readAllocationFile
};
