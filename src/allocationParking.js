"use strict";

const { reportContainsUntrustedLegacyData } = require("./untrustedLegacyFields");

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
  const parkedAllocationRelated = reportContainsParkedAllocationData(report);
  const untrustedLegacyRelated = reportContainsUntrustedLegacyData(report);
  const retiredSemanticRelated = report.type === "lead_utilization_report" || report.metadata?.generatedBy === "automatic_lead_utilization_report";
  const hiddenFromActiveReports = parkedAllocationRelated || untrustedLegacyRelated || retiredSemanticRelated;
  return {
    schemaVersion: "sales_dashboard_report_visibility.v1",
    status: retiredSemanticRelated
      ? "retired_unvalidated_semantic_report"
      : parkedAllocationRelated
      ? "parked_data_related"
      : untrustedLegacyRelated
        ? "untrusted_legacy_data_related"
        : "active",
    hiddenFromActiveReports,
    activeReportVisible: !hiddenFromActiveReports,
    parkedAllocationRelated,
    untrustedLegacyRelated,
    retiredSemanticRelated,
    reason: hiddenFromActiveReports
      ? retiredSemanticRelated
        ? "Report used an unvalidated semantic utilisation or performance judgement and is retained only as audit history."
        : parkedAllocationRelated
        ? "Report contains parked allocation or superseded stable-target terminology."
        : "Report relies on untrusted legacy disposition or note fields and is superseded."
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
