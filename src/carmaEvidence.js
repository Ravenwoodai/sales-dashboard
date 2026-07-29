"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const CARMA_SCHEMA_VERSION = "carma_evidence.v2";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "data", "store", "carma-evidence.json");
const REQUIRED_TABLES = [
  "meta",
  "extraction_runs",
  "crm_customers",
  "crm_orders",
  "crm_allocations",
  "crm_credit_awards",
  "crm_staff_identities",
  "crm_source_provenance",
  "crm_validation_issues"
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSourceType(value) {
  const raw = clean(value);
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!key) return "";
  if (key.includes("selfsourced")) return "Self Sourced";
  if (key === "f" || key.startsWith("facebook") || key.startsWith("fb")) return "Facebook";
  if (key.startsWith("googlemaps") || key === "gmee" || key.startsWith("gm")) return "Google Maps";
  if (key.includes("localsearch")) return "Local Search";
  if (key.includes("instagram")) return "Instagram";
  if (key === "dm" || key.includes("directmail")) return "Direct Mail";
  if (key.includes("hipages")) return "HiPages";
  if (key.includes("nocowboys")) return "NoCowBoys";
  if (key.includes("domains")) return "Domains";
  if (key.includes("salesperson")) return "Salesperson";
  return "";
}

function dateOnly(value) {
  const text = clean(value);
  if (!text) return "";
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return text.slice(0, 10);
}

function resolveCarmaEvidencePath(argv = process.argv.slice(2), env = process.env, options = {}) {
  if (options.carmaEvidencePath) return path.resolve(options.carmaEvidencePath);
  const flagIndex = argv.findIndex((arg) => arg === "--carma-evidence" || arg === "--carma-evidence-path");
  if (flagIndex >= 0 && argv[flagIndex + 1]) return path.resolve(argv[flagIndex + 1]);
  if (env.SALES_DASHBOARD_CARMA_EVIDENCE_PATH) return path.resolve(env.SALES_DASHBOARD_CARMA_EVIDENCE_PATH);
  const configPath = path.resolve(options.carmaEvidenceConfigPath || DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return clean(config.databasePath) ? path.resolve(config.databasePath) : null;
  } catch {
    return null;
  }
}

function unavailableReport({ configured = false, databasePath = null, error = "", code = "" } = {}) {
  return {
    schemaVersion: "sales_dashboard_carma_evidence.v2",
    configured,
    available: false,
    status: configured ? "unavailable" : "not_configured",
    readOnly: true,
    databaseFileName: databasePath ? path.basename(databasePath) : "",
    contractSchemaVersion: "",
    policyRuleVersion: "",
    leadSourcePolicyVersion: "",
    externalCreditPolicyVersion: "",
    generatedAt: "",
    error,
    code,
    joinRule: "exact customer_id only",
    phoneMatchingUsed: false,
    campaignSourceSeparationEnforced: true,
    totals: {
      customers: 0,
      orders: 0,
      allocations: 0,
      creditAwards: 0,
      exactCustomerMatches: 0,
      matchingCalls: 0,
      matchingOrders: 0,
      companySourcedOrders: 0,
      selfSourcedOrders: 0,
      sourceComparisons: 0,
      sourceMatches: 0,
      importDateComparisons: 0,
      importDateMatches: 0,
      directReportingErrors: 0
    },
    rows: [],
    limitations: []
  };
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all().map((row) => row.name));
}

