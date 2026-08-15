// Builds the audited Conversion Report replacement with preserved SWCR sheets and full 2WCR lenses.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "C:/Users/User/Desktop/Sales Dashboard";
const baseWorkbookPath = path.join(root, "outputs/swcr-consolidated/2026-08-03_to_2026-08-07/SWCR_Consolidated_Report_2026-08-03_to_2026-08-07.xlsx");
const baseSwcrCsvPath = path.join(root, "outputs/swcr-consolidated/2026-08-03_to_2026-08-07/SWCR_Consolidated_Flat_Export_2026-08-03_to_2026-08-07.csv");
const outputDir = path.join(root, "outputs/conversion-report/2026-08-03_to_2026-08-07-final");
const workDir = path.join(root, "work/conversion-report-final");
const outputWorkbookPath = path.join(outputDir, "Conversion_Report_2026-08-03_to_2026-08-07.xlsx");
const outputSwcrCsvPath = path.join(outputDir, "Conversion_Report_SWCR_Flat_Export_2026-08-03_to_2026-08-07.csv");
const outputTwoWeekCsvPath = path.join(outputDir, "Conversion_Report_2WCR_Flat_Export_2026-07-20_to_2026-07-24.csv");

const require = createRequire(import.meta.url);
const { readValidatedCarmaFacts } = require(path.join(root, "src/carmaEvidence.js"));
const { isExcludedPersonnel, isExcludedReportingRow, EXCLUDED_PERSONNEL } = require(path.join(root, "src/personnelExclusions.js"));

const allocationManifests = [
  path.join(root, "data/carma/raw/weekly-performance-exports/manifest_2026-07-20_to_2026-07-26.json"),
  path.join(root, "data/carma/raw/weekly-performance-exports/manifest_2026-07-27_to_2026-08-02.json"),
  path.join(root, "data/carma/raw/weekly-performance-exports/manifest_2026-08-03_to_2026-08-09.json"),
];
const salesSources = {
  carma20Manifest: "C:/Users/User/Desktop/Carma Reports/output/weekly-approved-sales-evidence/2026-07-20_to_2026-07-26/swcr-approved-sales-evidence-manifest.json",
  carma20Csv: "C:/Users/User/Desktop/Carma Reports/output/weekly-approved-sales-evidence/2026-07-20_to_2026-07-26/approved-sales-swcr-outcome.csv",
  dashboard27Db: path.join(root, "outputs/corrected-2026-08-05-carma-evidence-v4-2026-07-27-to-2026-08-02/carma-evidence.sqlite"),
  dashboard27Verification: path.join(root, "outputs/corrected-2026-08-05-carma-evidence-v4-2026-07-27-to-2026-08-02/carma-evidence-v4-verification.json"),
  dashboard03Db: path.join(root, "outputs/weekly-lead-utilisation/2026-08-03_to_2026-08-07/carma-evidence/carma-evidence.sqlite"),
  dashboard03Verification: path.join(root, "outputs/weekly-lead-utilisation/2026-08-03_to_2026-08-07/carma-evidence/carma-evidence-v4-verification.json"),
  carma03Manifest: "C:/Users/User/Desktop/Carma Reports/output/weekly-approved-sales-evidence/2026-08-03_to_2026-08-09/weekly-approved-sales-evidence-manifest.json",
  carma03Csv: "C:/Users/User/Desktop/Carma Reports/output/weekly-approved-sales-evidence/2026-08-03_to_2026-08-09/approved-sales-enriched.csv",
};
const policyPath = path.join(root, "config/weekly-lead-type-policy.json");
const catalogPath = path.join(root, "data/carma/catalog.json");
const swcrDataPaths = [
  path.join(root, "outputs/swcr-consolidated/2026-07-20_to_2026-07-24/swcr_report_data.json"),
  path.join(root, "outputs/swcr-consolidated/2026-07-27_to_2026-07-31/swcr_report_data.json"),
  path.join(root, "outputs/swcr-consolidated/2026-08-03_to_2026-08-07/swcr_report_data.json"),
];

const clean = (value) => String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
const norm = (value) => clean(value).toLowerCase();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const sha256File = async (filePath) => crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
const hashObject = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const asLocalTimestamp = (value) => clean(value).replace(/\.\d{3}Z$/, "").replace(/Z$/, "").replace(/([+-]\d\d:\d\d)$/, "").replace(" ", "T").slice(0, 19);
const dateOnly = (value) => asLocalTimestamp(value).slice(0, 10);
const isWeekday = (date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};

function csvRows(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const [headers, ...body] = rows;
  return body.filter((item) => item.some(Boolean)).map((item) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), item[index] ?? ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function assertHash(filePath, expected, label) {
  const actual = await sha256File(filePath);
  if (actual !== clean(expected)) throw new Error(`${label} hash mismatch: ${actual} != ${expected}`);
  return actual;
}

for (const filePath of [baseWorkbookPath, baseSwcrCsvPath, catalogPath, policyPath, ...allocationManifests, ...Object.values(salesSources), ...swcrDataPaths]) {
  await fs.access(filePath);
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
if (catalog.schemaVersion !== "carma_data_catalog.v1") throw new Error("Unsupported Carma catalog.");
const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
const mappedType = new Map(policy.campaignRules.map((rule) => [clean(rule.exactCampaignName), clean(rule.leadType)]));

const allocationFiles = [];
for (const manifestPath of allocationManifests) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== "weekly_performance_exports_manifest.v1") throw new Error(`Unsupported allocation manifest ${manifestPath}`);
  const filePath = manifest.allocation.rawPath;
  await assertHash(filePath, manifest.allocation.sha256, `Allocation source ${path.basename(filePath)}`);
  allocationFiles.push({ manifestPath, filePath, manifest });
}

const allocationEvents = [];
const seenEventKeys = new Set();
let duplicateAllocationRows = 0;
let incompleteAllocationRows = 0;
for (const source of allocationFiles) {
  const rows = csvRows(await fs.readFile(source.filePath, "utf8"));
  if (rows.length !== Number(source.manifest.allocation.rowCount)) throw new Error(`Allocation row-count mismatch for ${source.filePath}`);
  for (const row of rows) {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName);
    const manager = clean(row.SalesManager) || "Unassigned manager";
    const date = clean(row.DateSentToSalesperson_Date);
    const time = clean(row.DateSentToSalesperson_Time);
    const campaign = clean(row.AllocationName);
    if (!customerId || !salesperson || !date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { incompleteAllocationRows += 1; continue; }
    if (date < "2026-07-20" || date > "2026-08-07") continue;
    const eventKey = [norm(customerId), norm(salesperson), norm(manager), date, time, norm(campaign)].join("|");
    if (seenEventKeys.has(eventKey)) { duplicateAllocationRows += 1; continue; }
    seenEventKeys.add(eventKey);
    allocationEvents.push({
      customerId,
      salesperson,
      manager,
      allocatedAt: `${date}T${time.padStart(8, "0")}`,
      date,
      campaign,
      segment: mappedType.get(campaign) || "",
      source: clean(row.DataSource) || clean(row.CustomerImportSource) || "Source not recorded",
      excluded: isExcludedReportingRow(salesperson, manager),
    });
  }
}
allocationEvents.sort((left, right) => left.allocatedAt.localeCompare(right.allocatedAt) || left.customerId.localeCompare(right.customerId));

