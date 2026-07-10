# Architecture

## System Overview
Sales Dashboard is a local Node.js web application that turns scheduled CSV/XLSX call exports into an in-memory operational dashboard. Optional campaign/allocation workbooks are parked and retained only as inactive diagnostics.
The MVP avoids a database and external AI calls so the first version is private, testable, and easy to reason about.

## Runtime Flow
1. `src/main.js` resolves the call export path from `--csv`, `--csv-path`, or `SALES_DASHBOARD_CSV_PATH`, and the optional allocation path from `--allocations`, `--allocations-path`, or `SALES_DASHBOARD_ALLOCATIONS_PATH`.
2. Source files are read from their original locations and are not copied into the repository.
3. `src/sourceFile.js`, `src/csvParser.js`, and `src/xlsxReader.js` normalize CSV/XLSX first-sheet tabular inputs into the same CSV-shaped analysis flow.
4. `src/analysis.js` deduplicates by `call_id`, profiles coverage, applies privacy guardrails, links follow-ups through stable IDs only, computes active call/transcript metrics, splits one-dial reattempt records into valid/risky/review buckets, builds a Lead Harvest Queue for positive callback candidates, and marks allocation imports as parked when configured.
5. `src/dateTimeFormat.js` owns UI-facing Australian/AEST display for source call times, filters, report evidence, and stored system timestamps.
6. `src/allocationCoverage.js` remains the preserved parser for separate allocation workbooks, but its totals/reconciliation model is not used by active dashboard analytics.
7. `src/globalFilters.js` normalizes one active filter state and applies it to call/transcript metrics, alert rows, drill-downs, and rendered explorer rows.
8. `src/alertLifecycle.js` defines alert workflow statuses, active/closed counts, non-destructive lifecycle actions, and audit-history normalization.
9. `src/managerReview.js` defines governed review statuses, scopes, correction allowlists, local actor resolution, correction records, and review history.
10. `src/transcriptEvaluator.js` performs deterministic local transcript classification.
11. `src/storage.js` persists derived import history, sanitized evaluation artifacts, parked allocation metadata, alert lifecycle events/history, manager reviews, Evaluation Studio artifacts, and report records under `data/`.
12. `src/evaluationStudio.js` defines the governed Evaluation Studio foundation: seeded Neuron/LatentPulse-derived knowledgebase entries, editable strict-schema templates with safe custom evaluation goals, queued/prompt-test run metadata, run snapshots, automatic reconciliation of small queued prompt-test jobs during Studio page/API reads, run quarantine/resume history, all-eligible-call batch selection support, batch result harvesting support, versioned result records with prompt and knowledgebase-version provenance, filter-aware evidence/result queues, report-safe rollups, result-to-manager-review handoff helpers, safe suggested correction prefill, and local model guardrails.
13. Normal report APIs and dashboard report lists classify stored reports and expose only active reports; parked allocation, stale stable-target, and superseded report content remains preserved in storage but hidden from normal views.
14. `src/aiExecutionLayer.js` optionally submits selected transcript jobs and explicit Evaluation Studio runs to the local AI Execution Layer at `C:\Users\User\Desktop\ai-execution-layer` through `POST /run-task`.
15. `src/dashboardRenderer.js` renders the dashboard and sanitized tables.
16. `/api/summary`, `/api/alerts`, `/api/manager-reviews`, `/api/evaluation-studio`, `/api/calls/<call-id>/reviews`, `/api/allocations`, `/api/imports`, `/api/reports`, `/api/reviews`, and `/api/ai/*` expose local JSON workflows.

