# Architecture

## System Overview
Sales Dashboard is a local Node.js web application that turns scheduled CSV call exports into an in-memory operational dashboard.
The MVP avoids a database and external AI calls so the first version is private, testable, and easy to reason about.

## Runtime Flow
1. `src/main.js` resolves the CSV path from `--csv`, `--csv-path`, or `SALES_DASHBOARD_CSV_PATH`.
2. The CSV file is read from its original location and is not copied into the repository.
3. `src/csvParser.js` parses the CSV with quoted-field support.
4. `src/analysis.js` deduplicates by `call_id`, profiles coverage, applies privacy guardrails, links follow-ups through stable IDs only, and computes metrics.
5. `src/transcriptEvaluator.js` performs deterministic local transcript classification.
6. `src/storage.js` persists derived import history, sanitized evaluation artifacts, alert events, manager reviews, and report records under `data/`.
7. `src/aiExecutionLayer.js` optionally submits selected transcript jobs to the local AI Execution Layer at `C:\Users\User\Desktop\ai-execution-layer` through `POST /run-task`.
8. `src/dashboardRenderer.js` renders the dashboard and sanitized tables.
9. `/api/summary`, `/api/imports`, `/api/reports`, `/api/reviews`, and `/api/ai/*` expose local JSON workflows.

## Module Responsibilities
- `src/main.js`: HTTP server, CSV path resolution, health and summary routes.
- `src/csvParser.js`: CSV parsing only.
- `src/transcriptEvaluator.js`: local call-level transcript and outcome evaluation.
- `src/analysis.js`: import profiling, deduplication, metrics, follow-up linking, alert construction, and sanitized explorer rows.
- `src/storage.js`: local JSON store, import artifact writer, generated report saver, and manager review persistence.
- `src/aiExecutionLayer.js`: optional client for local Execution Layer status, job submission, and job polling.
- `src/dashboardRenderer.js`: HTML rendering and escaping.
- `tests/analysis.test.js`: parser, privacy, mismatch, and follow-up-linking coverage.
- `tests/storage.test.js`: import persistence, report library, manager review, and store-path coverage.

## Data Boundaries
- Raw CSV values stay in process memory only.
- Derived local artifacts are stored under `data/`, which is ignored by Git.
- Redacted phone values are never used for matching or displayed in dashboard rows.
- Invalid customer date/import date values are listed as ignored fields.
- Transcript text is treated as untrusted display content and escaped before rendering.
- Local evaluator outputs are derived data and are persisted as versioned local import artifacts.
- Local model jobs are submitted only through the Execution Layer API; Sales Dashboard stores job references, not raw model outputs.

## Future Architecture
The next architecture step should replace the JSON store with SQLite only when concurrent users, large import history, or richer filtering makes file-backed state too limited.
Future data-model candidates:
- raw import archive outside Git
- canonical calls table
- versioned call evaluations
- evidence table
- manager review and alert lifecycle tables
- optional LLM-backed evaluator behind strict schema validation
