import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

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

const args = argsFrom(process.argv.slice(2));
const workbookPath = path.resolve(String(args.workbook || ""));
const reportDataPath = path.resolve(String(args["report-data"] || ""));
const outputPath = path.resolve(String(args.output || ""));
for (const [label, value] of [["--workbook", args.workbook], ["--report-data", args["report-data"]], ["--output", args.output]]) {
  if (!value) throw new Error(`${label} is required.`);
}

const norm = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet = workbook.worksheets.getItem("Approved Sales");
const maxSalesRows = Number(args["max-sales-rows"] || 10000);
if (!Number.isInteger(maxSalesRows) || maxSalesRows < 2 || maxSalesRows > 100000) {
  throw new Error("--max-sales-rows must be an integer from 2 to 100000.");
}
const values = sheet.getRange(`A6:M${5 + maxSalesRows}`).values;
const headers = values[0].map((value) => String(value ?? "").trim());
const index = Object.fromEntries(headers.map((header, column) => [header, column]));
const resolveColumn = (label, alternatives) => {
  const header = alternatives.find((candidate) => candidate in index);
  if (!header) throw new Error(`Missing Approved Sales column: ${label}`);
  return index[header];
};
const salesColumns = {
  order: resolveColumn("Order", ["Order"]),
  seller: resolveColumn("Seller", ["Seller"]),
  approvalDate: resolveColumn("Approval time/date", ["Approval Time / Period Evidence", "Approval Date"]),
  sourceAttribution: resolveColumn("Source attribution", ["Source Attribution", "Allocated / Self"]),
  managerComparison: resolveColumn("Manager comparison", ["Manager comparison"]),
  completeTotal: resolveColumn("Complete total", ["Complete total"]),
};

const reportData = JSON.parse(await fs.readFile(reportDataPath, "utf8"));
const includedPeople = new Map(reportData.salespeople.map((row) => [norm(row.salesperson), row.salesperson]));
const aggregates = new Map(reportData.salespeople.map((row) => [norm(row.salesperson), {
  salesperson: row.salesperson,
  manager: row.manager,
  allocatedSales: 0,
  selfSourcedSales: 0,
  attributionWithheldSales: 0,
} ]));

const periodStart = String(reportData.reportingPeriod?.startDate || "");
const periodEnd = String(reportData.reportingPeriod?.endDate || "");
if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
  throw new Error("report_data.json is missing a valid reportingPeriod startDate/endDate.");
}
const rows = values.slice(1).filter((row) => row.some((value) => value !== null && value !== ""));
const inPeriodRows = rows.filter((row) => {
  const date = String(row[salesColumns.approvalDate] ?? "").slice(0, 10);
  return date >= periodStart && date <= periodEnd;
});
const includedRows = inPeriodRows.filter((row) => includedPeople.has(norm(row[salesColumns.seller])));
const classificationBuckets = new Map([
  ["Sale From Allocated Lead", "allocated"],
  ["Allocated-Lead Sale", "allocated"],
  ["Self Sourced", "self_sourced"],
  ["Attribution Withheld", "withheld"],
]);

for (const row of includedRows) {
  const sellerKey = norm(row[salesColumns.seller]);
  const classification = String(row[salesColumns.sourceAttribution] ?? "").trim();
  const bucket = classificationBuckets.get(classification);
  if (!bucket) {
    throw new Error(`Unexpected source attribution for order ${row[salesColumns.order]}: ${classification}`);
  }
  if (String(row[salesColumns.completeTotal] ?? "").trim() !== "Included") {
    throw new Error(`Included salesperson sale is not in the complete total: order ${row[salesColumns.order]}`);
  }
  const aggregate = aggregates.get(sellerKey);
  if (bucket === "allocated") aggregate.allocatedSales += 1;
  else if (bucket === "self_sourced") aggregate.selfSourcedSales += 1;
  else aggregate.attributionWithheldSales += 1;
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
  attributionWithheldSales: total.attributionWithheldSales + row.attributionWithheldSales,
}), { allocatedSales: 0, selfSourcedSales: 0, attributionWithheldSales: 0 });
totals.classifiedSales = totals.allocatedSales + totals.selfSourcedSales;
totals.allocatedSalesShare = totals.classifiedSales ? totals.allocatedSales / totals.classifiedSales : null;
totals.selfSourcedSalesShare = totals.classifiedSales ? totals.selfSourcedSales / totals.classifiedSales : null;

const payload = {
  sourceWorkbook: workbookPath.split("/").at(-1),
  sourceSheet: "Approved Sales",
  reportingPeriod: { start: periodStart, end: periodEnd, timezone: "Australia/Melbourne" },
  rule: "Sale From Allocated Lead and Self Sourced counts come from governed exact source attribution; percentages divide by classified sales only; Attribution Withheld is excluded from the split and disclosed separately.",
  sourceApprovedSalesRows: rows.length,
  sourceRowsInMondayFridayPeriod: inPeriodRows.length,
  includedSalesRows: includedRows.length,
  excludedSalesRows: inPeriodRows.length - includedRows.length,
  totals,
  salespeople,
};

if (salespeople.length !== reportData.salespeople.length) throw new Error("Salesperson sales split does not cover every report salesperson");
if (totals.allocatedSales + totals.selfSourcedSales + totals.attributionWithheldSales !== includedRows.length) throw new Error("Sales source split does not reconcile to included sales rows");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...payload.reportingPeriod, sourceRows: rows.length, inPeriodRows: inPeriodRows.length, includedSalesRows: includedRows.length, excludedSalesRows: payload.excludedSalesRows, totals }, null, 2));
