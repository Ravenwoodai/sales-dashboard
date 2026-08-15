# Specification

## MVP User Journey

1. An operator starts the local application with a call CSV/XLSX.
2. The application validates, deduplicates, and profiles the source without copying it into Git.
3. A manager sees import coverage, call activity, source/record facts, exact reattempt relationships, and conservative literal transcript detections.
4. Unsupported semantic areas visibly remain unavailable or unknown.
5. A manager can open a contributing call, read the transcript and exact evidence, and record a non-destructive review overlay.
6. A manager can inspect capability boundaries, deterministic voicemail/inbound evidence, and benchmark-only human-truth work in Evaluation Studio.
7. Historical model work remains in a separate immutable Evaluation Research Archive, clearly labelled non-authoritative.
8. When the optional Carma evidence contract is configured, a manager can inspect approved sales, seller-allocation proof, policy source/campaign, Carma credited source, and exact-ID call reconciliation in Records & Reports.

## Data Contract

- Deduplicate by `call_id`.
- Treat raw transcript text as untrusted display content and escape it.
- Preserve source speaker/turn order; do not claim independent diarisation.
- Use valid source timestamps and display them in Australian format/AEST.
- Use valid `CustomerImportDate` and `CustomerCreateDate` only for record-age/source reporting.
- Treat malformed date fragments as missing.
- Never use or display `dialled_phone_number` or partial/redacted phone values for matching.
- Use only permitted exact source IDs, including `customer_id`, `ContactId`, `AllocatedLeadID`, `FoundCustomerID`, and `FoundContactID`, for limited relationships.
- A later stable-ID match means `later_attempt_observed` only. It does not prove callback completion, human contact, lead validity, sale, payment, or revenue.
- `NoSaleType` and `Baz_DetailedNotes` are excluded untrusted legacy fields. Preserve them only in original raw input; never use or expose them in active analytics, filters, alerts, reports, UI/APIs, manager-review prefill, or evaluator input.
- Optional campaign/allocation imports are parked and excluded from active analytics, filters, reports, alerts, scorecards, and evaluator context.
- The separate normalized Carma evidence contract is optional, local, validated, and opened read-only. It may contribute approved-sale, seller-allocation, source, campaign, and credit facts after integrity validation.
- Join call records to Carma customers by exact `customer_id` only. Name, phone, partial-ID, and fuzzy matching are forbidden.
- Keep acquisition source and campaign in separate fields. Campaign labels must never be promoted into source types.
- Under default lead-source policy `actual_seller_any_pre_sale_allocation.v1`, classify a sale as `Company Sourced` when the actual seller has any exact recorded allocation on or before sale approval; otherwise classify it as `Self Sourced`. Allocation age, acquisition-source proof, most-recent-recipient status and later allocations to other people do not change this top-level classification.
- Keep any named acquisition-channel credit policy separate. The retained external-credit comparison may still use its own independently versioned source-proof/28-day rule, but that rule must never redefine Company Sourced versus Self Sourced.

## Active Evaluation Rules

The active evaluator is deterministic and literal only.

Allowed outcomes:

- `no_answer` only for a recognised exact no-answer phrase.
- `voicemail` only for machine/carrier voicemail wording.
- `system_audio` only for machine/carrier/system wording covered by the closed rules.
- `wrong_number` only for a direct Customer wrong-contact statement.
- `opt_out` only for a direct Customer opt-out statement.
- otherwise `null`/unknown.

Allowed events:

- Exact voicemail/system-audio/no-answer evidence.
- Direct Customer wrong-number evidence.
- Direct Customer opt-out evidence.
- Literal AI-assistant phrases as descriptive evidence, never a quality judgment.

The following stay null/unknown unless a manager explicitly authors an overlay:

- transcript quality;
- connected to human;
- meaningful/actionable conversation;
- decision-maker status;
- customer sentiment;
- next step/follow-up meaning;
- valid no-sale;
- lead quality/score;
- call quality/score;
- Spiel/handling quality;
- evaluator confidence.

