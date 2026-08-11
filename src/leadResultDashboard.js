"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  buildLeadDistributionRows,
  buildManagerChartGuidance,
  buildManagerRows,
  buildPerformanceViews,
  selectPreviousSnapshot,
  validSnapshot
} = require("./leadResultDashboardMetrics");
const { buildSourceAttributionCoverage } = require("./sourceAttributionCoverage");

const LEAD_RESULT_SCHEMA_VERSION = "lead_result_dashboard_web.v1";

function normalizePerson(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotAllocatedLeadShare(row = {}) {
  const storedShare = row.allocatedLeadShare;
  if (storedShare !== null && storedShare !== undefined && storedShare !== "" && Number.isFinite(Number(storedShare))) return Number(storedShare);
  const company = number(row.allocatedLeadSales ?? row.companySourcedSales);
  const self = number(row.selfSourcedSales);
  if (company + self) return company / (company + self);
  if (number(row.attributionWithheldSales)) return null;
  return number(row.approvedSales) ? company / number(row.approvedSales) : 0;
}

function snapshotSourceShareComparable(row = {}) {
  if (typeof row.sourceShareComparable === "boolean") return row.sourceShareComparable;
  return buildSourceAttributionCoverage({
    companySourcedSales: row.allocatedLeadSales ?? row.companySourcedSales,
    selfSourcedSales: row.selfSourcedSales,
    attributionWithheldSales: row.attributionWithheldSales,
    totalSales: row.approvedSales
  }).sourceShareComparable;
}

function leadResultCompleteness(report = {}) {
  const dataQuality = report.dataQuality || {};
  const totals = report.totals || {};
  const checks = {
    reportAvailable: report.available === true,
    periodValid: Boolean(report.period?.startDate && report.period?.endDate && report.period.endDate >= report.period.startDate),
    allocationPopulationPresent: number(totals.deduplicatedSentEvents) > 0,
    allocationPopulationReconciled: number(totals.rawAllocationRows)
      === number(totals.deduplicatedSentEvents) + number(totals.logicalDuplicateRows),
    allocationKeysComplete: number(dataQuality.missingAllocationKeys) === 0,
    allocationTimestampsValid: number(dataQuality.invalidAllocationTimestamps) === 0,
    approvedSalesCoverageReconciled: dataQuality.approvedSalesCoverageStatus === "verified"
      && report.comparison?.salesCoverageStatus === "verified",
    approvedSalesTimestampsValid: number(dataQuality.invalidSalesTimestamps) === 0,
    callEvidenceContractReconciled: number(dataQuality.observedCalledPairs)
      + number(dataQuality.noExactCallObservedPairs)
      === number(totals.uniqueCustomerRecipientPairs),
    callTimestampsValid: number(dataQuality.invalidCallTimestamps) === 0,
    exactCustomerJoinOnly: dataQuality.exactCustomerJoinOnly === true
  };
  const complete = Object.values(checks).every(Boolean);
  const unavailableReasons = [];
  if (!checks.reportAvailable) unavailableReasons.push(report.error || "Performance sources are unavailable.");
  if (!checks.periodValid) unavailableReasons.push("The selected reporting period is invalid.");
  if (!checks.allocationPopulationPresent) unavailableReasons.push("No governed Sent Lead allocation events are present in the selected period.");
  if (!checks.allocationPopulationReconciled) unavailableReasons.push("The allocation population does not reconcile after logical deduplication.");
  if (!checks.allocationKeysComplete) unavailableReasons.push("One or more allocation rows lack required exact keys.");
  if (!checks.allocationTimestampsValid) unavailableReasons.push("One or more allocation timestamps are invalid.");
  if (!checks.approvedSalesCoverageReconciled) unavailableReasons.push("Approved-sales coverage is not reconciled for the entire selected period.");
  if (!checks.approvedSalesTimestampsValid) unavailableReasons.push("One or more approved-sale timestamps are invalid.");
  if (!checks.callEvidenceContractReconciled) unavailableReasons.push("The positive-call and review-backlog populations do not reconcile to the selected allocation pairs.");
  if (!checks.callTimestampsValid) unavailableReasons.push("One or more supplied call timestamps are invalid.");
  if (!checks.exactCustomerJoinOnly) unavailableReasons.push("The exact-customer-only linkage boundary is not active.");
  return {
    schemaVersion: "lead_result_dashboard_completeness.v1",
    complete,
    status: complete ? "complete" : "incomplete",
    checks,
    unavailableReasons,
    callScoringStatus: dataQuality.callCoverageComplete
      ? "complete_scored"
      : "withheld_incomplete_call_coverage",
    callEvidenceThrough: dataQuality.callEvidenceThrough || "",
    unresolvedCallJoinKeys: number(dataQuality.missingCallJoinKeys),
    unlinkedSelfSourcingCallAttempts: number(dataQuality.unlinkedSelfSourcingCallAttempts),
    explanation: complete
      ? (dataQuality.callCoverageComplete
        ? "The allocation population, approved-sales coverage, exact-link boundary and company-supplied lead call population reconcile. Valid calls without a Customer ID are reported separately as self-sourcing attempts and do not block scoring; absent weekend rows are treated as no weekend activity."
        : "The allocation population, approved-sales coverage, exact-link boundary, and displayed call/backlog population reconcile for this period. Call-rate scoring remains withheld only for genuine call-ID, timestamp, identity or weekday-coverage failures.")
      : unavailableReasons.join(" ")
  };
}

function leadResultCompleteRanges(report = {}) {
  const availableStart = report.availablePeriod?.startDate || "";
  const availableEnd = report.availablePeriod?.endDate || "";
  if (!availableStart || !availableEnd) return [];
  const ranges = (report.history || []).filter((row) => row.coverageStatus === "reconciled").map((row) => {
    const match = String(row.period || "").match(/^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/);
    if (!match) return null;
    const startDate = match[1] < availableStart ? availableStart : match[1];
    const endDate = match[2] > availableEnd ? availableEnd : match[2];
    if (endDate < startDate) return null;
    return {
      startDate,
      endDate,
      label: `${startDate} to ${endDate}`,
      sourcePeriod: row.period,
      approvedSales: number(row.approvedSales),
      coverageStatus: row.coverageStatus
    };
  }).filter(Boolean);
  const completeness = leadResultCompleteness(report);
  if (completeness.complete && report.period?.startDate && report.period?.endDate) {
    ranges.push({
      startDate: report.period.startDate,
      endDate: report.period.endDate,
      label: `${report.period.startDate} to ${report.period.endDate}`,
      sourcePeriod: "Combined continuous governed coverage",
      approvedSales: number(report.totals?.approvedSalesInPeriod),
      coverageStatus: "reconciled"
    });
  }
  return Array.from(new Map(ranges.map((row) => [`${row.startDate}|${row.endDate}`, row])).values())
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate));
}

