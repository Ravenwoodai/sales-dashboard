# Decision Log
This document records durable decisions for Sales Dashboard.
Use short ADR-style entries so future agents know not just what changed, but why.

## ADR Format
Each entry should include:
- Decision ID
- Date
- Status
- Decision
- Context
- Consequences

## ADR-001 - Repository-Local Knowledge Is The System Of Record
Date: 2026-07-05
Status: Accepted
Decision: Important product and engineering context must live in the repository, not only in chat or memory.
Context: Agents can only act on what they can discover while running.
Consequences:
- onboarding becomes faster
- context is more durable
- documentation upkeep becomes part of normal development

## ADR-002 - Plans And Quality Are First-Class Artifacts
Date: 2026-07-05
Status: Accepted
Decision: Meaningful work should update docs/PLANS.md and docs/QUALITY_SCORE.md instead of leaving intent and debt implicit.
Context: Fast iteration without visible plans and quality signals creates drift.
Consequences:
- easier handoffs
- clearer prioritization
- explicit debt tracking

## ADR-003 - Prefer Small, Verifiable Changes
Date: 2026-07-05
Status: Accepted
Decision: Favor the smallest change that can be verified end-to-end.
Context: Smaller diffs are easier for agents to reason about and recover from.
Consequences:
- lower regression risk
- faster reviews
- fewer cascading documentation mismatches

## ADR-004 - Ignore Redacted Phone Values For MVP Analytics
Date: 2026-07-05
Status: Accepted
Decision: `dialled_phone_number` is intentionally incomplete for security and must not be used for matching, repeat-contact metrics, inbound attribution, follow-up linking, phone-quality scoring, or dashboard display in the MVP.
Context: The source system provides privacy-reduced phone values. Treating them as bad data or trying to reconstruct identity would violate the product's privacy boundary.
Consequences:
- stable source IDs are the only allowed linkage keys in the MVP
- missing stable IDs produce unknown linkage instead of inferred linkage
- a future `secure_contact_key` would be the right privacy-safe way to support phone-level matching

## ADR-005 - Start With Deterministic Local Evaluation
Date: 2026-07-05
Status: Accepted
Decision: The MVP uses deterministic local transcript rules before introducing an LLM-backed evaluator.
Context: The first product slice needs auditable, private, testable behavior from the current CSV.
Consequences:
- no transcript data leaves the machine
- evaluation can be tested with fixtures
- future LLM outputs must be schema-validated and versioned rather than silently replacing current logic

## ADR-006 - No Sales Or Revenue Claims From Current CSV
Date: 2026-07-05
Status: Accepted
Decision: The dashboard must not claim confirmed sales conversion, revenue, order value, close date, revenue attribution, or won/lost commercial outcome from the current data.
Context: The current CSV lacks reliable sales/revenue outcome fields.
Consequences:
- dashboard language stays focused on call quality, contactability, follow-up signals, source quality, and review queues
- future data requests should prioritize confirmed outcome and value fields before conversion dashboards are built

## ADR-007 - Store Derived Artifacts Locally Under Ignored Data Folder
Date: 2026-07-05
Status: Accepted
Decision: Persist import history, sanitized evaluation artifacts, alert/review state, and generated reports under `data/`, which is ignored by Git.
Context: The product needs history and a report library, but raw CSVs and transcript-derived artifacts should remain local and out of source control.
Consequences:
- dashboard history survives server restarts
- generated reports can be viewed later from the dashboard
- JSON-file storage remains simple for MVP but may need SQLite when concurrency or larger history arrives

## ADR-008 - Future Generated Reports Must Enter The Reports Library
Date: 2026-07-05
Status: Accepted
Decision: When Codex generates a data extract, analysis, or report for the user, it should save a report record through `POST /api/reports` or `saveGeneratedReport(...)`.
Context: The user wants generated data and reports accessible from the Sales Dashboard instead of stranded in chat.
Consequences:
- report title, summary, markdown content, metadata, and timestamps are retained locally
- the dashboard becomes the default place to revisit generated analysis
- future agent work should include report-saving as a normal closeout step when a report is produced

