# Agent Context
This is the fastest handoff brief for new agents joining Sales Dashboard.

## What This Project Is
- Sales Dashboard is a local Node.js web app for scheduled CSV/XLSX sales-call transcript exports. Optional campaign/allocation imports are parked and excluded from active analytics.
- It profiles CSV quality, deduplicates calls, evaluates transcripts locally, and renders manager-friendly call intelligence dashboards.
- The MVP is deliberately local-only and uses no external AI service or database.

## Current Operating Baseline
- Run with sample data: `node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"`
- Run with July 7 call data and parked allocation workbook: `node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"`
- Generic run: `node src/main.js`
- Test: `node --test tests/*.test.js`
- Local URL: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/health`
- Summary API: `http://127.0.0.1:3000/api/summary`
- Alerts API: `http://127.0.0.1:3000/api/alerts`
- Imports API: `http://127.0.0.1:3000/api/imports`
- Reports API: `http://127.0.0.1:3000/api/reports`
- Allocations API: `http://127.0.0.1:3000/api/allocations`
- Manager reviews API: `http://127.0.0.1:3000/api/manager-reviews`
- Report viewer: `http://127.0.0.1:3000/reports/<report-id>`
- Local store: `data/store/state.json` by default, ignored by Git.

## Current Product Rules
- Ignore `dialled_phone_number` for MVP analytics. Valid `CustomerImportDate` and `CustomerCreateDate` may power source-quality Record Age; malformed date fragments are missing and raw date fields stay out of proof tables.
- Do not use partial phone values for repeat contact, attribution, follow-up matching, or display.
- Use stable IDs for limited matching where available.
- Treat imported `NoSaleType` and `Baz_DetailedNotes` as raw source context, not final truth.
- Do not claim sales conversion, revenue, order value, close date, or won/lost outcome.
- When a user asks Codex to generate a data extract or report, save it through `POST /api/reports` or `saveGeneratedReport(...)` so it appears in the Reports Library.
- Reports saved to the library should be openable from the dashboard through their `View` link when they are active. Normal report APIs and dashboard lists hide parked allocation, stale stable-target, and superseded lead-day report content by default while preserving raw store records.
- Each CSV import now creates an automatic follow-up leakage report that tracks strict callback leakage, one-attempt/no-contact matched records, no-contact retry coverage, and future callback pending status by source ID.
- Lead reattempt views treat one-dial records as neutral until split into deterministic buckets. The reportable utilisation-risk signal is deliberately narrow: one dial, clear no-contact, stable ID match, and no later matching call observed. Ambiguous rows stay excluded from the hard no-contact report unless later confirmed through manager-approved review.
- Optional allocation workbooks are parked. They may be parsed for diagnostic metadata, but must not power dashboard metrics, reports, alerts, filters, source/list quality, scorecards, or AI transcript context.
- Aggregated dashboard/report values should link to `/drilldown?metric=...` where possible. Drill-down rows should show short proof summaries, not raw transcript blobs, and link to `/calls/<call-id>` proof pages with sanitized raw fields, ordered transcript proof turns, raw transcript audit text, and manager review capture.
- Optional local model processing is routed through `C:\Users\User\Desktop\ai-execution-layer` via the Execution Layer API. Use `src/aiExecutionLayer.js`; do not call vLLM/Ollama directly from this project.

## Current Risks
- The local evaluator is deterministic and useful for MVP triage, but it is not a final LLM-backed evaluation layer.
- The deterministic one-dial bucket split is evidence-backed but conservative; ambiguous rows should stay out of lead-utilisation-risk reporting until manager review confirms whether meaningful contact occurred and the outcome was resolved.
- Follow-up completion is limited by the uploaded date range and available stable IDs.
- Old allocation-derived reports/events may exist in local stores; active persistence views filter parked-data reports and parked-data alert events out of normal counts.
- Alert volume can be high because blank imported dispositions are common on meaningful calls.
- Alert lifecycle controls are available in the Alert Centre and `/api/alerts`; active alert counts include only `new`, `acknowledged`, and `in_progress`.
- Alert lifecycle actor attribution is fixed to the local placeholder `local_manager` until real authentication exists; client-supplied actor names are ignored for authoritative lifecycle history.
- Manager review controls are available through call pages, the manager review queue, alert-centre linked review forms, `/api/manager-reviews`, and `/reviews`. Manager review statuses are separate from alert lifecycle statuses, and manager corrections are stored as overlays with corrections/history instead of overwriting raw imported, deterministic, LLM, or alert evidence.
- Persistence is JSON-file backed and local-only; it is suitable for MVP history, not multi-user concurrent editing.

## Next Useful Work
- Add a strict-schema LLM evaluator only after the deterministic baseline is proven.
- Add browser smoke coverage for manager review UI interactions if the workflow grows more complex.