function buildLeadResultDashboardModel({
  config = {},
  carmaConfig = {},
  report = {},
  previousSnapshot = null,
  previousSnapshotSource = ""
} = {}) {
  const completeness = leadResultCompleteness(report);
  if (!completeness.complete) {
    const error = new Error(completeness.explanation || "The selected Lead Results period is incomplete.");
    error.code = "LEAD_RESULT_PERIOD_INCOMPLETE";
    error.completeness = completeness;
    throw error;
  }

  const observedSalespersonRows = (report.comparison?.rows || [])
    .filter((row) => number(row.sentAllocationEvents) > 0);
  const salespersonKeys = new Set(observedSalespersonRows.map((row) => normalizePerson(row.salesperson)));
  const approvedSalesEvidence = report._evidence?.approvedSales || [];
  const offRoster = approvedSalesEvidence.filter((row) => !salespersonKeys.has(normalizePerson(row.seller)));
  const companySales = approvedSalesEvidence.filter((row) => row.leadSourceClassification === "Company Sourced");
  const selfSales = approvedSalesEvidence.filter((row) => row.leadSourceClassification === "Self Sourced");
  const withheldSales = approvedSalesEvidence.filter((row) => row.leadSourceClassification === "Attribution Withheld");
  const sentLeadRows = report._sentLeadEvidence || [];
  const managerRows = buildManagerRows(observedSalespersonRows, {
    callCoverageComplete: report.dataQuality?.callCoverageComplete === true
  });

  const priorByPerson = new Map((previousSnapshot?.salespeople || [])
    .map((row) => [normalizePerson(row.salesperson), row]));
  const salespersonRows = observedSalespersonRows.map((row) => {
    const prior = priorByPerson.get(normalizePerson(row.salesperson));
    const priorApprovedSales = prior?.approvedSales ?? null;
    const priorAllocatedLeadSales = prior?.allocatedLeadSales ?? prior?.companySourcedSales ?? null;
    return {
      ...row,
      ...buildSourceAttributionCoverage({
        companySourcedSales: row.companySourcedSales,
        selfSourcedSales: row.selfSourcedSales,
        attributionWithheldSales: row.attributionWithheldSales,
        totalSales: row.approvedSales
      }),
      manager: row.manager,
      exactCallsObserved: number(row.customersCalledAfterAllocation),
      noExactCallObserved: Math.max(0, number(row.uniqueCustomers) - number(row.customersCalledAfterAllocation)),
      priorSent: prior?.sentAllocationEvents ?? null,
      priorApprovedSales,
      priorAllocatedLeadSales,
      priorRate: prior && snapshotSourceShareComparable(prior) ? snapshotAllocatedLeadShare(prior) : null
    };
  }).sort((a, b) => {
    if (a.comparisonEligible !== b.comparisonEligible) return a.comparisonEligible ? -1 : 1;
    return (number(b.approvedSalesPerSentEvent) - number(a.approvedSalesPerSentEvent))
      || a.salesperson.localeCompare(b.salesperson);
  });
  const leadDistributionRows = buildLeadDistributionRows(salespersonRows, managerRows);
  const chartGuidance = buildManagerChartGuidance(managerRows, leadDistributionRows, {
    callEvidenceThrough: report.dataQuality?.callEvidenceThrough,
    unresolvedCallJoinKeys: report.dataQuality?.missingCallJoinKeys,
    unlinkedSelfSourcingCallAttempts: report.dataQuality?.unlinkedSelfSourcingCallAttempts,
    callCoverageComplete: report.dataQuality?.callCoverageComplete === true
  });
  const performanceViews = buildPerformanceViews({
    salespersonRows,
    managerRows,
    previousSnapshot,
    currentPeriod: report.period,
    callCoverageComplete: report.dataQuality?.callCoverageComplete === true
  });
  const allocationDates = report.dataQuality?.allocationDates || [];
  const callDates = new Set(report.dataQuality?.callDates || []);
  const coverageRows = allocationDates.map((date) => [
    date,
    callDates.has(date) ? "Available in merged call sources" : "Missing from merged call sources"
  ]);
  const afterWindowCallDates = [...callDates]
    .filter((date) => date > report.period.endDate || date < report.period.startDate)
    .sort();
  const salesValue = approvedSalesEvidence.reduce((sum, row) => sum + number(row.approvedValue), 0);

  return {
    schemaVersion: LEAD_RESULT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    config,
    carmaConfig,
    report,
    completeness,
    offRoster,
    companySales,
    selfSales,
    withheldSales,
    sentLeadRows,
    managerRows,
    salespersonRows,
    leadDistributionRows,
    chartGuidance,
    performanceViews,
    previousSnapshot,
    previousSnapshotSource,
    coverageRows,
    afterWindowCallDates,
    salesValue
  };
}

