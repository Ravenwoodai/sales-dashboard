# Plans

### Local Evaluation Studio Workflow
- Goal: make transcript evaluation a direct local workflow rather than a manager-approval process.
- Scope shipped: local-user attribution, Draft/Included knowledgebase language, default inclusion for newly entered local knowledge, filtered transcript selection, specific-call selection, deterministic sampling, batch preview, submit-now batch runs, one-call tests, paginated result browsing, result filters for evaluator findings, and concise decision-first result details with deduplicated transcript evidence.
- Safety retained: immutable raw calls, strict evaluator schemas, evidence validation, single-worker lease, idempotent harvesting, and no automatic lead/claim/CRM action.
- Calibration: the frozen 25-call plus eight-allegation label set is preserved as optional local reference labels with canonical SHA-256 `3acfc1b70ff788a0b3772fe3905a92094d80510a8ccc8e380485e086f03147f3`; it does not gate normal evaluation.
- Verification: `node --test tests/*.test.js` passes 146/146; desktop and 390px browser checks cover selection preview, result filtering, workspace order, and page-level overflow on the verified July 7 server at `http://127.0.0.1:3040/evaluation-studio`.
- Status: complete. The separate v4 evaluator-quality calibration identifies follow-up semantic/model work before unattended full-dataset evaluation.

### Evaluation Studio Single-Worker Safety
- Goal: prevent stale, duplicate, or contract-incompatible Execution Layer processes from consuming Sales Dashboard Evaluation Studio jobs.
- Scope shipped: per-process worker identity, `dynamic-schema-v1` job requirements, a 30-second durable lease with 5-second heartbeat, atomic lease-aware claims, a database trigger that blocks obsolete claim SQL, versioned claim attempts and recovery lineage, sanitised health visibility, standby/failover behaviour, and startup duplicate checks.
- Verification: deterministic lease tests, Evaluation Studio contract tests, PostgreSQL claim test, full Sales Dashboard suite, and controlled compatible/standby/failover/incompatible live processes against the shared local SQLite queue.
- Status: complete; the larger evaluator calibration batch remains deferred.
This file tracks execution plans for Sales Dashboard.

## Active Plans
- None.

## Completed Plans
### Untrusted Legacy Field Exclusion
- Goal: prevent unreliable legacy human disposition and unknown-model note fields from influencing any active product conclusion.
- Scope shipped: central exclusion policy, optional import contract, transcript-only local evaluation, removal from metrics/alerts/filters/reports/UI/APIs/manager-review prefill/AI inputs, historical report and alert filtering, and invariance regression tests.
- Risks handled: original raw sources and historical records remain unchanged; exact legacy values are not exposed through normal product paths; deterministic, LLM, and manager-review governance remain separate.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Evaluation Studio Knowledge Import And Approval Gate
- Goal: replace brief seed summaries with structured Neuron source knowledge and a small de-identified LatentPulse calibration set, without allowing historical material to silently become current evaluation policy.
- Scope shipped: imported ten versioned Neuron documents covering offer/compliance wording, call stages, conversation state, objections, buyer signals, scoring, pattern statistics, coaching phrases, successful patterns, and retrieval design; imported four de-identified LatentPulse calibration/governance entries; archived the five superseded seed summaries without deletion; added approval metadata and UI controls.
- Risks handled: imported material is tagged historical and pending manager approval; pending entries are visible in Evaluation Studio but excluded from run snapshots and model input; only `approved_current` entries may enter a new evaluation run; raw LatentPulse transcripts and historical customer identifiers were not imported.
- Verification: live Studio summary shows 14 active pending entries, 0 approved entries, and 5 archived seed summaries. `node --test tests/*.test.js` passes with 108 tests.
- Status: complete.

