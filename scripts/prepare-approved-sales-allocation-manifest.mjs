import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../src/csvParser");

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePerson(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const args = argsFrom(process.argv.slice(2));
const periodStart = clean(args["period-start"]);
const periodEnd = clean(args["period-end"]);
const csvPath = path.resolve(args.csv || "");
const claDir = args["cla-dir"] ? path.resolve(args["cla-dir"]) : "";
const browserManifestPath = path.resolve(args["browser-manifest"] || "");
const weeklyAllocationPath = path.resolve(args["weekly-allocation"] || "");
const outputDir = path.resolve(args.output || "");

if (!args["period-start"] || !args["period-end"] || !args.csv || !args["browser-manifest"] || !args["weekly-allocation"] || !args.output) {
  throw new Error("Usage: --period-start YYYY-MM-DD --period-end YYYY-MM-DD --csv <enriched.csv> [--cla-dir <customer allocation checkpoint>] --browser-manifest <approved-order extraction manifest> --weekly-allocation <positive-proof CSV> --output <parser evidence directory>");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
  throw new Error("The allocation coverage period must be an ordered YYYY-MM-DD range");
}
for (const requiredPath of [csvPath, browserManifestPath, weeklyAllocationPath, ...(claDir ? [claDir] : [])]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Required source is missing: ${requiredPath}`);
}

const progressPath = claDir ? path.join(claDir, "progress.json") : "";
const progress = progressPath && fs.existsSync(progressPath)
  ? JSON.parse(await fsp.readFile(progressPath, "utf8"))
  : { results: [] };
const browserManifest = JSON.parse(await fsp.readFile(browserManifestPath, "utf8"));
const customerResults = new Map();
for (const row of progress.results || []) {
  if (row.status === "downloaded" && clean(row.customerId)) customerResults.set(clean(row.customerId), row);
}
for (const record of Object.values(browserManifest.records || {})) {
  if (record.status !== "complete" || record.allocationStatus !== "downloaded" || !clean(record.customerId)) continue;
  customerResults.set(clean(record.customerId), {
    customerId: clean(record.customerId),
    status: "downloaded",
    pdfPath: record.allocationPath,
    bytes: record.allocationBytes,
    source: "approved_order_allocation_capture"
  });
}

const weeklyParsed = parseCsv(await fsp.readFile(weeklyAllocationPath, "utf8"));
const weeklyRows = weeklyParsed.rows;
const parsed = parseCsv(await fsp.readFile(csvPath, "utf8"));
const rows = parsed.rows;
const orderIds = [];
const records = {};
const seenOrders = new Set();
const weeklyPositiveOnly = [];
const attributionWithheld = [];
await fsp.mkdir(path.join(outputDir, "records"), { recursive: true });

for (const row of rows) {
  const orderId = clean(row.Order);
  const customerId = clean(row["Customer ID"]);
  const customerName = clean(row.Customer);
  if (!/^\d+$/.test(orderId) || !/^\d+$/.test(customerId)) {
    throw new Error(`Invalid exact order/customer identifier: ${orderId}/${customerId}`);
  }
  if (seenOrders.has(orderId)) throw new Error(`Duplicate order ID in enriched source: ${orderId}`);
  seenOrders.add(orderId);
  const result = customerResults.get(customerId);
  if (!result || result.status !== "downloaded") {
    const approvalTimestamp = clean(row["Approval Timestamp"]);
    const proof = weeklyRows.find((allocation) => (
      clean(allocation.CustomerID) === customerId
      && normalizePerson(allocation.FullName) === normalizePerson(clean(row["Salesperson (Report)"]))
      && /^\d{4}-\d{2}-\d{2}$/.test(clean(allocation.DateSentToSalesperson_Date))
      && `${clean(allocation.DateSentToSalesperson_Date)} ${clean(allocation.DateSentToSalesperson_Time) || "00:00:00"}` <= approvalTimestamp
    ));
    if (!proof) {
      attributionWithheld.push({
        orderId,
        customerId,
        seller: clean(row["Salesperson (Report)"]),
        approvalTimestamp,
        reason: "complete_customer_allocation_history_unavailable_and_no_exact_weekly_positive_proof"
      });
      continue;
    }
    weeklyPositiveOnly.push({
      orderId,
      customerId,
      seller: clean(row["Salesperson (Report)"]),
      approvalTimestamp,
      allocationItemId: clean(proof.AllocationItemID),
      allocationName: clean(proof.AllocationName),
      sentDate: clean(proof.DateSentToSalesperson_Date),
      sentTime: clean(proof.DateSentToSalesperson_Time),
      manager: clean(proof.SalesManager)
    });
    continue;
  }
  const pdfPath = path.resolve(result.pdfPath || path.join(claDir, `customer-lead-allocation-${customerId}.pdf`));
  const signature = (await fsp.readFile(pdfPath)).subarray(0, 5).toString("ascii");
  if (signature !== "%PDF-") throw new Error(`Allocation evidence for customer ${customerId} is not a PDF`);

  const recordPath = path.join(outputDir, "records", `${orderId}.json`);
  const record = { orderId, customerId, customerName, seller: clean(row["Salesperson (Report)"]) };
  await fsp.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  orderIds.push(orderId);
  records[orderId] = {
    status: "complete",
    recordPath,
    allocationPath: pdfPath,
    customerId,
    customerName
  };
}

if (orderIds.length + weeklyPositiveOnly.length + attributionWithheld.length !== rows.length) {
  throw new Error(`Allocation coverage does not reconcile: history=${orderIds.length}, weekly_positive=${weeklyPositiveOnly.length}, withheld=${attributionWithheld.length}, sales=${rows.length}`);
}

const manifest = {
  processVersion: "LEAD-RESULT-ALLOCATION-PARSER-BRIDGE-1",
  reportName: "Approved Sales by Customer for Period",
  reportParameters: {
    startDate: periodStart.split("-").reverse().join("/"),
    endDate: periodEnd.split("-").reverse().join("/"),
    showNewCustomersInPeriod: false,
  },
  sourceCsv: csvPath,
  sourceClaProgress: progressPath || null,
  orderIds,
  records
};
const manifestPath = path.join(outputDir, "manifest.json");
await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const coverage = {
  processVersion: "LEAD-RESULT-ALLOCATION-COVERAGE-1",
  sourceOrders: rows.length,
  uniqueCustomers: new Set(rows.map((row) => clean(row["Customer ID"]))).size,
  historyCoveredOrders: orderIds.length,
  historyCoveredCustomers: new Set(orderIds.map((orderId) => records[orderId].customerId)).size,
  weeklyPositiveOnlyOrders: weeklyPositiveOnly.length,
  weeklyPositiveOnly,
  attributionWithheldOrders: attributionWithheld.length,
  attributionWithheld,
  sourceHashes: {
    enrichedCsv: sha256File(csvPath),
    claProgress: progressPath ? sha256File(progressPath) : "",
    browserManifest: sha256File(browserManifestPath),
    weeklyAllocation: sha256File(weeklyAllocationPath)
  },
  safeguard: "A missing complete allocation history is classified Company Sourced only with exact Customer ID and normalized full-seller allocation sent before explicit approval; otherwise source attribution is withheld and missing proof can never produce Self Sourced."
};
const coveragePath = path.join(outputDir, "coverage.json");
await fsp.writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ manifestPath, coveragePath, ordersWithHistory: orderIds.length, weeklyPositiveOnlyOrders: weeklyPositiveOnly.length, attributionWithheldOrders: attributionWithheld.length }, null, 2)}\n`);
