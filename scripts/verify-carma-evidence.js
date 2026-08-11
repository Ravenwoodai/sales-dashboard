"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  ALL_APPROVED_SALES_POPULATION_CONTRACT,
  CARMA_APPROVAL_TIME_SEMANTICS,
  DEFAULT_OUTPUT_DIR,
  EXTERNAL_CREDIT_POLICY_VERSION,
  POLICY_VERSION,
  SCHEMA_VERSION
} = require("./build-carma-evidence");
const { validCarmaApprovalTimestamp } = require("../src/carmaEvidence");

const EXPECTED_APPROVED_SALES_RUNS = {
  carma_sales_all_2026_07_20_26: {
    source_report_sha256: "f2070b8a59781dc68b19640f6b092e1b57efd6ced8e721acf999a967d285ec0b",
    source_manifest_sha256: "91d62bb55f6c502370d58ed7f570b1d11ea7128ad700b9394ecfb14f8ebbeb8d",
    extraction_audit_sha256: "16f3bfec59dc54efe56a7dfdca5ff3aa9815b6ade31a36983734034d41e7f679"
  },
  carma_sales_all_2026_07_13_19: {
    source_report_sha256: "61fe1bddc2ca32df1a467799ad36524b4499174e57d9cb6b5e52ddbad5b75e2e",
    source_manifest_sha256: "9fd03fe703c9a45e7592b86b807fb56356d46910a1d6b7d7f6977d78ce8500a5",
    extraction_audit_sha256: "5c8a668514ecf6497df3e406c9f694604583148af262e657f664280b5e19e8f1"
  },
  carma_sales_all_2026_07_27_08_02: {
    source_report_sha256: "b84a4b96feaac5efadc04e4adbaaf923db71e7029bf6421b123e4efbb527661b",
    source_manifest_sha256: "8247d80f1290cc89badbb19e0139c7d2d7a7b261f1940c174401e4b6c9290508",
    extraction_audit_sha256: "70a1cc753f83b54a560c1919be87372ce18cd6cb99c850be8d02a5dc06d12430"
  }
};

function parseArgs(argv) {
  const index = argv.findIndex((value) => value === "--database" || value === "--db");
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);

  const configPath = path.join(__dirname, "..", "data", "store", "carma-evidence.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof config.databasePath === "string" && config.databasePath.trim()) {
      return path.resolve(__dirname, "..", config.databasePath);
    }
  }
  return path.join(DEFAULT_OUTPUT_DIR, "carma-evidence.sqlite");
}

