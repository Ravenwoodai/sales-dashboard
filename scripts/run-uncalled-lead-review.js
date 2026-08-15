#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const result = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") result.force = true;
    else if (token.startsWith("--")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      result[token.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${token}`);
  }
  return result;
}

function datePlus(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date: ${dateText}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertMonday(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.getUTCDay() !== 1) throw new Error(`--start must be a Monday in YYYY-MM-DD format: ${dateText}`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fingerprint(files) {
  const hash = crypto.createHash("sha256");
  for (const filePath of files) {
    hash.update(path.resolve(filePath));
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function resolvePython(configured) {
  if (configured) return path.resolve(configured);
  const bundled = path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  return fs.existsSync(bundled) ? bundled : "python";
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} exited with status ${result.status}`);
}

function assertSignature(filePath, signature, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} was not created: ${filePath}`);
  const bytes = fs.readFileSync(filePath).subarray(0, signature.length);
  if (!bytes.equals(signature)) throw new Error(`${label} has an invalid file signature: ${filePath}`);
}

function outputHashesMatch(manifest) {
  return manifest.outputs.every((item) => fs.existsSync(item.path) && sha256File(item.path) === item.sha256);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.start) throw new Error("Usage: npm run report:uncalled-lead-review -- --start YYYY-MM-DD [--force]");
  assertMonday(args.start);

  const endDate = datePlus(args.start, 4);
  const sunday = datePlus(args.start, 6);
  const runId = `${args.start}_to_${endDate}`;
  const manifestPath = path.resolve(args.manifest || path.join(ROOT, "data", "carma", "raw", "weekly-performance-exports", `manifest_${args.start}_to_${sunday}.json`));
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No governed weekly allocation manifest exists for ${args.start} to ${endDate}. Expected: ${manifestPath}. The report was not estimated.`);
  }
  const configPath = path.resolve(args.config || path.join(ROOT, "config", "weekly-lead-utilisation.local.json"));
  const rulesPath = path.resolve(args.rules || path.join(ROOT, "config", "uncalled-lead-review-rules.json"));
  const builderPath = path.join(ROOT, "scripts", "build-uncalled-lead-review.mjs");
  const corePath = path.join(ROOT, "src", "uncalledLeadReview.js");
  const pdfRendererPath = path.join(ROOT, "scripts", "render-uncalled-lead-review-pdf.py");
  const sourceFingerprint = fingerprint([manifestPath, configPath, rulesPath, builderPath, corePath, pdfRendererPath]);
  const outputRoot = path.resolve(args["output-root"] || path.join(ROOT, "outputs", "uncalled-lead-review"));
  const outputDir = path.join(outputRoot, runId);
  const orchestrationPath = path.join(outputDir, "orchestration-manifest.json");
  const workbookPath = path.join(outputDir, `Uncalled_Lead_Review_${runId}.xlsx`);
  const pdfPath = path.join(outputDir, `Uncalled_Lead_Review_${runId}.pdf`);
  const dataPath = path.join(outputDir, "report_data.json");

  if (fs.existsSync(orchestrationPath) && !args.force) {
    const prior = JSON.parse(fs.readFileSync(orchestrationPath, "utf8"));
    if (prior.status === "complete" && prior.sourceFingerprint === sourceFingerprint && outputHashesMatch(prior)) {
      process.stdout.write(`${JSON.stringify({ status: "already-complete", runId, workbookPath, pdfPath }, null, 2)}\n`);
      return;
    }
    throw new Error(`Existing output for ${runId} does not match the current source or generator. Review it, then rerun with --force to replace the generated files.`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  run(process.execPath, [builderPath, "--start", args.start, "--manifest", manifestPath, "--config", configPath, "--rules", rulesPath, "--output", outputDir, "--output-root", outputRoot]);
  run(resolvePython(args.python), [pdfRendererPath, "--data", dataPath, "--output", pdfPath]);
  assertSignature(workbookPath, Buffer.from([0x50, 0x4b]), "Workbook");
  assertSignature(pdfPath, Buffer.from("%PDF-"), "PDF");
  const qa = JSON.parse(fs.readFileSync(path.join(outputDir, "qa.json"), "utf8"));
  if (qa.qaChecks.some((check) => check.result !== "PASS") || qa.formulaErrorMatches !== 0) throw new Error(`Generated QA failed for ${runId}`);
  const outputs = [workbookPath, pdfPath, dataPath, path.join(outputDir, "qa.json")].map((filePath) => ({ path: filePath, sha256: sha256File(filePath), bytes: fs.statSync(filePath).size }));
  const completed = { schemaVersion: "uncalled_lead_review_orchestration.v1", status: "complete", runId, generatedAt: new Date().toISOString(), sourceFingerprint, manifestPath, outputs };
  fs.writeFileSync(orchestrationPath, `${JSON.stringify(completed, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "complete", runId, workbookPath, pdfPath, totals: qa.totals }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
