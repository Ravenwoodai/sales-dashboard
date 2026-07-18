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

### Weekly Lead Intelligence
- Goal: make the two supplied weekly spreadsheet exports visible as a safe, isolated operational intelligence section.
- Scope: supply mix, weekly import trend, workflow-field catalogue, and the lead-generator next-week handoff rule; no change to active call metrics or commercial attribution.
- Verification: `node --test tests/*.test.js` passes 150/150; live dashboard at `http://127.0.0.1:3040/?view=team` contains the section.
- Status: complete.

## Completed Plans
### Self-Sourcing Attribution Audit
- Goal: test whether New Business calls disproportionately target long-held CRM records without turning a historical source label into proof of lead ownership.
- Scope shipped: isolated `src/selfSourcingAttribution.js` model, Team & Sources audit panel, 90-day and 365-day call/record cohorts, confirmed-import and salesperson-created splits, source-breakdown evidence, and a regression test.
- Risks handled: no Crystal Report dependency; no phone matching; no use of legacy disposition/note fields; no claims of online discovery, neglect, sales, revenue, or reattribution.
- Verification: `node --test tests/selfSourcingAttribution.test.js tests/analysis.test.js tests/drilldown.test.js`.
- Status: complete.

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

### Offer Acceptance Evaluation Studio Template
- Goal: let managers run an editable Studio evaluator that distinguishes no sale signal, interested/follow-up only, and direct customer acceptance of a presented offer using the team's own transcript threshold.
- Scope shipped: seeded active `Offer Acceptance (Sale Signal) Review` template, strict `offer_acceptance_classification.v1` result schema with a numeric integer category contract, non-destructive current-store reconciliation, transcript-quote verification, category/classification consistency checks, category 3 commitment and unresolved-condition enforcement, stored acceptance assessment, and visible normalized Studio findings. The v2 template requires short contiguous evidence excerpts; local ingestion may shorten a model quote only when the retained excerpt is still verified verbatim. Studio now shows accepted/follow-up/no-signal outcomes, acceptance rate, latest-run failures, salesperson/source/date breakdowns, and the evaluation template/run type/version used for every result instead of generic lead-audit columns. Recoverable historical quote-format failures are reprocessed once per validation revision, and recovery defers when the source transcript is unavailable.
- Risks handled: salesperson assertions and administrative acknowledgements cannot establish category 3; partner/owner/manager/finance approval and later decisions remain category 2; category 3 is explicitly separated from payment, fulfilment, recognized revenue, and CRM closure.
- Verification: manager-labelled transcript calibrations, v1-to-v2 template reconciliation, numeric category contract, proof-preserving quote repair, reporting rollups, and tailored result rendering are represented in focused tests; `node --test tests/*.test.js` passes 159/159. The live 10-call run was recovered to 10 classified and zero failed after storing only transcript-verified excerpts.
- Status: complete.

### Call Intelligence Foundation And Specialist Routing
- Goal: establish one well-rounded, neutral daily transcript pass that identifies opportunity, measurement eligibility, and efficiency without weakening or replacing the five existing specialist evaluators.
- Scope shipped: active editable `Call Intelligence Foundation` template v6 using schema `call_intelligence_foundation.v3`; required represented-party capture with `No product pitched` fallback and meaningful exact proof; local repair of explicit `on behalf of` evidence; final-state reconciliation with `long_term_nurture`; exact transcript-grounded callback timing normalized as a finding and shared across result rows for the same call; strict contact/stage/outcome/commercial-context/evidence validation; three independent lenses with no composite score; selective specialist routes; non-destructive child runs; specialist-authoritative reporting; salesperson/source/date/represented-organisation breakdowns; evaluation-type visibility; 12-way bounded submission with three idempotent transient retries; and 100-job bounded automatic harvest passes.
- Risks handled: the model cannot self-route unsupported specialist work, long-term nurture cannot enter the active callback route, earlier provisional wording cannot override the final agreed state, existing specialist results are not overwritten, accepted candidates are not treated as accepted until the Offer Acceptance specialist classifies them, and Foundation output cannot establish payment, revenue, ROI, fulfilment, or CRM closure. Template v1 is archived because its optional numeric amount contract was ambiguous; later schemas preserve explicit amount availability and exact proof.
- Verification: strict schema/proof/routing/report tests, proof-relevance and transcript-derived represented-party repair tests, transient-submission retry coverage, end-to-end specialist routing, and the 101-call harvest boundary are included. `node --test tests/*.test.js` passes 169/169. Ten representative high-quality live-customer calls completed with ten usable represented-party results and exact proof; an earlier random edge-case set separately verified `No product pitched`. A later sequential New Business search stopped at attempt 12 when call 48544948 produced authoritative Offer Acceptance category 3 at 95% confidence. The observed worker remains unproven at 10,000/day.
- Status: complete.

