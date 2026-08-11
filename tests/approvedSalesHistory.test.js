"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
  APPROVED_SALES_HISTORY_SCHEMA_VERSION,
  readApprovedSalesHistorySummary
} = require("../src/approvedSalesHistory");
const { configurePersonnelExclusions } = require("../src/personnelExclusions");

function createFixture(directory, schemaVersion = APPROVED_SALES_HISTORY_SCHEMA_VERSION) {
  const databasePath = path.join(directory, "approved-sales-history.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE extraction_runs (
      period_id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      all_order_count INTEGER NOT NULL,
      new_customer_order_count INTEGER NOT NULL,
      all_approved_value REAL NOT NULL,
      new_customer_approved_value REAL NOT NULL,
      matched_order_field_variation_count INTEGER NOT NULL,
      classification_quality TEXT NOT NULL,
      reconciliation_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE approved_sales_history (
      period_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      approved_value REAL NOT NULL,
      is_new_customer INTEGER NOT NULL,
      PRIMARY KEY (period_id, order_id),
      FOREIGN KEY (period_id) REFERENCES extraction_runs(period_id)
    ) STRICT;
  `);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("schema_version", schemaVersion);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run(
    "new_customer_definition",
    "Exact same-period report membership"
  );
  db.prepare("INSERT INTO meta VALUES (?, ?)").run(
    "non_membership_meaning",
    "Not selected; not proof of an existing customer"
  );
  db.prepare("INSERT INTO meta VALUES (?, ?)").run(
    "historical_marker_cliff_start",
    "2024-01-01"
  );
  db.prepare("INSERT INTO meta VALUES (?, ?)").run(
    "matching_rule",
    "exact period_id + exact order_id only"
  );
  db.prepare(`
    INSERT INTO extraction_runs VALUES (
      '2025', '2025-01-01', '2025-12-31',
      2, 1, 900.0, 400.0, 1,
      'exact_report_membership',
      'exact_order_subset_reconciled_with_source_variations'
    )
  `).run();
  db.prepare("INSERT INTO approved_sales_history VALUES (?, ?, ?, ?)").run(
    "2025",
    "10000001",
    400,
    1
  );
  db.prepare("INSERT INTO approved_sales_history VALUES (?, ?, ?, ?)").run(
    "2025",
    "10000002",
    500,
    0
  );
  db.close();
  return databasePath;
}

test("approved-sales history summary exposes reconciled all/new counts without paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "approved-sales-history-"));
  const databasePath = createFixture(directory);
  const summary = readApprovedSalesHistorySummary({ databasePath });
  assert.equal(summary.available, true);
  assert.equal(summary.schemaVersion, APPROVED_SALES_HISTORY_SCHEMA_VERSION);
  assert.deepEqual(summary.rows[0], {
    periodId: "2025",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    period: "2025-01-01 to 2025-12-31",
    allApprovedOrders: 2,
    newCustomerOrders: 1,
    newCustomerShare: 50,
    allApprovedValue: 900,
    newCustomerApprovedValue: 400,
    matchedOrderFieldVariations: 1,
    classificationQuality: "exact_report_membership",
    reconciliationStatus: "exact_order_subset_reconciled_with_source_variations",
    sourceLabel: "Carma approved-sales all + new-customer report views"
  });
  assert.equal(
    summary.definitions.nonMembershipMeaning,
    "Not selected; not proof of an existing customer"
  );
  assert.doesNotMatch(JSON.stringify(summary), /approved-sales-history\.sqlite|tmp\\/i);
});

test("approved-sales history fails closed on an unsupported schema", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "approved-sales-history-schema-"));
  const databasePath = createFixture(directory, "unknown.v1");
  assert.throws(
    () => readApprovedSalesHistorySummary({ databasePath }),
    /unsupported schema/i
  );
});

test("approved-sales history reconciles source totals before excluding configured sellers", () => {
  configurePersonnelExclusions(["Excluded Seller"]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "approved-sales-history-exclusions-"));
  const databasePath = createFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec("ALTER TABLE approved_sales_history ADD COLUMN actual_seller TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE approved_sales_history SET actual_seller = ? WHERE order_id = ?")
    .run("Excluded Seller", "10000001");
  db.prepare("UPDATE approved_sales_history SET actual_seller = ? WHERE order_id = ?")
    .run("Riley Example", "10000002");
  db.close();

  const summary = readApprovedSalesHistorySummary({ databasePath });
  assert.equal(summary.available, true);
  assert.equal(summary.rows[0].sourceAllApprovedOrders, 2);
  assert.equal(summary.rows[0].allApprovedOrders, 1);
  assert.equal(summary.rows[0].allApprovedValue, 500);
  assert.equal(summary.rows[0].newCustomerOrders, 0);
  assert.equal(summary.rows[0].excludedPersonnelOrders, 1);
  assert.equal(summary.rows[0].excludedPersonnelApprovedValue, 400);
  assert.match(summary.definitions.personnelExclusionRule, /reconciled first/i);
  assert.doesNotMatch(JSON.stringify(summary), /Excluded Seller/);
});
