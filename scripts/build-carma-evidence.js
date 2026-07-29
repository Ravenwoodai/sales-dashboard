"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { parseCsv } = require("../src/csvParser");
const {
  LEAD_SOURCE_POLICY_VERSION,
  classifyLeadSource
} = require("../src/leadSourcePolicy");

const DEFAULT_OUTPUT_ROOT = "C:\\Users\\User\\Documents\\Codex\\2026-07-24\\build-the-smallest-possible-working-mvp\\outputs";
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_OUTPUT_ROOT, "carma-sales-dashboard-integration-2026-07-27");
const DEFAULT_OLD_DECISIONS = path.join(DEFAULT_OUTPUT_ROOT, "lead-source-attribution-decisions.jsonl");
const DEFAULT_OLD_ALLOCATIONS = path.join(DEFAULT_OUTPUT_ROOT, "lead-source-allocation-history-linked.jsonl");
const DEFAULT_NEW_DIR = path.join(DEFAULT_OUTPUT_ROOT, "sales-source-method-evidence-2026-07-13-to-2026-07-19");
const DEFAULT_NEW_DECISIONS = path.join(DEFAULT_NEW_DIR, "source-credit-decisions-lenient.jsonl");
const DEFAULT_NEW_ALLOCATIONS = path.join(DEFAULT_NEW_DIR, "source-credit-allocation-evidence-lenient.jsonl");
const DEFAULT_CREDITS = path.join(DEFAULT_OUTPUT_ROOT, "lead-credit-allocation-evidence-2026-07-26", "actual-credit-records-all.jsonl");
const DEFAULT_CALLS = path.join(__dirname, "..", "data", "source", "CallData 07.07.2026.csv");
const SCHEMA_VERSION = "carma_evidence.v2";
const POLICY_VERSION = LEAD_SOURCE_POLICY_VERSION;
const EXTERNAL_CREDIT_POLICY_VERSION = "seller_allocation_within_28_days_lenient.v1";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    values[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return values;
}

