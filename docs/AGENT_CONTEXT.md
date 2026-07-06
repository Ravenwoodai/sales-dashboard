# Agent Context
This is the fastest handoff brief for new agents joining Sales Dashboard.

## What This Project Is
- Sales Dashboard is a local Node.js web app for scheduled CSV sales-call transcript exports.
- It profiles CSV quality, deduplicates calls, evaluates transcripts locally, and renders manager-friendly call intelligence dashboards.
- The MVP is deliberately local-only and uses no external AI service or database.

## Current Operating Baseline
- Run with sample data: `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- Generic run: `node src/main.js`
- Test: `node --test tests/*.test.js`
- Local URL: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/health`
- Summary API: `http://127.0.0.1:3000/api/summary`
- Imports API: `http://127.0.0.1:3000/api/imports`
- Reports API: `http://127.0.0.1:3000/api/reports`
- Report viewer: `http://127.0.0.1:3000/reports/<report-id>`
- Local store: `data/store/state.json` by default, ignored by Git.

## Current Product Rules
- Ignore `dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` for MVP analytics.
- Do not use partial phone values for repeat contact, attribution, follow-up matching, or display.
- Use stable IDs for limited matching where available.
- Treat imported `NoSaleType` and `Baz_DetailedNotes` as raw source context, not final truth.
- Do not claim sales conversion, revenue, order value, close date, or won/lost outcome.
- When a user asks Codex to generate a data extract or report, save it through `POST /api/reports` or `saveGeneratedReport(...)` so it appears in the Reports Library.
- Reports saved to the library should be openable from the dashboard through their `View` link.
- Each CSV import now creates an automatic lead-utilization report that tracks strict callback leakage, one-attempt/no-contact lead-days, no-contact retry coverage, and future callback pending status by stable lead ID.
- Aggregated dashboard/report values should link to `/drilldown?metric=...` where possible. Drill-down rows should show short proof summaries, not raw transcript blobs, and link to `/calls/<call-id>` proof pages with sanitized raw fields, ordered transcript proof turns, raw transcript audit text, and manager review capture.
- Optional local model processing is routed through `C:\Users\User\Desktop\ai-execution-layer` via the Execution Layer API. Use `src/aiExecutionLayer.js`; do not call vLLM/Ollama directly from this project.

## Current Risks
- The local evaluator is deterministic and useful for MVP triage, but it is not a final LLM-backed evaluation layer.
- Follow-up completion is limited by the uploaded date range and available stable IDs.
- Alert volume can be high because blank imported dispositions are common on meaningful calls.
- Persistence is JSON-file backed and local-only; it is suitable for MVP history, not multi-user concurrent editing.

## Next Useful Work
- Add richer manager review actions and alert lifecycle controls in the UI.
- Add a strict-schema LLM evaluator only after the deterministic baseline is proven.
