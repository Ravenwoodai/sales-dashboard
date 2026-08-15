"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  addDays,
  assertExclusionPolicy,
  exclusionPolicySha256,
  interpolate,
  reportingPeriod,
  resolveSingleFile,
  runCommand,
  runWeeklyLeadUtilisation,
  verifyEvidencePeriod,
  weeklyLeadUtilisationTrendContract,
} = require("../src/weeklyLeadUtilisationOrchestrator");
const { retainWeeklySources } = require("../src/weeklyPerformanceSourceConfig");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weekly-lead-utilisation-"));
}

function exclusionReportConfig(overrides = {}) {
  const report = {
    managerTeamExclusions: ["Excluded Manager"],
    salespersonExclusions: ["Excluded Salesperson"],
    exclusionDisplay: "Excluded Manager team and Excluded Salesperson",
    ...overrides,
  };
  return { ...report, exclusionPolicySha256: exclusionPolicySha256(report) };
}

function createEvidenceDatabase(filePath, options = {}) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE extraction_runs (
      run_id TEXT PRIMARY KEY,
      dataset_type TEXT NOT NULL,
      population_contract TEXT NOT NULL,
      show_new_customers_only INTEGER NOT NULL,
      completeness_status TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      row_count INTEGER NOT NULL
    ) STRICT;
  `);
  db.prepare(`
    INSERT INTO extraction_runs
      (run_id, dataset_type, population_contract, show_new_customers_only, completeness_status,
       period_start, period_end, extracted_at, row_count)
    VALUES (?, 'approved_sales', ?, ?, ?, ?, ?, '2026-08-07T00:00:00.000Z', ?)
  `).run(
    "test_run",
    options.populationContract || "carma_approved_sales_show_new_customers_false.v1",
    options.showNewCustomersOnly || 0,
    options.completenessStatus || "complete",
    options.startDate || "2026-07-27",
    options.endDate || "2026-08-02",
    options.rowCount || 10,
  );
  db.close();
}

test("reporting period is a Monday-to-Friday week with a Sunday source envelope", () => {
  assert.deepEqual(reportingPeriod("2026-07-27"), {
    startDate: "2026-07-27",
    endDate: "2026-07-31",
    sourceEndDate: "2026-08-02",
    timezone: "Australia/Melbourne",
  });
  assert.equal(addDays("2026-12-28", 6), "2027-01-03");
  assert.throws(() => reportingPeriod("2026-07-28"), /must be a Monday/);
});

test("interpolation fails closed on unknown tokens", () => {
  assert.equal(interpolate("{{periodStart}}/file.csv", { periodStart: "2026-07-27" }), "2026-07-27/file.csv");
  assert.throws(() => interpolate("{{missing}}", {}), /Unknown orchestration token/);
});

test("personnel exclusions are configuration-driven and hash locked", () => {
  const report = exclusionReportConfig();
  assert.equal(assertExclusionPolicy(report).sha256, report.exclusionPolicySha256);
  assert.throws(
    () => assertExclusionPolicy({ ...report, salespersonExclusions: ["Changed Person"] }),
    /do not match/,
  );
});

test("weekly trend contract is mandatory and defaults to the retained 100-allocation policy", () => {
  const root = path.resolve(__dirname, "..");
  const defaultContract = weeklyLeadUtilisationTrendContract({ report: {} }, { root }, root);
  assert.equal(defaultContract.personMinimumAllocations, 100);
  assert.equal(defaultContract.trendHistoryPath, path.join(root, "data", "store", "lead-utilisation-trend-history.json"));
  assert.throws(
    () => weeklyLeadUtilisationTrendContract({ report: { personMinimumAllocations: 0 } }, { root }, root),
    /positive number/,
  );
});

test("source wildcard must resolve to exactly one file", () => {
  const directory = temporaryDirectory();
  fs.writeFileSync(path.join(directory, "WeeklyCallExport_a.csv"), "a");
  assert.equal(
    resolveSingleFile(path.join(directory, "WeeklyCallExport_*.csv"), {}, directory, "calls"),
    path.join(directory, "WeeklyCallExport_a.csv"),
  );
  fs.writeFileSync(path.join(directory, "WeeklyCallExport_b.csv"), "b");
  assert.throws(() => resolveSingleFile(path.join(directory, "WeeklyCallExport_*.csv"), {}, directory, "calls"), /exactly one file/);
});

test("Windows command scripts run through the command host", { skip: process.platform !== "win32" }, () => {
  const directory = temporaryDirectory();
  const commandPath = path.join(directory, "proof.cmd");
  fs.writeFileSync(commandPath, "@echo off\r\necho command-script-ok\r\n");
  const result = runCommand({ executable: commandPath, args: [], cwd: directory }, { label: "Command script proof" });
  assert.match(result.stdout, /command-script-ok/);
});

test("weekly imports retain earlier immutable sources and deduplicate the selected week", () => {
  const directory = temporaryDirectory();
  const prior = path.join(directory, "prior.csv");
  const current = path.join(directory, "current.csv");
  fs.writeFileSync(prior, "prior");
  fs.writeFileSync(current, "current");
  assert.deepEqual(
    retainWeeklySources({
      sources: [
        { path: prior, role: "weekly_allocation" },
        { path: current, role: "weekly_allocation" },
      ],
      legacyPath: current,
      newPath: current,
      role: "weekly_allocation",
    }).map((source) => source.path),
    [prior, current],
  );
});

test("governed evidence verification rejects a filtered population", () => {
  const directory = temporaryDirectory();
  const validPath = path.join(directory, "valid.sqlite");
  createEvidenceDatabase(validPath);
  assert.equal(verifyEvidencePeriod(validPath, "2026-07-27", "2026-08-02").row_count, 10);

  const filteredPath = path.join(directory, "filtered.sqlite");
  createEvidenceDatabase(filteredPath, { showNewCustomersOnly: 1 });
  assert.throws(() => verifyEvidencePeriod(filteredPath, "2026-07-27", "2026-08-02"), /not governed and complete/);
});

test("dry run resolves source hashes and writes a non-mutating manifest", async () => {
  const directory = temporaryDirectory();
  const allocationPath = path.join(directory, "allocation.csv");
  const callPath = path.join(directory, "calls.csv");
  const logoPath = path.join(directory, "logo.png");
  const databasePath = path.join(directory, "carma.sqlite");
  fs.writeFileSync(allocationPath, "allocation");
  fs.writeFileSync(callPath, "calls");
  fs.writeFileSync(logoPath, "logo");
  createEvidenceDatabase(databasePath);
  const configPath = path.join(directory, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: "weekly_lead_utilisation_orchestrator.v1",
    timezone: "Australia/Melbourne",
    sources: { allocationPath, callPath },
    acquisition: {
      allocationCommand: { executable: "node", args: ["--version"], cwd: directory },
      callCommand: { executable: "node", args: ["--version"], cwd: directory },
    },
    carmaEvidence: { databasePath },
    report: {
      outputRoot: path.join(directory, "outputs"),
      logoPath,
      ...exclusionReportConfig(),
    },
  }));

  const result = await runWeeklyLeadUtilisation({
    root: path.resolve(__dirname, ".."),
    configPath,
    startDate: "2026-07-27",
    dryRun: true,
    acquire: true,
    sendEmail: false,
  });
  assert.equal(result.manifest.status, "dry_run_complete");
  assert.equal(result.manifest.stages.some((stage) => stage.id === "import_weekly_exports"), false);
  assert.equal(result.manifest.stages.some((stage) => stage.id === "acquire_weekly_allocation"), true);
  assert.equal(result.manifest.stages.some((stage) => stage.id === "acquire_weekly_calls"), true);
  assert.equal(result.manifest.sources.allocation.fileName, "allocation.csv");
  assert.equal(fs.existsSync(result.manifestPath), true);
  assert.equal(path.basename(result.manifestPath), "dry-run-manifest.json");
});
