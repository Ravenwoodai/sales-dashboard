# Voicemail Callback Attribution Contract

Status: design approved in principle; implementation requires the repository's high-risk model escalation because it introduces attribution and financial-data validation.

## Objective

Measure a controlled voicemail-recovery pilot from explicit source-system records without inferring that a voicemail caused a callback, that an inbound call was receptive, or that a call produced a sale.

The active call export remains the call-evidence source. A separate optional pilot export supplies only facts the call export does not contain.

## Current Data Boundary

The July call export contains 20,000 rows and 19,914 distinct call IDs. It provides:

- exact call ID, source date/time, direction, call type, salesperson and user ID;
- at least one permitted stable ID on 19,593 rows, with 407 rows having none;
- 774 inbound rows;
- `OrderCount` on 2,607 rows.

It does not provide:

- a voicemail-event ID or message-completion event;
- an explicit link from an inbound call to a voicemail event;
- an order or sale ID, sale date, won/lost state, order value, revenue, gross profit or currency;
- a CRM reason proving why an inbound call occurred.

`OrderCount` means only that the exported customer record had previous order history. It is not a sale outcome and cannot be attributed to a call.

## Optional Pilot Export

Configure one local CSV/XLSX through `--voicemail-pilot <path>` or `SALES_DASHBOARD_VOICEMAIL_PILOT_PATH`. Raw pilot data remains under ignored local storage and must not be committed.

One row represents one preassigned outbound voicemail opportunity.

| Field | Required | Contract |
| --- | --- | --- |
| `pilot_record_id` | Yes | Immutable unique source-system record ID. |
| `pilot_arm` | Yes | Exactly `treatment` or `control`; assigned before callback and commercial outcomes are known. |
| `voicemail_event_id` | Yes | Immutable unique telephony/CRM voicemail event ID. |
| `outbound_call_id` | Yes | Exact call ID in the active import; must be outbound and deterministically classified as voicemail. |
| `message_status` | Yes | Exactly `approved_left`, `other_left`, `not_left`, or `unknown`. |
| `message_template_version` | Conditional | Required only for `approved_left`; must match an application allowlist. |
| `message_completed_at` | Conditional | Required for `approved_left` or `other_left`; ISO-8601 source timestamp not earlier than the outbound call. |
| `callback_call_id` | No | Exact active-import inbound call ID. Absence means callback not recorded, not that no callback occurred outside the data window. |
| `callback_attribution_source` | Conditional | Required with `callback_call_id`; exactly `telephony_event_link`, `crm_event_link`, or `manager_verified`. Report each source separately. |
| `handler_user_id` | No | Source-system user ID. When supplied, it must match the inbound call's source `UserID`; salesperson name is derived, never trusted from this file. |
| `crm_lead_id` | No | Exact CRM lead ID retained for audit; it must match a permitted stable ID when a corresponding call field exists. |
| `crm_sale_id` | No | Immutable CRM sale/order ID explicitly linked to this pilot record or callback. |
| `sale_status` | Conditional | Required with `crm_sale_id`; exactly `won`, `lost`, `pending`, or `reversed`. |
| `sale_recorded_at` | Conditional | Required with `crm_sale_id`; ISO-8601 source timestamp. |
| `gross_profit_minor_units` | No | Signed integer minor currency units; accepted only with a `won` or `reversed` sale and explicit sale ID. |
| `currency` | Conditional | Required with gross profit; exactly an allowed ISO-4217 code such as `AUD` or `NZD`. Never aggregate unlike currencies. |

## Fail-Closed Validation

A row is `not_scored` for the affected measure when any controlling fact is missing or contradictory. It is never coerced into treatment compliance, callback, sale or profit.

- IDs must be unique and exact; phone matching is forbidden.
- Outbound and callback calls must exist in the same active import.
- The outbound call must be direction `out` and exact deterministic voicemail.
- The callback call must be direction `in`, later than the outbound call and share at least one permitted exact stable ID unless the source system supplies an explicit immutable event link that is retained as evidence.
- Multiple callback candidates, duplicate event IDs, chronology conflicts and stable-ID conflicts are `not_scored`.
- Handler attribution uses the inbound call's source user/salesperson fields. A supplied handler ID must match them.
- A sale requires an explicit CRM sale ID and explicit linkage. `OrderCount`, transcript wording and model output are prohibited sale evidence.
- Gross profit requires sale ID, allowed sale status, integer minor units and currency. Missing or mixed currency is not aggregated.
- No field in this export may promote or enable a local-model capability.

## Reported Measures

Report denominators and missingness for every measure.

1. Assigned voicemail opportunities by treatment/control arm.
2. Approved-message compliance within the treatment arm.
3. Explicitly attributed inbound callbacks by arm and attribution source.
4. Original-salesperson handling, different-salesperson handling and unknown handler from exact source fields.
5. CRM-linked won/lost/pending/reversed outcomes by arm.
6. Gross profit by currency, per assigned opportunity and per explicit won sale.
7. Net contribution only after externally supplied pilot costs are recorded with the same currency and period.

The primary experiment result is intention-to-treat callback lift between preassigned arms. Message compliance is a separate implementation measure; it must not be used to remove non-compliant treatment records from the main denominator.

## Prohibited Claims

Do not claim:

- that a same-record inbound call was caused by voicemail unless an explicit source-system event link exists;
- that inbound calls are more receptive based only on duration or transcript availability;
- that `OrderCount` changed because of a call;
- that transcript language proves a sale, payment, fulfilment, revenue or profit;
- that a manager-entered link has the same provenance as a telephony/CRM event link;
- that observational results prove incremental lift without a preassigned control arm.

## Implementation Sequence

1. Add the optional parser and strict row validator without changing existing call or archive stores.
2. Produce a read-only validation preview showing accepted, rejected and `not_scored` records with exact reasons.
3. Add deterministic pilot measures only after fixtures cover duplicate IDs, chronology, stable-ID mismatch, missing commercial proof, currency separation and intention-to-treat denominators.
4. Render the pilot section separately from the historical evaluator archive and label every source/provenance class.
5. Browser-check populated, empty, invalid-file and mobile states.
6. Re-run the trusted-boundary audit and prove the import creates no model job, run or result.
