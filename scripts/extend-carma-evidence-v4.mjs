import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../src/csvParser");

const SCHEMA_VERSION = "carma_evidence.v4";
const POPULATION_CONTRACT = "carma_approved_sales_show_new_customers_false.v1";
const POLICY_VERSION = "actual_seller_any_pre_sale_allocation.v1";
const TIMESTAMP_STATUS = "unavailable_after_two_read_only_captures";
const ALLOCATION_STATUS = "allocation_history_unavailable_after_targeted_read_only_capture";

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return args;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePerson(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function stableId(prefix, ...parts) {
  const digest = crypto.createHash("sha256").update(parts.map(clean).join("\u241f")).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

const MONTHS = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 });

function isoDate(value) {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const compact = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (compact) {
    const year = compact[3].length === 2 ? 2000 + Number(compact[3]) : Number(compact[3]);
    const month = MONTHS[compact[2].toLowerCase()];
    if (!month) throw new Error(`Invalid source month: ${text}`);
    return `${year}-${String(month).padStart(2, "0")}-${String(Number(compact[1])).padStart(2, "0")}`;
  }
  const long = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (long) {
    const month = MONTHS[long[2].slice(0, 3).toLowerCase()];
    if (!month) throw new Error(`Invalid source month: ${text}`);
    return `${long[3]}-${String(month).padStart(2, "0")}-${String(Number(long[1])).padStart(2, "0")}`;
  }
  throw new Error(`Unsupported source date: ${text}`);
}

function optionalIsoDate(value) {
  if (!clean(value)) return "";
  try {
    return isoDate(value);
  } catch {
    return "";
  }
}

function approvalTimestamp(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Invalid explicit approval timestamp: ${text}`);
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}.000Z`;
}

function timestampAtStart(date) {
  return date ? `${date}T00:00:00.000Z` : "";
}

function weeklyAllocationTimestamp(dateValue, timeValue) {
  const date = clean(dateValue);
  const time = clean(timeValue) || "00:00:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Invalid weekly allocation timestamp: ${date} ${time}`);
  }
  return `${date}T${time}.000Z`;
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

