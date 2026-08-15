# Project Context

## System Overview

Sales Dashboard is a local Node.js web application for scheduled CSV/XLSX sales-call exports. It profiles the import, deduplicates calls, derives supported source/stable-ID facts, applies conservative literal transcript rules, persists local evidence, and renders manager-facing workspaces. An optional Carma evidence contract adds read-only authoritative approved-sale, allocation and source-credit facts without changing the call-analysis boundary.

The current system has no promoted semantic local-model capability. Historical Qwen jobs/results are retained as a read-only research archive with authority `none`.

The local Carma data layer is documented in `docs/CARMA_DATA_LAYER.md` and inventoried in ignored `data/carma/catalog.json`. It is the required entry point for agents seeking full historical approved sales or raw weekly allocation logs; the app's `carma_evidence.v2` database remains a validated read-only subset for exact-ID dashboard proof.

## Product Objective

Give managers a system they can use confidently by making every active conclusion traceable to one of four sources:

1. a permitted source field;
2. an exact stable-ID relationship;
3. an exact literal transcript excerpt covered by a closed rule;
4. an explicit manager-authored review overlay.

Anything else remains unknown.

## Current Flow

1. `src/main.js` resolves local source paths and starts the server.
2. `src/sourceFile.js`, `src/csvParser.js`, and `src/xlsxReader.js` normalise input.
3. `src/analysis.js` deduplicates calls, profiles source coverage, applies filters, and derives exact reattempt facts.
4. `src/transcriptEvaluator.js` and `src/transcriptIntelligence.js` detect only approved literal states/events and retain exact evidence.
5. `src/intelligenceDatabase.js` writes the active deterministic projection with all semantic fields null.
6. `src/storage.js` merges alert lifecycle, manager review, reports, and research-archive pointers.
7. `src/dashboardRenderer.js` renders the active UI and proof pages.
8. `src/localModelCapability.js` validates/pins the current register and blocks any unpromoted submission or consumption.
9. `src/evaluationValidationLab.js` builds isolated genuinely-unseen manifests, validates exact-quote human truth, freezes benchmarks, and compares future candidates without promotion side effects.
10. `src/voicemailRecovery.js` computes the closed voicemail/message/chronology/later-inbound evidence lane without semantic, causal, or commercial inference.
11. `src/voicemailPilotAttribution.js` validates an optional local pilot export against exact active call proof and exposes a sanitized read-only experiment report without persistence or model use.
12. `src/carmaEvidence.js` validates and opens `carma-evidence.sqlite` read-only, then joins orders to active calls only by exact `customer_id`.
13. `src/leadSourcePolicy.js` applies the locked `actual_seller_any_pre_sale_allocation.v1` default: Company Sourced when the actual seller had any exact pre-sale allocation; otherwise Self Sourced.
14. `scripts/build-carma-evidence.js` deterministically rebuilds the versioned contract from saved Carma extracts and keeps sourcing method, acquisition source, campaign and external credit separate.

## Active Product Surfaces

- Overview: dataset, filters, provenance, activity, literal coverage, reattempt, and record/source facts.
- Opportunities: unavailable until a relevant capability is promoted.
- Follow-Up: literal reattempt activity only.
- Alerts & Reviews: literal alerts and manager-authored workflow.
- Intelligence: literal transcript triage with evidence/provenance.
- Records & Reports: source facts, read-only Carma sale/source-credit proof, import history, and safe reports.
- Evaluation Studio: capability catalog, deterministic voicemail/inbound evidence, optional fail-closed pilot attribution, isolated benchmark Validation Lab, and a separate read-only historical research archive.
- Call proof: transcript timeline, exact evidence, research warnings, and manager review.

Lead Harvest and model-backed action queues are retired.

## Capability Boundary

- Read `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` and `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json` before any model work.
- Current register: 20 audited capabilities, zero promoted.
- Model submission, polling for operational use, result ingestion, automatic routing, Studio run/prompt/resume/harvest, overnight execution, and ad-hoc execution all fail closed.
- Valid JSON, exact quote copying, completed jobs, passing tests, and a healthy model service are technical evidence only.
- Qwen Spiel v3-v6 is stopped. Repeated failure on narrower facts prohibits another same-model rescue.

## Data Boundaries

