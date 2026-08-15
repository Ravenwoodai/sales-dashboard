import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function argsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Invalid argument: ${token}`);
    result[token.slice(2)] = argv[++index];
  }
  return result;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    windowsHide: true,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${options.label || path.basename(executable)} failed with exit code ${result.status}`);
}

const args = argsFrom(process.argv.slice(2));
for (const required of ["start", "end", "weekly-allocation", "base-db", "carma-reports-root", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
const startDate = args.start;
const endDate = args.end;
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("--start and --end must be an ordered YYYY-MM-DD period");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const carmaRoot = path.resolve(args["carma-reports-root"]);
const sourceXlsx = args["source-xlsx"] ? path.resolve(args["source-xlsx"]) : "";
const weeklyAllocation = path.resolve(args["weekly-allocation"]);
const baseDb = path.resolve(args["base-db"]);
const outputDir = path.resolve(args.output);
for (const requiredPath of [carmaRoot, weeklyAllocation, baseDb, ...(sourceXlsx ? [sourceXlsx] : [])]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Required source is missing: ${requiredPath}`);
}
fs.mkdirSync(outputDir, { recursive: true });
const carmaOutputRoot = path.resolve(args["carma-output-root"] || path.join(carmaRoot, "output", "weekly-approved-sales-evidence"));
const carmaTsx = path.join(carmaRoot, "node_modules", "tsx", "dist", "cli.mjs");
run(process.execPath, [carmaTsx, path.join(carmaRoot, "src", "build-weekly-approved-sales-evidence.ts"),
  "--start", startDate, "--end", endDate, "--output-root", carmaOutputRoot,
  ...(sourceXlsx ? ["--source-xlsx", sourceXlsx] : []),
  ...(args["source-audit"] ? ["--source-audit", path.resolve(args["source-audit"])] : []),
  ...(args["order-evidence-root"] ? ["--order-evidence-root", path.resolve(args["order-evidence-root"])] : []),
  ...(args.python ? ["--python", args.python] : []),
], { cwd: carmaRoot, label: "Carma Approved Sales exact-order evidence" });

const bundleDir = path.join(carmaOutputRoot, `${startDate}_to_${endDate}`);
const enrichedCsv = path.join(bundleDir, "approved-sales-enriched.csv");
const enrichmentManifest = path.join(bundleDir, "enrichment-manifest.json");
const browserManifest = path.join(args["order-evidence-root"] ? path.resolve(args["order-evidence-root"]) : path.join(bundleDir, "order-evidence"), "manifest.json");
const parserDir = path.join(outputDir, "allocation-parser");
run(process.execPath, [path.join(root, "scripts", "prepare-approved-sales-allocation-manifest.mjs"),
  "--period-start", startDate, "--period-end", endDate, "--csv", enrichedCsv,
  "--browser-manifest", browserManifest, "--weekly-allocation", weeklyAllocation, "--output", parserDir,
], { cwd: root, label: "Approved Sales allocation coverage" });

const python = args.python || path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
run(fs.existsSync(python) ? python : "python", [path.join(root, "scripts", "parse-approved-sales-allocations.py")], {
  cwd: root,
  env: { ALLOCATION_PARSER_OUTPUT_ROOT: parserDir },
  label: "Approved Sales allocation PDF parser",
});

run(process.execPath, [path.join(root, "scripts", "extend-carma-evidence-v4.mjs"),
  "--period-start", startDate, "--period-end", endDate, "--base-db", baseDb,
  "--csv", enrichedCsv, "--enrichment-manifest", enrichmentManifest,
  "--allocation-jsonl", path.join(parserDir, "allocation-history.jsonl"),
  "--allocation-index", path.join(parserDir, "allocation-index.json"),
  "--allocation-parse-manifest", path.join(parserDir, "allocation-parse-manifest.json"),
  "--allocation-coverage", path.join(parserDir, "coverage.json"),
  "--weekly-allocation", weeklyAllocation, "--output", outputDir,
], { cwd: root, label: "Governed weekly Carma evidence database build" });

const databasePath = path.join(outputDir, "carma-evidence.sqlite");
const { readValidatedCarmaFacts, ALL_APPROVED_SALES_POPULATION_CONTRACT } = require("../src/carmaEvidence");
const facts = readValidatedCarmaFacts({ databasePath, projection: "performance" });
const coverage = facts.coverageRows.find((row) => row.dataset_type === "approved_sales" && row.period_start === startDate && row.period_end === endDate);
if (!coverage || coverage.population_contract !== ALL_APPROVED_SALES_POPULATION_CONTRACT || Number(coverage.show_new_customers_only) !== 0 || coverage.completeness_status !== "complete" || Number(coverage.row_count) <= 0) {
  throw new Error("Final governed Approved Sales evidence period did not pass contract validation");
}
process.stdout.write(`${JSON.stringify({ status: "complete", period: { startDate, endDate }, databasePath, rowCount: coverage.row_count }, null, 2)}\n`);
