"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  alertContainsUntrustedLegacyData,
  reportContainsUntrustedLegacyData,
  sanitizeImportSummary,
  sanitizeManagerReviewForPublic,
  sanitizeUntrustedLegacyDataForPublic,
  stripUntrustedLegacyFields
} = require("../src/untrustedLegacyFields");
const { classifyReportVisibility } = require("../src/allocationParking");

test("untrusted legacy fields are stripped without changing preserved source objects", () => {
  const source = {
    call_id: "call-1",
    NoSaleType: "LEGACY_DISPOSITION_SENTINEL",
    Baz_DetailedNotes: "LEGACY_NOTE_SENTINEL"
  };
  const safe = stripUntrustedLegacyFields(source);

  assert.deepEqual(safe, { call_id: "call-1" });
  assert.equal(source.NoSaleType, "LEGACY_DISPOSITION_SENTINEL");
  assert.equal(source.Baz_DetailedNotes, "LEGACY_NOTE_SENTINEL");
});

test("legacy-derived historical reports and alerts are hidden while neutral call reports remain active", () => {
  for (const content of [
    "NoSaleType coverage",
    "Baz_DetailedNotes findings",
    "Raw imported disposition mismatch",
    "Outcome mismatches by salesperson"
  ]) {
    assert.equal(reportContainsUntrustedLegacyData({ title: content }), true);
    assert.equal(classifyReportVisibility({ title: content }).activeReportVisible, false);
  }
  assert.equal(alertContainsUntrustedLegacyData({ category: "Imported outcome mismatch" }), true);
  assert.equal(reportContainsUntrustedLegacyData({ title: "Transcript follow-up review", markdown: "Call-data evidence only." }), false);
  assert.equal(classifyReportVisibility({ title: "Transcript follow-up review", markdown: "Call-data evidence only." }).activeReportVisible, true);
});

test("normal import and manager-review summaries remove legacy-derived values", () => {
  const summary = sanitizeImportSummary({
    totals: { uniqueCalls: 5, outcomeMismatches: 3, noSaleCoverage: 4, bazNotesCoverage: 2 },
    rates: { transcriptCoverage: 80, outcomeMismatch: 60, noSaleCoverage: 80, bazNotesCoverage: 40 },
    untrustedLegacyFields: { fields: ["NoSaleType", "Baz_DetailedNotes"] },
    intelligenceGovernance: { provenance: { rawImportedFields: ["NoSaleType", "Baz_DetailedNotes"] } }
  });
  assert.deepEqual(summary.totals, { uniqueCalls: 5 });
  assert.deepEqual(summary.rates, { transcriptCoverage: 80 });
  assert.equal(summary.untrustedLegacyFields, undefined);
  assert.equal(summary.legacyUntrustedDataExcluded, true);
  assert.doesNotMatch(JSON.stringify(summary), /NoSaleType|Baz_DetailedNotes/);

  const review = sanitizeManagerReviewForPublic({
    corrections: [{ fieldName: "local_outcome_category", rawValue: "LEGACY_DISPOSITION_SENTINEL", managerCorrectedValue: "callback_requested" }]
  });
  assert.equal(review.corrections[0].rawValue, undefined);
  assert.equal(review.corrections[0].managerCorrectedValue, "callback_requested");

  const run = sanitizeUntrustedLegacyDataForPublic({
    id: "historical-run",
    guardrails: ["NoSaleType and Baz_DetailedNotes were previously supplied as context."],
    taskInput: { imported_no_sale: "LEGACY_DISPOSITION_SENTINEL", transcript: "Customer: call tomorrow." }
  });
  assert.equal(run.taskInput.imported_no_sale, undefined);
  assert.equal(run.taskInput.transcript, "Customer: call tomorrow.");
  assert.doesNotMatch(JSON.stringify(run), /NoSaleType|Baz_DetailedNotes|LEGACY_DISPOSITION_SENTINEL/);
});
