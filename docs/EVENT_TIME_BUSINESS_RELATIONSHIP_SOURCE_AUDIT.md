# Event-Time Business Relationship Source Audit

Date: 2026-07-30
Status: binary compromise implemented from retained local evidence; evidence tier remains visible

## Decision

`OrderCount` is an export-time customer snapshot, not authoritative event-time
order history. The retained audit nevertheless supports a bounded binary
compromise because the product requires every call to be New or Warm:

1. complete retained Invoicing Summary history controls the first invoice/order
   boundary for an exact `customer_id`;
2. a retained pre-call `Order Created` event proves Warm;
3. a dated pre-call allocation explicitly labelled Warm/KWYC/Repeat is
   supporting Warm evidence;
4. only when none of those controls applies, positive `OrderCount` falls back to
   Warm and blank/zero falls back to New;
5. a missing exact `customer_id` is forced to New under the mandatory binary
   policy;
6. every row retains its rule, evidence tier, source and boundary so fallback
   results cannot masquerade as exact history.

The local `sales_dashboard_business_relationship_evidence.v1` index is generated
from already-retained Carma captures. It performs no live Carma search or
writeback. Unknown is not an output state, but exact, supporting and fallback
coverage remain separately countable.

The dimensions remain independent:

- business relationship: New Business or Warm Business, with an evidence tier;
- call motion: Outbound, Inbound, Unknown;
- lead classification: Company Sourced, Self Sourced;
- acquisition channel: Facebook, Google Maps, Source not recorded, and so on;
- allocation `DataSource`.

Cold call means New Business plus Outbound. It is not a synonym for Company
Sourced, Self Sourced or a particular acquisition channel.

## Reproduced Current Evidence

### Weekly call export

Source:
`WeeklyCallExport_2026-07-20_to_2026-07-26.csv`

- 39,522 calls.
- 34,720 blank/NULL `OrderCount` rows.
- 4,802 positive-`OrderCount` rows.
- 33,666 outbound blank/NULL rows.
- 4,611 outbound positive-`OrderCount` rows.
- 925 calls have no exact Customer ID.
- 24,540 unique Customer IDs are present.
- No Customer ID has conflicting `OrderCount` segments inside this export.

The absence of an internal conflict does not make the field point-in-time safe.
It is internally consistent as an export snapshot.

### Direct retrospective-leakage proof

The governed current approved-sales population contains 583 included orders
after the existing exact personnel exclusion policy.

- 279 orders have at least one exact-customer, exact-seller call at or before
  approval.
- Those orders have 417 such pre-approval calls.
- All 279 orders and all 417 pre-approval calls now carry positive
  `OrderCount`.
- 183 of the 279 orders also occur in Carma's 2026 new-customer report
  population.

Therefore a successful first-sale call can be retroactively displayed as Warm
when the weekly call export is generated after approval.

### Allocation coverage

Source:
`WeeklyLeadAllocationExport_2026-07-20_to_2026-07-26.csv`

After the existing exact personnel exclusions:

- 31,475 raw allocation rows;
- 30,195 unique allocated customers;
- 12,388 customers inherit blank/NULL `OrderCount` from an exact weekly call;
- 990 inherit positive `OrderCount`;
- 16,817 have no weekly call classification.

Only 13,378 of 30,195 allocated customers can inherit any call-export segment.
The remaining 16,817 cannot safely be assigned to either New or Warm.

## Source Inventory And Coverage