function verify(databasePath) {
  if (!fs.existsSync(databasePath)) throw new Error(`Carma evidence database not found: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
  const invalidApprovalTimestamps = db.prepare("SELECT sale_approved_at FROM crm_orders").all()
    .filter((row) => !validCarmaApprovalTimestamp(row.sale_approved_at)).length;
  const invalidExceptionApprovalTimestamps = db.prepare(`
    SELECT sale_approved_at FROM crm_order_timestamp_exceptions
    WHERE approval_timestamp_status = 'explicit'
  `).all().filter((row) => !validCarmaApprovalTimestamp(row.sale_approved_at)).length;
  const currentAllSales = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      ROUND(SUM(sale_value), 2) AS sale_value,
      SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
      SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced
    FROM crm_orders
    WHERE run_id = 'carma_sales_all_2026_07_20_26'
  `).get();
  const priorAllSales = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      ROUND(SUM(sale_value), 2) AS sale_value,
      SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
      SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced
    FROM crm_orders
    WHERE run_id = 'carma_sales_all_2026_07_13_19'
  `).get();
  const nextAllSales = db.prepare(`
    SELECT
      COUNT(*) AS classified_orders,
      ROUND(SUM(sale_value), 2) AS classified_value,
      SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
      SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced,
      (SELECT COUNT(*) FROM crm_order_timestamp_exceptions WHERE run_id = 'carma_sales_all_2026_07_27_08_02') AS attribution_withheld,
      ROUND(
        SUM(sale_value) +
        (SELECT COALESCE(SUM(sale_value), 0) FROM crm_order_timestamp_exceptions WHERE run_id = 'carma_sales_all_2026_07_27_08_02'),
        2
      ) AS complete_value
    FROM crm_orders
    WHERE run_id = 'carma_sales_all_2026_07_27_08_02'
  `).get();
  const approvedSalesRunFingerprints = Object.fromEntries(db.prepare(`
    SELECT run_id, source_report_sha256, source_manifest_sha256, extraction_audit_sha256
    FROM extraction_runs
    WHERE dataset_type = 'approved_sales'
    ORDER BY run_id
  `).all().map((row) => [row.run_id, {
    source_report_sha256: row.source_report_sha256,
    source_manifest_sha256: row.source_manifest_sha256,
    extraction_audit_sha256: row.extraction_audit_sha256
  }]));
  const approvedSalesSourceFingerprintsAccepted = Object.entries(EXPECTED_APPROVED_SALES_RUNS).every(
    ([runId, expected]) => Object.entries(expected).every(
      ([field, hash]) => approvedSalesRunFingerprints[runId]?.[field] === hash
    )
  ) && Object.keys(approvedSalesRunFingerprints).length === Object.keys(EXPECTED_APPROVED_SALES_RUNS).length;
  const result = {
    schemaVersion: "carma_evidence_verification.v1",
    databaseFileName: path.basename(databasePath),
    contractSchemaVersion: meta.schema_version || "",
    schemaVersionAccepted: meta.schema_version === "carma_evidence.v4",
    approvalTimestampSemantics: meta.approval_timestamp_semantics || "",
    approvalTimestampSemanticsAccepted:
      meta.approval_timestamp_semantics === CARMA_APPROVAL_TIME_SEMANTICS,
    invalidApprovalTimestamps,
    invalidExceptionApprovalTimestamps,
    approvalTimestampsAccepted: invalidApprovalTimestamps === 0 && invalidExceptionApprovalTimestamps === 0,
    leadSourcePolicyVersion: meta.lead_source_classification_rule_version || meta.policy_rule_version || "",
    leadSourcePolicyAccepted:
      (meta.lead_source_classification_rule_version || meta.policy_rule_version) === POLICY_VERSION,
    externalCreditPolicyVersion: meta.external_credit_policy_rule_version || "",
    externalCreditPolicyAccepted:
      meta.external_credit_policy_rule_version === EXTERNAL_CREDIT_POLICY_VERSION,
    readOnlyOpen: true,
    integrityCheck: db.prepare("PRAGMA integrity_check").get().integrity_check,
    foreignKeyIssueCount: db.prepare("PRAGMA foreign_key_check").all().length,
    counts: {
      customers: db.prepare("SELECT COUNT(*) AS count FROM crm_customers").get().count,
      orders: db.prepare("SELECT COUNT(*) AS count FROM crm_orders").get().count,
      timestampExceptions: db.prepare("SELECT COUNT(*) AS count FROM crm_order_timestamp_exceptions").get().count,
      allocations: db.prepare("SELECT COUNT(*) AS count FROM crm_allocations").get().count,
      credits: db.prepare("SELECT COUNT(*) AS count FROM crm_credit_awards").get().count,
      exactMatchedCustomers: db.prepare("SELECT COUNT(DISTINCT customer_id) AS count FROM dashboard_call_matches").get().count
    },
    currentAllSales,
    priorAllSales,
    nextAllSales,
    approvedSalesRunFingerprints,
    approvedSalesSourceFingerprintsAccepted,
    approvedSalesPopulationContractViolations: db.prepare(`
      SELECT COUNT(*) AS count
      FROM extraction_runs
      WHERE dataset_type = 'approved_sales'
        AND (
          population_contract <> ?
          OR show_new_customers_only <> 0
          OR completeness_status <> 'complete'
          OR LENGTH(source_report_sha256) <> 64
          OR LENGTH(source_manifest_sha256) <> 64
          OR LENGTH(extraction_audit_sha256) <> 64
        )
    `).get(ALL_APPROVED_SALES_POPULATION_CONTRACT).count,
    overlappingApprovedSalesPeriods: db.prepare(`
      SELECT COUNT(*) AS count
      FROM extraction_runs a
      JOIN extraction_runs b ON a.run_id < b.run_id
      WHERE a.dataset_type = 'approved_sales'
        AND b.dataset_type = 'approved_sales'
        AND a.period_start <= b.period_end
        AND b.period_start <= a.period_end
    `).get().count,
    ordersOutsideDeclaredPeriod: db.prepare(`
      SELECT COUNT(*) AS count
      FROM crm_orders o
      JOIN extraction_runs r ON r.run_id = o.run_id
      WHERE SUBSTR(o.sale_approved_at, 1, 10) < r.period_start
         OR SUBSTR(o.sale_approved_at, 1, 10) > r.period_end
    `).get().count,
    leadSourceClassificationViolations: db.prepare(`
      SELECT COUNT(*) AS count
      FROM crm_orders
      WHERE (seller_allocated_before_sale = 1 AND lead_source_classification <> 'Company Sourced')
         OR (seller_allocated_before_sale = 0 AND lead_source_classification <> 'Self Sourced')
         OR lead_source_classification_rule_version <> ?
    `).get(POLICY_VERSION).count,
    sourceCampaignViolations: db.prepare(`
      SELECT COUNT(*) AS count
      FROM crm_orders
      WHERE acquisition_source_type LIKE '%(Batch)%'
         OR policy_credit_source LIKE '%(Batch)%'
    `).get().count,
    phoneNamedColumns: db.prepare(`
      SELECT COUNT(*) AS count
      FROM pragma_table_list t
      JOIN pragma_table_info(t.name) c
      WHERE LOWER(c.name) LIKE '%phone%' OR LOWER(c.name) LIKE '%mobile%'
    `).get().count
  };
  db.close();
  result.ok = result.schemaVersionAccepted
    && result.approvalTimestampSemanticsAccepted
    && result.approvalTimestampsAccepted
    && result.leadSourcePolicyAccepted
    && result.externalCreditPolicyAccepted
    && result.integrityCheck === "ok"
    && result.foreignKeyIssueCount === 0
    && result.counts.orders === 1755
    && result.counts.timestampExceptions === 1
    && result.counts.allocations === 74238
    && result.currentAllSales.orders === 584
    && result.currentAllSales.sale_value === 310669.1
    && result.currentAllSales.company_sourced === 478
    && result.currentAllSales.self_sourced === 106
    && result.priorAllSales.orders === 637
    && result.priorAllSales.sale_value === 336455.24
    && result.priorAllSales.company_sourced === 541
    && result.priorAllSales.self_sourced === 96
    && result.nextAllSales.classified_orders === 534
    && result.nextAllSales.classified_value === 289874.75
    && result.nextAllSales.company_sourced === 436
    && result.nextAllSales.self_sourced === 98
    && result.nextAllSales.attribution_withheld === 1
    && result.nextAllSales.complete_value === 290069.25
    && result.approvedSalesSourceFingerprintsAccepted
    && result.approvedSalesPopulationContractViolations === 0
    && result.overlappingApprovedSalesPeriods === 0
    && result.ordersOutsideDeclaredPeriod === 0
    && result.leadSourceClassificationViolations === 0
    && result.sourceCampaignViolations === 0
    && result.phoneNamedColumns === 0;
  return result;
}

if (require.main === module) {
  try {
    const result = verify(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verify };
