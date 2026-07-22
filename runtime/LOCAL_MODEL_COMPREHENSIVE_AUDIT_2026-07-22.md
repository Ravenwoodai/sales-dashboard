# Comprehensive Local-Model Accuracy And Process Audit

Date: 2026-07-22
Scope: every identified Sales Dashboard evaluator, supporting local-model route, automatic submission path, semantic validator, downstream consumer, scheduler, and durable audit control.
Method: read-only inspection of source, configuration, live health/status, SQLite records, frozen human-labelled audits, run artifacts, and tests. No new local-model job was submitted.

## Post-Audit Remediation Status

The observations below describe the system at audit time. The required P0 remediation was completed later on 2026-07-22 without submitting a model job:

- the capability register is enforced at submission and operational-consumption boundaries;
- all 20 audited capabilities remain unpromoted;
- 167 queued jobs and five queued Studio runs were quarantined non-destructively;
- the scheduled evaluation task is absent/disabled and both controllers fail before network access;
- Evaluation Studio is a read-only research archive with authority `none`;
- Lead Harvest and model-backed operational routes/queues/rollups are retired or unavailable;
- the active intelligence database contains literal outcomes/evidence only and null semantic fields;
- live API, database, browser, and adversarial mutation checks pass.

Current operational truth is in `runtime/SESSION_HANDOVER.md`. References later in this audit to an enabled task, active worker, permitted Studio workflow, or unfinished P0 quarantine are preserved historical findings, not current instructions.

## Executive Verdict

The local inference service is working as configured. The evaluation product is not working accurately enough for its current claimed and operational uses.

The important distinction is:

- technical execution is reliable: jobs generally complete, JSON generally validates, exact quoted text is usually present, queues and leases work, and the databases are healthy;
- semantic evaluation is unreliable: Qwen repeatedly selects the wrong meaning, speaker, chronology, authority state, commitment state, follow-up state, objection outcome, procedural finding, and quality judgment;
- no active Qwen evaluator has passed an independent frozen promotion audit for its complete product decision;
- some unpromoted outputs are nevertheless described or consumed as authoritative, routed automatically, and used to create management action queues. That exceeds the demonstrated capability boundary.

The failure is therefore not primarily a service outage, concurrency issue, prompt-formatting issue, or JSON-schema issue. It is a model/task capability mismatch compounded by governance that tested infrastructure more rigorously than meaning.

The Qwen Spiel research family has reached a hard stop. V3 failed composite scoring, v4 failed multi-fact extraction, and v5 then failed three atomic fact lanes. V6 would be another same-model decomposition after narrow semantic failures, so it is stopped untested. Further Qwen decomposition is prohibited by `docs/LOCAL_MODEL_CAPABILITY_POLICY.md`.

## What Was Audited

The audit covered:

1. deterministic transcript evaluation;
2. legacy local-LLM transcript intelligence and its numeric quality score;
3. Call Intelligence Foundation v6;
4. Offer Acceptance v3;
5. Callback Opportunity v3;
6. Objection Handling v2;
7. Procedure Adherence v2;
8. Lead Record v4;
9. Spiel & Call Handling Quality v3;
10. Spiel fact-extraction v4;
11. Spiel atomic fact lanes v5;
12. the unexecuted Spiel candidate-span v6 design;
13. Evaluation Studio job submission, harvesting, validation, reconciliation, auto-routing, retries, and custom templates;
14. overnight and ad hoc automation;
15. Execution Layer routing, leases, admission, persistence, model identity, inference settings, and feedback;
16. downstream reporting, aggregate authority, and action-queue consumption.

Controlling human-labelled evidence is preserved in:

- `runtime/ALL_EVALUATORS_ACCURACY_AUDIT_2026-07-20.md`;
- `runtime/SPIEL_QUALITY_VALIDATION_2026-07-20.md`;
- the v4 and v5 frozen gate artifacts listed in `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`.

## Model And Runtime Identity

The Evaluation Studio route inspected was:

| Property | Observed value |
| --- | --- |
| Model key | `sales-dashboard-qwen3-30b-a3b-q4km` |
| Provider model | `hf.co/lmstudio-community/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M` |
| Local model digest | `20123c3f0bbbfb08e001830875dab0aa37da52c0ce55c0e89ecd9b79e335a5e7` |
| Architecture | Qwen3 mixture of experts |
| Size | 30.5B total parameters, approximately 3B active parameters per token under the A3B route |
| Quantisation | `Q4_K_M` |
| Runtime | Ollama native chat through the local Execution Layer |
| Thinking mode | disabled |
| Schema temperature | 0 |
| Maximum completion | at most 1,024 tokens |
| Explicit request context | not pinned |
| Seed | not pinned |
| `top_p` | not pinned |

The route is often referred to as “Qwen3 30B”, but it is not equivalent to a dense 30B model doing 30B-parameter inference per token. Its mixture-of-experts architecture and quantisation matter when setting expectations.

The catalogue advertises an 8,192-token context, while the installed model metadata advertises a much larger trained context. The application does not explicitly pin `num_ctx`, so the actual per-request context is not durably reproducible from the Sales Dashboard job record. Seven completed prompts exceeded 8,192 recorded prompt tokens: four Foundation, one Offer, and three Lead Record; Spiel had three above 8,192 and 21 above 7,000. This does not prove truncation, but it means the system cannot currently prove the runtime context used for a historical decision.

Jobs record the provider model tag but not the immutable local digest. If a mutable tag is replaced, a later replay can silently use different weights.

## Work Performed And Token Exposure

The Execution Layer database records the following Sales Dashboard work:

| Workload | Done | Failed | Prompt tokens | Completion tokens | Total tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Evaluation Studio on Qwen route | 4,489 | 11 | 17,056,767 | 1,645,388 | 18,702,155 |
| Legacy transcript intelligence, Qwen 8B | 150 | 3 | 450,983 | 142,812 | 593,795 |
| Legacy transcript intelligence, GPT-OSS 20B | 16 | 0 | 83,866 | 4,730 | 88,596 |
| Legacy transcript intelligence, Qwen route | 25 | 16 | 133,979 | 10,499 | 144,478 |
| Recorded total | 4,680 | 30 | 17,725,595 | 1,803,429 | 19,529,024 |

Evaluation Studio recorded nine retries. Across output attempts, 4,483 passed structural validation and 18 were invalid JSON. Those numbers demonstrate a functioning transport/structured-output path; they do not demonstrate decision accuracy.

The 4,489 Evaluation Studio completions and roughly 18.7 million associated tokens should be treated mainly as research and historical evidence. The infrastructure, transcripts, human labels, immutable manifests, and failure artifacts are reusable. The stored semantic classifications are not thereby validated for operations.

## Evaluator Accuracy Findings

The frozen independent audit used exactly 25 manager-labelled calls for the main evaluators and separate frozen gates for Spiel. The results below are exact decision agreement, not a subjective impression after the fact.