function clean(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value ? 1 : 0;
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path.basename(filePath)} line ${index + 1}: ${error.message}`);
    }
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function stableId(prefix, ...parts) {
  return `${prefix}_${crypto.createHash("sha256").update(parts.map(clean).join("|")).digest("hex").slice(0, 24)}`;
}

function isoDate(value) {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function dateOnly(value) {
  const raw = clean(value);
  if (!raw) return "";
  const localMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const text = isoDate(raw);
  return text ? text.slice(0, 10) : "";
}

function daysBetween(earlier, later) {
  const start = new Date(earlier);
  const end = new Date(later);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function isCampaignLabel(value) {
  const text = clean(value);
  return /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(text)
    && /\b(?:19|20)\d{2}\b|\b\d{2}\b|\(batch\)/i.test(text);
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
  if (key.includes("import")) return "";
  if (isCampaignLabel(raw)) return "";
  return "";
}

function sourceForOldDecision(row) {
  const tooltipSource = normalizeSourceType(row.tooltipImportSource);
  if (tooltipSource) {
    return {
      sourceType: tooltipSource,
      proven: true,
      field: "Customer tooltip Import Source",
      value: clean(row.tooltipImportSource)
    };
  }
  const allocationSource = normalizeSourceType(row.allocationLeadSource || row.attributionSource);
  if (allocationSource) {
    return {
      sourceType: allocationSource,
      proven: true,
      field: "Allocation Lead Source",
      value: clean(row.allocationLeadSource || row.attributionSource)
    };
  }
  return { sourceType: "Self Sourced", proven: false, field: "None", value: "" };
}

function campaignForOldDecision(row) {
  const candidate = clean(row.allocationLeadSource || row.attributionSource);
  return isCampaignLabel(candidate) ? candidate : "";
}

function creditSourceType(row) {
  const reportType = clean(row.reportLeadGeneratorType);
  if (/self\s*sourced/i.test(reportType)) return "Self Sourced";
  return normalizeSourceType(row.creditedCostCentre)
    || normalizeSourceType(row.creditedLogin)
    || normalizeSourceType(reportType)
    || (reportType ? reportType : "Unclassified");
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }
  const headers = Object.keys(rows[0]);
  const body = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\r\n");
  fs.writeFileSync(filePath, `${body}\r\n`, "utf8");
}

function execSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;

    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE extraction_runs (
      run_id TEXT PRIMARY KEY,
      dataset_type TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      extracted_at TEXT,
      source_provenance_id TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK (row_count >= 0),
      notes TEXT NOT NULL DEFAULT ''
    ) STRICT;

    CREATE TABLE crm_source_provenance (
      provenance_id TEXT PRIMARY KEY,
      dataset_type TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      extracted_at TEXT,
      raw_path_exposed INTEGER NOT NULL DEFAULT 0 CHECK (raw_path_exposed IN (0, 1)),
      notes TEXT NOT NULL DEFAULT ''
    ) STRICT;

    CREATE TABLE crm_customers (
      customer_id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_import_source_raw TEXT NOT NULL DEFAULT '',
      customer_import_source_type TEXT NOT NULL DEFAULT '',
      customer_import_date TEXT NOT NULL DEFAULT '',
      customer_created_by TEXT NOT NULL DEFAULT '',
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;

    CREATE TABLE crm_orders (
      order_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      actual_seller TEXT NOT NULL,
      sale_approved_at TEXT NOT NULL,
      sale_value REAL NOT NULL,
      acquisition_source_type TEXT NOT NULL,
      acquisition_source_raw TEXT NOT NULL DEFAULT '',
      acquisition_source_proven INTEGER NOT NULL CHECK (acquisition_source_proven IN (0, 1)),
      campaign TEXT NOT NULL DEFAULT '',
      lead_source_classification TEXT NOT NULL CHECK (lead_source_classification IN ('Company Sourced', 'Self Sourced')),
      lead_source_classification_rule_version TEXT NOT NULL,
      lead_source_classification_reason TEXT NOT NULL,
      policy_credit_source TEXT NOT NULL,
      allowable_external_credit REAL,
      seller_allocated_before_sale INTEGER NOT NULL CHECK (seller_allocated_before_sale IN (0, 1)),
      seller_allocation_date TEXT NOT NULL DEFAULT '',
      seller_allocation_within_28_days INTEGER NOT NULL CHECK (seller_allocation_within_28_days IN (0, 1)),
      seller_allocation_active_at_sale INTEGER NOT NULL CHECK (seller_allocation_active_at_sale IN (0, 1)),
      possible_alias_review INTEGER NOT NULL CHECK (possible_alias_review IN (0, 1)),
      later_other_allocation_ignored INTEGER NOT NULL CHECK (later_other_allocation_ignored IN (0, 1)),
      policy_rule_version TEXT NOT NULL,
      decision_reason TEXT NOT NULL,
      legacy_primary_failure_reason TEXT NOT NULL DEFAULT '',
      carma_credited_source TEXT NOT NULL,
      carma_credited_value REAL NOT NULL,
      carma_external_credited_value REAL NOT NULL,
      reporting_finding TEXT NOT NULL,
      direct_reporting_error INTEGER NOT NULL CHECK (direct_reporting_error IN (0, 1)),
      validation_status TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES extraction_runs(run_id),
      FOREIGN KEY (customer_id) REFERENCES crm_customers(customer_id),
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;

    CREATE TABLE crm_allocations (
      allocation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      history_id TEXT NOT NULL DEFAULT '',
      effective_start_at TEXT NOT NULL DEFAULT '',
      inactivated_at TEXT NOT NULL DEFAULT '',
      recipient TEXT NOT NULL DEFAULT '',
      sales_manager TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      recipient_exact_seller INTEGER NOT NULL CHECK (recipient_exact_seller IN (0, 1)),
      recipient_possible_alias INTEGER NOT NULL CHECK (recipient_possible_alias IN (0, 1)),
      started_before_sale INTEGER NOT NULL CHECK (started_before_sale IN (0, 1)),
      active_at_sale INTEGER NOT NULL CHECK (active_at_sale IN (0, 1)),
      qualifies_seller_within_28_days INTEGER NOT NULL CHECK (qualifies_seller_within_28_days IN (0, 1)),
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES extraction_runs(run_id),
      FOREIGN KEY (order_id) REFERENCES crm_orders(order_id),
      FOREIGN KEY (customer_id) REFERENCES crm_customers(customer_id),
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;

    CREATE TABLE crm_credit_awards (
      credit_award_id TEXT PRIMARY KEY,
      reported_order_number TEXT NOT NULL,
      target_order_id TEXT,
      customer_id TEXT NOT NULL DEFAULT '',
      credited_source_type TEXT NOT NULL,
      credited_cost_centre TEXT NOT NULL DEFAULT '',
      credited_login TEXT NOT NULL DEFAULT '',
      salesperson TEXT NOT NULL DEFAULT '',
      approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
      credited_value REAL NOT NULL,
      report_create_date TEXT NOT NULL DEFAULT '',
      report_week_created TEXT NOT NULL DEFAULT '',
      report_allocated_flag INTEGER,
      report_called_flag INTEGER,
      source_row INTEGER NOT NULL,
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (target_order_id) REFERENCES crm_orders(order_id),
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;

    CREATE TABLE crm_staff_identities (
      identity_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      identity_role TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      canonical_salesperson TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    ) STRICT;

    CREATE TABLE crm_validation_issues (
      issue_id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      order_id TEXT,
      customer_id TEXT,
      detail TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
      FOREIGN KEY (order_id) REFERENCES crm_orders(order_id),
      FOREIGN KEY (customer_id) REFERENCES crm_customers(customer_id)
    ) STRICT;

    CREATE TABLE dashboard_call_matches (
      match_id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      call_at TEXT NOT NULL,
      salesperson TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '',
      customer_import_source TEXT NOT NULL DEFAULT '',
      customer_import_date TEXT NOT NULL DEFAULT '',
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES crm_customers(customer_id),
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;

    CREATE INDEX idx_orders_customer ON crm_orders(customer_id);
    CREATE INDEX idx_orders_sale_at ON crm_orders(sale_approved_at);
    CREATE INDEX idx_allocations_order ON crm_allocations(order_id);
    CREATE INDEX idx_allocations_customer ON crm_allocations(customer_id);
    CREATE INDEX idx_credits_order ON crm_credit_awards(reported_order_number);
    CREATE INDEX idx_calls_customer ON dashboard_call_matches(customer_id);

    CREATE VIEW v_no_exact_seller_allocation AS
    SELECT
      order_id,
      customer_id,
      customer_name,
      actual_seller,
      sale_approved_at,
      sale_value,
      possible_alias_review,
      lead_source_classification,
      lead_source_classification_reason,
      policy_credit_source,
      allowable_external_credit,
      carma_credited_source,
      carma_credited_value,
      reporting_finding
    FROM crm_orders
    WHERE seller_allocated_before_sale = 0;

    CREATE VIEW v_possible_seller_alias_review AS
    SELECT *
    FROM v_no_exact_seller_allocation
    WHERE possible_alias_review = 1;

    CREATE VIEW v_actual_vs_allowed_credit AS
    SELECT
      order_id,
      customer_id,
      actual_seller,
      sale_approved_at,
      sale_value,
      acquisition_source_type,
      campaign,
      lead_source_classification,
      lead_source_classification_reason,
      policy_credit_source,
      allowable_external_credit,
      carma_credited_source,
      carma_credited_value,
      carma_external_credited_value,
      carma_external_credited_value - COALESCE(allowable_external_credit, 0) AS external_credit_variance,
      direct_reporting_error,
      validation_status
    FROM crm_orders;

    CREATE VIEW v_customer_call_allocation_sale_timeline AS
    SELECT
      o.customer_id,
      c.call_id,
      c.call_at,
      c.salesperson AS call_salesperson,
      c.customer_import_source AS dashboard_import_source,
      c.customer_import_date AS dashboard_import_date,
      a.allocation_id,
      a.effective_start_at AS allocation_at,
      a.recipient AS allocation_recipient,
      a.recipient_exact_seller,
      o.order_id,
      o.sale_approved_at,
      o.actual_seller,
      o.sale_value,
      o.lead_source_classification,
      o.policy_credit_source,
      o.carma_credited_source
    FROM crm_orders o
    JOIN dashboard_call_matches c ON c.customer_id = o.customer_id
    LEFT JOIN crm_allocations a ON a.order_id = o.order_id;

    CREATE VIEW v_combined_customer_proof AS
    SELECT
      o.order_id,
      o.customer_id,
      o.customer_name,
      o.actual_seller,
      o.seller_allocation_date,
      o.sale_approved_at,
      o.sale_value,
      o.lead_source_classification,
      o.lead_source_classification_reason,
      o.policy_credit_source,
      o.carma_credited_source,
      o.carma_credited_value,
      o.campaign,
      c.call_id,
      c.call_at,
      c.salesperson AS call_salesperson,
      c.customer_import_source AS dashboard_import_source,
      c.customer_import_date AS dashboard_import_date,
      cu.customer_import_source_raw AS carma_import_source,
      cu.customer_import_date AS carma_import_date,
      CASE
        WHEN c.customer_import_source = '' OR cu.customer_import_source_type = '' THEN 'not_comparable'
        WHEN LOWER(REPLACE(c.customer_import_source, ' ', '')) = LOWER(REPLACE(cu.customer_import_source_type, ' ', '')) THEN 'match'
        ELSE 'mismatch'
      END AS source_comparison,
      CASE
        WHEN c.customer_import_date = '' OR cu.customer_import_date = '' THEN 'not_comparable'
        WHEN SUBSTR(c.customer_import_date, 1, 10) = SUBSTR(cu.customer_import_date, 1, 10) THEN 'match'
        ELSE 'mismatch'
      END AS import_date_comparison
    FROM crm_orders o
    JOIN crm_customers cu ON cu.customer_id = o.customer_id
    JOIN dashboard_call_matches c ON c.customer_id = o.customer_id;
  `);
}