### Evaluation Result Drilldowns And Responsive Layout
- Goal: let managers inspect the exact stored calls behind every visible Evaluation Studio aggregate without horizontal navigation.
- Scope shipped: filtered drilldown links on Foundation and Offer Acceptance metric cards, breakdown labels/counts/outcomes/rates, Foundation-specific result filters, per-call latest-run failure proof, full-width responsive result cards, direct transcript actions, and stacked mobile table rows.
- Risks handled: drilldowns are read-only views over existing stored results and preserve the original evaluator definitions, denominators, confidence, evidence and provenance; no evaluation, call record, manager review, alert, claim or CRM value is mutated.
- Verification: `node --test tests/*.test.js` passes 169/169. Live Chromium CDP measurements show document width equals viewport width, zero overflowing tables, and visible result/transcript actions at 1256px desktop and 390px mobile.
- Status: complete.

### Dashboard-Wide Drill-Down Coverage
- Goal: make every result, count, rate, salesperson, source, date, classification, and evidence-backed label inspectable down to the contributing calls or stored evaluation results.
- Scope shipped: exact call/result filters across all seven dashboard workspaces and Evaluation Studio; linked overview, provenance, transcript-governance, AI-assistant, system-audio, reattempt, harvest, source-attribution, intelligence, team/source, manager-review, import-history, alert, evaluation-run, and evaluation-result values; user-facing historical import snapshots and a saved-manager-review report; and explicit terminal-state labelling where no underlying row set exists.
- Intentional terminal values: database/configuration metadata, zero-row `Unprocessed`, the non-expressible inverse `Records excluded`, and fixed Weekly Lead Intelligence summary cells whose source snapshot has no row-level export contract. The weekly snapshot cards still open the fullest available origin, trend, and workflow tables.
- Risks handled: drill-downs are read-only and preserve active global filters, exact evaluator result semantics, evidence, denominators, and provenance; no call, evaluation, review, alert, claim, import, or CRM record is mutated.
- Verification: `node --test tests/*.test.js` passes 171/171. Live desktop and 390px mobile rendering showed no horizontal page overflow; exact Foundation, Offer Acceptance, transcript-quality, salesperson, source, date, callback-timing, run, import, and manager-review destinations returned populated pages.
- Status: complete.

### Authoritative Call Outcome Summary And Customer Identity
- Goal: prevent Foundation candidate labels from obscuring a completed specialist decision and keep the imported Customer ID visible on every call-facing record.
- Scope shipped: latest authoritative Offer Acceptance context is reconciled onto every stored result for the same call; result cards promote the specialist outcome, confidence, and evidence context while retaining the individual evaluator's own finding; each result has a render-time plain-language record summary; call proof pages have a current outcome summary; and Customer ID (or explicit `Not available`) is visible on result cards, attention/results tables, report examples, failure records, lead-harvest rows, manager-review snapshots, APIs, and call pages.
- Risks handled: summaries are deterministic views over stored results, so they create no model calls, evaluation cost, validation failures, or historical rewrites. Accepted means transcript evidence of offer acceptance, not proof of payment, fulfilment, recognised revenue, or CRM closure.
- Verification: `node --test tests/*.test.js` passes 173/173. Live call 48544948 now shows `Customer accepted offer`, Customer ID 16830601, authoritative 95% Offer Acceptance confidence, the Foundation result as secondary context, and the payment/fulfilment limitation on both its Studio card and call page. Desktop and 390px mobile document widths match their viewports.
- Status: complete.

