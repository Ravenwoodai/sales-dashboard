"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { loadCarmaEvidence, readValidatedCarmaFacts, resolveCarmaEvidencePath } = require("../src/carmaEvidence");
const {
  isoDate: normalizeCarmaWallClockTimestamp,
  validateAllApprovedSalesSource
} = require("../scripts/build-carma-evidence");
const { createServer } = require("../src/main");

function createCarmaFixture(directory) {
  const databasePath = path.join(directory, "carma-evidence.sqlite");
  const db = new DatabaseSync(databasePath);
  const digest = "a".repeat(64);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE extraction_runs (
      run_id TEXT PRIMARY KEY,
      dataset_type TEXT NOT NULL,
      population_contract TEXT NOT NULL,
      show_new_customers_only INTEGER NOT NULL,
      completeness_status TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL,
      source_report_sha256 TEXT NOT NULL,
      source_manifest_sha256 TEXT NOT NULL,
      extraction_audit_sha256 TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      notes TEXT NOT NULL
    );
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
      validation_status TEXT NOT NULL,
      run_id TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL
    );
    CREATE TABLE crm_allocations (allocation_id TEXT PRIMARY KEY);
    CREATE TABLE crm_credit_awards (credit_award_id TEXT PRIMARY KEY);
    CREATE TABLE crm_staff_identities (identity_id TEXT PRIMARY KEY);
    CREATE TABLE crm_validation_issues (issue_id TEXT PRIMARY KEY);
    INSERT INTO meta VALUES
      ('schema_version', 'carma_evidence.v3'),
      ('approval_timestamp_semantics', 'australia_sydney_wall_clock_components.v1'),
      ('policy_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('lead_source_classification_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('external_credit_policy_rule_version', 'seller_allocation_within_28_days_lenient.v1'),
      ('generated_at', '2026-07-27T00:00:00.000Z'),
      ('join_rule', 'exact customer_id only'),
      ('campaign_source_separation', 'enforced');
    INSERT INTO crm_customers VALUES ('customer-1', 'Google Maps', '2026-07-01');
    INSERT INTO extraction_runs VALUES (
      'sales-run-1', 'approved_sales', 'carma_approved_sales_show_new_customers_false.v1',
      0, 'complete', '2026-07-01', '2026-07-31',
      '2026-07-29T00:00:00.000Z', 'provenance-1',
      '${digest}', '${digest}', '${digest}', 1, 'Fixture coverage'
    );
    INSERT INTO crm_orders VALUES (
      '11890000', 'customer-1', 'Example Customer', 'Riley Example',
      '2026-07-10T00:00:00.000Z', '2026-07-12T04:00:00.000Z', 500,
      'Google Maps', 1, '11a April 26(Batch)',
      'Company Sourced', 'actual_seller_any_pre_sale_allocation.v1',
      'Company Sourced — the actual seller had an exact recorded allocation before the sale.',
      'Google Maps', 500,
      'Facebook', 500, 500, 'Carma source differs from policy source', 1, 'contradiction',
      'sales-run-1', 'provenance-1'
    );
  `);
  db.close();
  return databasePath;
}

function promoteFixtureToV4(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    UPDATE meta SET value = 'carma_evidence.v4' WHERE key = 'schema_version';
    UPDATE extraction_runs SET row_count = 2 WHERE run_id = 'sales-run-1';
    INSERT INTO crm_customers VALUES ('customer-2', 'Referral', '2026-07-05');
    CREATE TABLE crm_order_timestamp_exceptions (
      order_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      actual_seller TEXT NOT NULL,
      sale_value REAL NOT NULL,
      acquisition_source_type TEXT NOT NULL,
      acquisition_source_proven INTEGER NOT NULL,
      approval_timestamp_status TEXT NOT NULL,
      approval_evidence TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL
    );
    INSERT INTO crm_order_timestamp_exceptions VALUES (
      '11890001', 'sales-run-1', 'customer-2', 'Timestamp Exception Customer', 'Jordan Example',
      750, 'Referral', 1, 'unavailable_after_two_read_only_captures',
      'No explicit approval timestamp after two independent read-only captures.', 'provenance-1'
    );
  `);
  db.close();
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
  assert.equal(report.approvalTimestampSemantics, "australia_sydney_wall_clock_components.v1");
  assert.equal(report.rows[0].policyCreditedSource, "Google Maps");
  assert.equal(Object.prototype.hasOwnProperty.call(report.rows[0], "phone"), false);
});

test("Carma evidence v4 retains timestamp exceptions in totals without inferring source attribution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-v4-timestamp-exception-"));
  const databasePath = createCarmaFixture(directory);
  promoteFixtureToV4(databasePath);
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, true);
  assert.equal(report.contractSchemaVersion, "carma_evidence.v4");
  assert.equal(report.totals.orders, 2);
  assert.equal(report.totals.companySourcedOrders, 1);
  assert.equal(report.totals.selfSourcedOrders, 0);
  assert.equal(report.totals.attributionWithheldOrders, 1);
  assert.match(report.limitations.join(" "), /no pre-sale timing decision/i);
});

