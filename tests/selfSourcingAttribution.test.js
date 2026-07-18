"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");

function csv(rows) {
  const columns = ["call_id", "call_date", "call_time", "OrderCount", "CustomerImportDate", "CustomerImportSource", "CustomerCreatedByType", "CustomerCreateDate", "Salesperson", "CallType", "call_direction", "CallTotalSeconds", "ring_time_seconds", "call_duration_seconds", "transcription_text"];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => row[column] || "").join(","))].join("\n");
}

test("self-sourcing attribution separates long-held records from confirmed old imports", () => {
  const analysis = analyzeCsvText(csv([
    { call_id: "import-old", call_date: "1/07/2026", call_time: "10:00:00", OrderCount: "0", CustomerImportDate: "1/01/2026", CustomerImportSource: "GoogleMaps" },
    { call_id: "manual-old", call_date: "1/07/2026", call_time: "10:01:00", OrderCount: "0", CustomerCreatedByType: "SP", CustomerCreateDate: "1/01/2026" },
    { call_id: "fresh", call_date: "1/07/2026", call_time: "10:02:00", OrderCount: "NULL", CustomerImportDate: "20/06/2026", CustomerImportSource: "GoogleMaps" },
    { call_id: "warm-old", call_date: "1/07/2026", call_time: "10:03:00", OrderCount: "1", CustomerImportDate: "1/01/2026", CustomerImportSource: "GoogleMaps" }
  ]));

  const audit = analysis.selfSourcingAttribution;
  const ninety = audit.thresholds.find((row) => row.thresholdDays === 90);
  assert.equal(audit.totals.newBusinessCalls, 3);
  assert.equal(ninety.longHeldRecordCalls, 2);
  assert.equal(ninety.longHeldRecordRate, 66.7);
  assert.equal(ninety.confirmedLegacyImportCalls, 1);
  assert.equal(ninety.salespersonCreatedLongHeldCalls, 1);
  assert.equal(audit.conclusion.longHeldRecordsAreMajority, true);
  assert.equal(audit.legacyImportSources[0].source, "GoogleMaps");
});