### Evaluation Results Grouped By Call
- Goal: stop repeated transcripts looking like duplicate records when Foundation and specialist evaluators have all assessed the same call.
- Scope shipped: Evaluation Results now renders one top-level record per call with Customer ID, salesperson, source, date, authoritative current outcome, outcome confidence, summary, and evaluation count. Foundation and specialist results are nested behind one expandable evaluation list, where each evaluator retains its own outcome, confidence, evidence, provenance, and transcript action. Result pagination now counts call groups and never splits one call's evaluations across pages; call identity values remain direct drill-down links.
- Risks handled: grouping is a display and paging change only. Stored evaluation history is preserved, specialist routing remains auditable, individual evaluator findings are not merged, and one accepted call cannot look like several accepted customers merely because several evaluators ran.
- Verification: `node --test tests/*.test.js` passes 173/173. Live call 48544948 renders once with four nested evaluations, Customer ID 16830601, authoritative `Customer accepted offer` at 95% confidence, and working salesperson/source/date drill-downs. Chromium measurements show no horizontal page overflow at 1256px or 390px.
- Status: complete.

### Live Evaluation Studio Progress Refresh
- Goal: keep report totals and grouped results current while long Foundation and specialist runs remain in the same running state.
- Scope shipped: the Studio now polls a lightweight progress endpoint every five seconds, harvests a bounded ten jobs across each of at most five active runs, and reloads when status, completed, failed, queued, or update values change. Reloads preserve scroll position, expanded call evaluations, batch-selection inputs, prompt-test inputs, and result-filter inputs. A visible label distinguishes live updating from current settled results, overlapping poll requests are blocked, and terminal partially-completed runs no longer poll forever merely because historical job IDs remain.
- Risks handled: the normal full Studio API retains its existing 100-job bounded harvest contract; the browser poll uses a smaller payload and bounded work to avoid repeated full-result downloads and overlapping expensive requests. Stored results, evaluator semantics, specialist routing, failures, and historical runs are unchanged.
- Verification: `node --test tests/*.test.js` passes 173/173, including the new progress endpoint and refresh contract. The live Studio advanced from the stale screenshot's 63 calls / 63 evaluations to 181 calls / 509 evaluations and now correctly shows `Current stored results` after all jobs became terminal. Chromium measurements at 1256px and 390px show no horizontal overflow.
- Status: complete.

### Controlled Foundation Scale-Out
- Goal: evaluate every transcript with Call Intelligence Foundation and run every deterministic specialist recommendation without accepting silent semantic loss or overloading the local worker.
- Scope shipped: trusted contact/result reconciliation, exact-evidence repair or conservative removal, terminal/no-product routing suppression, category-2 Offer Acceptance reconciliation, revisioned historical recovery, and transcript-first batch limiting. Scale-out uses oldest unevaluated transcript calls, one parent at a time, automatic specialist routing, a 200-call canary, then 500-call batches only after parent and children drain.
- Runtime scaling: Evaluation Studio now persists submitted AI-job references and harvested validated results in bounded batches rather than rewriting the entire JSON store once per job. Semantic failures remain isolated per job, successful results remain versioned, and run/routing updates remain separate auditable writes.
- Verification: `node --test tests/*.test.js` passes 184/184. Canary and the first three 500-call boundaries passed. Third parent `eval_run_6264155b63b1720d01e3` plus recovery `eval_run_c19789006c76a83eff4c` provide 500 unique successful Foundation results; all 315 requested specialists completed, 1,127/1,127 excerpts verify exactly, and route/duplicate/worker/database gates are clean. Dataset coverage is 1,880/16,108 with 14,228 remaining.
- Operating gate: do not submit the next parent while any current parent or child is pending. Require less than 2% failures for every run, zero routing errors, complete route coverage, exact evidence, worker queue/running zero, and healthy database state before the next 500.
- Status: safely paused by user request after the third 500-call gate; still in progress until every transcript-bearing call and recommended specialist route is complete.

## Planning Rules
- Keep the MVP grounded in current CSV evidence.
- Do not add sales/revenue claims until reliable fields exist.
- Treat LLM outputs as a future versioned layer, not as a hidden replacement for deterministic checks.
### Idle-Aware Overnight Evaluation Backlog
- Goal: finish all transcript-bearing calls through Call Intelligence Foundation and every recommended specialist without degrading normal daytime PC performance.
- Scope shipped: daily 22:00-06:00 Melbourne wake-capable task, system-awake/display-off controller lifetime, one 500-call parent at a time, automatic specialist completion, 04:30 submission cutoff, durable status/log, duplicate-controller lock, service preflight/recovery, Studio status panel, and fail-closed 2% Foundation/specialist quality boundaries.
- Execution safety: the Execution Layer admits the next protected job only in-window, after 600 seconds of user inactivity, and with at least 4 GB available physical memory. Running work finishes; no new protected claim is made when a gate closes.
- Status: complete and enabled for the 18 July 2026 22:00 window.
