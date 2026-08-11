"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
  validateEvidenceDocument
} = require("../src/businessRelationship");

const WARM_ALLOCATION_PATTERN = /\b(warm|repeat|rpts?|kwyc|recent approvals?|old .*sales)\b/i;
const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function flattenedHeaders(grid) {
  return Array.isArray(grid?.headers?.[0]) ? grid.headers[0] : (grid?.headers || []);
}

function rowsForGrid(grid) {
  const headers = flattenedHeaders(grid).map((header, index) => clean(header?.text ?? header) || `column_${index}`);
  return (grid?.rows || []).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, clean(row.cells?.[index]?.text ?? row[index]?.text ?? row[index])])
  ));
}

function gridWithHeaders(view, requiredHeaders) {
  return (view?.grids || []).find((grid) => {
    const headers = flattenedHeaders(grid).map((header) => clean(header?.text ?? header).toLowerCase());
    return requiredHeaders.every((required) => headers.includes(required.toLowerCase()));
  });
}

function carmaDate(value) {
  const match = clean(value).match(/^(?:[A-Za-z]{3}\s+)?(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!match || !MONTHS[match[2].toLowerCase()]) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${MONTHS[match[2].toLowerCase()]}-${match[1].padStart(2, "0")}`;
}

function carmaDateTime(value) {
  const match = clean(value).match(
    /^(?:[A-Za-z]{3}\s+)?(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(AM|PM)$/i
  );
  if (!match || !MONTHS[match[2].toLowerCase()]) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  let hour = Number(match[4]);
  if (match[7].toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (match[7].toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${year}-${MONTHS[match[2].toLowerCase()]}-${match[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${match[5]}:${match[6] || "00"}`;
}

function parseArgs(argv) {
  const options = { detailedManifests: [], summaryManifests: [], output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--detailed-manifest" && value) {
      options.detailedManifests.push(path.resolve(value));
      index += 1;
    } else if (arg === "--summary-manifest" && value) {
      options.summaryManifests.push(path.resolve(value));
      index += 1;
    } else if (arg === "--output" && value) {
      options.output = path.resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return options;
}

function customerSeed() {
  return {
    detailedHistoryComplete: false,
    detailedInvoiceBoundaries: [],
    observedOrderCreatedAt: [],
    warmAllocationDates: []
  };
}

function addManifest(document, manifestPath, kind, audit) {
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest does not exist: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const records = Object.values(manifest.records || {});
  audit.sources.push({
    kind,
    manifestFileName: path.basename(manifestPath),
    manifestPath,
    manifestSha256: sha256(manifestPath),
    requestedOrders: Number(manifest.requestedOrders || records.length),
    records: records.length
  });

  for (const record of records) {
    if (clean(record.status).toLowerCase() !== "complete") {
      audit.incompleteRecords += 1;
      continue;
    }
    const orderPath = clean(record.orderPath);
    if (!orderPath || !fs.existsSync(orderPath)) {
      audit.missingOrderFiles += 1;
      continue;
    }
    const order = JSON.parse(fs.readFileSync(orderPath, "utf8"));
    const customerId = clean(record.customerId || order.customerId);
    if (!customerId) {
      audit.missingCustomerIds += 1;
      continue;
    }
    if (clean(record.customerId) && clean(order.customerId) && clean(record.customerId) !== clean(order.customerId)) {
      throw new Error(`Order customer_id conflict for order ${clean(record.orderId || order.orderId)}`);
    }
    if (!document.customers[customerId]) document.customers[customerId] = customerSeed();
    const customer = document.customers[customerId];
    const historyViews = [order.views?.History, order.views?.Summary].filter(Boolean);
    const createdByOrder = new Map();

    for (const view of historyViews) {
      const historyGrid = gridWithHeaders(view, ["Date", "Reason", "Description"]);
      for (const row of rowsForGrid(historyGrid)) {
        if (!/^order created$/i.test(clean(row.Reason))) continue;
        const createdAt = carmaDateTime(row.Date);
        if (!createdAt) continue;
        customer.observedOrderCreatedAt.push(createdAt);
        const orderNumber = clean(row.Description).match(/\b(\d{7,})\b/)?.[1] || "";
        if (orderNumber) createdByOrder.set(orderNumber, createdAt);
      }
    }

    if (kind === "detailed") {
      const invoicingView = order.views?.["Invoicing Summary"];
      if (invoicingView && order.coverage?.everyReportedGridRowCaptured === true) {
        customer.detailedHistoryComplete = true;
        const invoiceGrid = gridWithHeaders(invoicingView, ["Invoice", "Order", "Invoice Date"]);
        for (const row of rowsForGrid(invoiceGrid)) {
          const invoiceNumber = clean(row.Invoice);
          const invoiceDate = carmaDate(row["Invoice Date"]);
          const orderNumber = clean(row.Order);
          if (!invoiceNumber || !invoiceDate) continue;
          customer.detailedInvoiceBoundaries.push({
            invoiceNumber,
            orderNumber,
            invoiceDate,
            issuedAt: createdByOrder.get(orderNumber) || createdByOrder.get(invoiceNumber) || "",
            source: "carma_invoicing_summary"
          });
        }
      }
    }

    const allocationPath = path.join(path.dirname(orderPath), "allocation.json");
    if (fs.existsSync(allocationPath)) {
      const allocation = JSON.parse(fs.readFileSync(allocationPath, "utf8"));
      if (clean(allocation.customerId) && clean(allocation.customerId) !== customerId) {
        throw new Error(`Allocation customer_id conflict for order ${clean(record.orderId || order.orderId)}`);
      }
      for (const row of allocation.rows || []) {
        if (!WARM_ALLOCATION_PATTERN.test(clean(row.description))) continue;
        const eventDate = carmaDate(row.sent) || carmaDate(row.created);
        if (eventDate) customer.warmAllocationDates.push(eventDate);
      }
    }
    audit.readableOrders += 1;
  }
}

function deduplicateDocument(document) {
  for (const customer of Object.values(document.customers)) {
    const invoiceMap = new Map();
    for (const boundary of customer.detailedInvoiceBoundaries) {
      const key = `${boundary.invoiceNumber}|${boundary.orderNumber}|${boundary.invoiceDate}`;
      const existing = invoiceMap.get(key);
      if (existing?.issuedAt && boundary.issuedAt && existing.issuedAt !== boundary.issuedAt) {
        throw new Error(`Conflicting issue timestamps for invoice ${boundary.invoiceNumber}`);
      }
      invoiceMap.set(key, existing?.issuedAt ? existing : boundary);
    }
    customer.detailedInvoiceBoundaries = [...invoiceMap.values()].sort((a, b) => (
      a.invoiceDate.localeCompare(b.invoiceDate)
      || a.issuedAt.localeCompare(b.issuedAt)
      || a.invoiceNumber.localeCompare(b.invoiceNumber)
    ));
    customer.observedOrderCreatedAt = [...new Set(customer.observedOrderCreatedAt)].sort();
    customer.warmAllocationDates = [...new Set(customer.warmAllocationDates)].sort();
  }
}

function buildEvidence(options) {
  if (!options.output) throw new Error("--output is required");
  if (!options.detailedManifests.length && !options.summaryManifests.length) {
    throw new Error("At least one --detailed-manifest or --summary-manifest is required");
  }
  const document = {
    schemaVersion: BUSINESS_RELATIONSHIP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    joinRule: "exact customer_id only",
    classificationPolicy: "event_time_invoice_then_order_event_then_warm_allocation_then_order_count_binary.v1",
    sources: [],
    customers: {}
  };
  const audit = {
    readableOrders: 0,
    missingOrderFiles: 0,
    missingCustomerIds: 0,
    incompleteRecords: 0,
    sources: document.sources
  };
  options.detailedManifests.forEach((manifestPath) => addManifest(document, manifestPath, "detailed", audit));
  options.summaryManifests.forEach((manifestPath) => addManifest(document, manifestPath, "summary", audit));
  deduplicateDocument(document);
  validateEvidenceDocument(document);
  const customers = Object.values(document.customers);
  audit.customers = customers.length;
  audit.detailedCustomers = customers.filter((customer) => customer.detailedHistoryComplete).length;
  audit.invoiceBoundaries = customers.reduce((sum, customer) => sum + customer.detailedInvoiceBoundaries.length, 0);
  audit.observedOrderEvents = customers.reduce((sum, customer) => sum + customer.observedOrderCreatedAt.length, 0);
  audit.warmAllocationDates = customers.reduce((sum, customer) => sum + customer.warmAllocationDates.length, 0);
  document.audit = audit;
  return document;
}

function writeEvidence(document, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
}

function usage() {
  return [
    "Build the offline event-time New/Warm evidence index.",
    "",
    "node scripts/build-business-relationship-evidence.js \\",
    "  --detailed-manifest <full customer tabs manifest.json> \\",
    "  --summary-manifest <all-approved Summary manifest.json> \\",
    "  --output <business-relationship-evidence.json>"
  ].join("\n");
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const document = buildEvidence(options);
    writeEvidence(document, options.output);
    process.stdout.write(`${JSON.stringify({ ok: true, output: options.output, ...document.audit }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildEvidence,
  carmaDate,
  carmaDateTime,
  parseArgs,
  writeEvidence
};
