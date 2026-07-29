"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseCsv } = require("../src/csvParser");

const ROOT = path.join(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "data", "carma", "config.json");
const DEFAULT_CATALOG = path.join(ROOT, "data", "carma", "catalog.json");

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

module.exports = { buildCatalog, rawAllocationSummary };
