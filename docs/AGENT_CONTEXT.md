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
- Evaluation Studio UI: `http://127.0.0.1:3000/evaluation-studio`
- Evaluation Studio API: `http://127.0.0.1:3000/api/evaluation-studio`
- Lead Harvest API: `http://127.0.0.1:3000/api/lead-harvest`
- Report viewer: `http://127.0.0.1:3000/reports/<report-id>`
- Local store: `data/store/state.json` by default, ignored by Git.

## Current Product Rules
- Ignore `dialled_phone_number` for MVP analytics. Valid `CustomerImportDate` and `CustomerCreateDate` may power source-quality Record Age; malformed date fragments are missing and raw date fields stay out of proof tables.
- Do not use partial phone values for repeat contact, attribution, follow-up matching, or display.
- Use stable IDs for limited matching where available.
- Treat `NoSaleType` and `Baz_DetailedNotes` as excluded untrusted legacy fields, not context. Preserve them only in the original raw source; never use or expose them in active analytics, alerts, filters, reports, UI/APIs, manager-review prefill, or AI/evaluator inputs.
- Do not claim sales conversion, revenue, order value, close date, or won/lost outcome.
- When a user asks Codex to generate a data extract or report, save it through `POST /api/reports` or `saveGeneratedReport(...)` so it appears in the Reports Library.
- Reports saved to the library should be openable from the dashboard through their `View` link when they are active. Normal report APIs and dashboard lists hide parked allocation, stale stable-target, and superseded lead-day report content by default while preserving raw store records.
- Each CSV import now creates an automatic follow-up leakage report that tracks strict callback leakage, one-attempt/no-contact matched records, no-contact retry coverage, and future callback pending status by source ID.
- Lead reattempt views treat one-dial records as neutral until split into deterministic buckets. The reportable utilisation-risk signal is deliberately narrow: one dial, clear no-contact, stable ID match, and no later matching call observed. Ambiguous rows stay excluded from the hard no-contact report unless later confirmed through manager-approved review.
- Lead Harvest Queue views identify New Business positive-response callback candidates from call/transcript evidence. Possible names, callback timing, customer objection tags, salesperson handling tags, and handover notes are extracted review context only. Later matching call observed labels use stable IDs, not phone values, and mean a later call exists in the upload, not that completion is proven. Missing stable IDs are labelled matching unavailable.
- Long-term deferral wording such as "call back in 12 months" or "next financial year" is labelled as long-term deferral/future nurture, not as an active callback or Lead Harvest opportunity.
- Optional allocation workbooks are parked. They may be parsed for diagnostic metadata, but must not power dashboard metrics, reports, alerts, filters, source/list quality, scorecards, or AI transcript context.
- Evaluation Studio is complete for Batch 7 and lives at `/evaluation-studio` as a separate transcript-evaluation workspace. It stores Neuron/LatentPulse-derived seed knowledgebase entries, editable knowledgebase records, editable strict-schema templates with safe custom evaluation goals, queued evaluation runs with all-eligible-call selection support, one-call prompt test runs, automatic reconciliation of small queued prompt-test jobs on Studio page/API reads, versioned result records with prompt/template and knowledgebase-version provenance, global-filter-aware evidence/result/rollup views, manager-review handoffs from stored results with suggested correction prefill, run quarantine/resume history, batch result harvesting from local AI jobs, and report-safe lead utilisation/coaching rollups from labelled Evaluation Studio findings. The main Sales Dashboard shows only a compact Evaluation Results bridge and links to the studio; prompt/run tooling should stay out of the reporting dashboard. Results remain separate from active deterministic metrics and manager-reviewed overlays unless a future labelled workflow explicitly uses them; suggested prefill is not a manager correction until confirmed.
- The main dashboard uses the `view` query parameter for focused manager workspaces: `overview`, `harvest`, `follow_up`, `reviews`, `team`, `intelligence`, and `records`. Preserve the shared global filter query when linking between them; do not rebuild these as independent analytics pages.
- Evaluation Studio now contains structured historical Neuron knowledge and de-identified LatentPulse calibration entries. They are visible as `pending_manager_approval` but excluded from evaluation context until a manager changes an entry to `approved_current`; do not bypass that approval gate or import raw historical transcripts into the knowledgebase.
- Aggregated dashboard/report values should link to `/drilldown?metric=...` where possible. Drill-down rows should show short proof summaries, not raw transcript blobs, and link to `/calls/<call-id>` proof pages with sanitized raw fields, a readable Transcript Timeline, separate Detected Signal excerpts, raw transcript audit text, and manager review capture.
- Optional local model processing is routed through `C:\Users\User\Desktop\ai-execution-layer` via the Execution Layer API. Use `src/aiExecutionLayer.js`; do not call vLLM/Ollama directly from this project.

## Current Risks
- The local evaluator is deterministic and useful for MVP triage, but it is not a final LLM-backed evaluation layer.
- The deterministic one-dial bucket split is evidence-backed but conservative; ambiguous rows should stay out of lead-utilisation-risk reporting until manager review confirms whether meaningful contact occurred and the outcome was resolved.
- Lead Harvest Queue rows are deterministic candidates for manager follow-up, not confirmed conversion outcomes. Possible names/timing/details, objection tags, and salesperson handling tags come from transcript text and should be checked against call evidence before use. Long-term deferrals are intentionally excluded from active callback candidate counts.
- Follow-up completion is limited by the uploaded date range and available stable IDs.
- Old allocation-derived reports/events may exist in local stores; active persistence views filter parked-data reports and parked-data alert events out of normal counts.
- Alert volume must be explained by active transcript/call-data signals only; legacy imported dispositions cannot create or alter alerts.
- Alert lifecycle controls are available in the Alert Centre and `/api/alerts`; active alert counts include only `new`, `acknowledged`, and `in_progress`.
- Alert lifecycle actor attribution is fixed to the local placeholder `local_manager` until real authentication exists; client-supplied actor names are ignored for authoritative lifecycle history.
- Manager review controls are available through call pages, the manager review queue, alert-centre linked review forms, `/api/manager-reviews`, and `/reviews`. Manager review statuses are separate from alert lifecycle statuses, and manager corrections are stored as overlays with corrections/history instead of overwriting raw imported, deterministic, LLM, or alert evidence.
- Persistence is JSON-file backed and local-only; it is suitable for MVP history, not multi-user concurrent editing.

## Next Useful Work
- Add browser smoke coverage for Evaluation Studio and manager review UI interactions if the workflows grow more complex.
- Consider SQLite-backed query/storage only if JSON persistence becomes too limited for Evaluation Studio history.
