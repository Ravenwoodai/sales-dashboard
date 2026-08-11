"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseCsv } = require("../src/csvParser");

const ROOT = path.join(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "data", "carma", "config.json");
const DEFAULT_CATALOG = path.join(ROOT, "data", "carma", "catalog.json");
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
  const rawLogs = listRawAllocationLogs(config.rawAllocationLogDirectory).map(rawAllocationSummary);
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
      rawAllocationLogs: {
        authority: "primary_for_weekly_sent_allocation_events",
        dedupeRule: "CustomerID + FullName + SalesManager + DateSentToSalesperson_Date + DateSentToSalesperson_Time + AllocationName",
        files: rawLogs,
        totalRows: rawLogs.reduce((sum, file) => sum + file.rowCount, 0),
        totalLogicalEvents: rawLogs.reduce((sum, file) => sum + file.logicalEventCount, 0)
      },
      campaignAllocationsGrid,
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
  rawAllocationSummary
};
