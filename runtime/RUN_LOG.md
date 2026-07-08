# Run Log
Record meaningful development actions here in chronological order.

Format:
YYYY-MM-DD HH:MM action performed

2026-07-05 08:05 - Initialized repository with Agent Forge scaffold.
2026-07-05 08:45 - Built MVP CSV call intelligence dashboard with privacy-safe field exclusions, local transcript evaluation, alerts, review queue, scorecards, tests, and updated docs.
2026-07-05 09:15 - Added local persistence for imports, sanitized evaluation artifacts, alert/review state, automatic executive summaries, and dashboard-accessible generated reports.
2026-07-05 09:30 - Added dashboard report View links and full report viewer pages for opening saved report data.
2026-07-05 09:55 - Added automatic lead utilization and follow-up leakage report with strict callback proof rules, no-contact retry coverage, and dashboard report-library access.
2026-07-05 10:15 - Added dashboard-wide drill-down proof layer with clickable metrics, lead-day proof records, call proof pages, sanitized raw source fields, and manager review form capture.
2026-07-05 10:35 - Added optional local AI Execution Layer integration for transcript jobs through C:\Users\User\Desktop\ai-execution-layer, with environment-only credentials, AI job references, status endpoint, and call-page submission panel.
2026-07-06 09:29 - Reworked transcript evidence display so dashboard/report tables show proof summaries, call pages show ordered transcript proof cards and readable transcript turns, and raw transcripts remain available for audit.
2026-07-07 08:15 - Added aggregate Lead Allocation Coverage with optional CSV/XLSX allocation import, built-in XLSX source reader, date/salesperson/type reconciliation, `/api/allocations`, dashboard section, persistence summaries, tests, and real July 7 workbook verification.
2026-07-08 00:00 - Parked separate campaign/allocation imports from active analytics, removed active allocation dashboard/report/API metric surfaces, added parked diagnostics and regression tests.
2026-07-08 00:35 - Added source-call-time date range labels, active dataset/import banner, call-data-only window warnings, and unsupported sales/revenue/conversion warning without using parked allocation data.
2026-07-08 01:10 - Added intelligence provenance, confidence bands, review-state labels, and explicit evidence-gap wording so deterministic, LLM-reviewed, manager-reviewed, raw imported, and unprocessed states are visibly separated.
2026-07-08 01:45 - Added shared global call/transcript filters with URL state, filtered denominator summaries, low/empty sample warnings, alert/drill-down consistency, and missing-value buckets while keeping allocation data parked.
2026-07-08 02:20 - Added alert lifecycle controls with active/closed status counts, manager notes, lifecycle history, bulk alert actions, `/api/alerts` workflow endpoints, and parked-allocation alert exclusion.
2026-07-08 03:05 - Cleaned up Batch 5 follow-ups: normal report APIs/viewer now hide parked allocation, stale stable-target, and superseded lead-day reports while preserving stored records; alert lifecycle actors are server-resolved as `local_manager`; added regression tests for report filtering, actor hardening, note escaping, parked-alert mutation rejection, and bulk actions.
2026-07-08 04:10 - Added governed manager review workflow with review statuses, correction allowlist, local actor hardening, review history, `/api/manager-reviews`, call review APIs, dashboard/call-page review controls, review governance counts, global review-status filtering, and tests proving corrections do not overwrite raw/deterministic/LLM/alert evidence.
2026-07-08 04:45 - Replaced visible Import Age displays with Record Age, using valid CustomerImportDate first and valid CustomerCreateDate second so LG/SP-created records no longer show n/a when creation date is available.
2026-07-08 05:05 - Updated manager-facing reattempt wording from records touched to records dialed, keeping internal metric keys stable.
2026-07-08 05:20 - Added deterministic one-dial lead reattempt buckets: valid one-dial outcome, risky one-dial no-contact, and needs review. Updated dashboard/report/drilldown wording so one-dial records are neutral unless the risky no-contact subset is shown; tests pass with `node --test tests/*.test.js`.
2026-07-08 05:45 - Generated the July 7 Direct Sales Lead Utilisation data pack using the strict one-dial no-contact/no-later-matching-call signal. Saved Markdown and JSON outputs under `outputs/`, saved an active dashboard report `direct-sales-lead-utilisation-review-july7`, and verified `node --test tests/*.test.js` passes.
