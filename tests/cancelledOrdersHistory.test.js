"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizedIndexRows,
  summarizeRows
} = require("../scripts/build-cancelled-orders-by-week-history");
const {
  cancelledOrdersByWeekSummary
} = require("../scripts/refresh-carma-data-layer");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeOutput(directory, fileName, content) {
  const filePath = path.join(directory, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return {
    fileName: fileName.replaceAll("\\", "/"),
    sha256: sha256(filePath)
  };
}

function createManifestFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cancelled-orders-history-")
  );
  const combinationIds = [
    "group-publication__all-salespeople",
    "group-publication__terminated-salespeople-only",
    "group-week__all-salespeople",
    "group-week__terminated-salespeople-only"
  ];
  const combinations = combinationIds.map((id, index) => ({
    id,
    status: "complete",
    ...writeOutput(directory, `combinations/${index}.xlsx`, `output-${index}`)
  }));
  const boundaryProbe = {
    status: "complete_empty",
    weekCount: 0,
    orderRowCount: 0,
    ...writeOutput(directory, "probes/boundary.xlsx", "empty")
  };
  const normalizedIndex = {
    rowCount: 2,
    ordersWithoutPublication: 1,
    ordersWithoutEdition: 1,
    ...writeOutput(directory, "index.csv", "order_id\n10000001\n10000002\n")
  };
  const manifest = {
    schemaVersion: "carma_cancelled_orders_by_week_history_manifest.v1",
    processVersion: "CANCELLED-ORDERS-BY-WEEK-HISTORY-1",
    reportName: "Cancelled Orders by Week",
    coverage: {
      oldestRequestedDate: "1900-01-01",
      oldestReturnedWeek: "2025-07-27",
      latestReturnedWeek: "2026-07-26",
      boundaryReason: "Explicit pre-boundary range was empty."
    },
    totals: {
      totalParsedNonEmptyRowsAcrossOverlappingViews: 20,
      allSalespeopleUniqueOrders: 2,
      terminatedSalespeopleUniqueOrders: 1
    },
    combinations,
    boundaryProbe,
    normalizedIndex,
    validation: {
      requestedCombinationCount: 4,
      completedCombinationCount: 4,
      completeCombinationMatrix: true,
      allSalespeopleGroupingTupleDifferences: {
        weekOnly: 0,
        publicationOnly: 0
      },
      terminatedSalespeopleGroupingTupleDifferences: {
        weekOnly: 0,
        publicationOnly: 0
      },
      terminatedOrdersMissingFromAllSalespeople: 0,
      duplicateOrderRowsAcrossIndividualOutputs: 0
    }
  };
  const manifestPath = path.join(directory, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath };
}

test("cancelled-order parser retains exact orders and genuine blank report groups", () => {
  const rows = [
    ["Cancelled Orders"],
    ["27/07/2025", "1100"],
    ["AiPol Police Journal", "1100"],
    ["11365673", "Just Crave It", "600"],
    ["September 2025"],
    ["11463965", "Cheapa Car Rental", "500"],
    ["03/08/2025", "400"],
    ["11547817", "SYNC Project Management", "400"]
  ];
  const summary = summarizeRows(rows);
  const index = normalizedIndexRows(rows);

  assert.equal(summary.weekCount, 2);
  assert.equal(summary.orderRowCount, 3);
  assert.equal(summary.uniqueOrderCount, 3);
  assert.equal(summary.reportLessGstValue, 1500);
  assert.deepEqual(index[0], {
    cancellationWeek: "2025-07-27",
    publicationName: "AiPol Police Journal",
    editionName: "",
    orderId: "11365673",
    customerName: "Just Crave It",
    reportLessGstValue: 600,
    sourceRow: 4
  });
  assert.equal(index[1].editionName, "September 2025");
  assert.equal(index[2].publicationName, "");
  assert.equal(index[2].editionName, "");
});

test("cancelled-order catalog summary validates the complete governed manifest", () => {
  const { manifestPath } = createManifestFixture();
  const summary = cancelledOrdersByWeekSummary(manifestPath);

  assert.equal(summary.available, true);
  assert.equal(summary.completedCombinationCount, 4);
  assert.equal(summary.allSalespeopleUniqueOrders, 2);
  assert.equal(summary.normalizedIndex.ordersWithoutPublication, 1);
  assert.equal(summary.coverageStart, "2025-07-27");
});

test("cancelled-order catalog summary fails closed when an output hash changes", () => {
  const { directory, manifestPath } = createManifestFixture();
  fs.appendFileSync(path.join(directory, "combinations", "0.xlsx"), "tampered");

  assert.throws(
    () => cancelledOrdersByWeekSummary(manifestPath),
    /hash does not match/i
  );
});

test("cancelled-order catalog summary is explicit when it is not configured", () => {
  assert.deepEqual(cancelledOrdersByWeekSummary(""), {
    authority: "primary_for_carma_cancelled_orders_by_week_report_history",
    configured: false,
    available: false
  });
});
