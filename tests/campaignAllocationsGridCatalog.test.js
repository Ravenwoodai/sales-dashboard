"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  campaignAllocationsGridSummary
} = require("../scripts/refresh-carma-data-layer");

function writeOutput(directory, fileName, content) {
  const filePath = path.join(directory, fileName);
  fs.writeFileSync(filePath, content);
  return {
    fileName,
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}

function createFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "campaign-allocations-grid-")
  );
  const extract = {
    metadata: { report: "Campaign Allocations" },
    totals: { rows: 1, quantity: 10, actioned: 4, remaining: 6 },
    audit: [{
      date: "2026-01-01",
      scope_pass: true,
      missing_indexes: 0,
      directional_mismatches: 0,
      balance_errors: 0
    }],
    records: [{ quantity: 10, actioned: 4, remaining: 6 }]
  };
  const outputs = {
    json: writeOutput(directory, "extract.json", JSON.stringify(extract)),
    csv: writeOutput(directory, "extract.csv", "quantity,actioned,remaining\n10,4,6\n"),
    xlsx: writeOutput(directory, "extract.xlsx", "fixture workbook")
  };
  const manifest = {
    schemaVersion: "carma_campaign_allocations_grid_manifest.v1",
    reportName: "Campaign Allocations",
    coverage: {
      requestedStart: "2026-01-01",
      requestedEnd: "2026-01-01",
      firstActualAllocationDate: "2026-01-01",
      continuousDailyAuditDays: 1
    },
    totals: {
      rows: 1,
      quantity: 10,
      actioned: 4,
      remaining: 6,
      actionedRate: 0.4
    },
    validation: {
      readOnly: true,
      dailyExtraction: true,
      quantityBalanceReconciled: true,
      qaFailures: 0,
      repeatedVirtualGridRowsDiscarded: 2,
      customerLevelIdentifiersAvailable: false
    },
    outputs,
    permittedUses: ["grid facts"],
    prohibitedInferences: ["weekly leads sent"]
  };
  const manifestPath = path.join(directory, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath };
}

test("campaign allocations grid catalog entry verifies hashes, coverage and totals", () => {
  const fixture = createFixture();
  try {
    const summary = campaignAllocationsGridSummary(fixture.manifestPath);
    assert.equal(summary.available, true);
    assert.equal(summary.coverageStart, "2026-01-01");
    assert.equal(summary.rowCount, 1);
    assert.equal(summary.quantity, 10);
    assert.equal(summary.actioned, 4);
    assert.equal(summary.remaining, 6);
    assert.equal(summary.customerLevelIdentifiersAvailable, false);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("campaign allocations grid catalog entry rejects changed source data", () => {
  const fixture = createFixture();
  try {
    fs.appendFileSync(path.join(fixture.directory, "extract.csv"), "changed");
    assert.throws(
      () => campaignAllocationsGridSummary(fixture.manifestPath),
      /hash does not match/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
