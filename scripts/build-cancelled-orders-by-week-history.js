"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readXlsxWorksheetRows } = require("../src/xlsxReader");

const SCHEMA_VERSION = "carma_cancelled_orders_by_week_history_manifest.v1";
const PROCESS_VERSION = "CANCELLED-ORDERS-BY-WEEK-HISTORY-1";
const REPORT_NAME = "Cancelled Orders by Week";
const DEFAULT_SOURCE_DIRECTORY =
  "C:\\Users\\User\\Desktop\\Carma Reports\\output\\cancelled-orders-by-week-history-2026-07-29";

const PUBLICATIONS = [
  "AiPol Desk Diary",
  "AiPol Police Journal",
  "aipol.org",
  "Ambulance Active",
  "ambulanceactive.com.au",
  "National Emergency Response",
  "NHW Australasia",
  "NSESVA Yearbook",
  "NSW Streetsmart Handbook",
  "NT Streetsmart Handbook",
  "NZ Streetsmart Handbook",
  "Phoenix Journal",
  "QLD Streetsmart Handbook",
  "SA Streetsmart Handbook",
  "Soldier On",
  "TAS Streetsmart Handbook",
  "The Volunteer Magazine",
  "True Blue",
  "VIC Streetsmart Handbook",
  "WA Streetsmart Handbook",
  "Womens Police Journal"
];

const EDITIONS = [
  "2025 Yearbook",
  "2026 Desk Diary",
  "2026 Yearbook",
  "2027 Desk Diary",
  "April 2026",
  "August 2025",
  "August 2026",
  "Autumn 2026",
  "December 2025",
  "February 2026",
  "Jul 26-Dec 26",
  "June 2025",
  "June 2026",
  "Mar 26 - Mar 27",
  "March 2026",
  "November 2025",
  "October 2025",
  "October 2026",
  "September 2025",
  "September 2026",
  "Spring 2025",
  "Spring 2026",
  "Summer 2025",
  "Summer 2026",
  "Winter 2025",
  "Winter 2026"
];

const COMBINATIONS = [
  {
    id: "group-week__all-salespeople",
    groupByWeek: true,
    showInactiveOnly: false,
    fileName:
      "combinations/cancelled-orders-by-week-1900-01-01-to-2026-07-29-group-week-all-salespeople.xlsx"
  },
  {
    id: "group-week__terminated-salespeople-only",
    groupByWeek: true,
    showInactiveOnly: true,
    fileName:
      "combinations/cancelled-orders-by-week-1900-01-01-to-2026-07-29-group-week-terminated-salespeople-only.xlsx"
  },
  {
    id: "group-publication__all-salespeople",
    groupByWeek: false,
    showInactiveOnly: false,
    fileName:
      "combinations/cancelled-orders-by-week-1900-01-01-to-2026-07-29-group-publication-all-salespeople.xlsx"
  },
  {
    id: "group-publication__terminated-salespeople-only",
    groupByWeek: false,
    showInactiveOnly: true,
    fileName:
      "combinations/cancelled-orders-by-week-1900-01-01-to-2026-07-29-group-publication-terminated-salespeople-only.xlsx"
  }
];

const BOUNDARY_PROBE_FILE =
  "probes/cancelled-orders-by-week-1900-01-01-to-2025-07-26-empty-boundary-probe.xlsx";
const NORMALIZED_INDEX_FILE = "cancelled-orders-by-week-order-index.csv";
const MANIFEST_FILE = "manifest.json";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] =
      argv[index + 1] && !argv[index + 1].startsWith("--")
        ? argv[++index]
        : true;
  }
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileMeta(filePath, relativeTo) {
  const stat = fs.statSync(filePath);
  return {
    fileName: path.relative(relativeTo, filePath).replaceAll("\\", "/"),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256(filePath)
  };
}

function cleanCell(value) {
  return String(value ?? "").trim();
}

function isOrderId(value) {
  return /^\d{8}$/.test(cleanCell(value));
}

function isWeek(value) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(cleanCell(value));
}

