"use strict";

const LEAD_TYPE_RULE_VERSION = "exact_customer_history_at_allocation.v1";
const ALLOCATION_LABEL_SIGNAL_VERSION = "allocation_label_explicit_tokens.v1";

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalWallClock(value) {
  const text = clean(value);
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return "";
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  if (hour > 23 || minute > 59 || second > 59) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4].padStart(2, "0")}:${match[5]}:${String(second).padStart(2, "0")}`;
}

function allocationWallClock(event = {}) {
  return canonicalWallClock(`${clean(event.sentDate)}T${clean(event.sentTime) || "00:00:00"}`);
}

function allocationLabelSignal(allocationName) {
  const normalized = normalize(allocationName);
  const warm = /\b(kwyc|expired|expireds|repeat|repeats|pending payment|sold last 6 months|final crack|old police sales)\b/.test(normalized);
  if (warm) {
    return {
      key: "warm",
      label: "Warm",
      reason: "AllocationName contains explicit Warm/returning-lead wording",
      ruleVersion: ALLOCATION_LABEL_SIGNAL_VERSION
    };
  }

  const isNew = /\b(fresh|nb)\b/.test(normalized) || /^hipages leads for \d/.test(normalized);
  if (isNew) {
    return {
      key: "new",
      label: "New Business",
      reason: "AllocationName contains explicit Fresh/NB/new-lead wording",
      ruleVersion: ALLOCATION_LABEL_SIGNAL_VERSION
    };
  }

  return {
    key: "none",
    label: "No clear label signal",
    reason: "AllocationName does not contain an explicit New Business or Warm token",
    ruleVersion: ALLOCATION_LABEL_SIGNAL_VERSION
  };
}

function classifyLeadTypeFromAllocationName(allocationName) {
  const signal = allocationLabelSignal(allocationName);
  return {
    key: "unknown",
    label: "Unclassified",
    rule: `${signal.reason}; campaign/allocation wording is secondary evidence and cannot determine lead type by itself`,
    ruleVersion: LEAD_TYPE_RULE_VERSION,
    allocationLabelSignal: signal.label,
    allocationLabelRule: signal.reason,
    labelConflict: false
  };
}

function classificationResult(key, rule, details = {}) {
  const label = key === "new" ? "New Business" : key === "warm" ? "Warm" : "Unclassified";
  const labelSignal = details.labelSignal || allocationLabelSignal(details.allocationName);
  const labelConflict = Boolean(
    key !== "unknown"
    && labelSignal.key !== "none"
    && labelSignal.key !== key
  );
  return {
    key,
    label,
    rule,
    ruleVersion: LEAD_TYPE_RULE_VERSION,
    evidenceTier: details.evidenceTier || (key === "unknown" ? "unclassified" : "exact"),
    historySource: details.historySource || "",
    historyBoundaryAt: details.historyBoundaryAt || "",
    allocationLabelSignal: labelSignal.label,
    allocationLabelRule: labelSignal.reason,
    retainedHistoricalLabelSignal: details.retainedHistoricalLabelSignal || "",
    labelConflict,
    reviewReason: details.reviewReason || ""
  };
}

function approvedOrderTimesFor(customerId, approvedOrdersByCustomer) {
  if (!approvedOrdersByCustomer || typeof approvedOrdersByCustomer.get !== "function") return [];
  return (approvedOrdersByCustomer.get(customerId) || [])
    .map(canonicalWallClock)
    .filter(Boolean)
    .sort();
}

function classifyLeadTypeForAllocationEvent(event = {}, options = {}) {
  const customerId = clean(event.customerId);
  const eventAt = allocationWallClock(event);
  const labelSignal = allocationLabelSignal(event.allocationName);
  if (!customerId || !eventAt) {
    return classificationResult("unknown", "Exact CustomerID or allocation timestamp is missing/invalid", {
      allocationName: event.allocationName,
      labelSignal,
      reviewReason: !customerId
        ? "CustomerID is missing, so exact customer-history matching is impossible."
        : "The sent date/time is invalid, so history cannot be assessed at the allocation moment."
    });
  }

  const relationshipEvidence = options.relationshipEvidence;
  const customer = relationshipEvidence?.available === true
    ? relationshipEvidence.customers.get(customerId)
    : null;
  const priorApprovedAt = approvedOrderTimesFor(customerId, options.approvedOrdersByCustomer)
    .filter((value) => value < eventAt)
    .at(-1);
  const priorOrderCreatedAt = (customer?.observedOrderCreatedAt || [])
    .map(canonicalWallClock)
    .filter((value) => value && value < eventAt)
    .sort()
    .at(-1);
  const priorInvoice = (customer?.detailedInvoiceBoundaries || [])
    .filter((boundary) => {
      const issuedAt = canonicalWallClock(boundary.issuedAt);
      if (issuedAt) return issuedAt < eventAt;
      return clean(boundary.invoiceDate) < event.sentDate;
    })
    .at(-1);
  const retainedHistoricalLabelSignal = (customer?.warmAllocationDates || [])
    .filter((value) => clean(value) < event.sentDate)
    .sort()
    .at(-1) || "";

  const positiveHistory = [
    priorInvoice ? {
      at: canonicalWallClock(priorInvoice.issuedAt) || priorInvoice.invoiceDate,
      source: priorInvoice.source || "carma_invoicing_summary",
      rule: "Exact customer history shows an invoice/order before this allocation"
    } : null,
    priorOrderCreatedAt ? {
      at: priorOrderCreatedAt,
      source: "carma_summary_history.Order Created",
      rule: "Exact customer history shows an Order Created event before this allocation"
    } : null,
    priorApprovedAt ? {
      at: priorApprovedAt,
      source: "validated_carma_approved_sales",
      rule: "Validated Carma evidence shows an approved order before this allocation"
    } : null
  ].filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));

  if (positiveHistory[0]) {
    return classificationResult("warm", positiveHistory[0].rule, {
      allocationName: event.allocationName,
      labelSignal,
      evidenceTier: "exact_positive_history",
      historySource: positiveHistory[0].source,
      historyBoundaryAt: positiveHistory[0].at,
      retainedHistoricalLabelSignal
    });
  }

  if (customer?.detailedHistoryComplete === true) {
    const sameDayInvoiceWithoutTime = (customer.detailedInvoiceBoundaries || []).find((boundary) => (
      !canonicalWallClock(boundary.issuedAt)
      && clean(boundary.invoiceDate) === event.sentDate
    ));
    if (sameDayInvoiceWithoutTime) {
      return classificationResult("unknown", "The exact customer has complete retained history, but a same-day first invoice lacks the time needed to order the events", {
        allocationName: event.allocationName,
        labelSignal,
        evidenceTier: "exact_history_time_unresolved",
        historySource: sameDayInvoiceWithoutTime.source || "carma_invoicing_summary",
        historyBoundaryAt: sameDayInvoiceWithoutTime.invoiceDate,
        retainedHistoricalLabelSignal,
        reviewReason: "A same-day invoice date exists without an exact issue time, so New versus Warm cannot be determined safely."
      });
    }
    const firstInvoice = (customer.detailedInvoiceBoundaries || [])[0];
    return classificationResult("new", "Complete retained history for the exact CustomerID shows no order/invoice before this allocation", {
      allocationName: event.allocationName,
      labelSignal,
      evidenceTier: "exact_complete_history",
      historySource: "carma_invoicing_summary",
      historyBoundaryAt: firstInvoice
        ? canonicalWallClock(firstInvoice.issuedAt) || firstInvoice.invoiceDate
        : "No retained invoice/order",
      retainedHistoricalLabelSignal
    });
  }

  return classificationResult("unknown", "No complete exact customer history or exact prior order was available at the allocation time", {
    allocationName: event.allocationName,
    labelSignal,
    retainedHistoricalLabelSignal,
    reviewReason: customer
      ? "Some exact customer evidence exists, but it is not complete enough to prove there was no earlier order."
      : "This CustomerID is not covered by the retained customer-history index."
  });
}

module.exports = {
  ALLOCATION_LABEL_SIGNAL_VERSION,
  LEAD_TYPE_RULE_VERSION,
  allocationLabelSignal,
  allocationWallClock,
  classifyLeadTypeForAllocationEvent,
  classifyLeadTypeFromAllocationName
};
