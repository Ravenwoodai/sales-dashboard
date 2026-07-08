"use strict";

const PARKED_ALLOCATION_REASON = "Campaign/allocation data has been parked by product decision.";

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function buildParkedAllocationDiagnostic(metadata = {}) {
  const configured = Boolean(
    metadata.configured ||
    metadata.sourceName ||
    metadata.sourceType ||
    metadata.sheetName ||
    metadata.error
  );
  const readStatus = cleanText(metadata.readStatus) || (configured ? "parked" : "not_configured");

  return {
    schemaVersion: "allocation_parking.v1",
    status: "parked",
    excludedFromActiveAnalytics: true,
    reason: PARKED_ALLOCATION_REASON,
    activeMetricsAvailable: false,
    configured,
    sourceName: cleanText(metadata.sourceName),
    sourceType: cleanText(metadata.sourceType),
    sheetName: cleanText(metadata.sheetName),
    readStatus,
    error: cleanText(metadata.error)
  };
}

function parkedAllocationFromLegacyCoverage(allocationCoverage = null) {
  if (!allocationCoverage) return null;
  return buildParkedAllocationDiagnostic({
    configured: Boolean(allocationCoverage.configured || allocationCoverage.loaded),
    sourceName: allocationCoverage.sourceName || "",
    sourceType: allocationCoverage.sourceType || "",
    sheetName: allocationCoverage.sheetName || "",
    readStatus: allocationCoverage.loaded ? "legacy_coverage_parked" : "legacy_coverage_not_loaded",
    error: allocationCoverage.error || ""
  });
}

const PARKED_ALLOCATION_REPORT_PATTERNS = [
  /\ballocation\b/i,
  /lead allocation coverage/i,
  /allocation coverage/i,
  /allocation reconciliation/i,
  /allocation-observed/i,
  /observed vs actioned/i,
  /qty actioned/i,
  /leads allocated/i,
  /leads actioned/i,
  /leads remaining/i,
  /stable lead-days/i,
  /stable lead day/i,
  /\blead-days?\b/i,
  /\bstable targets?\b/i,
  /allocated-versus-called/i,
  /allocated\s+versus\s+called/i,
  /campaign allocation/i
];

function textHasParkedAllocationTerms(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return PARKED_ALLOCATION_REPORT_PATTERNS.some((pattern) => pattern.test(text));
}

function reportContainsParkedAllocationData(report = {}) {
  if (report.containsParkedAllocationData || report.parkedDataRelated || report.metadata?.parkedDataRelated) {
    return true;
  }
  return textHasParkedAllocationTerms([
    report.title,
    report.summary,
    report.content,
    JSON.stringify(report.metadata || {})
  ].filter(Boolean).join("\n"));
}

function classifyReportVisibility(report = {}) {
  const hiddenFromActiveReports = reportContainsParkedAllocationData(report);
  return {
    schemaVersion: "sales_dashboard_report_visibility.v1",
    status: hiddenFromActiveReports ? "parked_data_related" : "active",
    hiddenFromActiveReports,
    activeReportVisible: !hiddenFromActiveReports,
    reason: hiddenFromActiveReports
      ? "Report contains parked allocation or superseded stable-target terminology."
      : ""
  };
}

function activeReportsOnly(reports = []) {
  return (reports || []).filter((report) => !classifyReportVisibility(report).hiddenFromActiveReports);
}

module.exports = {
  PARKED_ALLOCATION_REASON,
  activeReportsOnly,
  buildParkedAllocationDiagnostic,
  classifyReportVisibility,
  parkedAllocationFromLegacyCoverage,
  reportContainsParkedAllocationData,
  textHasParkedAllocationTerms
};