## ADR-009 - Allocation Coverage Uses Aggregate-Safe Joins
Date: 2026-07-07
Status: Superseded by ADR-010
Decision: Lead allocation workbooks can be incorporated as their own dashboard section, but call-record enrichment must join only by date + salesperson + type until the allocation export provides a shared campaign/list ID or stable lead ID.
Context: The July 7 allocation workbook contains campaign, allocated/actioned/remaining counts, date, manager, salesperson, and type. It does not contain lead IDs or a campaign/list key that appears in the call records.
Consequences:
- allocation `QTY ACTIONED` remains an operational source field, not a replacement for raw call count
- campaign rows are allocation-side totals only
- call observations such as stable lead-days, live-human rate, meaningful conversation rate, and one-attempt/no-contact are shown as aggregate comparisons
- future campaign-level attribution requires a new shared identifier, not name matching or phone inference

## ADR-010 - Park Separate Campaign/Allocation Imports
Date: 2026-07-08
Status: Accepted
Decision: Separate campaign/allocation imports are preserved but parked from active dashboard use.
Context: The allocation workbook created confusing allocation-versus-call comparisons and could be over-read as salesperson, campaign, source, or completion performance. The reliable product scope is call/transcript data plus call CSV fields.
Consequences:
- active analysis no longer builds allocation coverage or reconciliation metrics
- `/api/allocations` returns diagnostic parked status only
- normal dashboard navigation, cards, reports, alerts, scorecards, source/list quality, and AI transcript context exclude separate allocation import data
- raw parser code and existing data are preserved for a future explicit decision
- `AllocatedLeadID` remains an allowed call CSV field for call-based matching and raw inspection, but not for allocation-performance inference

## ADR-011 - Alert Lifecycle State Is A Non-Destructive Overlay
Date: 2026-07-08
Status: Accepted
Decision: Alert lifecycle actions are stored as manager workflow metadata over generated call-data alerts, not as rewrites of the generated alert evidence.
Context: Managers need to acknowledge, progress, resolve, dismiss, reopen, note, and mark likely false positives without losing why an alert originally fired. The app is still local-only and has no real user authentication.
Consequences:
- active alert counts include only `new`, `acknowledged`, and `in_progress`
- `resolved`, `dismissed`, `false_positive`, and parked alerts are preserved but excluded from active alert totals
- lifecycle history and manager notes remain auditable in the local JSON store
- authoritative lifecycle actors use the server-resolved `local_manager` placeholder until authentication exists; client-supplied actor names are ignored
- parked allocation-related alerts stay excluded from normal alert workflow endpoints and dashboard views

## ADR-012 - Active Report APIs Hide Parked And Superseded Report Content
Date: 2026-07-08
Status: Accepted
Decision: Normal report APIs and report viewer routes expose only active reports. Parked allocation, stale stable-target, stable lead-day, lead-day, and allocation-like report content remains preserved in the local store but hidden from normal `/api/reports`, `/api/reports/:id`, `/reports/<id>`, and dashboard Reports Library views.
Context: Batch 5 verification found that raw report APIs could still expose historical report bodies with superseded allocation/stable-target terminology even though active dashboard analytics had parked allocation data.
Consequences:
- `/api/reports` returns active, non-parked reports only and reports a hidden-report count
- `/api/reports/:id` and `/reports/<id>` return not-found behavior for hidden reports in normal mode
- `POST /api/reports` preserves hidden report records but does not echo hidden report bodies in its normal response
- stored records are preserved for future explicit admin/internal diagnostics or cleanup decisions
- `AllocatedLeadID` remains allowed in raw call-field context and is not treated as allocation report content by itself

## ADR-013 - Manager Review Corrections Are Governed Overlays
Date: 2026-07-08
Status: Accepted
Decision: Manager review state and corrections are stored as separate review/correction/history overlays instead of rewriting raw imported fields, deterministic evaluation outputs, LLM outputs, or generated alert evidence.
Context: Managers need to confirm, correct, dismiss, escalate, and note call-level or signal-level classifications while preserving the provenance of the original dashboard intelligence. Alert lifecycle already answers whether an alert has been triaged; manager review answers whether a human reviewed or corrected the underlying classification.
Consequences:
- review statuses are `unreviewed`, `review_needed`, `in_review`, `reviewed_confirmed`, `reviewed_corrected`, `dismissed`, and `escalated`
- manager review and alert lifecycle statuses are displayed and stored separately
- corrections use an explicit field allowlist and reject raw imported, metadata, alert-evidence, allocation, and campaign fields
- authoritative review actors use the server-resolved `local_manager` placeholder until authentication exists
- review history, correction reason, evidence assessment, previous displayed value, corrected value, notes, actor, and timestamp are preserved for audit
- aggregate metrics remain deterministic unless a manager-reviewed value is explicitly labelled as such

