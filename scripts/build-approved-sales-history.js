"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { readXlsxWorksheetRows } = require("../src/xlsxReader");

const ROOT = path.join(__dirname, "..");
const DEFAULT_CONFIG = path.join(ROOT, "data", "carma", "config.json");
const DEFAULT_OUTPUT = path.join(
  ROOT,
  "data",
  "carma",
  "generated",
  "approved-sales-history"
);
const SCHEMA_VERSION = "carma_approved_sales_history.v1";
const ORDER_ID_PATTERN = /^\d{8}$/;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--")
      ? argv[++index]
      : true;
  }
  return args;
}

function clean(value) {
  return String(value ?? "").trim();
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isoDate(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Expected DD/MM/YYYY date, received ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exactStringSet(values) {
  return Array.from(new Set(values.map(clean))).sort();
}

function reportRows(filePath) {
  const workbook = readXlsxWorksheetRows(filePath);
  const header = workbook.rows[0] || [];
  const headerText = clean(header[0]);
  if (!/Approved Sales by Customer for Period/i.test(headerText)) {
    throw new Error(`${path.basename(filePath)} is not an Approved Sales by Customer report`);
  }
  const groups = new Map();
  let lineValueTotal = 0;
  let lineRows = 0;
  for (let index = 0; index < workbook.rows.length; index += 1) {
    const row = workbook.rows[index];
    const orderId = clean(row[0]);
    if (!ORDER_ID_PATTERN.test(orderId)) continue;
    const lineValue = Number(row[9] ?? 0);
    if (!Number.isFinite(lineValue)) {
      throw new Error(`${path.basename(filePath)} row ${index + 1} has an invalid approved value`);
    }
    lineRows += 1;
    lineValueTotal += lineValue;
    if (!groups.has(orderId)) {
      groups.set(orderId, {
        orderId,
        actualSellers: [],
        customerNames: [],
        lineCount: 0,
        approvedValue: 0,
        sourceRows: []
      });
    }
    const group = groups.get(orderId);
    group.actualSellers.push(row[1]);
    group.customerNames.push(row[2]);
    group.lineCount += 1;
    group.approvedValue += lineValue;
    group.sourceRows.push(index + 1);
  }
  const reportedLineValue = Number(header[2] ?? 0);
  if (
    Number.isFinite(reportedLineValue)
    && Math.abs(reportedLineValue - lineValueTotal) > 0.02
  ) {
    throw new Error(
      `${path.basename(filePath)} line total ${lineValueTotal.toFixed(2)} `
      + `does not reconcile to report total ${reportedLineValue.toFixed(2)}`
    );
  }
  const orders = new Map();
  groups.forEach((group, orderId) => {
    const sellers = exactStringSet(group.actualSellers);
    const customers = exactStringSet(group.customerNames);
    if (sellers.length !== 1 || customers.length !== 1) {
      throw new Error(
        `${path.basename(filePath)} order ${orderId} has conflicting `
        + `seller/customer values: ${JSON.stringify({ sellers, customers })}`
      );
    }
    orders.set(orderId, {
      orderId,
      actualSeller: sellers[0],
      customerName: customers[0],
      lineCount: group.lineCount,
      approvedValue: group.approvedValue,
      sourceRows: group.sourceRows
    });
  });
  return {
    headerText,
    reportedLineValue: Math.round(reportedLineValue * 100) / 100,
    lineValueTotal: Math.round(lineValueTotal * 100) / 100,
    lineRows,
    orders
  };
}

function matchingNewCustomerOrder(allOrder, newOrder) {
  return (
    allOrder.actualSeller === newOrder.actualSeller
    && allOrder.customerName === newOrder.customerName
    && allOrder.lineCount === newOrder.lineCount
    && Math.abs(allOrder.approvedValue - newOrder.approvedValue) <= 0.01
  );
}

function requireFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath || "(not configured)"}`);
  }
  return path.resolve(filePath);
}

function periodFiles(period, newDirectory) {
  const historicalAll = requireFile(period.outputPath, `All-sales source for ${period.id}`);
  const matchedAll = path.join(newDirectory, `approved-sales-all-${period.id}.xlsx`);
  const newCustomers = requireFile(
    path.join(newDirectory, `approved-sales-new-customers-${period.id}.xlsx`),
    `New-customer source for ${period.id}`
  );
  return {
    all: fs.existsSync(matchedAll) ? matchedAll : historicalAll,
    allSnapshot: fs.existsSync(matchedAll) ? "matched_2026_07_29_snapshot" : "retained_2026_07_27_snapshot",
    newCustomers
  };
}

function initializeDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;

    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE extraction_runs (
      period_id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      all_source_file_name TEXT NOT NULL,
      all_source_sha256 TEXT NOT NULL,
      all_source_snapshot TEXT NOT NULL,
      new_source_file_name TEXT NOT NULL,
      new_source_sha256 TEXT NOT NULL,
      all_order_count INTEGER NOT NULL CHECK (all_order_count >= 0),
      new_customer_order_count INTEGER NOT NULL CHECK (new_customer_order_count >= 0),
      all_line_count INTEGER NOT NULL CHECK (all_line_count >= 0),
      new_customer_line_count INTEGER NOT NULL CHECK (new_customer_line_count >= 0),
      all_approved_value REAL NOT NULL,
      new_customer_approved_value REAL NOT NULL,
      matched_order_field_variation_count INTEGER NOT NULL CHECK (
        matched_order_field_variation_count >= 0
      ),
      classification_quality TEXT NOT NULL,
      reconciliation_status TEXT NOT NULL
    ) STRICT;

    CREATE TABLE approved_sales_history (
      period_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      order_id TEXT NOT NULL,
      actual_seller TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      approved_value REAL NOT NULL,
      line_count INTEGER NOT NULL CHECK (line_count > 0),
      is_new_customer INTEGER NOT NULL CHECK (is_new_customer IN (0, 1)),
      classification_basis TEXT NOT NULL,
      classification_quality TEXT NOT NULL,
      all_source_file_name TEXT NOT NULL,
      new_source_file_name TEXT NOT NULL,
      PRIMARY KEY (period_id, order_id),
      FOREIGN KEY (period_id) REFERENCES extraction_runs(period_id)
    ) STRICT;

    CREATE INDEX idx_approved_sales_order ON approved_sales_history(order_id);
    CREATE INDEX idx_approved_sales_period_new
      ON approved_sales_history(period_start, period_end, is_new_customer);
    CREATE INDEX idx_approved_sales_seller ON approved_sales_history(actual_seller);

    CREATE VIEW v_period_summary AS
    SELECT
      period_id,
      period_start,
      period_end,
      COUNT(*) AS all_orders,
      SUM(is_new_customer) AS new_customer_orders,
      ROUND(SUM(approved_value), 2) AS all_approved_value,
      ROUND(SUM(CASE WHEN is_new_customer = 1 THEN approved_value ELSE 0 END), 2)
        AS new_customer_approved_value,
      MIN(classification_quality) AS classification_quality
    FROM approved_sales_history
    GROUP BY period_id, period_start, period_end;
  `);
  return db;
}