| Evaluator or capability | Frozen result | Verdict | Safe boundary now |
| --- | --- | --- | --- |
| Deterministic transcript evaluator | At least 9 material contradictions in 25 | Not a final evaluator | Literal terminal/direct signals only, with no speaker- or chronology-sensitive inference |
| Legacy LLM transcript intelligence | No frozen calibration; 0–100 quality score has no approved rubric | Retire or replace | Historical display only |
| Foundation: decision-maker status | 17/25 | Failed | Not authoritative |
| Foundation: offer presented | 24/25 | Restricted, unpromoted | Research-only literal signal |
| Foundation: price presented | 25/25 | Restricted, unpromoted | Research-only literal signal |
| Foundation: objection present | 16/25 | Failed | Not authoritative |
| Foundation: lead-record signal | 24/25 | Restricted, unpromoted | No record action |
| Foundation: efficiency status | 9/25 | Failed | No performance use |
| Offer Acceptance v3 | 18/25 | Failed, not promoted | No authoritative accepted-offer decision |
| Callback v3 state | 15/25 | Failed, not promoted | No callback workload decision |
| Callback state + channel + timing | 12/25 | Failed, not promoted | No scheduling decision |
| Objection Handling v2 | 10/25 | Failed, not promoted | No coaching or compliance decision |
| Procedure Adherence v2 | 7/21 assessable | Failed, not promoted | No coaching or compliance decision |
| Lead Record v4 on shared set | 23/25 | Restricted, not promoted | No correction, suppression, or invalidity action |
| Lead Record v4 reference primary | 17/25 | Failed product boundary | Literal findings only |
| Lead Record contradicted allegation | 3/8 allegation decisions; zero contradicted-allegation recall in the prior calibration | Failed safety case | No allegation conclusion |
| Spiel v3 | 3/10 complete decisions; 5/10 band pairs | Failed, not promoted | Historical research only |
| Spiel v4 multi-fact extraction | 4/20 contract-valid after trusted metadata was removed | Failed and retired | No Gate B |
| Spiel v5 third-party authority | 8/10 exact fact decisions | Failed atomic lane | Stopped |
| Spiel v5 wrong contact | 6/10 exact fact decisions | Failed atomic lane | Stopped |
| Spiel v5 permanently closed | 5/10 exact fact decisions | Failed atomic lane | Stopped |
| Spiel v6 candidate nomination | Not executed | Stopped untested | No Phase A continuation, freeze, or inference |

No complete active evaluator is promoted.

Qwen demonstrated some usefulness on narrow, explicit literal signals such as price mention and offer mention. That does not promote the surrounding evaluator, because the product decisions depend on chronology, speaker, negation, authority, conditions, and final state. A 24/25 or 25/25 subfield cannot safely authorize a downstream classification that failed its own frozen gate.

## Failure Pattern

The errors were not random formatting noise. They clustered in recurring semantic operations:

- resolving the final state after earlier provisional statements;
- distinguishing unconditional commitment from conditional interest;
- determining whether a customer, seller, third party, or administrative step controls authority;
- separating callback, email/referral, payment timing, long-term nurture, and no-next-step states;
- distinguishing a wrong contact from a correct business with the wrong role;
- distinguishing permanent closure from temporary closure, sale of the business, future closure, or poor trading;
- recognizing a contradicted allegation rather than merely spotting allegation language;
- deciding whether respectful persistence is acceptable or a handling failure;
- applying purpose and scope before producing separate Call Handling and Spiel bands;
- selecting evidence that is exact but actually relevant to the claimed fact.

These are precisely the semantics the product requires. They persisted when the prompt was narrowed from full evaluation to fact extraction and then to one atomic status plus pre-numbered spans. The failures therefore bound the product: Qwen should not own these decisions in this application.

## Process And Control Findings

### What Works Correctly

- All model traffic identified for this application is local and loopback-routed through the Execution Layer; transcript data is not sent to an external model service.
- SQLite integrity, WAL storage, queue leasing, claim guards, idempotency, bounded retries, worker ownership, admission checks, and restoration controls are technically sound.
- The frozen blind 25-call audit completed 98/98 service jobs with schema-valid service outputs. Sales Dashboard accepted 96 and rejected two semantically invalid results.
- Exact-quote validation catches fabrication and non-matching text.
- The current worker queue and running counts were zero at inspection time.
- Both automation controllers were halted on a specialist-recovery structural quality failure, so no evaluation spend was occurring at inspection time.
- Historical records and failed gates have generally been retained instead of deleted, which makes this investigation possible.

### What Does Not Work Correctly

