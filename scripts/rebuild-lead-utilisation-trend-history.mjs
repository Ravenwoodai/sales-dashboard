import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { appendSnapshot } = require("../src/leadUtilisationTrends.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentsFrom(argv) {
  const values = { reports: [], ensureSalespersonExclusions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--report-data") values.reports.push(argv[++index]);
    else if (token === "--output") values.output = argv[++index];
    else if (token === "--ensure-salesperson-exclusion") values.ensureSalespersonExclusions.push(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  return values;
}

const args = argumentsFrom(process.argv.slice(2));
if (!args.reports.length) throw new Error("Provide at least one --report-data path.");
const outputPath = path.resolve(args.output || path.join(root, "data", "store", "lead-utilisation-trend-history.json"));
const reports = [];
for (const reportPath of args.reports) {
  const absolutePath = path.resolve(reportPath);
  const data = JSON.parse(await fs.readFile(absolutePath, "utf8"));
  const exclusions = data.exclusions || (data.exclusions = {});
  exclusions.salespeople = [...new Set([...(exclusions.salespeople || []), ...args.ensureSalespersonExclusions].map((name) => String(name || "").trim()).filter(Boolean))];
  reports.push({ absolutePath, data });
}
reports.sort((a, b) => String(a.data.reportingPeriod?.startDate).localeCompare(String(b.data.reportingPeriod?.startDate)));

const added = [];
for (const report of reports) {
  const { history, snapshot } = appendSnapshot(outputPath, report.data);
  added.push({
    source: report.absolutePath,
    period: snapshot.period,
    snapshotHash: snapshot.contentHash,
    retainedRevisions: history.snapshots.length,
  });
}

console.log(JSON.stringify({ outputPath, reportsProcessed: added.length, snapshots: added }, null, 2));
