import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../src/csvParser.js");
const {
  NEW_BUSINESS,
  WARM,
  buildAllocationIndexes,
  classifyApprovedSale,
  classifyCampaign,
  clean,
  loadPolicy,
  norm,
  parseLocalTimestamp,
} = require("../src/weeklyLeadTypePolicy.js");

function argsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return result;
}

const args = argsFrom(process.argv.slice(2));
for (const required of ["workbook", "database", "source-config", "policy", "report-data", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}
const workbookPath = path.resolve(String(args.workbook));
const databasePath = path.resolve(String(args.database));
const sourceConfig = JSON.parse(await fs.readFile(path.resolve(String(args["source-config"])), "utf8"));
const report = JSON.parse(await fs.readFile(path.resolve(String(args["report-data"])), "utf8"));
const outputDir = path.resolve(String(args.output));
const { policy, campaignTypes } = loadPolicy(path.resolve(String(args.policy)));

const allocationSources = [];
const seenPaths = new Set();
for (const source of [...(sourceConfig.allocationSources || []), ...(sourceConfig.allocationLogPath ? [{ path: sourceConfig.allocationLogPath }] : [])]) {
  const sourcePath = path.resolve(String(source.path));
  if (seenPaths.has(sourcePath)) continue;
  seenPaths.add(sourcePath);
  allocationSources.push(sourcePath);
}
const allocationRows = [];
for (const sourcePath of allocationSources) allocationRows.push(...parseCsv(await fs.readFile(sourcePath, "utf8")).rows);
const indexes = buildAllocationIndexes(allocationRows, campaignTypes);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet = workbook.worksheets.getItem("Approved Sales");
if (!sheet) throw new Error("Lead Result Dashboard workbook has no Approved Sales sheet.");
const values = sheet.getRange("A6:M10005").values;
const headers = values[0].map((value) => clean(value));
const index = Object.fromEntries(headers.map((header, column) => [header, column]));
const column = (label, choices) => {
  const name = choices.find((choice) => choice in index);
  if (!name) throw new Error(`Approved Sales is missing ${label}.`);
  return index[name];
};
const columns = {
  order: column("Order", ["Order"]),
  customerId: column("Customer ID", ["Customer ID"]),
  seller: column("Seller", ["Seller"]),
  approval: column("Approval date", ["Approval Time / Period Evidence", "Approval Date"]),
  value: column("Approved value", ["Approved value", "Approved Value"]),
  source: column("Source Attribution", ["Source Attribution", "Allocated / Self"]),
  managerComparison: column("Manager comparison", ["Manager comparison"]),
  completeTotal: column("Complete total", ["Complete total"]),
};
const start = report.reportingPeriod.startDate;
const end = report.reportingPeriod.endDate;
const roster = new Map(report.salespeople.map((row) => [norm(row.salesperson), row]));
const rows = values.slice(1).filter((row) => row.some((value) => value !== null && value !== ""));
const included = rows.filter((row) => {
  const date = clean(row[columns.approval]).slice(0, 10);
  return date >= start && date <= end
    && roster.has(norm(row[columns.seller]))
    && clean(row[columns.managerComparison]) === "Included"
    && clean(row[columns.completeTotal]) === "Included";
});

const database = new DatabaseSync(databasePath, { readOnly: true });
const orderQuery = database.prepare("SELECT sale_approved_at FROM crm_orders WHERE order_id = ?");
const historyQuery = database.prepare(`
  SELECT effective_start_at, description
  FROM crm_allocations
  WHERE order_id = ? AND recipient_exact_seller = 1 AND started_before_sale = 1
  ORDER BY effective_start_at DESC, history_id
`);
const classified = [];
for (const row of included) {
  const orderId = clean(row[columns.order]);
  const customerId = clean(row[columns.customerId]);
  const seller = clean(row[columns.seller]);
  const sourceAttribution = clean(row[columns.source]);
  const governedOrder = orderQuery.get(orderId);
  if (!governedOrder?.sale_approved_at) throw new Error(`Approved sale ${orderId} has no governed approval timestamp.`);
  const approvalText = clean(governedOrder.sale_approved_at).replace("T", " ");
  const approvalAt = Date.parse(`${approvalText.replace(" ", "T").replace(/Z?$/, "Z")}`);
  if (!Number.isFinite(approvalAt)) throw new Error(`Approved sale ${orderId} has an invalid governed approval timestamp.`);
  let selectedCampaign = "";
  let allocationLeadType = "";
  let allocationSource = "";
  if (["Sale From Allocated Lead", "Allocated-Lead Sale"].includes(sourceAttribution)) {
    const weeklyRows = indexes.exact.get(`${customerId}\u0000${norm(seller)}`) || [];
    const weekly = weeklyRows.filter((item) => item.timestamp <= approvalAt).at(-1) || null;
    if (weekly) {
      selectedCampaign = weekly.allocationName;
      allocationLeadType = weekly.leadType;
      allocationSource = "retained_weekly_allocation";
    } else {
      const historical = historyQuery.all(orderId)[0] || null;
      if (!historical) throw new Error(`Allocated approved sale ${orderId} has no exact pre-approval allocation evidence.`);
      selectedCampaign = clean(historical.description);
      allocationLeadType = classifyCampaign(selectedCampaign, campaignTypes);
      allocationSource = "governed_customer_allocation_history";
    }
  }
  const result = classifyApprovedSale(sourceAttribution, allocationLeadType);
  classified.push({
    orderId,
    customerId,
    seller,
    manager: roster.get(norm(seller)).manager,
    approvedAt: clean(row[columns.approval]),
    approvedValue: Number(row[columns.value] || 0),
    sourceAttribution,
    leadType: result.leadType,
    rule: result.rule,
    allocationSource,
    selectedCampaign,
  });
}
database.close();

const outputs = {};
for (const leadType of [NEW_BUSINESS, WARM]) {
  const selected = classified.filter((row) => row.leadType === leadType);
  const aggregates = new Map(report.salespeople.map((row) => [norm(row.salesperson), {
    salesperson: row.salesperson,
    manager: row.manager,
    allocatedSales: 0,
    selfSourcedSales: 0,
    attributionWithheldSales: 0,
    approvedSalesValue: 0,
  }]));
  for (const sale of selected) {
    const aggregate = aggregates.get(norm(sale.seller));
    if (sale.sourceAttribution === "Self Sourced") aggregate.selfSourcedSales += 1;
    else aggregate.allocatedSales += 1;
    aggregate.approvedSalesValue += sale.approvedValue;
  }
  const salespeople = [...aggregates.values()].map((row) => {
    const classifiedSales = row.allocatedSales + row.selfSourcedSales;
    return {
      ...row,
      classifiedSales,
      allocatedSalesShare: classifiedSales ? row.allocatedSales / classifiedSales : null,
      selfSourcedSalesShare: classifiedSales ? row.selfSourcedSales / classifiedSales : null,
    };
  });
  const totals = salespeople.reduce((total, row) => ({
    allocatedSales: total.allocatedSales + row.allocatedSales,
    selfSourcedSales: total.selfSourcedSales + row.selfSourcedSales,
    attributionWithheldSales: 0,
    approvedSalesValue: total.approvedSalesValue + row.approvedSalesValue,
  }), { allocatedSales: 0, selfSourcedSales: 0, attributionWithheldSales: 0, approvedSalesValue: 0 });
  totals.classifiedSales = totals.allocatedSales + totals.selfSourcedSales;
  totals.allocatedSalesShare = totals.classifiedSales ? totals.allocatedSales / totals.classifiedSales : null;
  totals.selfSourcedSalesShare = totals.classifiedSales ? totals.selfSourcedSales / totals.classifiedSales : null;
  const payload = {
    schemaVersion: "weekly_lead_type_sales_split.v1",
    leadType,
    policyVersion: policy.policyVersion,
    sourceWorkbook: path.basename(workbookPath),
    sourceSheet: "Approved Sales",
    reportingPeriod: { start, end, timezone: "Australia/Melbourne" },
    rule: leadType === NEW_BUSINESS
      ? "New Business contains mapped New Business allocated sales plus every Self Sourced approved sale."
      : "Warm contains mapped Warm allocated sales; Self Sourced approved sales are excluded because policy classifies them as New Business.",
    sourceApprovedSalesRows: rows.length,
    sourceRowsInMondayFridayPeriod: included.length,
    includedSalesRows: selected.length,
    excludedSalesRows: included.length - selected.length,
    totals,
    salespeople,
    evidence: selected,
  };
  const slug = leadType === NEW_BUSINESS ? "new-business" : "warm";
  const outputPath = path.join(outputDir, slug, "sales_source_split.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  outputs[leadType] = { outputPath, totals };
}

const count = classified.length;
const value = classified.reduce((sum, row) => sum + row.approvedValue, 0);
if (outputs[NEW_BUSINESS].totals.classifiedSales + outputs[WARM].totals.classifiedSales !== count) throw new Error("Sales count split does not reconcile.");
if (Math.abs(outputs[NEW_BUSINESS].totals.approvedSalesValue + outputs[WARM].totals.approvedSalesValue - value) > 0.005) throw new Error("Sales value split does not reconcile.");
console.log(JSON.stringify({ sourceSales: count, sourceValue: value, outputs }, null, 2));