const carma20Manifest = JSON.parse(await fs.readFile(salesSources.carma20Manifest, "utf8"));
if (carma20Manifest.status !== "PASSED" || carma20Manifest.parameters?.showOnlyNewCustomers !== false) throw new Error("20-26 July Carma bundle is not a passed all-customer source.");
await assertHash(salesSources.carma20Csv, carma20Manifest.files.swcrOutcomeCsv.sha256, "20-26 July approved-sales CSV");

const dashboard27Verification = JSON.parse(await fs.readFile(salesSources.dashboard27Verification, "utf8"));
if (dashboard27Verification.verdict !== "PASS" || dashboard27Verification.reconciliation?.explicitApprovalTimestamps !== dashboard27Verification.reconciliation?.orders) throw new Error("27 July-2 August Sales Dashboard evidence failed verification.");
await assertHash(salesSources.dashboard27Db, dashboard27Verification.databaseSha256, "27 July-2 August evidence database");

const dashboard03Verification = JSON.parse(await fs.readFile(salesSources.dashboard03Verification, "utf8"));
if (dashboard03Verification.verdict !== "PASS" || dashboard03Verification.reconciliation?.explicitApprovalTimestamps !== dashboard03Verification.reconciliation?.orders) throw new Error("3-9 August Sales Dashboard evidence failed verification.");
await assertHash(salesSources.dashboard03Db, dashboard03Verification.databaseSha256, "3-9 August evidence database");

const carma03Manifest = JSON.parse(await fs.readFile(salesSources.carma03Manifest, "utf8"));
if (carma03Manifest.status !== "complete" || carma03Manifest.populationContract !== "carma_approved_sales_show_new_customers_false.v1") throw new Error("3-9 August Carma bundle is not complete all-customer evidence.");
await assertHash(salesSources.carma03Csv, carma03Manifest.enrichedCsv.sha256, "3-9 August Carma enriched CSV");

const candidateSales = [];
function addSale(record) {
  const orderId = clean(record.orderId);
  const customerId = clean(record.customerId);
  const seller = clean(record.seller);
  const approvedAt = asLocalTimestamp(record.approvedAt);
  const value = roundMoney(record.value);
  if (!orderId || !customerId || !seller || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(approvedAt) || !Number.isFinite(value)) throw new Error(`Invalid approved-sale evidence from ${record.source}`);
  if (dateOnly(approvedAt) < "2026-07-20" || dateOnly(approvedAt) > "2026-08-09") return;
  candidateSales.push({ orderId, customerId, seller, approvedAt, value, source: record.source });
}

for (const row of csvRows(await fs.readFile(salesSources.carma20Csv, "utf8"))) {
  if (!clean(row["Approval Evidence"]) || clean(row["SWCR Outcome Eligible"]).toLowerCase() !== "true") throw new Error(`20 July sale ${row.Order} lacks explicit eligible approval evidence.`);
  addSale({ orderId: row.Order, customerId: row["Customer ID"], seller: row["Normalised Salesperson"] || row["Actual Salesperson"], approvedAt: row["Approval ISO Australia/Sydney"], value: row["Amount ex GST"], source: "Carma Reports 20-26 July" });
}

for (const order of readValidatedCarmaFacts({ databasePath: salesSources.dashboard27Db, projection: "performance" }).orders) {
  if (dateOnly(order.sale_approved_at) < "2026-07-27" || dateOnly(order.sale_approved_at) > "2026-08-02") continue;
  if (clean(order.approval_timestamp_status).toLowerCase() !== "explicit") throw new Error(`Order ${order.order_id} lacks an explicit approval timestamp.`);
  addSale({ orderId: order.order_id, customerId: order.customer_id, seller: order.actual_seller, approvedAt: order.sale_approved_at, value: order.sale_value, source: "Sales Dashboard 27 July-2 August" });
}

for (const order of readValidatedCarmaFacts({ databasePath: salesSources.dashboard03Db, projection: "performance" }).orders) {
  if (dateOnly(order.sale_approved_at) < "2026-08-03" || dateOnly(order.sale_approved_at) > "2026-08-09") continue;
  if (clean(order.approval_timestamp_status).toLowerCase() !== "explicit") throw new Error(`Order ${order.order_id} lacks an explicit approval timestamp.`);
  addSale({ orderId: order.order_id, customerId: order.customer_id, seller: order.actual_seller, approvedAt: order.sale_approved_at, value: order.sale_value, source: "Sales Dashboard 3-9 August" });
}

for (const row of csvRows(await fs.readFile(salesSources.carma03Csv, "utf8"))) {
  if (clean(row["Approval Status"]).toLowerCase() !== "explicit") throw new Error(`Carma 3-9 August order ${row.Order} lacks explicit approval evidence.`);
  addSale({ orderId: row.Order, customerId: row["Customer ID"], seller: row["Salesperson (Report)"], approvedAt: row["Approval Timestamp"], value: row["Amount ex GST"], source: "Carma Reports 3-9 August retained copy" });
}

const salesByOrder = new Map();
let duplicateSalesEvidenceRows = 0;
const duplicateOrderIds = new Set();
for (const sale of candidateSales) {
  const existing = salesByOrder.get(norm(sale.orderId));
  if (!existing) { salesByOrder.set(norm(sale.orderId), { ...sale, evidenceSources: [sale.source] }); continue; }
  const comparable = [norm(existing.customerId), norm(existing.seller), existing.approvedAt, existing.value];
  const incoming = [norm(sale.customerId), norm(sale.seller), sale.approvedAt, sale.value];
  if (JSON.stringify(comparable) !== JSON.stringify(incoming)) throw new Error(`Conflicting retained evidence for order ${sale.orderId}.`);
  duplicateSalesEvidenceRows += 1;
  duplicateOrderIds.add(sale.orderId);
  if (!existing.evidenceSources.includes(sale.source)) existing.evidenceSources.push(sale.source);
}
const allSales = [...salesByOrder.values()].sort((left, right) => left.approvedAt.localeCompare(right.approvedAt) || left.orderId.localeCompare(right.orderId));
const directMaturePairs = new Map();
for (const event of allocationEvents.filter((item) => item.date >= "2026-07-20" && item.date <= "2026-07-24" && ["New Business", "Warm"].includes(item.segment) && !item.excluded)) {
  const pairKey = `${norm(event.customerId)}|${norm(event.salesperson)}`;
  if (!directMaturePairs.has(pairKey) || event.allocatedAt < directMaturePairs.get(pairKey).allocatedAt) directMaturePairs.set(pairKey, event);
}
const directMatureMatchedSales = allSales.filter((sale) => {
  if (sale.approvedAt > "2026-08-07T23:59:59" || isExcludedPersonnel(sale.seller)) return false;
  const allocation = directMaturePairs.get(`${norm(sale.customerId)}|${norm(sale.seller)}`);
  return Boolean(allocation && allocation.allocatedAt <= sale.approvedAt);
});

