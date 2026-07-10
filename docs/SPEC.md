# Specification

## MVP User Journey
1. Operator starts the local dashboard with a scheduled CSV path.
2. The system parses the CSV, deduplicates by `call_id`, and computes data-confidence checks.
3. The local evaluator classifies transcripts into contact, outcome, follow-up, and risk signals.
4. The dashboard presents supported metrics and review queues with evidence and confidence context.
5. The system saves a derived import snapshot, alert events, and an automatic executive-summary report.
6. Managers inspect alerts, calls, import history, and saved reports without seeing or depending on intentionally incomplete phone values.
7. When an allocation workbook is supplied, the system preserves only parked diagnostic metadata and managers continue using call/transcript analytics.
8. Managers can review, confirm, correct, dismiss, escalate, and note call/signal classifications without overwriting raw imported, deterministic, LLM, or alert evidence.
9. Managers can inspect a Lead Harvest Queue of positive-response callback candidates for New Business, with possible name, callback timing, handover context, confidence, and evidence snippets.
10. Managers can use an Evaluation Studio foundation to manage sales knowledgebase entries, strict-schema evaluation templates, queued evaluation runs, local result harvesting, and report-safe evaluation rollups before optional local model submission.

## Data Contract
Required MVP columns:
- `call_id`
- `call_date`
- `call_time`
- `Salesperson`
- `CallType`
- `call_direction`
- `CallTotalSeconds`
- `ring_time_seconds`
- `call_duration_seconds`
- `transcription_text`
- `NoSaleType`
- `Baz_DetailedNotes`
- `CustomerImportSource`

Optional stable linkage fields:
- `customer_id`
- `ContactId`
- `AllocatedLeadID`
- `FoundContactID`
- `FoundCustomerID`

Parked allocation workbook columns:
- `LEAD CAMPAIGN`
- `QTY ALLOCATED`
- `QTY ACTIONED`
- `QTY REMAINING`
- `DATE`
- `SALES MANAGER`
- `SALESPERSON`
- `TYPE`

These fields are preserved only in the parked allocation parser/diagnostic path. They must not feed active metrics, alerts, filters, source/list quality, reports, scorecards, or AI transcript context.

Restricted current fields:
- `dialled_phone_number`: intentionally incomplete for security and ignored for MVP analytics.
- `CustomerCreateDate`: used only when it parses as a valid source date for Record Age fallback; malformed fragments are treated as missing.
- `CustomerImportDate`: used only when it parses as a valid source date for Record Age; malformed fragments are treated as missing.

## Local Evaluation Rules
- Duration above zero is treated only as a telephony-connected signal.
- Probable live-human contact requires transcript evidence, not duration alone.
- Imported `NoSaleType` and `Baz_DetailedNotes` are raw source context only.
- Local outcome classification is generated independently.
- Evidence snippets are recorded for follow-up, mismatch, complaint, and opt-out signals.
- Unknown is preferred when the transcript or stable IDs are insufficient.
- One-dial reattempt records are neutral until deterministic evidence separates valid one-dial outcomes, risky one-dial no-contact/no-pitch rows, and ambiguous rows needing manager or later local-LLM review.
- Lead harvest candidates require deterministic live-human, positive-response, and callback/follow-up evidence. Later-call status is labelled as "later matching call observed" only when stable source IDs match; missing stable IDs are labelled matching unavailable.

## Dashboard Modules
- Executive overview
- Data confidence panel
- Import history
- Reports library
- Alert centre
- Manager review queue
- Salesperson scorecards
- Source/list quality
- Follow-up leakage and reattempt behaviour
- Lead Harvest Queue for positive callback candidates
- Evaluation Studio for knowledgebase, prompt templates, and queued governed evaluation runs
- Sanitized raw call explorer

## Manager Review Governance
- Manager review is separate from alert lifecycle. Alert lifecycle tracks alert triage; manager review tracks human review and correction of call/signal classifications.
- Supported review statuses are `unreviewed`, `review_needed`, `in_review`, `reviewed_confirmed`, `reviewed_corrected`, `dismissed`, and `escalated`.
- Manager corrections are stored as separate review records with correction entries and review history. They include actor, timestamp, reviewed field, previous/displayed value, manager-corrected value, reason or note where supplied, and evidence assessment where supplied.
- Review actors resolve to `local_manager` until authentication exists. Client-supplied actor/reviewer names are not authoritative.
- Correctable fields are allowlisted to derived contact, outcome, follow-up, coaching, risk, and evidence-assessment fields. Raw imported fields, raw transcript text, raw `NoSaleType`, raw notes, source IDs, phone fields, import metadata, alert evidence, and parked allocation/campaign fields cannot be corrected through manager review.
- Dashboard display may show manager-corrected values as manager-reviewed overlays, but raw imported, deterministic, and LLM values must remain inspectable.

