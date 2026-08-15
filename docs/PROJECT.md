# Project

## Name

Sales Dashboard

## Purpose

Sales Dashboard is a local web application for inspecting scheduled CSV/XLSX sales-call exports and optional validated Carma evidence. It turns supported source facts, exact stable-ID relationships, conservative literal transcript detections, policy-governed approved-sale/source-credit evidence, and manager-authored review overlays into usable evidence without inventing call quality, payment, recognised revenue, ROI, or customer intent.

The current product deliberately has no automated semantic evaluator. The audited Qwen service works technically, but none of its evaluator capabilities is accurate enough for operational authority.

## Primary Users

- Sales managers reviewing source records, call activity, reattempt evidence, literal risk signals, and individual transcripts.
- Operators checking import coverage, application health, and historical research state.
- Developers extending deterministic reporting or testing a future evaluator behind an independent promotion boundary.

## MVP Scope

- Load a call CSV/XLSX from `--csv <path>` or `SALES_DASHBOARD_CSV_PATH`.
- Optionally load a separate voicemail-pilot CSV/XLSX from `--voicemail-pilot <path>` or `SALES_DASHBOARD_VOICEMAIL_PILOT_PATH`; validate it read-only and never persist its raw rows into the active stores.
- Optionally parse an allocation file from `--allocations <path>` or `SALES_DASHBOARD_ALLOCATIONS_PATH`, but park it outside active analytics.
- Optionally open a normalized Carma evidence SQLite contract from `--carma-evidence <path>`, `SALES_DASHBOARD_CARMA_EVIDENCE_PATH`, or ignored local configuration. Open it read-only, validate its contract and integrity, and join calls to approved sales by exact `customer_id` only.
- Deduplicate calls by `call_id`.
- Use source facts such as timestamps, direction, method, salesperson, source, region, record dates, and transcript availability.
- Use permitted stable IDs for exact repeat/later-attempt relationships. Never use partial phone values.
- Detect only closed literal transcript states whose exact wording is retained as evidence: machine/carrier voicemail or system audio, recognised no-answer wording, direct Customer wrong number, direct Customer opt-out, and literal AI-assistant phrasing.
- Leave semantic attributes unknown: human contact, meaningful/actionable conversation, decision maker, sentiment, next step, lead validity/quality, call quality, Spiel quality, and evaluator confidence.
- Provide six dashboard workspaces: Overview, Opportunities, Follow-Up, Alerts & Reviews, Intelligence, and Records & Reports.
- Make Opportunities explicitly unavailable while no supporting evaluator is promoted.
- Treat Follow-Up as literal reattempt activity, not a semantic callback queue.
- Provide transcript proof pages and non-destructive manager review overlays.
- Make Evaluation Studio a controlled validation laboratory: capability truth, deterministic evidence, benchmark-only human labels, and an unmistakable read-only historical research archive with authority `none`.
- Build research benchmark manifests from genuinely unseen calls only, show no more than five direct-quote questions at once, and freeze exact evidence-backed labels before any future candidate inference.
- Measure the deterministic voicemail/inbound lane from exact source/literal facts without claiming callback causation, receptiveness, sale, or conversion.
- Measure a controlled voicemail pilot only from exact preassignment, event-link, call-ID, source-handler, CRM-sale and currency facts. Withhold treatment/control lift until both arms have complete equal-duration observation windows.
- Retire Lead Harvest and every model-backed operational route, queue, rollup, ranking, or action.
- Persist local history under the ignored `data/` directory.
- Keep reports based on trusted source/literal evidence and validated read-only Carma evidence; preserve unsafe historical reports without exposing them as active truth.
- When Carma evidence is configured, show approved order, seller, approval date/value, seller-allocation date, sourcing method, acquisition source, policy credited source, campaign, Carma credited source, allowable credit, and reconciliation findings without CRM writeback.
- Default every Carma lead-source and salesperson-performance report to `actual_seller_any_pre_sale_allocation.v1`: Company Sourced when the actual seller had any exact recorded pre-sale allocation; otherwise Self Sourced. Allocation age and acquisition-source proof do not change this top-level method.
- Clearly state that call-source data alone does not prove sales conversion. Validated Carma evidence may prove an approved sale and its recorded approval value, but does not prove payment, fulfilment, recognised revenue, profit, ROI, or causal influence.

