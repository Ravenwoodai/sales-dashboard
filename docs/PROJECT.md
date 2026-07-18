# Project
## Name
Sales Dashboard

## Purpose
Sales Dashboard is a local web dashboard for scheduled CSV/XLSX exports of sales call transcript data.
It preserves the raw import in memory, profiles the call export, runs a local deterministic transcript-evaluation layer, and surfaces confidence-aware sales operations views without using unsupported sales or revenue assumptions. Separate campaign/allocation imports are parked and excluded from active analytics.

## Primary Users
- Sales managers reviewing call quality, follow-up leakage, and source/list performance.
- Operators checking whether scheduled CSV imports are usable and complete.
- Future agents extending the product with stricter AI evaluation, persistence, and manager review workflows.

## MVP Scope
- Load a CSV or XLSX call export from `--csv <path>` or `SALES_DASHBOARD_CSV_PATH`.
- Optionally configure an allocation CSV/XLSX from `--allocations <path>` or `SALES_DASHBOARD_ALLOCATIONS_PATH`; the data is parked and not used for active metrics.
- Deduplicate by `call_id`.
- Ignore `dialled_phone_number` for MVP analytics. Parse valid `CustomerImportDate` and `CustomerCreateDate` only for source-quality Record Age; malformed date fragments are treated as missing and raw date fields stay out of proof tables.
- Preserve redacted phone/date fields only as raw source fields; do not use them for matching, attribution, repeat-call logic, or dashboard display.
- Use stable IDs such as `customer_id`, `ContactId`, `AllocatedLeadID`, `FoundCustomerID`, and `FoundContactID` for limited follow-up linkage. A later exact-ID call is `later_attempt_observed`; it does not establish callback completion, payment, or sale completion without separate verified evidence.
- Locally classify transcript quality, contact type, local outcome, follow-up signals, and risk flags from call/transcript evidence.
- Show executive metrics, data confidence, alert centre, manager review queue, salesperson scorecards, source/list quality based on call CSV fields, follow-up leakage, lead reattempt behaviour, transcript intelligence, and sanitized call explorer.
- Show a Lead Harvest Queue for New Business positive-response callback candidates, using deterministic call/transcript evidence and stable-ID later-call checks only. Candidate names, callback timing, and handover context are possible extracted review context, not confirmed sales outcomes.
- Persist derived import history, versioned local evaluation artifacts, alert events with lifecycle history, manager review records, and generated reports under the local ignored `data/` folder.
- Let managers acknowledge, progress, resolve, dismiss, reopen, note, bulk-update, and mark likely false-positive call-data alerts without changing the original alert evidence; until authentication exists, lifecycle actor attribution is fixed to `local_manager`.
- Let managers mark calls/signals for review, start review, confirm, correct, dismiss, escalate, reopen, note, and bulk-update manager review records. Manager corrections are stored as separate review/correction/history overlays and do not overwrite raw imported fields, deterministic outputs, LLM outputs, or alert evidence.
- Provide a standalone Evaluation Studio for the local workflow: choose transcripts by call IDs or operational filters, preview the exact batch, run a selected strict-schema evaluator, and browse paginated results by business outcome, evidence-strength band, specialist type, and operational issue. This includes the neutral Call Intelligence Foundation, selectively routed typed specialist contracts, the manager-calibrated three-outcome Offer Acceptance evaluator, and a deterministic per-call commercial lifecycle aggregate. The aggregate keeps accepted offer, quoted value, intended payment timing, payment verification, invoice, fulfilment, revenue, and CRM state separate; resolves supported relative dates from Australian source call dates; records evaluator conflicts and authority rules; and exposes claim provenance plus strongest exact transcript evidence. Knowledgebase entries are local drafts or included references; no manager identity or approval is required. Results never overwrite raw calls or operational records.
- Provide a Reports Library so future generated data/reports can be stored and viewed from the dashboard; normal report APIs and UI hide parked, superseded, allocation-related, and stale stable-target reports while preserving them in storage.
- When local model processing is required, submit jobs through `C:\Users\User\Desktop\ai-execution-layer` using its Execution Layer API rather than calling model runtimes directly.
- Clearly state that the current CSV does not support confirmed sales conversion, revenue attribution, order value, or won/lost commercial outcome.

