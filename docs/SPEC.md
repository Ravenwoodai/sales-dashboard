# Specification

## MVP User Journey
1. Operator starts the local dashboard with a scheduled CSV path.
2. The system parses the CSV, deduplicates by `call_id`, and computes data-confidence checks.
3. The local evaluator classifies transcripts into contact, outcome, follow-up, and risk signals.
4. The dashboard presents supported metrics and review queues with evidence and confidence context.
5. The system saves a derived import snapshot, alert events, and an automatic executive-summary report.
6. Managers inspect alerts, calls, import history, and saved reports without seeing or depending on intentionally incomplete phone values.

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

Ignored current fields:
- `dialled_phone_number`: intentionally incomplete for security and ignored for MVP analytics.
- `CustomerCreateDate`: currently not a valid customer-created timestamp.
- `CustomerImportDate`: currently not a valid customer-import timestamp.

## Local Evaluation Rules
- Duration above zero is treated only as a telephony-connected signal.
- Probable live-human contact requires transcript evidence, not duration alone.
- Imported `NoSaleType` and `Baz_DetailedNotes` are raw source context only.
- Local outcome classification is generated independently.
- Evidence snippets are recorded for follow-up, mismatch, complaint, and opt-out signals.
- Unknown is preferred when the transcript or stable IDs are insufficient.

## Dashboard Modules
- Executive overview
- Data confidence panel
- Import history
- Reports library
- Alert centre
- Manager review queue
- Salesperson scorecards
- Source/list quality
- Sanitized raw call explorer

## Persistence Requirements
- Store derived state under `data/`, which must stay ignored by Git.
- Persist import summary records keyed by input hash.
- Persist sanitized evaluation artifacts per import.
- Persist alert events with lifecycle-ready status fields.
- Persist manager review records keyed by import/call.
- Persist generated reports with title, type, summary, content, metadata, timestamps, and source.
- Automatically create or update an executive-summary report for each imported CSV.
- Allow future Codex-generated reports to be saved through `POST /api/reports`.
- Allow saved reports to be opened from the dashboard at `/reports/<report-id>`.

## Unsupported Metrics
The current CSV does not contain reliable fields for:
- confirmed sales conversion
- revenue
- order value
- close date
- won/lost commercial outcome
- salesperson revenue performance

These must remain warning/unsupported states until explicit reliable fields are added.

## Acceptance Criteria
- `node --test tests/*.test.js` passes.
- `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"` starts the dashboard.
- `/health` returns a JSON status.
- `/api/summary` returns the computed analysis payload.
- `/api/imports` returns saved import history.
- `/api/reports` returns saved reports and accepts generated report saves.
- `/reports/<report-id>` renders the full saved report content/data in the browser.
- The dashboard lists ignored fields and unsupported sales/revenue metrics.
- The explorer does not display `dialled_phone_number`, `CustomerCreateDate`, or `CustomerImportDate`.
