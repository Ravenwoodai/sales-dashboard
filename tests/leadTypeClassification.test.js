"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEAD_TYPE_RULE_VERSION,
  allocationLabelSignal,
  classifyLeadTypeForAllocationEvent,
  classifyLeadTypeFromAllocationName
} = require("../src/leadTypeClassification");

function evidence(customers = {}) {
  return {
    available: true,
    customers: new Map(Object.entries(customers))
  };
}

function event(overrides = {}) {
  return {
    customerId: "C-100",
    sentDate: "2026-07-22",
    sentTime: "10:00:00",
    allocationName: "Fresh Leads",
    ...overrides
  };
}

test("allocation-name wording is secondary and cannot classify a lead by itself", () => {
  assert.equal(allocationLabelSignal("Fresh Leads").label, "New Business");
  assert.equal(allocationLabelSignal("Newly Expired KWYC").label, "Warm");
  const result = classifyLeadTypeFromAllocationName("Fresh Leads");
  assert.equal(result.label, "Unclassified");
  assert.equal(result.ruleVersion, LEAD_TYPE_RULE_VERSION);
  assert.match(result.rule, /cannot determine lead type by itself/i);
});

test("complete exact history with no earlier order proves New Business", () => {
  const result = classifyLeadTypeForAllocationEvent(event(), {
    relationshipEvidence: evidence({
      "C-100": {
        detailedHistoryComplete: true,
        detailedInvoiceBoundaries: [],
        observedOrderCreatedAt: [],
        warmAllocationDates: []
      }
    }),
    approvedOrdersByCustomer: new Map()
  });
  assert.equal(result.label, "New Business");
  assert.equal(result.evidenceTier, "exact_complete_history");
});

test("an exact prior invoice proves Warm regardless of a conflicting Fresh label", () => {
  const result = classifyLeadTypeForAllocationEvent(event(), {
    relationshipEvidence: evidence({
      "C-100": {
        detailedHistoryComplete: true,
        detailedInvoiceBoundaries: [{
          invoiceNumber: "10001",
          orderNumber: "20001",
          invoiceDate: "2026-07-20",
          issuedAt: "2026-07-20T12:00:00",
          source: "carma_invoicing_summary"
        }],
        observedOrderCreatedAt: [],
        warmAllocationDates: []
      }
    }),
    approvedOrdersByCustomer: new Map()
  });
  assert.equal(result.label, "Warm");
  assert.equal(result.historyBoundaryAt, "2026-07-20T12:00:00");
  assert.equal(result.labelConflict, true);
});

test("a validated exact prior approved order proves Warm when retained history is incomplete", () => {
  const result = classifyLeadTypeForAllocationEvent(event({ allocationName: "Volunteer Mag" }), {
    relationshipEvidence: evidence(),
    approvedOrdersByCustomer: new Map([["C-100", ["2026-07-21T09:30:00.000Z"]]])
  });
  assert.equal(result.label, "Warm");
  assert.equal(result.historySource, "validated_carma_approved_sales");
});

test("missing complete history fails closed as Unclassified", () => {
  const result = classifyLeadTypeForAllocationEvent(event({ allocationName: "Old Police Sales" }), {
    relationshipEvidence: evidence(),
    approvedOrdersByCustomer: new Map()
  });
  assert.equal(result.label, "Unclassified");
  assert.equal(result.allocationLabelSignal, "Warm");
  assert.match(result.reviewReason, /not covered/i);
});

test("a same-day invoice without an issue time remains Unclassified", () => {
  const result = classifyLeadTypeForAllocationEvent(event(), {
    relationshipEvidence: evidence({
      "C-100": {
        detailedHistoryComplete: true,
        detailedInvoiceBoundaries: [{
          invoiceNumber: "10001",
          orderNumber: "20001",
          invoiceDate: "2026-07-22",
          issuedAt: "",
          source: "carma_invoicing_summary"
        }],
        observedOrderCreatedAt: [],
        warmAllocationDates: []
      }
    }),
    approvedOrdersByCustomer: new Map()
  });
  assert.equal(result.label, "Unclassified");
  assert.equal(result.evidenceTier, "exact_history_time_unresolved");
});
