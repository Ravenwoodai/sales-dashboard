"use strict";

const { buildSourceAttributionCoverage } = require("./sourceAttributionCoverage");

const MINIMUM_MANAGER_SAMPLE = 100;
const MINIMUM_PERFORMANCE_SAMPLE = 100;
const MATERIAL_RELATIVE_DIFFERENCE = 0.10;
const MATERIAL_SHARE_GAP = 0.02;
const EQUAL_SHARE_BAND = 0.25;
const WEAK_RETURN_RATIO = 0.70;
const CONCENTRATION_THRESHOLD = 0.50;
const SELF_SOURCE_DEPENDENCE_THRESHOLD = 0.50;
const MATERIAL_REALLOCATION_RATE = 0.05;
const MINIMUM_APPROVED_SALES_SHARE_SAMPLE = 5;
const MINIMUM_TROPHY_SALES = 12;
const MINIMUM_UNCALLED_REVIEW_PAIRS = 25;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function oneDecimal(value) {
  return number(value).toLocaleString("en-AU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function percentagePoints(value) {
  return `${oneDecimal(Math.abs(number(value)) * 100)} percentage points`;
}

function normalizePerson(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeDivide(numerator, denominator) {
  return number(denominator) ? number(numerator) / number(denominator) : 0;
}

function dateMs(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

function periodsAreComparable(currentPeriod = {}, previousPeriod = {}) {
  currentPeriod = currentPeriod || {};
  previousPeriod = previousPeriod || {};
  const currentStart = dateMs(currentPeriod.startDate);
  const currentEnd = dateMs(currentPeriod.endDate);
  const priorStart = dateMs(previousPeriod.startDate);
  const priorEnd = dateMs(previousPeriod.endDate);
  if ([currentStart, currentEnd, priorStart, priorEnd].some((value) => value === null)) return false;
  return currentEnd - currentStart === priorEnd - priorStart
    && priorEnd + 24 * 60 * 60 * 1000 === currentStart;
}

function snapshotAllocatedLeadShare(row = {}) {
  const storedShare = row.allocatedLeadShare;
  if (storedShare !== null && storedShare !== undefined && storedShare !== "" && Number.isFinite(Number(storedShare))) return Number(storedShare);
  const company = number(row.allocatedLeadSales ?? row.companySourcedSales);
  const self = number(row.selfSourcedSales);
  if (company + self) return safeDivide(company, company + self);
  if (number(row.attributionWithheldSales)) return null;
  return safeDivide(company, row.approvedSales ?? row.sales);
}

function snapshotSourceShareComparable(row = {}) {
  if (typeof row.sourceShareComparable === "boolean") return row.sourceShareComparable;
  const company = number(row.allocatedLeadSales ?? row.companySourcedSales);
  const self = number(row.selfSourcedSales);
  const withheld = number(row.attributionWithheldSales);
  const total = number(row.approvedSales ?? row.sales);
  if (company + self + withheld > 0) {
    return buildSourceAttributionCoverage({
      companySourcedSales: company,
      selfSourcedSales: self,
      attributionWithheldSales: withheld,
      totalSales: total
    }).sourceShareComparable;
  }
  return withheld === 0 && total > 0;
}

function isNamedTeam(value) {
  const label = String(value || "").trim();
  return Boolean(label) && !/(unknown|unidentified|withheld|not assigned|not available)/i.test(label);
}

function buildManagerRows(comparisonRows = [], { callCoverageComplete = false } = {}) {
  const managers = new Map();
  comparisonRows.forEach((row) => {
    if (number(row.sentAllocationEvents) <= 0) return;
    const manager = String(row.manager || "Unknown").trim() || "Unknown";
    const value = managers.get(manager) || {
      manager,
      activeSalespeople: 0,
      sent: 0,
      unique: 0,
      reallocations: 0,
      sales: 0,
      value: 0,
      company: 0,
      self: 0,
      withheld: 0,
      customersCalledAfterAllocation: 0,
      sameDayCalls: 0,
      callsWithin24Hours: 0,
      callsWithin72Hours: 0,
      weeklyCallCount: 0,
      weeklyOutboundCallCount: 0,
      weeklyDurationObservedCalls: 0,
      weeklyZeroDurationCalls: 0,
      weeklyShortCallCount: 0,
      weeklyLongCallCount: 0,
      weeklyTotalCallDurationSeconds: 0,
      managerOwnSent: 0,
      managerOwnSales: 0,
      managerOwnValue: 0,
      managerOwnCompany: 0,
      managerOwnSelf: 0,
      managerOwnWithheld: 0
    };
    value.activeSalespeople += 1;
    value.sent += number(row.sentAllocationEvents);
    value.unique += number(row.uniqueCustomers);
    value.reallocations += number(row.reallocationEvents);
    value.sales += number(row.approvedSales);
    value.value += number(row.approvedSalesValue);
    value.company += number(row.companySourcedSales);
    value.self += number(row.selfSourcedSales);
    value.withheld += number(row.attributionWithheldSales);
    value.customersCalledAfterAllocation += number(row.customersCalledAfterAllocation);
    value.sameDayCalls += number(row.sameDayCalls);
    value.callsWithin24Hours += number(row.callsWithin24Hours);
    value.callsWithin72Hours += number(row.callsWithin72Hours);
    value.weeklyCallCount += number(row.weeklyCallCount);
    value.weeklyOutboundCallCount += number(row.weeklyOutboundCallCount);
    value.weeklyDurationObservedCalls += number(row.weeklyDurationObservedCalls);
    value.weeklyZeroDurationCalls += number(row.weeklyZeroDurationCalls);
    value.weeklyShortCallCount += number(row.weeklyShortCallCount);
    value.weeklyLongCallCount += number(row.weeklyLongCallCount);
    value.weeklyTotalCallDurationSeconds += number(row.weeklyTotalCallDurationSeconds);
    if (normalizePerson(row.salesperson) === normalizePerson(manager)) {
      value.managerOwnSent += number(row.sentAllocationEvents);
      value.managerOwnSales += number(row.approvedSales);
      value.managerOwnValue += number(row.approvedSalesValue);
      value.managerOwnCompany += number(row.companySourcedSales);
      value.managerOwnSelf += number(row.selfSourcedSales);
      value.managerOwnWithheld += number(row.attributionWithheldSales);
    }
    managers.set(manager, value);
  });

  const totalSent = Array.from(managers.values()).reduce((sum, row) => sum + row.sent, 0);
  const totalSales = Array.from(managers.values()).reduce((sum, row) => sum + row.sales, 0);
  const totalLeadRecipients = Array.from(managers.values()).reduce((sum, row) => sum + row.activeSalespeople, 0);
  const companyObservedPerRecipientAverage = safeDivide(totalSent, totalLeadRecipients);
  const totalAllocatedLeadSales = Array.from(managers.values()).reduce((sum, row) => sum + row.company, 0);
  const managerValues = Array.from(managers.values()).map((row) => ({
    ...row,
    ...buildSourceAttributionCoverage({
      companySourcedSales: row.company,
      selfSourcedSales: row.self,
      attributionWithheldSales: row.withheld,
      totalSales: row.sales
    })
  }));
  const comparableManagers = managerValues.filter((row) => row.sourceShareComparable);
  const comparableManagerClassifiedSales = comparableManagers.reduce((sum, row) => sum + row.classifiedSales, 0);
  const comparableManagerAllocatedSales = comparableManagers.reduce((sum, row) => sum + row.company, 0);
  const comparableManagerAllocatedShare = safeDivide(comparableManagerAllocatedSales, comparableManagerClassifiedSales);
  return managerValues
    .map((row) => ({
      ...row,
      allocatedLeadSales: row.company,
      leadsPerActiveSalesperson: row.activeSalespeople ? row.sent / row.activeSalespeople : 0,
      companyObservedPerRecipientAverage,
      workloadReferenceIndex: companyObservedPerRecipientAverage
        ? safeDivide(row.sent / row.activeSalespeople, companyObservedPerRecipientAverage)
        : 0,
      salesPerLead: safeDivide(row.sales, row.sent),
      ratePer1000: row.sent ? row.sales / row.sent * 1000 : 0,
      valuePerLead: safeDivide(row.value, row.sent),
      leadsPerSale: row.sales ? row.sent / row.sales : null,
      reallocationRate: safeDivide(row.reallocations, row.sent),
      leadShare: totalSent ? row.sent / totalSent : 0,
      salesShare: totalSales ? row.sales / totalSales : 0,
      allocatedSalesShare: safeDivide(row.company, totalAllocatedLeadSales),
      companyShare: row.allocatedLeadShare,
      selfShare: row.classifiedSales ? safeDivide(row.self, row.classifiedSales) : 0,
      efficiencyIndex: row.sourceShareComparable ? safeDivide(row.allocatedLeadShare, comparableManagerAllocatedShare) * 100 : null,
      managerOwnSalesShare: safeDivide(row.managerOwnSales, row.sales),
      exactCallsObserved: row.customersCalledAfterAllocation,
      noExactCallObserved: Math.max(0, row.unique - row.customersCalledAfterAllocation),
      utilisationRate: callCoverageComplete ? safeDivide(row.customersCalledAfterAllocation, row.unique) : null,
      sameDayCallRate: callCoverageComplete ? safeDivide(row.sameDayCalls, row.unique) : null,
      callWithin24HoursRate: callCoverageComplete ? safeDivide(row.callsWithin24Hours, row.unique) : null,
      callWithin72HoursRate: callCoverageComplete ? safeDivide(row.callsWithin72Hours, row.unique) : null,
      weeklyAverageCallDurationSeconds: row.weeklyDurationObservedCalls
        ? row.weeklyTotalCallDurationSeconds / row.weeklyDurationObservedCalls
        : null,
      weeklyCallsPerApprovedSale: row.sales ? row.weeklyCallCount / row.sales : null,
      lowSample: row.sent < MINIMUM_MANAGER_SAMPLE,
      namedTeam: isNamedTeam(row.manager)
    }))
    .sort((a, b) => b.allocatedLeadShare - a.allocatedLeadShare || b.allocatedLeadSales - a.allocatedLeadSales || a.manager.localeCompare(b.manager));
}

function buildLeadDistributionRows(salespersonRows = [], managerRows = []) {
  const managerByName = new Map(managerRows.map((row) => [row.manager, row]));
  return salespersonRows.map((row) => {
    const manager = managerByName.get(row.manager);
    const sentLeads = number(row.sentAllocationEvents);
    const equalShareReference = manager?.leadsPerActiveSalesperson || 0;
    const shareIndex = equalShareReference ? sentLeads / equalShareReference : 0;
    let status = "Within 25% of equal-share reference";
    if (!manager || manager.activeSalespeople < 2) {
      status = "Single observed recipient — no within-team comparison";
    } else if (shareIndex >= 1 + EQUAL_SHARE_BAND) {
      status = "25%+ above equal-share reference";
    } else if (shareIndex <= 1 - EQUAL_SHARE_BAND) {
      status = "25%+ below equal-share reference";
    }
    return {
      salesperson: row.salesperson,
      manager: row.manager,
      sentLeads,
      observedActiveSalespeople: manager?.activeSalespeople || 0,
      teamSentLeads: manager?.sent || 0,
      equalShareReference,
      differenceFromReference: sentLeads - equalShareReference,
      shareIndex,
      status
    };
  }).sort((a, b) => a.manager.localeCompare(b.manager) || b.sentLeads - a.sentLeads || a.salesperson.localeCompare(b.salesperson));
}

function buildManagerChartGuidance(managerRows = [], distributionRows = [], {
  callEvidenceThrough = "",
  unresolvedCallJoinKeys = 0,
  unlinkedSelfSourcingCallAttempts = 0,
  callCoverageComplete = false
} = {}) {
  const totalSent = managerRows.reduce((sum, row) => sum + row.sent, 0);
  const comparableRows = managerRows.filter((row) => row.sourceShareComparable);
  const totalSales = comparableRows.reduce((sum, row) => sum + row.classifiedSales, 0);
  const totalAllocatedLeadSales = comparableRows.reduce((sum, row) => sum + row.allocatedLeadSales, 0);
  const allAllocatedLeadSales = managerRows.reduce((sum, row) => sum + row.allocatedLeadSales, 0);
  const totalActive = managerRows.reduce((sum, row) => sum + row.activeSalespeople, 0);
  const overallAllocatedLeadShare = safeDivide(totalAllocatedLeadSales, totalSales);
  const fullSample = managerRows
    .filter((row) => row.sourceShareComparable && !row.lowSample && row.sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE)
    .sort((a, b) => b.allocatedLeadShare - a.allocatedLeadShare || b.allocatedLeadSales - a.allocatedLeadSales);
  const topRate = fullSample[0] || null;
  const bottomRate = fullSample[fullSample.length - 1] || null;
  const efficiencyFacts = [];
  if (topRate) {
    const relative = overallAllocatedLeadShare ? topRate.allocatedLeadShare / overallAllocatedLeadShare - 1 : 0;
    efficiencyFacts.push(relative >= MATERIAL_RELATIVE_DIFFERENCE
      ? `Sales highlight: ${topRate.manager} has the highest Company Supplied Share at ${oneDecimal(topRate.allocatedLeadShare * 100)}%. ${topRate.allocatedLeadSales} of ${topRate.sales} Approved Sales came from customers supplied to the selling rep before approval. This is ${oneDecimal(relative * 100)}% above the comparable manager-team average of ${oneDecimal(overallAllocatedLeadShare * 100)}%.`
      : `No eligible manager team is at least 10% above the comparable Company Supplied Share average of ${oneDecimal(overallAllocatedLeadShare * 100)}%.`);
  }
  if (bottomRate && bottomRate !== topRate) {
    const relative = overallAllocatedLeadShare ? 1 - bottomRate.allocatedLeadShare / overallAllocatedLeadShare : 0;
    efficiencyFacts.push(relative >= MATERIAL_RELATIVE_DIFFERENCE
      ? `Sales review point: ${bottomRate.manager} has the lowest Company Supplied Share at ${oneDecimal(bottomRate.allocatedLeadShare * 100)}% (${bottomRate.allocatedLeadSales} of ${bottomRate.sales} Approved Sales). This is ${oneDecimal(relative * 100)}% below the comparable manager-team average; it is a prompt to review the sales mix, not a performance finding.`
      : `No eligible manager team is at least 10% below the comparable Company Supplied Share average.`);
  }
  const lowSamples = managerRows.filter((row) => row.lowSample || row.sales < MINIMUM_APPROVED_SALES_SHARE_SAMPLE);
  efficiencyFacts.push(lowSamples.length
    ? `Sample warning: ${lowSamples.map((row) => row.manager).join(", ")} ${lowSamples.length === 1 ? "does" : "do"} not meet both safeguards (${MINIMUM_MANAGER_SAMPLE}+ Sent Leads and ${MINIMUM_APPROVED_SALES_SHARE_SAMPLE}+ Approved Sales).`
    : `Sample check: all ${managerRows.length} manager groups meet both safeguards (${MINIMUM_MANAGER_SAMPLE}+ Sent Leads and ${MINIMUM_APPROVED_SALES_SHARE_SAMPLE}+ Approved Sales).`);
  const provisionalTeams = managerRows.filter((row) => !row.sourceShareComparable && row.withheld > 0);
  if (provisionalTeams.length) {
    efficiencyFacts.push(`Sales-source safeguard: ${provisionalTeams.map((row) => row.manager).join(", ")} ${provisionalTeams.length === 1 ? "is" : "are"} shown as provisional and excluded from source-share comparisons because unresolved attribution is 3% or more. The percentage and possible range remain visible.`);
  }

  const gaps = managerRows
    .filter((row) => row.sourceShareComparable)
    .map((row) => ({ ...row, gap: row.allocatedSalesShare - row.leadShare }));
  const positiveGap = [...gaps].sort((a, b) => b.gap - a.gap)[0] || null;
  const negativeGap = [...gaps].sort((a, b) => a.gap - b.gap)[0] || null;
  const shareFacts = [];
  shareFacts.push(positiveGap && positiveGap.gap >= MATERIAL_SHARE_GAP
    ? `Sales highlight: ${positiveGap.manager}'s share of company-supplied sales is ${percentagePoints(positiveGap.gap)} higher than its share of this week's lead allocation (${oneDecimal(positiveGap.allocatedSalesShare * 100)}% of company-supplied sales versus ${oneDecimal(positiveGap.leadShare * 100)}% of weekly leads).`
    : `No manager team's company-supplied sales share is at least 2 percentage points higher than its share of this week's lead allocation.`);
  shareFacts.push(negativeGap && negativeGap.gap <= -MATERIAL_SHARE_GAP
    ? `Sales review point: ${negativeGap.manager}'s share of company-supplied sales is ${percentagePoints(negativeGap.gap)} lower than its share of this week's lead allocation (${oneDecimal(negativeGap.allocatedSalesShare * 100)}% of company-supplied sales versus ${oneDecimal(negativeGap.leadShare * 100)}% of weekly leads). Use this as a conversation starter about the sales mix and timing, not as a performance finding.`
    : `No manager team's company-supplied sales share is at least 2 percentage points lower than its share of this week's lead allocation.`);
  shareFacts.push(`Sales context: this view includes ${allAllocatedLeadSales.toLocaleString("en-AU")} company-supplied sales approved this week, where the customer was allocated to the seller before approval. Provisional teams remain visible but are excluded from comparative conclusions. Allocations may be from an earlier week, so this is a sales-mix comparison—not a conversion rate for this week's leads.`);

  const byLoad = [...managerRows].sort((a, b) => b.leadsPerActiveSalesperson - a.leadsPerActiveSalesperson);
  const highestLoad = byLoad[0] || null;
  const lowestLoad = byLoad[byLoad.length - 1] || null;
  const overallLoad = totalActive ? totalSent / totalActive : 0;
  const above = distributionRows.filter((row) => row.status.startsWith("25%+ above")).length;
  const below = distributionRows.filter((row) => row.status.startsWith("25%+ below")).length;
  const activeFacts = [];
  if (highestLoad) {
    activeFacts.push(`Highest observed load: ${highestLoad.manager} has ${oneDecimal(highestLoad.leadsPerActiveSalesperson)} Sent Leads per salesperson receiving leads across ${highestLoad.activeSalespeople} people.`);
  }
  if (lowestLoad && lowestLoad !== highestLoad) {
    activeFacts.push(`Lowest observed load: ${lowestLoad.manager} has ${oneDecimal(lowestLoad.leadsPerActiveSalesperson)} per salesperson receiving leads across ${lowestLoad.activeSalespeople} people; the weighted company observed-recipient average is ${oneDecimal(overallLoad)}.`);
    const spread = lowestLoad.leadsPerActiveSalesperson ? highestLoad.leadsPerActiveSalesperson / lowestLoad.leadsPerActiveSalesperson : 0;
    if (spread >= 1 + EQUAL_SHARE_BAND) {
      activeFacts.push(`Watch item: the highest manager load is ${oneDecimal(spread)} times the lowest. Check capacity, leave and role differences before treating this as unfair allocation.`);
    }
  }
  activeFacts.push(`The chart reference is the weighted company average of ${oneDecimal(overallLoad)} Sent Leads per salesperson receiving leads. Within teams, ${above} of ${totalActive} recipients are 25%+ above their team equal-share reference and ${below} are 25%+ below it.`);

  const callBacklogRows = [...managerRows]
    .sort((a, b) => b.noExactCallObserved - a.noExactCallObserved || b.unique - a.unique || a.manager.localeCompare(b.manager));
  const largestCallBacklog = callBacklogRows[0] || null;
  const smallestCallBacklog = [...callBacklogRows]
    .sort((a, b) => a.noExactCallObserved - b.noExactCallObserved || a.unique - b.unique || a.manager.localeCompare(b.manager))[0] || null;
  const totalNoExactCallObserved = managerRows.reduce((sum, row) => sum + number(row.noExactCallObserved), 0);
  const totalUniqueAllocatedPairs = managerRows.reduce((sum, row) => sum + number(row.unique), 0);
  const callBacklogFacts = [];
  if (largestCallBacklog) {
    callBacklogFacts.push(`Largest review backlog: ${largestCallBacklog.manager} has ${largestCallBacklog.noExactCallObserved.toLocaleString("en-AU")} of ${largestCallBacklog.unique.toLocaleString("en-AU")} allocated customer-salesperson pairs ${callCoverageComplete ? "uncalled within the governed reporting window" : "with no exact recorded call through the evidence cutoff"} (${oneDecimal(safeDivide(largestCallBacklog.noExactCallObserved, largestCallBacklog.unique) * 100)}%).`);
  }
  if (smallestCallBacklog && smallestCallBacklog !== largestCallBacklog) {
    callBacklogFacts.push(`Smallest review backlog: ${smallestCallBacklog.manager} has ${smallestCallBacklog.noExactCallObserved.toLocaleString("en-AU")} of ${smallestCallBacklog.unique.toLocaleString("en-AU")} pairs ${callCoverageComplete ? "uncalled within the governed reporting window" : "with no exact recorded call through the evidence cutoff"}.`);
  }
  callBacklogFacts.push(`Across all teams, ${totalNoExactCallObserved.toLocaleString("en-AU")} of ${totalUniqueAllocatedPairs.toLocaleString("en-AU")} allocated customer-salesperson pairs have no exact post-allocation call observed${callEvidenceThrough ? ` through ${callEvidenceThrough}` : " through the displayed evidence cutoff"}.`);
  if (number(unresolvedCallJoinKeys)) {
    callBacklogFacts.push(`Data-quality warning: ${number(unresolvedCallJoinKeys).toLocaleString("en-AU")} calls still lack a reliable exact customer join and could reduce these review counts if reconciled.`);
  }
  if (number(unlinkedSelfSourcingCallAttempts)) {
    callBacklogFacts.push(`Separate activity: ${number(unlinkedSelfSourcingCallAttempts).toLocaleString("en-AU")} valid calls without a Customer ID are treated as unsuccessful self-sourcing attempts. They are not company-supplied lead calls and are not Self-Sourced Sales.`);
  }

  return {
    efficiency: {
      whatItShows: "For each manager team, this shows the share of classified Approved Sales that came from company-supplied customers: customers allocated to the actual seller before approval. Coverage and the possible range disclose any unresolved attribution.",
      howToRead: `A higher percentage means more of the team's classified Approved Sales came from company-supplied customers. Compare only teams below 3% unresolved attribution and with at least ${MINIMUM_MANAGER_SAMPLE} Sent Leads and ${MINIMUM_APPROVED_SALES_SHARE_SAMPLE} Approved Sales. Provisional teams remain visible but are not compared. This shows the source mix of approved sales, not conversion of the leads sent this week.`,
      whatToKnow: efficiencyFacts.join("\n")
    },
    shares: {
      whatItShows: "For each manager team, this compares its share of this week's lead allocation with its share of company-supplied sales approved this week.",
      howToRead: "Read the two values as weekly lead allocation share / company-supplied sales share. When the second number is higher, the team accounts for a larger share of company-supplied sales than of this week's lead allocation; when it is lower, use it as a discussion starter about sales mix and timing. This is not a conversion rate and does not mean current leads were wasted.",
      whatToKnow: shareFacts.join("\n")
    },
    active: {
      whatItShows: "Sent Leads divided by salespeople receiving at least one valid lead for each manager, compared with the weighted company observed-recipient average.",
      howToRead: "Teams above the reference allocated more leads per observed recipient than the company average; teams below it allocated fewer. This is workload context, not a staffing or fairness verdict.",
      whatToKnow: `${activeFacts.join("\n")}\nLimitation: this source cannot identify an active salesperson who received zero leads; that requires a governed roster or attendance source.`
    },
    callBacklog: {
      whatItShows: "Allocated customer-salesperson pairs in each manager team where no exact same-customer, same-salesperson call was observed after allocation through the displayed evidence cutoff.",
      howToRead: `A higher count means a larger company-supplied lead review backlog${callCoverageComplete ? " within the governed reporting window" : ", not proven failure to call"}. Team allocation volumes differ and newer leads have had less time to be called. Valid calls without a Customer ID are separate self-sourcing attempts and are not assigned to allocated leads.`,
      whatToKnow: callBacklogFacts.join("\n")
    }
  };
}

function priorManagerMap(snapshot) {
  if (!snapshot) return new Map();
  if (Array.isArray(snapshot.managers)) {
    return new Map(snapshot.managers.map((row) => [normalizePerson(row.manager), row]));
  }
  const grouped = new Map();
  (snapshot.salespeople || []).forEach((row) => {
    const manager = String(row.manager || "").trim();
    if (!manager) return;
    const key = normalizePerson(manager);
    const current = grouped.get(key) || { manager, sentAllocationEvents: 0, approvedSales: 0, allocatedLeadSales: 0 };
    current.sentAllocationEvents += number(row.sentAllocationEvents);
    current.approvedSales += number(row.approvedSales);
    current.allocatedLeadSales += number(row.allocatedLeadSales ?? row.companySourcedSales);
    grouped.set(key, current);
  });
  grouped.forEach((row) => {
    row.approvedSalesPerLead = safeDivide(row.approvedSales, row.sentAllocationEvents);
    row.allocatedLeadShare = snapshotAllocatedLeadShare(row);
  });
  return grouped;
}

function buildTrophyCandidate({ trophy, rows, compare, metric, context }) {
  const eligible = [...rows].sort(compare);
  if (!eligible.length) {
    const noCandidate = trophy.endsWith("— Team")
      ? "No eligible team candidate this week"
      : "No eligible salesperson candidate this week";
    return {
      trophy,
      candidate: noCandidate,
      metric: "Not awarded",
      context: "The required data or eligibility threshold was not met.",
      runnersUp: "None",
      eligibleCount: 0
    };
  }
  const winner = eligible[0];
  return {
    trophy,
    candidate: winner.displayName,
    metric: metric(winner),
    context: context(winner),
    runnersUp: eligible.slice(1, 3).map((row) => row.displayName).join(", ") || "No additional eligible candidate",
    eligibleCount: eligible.length
  };
}

function buildPerformanceViews({ salespersonRows = [], managerRows = [], previousSnapshot = null, currentPeriod = null, callCoverageComplete = false } = {}) {
  const totalSent = salespersonRows.reduce((sum, row) => sum + number(row.sentAllocationEvents), 0);
  const totalSales = salespersonRows.reduce((sum, row) => sum + number(row.approvedSales), 0);
  const totalValue = salespersonRows.reduce((sum, row) => sum + number(row.approvedSalesValue), 0);
  const totalReallocations = salespersonRows.reduce((sum, row) => sum + number(row.reallocationEvents), 0);
  const totalUnique = salespersonRows.reduce((sum, row) => sum + number(row.uniqueCustomers), 0);
  const totalCalled = salespersonRows.reduce((sum, row) => sum + number(row.customersCalledAfterAllocation), 0);
  const totalWithin72 = salespersonRows.reduce((sum, row) => sum + number(row.callsWithin72Hours), 0);
  const totalAllocatedLeadSales = salespersonRows.reduce((sum, row) => sum + number(row.companySourcedSales), 0);
  const totalSelfSourcedSales = salespersonRows.reduce((sum, row) => sum + number(row.selfSourcedSales), 0);
  const overallSalesPerLead = safeDivide(totalSales, totalSent);
  const overallAllocatedLeadShare = safeDivide(totalAllocatedLeadSales, totalAllocatedLeadSales + totalSelfSourcedSales);
  const overallValuePerLead = safeDivide(totalValue, totalSent);
  const overallReallocationRate = safeDivide(totalReallocations, totalSent);
  const overallUtilisationRate = callCoverageComplete ? safeDivide(totalCalled, totalUnique) : null;
  const overallFollowUpRate = callCoverageComplete ? safeDivide(totalWithin72, totalUnique) : null;
  const averageSalespersonLeads = safeDivide(totalSent, salespersonRows.length);
  const previousPeople = new Map((previousSnapshot?.salespeople || []).map((row) => [normalizePerson(row.salesperson), row]));
  const priorPeriodComparable = periodsAreComparable(currentPeriod, previousSnapshot?.period);

  const salespeople = salespersonRows.map((row) => {
    const sent = number(row.sentAllocationEvents);
    const unique = number(row.uniqueCustomers);
    const sales = number(row.approvedSales);
    const value = number(row.approvedSalesValue);
    const company = number(row.companySourcedSales);
    const self = number(row.selfSourcedSales);
    const withheld = number(row.attributionWithheldSales);
    const coverage = buildSourceAttributionCoverage({
      companySourcedSales: company,
      selfSourcedSales: self,
      attributionWithheldSales: withheld,
      totalSales: sales
    });
    const { sourceAttributionComplete, sourceShareComparable, allocatedLeadShare } = coverage;
    const prior = previousPeople.get(normalizePerson(row.salesperson));
    const priorSent = prior ? number(prior.sentAllocationEvents) : null;
    const priorSales = prior ? number(prior.approvedSales) : null;
    const priorAllocatedLeadSales = prior && Number.isFinite(Number(prior.allocatedLeadSales ?? prior.companySourcedSales))
      ? number(prior.allocatedLeadSales ?? prior.companySourcedSales)
      : null;
    const priorRate = prior && snapshotSourceShareComparable(prior) ? snapshotAllocatedLeadShare(prior) : null;
    const salesPerLead = safeDivide(sales, sent);
    const leadShare = safeDivide(sent, totalSent);
    const salesShare = safeDivide(sales, totalSales);
    const allocatedSalesShare = safeDivide(company, totalAllocatedLeadSales);
    const reallocationRate = safeDivide(row.reallocationEvents, sent);
    const selfShare = coverage.classifiedSales ? safeDivide(self, coverage.classifiedSales) : 0;
    const concerns = [];
    if (sent >= averageSalespersonLeads && sales === 0) {
      concerns.push(`High weekly lead volume (${sent.toLocaleString("en-AU")} Sent Leads) with no Approved Sales in the report week; review context, but do not call this weekly lead conversion.`);
    } else if (sourceShareComparable && sent >= averageSalespersonLeads && sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE && allocatedLeadShare < overallAllocatedLeadShare * WEAK_RETURN_RATIO) {
      concerns.push(`Only ${company} of ${coverage.classifiedSales} classified Approved Sales (${oneDecimal(allocatedLeadShare * 100)}%) were Sales From Allocated Leads, below 70% of the salesperson benchmark.`);
    }
    if (sourceShareComparable && totalAllocatedLeadSales && leadShare - allocatedSalesShare >= MATERIAL_SHARE_GAP) {
      concerns.push(`Received ${oneDecimal(leadShare * 100)}% of weekly Sent Leads but produced ${oneDecimal(allocatedSalesShare * 100)}% of Sales From Allocated Leads approved this week; earlier allocations may contribute to the sales.`);
    }
    if (reallocationRate >= Math.max(MATERIAL_REALLOCATION_RATE, overallReallocationRate * 1.5)) {
      concerns.push(`Reallocations are ${oneDecimal(reallocationRate * 100)}% of Sent Leads versus ${oneDecimal(overallReallocationRate * 100)}% overall.`);
    }
    if (sourceShareComparable && coverage.classifiedSales && selfShare >= SELF_SOURCE_DEPENDENCE_THRESHOLD) {
      concerns.push(`${oneDecimal(selfShare * 100)}% of classified Approved Sales are Self Sourced; this may show initiative but is less attributable to company-provided leads.`);
    }
    if (sourceShareComparable && priorRate !== null && priorSent >= MINIMUM_PERFORMANCE_SAMPLE && sent >= MINIMUM_PERFORMANCE_SAMPLE && priorSales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE && sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE && allocatedLeadShare - priorRate <= -0.05) {
      concerns.push(`Company-supplied sales share reduced by ${oneDecimal(Math.abs(allocatedLeadShare - priorRate) * 100)} percentage points from the prior comparable period.`);
    }
    if (callCoverageComplete) {
      const utilisationRate = safeDivide(row.customersCalledAfterAllocation, unique);
      const followUpRate = safeDivide(row.callsWithin72Hours, unique);
      if (overallUtilisationRate && utilisationRate < overallUtilisationRate * WEAK_RETURN_RATIO) concerns.push(`Lead utilisation is below 70% of the complete-data benchmark.`);
      if (overallFollowUpRate && followUpRate < overallFollowUpRate * WEAK_RETURN_RATIO) concerns.push(`72-hour follow-up is below 70% of the complete-data benchmark.`);
    }
    return {
      ...row,
      displayName: row.salesperson,
      sent,
      unique,
      sales,
      value,
      company,
      self,
      withheld,
      ...coverage,
      allocatedLeadSales: company,
      salesPerLead,
      ratePer1000: salesPerLead * 1000,
      valuePerLead: safeDivide(value, sent),
      leadsPerSale: sales ? sent / sales : null,
      leadShare,
      salesShare,
      allocatedSalesShare,
      exactCallsObserved: number(row.customersCalledAfterAllocation),
      noExactCallObserved: Math.max(0, unique - number(row.customersCalledAfterAllocation)),
      efficiencyIndex: sourceShareComparable ? safeDivide(allocatedLeadShare, overallAllocatedLeadShare) * 100 : null,
      reallocationRate,
      companyShare: allocatedLeadShare,
      selfShare,
      utilisationRate: callCoverageComplete ? safeDivide(row.customersCalledAfterAllocation, unique) : null,
      sameDayCallRate: callCoverageComplete ? safeDivide(row.sameDayCalls, unique) : null,
      callWithin24HoursRate: callCoverageComplete ? safeDivide(row.callsWithin24Hours, unique) : null,
      callWithin72HoursRate: callCoverageComplete ? safeDivide(row.callsWithin72Hours, unique) : null,
      weeklyCallCount: number(row.weeklyCallCount),
      weeklyOutboundCallCount: number(row.weeklyOutboundCallCount),
      weeklyDurationObservedCalls: number(row.weeklyDurationObservedCalls),
      weeklyZeroDurationCalls: number(row.weeklyZeroDurationCalls),
      weeklyShortCallCount: number(row.weeklyShortCallCount),
      weeklyLongCallCount: number(row.weeklyLongCallCount),
      weeklyTotalCallDurationSeconds: number(row.weeklyTotalCallDurationSeconds),
      weeklyAverageCallDurationSeconds: row.weeklyAverageCallDurationSeconds ?? null,
      weeklyMedianCallDurationSeconds: row.weeklyMedianCallDurationSeconds ?? null,
      weeklyCallsPerApprovedSale: row.weeklyCallsPerApprovedSale ?? null,
      priorSent,
      priorSales,
      priorAllocatedLeadSales,
      priorRate,
      change: priorRate === null || !sourceShareComparable ? null : allocatedLeadShare - priorRate,
      salesChangeRate: priorSales ? (sales - priorSales) / priorSales : null,
      eligible: sent >= MINIMUM_PERFORMANCE_SAMPLE,
      shareEligible: sourceShareComparable && sent >= MINIMUM_PERFORMANCE_SAMPLE && sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE,
      concerns
    };
  });

  const peopleByManager = new Map();
  salespeople.forEach((row) => {
    if (!peopleByManager.has(row.manager)) peopleByManager.set(row.manager, []);
    peopleByManager.get(row.manager).push(row);
  });
  const priorTeams = priorManagerMap(previousSnapshot);
  const namedManagers = managerRows.filter((row) => row.namedTeam !== false && isNamedTeam(row.manager));
  const averageTeamLeads = safeDivide(namedManagers.reduce((sum, row) => sum + row.sent, 0), namedManagers.length);
  const substantialTeamLeadVolume = Math.max(MINIMUM_PERFORMANCE_SAMPLE, averageTeamLeads * 0.75);

  const teams = managerRows.map((row) => {
    const members = peopleByManager.get(row.manager) || [];
    const eligibleMembers = members.filter((member) => member.shareEligible);
    const lowMembers = eligibleMembers.filter((member) => member.allocatedLeadShare < overallAllocatedLeadShare);
    const salesLeader = [...members].sort((a, b) => b.sales - a.sales || a.displayName.localeCompare(b.displayName))[0] || null;
    const valueLeader = [...members].sort((a, b) => b.value - a.value || a.displayName.localeCompare(b.displayName))[0] || null;
    const selfContributors = members.filter((member) => member.self > 0).length;
    const prior = priorTeams.get(normalizePerson(row.manager));
    const priorSent = prior ? number(prior.sentAllocationEvents ?? prior.sent) : null;
    const priorSales = prior ? number(prior.approvedSales ?? prior.sales) : null;
    const priorAllocatedLeadSales = prior && Number.isFinite(Number(prior.allocatedLeadSales ?? prior.companySourcedSales))
      ? number(prior.allocatedLeadSales ?? prior.companySourcedSales)
      : null;
    const priorRate = prior && snapshotSourceShareComparable(prior) ? snapshotAllocatedLeadShare(prior) : null;
    const concerns = [];
    if (row.sent >= substantialTeamLeadVolume && row.sales === 0) {
      concerns.push(`High weekly lead volume (${row.sent.toLocaleString("en-AU")} Sent Leads) with no Approved Sales in the report week; review context without treating this as weekly lead conversion.`);
    } else if (row.sourceShareComparable && row.sent >= substantialTeamLeadVolume && row.sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE && row.allocatedLeadShare < overallAllocatedLeadShare * WEAK_RETURN_RATIO) {
      concerns.push(`Only ${row.allocatedLeadSales} of ${row.classifiedSales} classified team Approved Sales (${oneDecimal(row.allocatedLeadShare * 100)}%) were Sales From Allocated Leads, below 70% of the manager-comparable share.`);
    }
    if (row.sourceShareComparable && totalAllocatedLeadSales && row.leadShare - row.allocatedSalesShare >= MATERIAL_SHARE_GAP) {
      concerns.push(`The team received ${oneDecimal(row.leadShare * 100)}% of weekly Sent Leads but produced ${oneDecimal(row.allocatedSalesShare * 100)}% of Sales From Allocated Leads approved this week; earlier allocations may contribute to the sales.`);
    }
    const salesConcentration = safeDivide(salesLeader?.sales, row.sales);
    const valueConcentration = safeDivide(valueLeader?.value, row.value);
    if (members.length > 1 && (salesConcentration > CONCENTRATION_THRESHOLD || valueConcentration > CONCENTRATION_THRESHOLD)) {
      const leader = salesConcentration >= valueConcentration ? salesLeader : valueLeader;
      const share = Math.max(salesConcentration, valueConcentration);
      concerns.push(`${leader.displayName} contributes ${oneDecimal(share * 100)}% of the team's ${salesConcentration >= valueConcentration ? "Approved Sales" : "Approved Sales Value"}, creating concentration risk.`);
    }
    if (eligibleMembers.length > 1 && lowMembers.length / eligibleMembers.length > 0.5) {
      concerns.push(`${lowMembers.length} of ${eligibleMembers.length} comparable team members are below the overall salesperson Sales From Allocated Leads % benchmark.`);
    }
    if (row.sourceShareComparable && row.classifiedSales && row.selfShare >= SELF_SOURCE_DEPENDENCE_THRESHOLD) {
      concerns.push(`${oneDecimal(row.selfShare * 100)}% of classified team Approved Sales are Self Sourced; this may show initiative but makes the result less attributable to company-provided leads.`);
    }
    if (row.reallocationRate >= Math.max(MATERIAL_REALLOCATION_RATE, overallReallocationRate * 1.5)) {
      concerns.push(`Reallocations are ${oneDecimal(row.reallocationRate * 100)}% of team Sent Leads versus ${oneDecimal(overallReallocationRate * 100)}% overall.`);
    }
    if (callCoverageComplete) {
      if (overallUtilisationRate && row.utilisationRate < overallUtilisationRate * WEAK_RETURN_RATIO) concerns.push(`Team lead utilisation is below 70% of the complete-data benchmark.`);
      if (overallFollowUpRate && row.callWithin72HoursRate < overallFollowUpRate * WEAK_RETURN_RATIO) concerns.push(`Team 72-hour follow-up is below 70% of the complete-data benchmark.`);
    }
    return {
      ...row,
      displayName: `${row.manager} team`,
      members,
      eligibleMembers: eligibleMembers.length,
      lowPerformingMembers: lowMembers.length,
      lowPerformingMemberShare: safeDivide(lowMembers.length, eligibleMembers.length),
      selfContributors,
      salesLeader: salesLeader?.displayName || "",
      salesLeaderShare: salesConcentration,
      valueLeader: valueLeader?.displayName || "",
      valueLeaderShare: valueConcentration,
      priorSent,
      priorSales,
      priorAllocatedLeadSales,
      priorRate,
      change: priorRate === null || !row.sourceShareComparable ? null : row.allocatedLeadShare - priorRate,
      salesChangeRate: priorSales ? (row.sales - priorSales) / priorSales : null,
      eligible: row.namedTeam !== false && isNamedTeam(row.manager) && row.sent >= MINIMUM_PERFORMANCE_SAMPLE,
      shareEligible: row.sourceShareComparable && row.namedTeam !== false && isNamedTeam(row.manager) && row.sent >= MINIMUM_PERFORMANCE_SAMPLE && row.sales >= MINIMUM_APPROVED_SALES_SHARE_SAMPLE,
      concerns
    };
  });

  const salespeopleResultsWorthyOfInvestigation = salespeople.filter((row) => row.sourceShareComparable && row.eligible && (row.concerns.length || row.sales === 0))
    .sort((a, b) => a.allocatedLeadShare - b.allocatedLeadShare || a.allocatedLeadSales - b.allocatedLeadSales || b.sent - a.sent || a.displayName.localeCompare(b.displayName));
  const teamResultsWorthyOfInvestigation = teams.filter((row) => row.eligible && row.concerns.length)
    .sort((a, b) => b.concerns.length - a.concerns.length || a.efficiencyIndex - b.efficiencyIndex || b.sent - a.sent || a.manager.localeCompare(b.manager));

  const eligiblePeople = salespeople.filter((row) => row.eligible);
  const eligibleTeams = teams.filter((row) => row.eligible);
  const shareEligiblePeople = salespeople.filter((row) => row.shareEligible);
  const shareEligibleTeams = teams.filter((row) => row.shareEligible);
  const versatilityPeople = salespeople.filter((row) => row.sourceShareComparable && row.classifiedSales >= MINIMUM_TROPHY_SALES && row.company > 0 && row.self > 0);
  const versatilityTeams = teams.filter((row) => row.sourceShareComparable && row.namedTeam && row.classifiedSales >= MINIMUM_TROPHY_SALES && row.company > 0 && row.self > 0);
  const consistentPeople = priorPeriodComparable
    ? salespeople.filter((row) => row.sales >= MINIMUM_TROPHY_SALES && row.priorSales >= MINIMUM_TROPHY_SALES && row.salesChangeRate !== null)
    : [];
  const consistentTeams = priorPeriodComparable
    ? teams.filter((row) => row.namedTeam && row.sales >= MINIMUM_TROPHY_SALES && row.priorSales >= MINIMUM_TROPHY_SALES && row.salesChangeRate !== null)
    : [];
  const leadBurnersByResult = shareEligiblePeople
    .filter((row) => row.sent >= MINIMUM_PERFORMANCE_SAMPLE)
    .sort((a, b) => a.allocatedLeadShare - b.allocatedLeadShare || b.sent - a.sent || a.displayName.localeCompare(b.displayName))
    .slice(0, 10);
  const leadBurnersByUncalled = callCoverageComplete
    ? salespeople.filter((row) => row.unique >= MINIMUM_UNCALLED_REVIEW_PAIRS && row.noExactCallObserved > 0)
      .map((row) => ({ ...row, uncalledRate: safeDivide(row.noExactCallObserved, row.unique) }))
      .sort((a, b) => b.uncalledRate - a.uncalledRate || b.noExactCallObserved - a.noExactCallObserved || a.displayName.localeCompare(b.displayName))
      .slice(0, 10)
    : [];
  const salespersonTrophies = [
    buildTrophyCandidate({ trophy: "Company-Supplied Sales Share Champion — Salesperson", rows: shareEligiblePeople.filter((row) => row.allocatedLeadSales > 0), compare: (a, b) => b.allocatedLeadShare - a.allocatedLeadShare || b.allocatedLeadSales - a.allocatedLeadSales, metric: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}%`, context: (row) => `${row.allocatedLeadSales} of ${row.classifiedSales} classified Approved Sales were to customers allocated to this seller before approval.` }),
    buildTrophyCandidate({ trophy: "Sales From Allocated Leads Champion — Salesperson", rows: shareEligiblePeople.filter((row) => row.allocatedLeadSales > 0), compare: (a, b) => b.allocatedLeadSales - a.allocatedLeadSales || b.allocatedLeadShare - a.allocatedLeadShare, metric: (row) => `${row.allocatedLeadSales} Sales From Allocated Leads`, context: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}% of ${row.classifiedSales} classified Approved Sales; allocation can be from any earlier date.` }),
    buildTrophyCandidate({ trophy: "Sales Volume Champion — Salesperson", rows: eligiblePeople, compare: (a, b) => b.sales - a.sales || b.allocatedLeadSales - a.allocatedLeadSales, metric: (row) => `${row.sales} Approved Sales`, context: (row) => `${row.allocatedLeadSales} Sales From Allocated Leads, ${row.self} Self-Sourced${row.withheld ? ` and ${row.withheld} source-attribution withheld` : ""}.` }),
    buildTrophyCandidate({ trophy: "Sales Value Champion — Salesperson", rows: eligiblePeople, compare: (a, b) => b.value - a.value || b.sales - a.sales, metric: (row) => `$${row.value.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`, context: (row) => `${row.sales} Approved Sales: ${row.allocatedLeadSales} Sales From Allocated Leads, ${row.self} Self Sourced${row.withheld ? ` and ${row.withheld} source-attribution withheld` : ""}.` }),
    buildTrophyCandidate({ trophy: "Self-Sourcing Champion — Salesperson", rows: shareEligiblePeople.filter((row) => row.self > 0), compare: (a, b) => b.self - a.self || b.selfShare - a.selfShare, metric: (row) => `${row.self} Self-Sourced Sales`, context: (row) => `${oneDecimal(row.selfShare * 100)}% of ${row.classifiedSales} classified Approved Sales; this is sales, not a count of self-sourced leads.` }),
    buildTrophyCandidate({ trophy: "Versatility Champion — Salesperson", rows: versatilityPeople, compare: (a, b) => Math.abs(a.allocatedLeadShare - 0.5) - Math.abs(b.allocatedLeadShare - 0.5) || b.classifiedSales - a.classifiedSales || a.displayName.localeCompare(b.displayName), metric: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}% company supplied / ${oneDecimal(row.selfShare * 100)}% self sourced`, context: (row) => `${row.classifiedSales} classified Approved Sales with both sales sources represented; closest eligible result to a 50/50 split.` }),
    buildTrophyCandidate({ trophy: "Lead Utilisation Champion — Salesperson", rows: callCoverageComplete ? eligiblePeople.filter((row) => row.sales >= MINIMUM_TROPHY_SALES) : [], compare: (a, b) => b.utilisationRate - a.utilisationRate || b.sent - a.sent, metric: (row) => `${oneDecimal(row.utilisationRate * 100)}%`, context: (row) => `Exact post-allocation call coverage from complete call data; ${row.sales} Approved Sales meets the ${MINIMUM_TROPHY_SALES}-sale gate.` }),
    buildTrophyCandidate({ trophy: "Follow-Up Champion — Salesperson", rows: callCoverageComplete ? eligiblePeople : [], compare: (a, b) => b.callWithin72HoursRate - a.callWithin72HoursRate || b.sent - a.sent, metric: (row) => `${oneDecimal(row.callWithin72HoursRate * 100)}% within 72 hours`, context: () => `Calculated only from complete call-date coverage.` }),
    buildTrophyCandidate({ trophy: "Consistency Champion — Salesperson", rows: consistentPeople, compare: (a, b) => Math.abs(a.salesChangeRate) - Math.abs(b.salesChangeRate) || b.sales - a.sales || a.displayName.localeCompare(b.displayName), metric: (row) => `${oneDecimal(Math.abs(row.salesChangeRate) * 100)}% week-to-week sales difference`, context: (row) => `${row.priorSales} prior and ${row.sales} current Approved Sales across contiguous equal-length periods; both meet the ${MINIMUM_TROPHY_SALES}-sale gate.` })
  ];
  const teamTrophies = [
    buildTrophyCandidate({ trophy: "Company-Supplied Sales Share Champion — Team", rows: shareEligibleTeams.filter((row) => row.allocatedLeadSales > 0), compare: (a, b) => b.allocatedLeadShare - a.allocatedLeadShare || b.allocatedLeadSales - a.allocatedLeadSales, metric: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}%`, context: (row) => `${row.allocatedLeadSales} of ${row.classifiedSales} classified team Approved Sales were to customers allocated to the seller before approval.` }),
    buildTrophyCandidate({ trophy: "Sales From Allocated Leads Champion — Team", rows: shareEligibleTeams.filter((row) => row.allocatedLeadSales > 0), compare: (a, b) => b.allocatedLeadSales - a.allocatedLeadSales || b.allocatedLeadShare - a.allocatedLeadShare, metric: (row) => `${row.allocatedLeadSales} Sales From Allocated Leads`, context: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}% of ${row.classifiedSales} classified team Approved Sales; manager personally contributed ${row.managerOwnSales}.` }),
    buildTrophyCandidate({ trophy: "Sales Volume Champion — Team", rows: eligibleTeams, compare: (a, b) => b.sales - a.sales || b.allocatedLeadSales - a.allocatedLeadSales, metric: (row) => `${row.sales} Approved Sales`, context: (row) => `${row.allocatedLeadSales} Sales From Allocated Leads, ${row.self} Self-Sourced${row.withheld ? ` and ${row.withheld} source-attribution withheld` : ""} across ${row.activeSalespeople} salespeople receiving leads.` }),
    buildTrophyCandidate({ trophy: "Sales Value Champion — Team", rows: eligibleTeams, compare: (a, b) => b.value - a.value || b.sales - a.sales, metric: (row) => `$${row.value.toLocaleString("en-AU", { minimumFractionDigits: 2 })}`, context: (row) => `${row.sales} Approved Sales: ${row.allocatedLeadSales} Sales From Allocated Leads, ${row.self} Self Sourced${row.withheld ? ` and ${row.withheld} source-attribution withheld` : ""}.` }),
    buildTrophyCandidate({ trophy: "Self-Sourcing Champion — Team", rows: shareEligibleTeams.filter((row) => row.self > 0), compare: (a, b) => b.self - a.self || b.selfContributors - a.selfContributors, metric: (row) => `${row.self} Self-Sourced Sales`, context: (row) => `${row.manager} team produced ${row.self} self-sourced approved sales across ${row.selfContributors} contributing salespeople (${oneDecimal(row.selfShare * 100)}% of classified team sales). This is sales, not a count of self-sourced leads.` }),
    buildTrophyCandidate({ trophy: "Versatility Champion — Team", rows: versatilityTeams, compare: (a, b) => Math.abs(a.allocatedLeadShare - 0.5) - Math.abs(b.allocatedLeadShare - 0.5) || b.classifiedSales - a.classifiedSales || a.displayName.localeCompare(b.displayName), metric: (row) => `${oneDecimal(row.allocatedLeadShare * 100)}% company supplied / ${oneDecimal(row.selfShare * 100)}% self sourced`, context: (row) => `${row.classifiedSales} classified team Approved Sales with both sources represented; closest eligible result to a 50/50 split.` }),
    buildTrophyCandidate({ trophy: "Lead Utilisation Champion — Team", rows: callCoverageComplete ? eligibleTeams.filter((row) => row.sales >= MINIMUM_TROPHY_SALES) : [], compare: (a, b) => b.utilisationRate - a.utilisationRate || b.sent - a.sent, metric: (row) => `${oneDecimal(row.utilisationRate * 100)}%`, context: (row) => `Aggregated exact post-allocation call coverage; ${row.sales} Approved Sales meets the ${MINIMUM_TROPHY_SALES}-sale gate.` }),
    buildTrophyCandidate({ trophy: "Follow-Up Champion — Team", rows: callCoverageComplete ? eligibleTeams : [], compare: (a, b) => b.callWithin72HoursRate - a.callWithin72HoursRate || b.sent - a.sent, metric: (row) => `${oneDecimal(row.callWithin72HoursRate * 100)}% within 72 hours`, context: () => `Aggregated call counts divided by aggregated unique leads; never an average of salesperson percentages.` }),
    buildTrophyCandidate({ trophy: "Consistency Champion — Team", rows: consistentTeams, compare: (a, b) => Math.abs(a.salesChangeRate) - Math.abs(b.salesChangeRate) || b.sales - a.sales || a.displayName.localeCompare(b.displayName), metric: (row) => `${oneDecimal(Math.abs(row.salesChangeRate) * 100)}% week-to-week sales difference`, context: (row) => `${row.priorSales} prior and ${row.sales} current team Approved Sales across contiguous equal-length periods; both meet the ${MINIMUM_TROPHY_SALES}-sale gate.` })
  ];

  return {
    benchmarks: {
      totalSent,
      totalSales,
      totalValue,
      totalAllocatedLeadSales,
      overallSalesPerLead,
      overallAllocatedLeadShare,
      overallValuePerLead,
      overallReallocationRate,
      overallUtilisationRate,
      overallFollowUpRate,
      averageSalespersonLeads,
      averageTeamLeads,
      substantialTeamLeadVolume,
      companyObservedPerRecipientAverage: safeDivide(totalSent, salespersonRows.length)
    },
    salespeople,
    teams,
    salespeopleResultsWorthyOfInvestigation: salespeopleResultsWorthyOfInvestigation.slice(0, 10),
    teamResultsWorthyOfInvestigation: teamResultsWorthyOfInvestigation.slice(0, 10),
    leadBurnersByResult,
    leadBurnersByUncalled,
    minimumUncalledReviewPairs: MINIMUM_UNCALLED_REVIEW_PAIRS,
    priorPeriodComparable,
    salespersonTrophies,
    teamTrophies
  };
}

function validSnapshot(snapshot) {
  return snapshot
    && snapshot.schemaVersion === "lead_result_dashboard_snapshot.v1"
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.period?.startDate || "")
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.period?.endDate || "")
    && Array.isArray(snapshot.salespeople);
}

function selectPreviousSnapshot(candidates = [], currentStartDate = "") {
  const valid = candidates.filter((candidate) => (
    validSnapshot(candidate?.snapshot)
    && candidate.snapshot.period.endDate < currentStartDate
  )).sort((a, b) => (
    b.snapshot.period.endDate.localeCompare(a.snapshot.period.endDate)
    || b.snapshot.period.startDate.localeCompare(a.snapshot.period.startDate)
  ));
  return valid[0] || null;
}

module.exports = {
  EQUAL_SHARE_BAND,
  CONCENTRATION_THRESHOLD,
  MATERIAL_RELATIVE_DIFFERENCE,
  MATERIAL_REALLOCATION_RATE,
  MATERIAL_SHARE_GAP,
  MINIMUM_MANAGER_SAMPLE,
  MINIMUM_APPROVED_SALES_SHARE_SAMPLE,
  MINIMUM_PERFORMANCE_SAMPLE,
  MINIMUM_TROPHY_SALES,
  MINIMUM_UNCALLED_REVIEW_PAIRS,
  SELF_SOURCE_DEPENDENCE_THRESHOLD,
  WEAK_RETURN_RATIO,
  buildLeadDistributionRows,
  buildManagerChartGuidance,
  buildManagerRows,
  buildPerformanceViews,
  isNamedTeam,
  periodsAreComparable,
  selectPreviousSnapshot,
  validSnapshot
};
