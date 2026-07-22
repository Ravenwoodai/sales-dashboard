# System Map

## Sources Of Truth

- `AGENTS.md`: startup order and model capability stop rule.
- `docs/PROJECT.md`: current product boundary.
- `docs/LOCAL_MODEL_CAPABILITY_POLICY.md`: evaluator research, promotion, and stop rules.
- `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`: machine-readable capability authority.
- `runtime/LOCAL_MODEL_COMPREHENSIVE_AUDIT_2026-07-22.md`: evidence behind the quarantine decision.
- `runtime/SESSION_HANDOVER.md`: current runtime and verification state.

## Active Request Path

```text
CSV/XLSX source
  -> sourceFile/csvParser/xlsxReader
  -> analysis + literal transcript evaluator
  -> intelligence.sqlite + state overlays
  -> dashboardRenderer / JSON APIs / reports
```

## Capability Guard Path

```text
any model-related request/controller
  -> localModelCapability validates pinned register
  -> capability promoted?
       no  -> reject before network or mutation
       yes -> explicit submission/consumption path (none currently)
```

## Core Files

- `src/main.js`: HTTP server, dashboard/API routes, health, and mutation boundaries.
- `src/localModelCapability.js`: register validation, cached process binding, assertions, and public status.
- `src/evaluationValidationLab.js`: isolated genuinely-unseen benchmark manifests, exact-quote human labels, immutable freezes, and strict candidate comparisons.
- `src/voicemailRecovery.js`: closed voicemail/message/later-inbound evidence rules and source-handler observations.
- `src/sourceFile.js`, `src/csvParser.js`, `src/xlsxReader.js`: source ingestion.
- `src/analysis.js`: deduplication, source metrics, exact reattempt relationships, literal risks, filters, reviews, and sanitized rows.
- `src/transcriptEvaluator.js`: recognised literal terminal-state rules.
- `src/transcriptIntelligence.js`: literal events/outcomes and exact evidence with semantic fields null.
- `src/intelligenceDatabase.js`: active-import SQLite persistence and trusted projections.
- `src/globalFilters.js`: common filters and denominators.
- `src/alertLifecycle.js`: alert status/history.
- `src/managerReview.js`: manager-authored overlays/history.
- `src/storage.js`: state coordinator and report/archive persistence.
- `src/evaluationStudioDatabase.js`: historical Evaluation Studio SQLite store.
- `src/evaluationStudio.js`: archived evaluator definitions/results interpretation; no live authority.
- `src/aiExecutionLayer.js`: guarded local service client; submission and operational polling are closed.
- `src/dashboardRenderer.js`: escaped UI rendering.
- `src/dateTimeFormat.js`: Australian/AEST display.
- `src/allocationCoverage.js`, `src/allocationParking.js`: parked allocation diagnostics.
- `src/selfSourcingAttribution.js`: record-age/source attribution-review facts.
- `src/weeklyLeadIntelligence.js`: isolated source-report snapshot.

## Research-Only Files

- `src/callIntelligenceAggregate.js`, `src/salesOpportunityActionCentre.js`: historical model-result projections; not operational while dependencies are unpromoted.
- `src/leadHarvestAnalytics.js`: retired semantic candidate logic.
- `src/spielQualityV4*.js`, `src/spielQualityV5*.js`, `src/spielQualityV6*.js`: failed/stopped Qwen research harnesses.
- `scripts/run-spiel-quality-*.js`, freeze/recovery/analyse scripts, and associated runtime manifests: preserved audit history; not authorised to run.
- `scripts/run-overnight-evaluations.js`, `scripts/run-adhoc-evaluations.js`: retained controllers with a mandatory fail-closed capability preflight.

## Storage

- `data/store/state.json`: import/report/alert/review/job references and archive pointer/counts.
- `data/store/intelligence.sqlite`: active deterministic call/event/risk/lead projections.
- `data/store/evaluation-studio.sqlite`: historical knowledge/templates/runs/results.
- `data/store/evaluation-validation-lab.json`: separate benchmark manifests, human labels, immutable freeze metadata, and candidate comparison records.
- `runtime/`: audits, frozen manifests, controller history, handoff, blockers, and logs.

## Public Product Surfaces

- `/`: Overview.
- `/?view=opportunities`: explicit unavailable state until promotion.
- `/?view=follow_up`: literal reattempt activity.
- `/?view=reviews`: alerts and manager review.
- `/?view=intelligence`: literal transcript triage and provenance.
- `/?view=records`: source records and safe reports.
- `/evaluation-studio`: controlled validation workspace plus a visibly separate read-only historical research archive.
- `/calls/<call-id>`: transcript proof, literal detections, research history, and manager review.
- `/health`: runtime and capability status.
- `/api/summary`, `/api/alerts`, `/api/manager-reviews`, `/api/imports`, `/api/reports`: active local workflows.
- `/api/ai/*`: health/research archive metadata only; submission endpoints are retired/blocked.
- `/api/lead-harvest`: retired (`410`).
- Evaluation Studio result ingestion is retired (`410`); run/prompt/resume/harvest mutations are capability-locked (`423`).
- Knowledge/template/archive/feedback/result-review mutations are locked (`423`); only archive reads and read-only selection preview remain.
- `GET /api/evaluation-studio/validation-lab`: capability catalog, validation-lab state, direct-quote review questions, and deterministic voicemail/inbound evidence.
- `POST /evaluation-studio/validation-lab/manifests`: create an isolated benchmark manifest; this never creates a model job or archive run.
- `POST /evaluation-studio/validation-lab/manifests/<id>/labels`: record exact human benchmark truth in batches of at most five.
- `POST /evaluation-studio/validation-lab/manifests/<id>/freeze`: freeze a complete, balanced, unchanged benchmark manifest. Freezing is not promotion.

## Current Guardrails

- Zero promoted local-model capabilities.
- The Windows evaluation task exists but is disabled; there is no active model work, and controller capability preflight remains fail closed.
- Semantic call fields remain null unless manager-authored.
- Historical model results have authority `none` and cannot affect active calculations.
- Benchmark truth is separate from routine manager review and the historical evaluator archive; unsupported benchmark cases are labelled explicitly rather than forced into a semantic class.
- Unseen selection excludes call IDs found in runtime audits, repository rule/prompt/test/script artifacts, all historical/current results and attempted run selections, and every earlier benchmark manifest.
- The deterministic voicemail lane may report exact prompt/message/chronology/linkage facts, but never callback causation, receptiveness, sales, gross profit, or commercial value.
- No sales, conversion, payment, fulfilment, revenue, ROI, or CRM claims.
- No phone-based matching.
- No use of excluded legacy disposition/note fields.
- Allocation data remains parked.
- Stable-ID later attempts prove only another related record exists in the upload window.

## Verification Commands

- `npm test`
- `npm run audit:trusted-boundary`
- `node src/main.js --csv "data/source/CallData 07.07.2026.csv"`
- Check `/health` for `ai_execution.enabled=false`, zero promoted capabilities, and operational consumption false.
- Run SQLite `PRAGMA integrity_check` on both databases.
- Confirm active semantic columns are null and active import `llm_status=not_requested`.
- Confirm blocked mutation endpoints do not change job/run/result counts.
- Browser-check all six workspaces, Evaluation Studio, and a call proof page.
- Confirm Studio benchmark mutation routes leave model job/run/result counts unchanged and never issue a model request.
- Run `git diff --check`.
