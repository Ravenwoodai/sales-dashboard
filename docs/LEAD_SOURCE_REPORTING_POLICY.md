# Lead Source Reporting Policy

## Status

Accepted default for every Carma lead-source, source-credit and salesperson-performance report.

Policy version: `actual_seller_any_pre_sale_allocation.v1`

Effective date: 2026-07-27

## Required Top-Level Classification

Every approved sale receives exactly one sourcing-method classification:

- `Company Sourced`: the actual seller had any exact recorded allocation before the sale was approved.
- `Self Sourced`: no exact recorded pre-sale allocation to the actual seller was found.

This classification is controlled by allocation evidence. Allocation age, the most recent recipient, a later allocation to another person, and whether an acquisition channel is independently proven do not change the top-level classification.

## Exact Rules

1. Match the allocation recipient to the actual seller by an exact accepted identity.
2. Count only allocations effective on or before the sale approval event.
3. If one or more qualifying allocations exist, classify the sale as `Company Sourced`.
4. If none exists, classify the sale as `Self Sourced`.
5. Use the latest qualifying actual-seller allocation date for display, but never use allocation age to disqualify a Company Sourced sale.
6. Administrative staff, managers and other salespeople do not qualify in place of the actual seller.
7. Possible name aliases remain review flags and do not become exact seller matches without an authoritative identity mapping.
8. Post-sale allocations never affect the sale classification.

## Safe Cross-Report Reconciliation

Complete governed Carma allocation history remains the primary evidence source. The configured weekly allocation export may supplement it only when one row proves all three conditions:

1. exact Customer ID;
2. exact normalized full salesperson name matching the actual seller;
3. allocation sent on or before sale approval.

A positive match upgrades a stored `Self Sourced` result to `Company Sourced`. A missing weekly row never downgrades `Company Sourced` and never independently proves `Self Sourced`. A first-name-only label, a different salesperson, an invalid timestamp, or a post-approval allocation cannot qualify. The report must retain both the stored classification and the evidence source used for any correction.

## Separate Reporting Dimensions

The sourcing-method classification must not be mixed with acquisition-source or campaign fields:

- `Sourcing Method`: `Company Sourced` or `Self Sourced`.
- `Acquisition Source Type`: a separately proven channel such as Facebook, Google Maps, Direct Mail, Instagram or HiPages. If no channel is proven, keep it `Not Recorded`/`Unproven`; do not invent a channel.
- `Campaign`: a separate campaign label. Dates, edition names and `(Batch)` labels are campaigns, never acquisition source types.
- `Carma Credited Source`: what Carma credited. This remains separate from the policy classification and may be compared for reporting accuracy.
- `External Credit Policy`: any rule for awarding money or value to a named acquisition channel is separate from the Company Sourced/Self Sourced classification.

## Default Report Columns

Lead-source reports should include, where available:

- Order Number
- Customer
- Actual Seller
- Sale Approval Date
- Approved Sale Value
- Actual Seller Allocated Before Sale
- Seller Allocation Date
- Days Since Seller Allocation
- Sourcing Method
- Acquisition Source Type
- Campaign
- Carma Credited Source
- Reporting Finding
- Validation Status
- Decision Reason

## Evidence Boundary

Allocation evidence proves company assignment, not the original marketing channel or causal influence. Approved sale value is a Carma-approved amount; it does not prove payment, fulfilment, recognised revenue, profit or ROI.
