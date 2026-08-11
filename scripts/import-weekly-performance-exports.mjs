import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readTabularFileColumns } = require("../src/sourceFile");
const {
  REQUIRED_ALLOCATION_COLUMNS,
  REQUIRED_CALL_COLUMNS
} = require("../src/performanceCohorts");
const { retainWeeklySources } = require("../src/weeklyPerformanceSourceConfig");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return args;
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error(`${label} must be YYYY-MM-DD.`);
}

function normalizeDate(value, monthFirst = false) {
  const text = String(value || "").trim().split(/\s+/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  const month = monthFirst ? first : second;
  const day = monthFirst ? second : first;
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inspectCsv(filePath, requiredColumns, dateColumn, monthFirst = false) {
  const result = readTabularFileColumns(filePath, Array.from(new Set([...requiredColumns, dateColumn])));
  const missing = requiredColumns.filter((column) => !result.columns.includes(column));
  if (missing.length) throw new Error(`${path.basename(filePath)} is missing required columns: ${missing.join(", ")}`);
  const dates = Array.from(new Set(result.rows.map((row) => normalizeDate(row[dateColumn], monthFirst)).filter(Boolean))).sort();
  return { rowCount: result.rows.length, dates, columns: result.columns };
}

async function copyRaw(sourcePath, destinationPath, expectedHash) {
  if (fs.existsSync(destinationPath)) {
    if (hashFile(destinationPath) !== expectedHash) throw new Error(`Existing raw file has unexpected content: ${destinationPath}`);
    return "already_present";
  }
  await fsp.copyFile(sourcePath, destinationPath);
  if (hashFile(destinationPath) !== expectedHash) throw new Error(`Copied raw file failed SHA-256 verification: ${destinationPath}`);
  return "copied";
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const allocationPath = path.resolve(String(args.allocation || ""));
  const callPath = path.resolve(String(args.calls || ""));
  const explicitPrimaryCallPath = args["primary-calls"]
    ? path.resolve(String(args["primary-calls"]))
    : "";
  const startDate = String(args.start || "");
  const endDate = String(args.end || "");
  assertIsoDate(startDate, "--start");
  assertIsoDate(endDate, "--end");
  if (endDate < startDate) throw new Error("--end must be on or after --start.");
  if (!fs.existsSync(allocationPath)) throw new Error(`Allocation export not found: ${allocationPath}`);
  if (!fs.existsSync(callPath)) throw new Error(`Call export not found: ${callPath}`);
  if (explicitPrimaryCallPath && !fs.existsSync(explicitPrimaryCallPath)) {
    throw new Error(`Primary call history not found: ${explicitPrimaryCallPath}`);
  }

  const allocation = inspectCsv(allocationPath, REQUIRED_ALLOCATION_COLUMNS, "DateSentToSalesperson_Date");
  const calls = inspectCsv(callPath, REQUIRED_CALL_COLUMNS, "call_date", true);
  const allocationHash = hashFile(allocationPath);
  const callHash = hashFile(callPath);
  const rawDir = path.join(ROOT, "data", "carma", "raw", "weekly-performance-exports");
  await fsp.mkdir(rawDir, { recursive: true });
  const allocationDestination = path.join(rawDir, `WeeklyLeadAllocationExport_${startDate}_to_${endDate}_${allocationHash.slice(0, 12)}.csv`);
  const callDestination = path.join(rawDir, `WeeklyCallExport_${startDate}_to_${endDate}_${callHash.slice(0, 12)}.csv`);
  const allocationStatus = await copyRaw(allocationPath, allocationDestination, allocationHash);
  const callStatus = await copyRaw(callPath, callDestination, callHash);

  const configPath = path.join(ROOT, "data", "store", "performance-cohorts.json");
  const current = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  const retainedPrimarySource = Array.isArray(current.callSources)
    ? current.callSources.find((source) => String(source?.role || "") === "primary_history")
    : null;
  const primaryCallPath = explicitPrimaryCallPath
    || current.primaryCallCsvPath
    || retainedPrimarySource?.path
    || "";
  if (primaryCallPath && !fs.existsSync(primaryCallPath)) {
    throw new Error(`Configured primary call history not found: ${primaryCallPath}`);
  }
  const primaryCalls = primaryCallPath
    ? inspectCsv(primaryCallPath, REQUIRED_CALL_COLUMNS, "call_date", false)
    : null;
  const primaryCallHash = primaryCallPath ? hashFile(primaryCallPath) : "";
  const allocationSources = retainWeeklySources({
    sources: current.allocationSources,
    legacyPath: current.allocationLogPath,
    newPath: allocationDestination,
    role: "weekly_allocation"
  });
  const weeklyCallSources = retainWeeklySources({
    sources: current.callSources,
    legacyPath: current.callCsvPath,
    newPath: callDestination,
    role: "weekly_supplement",
    defaults: { dateOrder: "month_first" }
  });

  const manifest = {
    schemaVersion: "weekly_performance_exports_manifest.v1",
    selectedPeriod: { startDate, endDate },
    allocation: {
      rawPath: allocationDestination,
      sha256: allocationHash,
      rowCount: allocation.rowCount,
      observedDates: allocation.dates
    },
    calls: {
      rawPath: callDestination,
      sha256: callHash,
      rowCount: calls.rowCount,
      observedDates: calls.dates
    },
    primaryCallHistory: primaryCalls ? {
      sourcePath: path.resolve(primaryCallPath),
      sha256: primaryCallHash,
      rowCount: primaryCalls.rowCount,
      observedDates: primaryCalls.dates,
      dateOrder: "day_first"
    } : null,
    preservationRule: "Raw CSV bytes are copied unchanged and verified by SHA-256. Existing files are never overwritten."
  };
  const manifestPath = path.join(rawDir, `manifest_${startDate}_to_${endDate}.json`);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== manifestText) await fsp.writeFile(manifestPath, manifestText);

  const config = {
    schemaVersion: "performance_cohorts_config.v2",
    allocationLogPath: allocationDestination,
    allocationSources,
    primaryCallCsvPath: primaryCallPath ? path.resolve(primaryCallPath) : "",
    callCsvPath: callDestination,
    callSources: [
      ...(primaryCallPath ? [{
        path: path.resolve(primaryCallPath),
        role: "primary_history",
        dateOrder: "day_first"
      }] : []),
      ...weeklyCallSources
    ],
    approvedSalesHistoryPath: current.approvedSalesHistoryPath || path.join(ROOT, "data", "carma", "generated", "approved-sales-history", "approved-sales-history.sqlite"),
    startDate,
    endDate
  };
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  if (!fs.existsSync(configPath) || fs.readFileSync(configPath, "utf8") !== configText) await fsp.writeFile(configPath, configText);

  process.stdout.write(`${JSON.stringify({
    allocationStatus,
    callStatus,
    manifestPath,
    configPath,
    allocationDates: allocation.dates,
    callDates: calls.dates,
    primaryCallDates: primaryCalls?.dates || []
  }, null, 2)}\n`);
}

await main();
