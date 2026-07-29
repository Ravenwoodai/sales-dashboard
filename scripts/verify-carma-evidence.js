"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  DEFAULT_OUTPUT_DIR,
  EXTERNAL_CREDIT_POLICY_VERSION,
  POLICY_VERSION,
  SCHEMA_VERSION
} = require("./build-carma-evidence");

function parseArgs(argv) {
  const index = argv.findIndex((value) => value === "--database" || value === "--db");
  return index >= 0 && argv[index + 1]
    ? path.resolve(argv[index + 1])
    : path.join(DEFAULT_OUTPUT_DIR, "carma-evidence.sqlite");
}

function verify(databasePath) {
  if (!fs.existsSync(databasePath)) throw new Error(`Carma evidence database not found: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
  const result = {
    schemaVersion: "carma_evidence_verification.v1",
    databaseFileName: path.basename(databasePath),
    contractSchemaVersion: meta.schema_version || "",
    schemaVersionAccepted: meta.schema_version === SCHEMA_VERSION,
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
      allocations: db.prepare("SELECT COUNT(*) AS count FROM crm_allocations").get().count,
      credits: db.prepare("SELECT COUNT(*) AS count FROM crm_credit_awards").get().count,
      exactMatchedCustomers: db.prepare("SELECT COUNT(DISTINCT customer_id) AS count FROM dashboard_call_matches").get().count
    },
    oldFocusedPopulation: db.prepare(`
      SELECT
        COUNT(*) AS no_exact_seller_allocation,
        SUM(CASE WHEN primary_failure_alias = 0 THEN 1 ELSE 0 END) AS confirmed_no_exact,
        SUM(primary_failure_alias) AS prior_focused_alias_reviews
      FROM (
        SELECT
          o.order_id,
          CASE WHEN o.legacy_primary_failure_reason = 'Seller has only a possible name-alias allocation match' THEN 1 ELSE 0 END AS primary_failure_alias
        FROM crm_orders o
        WHERE o.run_id = 'carma_sales_2026_07_19_25'
          AND o.seller_allocated_before_sale = 0
      )
    `).get(),
    currentAliasReviewPopulation: db.prepare(`
      SELECT
        COUNT(*) AS no_exact_seller_allocation,
        SUM(CASE WHEN possible_alias_review = 0 THEN 1 ELSE 0 END) AS confirmed_no_exact,
        SUM(possible_alias_review) AS possible_alias_reviews
      FROM crm_orders
      WHERE run_id = 'carma_sales_2026_07_19_25'
        AND seller_allocated_before_sale = 0
    `).get(),
    latestCompletedWeek: db.prepare(`
      SELECT
        COUNT(*) AS orders,
        ROUND(SUM(sale_value), 2) AS sale_value,
        SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
        SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced
      FROM crm_orders
      WHERE run_id = 'carma_sales_2026_07_13_19'
    `).get(),
    leadSourceClassificationViolations: db.prepare(`
      SELECT COUNT(*) AS count
      FROM crm_orders
      WHERE (seller_allocated_before_sale = 1 AND lead_source_classification <> 'Company Sourced')
         OR (seller_allocated_before_sale = 0 AND lead_source_classification <> 'Self Sourced')
         OR lead_source_classification_rule_version <> ?
    `).get(POLICY_VERSION).count,
    oldCohortExactJoin: db.prepare(`
      SELECT
        COUNT(DISTINCT p.customer_id) AS exact_customer_matches,
        COUNT(DISTINCT p.call_id) AS matching_calls,
        SUM(CASE WHEN p.source_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS source_comparisons,
        SUM(CASE WHEN p.source_comparison = 'match' THEN 1 ELSE 0 END) AS source_matches,
        SUM(CASE WHEN p.import_date_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS date_comparisons,
        SUM(CASE WHEN p.import_date_comparison = 'match' THEN 1 ELSE 0 END) AS date_matches
      FROM v_combined_customer_proof p
      JOIN crm_orders o ON o.order_id = p.order_id
      WHERE o.run_id = 'carma_sales_2026_07_19_25'
    `).get(),
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
    && result.leadSourcePolicyAccepted
    && result.externalCreditPolicyAccepted
    && result.integrityCheck === "ok"
    && result.foreignKeyIssueCount === 0
    && result.counts.orders === 930
    && result.latestCompletedWeek.orders === 637
    && result.latestCompletedWeek.company_sourced + result.latestCompletedWeek.self_sourced === 637
    && result.leadSourceClassificationViolations === 0
    && result.oldFocusedPopulation.no_exact_seller_allocation === 87
    && result.oldCohortExactJoin.exact_customer_matches === 26
    && result.oldCohortExactJoin.source_matches === result.oldCohortExactJoin.source_comparisons
    && result.oldCohortExactJoin.date_matches === result.oldCohortExactJoin.date_comparisons
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
