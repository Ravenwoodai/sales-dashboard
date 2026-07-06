# System Map

## Core Paths
- `AGENTS.md`: startup map for agents.
- `AI_SYSTEM.md`: hard operating rules.
- `src/main.js`: local web server and API routes.
- `src/csvParser.js`: CSV parsing boundary.
- `src/transcriptEvaluator.js`: local deterministic transcript-evaluation rules.
- `src/analysis.js`: data profiling, deduplication, metrics, alerts, and sanitized explorer data.
- `src/storage.js`: local ignored JSON store for imports, derived evaluation artifacts, alert/review state, and reports.
- `src/dashboardRenderer.js`: dashboard HTML, escaping, and table rendering.
- `tests/analysis.test.js`: current automated verification.
- `tests/storage.test.js`: persistence and report-library verification.
- `docs/`: product, architecture, plan, decision, and quality records.
- `runtime/`: backlog, logs, blockers, and handover state.
- `.ai/context.json`: machine-readable runtime and verification metadata.

## Product Ownership Boundaries
- CSV ingestion owns source-file parsing and schema checks.
- Analysis owns metrics and guardrails.
- Transcript evaluation owns local call-level signals.
- Dashboard rendering owns user-facing presentation and escaping.
- Storage owns local persistence under ignored `data/`.
- Runtime docs own operational truth for future agents.

## Current Data Guardrails
- `dialled_phone_number` is intentionally incomplete for security and excluded from analytics.
- `CustomerCreateDate` and `CustomerImportDate` are excluded until the export contains real timestamps.
- Current CSVs do not support sales/revenue claims.
- Stable ID linkage is allowed only from source IDs, not from partial phone values.

## Verification
- Run `node --test tests/*.test.js`.
- Start the app with `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`.
- Open `http://127.0.0.1:3000`.
- Check `http://127.0.0.1:3000/health` and `http://127.0.0.1:3000/api/summary`.
- Check `http://127.0.0.1:3000/api/imports` and `http://127.0.0.1:3000/api/reports`.
- Open saved reports at `http://127.0.0.1:3000/reports/<report-id>`.