### Manager Workspace UI Redesign
- Goal: turn the very long all-in-one dashboard into focused operational workspaces while keeping one shared filtered call population and a separate Evaluation Studio.
- Scope shipped: seven Sales Dashboard workspaces (`overview`, `harvest`, `follow_up`, `reviews`, `team`, `intelligence`, and `records`), a product switcher, compact dataset context, progressive-disclosure filters, an overview attention queue, relevant in-page navigation, bounded table previews, Evaluation Studio jump navigation, and collapsed creation forms.
- Risks handled: all existing analysis and governance remain server-rendered and unchanged; filter query state persists between workspaces; parked allocation content remains excluded; hidden workspace content is not presented as active UI; large tables scroll within their containers on mobile.
- Verification: `node --test tests/*.test.js` passes with 107 tests. Browser checks passed at 1280x720 and 390x844 with no page-level horizontal overflow on the overview, Lead Harvest, Reviews, and Evaluation Studio routes.
- Status: complete.

### Batch 7 Evaluation Studio
- Goal: add a governed Evaluation Studio where managers can manage sales knowledgebase entries, strict-schema evaluation templates, local batch evaluation runs, evidence/confidence outputs, and manager-reviewed corrections without replacing raw, deterministic, LLM, or manager-review records.
- Scope shipped: `src/evaluationStudio.js`, seeded Neuron/LatentPulse-derived knowledgebase entries, editable/archivable knowledgebase records, standalone `/evaluation-studio` workspace with text-file loader for knowledgebase material, editable/archivable strict-schema templates with safe custom evaluation goals, queued run records with template/knowledgebase snapshots, all-eligible-call batch selection support, one-call prompt test runs, versioned Evaluation Studio result records that preserve template and knowledgebase versions, result/evidence queues, manager-review handoff from result records with safe suggested correction prefill, run quarantine/resume governance with history, batch result harvesting from queued local AI jobs, global-filter-aware Evaluation Studio result and rollup views, report-safe Evaluation Studio lead utilisation/coaching rollups, `/api/evaluation-studio` APIs including `/api/evaluation-studio/results`, `/api/evaluation-studio/prompt-tests`, and `/api/evaluation-studio/report-rollups`, compact dashboard Evaluation Results bridge, explicit optional Execution Layer submission path, and regression tests.
- Risks handled: evaluator outputs remain review signals and never overwrite raw imported, deterministic, LLM, alert, or manager-reviewed records; local AI work routes through the Execution Layer instead of direct model calls; raw `AllocatedLeadID` and parked allocation/campaign data are blocked from performance evidence; report rollups avoid sales, revenue, conversion, disciplinary, and allocation claims.
- Verification: `node --test tests/*.test.js` passes with 105 tests after custom-goal, all-eligible-call batch, result knowledgebase-version provenance, Evaluation Studio global-filter coverage, and final requirement audit.
- Status: complete.

