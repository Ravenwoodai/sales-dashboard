"use strict";

const MAX_UNRESOLVED_SHARE_FOR_COMPARISON = 0.03;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildSourceAttributionCoverage({
  companySourcedSales = 0,
  selfSourcedSales = 0,
  attributionWithheldSales = 0,
  totalSales
} = {}) {
  const company = number(companySourcedSales);
  const self = number(selfSourcedSales);
  const withheld = number(attributionWithheldSales);
  const classifiedSales = company + self;
  const reconciledTotal = classifiedSales + withheld;
  const suppliedTotal = Number.isFinite(Number(totalSales)) ? number(totalSales) : reconciledTotal;
  const total = Math.max(suppliedTotal, reconciledTotal);
  const sourceCoverage = total ? clamp(classifiedSales / total) : 1;
  const unresolvedShare = total ? clamp(withheld / total) : 0;
  const allocatedLeadShare = classifiedSales ? clamp(company / classifiedSales) : 0;
  const allocatedLeadShareLowerBound = total ? clamp(company / total) : 0;
  const allocatedLeadShareUpperBound = total ? clamp((company + withheld) / total) : 0;
  const sourceAttributionComplete = withheld === 0;
  const sourceShareComparable = classifiedSales > 0
    && unresolvedShare < MAX_UNRESOLVED_SHARE_FOR_COMPARISON;
  const sourceAttributionStatus = sourceAttributionComplete
    ? "complete"
    : sourceShareComparable
      ? "high_coverage"
      : "provisional";

  return {
    classifiedSales,
    sourceCoverage,
    unresolvedShare,
    allocatedLeadShare,
    allocatedLeadShareLowerBound,
    allocatedLeadShareUpperBound,
    sourceAttributionComplete,
    sourceShareComparable,
    sourceAttributionStatus,
    sourceAttributionStatusLabel: sourceAttributionComplete
      ? "Complete"
      : sourceShareComparable
        ? "High coverage"
        : "Provisional"
  };
}

module.exports = {
  MAX_UNRESOLVED_SHARE_FOR_COMPARISON,
  buildSourceAttributionCoverage
};
