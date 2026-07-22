# Architecture

## System Overview

Sales Dashboard is a local Node.js web application. It reads CSV/XLSX call exports, keeps raw source data local, builds a conservative derived SQLite view, and renders evidence-focused manager pages. Optional allocation data is parked. Historical local-model artifacts are isolated as research.

The architecture is intentionally fail closed: no local-model capability is currently promoted, so neither model availability nor historical output can enable submission or operational consumption.

## Runtime Flow

1. `src/main.js` resolves call/allocation paths and starts the local HTTP server.
2. `src/sourceFile.js`, `src/csvParser.js`, and `src/xlsxReader.js` normalise source tables.
3. `src/analysis.js` deduplicates by `call_id`, profiles source coverage, applies global filters, builds stable-ID reattempt facts, and combines literal detections with manager overlays.
4. `src/transcriptEvaluator.js` performs only closed literal classification. Semantic fields remain null.
5. `src/transcriptIntelligence.js` emits literal outcomes/events/risk evidence for persistence; it does not infer human contact, intent, sentiment, next steps, or quality.
6. `src/intelligenceDatabase.js` stores the active derived import in `intelligence.sqlite`, with semantic fields null by design.
7. `src/storage.js` coordinates local state, alerts, manager reviews, reports, and Evaluation Studio archive hydration.
8. `src/dashboardRenderer.js` renders six manager workspaces and call proof pages.
9. `src/localModelCapability.js` validates and pins the current capability register for the lifetime of the process.
10. Every model submission, polling, ingestion, automatic-routing, controller, and Studio mutation path checks the pinned register and rejects unpromoted capabilities before a network call or state mutation.
11. `src/evaluationValidationLab.js` isolates genuinely unseen manifests and frozen human benchmark truth from both operational reviews and the historical archive.
12. `src/voicemailRecovery.js` recomputes the closed voicemail/message/later-inbound evidence lane from active call rows without semantic or commercial inference.

## Trust Layers

```text
raw source
  -> source facts / exact stable-ID relations
  -> exact literal transcript detections + evidence
  -> manager-authored non-destructive overlays
  -> active UI, APIs, and reports

historical model jobs/results
  -> research archive (authority: none)
  -> never enters the active path
```

## Active Module Responsibilities

- `src/main.js`: server, routes, health, capability status, and fail-closed HTTP boundaries.
- `src/localModelCapability.js`: register discovery, validation, immutable process binding, submission/consumption assertions, public policy summary, and a read-only Studio catalog with exact scope, provenance, exclusions, evidence, failure reason, authority, and permitted next action.
- `src/analysis.js`: source profiling, stable-ID facts, literal review signals, filters, and sanitized rows.
- `src/transcriptEvaluator.js`: conservative literal state detection only.
- `src/transcriptIntelligence.js`: literal event/outcome projection with exact evidence and null semantic attributes.
- `src/intelligenceDatabase.js`: active import SQLite storage and trusted call/lead projections.
- `src/globalFilters.js`: shared query/filter state.
- `src/alertLifecycle.js`: alert status transitions and history.
- `src/managerReview.js`: manager status, correction allowlist, overlays, and history.
- `src/selfSourcingAttribution.js`: record-age/source attribution-review facts only.
- `src/weeklyLeadIntelligence.js`: isolated source-report snapshot, not a performance or commercial metric.
- `src/allocationCoverage.js` and `src/allocationParking.js`: preserved parser and parked diagnostics only.
- `src/storage.js`: local JSON/SQLite coordination, reports, alerts, reviews, and archive access.
- `src/evaluationStudioDatabase.js`: authoritative historical Evaluation Studio SQLite store.
- `src/evaluationStudio.js`: historical evaluator definitions and archive interpretation; live submission/operational use is blocked externally and internally by capability policy.
- `src/evaluationValidationLab.js`: separate benchmark-only manifest selection; runtime/repository/result/run/manifest prior-use exclusion proof; direct-quote label validation; immutable freezing; exact result-set/evidence comparison; and strict promotion test.
- `src/voicemailRecovery.js`: deterministic exact-message, stable-ID chronology, later-inbound relationship, and source-handler evidence.
- `src/aiExecutionLayer.js`: fail-closed client boundary. Its submission/polling functions require a promoted capability.
- `src/overnightEvaluationAutomation.js`, `scripts/run-overnight-evaluations.js`, and `scripts/run-adhoc-evaluations.js`: retained historical controllers that reject before network access while no capability is promoted.
- `src/dashboardRenderer.js`: escaped HTML for dashboard, archive, drilldowns, and call proof.

## Retired Or Research-Only Modules

- `src/leadHarvestAnalytics.js` and related routes are retired from active product use.
- `src/salesOpportunityActionCentre.js` preserves historical logic, but its operational projection is unavailable while dependencies are unpromoted.
- `src/callIntelligenceAggregate.js` may describe historical results only; it has no operational authority.
- `src/spielQualityV4*.js`, `src/spielQualityV5*.js`, and `src/spielQualityV6*.js` are stopped research harnesses. They must not be wired into production or used to justify more Qwen inference.

## Storage Boundaries

- Raw source files remain at their configured locations and are not committed.
- `data/store/state.json` stores local operational history and job references.
- `data/store/intelligence.sqlite` stores the active deterministic derived import.
- `data/store/evaluation-studio.sqlite` stores historical model research artifacts.
- `data/store/evaluation-validation-lab.json` stores isolated human benchmark truth and manifest fingerprints.
- Transcript content is untrusted display input and must be escaped.
- Redacted/partial phone values are never used for matching or displayed.
- `NoSaleType` and `Baz_DetailedNotes` never enter active computation, UI, reports, reviews, or model context.
- Manager corrections are overlays and never overwrite raw or derived evidence.
- Allocation data is parked and excluded from active metrics and model context.

## Model Boundary

- The register is the only authority for whether a capability may submit or be consumed.
- A missing, malformed, unrecognised, stale, or unpromoted capability is denied.
- The register path is pinned and cached at process start/use; changing it requires an application restart.
- Historical results are returned only with research-only labels and authority `none`.
- Benchmark truth is not a manager-review queue and cannot grant model authority; a passing comparison still requires external approval and a deliberate register change.
- The application does not call Ollama/vLLM directly.
- A separately running Execution Layer is not evidence of permission.

## Future Architecture

- Add direct paginated Evaluation Studio SQL reads only if archive latency is a measured problem.
- Add authentication before multi-user access.
- A new semantic evaluator must be isolated behind a new frozen capability and promotion program; it cannot reuse historical authority labels or automatically inherit routes.