### Lead Harvest Queue
- Goal: help managers harvest New Business leads where a customer gave a positive response and callback/follow-up context appears in the call transcript.
- Scope shipped: deterministic `src/leadHarvestAnalytics.js` candidate model, `/api/lead-harvest`, dashboard Lead Harvest Queue cards/tables/evidence rows, drill-down metrics for candidates/open/later-matching-call-observed/matching-unavailable records, possible name/timing/context extraction, customer objection tags, salesperson handling tags, newest/oldest/view-all queue links, and tests for New Business scoping, warm exclusion, terminal-outcome exclusion, API rollups, sorting, and proof rows.
- Risks handled: queue rows are review candidates rather than confirmed sales; later matching call observed means a later stable-ID call exists but does not prove completion; objection/handling tags are transcript indicators, not manager-confirmed truth; missing stable IDs are labelled matching unavailable; phone values and parked allocation/campaign data are not used.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### One-Dial Reattempt Evidence Buckets
- Goal: stop treating every single-dial matched record as a waste/risk signal.
- Scope shipped: deterministic `valid_one_dial_outcome`, `risky_one_dial_no_contact`, `needs_review`, and strict `oneDialNoContactNoLater` proof metrics in lead reattempt analytics; dashboard cards/tables/drilldowns/report wording changed from one-and-done risk to one-dial evidence buckets; records touched wording changed to records dialed.
- Risks handled: valid terminal outcomes such as wrong number, not interested, complaint, or opt-out are separated from no-answer/voicemail/system-audio rows; the reportable utilisation-risk score uses only one-dial no-contact records with no later matching call observed; ambiguous rows stay out of the score unless later confirmed through manager-approved review.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Manager Review Governance And Correction Workflow
- Goal: make transcript-derived dashboard intelligence reviewable and correctable without overwriting raw imported, deterministic, LLM, or alert evidence.
- Scope shipped: `src/managerReview.js` status/scope/correction allowlist helpers, manager review records with corrections/history, local `local_manager` actor resolution, `/api/manager-reviews` list/create/detail/update/history/bulk endpoints, `/api/calls/<call-id>/reviews`, upgraded `/reviews` form handling, manager-review global filter status support, review governance counts, call-page correction form/history, alert-centre linked review state, review queue actions, and raw explorer review/correction display.
- Risks handled: manager review is separate from alert lifecycle, corrections are overlays only, untrusted legacy disposition/note fields remain raw-source-only, deterministic/LLM outputs remain preserved, protected/raw/allocation/campaign fields cannot be corrected, notes are escaped on render, and active alert counts do not change from manager review alone.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Batch 5.1 Report And Local Actor Cleanup
- Goal: close Batch 5 verification follow-ups before manager review governance work.
- Scope shipped: normal `/api/reports`, `/api/reports/:id`, and `/reports/<id>` filter out parked allocation, stale stable-target, stable lead-day, lead-day, and allocation-like report content; hidden reports remain preserved in the local store; alert lifecycle actions resolve authoritative actor as `local_manager` until authentication exists; manager notes remain escaped in dashboard rendering.
- Risks handled: raw report APIs no longer leak parked/stale report bodies by default, old stable-target reports do not appear in normal report lists, client-supplied actor names cannot spoof lifecycle history, parked alerts still reject lifecycle mutation, and `AllocatedLeadID` remains allowed as raw call CSV matching context.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Alert Lifecycle Controls
- Goal: turn the Alert Centre from a passive generated-alert list into a practical triage workflow.
- Scope shipped: `src/alertLifecycle.js` lifecycle status helpers, non-destructive alert actions, manager notes, lifecycle history, `/api/alerts` list/update/bulk/history endpoints, dashboard status/severity summaries, row controls, bulk controls, and active-count rules.
- Risks handled: active alert counts include only `new`, `acknowledged`, and `in_progress`; `resolved`, `dismissed`, `false_positive`, and parked allocation-related alerts do not inflate active totals; generated alert evidence remains intact.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Global Filter Consistency
- Goal: make active dashboard cards, tables, alerts, scorecards, drill-downs, raw explorer rows, and JSON summary responses share one call/transcript filter state.
- Scope shipped: `src/globalFilters.js` canonical filter state, source-call-date filtering without timezone shifting, URL-persisted active filter query, filter chips/reset path, filtered/total/excluded record summary, low/very-low/empty-sample warnings, denominator notes, missing-value buckets, alert severity/status filtering against active call-linked alerts, and filtered drill-down consistency.
- Risks handled: parked campaign/allocation data is not a filter dimension, call CSV `AllocatedLeadID` remains only raw/entity context, source/list quality stays call-CSV-only, and default unfiltered metrics remain unchanged.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Intelligence Provenance And Evidence Labelling
- Goal: make raw imported fields, deterministic transcript signals, LLM-reviewed outputs, manager review state, confidence, and evidence gaps explicit in the dashboard.
- Scope shipped: deterministic provenance labels, LLM-reviewed labelling only for completed usable LLM output, manager review state labels, confidence bands and rollup counts, review-only guardrails for low/unusable transcript rows, and explicit "Evidence unavailable" gaps where proof is missing.
- Risks handled: deterministic-only insights are not presented as LLM-reviewed, LLM confidence is not shown without a valid LLM result, low-confidence/unusable transcript rows are labelled as review-only context, and parked allocation data remains excluded.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Reporting Period And Active Dataset Clarity
- Goal: make the active dashboard unmistakable about which call dataset, import, date range, source timezone, and data window it is showing.
- Scope shipped: source-call-time date range labels, AEST processing timestamps, active dataset/import banner with filename/hash/row counts/dedup counts, call-data-only single-day/partial-day/trend/follow-up warnings, and explicit unsupported sales/revenue/conversion warning.
- Risks handled: displayed call dates avoid local timezone shifting, parked campaign/allocation imports are not used in any new banner/warning/metric, and active dashboard scope remains call CSV plus transcript intelligence only.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Park Campaign/Allocation Data From Active Dashboard
- Goal: preserve separate campaign/allocation imports while removing them from active dashboard use.
- Scope shipped: parked allocation diagnostic, `/api/allocations` diagnostic-only response, removal of allocation dashboard navigation/section, active analysis no longer builds allocation coverage, automatic reports/artifacts exclude allocation totals and reconciliation rows, parked alert/report filtering, AI prompt raw-field filtering, and regression tests proving allocation rows do not change active metrics.
- Risks handled: `AllocatedLeadID` remains available as a call CSV matching field, but separate allocation imports no longer influence metrics, reports, alerts, source/list quality, scorecards, or AI transcript context.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Aggregate Lead Allocation Coverage
- Goal: incorporate lead campaign allocation workbooks as their own dashboard section while safely leveraging call-record evidence.
- Scope shipped: optional `--allocations` / `SALES_DASHBOARD_ALLOCATIONS_PATH` input, CSV/XLSX source adapter, built-in XLSX first-sheet reader, allocation workbook schema validation, allocation totals by type/date/salesperson/campaign, aggregate call-observed reconciliation by date + salesperson + type, `/api/allocations`, dashboard Lead Allocation Coverage section, persistence of derived allocation summaries, and tests for aggregate join behavior.
- Risks handled: campaign rows are allocation-side totals only, `QTY ACTIONED` is not treated as raw call count, redacted phone values remain unused, and future campaign/list attribution requires a shared campaign/list ID or stable lead ID.
- Verification: `node --test tests/*.test.js`; real July 7 workbook load with `CallData 07.07.2026.xlsx` and `allocations 07.07.2026.xlsx`; browser desktop/mobile checks of the allocation section at `http://127.0.0.1:3103`.
- Status: superseded by parked allocation decision.

