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
- Added the Lead Harvest Queue. `src/leadHarvestAnalytics.js`, `/api/lead-harvest`, dashboard Lead Harvest cards/tables, and harvest drill-down metrics identify New Business calls with deterministic live-human, positive-response, and callback/follow-up evidence. Possible names, callback timing, and handover context are extracted as review context only; later-call labels use stable IDs only, and missing stable IDs are labelled matching unavailable.
- Expanded Lead Harvest Queue review context. Candidate rows now include deterministic customer objection tags, salesperson handling tags, objection/handling summary tables, newest/oldest/view-all queue links, and sorted/paginated harvest drilldowns. Later matching call observed means a later stable-ID call exists in the active import; it does not prove completion.
- Reworked call proof pages so the readable Transcript Timeline appears before Detected Signal proof excerpts. Useless speaker-label-only match text is hidden, and 12-month/next-financial-year callback wording is classified as long-term deferral/future nurture instead of active follow-up or Lead Harvest candidate evidence.
- Completed Batch 7 Evaluation Studio. `src/evaluationStudio.js`, `src/storage.js`, `src/main.js`, and `src/dashboardRenderer.js` now provide seeded Neuron/LatentPulse-derived knowledgebase entries, editable/archivable knowledgebase records, standalone `/evaluation-studio` management workspace with a text-file loader, editable/archivable strict-schema evaluation templates with safe custom evaluation goals, queued evaluation runs with template/knowledgebase snapshots and all-eligible-call selection support, one-call prompt test runs, run quarantine/resume governance with history, batch result harvesting from queued local AI jobs, versioned result records preserving prompt/template and knowledgebase-version context, global-filter-aware result/evidence/rollup views, manager-review handoff from stored result records with safe suggested correction prefill, report-safe Evaluation Studio lead utilisation/coaching rollups, `/api/evaluation-studio`, `/api/evaluation-studio/results`, `/api/evaluation-studio/prompt-tests`, `/api/evaluation-studio/report-rollups`, compact dashboard Evaluation Results bridge, and optional explicit local Execution Layer submission.
- Local Evaluation Studio prompt testing is enabled for the current July 7 dashboard run. The Execution Layer now has a dedicated `sales_dashboard_evaluation_studio` task type and Sales Dashboard model route for editable Studio prompt/knowledgebase runs, while normal transcript intelligence extraction remains on `sales_transcript_intelligence_extraction`. A one-call callback-opportunity prompt test for call `48541981` completed and was harvested into an Evaluation Studio result.
- Small queued Evaluation Studio prompt-test runs now auto-harvest completed local AI jobs when `/evaluation-studio` or the Evaluation Studio APIs are opened, so completed prompt tests should not remain displayed as `running` waiting for a manual Harvest click.
- UI date/time display is standardized to Australian format and AEST. Source call times display as `DD/MM/YYYY HH:mm:ss AEST` without browser timezone conversion; stored timestamps such as imported/updated/reviewed times are converted to fixed AEST through `src/dateTimeFormat.js`.

## In Progress
- None.

## Blockers
- none

## Recommended Next Task
- Keep future filters in `src/globalFilters.js`; do not add separate module-specific allocation/campaign filters.
- Keep normal report APIs active-only unless an explicit internal/admin diagnostic mode is approved.
- Treat Lead Harvest Queue rows as manager review/callback prep candidates, not confirmed sales or revenue outcomes. Objection/handling tags are evidence-backed review indicators, not manager-confirmed truth. Do not add phone matching or parked allocation data to this queue.
- Keep long-term deferrals out of active callback/harvest counts unless a manager explicitly chooses to create a future nurture workflow.
- Optional: add browser smoke coverage for Evaluation Studio UI interactions if the workflow grows more complex. Do not let evaluator outputs silently replace deterministic or manager-reviewed values, and do not use them for the hard no-contact utilisation score unless explicitly labelled and governed.
- Later: add diarisation/order correction only through the planned local AI evaluation layer; current UI preserves source transcript order and separates the timeline from signal excerpts.
- Later: revisit allocation data only after an explicit product decision; do not rebuild allocation dashboards or allocation-derived performance metrics by default.

## Verification Commands
- `node --test tests/*.test.js`
- `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`
- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/summary`
- `http://127.0.0.1:3000/api/alerts`
- `http://127.0.0.1:3000/api/manager-reviews`
- `http://127.0.0.1:3000/evaluation-studio`
- `http://127.0.0.1:3000/api/evaluation-studio`
- `http://127.0.0.1:3000/api/lead-harvest`
- `http://127.0.0.1:3000/api/allocations`
- `http://127.0.0.1:3000/api/imports`
- `http://127.0.0.1:3000/api/reports`
- `http://127.0.0.1:3000/reports/direct-sales-lead-utilisation-review-july7` when the active app is running on port 3000, or use the same path on the currently running July 7 port.