| Source | Exact Customer ID | Exact Order ID | Exact approval timestamp | Status/history | Coverage finding | Authority for event-time New/Warm |
| --- | --- | --- | --- | --- | --- | --- |
| Weekly call export | Usually | No | No | `OrderCount` snapshot only | One export week; 925 calls lack Customer ID | No |
| Weekly allocation export | Yes | No | No | Allocation events only | 20-24 July 2026 | No |
| `carma_approved_sales_history.v1` | No | Yes | No | Approved-report membership | 501,270 orders across 31 periods; 1996-07-27 catalog envelope | No |
| Carma new-customer report membership | No | Yes | No | Period/order marker | 46,147 marked orders; historically sparse before 2024 | No; non-membership is not Warm proof |
| `carma_evidence.v3` | Yes | Yes | Yes | Approved population plus governed evidence | 1,221 orders, limited to 13-26 July 2026 | Yes only for observed orders, not for complete prior-history absence |
| Retained Customer Management Sales History captures | Yes | Yes | Usually | Current status plus approval tooltip | 293 customers/334 customer-order rows in one recent cohort | Promising extraction route, but not a complete customer universe |
| Customer Lead Allocation report | Yes | No | No | Allocation history only | Per-customer, on demand | No |
| Cancelled Orders by Week | No governed exact customer-order join for this purpose | Yes | Cancellation report period only | Cancellation-report inclusion | Returned history begins 27 July 2025 | No |

The long approved-sales workbooks contain ten populated columns and order IDs,
seller labels, customer names and approved values, but no governed exact
Customer ID or exact approval timestamp. This was checked at both the imported
workbook and XLSX package levels for representative all-customer, new-customer,
historical and current-period files:

- every audited workbook contains one worksheet and one ten-column table;
- none contains a hidden worksheet, hidden row or hidden column;
- none contains custom XML, comments or external-link payloads;
- no worksheet cell contains an exact Customer ID, approval-timestamp or
  equivalent field label.

Therefore the missing identifiers are not merely concealed from the visible
report layout. The two recent `carma_evidence.v3` runs contain the required
fields but cannot prove that no earlier order exists.

## Promising Carma Read-Only Evidence Route

The retained Customer Management `Sales History` grid is suitable as a
customer-order evidence source if an exact internal Customer ID can open the
correct customer record.

Across the 293 retained customer captures:

- 334 reported Sales History rows were captured as 334 rows;
- 323 rows expose an exact `Approved: DD-Mon-YY HH:mm` title;
- the earliest observed approval is 19 October 2007;
- the latest observed approval is 24 July 2026;
- 329 rows currently display `Approved`, with 322 exact approval titles;
- four rows display `Draft`;
- one row displays `Cancelled` and still retains its earlier exact approval
  title;
- six customer captures did not expose the expected Order Status grid;
- eleven rows have no exact approval title and require an order-level
  drill-down or must remain invalid/Unknown.

This is important evidence that a later cancellation need not erase the earlier
approval event. It is not proof of complete history for the 24,540 call
customers or 30,195 allocation customers.

Customer Management currently has a proven exact Order search:

1. open `/CustomerManagement`;
2. fill the exact `Order` field;
3. activate `Filter the list of Companies`;
4. require the requested Order ID and a `[title^='Customer ID:']` tooltip;
5. open the exact `Sales History` tab;
6. require captured virtual-grid rows to equal the grid's reported size.

Its Advanced Search exposes `input#_externalCustomerIdField` with placeholder
`External CustomerID`, but retained evidence does not prove that this accepts
Carma's internal Customer ID. Across all 293 retained order captures the field
was present but blank. The retained `customer-id-kind-check.png` used the
generic Search control rather than this field and returned no results, so its
filename is not semantic proof of an internal-ID lookup. A live read-only
canary must establish exact internal Customer ID lookup before a customer-first
extractor is approved.

## Missing Authoritative Contract

The required contract is `carma_customer_order_history.v1`, stored locally and
opened read-only by Sales Dashboard. At minimum it must contain:

- `customer_id`;
- `order_id`;
- `approved_at`;
- `approved_at_source_text`;
- `business_timezone` (`Australia/Sydney`);
- `qualifying_order_status`;
- current/later status evidence without rewriting the approval event;
- source run/extraction ID;
- source period start/end;
- source file/report hash;
- row validation status.

It must also:

1. deduplicate exact Order IDs;
2. reject one Order ID mapped to multiple Customer IDs;
3. validate exact Customer IDs and timestamps;
4. resolve Australia/Sydney wall-clock time explicitly, marking ambiguous or
   invalid local times unusable rather than guessing;
5. prove continuous/sufficient coverage and record the earliest reliable
   boundary;
6. reconcile every source run to its report/manifest row and order counts;
7. retain later cancellations/status changes without retroactively removing an
   earlier valid approval;
