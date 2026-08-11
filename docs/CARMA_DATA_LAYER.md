# Shared Carma Data Layer

## Purpose

This is the local, documented entry point for Carma extracts used by Sales Dashboard and its coding agents. It separates the source of a fact from the way that fact may be used. Raw source files remain local and are excluded from Git.

The machine-readable local configuration is `data/carma/config.json`. Run `npm run carma:refresh-data-layer` whenever a new extract is placed in the configured location. It writes `data/carma/catalog.json`, a local inventory with freshness, coverage and source hashes. Neither file is exposed through the dashboard UI or API.

## Authoritative datasets

| Dataset | What it answers | Authority and limits |
| --- | --- | --- |
| Approved Sales History | Historical Carma-approved order rows, including Order IDs, seller/customer display text, approved value and report period. | Primary source for historical order totals, but the retained workbooks do not contain governed exact Customer ID or exact approval timestamp. They cannot independently classify event-time New/Warm. An approved amount is not payment, fulfilment, profit or recognised revenue. |
| Classified Approved Sales History | Order-level union of the Approved Sales report with `Show only new customers=False` and the exact order-ID subset returned with `True`. | Primary source for historical all-sales totals and Carma's report-membership marker. `is_new_customer=0` means only that the order was not returned by the `True` view; it is not independent proof that the customer was existing. Pre-2024 markers are explicitly flagged as historically sparse. |
| Raw Allocation Logs | Individual lead-allocation events actually sent during each exported week. | Primary source for weekly lead-delivery counts, recipients, reallocations and allocation-event audit. Deduplicate by the logical event rule in the raw-log workflow. Each file is only a weekly snapshot; it does not fill missing weeks. |
| Cancelled Orders by Week History | Orders included in Carma's `Cancelled Orders by Week` report, available by cancellation week or publication and for all or terminated-only salespeople. | Primary source for this report's history and grouping. The four views overlap and must not be summed. Inclusion does not prove refund, reversal, deletion, recognised-revenue adjustment or cancellation cause. |
| Customer Allocation History | Full retained allocation history for customers contained in the related approved-sales extraction. | Primary source for historical allocation evidence on that covered customer/order cohort. It is not a substitute for raw weekly delivery logs. |
| Campaign Allocations Grid | Verified daily Campaign Allocations grid rows with campaign name, Quantity, Actioned, Remaining, creation date, manager and recipient fields. | Primary source for the aggregate grid facts present in the extract. It has no customer IDs or individual sent events and cannot prove weekly leads sent, unique leads available, customer-level allocation or conversion. |
| Campaign Status Snapshot | Campaign quantity/actioned/remaining state at extraction time. | Optional diagnostic/status evidence only. Do not use as the denominator for weekly leads sent. |
| `carma_evidence.v4` | A normalized, validated subset used by the running dashboard for approved-sale, allocation and source-credit proof. | Read-only, exact `customer_id` joins only. Approved-sales runs must be complete unfiltered all-customer populations with manifest/audit hashes; new-customer-only extracts cannot supply denominators. V4 retains a complete weekly sale in count/value totals when source attribution is incomplete, preserving an explicit approval timestamp when available while isolating the record in `crm_order_timestamp_exceptions`. Missing allocation history cannot prove Self Sourced, and pre-sale timing is withheld only when approval time is unavailable. V3 remains readable for earlier complete periods. This contract is not the complete approved-sales history; use the catalog to find the historical source files. |

## Rules for agents

### Mandatory catalog-first gate

For any task involving data discovery, availability, analysis, comparison, reporting, validation, download, refresh or extraction, inspect `data/carma/catalog.json` before searching directories or planning acquisition. This applies to all data-related work, not only tasks that explicitly mention Carma.

The gate is complete only when the agent has:

1. identified the relevant catalog key;
2. checked its authority, availability, coverage, source path, hashes/freshness and limitations;
3. opened the named manifest or source when deciding whether the requested data exists; and
4. recorded a brief receipt containing the catalog key, coverage checked, selected source and material limitation.

If the catalog is missing or stale, run `npm run carma:refresh-data-layer`, then repeat the gate against the refreshed file. An agent may not claim data is unavailable or start/recommend a duplicate extraction, download or backfill until this gate is complete. Prior chat context, remembered paths and broad filesystem searches never substitute for it.

### Dataset-specific rules