## ADR-014 - Evaluation Studio Is A Governed Overlay, Not A Replacement App
Date: 2026-07-10
Status: Accepted
Decision: Sales Dashboard remains the system of record while Batch 7 borrows Neuron-Compute-Training's knowledgebase/prompt-management ideas and LatentPulse's structured/local evaluation governance ideas into a local Evaluation Studio overlay.
Context: The sibling projects already contain useful company sales knowledgebase material, editable prompt concepts, local model sidecar patterns, strict structured outputs, and gold-review thinking. Replacing Sales Dashboard would risk losing the active import, allocation parking, global filters, alert lifecycle, manager review, report visibility, and data-confidence guardrails already built here.
Consequences:
- Evaluation Studio stores knowledgebase entries, strict-schema templates, queued/prompt-test runs, local AI harvest state, result records, and report-safe rollups as local management artifacts.
- Evaluation templates may use safe custom evaluation goals so managers can add new question types without code changes; parked campaign/allocation goal names remain blocked.
- Neuron/LatentPulse-derived seeds are included as starting guidance, but managers can edit/archive them inside Sales Dashboard.
- Optional local model submission must go through `src/aiExecutionLayer.js`; Sales Dashboard does not call model runtimes directly.
- Evaluation Studio outputs must remain evidence-backed, confidence-labelled, versioned, and manager-reviewable.
- Evaluation results preserve prompt/template version and knowledgebase-version context so stored findings can be audited against the exact management context used.
- Evaluation Studio result handoff may add suggested correction prefill for allowlisted manager-review fields, but suggestions remain separate from confirmed manager corrections until a manager acts.
- Evaluation Studio run quarantine/resume/harvest state is governance metadata only; it does not delete jobs, raw calls, result records, or manager review history.
- Evaluation Studio must not silently overwrite raw imported fields, deterministic outputs, LLM outputs, alert evidence, or manager review history.
- Parked campaign/allocation imports remain excluded from active evaluation, reporting, filters, and performance claims.

## ADR-015 - Manager Reporting Uses Focused Workspaces
Date: 2026-07-11
Status: Accepted
Decision: The Sales Dashboard is presented as seven focused manager workspaces selected with the `view` query parameter, while Evaluation Studio remains a separate `/evaluation-studio` workspace.
Context: Rendering every scorecard, queue, confidence panel, alert, report, and raw record on one page created excessive scrolling and made operational priorities hard to find. The redesign must improve navigation without creating inconsistent analytics or separate filter implementations.
Consequences:
- workspace views are `overview`, `harvest`, `follow_up`, `reviews`, `team`, `intelligence`, and `records`
- global filter query state is preserved when moving between workspaces
- server analysis, denominators, allocation parking, alert lifecycle, and manager review governance remain unchanged
- Evaluation Studio prompt, knowledgebase, and run controls stay outside the reporting workspace
- operational tables may use bounded previews, but their full evidence and drilldown routes remain available

## ADR-016 - Historical Evaluation Knowledge Requires Explicit Approval
Date: 2026-07-11
Status: Accepted
Decision: Historical Neuron and LatentPulse knowledge is stored as active, visible Evaluation Studio records with `pending_manager_approval`, but is excluded from evaluation runs and local model input until a manager changes it to `approved_current`.
Context: The source projects contain useful company procedure, language, scoring, examples, historic pricing, programme variants, outcome-linked analysis, and review-governance material. Some content may no longer match the current offer, policy, legal wording, or data-confidence rules.
Consequences:
- visible knowledge is distinct from knowledge eligible for evaluation context
- every imported entry stores source project, source reference, version, historical flag, approval status, and approval note
- historical pricing, dates, legal statements, programme wording, and examples cannot silently become current operational policy
- de-identified LatentPulse calibration entries support manager review and prompt calibration but are not raw transcript imports
- managers approve current material per entry through Evaluation Studio before new runs can use it