8. expose no configured path or raw customer row through public aggregate APIs;
9. remain local, read-only and free of CRM writeback.

Classification is strict:

```text
Warm Business
  = at least one qualifying approved order for exact customer_id
    with approved_at < event_at

New Business
  = no such prior order exists
    AND complete history coverage proves the absence

Unknown
  = missing/invalid ID or timestamp, conflicting identity/order evidence,
    incomplete coverage, unresolved timestamp, or unreconciled source
```

The event itself never counts as its own previous order.

## Required Read-Only Extraction Plan

### Gate 1: prove exact Customer ID navigation

Use a known Customer ID/order pair from the retained evidence as a canary.

1. Open Customer Management read-only.
2. Clear the generic Search and Order controls.
3. Fill only `input#_externalCustomerIdField` with the retained exact internal
   Customer ID.
4. Activate the exact `Filter the list of Companies` control.
5. Require exactly one returned customer whose Customer ID tooltip equals the
   requested ID.
6. Require the retained known Order ID to appear in that customer's Sales
   History.
7. Require every captured Sales History grid to reconcile extracted rows to
   its reported size.
8. Repeat with one single-order customer, one customer with old/multiple
   orders, and one of the six records that previously lacked the expected
   detailed order-status grid.
9. Record the non-secret selector/route contract and zero mutation counter.

Two 30 July browser-control attempts failed while the local browser runtime was
creating its execution assets, before opening any page. The retained browser
runtime has accumulated many stale helper processes; restarting the Codex app
is the safest recovery rather than terminating processes belonging to other
tasks. The canary remains pending. No credential, cookie or Carma record was
read or changed during either failed connection.

### Gate 2: prefer a governed bulk report/export

Before scraping records one by one, inventory the authenticated Reporting,
Sales Team Reports and Customer Management read-only surfaces for an export
that provides:

- internal Customer ID;
- Order ID;
- exact approval event timestamp;
- approval/current status;
- complete source period.

Ask the Carma/report owner for a read-only report or database view if the UI
does not expose all fields together. This is the preferred source because it
can prove continuous population coverage and avoid a high-volume UI crawl.

### Gate 3: customer-first bounded extractor

If exact internal Customer ID navigation is proven and no bulk export exists:

1. Build the extraction cohort from exact call `customer_id` and allocation
   `CustomerID` only.
2. Query each distinct customer once.
3. Capture only the Sales History grid fields needed by this contract.
4. Follow an Order ID only when the Sales History row lacks an exact approval
   title.
5. Do not capture contacts, phones, addresses, notes, transcripts, payments or
   unrelated tabs.
6. Checkpoint every customer; rate-limit; retry safely; make the run resumable.
7. Record explicit empty, inaccessible, conflict and invalid-timestamp states.
8. Reconcile requested customers, returned customers, order rows, unique Order
   IDs and hashes before promotion.

### Gate 4: order-first fallback only if unavoidable

If exact Customer ID navigation is unavailable, the annual approved-sales
history provides 501,270 Order IDs that can seed exact order searches. A new
minimal extractor could open each order, capture its exact Customer ID and
minimal Sales History evidence, then deduplicate customers and orders.

The existing full order extractor is not appropriate for this task because it
captures many unrelated, privacy-sensitive tabs and allocation PDFs. Any
order-first fallback must be a new minimal read-only process with checkpoints,
bounded concurrency, hashes and resumability. It is a last resort because of
the very large order population.

## Implementation Gate

Do not add the requested New/Warm default, conversion denominator or
relationship filter until:

- `carma_customer_order_history.v1` exists and passes integrity/reconciliation;
- the earliest reliable boundary is documented;
- current call, allocation and sale events have measured New/Warm/Unknown
  coverage;
- `All = New + Warm + Unknown` reconciles for each supported measure;
- the 417 pre-approval calls remain New when complete history proves no earlier
  approval;
- Unknown remains visible and excluded from New/Warm denominators.

Until then, the accurate product decision is to keep the authoritative
event-time relationship feature blocked rather than publish a convenient but
retrospective classification.
