"use strict";

const LEAD_SOURCE_POLICY_VERSION = "actual_seller_any_pre_sale_allocation.v1";

const LEAD_SOURCE_CLASSIFICATIONS = Object.freeze({
  COMPANY_SOURCED: "Company Sourced",
  SELF_SOURCED: "Self Sourced"
});

function clean(value) {
  return String(value ?? "").trim();
}

function explicitTrue(value) {
  if (value === true || value === 1) return true;
  return ["1", "true", "yes", "y"].includes(clean(value).toLowerCase());
}

function validTime(value) {
  const text = clean(value);
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}

function hasExactSellerPreSaleAllocation({
  sellerAllocatedBeforeSale = false,
  sellerAllocationDate = "",
  saleApprovalDate = ""
} = {}) {
  if (explicitTrue(sellerAllocatedBeforeSale)) return true;
  const allocationTime = validTime(sellerAllocationDate);
  const saleTime = validTime(saleApprovalDate);
  return allocationTime !== null && saleTime !== null && allocationTime <= saleTime;
}

function classifyLeadSource(evidence = {}) {
  const companySourced = hasExactSellerPreSaleAllocation(evidence);
  return {
    policyVersion: LEAD_SOURCE_POLICY_VERSION,
    classification: companySourced
      ? LEAD_SOURCE_CLASSIFICATIONS.COMPANY_SOURCED
      : LEAD_SOURCE_CLASSIFICATIONS.SELF_SOURCED,
    companySourced,
    selfSourced: !companySourced,
    reason: companySourced
      ? "Company Sourced — the actual seller had an exact recorded allocation before the sale."
      : "Self Sourced — no exact recorded pre-sale allocation to the actual seller was found."
  };
}

module.exports = {
  LEAD_SOURCE_CLASSIFICATIONS,
  LEAD_SOURCE_POLICY_VERSION,
  classifyLeadSource,
  hasExactSellerPreSaleAllocation
};
