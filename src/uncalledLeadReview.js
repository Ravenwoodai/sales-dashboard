"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv } = require("./csvParser");

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function norm(value) {
  return clean(value).toLowerCase();
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseLocal(dateValue, timeValue = "00:00:00") {
  const dateText = clean(dateValue).split(" ")[0];
  const timeText = clean(timeValue) || "00:00:00";
  let year;
  let month;
  let day;
  let match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  } else {
    match = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return Number.NaN;
    month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
  }
  const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = Number(timeMatch?.[1] || 0);
  const minute = Number(timeMatch?.[2] || 0);
  const second = Number(timeMatch?.[3] || 0);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function datePlus(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function reportDates(startDate) {
  return Array.from({ length: 5 }, (_, index) => datePlus(startDate, index));
}

function dayName(timestamp) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(timestamp).getUTCDay()];
}

function timeBand(timeText) {
  const hour = Number(clean(timeText).split(":")[0]);
  if (!Number.isFinite(hour)) return "Unknown time";
  if (hour < 10) return "Before 10 am";
  if (hour < 12) return "10 am to noon";
  if (hour < 15) return "Noon to 3 pm";
  return "After 3 pm";
}

function managerLabel(value) {
  return clean(value) || "Unassigned / Missing Manager";
}

function salespersonLabel(value) {
  return clean(value) || "Unassigned / Missing Salesperson";
}

function stableCallCustomer(row) {
  return clean(row.customer_id) || clean(row.FoundCustomerID);
}

function compiledRules(ruleModel) {
  return {
    operational: (ruleModel.operationalRules || []).map((rule) => ({ ...rule, regex: new RegExp(rule.pattern, "i") })),
    categories: (ruleModel.categoryRules || []).map((rule) => ({ ...rule, regex: new RegExp(rule.pattern, "i") })),
  };
}

function firstRegexMatch(regex, text) {
  const match = text.match(regex);
  return clean(match?.[0]);
}

function classifyLead(row, ruleModel) {
  const rules = compiledRules(ruleModel);
  const businessName = clean(row.businessName);
  const operational = rules.operational.find((rule) => rule.regex.test(businessName));
  if (operational) {
    return {
      category: operational.category,
      confidence: operational.confidence,
      classificationBasis: `${operational.id}: business name matched "${firstRegexMatch(operational.regex, businessName) || "blank/placeholder"}".`,
      alternativeCategorySignal: "",
      operationalGroup: operational.group,
      suitabilityScore: ruleModel.bands[operational.band],
      suitabilityBand: operational.band,
      recommendedHandling: operational.handling,
      bestAudience: operational.audience,
      suitabilityRationale: operational.rationale,
      ruleId: operational.id,
    };
  }

  const matches = rules.categories.filter((rule) => rule.regex.test(businessName));
  if (matches.length) {
    const primary = matches[0];
    return {
      category: primary.category,
      confidence: "High",
      classificationBasis: `${primary.id}: business name matched "${firstRegexMatch(primary.regex, businessName)}".`,
      alternativeCategorySignal: matches[1]?.category || "",
      operationalGroup: "Missed commercial opportunity",
      suitabilityScore: ruleModel.bands[primary.band],
      suitabilityBand: primary.band,
      recommendedHandling: primary.handling,
      bestAudience: primary.audience,
      suitabilityRationale: primary.rationale,
      ruleId: primary.id,
    };
  }

  const commercialMarker = /\b(?:pty\.?\s*ltd|limited|group|services?|solutions?|company|co\.?|enterprises?)\b/i.test(businessName);
  return {
    category: commercialMarker ? "Other commercial business" : "Other / uncertain",
    confidence: commercialMarker ? "Medium" : "Low",
    classificationBasis: commercialMarker
      ? "The business name contains a general commercial marker but no specific category keyword."
      : "The available business name does not contain a clear deterministic category signal.",
    alternativeCategorySignal: "",
    operationalGroup: "Uncertain / manual research",
    suitabilityScore: ruleModel.bands[commercialMarker ? "C - Conditional" : "D - Low/manual research"],
    suitabilityBand: commercialMarker ? "C - Conditional" : "D - Low/manual research",
    recommendedHandling: "Quick manual check before deciding whether to call or remove the record.",
    bestAudience: commercialMarker ? "General CWA community audience" : "Not assigned",
    suitabilityRationale: commercialMarker
      ? "The record appears commercial, but its business type is not clear from the allocation data."
      : "The available allocation data is not clear enough to assess commercial fit reliably.",
    ruleId: commercialMarker ? "OTHER_COMMERCIAL" : "UNCERTAIN",
  };
}

