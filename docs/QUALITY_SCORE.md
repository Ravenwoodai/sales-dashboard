# Quality Score

This score describes the current trusted product, not the amount of historical evaluator code or the technical health of the model service.

| Area | Score | Current evidence | Next step |
| --- | ---: | --- | --- |
| Product clarity | 5/5 | Six focused workspaces; unsupported automation is visibly unavailable; Studio now separates capability truth, deterministic evidence, benchmark validation, and immutable historical research. | Keep the authority legend and archive boundary explicit. |
| Data integrity | 5/5 | Active 19,914-call SQLite import and optional 930-order Carma evidence contract pass integrity checks; the locked lead-source policy has zero classification violations, and Carma has zero foreign-key issues, source/campaign violations or phone-named columns; the shared Carma catalog hashes and inventories the complete approved-sales-history extract and weekly raw allocation files; all call semantic columns remain null. | Refresh the Carma catalog and re-run integrity/classification/cohort checks after source or schema changes. |
| Model governance | 5/5 | Register has 20 capabilities and zero promoted; submissions and operational consumption fail closed; the UI exposes scope/provenance/failure evidence; isolated frozen benchmarks cannot self-promote. | Require external approval after any future strict promotion pass. |
| Semantic automation | 1/5 | No current Qwen evaluator is accurate enough for authority. This is correctly exposed as unavailable rather than disguised as confidence. | Use a materially different candidate or keep the product deterministic. |
| Verification | 5/5 | Full automated suite, allocation-policy unit/regression tests, Carma builder/verifier, exact-ID cohort reconciliation, workbook formula/visual QA, API health, SQLite audits, adversarial mutation checks, controller fail-closed checks, isolated Validation Lab tests, and browser checks cover the current boundary. | Maintain source hashes, exact-ID rules, locked classification, source/campaign separation and no-model-request checks when sources change. |
| Runtime operability | 4/5 | Dashboard is healthy with AI disabled; zero active model work; archive remains readable. Evaluation Studio archive reads are slower than ordinary pages. | Add direct paginated archive SQL reads only if measured latency warrants it. |
| Security/privacy | 4/5 | Local-only app, excluded phone/legacy fields, escaped transcript display, no external AI route. | Add authentication before any non-local or multi-user deployment. |

## Semantic Accuracy Findings

- The local service, queue, schemas, leases, and persistence function technically. That does not establish evaluation accuracy.
- No complete active Qwen evaluator passed an independent frozen semantic promotion audit.
- Offer Acceptance reached 18/25 exact frozen agreement; Callback state 15/25; Objection 10/25; Procedure 7/21; Foundation fields were mixed, including 9/25 for efficiency.
- Spiel v3 produced 3/10 complete decisions on its last unseen set. V4 produced only 4/20 contract-valid extractions. Atomic v5 gates reached 8/10 for `third_party_authority`, 6/10 for `wrong_contact`, and 5/10 for `business_permanently_closed`.
- V6 was stopped untested. Repeated failure on narrower facts is evidence that the model/product boundary is wrong, not a reason to spend more tokens.

## Current Trusted Claims

- Source/import facts and exact stable-ID relationships.
- Exact recognised no-answer wording.
- Machine/carrier voicemail and system-audio wording.
- Direct Customer wrong-number statements.
- Direct Customer opt-out statements.
- Literal AI-assistant phrases, labelled only as literal detection.
- Explicit manager-authored review overlays.
- Closed deterministic voicemail/message/linkage observations with exact evidence; these are not callback-causation or commercial claims.
- Optional pilot facts that pass the separate source contract: preassignment, explicit event/call linkage, source handler, CRM sale state/timestamp and separate-currency gross profit. Invalid measures are `not_scored`, and treatment/control lift requires complete equal-duration windows.

All other semantic call attributes remain unknown unless a manager records them.

## Current Risks

- Literal rules are conservative and can miss paraphrases. That creates unknowns, not false certainty.
- Historical evaluator names, templates, and results remain in the research archive and repository. A reader can still misunderstand them if the research-only warning is removed.
- Manager review uses the local placeholder actor `local_manager`; it is not authenticated multi-user governance.
- Transcript speaker order depends on source data and is not independently diarised.
- Stable-ID later-attempt evidence is bounded by the uploaded date window and cannot prove callback completion.
- A pilot export can still contain inaccurate upstream source records. The application validates internal consistency and provenance fields; it does not independently prove that the telephony/CRM source system recorded reality correctly or that arm assignment was randomized.
- Allocation artifacts and unsafe historical reports remain preserved for audit; active APIs and UI must continue filtering them.
- The separate AI Execution Layer may run independently, but its health or availability must never reopen Sales Dashboard submission.
- A benchmark may still be too small or unbalanced to support promotion; smoke/development results must never be presented as authority.

## Release Rule

A release is acceptable only when:

- the capability register validates and contains no accidentally promoted capability;
- model submission and operational consumption remain fail closed;
- active semantic database columns remain null unless explicitly manager-authored;
- scheduled/ad-hoc controllers cannot make a model network request;
- blocked write endpoints do not mutate jobs, runs, or results;
- the full tests, SQLite integrity checks, browser checks, and `git diff --check` pass.
