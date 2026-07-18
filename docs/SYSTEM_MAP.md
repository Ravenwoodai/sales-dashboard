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
- `src/dateTimeFormat.js`: Australian/AEST display helpers for source call times, filters, reports, and stored timestamps.
- `src/alertLifecycle.js`: alert workflow statuses, active/closed/parked counting, manager notes, and audit-history helpers.
- `src/managerReview.js`: manager review statuses, scopes, correction allowlist, local actor resolution, correction overlays, and review-history helpers.
- `src/evaluationStudio.js`: governed Evaluation Studio model for the neutral Call Intelligence Foundation, independent opportunity/measurement/efficiency lenses, locally reconciled routes to five specialist evaluators, knowledgebase entries, custom-goal templates, the strict three-outcome Offer Acceptance evaluator, queued and prompt-test runs, run quarantine/resume history, versioned results with provenance, Foundation/specialist rollups, transcript-proof validation, and guarded local-model inputs.
- `src/transcriptEvaluator.js`: local deterministic transcript-evaluation rules.
- `src/analysis.js`: data profiling, deduplication, active/filtered call-transcript metrics, deterministic lead reattempt buckets, lead harvest candidates, parked allocation status, alerts, manager-review governance overlays, and sanitized explorer data.
- `src/leadHarvestAnalytics.js`: deterministic positive-response callback candidate queue using call/transcript evidence and stable-ID later-call checks.
- `src/selfSourcingAttribution.js`: isolated New Business audit of long-held CRM records, historical imports, and salesperson-created records for attribution review only.
- `src/weeklyLeadIntelligence.js`: attached weekly-report snapshot for lead supply mix, trend, and workflow-field catalogue; it never changes call metrics or commercial attribution.
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
- Evaluation Studio knowledgebase entries, custom-goal templates, queued/prompt-test run records, run quarantine/resume history, batch harvest state, result records with prompt/knowledgebase provenance, and report-safe rollups are separate management artifacts. They can prepare and store local model evidence, and can create manager-review-needed items with suggested-only correction prefill, but they do not replace active deterministic metrics or manager-reviewed overlays unless a future labelled workflow explicitly does so.
- Offer Acceptance category 3 requires verified transcript evidence of a presented offer plus direct, unconditional customer commitment or a completed acceptance action. Category 2 covers conditional approval and follow-up. No category proves payment, fulfilment, revenue, or CRM closure.
- Call Intelligence Foundation results provide separate opportunity, measurement-eligibility, and efficiency dimensions without a composite score. Schema v3 records who the salesperson called on behalf of, final exact follow-up timing, and `long_term_nurture` when distant timing supersedes an earlier callback request. Explicit represented-party wording can be repaired from exact transcript proof, and the latest Foundation context is shared across the call's specialist result rows. Quoted amounts are transcript context only. Locally derived specialist routes create child runs without overwriting existing specialist results, and the specialist evaluator remains authoritative.
- Evaluation Studio AI jobs are protected in the local Execution Layer by a `dynamic-schema-v1` required contract, one durable worker lease, atomic lease-aware claims, and versioned claim attempts. Other API processes may remain available, but only the active compatible owner consumes the protected queue. `/api/ai/status?health=true` proxies the sanitised owner/lease/queue state.
- Evaluation Studio submits batch jobs with concurrency 12, retries transient submission failures idempotently up to three times, and auto-harvests no more than 100 unfinished jobs per reconciliation pass; runs larger than 100 remain active and continue on subsequent reads.
- One-dial reattempt records are neutral until deterministic evidence separates valid terminal outcomes, risky no-contact/no-pitch rows, and rows needing manager or later local-LLM review.
- Lead harvest candidates are call-data-only review rows for positive response plus callback/follow-up context. Possible names and timing are extracted context, not verified CRM truth, and matching uses stable IDs only.
- Self-Sourcing Attribution Audit findings are review signals only. Record age or a historical import date cannot prove online self-sourcing, neglect, lead ownership, a sale, revenue, or an attribution change; Crystal `.rpt` attachments are not an active data source.
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
- Open `http://127.0.0.1:3000/evaluation-studio` for the standalone Evaluation Studio workspace.
- Check `http://127.0.0.1:3000/api/evaluation-studio` for knowledgebase, prompt template, and run metadata.
- Use `POST http://127.0.0.1:3000/api/evaluation-studio/prompt-tests` for one-call Evaluation Studio prompt test runs.
- Use `POST http://127.0.0.1:3000/api/evaluation-studio/runs/<run-id>/harvest` to collect queued local AI job results into Evaluation Studio records. Small queued prompt-test runs are also reconciled automatically when `/evaluation-studio` or the Evaluation Studio APIs are read.
- Check `http://127.0.0.1:3000/api/evaluation-studio/report-rollups` for report-safe lead utilisation/coaching rollups from labelled Evaluation Studio findings.
- Check `http://127.0.0.1:3000/api/lead-harvest` for New Business positive callback candidates and later matching-call labels.
- Check `http://127.0.0.1:3000/api/imports` and `http://127.0.0.1:3000/api/reports`.
- Check `http://127.0.0.1:3000/api/allocations` for parked diagnostic metadata when an allocation file is configured.
- Open saved reports at `http://127.0.0.1:3000/reports/<report-id>`.
