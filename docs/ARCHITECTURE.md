# Architecture

## System Overview
Sales Dashboard is a local Node.js web application that turns scheduled CSV/XLSX call exports into an in-memory operational dashboard. Optional campaign/allocation workbooks are parked and retained only as inactive diagnostics.
The MVP avoids a database and external AI calls so the first version is private, testable, and easy to reason about.

## Runtime Flow
1. `src/main.js` resolves the call export path from `--csv`, `--csv-path`, or `SALES_DASHBOARD_CSV_PATH`, and the optional allocation path from `--allocations`, `--allocations-path`, or `SALES_DASHBOARD_ALLOCATIONS_PATH`.
2. Source files are read from their original locations and are not copied into the repository.
3. `src/sourceFile.js`, `src/csvParser.js`, and `src/xlsxReader.js` normalize CSV/XLSX first-sheet tabular inputs into the same CSV-shaped analysis flow.
4. `src/analysis.js` deduplicates by `call_id`, profiles coverage, applies privacy guardrails, links follow-ups through stable IDs only, records later exact-ID attempts without claiming completion, computes active call/transcript metrics, splits one-dial reattempt records into valid/risky/review buckets, builds a Lead Harvest Queue for positive callback candidates, and marks allocation imports as parked when configured.
5. `src/selfSourcingAttribution.js` builds an isolated New Business attribution audit from valid record/import/create dates. It distinguishes long-held CRM records, confirmed historical imports, and salesperson-created records without claiming online self-sourcing or changing attribution.
6. `src/weeklyLeadIntelligence.js` exposes the supplied weekly-report snapshot separately from active call metrics, allocation, commercial outcomes, and attribution.
7. `src/dateTimeFormat.js` owns UI-facing Australian/AEST display for source call times, filters, report evidence, and stored system timestamps.
6. `src/allocationCoverage.js` remains the preserved parser for separate allocation workbooks, but its totals/reconciliation model is not used by active dashboard analytics.
7. `src/globalFilters.js` normalizes one active filter state and applies it to call/transcript metrics, alert rows, drill-downs, and rendered explorer rows.
8. `src/alertLifecycle.js` defines alert workflow statuses, active/closed counts, non-destructive lifecycle actions, and audit-history normalization.
9. `src/managerReview.js` defines governed review statuses, scopes, correction allowlists, local actor resolution, correction records, and review history.
10. `src/badLeadClaim.js` defines the internal `bad_lead_claim.v1` salesperson-claim record, strict reason/status validation, trusted actor context, immutable allegation fields, manager-only decisions, and append-only claim history.
11. `src/transcriptEvaluator.js` performs deterministic local transcript classification.
12. `src/storage.js` persists derived import history, sanitized evaluation artifacts, parked allocation metadata, alert lifecycle events/history, manager reviews, internal bad-lead claims, Evaluation Studio artifacts, and report records under `data/`.
13. `src/evaluationStudio.js` defines the governed Evaluation Studio foundation: the neutral three-lens Call Intelligence Foundation, deterministic specialist routing, typed Callback/Procedure/Objection v2 contracts, editable strict-schema custom templates, a manager-calibrated three-outcome Offer Acceptance evaluator with semantic validation and field-relevant proof, queued/prompt-test run metadata, versioned result/audit records, full-transcript input fingerprints, filter-aware result queues, rollups, manager-review handoff helpers, and local model guardrails.
14. Normal report APIs and dashboard report lists classify stored reports and expose only active reports; parked allocation, stale stable-target, and superseded report content remains preserved in storage but hidden from normal views.
15. `src/aiExecutionLayer.js` optionally submits selected transcript jobs and explicit Evaluation Studio runs to the local AI Execution Layer at `C:\Users\User\Desktop\ai-execution-layer` through `POST /run-task`. The Execution Layer stamps Evaluation Studio jobs with `dynamic-schema-v1`, allows one leased process identity to own that protected queue, blocks stale/incompatible claim SQL at the database boundary, records worker/attempt provenance, and exposes sanitised ownership state through `/health`.
16. `src/dashboardRenderer.js` renders the dashboard and sanitized tables.
17. `/api/summary`, `/api/alerts`, `/api/manager-reviews`, `/api/evaluation-studio`, `/api/calls/<call-id>/reviews`, `/api/allocations`, `/api/imports`, `/api/reports`, `/api/reviews`, and `/api/ai/*` expose local JSON workflows.

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
- `src/badLeadClaim.js`: internal bad-lead claim schema, reason/status validation, controlled transitions, trusted actor boundaries, append-only audit history, and exact call-first/lead-only Evaluation Studio context selection.
- `src/evaluationStudio.js`: Evaluation Studio knowledgebase/template/run/result model, the `call_intelligence_foundation.v3` schema, final-outcome and long-term-nurture reconciliation, transcript-grounded represented-party capture, shared Foundation context for specialist rows, independent opportunity/measurement/efficiency lenses, locally reconciled routes to five specialist goals, strict output and transcript-proof validation, proof-preserving represented-party repair, Lead Record and Offer Acceptance semantic validators, run governance, provenance, Foundation/specialist rollups, manager-review mapping, and parked-data field blocking.
- `src/callIntelligenceAggregate.js`: deterministic `call_intelligence_aggregate.v1` and `call_commercial_state.v1` views that separate accepted-offer evidence from payment/invoice/fulfilment/revenue/CRM verification, resolve supported relative dates from source DD/MM/YYYY, expose authority conflicts and specialist lifecycle states, retain provenance, and select strong exact transcript excerpts for historical and current results.
- `src/dateTimeFormat.js`: Australian/AEST UI date/time display helpers.
- `src/transcriptEvaluator.js`: local call-level transcript and outcome evaluation.
- `src/analysis.js`: import profiling, deduplication, active/filtered call-transcript metrics, deterministic lead reattempt buckets, lead harvest candidates, parked allocation status, follow-up linking, alert construction, manager-review governance overlays, and sanitized explorer rows.
- `src/leadHarvestAnalytics.js`: deterministic positive-response callback candidate queue with possible name/timing extraction and stable-ID later-call labels.
- `src/selfSourcingAttribution.js`: isolated long-held-record and historical-import attribution-review model; it does not accept Crystal Report files as a source.
- `src/weeklyLeadIntelligence.js`: supplied weekly-report supply/trend/workflow snapshot; it is not an active call or commercial metric source.
- `src/storage.js`: local JSON store, import artifact writer, generated report saver, alert lifecycle persistence, manager review correction/history persistence, and active report visibility.
- `src/aiExecutionLayer.js`: optional client for local Execution Layer status, job submission, and job polling.
- `src/dashboardRenderer.js`: HTML rendering and escaping.
- `tests/analysis.test.js`: parser, privacy, excluded-legacy-field invariance, and follow-up-linking coverage.
- `tests/storage.test.js`: import persistence, report library, manager review, and store-path coverage.