### MVP Call Intelligence Dashboard
- Goal: build a local first version that loads the July 1 CSV, respects privacy-reduced phone data, evaluates transcripts locally, and renders usable sales operations views.
- Scope shipped: CSV parsing, call deduplication, data-confidence panel, ignored field guardrails, deterministic transcript evaluation, follow-up linking through stable IDs, alert centre, manager review queue, salesperson/source scorecards, sanitized call explorer, and automated tests.
- Risks handled: phone values are ignored, invalid customer date/import date values are ignored, sales/revenue metrics are marked unsupported, and transcript text is escaped before rendering.
- Verification: `node --test tests/*.test.js`; real CSV load via `loadAnalysis("C:/Users/User/Downloads/July 1 Data.csv")`.
- Status: complete.

### Local Persistence And Reports Library
- Goal: persist scheduled import history and make generated reports accessible from the dashboard.
- Scope shipped: local ignored JSON store, import summaries, sanitized evaluation artifacts, alert events, manager-review records, automatic executive-summary reports, `POST /api/reports`, report/detail APIs, import history UI, and Reports Library UI.
- Risks handled: raw CSV is not copied into Git, redacted phone values remain unused, and report content is local-only.
- Verification: `node --test tests/*.test.js`; real CSV load creates an import snapshot and automatic report.
- Status: complete.