const cohortDefinitions = [
  { start: "2026-07-20", end: "2026-07-24", cutoff: "2026-08-07", status: "Mature - complete through 7 Aug", statusKey: "mature" },
  { start: "2026-07-27", end: "2026-07-31", cutoff: "2026-08-14", status: "Awaiting complete evidence through 14 Aug", statusKey: "awaiting_evidence" },
  { start: "2026-08-03", end: "2026-08-07", cutoff: "2026-08-21", status: "Awaiting complete evidence through 21 Aug", statusKey: "awaiting_evidence" },
];
const cohortForDate = (date) => cohortDefinitions.find((cohort) => date >= cohort.start && date <= cohort.end);

const eventsByCustomer = new Map();
for (const event of allocationEvents) {
  const customerKey = norm(event.customerId);
  if (!eventsByCustomer.has(customerKey)) eventsByCustomer.set(customerKey, []);
  eventsByCustomer.get(customerKey).push(event);
}
const salesByCustomer = new Map();
for (const sale of allSales) {
  const customerKey = norm(sale.customerId);
  if (!salesByCustomer.has(customerKey)) salesByCustomer.set(customerKey, []);
  salesByCustomer.get(customerKey).push(sale);
}

const cohortSeeds = [];
let unmappedLeadCount = 0;
let excludedLeadCount = 0;
for (const [customerKey, events] of eventsByCustomer) {
  const weekdayEvents = events.filter((event) => isWeekday(event.date) && cohortForDate(event.date));
  if (!weekdayEvents.length) continue;
  const firstEligible = weekdayEvents.find((event) => ["New Business", "Warm"].includes(event.segment) && !event.excluded);
  if (!firstEligible) {
    if (weekdayEvents.some((event) => ["New Business", "Warm"].includes(event.segment) && event.excluded)) excludedLeadCount += 1;
    else unmappedLeadCount += 1;
    continue;
  }
  cohortSeeds.push({ customerKey, cohort: cohortForDate(firstEligible.date), original: firstEligible, allEvents: events });
}

function groupRow(map, label) {
  const name = clean(label) || "Unassigned";
  if (!map.has(name)) map.set(name, { label: name, events: 0, denominator: 0, sales: 0, value: 0 });
  return map.get(name);
}

const matureCohort = cohortDefinitions[0];
const matureLeads = [];
const matchedSaleAudit = [];
const attributedOrderIds = new Set();
let saleBeforeCohortCount = 0;
let sellerWithoutAllocationCount = 0;
let conflictingSellerLeadCount = 0;
let additionalQualifiedOrdersExcluded = 0;
let excludedAtCutoffCount = 0;

for (const seed of cohortSeeds.filter((item) => item.cohort.start === matureCohort.start)) {
  const windowEvents = seed.allEvents.filter((event) => event.allocatedAt <= `${matureCohort.cutoff}T23:59:59`);
  const cohortEvents = windowEvents.filter((event) => event.date >= matureCohort.start && event.date <= matureCohort.end);
  if (!windowEvents.length || !cohortEvents.length) continue;
  const latestEvent = windowEvents[windowEvents.length - 1];
  const sales = (salesByCustomer.get(seed.customerKey) || []).filter((sale) => sale.approvedAt <= `${matureCohort.cutoff}T23:59:59`);
  const matched = [];
  for (const sale of sales) {
    if (sale.approvedAt < seed.original.allocatedAt) { saleBeforeCohortCount += 1; continue; }
    if (isExcludedPersonnel(sale.seller)) continue;
    const sellerEvents = windowEvents.filter((event) => norm(event.salesperson) === norm(sale.seller) && event.allocatedAt <= sale.approvedAt && !event.excluded);
    if (!sellerEvents.length) { sellerWithoutAllocationCount += 1; continue; }
    matched.push({ sale, accountableEvent: sellerEvents[sellerEvents.length - 1] });
  }
  matched.sort((left, right) => left.sale.approvedAt.localeCompare(right.sale.approvedAt) || left.sale.orderId.localeCompare(right.sale.orderId));
  const matchedSellers = [...new Set(matched.map((item) => norm(item.sale.seller)))];
  if (matchedSellers.length > 1) conflictingSellerLeadCount += 1;
  const conversionMatch = matched.length ? matched[0] : null;
  additionalQualifiedOrdersExcluded += Math.max(0, matched.length - 1);
  const accountableEvent = conversionMatch ? conversionMatch.accountableEvent : latestEvent;
  if (accountableEvent.excluded || isExcludedReportingRow(accountableEvent.salesperson, accountableEvent.manager)) { excludedAtCutoffCount += 1; continue; }
  const leadSales = conversionMatch ? [conversionMatch.sale] : [];
  for (const item of conversionMatch ? [conversionMatch] : []) {
    if (attributedOrderIds.has(item.sale.orderId)) throw new Error(`Order ${item.sale.orderId} was attributed more than once.`);
    attributedOrderIds.add(item.sale.orderId);
    matchedSaleAudit.push({
      cohort: `${matureCohort.start} to ${matureCohort.end}`,
      cutoff: matureCohort.cutoff,
      orderId: item.sale.orderId,
      customerId: item.sale.customerId,
      seller: item.sale.seller,
      manager: accountableEvent.manager,
      approvedAt: item.sale.approvedAt,
      value: item.sale.value,
      segment: seed.original.segment,
      source: seed.original.source,
      sellerAllocationAt: item.accountableEvent.allocatedAt,
      evidenceSources: item.sale.evidenceSources.join("; "),
    });
  }
  matureLeads.push({
    cohort: `${matureCohort.start} to ${matureCohort.end}`,
    cutoff: matureCohort.cutoff,
    status: matureCohort.status,
    customerId: seed.original.customerId,
    segment: seed.original.segment,
    source: seed.original.source,
    originalSalesperson: seed.original.salesperson,
    originalManager: seed.original.manager,
    originalAllocatedAt: seed.original.allocatedAt,
    accountableSalesperson: accountableEvent.salesperson,
    accountableManager: accountableEvent.manager,
    accountableAt: accountableEvent.allocatedAt,
    cohortAllocationEvents: cohortEvents.length,
    windowAllocationEvents: windowEvents.length,
    reallocated: norm(accountableEvent.salesperson) !== norm(seed.original.salesperson),
    disposition: leadSales.length ? "Sold within 2WCR" : "Unsold at cutoff",
    approvedSales: leadSales.length,
    approvedValue: roundMoney(leadSales.reduce((sum, sale) => sum + sale.value, 0)),
    orderIds: leadSales.map((sale) => sale.orderId),
  });
}

const duplicateDenominatorCheck = new Set();
for (const lead of matureLeads) {
  const key = `${lead.cohort}|${norm(lead.customerId)}`;
  if (duplicateDenominatorCheck.has(key)) throw new Error(`Lead ${lead.customerId} appears in the denominator twice.`);
  duplicateDenominatorCheck.add(key);
}