## Model Capability Policy

- `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` and the latest `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_*.json` control all local-model submission and consumption.
- The 2026-07-22 register has 20 audited capabilities and zero promoted capabilities.
- Live model submission, automatic routing, polling for operational use, result ingestion, Studio run creation, prompt tests, resume, harvest, and scheduled/ad-hoc automation must fail closed.
- Historical output may be displayed only as research, with `researchOnly: true`, authority `none`, and a clear warning.
- Qwen Spiel v3-v6 is a stopped research family. Do not rescue it with another same-model decomposition.
- A future capability requires a frozen predeclared scope, genuinely unseen evidence, human labels fixed before inference, field-level minimum evidence, explicit accuracy and critical-error thresholds, and separate approval before operational use.

## Operating Profile

- Stack: Node.js built-in platform modules and local SQLite storage.
- Generic start: `node src/main.js`
- Current-data example: `node src/main.js --csv "data/source/CallData 07.07.2026.csv"`
- Test: `npm test`
- Default URL: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/health`
- Main state: `data/store/state.json`
- Active derived intelligence: `data/store/intelligence.sqlite`
- Evaluation research archive: `data/store/evaluation-studio.sqlite`
- Benchmark-truth store: `data/store/evaluation-validation-lab.json`
- The port may be overridden; the verified 2026-07-22 runtime used port 3040.

## Success Criteria

- Imports load without copying sensitive source data into Git.
- Every active displayed conclusion is traceable to a permitted source field, exact stable-ID relationship, exact literal transcript excerpt, or explicit manager review.
- Unknown semantic states remain null/unknown and do not silently become negative or positive outcomes.
- Historical model artifacts never affect routes, actions, denominators, rankings, coaching, compliance, discipline, finance, lead work, or CRM decisions.
- Every model-related write endpoint fails closed when its capability is unpromoted and does not mutate stored counts.
- Scheduled and ad-hoc controllers cannot reach the model service while the capability register is closed.
- Evaluation Studio has no model submission controls. Its only writes are isolated benchmark-truth drafts/labels/freeze records; these cannot mutate the archive or create operational work.
- Every registered capability shows exact scope, status, provenance, authority, exclusions, evidence, failure reason, and permitted next action.
- The voicemail/inbound lane recomputes counts from the active import and keeps ambiguous chronology/linkage `unknown`/`not_scored`.
- The optional pilot import rejects invalid assignments before denominators, keeps invalid downstream measures `not_scored`, separates attribution provenance and currencies, and creates no job, run, result, queue, review or CRM action.
- The optional Carma evidence adapter opens the contract read-only, passes integrity and foreign-key checks, uses exact `customer_id` matching only, separates source from campaign, and exposes no raw configured path.
- The Carma contract keeps sourcing method, acquisition-source type, campaign and credited source separate. Administrative/other-person allocations and unverified aliases never qualify in place of the actual seller.
- Call pages show readable transcript proof, provenance, historical research warnings, and manager review without exposing unsupported raw fields.
- `NoSaleType` and `Baz_DetailedNotes` remain excluded from active computation and display.
- Phone values and malformed date fragments are not used for matching or analytics.
- Generic allocation imports remain parked. Only the separately validated read-only Carma evidence contract may contribute allocation and approved-sale facts.
- Browser, tests, SQLite integrity, runtime health, and adversarial fail-closed checks pass before release.

## Non-Goals

- Automated call-quality, Spiel, objection-handling, procedure, offer-acceptance, lead-validity, or opportunity decisions under the current model.
- Semantic search or automatic coaching/ranking.
- Sales, revenue, payment, fulfilment, ROI, or CRM inference from call records. Approved-sale and source-credit facts may be displayed only from validated Carma evidence.
- Audio processing, diarisation, re-transcription, or recording analysis.
- Phone-based entity resolution.
- External AI services or direct calls to Ollama/vLLM from this repository.
- Multi-user authenticated workflow until authentication and concurrency controls are added.
