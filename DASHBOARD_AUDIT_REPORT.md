# Sales Dashboard Audit Report

> Historical audit only: conclusions involving `NoSaleType`, `Baz_DetailedNotes`, imported-disposition mismatches, or allocation/stable-lead-day concepts are superseded. Those legacy fields are preserved in raw source storage but excluded from the active product as of 11 July 2026.

Audit date: 2026-07-07
Scope: live local dashboard, call workbook, allocation workbook, derived store artifacts, SQLite intelligence store, UI rendering, and automated tests.
Audit mode: read-only inspection. No app code, migrations, source data, or runtime data were modified.

## 1. Executive Summary

The new allocation data links to the old call data only at an aggregate-safe grain: date + salesperson + type. That is the correct conservative design for this workbook because the allocation export does not contain a shared call ID, campaign/list ID, customer ID, contact ID, or lead ID that can prove row-level attribution back to the call records.

The dashboard can safely use allocation data to answer questions like:

| Question | Supported? | Evidence basis |
| --- | --- | --- |
| How many leads were allocated/actioned/remaining? | Yes | Allocation workbook totals |
| How much same-day call activity was observed for a salesperson/type/date bucket? | Yes | Call workbook grouped by date + salesperson + New/Warm type |
| How many stable lead-days were worked against the allocation period? | Yes, with caveats | Stable IDs in call records |
| Which campaign produced which specific calls? | No | No shared campaign/list/lead key exists |
| Whether `QTY ACTIONED` equals call attempts or completed work | No | Allocation field is operational source data, not raw call evidence |
| Whether an individual allocated lead was called | Usually no | Allocation workbook has only aggregate counts |

Accuracy is strong for the core totals. Independent recalculation matched the live dashboard/API for raw rows, deduped calls, transcript coverage, allocation totals, and drilldown counts. The biggest trust risks are not arithmetic errors. They are interpretation risks:

- The UI date range is misleading because it shifts source dates through local browser time and omits the end date.
- July 1 call data starts at 15:58:37, while allocation data appears to cover the full day.
- Alert volume is very high and has no working lifecycle controls in the dashboard.
- Several useful metrics are deterministic rules, not human-reviewed findings or LLM evaluations.
- Campaign attribution is correctly not claimed, but the dashboard should keep warning users about that limitation.

No P0 issue was found. The dashboard is usable for operational triage, but it should not yet be used for compensation, disciplinary decisions, or campaign ROI claims without the P1 fixes below.

## 2. Audit Method

I used six evidence sources:

| Evidence source | What was checked |
| --- | --- |
| Call workbook | `C:\Users\User\Downloads\CallData 07.07.2026.xlsx`, parsed independently |
| Allocation workbook | `C:\Users\User\Downloads\allocations 07.07.2026.xlsx`, parsed independently |
| Live APIs | `/api/health`, `/api/summary`, `/api/allocations`, `/api/drilldown`, `/api/ai/status`, `/api/intelligence/*` on port 3103 |
| Browser UI | Live page at `http://127.0.0.1:3103`, section presence, page text, console warnings/errors |
| Source code | Key pipeline files in `src/`, especially `analysis.js`, `allocationCoverage.js`, `transcriptEvaluator.js`, `drilldown.js`, `sourceQuality.js`, `storage.js`, and `dashboardRenderer.js` |
| Persistence | `data/store/imports/import_5b63ed14caf07ef2c561.json`, `data/store/intelligence.sqlite`, and store summary files |

Verification command run:

```text
node --test tests/*.test.js
```

Result: 56 tests passed, 0 failed.

## 3. Data And Pipeline Findings

### Call Data

Independent workbook totals:

| Metric | Value |
| --- | ---: |
| Raw rows | 20,000 |
| Canonical rows after `call_id` dedupe | 19,914 |
| Duplicate rows/call IDs | 86 |
| Missing `call_id` rows | 0 |
| Source date start | 2026-07-01 15:58:37 |
| Source date end | 2026-07-06 20:12:37 |
| Salespeople | 55 |
| Transcript rows | 16,108, 80.9% |
| `NoSaleType` coverage | 10,831, 54.4% |
| `Baz_DetailedNotes` coverage | 13,771, 69.2% |
| `CustomerImportSource` coverage | 8,204, 41.2% |
| Stable `AllocatedLeadID` coverage | 14,417, 72.4% |
| Stable `ContactId` coverage | 15,094, 75.8% |