## Module Responsibilities
- `src/main.js`: HTTP server, call/allocation path resolution, health and summary routes.
- `src/csvParser.js`: CSV parsing only.
- `src/sourceFile.js`: CSV/XLSX source-file adapter.
- `src/xlsxReader.js`: minimal XLSX first-sheet reader using built-in Node modules.
- `src/allocationCoverage.js`: preserved aggregate allocation parser; parked from active analytics.
- `src/allocationParking.js`: shared parked-allocation diagnostic, stale report classification, and historical report filtering helpers.
- `src/globalFilters.js`: shared active call/transcript filter state, option generation, missing-value buckets, and denominator summaries.
- `src/alertLifecycle.js`: alert lifecycle status definitions, active/closed counting rules, note/history helpers, and alert-event normalization.
- `src/managerReview.js`: manager review status/scope/correction validation, local actor resolution, non-destructive correction overlays, and review-history normalization.
- `src/evaluationStudio.js`: Evaluation Studio knowledgebase/template/run/result model, seeded Neuron/LatentPulse-derived defaults, safe custom evaluation goals, strict output schema validation, prompt-test run typing, run quarantine/resume governance, all-eligible-call batch selection support, batch result harvesting support, guarded local-model input construction, prompt/knowledgebase-version provenance on results, evidence/confidence result normalization, global-filter-aware result and report-safe rollups from labelled findings, manager-review scope/reason mapping, safe suggested correction prefill from allowlisted findings, and parked-data field blocking.
- `src/dateTimeFormat.js`: Australian/AEST UI date/time display helpers.
- `src/transcriptEvaluator.js`: local call-level transcript and outcome evaluation.
- `src/analysis.js`: import profiling, deduplication, active/filtered call-transcript metrics, deterministic lead reattempt buckets, lead harvest candidates, parked allocation status, follow-up linking, alert construction, manager-review governance overlays, and sanitized explorer rows.
- `src/leadHarvestAnalytics.js`: deterministic positive-response callback candidate queue with possible name/timing extraction and stable-ID later-call labels.
- `src/storage.js`: local JSON store, import artifact writer, generated report saver, alert lifecycle persistence, manager review correction/history persistence, and active report visibility.
- `src/aiExecutionLayer.js`: optional client for local Execution Layer status, job submission, and job polling.
- `src/dashboardRenderer.js`: HTML rendering and escaping.
- `tests/analysis.test.js`: parser, privacy, mismatch, and follow-up-linking coverage.
- `tests/storage.test.js`: import persistence, report library, manager review, and store-path coverage.

## Data Boundaries
- Raw CSV/XLSX values stay in process memory only.
- Derived local artifacts are stored under `data/`, which is ignored by Git.
- Redacted phone values are never used for matching or displayed in dashboard rows.
- Invalid customer date/import date values are listed as ignored fields.
- Transcript text is treated as untrusted display content and escaped before rendering.
- Local evaluator outputs are derived data and are persisted as versioned local import artifacts.
- Campaign/allocation imports are parked. They are retained as inactive metadata and excluded from active metrics, reports, alerts, filters, source/list quality, scorecards, and AI transcript context.
- One-dial reattempt records are neutral until deterministic evidence separates valid terminal outcomes, risky no-contact/no-pitch rows, and ambiguous rows needing manager or later local-LLM review.
- Lead harvest candidates are review rows only. They require call/transcript evidence of a live-human positive response plus callback/follow-up context, and later-call labels use stable source IDs only. Missing stable IDs are labelled matching unavailable.
- Alert lifecycle actions are non-destructive overlays on generated call-data alerts. Active alerts are `new`, `acknowledged`, and `in_progress`; `resolved`, `dismissed`, `false_positive`, and parked alerts do not inflate active alert counts.
- Alert lifecycle actor attribution uses the server-side local placeholder `local_manager` until authentication exists; client-supplied actor fields are not authoritative.
- Manager review actions are separate non-destructive overlays on calls/signals/alerts. Review corrections store previous/displayed/manager-corrected values, correction reasons, evidence assessment, notes, actor, timestamp, and history without overwriting raw imported fields, deterministic outputs, LLM outputs, or generated alert evidence.
- Evaluation Studio artifacts are management/evaluation metadata only. Knowledgebase entries, custom-goal templates, runs, local AI harvest state, results, and report-safe rollups are versioned and auditable. Stored local model results preserve prompt/template and knowledgebase-version context and must remain separate from raw imported fields, deterministic outputs, LLM outputs, alert evidence, and manager review history. Run quarantine/resume/harvest state is non-destructive history metadata. Result-to-review handoff creates a normal manager-review record through `src/managerReview.js` and `src/storage.js`; any evaluator-derived correction prefill is stored as suggested-only metadata until a manager confirms it.
- Stored reports can remain in local history, but normal report APIs and UI expose only active reports and hide parked/stale allocation-like report content.
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