function writeCsv(filePath, rows) {
  const headers = [
    "period_id",
    "period_start",
    "period_end",
    "order_id",
    "actual_seller",
    "customer_name",
    "approved_value",
    "line_count",
    "is_new_customer",
    "classification_basis",
    "classification_quality",
    "all_source_file_name",
    "new_source_file_name"
  ];
  const handle = fs.openSync(filePath, "w");
  try {
    fs.writeSync(handle, `${headers.join(",")}\r\n`);
    let buffer = "";
    rows.forEach((row, index) => {
      buffer += `${headers.map((header) => csvEscape(row[header])).join(",")}\r\n`;
      if (index % 5000 === 4999) {
        fs.writeSync(handle, buffer);
        buffer = "";
      }
    });
    if (buffer) fs.writeSync(handle, buffer);
  } finally {
    fs.closeSync(handle);
  }
}

function buildApprovedSalesHistory({
  allManifestPath,
  newDirectory,
  outputDirectory,
  force = false
}) {
  const allManifest = JSON.parse(
    fs.readFileSync(requireFile(allManifestPath, "Approved-sales all-history manifest"), "utf8")
  );
  const resolvedNewDirectory = requireFile(newDirectory, "Approved-sales new-customer directory");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const databasePath = path.join(outputDirectory, "approved-sales-history.sqlite");
  const csvPath = path.join(outputDirectory, "approved-sales-history.csv");
  const periodsCsvPath = path.join(outputDirectory, "approved-sales-history-periods.csv");
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const targets = [databasePath, csvPath, periodsCsvPath, manifestPath];
  if (!force && targets.some((target) => fs.existsSync(target))) {
    throw new Error(`Output already exists in ${outputDirectory}; pass --force to replace it`);
  }
  const temporary = Object.fromEntries(
    targets.map((target) => [target, `${target}.tmp-${process.pid}`])
  );
  Object.values(temporary).forEach((target) => {
    if (fs.existsSync(target)) fs.rmSync(target);
  });

  const periodSources = Object.values(allManifest.periods || {})
    .filter((period) => period.status === "complete")
    .sort((left, right) => isoDate(left.startDate).localeCompare(isoDate(right.startDate)));
  if (!periodSources.length) throw new Error("All-sales manifest has no complete periods");

  const periodResults = [];
  const orderRows = [];
  periodSources.forEach((period) => {
    const files = periodFiles(period, resolvedNewDirectory);
    const allReport = reportRows(files.all);
    const newReport = reportRows(files.newCustomers);
    const orphans = [];
    const fieldVariations = [];
    newReport.orders.forEach((newOrder, orderId) => {
      const allOrder = allReport.orders.get(orderId);
      if (!allOrder) {
        orphans.push(orderId);
      } else if (!matchingNewCustomerOrder(allOrder, newOrder)) {
        fieldVariations.push({
          orderId,
          sellerChanged: allOrder.actualSeller !== newOrder.actualSeller,
          customerNameChanged: allOrder.customerName !== newOrder.customerName,
          lineCountChanged: allOrder.lineCount !== newOrder.lineCount,
          approvedValueChanged:
            Math.abs(allOrder.approvedValue - newOrder.approvedValue) > 0.01,
          all: {
            actualSeller: allOrder.actualSeller,
            customerName: allOrder.customerName,
            lineCount: allOrder.lineCount,
            approvedValue: allOrder.approvedValue
          },
          newCustomers: {
            actualSeller: newOrder.actualSeller,
            customerName: newOrder.customerName,
            lineCount: newOrder.lineCount,
            approvedValue: newOrder.approvedValue
          }
        });
      }
    });
    if (orphans.length) {
      throw new Error(
        `Period ${period.id} failed exact-order reconciliation: `
        + `${orphans.length} orphan(s)`
      );
    }
    periodResults.push({
      periodId: period.id,
      periodStart: isoDate(period.startDate),
      periodEnd: isoDate(period.endDate),
      allSourcePath: files.all,
      allSourceFileName: path.basename(files.all),
      allSourceSha256: sha256File(files.all),
      allSourceSnapshot: files.allSnapshot,
      newSourcePath: files.newCustomers,
      newSourceFileName: path.basename(files.newCustomers),
      newSourceSha256: sha256File(files.newCustomers),
      allOrderCount: allReport.orders.size,
      newCustomerOrderCount: newReport.orders.size,
      allLineCount: allReport.lineRows,
      newCustomerLineCount: newReport.lineRows,
      allApprovedValue: allReport.lineValueTotal,
      newCustomerApprovedValue: newReport.lineValueTotal,
      matchedOrderFieldVariationCount: fieldVariations.length,
      matchedOrderFieldVariationExamples: fieldVariations.slice(0, 20),
      newCustomerShare: allReport.orders.size
        ? Math.round((newReport.orders.size / allReport.orders.size) * 10000) / 100
        : null,
      reconciliationStatus: fieldVariations.length
        ? "exact_order_subset_reconciled_with_source_variations"
        : "exact_order_subset_reconciled"
    });
    allReport.orders.forEach((order) => {
      orderRows.push({
        period_id: period.id,
        period_start: isoDate(period.startDate),
        period_end: isoDate(period.endDate),
        order_id: order.orderId,
        actual_seller: order.actualSeller,
        customer_name: order.customerName,
        approved_value: order.approvedValue,
        line_count: order.lineCount,
        is_new_customer: newReport.orders.has(order.orderId) ? 1 : 0,
        classification_basis:
          "Exact order_id membership in the same-period Carma report with Show only new customers=True",
        classification_quality: "",
        all_source_file_name: path.basename(files.all),
        new_source_file_name: path.basename(files.newCustomers)
      });
    });
  });

  const populated = periodResults.filter((period) => period.allOrderCount > 0);
  let cliffStart = "";
  let largestIncrease = -Infinity;
  for (let index = 1; index < populated.length; index += 1) {
    const previous = populated[index - 1];
    const current = populated[index];
    const increase = Number(current.newCustomerShare || 0) - Number(previous.newCustomerShare || 0);
    if (increase > largestIncrease) {
      largestIncrease = increase;
      cliffStart = current.periodStart;
    }
  }
  periodResults.forEach((period) => {
    period.classificationQuality = (
      period.allOrderCount > 0
      && cliffStart
      && period.periodStart < cliffStart
    )
      ? "exact_report_membership_historical_marker_sparse"
      : "exact_report_membership";
  });
  const qualityByPeriod = new Map(
    periodResults.map((period) => [period.periodId, period.classificationQuality])
  );
  orderRows.forEach((row) => {
    row.classification_quality = qualityByPeriod.get(row.period_id);
  });

  const db = initializeDatabase(temporary[databasePath]);
  const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  const insertRun = db.prepare(`
    INSERT INTO extraction_runs (
      period_id, period_start, period_end,
      all_source_file_name, all_source_sha256, all_source_snapshot,
      new_source_file_name, new_source_sha256,
      all_order_count, new_customer_order_count,
      all_line_count, new_customer_line_count,
      all_approved_value, new_customer_approved_value,
      matched_order_field_variation_count,
      classification_quality, reconciliation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrder = db.prepare(`
    INSERT INTO approved_sales_history (
      period_id, period_start, period_end, order_id,
      actual_seller, customer_name, approved_value, line_count,
      is_new_customer, classification_basis, classification_quality,
      all_source_file_name, new_source_file_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    [
      ["schema_version", SCHEMA_VERSION],
      ["generated_at", new Date().toISOString()],
      ["report_name", "Approved Sales by Customer for Period"],
      ["new_customer_definition", "Exact order_id membership in the same-period Carma report with Show only new customers=True"],
      ["non_membership_meaning", "Not selected by the Carma new-customer-only report; not independent proof of existing-customer status"],
      ["historical_marker_cliff_start", cliffStart],
      ["historical_marker_largest_share_increase_percentage_points", String(Math.round(largestIncrease * 100) / 100)],
      ["matching_rule", "exact period_id + exact order_id only"],
      ["phone_matching", "prohibited"],
      ["customer_name_matching", "prohibited"]
    ].forEach(([key, value]) => insertMeta.run(key, value));
    periodResults.forEach((period) => insertRun.run(
      period.periodId,
      period.periodStart,
      period.periodEnd,
      period.allSourceFileName,
      period.allSourceSha256,
      period.allSourceSnapshot,
      period.newSourceFileName,
      period.newSourceSha256,
      period.allOrderCount,
      period.newCustomerOrderCount,
      period.allLineCount,
      period.newCustomerLineCount,
      period.allApprovedValue,
      period.newCustomerApprovedValue,
      period.matchedOrderFieldVariationCount,
      period.classificationQuality,
      period.reconciliationStatus
    ));
    orderRows.forEach((row) => insertOrder.run(
      row.period_id,
      row.period_start,
      row.period_end,
      row.order_id,
      row.actual_seller,
      row.customer_name,
      row.approved_value,
      row.line_count,
      row.is_new_customer,
      row.classification_basis,
      row.classification_quality,
      row.all_source_file_name,
      row.new_source_file_name
    ));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (integrity !== "ok" || foreignKeys.length) {
    db.close();
    throw new Error(`SQLite verification failed: ${JSON.stringify({ integrity, foreignKeys })}`);
  }
  db.close();

  writeCsv(temporary[csvPath], orderRows);
  writeCsv(
    temporary[periodsCsvPath],
    periodResults.map((period) => ({
      period_id: period.periodId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      all_order_count: period.allOrderCount,
      new_customer_order_count: period.newCustomerOrderCount,
      new_customer_share_pct: period.newCustomerShare,
      all_approved_value: period.allApprovedValue,
      new_customer_approved_value: period.newCustomerApprovedValue,
      matched_order_field_variation_count: period.matchedOrderFieldVariationCount,
      classification_quality: period.classificationQuality,
      reconciliation_status: period.reconciliationStatus,
      all_source_file_name: period.allSourceFileName,
      all_source_sha256: period.allSourceSha256,
      all_source_snapshot: period.allSourceSnapshot,
      new_source_file_name: period.newSourceFileName,
      new_source_sha256: period.newSourceSha256
    }))
  );

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    reportName: "Approved Sales by Customer for Period",
    parameters: {
      allSales: {
        showNewCustomersOnly: false,
        summaryOnly: false,
        groupBySalesperson: false,
        assetGroups: "All"
      },
      newCustomers: {
        showNewCustomersOnly: true,
        summaryOnly: false,
        groupBySalesperson: false,
        assetGroups: "All"
      }
    },
    matchingRule: "exact period_id + exact order_id only",
    classificationDefinition:
      "is_new_customer=1 only when the exact order_id appears in the same-period Carma new-customer-only report",
    nonMembershipMeaning:
      "is_new_customer=0 means the order was not selected by that Carma report; it is not independent proof that the customer was historically existing",
    observedHistoricalMarkerCliff: {
      start: cliffStart,
      largestShareIncreasePercentagePoints: Math.round(largestIncrease * 100) / 100,
      interpretation:
        "The report membership changes sharply at this boundary; pre-boundary false values require historical-data-quality caution"
    },
    outputs: {
      sqlite: path.basename(databasePath),
      csv: path.basename(csvPath),
      periodSummaryCsv: path.basename(periodsCsvPath)
    },
    totals: {
      periods: periodResults.length,
      orders: orderRows.length,
      newCustomerOrders: orderRows.reduce((sum, row) => sum + row.is_new_customer, 0),
      approvedValue: Math.round(orderRows.reduce((sum, row) => sum + row.approved_value, 0) * 100) / 100,
      newCustomerApprovedValue: Math.round(
        orderRows
          .filter((row) => row.is_new_customer)
          .reduce((sum, row) => sum + row.approved_value, 0) * 100
      ) / 100,
      matchedOrderFieldVariations: periodResults.reduce(
        (sum, period) => sum + period.matchedOrderFieldVariationCount,
        0
      )
    },
    validation: {
      exactOrderSubsetOrphans: 0,
      matchedOrderFieldVariations: periodResults.reduce(
        (sum, period) => sum + period.matchedOrderFieldVariationCount,
        0
      ),
      sqliteIntegrity: integrity,
      sqliteForeignKeyIssues: foreignKeys.length
    },
    periods: periodResults.map((period) => ({
      id: period.periodId,
      startDate: period.periodStart,
      endDate: period.periodEnd,
      allOrderCount: period.allOrderCount,
      newCustomerOrderCount: period.newCustomerOrderCount,
      newCustomerSharePct: period.newCustomerShare,
      allApprovedValue: period.allApprovedValue,
      newCustomerApprovedValue: period.newCustomerApprovedValue,
      matchedOrderFieldVariationCount: period.matchedOrderFieldVariationCount,
      matchedOrderFieldVariationExamples: period.matchedOrderFieldVariationExamples,
      classificationQuality: period.classificationQuality,
      reconciliationStatus: period.reconciliationStatus,
      allSource: {
        fileName: period.allSourceFileName,
        sha256: period.allSourceSha256,
        snapshot: period.allSourceSnapshot
      },
      newCustomerSource: {
        fileName: period.newSourceFileName,
        sha256: period.newSourceSha256
      }
    }))
  };
  fs.writeFileSync(temporary[manifestPath], `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  targets.forEach((target) => {
    if (force && fs.existsSync(target)) fs.rmSync(target);
    fs.renameSync(temporary[target], target);
  });
  return { databasePath, csvPath, periodsCsvPath, manifestPath, manifest };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const configPath = path.resolve(args.config || DEFAULT_CONFIG);
    const config = JSON.parse(fs.readFileSync(requireFile(configPath, "Carma data-layer config"), "utf8"));
    const result = buildApprovedSalesHistory({
      allManifestPath: path.resolve(
        args["all-manifest"] || config.approvedSalesHistoryManifest || ""
      ),
      newDirectory: path.resolve(
        args["new-directory"] || config.approvedSalesNewCustomerDirectory || ""
      ),
      outputDirectory: path.resolve(args.output || DEFAULT_OUTPUT),
      force: Boolean(args.force)
    });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: result.manifest.schemaVersion,
      databasePath: result.databasePath,
      csvPath: result.csvPath,
      periodsCsvPath: result.periodsCsvPath,
      manifestPath: result.manifestPath,
      totals: result.manifest.totals,
      validation: result.manifest.validation,
      observedHistoricalMarkerCliff: result.manifest.observedHistoricalMarkerCliff
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCHEMA_VERSION,
  buildApprovedSalesHistory,
  matchingNewCustomerOrder,
  reportRows
};