Source date distribution:

| Date | Canonical calls |
| --- | ---: |
| 2026-07-01 | 444 |
| 2026-07-02 | 6,250 |
| 2026-07-03 | 6,974 |
| 2026-07-06 | 6,246 |

### Allocation Data

Independent workbook totals:

| Metric | Value |
| --- | ---: |
| Allocation rows | 485 |
| Allocated | 20,026 |
| Actioned | 3,591 |
| Remaining | 16,435 |
| Dates | 4 |
| Campaigns | 56 |
| Managers | 7 |

Allocation by date:

| Date | Rows | Allocated | Actioned | Remaining |
| --- | ---: | ---: | ---: | ---: |
| 2026-07-01 | 86 | 3,570 | 656 | 2,914 |
| 2026-07-02 | 82 | 4,276 | 769 | 3,507 |
| 2026-07-03 | 112 | 5,184 | 920 | 4,264 |
| 2026-07-06 | 205 | 6,996 | 1,246 | 5,750 |

Allocation by type:

| Type | Rows | Allocated | Actioned | Remaining |
| --- | ---: | ---: | ---: | ---: |
| New Business | 366 | 17,204 | 3,015 | 14,189 |
| Warm | 119 | 2,822 | 576 | 2,246 |

### How The New Data Links To The Old Data

The implemented join is conservative and evidence-based:

```text
allocation.DATE + allocation.SALESPERSON + allocation.TYPE
matched to
call_date + Salesperson + New/Warm business type
```

The call data then contributes observed call rows, stable lead-days, live-human rate, meaningful conversation rate, follow-up signals, outcome mismatches, and no-contact indicators inside that aggregate bucket.

The allocation data cannot safely contribute individual call proof, campaign-level call attribution, or per-lead utilization because the workbook lacks a shared ID.

## 4. Displayed Metric Validation

| Displayed/API metric | Dashboard/API value | Independent or secondary check | Result | Caveat |
| --- | ---: | ---: | --- | --- |
| Raw call rows | 20,000 | 20,000 | Pass | Source workbook count |
| Unique calls | 19,914 | 19,914 | Pass | Deduped by `call_id` |
| Duplicate call IDs | 86 | 86 | Pass | Duplicate rows excluded from canonical metrics |
| Salespeople | 55 | 55 | Pass | UserID to salesperson mapping had no conflicts |
| Transcript coverage | 16,108, 80.9% | 16,108, 80.9% | Pass | Transcript existence, not quality |
| Probable live human | 6,118, 30.7% | Drilldown count 6,118 | Pass | Deterministic transcript rules |
| Meaningful conversations | 5,799, 29.1% | Drilldown count 5,799 | Pass | Deterministic transcript rules |
| Follow-up required | 2,595 | Drilldown count 2,595 | Pass | 861 require future data |
| Outcome mismatches | 6,864 | Drilldown count 6,864 | Pass | Imported disposition vs local rule output |
| Risk reviews | 330 | Drilldown count 330 | Pass | Complaint/opt-out style signals |
| System audio encounters | 6,454 | Drilldown count 6,454 | Pass | Includes call-screening encounters, not always no-human calls |
| AI assistant encounters | 37 | Drilldown count 37 | Pass | Rule-based detection |
| Allocation rows | 485 | 485 | Pass | Allocation workbook count |
| Leads allocated | 20,026 | 20,026 | Pass | Allocation workbook total |
| Leads actioned | 3,591 | 3,591 | Pass | Allocation source field only |
| Leads remaining | 16,435 | 16,435 | Pass | Allocation source field only |
| Observed stable lead-days | 16,194 | Drilldown count 16,194 | Pass | Stable IDs only |
| Single-attempt no-contact | 9,050 | Drilldown count 9,050 | Pass | Stable lead-day rule |
| Source bulk-sourced | 8,347 | Drilldown count 8,347 | Pass | Includes valid import dates |
| Source manual-created | 11,045 | Drilldown count 11,045 | Pass | Creator fields or create date |
| Missing source attribution | 546 | Drilldown count 546 | Pass | New Business subset |
| Current import LLM status | 19,914 `not_requested` | SQLite count 19,914 | Pass | Local model layer disabled |