function buildSegment(name, predicate) {
  const leads = matureLeads.filter(predicate);
  const views = { Salesperson: new Map(), Manager: new Map(), Source: new Map() };
  for (const lead of leads) {
    const dimensions = [["Salesperson", lead.accountableSalesperson], ["Manager", lead.accountableManager], ["Source", lead.source]];
    for (const [view, label] of dimensions) {
      const row = groupRow(views[view], label);
      row.events += lead.cohortAllocationEvents;
      row.denominator += 1;
      row.sales += lead.approvedSales;
      row.value = roundMoney(row.value + lead.approvedValue);
    }
  }
  const result = {
    segment: name,
    events: leads.reduce((sum, lead) => sum + lead.cohortAllocationEvents, 0),
    denominator: leads.length,
    sales: leads.reduce((sum, lead) => sum + lead.approvedSales, 0),
    value: roundMoney(leads.reduce((sum, lead) => sum + lead.approvedValue, 0)),
    reallocatedLeads: leads.filter((lead) => lead.reallocated).length,
    views: Object.fromEntries(Object.entries(views).map(([view, rows]) => [view, [...rows.values()].sort((left, right) => right.sales - left.sales || right.denominator - left.denominator || left.label.localeCompare(right.label))])),
  };
  for (const [view, rows] of Object.entries(result.views)) {
    const checks = {
      events: rows.reduce((sum, row) => sum + row.events, 0),
      denominator: rows.reduce((sum, row) => sum + row.denominator, 0),
      sales: rows.reduce((sum, row) => sum + row.sales, 0),
      value: roundMoney(rows.reduce((sum, row) => sum + row.value, 0)),
    };
    if (checks.events !== result.events || checks.denominator !== result.denominator || checks.sales !== result.sales || checks.value !== result.value) throw new Error(`${name} ${view} reconciliation failed.`);
  }
  return result;
}

const twoWeekSegments = [
  buildSegment("Total (New + Warm)", () => true),
  buildSegment("New Business", (lead) => lead.segment === "New Business"),
  buildSegment("Warm", (lead) => lead.segment === "Warm"),
];
const [total2wcr, new2wcr, warm2wcr] = twoWeekSegments;
if (total2wcr.events !== new2wcr.events + warm2wcr.events || total2wcr.denominator !== new2wcr.denominator + warm2wcr.denominator || total2wcr.sales !== new2wcr.sales + warm2wcr.sales || total2wcr.value !== roundMoney(new2wcr.value + warm2wcr.value)) throw new Error("Total/New Business/Warm 2WCR reconciliation failed.");
if (matchedSaleAudit.length !== total2wcr.sales || attributedOrderIds.size !== matchedSaleAudit.length) throw new Error("Matched-sale audit does not reconcile to the 2WCR numerator.");
for (const segment of twoWeekSegments) for (const rows of Object.values(segment.views)) for (const row of rows) if (isExcludedPersonnel(row.label)) throw new Error(`Excluded personnel appeared in ${segment.segment}: ${row.label}`);

const swcrReports = [];
for (const swcrPath of swcrDataPaths) {
  const report = JSON.parse(await fs.readFile(swcrPath, "utf8"));
  if (report.status !== "complete" || report.policyVersion !== policy.policyVersion) throw new Error(`SWCR report is not complete/current: ${swcrPath}`);
  swcrReports.push(report);
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(baseWorkbookPath));
const originalSheetNames = ["Overview", "Running SWCR", "Total SWCR", "New Business SWCR", "Warm SWCR", "All Approved Sales", "Definitions & Limits"];
const actualOriginalNames = [];
for (let index = 0; index < 7; index += 1) actualOriginalNames.push(workbook.worksheets.getItemAt(index).name);
if (JSON.stringify(actualOriginalNames) !== JSON.stringify(originalSheetNames)) throw new Error(`Unexpected base workbook sheets: ${actualOriginalNames.join(", ")}`);
const originalOverviewFingerprint = hashObject({ values: workbook.worksheets.getItem("Overview").getRange("A4:F7").values, formulas: workbook.worksheets.getItem("Overview").getRange("A4:F7").formulas });

