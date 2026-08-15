"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEAD_SOURCE_POLICY_VERSION,
  classifyLeadSource
} = require("../src/leadSourcePolicy");

test("the default policy classifies any exact pre-sale allocation to the actual seller as Company Sourced", () => {
  const result = classifyLeadSource({
    sellerAllocatedBeforeSale: true,
    sellerAllocationDate: "2026-07-10T00:00:00.000Z",
    saleApprovalDate: "2026-07-20T08:25:00.000Z",
    sourceProven: false,
    sellerAllocatedWithin28Days: true
  });
  assert.equal(result.policyVersion, LEAD_SOURCE_POLICY_VERSION);
  assert.equal(result.classification, "Company Sourced");
  assert.equal(result.companySourced, true);
});

test("allocation age and acquisition-source proof do not change Company Sourced classification", () => {
  const result = classifyLeadSource({
    sellerAllocatedBeforeSale: true,
    sellerAllocationDate: "2025-06-01T00:00:00.000Z",
    saleApprovalDate: "2026-07-20T00:00:00.000Z",
    sourceProven: false,
    sellerAllocatedWithin28Days: false
  });
  assert.equal(result.classification, "Company Sourced");
});

test("Self Sourced requires no exact recorded pre-sale allocation to the actual seller", () => {
  const result = classifyLeadSource({
    sellerAllocatedBeforeSale: false,
    sellerAllocationDate: "",
    saleApprovalDate: "2026-07-20T00:00:00.000Z"
  });
  assert.equal(result.classification, "Self Sourced");
  assert.equal(result.selfSourced, true);
});

test("a post-sale allocation does not make a sale Company Sourced", () => {
  const result = classifyLeadSource({
    sellerAllocatedBeforeSale: false,
    sellerAllocationDate: "2026-07-21T00:00:00.000Z",
    saleApprovalDate: "2026-07-20T00:00:00.000Z"
  });
  assert.equal(result.classification, "Self Sourced");
});

test("order 11884640 is Company Sourced under the locked default", () => {
  const result = classifyLeadSource({
    sellerAllocationDate: "2026-07-10T00:00:00.000Z",
    saleApprovalDate: "2026-07-20T08:25:00.000Z"
  });
  assert.equal(result.classification, "Company Sourced");
});