## 5. Issues Found

### ISSUE-001 - P1 - Data Display - Date Range Is Misleading

The workbook source period is 2026-07-01 15:58:37 to 2026-07-06 20:12:37, but the dashboard displayed `02/07/2026 01:58 am - 06:12 am` in the browser. The renderer converts stored ISO timestamps through browser locale time and only prints the end time, not the end date.

Evidence:
- `src/analysis.js` parses call date/time as UTC.
- `src/dashboardRenderer.js` formats start date/time but only end time.
- Browser text showed an end time without the end date.

Impact: Users may misunderstand the period being audited, especially across time zones and multi-day ranges.

### ISSUE-002 - P1 - Data Completeness - July 1 Allocation Coverage Compares Full-Day Allocations To Partial-Day Calls

The call workbook starts on 2026-07-01 at 15:58:37 and has only 444 calls for July 1. The allocation workbook has 3,570 allocated leads for July 1. The dashboard shows the date side by side, but does not clearly flag that July 1 call coverage is partial-day.

Impact: July 1 coverage can look operationally poor when it may be a source-window artifact.

### ISSUE-003 - P1 - Operability - Multiple Dashboard Instances Show Different Data

Two local dashboard instances were running:

| Port | CSV loaded | Allocations loaded | Import ID |
| --- | --- | --- | --- |
| 3000 | Yes | Not indicated in health response | `import_7f3ab2857d48c5dd428d` |
| 3103 | Yes | Yes | `import_5b63ed14caf07ef2c561` |

Impact: A user opening the documented `http://127.0.0.1:3000` URL may see stale or different data from the allocation-enabled dashboard on port 3103.

### ISSUE-004 - P1 - UX / Trust - Missing Global Filters

The UI has business-segment links and drilldown/query filters, but no visible global controls for date range, salesperson, source, imported outcome, confidence band, alert state, or review state. Browser inspection found only a logo upload file input on the main page.

Impact: Managers cannot easily isolate a cohort before interpreting metrics. API support exists for some filters, but the dashboard surface does not make them operationally usable.

### ISSUE-005 - P1 - Workflow - Alert Lifecycle Is Not Usable From The Dashboard

The current import generated 9,487 alerts:

| Severity | Count |
| --- | ---: |
| Critical | 1,762 |
| Warning | 6,864 |
| Notice | 861 |

The page shows `0 acknowledged`, and storage has status fields for alert events, but there is no visible dashboard action to acknowledge, dismiss, assign, bulk triage, or filter alerts by lifecycle state.

Impact: The alert centre is evidence-rich but operationally overwhelming.

### ISSUE-006 - P1 - Data Relationship - Allocation Reconciliation Can Be Over-Interpreted

The dashboard correctly states the join grain, but users can still over-read metrics like `Observed vs actioned`. The current import shows:

| Metric | Value |
| --- | ---: |
| Matched groups | 165 |
| Allocation-only groups | 28 |
| Calls-only groups | 161 |
| Observed stable lead-days | 16,194 |
| Allocation `QTY ACTIONED` | 3,591 |
| Observed minus actioned | 12,603 |

This delta is not necessarily an error. It compares two different concepts: call-observed stable lead-days vs an allocation-system actioned count.

Impact: Without stronger labeling, users may treat a diagnostic comparison as proof of under-reporting or over-calling.

### ISSUE-007 - P2 - Source Quality - Source Attribution Mixes Raw And Inferred Categories

`CustomerImportSource` is blank for 11,710 of 19,914 calls, or 58.8%. The source model then infers categories such as `Facebook` or `Self Sourced` from creator fields when the raw source is missing.