async function collectSnapshotFiles(directory, targetName = "snapshot.json") {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSnapshotFiles(entryPath, targetName));
    else if (entry.name === targetName || (targetName === "*.json" && entry.name.endsWith(".json"))) files.push(entryPath);
  }
  return files;
}

async function readSnapshotCandidates(paths = []) {
  const candidates = [];
  for (const sourcePath of Array.from(new Set(paths.map((value) => path.resolve(value))))) {
    try {
      const snapshot = JSON.parse(await fsp.readFile(sourcePath, "utf8"));
      if (validSnapshot(snapshot)) candidates.push({ sourcePath, snapshot });
    } catch {
      // Ignore unrelated or incomplete historical output folders.
    }
  }
  return candidates;
}

async function resolvePreviousLeadResultSnapshot({
  rootPath,
  currentStartDate,
  explicitSnapshotPath = ""
} = {}) {
  if (explicitSnapshotPath) {
    const explicitPath = path.resolve(explicitSnapshotPath);
    const [candidate] = await readSnapshotCandidates([explicitPath]);
    if (!candidate) throw new Error("The supplied previous snapshot is not a valid Lead Result Dashboard snapshot.");
    if (candidate.snapshot.period.endDate >= currentStartDate) {
      throw new Error("The supplied previous snapshot must end before the current report period starts.");
    }
    return candidate;
  }
  const historyDir = path.join(rootPath, "data", "store", "lead-result-dashboard-snapshots");
  const [historyFiles, outputFiles] = await Promise.all([
    collectSnapshotFiles(historyDir, "*.json"),
    collectSnapshotFiles(path.join(rootPath, "outputs"), "snapshot.json")
  ]);
  return selectPreviousSnapshot(
    await readSnapshotCandidates([...historyFiles, ...outputFiles]),
    currentStartDate
  );
}

