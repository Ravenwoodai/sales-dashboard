# System Map

## Core Paths
- `AGENTS.md`: startup map for agents.
- `AI_SYSTEM.md`: hard operating rules.
- `src/main.js`: local web server and API routes.
- `src/csvParser.js`: CSV parsing boundary.
- `src/sourceFile.js`: CSV/XLSX source-file adapter.
- `src/xlsxReader.js`: minimal XLSX reader for first-sheet tabular imports.
- `src/allocationCoverage.js`: preserved aggregate allocation parser, parked from active analytics.
- `src/allocationParking.js`: parked allocation diagnostic, stale report classification, and historical parked-data filtering helpers.
- `src/globalFilters.js`: shared active call/transcript filter state, option generation, missing-value buckets, and denominator summaries.
- `src/alertLifecycle.js`: alert workflow statuses, active/closed/parked counting, manager notes, and audit-history helpers.
- `src/managerReview.js`: manager review statuses, scopes, correction allowlist, local actor resolution, correction overlays, and review-history helpers.
- `src/transcriptEvaluator.js`: local deterministic transcript-evaluation rules.
- `src/analysis.js`: data profiling, deduplication, active/filtered call-transcript metrics, deterministic lead reattempt buckets, parked allocation status, alerts, manager-review governance overlays, and sanitized explorer data.
- `src/storage.js`: local ignored JSON store for imports, derived evaluation artifacts, alert lifecycle state/history, manager review correction/history state, and reports.
- `src/dashboardRenderer.js`: dashboard HTML, escaping, and table rendering.
- `tests/analysis.test.js`: current automated verification.
- `tests/storage.test.js`: persistence and report-library verification.
- `docs/`: product, architecture, plan, decision, and quality records.
- `runtime/`: backlog, logs, blockers, and handover state.
- `.ai/context.json`: machine-readable runtime and verification metadata.

## Product Ownership Boundaries
- CSV ingestion owns source-file parsing and schema checks.
- Allocation ingestion owns preserved parsing and parked diagnostic metadata only.
- Analysis owns metrics, filtering, denominators, and guardrails.
- Transcript evaluation owns local call-level signals.
- Dashboard rendering owns user-facing presentation and escaping.
- Storage owns local persistence under ignored `data/`.
- Runtime docs own operational truth for future agents.

## Current Data Guardrails
- `dialled_phone_number` is intentionally incomplete for security and excluded from analytics.
- Valid `CustomerImportDate` and `CustomerCreateDate` are used only for source-quality Record Age. Malformed date fragments are treated as missing, and raw date fields stay out of proof tables.
- Current CSVs do not support sales/revenue claims.
- Campaign/allocation imports are parked and excluded from active metrics, reports, alerts, filters, source/list quality, scorecards, and AI transcript context.
- Active alert counts include only `new`, `acknowledged`, and `in_progress` call-data alerts. `resolved`, `dismissed`, `false_positive`, and parked allocation-related alerts are excluded from active alert totals.
- Manager review statuses are separate from alert lifecycle statuses. Review corrections are manager-reviewed overlays and cannot mutate raw imported fields, deterministic/LLM outputs, or generated alert evidence.
- One-dial reattempt records are neutral until deterministic evidence separates valid terminal outcomes, risky no-contact/no-pitch rows, and rows needing manager or later local-LLM review.
- Normal report APIs and the dashboard Reports Library show active reports only; parked allocation, stale stable-target, and superseded lead-day report content is preserved in storage but hidden from normal report access.
- Alert lifecycle actions use the server-resolved `local_manager` actor until authentication exists; client-supplied actor names are ignored for authoritative lifecycle history.
- Stable ID linkage is allowed only from source IDs, not from partial phone values.

## Verification
- Run `node --test tests/*.test.js`.
- Start the app with `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`.
- Start the app with allocations parked using `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`.
- Open `http://127.0.0.1:3000`.
- Check `http://127.0.0.1:3000/health` and `http://127.0.0.1:3000/api/summary`.
- Check `http://127.0.0.1:3000/api/alerts` for lifecycle-filtered active alert workflow data.
- Check `http://127.0.0.1:3000/api/manager-reviews` and `http://127.0.0.1:3000/api/calls/<call-id>/reviews` for governed manager review records.
- Check `http://127.0.0.1:3000/api/imports` and `http://127.0.0.1:3000/api/reports`.
- Check `http://127.0.0.1:3000/api/allocations` for parked diagnostic metadata when an allocation file is configured.
- Open saved reports at `http://127.0.0.1:3000/reports/<report-id>`.