Impact: Source/list performance is useful directionally but should not be treated as pure source-system truth. Inferred rows need stronger badges and separate rollups.

### ISSUE-008 - P2 - System Audio - "Barrier" Language Is Too Broad

System audio has 6,454 encounters. Some call-screening rows later contain enough customer conversation to be classified as customer/live-human style interaction. In the persisted evaluation rows, 518 system-audio-detected rows also had meaningful conversation true.

Impact: "System audio barrier" can overstate the number of blocked/no-human calls. Better labels would distinguish machine voicemail, carrier system, call-screening prompt followed by human conversation, and call-screening prompt with no human recovery.

### ISSUE-009 - P2 - Follow-Up - Completion Means Later Call, Not Resolved Obligation

Follow-up required totals:

| Status | Count |
| --- | ---: |
| Completed | 302 |
| Overdue | 1,432 |
| Indeterminate, insufficient future data | 861 |

The completion rule is a later matching call through stable IDs. It does not prove the later call actually satisfied the requested callback, email, quote, or appointment.

Impact: Follow-up completion should be framed as "later call observed", not "follow-up resolved."

### ISSUE-010 - P2 - Privacy - Raw Proof Field Allowlist Is Still Too Loose

`dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` are excluded from drilldown raw fields, which is good. However, `CallerID` is not excluded by the same raw-field blocklist, and the source workbook contains phone-like caller ID values.

Impact: Some phone-like or sensitive operational fields may still appear in raw proof pages.

### ISSUE-011 - P2 - AI Governance - Current Import Is Rules-Based, Not LLM-Reviewed

The AI execution layer status is disabled/configured false for the current run. SQLite shows all 19,914 current import rows as `llm_status = not_requested`. Older imports have 131 completed LLM results, but the current July 7 import does not.

Impact: Any section named "AI" or "Intelligence" should make clear when it is deterministic rules, local LLM, or human-reviewed output.

### ISSUE-012 - P2 - Review Governance - Manager Review State Exists But Is Sparse

The call page supports manager review saving, and storage has manager review records. Current inspected stores had 0 manager reviews for the active import. Review queues are generated, but there is not yet enough workflow for confirmation, override reason, reviewer identity controls, or audit trail filtering.

Impact: The app can surface review candidates, but it is not yet a controlled review system.

### ISSUE-013 - P3 - Performance / Usability - Single-Page Dashboard Is Very Long

Browser inspection found the allocation section around 29,856 px down-page and alerts around 33,586 px. This is usable for audit but heavy for day-to-day management.

Impact: Important sections are present, but users may miss them without stronger navigation, sticky filters, and focused work queues.

## 6. Contradictions And Suspicious Data Examples

These are not automatically app bugs. They are places where the source labels and transcript-derived evidence disagree.

| Pattern | Count | Interpretation |
| --- | ---: | --- |
| Blank raw `NoSaleType` but meaningful conversation | 3,080 | Imported outcome often missing despite transcript evidence |
| Blank raw `NoSaleType` but follow-up required | 1,629 | Follow-up may be hidden from source disposition |
| `Did Not Answer` but probable live human | 1,060 | Imported outcome may be stale or wrong |
| `Did Not Answer` but meaningful conversation | 849 | Strong mismatch candidates |
| `Not Interested` but follow-up required | 630 | Some calls contain next-step language despite no-sale label |
| Unusable transcript but positive call duration | 51 | Likely audio/transcript quality or export issue |
| Duplicate call IDs | 86 | Correctly deduped from canonical metrics |

Representative examples, with customer IDs masked:

| Case | Call ID | Customer | Date | Salesperson | Raw `NoSaleType` | Local outcome | Evidence summary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blank no-sale, meaningful | 48541981 | 168***96 | 2026-07-01 | Oskar Peterson | blank | complaint | Customer asked about quote, price, or cost |
| Did not answer, live human | 48541987 | 163***67 | 2026-07-01 | Lior Carter | Did Not Answer | other | Imported outcome may not match the transcript |
| Not interested, follow-up | 48542013 | 168***96 | 2026-07-01 | Johnny Hanna | Not Interested | wrong_number | Positive follow-up signal found |
| AI assistant encounter | 48542522 | 167***64 | 2026-07-02 | Ricky Digala | Did Not Answer | system_audio | AI call assistant encountered; structured response left |