function makeLeadResultSnapshot(model = {}) {
  return {
    schemaVersion: "lead_result_dashboard_snapshot.v1",
    period: model.report.period,
    totals: {
      sentLeads: model.report.totals.deduplicatedSentEvents,
      approvedSales: model.report.totals.approvedSalesInPeriod,
      approvedSalesValue: model.salesValue,
      observedActiveSalespeople: model.salespersonRows.length
    },
    salespeople: model.salespersonRows.map((row) => ({
      salesperson: row.salesperson,
      manager: row.manager,
      sentAllocationEvents: row.sentAllocationEvents,
      approvedSales: row.approvedSales,
      approvedSalesPerLead: row.sentAllocationEvents ? row.approvedSales / row.sentAllocationEvents : 0,
      allocatedLeadSales: row.companySourcedSales,
      companySourcedSales: row.companySourcedSales,
      selfSourcedSales: row.selfSourcedSales,
      attributionWithheldSales: row.attributionWithheldSales || 0,
      classifiedSales: row.classifiedSales,
      sourceCoverage: row.sourceCoverage,
      unresolvedShare: row.unresolvedShare,
      sourceAttributionComplete: row.sourceAttributionComplete,
      sourceShareComparable: row.sourceShareComparable,
      sourceAttributionStatus: row.sourceAttributionStatus,
      allocatedLeadShare: row.allocatedLeadShare,
      allocatedLeadShareLowerBound: row.allocatedLeadShareLowerBound,
      allocatedLeadShareUpperBound: row.allocatedLeadShareUpperBound
    })),
    managers: model.performanceViews.teams.map((row) => ({
      manager: row.manager,
      sentAllocationEvents: row.sent,
      approvedSales: row.sales,
      approvedSalesPerLead: row.salesPerLead,
      allocatedLeadSales: row.allocatedLeadSales,
      allocatedLeadShare: row.allocatedLeadShare,
      approvedSalesValue: row.value,
      companySourcedSales: row.company,
      selfSourcedSales: row.self,
      attributionWithheldSales: row.withheld,
      sourceAttributionComplete: row.sourceAttributionComplete,
      classifiedSales: row.classifiedSales,
      sourceCoverage: row.sourceCoverage,
      unresolvedShare: row.unresolvedShare,
      sourceShareComparable: row.sourceShareComparable,
      sourceAttributionStatus: row.sourceAttributionStatus,
      allocatedLeadShareLowerBound: row.allocatedLeadShareLowerBound,
      allocatedLeadShareUpperBound: row.allocatedLeadShareUpperBound,
      observedActiveSalespeople: row.activeSalespeople
    }))
  };
}

function rankingResult(row = {}) {
  if (!row.sourceShareComparable && number(row.attributionWithheldSales)) return "Provisional - 3%+ unresolved attribution";
  if (row.priorRate === null || row.priorRate === undefined) return "Baseline - no compatible prior period";
  if (
    number(row.sentAllocationEvents) < 100
    || number(row.priorSent) < 100
    || number(row.approvedSales) < 5
    || number(row.priorApprovedSales) < 5
  ) return "Low sample - not compared";
  const change = number(row.allocatedLeadShare) - number(row.priorRate);
  if (change >= 0.05) return "Share increased";
  if (change <= -0.05) return "Share reduced";
  return "No material change";
}

