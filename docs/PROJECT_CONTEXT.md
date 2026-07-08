# Project Context

## 1. System Overview
Sales Dashboard is a local Node.js web app for scheduled CSV/XLSX sales-call transcript exports. It profiles import quality, deduplicates calls, runs deterministic local transcript evaluation, parks optional campaign/allocation imports outside active analytics, optionally submits local model jobs through the AI Execution Layer, persists derived local history, and renders a manager-facing dashboard without using unsupported phone/date, sales, or revenue assumptions.

## 2. Core Objective
Make the current call export useful and safe: surface contact quality, meaningful conversations, follow-up signals, lead reattempt behaviour, imported-outcome mismatches, call-CSV source/list quality, manager review queues, import history, and generated reports while preserving privacy and data-confidence boundaries. Preserve separate campaign/allocation data only as parked diagnostics.

## 3. Key Entities
- CSV/XLSX import
- Canonical call
- Local call evaluation
- Evidence snippet
- Lead reattempt bucket
- Alert event
- Alert lifecycle action
- Manager review queue item
- Manager review record
- Manager review correction
- Manager review history event
- Generated report
- Global filter state
- Parked allocation import diagnostic
- Local AI job reference
- Salesperson scorecard
- Source/list quality row
- Ignored field guardrail

## 4. System Flow
1. Start with `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"` or set `SALES_DASHBOARD_CSV_PATH`.
2. Optionally provide `--allocations <path>` or `SALES_DASHBOARD_ALLOCATIONS_PATH` for a parked allocation CSV/XLSX diagnostic.
3. Parse CSV/XLSX first-sheet tabular inputs with `src/sourceFile.js`, `src/csvParser.js`, and `src/xlsxReader.js`.
4. Deduplicate calls by `call_id`, ignore privacy-reduced fields for analytics, and parse valid customer import/create dates only for source-quality Record Age.
5. Evaluate each transcript locally with deterministic rules in `src/transcriptEvaluator.js`.
6. Link follow-up signals through stable source IDs only.
7. Build active call/transcript metrics, deterministic one-dial lead reattempt buckets, parked allocation status, alerts, sanitized evaluation rows, and explorer rows in `src/analysis.js`.
8. Apply shared global call/transcript filters with `src/globalFilters.js` for summary APIs, dashboard cards, alerts, drill-downs, and explorer rows.
9. Merge alert lifecycle state with generated call-data alerts using `src/alertLifecycle.js`.
10. Apply governed manager review overlays from `src/managerReview.js` and `src/storage.js` so review status, corrections, and history remain separate from raw/deterministic/LLM/alert evidence.
11. Persist derived import history, parked allocation metadata, evaluation artifacts, alert lifecycle history, manager review correction/history state, and reports through `src/storage.js`.
12. Classify stored reports so normal report APIs and dashboard report lists expose active reports only while preserving parked/stale records internally.
13. Submit optional local model transcript jobs through `src/aiExecutionLayer.js` and `C:\Users\User\Desktop\ai-execution-layer`.
14. Render the dashboard through `src/dashboardRenderer.js`.

## 5. Architecture Snapshot
- `src/main.js`: local HTTP server, `/health`, `/api/summary`, and optional reload route.
- `src/csvParser.js`: CSV parser.
- `src/sourceFile.js`: CSV/XLSX source-file adapter.
- `src/xlsxReader.js`: minimal XLSX first-sheet reader using built-in Node modules.
- `src/allocationCoverage.js`: preserved allocation workbook parser, parked from active analytics.
- `src/allocationParking.js`: parked allocation diagnostic, stale report classification, and historical parked-data filtering helpers.
- `src/globalFilters.js`: shared active call/transcript filter state, option generation, missing-value buckets, and denominator summaries.
- `src/alertLifecycle.js`: alert status, active/closed count, server-resolved local actor, manager note, and lifecycle-history helpers.
- `src/managerReview.js`: manager review status/scope/correction allowlist, local actor resolution, correction overlay, and review-history helpers.
- `src/transcriptEvaluator.js`: local transcript-quality, contact, outcome, follow-up, and risk classifier.
- `src/analysis.js`: import profiling, deduplication, active/filtered call-transcript metrics, parked allocation status, deterministic lead reattempt buckets, alerts, follow-up status, manager-review governance overlays, and sanitized rows.
- `src/storage.js`: ignored local JSON store, import artifact writer, generated report saver, active report visibility view, alert lifecycle persistence, and manager review correction/history persistence.
- `src/aiExecutionLayer.js`: optional local AI Execution Layer client for transcript jobs.
- `src/dashboardRenderer.js`: HTML renderer and escaping layer.
- `tests/analysis.test.js`: parser and evaluator checks.
- `tests/storage.test.js`: persistence and report-library checks.

## 6. Agent Orchestration Model
- Startup map: `AGENTS.md`
- Operating rules: `AI_SYSTEM.md`
- Instructions: `agent/INSTRUCTIONS.md`
- Backlog: `runtime/AUTONOMOUS_BACKLOG.md`
- UI standard: `docs/UI_DESIGN_STANDARD.md`
- Plans and quality: `docs/PLANS.md` and `docs/QUALITY_SCORE.md`

## 7. Current State
- Template: web-app
- Stack: Node.js
- Runtime type: web
- Run command: `node src/main.js`
- Sample-data run command: `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- Parked allocation run command: `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`
- Test command: `node --test tests/*.test.js`
- Open URL: `http://127.0.0.1:3000`
- Healthcheck URL: `http://127.0.0.1:3000/health`
- Alerts API: `http://127.0.0.1:3000/api/alerts`
- Imports API: `http://127.0.0.1:3000/api/imports`
- Reports API: `http://127.0.0.1:3000/api/reports`
- Allocations API: `http://127.0.0.1:3000/api/allocations`
- Manager Reviews API: `http://127.0.0.1:3000/api/manager-reviews`
- AI status API: `http://127.0.0.1:3000/api/ai/status`
- Local store: `data/store/state.json`, ignored by Git.

## 8. Source Map
- `/docs/PROJECT.md`
- `/docs/SPEC.md`
- `/docs/ARCHITECTURE.md`
- `/docs/SYSTEM_MAP.md`
- `/docs/UI_DESIGN_STANDARD.md`
- `/docs/AGENT_CONTEXT.md`
- `/runtime/AUTONOMOUS_BACKLOG.md`

## 9. Metadata
- Last Generated: 2026-07-08T04:45:00.000Z
- Confidence Level: high