Allocation reconciliation examples:

| Pattern | Salesperson | Date | Type | Allocated | Actioned | Call rows | Stable lead-days |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Allocation-only | Robert Moricky | 2026-07-06 | Warm | 386 | 16 | 0 | 0 |
| Allocation-only | Elliott Bartley | 2026-07-01 | New Business | 158 | 8 | 0 | 0 |
| Calls-only | Ruby Lovett | 2026-07-03 | New Business | 0 | 0 | 232 | 192 |
| Calls-only | Christopher Evans | 2026-07-06 | New Business | 0 | 0 | 182 | 164 |

These examples prove that the allocation file and call file are related but not interchangeable.

## 7. AI Transcript Evaluation Audit

Current state:

| Area | Finding |
| --- | --- |
| Current import LLM status | 19,914 `not_requested` rows |
| AI execution layer | Disabled for this run |
| Current transcript evaluation | Deterministic local rules |
| Stored evaluation schema | `local_call_eval.v1`, `call_intelligence.v1`, and SQLite `sales_dashboard_intelligence_db.v1` |
| Hashing/audit signals | Import input hash, transcript hash, extraction version, created/updated timestamps |
| External AI calls | None observed for current import |

Positive controls:

- Transcript text is escaped in rendering.
- Optional AI execution is routed through the local execution layer, not provider APIs.
- Prompt/input construction includes guardrails in tests.
- Current import does not silently mix in LLM outputs.

Risks:

- Deterministic rules are useful triage, not final truth.
- The UI should more plainly distinguish rules-based intelligence from LLM-reviewed and manager-reviewed intelligence.
- Older LLM result rows exist in SQLite for a different import, so import scoping must remain visible.
- LLM result quality/rerun handling is present, but current import has no completed local model review.

## 8. Alert And Follow-Up Audit

Alert categories:

| Category | Count |
| --- | ---: |
| Imported outcome mismatch | 6,864 |
| Follow-up needs review | 2,293 |
| Complaint or risk signal | 314 |
| Opt-out detected | 16 |

The alert logic is evidence-backed, but the workflow is incomplete. The dashboard needs:

- Acknowledge/dismiss controls.
- Bulk triage for repeated alert types.
- Filters by severity, salesperson, source, date, review status, and confidence.
- A way to mark source-label corrections separately from transcript-risk confirmations.

Follow-up interpretation should be tightened:

- `completed` should read as "later matching call observed."
- `overdue` should remain a risk signal, not proof of non-compliance.
- `indeterminate_insufficient_future_data` should stay visible because the upload may not contain enough future calls.

## 9. Dashboard UX And Trust Audit

What works well:

- Data Confidence section explicitly says unsupported sales/revenue metrics are not claimed.
- Allocation section states the join grain and campaign attribution limitation.
- Metrics link to drilldown proof.
- Browser console returned no warnings or errors during the inspected page load.
- The allocation section renders and matches API totals.

Trust gaps:

- The date range display is misleading.
- Global filters are missing from the main UI.
- Alert volume is too high for manual scanning.
- The dashboard can be opened on different ports with different loaded data.
- "AI", "system audio", "actioned", and "completed" need sharper labels to prevent over-interpretation.

## 10. Privacy And Governance Findings

Positive findings:

- Source workbooks remain in Downloads and are not copied into Git.
- Derived stores live under `data/`, which is Git-ignored.
- Redacted `dialled_phone_number` is not used for matching or dashboard display.
- No external AI provider usage was observed.
- Transcript rendering is escaped.

Risks:

- `data/store/intelligence.sqlite` and import artifacts contain sensitive derived transcript intelligence and should be treated as operational data.
- Customer IDs and call IDs are visible in dashboard proof views.
- `CallerID` is not excluded from raw proof fields by the same blocklist that excludes `dialled_phone_number`.
- There is no authentication or role-based access. This is acceptable for localhost-only use, but not for sharing beyond the local machine.

