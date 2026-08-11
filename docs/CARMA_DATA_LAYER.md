# Shared Carma Data Layer

## Purpose

This is the local, documented entry point for Carma extracts used by Sales Dashboard and its coding agents. It separates the source of a fact from the way that fact may be used. Raw source files remain local and are excluded from Git.

The machine-readable local configuration is `data/carma/config.json`. Run `npm run carma:refresh-data-layer` whenever a new extract is placed in the configured location. It writes `data/carma/catalog.json`, a local inventory with freshness, coverage and source hashes. Neither file is exposed through the dashboard UI or API.

## Authoritative datasets

| Dataset | What it answers | Authority and limits |
| --- | --- | --- |
| Approved Sales History | Historical Carma-approved orders by customer, including order identifiers and approval periods. | Primary source for sales history. An approved amount is not payment, fulfilment, profit or recognised revenue. |
| Raw Allocation Logs | Individual lead-allocation events actually sent during each exported week. | Primary source for weekly lead-delivery counts, recipients, reallocations and allocation-event audit. Deduplicate by the logical event rule in the raw-log workflow. Each file is only a weekly snapshot; it does not fill missing weeks. |
| Customer Allocation History | Full retained allocation history for customers contained in the related approved-sales extraction. | Primary source for historical allocation evidence on that covered customer/order cohort. It is not a substitute for raw weekly delivery logs. |
| Campaign Allocations Grid | Verified daily Campaign Allocations grid rows with campaign name, Quantity, Actioned, Remaining, creation date, manager and recipient fields. | Primary source for the aggregate grid facts present in the extract. It has no customer IDs or individual sent events and cannot prove weekly leads sent, unique leads available, customer-level allocation or conversion. |
| Campaign Status Snapshot | Campaign quantity/actioned/remaining state at extraction time. | Optional diagnostic/status evidence only. Do not use as the denominator for weekly leads sent. |
| `carma_evidence.v2` | A normalized, validated subset used by the running dashboard for approved-sale, allocation and source-credit proof. | Read-only, exact `customer_id` joins only. This contract is not the complete approved-sales history; use the catalog to find the historical source files. |

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
5. For sales attribution or Company Sourced/Self Sourced reporting inside the app, use the validated `carma_evidence.v2` contract and its locked policy. Never invent a match by phone, business name or staff-name similarity.
6. Keep source type, campaign, sourcing method and external credit as separate dimensions.
7. A raw-path location in the local catalog is operational metadata, not dashboard display data. Do not expose it in UI, APIs, reports or commits.

## Refresh procedure

1. Save each new `WeeklyLeadAllocationExport_*.csv` in `data/carma/raw/allocation-logs/`.
2. Ensure `data/carma/config.json` points to the latest Carma Reports output folders.
3. Run `npm run carma:refresh-data-layer`.
4. Review `data/carma/catalog.json` for coverage, row counts and missing sources.
5. When the curated Carma evidence sources change, rebuild and verify its separate contract with `npm run carma:build-evidence` and `npm run carma:verify-evidence` before configuring the dashboard to use it.

## Privacy and matching boundary

Raw Carma data is local-only. Dashboard joins remain exact `customer_id` only. Phone, fuzzy business-name and inferred-person matching are prohibited. The data layer is read-only; it never writes back to Carma.