function countBy(rows, valueFn) {
  const counts = new Map();
  for (const row of rows) {
    const value = clean(valueFn(row)) || "Unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: rows.length ? count / rows.length : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function mostCommon(rows, valueFn) {
  return countBy(rows, valueFn)[0]?.label || "None";
}

function entitySignals(rows, field, minimumSample) {
  const grouped = new Map();
  for (const row of rows) {
    const key = clean(row[field]) || "Unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.entries()].map(([name, items]) => {
    const missed = items.filter((row) => row.operationalGroup === "Missed commercial opportunity").length;
    const shouldNot = items.filter((row) => row.operationalGroup === "Should not have been called").length;
    const blocked = items.filter((row) => row.operationalGroup === "Could not practically be called").length;
    const uncertain = items.filter((row) => row.operationalGroup === "Uncertain / manual research").length;
    return {
      name,
      manager: field === "salesperson" ? mostCommon(items, (row) => row.manager) : "",
      uncalled: items.length,
      missed,
      missedShare: items.length ? missed / items.length : 0,
      shouldNot,
      shouldNotShare: items.length ? shouldNot / items.length : 0,
      blocked,
      blockedShare: items.length ? blocked / items.length : 0,
      uncertain,
      uncertainShare: items.length ? uncertain / items.length : 0,
      topCategory: mostCommon(items, (row) => row.category),
      topSource: mostCommon(items, (row) => row.leadSource),
      topBatch: mostCommon(items, (row) => row.allocationName),
      friday: items.filter((row) => row.dayReceived === "Friday").length,
      lateFriday: items.filter((row) => row.limitedOpportunity).length,
      ownershipMismatch: items.filter((row) => row.ownershipMismatch).length,
      comparisonStatus: items.length >= minimumSample ? "Comparable" : "Small sample",
    };
  }).sort((a, b) => b.missed - a.missed || b.uncalled - a.uncalled || a.name.localeCompare(b.name));
}

function sourceSignals(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const name = clean(row[field]) || "Unknown";
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(row);
  }
  return [...grouped.entries()].map(([name, items]) => ({
    name,
    uncalled: items.length,
    missed: items.filter((row) => row.operationalGroup === "Missed commercial opportunity").length,
    shouldNot: items.filter((row) => row.operationalGroup === "Should not have been called").length,
    blocked: items.filter((row) => row.operationalGroup === "Could not practically be called").length,
    uncertain: items.filter((row) => row.operationalGroup === "Uncertain / manual research").length,
    topCategory: mostCommon(items, (row) => row.category),
  })).sort((a, b) => b.uncalled - a.uncalled || a.name.localeCompare(b.name));
}