1. Start with `data/carma/catalog.json`. If it is missing or stale, run `npm run carma:refresh-data-layer` before analysis.
2. For a request to “incorporate sales history”, use the Approved Sales History entry, not campaign snapshots or call-derived fields.
3. For a request to measure leads sent in a supplied week, use Raw Allocation Logs. Do not substitute Campaign `Quantity`, `Actioned`, or `Remaining`.
4. For January-August 2026 campaign creation, recipient and grid-quantity analysis, use `campaignAllocationsGrid`. Its verified coverage is 1 January through 7 August 2026, with the first actual allocation dated 20 January. Treat its fields as aggregate grid facts only; do not back-calculate customer counts, unique lead availability, sent-event allocation or conversion.
5. For sales attribution or Company Sourced/Self Sourced reporting inside the app, use the validated `carma_evidence.v4` contract and its locked policy. Performance may supplement missing history or a stored Self result only with a positive raw weekly row whose Customer ID, normalized full seller and sent-before-approval timestamp match exactly. Never invent a match by phone, business name, first-name-only staff text or fuzzy similarity; weekly absence never downgrades governed history or proves Self Sourced. When an approval timestamp or complete allocation history is unavailable, keep the order in complete sale count/value totals but use `Attribution Withheld`; retain the approval time and pre-sale timing when the timestamp is explicit.
6. Keep source type, campaign, sourcing method and external credit as separate dimensions.
7. A raw-path location in the local catalog is operational metadata, not dashboard display data. Do not expose it in UI, APIs, reports or commits.
8. When a question distinguishes all approved sales from Carma-marked new customers, use `approvedSalesHistoryClassified`. Match the two report modes only by exact reporting period plus exact order ID.
9. Do not relabel `is_new_customer=0` as “existing customer”. The marker falls from 67.45% in 2024 to 9.78% in 2023 and is extremely sparse earlier, so pre-2024 rows retain the `exact_report_membership_historical_marker_sparse` warning.

10. For cancelled-order history, use `cancelledOrdersByWeekHistory`. Treat the normalized CSV as a search/index view and the raw XLSX files as the retained report evidence. Preserve blank publication/edition group values rather than inferring them.
11. For event-time New Business/Warm Business, read `docs/EVENT_TIME_BUSINESS_RELATIONSHIP_SOURCE_AUDIT.md`. Build the local `sales_dashboard_business_relationship_evidence.v1` index from retained detailed and all-approved captures. Exact invoice/order timing controls; explicit Warm allocation and `OrderCount` are visibly weaker fallbacks. Never use phone/name/fuzzy joins or present fallback results as complete lifetime history.

## Refresh procedure

1. Save each new `WeeklyLeadAllocationExport_*.csv` in `data/carma/raw/allocation-logs/`.
2. Ensure `data/carma/config.json` points to the latest Carma Reports output folders.
3. Run `npm run carma:refresh-data-layer`.
4. Review `data/carma/catalog.json` for coverage, row counts and missing sources.
5. When the curated Carma evidence sources change, rebuild and verify its separate contract with `npm run carma:build-evidence` and `npm run carma:verify-evidence` before configuring the dashboard to use it.

After either Approved Sales report mode changes, run `npm run carma:build-approved-sales-history -- --force` before refreshing the catalog. The builder fails if a marked-new order is missing from the matching all-sales period.

After a Cancelled Orders by Week extraction changes, run
`npm run carma:build-cancelled-orders-history -- --source-dir "<output directory>"`
before refreshing the catalog. The builder requires all four Boolean report
combinations, exact order-tuple reconciliation, a terminated-only subset, an
empty pre-boundary probe, and matching output hashes.

## Classified history contract

- Schema: `carma_approved_sales_history.v1`.
- Local outputs: `data/carma/generated/approved-sales-history/approved-sales-history.sqlite`, order CSV, period-summary CSV and `manifest.json`.
- Coverage: 31 reporting periods from 1996-01-01 through 2026-07-27.
- Population: 501,270 approved orders, including 46,147 exact Carma-marked-new memberships.
- Validation: marked-new subset, period counts, source-precision approved values, SQLite integrity and foreign keys all reconcile.
- Source variations: four exact order matches have customer-name text differences between report modes. They remain one order, with both source fingerprints retained for audit.

## Cancelled-order history contract

- Schema: `carma_cancelled_orders_by_week_history_manifest.v1`.
- Process: `CANCELLED-ORDERS-BY-WEEK-HISTORY-1`.
- Baseline coverage returned by Carma: 2025-07-27 through 2026-07-26, after requesting 1900-01-01 through 2026-07-29.
- Boundary evidence: a separate 1900-01-01 through 2025-07-26 run returned no order IDs or week groups.
- Population: 3,147 unique orders in the all-salesperson view and 1,381 in the terminated-salesperson-only subset.
- Validation: both grouping modes reconcile with zero exact tuple differences; no individual output contains duplicate order rows.
- Group quality: 41 normalized orders have no publication heading and 100 have no edition heading in the comprehensive weekly report. These remain blank and are not inferred.
- Raw files and the normalized CSV are local-only and hash-validated through the ignored catalog.

## Privacy and matching boundary

Raw Carma data is local-only. Dashboard joins remain exact `customer_id` only. Phone, fuzzy business-name and inferred-person matching are prohibited. The data layer is read-only; it never writes back to Carma.
