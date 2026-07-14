"use strict";

const UNTRUSTED_LEGACY_FIELDS = Object.freeze([
  "NoSaleType",
  "Baz_DetailedNotes"
]);

const UNTRUSTED_LEGACY_POLICY = Object.freeze({
  schemaVersion: "sales_dashboard_untrusted_legacy_fields.v1",
  status: "excluded",
  excludedFromActiveAnalytics: true,
  excludedFromAiContext: true,
  excludedFromNormalUi: true,
  rawSourcePreserved: true,
  reason: "Legacy imported fields have unverified provenance or accuracy and are preserved for audit only."
});

const UNTRUSTED_LEGACY_REPORT_PATTERNS = [
  /\bNoSaleType\b/i,
  /Baz_DetailedNotes/i,
  /\bBaz notes?\b/i,
  /\braw imported disposition\b/i,
  /\bimported[_\s-]+(?:outcome|disposition)[_\s-]+mismatch(?:es)?\b/i,
  /\boutcome[_\s-]+mismatch(?:es)?\b/i
];

function normalizeFieldName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isUntrustedLegacyField(field) {
  const normalized = normalizeFieldName(field);
  return normalized === "nosaletype" || normalized === "bazdetailednotes";
}

function stripUntrustedLegacyFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([field]) => !isUntrustedLegacyField(field))
  );
}

function textHasUntrustedLegacyTerms(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return UNTRUSTED_LEGACY_REPORT_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeUntrustedLegacyDataForPublic(value) {
  if (Array.isArray(value)) return value.map(sanitizeUntrustedLegacyDataForPublic);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const normalized = normalizeFieldName(key);
      if (isUntrustedLegacyField(key) || [
        "importednosale",
        "importednosaleraw",
        "outcomemismatch",
        "nosalecoverage",
        "baznotescoverage"
      ].includes(normalized)) return [];
      return [[key, sanitizeUntrustedLegacyDataForPublic(item)]];
    }));
  }
  if (typeof value === "string" && textHasUntrustedLegacyTerms(value)) {
    return "[Excluded legacy-data reference]";
  }
  return value;
}

function reportContainsUntrustedLegacyData(report = {}) {
  if (report.containsUntrustedLegacyData || report.metadata?.containsUntrustedLegacyData) return true;
  return textHasUntrustedLegacyTerms([
    report.title,
    report.summary,
    report.content,
    JSON.stringify(report.metadata || {})
  ].filter(Boolean).join("\n"));
}

function alertContainsUntrustedLegacyData(alert = {}) {
  return textHasUntrustedLegacyTerms([
    alert.category,
    alert.title,
    alert.message,
    alert.evidenceSummary,
    alert.ruleId
  ].filter(Boolean).join("\n"));
}

function managerReviewContainsUntrustedLegacyData(review = {}) {
  const corrections = [...(review.corrections || []), ...(review.suggestedCorrections || [])];
  const hasHistoricalRawPrefill = corrections.some((correction) => String(correction?.rawValue ?? correction?.raw_value ?? "").trim());
  return Boolean(review.containsUntrustedLegacyData) || hasHistoricalRawPrefill || textHasUntrustedLegacyTerms(review);
}

function sanitizeImportSummary(record = {}) {
  const safeRecord = sanitizeUntrustedLegacyDataForPublic(record);
  const totals = { ...(safeRecord.totals || {}) };
  const rates = { ...(safeRecord.rates || {}) };
  delete totals.outcomeMismatches;
  delete totals.noSaleCoverage;
  delete totals.bazNotesCoverage;
  delete rates.outcomeMismatch;
  delete rates.noSaleCoverage;
  delete rates.bazNotesCoverage;
  return {
    ...safeRecord,
    totals,
    rates,
    untrustedLegacyFields: undefined,
    legacyUntrustedDataExcluded: true
  };
}

function sanitizeManagerReviewForPublic(review = {}) {
  const sanitizeCorrection = (correction = {}) => {
    const { rawValue: _rawValue, raw_value: _rawValueSnake, ...safe } = correction;
    return safe;
  };
  return sanitizeUntrustedLegacyDataForPublic({
    ...review,
    corrections: (review.corrections || []).map(sanitizeCorrection),
    suggestedCorrections: (review.suggestedCorrections || []).map(sanitizeCorrection)
  });
}

module.exports = {
  UNTRUSTED_LEGACY_FIELDS,
  UNTRUSTED_LEGACY_POLICY,
  alertContainsUntrustedLegacyData,
  isUntrustedLegacyField,
  managerReviewContainsUntrustedLegacyData,
  reportContainsUntrustedLegacyData,
  sanitizeImportSummary,
  sanitizeManagerReviewForPublic,
  sanitizeUntrustedLegacyDataForPublic,
  stripUntrustedLegacyFields,
  textHasUntrustedLegacyTerms
};