## Operating Profile
- Template: web-app
- Stack: Node.js with built-in platform modules only
- Runtime type: web
- Run command: `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- Generic run command: `node src/main.js`
- Allocation run command: `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`
- Test command: `node --test tests/*.test.js`
- Local URL: `http://127.0.0.1:3040`
- Healthcheck URL: `http://127.0.0.1:3040/health`
- Allocations API: `http://127.0.0.1:3040/api/allocations`
- AI status URL: `http://127.0.0.1:3040/api/ai/status`
- Manager reviews API: `http://127.0.0.1:3040/api/manager-reviews`
- Evaluation Studio UI: `http://127.0.0.1:3040/evaluation-studio`
- Evaluation Studio API: `http://127.0.0.1:3040/api/evaluation-studio`
- Evaluation Studio selection preview API: `POST http://127.0.0.1:3040/api/evaluation-studio/selection-preview`
- Evaluation Studio typed-specialist recovery API: `GET http://127.0.0.1:3040/api/evaluation-studio/specialist-recovery`
- Evaluation Studio results API: `http://127.0.0.1:3040/api/evaluation-studio/results`
- Evaluation Studio prompt tests API: `POST http://127.0.0.1:3040/api/evaluation-studio/prompt-tests`
- Evaluation Studio run harvest API: `POST http://127.0.0.1:3040/api/evaluation-studio/runs/<run-id>/harvest`
- Evaluation Studio run quarantine API: `POST http://127.0.0.1:3040/api/evaluation-studio/runs/<run-id>/quarantine`
- Evaluation Studio run resume API: `POST http://127.0.0.1:3040/api/evaluation-studio/runs/<run-id>/resume`
- Evaluation Studio report rollups API: `http://127.0.0.1:3040/api/evaluation-studio/report-rollups`
- Evaluation Studio result review handoff: `POST http://127.0.0.1:3040/api/evaluation-studio/results/<result-id>/review`
- Lead Harvest API: `http://127.0.0.1:3040/api/lead-harvest`
- Store path: `data/store/state.json` by default, or `SALES_DASHBOARD_STORE_PATH`; Evaluation Studio history is authoritative in adjacent `data/store/evaluation-studio.sqlite` (override with `SALES_DASHBOARD_EVALUATION_STUDIO_DB_PATH`).

## Success Criteria
- The July 1 CSV can be loaded without copying sensitive source data into the repository.
- The dashboard uses only supported fields for MVP metrics.
- Phone values and invalid customer date/import date fragments are explicitly excluded from analytics.
- UI date/time display uses Australian format and AEST labels. Source call dates are displayed as source call time in AEST without browser timezone shifting; stored processing/review/report timestamps are converted to fixed AEST.
- Transcript-derived metrics are confidence-aware, table views show readable proof summaries, and call proof pages show ordered transcript turns plus raw transcript audit text.
- Follow-up leakage is treated as indeterminate when the upload lacks enough future data.
- `NoSaleType` and `Baz_DetailedNotes` are optional untrusted legacy fields. The former is an often-inaccurate human disposition and the latter is an unknown-model output with unverified provenance and accuracy. Both remain unchanged in raw source storage but are excluded from active analytics, alerts, filters, reports, scorecards, normal UI/APIs, manager-review prefill, and all AI/evaluator context.
- Manager-reviewed values are labelled as manager-reviewed overlays and remain inspectable alongside raw imported, deterministic, and LLM-reviewed values.
- Evaluation Studio knowledgebase, templates, run records, harvest history, result records, and report-safe rollups are versioned local artifacts. Ordinary evaluation requires no manager identity or approval. Local model results keep prompt version, knowledgebase version, evidence, confidence, provenance, and guardrails visible and never silently replace deterministic or optional manually corrected values. Parked campaign/allocation concepts remain blocked.
- The Call Intelligence Foundation records call stage, customer outcome, next step, commercial context, and exact evidence, but deliberately emits no composite score. It records the transcript-grounded organisation/publication/client the salesperson called on behalf of, or exactly `No product pitched` when the call did not reach or state it. A named party requires meaningful exact transcript proof. The final agreed disposition overrides earlier provisional interest/callback language; a roughly one-year agreement is long-term nurture, not an active callback. Foundation represented-party and timing context is shared across specialist result rows for the same call. Its opportunity, measurement, and efficiency lenses remain separate. Locally derived routes may create non-destructive child runs for Offer Acceptance, Callback Opportunity, Objection Handling, Procedure, and Lead Record Audit; the specialist result remains authoritative for that specialist question.
- The Offer Acceptance evaluator treats category 3 as direct transcript evidence that a customer accepted the presented offer. Conditional approval, information requests, callbacks, partner/finance review, and administrative acknowledgements remain category 2. The per-call commercial state may therefore say `accepted_offer_signal` while payment remains `not_verified` and invoice, fulfilment, revenue, and CRM remain `unknown`.
- Evaluation task input records the complete app-source transcript character count and SHA-256 fingerprint, and explicitly requires chronological evaluation through the final turn. Numeric model confidence remains available only in audit detail as uncalibrated model self-report; normal result views use evidence-strength bands.
- One-dial lead reattempt records are treated as neutral until split by deterministic evidence. The reportable lead-utilisation-risk signal is restricted to one-dial no-contact records with no later matching call observed; ambiguous rows need manager or later local-LLM review before any stronger conclusion.
- Lead Harvest Queue rows are call-data-only candidates where deterministic evidence shows live-human conversation, positive response, and callback/follow-up context. They use stable IDs to label later matching calls when available, never phone values or parked allocation data.
- Generated reports are saved through `/api/reports`; normal report APIs and the dashboard Reports Library return active, non-parked reports only.
- Allocation workbooks, when configured, are preserved only as parked metadata and must not affect active metrics, reports, alerts, source/list quality, or AI transcript context.

## Non-Goals
- Do not turn an Offer Acceptance category into a claim of confirmed payment, fulfilment, revenue, order value, close date, CRM conversion, or won/lost commercial outcome.
- Do not perform call audio processing, diarisation from audio, re-transcription, or recording analysis.
- Do not use redacted phone values for entity resolution.
- Do not send transcripts or customer data to external AI services. Optional local model work must go through the local AI Execution Layer.
- Do not build semantic search or LLM-backed evaluation in the MVP.