## Dashboard Modules

- **Overview:** active dataset, filters, denominators, provenance, call activity, trusted coverage, reattempt facts, record/source facts, and attention items derived from literal evidence or manager state.
- **Opportunities:** explicit unavailable state while required capabilities are unpromoted. No model-backed funnel or action queue.
- **Follow-Up:** reattempt activity derived from exact stable IDs and literal no-contact states. It is not a semantic callback queue.
- **Alerts & Reviews:** lifecycle controls for supported literal alerts plus manager review records.
- **Intelligence:** literal transcript triage, exact evidence, provenance, and guardrail disclosure.
- **Records & Reports:** source records, record-age/source summaries, attribution-review facts, safe reports, and optional read-only Carma sale/source-credit evidence with a separate campaign field.
- **Evaluation Studio:** controlled validation laboratory with a complete capability catalog, deterministic voicemail/inbound lane, benchmark builder, direct-quote human labelling in batches of at most five, strict frozen promotion checks, and a separate immutable Historical Research area. It has no model submit, run, retry, resume, harvest, or operational review-handoff controls.
- **Call proof:** ordered transcript timeline, literal detections, sanitized source fields, historical model research warnings, manager review, and audit history.
- Lead Harvest and semantic team-performance panels are retired.

## Alert And Manager Review Governance

- Alerts are generated only from the active trusted boundary.
- Active alert statuses are `new`, `acknowledged`, and `in_progress`; closed statuses do not inflate active totals.
- Alert lifecycle actions append history and never change original evidence.
- Server-resolved actor is `local_manager` until authentication exists; client actor names are not authoritative.
- Manager review is separate from alert lifecycle.
- Manager review can confirm, correct, dismiss, escalate, reopen, or add a note within the allowlisted review contract.
- Corrections are overlays containing previous/displayed/corrected values, reason, evidence assessment, note, actor, time, and history.
- Manager review never overwrites raw input, literal evidence, or historical model artifacts.

## Local-Model Governance

- `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` and the latest capability register are authoritative.
- Every exact capability has separate submission and operational-consumption permission.
- Missing, malformed, stale, unknown, failed, stopped, quarantined, or unpromoted state is denied.
- The current Qwen register contains zero promoted capabilities.
- No Qwen work may be submitted, resumed, harvested, auto-routed, or operationally consumed.
- Technical service health, valid JSON/schema, exact copied excerpts, successful jobs, test coverage, and plausible explanations are not semantic promotion evidence.
- Once an atomic/narrow unseen semantic gate fails, another same-model decomposition or adjacent fact lane is prohibited for that evaluator family.
- A materially different future candidate must have predeclared facts, exclusions, evidence minimums, frozen human labels, genuinely unseen promotion calls, critical-error limits, and separate explicit operational approval.

## Evaluation Research Archive

- Preserve historical knowledgebase entries, templates, runs, jobs, results, prompts, evidence, provenance, audits, and quarantine history.
- Archive records are immutable research evidence with `researchOnly: true` and authority `none`.
- Historical names such as Foundation, Offer Acceptance, Callback, Objection, Procedure, Lead Record, Spiel Quality, or Lead Harvest do not grant current authority.
- Archive reads must not automatically poll the model service, reconcile into active state, route new jobs, create reviews, or alter active denominators.
- Knowledgebase/template edits, archive/quarantine changes, semantic feedback, and result-to-review handoff are also locked; the archive is read-only, not merely inference-disabled.
- Result-ingestion endpoints are retired (`410`).
- Run creation, prompt testing, resume, and harvest are capability-locked (`423`) while unpromoted.
- Direct transcript-evaluation endpoints and Lead Harvest are retired (`410`).

## Benchmark Validation Lab

