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
- Use stable IDs such as `customer_id`, `ContactId`, `AllocatedLeadID`, `FoundCustomerID`, and `FoundContactID` for limited follow-up linkage.
- Locally classify transcript quality, contact type, local outcome, follow-up signals, risk flags, and imported-disposition mismatches.
- Show executive metrics, data confidence, alert centre, manager review queue, salesperson scorecards, source/list quality based on call CSV fields, follow-up leakage, lead reattempt behaviour, transcript intelligence, and sanitized call explorer.
- Persist derived import history, versioned local evaluation artifacts, alert events with lifecycle history, manager review records, and generated reports under the local ignored `data/` folder.
- Let managers acknowledge, progress, resolve, dismiss, reopen, note, bulk-update, and mark likely false-positive call-data alerts without changing the original alert evidence; until authentication exists, lifecycle actor attribution is fixed to `local_manager`.
- Let managers mark calls/signals for review, start review, confirm, correct, dismiss, escalate, reopen, note, and bulk-update manager review records. Manager corrections are stored as separate review/correction/history overlays and do not overwrite raw imported fields, deterministic outputs, LLM outputs, or alert evidence.
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
- Local URL: `http://127.0.0.1:3000`
- Healthcheck URL: `http://127.0.0.1:3000/health`
- Allocations API: `http://127.0.0.1:3000/api/allocations`
- AI status URL: `http://127.0.0.1:3000/api/ai/status`
- Manager reviews API: `http://127.0.0.1:3000/api/manager-reviews`
- Store path: `data/store/state.json` by default, or `SALES_DASHBOARD_STORE_PATH`

## Success Criteria
- The July 1 CSV can be loaded without copying sensitive source data into the repository.
- The dashboard uses only supported fields for MVP metrics.
- Phone values and invalid customer date/import date fragments are explicitly excluded from analytics.
- Transcript-derived metrics are confidence-aware, table views show readable proof summaries, and call proof pages show ordered transcript turns plus raw transcript audit text.
- Follow-up leakage is treated as indeterminate when the upload lacks enough future data.
- Managers can inspect calls needing review without relying on imported `NoSaleType` or `Baz_DetailedNotes` as final truth.
- Manager-reviewed values are labelled as manager-reviewed overlays and remain inspectable alongside raw imported, deterministic, and LLM-reviewed values.
- One-dial lead reattempt records are treated as neutral until split by deterministic evidence. The reportable lead-utilisation-risk signal is restricted to one-dial no-contact records with no later matching call observed; ambiguous rows need manager or later local-LLM review before any stronger conclusion.
- Generated reports are saved through `/api/reports`; normal report APIs and the dashboard Reports Library return active, non-parked reports only.
- Allocation workbooks, when configured, are preserved only as parked metadata and must not affect active metrics, reports, alerts, source/list quality, or AI transcript context.

## Non-Goals
- Do not claim confirmed sales conversion, revenue, order value, close date, or won/lost commercial outcomes.
- Do not perform call audio processing, diarisation from audio, re-transcription, or recording analysis.
- Do not use redacted phone values for entity resolution.
- Do not send transcripts or customer data to external AI services. Optional local model work must go through the local AI Execution Layer.
- Do not build semantic search or LLM-backed evaluation in the MVP.