test("Carma evidence v4 retains an explicit approval time while withholding only incomplete source attribution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-v4-source-attribution-exception-"));
  const databasePath = createCarmaFixture(directory);
  promoteFixtureToV4(databasePath);
  const db = new DatabaseSync(databasePath);
  db.exec(`
    ALTER TABLE crm_order_timestamp_exceptions ADD COLUMN sale_approved_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_order_timestamp_exceptions ADD COLUMN attribution_withheld_reason TEXT NOT NULL DEFAULT '';
    UPDATE crm_order_timestamp_exceptions
    SET sale_approved_at = '2026-07-29T13:31:00.000Z',
        approval_timestamp_status = 'explicit',
        attribution_withheld_reason = 'allocation_history_unavailable_after_targeted_read_only_capture',
        approval_evidence = 'Approval timestamp verified; exact-customer allocation history incomplete.'
    WHERE order_id = '11890001';
  `);
  db.close();

  const facts = readValidatedCarmaFacts({ databasePath });
  const withheld = facts.orders.find((row) => row.order_id === "11890001");
  assert.equal(withheld.sale_approved_at, "2026-07-29T13:31:00.000Z");
  assert.equal(withheld.approval_timestamp_status, "explicit");
  assert.equal(withheld.lead_source_classification, "Attribution Withheld");

  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, true);
  assert.equal(report.totals.attributionWithheldOrders, 1);
  assert.match(report.limitations.join(" "), /complete exact-customer allocation history was unavailable/i);
});

test("Carma evidence fails closed when a phone-named matching column enters the contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-phone-boundary-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec("ALTER TABLE crm_orders ADD COLUMN phone_match TEXT");
  db.close();
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, false);
  assert.equal(report.code, "CARMA_EVIDENCE_INVALID");
  assert.match(report.error, /phone-named matching columns are prohibited/i);
});

test("Carma evidence fails closed when approved-sales extraction counts do not reconcile", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-coverage-boundary-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec("UPDATE extraction_runs SET row_count = 2 WHERE run_id = 'sales-run-1'");
  db.close();
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, false);
  assert.equal(report.code, "CARMA_EVIDENCE_INVALID");
  assert.match(report.error, /do not reconcile/i);
});

test("Carma evidence fails closed for a self-consistent new-customer-only approved-sales run", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-population-boundary-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec(`
    UPDATE extraction_runs
    SET population_contract = 'carma_approved_sales_new_customers_only.v1',
        show_new_customers_only = 1
    WHERE run_id = 'sales-run-1'
  `);
  db.close();
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, false);
  assert.equal(report.code, "CARMA_EVIDENCE_INVALID");
  assert.match(report.error, /not verified unfiltered all-sales populations/i);
});

test("Carma evidence fails closed without the exact approval timestamp semantics contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-time-contract-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec("DELETE FROM meta WHERE key = 'approval_timestamp_semantics'");
  db.close();
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, false);
  assert.equal(report.code, "CARMA_EVIDENCE_INVALID");
  assert.match(report.error, /approval timestamp semantics/i);
});

test("Carma evidence rejects an offset-bearing approval even when metadata claims wall-clock semantics", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-time-row-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec("UPDATE crm_orders SET sale_approved_at = '2026-07-12T14:00:00+10:00'");
  db.close();
  const report = loadCarmaEvidence({ databasePath });
  assert.equal(report.available, false);
  assert.equal(report.code, "CARMA_EVIDENCE_INVALID");
  assert.match(report.error, /approval timestamp.*violate/i);
});

test("Carma evidence builder preserves source wall-clock components and rejects offset conversion", () => {
  assert.equal(
    normalizeCarmaWallClockTimestamp("2026-07-24T13:03:00.000Z"),
    "2026-07-24T13:03:00.000Z"
  );
  assert.equal(
    normalizeCarmaWallClockTimestamp("2026-07-24"),
    "2026-07-24T00:00:00.000Z"
  );
  assert.equal(
    normalizeCarmaWallClockTimestamp("24-Jul-26"),
    "2026-07-24T00:00:00.000Z"
  );
  assert.throws(
    () => normalizeCarmaWallClockTimestamp("2026-07-24T13:03:00+10:00"),
    /wall_clock_components/i
  );
  assert.throws(
    () => normalizeCarmaWallClockTimestamp("2026-02-30T13:03:00.000Z"),
    /wall_clock_components/i
  );
});

test("Carma evidence builder rejects a manifest whose report parameters select new customers only", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "carma-source-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  const auditPath = path.join(directory, "audit.json");
  const sourceReportPath = path.join(directory, "approved-sales.xlsx");
  fs.writeFileSync(manifestPath, JSON.stringify({
    reportName: "Approved Sales by Customer for Period",
    reportParameters: {
      startDate: "20/07/2026",
      endDate: "26/07/2026",
      showNewCustomersInPeriod: true,
      summaryOnly: false,
      assetGroups: "All"
    },
    requestedOrders: 1,
    orderIds: ["order-1"],
    records: {
      "order-1": { status: "complete", allocationStatus: "downloaded" }
    }
  }));
  fs.writeFileSync(auditPath, JSON.stringify({
    complete: true,
    reportPeriod: { start: "2026-07-20", end: "2026-07-26" },
    requestedOrders: 1,
    completedEvidenceOrders: 1,
    sourceOrders: 1,
    sourceOrderLineRows: 1,
    allocationRows: 0,
    saleDatesOutsidePeriod: 0
  }));
  fs.writeFileSync(sourceReportPath, "fixture");
  assert.throws(() => validateAllApprovedSalesSource({
    decisions: [{ orderNumber: "order-1" }],
    allocations: [],
    manifestPath,
    auditPath,
    sourceReportPath,
    periodStart: "2026-07-20",
    periodEnd: "2026-07-26"
  }), /Show New Customers In Period = False/i);
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
