# Project
## Name
Sales Dashboard

## Purpose
Sales Dashboard is a local web dashboard for scheduled CSV exports of sales call transcript data.
It preserves the raw import in memory, profiles the CSV, runs a local deterministic transcript-evaluation layer, and surfaces confidence-aware sales operations views without using unsupported sales or revenue assumptions.

## Primary Users
- Sales managers reviewing call quality, follow-up leakage, and source/list performance.
- Operators checking whether scheduled CSV imports are usable and complete.
- Future agents extending the product with stricter AI evaluation, persistence, and manager review workflows.

## MVP Scope
- Load a CSV from `--csv <path>` or `SALES_DASHBOARD_CSV_PATH`.
- Deduplicate by `call_id`.
- Ignore `dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` for MVP analytics.
- Preserve redacted phone/date fields only as raw source fields; do not use them for matching, attribution, repeat-call logic, or dashboard display.
- Use stable IDs such as `customer_id`, `ContactId`, `AllocatedLeadID`, `FoundCustomerID`, and `FoundContactID` for limited follow-up linkage.
- Locally classify transcript quality, contact type, local outcome, follow-up signals, risk flags, and imported-disposition mismatches.
- Show executive metrics, data confidence, alert centre, manager review queue, salesperson scorecards, source/list quality, and sanitized call explorer.
- Persist derived import history, versioned local evaluation artifacts, alert events, manager review records, and generated reports under the local ignored `data/` folder.
- Provide a Reports Library so future generated data/reports can be stored and viewed from the dashboard.
- When local model processing is required, submit jobs through `C:\Users\User\Desktop\ai-execution-layer` using its Execution Layer API rather than calling model runtimes directly.
- Clearly state that the current CSV does not support confirmed sales conversion, revenue attribution, order value, or won/lost commercial outcome.

## Operating Profile
- Template: web-app
- Stack: Node.js with built-in platform modules only
- Runtime type: web
- Run command: `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- Generic run command: `node src/main.js`
- Test command: `node --test tests/*.test.js`
- Local URL: `http://127.0.0.1:3000`
- Healthcheck URL: `http://127.0.0.1:3000/health`
- AI status URL: `http://127.0.0.1:3000/api/ai/status`
- Store path: `data/store/state.json` by default, or `SALES_DASHBOARD_STORE_PATH`

## Success Criteria
- The July 1 CSV can be loaded without copying sensitive source data into the repository.
- The dashboard uses only supported fields for MVP metrics.
- Phone values and invalid customer date/import date values are explicitly excluded from analytics.
- Transcript-derived metrics are confidence-aware, table views show readable proof summaries, and call proof pages show ordered transcript turns plus raw transcript audit text.
- Follow-up leakage is treated as indeterminate when the upload lacks enough future data.
- Managers can inspect calls needing review without relying on imported `NoSaleType` or `Baz_DetailedNotes` as final truth.
- Generated reports are saved through `/api/reports` and visible in the dashboard Reports Library.

## Non-Goals
- Do not claim confirmed sales conversion, revenue, order value, close date, or won/lost commercial outcomes.
- Do not perform call audio processing, diarisation from audio, re-transcription, or recording analysis.
- Do not use redacted phone values for entity resolution.
- Do not send transcripts or customer data to external AI services. Optional local model work must go through the local AI Execution Layer.
- Do not build semantic search or LLM-backed evaluation in the MVP.
