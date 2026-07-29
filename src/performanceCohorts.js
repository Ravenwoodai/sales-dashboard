"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { readTabularFile } = require("./sourceFile");

const REPORT_SCHEMA_VERSION = "performance_cohorts.v1";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "data", "store", "performance-cohorts.json");
const MINIMUM_COMPARISON_ALLOCATIONS = 100;
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

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePerson(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function dateIso(value, order = "day_first") {
  const text = clean(value);
  if (!text) return "";
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  const first = match[1].padStart(2, "0");
  const second = match[2].padStart(2, "0");
  return order === "month_first"
    ? `${match[3]}-${first}-${second}`
    : `${match[3]}-${second}-${first}`;
}

function timestamp(value, time = "", order = "day_first") {
  const date = dateIso(value, order);
  if (!date) return null;
  const parsed = new Date(`${date}T${clean(time) || "00:00:00"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 10000) / 100;
}

function moneyPer(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 100) / 100;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function withinPeriod(date, startDate, endDate) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : dateIso(date);
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
  const resolved = {
    configured: Boolean(
      options.performanceAllocationPath
      || flagValue("--performance-allocations", "--performance-allocation-log")
      || env.SALES_DASHBOARD_PERFORMANCE_ALLOCATIONS_PATH
      || local.allocationLogPath
    ),
    configPath,
    allocationLogPath: options.performanceAllocationPath
      || flagValue("--performance-allocations", "--performance-allocation-log")
      || env.SALES_DASHBOARD_PERFORMANCE_ALLOCATIONS_PATH
      || local.allocationLogPath
      || "",
    callCsvPath: options.performanceCallPath
      || flagValue("--performance-calls")
      || env.SALES_DASHBOARD_PERFORMANCE_CALLS_PATH
      || local.callCsvPath
      || "",
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
    historicalSnapshots: Array.isArray(options.performanceHistoricalSnapshots)
      ? options.performanceHistoricalSnapshots
      : Array.isArray(local.historicalSnapshots)
        ? local.historicalSnapshots
        : []
  };
  return {
    ...resolved,
    allocationLogPath: resolved.allocationLogPath ? path.resolve(resolved.allocationLogPath) : "",
    callCsvPath: resolved.callCsvPath ? path.resolve(resolved.callCsvPath) : ""
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
      eligibleRows: 0
    },
    totals: {},
    cohortWindows: [],
    history: [],
    dataQuality: {},
    definitions: {},
    limitations: []
  };
}

function seedPerson(person, manager = "") {
  return {
    salesperson: person,
    normalizedSalesperson: normalizePerson(person),
    manager: clean(manager) || "Unknown",
    sentAllocationEvents: 0,
    uniqueCustomers: 0,
    reallocationEvents: 0,
    approvedSales: 0,
    approvedSalesValue: 0,
    sameDayCalls: 0,
    callsWithin24Hours: 0,
    callsWithin72Hours: 0,
    customersCalledAfterAllocation: 0,
    _customers: new Map()
  };
}

function buildPerformanceCohortsReport({
  allocationRows = [],
  allocationColumns = [],
  callRows = [],
  callColumns = [],
  salesRows = [],
  startDate = "",
  endDate = "",
  historicalSnapshots = [],
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

  const allocationDates = allocationRows
    .map((row) => dateIso(row.DateSentToSalesperson_Date))
    .filter(Boolean)
    .sort();
  const reportStart = startDate || allocationDates[0] || "";
  const reportEnd = endDate || allocationDates[allocationDates.length - 1] || "";
  if (!reportStart || !reportEnd || reportEnd < reportStart) {
    return emptyPerformanceReport({
      configured,
      error: "Performance period is missing or invalid.",
      code: "PERFORMANCE_PERIOD_INVALID"
    });
  }

  const includedAllocationRows = allocationRows.filter((row) => (
    withinPeriod(row.DateSentToSalesperson_Date, reportStart, reportEnd)
  ));
  const logicalEvents = new Map();
  const allocationItemIds = new Map();
  let missingAllocationKeys = 0;
  includedAllocationRows.forEach((row) => {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName);
    if (!customerId || !salesperson) {
      missingAllocationKeys += 1;
      return;
    }
    const event = {
      customerId,
      salesperson,
      normalizedSalesperson: normalizePerson(salesperson),
      manager: clean(row.SalesManager) || "Unknown",
      sentAt: timestamp(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time),
      sentDate: dateIso(row.DateSentToSalesperson_Date),
      allocationName: clean(row.AllocationName) || "Unknown",
      allocationItemId: clean(row.AllocationItemID)
    };
    const logicalKey = [
      event.customerId,
      event.normalizedSalesperson,
      normalizePerson(event.manager),
      event.sentDate,
      clean(row.DateSentToSalesperson_Time),
      event.allocationName
    ].join("|");
    if (!logicalEvents.has(logicalKey)) logicalEvents.set(logicalKey, event);
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
      if (dated[0]) allocationByCustomerAndPerson.set(`${customerId}|${person.normalizedSalesperson}`, dated[0]);
    });
  });

  const uniqueCalls = new Map();
  callRows.forEach((row) => {
    const callId = clean(row.call_id);
    if (!callId || uniqueCalls.has(callId)) return;
    const callAt = timestamp(row.call_date, row.call_time, "month_first");
    const customerId = clean(row.customer_id);
    const normalizedSalesperson = normalizePerson(row.Salesperson);
    uniqueCalls.set(callId, {
      callId,
      customerId,
      normalizedSalesperson,
      salesperson: clean(row.Salesperson),
      userId: clean(row.UserID),
      callAt,
      callDate: dateIso(row.call_date, "month_first")
    });
  });
  const callsByCustomerAndPerson = new Map();
  uniqueCalls.forEach((call) => {
    if (!call.customerId || !call.normalizedSalesperson || !call.callAt) return;
    const key = `${call.customerId}|${call.normalizedSalesperson}`;
    if (!callsByCustomerAndPerson.has(key)) callsByCustomerAndPerson.set(key, []);
    callsByCustomerAndPerson.get(key).push(call);
  });
  callsByCustomerAndPerson.forEach((calls) => calls.sort((a, b) => a.callAt - b.callAt));

  allocationByCustomerAndPerson.forEach((allocation, key) => {
    const person = people.get(allocation.normalizedSalesperson);
    const calls = (callsByCustomerAndPerson.get(key) || []).filter((call) => call.callAt >= allocation.sentAt);
    if (!person || !calls.length) return;
    const first = calls[0];
    const elapsed = first.callAt - allocation.sentAt;
    person.customersCalledAfterAllocation += 1;
    if (first.callDate === allocation.sentDate) person.sameDayCalls += 1;
    if (elapsed <= 24 * 60 * 60 * 1000) person.callsWithin24Hours += 1;
    if (elapsed <= 72 * 60 * 60 * 1000) person.callsWithin72Hours += 1;
  });

  const ordersByCustomer = new Map();
  const sameWeekSales = salesRows.filter((order) => {
    const approvedAt = timestamp(order.sale_approved_at);
    if (!approvedAt) return false;
    if (!ordersByCustomer.has(clean(order.customer_id))) ordersByCustomer.set(clean(order.customer_id), []);
    ordersByCustomer.get(clean(order.customer_id)).push({ ...order, approvedAt });
    return withinPeriod(approvedAt, reportStart, reportEnd);
  });
  ordersByCustomer.forEach((orders) => orders.sort((a, b) => a.approvedAt - b.approvedAt));

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
  });

  const latestEvidenceDate = salesRows
    .map((order) => timestamp(order.sale_approved_at))
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || new Date(`${reportEnd}T23:59:59`);
  const cohortWindows = [30, 60, 90].map((days) => {
    let matureCustomers = 0;
    let convertedCustomers = 0;
    allocationByCustomerAndPerson.forEach((allocation) => {
      if (addDays(allocation.sentAt, days) > latestEvidenceDate) return;
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
      evidenceThrough: latestEvidenceDate.toISOString().slice(0, 10)
    };
  });

  const totalSent = Array.from(people.values()).reduce((sum, person) => sum + person.sentAllocationEvents, 0);
  const totalUniqueCustomers = Array.from(people.values()).reduce((sum, person) => sum + person.uniqueCustomers, 0);
  const totalSales = Array.from(people.values()).reduce((sum, person) => sum + person.approvedSales, 0);
  const totalValue = Array.from(people.values()).reduce((sum, person) => sum + person.approvedSalesValue, 0);
  const teamRate = percent(totalSales, totalSent);
  const rows = Array.from(people.values()).map((person) => {
    const comparisonEligible = person.sentAllocationEvents >= MINIMUM_COMPARISON_ALLOCATIONS;
    const rate = percent(person.approvedSales, person.sentAllocationEvents);
    const isRoleReview = /admin|administrator|test|unknown/i.test(person.salesperson);
    return {
      salesperson: person.salesperson,
      manager: person.manager,
      sentAllocationEvents: person.sentAllocationEvents,
      uniqueCustomers: person.uniqueCustomers,
      reallocationEvents: person.reallocationEvents,
      reallocationRate: percent(person.reallocationEvents, person.sentAllocationEvents),
      approvedSales: person.approvedSales,
      approvedSalesValue: Math.round(person.approvedSalesValue * 100) / 100,
      approvedSalesPerSentEvent: rate,
      approvedSalesPerUniqueCustomer: percent(person.approvedSales, person.uniqueCustomers),
      valuePerSentEvent: moneyPer(person.approvedSalesValue, person.sentAllocationEvents),
      customersCalledAfterAllocation: person.customersCalledAfterAllocation,
      observedCallCoverageRate: percent(person.customersCalledAfterAllocation, person.uniqueCustomers),
      sameDayCallRate: percent(person.sameDayCalls, person.uniqueCustomers),
      callWithin24HoursRate: percent(person.callsWithin24Hours, person.uniqueCustomers),
      callWithin72HoursRate: percent(person.callsWithin72Hours, person.uniqueCustomers),
      comparisonEligible,
      comparisonStatus: isRoleReview
        ? "role_review"
        : comparisonEligible
          ? "eligible"
          : "low_sample",
      relativeToTeam: rate === null || teamRate === null
        ? "not_available"
        : rate >= teamRate * 1.25
          ? "above_team_proxy"
          : rate <= teamRate * 0.75
            ? "below_team_proxy"
            : "near_team_proxy"
    };
  }).sort((a, b) => {
    if (a.comparisonStatus === "role_review" && b.comparisonStatus !== "role_review") return 1;
    if (b.comparisonStatus === "role_review" && a.comparisonStatus !== "role_review") return -1;
    if (a.comparisonEligible !== b.comparisonEligible) return a.comparisonEligible ? -1 : 1;
    return Number(b.approvedSalesPerSentEvent || 0) - Number(a.approvedSalesPerSentEvent || 0)
      || b.sentAllocationEvents - a.sentAllocationEvents
      || a.salesperson.localeCompare(b.salesperson);
  });
  let rank = 0;
  rows.forEach((row) => {
    if (row.comparisonEligible && row.comparisonStatus === "eligible") {
      rank += 1;
      row.comparisonRank = rank;
    } else {
      row.comparisonRank = null;
    }
  });

  const allocationDateSet = Array.from(new Set(includedAllocationRows.map((row) => dateIso(row.DateSentToSalesperson_Date)).filter(Boolean))).sort();
  const callDateSet = Array.from(new Set(Array.from(uniqueCalls.values()).map((call) => call.callDate).filter(Boolean))).sort();
  const allocationPersonIds = new Set(includedAllocationRows.map((row) => clean(row.SalesPersonID)).filter(Boolean));
  const callUserIds = new Set(callRows.map((row) => clean(row.UserID)).filter(Boolean));
  const sharedUserIds = Array.from(allocationPersonIds).filter((id) => callUserIds.has(id)).length;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    configured,
    available: true,
    status: "available",
    period: {
      startDate: reportStart,
      endDate: reportEnd,
      label: `${reportStart} to ${reportEnd}`,
      timezone: "Australia/Sydney"
    },
    comparison: {
      label: "Same-week approved-sales productivity proxy",
      minimumAllocations: MINIMUM_COMPARISON_ALLOCATIONS,
      rows,
      eligibleRows: rows.filter((row) => row.comparisonEligible && row.comparisonStatus === "eligible").length,
      roleReviewRows: rows.filter((row) => row.comparisonStatus === "role_review").length
    },
    totals: {
      rawAllocationRows: includedAllocationRows.length,
      deduplicatedSentEvents: totalSent,
      logicalDuplicateRows: includedAllocationRows.length - logicalEvents.size - missingAllocationKeys,
      uniqueCustomerRecipientPairs: totalUniqueCustomers,
      salespeople: people.size,
      approvedSalesInPeriod: sameWeekSales.length,
      matchedApprovedSales: totalSales,
      unmatchedApprovedSales: unmatchedSalesOrders,
      approvedSalesValue: Math.round(totalValue * 100) / 100,
      approvedSalesPerSentEvent: teamRate,
      approvedSalesPerUniqueCustomer: percent(totalSales, totalUniqueCustomers),
      uniqueCallsInSupplement: uniqueCalls.size
    },
    cohortWindows,
    history: historicalSnapshots.map((snapshot) => ({
      period: clean(snapshot.period),
      method: clean(snapshot.method),
      leads: Number(snapshot.leads || 0),
      approvedSales: Number(snapshot.approvedSales || 0),
      proxyRate: Number(snapshot.proxyRate || 0),
      comparableToCurrent: snapshot.comparableToCurrent === true,
      sourceLabel: clean(snapshot.sourceLabel)
    })),
    dataQuality: {
      allocationDates: allocationDateSet,
      callDates: callDateSet,
      dateWindowMismatch: callDateSet.some((date) => date < reportStart || date > reportEnd),
      missingAllocationKeys,
      duplicateAllocationItemIds: Array.from(allocationItemIds.values()).filter((count) => count > 1).length,
      missingCallColumns,
      allocationPersonIds: allocationPersonIds.size,
      callUserIds: callUserIds.size,
      sharedUserIds,
      salespersonIdentityRule: "Normalized exact salesperson label; source user IDs are not cross-system identifiers.",
      exactCustomerJoinOnly: true
    },
    definitions: {
      sentAllocationEvent: "A logical allocation event deduplicated by customer, recipient, manager, sent date/time and allocation name.",
      sameWeekProxy: "Approved orders in the reporting week divided by deduplicated sent allocation events in that week.",
      uniqueCustomerRate: "Approved orders in the reporting week divided by unique customer-recipient pairs sent in that week.",
      cohortConversion: "Exact customer and exact seller approved within the stated number of days after allocation, using only fully matured customers.",
      callCoverage: "An exact-customer call by the exact normalized allocation-recipient label after allocation. Phone numbers are never used.",
      approvedSalesValue: "CRM approved-sale amount ex GST; not payment, profit or recognised revenue."
    },
    limitations: [
      "The same-week proxy is a workload/productivity comparison, not lead-cohort conversion or proof that a particular call caused a sale.",
      "Unmatured allocation cohorts are excluded from 30/60/90-day conversion denominators.",
      "Personnel matching uses normalized exact source labels because allocation SalesPersonID and call UserID are different identifier systems.",
      "Role-review and low-sample rows remain visible but are not ranked.",
      "Call dates outside the allocation reporting window are disclosed and are used only for bounded post-allocation execution timing."
    ]
  };
}

function loadPerformanceCohorts({ config = {}, databasePath = "" } = {}) {
  if (!config.configured) return emptyPerformanceReport({ configured: false });
  if (config.error) return emptyPerformanceReport({ configured: true, error: config.error, code: "PERFORMANCE_CONFIG_INVALID" });
  if (!config.allocationLogPath || !fs.existsSync(config.allocationLogPath)) {
    return emptyPerformanceReport({
      configured: true,
      error: "The configured performance allocation log is unavailable.",
      code: "PERFORMANCE_ALLOCATION_NOT_FOUND"
    });
  }
  if (!databasePath || !fs.existsSync(databasePath)) {
    return emptyPerformanceReport({
      configured: true,
      error: "The read-only Carma evidence database is unavailable.",
      code: "PERFORMANCE_CARMA_NOT_FOUND"
    });
  }

  let db;
  try {
    const allocations = readTabularFile(config.allocationLogPath);
    const calls = config.callCsvPath && fs.existsSync(config.callCsvPath)
      ? readTabularFile(config.callCsvPath)
      : { columns: [], rows: [] };
    db = new DatabaseSync(databasePath, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`Carma integrity check failed: ${integrity || "unknown"}`);
    const salesRows = db.prepare(`
      SELECT order_id, customer_id, actual_seller, sale_approved_at, sale_value
      FROM crm_orders
      ORDER BY sale_approved_at, order_id
    `).all();
    db.close();
    return buildPerformanceCohortsReport({
      allocationRows: allocations.rows,
      allocationColumns: allocations.columns,
      callRows: calls.rows,
      callColumns: calls.columns,
      salesRows,
      startDate: config.startDate,
      endDate: config.endDate,
      historicalSnapshots: config.historicalSnapshots,
      configured: true
    });
  } catch (error) {
    try {
      db?.close();
    } catch {}
    return emptyPerformanceReport({
      configured: true,
      error: error.message,
      code: "PERFORMANCE_REPORT_LOAD_FAILED"
    });
  }
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
    if (manager && row.manager !== manager) return false;
    if (salesperson && row.salesperson !== salesperson) return false;
    if (status && row.comparisonStatus !== status) return false;
    return true;
  }).map((row) => ({
    ...row,
    displayEligible: row.sentAllocationEvents >= minimum && row.comparisonStatus !== "role_review"
  }));
  return {
    ...report,
    comparison: {
      ...report.comparison,
      minimumAllocations: minimum,
      rows
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
  buildPerformanceCohortsReport,
  emptyPerformanceReport,
  loadPerformanceCohorts,
  normalizePerson,
  publicPerformanceCohorts,
  resolvePerformanceConfig
};
