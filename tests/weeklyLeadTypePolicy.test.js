"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NEW_BUSINESS,
  WARM,
  buildAllocationIndexes,
  classifyApprovedSale,
  classifyCall,
} = require("../src/weeklyLeadTypePolicy");

const campaignTypes = new Map([["fresh", NEW_BUSINESS], ["repeats", WARM]]);
const allocation = (overrides = {}) => ({
  CustomerID: "100",
  FullName: "Alex Sales",
  SalesManager: "Manager",
  DateSentToSalesperson_Date: "08/03/2026",
  DateSentToSalesperson_Time: "09:00:00",
  AllocationItemID: "A1",
  AllocationName: "Fresh",
  ...overrides,
});
const call = (overrides = {}) => ({
  call_id: "C1",
  customer_id: "100",
  Salesperson: "Alex Sales",
  call_date: "08/03/2026",
  call_time: "10:00:00",
  ...overrides,
});

test("call rules use exact prior allocation type", () => {
  const indexes = buildAllocationIndexes([allocation()], campaignTypes);
  assert.equal(classifyCall(call(), indexes).leadType, NEW_BUSINESS);
});

test("no customer ID and absent customer both become New Business", () => {
  const indexes = buildAllocationIndexes([allocation()], campaignTypes);
  assert.equal(classifyCall(call({ customer_id: "", FoundCustomerID: "" }), indexes).rule, "no_customer_id");
  assert.equal(classifyCall(call({ customer_id: "999" }), indexes).rule, "customer_absent_from_available_allocation_logs");
});

test("nearest Admin allocation overrides campaign type to Warm", () => {
  const indexes = buildAllocationIndexes([allocation({ FullName: "Admin User", AllocationName: "Fresh" })], campaignTypes);
  const result = classifyCall(call({ Salesperson: "Other Person" }), indexes);
  assert.equal(result.leadType, WARM);
  assert.equal(result.rule, "nearest_allocation_person_admin");
});

test("nearest allocation type is used when no exact prior allocation exists", () => {
  const indexes = buildAllocationIndexes([allocation({ FullName: "Other Person", AllocationName: "Repeats" })], campaignTypes);
  assert.equal(classifyCall(call(), indexes).leadType, WARM);
});

test("Self Sourced approved sales are New Business", () => {
  assert.deepEqual(classifyApprovedSale("Self Sourced", ""), { leadType: NEW_BUSINESS, rule: "self_sourced_is_new_business" });
  assert.equal(classifyApprovedSale("Sale From Allocated Lead", WARM).leadType, WARM);
});
