# Agent Context

This is the fast handoff for Sales Dashboard. Read `AGENTS.md` and the startup documents before changing behavior.

## Current Product

- Sales Dashboard is a local Node.js application for CSV/XLSX sales-call exports.
- Active reporting is limited to source-record facts, exact stable-ID relationships, literal transcript states, manager-authored review overlays, and optional authoritative Carma CRM facts through the separate read-only evidence contract.
- Optional allocation imports remain parked and excluded from active analytics.
- Before locating or using any Carma extract, read `docs/CARMA_DATA_LAYER.md` and refresh `data/carma/catalog.json` when it is missing or stale. The catalog identifies the full approved-sales history, raw weekly allocation logs, customer allocation history and optional Campaign snapshots.
- Optional voicemail-pilot imports are read-only source validation inputs, never active intelligence or model inputs.
- The application does not currently have a promoted local-model capability. Historical Qwen outputs are research artifacts only.

## Mandatory Local-Model Boundary

- Read `docs/LOCAL_MODEL_CAPABILITY_POLICY.md`, `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`, and `runtime/LOCAL_MODEL_COMPREHENSIVE_AUDIT_2026-07-22.md` before touching model-related code or data.
- The current register contains 20 capabilities and zero promoted capabilities. Every live submission and operational-consumption decision must fail closed.
- Do not submit Qwen work, poll it for operational use, auto-route it, resume it, harvest it into active state, or use it for queues, denominators, rankings, coaching, compliance, discipline, finance, lead actions, or CRM decisions.
- The Qwen Spiel v3-v6 family is stopped. A narrower prompt or another decomposition is prohibited unless a materially different model and a new independently approved research program are introduced.
- JSON validity, exact copied quotes, completed jobs, and passing transport tests prove technical function only. They do not prove semantic accuracy.

## Active Trusted Boundary

- Exact literal terminal states only: recognised no-answer wording, machine/carrier voicemail or system-audio wording, a direct Customer wrong-number statement, and a direct Customer opt-out statement.
- Literal AI-assistant phrase detection is descriptive evidence only.
- Stable-ID reattempt relationships show only that another matching record or later attempt exists. They do not prove callback completion, contact quality, a sale, payment, or revenue.
- Record age, source, salesperson, direction, call method, timestamps, and import coverage are source facts, not performance judgments.
- Semantic fields such as human contact, meaningful conversation, decision-maker status, sentiment, next step, valid no-sale, lead quality, call quality, and model confidence remain `null`/unknown unless a manager records an explicit review overlay.
- Call/transcript evidence must not claim sales conversion, revenue, order value, close date, won/lost outcome, payment, fulfilment, ROI, or CRM completion. Carma-approved orders and approved values may be shown only as CRM source facts; they do not prove call causation, payment, fulfilment, profit or recognised revenue.
- Carma joins are exact `customer_id` only. Never add phone, fuzzy-name or inferred-person matching. Keep possible staff aliases review-only.
- Acquisition source and campaign are separate. Never turn a dated or `(Batch)` campaign label into a source type.
- Default every Carma lead-source, source-credit and salesperson-performance report to `docs/LEAD_SOURCE_REPORTING_POLICY.md` / `actual_seller_any_pre_sale_allocation.v1`: Company Sourced when the actual seller had any exact recorded pre-sale allocation; Self Sourced only when no such allocation exists. Allocation age and channel proof do not change this top-level classification.
- Keep sourcing method, named acquisition source, campaign, Carma credited source and external credit allowance as separate fields. Administrative/other-person allocations do not qualify in place of the actual seller.
- `NoSaleType` and `Baz_DetailedNotes` are excluded untrusted legacy fields. Preserve them only in original raw input; never use or expose them in active analytics, model input, reviews, reports, APIs, or UI.
- Do not use partial phone numbers for matching or display. Use only permitted stable IDs.

## User-Facing Surfaces

- Dashboard workspaces: `overview`, `opportunities`, `follow_up`, `reviews`, `intelligence`, and `records`.
- Opportunities is intentionally unavailable while no relevant model capability is promoted.
- Follow-Up is literal reattempt activity, not a semantic callback or sales-opportunity queue.
- Intelligence is literal transcript triage with explicit provenance and guardrails.
- Records & Reports contains source-record facts, read-only Carma sale/source-credit proof, attribution-review facts and safe reports.
- Evaluation Studio at `/evaluation-studio` is a controlled validation workspace. It contains a read-only capability catalog, deterministic voicemail/inbound evidence, an isolated benchmark lab, and a visibly separate immutable historical research archive.
- The optional pilot section accepts only the exact contract in `docs/VOICEMAIL_CALLBACK_ATTRIBUTION.md`. It rejects invalid assignments before denominators, keeps invalid downstream measures `not_scored`, separates currencies/provenance, and withholds callback lift unless both arms have complete equal-duration windows.
- The only permitted Studio writes create benchmark manifests, record exact-evidence human labels in batches of at most five, and freeze complete manifests. They cannot create, submit, resume, poll, or harvest a model job and cannot mutate the archive.
- Research metadata, quarantine state, semantic feedback, and result-to-review handoff are also locked; use the normal call page for an independent manager-authored review.
- Lead Harvest and operational sales-opportunity APIs are retired or unavailable; do not restore them from historical code or documentation.
- Call proof pages retain transcript evidence, literal detections, historical research clearly labelled non-authoritative, and manager review capture.

