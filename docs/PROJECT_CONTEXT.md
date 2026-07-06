# Project Context

## 1. System Overview
Sales Dashboard is a local Node.js web app for scheduled CSV sales-call transcript exports. It profiles import quality, deduplicates calls, runs deterministic local transcript evaluation, optionally submits local model jobs through the AI Execution Layer, persists derived local history, and renders a manager-facing dashboard without using unsupported phone/date, sales, or revenue assumptions.

## 2. Core Objective
Make the current CSV useful and safe: surface contact quality, meaningful conversations, follow-up signals, imported-outcome mismatches, source/list quality, manager review queues, import history, and generated reports while preserving privacy and data-confidence boundaries.

## 3. Key Entities
- CSV import
- Canonical call
- Local call evaluation
- Evidence snippet
- Alert event
- Manager review queue item
- Manager review record
- Generated report
- Local AI job reference
- Salesperson scorecard
- Source/list quality row
- Ignored field guardrail

## 4. System Flow
1. Start with `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"` or set `SALES_DASHBOARD_CSV_PATH`.
2. Parse the CSV with `src/csvParser.js`.
3. Deduplicate by `call_id` and ignore privacy-reduced or invalid fields for analytics.
4. Evaluate each transcript locally with deterministic rules in `src/transcriptEvaluator.js`.
5. Link follow-up signals through stable source IDs only.
6. Build metrics, alerts, sanitized evaluation rows, and explorer rows in `src/analysis.js`.
7. Persist derived import history, evaluation artifacts, alert/review state, and reports through `src/storage.js`.
8. Submit optional local model transcript jobs through `src/aiExecutionLayer.js` and `C:\Users\User\Desktop\ai-execution-layer`.
9. Render the dashboard through `src/dashboardRenderer.js`.

## 5. Architecture Snapshot
- `src/main.js`: local HTTP server, `/health`, `/api/summary`, and optional reload route.
- `src/csvParser.js`: CSV parser.
- `src/transcriptEvaluator.js`: local transcript-quality, contact, outcome, follow-up, and risk classifier.
- `src/analysis.js`: import profiling, deduplication, metrics, alerts, follow-up status, and sanitized rows.
- `src/storage.js`: ignored local JSON store, import artifact writer, generated report saver, and manager review persistence.
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
- Test command: `node --test tests/*.test.js`
- Open URL: `http://127.0.0.1:3000`
- Healthcheck URL: `http://127.0.0.1:3000/health`
- Imports API: `http://127.0.0.1:3000/api/imports`
- Reports API: `http://127.0.0.1:3000/api/reports`
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
- Last Generated: 2026-07-05T09:15:00.000Z
- Confidence Level: high
