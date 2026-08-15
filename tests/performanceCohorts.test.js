"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  buildPerformanceDrilldown,
  buildPerformanceCohortsReport,
  loadPerformanceCohorts,
  publicPerformanceCohorts,
  resolvePerformanceConfig
} = require("../src/performanceCohorts");
const { readValidatedCarmaFacts } = require("../src/carmaEvidence");
const { renderDrilldownPage } = require("../src/dashboardRenderer");
const { rowsToCsv } = require("../src/sourceFile");
const { createServer, isLoopbackHost, startServer } = require("../src/main");
const {
  EXCLUDED_PERSONNEL,
  configurePersonnelExclusions
} = require("../src/personnelExclusions");

const allocationColumns = [
  "CustomerID",
  "CompanyName",
  "FullName",
  "SalesManager",
  "DateSentToSalesperson_Date",
  "DateSentToSalesperson_Time",
  "AllocationName",
  "AllocationItemID",
  "SalesPersonID",
  "DataSource",
  "CustomerImportSource",
  "LeadImportDate_Date"
];
const callColumns = ["call_id", "customer_id", "UserID", "call_date", "call_time", "Salesperson"];
const callColumnsWithFoundCustomer = [...callColumns, "FoundCustomerID"];

function allocation(overrides = {}) {
  return {
    CustomerID: "customer-1",
    CompanyName: "Example Customer",
    FullName: "Riley Example",
    SalesManager: "Morgan Manager",
    DateSentToSalesperson_Date: "2026-07-20",
    DateSentToSalesperson_Time: "09:00:00",
    AllocationName: "Fresh Leads",
    AllocationItemID: "allocation-1",
    SalesPersonID: "allocation-user-1",
    DataSource: "GoogleMaps",
    CustomerImportSource: "GoogleMaps",
    LeadImportDate_Date: "2026-07-01",
    ...overrides
  };
}

function call(overrides = {}) {
  return {
    call_id: "call-1",
    customer_id: "customer-1",
    UserID: "call-user-1",
    call_date: "7/20/2026 12:00:00 AM",
    call_time: "10:00:00",
    Salesperson: "Riley Example",
    ...overrides
  };
}

function sale(overrides = {}) {
  return {
    order_id: "order-1",
    run_id: "sales-run-1",
    customer_id: "customer-1",
    customer_name: "Example Customer",
    actual_seller: "Riley Example",
    sale_approved_at: "2026-07-20T10:30:00.000Z",
    sale_value: 500,
    acquisition_source_type: "Google Maps",
    acquisition_source_proven: 1,
    lead_source_classification: "Company Sourced",
    lead_source_classification_rule_version: "actual_seller_any_pre_sale_allocation.v1",
    seller_allocated_before_sale: 1,
    seller_allocation_date: "2026-07-20T09:00:00.000Z",
    historical_allocation_id: "historical-allocation-1",
    historical_allocation_history_id: "history-1",
    historical_allocation_effective_start_at: "2026-07-20T09:00:00.000Z",
    historical_allocation_inactivated_at: "",
    historical_allocation_recipient: "Riley Example",
    historical_allocation_manager: "Morgan Manager",
    historical_allocation_description: "Fresh Leads",
    historical_allocation_active_at_sale: 1,
    ...overrides
  };
}

function coverage(overrides = {}) {
  const digest = "a".repeat(64);
  return {
    run_id: "sales-run-1",
    dataset_type: "approved_sales",
    population_contract: "carma_approved_sales_show_new_customers_false.v1",
    show_new_customers_only: 0,
    completeness_status: "complete",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    extracted_at: "2026-07-29T00:00:00.000Z",
    source_provenance_id: "provenance-1",
    source_report_sha256: digest,
    source_manifest_sha256: digest,
    extraction_audit_sha256: digest,
    row_count: 2,
    notes: "Fixture coverage",
    ...overrides
  };
}

function fullCallCsv() {
  const columns = [
    "dialled_phone_number", "call_id", "UserID", "Mobile", "CallTotalSeconds", "call_date", "call_time",
    "ring_time_seconds", "call_duration_seconds", "AllocatedLeadID", "customer_id", "ContactId",
    "Baz_DetailedNotes", "transcription_text", "CallType", "call_direction", "NoSaleType", "CustomerCreatedBy",
    "CustomerCreatedByType", "CustomerCreateDate", "CustomerImportDate", "CustomerImportSource", "Salesperson",
    "Prefix", "CallerID", "IsNZCall", "CallRegion", "FoundContactID", "FoundCustomerID", "OrderCount"
  ];
  return rowsToCsv(columns, [{
    dialled_phone_number: "redacted",
    call_id: "call-1",
    UserID: "call-user-1",
    CallTotalSeconds: "62",
    call_date: "7/20/2026 12:00:00 AM",
    call_time: "10:00:00",
    ring_time_seconds: "2",
    call_duration_seconds: "60",
    AllocatedLeadID: "lead-1",
    customer_id: "customer-1",
    ContactId: "contact-1",
    transcription_text: "Outbound call Customer: Hello. Riley Example: Hello.",
    CallType: "Click to dial",
    call_direction: "out",
    CustomerImportDate: "7/01/2026 12:00:00 AM",
    CustomerImportSource: "GoogleMaps",
    Salesperson: "Riley Example"
  }]);
}

