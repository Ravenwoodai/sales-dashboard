"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { isExcludedPersonnel } = require("./personnelExclusions");

const CARMA_SCHEMA_VERSION = "carma_evidence.v4";
const SUPPORTED_CARMA_SCHEMA_VERSIONS = new Set(["carma_evidence.v3", CARMA_SCHEMA_VERSION]);
const CARMA_APPROVAL_TIME_SEMANTICS = "australia_sydney_wall_clock_components.v1";
const ALL_APPROVED_SALES_POPULATION_CONTRACT = "carma_approved_sales_show_new_customers_false.v1";
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
const TIMESTAMP_EXCEPTION_TABLE = "crm_order_timestamp_exceptions";
const APPROVAL_TIMESTAMP_EXPLICIT = "explicit";
const APPROVAL_TIMESTAMP_WITHHELD = "unavailable_after_two_read_only_captures";
const ATTRIBUTION_WITHHELD = "Attribution Withheld";
const REQUIRED_LEAD_SOURCE_POLICY_VERSION = "actual_seller_any_pre_sale_allocation.v1";

function clean(value) {
  return String(value ?? "").trim();
}

function validCarmaApprovalTimestamp(value) {
  const match = clean(value).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const numeric = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };
  const calendar = new Date(Date.UTC(
    numeric.year,
    numeric.month - 1,
    numeric.day,
    numeric.hour,
    numeric.minute,
    numeric.second
  ));
  return numeric.hour <= 23
    && numeric.minute <= 59
    && numeric.second <= 59
    && calendar.getUTCFullYear() === numeric.year
    && calendar.getUTCMonth() + 1 === numeric.month
    && calendar.getUTCDate() === numeric.day;
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
    schemaVersion: "sales_dashboard_carma_evidence.v4",
    configured,
    available: false,
    status: configured ? "unavailable" : "not_configured",
    readOnly: true,
    databaseFileName: databasePath ? path.basename(databasePath) : "",
    contractSchemaVersion: "",
    approvalTimestampSemantics: "",
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
      attributionWithheldOrders: 0,
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

