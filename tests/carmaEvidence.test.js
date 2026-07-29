"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { loadCarmaEvidence, resolveCarmaEvidencePath } = require("../src/carmaEvidence");
const { createServer } = require("../src/main");

function createCarmaFixture(directory) {
  const databasePath = path.join(directory, "carma-evidence.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE extraction_runs (run_id TEXT PRIMARY KEY);
    CREATE TABLE crm_source_provenance (provenance_id TEXT PRIMARY KEY);
    CREATE TABLE crm_customers (
      customer_id TEXT PRIMARY KEY,
      customer_import_source_type TEXT NOT NULL,
      customer_import_date TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      order_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      actual_seller TEXT NOT NULL,
      seller_allocation_date TEXT NOT NULL,
      sale_approved_at TEXT NOT NULL,
      sale_value REAL NOT NULL,
      acquisition_source_type TEXT NOT NULL,
      acquisition_source_proven INTEGER NOT NULL,
      campaign TEXT NOT NULL,
      lead_source_classification TEXT NOT NULL,
      lead_source_classification_rule_version TEXT NOT NULL,
      lead_source_classification_reason TEXT NOT NULL,
      policy_credit_source TEXT NOT NULL,
      allowable_external_credit REAL,
      carma_credited_source TEXT NOT NULL,
      carma_credited_value REAL NOT NULL,
      carma_external_credited_value REAL NOT NULL,
      reporting_finding TEXT NOT NULL,
      direct_reporting_error INTEGER NOT NULL,
      validation_status TEXT NOT NULL
    );
    CREATE TABLE crm_allocations (allocation_id TEXT PRIMARY KEY);
    CREATE TABLE crm_credit_awards (credit_award_id TEXT PRIMARY KEY);
    CREATE TABLE crm_staff_identities (identity_id TEXT PRIMARY KEY);
    CREATE TABLE crm_validation_issues (issue_id TEXT PRIMARY KEY);
    INSERT INTO meta VALUES
      ('schema_version', 'carma_evidence.v2'),
      ('policy_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('lead_source_classification_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('external_credit_policy_rule_version', 'seller_allocation_within_28_days_lenient.v1'),
      ('generated_at', '2026-07-27T00:00:00.000Z'),
      ('join_rule', 'exact customer_id only'),
      ('campaign_source_separation', 'enforced');
    INSERT INTO crm_customers VALUES ('customer-1', 'Google Maps', '2026-07-01');
    INSERT INTO crm_orders VALUES (
      '11890000', 'customer-1', 'Example Customer', 'Riley Example',
      '2026-07-10T00:00:00.000Z', '2026-07-12T04:00:00.000Z', 500,
      'Google Maps', 1, '11a April 26(Batch)',
      'Company Sourced', 'actual_seller_any_pre_sale_allocation.v1',
      'Company Sourced — the actual seller had an exact recorded allocation before the sale.',
      'Google Maps', 500,
      'Facebook', 500, 500, 'Carma source differs from policy source', 1, 'contradiction'
    );
  `);
  db.close();
  return databasePath;
}

function sampleCsv() {
  return [
    "dialled_phone_number,call_id,UserID,Mobile,CallTotalSeconds,call_date,call_time,ring_time_seconds,call_duration_seconds,AllocatedLeadID,customer_id,ContactId,Baz_DetailedNotes,transcription_text,CallType,call_direction,NoSaleType,CustomerCreatedBy,CustomerCreatedByType,CustomerCreateDate,CustomerImportDate,CustomerImportSource,Salesperson,Prefix,CallerID,IsNZCall,CallRegion,FoundContactID,FoundCustomerID,OrderCount",
    "redacted,call-1,user-1,,60,01/07/2026,09:00:00,2,58,lead-1,customer-1,contact-1,,,Click to dial,out,,system,LG,,01/07/2026,GoogleMaps,Riley Example,,,,,,,",
    ""
  ].join("\n");
}

test("Carma evidence opens read-only and joins calls only by exact customer_id", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-evidence-"));
  const databasePath = createCarmaFixture(directory);
  const report = loadCarmaEvidence({
    databasePath,
    calls: [
      {
        callId: "call-1",
        customerId: "customer-1",
        customerImportSource: "GoogleMaps",
        customerImportDate: "01/07/2026",
        salesperson: "Riley Example"
      },
      {
        callId: "call-no-match",
        customerId: "customer-2",
        customerImportSource: "GoogleMaps"
      }
    ]
  });
  assert.equal(report.available, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.totals.exactCustomerMatches, 1);
  assert.equal(report.totals.matchingCalls, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].joinProof, "Exact customer_id");
  assert.equal(report.rows[0].sourceComparison, "match");
  assert.equal(report.rows[0].importDateComparison, "match");
  assert.equal(report.rows[0].campaign, "11a April 26(Batch)");
  assert.equal(report.rows[0].leadSourceClassification, "Company Sourced");
  assert.equal(report.leadSourcePolicyVersion, "actual_seller_any_pre_sale_allocation.v1");
  assert.equal(report.externalCreditPolicyVersion, "seller_allocation_within_28_days_lenient.v1");
  assert.equal(report.rows[0].policyCreditedSource, "Google Maps");
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], "phone"), false);
});

test("Carma evidence configuration resolves CLI, environment, then local config", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-config-"));
  const configPath = path.join(directory, "carma-evidence.json");
  fs.writeFileSync(configPath, JSON.stringify({ databasePath: path.join(directory, "configured.sqlite") }));
  assert.equal(resolveCarmaEvidencePath(["--carma-evidence", "cli.sqlite"], {}, { carmaEvidenceConfigPath: configPath }), path.resolve("cli.sqlite"));
  assert.equal(resolveCarmaEvidencePath([], { SALES_DASHBOARD_CARMA_EVIDENCE_PATH: "env.sqlite" }, { carmaEvidenceConfigPath: configPath }), path.resolve("env.sqlite"));
  assert.equal(resolveCarmaEvidencePath([], {}, { carmaEvidenceConfigPath: configPath }), path.join(directory, "configured.sqlite"));
});

test("Sales Dashboard exposes configured Carma evidence in health, API, and Records UI", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-dashboard-"));
  const databasePath = createCarmaFixture(directory);
  const csvPath = path.join(directory, "calls.csv");
  const storePath = path.join(directory, "state.json");
  fs.writeFileSync(csvPath, sampleCsv(), "utf8");
  const server = createServer({ csvPath, storePath, carmaEvidencePath: databasePath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.carma_evidence_available, true);
    assert.equal(health.carma_evidence_read_only, true);
    assert.equal(health.carma_evidence_orders, 1);
    assert.equal(health.carma_evidence_exact_customer_matches, 1);

    const apiResponse = await fetch(`${baseUrl}/api/carma-evidence?errorsOnly=true`);
    const api = await apiResponse.json();
    assert.equal(apiResponse.status, 200);
    assert.equal(api.query.matchingRows, 1);
    assert.equal(api.rows[0].leadSourceClassification, "Company Sourced");
    assert.equal(api.rows[0].orderNumber, "11890000");

    const html = await fetch(`${baseUrl}/?view=records`).then((response) => response.text());
    assert.match(html, /Carma Sale & Lead-Source Evidence/);
    assert.match(html, /Carma linked read-only/);
    assert.match(html, /11890000/);
    assert.match(html, /Company Sourced/);
    assert.match(html, /Campaign: 11a April 26\(Batch\)/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