function isoDate(value) {
  const match = cleanCell(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function summarizeRows(rows) {
  const weekRows = rows
    .map((row, index) => ({
      sourceRow: index + 1,
      week: cleanCell(row[0]),
      reportValue: Number(row[1] || 0)
    }))
    .filter((row) => isWeek(row.week));
  const orderRows = rows
    .map((row, index) => ({
      sourceRow: index + 1,
      orderId: cleanCell(row[0]),
      customerName: cleanCell(row[1]),
      reportLessGstValue: Number(row[2] || 0)
    }))
    .filter((row) => isOrderId(row.orderId));
  const orderIds = orderRows.map((row) => row.orderId);
  const orderTuples = orderRows.map((row) =>
    JSON.stringify([row.orderId, row.customerName, row.reportLessGstValue])
  );

  return {
    parsedNonEmptyRowCount: rows.length,
    weekCount: weekRows.length,
    oldestReturnedWeek: weekRows[0]?.week || "",
    latestReturnedWeek: weekRows.at(-1)?.week || "",
    orderRowCount: orderRows.length,
    uniqueOrderCount: new Set(orderIds).size,
    duplicateOrderRowCount: orderRows.length - new Set(orderIds).size,
    reportLessGstValue: Math.round(
      orderRows.reduce((sum, row) => sum + row.reportLessGstValue, 0) * 100
    ) / 100,
    orderRows,
    orderTupleSet: new Set(orderTuples)
  };
}

function setDifferenceCount(left, right) {
  return [...left].filter((value) => !right.has(value)).length;
}

function normalizedIndexRows(rows) {
  const publicationSet = new Set(PUBLICATIONS);
  const editionSet = new Set(EDITIONS);
  let currentWeek = "";
  let currentPublication = "";
  let currentEdition = "";
  const result = [];

  rows.forEach((row, index) => {
    const first = cleanCell(row[0]);
    if (isWeek(first)) {
      currentWeek = first;
      currentPublication = "";
      currentEdition = "";
      return;
    }
    if (publicationSet.has(first)) {
      currentPublication = first;
      currentEdition = "";
      return;
    }
    if (editionSet.has(first)) {
      currentEdition = first;
      return;
    }
    if (!isOrderId(first)) return;
    result.push({
      cancellationWeek: isoDate(currentWeek),
      publicationName: currentPublication,
      editionName: currentEdition,
      orderId: first,
      customerName: cleanCell(row[1]),
      reportLessGstValue: Number(row[2] || 0),
      sourceRow: index + 1
    });
  });
  return result;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeNormalizedIndex(filePath, rows) {
  const headers = [
    "cancellation_week",
    "publication_name",
    "edition_name",
    "order_id",
    "customer_name",
    "report_less_gst_value",
    "source_row"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.cancellationWeek,
        row.publicationName,
        row.editionName,
        row.orderId,
        row.customerName,
        row.reportLessGstValue,
        row.sourceRow
      ]
        .map(csvCell)
        .join(",")
    )
  ];
  fs.writeFileSync(filePath, `${lines.join("\r\n")}\r\n`, "utf8");
}

function buildManifest(sourceDirectory) {
  const sourceRoot = path.resolve(sourceDirectory);
  const results = COMBINATIONS.map((combination) => {
    const filePath = path.join(sourceRoot, combination.fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cancelled Orders combination is missing: ${filePath}`);
    }
    const rows = readXlsxWorksheetRows(filePath).rows;
    const summary = summarizeRows(rows);
    if (
      summary.orderRowCount === 0 ||
      summary.duplicateOrderRowCount !== 0
    ) {
      throw new Error(
        `Cancelled Orders combination failed order validation: ${combination.id}`
      );
    }
    return {
      ...combination,
      status: "complete",
      ...fileMeta(filePath, sourceRoot),
      parsedNonEmptyRowCount: summary.parsedNonEmptyRowCount,
      weekCount: summary.weekCount,
      oldestReturnedWeek: summary.oldestReturnedWeek,
      latestReturnedWeek: summary.latestReturnedWeek,
      orderRowCount: summary.orderRowCount,
      uniqueOrderCount: summary.uniqueOrderCount,
      duplicateOrderRowCount: summary.duplicateOrderRowCount,
      reportLessGstValue: summary.reportLessGstValue,
      orderRows: summary.orderRows,
      orderTupleSet: summary.orderTupleSet,
      sourceSnapshot: "carma_ui_extraction_2026-07-29"
    };
  });

  const allWeek = results.find(
    (result) => result.id === "group-week__all-salespeople"
  );
  const allPublication = results.find(
    (result) => result.id === "group-publication__all-salespeople"
  );
  const inactiveWeek = results.find(
    (result) => result.id === "group-week__terminated-salespeople-only"
  );
  const inactivePublication = results.find(
    (result) =>
      result.id === "group-publication__terminated-salespeople-only"
  );
  const required = [allWeek, allPublication, inactiveWeek, inactivePublication];
  if (required.some((value) => !value)) {
    throw new Error("Cancelled Orders combination matrix is incomplete.");
  }

  const validation = {
    requestedCombinationCount: COMBINATIONS.length,
    completedCombinationCount: results.length,
    completeCombinationMatrix: results.length === COMBINATIONS.length,
    allSalespeopleGroupingTupleDifferences: {
      weekOnly: setDifferenceCount(
        allWeek.orderTupleSet,
        allPublication.orderTupleSet
      ),
      publicationOnly: setDifferenceCount(
        allPublication.orderTupleSet,
        allWeek.orderTupleSet
      )
    },
    terminatedSalespeopleGroupingTupleDifferences: {
      weekOnly: setDifferenceCount(
        inactiveWeek.orderTupleSet,
        inactivePublication.orderTupleSet
      ),
      publicationOnly: setDifferenceCount(
        inactivePublication.orderTupleSet,
        inactiveWeek.orderTupleSet
      )
    },
    terminatedOrdersMissingFromAllSalespeople: setDifferenceCount(
      inactiveWeek.orderTupleSet,
      allWeek.orderTupleSet
    ),
    duplicateOrderRowsAcrossIndividualOutputs: results.reduce(
      (sum, result) => sum + result.duplicateOrderRowCount,
      0
    )
  };
  if (
    !validation.completeCombinationMatrix ||
    validation.allSalespeopleGroupingTupleDifferences.weekOnly !== 0 ||
    validation.allSalespeopleGroupingTupleDifferences.publicationOnly !== 0 ||
    validation.terminatedSalespeopleGroupingTupleDifferences.weekOnly !== 0 ||
    validation.terminatedSalespeopleGroupingTupleDifferences.publicationOnly !==
      0 ||
    validation.terminatedOrdersMissingFromAllSalespeople !== 0 ||
    validation.duplicateOrderRowsAcrossIndividualOutputs !== 0
  ) {
    throw new Error(
      `Cancelled Orders cross-combination reconciliation failed: ${JSON.stringify(validation)}`
    );
  }

  const boundaryPath = path.join(sourceRoot, BOUNDARY_PROBE_FILE);
  if (!fs.existsSync(boundaryPath)) {
    throw new Error(`Cancelled Orders boundary probe is missing: ${boundaryPath}`);
  }
  const boundarySummary = summarizeRows(
    readXlsxWorksheetRows(boundaryPath).rows
  );
  if (boundarySummary.orderRowCount !== 0 || boundarySummary.weekCount !== 0) {
    throw new Error("Cancelled Orders pre-boundary probe was not empty.");
  }

  const indexRows = normalizedIndexRows(
    readXlsxWorksheetRows(
      path.join(sourceRoot, allWeek.fileName)
    ).rows
  );
  const ordersWithoutPublication = indexRows.filter(
    (row) => !row.publicationName
  ).length;
  const ordersWithoutEdition = indexRows.filter(
    (row) => !row.editionName
  ).length;
  if (
    indexRows.length !== allWeek.uniqueOrderCount ||
    indexRows.some((row) => !row.cancellationWeek || !row.orderId)
  ) {
    throw new Error("Cancelled Orders normalized index did not reconcile.");
  }
  const indexPath = path.join(sourceRoot, NORMALIZED_INDEX_FILE);
  writeNormalizedIndex(indexPath, indexRows);

  const serializableResults = results.map(
    ({ orderRows, orderTupleSet, ...result }) => result
  );
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    processVersion: PROCESS_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSystem: "Carma",
    reportName: REPORT_NAME,
    reportFileName: "CancelledOrdersByWeek.rpt",
    parameters: {
      requestedStartDate: "1900-01-01",
      requestedEndDate: "2026-07-29",
      publications: PUBLICATIONS,
      editions: EDITIONS,
      publicationSelection: "all_available_values",
      editionSelection: "all_available_values_after_publication_selection",
      groupByWeekValues: [true, false],
      showInactiveOnlyValues: [true, false],
      falseShowInactiveOnlyMeaning:
        "all salespeople rather than terminated salespeople only"
    },
    coverage: {
      oldestRequestedDate: "1900-01-01",
      oldestReturnedWeek: isoDate(allWeek.oldestReturnedWeek),
      latestReturnedWeek: isoDate(allWeek.latestReturnedWeek),
      boundaryReason:
        "Carma accepted 1900-01-01; the comprehensive report first returned 2025-07-27, and an explicit 1900-01-01 through 2025-07-26 probe returned no order IDs or week groups."
    },
    totals: {
      combinationCount: serializableResults.length,
      totalParsedNonEmptyRowsAcrossOverlappingViews: serializableResults.reduce(
        (sum, result) => sum + result.parsedNonEmptyRowCount,
        0
      ),
      allSalespeopleUniqueOrders: allWeek.uniqueOrderCount,
      terminatedSalespeopleUniqueOrders: inactiveWeek.uniqueOrderCount,
      allSalespeopleReportLessGstValue: allWeek.reportLessGstValue,
      terminatedSalespeopleReportLessGstValue:
        inactiveWeek.reportLessGstValue
    },
    combinations: serializableResults,
    boundaryProbe: {
      status: "complete_empty",
      requestedStartDate: "1900-01-01",
      requestedEndDate: "2025-07-26",
      groupByWeek: true,
      showInactiveOnly: false,
      ...fileMeta(boundaryPath, sourceRoot),
      parsedNonEmptyRowCount: boundarySummary.parsedNonEmptyRowCount,
      weekCount: 0,
      orderRowCount: 0
    },
    normalizedIndex: {
      ...fileMeta(indexPath, sourceRoot),
      rowCount: indexRows.length,
      ordersWithoutPublication,
      ordersWithoutEdition,
      ordersWithPublicationAndEdition:
        indexRows.length -
        indexRows.filter(
          (row) => !row.publicationName || !row.editionName
        ).length,
      matchingKey: "exact order_id within this extraction snapshot"
    },
    validation,
    limitations: [
      "The four report combinations overlap. Do not sum their row counts, order counts or values.",
      "The normalized CSV is an index of the comprehensive weekly view; the raw XLSX files retain all report text and grouping detail.",
      "Blank publication or edition values in the normalized CSV are preserved from report rows that appeared before any corresponding grouping heading; they are not inferred or filled.",
      "Report inclusion and cancellation-week grouping do not prove refund, payment reversal, order deletion, recognised-revenue adjustment or cancellation causation.",
      "The edition and publication lists are the values Carma exposed on 2026-07-29; a future refresh may expose a different selection universe.",
      "The requested 1900 start is not a claim that Carma stores cancellation history from 1900."
    ]
  };

  const manifestPath = path.join(sourceRoot, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildManifest(args["source-dir"] || DEFAULT_SOURCE_DIRECTORY);
    process.stdout.write(
      `${JSON.stringify(
        {
          manifestPath: result.manifestPath,
          coverage: result.manifest.coverage,
          totals: result.manifest.totals,
          validation: result.manifest.validation
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  COMBINATIONS,
  PROCESS_VERSION,
  REPORT_NAME,
  SCHEMA_VERSION,
  buildManifest,
  normalizedIndexRows,
  summarizeRows
};
