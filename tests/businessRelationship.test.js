"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
  classifyBusinessRelationship,
  loadBusinessRelationshipEvidence,
  resolveBusinessRelationshipEvidencePath
} = require("../src/businessRelationship");
const { analyzeCsvText } = require("../src/analysis");
const { createServer } = require("../src/main");

function evidenceDocument() {
  return {
    schemaVersion: BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
    generatedAt: "2026-07-30T00:00:00.000Z",
    joinRule: "exact customer_id only",
    customers: {
      "customer-exact": {
        detailedHistoryComplete: true,
        detailedInvoiceBoundaries: [{
          invoiceNumber: "11890001",
          orderNumber: "11890001",
          invoiceDate: "2026-07-22",
          issuedAt: "2026-07-22T11:30:00",
          source: "carma_invoicing_summary"
        }],
        observedOrderCreatedAt: ["2026-07-22T11:30:00"],
        warmAllocationDates: []
      },
      "customer-event": {
        detailedHistoryComplete: false,
        detailedInvoiceBoundaries: [],
        observedOrderCreatedAt: ["2026-07-20T09:00:00"],
        warmAllocationDates: []
      },
      "customer-allocation": {
        detailedHistoryComplete: false,
        detailedInvoiceBoundaries: [],
        observedOrderCreatedAt: [],
        warmAllocationDates: ["2026-07-19"]
      }
    }
  };
}

function loadedEvidence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "business-relationship-"));
  const evidencePath = path.join(directory, "evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidenceDocument()));
  return { directory, evidencePath, evidence: loadBusinessRelationshipEvidence({ evidencePath }) };
}

test("exact invoice timing overrides retrospective OrderCount leakage", () => {
  const { evidence } = loadedEvidence();
  const before = classifyBusinessRelationship({
    customer_id: "customer-exact",
    call_date: "22/07/2026",
    call_time: "10:00:00",
    OrderCount: "4"
  }, { evidence });
  assert.equal(before.segment, "new");
  assert.equal(before.rule, "before_first_exact_invoice");
  assert.equal(before.evidenceTier, "exact");
  assert.equal(before.fallbackUsed, false);

  const after = classifyBusinessRelationship({
    customer_id: "customer-exact",
    call_date: "22/07/2026",
    call_time: "12:00:00",
    OrderCount: "0"
  }, { evidence });
  assert.equal(after.segment, "warm");
  assert.equal(after.rule, "after_first_exact_invoice");
  assert.equal(after.invoiceNumber, "11890001");

  const atBoundary = classifyBusinessRelationship({
    customer_id: "customer-exact",
    call_date: "22/07/2026",
    call_time: "11:30:00",
    OrderCount: "4"
  }, { evidence });
  assert.equal(atBoundary.segment, "new");
  assert.equal(atBoundary.rule, "before_first_exact_invoice");
});

test("retained order events and pre-call Warm allocations are used before the binary fallback", () => {
  const { evidence } = loadedEvidence();
  const event = classifyBusinessRelationship({
    customer_id: "customer-event",
    call_date: "21/07/2026",
    call_time: "09:00:00",
    OrderCount: "0"
  }, { evidence });
  assert.equal(event.segment, "warm");
  assert.equal(event.rule, "prior_order_created_event");
  assert.equal(event.evidenceTier, "exact");

  const allocation = classifyBusinessRelationship({
    customer_id: "customer-allocation",
    call_date: "20/07/2026",
    call_time: "09:00:00",
    OrderCount: "0"
  }, { evidence });
  assert.equal(allocation.segment, "warm");
  assert.equal(allocation.rule, "prior_explicit_warm_allocation");
  assert.equal(allocation.evidenceTier, "supporting");
});

test("every call is binary and fallback use remains explicit", () => {
  const { evidence } = loadedEvidence();
  const warm = classifyBusinessRelationship({
    customer_id: "not-indexed",
    call_date: "20/07/2026",
    call_time: "09:00:00",
    OrderCount: "1"
  }, { evidence });
  assert.equal(warm.segment, "warm");
  assert.equal(warm.rule, "order_count_positive_fallback");
  assert.equal(warm.evidenceTier, "fallback");

  const cold = classifyBusinessRelationship({
    customer_id: "",
    FoundCustomerID: "customer-exact",
    call_date: "20/07/2026",
    call_time: "09:00:00",
    OrderCount: "0"
  }, { evidence });
  assert.equal(cold.segment, "new");
  assert.equal(cold.rule, "missing_customer_id_cold_fallback");
  assert.equal(cold.customerId, "");
  assert.notEqual(cold.segment, "unknown");
});