- Raw source stays local and out of Git.
- Raw voicemail-pilot exports also stay local and out of Git; the application retains no raw pilot rows.
- Fixture/UAT call data always uses an isolated `SALES_DASHBOARD_STORE_PATH`; the default store is only for the real active import.
- `dialled_phone_number`/partial phones are never used for matching or display.
- `NoSaleType` and `Baz_DetailedNotes` are excluded untrusted legacy fields.
- Allocation imports are parked.
- Stable-ID later attempts prove only another related record exists in the uploaded window.
- Semantic fields remain null/unknown unless manager-authored.
- Call data and transcripts make no sales, payment, fulfilment, revenue, ROI, order-value, or CRM-outcome claims. The optional Carma contract may display Carma-approved orders and approved values as CRM source facts; exact customer linkage is not call-to-sale causation and approved value is not paid or recognised revenue.
- Carma joins use exact `customer_id` only. Phone, fuzzy business-name and inferred-person matching are prohibited; possible staff aliases remain review-only.
- Carma source types and campaigns are separate dimensions. Dated or `(Batch)` labels never become source types.
- Carma lead-source reports default to `actual_seller_any_pre_sale_allocation.v1`. Allocation age and channel proof do not disqualify Company Sourced; administrators, other salespeople and unverified aliases cannot qualify in place of the actual seller.
- Pilot callback/sale/profit facts exist only when the separate source contract proves them. Invalid assignments do not enter denominators, incomplete/unequal outcome windows withhold callback lift, and currencies never combine.

## Storage

- `data/store/state.json`: import/report/alert/review history and research job references.
- `data/store/intelligence.sqlite`: active deterministic call/event/risk/lead projection.
- `data/store/evaluation-studio.sqlite`: historical knowledge/templates/runs/results.
- `data/store/evaluation-validation-lab.json`: isolated benchmark manifests, exact-evidence human labels, freeze fingerprints, and candidate comparison records.
- `data/store/carma-evidence.json`: local read-only pointer to the versioned external Carma evidence database.

## Runtime

- Start: `node src/main.js`
- Current-data example: `node src/main.js --csv "data/source/CallData 07.07.2026.csv"`
- Optional pilot example: append `--voicemail-pilot "<local pilot.csv or .xlsx>"`.
- Optional Carma example: append `--carma-evidence "<local carma-evidence.sqlite>"`.
- Rebuild/verify Carma contract: `npm run carma:build-evidence` then `npm run carma:verify-evidence`.
- Tests: `npm test`
- Default URL: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/health`
- Verified 2026-07-22 runtime used port 3040 with `SALES_DASHBOARD_AI_ENABLED=false`.
- The Windows task `Sales Dashboard Overnight Evaluations` is present but disabled. Its trigger remains recorded for audit; it cannot run while disabled, and controller capability preflight must still reject unpromoted work.
- A separate Execution Layer may remain running for other work; it does not enable this application.

## Verified Current State (2026-07-27)

- 19,914 active calls.
- Every active call has `llm_status=not_requested`.
- All audited semantic call/lead/event fields are null.
- Literal outcomes only: voicemail, system audio, wrong number, opt-out, or unknown.
- No active Evaluation Studio runs or model jobs.
- Deterministic voicemail/inbound lane: 1,972 exact voicemail encounters, 22 literal callback requests, 0 exact approved-template messages, 135 later-inbound relationships, and 113 clean chronology links.
- Blocked write endpoints leave stored counts unchanged.
- Browser verification passed across all workspaces, Evaluation Studio, and a call page with no console errors/warnings.
- Optional voicemail-pilot populated, absent, invalid-source, and 390-pixel mobile states pass. The populated fixture created zero jobs, runs, results, reviews, queues, or persisted pilot rows.
- Carma evidence contract `carma_evidence.v2`: 930 orders, 910 customers, 30,494 allocation rows and 5,750 compiled credit rows; SQLite integrity `ok`, zero foreign-key, lead-source-classification, source/campaign or phone-column violations.
- The original 293-order overlap remains 26 exact customers/28 calls with 15/15 comparable source matches and 15/15 comparable import-date matches. The expanded two-cohort contract legitimately increases the exact overlap to 74 customers/121 calls.
- The current 13–19 July cohort contains 637 sales worth $336,455.24: 541 Company Sourced and 96 Self Sourced under the locked any-pre-sale-allocation rule. Separately, 381 orders qualify for a named external source under the retained external-credit rule.

## Future Work Boundary

Improve deterministic reporting, literal evidence, usability, performance, and manager review. The isolated Validation Lab supports 10-call smoke, 50-call development, at least 100-call promotion, and 25-call shadow partitions. A future semantic evaluator requires a materially different candidate or deterministic rule, a genuinely unseen balanced frozen promotion set, predeclared evidence/accuracy/critical-error/resource thresholds, and separate external operational approval.