### Lead Utilization Follow-Up Leakage Report
- Goal: prove who is and is not utilizing leads without relying on redacted phone numbers.
- Scope shipped: automatic lead-utilization report on each import, stable lead-day matching, strict callback-duty detection, future-callback pending status, no-contact retry coverage, salesperson risk table, evidence samples, and report-library viewer support.
- Risks handled: callback proof excludes loose sales-script wording such as "later this year"; phone numbers and invalid customer date/import fields remain unused.
- Verification: `node --test tests/*.test.js`; real July 1 CSV load creates `Lead Utilization And Follow-Up Leakage - July 1 Data.csv`.
- Status: complete.

### Drill-Down Proof Layer
- Goal: make dashboard/report numbers auditable by opening the exact call rows or lead-day records behind them.
- Scope shipped: `/drilldown` HTML page, `/api/drilldown` JSON endpoint, `/calls/<call-id>` proof page, `/api/calls/<call-id>` JSON endpoint, dashboard metric links, salesperson/source metric links, lead-utilization metric links, report drill-down links, sanitized raw source fields, full local transcript proof, and manager review form submissions.
- Risks handled: `dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` are excluded from raw proof fields; valid customer dates can support Record Age displays while malformed fragments remain missing; full drill-down rows are kept out of `/api/summary`.
- Verification: `node --test tests/*.test.js`; browser verification of dashboard links, lead drill-down page, call proof page, raw-field exclusions, and report drill-down links.
- Status: complete.

### Local AI Execution Layer Integration
- Goal: route optional local model transcript work through `C:\Users\User\Desktop\ai-execution-layer`.
- Scope shipped: execution-layer adapter, environment-driven configuration, `/api/ai/status`, transcript-evaluation submission endpoint, job polling proxy, local AI job references in the store, call-page submission panel, and integration documentation.
- Risks handled: credentials are environment-only, model runtimes are not called directly, deterministic rules remain the baseline, and Sales Dashboard stores job references rather than raw model outputs.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Readable Transcript Evidence Display
- Goal: make transcript evidence easy to scan in dashboard/report tables while preserving raw proof for audit.
- Scope shipped: evidence summaries on dashboard, drill-down, alert, review, explorer, and lead-utilization report surfaces; call pages now show the readable Transcript Timeline before separate Detected Signal proof excerpts; raw transcript remains available below the readable view.
- Risks handled: proof snippets no longer start mid-word or flatten several transcript fragments into one table cell; signal excerpts are not presented as the full conversation; source transcript order is preserved in the timeline instead of being re-sorted by the UI; 12-month/next-financial-year callback wording is classified as long-term deferral rather than active follow-up.
- Verification: `node --test tests/*.test.js`; browser verification at `http://127.0.0.1:3101` for drill-down proof summaries, call proof cards, report proof-summary samples, desktop layout, and mobile-width overflow.
- Status: complete.

### Lead Record Safety Decision Mappings
- Goal: ensure direct opt-out, serious threat, permanent-closure, and uncertain-closure evidence cannot produce contradictory operational recommendations.
- Scope shipped: versioned Lead Record audit template v4, transcript-backed semantic reconciliation, advisory manager-review mappings, permanent-closure certainty checks, and separate normalized operational-issue findings.
- Risks handled: recommendations remain advisory; trusted claims, leads, allocation, CRM, alerts, reports, and manager-review records are not mutated; historical v1-v3 runs and calibration artifacts remain preserved.
- Verification: preserved CAL-14, CAL-17, CAL-18, and hedged-closure patterns are covered by focused tests; `node --test tests/*.test.js` passes 145/145.
- Status: complete.

## Planning Rules
- Keep the MVP grounded in current CSV evidence.
- Do not add sales/revenue claims until reliable fields exist.
- Treat LLM outputs as a future versioned layer, not as a hidden replacement for deterministic checks.
