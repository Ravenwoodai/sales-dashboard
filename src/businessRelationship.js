"use strict";

const fs = require("fs");
const path = require("path");

const BUSINESS_RELATIONSHIP_SCHEMA_VERSION = "sales_dashboard_business_relationship_evidence.v1";
const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "data", "store", "carma-evidence.json");
const relationshipsByRow = new WeakMap();

function clean(value) {
  return String(value ?? "").trim();
}

function positiveOrderCount(row) {
  const value = Number(clean(row?.OrderCount).replaceAll(",", ""));
  return Number.isFinite(value) && value > 0;
}

function exactCustomerId(row) {
  const value = clean(row?.customer_id);
  return /^(?:null|undefined|n\/a)$/i.test(value) ? "" : value;
}

function canonicalWallClock(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19);
  }
  const text = clean(value);
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3}Z?)?$/
  );
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}`;
}

function callWallClock(row, suppliedCallAt = null) {
  const supplied = canonicalWallClock(suppliedCallAt);
  if (supplied) return supplied;
  const date = clean(row?.call_date).replace(/\s+12:00:00\s+[AP]M$/i, "");
  const time = clean(row?.call_time) || "00:00:00";
  let match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return canonicalWallClock(
      `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${time}`
    );
  }
  match = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const first = Number(match[1]);
  const second = Number(match[2]);
  const dateOrder = clean(row?.__callDateOrder).toLowerCase();
  const monthFirst = dateOrder === "mdy" || (second > 12 && first <= 12);
  const day = monthFirst ? match[2] : match[1];
  const month = monthFirst ? match[1] : match[2];
  return canonicalWallClock(
    `${match[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}`
  );
}

function relationshipResult(segment, rule, tier, details = {}) {
  const warm = segment === "warm";
  return {
    segment: warm ? "warm" : "new",
    label: warm ? "Warm Business" : "New Business",
    orderHistoryLabel: warm ? "Previous Sales History" : "No Prior Sale Established",
    rule,
    evidenceTier: tier,
    evidenceQuality: tier === "exact" ? "authoritative" : tier === "supporting" ? "supporting" : "fallback",
    customerId: details.customerId || "",
    customerIdField: details.customerId ? "customer_id" : "",
    callAt: details.callAt || "",
    boundaryAt: details.boundaryAt || "",
    invoiceNumber: details.invoiceNumber || "",
    orderNumber: details.orderNumber || "",
    source: details.source || "",
    fallbackUsed: tier === "fallback",
    exactHistoryUsed: tier === "exact",
    explanation: details.explanation || ""
  };
}

function fallbackRelationship(row, customerId, callAt) {
  if (positiveOrderCount(row)) {
    return relationshipResult("warm", "order_count_positive_fallback", "fallback", {
      customerId,
      callAt,
      source: "weekly_call_export.OrderCount",
      explanation: "No stronger event-time boundary controlled this call; the export snapshot reports one or more orders."
    });
  }
  return relationshipResult("new", customerId ? "order_count_zero_fallback" : "missing_customer_id_cold_fallback", "fallback", {
    customerId,
    callAt,
    source: "weekly_call_export.OrderCount",
    explanation: customerId
      ? "No prior-sale evidence was found in the retained index and the export snapshot is blank or zero."
      : "No exact customer_id was supplied; the mandatory binary policy assigns the call to New Business."
  });
}

function normalizeCustomerEvidence(value = {}) {
  const detailedBoundaries = Array.isArray(value.detailedInvoiceBoundaries)
    ? value.detailedInvoiceBoundaries
      .map((boundary) => ({
        invoiceNumber: clean(boundary.invoiceNumber),
        orderNumber: clean(boundary.orderNumber),
        invoiceDate: clean(boundary.invoiceDate),
        issuedAt: canonicalWallClock(boundary.issuedAt),
        source: clean(boundary.source) || "carma_invoicing_summary"
      }))
      .filter((boundary) => boundary.invoiceNumber && /^\d{4}-\d{2}-\d{2}$/.test(boundary.invoiceDate))
      .sort((a, b) => (
        a.invoiceDate.localeCompare(b.invoiceDate)
        || a.issuedAt.localeCompare(b.issuedAt)
        || a.invoiceNumber.localeCompare(b.invoiceNumber)
      ))
    : [];
  const observedOrderCreatedAt = Array.isArray(value.observedOrderCreatedAt)
    ? Array.from(new Set(value.observedOrderCreatedAt.map(canonicalWallClock).filter(Boolean))).sort()
    : [];
  const warmAllocationDates = Array.isArray(value.warmAllocationDates)
    ? Array.from(new Set(value.warmAllocationDates.map(clean).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))).sort()
    : [];
  return {
    detailedHistoryComplete: value.detailedHistoryComplete === true,
    detailedInvoiceBoundaries: detailedBoundaries,
    observedOrderCreatedAt,
    warmAllocationDates
  };
}

function validateEvidenceDocument(document) {
  if (!document || document.schemaVersion !== BUSINESS_RELATIONSHIP_SCHEMA_VERSION) {
    throw new Error(`Unsupported business-relationship evidence schema: ${document?.schemaVersion || "missing"}`);
  }
  if (document.joinRule !== "exact customer_id only") {
    throw new Error("Business-relationship evidence must use exact customer_id only");
  }
  if (!document.customers || typeof document.customers !== "object" || Array.isArray(document.customers)) {
    throw new Error("Business-relationship evidence customers map is missing");
  }
  const customers = new Map();
  for (const [customerId, value] of Object.entries(document.customers)) {
    const id = clean(customerId);
    if (!id) {
      throw new Error("Business-relationship evidence contains an invalid customer_id key");
    }
    const allowedCustomerFields = new Set([
      "detailedHistoryComplete",
      "detailedInvoiceBoundaries",
      "observedOrderCreatedAt",
      "warmAllocationDates"
    ]);
    const unexpectedCustomerFields = Object.keys(value || {}).filter((field) => !allowedCustomerFields.has(field));
    if (unexpectedCustomerFields.length) {
      throw new Error(`Business-relationship evidence contains unsupported customer fields: ${unexpectedCustomerFields.join(", ")}`);
    }
    for (const boundary of value.detailedInvoiceBoundaries || []) {
      const allowedBoundaryFields = new Set(["invoiceNumber", "orderNumber", "invoiceDate", "issuedAt", "source"]);
      const unexpectedBoundaryFields = Object.keys(boundary || {}).filter((field) => !allowedBoundaryFields.has(field));
      if (unexpectedBoundaryFields.length) {
        throw new Error(`Business-relationship evidence contains unsupported invoice fields: ${unexpectedBoundaryFields.join(", ")}`);
      }
    }
    customers.set(id, normalizeCustomerEvidence(value));
  }
  return customers;
}

function unavailableEvidence({ configured = false, evidencePath = null, error = "", code = "" } = {}) {
  return {
    schemaVersion: BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
    configured,
    available: false,
    status: configured ? "unavailable" : "not_configured",
    readOnly: true,
    evidenceFileName: evidencePath ? path.basename(evidencePath) : "",
    evidencePath,
    generatedAt: "",
    joinRule: "exact customer_id only",
    customers: new Map(),
    totals: { customers: 0, detailedCustomers: 0, invoiceBoundaries: 0, observedOrderEvents: 0, warmAllocationDates: 0 },
    error,
    code
  };
}

function loadBusinessRelationshipEvidence({ evidencePath = null } = {}) {
  if (!evidencePath) return unavailableEvidence();
  const resolvedPath = path.resolve(evidencePath);
  if (!fs.existsSync(resolvedPath)) {
    return unavailableEvidence({
      configured: true,
      evidencePath: resolvedPath,
      error: "Configured business-relationship evidence file does not exist.",
      code: "BUSINESS_RELATIONSHIP_EVIDENCE_NOT_FOUND"
    });
  }
  try {
    const document = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const customers = validateEvidenceDocument(document);
    const values = [...customers.values()];
    return {
      schemaVersion: BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
      configured: true,
      available: true,
      status: "available",
      readOnly: true,
      evidenceFileName: path.basename(resolvedPath),
      evidencePath: resolvedPath,
      generatedAt: clean(document.generatedAt),
      joinRule: "exact customer_id only",
      customers,
      totals: {
        customers: customers.size,
        detailedCustomers: values.filter((value) => value.detailedHistoryComplete).length,
        invoiceBoundaries: values.reduce((sum, value) => sum + value.detailedInvoiceBoundaries.length, 0),
        observedOrderEvents: values.reduce((sum, value) => sum + value.observedOrderCreatedAt.length, 0),
        warmAllocationDates: values.reduce((sum, value) => sum + value.warmAllocationDates.length, 0)
      },
      error: "",
      code: ""
    };
  } catch (error) {
    return unavailableEvidence({
      configured: true,
      evidencePath: resolvedPath,
      error: error.message,
      code: "BUSINESS_RELATIONSHIP_EVIDENCE_INVALID"
    });
  }
}

function resolveBusinessRelationshipEvidencePath(argv = process.argv.slice(2), env = process.env, options = {}) {
  if (options.businessRelationshipEvidencePath) return path.resolve(options.businessRelationshipEvidencePath);
  const flagIndex = argv.findIndex((arg) => (
    arg === "--business-relationship-evidence"
    || arg === "--business-relationship-evidence-path"
  ));
  if (flagIndex >= 0 && argv[flagIndex + 1]) return path.resolve(argv[flagIndex + 1]);
  if (env.SALES_DASHBOARD_BUSINESS_RELATIONSHIP_EVIDENCE_PATH) {
    return path.resolve(env.SALES_DASHBOARD_BUSINESS_RELATIONSHIP_EVIDENCE_PATH);
  }
  const configPath = path.resolve(options.carmaEvidenceConfigPath || DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const configured = clean(config.businessRelationshipEvidencePath);
    return configured ? path.resolve(configured) : null;
  } catch {
    return null;
  }
}

function classifyBusinessRelationship(row, { callAt = null, evidence = null } = {}) {
  const customerId = exactCustomerId(row);
  const at = callWallClock(row, callAt);
  const customer = customerId && evidence?.available ? evidence.customers.get(customerId) : null;

  if (customer && at) {
    const firstInvoice = customer.detailedInvoiceBoundaries[0] || null;
    if (customer.detailedHistoryComplete && firstInvoice) {
      const callDate = at.slice(0, 10);
      if (callDate < firstInvoice.invoiceDate) {
        return relationshipResult("new", "before_first_exact_invoice", "exact", {
          customerId,
          callAt: at,
          boundaryAt: firstInvoice.issuedAt || firstInvoice.invoiceDate,
          invoiceNumber: firstInvoice.invoiceNumber,
          orderNumber: firstInvoice.orderNumber,
          source: firstInvoice.source,
          explanation: "The call occurred before the customer's earliest retained issued invoice."
        });
      }
      if (callDate > firstInvoice.invoiceDate || (firstInvoice.issuedAt && at > firstInvoice.issuedAt)) {
        return relationshipResult("warm", "after_first_exact_invoice", "exact", {
          customerId,
          callAt: at,
          boundaryAt: firstInvoice.issuedAt || firstInvoice.invoiceDate,
          invoiceNumber: firstInvoice.invoiceNumber,
          orderNumber: firstInvoice.orderNumber,
          source: firstInvoice.source,
          explanation: "The customer had already been issued an invoice before this call."
        });
      }
      if (firstInvoice.issuedAt && at <= firstInvoice.issuedAt) {
        return relationshipResult("new", "before_first_exact_invoice", "exact", {
          customerId,
          callAt: at,
          boundaryAt: firstInvoice.issuedAt,
          invoiceNumber: firstInvoice.invoiceNumber,
          orderNumber: firstInvoice.orderNumber,
          source: firstInvoice.source,
          explanation: "The call occurred earlier on the day the customer's first invoice/order was issued."
        });
      }
    }

    const priorOrderEvent = customer.observedOrderCreatedAt.filter((value) => value < at).at(-1);
    if (priorOrderEvent) {
      return relationshipResult("warm", "prior_order_created_event", "exact", {
        customerId,
        callAt: at,
        boundaryAt: priorOrderEvent,
        source: "carma_summary_history.Order Created",
        explanation: "A retained Carma Order Created event exists before this call."
      });
    }

    const callDate = at.slice(0, 10);
    const priorWarmAllocation = customer.warmAllocationDates.filter((value) => value < callDate).at(-1);
    if (priorWarmAllocation) {
      return relationshipResult("warm", "prior_explicit_warm_allocation", "supporting", {
        customerId,
        callAt: at,
        boundaryAt: priorWarmAllocation,
        source: "carma_customer_lead_allocation_history",
        explanation: "A retained allocation explicitly marked Warm/KWYC/Repeat predates the call."
      });
    }
  }

  return fallbackRelationship(row, customerId, at);
}

function attachBusinessRelationship(row, relationship) {
  if (row && typeof row === "object") relationshipsByRow.set(row, relationship);
  return relationship;
}

function businessRelationshipFor(row) {
  return relationshipsByRow.get(row) || fallbackRelationship(row, exactCustomerId(row), callWallClock(row));
}

module.exports = {
  BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  attachBusinessRelationship,
  businessRelationshipFor,
  callWallClock,
  classifyBusinessRelationship,
  exactCustomerId,
  loadBusinessRelationshipEvidence,
  resolveBusinessRelationshipEvidencePath,
  validateEvidenceDocument
};