function createCarmaFixture(directory) {
  const databasePath = path.join(directory, "carma-evidence.sqlite");
  const db = new DatabaseSync(databasePath);
  const digest = "a".repeat(64);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE extraction_runs (
      run_id TEXT PRIMARY KEY,
      dataset_type TEXT NOT NULL,
      population_contract TEXT NOT NULL,
      show_new_customers_only INTEGER NOT NULL,
      completeness_status TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      extracted_at TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL,
      source_report_sha256 TEXT NOT NULL,
      source_manifest_sha256 TEXT NOT NULL,
      extraction_audit_sha256 TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE crm_source_provenance (provenance_id TEXT PRIMARY KEY);
    CREATE TABLE crm_customers (
      customer_id TEXT PRIMARY KEY,
      customer_import_source_type TEXT NOT NULL,
      customer_import_date TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      order_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      actual_seller TEXT NOT NULL,
      seller_allocation_date TEXT NOT NULL,
      seller_allocated_before_sale INTEGER NOT NULL,
      sale_approved_at TEXT NOT NULL,
      sale_value REAL NOT NULL,
      acquisition_source_type TEXT NOT NULL,
      acquisition_source_proven INTEGER NOT NULL,
      campaign TEXT NOT NULL,
      lead_source_classification TEXT NOT NULL,
      lead_source_classification_rule_version TEXT NOT NULL,
      lead_source_classification_reason TEXT NOT NULL,
      policy_credit_source TEXT NOT NULL,
      allowable_external_credit REAL,
      carma_credited_source TEXT NOT NULL,
      carma_credited_value REAL NOT NULL,
      carma_external_credited_value REAL NOT NULL,
      reporting_finding TEXT NOT NULL,
      direct_reporting_error INTEGER NOT NULL,
      validation_status TEXT NOT NULL,
      run_id TEXT NOT NULL,
      source_provenance_id TEXT NOT NULL
    );
    CREATE TABLE crm_allocations (
      allocation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      effective_start_at TEXT NOT NULL,
      inactivated_at TEXT NOT NULL,
      recipient TEXT NOT NULL,
      sales_manager TEXT NOT NULL,
      description TEXT NOT NULL,
      recipient_exact_seller INTEGER NOT NULL,
      recipient_possible_alias INTEGER NOT NULL,
      started_before_sale INTEGER NOT NULL,
      active_at_sale INTEGER NOT NULL,
      qualifies_seller_within_28_days INTEGER NOT NULL,
      source_provenance_id TEXT NOT NULL
    );
    CREATE TABLE crm_credit_awards (credit_award_id TEXT PRIMARY KEY);
    CREATE TABLE crm_staff_identities (identity_id TEXT PRIMARY KEY);
    CREATE TABLE crm_validation_issues (issue_id TEXT PRIMARY KEY);
    INSERT INTO meta VALUES
      ('schema_version', 'carma_evidence.v3'),
      ('approval_timestamp_semantics', 'australia_sydney_wall_clock_components.v1'),
      ('policy_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('lead_source_classification_rule_version', 'actual_seller_any_pre_sale_allocation.v1'),
      ('external_credit_policy_rule_version', 'seller_allocation_within_28_days_lenient.v1'),
      ('generated_at', '2026-07-29T00:00:00.000Z'),
      ('join_rule', 'exact customer_id only'),
      ('campaign_source_separation', 'enforced');
    INSERT INTO crm_customers VALUES ('customer-1', 'Google Maps', '2026-07-01');
    INSERT INTO extraction_runs VALUES (
      'sales-run-1', 'approved_sales', 'carma_approved_sales_show_new_customers_false.v1',
      0, 'complete', '2026-07-01', '2026-07-31',
      '2026-07-29T00:00:00.000Z', 'provenance-1',
      '${digest}', '${digest}', '${digest}', 1, 'Fixture coverage'
    );
    INSERT INTO crm_orders VALUES (
      'order-1', 'customer-1', 'Example Customer', 'Riley Example',
      '2026-07-20T09:00:00.000Z', 1, '2026-07-20T10:30:00.000Z', 500,
      'Google Maps', 1, 'Fresh Leads',
      'Company Sourced', 'actual_seller_any_pre_sale_allocation.v1',
      'The actual seller had an exact pre-sale allocation.',
      'Google Maps', 500, 'Google Maps', 500, 0,
      'Aligned', 0, 'verified', 'sales-run-1', 'provenance-1'
    );
    INSERT INTO crm_allocations VALUES (
      'historical-allocation-1', 'sales-run-1', 'order-1', 'customer-1',
      'history-1', '2026-07-20T09:00:00.000Z', '', 'Riley Example',
      'Morgan Manager', 'Fresh Leads', 1, 0, 1, 1, 1, 'provenance-1'
    );
  `);
  db.close();
  return databasePath;
}

test("Performance projection fails closed when selected historical allocation proof does not reconcile", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-history-proof-"));
  const databasePath = createCarmaFixture(directory);
  const db = new DatabaseSync(databasePath);
  db.exec(`
    UPDATE crm_orders
    SET seller_allocation_date = '2026-07-19T09:00:00.000Z'
    WHERE order_id = 'order-1'
  `);
  db.close();
  assert.throws(
    () => readValidatedCarmaFacts({ databasePath, projection: "performance" }),
    /do not reconcile to their selected historical seller-allocation proof/i
  );
});

test("performance comparison deduplicates raw events and keeps first-day approved sales in the local period", () => {
  const allocations = [
    allocation(),
    allocation({ AllocationItemID: "allocation-duplicate-id" }),
    allocation({
      CustomerID: "customer-2",
      AllocationItemID: "allocation-2",
      DateSentToSalesperson_Time: "09:05:00"
    })
  ];
  const report = buildPerformanceCohortsReport({
    allocationRows: allocations,
    allocationColumns,
    callRows: [call()],
    callColumns,
    salesRows: [
      sale(),
      sale({ order_id: "order-unmatched", customer_id: "customer-x", actual_seller: "Unmatched Seller" })
    ],
    coverageRows: [coverage()],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.available, true);
  assert.equal(report.totals.rawAllocationRows, 3);
  assert.equal(report.totals.deduplicatedSentEvents, 2);
  assert.equal(report.totals.logicalDuplicateRows, 1);
  assert.equal(report.totals.approvedSalesInPeriod, 2);
  assert.equal(report.totals.approvedSalesWithRecipientLabelMatch, 1);
  assert.equal(report.totals.approvedSalesWithoutRecipientLabelMatch, 1);
  assert.equal(report.comparison.rows[0].customersCalledAfterAllocation, 1);
  assert.equal(report.comparison.rows[0].callWithin24HoursRate, 50);
});

test("weekly call activity reports duration bands and calls per sale without treating duration as contact proof", () => {
  const durationCallColumns = [...callColumns, "call_duration_seconds", "call_direction"];
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [
      call({ call_id: "call-zero", call_time: "09:30:00", call_duration_seconds: "0", call_direction: "out" }),
      call({ call_id: "call-short", call_time: "10:00:00", call_duration_seconds: "20", call_direction: "outbound" }),
      call({ call_id: "call-mid", call_time: "10:30:00", call_duration_seconds: "30", call_direction: "in" }),
      call({ call_id: "call-long", call_time: "11:00:00", call_duration_seconds: "300", call_direction: "out" })
    ],
    callColumns: durationCallColumns,
    salesRows: [sale()],
    coverageRows: [coverage()],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const row = report.comparison.rows[0];
  assert.equal(row.weeklyCallCount, 4);
  assert.equal(row.weeklyOutboundCallCount, 3);
  assert.equal(row.weeklyDurationObservedCalls, 4);
  assert.equal(row.weeklyZeroDurationCalls, 1);
  assert.equal(row.weeklyShortCallCount, 1);
  assert.equal(row.weeklyLongCallCount, 1);
  assert.equal(row.weeklyTotalCallDurationSeconds, 350);
  assert.equal(row.weeklyAverageCallDurationSeconds, 87.5);
  assert.equal(row.weeklyMedianCallDurationSeconds, 25);
  assert.equal(row.weeklyCallsPerApprovedSale, 4);
  assert.equal(report.dataQuality.callDurationCoverageComplete, true);
  assert.match(report.definitions.weeklyCallActivity, /workload ratio, not causal conversion/);
});

test("timestamp exceptions remain in weekly sales totals but never receive source or timing attribution", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [
      sale({ approval_timestamp_status: "explicit" }),
      sale({
        order_id: "order-timestamp-exception",
        customer_id: "customer-2",
        sale_approved_at: "",
        approval_timestamp_status: "unavailable_after_two_read_only_captures",
        lead_source_classification: "Attribution Withheld",
        seller_allocated_before_sale: 0,
        seller_allocation_date: "",
        historical_allocation_id: null,
        historical_allocation_history_id: null,
        historical_allocation_effective_start_at: null,
        historical_allocation_inactivated_at: null,
        historical_allocation_recipient: null,
        historical_allocation_manager: null,
        historical_allocation_description: null,
        historical_allocation_active_at_sale: null
      })
    ],
    coverageRows: [coverage({ period_start: "2026-07-20", period_end: "2026-07-24", row_count: 2 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.available, true);
  assert.equal(report.totals.approvedSalesInPeriod, 2);
  assert.equal(report.totals.approvalTimestampExceptionsInPeriod, 1);
  assert.equal(report.comparison.rows[0].approvedSales, 2);
  assert.equal(report.comparison.rows[0].companySourcedSales, 1);
  assert.equal(report.comparison.rows[0].selfSourcedSales, 0);
  assert.equal(report.comparison.rows[0].attributionWithheldSales, 1);
  const exception = report._evidence.approvedSales.find((row) => row.orderNumber === "order-timestamp-exception");
  assert.equal(exception.leadSourceClassification, "Attribution Withheld");
  assert.equal(exception.approvalDate, "");
  assert.equal(exception.weeklyAllocationMatchStatus, "not_evaluated_approval_timestamp_unavailable");
});

test("mature cohort conversion uses exact customer and exact seller while same-week proxy stays separate", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation({
      DateSentToSalesperson_Date: "2026-01-05",
      DateSentToSalesperson_Time: "09:00:00"
    })],
    allocationColumns,
    salesRows: [
      sale({ sale_approved_at: "2026-01-05T10:30:00.000Z" })
    ],
    coverageRows: [coverage({
      period_start: "2026-01-05",
      period_end: "2026-04-30",
      row_count: 1
    })],
    startDate: "2026-01-05",
    endDate: "2026-01-09"
  });
  assert.equal(report.totals.approvedSalesInPeriod, 1);
  assert.equal(report.cohortWindows[0].status, "measured");
  assert.equal(report.cohortWindows[0].matureCustomers, 1);
  assert.equal(report.cohortWindows[0].convertedCustomers, 1);
  assert.equal(report.cohortWindows[0].conversionRate, 100);
});

test("lead analytics aggregate source allocation, exact observed conversion, age and reuse without raw identities", () => {
  const allocations = [
    allocation(),
    allocation({ AllocationItemID: "allocation-logical-duplicate" }),
    allocation({
      CustomerID: "customer-2",
      AllocationItemID: "allocation-2",
      DateSentToSalesperson_Time: "10:00:00",
      DataSource: "LG",
      CustomerImportSource: "LG"
    }),
    allocation({
      CustomerID: "customer-3",
      FullName: "Taylor Seller",
      SalesManager: "Taylor Manager",
      AllocationItemID: "allocation-3",
      SalesPersonID: "allocation-user-2",
      DateSentToSalesperson_Date: "2026-07-21",
      DateSentToSalesperson_Time: "09:00:00",
      LeadImportDate_Date: "2026-07-21"
    }),
    allocation({
      CustomerID: "customer-4",
      AllocationItemID: "allocation-4",
      DateSentToSalesperson_Time: "11:00:00",
      LeadImportDate_Date: "2025-01-01"
    }),
    allocation({
      CustomerID: "customer-4",
      AllocationItemID: "allocation-5",
      DateSentToSalesperson_Date: "2026-07-21",
      DateSentToSalesperson_Time: "11:00:00",
      LeadImportDate_Date: "not-a-date"
    }),
    allocation({
      CustomerID: "customer-4",
      FullName: "Taylor Seller",
      SalesManager: "Taylor Manager",
      AllocationItemID: "allocation-6",
      SalesPersonID: "allocation-user-2",
      DateSentToSalesperson_Date: "2026-07-21",
      DateSentToSalesperson_Time: "12:00:00"
    })
  ];
  const report = buildPerformanceCohortsReport({
    allocationRows: allocations,
    allocationColumns,
    salesRows: [
      sale(),
      sale({
        order_id: "order-2",
        customer_id: "customer-3",
        actual_seller: "Taylor Seller",
        sale_approved_at: "2026-07-21T10:30:00.000Z",
        sale_value: 700,
        acquisition_source_type: "Google Maps"
      })
    ],
    coverageRows: [coverage({ row_count: 2 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });

  assert.equal(report.totals.deduplicatedSentEvents, 6);
  assert.equal(report.leadAnalytics.dailyAllocations[0].sentAllocationEvents, 3);
  assert.equal(report.leadAnalytics.dailyAllocations[1].sentAllocationEvents, 3);
  assert.deepEqual(report.leadAnalytics.usage, {
    uniqueCustomers: 4,
    uniqueCustomerRecipientPairs: 5,
    repeatSentEventsSameRecipient: 1,
    crossRecipientCustomers: 1,
    crossRecipientAssignments: 1,
    conflictingSourcePairs: 0,
    logicalDimensionConflictRows: 0,
    usagePartitionReconciled: true,
    logicalDuplicateRows: 1,
    unknownSourceSentEvents: 0
  });
  assert.deepEqual(
    report.leadAnalytics.allocationFrequency.map((bucket) => bucket.customerRecipientPairs),
    [4, 1, 0, 0]
  );
  const googleMaps = report.leadAnalytics.sourceAllocationRows.find((row) => row.source === "GoogleMaps");
  assert.equal(googleMaps.sentAllocationEvents, 5);
  assert.equal(googleMaps.uniqueCustomerRecipientPairs, 4);
  assert.equal(googleMaps.exactConvertedCustomerRecipientPairs, 2);
  assert.equal(googleMaps.exactApprovedOrders, 2);
  assert.equal(googleMaps.exactApprovedValue, 1200);
  assert.equal(googleMaps.observedConversionRate, 50);
  const lg = report.leadAnalytics.sourceAllocationRows.find((row) => row.source === "LG");
  assert.equal(lg.observedConversionRate, 0);
  assert.equal(
    report.leadAnalytics.linkage.exactSourceLinkedConvertedCustomerRecipientPairs,
    2
  );
  assert.equal(report.leadAnalytics.linkage.approvedOrdersWithoutExactSourceLink, 0);
  assert.equal(
    report.leadAnalytics.leadAgeBuckets.find((bucket) => bucket.key === "same_day").sentAllocationEvents,
    1
  );
  assert.equal(
    report.leadAnalytics.leadAgeBuckets.find((bucket) => bucket.key === "366_plus_days").sentAllocationEvents,
    1
  );
  assert.equal(
    report.leadAnalytics.leadAgeBuckets.find((bucket) => bucket.key === "unknown").sentAllocationEvents,
    1
  );
  assert.equal(report.leadAnalytics.approvedSalesByAcquisitionSource[0].approvedOrders, 2);
  assert.equal(report.leadAnalytics.approvedSalesByAcquisitionSource[0].approvedValue, 1200);
  assert.doesNotMatch(JSON.stringify(report.leadAnalytics), /customer-[1-4]|allocation-[1-6]/);
});

test("source conversion excludes approvals before allocation and fails closed without complete sales coverage", () => {
  const beforeAllocation = buildPerformanceCohortsReport({
    allocationRows: [allocation({ DateSentToSalesperson_Time: "12:00:00" })],
    allocationColumns,
    salesRows: [sale({ sale_approved_at: "2026-07-20T10:30:00.000Z" })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(
    beforeAllocation.leadAnalytics.sourceAllocationRows[0].exactConvertedCustomerRecipientPairs,
    0
  );
  assert.equal(beforeAllocation.leadAnalytics.sourceAllocationRows[0].observedConversionRate, 0);
  assert.equal(beforeAllocation.leadAnalytics.linkage.approvedOrdersWithoutExactSourceLink, 1);

  const incompleteCoverage = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ period_end: "2026-07-20", row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(incompleteCoverage.leadAnalytics.conversionWindowStatus, "not_scored_sales_coverage_unverified");
  assert.equal(incompleteCoverage.leadAnalytics.sourceAllocationRows[0].observedConversionRate, null);
  assert.equal(
    incompleteCoverage.leadAnalytics.sourceAllocationRows[0].exactConvertedCustomerRecipientPairs,
    null
  );
  assert.equal(incompleteCoverage.leadAnalytics.sourceAllocationRows[0].exactApprovedOrders, null);
  assert.equal(incompleteCoverage.leadAnalytics.approvedSalesByAcquisitionSource.length, 0);
  assert.equal(incompleteCoverage.leadAnalytics.linkage.approvedOrdersInPeriod, 0);
  assert.equal(
    incompleteCoverage.leadAnalytics.linkage.exactSourceLinkedConvertedCustomerRecipientPairs,
    null
  );
});

test("conflicting allocation sources remain visible but cannot receive a conversion rate", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation(),
      allocation({
        AllocationItemID: "allocation-2",
        DateSentToSalesperson_Time: "11:00:00",
        DataSource: "LG",
        CustomerImportSource: ""
      })
    ],
    allocationColumns,
    salesRows: [sale({ sale_approved_at: "2026-07-20T12:30:00.000Z" })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const conflicting = report.leadAnalytics.sourceAllocationRows
    .find((row) => row.source === "Conflicting source values");
  assert.equal(conflicting.uniqueCustomerRecipientPairs, 1);
  assert.equal(conflicting.observedConversionRate, null);
  assert.equal(conflicting.conversionStatus, "not_scored_source_conflict");
  assert.equal(report.leadAnalytics.usage.conflictingSourcePairs, 1);
  assert.equal(report.leadAnalytics.linkage.sourceEligibleCustomerRecipientPairs, 0);
  assert.equal(
    report.leadAnalytics.linkage.exactSourceLinkedConvertedCustomerRecipientPairs,
    0
  );
  assert.equal(report.leadAnalytics.linkage.approvedOrdersWithoutExactSourceLink, 1);
});

test("allocation source priority, fallback, unknown and duplicate-dimension conflicts are explicit", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation({
        CustomerID: "fallback",
        AllocationItemID: "fallback-1",
        DataSource: "",
        CustomerImportSource: "Referral"
      }),
      allocation({
        CustomerID: "same-source",
        AllocationItemID: "same-source-1",
        DateSentToSalesperson_Time: "10:00:00",
        DataSource: " GoogleMaps ",
        CustomerImportSource: "googlemaps"
      }),
      allocation({
        CustomerID: "unknown",
        AllocationItemID: "unknown-1",
        DateSentToSalesperson_Time: "11:00:00",
        DataSource: "",
        CustomerImportSource: ""
      }),
      allocation({
        CustomerID: "primary",
        AllocationItemID: "primary-1",
        DateSentToSalesperson_Time: "13:00:00",
        DataSource: "LG",
        CustomerImportSource: "Referral"
      }),
      allocation({
        CustomerID: "raw-conflict",
        AllocationItemID: "raw-conflict-1",
        DateSentToSalesperson_Time: "12:00:00",
        DataSource: "GoogleMaps",
        CustomerImportSource: ""
      }),
      allocation({
        CustomerID: "raw-conflict",
        AllocationItemID: "raw-conflict-2",
        DateSentToSalesperson_Time: "12:00:00",
        DataSource: "LG",
        CustomerImportSource: ""
      })
    ],
    allocationColumns,
    salesRows: [],
    coverageRows: [coverage({ row_count: 0 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.totals.deduplicatedSentEvents, 5);
  assert.equal(
    report.leadAnalytics.sourceAllocationRows.find((row) => row.source === "Referral").sentAllocationEvents,
    1
  );
  assert.equal(
    report.leadAnalytics.sourceAllocationRows.find((row) => row.source === "GoogleMaps").sentAllocationEvents,
    1
  );
  assert.equal(
    report.leadAnalytics.sourceAllocationRows.find((row) => row.source === "LG").sentAllocationEvents,
    1
  );
  assert.equal(report.leadAnalytics.usage.unknownSourceSentEvents, 1);
  assert.equal(report.leadAnalytics.usage.conflictingSourcePairs, 1);
  assert.equal(report.leadAnalytics.usage.logicalDimensionConflictRows, 1);
  assert.equal(report.dataQuality.logicalDimensionConflictRows, 1);
});

test("lead age buckets preserve fixed calendar-day boundaries and unknown states", () => {
  const importDates = [
    "2026-07-20",
    "2026-07-19",
    "2026-07-13",
    "2026-07-12",
    "2026-06-20",
    "2026-06-19",
    "2026-04-21",
    "2026-04-20",
    "2025-07-20",
    "2025-07-19",
    "",
    "not-a-date",
    "2026-07-21"
  ];
  const report = buildPerformanceCohortsReport({
    allocationRows: importDates.map((leadImportDate, index) => allocation({
      CustomerID: `age-${index}`,
      AllocationItemID: `age-allocation-${index}`,
      DateSentToSalesperson_Time: `09:00:${String(index).padStart(2, "0")}`,
      LeadImportDate_Date: leadImportDate
    })),
    allocationColumns,
    salesRows: [],
    coverageRows: [coverage({ row_count: 0 })],
    startDate: "2026-07-20",
    endDate: "2026-07-20"
  });
  assert.deepEqual(
    report.leadAnalytics.leadAgeBuckets.map((bucket) => bucket.sentAllocationEvents),
    [1, 2, 2, 2, 2, 1, 3]
  );
  assert.equal(report.dataQuality.validLeadImportDateEvents, 10);
  assert.equal(report.dataQuality.missingLeadImportDateEvents, 1);
  assert.equal(report.dataQuality.invalidLeadImportDateEvents, 1);
  assert.equal(report.dataQuality.futureLeadImportDateEvents, 1);
});

test("multiple approved orders convert one exact customer-recipient pair once", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [
      sale(),
      sale({
        order_id: "order-2",
        sale_approved_at: "2026-07-21T10:30:00.000Z",
        sale_value: 300
      }),
      sale({
        order_id: "order-after-period",
        sale_approved_at: "2026-07-25T10:30:00.000Z",
        sale_value: 900
      })
    ],
    coverageRows: [coverage({ row_count: 3 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const source = report.leadAnalytics.sourceAllocationRows[0];
  assert.equal(source.exactConvertedCustomerRecipientPairs, 1);
  assert.equal(source.exactApprovedOrders, 2);
  assert.equal(source.exactApprovedValue, 800);
  assert.equal(source.observedConversionRate, 100);
  assert.equal(report.leadAnalytics.linkage.exactSourceLinkedConvertedCustomerRecipientPairs, 1);
  assert.equal(report.leadAnalytics.linkage.approvedOrdersInPeriod, 2);
});

test("sales and call rates fail closed when extraction or allocation-date coverage is incomplete", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation(),
      allocation({
        CustomerID: "customer-2",
        AllocationItemID: "allocation-2",
        DateSentToSalesperson_Date: "2026-07-21"
      })
    ],
    allocationColumns,
    callRows: [call()],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ period_start: "2026-07-20", period_end: "2026-07-20", row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.comparison.salesCoverageStatus, "not_verified");
  assert.equal(report.totals.approvedSalesPerSentEvent, null);
  assert.equal(report.comparison.rows[0].salesCoverageStatus, "not_scored_sales_coverage_unverified");
  assert.equal(report.dataQuality.callCoverageStatus, "not_scored_incomplete_call_dates");
  assert.equal(report.comparison.rows[0].callWithin24HoursRate, null);
});

test("approved-sales row-count mismatch cannot satisfy the scoring coverage gate", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 2 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.comparison.salesCoverageStatus, "not_verified");
  assert.equal(report.totals.approvedSalesPerSentEvent, null);
  assert.equal(report.history.length, 0);
  assert.equal(report.dataQuality.approvedSalesCoverage[0].coverageStatus, "row_count_mismatch");
  assert.equal(Object.hasOwn(report.dataQuality.approvedSalesCoverage[0], "rowCount"), false);
  assert.equal(Object.hasOwn(report.dataQuality.approvedSalesCoverage[0], "observedRowCount"), false);
});

test("new-customer-only approved-sales coverage cannot contribute sales or satisfy the scoring gate", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale()],
    coverageRows: [coverage({
      population_contract: "carma_approved_sales_new_customers_only.v1",
      show_new_customers_only: 1,
      row_count: 1
    })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.comparison.salesCoverageStatus, "not_verified");
  assert.equal(report.totals.approvedSalesInPeriod, 0);
  assert.equal(report.totals.approvedSalesPerSentEvent, null);
  assert.equal(report.history.length, 0);
  assert.equal(report.dataQuality.approvedSalesCoverage[0].coverageStatus, "population_not_authoritative");
  assert.equal(Object.hasOwn(report.dataQuality.approvedSalesCoverage[0], "rowCount"), false);
  assert.equal(Object.hasOwn(report.dataQuality.approvedSalesCoverage[0], "observedRowCount"), false);
  assert.doesNotMatch(JSON.stringify(report.history), /order-1|500|new.customers/i);
  const publicPayload = publicPerformanceCohorts(report);
  assert.doesNotMatch(JSON.stringify(publicPayload), /"rowCount":1|"observedRowCount":1/);
});

test("malformed allocation and call timestamps are counted and excluded from timing denominators", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation(),
      allocation({
        CustomerID: "customer-bad-time",
        AllocationItemID: "allocation-bad-time",
        DateSentToSalesperson_Time: "not-a-time"
      })
    ],
    allocationColumns,
    callRows: [call({ call_time: "not-a-time" })],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.dataQuality.invalidAllocationTimestamps, 1);
  assert.equal(report.dataQuality.invalidCallTimestamps, 1);
  assert.equal(report.totals.deduplicatedSentEvents, 1);
  assert.equal(report.comparison.rows[0].callWithin24HoursRate, null);
});

test("malformed configured report dates fail closed before lexical period comparisons", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-02-30",
    endDate: "2026-07-24"
  });
  assert.equal(report.available, false);
  assert.equal(report.code, "PERFORMANCE_PERIOD_INVALID");
});

test("customer-ID-free self-sourcing attempts do not block allocated-lead call scoring", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [call({ customer_id: "" })],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.dataQuality.missingCallJoinKeys, 0);
  assert.equal(report.dataQuality.unlinkedSelfSourcingCallAttempts, 1);
  assert.equal(report.dataQuality.callCoverageComplete, true);
  assert.equal(report.comparison.rows[0].callWithin24HoursRate, 0);
});

test("exact FoundCustomerID allocation match contributes positive call evidence without changing the raw row", () => {
  const callRow = call({ customer_id: "", FoundCustomerID: "customer-1" });
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [callRow],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-20"
  });
  assert.equal(callRow.customer_id, "");
  assert.equal(report.dataQuality.rawMissingCallJoinKeys, 1);
  assert.equal(report.dataQuality.foundCustomerIdPositiveRepairs, 1);
  assert.equal(report.dataQuality.foundCustomerIdPositiveRepairPairs, 1);
  assert.equal(report.dataQuality.foundCustomerIdNewlyObservedPairs, 1);
  assert.equal(report.dataQuality.missingCallJoinKeys, 0);
  assert.equal(report.dataQuality.observedCalledPairs, 1);
  assert.equal(report._evidence.allocationPairs[0].firstObservedCallIdProvenance, "found_customer_id_exact_allocation_match");
});

test("FoundCustomerID cannot supply allocated-lead evidence for another salesperson or a pre-allocation call", () => {
  for (const callRow of [
    call({ customer_id: "", FoundCustomerID: "customer-1", Salesperson: "Other Person" }),
    call({ customer_id: "", FoundCustomerID: "customer-1", call_time: "08:59:59" })
  ]) {
    const report = buildPerformanceCohortsReport({
      allocationRows: [allocation()],
      allocationColumns,
      callRows: [callRow],
      callColumns: callColumnsWithFoundCustomer,
      salesRows: [sale()],
      coverageRows: [coverage({ row_count: 1 })],
      startDate: "2026-07-20",
      endDate: "2026-07-20"
    });
    assert.equal(report.dataQuality.foundCustomerIdPositiveRepairs, 0);
    assert.equal(report.dataQuality.missingCallJoinKeys, 0);
    assert.equal(report.dataQuality.unlinkedSelfSourcingCallAttempts, 1);
    assert.equal(report.dataQuality.observedCalledPairs, 0);
  }
});

test("FoundCustomerID rejects sentinels and conflicts with direct or duplicate call identifiers", () => {
  const sentinel = buildPerformanceCohortsReport({
    allocationRows: [allocation()], allocationColumns,
    callRows: [call({ customer_id: "", FoundCustomerID: "NULL" })],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()], coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20", endDate: "2026-07-20"
  });
  assert.equal(sentinel.dataQuality.foundCustomerIdPositiveRepairs, 0);
  assert.equal(sentinel.dataQuality.missingCallJoinKeys, 0);
  assert.equal(sentinel.dataQuality.unlinkedSelfSourcingCallAttempts, 1);

  const directConflict = buildPerformanceCohortsReport({
    allocationRows: [allocation()], allocationColumns,
    callRows: [call({ customer_id: "customer-1", FoundCustomerID: "customer-2" })],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()], coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20", endDate: "2026-07-20"
  });
  assert.equal(directConflict.dataQuality.conflictingCallCustomerIds, 1);
  assert.equal(directConflict.dataQuality.missingCallJoinKeys, 1);
  assert.equal(directConflict.dataQuality.observedCalledPairs, 0);

  const duplicateConflict = buildPerformanceCohortsReport({
    allocationRows: [allocation()], allocationColumns,
    callRows: [
      call({ customer_id: "", FoundCustomerID: "customer-1" }),
      call({ customer_id: "", FoundCustomerID: "customer-2" })
    ],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()], coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20", endDate: "2026-07-20"
  });
  assert.equal(duplicateConflict.dataQuality.conflictingDuplicateCallIds, 1);
  assert.equal(duplicateConflict.dataQuality.missingCallJoinKeys, 1);
  assert.equal(duplicateConflict.dataQuality.observedCalledPairs, 0);
});

test("multiple consistent FoundCustomerID calls count one repaired allocation pair and use the earliest call", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()], allocationColumns,
    callRows: [
      call({ call_id: "call-2", customer_id: "", FoundCustomerID: "customer-1", call_time: "11:00:00" }),
      call({ call_id: "call-1", customer_id: "", FoundCustomerID: "customer-1", call_time: "10:00:00" })
    ],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()], coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20", endDate: "2026-07-20"
  });
  assert.equal(report.dataQuality.foundCustomerIdPositiveRepairs, 2);
  assert.equal(report.dataQuality.foundCustomerIdPositiveRepairPairs, 1);
  assert.equal(report.dataQuality.foundCustomerIdNewlyObservedPairs, 1);
  assert.equal(report.dataQuality.observedCalledPairs, 1);
  assert.equal(report._evidence.allocationPairs[0].observedCallsAfterAllocation, 2);
  assert.equal(report._evidence.allocationPairs[0].firstObservedCallDate, "2026-07-20");
});

test("duplicate call snapshots merge later exact identifier enrichment without creating a conflict", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [
      call({ call_id: "call-1", customer_id: "", FoundCustomerID: "" }),
      call({ call_id: "call-1", customer_id: "", FoundCustomerID: "customer-1" })
    ],
    callColumns: callColumnsWithFoundCustomer,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-20"
  });
  assert.equal(report.dataQuality.duplicateCallIds, 1);
  assert.equal(report.dataQuality.conflictingDuplicateCallIds, 0);
  assert.equal(report.dataQuality.foundCustomerIdPositiveRepairs, 1);
  assert.equal(report.dataQuality.unlinkedSelfSourcingCallAttempts, 0);
  assert.equal(report.dataQuality.callCoverageComplete, true);
});

test("multi-manager recipients retain every observed manager instead of inheriting the first row", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation(),
      allocation({
        CustomerID: "customer-2",
        AllocationItemID: "allocation-2",
        DateSentToSalesperson_Time: "09:05:00",
        SalesManager: "Taylor Manager"
      })
    ],
    allocationColumns,
    salesRows: [],
    coverageRows: [coverage({ row_count: 0 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.comparison.rows[0].manager, "Multiple managers");
  assert.deepEqual(report.comparison.rows[0].managers, ["Morgan Manager", "Taylor Manager"]);
  assert.equal(report.dataQuality.multipleManagerSalespeople, 1);
});

test("invalid approval dates cannot normalize into a mature cohort", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation({
      DateSentToSalesperson_Date: "2026-01-01",
      DateSentToSalesperson_Time: "09:00:00"
    })],
    allocationColumns,
    salesRows: [sale({ sale_approved_at: "2026-02-30T10:30:00.000Z" })],
    coverageRows: [coverage({
      period_start: "2026-01-01",
      period_end: "2026-04-30",
      row_count: 1
    })],
    startDate: "2026-01-01",
    endDate: "2026-01-07"
  });
  assert.equal(report.dataQuality.invalidSalesTimestamps, 1);
  assert.equal(report.cohortWindows[0].status, "not_mature");
  assert.equal(report.cohortWindows[0].matureCustomers, 0);
  assert.equal(report.cohortWindows[0].convertedCustomers, 0);
});

test("offset-bearing Carma approvals are excluded from direct performance scoring", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale({ sale_approved_at: "2026-07-20T10:30:00+10:00" })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-20"
  });
  assert.equal(report.dataQuality.invalidSalesTimestamps, 1);
  assert.equal(report.totals.approvedSalesInPeriod, 0);
});

test("Carma trailing-Z approval components remain source Sydney business time across DST windows", () => {
  const sourceBusinessBoundary = buildPerformanceCohortsReport({
    allocationRows: [allocation({ DateSentToSalesperson_Time: "00:00:00" })],
    allocationColumns,
    salesRows: [sale({ sale_approved_at: "2026-07-20T00:30:00.000Z" })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-20"
  });
  assert.equal(sourceBusinessBoundary.totals.approvedSalesInPeriod, 1);

  const dstBoundary = buildPerformanceCohortsReport({
    allocationRows: [allocation({
      DateSentToSalesperson_Date: "2026-10-04",
      DateSentToSalesperson_Time: "00:00:00"
    })],
    allocationColumns,
    salesRows: [
      sale({ order_id: "order-dst-in", sale_approved_at: "2026-10-04T01:30:00.000Z" }),
      sale({ order_id: "order-dst-out", sale_approved_at: "2026-10-05T00:30:00.000Z" })
    ],
    coverageRows: [coverage({
      period_start: "2026-10-04",
      period_end: "2026-10-05",
      row_count: 2
    })],
    startDate: "2026-10-04",
    endDate: "2026-10-04"
  });
  assert.equal(dstBoundary.totals.approvedSalesInPeriod, 1);
});

test("public performance payload is aggregate-only and never exposes local paths or phone fields", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const payload = publicPerformanceCohorts(report, { minimumAllocations: "100" });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /C:\\\\Users|dialled_phone_number|"phone"\s*:/i);
  assert.equal(payload.query.minimumAllocations, 100);
  assert.equal(payload.comparison.rows.length, 1);
});

test("performance configuration resolves explicit options before CLI, environment and ignored local config", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-config-"));
  const configPath = path.join(directory, "performance.json");
  fs.writeFileSync(configPath, JSON.stringify({
    allocationLogPath: path.join(directory, "local.csv"),
    approvedSalesHistoryPath: path.join(directory, "local-history.sqlite"),
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  }));
  const fromOption = resolvePerformanceConfig(
    ["--performance-allocations", path.join(directory, "cli.csv")],
    { SALES_DASHBOARD_PERFORMANCE_ALLOCATIONS_PATH: path.join(directory, "env.csv") },
    {
      performanceConfigPath: configPath,
      performanceAllocationPath: path.join(directory, "option.csv"),
      approvedSalesHistoryPath: path.join(directory, "option-history.sqlite")
    }
  );
  assert.equal(fromOption.allocationLogPath, path.join(directory, "option.csv"));
  assert.equal(
    fromOption.approvedSalesHistoryPath,
    path.join(directory, "option-history.sqlite")
  );
  const fromCli = resolvePerformanceConfig(
    ["--performance-allocations", path.join(directory, "cli.csv")],
    { SALES_DASHBOARD_PERFORMANCE_ALLOCATIONS_PATH: path.join(directory, "env.csv") },
    { performanceConfigPath: configPath }
  );
  assert.equal(fromCli.allocationLogPath, path.join(directory, "cli.csv"));
  assert.equal(
    fromCli.approvedSalesHistoryPath,
    path.join(directory, "local-history.sqlite")
  );
});

test("performance configuration retains separate primary-history and weekly-supplement call sources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-call-sources-"));
  const configPath = path.join(directory, "performance.json");
  const primaryPath = path.join(directory, "primary.csv");
  const supplementPath = path.join(directory, "supplement.csv");
  fs.writeFileSync(configPath, JSON.stringify({
    allocationLogPath: path.join(directory, "allocations.csv"),
    primaryCallCsvPath: primaryPath,
    callCsvPath: supplementPath,
    callSources: [
      { path: primaryPath, role: "primary_history", dateOrder: "day_first" },
      { path: supplementPath, role: "weekly_supplement", dateOrder: "month_first" }
    ]
  }));
  const resolved = resolvePerformanceConfig([], {}, { performanceConfigPath: configPath });
  assert.deepEqual(resolved.callSources, [
    { path: primaryPath, role: "primary_history", dateOrder: "day_first" },
    { path: supplementPath, role: "weekly_supplement", dateOrder: "month_first" }
  ]);
});

test("performance configuration retains multiple weekly allocation sources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-allocation-sources-"));
  const firstPath = path.join(directory, "allocations-week-1.csv");
  const secondPath = path.join(directory, "allocations-week-2.csv");
  const configPath = path.join(directory, "performance.json");
  fs.writeFileSync(configPath, JSON.stringify({
    allocationLogPath: secondPath,
    allocationSources: [
      { path: firstPath, role: "weekly_allocation" },
      { path: secondPath, role: "weekly_allocation" }
    ]
  }));
  const resolved = resolvePerformanceConfig([], {}, { performanceConfigPath: configPath });
  assert.equal(resolved.configured, true);
  assert.equal(resolved.allocationLogPath, secondPath);
  assert.deepEqual(resolved.allocationSources, [
    { path: firstPath, role: "weekly_allocation" },
    { path: secondPath, role: "weekly_allocation" }
  ]);
});

test("performance call-source bundle merges day-first primary history and month-first supplements", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-call-merge-"));
  const allocationPath = path.join(directory, "allocations.csv");
  const primaryPath = path.join(directory, "primary.csv");
  const supplementPath = path.join(directory, "supplement.csv");
  const databasePath = createCarmaFixture(directory);
  fs.writeFileSync(allocationPath, rowsToCsv(allocationColumns, [
    allocation(),
    allocation({
      CustomerID: "customer-2",
      FullName: "Second Seller",
      DateSentToSalesperson_Date: "2026-07-21",
      AllocationItemID: "allocation-2"
    })
  ]), "utf8");
  fs.writeFileSync(primaryPath, rowsToCsv(callColumns, [call({
    call_id: "call-primary",
    call_date: "20/07/2026"
  })]), "utf8");
  fs.writeFileSync(supplementPath, rowsToCsv(callColumns, [call({
    call_id: "call-supplement",
    customer_id: "customer-2",
    Salesperson: "Second Seller",
    call_date: "7/21/2026"
  })]), "utf8");
  const report = loadPerformanceCohorts({
    config: {
      configured: true,
      allocationLogPath: allocationPath,
      callSources: [
        { path: primaryPath, role: "primary_history", dateOrder: "day_first" },
        { path: supplementPath, role: "weekly_supplement", dateOrder: "month_first" }
      ],
      startDate: "2026-07-20",
      endDate: "2026-07-21"
    },
    databasePath
  });
  assert.deepEqual(report.dataQuality.callDates, ["2026-07-20", "2026-07-21"]);
  assert.equal(report.dataQuality.observedCalledPairs, 2);
  assert.equal(report.dataQuality.noExactCallObservedPairs, 0);
  assert.equal(report.dataQuality.callCoverageComplete, true);
});

test("missing weekend call rows do not block a weekday allocation report", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [call()],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-26"
  });
  assert.deepEqual(report.dataQuality.allocationDates, ["2026-07-20"]);
  assert.deepEqual(report.dataQuality.callDates, ["2026-07-20"]);
  assert.equal(report.dataQuality.callCoverageComplete, true);
});

test("performance source failures use a stable public error without exposing configured paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-read-error-"));
  const databasePath = createCarmaFixture(directory);
  const report = loadPerformanceCohorts({
    config: {
      configured: true,
      allocationLogPath: directory,
      callCsvPath: "",
      startDate: "2026-07-20",
      endDate: "2026-07-24"
    },
    databasePath
  });
  assert.equal(report.available, false);
  assert.equal(report.error, "Performance sources could not be read and validated.");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("configured personnel reporting refuses non-loopback server binding", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.throws(() => startServer({
    host: "0.0.0.0",
    port: 0,
    performanceAllocationPath: "configured.csv"
  }), /local-only/i);
});

test("Sales Dashboard exposes the sanitized Performance & Cohorts API and local UI", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-dashboard-"));
  const allocationPath = path.join(directory, "allocations.csv");
  const callPath = path.join(directory, "calls.csv");
  const storePath = path.join(directory, "state.json");
  const databasePath = createCarmaFixture(directory);
  fs.writeFileSync(allocationPath, rowsToCsv(allocationColumns, [allocation({
    DataSource: "<img src=x onerror=alert(1)>",
    CustomerImportSource: ""
  })]), "utf8");
  fs.writeFileSync(callPath, fullCallCsv(), "utf8");

  const server = createServer({
    csvPath: callPath,
    storePath,
    carmaEvidencePath: databasePath,
    performanceAllocationPath: allocationPath,
    performanceCallPath: callPath,
    performanceStartDate: "2026-07-20",
    performanceEndDate: "2026-07-24"
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const stateBeforeReads = fs.readFileSync(storePath, "utf8");
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.performance_cohorts_available, true);
    assert.equal(health.performance_cohorts_sent_events, 1);

    const response = await fetch(`${baseUrl}/api/performance-cohorts`);
    const api = await response.json();
    assert.equal(response.status, 200);
    assert.equal(api.totals.approvedSalesWithRecipientLabelMatch, 1);
    assert.equal(api.leadAnalytics.approvedSalesByAcquisitionSource[0].source, "Google Maps");
    assert.equal(api.leadAnalytics.approvedSalesByAcquisitionSource[0].approvedOrders, 1);
    assert.equal(api.comparison.rows[0].salesperson, "Riley Example");
    assert.doesNotMatch(JSON.stringify(api), /performance-dashboard-|dialled_phone_number/i);
    assert.equal(Object.prototype.hasOwnProperty.call(api, "_evidence"), false);
    assert.doesNotMatch(JSON.stringify(api.comparison.rows), /customer_id|order_id|allocation_id/i);

    const selectedResponse = await fetch(
      `${baseUrl}/api/performance-cohorts?performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const selected = await selectedResponse.json();
    assert.equal(selectedResponse.status, 200);
    assert.equal(selected.period.label, "2026-07-20 to 2026-07-20");
    assert.equal(selected.totals.deduplicatedSentEvents, 1);
    const invalidRange = await fetch(
      `${baseUrl}/api/performance-cohorts?performanceFrom=2026-07-24&performanceTo=2026-07-20`
    );
    assert.equal(invalidRange.status, 400);

    const companyDrilldownResponse = await fetch(
      `${baseUrl}/api/drilldown?metric=performance.approvedOrders&seller=Riley%20Example&classification=Company%20Sourced&performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const companyDrilldown = await companyDrilldownResponse.json();
    assert.equal(companyDrilldownResponse.status, 200);
    assert.equal(companyDrilldown.count, 1);
    assert.equal(companyDrilldown.recordType, "approved_sale");
    assert.equal(companyDrilldown.privacyMode, "local_manager_identifiers");
    assert.equal(companyDrilldown.rows[0].orderNumber, "order-1");
    assert.equal(companyDrilldown.rows[0].businessName, "Example Customer");
    assert.equal(companyDrilldown.rows[0].customerId, "customer-1");
    assert.equal(companyDrilldown.rows[0].historicalAllocationProofStatus, "exact_pre_sale_seller_allocation");
    assert.equal(companyDrilldown.rows[0].weeklyAllocationMatchStatus, "matched_in_selected_week");
    assert.doesNotMatch(JSON.stringify(companyDrilldown.rows), /phone|address|transcript|notes/i);

    const companyDrilldownHtml = await fetch(
      `${baseUrl}/drilldown?metric=performance.approvedOrders&seller=Riley%20Example&classification=Company%20Sourced&performanceFrom=2026-07-20&performanceTo=2026-07-20`
    ).then((result) => result.text());
    assert.match(companyDrilldownHtml, /Order \/ invoice/);
    assert.match(companyDrilldownHtml, /Business/);
    assert.match(companyDrilldownHtml, /Customer ID/);
    assert.match(companyDrilldownHtml, /Example Customer/);
    assert.match(companyDrilldownHtml, /customer-1/);
    assert.match(companyDrilldownHtml, /performance\.exactAllocationLink/);
    assert.match(companyDrilldownHtml, /View pre-sale allocation/);
    assert.match(companyDrilldownHtml, /performance\.weeklyAllocationLink/);
    assert.match(companyDrilldownHtml, /View selected-week match/);
    assert.match(companyDrilldownHtml, /Local manager source evidence/);

    const exactLinkResponse = await fetch(
      `${baseUrl}/api/drilldown?metric=performance.exactAllocationLink&orderNumber=order-1&performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const exactLink = await exactLinkResponse.json();
    assert.equal(exactLinkResponse.status, 200);
    assert.equal(exactLink.count, 1);
    assert.equal(exactLink.recordType, "historical_allocation_link");
    assert.equal(exactLink.rows[0].orderNumber, "order-1");
    assert.equal(exactLink.rows[0].allocationItemId, "historical-allocation-1");
    assert.equal(exactLink.rows[0].allocationRecipient, "Riley Example");
    assert.equal(exactLink.rows[0].allocationEffectiveStart, "2026-07-20T09:00:00.000Z");
    assert.match(exactLink.rows[0].linkRule, /complete governed Carma history/i);

    const weeklyLinkResponse = await fetch(
      `${baseUrl}/api/drilldown?metric=performance.weeklyAllocationLink&orderNumber=order-1&performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const weeklyLink = await weeklyLinkResponse.json();
    assert.equal(weeklyLinkResponse.status, 200);
    assert.equal(weeklyLink.count, 1);
    assert.equal(weeklyLink.recordType, "weekly_allocation_link");
    assert.equal(weeklyLink.rows[0].allocationItemId, "allocation-1");
    assert.equal(weeklyLink.rows[0].allocationSentDate, "2026-07-20");

    const html = await fetch(`${baseUrl}/?view=performance`).then((result) => result.text());
    assert.match(html, /Performance &amp; Cohorts/);
    assert.match(html, /Fair Salesperson Comparison/);
    assert.match(html, /Riley Example/);
    assert.match(html, /Lead allocation and observed outcomes/i);
    assert.match(html, /Lead Allocation by Source/);
    assert.match(html, /Observed Source Conversion/);
    assert.match(html, /Approved Sales by Acquisition Source/);
    assert.match(html, /Lead Age at Allocation/);
    assert.match(html, /Lead Usage &amp; Reuse/);
    assert.match(html, /Sales Activity by Lead Classification/);
    assert.match(html, /Classification × approval date/);
    assert.match(html, /Allocation-to-Call Observation/);
    assert.match(html, /(?:Leads Uncalled Within Reporting Window|Allocated Leads With No Recorded Call by Evidence Cutoff)/);
    assert.match(html, /name="performanceFrom"/);
    assert.match(html, /name="performanceTo"/);
    assert.match(html, /metric=performance\.approvedOrders/);
    assert.match(html, /classification=Company\+Sourced/);
    assert.match(html, /performanceFrom=2026-07-20/);
    assert.match(html, /class="lead-chart-figure"/);
    assert.match(html, /View exact daily source quantities/);
    assert.match(html, /bars use a shared 0–100% scale/);
    assert.match(html, /Usage signals/);
    assert.doesNotMatch(html, /Wastage signals/);
    assert.match(html, /grid-template-columns: repeat\(var\(--daily-column-count\), minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(html, /\.lead-chart-row\.low-sample \{ opacity:/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
    assert.match(html, /Mature Cohort Conversion/);
    assert.match(html, /class="app-topnav"/);
    assert.match(html, /aria-label="Application navigation"/);
    assert.match(html, /data-sidebar-toggle/);
    assert.match(html, /role="search"/);
    assert.match(html, /name="customerId"/);
    assert.match(html, /aria-current="page"[^>]*>[\s\S]*Performance &amp; Cohorts/);
    assert.match(html, /--sidebar: #151827/);
    assert.doesNotMatch(html, /Raw Call Explorer/);
    assert.doesNotMatch(html, /Lead Reattempt Behaviour/);
    assert.doesNotMatch(html, /Alert Centre/);
    assert.doesNotMatch(html, /Panelify/);

    const incompleteLeadResultsResponse = await fetch(
      `${baseUrl}/api/lead-results-dashboard?performanceFrom=2026-07-24&performanceTo=2026-07-24`
    );
    const incompleteLeadResults = await incompleteLeadResultsResponse.json();
    assert.equal(incompleteLeadResultsResponse.status, 409);
    assert.equal(incompleteLeadResults.available, false);
    assert.equal(incompleteLeadResults.completeness.checks.allocationPopulationPresent, false);
    const invalidLeadResultsPage = await fetch(
      `${baseUrl}/lead-results-dashboard?performanceFrom=2026-07-19&performanceTo=2026-07-20`
    );
    const invalidLeadResultsHtml = await invalidLeadResultsPage.text();
    assert.equal(invalidLeadResultsPage.status, 200);
    assert.match(invalidLeadResultsHtml, /2026-07-20 to 2026-07-24/);
    assert.match(invalidLeadResultsHtml, /performanceFrom=2026-07-20&amp;performanceTo=2026-07-24/);
    const incompleteExportResponse = await fetch(
      `${baseUrl}/exports/lead-results-dashboard.xlsx?performanceFrom=2026-07-24&performanceTo=2026-07-24`
    );
    assert.equal(incompleteExportResponse.status, 409);

    const leadResultsApiResponse = await fetch(
      `${baseUrl}/api/lead-results-dashboard?performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const leadResultsApi = await leadResultsApiResponse.json();
    assert.equal(leadResultsApiResponse.status, 200);
    assert.equal(leadResultsApi.available, true);
    assert.equal(leadResultsApi.completeness.complete, true);
    assert.equal(leadResultsApi.totals.sentLeads, 1);
    assert.equal(leadResultsApi.totals.approvedSales, 1);
    assert.equal(leadResultsApi.rankings.length, 1);
    assert.equal(leadResultsApi.rankings[0].salesperson, "Riley Example");
    assert.doesNotMatch(JSON.stringify(leadResultsApi), /performance-dashboard-|dialled_phone_number|databasePath|allocationLogPath/i);

    const leadResultsHtml = await fetch(
      `${baseUrl}/lead-results-dashboard?performanceFrom=2026-07-20&performanceTo=2026-07-20`
    ).then((result) => result.text());
    assert.match(leadResultsHtml, /Lead Result Dashboard/);
    assert.match(leadResultsHtml, /Manager Team Results/);
    assert.match(leadResultsHtml, /Performance &amp; Trophies/);
    assert.match(leadResultsHtml, /Complete workbook table/);
    assert.match(leadResultsHtml, /Performance Rankings/);
    assert.match(leadResultsHtml, /Riley Example/);
    assert.match(leadResultsHtml, /exports\/lead-results-dashboard\.xlsx/);
    assert.match(leadResultsHtml, /returnView=lead_results/);
    assert.match(leadResultsHtml, /data-sortable-table/);
    assert.ok(leadResultsHtml.lastIndexOf("Performance Rankings") > leadResultsHtml.lastIndexOf("Completeness &amp; Interpretation Checks"));

    const managerDrilldownResponse = await fetch(
      `${baseUrl}/api/drilldown?metric=performance.approvedOrders&manager=Morgan%20Manager&reconcile=allocatedLeadShare&performanceFrom=2026-07-20&performanceTo=2026-07-20&returnView=lead_results`
    );
    const managerDrilldown = await managerDrilldownResponse.json();
    assert.equal(managerDrilldownResponse.status, 200);
    assert.equal(managerDrilldown.count, 1);
    assert.equal(managerDrilldown.filters.manager, "Morgan Manager");
    assert.equal(managerDrilldown.reconciliation.numerator, 1);
    assert.equal(managerDrilldown.reconciliation.denominator, 1);
    assert.equal(managerDrilldown.reconciliation.value, 1);
    const managerDrilldownHtml = await fetch(
      `${baseUrl}/drilldown?metric=performance.approvedOrders&manager=Morgan%20Manager&reconcile=allocatedLeadShare&performanceFrom=2026-07-20&performanceTo=2026-07-20&returnView=lead_results`
    ).then((result) => result.text());
    assert.match(managerDrilldownHtml, /1 Sales From Allocated Leads ÷ 1 classified Approved Sales = 100\.0%/);
    assert.doesNotMatch(managerDrilldownHtml, /Ã·/);

    const exportResponse = await fetch(
      `${baseUrl}/exports/lead-results-dashboard.xlsx?performanceFrom=2026-07-20&performanceTo=2026-07-20`
    );
    const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get("content-type"), /spreadsheetml/);
    assert.match(exportResponse.headers.get("content-disposition"), /lead-result-dashboard_2026-07-20_to_2026-07-20\.xlsx/);
    assert.equal(exportBytes.subarray(0, 2).toString("utf8"), "PK");
    assert.ok(exportBytes.length > 10000);
    assert.equal(fs.readFileSync(storePath, "utf8"), stateBeforeReads);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unverified sales coverage renders Not scored rather than a zero-percent personnel signal", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "performance-unverified-ui-"));
  const allocationPath = path.join(directory, "allocations.csv");
  const callPath = path.join(directory, "calls.csv");
  const storePath = path.join(directory, "state.json");
  const databasePath = createCarmaFixture(directory);
  fs.writeFileSync(allocationPath, rowsToCsv(allocationColumns, [allocation({
    DateSentToSalesperson_Date: "2026-08-01"
  })]), "utf8");
  fs.writeFileSync(callPath, fullCallCsv(), "utf8");
  const server = createServer({
    csvPath: callPath,
    storePath,
    carmaEvidencePath: databasePath,
    performanceAllocationPath: allocationPath,
    performanceCallPath: path.join(directory, "missing-calls.csv"),
    performanceStartDate: "2026-08-01",
    performanceEndDate: "2026-08-01"
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const html = await fetch(`http://127.0.0.1:${server.address().port}/?view=performance`)
      .then((response) => response.text());
    assert.match(html, /Observed approval rate[\s\S]{0,400}Not scored/);
    assert.doesNotMatch(html, /Observed approval rate[\s\S]{0,400}0\.0%/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("performance exclusions remove exact primary personnel labels while retaining manager labels and near names", (t) => {
  const excluded = ["Admin User", " Excluded   Manager ", "EXCLUDED SELLER", "Excluded Supervisor"];
  const previousExclusions = [...EXCLUDED_PERSONNEL];
  configurePersonnelExclusions(excluded);
  t.after(() => configurePersonnelExclusions(previousExclusions));
  const allocationRows = [
    allocation({
      CustomerID: "eligible-1",
      FullName: "Riley Example",
      SalesManager: "Eligible Manager A",
      AllocationItemID: "eligible-allocation-1"
    }),
    allocation({
      CustomerID: "eligible-1",
      FullName: "Riley Example",
      SalesManager: "Eligible Manager B",
      AllocationItemID: "eligible-allocation-1b"
    }),
    allocation({
      CustomerID: "eligible-2",
      FullName: "Zed Excluded Seller Jr",
      AllocationItemID: "eligible-allocation-2"
    }),
    ...excluded.map((name, index) => allocation({
      CustomerID: `excluded-${index}`,
      FullName: name,
      AllocationItemID: `excluded-allocation-${index}`
    }))
  ];
  const salesRows = [
    sale({ order_id: "eligible-order-1", customer_id: "eligible-1", actual_seller: "Riley Example" }),
    sale({ order_id: "eligible-order-2", customer_id: "eligible-2", actual_seller: "Zed Excluded Seller Jr" }),
    ...excluded.map((name, index) => sale({
      order_id: `excluded-order-${index}`,
      customer_id: `excluded-${index}`,
      actual_seller: name
    }))
  ];
  const report = buildPerformanceCohortsReport({
    allocationRows,
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows,
    coverageRows: [coverage({ row_count: salesRows.length })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.equal(report.totals.excludedPersonnelAllocationRows, 4);
  assert.equal(report.totals.excludedPersonnelApprovedSalesInPeriod, 4);
  assert.equal(report.totals.deduplicatedSentEvents, 3);
  assert.deepEqual(report.comparison.rows.map((row) => row.salesperson), [
    "Riley Example",
    "Zed Excluded Seller Jr"
  ]);
  assert.deepEqual(report.comparison.rows[0].managers, ["Eligible Manager A", "Eligible Manager B"]);
  assert.equal(report.comparison.rows[0].manager, "Multiple managers");
  assert.equal(report.comparison.rows[0].sentAllocationEvents, 2);
  assert.doesNotMatch(JSON.stringify(report.comparison.rows.map((row) => row.salesperson)), /Admin User|Excluded Manager|Excluded Seller(?! Jr)|Excluded Supervisor/i);
});

test("performance drilldowns keep general lead evidence private while local audit evidence includes approved identifiers", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation(),
      allocation({
        AllocationItemID: "allocation-2",
        DateSentToSalesperson_Time: "11:00:00"
      }),
      allocation({
        AllocationItemID: "allocation-3",
        DateSentToSalesperson_Time: "12:00:00"
      }),
      allocation({
        AllocationItemID: "allocation-4",
        DateSentToSalesperson_Time: "13:00:00"
      })
    ],
    allocationColumns,
    callRows: [call()],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const repeat = buildPerformanceDrilldown(report, {
    metric: "performance.repeatSends"
  });
  const company = buildPerformanceDrilldown(report, {
    metric: "performance.approvedOrders",
    seller: "Riley Example",
    classification: "Company Sourced"
  });
  const exactLink = buildPerformanceDrilldown(report, {
    metric: "performance.exactAllocationLink",
    orderNumber: "order-1"
  });
  const noCall = buildPerformanceDrilldown(report, {
    metric: "performance.noCallObserved"
  });
  const leadAge = buildPerformanceDrilldown(report, {
    metric: "performance.leadAge",
    leadAgeBucket: "8_30_days"
  });
  assert.equal(report.leadAnalytics.usage.repeatSentEventsSameRecipient, 3);
  assert.equal(repeat.count, 3);
  assert.equal(new Set(repeat.rows.map((row) => row.evidenceRef)).size, 3);
  assert.equal(company.count, 1);
  assert.equal(exactLink.count, 1);
  assert.equal(noCall.count, 0);
  assert.equal(leadAge.count, 4);
  assert.equal(company.rows[0].recordType, "approved_sale");
  assert.match(company.rows[0].evidenceRef, /^[A-F0-9]{12}$/);
  assert.equal(company.rows[0].orderNumber, "order-1");
  assert.equal(company.rows[0].businessName, "Example Customer");
  assert.equal(company.rows[0].customerId, "customer-1");
  assert.equal(company.privacyMode, "local_manager_identifiers");
  assert.equal(exactLink.recordType, "historical_allocation_link");
  assert.equal(exactLink.rows[0].allocationItemId, "historical-allocation-1");
  assert.equal(exactLink.rows[0].allocationRecipient, "Riley Example");
  assert.equal(exactLink.rows[0].allocationDescription, "Fresh Leads");
  assert.doesNotMatch(
    JSON.stringify([...repeat.rows, ...leadAge.rows]),
    /customer-1|order-1|allocation-1|CustomerID|customer_name|phone|transcript/
  );
  assert.doesNotMatch(JSON.stringify([...company.rows, ...exactLink.rows]), /phone|address|transcript|notes/i);

  const noCallReport = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows: [sale()],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const auditableNoCall = buildPerformanceDrilldown(noCallReport, {
    metric: "performance.noCallObserved"
  });
  assert.equal(auditableNoCall.count, 1);
  assert.equal(auditableNoCall.privacyMode, "local_manager_identifiers");
  assert.equal(auditableNoCall.rows[0].companyName, "Example Customer");
  assert.equal(auditableNoCall.rows[0].customerId, "customer-1");
  assert.doesNotMatch(JSON.stringify(auditableNoCall.rows), /phone|address|transcript|notes|ContactID/i);
  const noCallHtml = renderDrilldownPage(auditableNoCall);
  assert.match(noCallHtml, /Business Name/);
  assert.match(noCallHtml, /Customer ID/);
  assert.match(noCallHtml, /Example Customer/);
  assert.match(noCallHtml, /customer-1/);
  assert.match(noCallHtml, /Local manager source evidence/);
  assert.match(noCallHtml, /Audit view/);
  assert.match(noCallHtml, /Compact view/);
  assert.match(noCallHtml, /sales-dashboard-table-columns:v1:/);
  assert.match(noCallHtml, /Data, totals and exports stay unchanged/);
});

test("unproven acquisition channel stays separate from governed lead classification", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows: [sale({
      acquisition_source_type: "Self Sourced",
      acquisition_source_proven: 0,
      lead_source_classification: "Company Sourced"
    })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  assert.deepEqual(report.leadAnalytics.approvedSalesByAcquisitionSource, [{
    source: "Source not recorded",
    approvedOrders: 1,
    approvedValue: 500,
    orderShare: 100
  }]);
  assert.equal(report.leadAnalytics.salesHeatmap[0].source, "Company Sourced");
  const drilldown = buildPerformanceDrilldown(report, {
    metric: "performance.salesHeatmap",
    classification: "Company Sourced"
  });
  assert.equal(drilldown.count, 1);
  assert.equal(drilldown.rows[0].leadSourceClassification, "Company Sourced");
  assert.equal(drilldown.rows[0].acquisitionSourceProven, false);
});

test("governed Company classification is never downgraded by a missing weekly allocation row", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows: [
      sale({
        order_id: "company-order-outside-weekly-log",
        customer_id: "customer-company-outside-weekly-log",
        historical_allocation_id: "historical-company-allocation"
      }),
      sale({
        order_id: "self-order",
        customer_id: "customer-self",
        lead_source_classification: "Self Sourced",
        seller_allocated_before_sale: 0,
        seller_allocation_date: "",
        historical_allocation_id: "",
        historical_allocation_history_id: "",
        historical_allocation_effective_start_at: "",
        historical_allocation_inactivated_at: "",
        historical_allocation_recipient: "",
        historical_allocation_manager: "",
        historical_allocation_description: "",
        historical_allocation_active_at_sale: 0
      })
    ],
    coverageRows: [coverage({ row_count: 2 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const approved = buildPerformanceDrilldown(report, {
    metric: "performance.approvedOrders"
  });
  const company = approved.rows.find((row) => row.orderNumber === "company-order-outside-weekly-log");
  const self = approved.rows.find((row) => row.orderNumber === "self-order");
  assert.equal(company.leadSourceClassification, "Company Sourced");
  assert.equal(company.historicalAllocationProofStatus, "exact_pre_sale_seller_allocation");
  assert.equal(company.weeklyAllocationMatchStatus, "not_present_in_selected_week");
  assert.equal(self.leadSourceClassification, "Self Sourced");
  assert.equal(self.historicalAllocationProofStatus, "no_pre_sale_seller_allocation_in_governed_history");
  assert.equal(self.weeklyAllocationMatchStatus, "not_present_in_selected_week");
  assert.equal(buildPerformanceDrilldown(report, {
    metric: "performance.exactAllocationLink",
    orderNumber: company.orderNumber
  }).count, 1);
  assert.equal(buildPerformanceDrilldown(report, {
    metric: "performance.exactAllocationLink",
    orderNumber: self.orderNumber
  }).count, 0);
  assert.equal(buildPerformanceDrilldown(report, {
    metric: "performance.weeklyAllocationLink"
  }).count, 0);
});

test("an exact weekly customer and full-seller allocation before approval safely corrects Self to Company", () => {
  const report = buildPerformanceCohortsReport({
    allocationRows: [allocation()],
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows: [sale({
      order_id: "weekly-corrected-order",
      lead_source_classification: "Self Sourced",
      seller_allocated_before_sale: 0,
      seller_allocation_date: "",
      historical_allocation_id: "",
      historical_allocation_history_id: "",
      historical_allocation_effective_start_at: "",
      historical_allocation_inactivated_at: "",
      historical_allocation_recipient: "",
      historical_allocation_manager: "",
      historical_allocation_description: "",
      historical_allocation_active_at_sale: 0
    })],
    coverageRows: [coverage({ row_count: 1 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const approved = buildPerformanceDrilldown(report, {
    metric: "performance.approvedOrders",
    orderNumber: "weekly-corrected-order"
  });
  const weeklyProof = buildPerformanceDrilldown(report, {
    metric: "performance.weeklyAllocationLink",
    orderNumber: "weekly-corrected-order"
  });

  assert.equal(approved.count, 1);
  assert.equal(approved.rows[0].leadSourceClassification, "Company Sourced");
  assert.equal(approved.rows[0].storedLeadSourceClassification, "Self Sourced");
  assert.equal(approved.rows[0].leadSourceClassificationReconciled, true);
  assert.equal(
    approved.rows[0].leadSourceClassificationEvidenceSource,
    "exact_weekly_allocation_export"
  );
  assert.equal(
    approved.rows[0].leadSourceProofStatus,
    "exact_weekly_pre_sale_seller_allocation"
  );
  assert.equal(
    approved.rows[0].historicalAllocationProofStatus,
    "no_pre_sale_seller_allocation_in_governed_history"
  );
  assert.equal(approved.rows[0].weeklyAllocationMatchStatus, "matched_in_selected_week");
  assert.equal(report.leadAnalytics.salesHeatmap[0].source, "Company Sourced");
  assert.equal(report.comparison.rows[0].companySourcedSales, 1);
  assert.equal(report.comparison.rows[0].selfSourcedSales, 0);
  assert.equal(report.dataQuality.weeklyAllocationClassificationCorrections, 1);
  assert.equal(report.dataQuality.unresolvedExactWeeklyClassificationContradictions, 0);
  assert.equal(weeklyProof.count, 1);
  assert.equal(weeklyProof.rows[0].classificationProof, true);
  assert.equal(weeklyProof.rows[0].leadSourceClassification, "Company Sourced");
  assert.equal(buildPerformanceDrilldown(report, {
    metric: "performance.exactAllocationLink",
    orderNumber: "weekly-corrected-order"
  }).count, 0);
});

test("different sellers, first-name-only labels and post-approval allocations cannot correct Self", () => {
  const selfSale = {
    lead_source_classification: "Self Sourced",
    seller_allocated_before_sale: 0,
    seller_allocation_date: "",
    historical_allocation_id: "",
    historical_allocation_history_id: "",
    historical_allocation_effective_start_at: "",
    historical_allocation_inactivated_at: "",
    historical_allocation_recipient: "",
    historical_allocation_manager: "",
    historical_allocation_description: "",
    historical_allocation_active_at_sale: 0
  };
  const report = buildPerformanceCohortsReport({
    allocationRows: [
      allocation({
        CustomerID: "customer-different-seller",
        FullName: "Another Seller",
        AllocationItemID: "different-seller-allocation"
      }),
      allocation({
        CustomerID: "customer-after-approval",
        DateSentToSalesperson_Time: "11:00:00",
        AllocationItemID: "post-approval-allocation"
      }),
      allocation({
        CustomerID: "customer-first-name-only",
        FullName: "Riley",
        AllocationItemID: "first-name-only-allocation"
      })
    ],
    allocationColumns,
    callRows: [],
    callColumns,
    salesRows: [
      sale({
        ...selfSale,
        order_id: "different-seller-order",
        customer_id: "customer-different-seller"
      }),
      sale({
        ...selfSale,
        order_id: "post-approval-order",
        customer_id: "customer-after-approval"
      }),
      sale({
        ...selfSale,
        order_id: "first-name-only-order",
        customer_id: "customer-first-name-only"
      })
    ],
    coverageRows: [coverage({ row_count: 3 })],
    startDate: "2026-07-20",
    endDate: "2026-07-24"
  });
  const approved = buildPerformanceDrilldown(report, {
    metric: "performance.approvedOrders"
  });

  assert.equal(approved.count, 3);
  assert.deepEqual(
    new Set(approved.rows.map((row) => row.leadSourceClassification)),
    new Set(["Self Sourced"])
  );
  assert.equal(report.leadAnalytics.salesHeatmap[0].source, "Self Sourced");
  assert.equal(report.leadAnalytics.salesHeatmap[0].approvedOrders, 3);
  assert.equal(report.dataQuality.weeklyAllocationClassificationCorrections, 0);
  assert.equal(report.dataQuality.unresolvedExactWeeklyClassificationContradictions, 0);
  assert.equal(buildPerformanceDrilldown(report, {
    metric: "performance.weeklyAllocationLink"
  }).count, 0);
});