## Data Boundaries
- Raw CSV/XLSX values stay in process memory only.
- Derived local artifacts are stored under `data/`, which is ignored by Git.
- Redacted phone values are never used for matching or displayed in dashboard rows.
- Invalid customer date/import date values are listed as ignored fields.
- Transcript text is treated as untrusted display content and escaped before rendering.
- Local evaluator outputs are derived data and are persisted as versioned local import artifacts.
- Campaign/allocation imports are parked. They are retained as inactive metadata and excluded from active metrics, reports, alerts, filters, source/list quality, scorecards, and AI transcript context.
- The Self-Sourcing Attribution Audit is an attribution-review aid only. It cannot prove online discovery, neglect, sales, revenue, ownership, or a reattribution decision; unavailable or changed Crystal Report attachments do not affect it.
- One-dial reattempt records are neutral until deterministic evidence separates valid terminal outcomes, risky no-contact/no-pitch rows, and ambiguous rows needing manager or later local-LLM review.
- Lead harvest candidates are review rows only. They require call/transcript evidence of a live-human positive response plus callback/follow-up context, and later-call labels use stable source IDs only. A later match proves only a related attempt was observed; completion and payment remain not established. Missing stable IDs are labelled matching unavailable.
- Alert lifecycle actions are non-destructive overlays on generated call-data alerts. Active alerts are `new`, `acknowledged`, and `in_progress`; `resolved`, `dismissed`, `false_positive`, and parked alerts do not inflate active alert counts.
- Alert lifecycle actor attribution uses the server-side local placeholder `local_manager` until authentication exists; client-supplied actor fields are not authoritative.
- Manager review actions are separate non-destructive overlays on calls/signals/alerts. Review corrections store previous/displayed/manager-corrected values, correction reasons, evidence assessment, notes, actor, timestamp, and history without overwriting raw imported fields, deterministic outputs, LLM outputs, or generated alert evidence.
- Bad-lead claims are separate allegation records in the ignored local JSON store. The original reason/text/submitter fields are immutable; later manager decisions and history are separate. Active `submitted`/`under_review` claims may enter local Evaluation Studio task input as read-only allegation context through exact `call_id` matching first or an exact canonical `AllocatedLeadID` lead-only fallback. Claims do not suppress or alter leads and are not exposed by normal dashboard persistence, prompt-test API task-input responses, or dedicated HTTP routes. Until authentication exists, any future claim API must resolve salesperson identity outside the client payload before calling the claim service.
- The local AI Execution Layer durably stores submitted task payloads under its project-authenticated job store. Sales Dashboard stores only job references locally and strips trusted claim context from prompt-test responses, execution-response echoes, and its `/api/ai/jobs/<id>` proxy.
- The seeded Lead Validity And Utilisation template is archived non-destructively and replaced by the versioned Lead Record & Disposition Evidence Audit. Its fixed schema and semantic validation produce recommendations only, preserve historical generic v1 results, generate normalized findings locally after validation, and exclude this evaluator from report rollups until a separate product decision approves reporting use.
- The seeded Offer Acceptance template is added non-destructively to existing stores. Active v3 keeps category/classification pairs consistent, verifies quoted offer/customer evidence against the transcript, blocks category 3 when an approval or decision remains unresolved, and makes the customer's final position authoritative: local reconciliation downgrades an earlier acceptance when a later customer turn withdraws it or adds a condition. Historical v1/v2 templates and results remain archived and readable. Category 3 is an accepted-offer transcript signal, not a completed commercial outcome.
- The seeded Call Intelligence Foundation template is reconciled non-destructively: templates v1-v5 remain archived and active v6 uses schema `call_intelligence_foundation.v3`. The schema requires `called_on_behalf_of`, adds `long_term_nurture`, and resolves final timing before specialist routing. Named represented parties require exact proof, with narrow local repair for explicit `on behalf of` wording; absent values use `No product pitched`. Foundation output never decides a specialist result; server-side routing creates or reuses child runs and skips calls already evaluated by that specialist.
- Evaluation Studio artifacts are management/evaluation metadata only. Knowledgebase entries, custom-goal templates, runs, local AI harvest state, results, and report-safe rollups are versioned and auditable. Stored local model results preserve prompt/template and knowledgebase-version context and must remain separate from raw imported fields, deterministic outputs, LLM outputs, alert evidence, and manager review history. Run quarantine/resume/harvest state is non-destructive history metadata. Result-to-review handoff creates a normal manager-review record through `src/managerReview.js` and `src/storage.js`; any evaluator-derived correction prefill is stored as suggested-only metadata until a manager confirms it.
- The per-call aggregate is a read-only interpretation layer over stored results and trusted call metadata. Offer Acceptance is authoritative for accepted-offer state; Foundation remains authoritative for its own opportunity/measurement/efficiency lenses. Disagreements are shown with an explicit resolution rule rather than silently overwritten. Unknown downstream lifecycle fields stay unknown.
- Batch creation submits at most 12 jobs concurrently and retries transient submission failures up to three times with an unchanged idempotency key. Automatic reconciliation harvests at most 100 unfinished jobs per pass, ignores already handled terminal jobs, and repeats on later Studio/API reads until every batch job is terminal.
- Stored reports can remain in local history, but normal report APIs and UI expose only active reports and hide parked/stale allocation-like report content.
- Local model jobs are submitted only through the Execution Layer API; Sales Dashboard stores job references, not raw model outputs.
- Overnight backlog ownership is split deliberately: `scripts/run-overnight-evaluations.js` selects, submits, harvests, validates, and advances one 500-call Foundation boundary; Windows Task Scheduler supplies the daily trigger; the AI Execution Layer owns per-job time/idle/memory admission. The controller never calls Ollama directly, never cancels an in-flight job, and never starts a new parent after 04:30 Melbourne time.

## Future Architecture
The next architecture step should replace the JSON store with SQLite only when concurrent users, large import history, or richer filtering makes file-backed state too limited.
Future data-model candidates:
- raw import archive outside Git
- canonical calls table
- versioned call evaluations
- evidence table
- manager review and alert lifecycle tables
- optional LLM-backed evaluator behind strict schema validation