function verifyManifestFile(filePath, expectedHash, label) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath || "not configured"}`);
  const actual = sha256File(filePath);
  if (clean(expectedHash) && actual !== clean(expectedHash)) throw new Error(`${label} hash does not match its retained manifest.`);
  return actual;
}

function buildUncalledLeadReview(options) {
  const { root, manifestPath, configPath, rulesPath, startDate } = options;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const ruleModel = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const endDate = datePlus(startDate, 4);
  if (manifest.selectedPeriod?.startDate !== startDate) throw new Error("Weekly-performance manifest start date does not match the requested Monday.");
  if (datePlus(startDate, 6) !== manifest.selectedPeriod?.endDate) throw new Error("Weekly-performance manifest does not cover the requested Monday-to-Sunday source envelope.");

  const reportDayList = reportDates(startDate);
  const missingWeeklyCallDates = reportDayList.filter((date) => !(manifest.calls?.observedDates || []).includes(date));
  const usePrimaryCalls = missingWeeklyCallDates.length > 0;
  if (usePrimaryCalls) {
    const missingFromPrimary = missingWeeklyCallDates.filter((date) => !(manifest.primaryCallHistory?.observedDates || []).includes(date));
    if (missingFromPrimary.length) throw new Error(`Call evidence is incomplete for: ${missingFromPrimary.join(", ")}`);
  }

  const allocationHash = verifyManifestFile(manifest.allocation?.rawPath, manifest.allocation?.sha256, "Allocation source");
  const callHash = verifyManifestFile(manifest.calls?.rawPath, manifest.calls?.sha256, "Weekly call source");
  const primaryCallHash = usePrimaryCalls
    ? verifyManifestFile(manifest.primaryCallHistory?.sourcePath, manifest.primaryCallHistory?.sha256, "Primary call history")
    : "";

  const allocationRows = parseCsv(fs.readFileSync(manifest.allocation.rawPath, "utf8")).rows;
  const rawCalls = [
    ...(usePrimaryCalls ? parseCsv(fs.readFileSync(manifest.primaryCallHistory.sourcePath, "utf8")).rows : []),
    ...parseCsv(fs.readFileSync(manifest.calls.rawPath, "utf8")).rows,
  ];
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const cutoff = Date.parse(`${endDate}T23:59:59Z`);
  const managerExclusions = new Set((config.report?.managerTeamExclusions || []).map(norm));
  const salespersonExclusions = new Set((config.report?.salespersonExclusions || []).map(norm));

  const seenAllocationKeys = new Set();
  let duplicateAllocationRows = 0;
  let allocationsOutsidePeriod = 0;
  let excludedAllocations = 0;
  const allocations = [];
  for (const sourceRow of allocationRows) {
    const timestamp = parseLocal(sourceRow.DateSentToSalesperson_Date, sourceRow.DateSentToSalesperson_Time);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > cutoff) {
      allocationsOutsidePeriod += 1;
      continue;
    }
    const allocationKey = clean(sourceRow.AllocationItemID);
    if (!allocationKey || seenAllocationKeys.has(allocationKey)) {
      duplicateAllocationRows += 1;
      continue;
    }
    seenAllocationKeys.add(allocationKey);
    const manager = managerLabel(sourceRow.SalesManager);
    const salesperson = salespersonLabel(sourceRow.FullName);
    if (managerExclusions.has(norm(manager)) || salespersonExclusions.has(norm(salesperson))) {
      excludedAllocations += 1;
      continue;
    }
    const owningSalesperson = clean(sourceRow.OwningSalesperson);
    const owningManager = clean(sourceRow.OwningSalesManager);
    allocations.push({
      allocationKey,
      customerId: clean(sourceRow.CustomerID),
      businessName: clean(sourceRow.CompanyName),
      leadSource: clean(sourceRow.DataSource) || clean(sourceRow.CustomerImportSource) || "Unknown",
      allocationName: clean(sourceRow.AllocationName) || "Unknown",
      manager,
      salesperson,
      owningSalesperson,
      owningManager,
      ownershipMismatch: Boolean(owningSalesperson && norm(owningSalesperson) !== norm(salesperson)),
      timestamp,
      allocationDate: new Date(timestamp).toISOString().slice(0, 10),
      allocationTime: clean(sourceRow.DateSentToSalesperson_Time),
      dayReceived: dayName(timestamp),
      timeBand: timeBand(sourceRow.DateSentToSalesperson_Time),
      limitedOpportunity: dayName(timestamp) === "Friday" && Number(clean(sourceRow.DateSentToSalesperson_Time).split(":")[0]) >= 15,
    });
  }

  const includedSalespeople = new Set(allocations.map((row) => norm(row.salesperson)));
  const seenCallIds = new Set();
  let duplicateCallRows = 0;
  let inboundCallsExcluded = 0;
  let callsOutsidePeriod = 0;
  const callsByPair = new Map();
  for (const call of rawCalls) {
    const timestamp = parseLocal(call.call_date, call.call_time);
    if (norm(call.call_direction) !== "out") {
      inboundCallsExcluded += 1;
      continue;
    }
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > cutoff) {
      callsOutsidePeriod += 1;
      continue;
    }
    const callId = clean(call.call_id);
    if (!callId || seenCallIds.has(callId)) {
      duplicateCallRows += 1;
      continue;
    }
    seenCallIds.add(callId);
    const salespersonKey = norm(salespersonLabel(call.Salesperson));
    if (!includedSalespeople.has(salespersonKey)) continue;
    const customerId = stableCallCustomer(call);
    if (!customerId) continue;
    const pairKey = `${customerId}\u0000${salespersonKey}`;
    if (!callsByPair.has(pairKey)) callsByPair.set(pairKey, []);
    callsByPair.get(pairKey).push(timestamp);
  }
  for (const values of callsByPair.values()) values.sort((a, b) => a - b);

  const uncalledRows = [];
  let called = 0;
  for (const allocation of allocations) {
    const calls = callsByPair.get(`${allocation.customerId}\u0000${norm(allocation.salesperson)}`) || [];
    if (calls.some((timestamp) => timestamp >= allocation.timestamp && timestamp <= cutoff)) {
      called += 1;
      continue;
    }
    const classification = classifyLead(allocation, ruleModel);
    const qualityFlags = [
      !allocation.customerId ? "Missing Customer ID" : "",
      allocation.ownershipMismatch ? "Owning salesperson differs from receiving salesperson" : "",
      allocation.limitedOpportunity ? "Allocated Friday after 3 pm" : "",
      allocation.leadSource === "Unknown" ? "Unknown lead source" : "",
    ].filter(Boolean);
    uncalledRows.push({
      ...allocation,
      ...classification,
      qualityFlags: qualityFlags.join("; ") || "None",
      evidenceNote: "No qualifying outbound call by the receiving salesperson after allocation and by the end of Friday.",
    });
  }

  const confidenceOrder = { High: 3, Medium: 2, Low: 1 };
  const ranked = [...uncalledRows].sort((a, b) =>
    b.suitabilityScore - a.suitabilityScore
    || (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0)
    || a.businessName.localeCompare(b.businessName)
    || a.allocationKey.localeCompare(b.allocationKey)
  );
  ranked.forEach((row, index) => { row.suitabilityRank = index + 1; });
  uncalledRows.sort((a, b) => a.manager.localeCompare(b.manager) || a.salesperson.localeCompare(b.salesperson) || a.timestamp - b.timestamp || a.allocationKey.localeCompare(b.allocationKey));

  const operationalGroups = countBy(uncalledRows, (row) => row.operationalGroup);
  const suitability = countBy(uncalledRows, (row) => row.suitabilityBand);
  const categories = countBy(uncalledRows, (row) => row.category);
  const totals = {
    received: allocations.length,
    called,
    uncalled: uncalledRows.length,
    missed: uncalledRows.filter((row) => row.operationalGroup === "Missed commercial opportunity").length,
    shouldNot: uncalledRows.filter((row) => row.operationalGroup === "Should not have been called").length,
    blocked: uncalledRows.filter((row) => row.operationalGroup === "Could not practically be called").length,
    uncertain: uncalledRows.filter((row) => row.operationalGroup === "Uncertain / manual research").length,
    lateFriday: uncalledRows.filter((row) => row.limitedOpportunity).length,
    ownershipMismatch: uncalledRows.filter((row) => row.ownershipMismatch).length,
  };
  totals.explainableNonCalls = totals.shouldNot + totals.blocked;

  const people = entitySignals(uncalledRows, "salesperson", ruleModel.minimumComparisonSample || 30);
  const teams = entitySignals(uncalledRows, "manager", ruleModel.minimumComparisonSample || 30);
  const sourceRows = sourceSignals(uncalledRows, "leadSource");
  const batchRows = sourceSignals(uncalledRows, "allocationName");
  const dayRows = countBy(uncalledRows, (row) => row.dayReceived);
  const timeRows = countBy(uncalledRows, (row) => row.timeBand);

  const qaChecks = [
    ["Received reconciles to called plus uncalled", totals.received === totals.called + totals.uncalled],
    ["Every uncalled allocation key is unique", new Set(uncalledRows.map((row) => row.allocationKey)).size === totals.uncalled],
    ["Operational groups reconcile to uncalled total", operationalGroups.reduce((sum, row) => sum + row.count, 0) === totals.uncalled],
    ["Suitability bands reconcile to uncalled total", suitability.reduce((sum, row) => sum + row.count, 0) === totals.uncalled],
    ["Categories reconcile to uncalled total", categories.reduce((sum, row) => sum + row.count, 0) === totals.uncalled],
    ["Salesperson totals reconcile", people.reduce((sum, row) => sum + row.uncalled, 0) === totals.uncalled],
    ["Manager totals reconcile", teams.reduce((sum, row) => sum + row.uncalled, 0) === totals.uncalled],
    ["Named exclusions are absent", !uncalledRows.some((row) => managerExclusions.has(norm(row.manager)) || salespersonExclusions.has(norm(row.salesperson)))],
    ["Every uncalled row has a category", uncalledRows.every((row) => clean(row.category))],
    ["Every uncalled row has an operational group", uncalledRows.every((row) => clean(row.operationalGroup))],
    ["Every uncalled row has a confidence label", uncalledRows.every((row) => ["High", "Medium", "Low"].includes(row.confidence))],
    ["Source files match retained hashes", Boolean(allocationHash && callHash && (!usePrimaryCalls || primaryCallHash))],
  ].map(([check, passed]) => ({ check, result: passed ? "PASS" : "FAIL" }));
  if (qaChecks.some((row) => row.result !== "PASS")) throw new Error(`Uncalled Lead Review QA failed: ${qaChecks.filter((row) => row.result !== "PASS").map((row) => row.check).join("; ")}`);

  const examples = {};
  for (const group of ["Missed commercial opportunity", "Should not have been called", "Could not practically be called", "Uncertain / manual research"]) {
    examples[group] = uncalledRows.filter((row) => row.operationalGroup === group).slice(0, 8);
  }

  const payload = {
    schemaVersion: "uncalled_lead_review.v1",
    title: "UNCALLED LEAD REVIEW",
    reportingPeriod: { startDate, endDate, cutoffLocal: `${endDate} 23:59:59`, timezone: "Australia/Melbourne" },
    ruleModel: { schemaVersion: ruleModel.schemaVersion, sha256: sha256File(rulesPath), minimumComparisonSample: ruleModel.minimumComparisonSample },
    exclusions: {
      managerTeams: config.report?.managerTeamExclusions || [],
      salespeople: config.report?.salespersonExclusions || [],
      display: config.report?.exclusionDisplay || "",
      policySha256: config.report?.exclusionPolicySha256 || "",
    },
    totals,
    operationalGroups,
    suitability,
    categories,
    people,
    teams,
    sources: sourceRows,
    batches: batchRows,
    days: dayRows,
    times: timeRows,
    examples,
    uncalledRows,
    qaChecks,
    sourceReceipt: {
      manifestPath,
      allocation: { path: manifest.allocation.rawPath, sha256: allocationHash, rowCount: manifest.allocation.rowCount },
      calls: { path: manifest.calls.rawPath, sha256: callHash, rowCount: manifest.calls.rowCount, observedDates: manifest.calls.observedDates },
      primaryCalls: usePrimaryCalls ? { path: manifest.primaryCallHistory.sourcePath, sha256: primaryCallHash, rowCount: manifest.primaryCallHistory.rowCount, missingWeeklyCallDates } : null,
      allocationRows: allocationRows.length,
      duplicateAllocationRows,
      allocationsOutsidePeriod,
      excludedAllocations,
      rawCallRows: rawCalls.length,
      uniqueInPeriodOutboundCallIds: seenCallIds.size,
      duplicateCallRows,
      inboundCallsExcluded,
      callsOutsidePeriod,
    },
  };
  payload.inputFingerprint = sha256Json({
    schemaVersion: payload.schemaVersion,
    ruleModel: payload.ruleModel,
    exclusions: payload.exclusions,
    allocationHash,
    callHash,
    primaryCallHash,
    startDate,
    endDate,
  });
  return payload;
}

module.exports = {
  buildUncalledLeadReview,
  classifyLead,
  clean,
  countBy,
  datePlus,
  norm,
  parseLocal,
  sha256File,
  sha256Json,
  timeBand,
};