test("analysis exposes the controlling relationship evidence on call rows", () => {
  const { evidence } = loadedEvidence();
  const csv = [
    "call_id,call_date,call_time,Salesperson,CallType,call_direction,CallTotalSeconds,ring_time_seconds,call_duration_seconds,transcription_text,CustomerImportSource,customer_id,OrderCount",
    "call-1,22/07/2026,10:00:00,Example Seller,Click to dial,out,60,5,55,,GoogleMaps,customer-exact,4",
    ""
  ].join("\n");
  const analysis = analyzeCsvText(csv, { businessRelationshipEvidence: evidence });
  assert.equal(analysis.totals.newBusinessCalls, 1);
  assert.equal(analysis.totals.warmBusinessCalls, 0);
  assert.equal(analysis.businessRelationship.exactCalls, 1);
  assert.equal(analysis.businessRelationship.unknownCalls, 0);
  assert.equal(analysis.drilldownRows[0].businessRelationshipRule, "before_first_exact_invoice");
  assert.equal(analysis.drilldownRows[0].businessRelationshipInvoiceNumber, "11890001");
});

test("business relationship evidence configuration resolves CLI, environment, then local config", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "business-relationship-config-"));
  const configPath = path.join(directory, "carma-evidence.json");
  fs.writeFileSync(configPath, JSON.stringify({
    businessRelationshipEvidencePath: path.join(directory, "configured.json")
  }));
  assert.equal(
    resolveBusinessRelationshipEvidencePath(["--business-relationship-evidence", "cli.json"], {}, { carmaEvidenceConfigPath: configPath }),
    path.resolve("cli.json")
  );
  assert.equal(
    resolveBusinessRelationshipEvidencePath([], { SALES_DASHBOARD_BUSINESS_RELATIONSHIP_EVIDENCE_PATH: "env.json" }, { carmaEvidenceConfigPath: configPath }),
    path.resolve("env.json")
  );
  assert.equal(
    resolveBusinessRelationshipEvidencePath([], {}, { carmaEvidenceConfigPath: configPath }),
    path.join(directory, "configured.json")
  );
});

test("business relationship evidence rejects phone or other unsupported matching fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "business-relationship-phone-"));
  const evidencePath = path.join(directory, "evidence.json");
  const document = evidenceDocument();
  document.customers["customer-exact"].phone = "not permitted";
  fs.writeFileSync(evidencePath, JSON.stringify(document));
  const evidence = loadBusinessRelationshipEvidence({ evidencePath });
  assert.equal(evidence.available, false);
  assert.equal(evidence.code, "BUSINESS_RELATIONSHIP_EVIDENCE_INVALID");
  assert.match(evidence.error, /unsupported customer fields/i);
});

test("dashboard health and call proof expose binary relationship evidence", async () => {
  const { directory, evidencePath } = loadedEvidence();
  const csvPath = path.join(directory, "calls.csv");
  const storePath = path.join(directory, "state.json");
  fs.writeFileSync(csvPath, [
    "call_id,call_date,call_time,Salesperson,CallType,call_direction,CallTotalSeconds,ring_time_seconds,call_duration_seconds,transcription_text,CustomerImportSource,customer_id,OrderCount",
    "call-1,22/07/2026,10:00:00,Example Seller,Click to dial,out,60,5,55,,GoogleMaps,customer-exact,4",
    ""
  ].join("\n"));
  const server = createServer({
    csvPath,
    storePath,
    businessRelationshipEvidencePath: evidencePath,
    carmaEvidenceConfigPath: path.join(directory, "no-carma-config.json")
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.business_relationship_evidence_available, true);
    assert.equal(health.business_relationship_exact_calls, 1);
    assert.equal(health.business_relationship_unknown_calls, 0);
    const html = await fetch(`${baseUrl}/calls/call-1`).then((response) => response.text());
    assert.match(html, /Business relationship/);
    assert.match(html, /before_first_exact_invoice/);
    assert.match(html, /11890001/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