## ADR-017 - Exclude Untrusted Legacy Disposition And Note Fields
Date: 2026-07-11
Status: Accepted
Decision: `NoSaleType` and `Baz_DetailedNotes` remain preserved unchanged in raw source files but are optional and excluded from active analytics, alerts, filters, reports, scorecards, normal UI/APIs, manager-review prefill, and AI/evaluator context.
Context: `NoSaleType` is a human-entered legacy disposition known to be inaccurate, while `Baz_DetailedNotes` is output from an unknown legacy model with unverified prompt, version, provenance, and accuracy. Neither is reliable enough to support management conclusions or model evaluation context.
Consequences:
- changing, blanking, or omitting either field cannot change active dashboard results
- imported-disposition mismatch metrics and alerts are retired
- old reports and alerts that depend on either field remain preserved but are hidden from normal active views
- Evaluation Studio records that contain legacy dependencies remain preserved and are classified out of active lists; new knowledge, templates, and results reject those dependencies
- local LLM intelligence created before the policy cutoff is preserved but quarantined from active intelligence until rerun under the current field-exclusion policy
- raw source records are not rewritten or deleted
- future integrations must provide separately governed, provenance-labelled evidence rather than reusing these fields

## ADR-018 - Bad-Lead Claims Are Auditable Allegations, Not Lead Decisions
Date: 2026-07-11
Status: Accepted
Decision: Introduce an internal versioned `bad_lead_claim.v1` record that stores a submitted allegation separately from future system evidence and manager decisions. Original allegation fields are immutable, status changes are controlled, manager decisions use trusted service context, and every action appends audit history.
Context: The dashboard can derive transcript signals and store manager corrections, but it has no authenticated salesperson claim, lead-suppression, or CRM writeback workflow. Treating deterministic, LLM, `NoSaleType`, or `Baz_DetailedNotes` values as a salesperson claim would be inaccurate.
Consequences:
- the initial implementation is a service and local JSON-store foundation only, with no normal API, UI, Evaluation Studio, report, alert, metric, or suppression integration
- submitter and manager identity must be supplied by trusted service context, never accepted from the claim payload
- `NoSaleType`, `Baz_DetailedNotes`, aliases, and historical dependent outputs cannot create, populate, infer, or alter claims
- a claim records what was alleged; confirmation or rejection is a separate manager decision and does not itself deactivate or suppress a lead
- a future salesperson-facing API requires an authenticated identity source before it can be considered trustworthy

## ADR-019 - Evaluation Studio May Inspect Active Trusted Claims As Allegations
Date: 2026-07-11
Status: Accepted
Decision: Local Evaluation Studio task inputs may include active `submitted` or `under_review` `bad_lead_claim.v1` records as read-only salesperson allegations. Exact `call_id` claims take precedence; only when none exist may a claim with no call ID match the call's exact canonical `AllocatedLeadID`.
Context: The evaluator needs to inspect what a salesperson alleged without treating deterministic outcomes, historical AI output, alerts, manager reviews, phone/name similarity, or excluded legacy fields as claims.
Consequences:
- claim context is labelled `salesperson_allegation` and is not factual proof, a manager decision, or an instruction
- inactive `confirmed`, `rejected`, and `withdrawn` claims are excluded from evaluator context
- customer/contact IDs, phone text, salesperson names, transcript wording, business names, alerts, reviews, deterministic outcomes, and historical AI results cannot match or create claim context
- claim history and manager-decision metadata are not sent to the evaluator
- internal claim context is sent only in the local model task payload and is removed from normal prompt-test API task-input responses
- the project-authenticated local AI Execution Layer may durably retain the full submitted task payload under its own retention policy; Sales Dashboard job references and job-status proxy responses do not expose the claim block
- evaluator instructions, output schema, result normalisation, metrics, reports, alerts, lead status, allocation, and CRM data remain unchanged