## Evaluation Studio Governance
- Evaluation Studio artifacts are separate from active deterministic metrics and manager review corrections.
- Knowledgebase entries are active or archived, versioned, tagged, and attributed to the local `local_manager` actor when edited through Sales Dashboard.
- Evaluation templates define an evaluation goal, prompt instructions, strict JSON output schema, version/hash metadata, and evidence/confidence expectations.
- Evaluation runs store the import ID, run type, template snapshot, knowledgebase snapshot, call selection, planned call count, status, queued local AI job references, and guardrails.
- Evaluation runs can be quarantined, resumed, and harvested non-destructively. Quarantine/resume/harvest actions store local-manager actor metadata, timestamp, reason/status metadata, and run history without deleting jobs or result records.
- Prompt test runs use run type `prompt_test`, target one call with transcript evidence, can be created as draft previews, and can optionally submit through the AI Execution Layer.
- Evaluation results store the import ID, run ID, call ID, template/version/hash, evaluation goal, status, confidence, evidence availability, transcript quality, findings, limitations, provenance, and manager-review recommendation as separate versioned evidence records.
- Evaluation results can be sent into the governed manager review workflow as review-needed items. This creates a manager review overlay/history event and may attach safe suggested correction prefill from allowlisted findings, but it does not alter the stored result, deterministic output, raw import, LLM output, alert evidence, or confirmed manager corrections.
- Suggested correction prefill is advisory only. It must be stored and displayed separately from confirmed manager corrections until a manager explicitly confirms or corrects the field.
- Optional local model submission must use the existing AI Execution Layer. Sales Dashboard must not call Ollama, vLLM, or external providers directly.
- Evaluation Studio may keep raw call CSV `AllocatedLeadID` as raw/canonical context, but it must not use parked campaign/allocation imports or allocation-performance concepts.
- Evaluation Studio results are evidence-backed review signals. They must not claim confirmed sales, revenue, order value, close rate, true conversion, or lost revenue, and must not silently replace deterministic or manager-reviewed values.

## Persistence Requirements
- Store derived state under `data/`, which must stay ignored by Git.
- Persist import summary records keyed by input hash.
- Persist sanitized evaluation artifacts per import.
- Persist alert events with lifecycle-ready status fields.
- Persist manager review records, correction entries, and review history keyed by import/call/scope/optional alert.
- Persist Evaluation Studio knowledgebase entries, templates, run records, local AI job harvest state, result records, and report-safe rollups under the local ignored store without copying raw imports into Git.
- Persist generated reports with title, type, summary, content, metadata, timestamps, and source.
- Automatically create or update an executive-summary report for each imported CSV.
- Persist parked allocation status metadata when an allocation file is supplied; do not copy the raw allocation workbook into the repository.
- Allow future Codex-generated reports to be saved through `POST /api/reports`.
- Allow active saved reports to be opened from the dashboard at `/reports/<report-id>`.
- Preserve parked/stale report records internally while excluding allocation-related, stable-target, stable lead-day, and lead-day reports from normal report APIs and UI.

## Unsupported Metrics
The current CSV does not contain reliable fields for:
- confirmed sales conversion
- revenue
- order value
- close date
- won/lost commercial outcome
- salesperson revenue performance

Parked allocation data must not be used for campaign/source/salesperson performance, allocated-versus-called comparisons, completion rates, or alerting.

These must remain warning/unsupported states until explicit reliable fields are added.

## Acceptance Criteria
- `node --test tests/*.test.js` passes.
- `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"` starts the dashboard.
- `/health` returns a JSON status.
- `/api/summary` returns the computed analysis payload.
- `/api/imports` returns saved import history.
- `/api/reports` returns active non-parked reports and accepts generated report saves.
- `/api/reports/:id` and `/reports/<report-id>` do not expose parked or stale report bodies in normal mode.
- `/api/allocations` returns parked diagnostic metadata only and never returns active totals or reconciliation rows.
- `/api/manager-reviews` exposes governed manager review records and rejects invalid statuses, scopes, protected fields, and allocation/campaign correction fields.
- `/api/evaluation-studio` exposes active knowledgebase entries, evaluation templates, run metadata, result records, and review-safe evidence queues; template/result validation blocks parked allocation/campaign performance concepts.
- `/api/evaluation-studio/results` stores and lists versioned Evaluation Studio result records with confidence, evidence, provenance, and manager-review recommendation.
- `/api/evaluation-studio/prompt-tests` creates one-call Evaluation Studio prompt test runs and optionally submits them to the local AI Execution Layer.
- `/api/evaluation-studio/runs/:id/harvest` checks queued local AI jobs for a run, stores completed Evaluation Studio results, marks failed jobs, preserves pending jobs, and appends run history.
- `/api/evaluation-studio/runs/:id/quarantine` marks a non-completed Evaluation Studio run as quarantined with a reason and history event.
- `/api/evaluation-studio/runs/:id/resume` returns a non-completed Evaluation Studio run to queued status with a resume history event.
- `/api/evaluation-studio/report-rollups` exposes report-safe lead utilisation/coaching rollups from labelled Evaluation Studio findings.
- `/api/evaluation-studio/results/:id/review` creates a governed manager review item from an Evaluation Studio result using server-resolved `local_manager` actor attribution.
- `/api/lead-harvest` exposes active call-data-only harvest candidates and excludes warm-business rows from the default New Business queue.
- `/reports/<report-id>` renders full saved report content/data only when the report is active and non-parked.
- The dashboard lists ignored fields and unsupported sales/revenue metrics.
- The explorer does not display `dialled_phone_number`, `CustomerCreateDate`, or `CustomerImportDate`.
- Source/list quality and drill-down tables show `Record Age`, using valid `CustomerImportDate` first and valid `CustomerCreateDate` second.
