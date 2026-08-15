"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  MANIFEST_SCHEMA,
  interpolate,
  runWeeklyLeadManagement,
} = require("../src/weeklyLeadManagementOrchestrator");
const { exclusionPolicySha256 } = require("../src/weeklyLeadUtilisationOrchestrator");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weekly-lead-management-"));
}

function exclusionReportConfig() {
  const report = {
    managerTeamExclusions: ["Excluded Manager"],
    salespersonExclusions: ["Excluded Salesperson"],
    exclusionDisplay: "Excluded Manager team and Excluded Salesperson",
  };
  return { ...report, exclusionPolicySha256: exclusionPolicySha256(report) };
}

function createEvidenceDatabase(filePath) {
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
    INSERT INTO extraction_runs VALUES (
      'test_run', 'approved_sales', 'carma_approved_sales_show_new_customers_false.v1',
      0, 'complete', '2026-07-27', '2026-08-02', '2026-08-03T00:00:00.000Z', 10
    );
  `);
  db.close();
}

test("combined weekly orchestration contract and tokens fail closed", () => {
  assert.equal(MANIFEST_SCHEMA, "weekly_lead_management_orchestrator.v3");
  assert.equal(interpolate("{{runId}}/report.xlsx", { runId: "2026-07-27_to_2026-07-31" }), "2026-07-27_to_2026-07-31/report.xlsx");
  assert.throws(() => interpolate("{{missing}}", {}), /Unknown configuration token/);
});

test("combined weekly dry run stops before voicemail and report generation", async () => {
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
    carmaEvidence: { databasePath },
    report: {
      outputRoot: path.join(directory, "lead-output"),
      logoPath,
      ...exclusionReportConfig(),
    },
    leadManagement: { outputRoot: path.join(directory, "management-output") },
  }));

  const result = await runWeeklyLeadManagement({
    root: path.resolve(__dirname, ".."),
    configPath,
    startDate: "2026-07-27",
    dryRun: true,
    acquire: false,
    sendEmail: false,
  });

  assert.equal(result.manifest.status, "dry_run_complete");
  assert.deepEqual(result.manifest.stages.map((stage) => stage.id), ["build_lead_utilisation_source_pack"]);
  assert.equal(result.manifest.stages[0].status, "complete");
  assert.equal(fs.existsSync(result.manifestPath), true);
  assert.equal(path.basename(result.manifestPath), "dry-run-manifest.json");
  assert.equal(fs.existsSync(path.join(result.outputDir, "Weekly_Lead_Management_Report_2026-07-27_to_2026-07-31.xlsx")), false);
});