## Runtime And Storage

- Generic start: `node src/main.js`
- Current-data example: `node src/main.js --csv "data/source/CallData 07.07.2026.csv"`
- Optional pilot: append `--voicemail-pilot "<local pilot.csv or .xlsx>"` or set `SALES_DASHBOARD_VOICEMAIL_PILOT_PATH`.
- Optional Carma: append `--carma-evidence "<local carma-evidence.sqlite>"`, set `SALES_DASHBOARD_CARMA_EVIDENCE_PATH`, or use the ignored local `data/store/carma-evidence.json`.
- Carma rebuild/verification: `npm run carma:build-evidence` and `npm run carma:verify-evidence`.
- Test: `npm test`
- Boundary audit: `npm run audit:trusted-boundary`
- Default URL: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/health`
- Main local state: `data/store/state.json`
- Active derived call intelligence: `data/store/intelligence.sqlite`
- Historical Evaluation Studio archive: `data/store/evaluation-studio.sqlite`
- Isolated benchmark truth: `data/store/evaluation-validation-lab.json`
- Read-only Carma contract pointer: `data/store/carma-evidence.json`
- The Windows task `Sales Dashboard Overnight Evaluations` is present but disabled. Do not enable it. Both overnight and ad-hoc controllers must reject execution before any model network request while capabilities are unpromoted.
- A separate AI Execution Layer may still be running for another project. Its presence does not enable Sales Dashboard; this application must remain disconnected and fail closed.

## Persistence And Review Rules

- Raw input remains local and ignored by Git.
- Raw pilot input remains local, ignored and unpersisted. Only sanitized in-memory report fields may reach the API/UI.
- Any browser/UAT server that uses fixture call data must set `SALES_DASHBOARD_STORE_PATH` to an isolated temporary store. Never start fixture data against the default `data/store/state.json`.
- Derived deterministic facts and manager overlays are versioned local data.
- Manager review is a non-destructive overlay. It never overwrites raw source, deterministic evidence, or historical model artifacts.
- Alert lifecycle actor attribution remains the server-side placeholder `local_manager` until authentication exists.
- Historical model runs/results/jobs remain preserved for audit, labelled `researchOnly` with authority `none`, and excluded from operational aggregates.
- Human benchmark labels are calibration truth, not routine human review. Every decision, including unsupported, requires an exact transcript quote and validated turn index before freezing.
- A strict promotion partition is at least 100 genuinely unseen, balanced calls. A passing comparison only becomes eligible for external approval; code never promotes automatically.
- Generated reports shown in the library must be based only on the active trusted boundary. Historical unsafe reports may remain preserved but hidden.

## Current Live Proof (2026-07-23)

- Active import: 19,914 calls from `CallData 07.07.2026.csv`.
- All active-import calls have `llm_status=not_requested`; all audited semantic columns are null.
- Literal outcomes only: voicemail, system audio, direct wrong number, direct opt-out, or unknown.
- No active Evaluation Studio runs or unresolved queued model jobs. The scheduled evaluation task exists but is disabled.
- Deterministic current-import voicemail proof: 1,972 exact voicemail encounters; 22 literal callback requests; 0 exact approved-template messages; 135 later-inbound relationships; 113 clean chronology links.
- Model submission, result ingestion, run creation, prompt testing, resume, harvest, and Lead Harvest adversarial requests fail closed without changing stored counts.
- Live browser verification found no operational model controls, Lead Harvest surface, semantic quality scores, or browser console errors.
- Optional pilot parser/API/UI tests and populated/empty/invalid/mobile browser checks passed; the import created no model or operational work.

## Current Risks

- Literal matching is intentionally conservative and may leave many calls unknown. Unknown is safer than a fabricated semantic decision.
- Manager reviews are local single-user overlays, not an authenticated multi-user workflow.
- Historical research names and outputs remain discoverable in the archive and source tree; their labels must never be interpreted as current capabilities.
- The application has no automatic semantic call-quality evaluator. That is an explicit product boundary, not a backlog defect to bypass.

## Next Useful Work

- Preserve the zero-promoted fail-closed boundary.
- Add a new evaluator only through the isolated, separately frozen, strictly unseen promotion program using a materially different candidate model or a genuinely deterministic rule. Promotion requires at least 100 balanced calls and external approval.
- Improve usability, source-record reporting, literal evidence, and manager review without introducing semantic automation claims.