function insertProvenance(db, datasetType, filePath, notes = "") {
  const provenanceId = stableId("prov", datasetType, sha256File(filePath));
  db.prepare(`
    INSERT INTO crm_source_provenance
      (provenance_id, dataset_type, source_file_name, source_sha256, extracted_at, raw_path_exposed, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(provenanceId, datasetType, path.basename(filePath), sha256File(filePath), new Date(fs.statSync(filePath).mtimeMs).toISOString(), notes);
  return provenanceId;
}

function build(options = {}) {
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);
  const oldDecisionsPath = path.resolve(options.oldDecisions || DEFAULT_OLD_DECISIONS);
  const oldAllocationsPath = path.resolve(options.oldAllocations || DEFAULT_OLD_ALLOCATIONS);
  const newDecisionsPath = path.resolve(options.newDecisions || DEFAULT_NEW_DECISIONS);
  const newAllocationsPath = path.resolve(options.newAllocations || DEFAULT_NEW_ALLOCATIONS);
  const creditsPath = path.resolve(options.credits || DEFAULT_CREDITS);
  const callsPath = path.resolve(options.calls || DEFAULT_CALLS);
  const dbPath = path.join(outputDir, "carma-evidence.sqlite");
  const verificationPath = path.join(outputDir, "carma-evidence-verification.json");
  const proofCsvPath = path.join(outputDir, "combined-customer-proof.csv");
  const noAllocationCsvPath = path.join(outputDir, "no-exact-seller-allocation-evidence.csv");
  const creditJoinCsvPath = path.join(outputDir, "expanded-credit-join.csv");
  const creditSearchAuditPath = path.join(outputDir, "credit-search-audit.json");

  [oldDecisionsPath, oldAllocationsPath, newDecisionsPath, newAllocationsPath, creditsPath, callsPath].forEach((filePath) => {
    if (!fs.existsSync(filePath)) throw new Error(`Required source is missing: ${filePath}`);
  });

  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const oldDecisions = readJsonl(oldDecisionsPath);
  const oldAllocations = readJsonl(oldAllocationsPath);
  const newDecisions = readJsonl(newDecisionsPath);
  const newAllocations = readJsonl(newAllocationsPath);
  const creditRows = readJsonl(creditsPath);
  const parsedCalls = parseCsv(fs.readFileSync(callsPath, "utf8")).rows;
  const seenCallIds = new Set();
  const callRows = parsedCalls.filter((row) => {
    const callId = clean(row.call_id);
    if (!callId || seenCallIds.has(callId)) return false;
    seenCallIds.add(callId);
    return true;
  }).map((row) => ({
    callId: clean(row.call_id),
    customerId: clean(row.customer_id),
    dateTime: `${dateOnly(row.call_date)}T${clean(row.call_time)}`,
    salesperson: clean(row.Salesperson),
    userId: clean(row.UserID),
    customerImportSource: normalizeSourceType(row.CustomerImportSource),
    customerImportDate: dateOnly(row.CustomerImportDate)
  }));

  const db = new DatabaseSync(dbPath);
  execSchema(db);
  const generatedAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");

  const oldDecisionProv = insertProvenance(db, "approved_sales_policy_decisions_2026-07-19_to_2026-07-25", oldDecisionsPath, "Focused Carma approved-sales decision extract.");
  const oldAllocationProv = insertProvenance(db, "customer_allocation_history_2026-07-19_to_2026-07-25", oldAllocationsPath, "Linked Carma customer allocation histories.");
  const newDecisionProv = insertProvenance(db, "approved_sales_policy_decisions_2026-07-13_to_2026-07-19", newDecisionsPath, "Saved source-credit decisions; top-level Company Sourced/Self Sourced classification is rebuilt from exact seller-allocation evidence.");
  const newAllocationProv = insertProvenance(db, "customer_allocation_history_2026-07-13_to_2026-07-19", newAllocationsPath, "Exact allocation histories used by the locked allocation-based lead-source classification.");
  const creditProv = insertProvenance(db, "lead_generators_sales_credit_ledger", creditsPath, "Complete parsed 420-branch Lead Generators Sales ledger; no repeat extraction.");
  const callsProv = insertProvenance(db, "sales_dashboard_active_call_export", callsPath, "Sanitized exact customer-ID match facts only; no phone or transcript persisted.");

  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  [
    ["schema_version", SCHEMA_VERSION],
    ["policy_rule_version", POLICY_VERSION],
    ["lead_source_classification_rule_version", POLICY_VERSION],
    ["external_credit_policy_rule_version", EXTERNAL_CREDIT_POLICY_VERSION],
    ["generated_at", generatedAt],
    ["producer", "Sales Dashboard integration build"],
    ["join_rule", "exact customer_id only"],
    ["phone_matching", "prohibited"],
    ["campaign_source_separation", "enforced"],
    ["raw_paths_exposed", "false"]
  ].forEach(([key, value]) => setMeta.run(key, value));

  const runInsert = db.prepare(`
    INSERT INTO extraction_runs
      (run_id, dataset_type, period_start, period_end, extracted_at, source_provenance_id, row_count, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  runInsert.run("carma_sales_2026_07_19_25", "approved_sales", "2026-07-19", "2026-07-25", generatedAt, oldDecisionProv, oldDecisions.length, "Actual approval events in the local extract fall between 20 and 24 July.");
  runInsert.run("carma_sales_2026_07_13_19", "approved_sales", "2026-07-13", "2026-07-19", generatedAt, newDecisionProv, newDecisions.length, "Latest completed Monday-Sunday source-credit evidence population.");
  runInsert.run("carma_credit_ledger_2026_07_26", "credit_ledger", "", "", generatedAt, creditProv, creditRows.length, "Parsed once from 420 report branches.");
  runInsert.run("sales_dashboard_calls_2026_07_01_06", "call_export", "2026-07-01", "2026-07-06", generatedAt, callsProv, callRows.length, "Active Sales Dashboard call cohort.");

  const oldAllocByOrder = new Map();
  oldAllocations.forEach((row) => {
    const key = clean(row.orderNumber);
    if (!oldAllocByOrder.has(key)) oldAllocByOrder.set(key, []);
    oldAllocByOrder.get(key).push(row);
  });
  const newAllocByOrder = new Map();
  newAllocations.forEach((row) => {
    const key = clean(row.orderNumber);
    if (!newAllocByOrder.has(key)) newAllocByOrder.set(key, []);
    newAllocByOrder.get(key).push(row);
  });
  const creditsByOrder = new Map();
  creditRows.filter((row) => row.approved).forEach((row) => {
    const key = clean(row.orderNumber);
    if (!creditsByOrder.has(key)) creditsByOrder.set(key, []);
    creditsByOrder.get(key).push(row);
  });

  const customerInsert = db.prepare(`
    INSERT INTO crm_customers
      (customer_id, customer_name, customer_import_source_raw, customer_import_source_type, customer_import_date, customer_created_by, source_provenance_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      customer_name = CASE WHEN excluded.customer_name <> '' THEN excluded.customer_name ELSE crm_customers.customer_name END,
      customer_import_source_raw = CASE WHEN excluded.customer_import_source_raw <> '' THEN excluded.customer_import_source_raw ELSE crm_customers.customer_import_source_raw END,
      customer_import_source_type = CASE WHEN excluded.customer_import_source_type <> '' THEN excluded.customer_import_source_type ELSE crm_customers.customer_import_source_type END,
      customer_import_date = CASE WHEN excluded.customer_import_date <> '' THEN excluded.customer_import_date ELSE crm_customers.customer_import_date END,
      customer_created_by = CASE WHEN excluded.customer_created_by <> '' THEN excluded.customer_created_by ELSE crm_customers.customer_created_by END
  `);
  const orderInsert = db.prepare(`
    INSERT INTO crm_orders (
      order_id, run_id, customer_id, customer_name, actual_seller, sale_approved_at, sale_value,
      acquisition_source_type, acquisition_source_raw, acquisition_source_proven, campaign,
      lead_source_classification, lead_source_classification_rule_version, lead_source_classification_reason,
      policy_credit_source, allowable_external_credit, seller_allocated_before_sale, seller_allocation_date,
      seller_allocation_within_28_days, seller_allocation_active_at_sale, possible_alias_review,
      later_other_allocation_ignored, policy_rule_version, decision_reason, legacy_primary_failure_reason, carma_credited_source,
      carma_credited_value, carma_external_credited_value, reporting_finding, direct_reporting_error,
      validation_status, source_provenance_id
    ) VALUES (${Array.from({ length: 32 }, () => "?").join(", ")})
  `);

  const normalizedOrders = [];

  for (const row of oldDecisions) {
    const orderId = clean(row.orderNumber);
    const customerId = clean(row.customerId);
    const saleAt = isoDate(row.saleDate);
    const allocations = oldAllocByOrder.get(orderId) || [];
    const sellerRows = allocations
      .filter((allocation) => allocation.recipientExactSeller && new Date(allocation.effectiveStart || 0) <= new Date(saleAt))
      .sort((a, b) => new Date(b.effectiveStart || 0) - new Date(a.effectiveStart || 0));
    const aliasRows = allocations.filter((allocation) => allocation.recipientPossibleAlias && new Date(allocation.effectiveStart || 0) <= new Date(saleAt));
    const latestSeller = sellerRows[0] || null;
    const allocationDays = latestSeller ? daysBetween(latestSeller.effectiveStart, saleAt) : null;
    const within28 = allocationDays !== null && allocationDays >= 0 && allocationDays <= 28;
    const sellerAllocated = Boolean(row.sellerAllocatedBeforeSale);
    const leadSource = classifyLeadSource({
      sellerAllocatedBeforeSale: sellerAllocated,
      sellerAllocationDate: latestSeller ? latestSeller.effectiveStart : "",
      saleApprovalDate: saleAt
    });
    const possibleAlias = !sellerAllocated && aliasRows.length > 0;
    const source = sourceForOldDecision(row);
    const campaign = campaignForOldDecision(row);
    const policySource = possibleAlias ? "Identity Alias Review" : source.proven && within28 ? source.sourceType : "Self Sourced";
    const allowed = possibleAlias ? null : policySource === "Self Sourced" ? 0 : Number(row.orderAmount || 0);
    const credits = creditsByOrder.get(orderId) || [];
    const creditTypes = [...new Set(credits.map(creditSourceType))];
    const creditedValue = credits.reduce((sum, credit) => sum + Number(credit.creditedValue || 0), 0);
    const externalCredited = credits.filter((credit) => creditSourceType(credit) !== "Self Sourced").reduce((sum, credit) => sum + Number(credit.creditedValue || 0), 0);
    const creditedSource = creditTypes.length ? creditTypes.join(" | ") : "Unverified";
    const reportingError = !possibleAlias && externalCredited > Number(allowed || 0) + 0.005;
    const finding = possibleAlias
      ? "Identity alias review required"
      : !credits.length
        ? "Carma credit row not found in compiled ledger"
        : reportingError
          ? "Carma external credit exceeds policy allowance"
          : "No proven excess external credit";
    const validationStatus = possibleAlias ? "review" : credits.length ? (reportingError ? "contradiction" : "verified") : "unverified";

    customerInsert.run(
      customerId,
      clean(row.customer),
      clean(row.tooltipImportSource),
      source.proven ? source.sourceType : "",
      dateOnly(row.explicitLeadImportDate || row.customerCreatedDate),
      clean(row.tooltipCreatedBy),
      oldDecisionProv
    );
    orderInsert.run(
      orderId,
      "carma_sales_2026_07_19_25",
      customerId,
      clean(row.customer),
      clean(row.actualSeller),
      saleAt,
      Number(row.orderAmount || 0),
      source.sourceType,
      source.value,
      bool(source.proven),
      campaign,
      leadSource.classification,
      leadSource.policyVersion,
      leadSource.reason,
      policySource,
      allowed,
      bool(sellerAllocated),
      latestSeller ? isoDate(latestSeller.effectiveStart) : "",
      bool(within28),
      bool(latestSeller?.activeAtSale),
      bool(possibleAlias),
      0,
      EXTERNAL_CREDIT_POLICY_VERSION,
      possibleAlias
        ? "No exact seller allocation; possible identity alias is isolated for review"
        : !sellerAllocated
          ? "No exact seller allocation before sale"
          : !source.proven
            ? "No independently proven acquisition source; campaign is stored separately"
            : !within28
              ? "Seller allocation was not within 28 days before approval"
              : "Proven source and exact seller allocation within 28 days",
      clean(row.primaryFailureReason),
      creditedSource,
      creditedValue,
      externalCredited,
      finding,
      bool(reportingError),
      validationStatus,
      oldDecisionProv
    );
    normalizedOrders.push({ orderId, customerId, runId: "carma_sales_2026_07_19_25" });
  }

  for (const row of newDecisions) {
    const orderId = clean(row.orderNumber);
    const customerId = clean(row.customerId);
    const sourceType = clean(row.acquisitionSourceType) || "Self Sourced";
    const sourceRaw = clean(row.sourceEvidenceValue || row.importSource || row.leadSource);
    const leadSource = classifyLeadSource({
      sellerAllocatedBeforeSale: Boolean(row.sellerAllocationDate),
      sellerAllocationDate: row.sellerAllocationDate,
      saleApprovalDate: row.saleDate
    });
    customerInsert.run(
      customerId,
      clean(row.customer),
      clean(row.importSource),
      clean(row.importSource) ? normalizeSourceType(row.importSource) : "",
      "",
      "",
      newDecisionProv
    );
    orderInsert.run(
      orderId,
      "carma_sales_2026_07_13_19",
      customerId,
      clean(row.customer),
      clean(row.actualSeller),
      isoDate(row.saleDate),
      Number(row.saleValue || 0),
      sourceType,
      sourceRaw,
      bool(row.sourceProven),
      clean(row.campaign),
      leadSource.classification,
      leadSource.policyVersion,
      leadSource.reason,
      clean(row.policyCreditSourceType || row.policyMethod || "Self Sourced"),
      Number(row.allowableExternalSourceCredit || 0),
      bool(row.sellerAllocationDate),
      isoDate(row.sellerAllocationDate),
      bool(row.sellerAllocatedWithin28Days),
      bool(row.sellerAllocationActiveAtSale),
      0,
      bool(row.laterOtherAllocationIgnored),
      EXTERNAL_CREDIT_POLICY_VERSION,
      clean(row.primaryReason),
      "",
      clean(row.carmaCreditedSourceTypes || "Unverified"),
      Number(row.carmaCreditedValue || 0),
      Number(row.carmaExternalCreditedValue || 0),
      clean(row.reportingFinding),
      bool(row.directReportingError),
      Number(row.carmaCreditRows || 0) > 0 ? (row.directReportingError ? "contradiction" : "verified") : "unverified",
      newDecisionProv
    );
    normalizedOrders.push({ orderId, customerId, runId: "carma_sales_2026_07_13_19" });
  }

  const allocationInsert = db.prepare(`
    INSERT INTO crm_allocations (
      allocation_id, run_id, order_id, customer_id, history_id, effective_start_at, inactivated_at,
      recipient, sales_manager, description, recipient_exact_seller, recipient_possible_alias,
      started_before_sale, active_at_sale, qualifies_seller_within_28_days, source_provenance_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  oldAllocations.forEach((row, index) => {
    allocationInsert.run(
      stableId("allocation", "old", row.orderNumber, row.historyId, index),
      "carma_sales_2026_07_19_25",
      clean(row.orderNumber),
      clean(row.customerId),
      clean(row.historyId),
      isoDate(row.effectiveStart),
      isoDate(row.inactivatedDate),
      clean(row.recipient),
      clean(row.salesManager),
      clean(row.description),
      bool(row.recipientExactSeller),
      bool(row.recipientPossibleAlias),
      bool(row.startedBySale),
      bool(row.activeAtSale),
      bool(row.recipientExactSeller && row.startedBySale && Number(row.daysToSale) >= 0 && Number(row.daysToSale) <= 28),
      oldAllocationProv
    );
  });
  newAllocations.forEach((row, index) => {
    allocationInsert.run(
      stableId("allocation", "new", row.orderNumber, row.historyId, index),
      "carma_sales_2026_07_13_19",
      clean(row.orderNumber),
      clean(row.customerId),
      clean(row.historyId),
      isoDate(row.effectiveStartDate),
      isoDate(row.inactivated),
      clean(row.recipient),
      clean(row.salesManager),
      clean(row.description),
      bool(row.recipientExactSeller),
      0,
      bool(row.startedBySale),
      bool(row.activeAtSale),
      bool(row.qualifiesSellerWithin28),
      newAllocationProv
    );
  });

  const orderIds = new Set(normalizedOrders.map((row) => row.orderId));
  const creditInsert = db.prepare(`
    INSERT INTO crm_credit_awards (
      credit_award_id, reported_order_number, target_order_id, customer_id, credited_source_type,
      credited_cost_centre, credited_login, salesperson, approved, credited_value, report_create_date,
      report_week_created, report_allocated_flag, report_called_flag, source_row, source_provenance_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  creditRows.forEach((row, index) => {
    const orderNumber = clean(row.orderNumber);
    creditInsert.run(
      stableId("credit", row.sourceFile, row.sourceSheet, row.sourceRow, orderNumber, index),
      orderNumber,
      orderIds.has(orderNumber) ? orderNumber : null,
      clean(row.customerId),
      creditSourceType(row),
      clean(row.creditedCostCentre),
      clean(row.creditedLogin),
      clean(row.salesperson),
      bool(row.approved),
      Number(row.creditedValue || 0),
      clean(row.reportCreateDate),
      clean(row.reportWeekCreated),
      row.reportAllocatedFlag === null || row.reportAllocatedFlag === undefined ? null : Number(row.reportAllocatedFlag),
      row.reportCalledFlag === null || row.reportCalledFlag === undefined ? null : Number(row.reportCalledFlag),
      Number(row.sourceRow || index + 1),
      creditProv
    );
  });

  const identityRows = new Map();
  const addIdentity = (name, role, status = "unmapped", canonical = "", notes = "") => {
    const value = clean(name);
    if (!value) return;
    const key = value.toLowerCase();
    const existing = identityRows.get(key);
    if (!existing || (existing.mappingStatus === "unmapped" && status !== "unmapped")) {
      identityRows.set(key, { displayName: value, role, mappingStatus: status, canonical, notes });
    }
  };
  oldDecisions.forEach((row) => addIdentity(row.actualSeller, "actual_seller"));
  newDecisions.forEach((row) => addIdentity(row.actualSeller, "actual_seller"));
  oldAllocations.forEach((row) => {
    addIdentity(row.recipient, "allocation_recipient");
    addIdentity(row.salesManager, "allocation_manager");
  });
  newAllocations.forEach((row) => {
    addIdentity(row.recipient, "allocation_recipient");
    addIdentity(row.salesManager, "allocation_manager");
  });
  callRows.forEach((row) => {
    const key = clean(row.salesperson).toLowerCase();
    if (identityRows.has(key)) addIdentity(row.salesperson, "salesperson", "exact_display_name", row.salesperson, "Exact display-name overlap with active Sales Dashboard calls.");
  });
  const identityInsert = db.prepare(`
    INSERT INTO crm_staff_identities
      (identity_id, display_name, identity_role, mapping_status, canonical_salesperson, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  identityRows.forEach((identity) => identityInsert.run(
    stableId("identity", identity.displayName),
    identity.displayName,
    identity.role,
    identity.mappingStatus,
    identity.canonical,
    identity.notes
  ));

  const knownCustomers = new Set(db.prepare("SELECT customer_id FROM crm_customers").all().map((row) => row.customer_id));
  const callInsert = db.prepare(`
    INSERT INTO dashboard_call_matches (
      match_id, call_id, customer_id, call_at, salesperson, user_id,
      customer_import_source, customer_import_date, source_provenance_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  callRows.filter((row) => knownCustomers.has(clean(row.customerId))).forEach((row) => {
    callInsert.run(
      stableId("callmatch", row.callId, row.customerId),
      clean(row.callId),
      clean(row.customerId),
      clean(row.dateTime || row.sourceTime),
      clean(row.salesperson),
      clean(row.userId),
      clean(row.customerImportSource),
      dateOnly(row.customerImportDate),
      callsProv
    );
  });

  const issueInsert = db.prepare(`
    INSERT INTO crm_validation_issues
      (issue_id, severity, issue_type, order_id, customer_id, detail, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.prepare("SELECT order_id, customer_id FROM crm_orders WHERE possible_alias_review = 1").all().forEach((row) => {
    issueInsert.run(stableId("issue", "possible_alias", row.order_id), "review", "possible_seller_alias", row.order_id, row.customer_id, "Possible alias evidence is isolated and is not accepted as an exact seller identity.", 0);
  });
  db.prepare("SELECT order_id, customer_id FROM crm_orders WHERE direct_reporting_error = 1").all().forEach((row) => {
    issueInsert.run(stableId("issue", "credit_contradiction", row.order_id), "error", "external_credit_exceeds_policy", row.order_id, row.customer_id, "Carma external credit exceeds the current policy allowance.", 0);
  });
  issueInsert.run(
    stableId("issue", "lead_generators_display_reconciliation"),
    "warning",
    "lead_generators_display_reconciliation",
    null,
    null,
    "The parsed Lead Generators Sales branches remain $3,801.20 below the displayed Carma report total; the parsed rows are retained with this explicit limitation.",
    0
  );

  db.exec("COMMIT");
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
  const counts = Object.fromEntries([
    "extraction_runs",
    "crm_source_provenance",
    "crm_customers",
    "crm_orders",
    "crm_allocations",
    "crm_credit_awards",
    "crm_staff_identities",
    "crm_validation_issues",
    "dashboard_call_matches"
  ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const oldNoAllocation = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN possible_alias_review = 0 THEN 1 ELSE 0 END) AS confirmed,
      SUM(possible_alias_review) AS aliases,
      ROUND(SUM(sale_value), 2) AS sale_value
    FROM crm_orders
    WHERE run_id = 'carma_sales_2026_07_19_25' AND seller_allocated_before_sale = 0
  `).get();
  const oldFocusedBaseline = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN legacy_primary_failure_reason = 'Seller has only a possible name-alias allocation match' THEN 0 ELSE 1 END) AS confirmed,
      SUM(CASE WHEN legacy_primary_failure_reason = 'Seller has only a possible name-alias allocation match' THEN 1 ELSE 0 END) AS aliases
    FROM crm_orders
    WHERE run_id = 'carma_sales_2026_07_19_25' AND seller_allocated_before_sale = 0
  `).get();
  const latest = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      ROUND(SUM(sale_value), 2) AS sale_value,
      SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN 1 ELSE 0 END) AS self_sourced_orders,
      ROUND(SUM(CASE WHEN lead_source_classification = 'Self Sourced' THEN sale_value ELSE 0 END), 2) AS self_sourced_value,
      SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN 1 ELSE 0 END) AS company_sourced_orders,
      ROUND(SUM(CASE WHEN lead_source_classification = 'Company Sourced' THEN sale_value ELSE 0 END), 2) AS company_sourced_value,
      SUM(CASE WHEN policy_credit_source <> 'Self Sourced' THEN 1 ELSE 0 END) AS named_external_credit_orders,
      ROUND(SUM(CASE WHEN policy_credit_source <> 'Self Sourced' THEN sale_value ELSE 0 END), 2) AS named_external_credit_value
    FROM crm_orders
    WHERE run_id = 'carma_sales_2026_07_13_19'
  `).get();
  const overlap = db.prepare(`
    SELECT
      COUNT(DISTINCT customer_id) AS exact_customer_matches,
      COUNT(DISTINCT call_id) AS matching_calls,
      COUNT(DISTINCT order_id) AS matching_orders,
      SUM(CASE WHEN source_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS source_comparisons,
      SUM(CASE WHEN source_comparison = 'match' THEN 1 ELSE 0 END) AS source_matches,
      SUM(CASE WHEN import_date_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS date_comparisons,
      SUM(CASE WHEN import_date_comparison = 'match' THEN 1 ELSE 0 END) AS date_matches
    FROM v_combined_customer_proof
  `).get();
  const oldOverlap = db.prepare(`
    SELECT
      COUNT(DISTINCT p.customer_id) AS exact_customer_matches,
      COUNT(DISTINCT p.call_id) AS matching_calls,
      COUNT(DISTINCT p.order_id) AS matching_orders,
      SUM(CASE WHEN p.source_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS source_comparisons,
      SUM(CASE WHEN p.source_comparison = 'match' THEN 1 ELSE 0 END) AS source_matches,
      SUM(CASE WHEN p.import_date_comparison <> 'not_comparable' THEN 1 ELSE 0 END) AS date_comparisons,
      SUM(CASE WHEN p.import_date_comparison = 'match' THEN 1 ELSE 0 END) AS date_matches
    FROM v_combined_customer_proof p
    JOIN crm_orders o ON o.order_id = p.order_id
    WHERE o.run_id = 'carma_sales_2026_07_19_25'
  `).get();
  const creditCoverage = db.prepare(`
    SELECT
      COUNT(*) AS target_orders,
      SUM(CASE WHEN carma_credited_source <> 'Unverified' THEN 1 ELSE 0 END) AS orders_with_credit_evidence,
      SUM(CASE WHEN carma_credited_source = 'Unverified' THEN 1 ELSE 0 END) AS orders_without_credit_evidence,
      SUM(direct_reporting_error) AS direct_reporting_errors
    FROM crm_orders
  `).get();
  const sourceCampaignCheck = db.prepare(`
    SELECT COUNT(*) AS violations
    FROM crm_orders
    WHERE acquisition_source_type LIKE '%(Batch)%'
       OR policy_credit_source LIKE '%(Batch)%'
  `).get().violations;
  const leadSourceClassificationCheck = db.prepare(`
    SELECT COUNT(*) AS violations
    FROM crm_orders
    WHERE (seller_allocated_before_sale = 1 AND lead_source_classification <> 'Company Sourced')
       OR (seller_allocated_before_sale = 0 AND lead_source_classification <> 'Self Sourced')
       OR lead_source_classification_rule_version <> ?
  `).get(POLICY_VERSION).violations;
  const phoneColumns = db.prepare(`
    SELECT COUNT(*) AS count
    FROM pragma_table_list t
    JOIN pragma_table_info(t.name) c
    WHERE LOWER(c.name) LIKE '%phone%' OR LOWER(c.name) LIKE '%mobile%'
  `).get().count;

  const proofRows = db.prepare("SELECT * FROM v_combined_customer_proof ORDER BY sale_approved_at, order_id, call_at").all();
  const noAllocationRows = db.prepare("SELECT * FROM v_no_exact_seller_allocation ORDER BY sale_approved_at, order_id").all();
  const creditJoinRows = db.prepare(`
    SELECT
      order_id,
      customer_id,
      sale_approved_at,
      sale_value,
      lead_source_classification,
      policy_credit_source,
      allowable_external_credit,
      carma_credited_source,
      carma_credited_value,
      carma_external_credited_value,
      validation_status,
      CASE WHEN carma_credited_source = 'Unverified' THEN 'exhaustive_no_match' ELSE 'exact_order_match' END AS credit_search_result,
      reporting_finding
    FROM crm_orders
    ORDER BY sale_approved_at, order_id
  `).all();
  writeCsv(proofCsvPath, proofRows);
  writeCsv(noAllocationCsvPath, noAllocationRows);
  writeCsv(creditJoinCsvPath, creditJoinRows);
  fs.writeFileSync(creditSearchAuditPath, `${JSON.stringify({
    schemaVersion: "carma_credit_search_audit.v1",
    generatedAt,
    targetOrders: creditJoinRows.length,
    parsedCreditLedgerRows: creditRows.length,
    exactOrderMatches: creditJoinRows.filter((row) => row.credit_search_result === "exact_order_match").length,
    exhaustiveNoMatches: creditJoinRows.filter((row) => row.credit_search_result === "exhaustive_no_match").length,
    searchMethod: "Every target order number was searched against every parsed approved row in the saved 5,750-row Lead Generators Sales ledger.",
    repeatedCarmaExtraction: false,
    limitation: "The parsed ledger remains $3,801.20 below the displayed Carma report total."
  }, null, 2)}\n`, "utf8");

  const verification = {
    schemaVersion: SCHEMA_VERSION,
    policyRuleVersion: POLICY_VERSION,
    generatedAt,
    database: {
      fileName: path.basename(dbPath),
      sha256: sha256File(dbPath),
      integrityCheck: integrity,
      foreignKeyIssueCount: foreignKeyIssues.length,
      counts
    },
    correction: {
      allocationFilterField: "seller_allocated_before_sale",
      primaryFailureReasonUsedForPopulation: false,
      oldCohortNoExactSellerAllocation: oldNoAllocation,
      priorFocusedRuleBaseline: oldFocusedBaseline,
      explanation: "The locked top-level classification uses exact actual-seller pre-sale allocation only. Possible aliases remain review flags and never count as exact allocation without an authoritative identity map."
    },
    latestCompletedWeek: latest,
    creditCoverage,
    exactJoinProof: {
      expandedTwoCohortContract: overlap,
      original293OrderCohortBaseline: oldOverlap
    },
    safety: {
      joinRule: "exact customer_id only",
      phoneMatchingUsed: false,
      phoneNamedColumns: phoneColumns,
      sourceCampaignViolations: sourceCampaignCheck,
      leadSourceClassificationViolations: leadSourceClassificationCheck,
      rawPathsExposed: false,
      databaseOpenedReadOnlyByDashboard: true
    },
    limitations: [
      "Lead Generators Sales parsed rows remain $3,801.20 below the displayed Carma report total.",
      "Possible seller aliases are review-only and are never treated as exact identities.",
      "Company Sourced/Self Sourced is an allocation classification; named acquisition channels and external credit policy remain separate dimensions.",
      "Sale value is a Carma approved-sale amount, not paid or recognised revenue.",
      "The Sales Dashboard call cohort predates both sale cohorts; exact customer overlap is evidence linkage, not call-to-sale causation."
    ]
  };
  fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  db.close();

  return {
    outputDir,
    dbPath,
    verificationPath,
    proofCsvPath,
    noAllocationCsvPath,
    creditJoinCsvPath,
    creditSearchAuditPath,
    verification
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = build({
      outputDir: args["output-dir"],
      oldDecisions: args["old-decisions"],
      oldAllocations: args["old-allocations"],
      newDecisions: args["new-decisions"],
      newAllocations: args["new-allocations"],
      credits: args.credits,
      calls: args.calls
    });
    process.stdout.write(`${JSON.stringify(result.verification, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  EXTERNAL_CREDIT_POLICY_VERSION,
  POLICY_VERSION,
  SCHEMA_VERSION,
  build,
  isCampaignLabel,
  normalizeSourceType
};
