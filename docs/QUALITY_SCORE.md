# Quality Score
Use this file to keep quality, risk, and debt visible in Sales Dashboard.

| Area | Score | Notes | Next Step |
| --- | --- | --- | --- |
| Product clarity | 4/5 | MVP scope is explicit: local CSV/XLSX call intelligence, strict no-contact/no-later lead-utilisation-risk reporting, deterministic one-dial reattempt buckets, global call-data filters, parked allocation imports, alert lifecycle triage, governed manager review corrections, active-only report APIs, no sales/revenue claims, phone/date guardrails, local import history, and report library behavior are documented. | Keep ambiguous one-dial rows outside the hard no-contact report unless later confirmed through manager-approved review. |
| Architecture legibility | 4/5 | Main modules are separated across source parsing, parked allocation diagnostics, shared global filtering, alert lifecycle helpers, manager review governance helpers, evaluation, analysis, storage, server, and rendering. | Consider SQLite only if JSON-file persistence becomes too limited. |
| Verification | 4/5 | Tests cover CSV parsing, workbook-style dates, parked allocation exclusion, stale report filtering, global filter denominator/drill-down consistency, deterministic one-dial bucket rollups and proof drilldowns, alert lifecycle actions/history/bulk updates with local actor hardening, manager review correction/history/allowlist/actor/filter/UI behavior, phone/date exclusions, local mismatch detection, stable-ID follow-up linking, readable evidence summaries, import persistence, report saving, and review state. | Add automated browser/UI smoke tests once dashboard interactions become richer. |
| Runtime operability | 4/5 | App boots from `node src/main.js`, accepts configured CSV/XLSX call paths and parked allocation paths, writes ignored local store artifacts, and exposes health, summary, alert lifecycle, diagnostic allocations, imports, reports, and review APIs. | Add scheduled import automation when the source cadence is finalized. |
| Security hygiene | 4/5 | Redacted phone data is preserved only as raw input and excluded from MVP analytics/display; no external AI calls are made. | Add access controls before exposing transcript detail beyond localhost. |

## Current Risk Notes
- The deterministic evaluator is a useful first-pass triage layer, not a final human-quality AI review system.
- One-dial reattempt buckets are conservative deterministic indicators. The reportable lead-utilisation-risk signal is only one dial plus clear no-contact plus no later matching call observed; valid terminal outcomes are separated, and ambiguous rows stay out of the risk score unless later confirmed through manager-approved review.
- Alert volume is high on the July 1 CSV because many meaningful calls have blank imported dispositions.
- Follow-up completion is often indeterminate with a one-day upload because there is not enough future data.
- Transcript speaker order still depends on the CSV transcript source; the UI now preserves that order and avoids clipping evidence mid-word, but it does not perform diarisation correction.
- Local persistence is JSON-file backed under `data/`; it is suitable for MVP history but not multi-user concurrent review.
- Campaign/allocation imports are parked. Historical local stores may still contain old allocation-derived reports/events, so active persistence views and normal report APIs filter parked/stale reports and parked-data alerts from normal counts.
- Global filters are URL/query based and tested for core dashboard modules; very large intelligence tables still use bounded local reads until a database-backed query layer is introduced.
- Alert lifecycle actions are persisted with the server-resolved local actor placeholder `local_manager`; real authentication should replace the placeholder before multi-user use.
- Manager review actions also use the server-resolved local actor placeholder `local_manager`. Corrections are auditable overlays, but JSON-file storage is still not a concurrent multi-user workflow engine.

## Update Rules
- Increase or decrease scores when reality changes.
- Record major risks here instead of leaving them implicit.
- Link plan or decision updates when they change the score materially.