- Store benchmark truth separately in `data/store/evaluation-validation-lab.json`; never write it into the historical archive or operational manager-review queue.
- A manifest is bound to one exact fact, one research product use, one partition (`smoke`, `development`, `promotion`, or `shadow`), the active import, transcript/source hashes, and a complete prior-audit exclusion fingerprint.
- Selection excludes every call mentioned in runtime audits or repository rule/prompt/test/script artifacts, every current/historical Studio result, attempted run selection or queued job, and every earlier Validation Lab manifest.
- Human labelling presents no more than five calls at once with the chronological source transcript. Every decision, including unsupported/not-scored, requires at least one selected exact quote, speaker and turn.
- Freeze requires complete labels, unchanged source/transcript hashes, the partition minimum, and balanced positive, hard-negative, and unsupported cases. Frozen manifests and labels are immutable.
- Smoke requires at least 10 examples, development approximately 50, promotion at least 100 genuinely unseen examples, and shadow at least 25. Ten calls never constitute promotion evidence.
- Candidate comparison reports false positives, false negatives, abstentions, unsupported errors, evidence integrity, critical errors, category results, resource use, thresholds, and stop-rule status.
- A passing strict test still does not promote. Separate external approval and an explicit capability-register change are mandatory.

## Deterministic Voicemail And Inbound Lane

- Exact voicemail comes from the existing closed literal outcome.
- A transcript-verifiable callback request requires a salesperson-labelled turn after recognised voicemail prompt wording. Exact approved-message compliance requires the complete approved wording with only the salesperson-name placeholder variable.
- Later inbound evidence requires valid later chronology and an exact permitted stable-ID field/value match. Multiple candidates or an intervening matching outbound record make event attribution `not_scored`.
- Original-salesperson/different-salesperson handling is shown only when clean event chronology, the source salesperson field, and a matching CWA speaker turn all exist.
- The lane may show elapsed time and source linkage. Callback causation, receptiveness, sales and gross profit remain unknown unless future CRM fields prove them.

## Persistence Requirements

- Store local state under ignored `data/` paths.
- `state.json` stores operational history/pointers and model job references.
- `intelligence.sqlite` is authoritative for the active deterministic derived import.
- `evaluation-studio.sqlite` is authoritative for historical Evaluation Studio records.
- `evaluation-validation-lab.json` stores isolated research benchmark truth; it has no operational authority.
- Active-import model status is `not_requested` and semantic columns are null.
- Historical model artifacts never populate active semantic columns.
- Quarantine preserves records and adds explicit state/history; it does not delete evidence.
- Generated reports shown normally must use only trusted active inputs. Unsafe historical/parked reports may remain stored but hidden.
- The optional Carma evidence database remains an external ignored local artifact and is opened read-only. It is not copied into either application SQLite database.
- Both SQLite databases must pass `PRAGMA integrity_check`.

## Optional Voicemail Pilot Attribution

- The optional source is configured with `--voicemail-pilot <path>` or `SALES_DASHBOARD_VOICEMAIL_PILOT_PATH` and follows `docs/VOICEMAIL_CALLBACK_ATTRIBUTION.md`.
- Every listed pilot column header is required. Row values are conditionally required according to the contract.
- Pilot assignment, voicemail event, outbound call and preassignment timestamp must validate before the record enters a treatment/control denominator.
- Message, callback, handler, sale and gross-profit evidence are validated independently. A contradiction makes only the affected downstream measure `not_scored` unless the assignment itself is invalid.
- A no-callback outcome requires an explicit completed observation timestamp. A treatment/control rate requires both arms, complete outcomes for every accepted assignment, and equal-duration observation windows.
- Exact telephony, CRM and manager-verified callback links are reported separately. Manager-verified links require shared stable IDs; phone matching is forbidden.
- CRM sale ID, state and source timestamp are required for observed commercial outcomes. Every assignment has a `pilot_currency`; gross profit requires signed integer minor units and a matching allowed currency. Unlike currencies are never combined. Per-assignment profit also requires a complete equal-duration commercial observation window for every assignment in that currency; missing sale IDs outside a closed window are unknown, not zero.
- The import is read-only and in-memory. It does not change `state.json`, either SQLite database, the Validation Lab, a model capability, or any operational route.