function validateCarmaDatabase(db) {
  const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity || "unknown"}`);
  const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyIssues.length) throw new Error(`Carma foreign-key validation failed for ${foreignKeyIssues.length} row(s)`);
  const names = tableNames(db);
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value]));
  if (!SUPPORTED_CARMA_SCHEMA_VERSIONS.has(meta.schema_version)) {
    throw new Error(`Unsupported Carma evidence schema: ${meta.schema_version || "missing"}`);
  }
  const requiredTables = meta.schema_version === CARMA_SCHEMA_VERSION
    ? [...REQUIRED_TABLES, TIMESTAMP_EXCEPTION_TABLE]
    : REQUIRED_TABLES;
  const missingTables = requiredTables.filter((name) => !names.has(name));
  if (missingTables.length) throw new Error(`Missing required Carma tables: ${missingTables.join(", ")}`);
  const prohibitedPhoneColumns = requiredTables.flatMap((table) => (
    db.prepare(`PRAGMA table_info("${table}")`).all()
      .filter((column) => /phone/i.test(column.name))
      .map((column) => `${table}.${column.name}`)
  ));
  if (prohibitedPhoneColumns.length) {
    throw new Error(`Phone-named matching columns are prohibited: ${prohibitedPhoneColumns.join(", ")}`);
  }
  if (meta.approval_timestamp_semantics !== CARMA_APPROVAL_TIME_SEMANTICS) {
    throw new Error(`Unsupported Carma approval timestamp semantics: ${meta.approval_timestamp_semantics || "missing"}`);
  }
  if (meta.campaign_source_separation !== "enforced") {
    throw new Error("Carma campaign/source separation is not enforced");
  }
  const policyVersion = meta.lead_source_classification_rule_version || meta.policy_rule_version || "";
  if (policyVersion !== REQUIRED_LEAD_SOURCE_POLICY_VERSION) {
    throw new Error(`Unsupported lead-source policy: ${policyVersion || "missing"}`);
  }
  const policyMismatch = db.prepare(`
    SELECT COUNT(*) AS count
    FROM crm_orders
    WHERE lead_source_classification_rule_version <> ?
  `).get(policyVersion)?.count || 0;
  if (policyMismatch) throw new Error(`${policyMismatch} Carma order(s) use an unexpected lead-source policy`);
  const invalidApprovalTimestamps = db.prepare("SELECT sale_approved_at FROM crm_orders").all()
    .filter((row) => !validCarmaApprovalTimestamp(row.sale_approved_at)).length;
  if (invalidApprovalTimestamps) {
    throw new Error(`${invalidApprovalTimestamps} Carma approval timestamp(s) violate ${CARMA_APPROVAL_TIME_SEMANTICS}`);
  }
  if (meta.schema_version === CARMA_SCHEMA_VERSION) {
    const exceptionColumns = new Set(db.prepare(`PRAGMA table_info(${TIMESTAMP_EXCEPTION_TABLE})`).all().map((row) => row.name));
    const hasAttributionFields = exceptionColumns.has("sale_approved_at") && exceptionColumns.has("attribution_withheld_reason");
    const invalidTimestampExceptions = db.prepare(`
      SELECT *
      FROM ${TIMESTAMP_EXCEPTION_TABLE}
      WHERE customer_id = '' OR actual_seller = '' OR sale_value < 0
    `).all().filter((row) => {
      const status = clean(row.approval_timestamp_status);
      if (status === APPROVAL_TIMESTAMP_WITHHELD) return hasAttributionFields && clean(row.sale_approved_at) !== "";
      return status !== APPROVAL_TIMESTAMP_EXPLICIT
        || !hasAttributionFields
        || !validCarmaApprovalTimestamp(row.sale_approved_at)
        || !clean(row.attribution_withheld_reason);
    }).length;
    if (invalidTimestampExceptions) {
      throw new Error(`${invalidTimestampExceptions} approval-timestamp exception row(s) violate the withheld-evidence contract`);
    }
  }
  return meta;
}

function readValidatedCarmaFacts({ databasePath, projection = "full" } = {}) {
  if (!databasePath) throw new Error("A Carma evidence database path is required");
  const resolvedPath = path.resolve(databasePath);
  if (!fs.existsSync(resolvedPath)) throw new Error("The configured Carma evidence database does not exist.");
  let db;
  try {
    db = new DatabaseSync(resolvedPath, { readOnly: true });
    const meta = validateCarmaDatabase(db);
    const exceptionColumns = meta.schema_version === CARMA_SCHEMA_VERSION
      ? new Set(db.prepare(`PRAGMA table_info(${TIMESTAMP_EXCEPTION_TABLE})`).all().map((row) => row.name))
      : new Set();
    const exceptionSaleApprovedSql = exceptionColumns.has("sale_approved_at") ? "e.sale_approved_at" : "''";
    const orderSql = projection === "performance"
      ? `
      WITH selected_seller_allocation AS (
        SELECT
          a.*,
          ROW_NUMBER() OVER (
            PARTITION BY a.order_id
            ORDER BY a.effective_start_at DESC, a.allocation_id
          ) AS selected_rank
        FROM crm_allocations a
        WHERE a.recipient_exact_seller = 1
          AND a.started_before_sale = 1
      )
      SELECT
        o.order_id,
        o.run_id,
        o.customer_id,
        o.customer_name,
        o.actual_seller,
        o.sale_approved_at,
        '${APPROVAL_TIMESTAMP_EXPLICIT}' AS approval_timestamp_status,
        o.sale_value,
        o.acquisition_source_type,
        o.acquisition_source_proven,
        o.lead_source_classification,
        o.lead_source_classification_rule_version,
        o.seller_allocated_before_sale,
        o.seller_allocation_date,
        selected.allocation_id AS historical_allocation_id,
        selected.history_id AS historical_allocation_history_id,
        selected.effective_start_at AS historical_allocation_effective_start_at,
        selected.inactivated_at AS historical_allocation_inactivated_at,
        selected.recipient AS historical_allocation_recipient,
        selected.sales_manager AS historical_allocation_manager,
        selected.description AS historical_allocation_description,
        selected.active_at_sale AS historical_allocation_active_at_sale
      FROM crm_orders o
      LEFT JOIN selected_seller_allocation selected
        ON selected.order_id = o.order_id
       AND selected.selected_rank = 1
      ORDER BY o.sale_approved_at DESC, o.order_id
    `
      : `
      SELECT
        o.order_id,
        o.run_id,
        o.customer_id,
        o.customer_name,
        o.actual_seller,
        o.seller_allocation_date,
        o.sale_approved_at,
        '${APPROVAL_TIMESTAMP_EXPLICIT}' AS approval_timestamp_status,
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
        o.source_provenance_id,
        c.customer_import_source_type,
        c.customer_import_date
      FROM crm_orders o
      JOIN crm_customers c ON c.customer_id = o.customer_id
      ORDER BY o.sale_approved_at DESC, o.order_id
    `;
    const classifiedOrders = db.prepare(orderSql).all();
    const timestampExceptions = meta.schema_version === CARMA_SCHEMA_VERSION
      ? db.prepare(projection === "performance" ? `
        SELECT
          e.order_id,
          e.run_id,
          e.customer_id,
          e.customer_name,
          e.actual_seller,
          ${exceptionSaleApprovedSql} AS sale_approved_at,
          e.approval_timestamp_status,
          e.sale_value,
          e.acquisition_source_type,
          e.acquisition_source_proven,
          '${ATTRIBUTION_WITHHELD}' AS lead_source_classification,
          '${REQUIRED_LEAD_SOURCE_POLICY_VERSION}' AS lead_source_classification_rule_version,
          0 AS seller_allocated_before_sale,
          '' AS seller_allocation_date,
          NULL AS historical_allocation_id,
          NULL AS historical_allocation_history_id,
          NULL AS historical_allocation_effective_start_at,
          NULL AS historical_allocation_inactivated_at,
          NULL AS historical_allocation_recipient,
          NULL AS historical_allocation_manager,
          NULL AS historical_allocation_description,
          NULL AS historical_allocation_active_at_sale
        FROM ${TIMESTAMP_EXCEPTION_TABLE} e
      ` : `
        SELECT
          e.order_id,
          e.run_id,
          e.customer_id,
          e.customer_name,
          e.actual_seller,
          '' AS seller_allocation_date,
          ${exceptionSaleApprovedSql} AS sale_approved_at,
          e.approval_timestamp_status,
          e.sale_value,
          e.acquisition_source_type,
          e.acquisition_source_proven,
          '' AS campaign,
          '${ATTRIBUTION_WITHHELD}' AS lead_source_classification,
          '${REQUIRED_LEAD_SOURCE_POLICY_VERSION}' AS lead_source_classification_rule_version,
          CASE
            WHEN e.approval_timestamp_status = '${APPROVAL_TIMESTAMP_EXPLICIT}'
              THEN 'Source attribution withheld because complete exact-customer allocation history was unavailable and no exact weekly positive proof existed.'
            ELSE 'Source attribution withheld because no explicit approval timestamp was present after two independent read-only captures.'
          END AS lead_source_classification_reason,
          '${ATTRIBUTION_WITHHELD}' AS policy_credit_source,
          NULL AS allowable_external_credit,
          'Unverified' AS carma_credited_source,
          0 AS carma_credited_value,
          0 AS carma_external_credited_value,
          CASE
            WHEN e.approval_timestamp_status = '${APPROVAL_TIMESTAMP_EXPLICIT}'
              THEN 'Approval timestamp verified; source attribution unavailable because exact-customer allocation history is incomplete.'
            ELSE 'Approval timestamp unavailable; no pre-sale timing decision made.'
          END AS reporting_finding,
          0 AS direct_reporting_error,
          CASE WHEN e.approval_timestamp_status = '${APPROVAL_TIMESTAMP_EXPLICIT}' THEN 'allocation_coverage_exception' ELSE 'timestamp_exception' END AS validation_status,
          e.source_provenance_id,
          c.customer_import_source_type,
          c.customer_import_date
        FROM ${TIMESTAMP_EXCEPTION_TABLE} e
        JOIN crm_customers c ON c.customer_id = e.customer_id
      `).all()
      : [];
    const orders = [...classifiedOrders, ...timestampExceptions].sort((left, right) => (
      clean(right.sale_approved_at).localeCompare(clean(left.sale_approved_at))
      || clean(left.order_id).localeCompare(clean(right.order_id))
    ));
    if (projection === "performance") {
      const invalidHistoricalProof = orders.filter((order) => {
        if (clean(order.approval_timestamp_status) !== APPROVAL_TIMESTAMP_EXPLICIT) return false;
        const companySourced = clean(order.lead_source_classification) === "Company Sourced";
        const sellerAllocatedBeforeSale = Number(order.seller_allocated_before_sale) === 1;
        const historicalAllocationPresent = Boolean(clean(order.historical_allocation_id));
        const allocationDateMatches = !historicalAllocationPresent || (
          dateOnly(order.seller_allocation_date)
          === dateOnly(order.historical_allocation_effective_start_at)
        );
        return companySourced !== sellerAllocatedBeforeSale
          || sellerAllocatedBeforeSale !== historicalAllocationPresent
          || !allocationDateMatches;
      });
      if (invalidHistoricalProof.length) {
        throw new Error(
          `${invalidHistoricalProof.length} Carma order(s) do not reconcile to their selected historical seller-allocation proof`
        );
      }
    }
    const coverageRows = db.prepare(`
      SELECT run_id, dataset_type, population_contract, show_new_customers_only,
             completeness_status, period_start, period_end, extracted_at,
             source_provenance_id, source_report_sha256, source_manifest_sha256,
             extraction_audit_sha256, row_count, notes
      FROM extraction_runs
      ORDER BY period_start, period_end, run_id
    `).all();
    const orderCountsByRun = orders.reduce((countsByRun, order) => {
      countsByRun.set(order.run_id, (countsByRun.get(order.run_id) || 0) + 1);
      return countsByRun;
    }, new Map());
    const approvedSalesRuns = coverageRows.filter((row) => row.dataset_type === "approved_sales");
    const invalidPopulationRuns = approvedSalesRuns.filter((row) => (
      row.population_contract !== ALL_APPROVED_SALES_POPULATION_CONTRACT
      || Number(row.show_new_customers_only) !== 0
      || row.completeness_status !== "complete"
      || !/^[a-f0-9]{64}$/i.test(row.source_report_sha256)
      || !/^[a-f0-9]{64}$/i.test(row.source_manifest_sha256)
      || !/^[a-f0-9]{64}$/i.test(row.extraction_audit_sha256)
    ));
    if (invalidPopulationRuns.length) {
      throw new Error(`${invalidPopulationRuns.length} approved-sales extraction run(s) are not verified unfiltered all-sales populations`);
    }
    const overlappingApprovedSalesRuns = approvedSalesRuns.filter((row, index) => (
      approvedSalesRuns.some((other, otherIndex) => (
        otherIndex > index
        && row.period_start
        && row.period_end
        && other.period_start
        && other.period_end
        && row.period_start <= other.period_end
        && other.period_start <= row.period_end
      ))
    ));
    if (overlappingApprovedSalesRuns.length) {
      throw new Error("Authoritative approved-sales extraction periods overlap");
    }
    const approvedRunIds = new Set(approvedSalesRuns.map((row) => row.run_id));
    const orphanedOrders = orders.filter((order) => !approvedRunIds.has(order.run_id)).length;
    if (orphanedOrders) throw new Error(`${orphanedOrders} Carma order(s) have no approved-sales extraction run`);
    const coverageMismatches = coverageRows.filter((row) => (
      row.dataset_type === "approved_sales"
      && Number(row.row_count || 0) !== Number(orderCountsByRun.get(row.run_id) || 0)
    ));
    if (coverageMismatches.length) {
      throw new Error(`${coverageMismatches.length} approved-sales extraction run(s) do not reconcile to order rows`);
    }
    const counts = Object.fromEntries([
      "crm_customers",
      "crm_orders",
      "crm_allocations",
      "crm_credit_awards"
    ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    counts.crm_order_timestamp_exceptions = timestampExceptions.length;
    counts.crm_orders += timestampExceptions.length;
    const leadSourceCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced,
        SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced
      FROM crm_orders
    `).get();
    leadSourceCounts.attribution_withheld = timestampExceptions.length;
    const directReportingErrors = Number(
      db.prepare("SELECT SUM(direct_reporting_error) AS count FROM crm_orders").get().count || 0
    );
    db.close();
    return {
      resolvedPath,
      meta,
      orders,
      coverageRows,
      counts,
      leadSourceCounts,
      directReportingErrors
    };
  } catch (error) {
    try {
      db?.close();
    } catch {}
    throw error;
  }
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

  try {
    const facts = readValidatedCarmaFacts({ databasePath: resolvedPath });
    const { meta, counts } = facts;
    const excludedPersonnelOrders = facts.orders.filter((order) => isExcludedPersonnel(order.actual_seller)).length;
    const orders = facts.orders.filter((order) => !isExcludedPersonnel(order.actual_seller));
    const eligibleCalls = calls.filter((call) => !isExcludedPersonnel(call.salesperson || call.Salesperson));

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
    for (const call of eligibleCalls) {
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
          approvalTimestampStatus: order.approval_timestamp_status,
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
      schemaVersion: "sales_dashboard_carma_evidence.v4",
      configured: true,
      available: true,
      status: "available",
      readOnly: true,
      databaseFileName: path.basename(resolvedPath),
      contractSchemaVersion: meta.schema_version,
      approvalTimestampSemantics: meta.approval_timestamp_semantics,
      policyRuleVersion: meta.policy_rule_version || "",
      leadSourcePolicyVersion: meta.lead_source_classification_rule_version || meta.policy_rule_version || "",
      externalCreditPolicyVersion: meta.external_credit_policy_rule_version || "",
      generatedAt: meta.generated_at || "",
      joinRule: meta.join_rule || "exact customer_id only",
      phoneMatchingUsed: false,
      campaignSourceSeparationEnforced: meta.campaign_source_separation === "enforced",
      totals: {
        customers: new Set(orders.map((order) => order.customer_id)).size,
        orders: orders.length,
        allocations: counts.crm_allocations,
        creditAwards: counts.crm_credit_awards,
        excludedPersonnelOrders,
        exactCustomerMatches: exactCustomers.size,
        matchingCalls: matchingCalls.size,
        matchingOrders: matchingOrders.size,
        companySourcedOrders: orders.filter((order) => order.lead_source_classification === "Company Sourced").length,
        selfSourcedOrders: orders.filter((order) => order.lead_source_classification === "Self Sourced").length,
        attributionWithheldOrders: orders.filter((order) => order.lead_source_classification === ATTRIBUTION_WITHHELD).length,
        sourceComparisons: sourceComparableRows.length,
        sourceMatches: sourceComparableRows.filter((row) => row.sourceComparison === "match").length,
        importDateComparisons: dateComparableRows.length,
        importDateMatches: dateComparableRows.filter((row) => row.importDateComparison === "match").length,
        directReportingErrors: orders.filter((order) => Number(order.direct_reporting_error) === 1).length
      },
      rows: joinedRows.sort((a, b) => String(b.saleApprovalDate).localeCompare(String(a.saleApprovalDate))),
      limitations: [
        "Exact customer_id joins prove record identity, not that a particular call caused a sale.",
        "Company Sourced means the actual seller had an exact pre-sale allocation; it does not prove the original acquisition channel.",
        "Attribution Withheld means the complete approved-sales population includes the order, but either its approval time or complete exact-customer allocation history was unavailable; no missing evidence is interpreted as Self Sourced and no pre-sale timing decision is made without support.",
        "Sale value is an approved-sale amount, not paid or recognised revenue.",
        "Possible staff aliases remain review-only.",
        "The compiled Carma credit ledger has a documented $3,801.20 reconciliation gap to the displayed report total."
      ]
    };
    return report;
  } catch (error) {
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
  ALL_APPROVED_SALES_POPULATION_CONTRACT,
  APPROVAL_TIMESTAMP_EXPLICIT,
  APPROVAL_TIMESTAMP_WITHHELD,
  ATTRIBUTION_WITHHELD,
  CARMA_APPROVAL_TIME_SEMANTICS,
  CARMA_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  loadCarmaEvidence,
  publicCarmaEvidence,
  readValidatedCarmaFacts,
  resolveCarmaEvidencePath,
  unavailableReport,
  validCarmaApprovalTimestamp
};