function loadCarmaEvidence({ databasePath, calls = [] } = {}) {
  if (!databasePath) return unavailableReport();
  const resolvedPath = path.resolve(databasePath);
  if (!fs.existsSync(resolvedPath)) {
    return unavailableReport({
      configured: true,
      databasePath: resolvedPath,
      error: "The configured Carma evidence database does not exist.",
      code: "CARMA_EVIDENCE_NOT_FOUND"
    });
  }

  let db;
  try {
    db = new DatabaseSync(resolvedPath, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity || "unknown"}`);
    const names = tableNames(db);
    const missingTables = REQUIRED_TABLES.filter((name) => !names.has(name));
    if (missingTables.length) throw new Error(`Missing required Carma tables: ${missingTables.join(", ")}`);
    const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
    if (meta.schema_version !== CARMA_SCHEMA_VERSION) {
      throw new Error(`Unsupported Carma evidence schema: ${meta.schema_version || "missing"}`);
    }

    const orders = db.prepare(`
      SELECT
        o.order_id,
        o.customer_id,
        o.customer_name,
        o.actual_seller,
        o.seller_allocation_date,
        o.sale_approved_at,
        o.sale_value,
        o.acquisition_source_type,
        o.acquisition_source_proven,
        o.campaign,
        o.lead_source_classification,
        o.lead_source_classification_rule_version,
        o.lead_source_classification_reason,
        o.policy_credit_source,
        o.allowable_external_credit,
        o.carma_credited_source,
        o.carma_credited_value,
        o.carma_external_credited_value,
        o.reporting_finding,
        o.direct_reporting_error,
        o.validation_status,
        c.customer_import_source_type,
        c.customer_import_date
      FROM crm_orders o
      JOIN crm_customers c ON c.customer_id = o.customer_id
      ORDER BY o.sale_approved_at DESC, o.order_id
    `).all();
    const counts = Object.fromEntries([
      "crm_customers",
      "crm_orders",
      "crm_allocations",
      "crm_credit_awards"
    ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    const leadSourceCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
        SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced
      FROM crm_orders
    `).get();

    const ordersByCustomer = new Map();
    orders.forEach((order) => {
      if (!ordersByCustomer.has(order.customer_id)) ordersByCustomer.set(order.customer_id, []);
      ordersByCustomer.get(order.customer_id).push(order);
    });

    const joinedRows = [];
    const exactCustomers = new Set();
    const matchingCalls = new Set();
    const matchingOrders = new Set();
    const seenMatches = new Set();
    for (const call of calls) {
      const customerId = clean(call.customerId || call.customer_id);
      if (!customerId || !ordersByCustomer.has(customerId)) continue;
      const callId = clean(call.callId || call.call_id);
      for (const order of ordersByCustomer.get(customerId)) {
        const key = `${callId}|${order.order_id}`;
        if (seenMatches.has(key)) continue;
        seenMatches.add(key);
        const dashboardSourceInput = Object.prototype.hasOwnProperty.call(call, "customerImportSourceRaw")
          ? call.customerImportSourceRaw
          : call.customerImportSource || call.source;
        const dashboardSource = normalizeSourceType(dashboardSourceInput);
        const carmaSource = normalizeSourceType(order.customer_import_source_type);
        const dashboardImportDate = dateOnly(call.customerImportDateIso || call.customerImportDate);
        const carmaImportDate = dateOnly(order.customer_import_date);
        const sourceComparable = Boolean(dashboardSource && carmaSource);
        const dateComparable = Boolean(dashboardImportDate && carmaImportDate);
        joinedRows.push({
          orderNumber: order.order_id,
          customerId,
          customer: order.customer_name,
          actualSeller: order.actual_seller,
          sellerAllocationDate: dateOnly(order.seller_allocation_date),
          saleApprovalDate: order.sale_approved_at,
          saleValue: Number(order.sale_value || 0),
          acquisitionSourceType: order.acquisition_source_type,
          campaign: order.campaign,
          leadSourceClassification: order.lead_source_classification,
          leadSourceClassificationRuleVersion: order.lead_source_classification_rule_version,
          leadSourceClassificationReason: order.lead_source_classification_reason,
          policyCreditedSource: order.policy_credit_source,
          allowableExternalCredit: order.allowable_external_credit === null ? null : Number(order.allowable_external_credit),
          carmaCreditedSource: order.carma_credited_source,
          carmaCreditedValue: Number(order.carma_credited_value || 0),
          reportingFinding: order.reporting_finding,
          validationStatus: order.validation_status,
          directReportingError: Boolean(order.direct_reporting_error),
          callId,
          callAt: clean(call.dateTime || call.sourceTime),
          callSalesperson: clean(call.salesperson),
          dashboardImportSource: dashboardSource,
          dashboardImportDate,
          carmaImportSource: carmaSource,
          carmaImportDate,
          sourceComparison: sourceComparable ? (dashboardSource === carmaSource ? "match" : "mismatch") : "not_comparable",
          importDateComparison: dateComparable ? (dashboardImportDate === carmaImportDate ? "match" : "mismatch") : "not_comparable",
          joinProof: "Exact customer_id"
        });
        exactCustomers.add(customerId);
        matchingCalls.add(callId);
        matchingOrders.add(order.order_id);
      }
    }

    const sourceComparableRows = joinedRows.filter((row) => row.sourceComparison !== "not_comparable");
    const dateComparableRows = joinedRows.filter((row) => row.importDateComparison !== "not_comparable");
    const report = {
      schemaVersion: "sales_dashboard_carma_evidence.v2",
      configured: true,
      available: true,
      status: "available",
      readOnly: true,
      databaseFileName: path.basename(resolvedPath),
      contractSchemaVersion: meta.schema_version,
      policyRuleVersion: meta.policy_rule_version || "",
      leadSourcePolicyVersion: meta.lead_source_classification_rule_version || meta.policy_rule_version || "",
      externalCreditPolicyVersion: meta.external_credit_policy_rule_version || "",
      generatedAt: meta.generated_at || "",
      joinRule: meta.join_rule || "exact customer_id only",
      phoneMatchingUsed: false,
      campaignSourceSeparationEnforced: meta.campaign_source_separation === "enforced",
      totals: {
        customers: counts.crm_customers,
        orders: counts.crm_orders,
        allocations: counts.crm_allocations,
        creditAwards: counts.crm_credit_awards,
        exactCustomerMatches: exactCustomers.size,
        matchingCalls: matchingCalls.size,
        matchingOrders: matchingOrders.size,
        companySourcedOrders: Number(leadSourceCounts.company_sourced || 0),
        selfSourcedOrders: Number(leadSourceCounts.self_sourced || 0),
        sourceComparisons: sourceComparableRows.length,
        sourceMatches: sourceComparableRows.filter((row) => row.sourceComparison === "match").length,
        importDateComparisons: dateComparableRows.length,
        importDateMatches: dateComparableRows.filter((row) => row.importDateComparison === "match").length,
        directReportingErrors: Number(db.prepare("SELECT SUM(direct_reporting_error) AS count FROM crm_orders").get().count || 0)
      },
      rows: joinedRows.sort((a, b) => String(b.saleApprovalDate).localeCompare(String(a.saleApprovalDate))),
      limitations: [
        "Exact customer_id joins prove record identity, not that a particular call caused a sale.",
        "Company Sourced means the actual seller had an exact pre-sale allocation; it does not prove the original acquisition channel.",
        "Sale value is an approved-sale amount, not paid or recognised revenue.",
        "Possible staff aliases remain review-only.",
        "The compiled Carma credit ledger has a documented $3,801.20 reconciliation gap to the displayed report total."
      ]
    };
    db.close();
    return report;
  } catch (error) {
    try {
      db?.close();
    } catch {}
    return unavailableReport({
      configured: true,
      databasePath: resolvedPath,
      error: error.message,
      code: "CARMA_EVIDENCE_INVALID"
    });
  }
}

function publicCarmaEvidence(report, query = {}) {
  const source = clean(query.policySource || query.source);
  const classification = clean(query.classification || query.sourceClassification);
  const status = clean(query.validationStatus || query.status);
  const errorsOnly = ["1", "true", "yes"].includes(clean(query.errorsOnly).toLowerCase());
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100) || 100));
  const offset = Math.max(0, Number(query.offset || 0) || 0);
  const rows = (report.rows || []).filter((row) => {
    if (classification && row.leadSourceClassification !== classification) return false;
    if (source && row.policyCreditedSource !== source && row.carmaCreditedSource !== source) return false;
    if (status && row.validationStatus !== status) return false;
    if (errorsOnly && !row.directReportingError) return false;
    return true;
  });
  return {
    ...report,
    rows: rows.slice(offset, offset + limit),
    query: {
      source,
      classification,
      validationStatus: status,
      errorsOnly,
      matchingRows: rows.length,
      limit,
      offset,
      nextOffset: offset + limit < rows.length ? offset + limit : null
    }
  };
}

module.exports = {
  CARMA_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  loadCarmaEvidence,
  publicCarmaEvidence,
  resolveCarmaEvidencePath,
  unavailableReport
};