## ADR-020 - Replace Broad Lead-Validity Evaluation With A Conservative Evidence Audit
Date: 2026-07-11
Status: Accepted
Decision: Archive the seeded Lead Validity And Utilisation template and replace it with the versioned Lead Record & Disposition Evidence Audit (`lead_record_disposition_evidence_audit`, schema `lead_record_disposition_evidence_audit.v1`).
Context: A broad lead-validity prompt could blur call evidence, salesperson allegation, operational usability, and final lead disposition. The local Qwen3 route has an 8,192-token context and 1,024-token output cap, so the replacement uses a compact fixed schema with semantic validation.
Consequences:
- the evaluator distinguishes record evidence from allegation assessment and treats allegation absence explicitly
- supported or contradictory conclusions require direct transcript/system evidence; missing evidence produces untestable or insufficient-evidence output
- the model returns no trusted findings directly; a required empty `findings` array satisfies the shared execution contract and normalized findings are generated locally only after validation
- historical generic v1 results and runs remain readable, while the old seeded template is archived non-destructively
- audit results are excluded from report rollups and cannot confirm/reject claims, change workflow status, alter leads, change operational systems, or write to a CRM
- excluded legacy fields and parked data remain unavailable

## ADR-021 - Enforce Lead Evidence Decision Consistency Locally
Date: 2026-07-12
Status: Accepted
Decision: Version the Lead Record & Disposition Evidence Audit template to v3 while retaining output schema `lead_record_disposition_evidence_audit.v1`, and enforce recommendation, review, evidence, confidence, and contact-state relationships in the local Sales Dashboard semantic layer.
Context: A controlled five-call run showed that valid schema output could still pair supported invalidity with normal workflow, confuse absent allegations with absent transcript evidence, or assign high confidence to unavailable evidence.
Consequences:
- explicit verified wrong-number evidence is normalized to supported invalidity, `correct_or_remove_record`, and manager review without changing a lead or claim
- absent allegations affect only allegation assessment; normal rejection evidence remains usable and available
- unavailable evidence caps confidence at 0.35, partial evidence at 0.75, and confidence of 0.90 or more requires available verified transcript evidence
- voicemail and no-answer evidence remain non-invalidity contact states with advisory `retry_contact`
- normalized findings separately expose contact evidence, record evidence, allegation availability/assessment, and recommended manager action
- deterministic semantic adjustments are stored with the normalized audit assessment while the raw model response remains preserved by the Execution Layer
- prior template versions, runs, and stored results remain preserved and readable

## ADR-022 - Make Safety-Critical Disposition Mappings Deterministic
Date: 2026-07-12
Status: Accepted
Decision: Version the Lead Record & Disposition Evidence Audit template to v4, retain schema `lead_record_disposition_evidence_audit.v1`, and deterministically reconcile verified do-not-contact, serious threat, explicit permanent-closure, and hedged-closure evidence before accepting a stored result.
Context: The preserved 25-call calibration showed that schema-valid model output could ignore an explicit opt-out or serious threat, treat a direct permanent closure as ordinary operational unusability, or overstate uncertain closure wording.
Consequences:
- direct do-not-contact and serious threat evidence becomes `supported_operational_unusability`, `manager_review_recommended`, and manager review true
- explicit permanent business closure becomes `supported_invalidity`, `correct_or_remove_record`, and manager review true
- hedged closure wording cannot prove permanent closure; it remains untestable, uses partial evidence, caps confidence at 0.75, and recommends independent verification
- locally generated findings expose the operational issue separately and agree with the top-level recommendation and review flag
- every recommendation remains advisory; no claim, lead, allocation, CRM, alert, report, or manager-review state is changed
- historical templates, stored results, and calibration artifacts remain preserved

## ADR-023 - Evaluation Studio Is A Direct Local Workflow
Date: 2026-07-13
Status: Accepted
Decision: Ordinary Evaluation Studio use requires no manager identity or approval. Local users select transcripts, preview and run batches, and browse evidence-backed results. Knowledge entries are Draft or Included. Accuracy calibration is optional and uses frozen local reference labels rather than an approval gate.
Context: The application is operated locally by one user; manager-approval ceremony obscured the primary transcript-evaluation workflow without adding meaningful authentication.
Consequences:
- new Evaluation Studio artifacts use `local_user` attribution
- stored compatibility enums remain readable, but the UI uses Draft, Included, and Manual check suggested
- optional Manager Review remains separate and does not gate evaluation
- schema, evidence, worker, idempotency, and no-operational-write protections remain mandatory