1. **The automation quality gates are structural, not semantic.** The overnight controller checks completion, error percentages, counts, routes, exact excerpts, queue state, and database health. A fluent but wrong, schema-valid classification passes those gates.
2. **Foundation auto-routing defaults on.** A Foundation run can automatically create specialist jobs from Foundation fields that failed frozen semantic calibration. One incorrect model decision can therefore create more model work and operational state.
3. **The deterministic baseline is over-trusted.** It is speaker- and chronology-blind in important paths, yet it is supplied to Qwen and can override/reconcile final contact states and specialist routes. The frozen audit found at least nine contradictions in 25 calls.
4. **Unpromoted Offer output is called authoritative.** The Sales Opportunity Action Centre and call aggregate prefer Offer specialist results even though Offer v3 matched only 18/25 and was never promoted.
5. **Unpromoted outputs create operational queues.** At inspection, the action centre exposed queues including six accepted-offer administration checks, 211 clear-timing callbacks, 60 missing-timing callbacks, 149 information/review calls, 204 offers without a next step, 68 decision-maker/no-offer calls, 13 objection/procedure gaps, and 80 record reviews. These counts are useful research inventory, not trustworthy work instructions.
6. **Evidence presence is confused with evidence correctness.** Validators can prove that a quote occurs in the transcript. They generally cannot prove that it is the relevant quote, the controlling final statement, or evidence for the field. One stored callback result used a farewell—“Yep. Fantastic. You too. Bye-bye.”—as customer-intent evidence.
7. **Reconciled records can remain internally contradictory.** A stored Spiel record had `needs_improvement` bands and a payment breach while its narrative still said there were no material gaps.
8. **No semantic feedback loop reaches the Execution Layer.** Its `job_feedback` table contains no Sales Dashboard feedback even after multiple frozen audits. The service therefore has no machine-readable record that structurally valid outputs failed semantic review.
9. **Inference is not fully reproducible.** The immutable model digest, `num_ctx`, seed, and `top_p` are not pinned and stored per job.
10. **There is no globally enforced capability register.** Active template status and strict schema are currently enough to submit work. Promotion status is not enforced at both the submission boundary and every downstream consumption boundary.
11. **Custom templates can bypass semantic promotion.** A valid schema can be submitted without an independently demonstrated task capability.
12. **Legacy intelligence remains callable.** It truncates transcripts to 8,000 characters and emits an uncalibrated numeric salesperson-quality score. It has no approved frozen semantic gate.
13. **The generic call-page local-AI action appears misconfigured.** It defaults to `sales_transcript_evaluation`, but the Sales Dashboard project has no current task access or route for that task. The available routes are Evaluation Studio and legacy transcript intelligence. It is a dead or broken path, not a validated evaluator.
14. **Tests prove software behavior, not model judgment.** The 322-test suite is valuable, but most tests use fixtures/mocks and validate schema, reconciliation, authorization, persistence, and promotion mechanics. A green suite cannot promote semantic accuracy.
15. **The scheduled task is still enabled.** The controllers are currently halted, but that accidental halt is not an explicit semantic quarantine and can be cleared by a future operator who follows the old handover instructions.

## Live State At The End Of Inspection

- Dashboard health endpoint: healthy with the current import loaded.
- Execution Layer: reachable on port 8080 with one protected worker.
- Sales Dashboard queue/running: 0/0.
- Overnight controller: `halted_on_specialist_recovery_quality_failure`.
- Ad hoc controller: `halted_on_specialist_recovery_quality_failure`.
- Windows task `Sales Dashboard Overnight Evaluations`: enabled and Ready.
- Loaded model observed during one inspection: a Qwen 8B instance associated with another local process; it was not attributed to Sales Dashboard and is not evidence of a Sales Dashboard conflict.
- No Qwen30 evaluation batch was submitted by this audit.

## Safe And Unsafe Uses

### Safe now

- historical display clearly labelled unpromoted/research-only;
- infrastructure and schema testing with mocks or pre-existing outputs;
- deterministic literal terminal signals with their known scope stated;
- human-authored frozen labels and evidence sets;
- research analysis that cannot create routes, work queues, scores, rankings, or record changes;
- a future model comparison performed only after a new frozen protocol and explicit budget approval.

### Unsafe now

- calling any active Qwen evaluator authoritative;
- using Qwen results to route another evaluator automatically;
- accepted-offer, callback, objection, procedure, record-validity, Spiel, handling, efficiency, or opportunity decisions;
- action queues, ranking, coaching, compliance, discipline, financial action, lead removal, CRM action, or performance denominators based on unpromoted results;
- completing the remaining Foundation/specialist backlog merely because the worker and schemas function;
- another Qwen Spiel prompt, decomposition, candidate-span gate, or successor version;
- interpreting “supported” as “the model is probably right.” A capability is supported only after it passes the exact frozen unseen gate for the exact product use.