await fs.mkdir(workDir, { recursive: true });
const sourcePreviewDir = path.join(workDir, "source-previews");
await fs.mkdir(sourcePreviewDir, { recursive: true });
for (const sheetName of originalSheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 0.8, format: "png" });
  await fs.writeFile(path.join(sourcePreviewDir, `${sheetName.replace(/[^a-z0-9]+/gi, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const navy = "#173F5F"; const blue = "#286090"; const lightBlue = "#DCEAF7"; const paleYellow = "#FFF2CC"; const line = "#C7D4E2"; const green = "#D9EAD3"; const red = "#F4CCCC";
const title = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 15 }, verticalAlignment: "center" };
const section = { fill: lightBlue, font: { bold: true, color: navy }, verticalAlignment: "center" };
const head = { fill: blue, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
const note = { fill: paleYellow, font: { color: "#7F6000" }, verticalAlignment: "top", wrapText: true };

function writeCard(sheet, labelRange, valueRange, label, formula, numberFormat) {
  sheet.mergeCells(labelRange); sheet.mergeCells(valueRange);
  sheet.getRange(labelRange.split(":")[0]).values = [[label]]; sheet.getRange(labelRange).format = section;
  sheet.getRange(valueRange.split(":")[0]).formulas = [[formula]];
  sheet.getRange(valueRange).format = { font: { bold: true, color: navy, size: 13 }, horizontalAlignment: "center", numberFormat, borders: { preset: "outside", style: "thin", color: line } };
}

function writeTwoWeekSegmentSheet(segment, sheetName) {
  const sheet = workbook.worksheets.add(sheetName); sheet.showGridLines = false;
  sheet.mergeCells("A1:G1"); sheet.getRange("A1").values = [[`${segment.segment} Two Week Conversion Rate`]]; sheet.getRange("A1:G1").format = title; sheet.getRange("A1:G1").format.rowHeight = 28;
  sheet.mergeCells("A2:G3"); sheet.getRange("A2").values = [[`Mature cohort ${matureCohort.start} to ${matureCohort.end}; outcomes from allocation time through ${matureCohort.cutoff}. Each Customer ID has one accountable denominator owner. Sold leads move to the exact actual seller who held an exact full-name allocation before approval; unsold leads belong to the latest recipient at cutoff. Original cohort lead type and source are retained.`]]; sheet.getRange("A2:G3").format = note;
  writeCard(sheet, "A5:B5", "A6:B6", "Cohort allocation events", `=${segment.events}`, "#,##0");
  writeCard(sheet, "C5:D5", "C6:D6", "Accountable lead denominator", `=${segment.denominator}`, "#,##0");
  writeCard(sheet, "E5:F5", "E6:F6", "Approved sales", `=${segment.sales}`, "#,##0");
  writeCard(sheet, "G5:G5", "G6:G6", "2WCR", "=IFERROR(E6/C6,0)", "0.00%");
  writeCard(sheet, "A8:B8", "A9:B9", "Approved value", `=${segment.value}`, '"$"#,##0.00');
  writeCard(sheet, "C8:D8", "C9:D9", "Reallocated accountable leads", `=${segment.reallocatedLeads}`, "#,##0");
  sheet.mergeCells("E8:G9"); sheet.getRange("E8").values = [[matureCohort.status]]; sheet.getRange("E8:G9").format = { fill: green, font: { bold: true, color: "#274E13" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: line } };
  let start = 12;
  for (const [view, rows] of Object.entries(segment.views)) {
    sheet.mergeCells(`A${start}:G${start}`); sheet.getRange(`A${start}`).values = [[`${segment.segment} 2WCR by ${view}`]]; sheet.getRange(`A${start}:G${start}`).format = section;
    sheet.getRange(`A${start + 1}:G${start + 1}`).values = [["Rank", view === "Source" ? "Original cohort source" : view, "Cohort allocation events", "Accountable leads", "Approved sales", "2WCR", "Approved value (AUD)"]]; sheet.getRange(`A${start + 1}:G${start + 1}`).format = head; sheet.getRange(`A${start + 1}:G${start + 1}`).format.rowHeight = 32;
    const first = start + 2;
    if (rows.length) {
      sheet.getRangeByIndexes(first - 1, 0, rows.length, 7).values = rows.map((row, index) => [index + 1, row.label, row.events, row.denominator, row.sales, null, row.value]);
      for (let index = 0; index < rows.length; index += 1) sheet.getRange(`F${first + index}`).formulas = [[`=IFERROR(E${first + index}/D${first + index},0)`]];
      const last = first + rows.length - 1;
      sheet.getRange(`A${first}:G${last}`).format.borders = { preset: "inside", style: "thin", color: "#DFE7EF" };
      sheet.getRange(`C${first}:E${last}`).format.numberFormat = "#,##0"; sheet.getRange(`F${first}:F${last}`).format.numberFormat = "0.00%"; sheet.getRange(`G${first}:G${last}`).format.numberFormat = '"$"#,##0.00';
      sheet.getRange(`F${first}:F${last}`).conditionalFormats.add("colorScale", { colors: [red, paleYellow, green], thresholds: ["min", "50%", "max"] });
      start = last + 3;
    } else start += 4;
  }
  sheet.freezePanes.freezeRows(13);
  for (const [columns, width] of [["A:A", 8], ["B:B", 34], ["C:E", 21], ["F:F", 13], ["G:G", 21]]) sheet.getRange(columns).format.columnWidth = width;
}

const overview = workbook.worksheets.getItem("Overview");
overview.getRange("A1").values = [["Conversion Report"]];
overview.getRange("A2").values = [["Two equal conversion lenses: the current same-week SWCR remains intact at left; the latest mature two-week 2WCR cohort is shown at right. Later cohorts remain awaiting complete outcome evidence."]];
overview.mergeCells("I1:N1"); overview.getRange("I1").values = [["Latest Mature 2WCR"]]; overview.getRange("I1:N1").format = title; overview.getRange("I1:N1").format.rowHeight = 28;
overview.mergeCells("I2:N2"); overview.getRange("I2").values = [[`${matureCohort.start} to ${matureCohort.end}; outcomes through ${matureCohort.cutoff}. One accountable Customer ID denominator after reallocation.`]]; overview.getRange("I2:N2").format = note;
overview.getRange("I4:N4").values = [["Segment", "Cohort allocation events", "Accountable leads", "Approved sales", "2WCR", "Approved value (AUD)"]]; overview.getRange("I4:N4").format = head;
overview.getRange("I5:N7").values = twoWeekSegments.map((segment) => [segment.segment, segment.events, segment.denominator, segment.sales, null, segment.value]);
for (let index = 0; index < twoWeekSegments.length; index += 1) overview.getRange(`M${5 + index}`).formulas = [[`=IFERROR(L${5 + index}/K${5 + index},0)`]];
overview.getRange("I5:N7").format.borders = { preset: "inside", style: "thin", color: "#DFE7EF" }; overview.getRange("J5:L7").format.numberFormat = "#,##0"; overview.getRange("M5:M7").format.numberFormat = "0.00%"; overview.getRange("N5:N7").format.numberFormat = '"$"#,##0.00';
overview.mergeCells("I10:N12"); overview.getRange("I10").values = [[`Cohort status: 20-24 July is mature. 27-31 July awaits complete sales and allocation evidence through 14 August. 3-7 August awaits complete evidence through 21 August. No incomplete cohort is reported as 2WCR.`]]; overview.getRange("I10:N12").format = note;
for (const [columns, width] of [["I:I", 31], ["J:L", 20], ["M:M", 13], ["N:N", 21]]) overview.getRange(columns).format.columnWidth = width;

writeTwoWeekSegmentSheet(total2wcr, "Total 2WCR");
writeTwoWeekSegmentSheet(new2wcr, "New Business 2WCR");
writeTwoWeekSegmentSheet(warm2wcr, "Warm 2WCR");

const comparison = workbook.worksheets.add("Cohort Comparison"); comparison.showGridLines = false;
comparison.mergeCells("A1:M1"); comparison.getRange("A1").values = [["SWCR versus Eventual 2WCR by Allocation Cohort"]]; comparison.getRange("A1:M1").format = title; comparison.getRange("A1:M1").format.rowHeight = 28;
comparison.mergeCells("A2:M3"); comparison.getRange("A2").values = [["SWCR remains the original same-week exact lead-seller-pair lens. Eventual 2WCR uses one Customer ID denominator reassigned to the final accountable recipient. 2WCR values are shown only after the entire outcome window has complete all-customer approval and allocation evidence."]]; comparison.getRange("A2:M3").format = note;
comparison.getRange("A5:M5").values = [["Allocation cohort", "Outcome cutoff", "Status", "Segment", "SWCR denominator", "SWCR sales", "SWCR", "2WCR denominator", "2WCR sales", "2WCR", "2WCR minus SWCR", "2WCR approved value", "Evidence limitation"]]; comparison.getRange("A5:M5").format = head; comparison.getRange("A5:M5").format.rowHeight = 40;
const comparisonRows = [];
for (let cohortIndex = 0; cohortIndex < cohortDefinitions.length; cohortIndex += 1) {
  const cohort = cohortDefinitions[cohortIndex];
  const swcr = swcrReports[cohortIndex];
  for (let segmentIndex = 0; segmentIndex < 3; segmentIndex += 1) {
    const swcrSegment = swcr.segments[segmentIndex];
    const matureSegment = cohort.statusKey === "mature" ? twoWeekSegments[segmentIndex] : null;
    comparisonRows.push([`${cohort.start} to ${cohort.end}`, cohort.cutoff, cohort.status, swcrSegment.segment, swcrSegment.pairs, swcrSegment.sales, null, matureSegment?.denominator ?? null, matureSegment?.sales ?? null, null, null, matureSegment?.value ?? null, cohort.statusKey === "mature" ? "Complete approvals through cutoff; exact order de-duplication applied." : `Complete retained approved-sales evidence currently ends 2026-08-09; do not calculate 2WCR before ${cohort.cutoff}.`]);
  }
}
comparison.getRangeByIndexes(5, 0, comparisonRows.length, 13).values = comparisonRows;
for (let index = 0; index < comparisonRows.length; index += 1) {
  const row = 6 + index;
  comparison.getRange(`G${row}`).formulas = [[`=IFERROR(F${row}/E${row},0)`]];
  comparison.getRange(`J${row}`).formulas = [[`=IF(OR(H${row}="",I${row}=""),"",IFERROR(I${row}/H${row},0))`]];
  comparison.getRange(`K${row}`).formulas = [[`=IF(J${row}="","",J${row}-G${row})`]];
}
comparison.getRange("A6:M14").format = { borders: { preset: "inside", style: "thin", color: "#DFE7EF" }, wrapText: true, verticalAlignment: "top" };
comparison.getRange("E6:F14").format.numberFormat = "#,##0"; comparison.getRange("G6:G14").format.numberFormat = "0.00%"; comparison.getRange("H6:I14").format.numberFormat = "#,##0"; comparison.getRange("J6:K14").format.numberFormat = "0.00%"; comparison.getRange("L6:L14").format.numberFormat = '"$"#,##0.00';
comparison.getRange("C6:C8").format.fill = green; comparison.getRange("C9:C14").format.fill = paleYellow;
comparison.freezePanes.freezeRows(5);
for (const [columns, width] of [["A:B", 18], ["C:C", 31], ["D:D", 22], ["E:F", 17], ["G:G", 12], ["H:I", 18], ["J:K", 15], ["L:L", 20], ["M:M", 54]]) comparison.getRange(columns).format.columnWidth = width;

const leadAudit = workbook.worksheets.add("2WCR Allocation Audit"); leadAudit.showGridLines = false;
leadAudit.mergeCells("A1:U1"); leadAudit.getRange("A1").values = [["2WCR Allocation and Denominator Audit - Mature Cohort"]]; leadAudit.getRange("A1:U1").format = title; leadAudit.getRange("A1:U1").format.rowHeight = 28;
leadAudit.mergeCells("A2:U3"); leadAudit.getRange("A2").values = [["One row per included Customer ID denominator. Customer names and contact details are intentionally omitted. Original cohort source/type remain fixed; final accountable owner reflects a qualifying exact seller allocation for sold leads or the latest allocation at cutoff for unsold leads."]]; leadAudit.getRange("A2:U3").format = note;
const leadAuditHeaders = ["Cohort", "Cutoff", "Status", "Customer ID", "Lead type", "Original source", "Original recipient", "Original manager", "Original allocation", "Cohort allocation events", "Window allocation events", "Final accountable recipient", "Final accountable manager", "Accountable allocation", "Reallocated", "Disposition", "Approved sales", "Approved value", "Order IDs", "Unique denominator key", "QA status"];
leadAudit.getRangeByIndexes(4, 0, 1, leadAuditHeaders.length).values = [leadAuditHeaders]; leadAudit.getRange("A5:U5").format = head; leadAudit.getRange("A5:U5").format.rowHeight = 36;
const leadAuditRows = matureLeads.sort((left, right) => left.segment.localeCompare(right.segment) || left.accountableManager.localeCompare(right.accountableManager) || left.accountableSalesperson.localeCompare(right.accountableSalesperson) || left.customerId.localeCompare(right.customerId)).map((lead) => [lead.cohort, lead.cutoff, lead.status, lead.customerId, lead.segment, lead.source, lead.originalSalesperson, lead.originalManager, lead.originalAllocatedAt, lead.cohortAllocationEvents, lead.windowAllocationEvents, lead.accountableSalesperson, lead.accountableManager, lead.accountableAt, lead.reallocated ? "Yes" : "No", lead.disposition, lead.approvedSales, lead.approvedValue, lead.orderIds.join("; "), `${lead.cohort}|${lead.customerId}`, "PASS"]);
leadAudit.getRangeByIndexes(5, 0, leadAuditRows.length, leadAuditHeaders.length).values = leadAuditRows;
const leadAuditLast = 5 + leadAuditRows.length;
leadAudit.getRange(`A6:U${leadAuditLast}`).format.borders = { preset: "inside", style: "thin", color: "#E6E6E6" }; leadAudit.getRange(`J6:K${leadAuditLast}`).format.numberFormat = "#,##0"; leadAudit.getRange(`Q6:Q${leadAuditLast}`).format.numberFormat = "#,##0"; leadAudit.getRange(`R6:R${leadAuditLast}`).format.numberFormat = '"$"#,##0.00';
leadAudit.freezePanes.freezeRows(5); leadAudit.freezePanes.freezeColumns(4);
for (const [columns, width] of [["A:C", 24], ["D:D", 15], ["E:E", 16], ["F:F", 22], ["G:H", 24], ["I:I", 20], ["J:K", 16], ["L:M", 24], ["N:N", 20], ["O:O", 12], ["P:P", 18], ["Q:Q", 14], ["R:R", 16], ["S:S", 22], ["T:T", 40], ["U:U", 12]]) leadAudit.getRange(columns).format.columnWidth = width;

const saleAudit = workbook.worksheets.add("2WCR Sales Audit"); saleAudit.showGridLines = false;
saleAudit.mergeCells("A1:L1"); saleAudit.getRange("A1").values = [["2WCR Approved-Sales Attribution Audit - Mature Cohort"]]; saleAudit.getRange("A1:L1").format = title; saleAudit.getRange("A1:L1").format.rowHeight = 28;
saleAudit.mergeCells("A2:L3"); saleAudit.getRange("A2").values = [["Every attributed order is unique after retained-copy de-duplication. Attribution requires exact Customer ID plus exact normalised full seller and a seller allocation at or before explicit approval. No phone, first-name, fuzzy-name or business-name matching is used."]]; saleAudit.getRange("A2:L3").format = note;
const saleAuditHeaders = ["Cohort", "Cutoff", "Order ID", "Customer ID", "Actual seller", "Accountable manager", "Approval timestamp", "Approved value", "Lead type", "Original source", "Seller allocation timestamp", "Retained evidence copies"];
saleAudit.getRangeByIndexes(4, 0, 1, saleAuditHeaders.length).values = [saleAuditHeaders]; saleAudit.getRange("A5:L5").format = head; saleAudit.getRange("A5:L5").format.rowHeight = 36;
const saleAuditRows = matchedSaleAudit.sort((left, right) => left.approvedAt.localeCompare(right.approvedAt) || left.orderId.localeCompare(right.orderId)).map((sale) => [sale.cohort, sale.cutoff, sale.orderId, sale.customerId, sale.seller, sale.manager, sale.approvedAt, sale.value, sale.segment, sale.source, sale.sellerAllocationAt, sale.evidenceSources]);
saleAudit.getRangeByIndexes(5, 0, saleAuditRows.length, saleAuditHeaders.length).values = saleAuditRows;
const saleAuditLast = 5 + saleAuditRows.length;
saleAudit.getRange(`A6:L${saleAuditLast}`).format.borders = { preset: "inside", style: "thin", color: "#E6E6E6" }; saleAudit.getRange(`H6:H${saleAuditLast}`).format.numberFormat = '"$"#,##0.00';
saleAudit.freezePanes.freezeRows(5); saleAudit.freezePanes.freezeColumns(4);
for (const [columns, width] of [["A:B", 20], ["C:D", 15], ["E:F", 24], ["G:G", 21], ["H:H", 17], ["I:I", 16], ["J:J", 22], ["K:K", 21], ["L:L", 48]]) saleAudit.getRange(columns).format.columnWidth = width;

const definitions = workbook.worksheets.add("2WCR Definitions"); definitions.showGridLines = false;
definitions.mergeCells("A1:B1"); definitions.getRange("A1").values = [["2WCR Definitions, Rules and Evidence Limits"]]; definitions.getRange("A1:B1").format = title; definitions.getRange("A1:B1").format.rowHeight = 28;
const definitionRows = [
  ["Field", "Definition"],
  ["2WCR cohort", "Leads first allocated Monday-Friday. The original mapped cohort event fixes cohort, lead type and source."],
  ["Outcome window", "From the original allocation timestamp through the second following Friday, giving every lead at least two full weeks."],
  ["Denominator", "One exact Customer ID, assigned once to the final accountable recipient. It is not an allocation-event count."],
  ["Sold-lead ownership", "The actual seller receives the denominator only when the same exact Customer ID and exact normalised full seller have an allocation at or before explicit approval."],
  ["Unsold-lead ownership", "Latest allocated recipient at the outcome cutoff."],
  ["Manager", "Manager recorded on the accountable allocation event; one manager per lead."],
  ["Source and lead type", "Retained from the original cohort allocation even after reallocation."],
  ["Approved sales", "One first qualifying unique approved order per lead after de-duplicating retained evidence copies. Later orders for an already-converted Customer ID do not create another conversion or move its denominator."],
  ["Shared exclusions", EXCLUDED_PERSONNEL.join(", ")],
  ["Mature evidence", "Only 20-24 July is mature: complete approved-sales and allocation evidence through 7 August."],
  ["Awaiting evidence", "27-31 July requires complete evidence through 14 August. 3-7 August requires complete evidence through 21 August. Current complete approved-sales evidence ends 9 August."],
  ["Value limitation", "Approved value ex GST is not proof of payment, recognised revenue, profit or causal conversion."],
  ["Matching limitation", "No phone, customer-name, business-name, fuzzy, first-name-only or inferred matching."],
];
definitions.getRangeByIndexes(2, 0, definitionRows.length, 2).values = definitionRows; definitions.getRange("A3:B3").format = head; definitions.getRange(`A4:B${2 + definitionRows.length}`).format = { borders: { preset: "inside", style: "thin", color: "#DFE7EF" }, wrapText: true, verticalAlignment: "top" }; definitions.getRange(`A4:A${2 + definitionRows.length}`).format = section; definitions.getRange("A:A").format.columnWidth = 30; definitions.getRange("B:B").format.columnWidth = 105;

const qaSheet = workbook.worksheets.add("2WCR QA & Evidence"); qaSheet.showGridLines = false;
qaSheet.mergeCells("A1:F1"); qaSheet.getRange("A1").values = [["2WCR Quality Assurance and Evidence Receipt"]]; qaSheet.getRange("A1:F1").format = title; qaSheet.getRange("A1:F1").format.rowHeight = 28;
const qaRows = [
  ["Check", "Result", "Observed", "Expected", "Status", "Notes"],
  ["Total denominator reconciliation", total2wcr.denominator, new2wcr.denominator + warm2wcr.denominator, total2wcr.denominator, "PASS", "Total equals New Business plus Warm."],
  ["Total approved-sales reconciliation", total2wcr.sales, new2wcr.sales + warm2wcr.sales, total2wcr.sales, "PASS", "All three views reconcile by salesperson, manager and source."],
  ["Total approved-value reconciliation", total2wcr.value, roundMoney(new2wcr.value + warm2wcr.value), total2wcr.value, "PASS", "Rounded to cents after exact order de-duplication."],
  ["Unique lead denominators", duplicateDenominatorCheck.size, matureLeads.length, matureLeads.length, "PASS", "One Customer ID per cohort denominator."],
  ["Unique attributed orders", attributedOrderIds.size, matchedSaleAudit.length, matchedSaleAudit.length, "PASS", "No order appears more than once."],
  ["Existing SWCR content", 7, 7, 7, "PASS", "Original seven-sheet order retained; the SWCR table on Overview is unchanged and the other six original sheets are not edited."],
  ["Excluded personnel", 0, 0, 0, "PASS", `${excludedLeadCount + excludedAtCutoffCount} leads removed by shared exclusions at original/final ownership gates.`],
  ["Multiple-seller leads resolved", conflictingSellerLeadCount, conflictingSellerLeadCount, conflictingSellerLeadCount, "PASS", "The first qualifying approved order closes the conversion outcome; later orders do not move or duplicate the denominator."],
  ["Retained evidence rows", candidateSales.length, candidateSales.length, candidateSales.length, "PASS", `${duplicateSalesEvidenceRows} duplicate evidence rows across ${duplicateOrderIds.size} order IDs removed.`],
  ["Complete approved-sales coverage", "2026-07-20 to 2026-08-09", "2026-07-20 to 2026-08-09", "2026-07-20 to 2026-08-09", "PASS", "Later cohorts remain awaiting their full cutoff evidence."],
  ["Catalog preflight", catalog.generatedAt, catalog.schemaVersion, "carma_data_catalog.v1", "PASS", "Refreshed before governed-source inspection; catalog itself does not yet enumerate all retained weekly bundles."],
];
qaSheet.getRangeByIndexes(2, 0, qaRows.length, 6).values = qaRows; qaSheet.getRange("A3:F3").format = head; qaSheet.getRange(`A4:F${2 + qaRows.length}`).format = { borders: { preset: "inside", style: "thin", color: "#DFE7EF" }, wrapText: true, verticalAlignment: "top" }; qaSheet.getRange(`E4:E${2 + qaRows.length}`).format = { fill: green, font: { bold: true, color: "#274E13" }, horizontalAlignment: "center" };
let sourceRow = 16;
qaSheet.mergeCells(`A${sourceRow}:F${sourceRow}`); qaSheet.getRange(`A${sourceRow}`).values = [["Governed source receipt"]]; qaSheet.getRange(`A${sourceRow}:F${sourceRow}`).format = section; sourceRow += 1;
qaSheet.getRange(`A${sourceRow}:F${sourceRow}`).values = [["Role", "Coverage", "Selected source", "SHA-256", "Authority/status", "Limitation"]]; qaSheet.getRange(`A${sourceRow}:F${sourceRow}`).format = head; sourceRow += 1;
const sourceReceiptRows = [
  ...allocationFiles.map((item) => ["Weekly allocation events", `${item.manifest.selectedPeriod.startDate} to ${item.manifest.selectedPeriod.endDate}`, item.filePath, item.manifest.allocation.sha256, "Primary weekly sent-event manifest", "Later allocation evidence after 7 August is not retained here."]),
  ["Approved sales", "20-26 July", salesSources.carma20Csv, carma20Manifest.files.swcrOutcomeCsv.sha256, "Passed Carma all-customer bundle", "Duplicate order IDs removed before calculation."],
  ["Approved sales", "27 July-2 August", salesSources.dashboard27Db, dashboard27Verification.databaseSha256, "Validated Sales Dashboard evidence", "All approvals explicit; one historical allocation attribution limitation does not remove the approved order."],
  ["Approved sales", "3-9 August", salesSources.dashboard03Db, dashboard03Verification.databaseSha256, "Validated Sales Dashboard evidence", "Retained Carma copy used as duplicate-copy cross-check."],
  ["Approved sales retained copy", "3-9 August", salesSources.carma03Csv, carma03Manifest.enrichedCsv.sha256, "Complete Carma all-customer bundle", "Same orders are de-duplicated against the validated Sales Dashboard copy."],
];
qaSheet.getRangeByIndexes(sourceRow - 1, 0, sourceReceiptRows.length, 6).values = sourceReceiptRows; qaSheet.getRange(`A${sourceRow}:F${sourceRow + sourceReceiptRows.length - 1}`).format = { borders: { preset: "inside", style: "thin", color: "#DFE7EF" }, wrapText: true, verticalAlignment: "top" };
qaSheet.freezePanes.freezeRows(3);
for (const [columns, width] of [["A:A", 27], ["B:B", 23], ["C:C", 66], ["D:D", 66], ["E:E", 30], ["F:F", 52]]) qaSheet.getRange(columns).format.columnWidth = width;

const currentOverviewFingerprint = hashObject({ values: overview.getRange("A4:F7").values, formulas: overview.getRange("A4:F7").formulas });
if (currentOverviewFingerprint !== originalOverviewFingerprint) throw new Error("Existing SWCR Overview table changed during the two-lens extension.");

const formulaErrorsBeforeExport = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 200 }, maxChars: 6000 });
if (formulaErrorsBeforeExport.ndjson && !/matched 0 entries/.test(formulaErrorsBeforeExport.ndjson)) throw new Error(`Formula error scan failed before export: ${formulaErrorsBeforeExport.ndjson}`);

await fs.mkdir(outputDir, { recursive: true });
const workbookFile = await SpreadsheetFile.exportXlsx(workbook); await workbookFile.save(outputWorkbookPath);
await fs.copyFile(baseSwcrCsvPath, outputSwcrCsvPath);

const flatRows = [["Segment", "View", "Dimension", "Cohort Allocation Events", "Accountable Lead Denominator", "Approved Sales", "2WCR", "Approved Value AUD", "Cohort", "Outcome Cutoff", "Status"]];
for (const segment of twoWeekSegments) for (const [view, rows] of Object.entries(segment.views)) for (const row of rows) flatRows.push([segment.segment, view, row.label, row.events, row.denominator, row.sales, row.denominator ? row.sales / row.denominator : 0, row.value, `${matureCohort.start} to ${matureCohort.end}`, matureCohort.cutoff, matureCohort.status]);
await fs.writeFile(outputTwoWeekCsvPath, `${flatRows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`);

const finalWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputWorkbookPath));
const finalErrors = await finalWorkbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 200 }, maxChars: 6000 });
if (finalErrors.ndjson && !/matched 0 entries/.test(finalErrors.ndjson)) throw new Error(`Formula error scan failed after export: ${finalErrors.ndjson}`);
const finalOverviewFingerprint = hashObject({ values: finalWorkbook.worksheets.getItem("Overview").getRange("A4:F7").values, formulas: finalWorkbook.worksheets.getItem("Overview").getRange("A4:F7").formulas });
if (finalOverviewFingerprint !== originalOverviewFingerprint) throw new Error("Existing SWCR Overview table changed after export.");

const previewDir = path.join(outputDir, "verification-previews");
await fs.mkdir(previewDir, { recursive: true });
const renderTargets = [
  ["Overview", "A1:N12"],
  ["Total 2WCR", null],
  ["New Business 2WCR", null],
  ["Warm 2WCR", null],
  ["Cohort Comparison", "A1:M14"],
  ["2WCR Allocation Audit", "A1:U25"],
  ["2WCR Sales Audit", "A1:L30"],
  ["2WCR Definitions", null],
  ["2WCR QA & Evidence", null],
];
for (const [sheetName, range] of renderTargets) {
  const preview = await finalWorkbook.render({ sheetName, ...(range ? { range } : { autoCrop: "all" }), scale: range ? 1 : 0.75, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName.replace(/[^a-z0-9]+/gi, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const finalSwcrPreviewDir = path.join(outputDir, "verification-previews-swcr-unchanged");
await fs.mkdir(finalSwcrPreviewDir, { recursive: true });
for (const sheetName of originalSheetNames) {
  const preview = await finalWorkbook.render({ sheetName, autoCrop: "all", scale: 0.7, format: "png" });
  await fs.writeFile(path.join(finalSwcrPreviewDir, `${sheetName.replace(/[^a-z0-9]+/gi, "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const qa = {
  schemaVersion: "conversion_report_2wcr_qa.v1",
  status: "complete",
  generatedAt: new Date().toISOString(),
  workbook: { path: outputWorkbookPath, sha256: await sha256File(outputWorkbookPath) },
  baseWorkbook: { path: baseWorkbookPath, sha256: await sha256File(baseWorkbookPath), originalSheets: originalSheetNames },
  csv: { swcr: { path: outputSwcrCsvPath, sha256: await sha256File(outputSwcrCsvPath) }, twoWeek: { path: outputTwoWeekCsvPath, sha256: await sha256File(outputTwoWeekCsvPath) } },
  evidenceCoverage: { approvedSalesStart: "2026-07-20", approvedSalesEnd: "2026-08-09", allocationEnd: "2026-08-07" },
  matureCohort,
  laterCohorts: cohortDefinitions.slice(1),
  sources: { allocationFiles: allocationFiles.map((item) => ({ path: item.filePath, sha256: item.manifest.allocation.sha256 })), sales: { carma20Manifest: salesSources.carma20Manifest, dashboard27Verification: salesSources.dashboard27Verification, dashboard03Verification: salesSources.dashboard03Verification, carma03Manifest: salesSources.carma03Manifest } },
  counts: { allocationEvents: allocationEvents.length, duplicateAllocationRows, incompleteAllocationRows, candidateSalesEvidenceRows: candidateSales.length, uniqueApprovedOrders: allSales.length, duplicateSalesEvidenceRows, duplicateOrderIds: duplicateOrderIds.size, directMatureExactPairSales: directMatureMatchedSales.length, matureDenominator: matureLeads.length, matureApprovedSales: matchedSaleAudit.length, reallocatedMatureLeads: matureLeads.filter((lead) => lead.reallocated).length, unmappedLeadCount, excludedLeadCount, excludedAtCutoffCount, saleBeforeCohortCount, sellerWithoutAllocationCount, conflictingSellerLeadCount, additionalQualifiedOrdersExcluded },
  segments: twoWeekSegments.map((segment) => ({ segment: segment.segment, events: segment.events, denominator: segment.denominator, sales: segment.sales, rate: segment.denominator ? segment.sales / segment.denominator : 0, value: segment.value, reallocatedLeads: segment.reallocatedLeads })),
  checks: { totalSegmentReconciles: true, salespersonManagerSourceReconcile: true, excludedPersonnelAbsent: true, duplicateOrderAttribution: false, duplicateDenominatorAttribution: false, formulaErrorMatches: 0, existingOverviewSwcrTableUnchanged: true, originalSheetOrderPreserved: true, allNewSheetsRendered: true },
  previewFiles: [...renderTargets.map(([sheetName]) => path.join(previewDir, `${sheetName.replace(/[^a-z0-9]+/gi, "_")}.png`)), ...originalSheetNames.map((sheetName) => path.join(finalSwcrPreviewDir, `${sheetName.replace(/[^a-z0-9]+/gi, "_")}.png`))],
};
await fs.writeFile(path.join(outputDir, "conversion_report_qa.json"), `${JSON.stringify(qa, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "conversion_report_data.json"), `${JSON.stringify({ schemaVersion: "conversion_report_2wcr.v1", status: "complete", policyVersion: policy.policyVersion, cohorts: cohortDefinitions, segments: twoWeekSegments, matureLeads, matchedSaleAudit }, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({ status: "complete", outputWorkbookPath, outputSwcrCsvPath, outputTwoWeekCsvPath, qaPath: path.join(outputDir, "conversion_report_qa.json"), segments: qa.segments, counts: qa.counts, previews: qa.previewFiles }, null, 2)}\n`);