function publicLeadResultDashboard(state = {}) {
  const model = state.model;
  const report = state.report || model?.report || {};
  const completeRanges = state.completeRanges || leadResultCompleteRanges(report);
  const base = {
    schemaVersion: "lead_result_dashboard_public.v1",
    available: state.available === true && Boolean(model),
    configured: state.configured === true,
    period: report.period || null,
    availablePeriod: report.availablePeriod || null,
    completeRanges,
    completeness: state.completeness || leadResultCompleteness(report)
  };
  if (!base.available) return base;
  const overallCoverage = buildSourceAttributionCoverage({
    companySourcedSales: model.companySales.length,
    selfSourcedSales: model.selfSales.length,
    attributionWithheldSales: model.withheldSales.length,
    totalSales: report.totals?.approvedSalesInPeriod
  });
  const totalWeeklyCalls = model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyCallCount), 0);
  const totalWeeklyOutboundCalls = model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyOutboundCallCount), 0);
  const durationObservedCalls = model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyDurationObservedCalls), 0);
  const totalWeeklyDurationSeconds = model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyTotalCallDurationSeconds), 0);
  const totalApprovedSales = number(report.totals?.approvedSalesInPeriod);
  return {
    ...base,
    generatedAt: model.generatedAt,
    previousPeriod: model.previousSnapshot?.period || null,
    totals: {
      sentLeads: number(report.totals?.deduplicatedSentEvents),
      uniqueLeadsSent: number(report.totals?.uniqueCustomerRecipientPairs),
      distinctCustomers: number(report.totals?.uniqueCustomers),
      approvedSales: number(report.totals?.approvedSalesInPeriod),
      approvedSalesValue: model.salesValue,
      allocatedLeadSales: model.companySales.length,
      selfSourcedSales: model.selfSales.length,
      attributionWithheldSales: model.withheldSales.length,
      ...overallCoverage,
      salespeopleReceivingLeads: model.salespersonRows.length,
      exactCallsObserved: number(report.dataQuality?.observedCalledPairs),
      noExactCallObserved: number(report.dataQuality?.noExactCallObservedPairs),
      unresolvedCallJoinKeys: number(report.dataQuality?.missingCallJoinKeys),
      unlinkedSelfSourcingCallAttempts: number(report.dataQuality?.unlinkedSelfSourcingCallAttempts),
      weeklyCallCount: totalWeeklyCalls,
      weeklyOutboundCallCount: totalWeeklyOutboundCalls,
      weeklyAverageCallDurationSeconds: durationObservedCalls ? totalWeeklyDurationSeconds / durationObservedCalls : null,
      weeklyTotalCallDurationSeconds: totalWeeklyDurationSeconds,
      weeklyShortCallCount: model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyShortCallCount), 0),
      weeklyLongCallCount: model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyLongCallCount), 0),
      weeklyZeroDurationCalls: model.salespersonRows.reduce((sum, row) => sum + number(row.weeklyZeroDurationCalls), 0),
      weeklyCallsPerApprovedSale: totalApprovedSales ? totalWeeklyCalls / totalApprovedSales : null
    },
    managerRows: model.managerRows,
    chartGuidance: model.chartGuidance,
    performanceViews: model.performanceViews,
    rankings: model.salespersonRows.map((row) => {
      const currentShare = number(row.allocatedLeadShare);
      return {
        salesperson: row.salesperson,
        manager: row.manager,
        sentLeads: number(row.sentAllocationEvents),
        uniqueLeads: number(row.uniqueCustomers),
        noExactCallObserved: number(row.noExactCallObserved),
        exactCallsObserved: number(row.exactCallsObserved),
        weeklyCallCount: number(row.weeklyCallCount),
        weeklyOutboundCallCount: number(row.weeklyOutboundCallCount),
        weeklyAverageCallDurationSeconds: row.weeklyAverageCallDurationSeconds,
        weeklyMedianCallDurationSeconds: row.weeklyMedianCallDurationSeconds,
        weeklyShortCallCount: number(row.weeklyShortCallCount),
        weeklyLongCallCount: number(row.weeklyLongCallCount),
        weeklyZeroDurationCalls: number(row.weeklyZeroDurationCalls),
        weeklyCallsPerApprovedSale: row.weeklyCallsPerApprovedSale,
        reallocations: number(row.reallocationEvents),
        approvedSales: number(row.approvedSales),
        approvedSalesValue: number(row.approvedSalesValue),
        allocatedLeadShare: currentShare,
        allocatedLeadShareLowerBound: row.allocatedLeadShareLowerBound,
        allocatedLeadShareUpperBound: row.allocatedLeadShareUpperBound,
        classifiedSales: row.classifiedSales,
        sourceCoverage: row.sourceCoverage,
        unresolvedShare: row.unresolvedShare,
        sourceShareComparable: row.sourceShareComparable,
        allocatedLeadSales: number(row.companySourcedSales),
        selfSourcedSales: number(row.selfSourcedSales),
        priorSentLeads: row.priorSent ?? null,
        priorApprovedSales: row.priorApprovedSales ?? null,
        priorAllocatedLeadShare: row.priorRate ?? null,
        change: !row.sourceShareComparable || row.priorRate === null || row.priorRate === undefined
          ? null
          : currentShare - number(row.priorRate),
        result: rankingResult(row),
        attributionWithheldSales: number(row.attributionWithheldSales),
        sourceAttributionStatus: row.sourceAttributionStatusLabel
      };
    }),
    dataQuality: {
      allocationDates: report.dataQuality?.allocationDates || [],
      callDates: report.dataQuality?.callDates || [],
      callCoverageComplete: report.dataQuality?.callCoverageComplete === true,
      callCoverageStatus: report.dataQuality?.callCoverageStatus || "",
      uncalledLabel: report.dataQuality?.callCoverageComplete === true
        ? "Leads Uncalled Within Reporting Window"
        : "Allocated Leads With No Recorded Call by Evidence Cutoff",
      callEvidenceThrough: report.dataQuality?.callEvidenceThrough || "",
      callDurationCoverageComplete: report.dataQuality?.callDurationCoverageComplete === true,
      invalidWeeklyCallDurations: number(report.dataQuality?.invalidWeeklyCallDurations),
      shortCallSeconds: number(report.dataQuality?.shortCallSeconds),
      longCallSeconds: number(report.dataQuality?.longCallSeconds),
      approvedSalesCoverageStatus: report.dataQuality?.approvedSalesCoverageStatus || "",
      missingCallJoinKeys: number(report.dataQuality?.missingCallJoinKeys),
      unlinkedSelfSourcingCallAttempts: number(report.dataQuality?.unlinkedSelfSourcingCallAttempts),
      invalidAllocationTimestamps: number(report.dataQuality?.invalidAllocationTimestamps),
      invalidCallTimestamps: number(report.dataQuality?.invalidCallTimestamps),
      invalidSalesTimestamps: number(report.dataQuality?.invalidSalesTimestamps),
      exactCustomerJoinOnly: report.dataQuality?.exactCustomerJoinOnly === true
    },
    definitions: {
      allocatedLeadShare: "Sales From Allocated Leads divided by classified Approved Sales for the same salesperson or team. Coverage and the possible range disclose unresolved attribution; Weekly Sent Leads remain separate workload context.",
      noExactCallObserved: report.dataQuality?.callCoverageComplete === true
        ? "Exact allocated customer-recipient pairs with no recorded post-allocation call inside the governed reporting window."
        : "An operational review backlog of exact customer-recipient pairs without an observed exact post-allocation call through the evidence cutoff. It is not proof that no call occurred.",
      salespeopleReceivingLeads: "Eligible recipients with at least one valid Sent Lead in the selected period. It does not identify an otherwise-active person who received zero leads.",
      weeklyCallActivity: "Deduplicated calls assigned by exact salesperson label inside the selected period. Short calls are more than zero and under 30 seconds; long calls are at least 5 minutes. Calls per sale is workload context, not conversion."
    }
  };
}

module.exports = {
  LEAD_RESULT_SCHEMA_VERSION,
  buildLeadResultDashboardModel,
  leadResultCompleteRanges,
  leadResultCompleteness,
  makeLeadResultSnapshot,
  publicLeadResultDashboard,
  resolvePreviousLeadResultSnapshot
};
