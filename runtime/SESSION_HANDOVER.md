# Session Handover

## Completed
- Built the Sales Dashboard MVP as a local Node.js web app.
- Added CSV parsing, call deduplication, data-confidence checks, local transcript evaluation, stable-ID follow-up linking, alerts, review queue, scorecards, source quality, and sanitized explorer views.
- Documented that `dialled_phone_number` is ignored for MVP analytics. Valid `CustomerImportDate` and `CustomerCreateDate` now support source-quality Record Age, while malformed fragments remain missing and raw date fields stay out of proof tables.
- Added automated tests for parser, privacy guardrails, outcome mismatch, and stable-ID follow-up linking.
- Added local ignored persistence for import history, sanitized evaluation artifacts, alert events, manager review records, and generated reports.
- Added Reports Library plus report-saving API so future generated reports can be viewed from the dashboard.
- Added report viewer pages at `/reports/<report-id>` and View links in the Reports Library.
- Reworked transcript evidence display so tables show proof summaries, call pages show ordered evidence cards and a readable transcript view, and raw transcripts remain available for audit.
- Previously added optional CSV/XLSX allocation import and Lead Allocation Coverage; this is now superseded by the parked allocation decision.
- Preserved built-in first-sheet XLSX reading for call/allocation workbooks and `/api/allocations`, but active artifacts now store parked metadata instead of allocation summaries.
- Parked separate campaign/allocation imports from active dashboard use. `/api/allocations` now returns parked diagnostic metadata only, active analysis no longer builds allocation coverage, active reports/alerts hide parked-data artifacts, and allocation fields are stripped from AI transcript context.
- Added intelligence provenance and confidence labelling so raw imported fields, deterministic transcript signals, usable LLM-reviewed output, manager review state, unprocessed rows, and missing evidence are visibly separated.
- Added shared global call/transcript filters. Summary APIs, dashboard cards, alert centre, scorecards, drill-downs, and raw explorer rows now use the same filtered call population with visible counts, denominator notes, low/empty sample warnings, URL state, and missing-value buckets.
- Added alert lifecycle controls. The Alert Centre and `/api/alerts` now support new, acknowledged, in-progress, resolved, dismissed, likely false-positive, and parked status handling; manager notes; lifecycle history; bulk actions; and active alert counts that exclude closed and parked alerts.
- Cleaned up Batch 5 follow-ups. Normal `/api/reports`, `/api/reports/:id`, `/reports/<id>`, and dashboard report lists hide parked allocation, stale stable-target, stable lead-day, lead-day, and allocation-like reports by default while preserving raw stored report records. Alert lifecycle actors are fixed to `local_manager` until authentication exists, even when clients submit actor fields.
- Added governed manager review workflow. `/api/manager-reviews`, `/api/calls/<call-id>/reviews`, `/reviews`, call pages, the review queue, alert-centre linked review forms, global manager-review filters, and raw explorer rows now support review statuses, corrections, correction history, local actor hardening, and manager-reviewed overlays without overwriting raw imported, deterministic, LLM, or alert evidence.
- Updated lead reattempt behaviour so one-dial records are neutral and split into valid one-dial outcomes, risky one-dial no-contact rows, and needs-review rows. Dashboard cards, proof drilldowns, and automatic reports now show the risky subset instead of calling all one-dial records waste.
- Generated the report-ready July 7 Direct Sales Lead Utilisation data pack. The Markdown output is `outputs/direct_sales_lead_utilisation_data_pack_july7.md`, the structured JSON output is `outputs/direct_sales_lead_utilisation_data_pack_july7.json`, and the dashboard report ID is `direct-sales-lead-utilisation-review-july7`. The pack starts with a full salesperson leaderboard and uses only the strict one-dial no-contact/no-later-matching-call signal.

## In Progress
- none

## Blockers
- none

## Recommended Next Task
- Keep future filters in `src/globalFilters.js`; do not add separate module-specific allocation/campaign filters.
- Keep normal report APIs active-only unless an explicit internal/admin diagnostic mode is approved.
- Next major product slice: strict-schema local/approved LLM evaluator option if still wanted. Do not let it silently replace deterministic or manager-reviewed values, and do not use it for the hard no-contact utilisation score.
- Later: add diarisation/order correction only through the planned local AI evaluation layer; current UI preserves source transcript order.
- Later: revisit allocation data only after an explicit product decision; do not rebuild allocation dashboards or allocation-derived performance metrics by default.

## Verification Commands
- `node --test tests/*.test.js`
- `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`
- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/summary`
- `http://127.0.0.1:3000/api/alerts`
- `http://127.0.0.1:3000/api/manager-reviews`
- `http://127.0.0.1:3000/api/allocations`
- `http://127.0.0.1:3000/api/imports`
- `http://127.0.0.1:3000/api/reports`
- `http://127.0.0.1:3000/reports/direct-sales-lead-utilisation-review-july7` when the active app is running on port 3000, or use the same path on the currently running July 7 port.