## ADR-024 - Separate Accepted Offer From Commercial Completion
Date: 2026-07-18
Status: Accepted
Decision: Project each call's stored Foundation and specialist results into a read-only, versioned commercial lifecycle that keeps accepted-offer evidence, quoted context, intended payment, payment verification, invoice, fulfilment, revenue, and CRM state independent. Offer Acceptance is authoritative only for whether the presented offer was accepted. A later stable-ID call is evidence of a related attempt, not automatic completion.
Context: The Foundation and Offer Acceptance evaluators can establish transcript facts, but the current source does not prove cleared payment, invoicing, fulfilment, realised revenue, or CRM closure. Earlier follow-up linking and percentage confidence presentation could overstate what was actually known.
Consequences:
- `call_intelligence_aggregate.v1` and `call_commercial_state.v1` are deterministic views over stored evidence and trusted call metadata; they do not rewrite historical results or operational systems
- Foundation/specialist disagreements remain visible and use explicit authority rules instead of silent merging
- supported relative dates resolve from the source call's Australian DD/MM/YYYY date while retaining raw wording, source basis, method, and ambiguity
- unknown downstream lifecycle fields remain unknown; accepted-offer reporting cannot imply paid, invoiced, fulfilled, realised revenue, or CRM won
- stable-ID follow-up matching stores the matched fields and later call context as `later_attempt_observed`; completion/payment stay not established without separate evidence
- normal result UI uses evidence-strength bands; numeric model confidence remains uncalibrated audit metadata
- seeded Callback, Procedure, and Objection evaluators use typed v2 contracts with exact evidence, while historical generic results and safe user-created custom templates remain compatible

## ADR-025 - Use Unique-Call Typed Baselines For Evaluation Reporting
Date: 2026-07-18
Status: Accepted
Decision: Management reports count one authoritative result per unique call, preferring the highest template version and latest stored result. Foundation reporting uses the active template baseline when it has results. Historical generic Callback, Procedure, and Objection outputs remain audit history but do not count as current typed specialist completion.
Context: The store contains legitimate reruns, older template generations, and 1,073 generic specialist results whose placeholder contract cannot support present-day pass/fail reporting. Counting result rows inflated denominators, while summing transcript-extracted quoted options created a misleading value total.
Consequences:
- reruns and older template results remain visible but cannot inflate accepted, classified, Foundation, or specialist-completion totals
- active Foundation v6 is the management baseline; older Foundation-only results remain available in result history
- generic historical specialists are labelled `evaluated_legacy_untyped`, never evaluated-clear or issue-found
- a specialist route is complete only when its current typed assessment is present
- quoted-price calls are counted, cross-call price totals are suppressed, and unusually large transcript amounts are flagged for review without silent correction
- deterministic acceptance-action reconciliation may create a new versioned result only when an explicit requested action is later completed by the customer and no later condition or withdrawal controls the final position

## ADR-026 - Recover Missing Typed Specialists Before Foundation And Store Studio History In SQLite
Date: 2026-07-19
Status: Accepted
Decision: The overnight controller must derive missing specialist work from current typed schema contracts and active Foundation routes, recover that work in bounded batches before submitting more Foundation calls, and halt on any recovery quality failure. Evaluation Studio knowledgebase, template, run, and result history is authoritative in a dedicated SQLite database rather than embedded in `state.json`.
Context: The accuracy audit found 967 missing current typed checks across 551 calls even though historical generic specialist rows existed. Embedded Studio history had also grown `state.json` to 54.7 MB, increasing rewrite and startup cost before planned higher volume.
Consequences:
- legacy generic rows remain auditable but never satisfy a current typed route
- recovery defaults to at most 100 exact calls for one specialist goal per run and re-derives the backlog after each clean terminal boundary
- any failed call, partial run, stored error, or planned/completed mismatch halts new overnight submissions until investigated
- the existing 22:00-06:00 Melbourne, 04:30 cutoff, 10-minute idle, 4 GB RAM, and single-controller gates remain authoritative
- SQLite uses WAL, full synchronous durability, indexed operational fields, per-record hashes, and incremental upserts; existing code receives a transparently hydrated Studio object
- the live migration keeps a timestamped pre-migration JSON rollback copy and verifies record counts plus `PRAGMA integrity_check`