## Optional Carma Sale And Source-Credit Evidence

- Build the normalized `carma_evidence.v2` contract from already saved Carma extracts with `npm run carma:build-evidence`; this is an offline producer and does not log in to or modify Carma.
- Configure the dashboard with `--carma-evidence <path>`, `SALES_DASHBOARD_CARMA_EVIDENCE_PATH`, or ignored `data/store/carma-evidence.json`.
- Validate schema, required tables, SQLite integrity, foreign keys, source/campaign separation, and absence of phone-named matching columns before reporting.
- Expose approved order, customer, actual seller, latest exact pre-sale seller-allocation date, approval date/value, lead-source classification, acquisition source, policy credited source, campaign, allowable external credit, Carma credited source/value, validation state, and reconciliation finding.
- `Company Sourced` requires any exact allocation to the actual seller on or before approval. The allocation may be older than 28 days. Administrative or other-person allocations do not qualify in place of the actual seller, and possible aliases remain review-only.
- `Self Sourced` requires that no exact recorded pre-sale allocation to the actual seller exists.
- Acquisition source type, campaign, Carma credited source and external monetary/source-credit policy are separate dimensions; see `docs/LEAD_SOURCE_REPORTING_POLICY.md`.
- Comparisons and timelines are descriptive evidence. They do not prove that a call, allocation, source, or campaign caused a sale.
- The adapter is read-only and provides no CRM mutation or writeback route.

## APIs And Fail-Closed Behavior

- `/health` exposes import health, AI disabled/configured state, capability summary, sanitized optional-pilot validation status/counts, and sanitized optional-Carma availability/counts without exposing full configured paths.
- `/api/summary`, `/api/alerts`, `/api/manager-reviews`, `/api/imports`, `/api/reports`, and call-proof routes expose active trusted data.
- `/api/ai/jobs/<id>` may expose a sanitized historical job only with research-only/authority-none warning.
- Direct transcript-evaluation submission endpoints return `410`.
- `/api/evaluation-studio/results` mutation returns `410`.
- Evaluation Studio run/prompt/resume/harvest mutations return `423` under capability quarantine.
- Benchmark-only manifest creation, direct-quote labels, and irreversible freeze use isolated `/evaluation-studio/validation-lab/...` routes and never call the model service or mutate archive/job counts.
- `/api/evaluation-studio` and `/api/evaluation-studio/validation-lab` expose the benchmark lab, capability catalog, deterministic voicemail/inbound report, and optional pilot validation report without inference.
- `/api/carma-evidence` exposes the sanitized read-only Carma evidence report and exact-ID reconciliation when configured.
- `/api/lead-harvest` returns `410`.
- Blocked requests must not change job, run, result, review, alert, or report counts and must not make a model-service network request.

## Unsupported Metrics

Do not calculate or claim:

- human answer rate;
- meaningful/actionable conversation rate;
- decision-maker rate;
- call/Spiel quality bands or rankings;
- objection-handling or procedure-adherence performance;
- offer acceptance or sales opportunity;
- lead validity/quality based on transcript semantics;
- callback completion from absence/presence of a later uploaded call;
- sales conversion, payment, fulfilment, order value, revenue, ROI, close date, or CRM won/lost state;
- source or salesperson performance based on any unpromoted model output.

## Acceptance Criteria

- All active conclusions have permitted evidence and provenance.
- Semantic unknowns remain null.
- Capability register validates and zero promoted means zero live model submission/consumption.
- Scheduled task is absent/disabled and both controllers fail before network access.
- No active model jobs or Evaluation Studio runs remain queued/running.
- Evaluation Studio exposes only deterministic/benchmark controls plus the immutable archive; it contains no model execution control.
- All six workspaces and call proof pages contain no hidden model controls or semantic scores.
- Adversarial blocked requests do not mutate stored counts.
- Full automated tests, browser console checks, SQLite integrity checks, runtime health, and `git diff --check` pass.