## Required Remediation

### P0 — quarantine before any more inference

1. Enforce `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json` at job submission. Unpromoted and stopped capabilities must be rejected, including auto-routes, scheduled batches, manual batches, tests against live inference, and custom templates.
2. Enforce the same register at consumption. Unpromoted results must be visibly `research_only`, never `authoritative`, and must not create routes, queues, denominators, rankings, coaching, record review, or commercial actions.
3. Disable automatic Foundation/specialist scale-out until each exact consumed capability is separately promoted. Do not simply clear the current controller halt.
4. Stop Spiel v6 Phase A and every further Qwen Spiel experiment. Preserve its files as unexecuted research history.
5. Retire or hide the legacy transcript-intelligence numeric evaluator and the unrouteable generic call-page AI action.

### P1 — make future evaluation evidence real

6. Require a frozen unseen canary before any batch, with manager-confirmed labels, exact evidence, immutable transcript hashes, model digest, prompt/schema hashes, inference settings, and a predeclared token/attempt budget.
7. Replace structural “quality gates” with semantic gates. A batch may pass only when a predeclared unseen sample matches frozen human truth at the required threshold; JSON and quote presence remain separate diagnostics.
8. Send audit verdicts to the Execution Layer feedback store, including exact expected and actual decisions, evidence relevance, failure type, and promotion outcome.
9. Pin and persist model digest, `num_ctx`, seed, sampling settings, runtime version, prompt hash, schema hash, and complete-input hash for every job.
10. Keep all existing results immutable but mark their capability status at render time. Do not silently relabel historical research as promoted.

### P2 — choose a product boundary the model can satisfy

11. For composite call judgments, evaluate a materially stronger model on a small frozen holdout before integrating it. Model selection must follow evidence, not nominal parameter count.
12. If no local model passes, make the product deterministic-plus-human or exclude the decision. Do not create progressively narrower Qwen prompts to simulate progress.
13. Use Qwen only where a separately promoted capability shows it can add value. The present evidence does not support Qwen-owned semantic span selection for these evaluator families.

## Stop And Reopening Rule

Decomposition is not automatically progress. Once a local model fails an atomic or otherwise narrow unseen semantic gate, further same-model decomposition is evidence that the product boundary is wrong, not permission to spend more tokens.

A stopped evaluator family may reopen only when:

- a materially different model is identified by a different immutable digest; or
- the model is removed from semantic ownership entirely;
- a new frozen hypothesis and product use are stated;
- manager-confirmed unseen labels and evidence exist;
- the exact accuracy, evidence, coverage, and critical-error thresholds are frozen;
- the maximum jobs, attempts, retries, and tokens are frozen; and
- the manager explicitly authorises that one bounded test.

## Final Assessment

Qwen is not “broken” in the sense of a malfunctioning service. It is producing the kind of structured responses the system requests. The failure is that the application asks those responses to carry semantic authority the frozen audits do not support.

The work was not all wasted: the execution infrastructure, safe local routing, persistence, labelled calls, exact evidence corpora, frozen manifests, and audit artifacts are valuable. But continuing to populate the dashboard with the same model would convert research evidence into false confidence. The correct next move is quarantine and boundary enforcement, followed—only if desired—by a small comparison against a materially stronger model.

## Verification

- No model job was submitted by this audit.
- `node --test tests/*.test.js`: 322/322 passed on the final run. An earlier run had one transient live-SQLite lock in a frozen-audit test; that test passed immediately in isolation and the complete rerun passed.
- `PRAGMA integrity_check` returned `ok` for `data/store/evaluation-studio.sqlite`.
- `PRAGMA integrity_check` returned `ok` for the adjacent Execution Layer `runtime/ai_execution_layer.db`.
- Both machine-readable JSON documents parsed successfully.
- `git diff --check` found no whitespace errors.
- Final live check: dashboard healthy; Evaluation Studio worker active; queue depth 0; running jobs 0; both controllers halted; Windows scheduled task enabled and Ready.
