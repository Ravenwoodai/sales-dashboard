"use strict";

const fs = require("node:fs");
const path = require("node:path");

const POLICY_SCHEMA = "weekly_lead_type_policy.v1";
const NEW_BUSINESS = "New Business";
const WARM = "Warm";

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function norm(value) {
  return clean(value).toLowerCase();
}

function parseLocalTimestamp(dateValue, timeValue = "00:00:00", dateOrder = "month_first") {
  const dateText = clean(dateValue).split(/\s+/)[0];
  let match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year;
  let month;
  let day;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return Number.NaN;
    year = Number(match[3]);
    if (dateOrder === "day_first") {
      day = Number(match[1]);
      month = Number(match[2]);
    } else {
      month = Number(match[1]);
      day = Number(match[2]);
    }
  }
  const clock = clean(timeValue).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = Number(clock?.[1] || 0);
  const minute = Number(clock?.[2] || 0);
  const second = Number(clock?.[3] || 0);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return Number.NaN;
  return timestamp;
}

function loadPolicy(policyPath) {
  const resolved = path.resolve(policyPath);
  const policy = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (policy.schemaVersion !== POLICY_SCHEMA) throw new Error(`Unsupported weekly lead-type policy schema: ${policy.schemaVersion}`);
  const campaignTypes = new Map();
  for (const row of policy.campaignRules || []) {
    const key = norm(row.exactCampaignName);
    if (!key || ![NEW_BUSINESS, WARM].includes(row.leadType)) throw new Error("Weekly lead-type policy has an invalid campaign rule.");
    if (campaignTypes.has(key) && campaignTypes.get(key) !== row.leadType) throw new Error(`Conflicting campaign rule: ${row.exactCampaignName}`);
    campaignTypes.set(key, row.leadType);
  }
  if (!campaignTypes.size) throw new Error("Weekly lead-type policy has no campaign rules.");
  return { policy, campaignTypes, policyPath: resolved };
}

function classifyCampaign(campaignName, campaignTypes) {
  const name = clean(campaignName);
  const leadType = campaignTypes.get(norm(name));
  if (!leadType) throw new Error(`Unmapped campaign name: ${name || "(blank)"}`);
  return leadType;
}

function buildAllocationIndexes(allocationRows, campaignTypes) {
  const exact = new Map();
  const customer = new Map();
  for (const row of allocationRows) {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName || row.OwningSalesperson);
    const personKey = norm(salesperson);
    const timestamp = parseLocalTimestamp(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time, "month_first");
    if (!customerId || !personKey || !Number.isFinite(timestamp)) continue;
    const item = {
      customerId,
      salesperson,
      personKey,
      manager: clean(row.SalesManager || row.OwningSalesManager),
      timestamp,
      allocationItemId: clean(row.AllocationItemID),
      allocationName: clean(row.AllocationName),
      leadType: classifyCampaign(row.AllocationName, campaignTypes),
    };
    const exactKey = `${customerId}\u0000${personKey}`;
    if (!exact.has(exactKey)) exact.set(exactKey, []);
    exact.get(exactKey).push(item);
    if (!customer.has(customerId)) customer.set(customerId, []);
    customer.get(customerId).push(item);
  }
  const sort = (left, right) => left.timestamp - right.timestamp || left.allocationItemId.localeCompare(right.allocationItemId);
  for (const rows of exact.values()) rows.sort(sort);
  for (const rows of customer.values()) rows.sort(sort);
  return { exact, customer };
}

function isAdminPerson(value) {
  return /^admin(?: user)?$/i.test(clean(value));
}

function oneTypeAtTimestamp(rows, timestamp, context) {
  const candidates = rows.filter((row) => row.timestamp === timestamp);
  const types = [...new Set(candidates.map((row) => row.leadType))];
  if (types.length !== 1) throw new Error(`Conflicting lead types at the selected allocation time for ${context}.`);
  return candidates[0];
}

function classifyCall(row, indexes, options = {}) {
  const dateOrder = options.dateOrder || "month_first";
  const customerId = clean(row.customer_id) || clean(row.FoundCustomerID);
  const salesperson = clean(row.Salesperson);
  const personKey = norm(salesperson);
  const timestamp = parseLocalTimestamp(row.call_date, row.call_time, dateOrder);
  if (!customerId) return { leadType: NEW_BUSINESS, rule: "no_customer_id", allocation: null };
  if (!personKey || !Number.isFinite(timestamp)) throw new Error(`Call ${clean(row.call_id) || "(missing ID)"} has an invalid salesperson or timestamp.`);

  const exactRows = indexes.exact.get(`${customerId}\u0000${personKey}`) || [];
  const priorExact = exactRows.filter((item) => item.timestamp <= timestamp);
  if (priorExact.length) {
    const selected = oneTypeAtTimestamp(exactRows, priorExact.at(-1).timestamp, `call ${clean(row.call_id)}`);
    return { leadType: selected.leadType, rule: "latest_exact_person_allocation_at_or_before_call", allocation: selected };
  }

  const customerRows = indexes.customer.get(customerId) || [];
  if (!customerRows.length) return { leadType: NEW_BUSINESS, rule: "customer_absent_from_available_allocation_logs", allocation: null };

  const priorCustomer = customerRows.filter((item) => item.timestamp <= timestamp);
  const selected = exactRows[0]
    || (priorCustomer.length ? oneTypeAtTimestamp(customerRows, priorCustomer.at(-1).timestamp, `call ${clean(row.call_id)}`) : null)
    || customerRows[0];
  if (!selected) throw new Error(`No nearest allocation could be selected for call ${clean(row.call_id)}.`);
  if (isAdminPerson(selected.salesperson)) return { leadType: WARM, rule: "nearest_allocation_person_admin", allocation: selected };
  return { leadType: selected.leadType, rule: "nearest_allocation_type", allocation: selected };
}

function classifyApprovedSale(sourceAttribution, allocationLeadType) {
  const source = clean(sourceAttribution);
  if (source === "Self Sourced") return { leadType: NEW_BUSINESS, rule: "self_sourced_is_new_business" };
  if (["Sale From Allocated Lead", "Allocated-Lead Sale"].includes(source)) {
    if (![NEW_BUSINESS, WARM].includes(allocationLeadType)) throw new Error("Allocated approved sale has no mapped allocation lead type.");
    return { leadType: allocationLeadType, rule: "latest_exact_seller_pre_approval_allocation_type" };
  }
  throw new Error(`Approved sale source attribution cannot be split: ${source || "(blank)"}`);
}

module.exports = {
  NEW_BUSINESS,
  POLICY_SCHEMA,
  WARM,
  buildAllocationIndexes,
  classifyApprovedSale,
  classifyCall,
  classifyCampaign,
  clean,
  loadPolicy,
  norm,
  parseLocalTimestamp,
};