## 11. Testing Gaps

| Gap | Current coverage | Recommended test |
| --- | --- | --- |
| Date range timezone/end-date formatting | Not covered | Unit test for multi-day date range display |
| Partial-day allocation warning | Not covered | Fixture where calls start mid-day and allocations are full-day |
| Global dashboard filters | Limited segment filter test | Browser/API tests for date, salesperson, source, outcome, confidence, alert status |
| Alert lifecycle controls | Future plan only | API and browser tests for acknowledge/dismiss/resolve |
| Privacy allowlist for raw proof fields | Partial blocklist test | Test that phone-like fields such as `CallerID` are excluded or explicitly allowed |
| Allocation exact July 7 workbook regression | Aggregate join unit exists | Golden snapshot for key allocation totals and date rows |
| LLM governance on current import | LLM storage tests exist | Test UI labels for deterministic vs LLM vs manager-reviewed states |
| Performance on 20k-row import | Manual observation | Endpoint timing and page-size smoke test |
| System-audio overlap semantics | Some tests exist | Test call-screening with later human conversation label clarity |
| Multiple local instances | Not covered | Health/banner test showing source path hash, import ID, allocation status, and port |

## 12. Recommended Fix Backlog

| Priority | Issue | Fix |
| --- | --- | --- |
| P1 | ISSUE-001 | Fix date range formatting: preserve source date semantics, show both start and end dates, and label timezone/source timezone. |
| P1 | ISSUE-002 | Add data-window completeness checks, especially for first/last day coverage in allocation comparisons. |
| P1 | ISSUE-003 | Add a clear instance/import banner and launcher guard so users do not confuse port 3000 and port 3103 data. |
| P1 | ISSUE-004 | Add global dashboard filters for date, salesperson, source, business type, imported outcome, confidence, alert/review state. |
| P1 | ISSUE-005 | Build alert lifecycle controls: acknowledge, dismiss, assign, bulk action, and filter by status. |
| P1 | ISSUE-006 | Rename allocation comparison metrics so `QTY ACTIONED` and observed stable lead-days are never read as the same thing. |
| P2 | ISSUE-007 | Split raw source categories from inferred source categories and show separate source-quality rollups. |
| P2 | ISSUE-008 | Split system audio into no-human barriers, call-screening with later human, machine voicemail, and carrier system. |
| P2 | ISSUE-009 | Rename follow-up completed to "later call observed" unless evidence proves the requested action was fulfilled. |
| P2 | ISSUE-010 | Move raw proof fields to an explicit allowlist or expand the sensitive-field blocklist. |
| P2 | ISSUE-011 | Add visible labels for deterministic, LLM-reviewed, and manager-reviewed intelligence states. |
| P2 | ISSUE-012 | Add structured manager review workflow and reviewer audit trail controls. |
| P3 | ISSUE-013 | Split the long dashboard into focused work queues or add sticky filters and section-level actions. |

## 13. Things Not To Fix Yet

Do not add campaign-level call attribution until the allocation export includes a shared campaign/list ID or stable lead/customer/contact ID.

Do not infer sales conversion, revenue, order value, or won/lost outcomes from transcripts.

Do not reconstruct phone numbers or use partial phone values for matching.

Do not replace the deterministic evaluator with an LLM layer until strict schema validation, import scoping, confidence handling, rerun states, and manager review policy are settled.

Do not optimize for multi-user deployment before deciding whether this remains localhost-only. If it will be shared, authentication and role controls come first.

## 14. Final Recommendation

Keep the allocation workbook as its own dashboard section and continue leveraging call records only through aggregate-safe reconciliation. That is accurate and defensible because the link is based on fields present in both datasets: date, salesperson, and New/Warm type.

The current dashboard is strong enough for operational discovery and manager triage. It is not yet strong enough for campaign attribution, individual lead proof, compensation decisions, or final performance judgments. The next fixes should focus on trust controls: date display, partial-period warnings, visible filters, alert lifecycle, and clearer labels for inferred or rules-based metrics.