const args = argsFrom(process.argv.slice(2));
const periodStart = clean(args["period-start"]);
const periodEnd = clean(args["period-end"]);
const baseDbPath = path.resolve(args["base-db"] || "");
const csvPath = path.resolve(args.csv || "");
const enrichmentManifestPath = path.resolve(args["enrichment-manifest"] || "");
const allocationJsonlPath = path.resolve(args["allocation-jsonl"] || "");
const allocationIndexPath = path.resolve(args["allocation-index"] || "");
const allocationParseManifestPath = path.resolve(args["allocation-parse-manifest"] || "");
const allocationCoveragePath = path.resolve(args["allocation-coverage"] || "");
const weeklyAllocationPath = path.resolve(args["weekly-allocation"] || "");
const outputDir = path.resolve(args.output || "");
if (!args["period-start"] || !args["period-end"] || !args["base-db"] || !args.csv || !args["enrichment-manifest"] || !args["allocation-jsonl"] || !args["allocation-index"] || !args["allocation-parse-manifest"] || !args["allocation-coverage"] || !args["weekly-allocation"] || !args.output) {
  throw new Error("Required: --period-start --period-end --base-db --csv --enrichment-manifest --allocation-jsonl --allocation-index --allocation-parse-manifest --allocation-coverage --weekly-allocation --output");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
  throw new Error("--period-start and --period-end must be a valid ordered YYYY-MM-DD period");
}
const runId = `carma_sales_all_${periodStart.replaceAll("-", "_")}_${periodEnd.replaceAll("-", "_")}`;
for (const requiredPath of [baseDbPath, csvPath, enrichmentManifestPath, allocationJsonlPath, allocationIndexPath, allocationParseManifestPath, allocationCoveragePath, weeklyAllocationPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Required source is missing: ${requiredPath}`);
}

const enrichment = readJson(enrichmentManifestPath);
const allocationIndex = readJson(allocationIndexPath);
const parseManifest = readJson(allocationParseManifestPath);
const allocationCoverage = readJson(allocationCoveragePath);
const salesRows = parseCsv(fs.readFileSync(csvPath, "utf8")).rows;
const allocationRows = readJsonl(allocationJsonlPath);
const weeklyAllocationRows = parseCsv(fs.readFileSync(weeklyAllocationPath, "utf8")).rows;
const orderIds = salesRows.map((row) => clean(row.Order));
const uniqueOrderIds = new Set(orderIds);
const exceptionOrders = new Set((enrichment.approvalTimestampExceptionOrders || []).map(clean));
const totalValue = salesRows.reduce((sum, row) => sum + Number(row["Amount ex GST"] || 0), 0);

if (enrichment.report !== "Approved Sales by Customer for Period" || enrichment.period?.start !== periodStart || enrichment.period?.end !== periodEnd) {
  throw new Error(`The enrichment manifest does not describe the governed ${periodStart} to ${periodEnd} report`);
}
if (salesRows.length === 0 || uniqueOrderIds.size !== salesRows.length) {
  throw new Error(`Approved-sales reconciliation failed: rows=${salesRows.length}, unique=${uniqueOrderIds.size}, value=${totalValue}`);
}
if (
  Number(enrichment.reconciliation?.sourceOrders) !== salesRows.length
  || Number(enrichment.reconciliation?.enrichedOrders) !== salesRows.length
  || Number(enrichment.reconciliation?.uniqueOrderIds) !== salesRows.length
  || Math.abs(Number(enrichment.reconciliation?.enrichedValueExGst) - totalValue) >= 0.005
  || Number(enrichment.reconciliation?.explicitApprovalTimestamps) + exceptionOrders.size !== salesRows.length
  || Number(enrichment.reconciliation?.approvalTimestampExceptions) !== exceptionOrders.size
) {
  throw new Error("Approval timestamp and source-population reconciliation does not match the enriched approved-sales evidence");
}
const sourceWorkbookPath = path.resolve(enrichment.inputs?.sourceWorkbook?.path || "");
if (!fs.existsSync(sourceWorkbookPath) || sha256File(sourceWorkbookPath).toUpperCase() !== clean(enrichment.inputs?.sourceWorkbook?.sha256).toUpperCase()) {
  throw new Error("The approved-sales source workbook hash does not match the enrichment manifest");
}
const weeklyPositiveOnly = allocationCoverage.weeklyPositiveOnly || [];
const coverageWithheld = allocationCoverage.attributionWithheld || [];
const expectedHistoryOrders = salesRows.length - weeklyPositiveOnly.length - coverageWithheld.length;
if (
  allocationCoverage.processVersion !== "LEAD-RESULT-ALLOCATION-COVERAGE-1"
  || Number(allocationCoverage.sourceOrders) !== salesRows.length
  || Number(allocationCoverage.uniqueCustomers) !== new Set(salesRows.map((row) => clean(row["Customer ID"]))).size
  || Number(allocationCoverage.historyCoveredOrders) !== expectedHistoryOrders
  || Number(allocationCoverage.weeklyPositiveOnlyOrders) !== weeklyPositiveOnly.length
  || Number(allocationCoverage.attributionWithheldOrders) !== coverageWithheld.length
  || sha256File(csvPath) !== clean(allocationCoverage.sourceHashes?.enrichedCsv)
  || sha256File(weeklyAllocationPath) !== clean(allocationCoverage.sourceHashes?.weeklyAllocation)
) {
  throw new Error("Allocation coverage manifest does not reconcile to the governed approved-sales and weekly sources");
}
if (Number(allocationIndex.orders) !== expectedHistoryOrders || Number(parseManifest.sourceOrders) !== expectedHistoryOrders || Number(parseManifest.parsedOrders) !== expectedHistoryOrders || Number(parseManifest.failedOrders) !== 0) {
  throw new Error(`Allocation parser output does not reconcile to ${expectedHistoryOrders} history-covered approved orders`);
}
const indexedOrders = new Set((allocationIndex.items || []).map((row) => clean(row.orderId)));
const weeklyPositiveByOrder = new Map(weeklyPositiveOnly.map((row) => [clean(row.orderId), row]));
const coverageWithheldByOrder = new Map(coverageWithheld.map((row) => [clean(row.orderId), row]));
const missingHistoryOrderIds = orderIds.filter((orderId) => !indexedOrders.has(orderId));
if (
  indexedOrders.size !== expectedHistoryOrders
  || weeklyPositiveByOrder.size !== weeklyPositiveOnly.length
  || coverageWithheldByOrder.size !== coverageWithheld.length
  || missingHistoryOrderIds.length !== weeklyPositiveOnly.length + coverageWithheld.length
  || missingHistoryOrderIds.some((orderId) => !weeklyPositiveByOrder.has(orderId) && !coverageWithheldByOrder.has(orderId))
) {
  throw new Error("History-covered and weekly-positive order IDs do not exactly partition the approved-sales population");
}

const allocationsByOrder = new Map();
for (const row of allocationRows) {
  const orderId = clean(row.orderId);
  if (!uniqueOrderIds.has(orderId)) throw new Error(`Allocation evidence contains an unexpected order: ${orderId}`);
  if (!allocationsByOrder.has(orderId)) allocationsByOrder.set(orderId, []);
  allocationsByOrder.get(orderId).push(row);
}
const indexByOrder = new Map((allocationIndex.items || []).map((row) => [clean(row.orderId), row]));
const normalized = salesRows.map((row) => {
  const orderId = clean(row.Order);
  const customerId = clean(row["Customer ID"]);
  const seller = clean(row["Salesperson (Report)"]);
  if (!/^\d+$/.test(orderId) || !/^\d+$/.test(customerId) || !seller) throw new Error(`Invalid governed identifiers for order ${orderId}`);
  const explicit = clean(row["Approval Status"]).toLowerCase() === "explicit";
  if (explicit === exceptionOrders.has(orderId)) throw new Error(`Timestamp status conflicts with manifest for order ${orderId}`);
  const approvalAt = explicit ? approvalTimestamp(row["Approval Timestamp"]) : "";
  const approvalDate = approvalAt.slice(0, 10);
  if (explicit && (approvalDate < periodStart || approvalDate > periodEnd)) throw new Error(`Approval timestamp is outside the report period for order ${orderId}`);
  const weeklyPositive = weeklyPositiveByOrder.get(orderId) || null;
  const attributionWithheld = coverageWithheldByOrder.get(orderId) || null;
  let allocations = allocationsByOrder.get(orderId) || [];
  if (weeklyPositive) {
    if (!explicit) throw new Error(`Weekly positive-only proof cannot classify timestamp-exception order ${orderId}`);
    const proof = weeklyAllocationRows.find((allocation) => (
      clean(allocation.CustomerID) === customerId
      && normalizePerson(allocation.FullName) === normalizePerson(seller)
      && clean(allocation.AllocationItemID) === clean(weeklyPositive.allocationItemId)
    ));
    if (!proof) throw new Error(`Weekly positive-only source row is missing for approved order ${orderId}`);
    const sentAt = weeklyAllocationTimestamp(proof.DateSentToSalesperson_Date, proof.DateSentToSalesperson_Time);
    if (sentAt > approvalAt) throw new Error(`Weekly positive-only allocation is after approval for order ${orderId}`);
    allocations = [{
      orderId,
      customerId,
      historyId: `weekly:${clean(proof.AllocationItemID)}`,
      created: clean(proof.DateSentToSalesperson_Date),
      sent: clean(proof.DateSentToSalesperson_Date),
      sentAt,
      inactivated: clean(proof.InactiveDate_Date),
      recipient: clean(proof.FullName),
      salesManager: clean(proof.SalesManager),
      description: clean(proof.AllocationName),
      evidenceSource: "exact_weekly_allocation_export"
    }];
  }
  const enrichedAllocations = allocations.map((allocation, index) => {
    const startDate = isoDate(allocation.sent || allocation.created);
    const inactivatedDate = isoDate(allocation.inactivated);
    const recipientExactSeller = normalizePerson(allocation.recipient) === normalizePerson(seller);
    const startedBeforeSale = explicit && Boolean(startDate) && startDate <= approvalDate;
    const activeAtSale = startedBeforeSale && (!inactivatedDate || inactivatedDate >= approvalDate);
    const ageDays = explicit ? daysBetween(startDate, approvalDate) : null;
    return { ...allocation, index, startDate, inactivatedDate, recipientExactSeller, startedBeforeSale, activeAtSale, ageDays };
  });
  const exactPreSale = explicit
    ? enrichedAllocations.filter((allocation) => allocation.recipientExactSeller && allocation.startedBeforeSale)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || clean(a.historyId).localeCompare(clean(b.historyId)))
    : [];
  const selected = exactPreSale[0] || null;
  const classification = explicit && !attributionWithheld
    ? (selected ? "Company Sourced" : "Self Sourced")
    : "Attribution Withheld";
  return {
    row,
    orderId,
    customerId,
    customerName: clean(row.Customer),
    seller,
    value: Number(row["Amount ex GST"] || 0),
    explicit,
    approvalAt,
    approvalDate,
    allocations: enrichedAllocations,
    selected,
    classification,
    index: indexByOrder.get(orderId),
    weeklyPositiveOnly: Boolean(weeklyPositive),
    attributionWithheld: Boolean(attributionWithheld)
  };
});

const counts = normalized.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] || 0) + 1;
  return acc;
}, {});
const audit = {
  processVersion: "SALES-DASHBOARD-CARMA-V4-INGEST-1",
  generatedAt: new Date().toISOString(),
  report: enrichment.report,
  period: enrichment.period,
  populationContract: POPULATION_CONTRACT,
  joinRule: "exact customer_id only",
  phoneMatching: "prohibited",
  allocationMatching: "exact normalized full seller label only",
  approvalTimestampSemantics: "Australia/Sydney wall-clock components; no offset conversion",
  sourceHashes: {
    approvedSalesWorkbook: sha256File(sourceWorkbookPath),
    enrichedCsv: sha256File(csvPath),
    enrichmentManifest: sha256File(enrichmentManifestPath),
    firstPassEvidence: clean(enrichment.inputs.firstPassEvidence.sha256).toLowerCase(),
    secondPassEvidence: clean(enrichment.inputs.secondPassEvidence.sha256).toLowerCase(),
    allocationJsonl: sha256File(allocationJsonlPath),
    allocationIndex: sha256File(allocationIndexPath),
    allocationParseManifest: sha256File(allocationParseManifestPath),
    allocationCoverage: sha256File(allocationCoveragePath),
    weeklyAllocation: sha256File(weeklyAllocationPath)
  },
  reconciliation: {
    orders: normalized.length,
    uniqueOrders: uniqueOrderIds.size,
    uniqueCustomers: new Set(normalized.map((row) => row.customerId)).size,
    totalValue,
    explicitApprovalTimestamps: normalized.filter((row) => row.explicit).length,
    approvalTimestampExceptions: normalized.filter((row) => !row.explicit).length,
    allocatedLeadSales: counts["Company Sourced"] || 0,
    selfSourcedSales: counts["Self Sourced"] || 0,
    attributionWithheld: counts["Attribution Withheld"] || 0,
    allocationRows: allocationRows.length,
    historyCoveredOrders: normalized.filter((row) => !row.weeklyPositiveOnly && !row.attributionWithheld).length,
    weeklyPositiveOnlyOrders: normalized.filter((row) => row.weeklyPositiveOnly).length,
    allocationCoverageWithheldOrders: normalized.filter((row) => row.attributionWithheld).length,
    unusableLeadImportDates: normalized.filter((row) => clean(row.index?.leadImportDate) && !optionalIsoDate(row.index?.leadImportDate)).length
  },
  safeguards: [
    `All ${salesRows.length} approved orders are retained; ${normalized.filter((row) => row.explicit).length} have explicit approval timestamps from exact-order evidence.`,
    "A missing complete allocation history may contribute only an exact Customer ID and normalized full-seller weekly allocation sent before explicit approval; otherwise attribution is withheld and missing history can never produce Self Sourced.",
    "Campaign and import-source text are recorded but never decide Allocated-Lead versus Self Sourced.",
    "No phone, fuzzy-name or call-causation matching is used."
  ]
};

await fsp.mkdir(outputDir, { recursive: true });
const auditPath = path.join(outputDir, "carma-v4-ingestion-audit.json");
await fsp.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
const databasePath = path.join(outputDir, "carma-evidence.sqlite");
if (fs.existsSync(databasePath)) throw new Error(`Refusing to overwrite existing governed database: ${databasePath}`);
await fsp.copyFile(baseDbPath, databasePath);

const generatedAt = new Date().toISOString();
const periodToken = `${periodStart}_to_${periodEnd}`;
const salesProvenanceId = stableId("prov", `approved_sales_${periodToken}`, sha256File(csvPath));
const allocationProvenanceId = stableId("prov", `allocation_history_${periodToken}`, sha256File(allocationJsonlPath));
const weeklyAllocationProvenanceId = stableId("prov", `weekly_allocation_positive_proof_${periodToken}`, sha256File(weeklyAllocationPath));
const db = new DatabaseSync(databasePath);
try {
  db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_order_timestamp_exceptions (
      order_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      actual_seller TEXT NOT NULL,
      sale_value REAL NOT NULL CHECK (sale_value >= 0),
      acquisition_source_type TEXT NOT NULL DEFAULT '',
      acquisition_source_proven INTEGER NOT NULL CHECK (acquisition_source_proven IN (0, 1)),
      sale_approved_at TEXT NOT NULL DEFAULT '',
      approval_timestamp_status TEXT NOT NULL CHECK (approval_timestamp_status IN ('${TIMESTAMP_STATUS}', 'explicit')),
      attribution_withheld_reason TEXT NOT NULL DEFAULT '',
      approval_evidence TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES extraction_runs(run_id),
      FOREIGN KEY (customer_id) REFERENCES crm_customers(customer_id),
      FOREIGN KEY (source_provenance_id) REFERENCES crm_source_provenance(provenance_id)
    ) STRICT;
  `);
  const metaUpsert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  metaUpsert.run("schema_version", SCHEMA_VERSION);
  metaUpsert.run("generated_at", generatedAt);
  metaUpsert.run("approval_timestamp_exception_policy", TIMESTAMP_STATUS);

  const provenanceInsert = db.prepare(`
    INSERT INTO crm_source_provenance (provenance_id, dataset_type, source_file_name, source_sha256, extracted_at, raw_path_exposed, notes)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  provenanceInsert.run(salesProvenanceId, `approved_sales_${periodToken}`, path.basename(csvPath), sha256File(csvPath), generatedAt, `Complete all-customer approved-sales population with exact Customer IDs; ${normalized.filter((row) => row.explicit).length} exact-order approval timestamps and ${normalized.filter((row) => !row.explicit).length} timestamp exceptions retained.`);
  provenanceInsert.run(allocationProvenanceId, `customer_lead_allocation_history_${periodToken}`, path.basename(allocationJsonlPath), sha256File(allocationJsonlPath), generatedAt, "Read-only Customer Lead Allocation histories joined to approved orders by exact Customer ID and matched to seller by exact normalized full label.");
  provenanceInsert.run(weeklyAllocationProvenanceId, `weekly_allocation_positive_proof_${periodToken}`, path.basename(weeklyAllocationPath), sha256File(weeklyAllocationPath), generatedAt, `Positive-only fallback for ${weeklyPositiveOnly.length} order(s) without complete retained allocation history: exact Customer ID, normalized full seller and sent-before-approval timing. Absence is never used.`);

  db.prepare(`
    INSERT INTO extraction_runs
      (run_id, dataset_type, population_contract, show_new_customers_only, completeness_status, period_start, period_end,
       extracted_at, source_provenance_id, source_report_sha256, source_manifest_sha256, extraction_audit_sha256, row_count, notes)
    VALUES (?, 'approved_sales', ?, 0, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    POPULATION_CONTRACT,
    periodStart,
    periodEnd,
    generatedAt,
    salesProvenanceId,
    sha256File(sourceWorkbookPath),
    sha256File(enrichmentManifestPath),
    sha256File(auditPath),
    salesRows.length,
    `Unfiltered all-customer Approved Sales report; ${normalized.filter((row) => row.explicit).length} explicit approval timestamps; ${normalized.filter((row) => row.attributionWithheld).length} source-attribution exception(s) retained without negative inference.`
  );

  const customerInsert = db.prepare(`
    INSERT INTO crm_customers
      (customer_id, customer_name, customer_import_source_raw, customer_import_source_type, customer_import_date, customer_created_by, source_provenance_id)
    VALUES (?, ?, ?, ?, ?, '', ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      customer_name = CASE WHEN excluded.customer_name <> '' THEN excluded.customer_name ELSE crm_customers.customer_name END,
      customer_import_source_raw = CASE WHEN excluded.customer_import_source_raw <> '' THEN excluded.customer_import_source_raw ELSE crm_customers.customer_import_source_raw END,
      customer_import_source_type = CASE WHEN excluded.customer_import_source_type <> '' THEN excluded.customer_import_source_type ELSE crm_customers.customer_import_source_type END,
      customer_import_date = CASE WHEN excluded.customer_import_date <> '' THEN excluded.customer_import_date ELSE crm_customers.customer_import_date END
  `);
  const orderInsert = db.prepare(`
    INSERT INTO crm_orders (
      order_id, run_id, customer_id, customer_name, actual_seller, sale_approved_at, sale_value,
      acquisition_source_type, acquisition_source_raw, acquisition_source_proven, campaign,
      lead_source_classification, lead_source_classification_rule_version, lead_source_classification_reason,
      policy_credit_source, allowable_external_credit, seller_allocated_before_sale, seller_allocation_date,
      seller_allocation_within_28_days, seller_allocation_active_at_sale, possible_alias_review,
      later_other_allocation_ignored, policy_rule_version, decision_reason, legacy_primary_failure_reason,
      carma_credited_source, carma_credited_value, carma_external_credited_value, reporting_finding,
      direct_reporting_error, validation_status, source_provenance_id
    ) VALUES (${Array.from({ length: 32 }, () => "?").join(", ")})
  `);
  const exceptionInsert = db.prepare(`
    INSERT INTO crm_order_timestamp_exceptions
      (order_id, run_id, customer_id, customer_name, actual_seller, sale_value, acquisition_source_type,
       acquisition_source_proven, sale_approved_at, approval_timestamp_status, attribution_withheld_reason,
       approval_evidence, source_provenance_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const allocationInsert = db.prepare(`
    INSERT INTO crm_allocations (
      allocation_id, run_id, order_id, customer_id, history_id, effective_start_at, inactivated_at,
      recipient, sales_manager, description, recipient_exact_seller, recipient_possible_alias,
      started_before_sale, active_at_sale, qualifies_seller_within_28_days, source_provenance_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `);

  for (const order of normalized) {
    const importSource = clean(order.row["Import Source"]);
    const acquisitionType = importSource || "Unverified";
    const customerImportDate = optionalIsoDate(order.index?.leadImportDate);
    customerInsert.run(order.customerId, order.customerName, importSource, acquisitionType, customerImportDate, salesProvenanceId);
    if (!order.explicit || order.attributionWithheld) {
      exceptionInsert.run(
        order.orderId,
        runId,
        order.customerId,
        order.customerName,
        order.seller,
        order.value,
        acquisitionType,
        importSource ? 1 : 0,
        order.approvalAt,
        order.explicit ? "explicit" : TIMESTAMP_STATUS,
        order.attributionWithheld ? ALLOCATION_STATUS : TIMESTAMP_STATUS,
        order.attributionWithheld
          ? "Explicit approval timestamp retained, but complete exact-customer allocation history was unavailable after targeted read-only capture and no exact weekly positive proof existed; source attribution withheld."
          : `No explicit approval timestamp after first-pass and targeted second-pass read-only captures; evidence hashes ${clean(enrichment.inputs.firstPassEvidence.sha256)} and ${clean(enrichment.inputs.secondPassEvidence.sha256)}.`,
        salesProvenanceId
      );
      continue;
    }
    const selected = order.selected;
    const classification = order.classification;
    const selectedAge = selected ? daysBetween(selected.startDate, order.approvalDate) : null;
    orderInsert.run(
      order.orderId,
      runId,
      order.customerId,
      order.customerName,
      order.seller,
      order.approvalAt,
      order.value,
      acquisitionType,
      importSource,
      importSource ? 1 : 0,
      clean(order.index?.leadSource),
      classification,
      POLICY_VERSION,
      selected
        ? order.weeklyPositiveOnly
          ? "Company Sourced — an exact weekly Customer ID and full-seller allocation was sent before the explicit approval timestamp; missing history was not used negatively."
          : "Company Sourced — the actual seller had an exact recorded allocation before the explicit approval timestamp."
        : "Self Sourced — no exact recorded pre-approval allocation to the actual seller was found in the complete customer history.",
      classification,
      null,
      selected ? 1 : 0,
      selected ? timestampAtStart(selected.startDate) : "",
      selectedAge !== null && selectedAge >= 0 && selectedAge <= 28 ? 1 : 0,
      selected?.activeAtSale ? 1 : 0,
      0,
      0,
      POLICY_VERSION,
      selected
        ? order.weeklyPositiveOnly
          ? "Exact weekly Customer ID and normalized full seller label matched an allocation sent before approval."
          : "Exact Customer ID and exact full seller label matched a pre-approval allocation."
        : "Complete exact Customer ID allocation history contained no pre-approval allocation to the exact full seller label.",
      "",
      "Unverified",
      0,
      0,
      "Approved-sales outcome retained; source classification rebuilt from exact read-only allocation history.",
      0,
      "verified",
      salesProvenanceId
    );
    for (const allocation of order.allocations) {
      allocationInsert.run(
        stableId("allocation", runId, order.orderId, allocation.historyId, allocation.index),
        runId,
        order.orderId,
        order.customerId,
        clean(allocation.historyId),
        allocation.sentAt || timestampAtStart(allocation.startDate),
        timestampAtStart(allocation.inactivatedDate),
        clean(allocation.recipient),
        clean(allocation.salesManager),
        clean(allocation.description),
        allocation.recipientExactSeller ? 1 : 0,
        allocation.startedBeforeSale ? 1 : 0,
        allocation.activeAtSale ? 1 : 0,
        allocation.recipientExactSeller && allocation.startedBeforeSale && allocation.ageDays !== null && allocation.ageDays >= 0 && allocation.ageDays <= 28 ? 1 : 0,
        allocation.evidenceSource === "exact_weekly_allocation_export" ? weeklyAllocationProvenanceId : allocationProvenanceId
      );
    }
  }

  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new Error(`Foreign-key validation failed for ${foreignKeys.length} row(s)`);
  const inserted = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM crm_orders WHERE run_id = ?) AS classified,
      (SELECT COUNT(*) FROM crm_order_timestamp_exceptions WHERE run_id = ?) AS exceptions,
      (SELECT COALESCE(SUM(sale_value), 0) FROM crm_orders WHERE run_id = ?) +
        (SELECT COALESCE(SUM(sale_value), 0) FROM crm_order_timestamp_exceptions WHERE run_id = ?) AS total_value
  `).get(runId, runId, runId, runId);
  const expectedClassified = normalized.filter((row) => row.explicit && !row.attributionWithheld).length;
  const expectedExceptions = normalized.length - expectedClassified;
  if (Number(inserted.classified) !== expectedClassified || Number(inserted.exceptions) !== expectedExceptions || Math.abs(Number(inserted.total_value) - totalValue) >= 0.005) {
    throw new Error(`Inserted database reconciliation failed: ${JSON.stringify(inserted)}`);
  }
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch {}
  throw error;
} finally {
  db.close();
}

const verification = {
  verdict: "PASS",
  databasePath,
  databaseSha256: sha256File(databasePath),
  sourceDatabasePath: baseDbPath,
  sourceDatabaseSha256: sha256File(baseDbPath),
  ingestionAuditPath: auditPath,
  ingestionAuditSha256: sha256File(auditPath),
  reconciliation: audit.reconciliation
};
const verificationPath = path.join(outputDir, "carma-evidence-v4-verification.json");
await fsp.writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
