"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseCsv } = require("../src/csvParser");

const ROOT = path.join(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "data", "carma", "config.json");
const DEFAULT_CATALOG = path.join(ROOT, "data", "carma", "catalog.json");
const CANCELLED_ORDERS_SCHEMA_VERSION =
  "carma_cancelled_orders_by_week_history_manifest.v1";
const CANCELLED_ORDERS_PROCESS_VERSION =
  "CANCELLED-ORDERS-BY-WEEK-HISTORY-1";
const CANCELLED_ORDERS_COMBINATION_IDS = [
  "group-publication__all-salespeople",
  "group-publication__terminated-salespeople-only",
  "group-week__all-salespeople",
  "group-week__terminated-salespeople-only"
];
const CAMPAIGN_ALLOCATIONS_GRID_SCHEMA_VERSION =
  "carma_campaign_allocations_grid_manifest.v1";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileMeta(filePath) {
  const stat = fs.statSync(filePath);
  return {
    fileName: path.basename(filePath),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256(filePath)
  };
}

function requireFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath || "(not configured)"}`);
  return path.resolve(filePath);
}

function requireManifestOutput(manifestDirectory, entry, label) {
  if (!entry?.fileName || !entry?.sha256) {
    throw new Error(`${label} metadata is incomplete.`);
  }
  const filePath = requireFile(path.join(manifestDirectory, entry.fileName), label);
  if (sha256(filePath) !== String(entry.sha256).toLowerCase()) {
    throw new Error(`${label} hash does not match its manifest.`);
  }
  return filePath;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function cancelledOrdersByWeekSummary(manifestPath) {
  if (!manifestPath) {
    return {
      authority: "primary_for_carma_cancelled_orders_by_week_report_history",
      configured: false,
      available: false
    };
  }
  const resolvedManifestPath = requireFile(
    manifestPath,
    "Cancelled Orders by Week manifest"
  );
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  if (manifest.schemaVersion !== CANCELLED_ORDERS_SCHEMA_VERSION) {
    throw new Error("Unsupported Cancelled Orders by Week manifest schema.");
  }
  if (
    manifest.processVersion !== CANCELLED_ORDERS_PROCESS_VERSION ||
    manifest.reportName !== "Cancelled Orders by Week"
  ) {
    throw new Error("Cancelled Orders by Week manifest process identity is invalid.");
  }
  const combinations = Array.isArray(manifest.combinations)
    ? manifest.combinations
    : [];
  const combinationIds = combinations.map((entry) => entry.id).sort();
  if (
    combinationIds.length !== CANCELLED_ORDERS_COMBINATION_IDS.length ||
    combinationIds.some(
      (value, index) => value !== CANCELLED_ORDERS_COMBINATION_IDS[index]
    ) ||
    combinations.some((entry) => entry.status !== "complete")
  ) {
    throw new Error("Cancelled Orders by Week combination matrix is incomplete.");
  }
  const validation = manifest.validation || {};
  if (
    validation.completeCombinationMatrix !== true ||
    Number(validation.requestedCombinationCount) !== 4 ||
    Number(validation.completedCombinationCount) !== 4 ||
    Number(validation.allSalespeopleGroupingTupleDifferences?.weekOnly) !== 0 ||
    Number(validation.allSalespeopleGroupingTupleDifferences?.publicationOnly) !== 0 ||
    Number(validation.terminatedSalespeopleGroupingTupleDifferences?.weekOnly) !== 0 ||
    Number(validation.terminatedSalespeopleGroupingTupleDifferences?.publicationOnly) !== 0 ||
    Number(validation.terminatedOrdersMissingFromAllSalespeople) !== 0 ||
    Number(validation.duplicateOrderRowsAcrossIndividualOutputs) !== 0
  ) {
    throw new Error("Cancelled Orders by Week reconciliation is incomplete.");
  }
  if (
    manifest.boundaryProbe?.status !== "complete_empty" ||
    Number(manifest.boundaryProbe?.weekCount) !== 0 ||
    Number(manifest.boundaryProbe?.orderRowCount) !== 0
  ) {
    throw new Error("Cancelled Orders by Week historical boundary is not validated.");
  }
  if (
    !isIsoDate(manifest.coverage?.oldestRequestedDate) ||
    !isIsoDate(manifest.coverage?.oldestReturnedWeek) ||
    !isIsoDate(manifest.coverage?.latestReturnedWeek)
  ) {
    throw new Error("Cancelled Orders by Week coverage dates are invalid.");
  }

  const manifestDirectory = path.dirname(resolvedManifestPath);
  combinations.forEach((entry) => {
    requireManifestOutput(
      manifestDirectory,
      entry,
      `Cancelled Orders by Week combination ${entry.id}`
    );
  });
  requireManifestOutput(
    manifestDirectory,
    manifest.boundaryProbe,
    "Cancelled Orders by Week boundary probe"
  );
  const normalizedIndexPath = requireManifestOutput(
    manifestDirectory,
    manifest.normalizedIndex,
    "Cancelled Orders by Week normalized index"
  );

  return {
    authority: "primary_for_carma_cancelled_orders_by_week_report_history",
    configured: true,
    available: true,
    sourcePath: manifestDirectory,
    manifest: fileMeta(resolvedManifestPath),
    schemaVersion: manifest.schemaVersion,
    processVersion: manifest.processVersion,
    reportName: manifest.reportName,
    coverageStart: manifest.coverage.oldestReturnedWeek,
    coverageEnd: manifest.coverage.latestReturnedWeek,
    oldestRequestedDate: manifest.coverage.oldestRequestedDate,
    boundaryReason: manifest.coverage.boundaryReason || "",
    requestedCombinationCount: Number(validation.requestedCombinationCount),
    completedCombinationCount: Number(validation.completedCombinationCount),
    completeOutputCount: combinations.filter((entry) => entry.status === "complete").length,
    emptyOutputCount: manifest.boundaryProbe.status === "complete_empty" ? 1 : 0,
    failedOutputCount: 0,
    totalParsedNonEmptyRowsAcrossOverlappingViews: Number(
      manifest.totals?.totalParsedNonEmptyRowsAcrossOverlappingViews || 0
    ),
    allSalespeopleUniqueOrders: Number(
      manifest.totals?.allSalespeopleUniqueOrders || 0
    ),
    terminatedSalespeopleUniqueOrders: Number(
      manifest.totals?.terminatedSalespeopleUniqueOrders || 0
    ),
    normalizedIndex: {
      ...fileMeta(normalizedIndexPath),
      rowCount: Number(manifest.normalizedIndex.rowCount || 0),
      ordersWithoutPublication: Number(
        manifest.normalizedIndex.ordersWithoutPublication || 0
      ),
      ordersWithoutEdition: Number(
        manifest.normalizedIndex.ordersWithoutEdition || 0
      )
    },
    validation
  };
}

function campaignAllocationsGridSummary(manifestPath) {
  if (!manifestPath) {
    return {
      authority: "primary_for_carma_campaign_allocations_grid_rows",
      configured: false,
      available: false
    };
  }
  const resolvedManifestPath = requireFile(
    manifestPath,
    "Campaign Allocations grid manifest"
  );
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  if (manifest.schemaVersion !== CAMPAIGN_ALLOCATIONS_GRID_SCHEMA_VERSION) {
    throw new Error("Unsupported Campaign Allocations grid manifest schema.");
  }
  if (
    manifest.reportName !== "Campaign Allocations" ||
    manifest.validation?.readOnly !== true ||
    manifest.validation?.dailyExtraction !== true ||
    manifest.validation?.quantityBalanceReconciled !== true ||
    Number(manifest.validation?.qaFailures) !== 0 ||
    manifest.validation?.customerLevelIdentifiersAvailable !== false
  ) {
    throw new Error("Campaign Allocations grid validation is incomplete.");
  }
  if (
    !isIsoDate(manifest.coverage?.requestedStart) ||
    !isIsoDate(manifest.coverage?.requestedEnd) ||
    !isIsoDate(manifest.coverage?.firstActualAllocationDate)
  ) {
    throw new Error("Campaign Allocations grid coverage dates are invalid.");
  }

  const manifestDirectory = path.dirname(resolvedManifestPath);
  const jsonPath = requireManifestOutput(
    manifestDirectory,
    manifest.outputs?.json,
    "Campaign Allocations grid JSON"
  );
  const csvPath = requireManifestOutput(
    manifestDirectory,
    manifest.outputs?.csv,
    "Campaign Allocations grid CSV"
  );
  const xlsxPath = requireManifestOutput(
    manifestDirectory,
    manifest.outputs?.xlsx,
    "Campaign Allocations grid XLSX"
  );
  const extract = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const records = Array.isArray(extract.records) ? extract.records : [];
  const audit = Array.isArray(extract.audit) ? extract.audit : [];
  const totals = records.reduce(
    (summary, row) => ({
      quantity: summary.quantity + Number(row.quantity || 0),
      actioned: summary.actioned + Number(row.actioned || 0),
      remaining: summary.remaining + Number(row.remaining || 0)
    }),
    { quantity: 0, actioned: 0, remaining: 0 }
  );
  if (
    records.length !== Number(manifest.totals?.rows) ||
    audit.length !== Number(manifest.coverage?.continuousDailyAuditDays) ||
    totals.quantity !== Number(manifest.totals?.quantity) ||
    totals.actioned !== Number(manifest.totals?.actioned) ||
    totals.remaining !== Number(manifest.totals?.remaining) ||
    totals.quantity !== totals.actioned + totals.remaining ||
    audit.some((day) =>
      day.scope_pass !== true ||
      Number(day.missing_indexes) !== 0 ||
      Number(day.directional_mismatches) !== 0 ||
      Number(day.balance_errors) !== 0
    )
  ) {
    throw new Error("Campaign Allocations grid extract does not reconcile with its manifest.");
  }

  return {
    authority: "primary_for_carma_campaign_allocations_grid_rows",
    configured: true,
    available: true,
    sourcePath: manifestDirectory,
    manifest: fileMeta(resolvedManifestPath),
    schemaVersion: manifest.schemaVersion,
    reportName: manifest.reportName,
    coverageStart: manifest.coverage.requestedStart,
    coverageEnd: manifest.coverage.requestedEnd,
    firstActualAllocationDate: manifest.coverage.firstActualAllocationDate,
    continuousDailyAuditDays: Number(manifest.coverage.continuousDailyAuditDays),
    rowCount: records.length,
    quantity: totals.quantity,
    actioned: totals.actioned,
    remaining: totals.remaining,
    actionedRate: Number(manifest.totals.actionedRate),
    repeatedVirtualGridRowsDiscarded: Number(
      manifest.validation.repeatedVirtualGridRowsDiscarded || 0
    ),
    outputs: {
      json: fileMeta(jsonPath),
      csv: fileMeta(csvPath),
      xlsx: fileMeta(xlsxPath)
    },
    customerLevelIdentifiersAvailable: false,
    permittedUses: manifest.permittedUses || [],
    prohibitedInferences: manifest.prohibitedInferences || []
  };
}

function periodStartSortKey(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || "");
}

function listRawAllocationLogs(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^WeeklyLeadAllocationExport_.*\.csv$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function rawAllocationSummary(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8")).rows;
  const sentDates = rows.map((row) => String(row.DateSentToSalesperson_Date || "").trim()).filter(Boolean).sort();
  const logicalEvents = new Set(rows.map((row) => [
    row.CustomerID,
    row.FullName,
    row.SalesManager,
    row.DateSentToSalesperson_Date,
    row.DateSentToSalesperson_Time,
    row.AllocationName
  ].map((value) => String(value || "").trim()).join("|")));
  return {
    ...fileMeta(filePath),
    rowCount: rows.length,
    logicalEventCount: logicalEvents.size,
    sentDateStart: sentDates[0] || "",
    sentDateEnd: sentDates.at(-1) || "",
    sourcePath: filePath
  };
}

function buildCatalog(configPath, catalogPath) {
  const config = JSON.parse(fs.readFileSync(requireFile(configPath, "Carma data-layer config"), "utf8"));
  if (config.schemaVersion !== "carma_data_layer_config.v1") throw new Error("Unsupported Carma data-layer config version.");

  const salesManifestPath = requireFile(config.approvedSalesHistoryManifest, "Approved-sales history manifest");
  const salesManifest = JSON.parse(fs.readFileSync(salesManifestPath, "utf8"));
  const periods = Object.values(salesManifest.periods || {}).filter((period) => period.status === "complete");
  const classifiedManifestPath = config.approvedSalesHistoryClassifiedManifest || "";
  const classifiedAvailable = Boolean(
    classifiedManifestPath && fs.existsSync(classifiedManifestPath)
  );
  const classifiedManifest = classifiedAvailable
    ? JSON.parse(fs.readFileSync(classifiedManifestPath, "utf8"))
    : null;
  const classifiedDirectory = classifiedAvailable
    ? path.dirname(classifiedManifestPath)
    : "";
  const classifiedOutput = (key) => (
    classifiedManifest?.outputs?.[key]
      ? path.join(classifiedDirectory, classifiedManifest.outputs[key])
      : ""
  );
  const rawLogs = listRawAllocationLogs(config.rawAllocationLogDirectory).map(rawAllocationSummary);
  const cancelledOrdersByWeekHistory = cancelledOrdersByWeekSummary(
    config.cancelledOrdersByWeekManifest || ""
  );
  const campaignAllocationsGrid = campaignAllocationsGridSummary(
    config.campaignAllocationsGridManifest || ""
  );
  const optionalDirs = [
    ["customerAllocationHistoryDirectory", "customerAllocationHistory"],
    ["campaignStatusDirectory", "campaignStatus"]
  ].map(([key, catalogKey]) => ({
    key: catalogKey,
    configured: Boolean(config[key]),
    available: Boolean(config[key] && fs.existsSync(config[key])),
    sourcePath: config[key] || ""
  }));

  const catalog = {
    schemaVersion: "carma_data_catalog.v1",
    generatedAt: new Date().toISOString(),
    usage: "local_agent_and_refresh_metadata_only",
    dashboardExposure: "none",
    datasets: {
      approvedSalesHistory: {
        authority: "primary_for_historical_approved_sales",
        sourcePath: path.dirname(salesManifestPath),
        manifest: fileMeta(salesManifestPath),
        reportName: salesManifest.reportName || "",
        coverageStart: periods.slice().sort((left, right) => periodStartSortKey(left.startDate).localeCompare(periodStartSortKey(right.startDate)))[0]?.startDate || "",
        coverageEnd: periods.slice().sort((left, right) => periodStartSortKey(left.endDate).localeCompare(periodStartSortKey(right.endDate))).at(-1)?.endDate || "",
        completePeriodCount: periods.length,
        periodsWithoutOrderIds: periods.filter((period) => !period.containsOrderIds).map((period) => period.id)
      },
      approvedSalesHistoryClassified: {
        authority:
          "primary_for_order_level_historical_approved_sales_and_carma_reported_new_customer_membership",
        configured: Boolean(classifiedManifestPath),
        available: classifiedAvailable,
        sourcePath: classifiedDirectory,
        manifest: classifiedAvailable ? fileMeta(classifiedManifestPath) : null,
        sqlite: classifiedAvailable && fs.existsSync(classifiedOutput("sqlite"))
          ? fileMeta(classifiedOutput("sqlite"))
          : null,
        periodSummaryCsv:
          classifiedAvailable && fs.existsSync(classifiedOutput("periodSummaryCsv"))
            ? fileMeta(classifiedOutput("periodSummaryCsv"))
            : null,
        schemaVersion: classifiedManifest?.schemaVersion || "",
        coverageStart: classifiedManifest?.periods?.[0]?.startDate || "",
        coverageEnd: classifiedManifest?.periods?.at(-1)?.endDate || "",
        periodCount: Number(classifiedManifest?.totals?.periods || 0),
        orderCount: Number(classifiedManifest?.totals?.orders || 0),
        newCustomerOrderCount: Number(
          classifiedManifest?.totals?.newCustomerOrders || 0
        ),
        matchingRule: classifiedManifest?.matchingRule || "",
        historicalMarkerCliffStart:
          classifiedManifest?.observedHistoricalMarkerCliff?.start || "",
        nonMembershipMeaning: classifiedManifest?.nonMembershipMeaning || ""
      },
      rawAllocationLogs: {
        authority: "primary_for_weekly_sent_allocation_events",
        dedupeRule: "CustomerID + FullName + SalesManager + DateSentToSalesperson_Date + DateSentToSalesperson_Time + AllocationName",
        files: rawLogs,
        totalRows: rawLogs.reduce((sum, file) => sum + file.rowCount, 0),
        totalLogicalEvents: rawLogs.reduce((sum, file) => sum + file.logicalEventCount, 0)
      },
      campaignAllocationsGrid,
      cancelledOrdersByWeekHistory,
      optionalExtracts: optionalDirs,
      dashboardEvidenceContract: {
        authority: "validated_subset_for_dashboard_exact_customer_id_proof",
        configured: Boolean(config.evidenceContractPath),
        available: Boolean(config.evidenceContractPath && fs.existsSync(config.evidenceContractPath)),
        sourcePath: config.evidenceContractPath || ""
      }
    },
    limitations: [
      "Raw allocation logs are weekly snapshots and cannot fill weeks that were not exported.",
      "Campaign status is not a weekly-sent-lead denominator.",
      "Campaign Allocations grid Quantity, Actioned and Remaining are aggregate grid facts, not customer-level sent events, unique lead availability or conversion evidence.",
      "Approved sales values are Carma-approved amounts, not payment, recognised revenue, profit or call-caused conversion.",
      "Cancelled Orders by Week proves report inclusion and grouping only; it does not by itself prove a refund, payment reversal, order deletion, recognised-revenue adjustment or cancellation cause.",
      "Cancelled Orders report combinations overlap and must not be summed.",
      "The is_new_customer field is exact membership in Carma's same-period new-customer-only report. A false value is not independent proof that the customer was historically existing.",
      "Carma's historical new-customer marker becomes extremely sparse before the observed 2024 boundary and must retain its classification-quality warning.",
      "Dashboard CRM joins remain exact customer_id only."
    ]
  };
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return catalog;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const catalog = buildCatalog(path.resolve(args.config || DEFAULT_CONFIG), path.resolve(args.output || DEFAULT_CATALOG));
    process.stdout.write(`${JSON.stringify({ generatedAt: catalog.generatedAt, datasets: catalog.datasets }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCatalog,
  campaignAllocationsGridSummary,
  cancelledOrdersByWeekSummary,
  rawAllocationSummary
};
