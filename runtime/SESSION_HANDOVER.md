# Session Handover

## Completed
- Built the Sales Dashboard MVP as a local Node.js web app.
- Added CSV parsing, call deduplication, data-confidence checks, local transcript evaluation, stable-ID follow-up linking, alerts, review queue, scorecards, source quality, and sanitized explorer views.
- Documented that `dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` are ignored for MVP analytics.
- Added automated tests for parser, privacy guardrails, outcome mismatch, and stable-ID follow-up linking.
- Added local ignored persistence for import history, sanitized evaluation artifacts, alert events, manager review records, and generated reports.
- Added Reports Library plus report-saving API so future generated reports can be viewed from the dashboard.
- Added report viewer pages at `/reports/<report-id>` and View links in the Reports Library.
- Reworked transcript evidence display so tables show proof summaries, call pages show ordered evidence cards and a readable transcript view, and raw transcripts remain available for audit.

## In Progress
- none

## Blockers
- none

## Recommended Next Task
- Add dashboard controls for manager review and alert lifecycle actions.
- Later: add diarisation/order correction only through the planned local AI evaluation layer; current UI preserves source transcript order.

## Verification Commands
- `node --test tests/*.test.js`
- `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/summary`
- `http://127.0.0.1:3000/api/imports`
- `http://127.0.0.1:3000/api/reports`
- `http://127.0.0.1:3000/reports/report_5eee32459104f287b9a1`
