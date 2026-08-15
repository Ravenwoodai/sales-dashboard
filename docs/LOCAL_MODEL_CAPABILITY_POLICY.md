# Local Model Capability Policy

This policy governs every Sales Dashboard workflow that uses a local language model, whether the model supplies a final decision, an intermediate fact, an evidence span, a summary, or a route recommendation.

## Core Rule

Local-model capability is never assumed from model size, valid JSON, exact-quote matching, plausible explanations, passing software tests, or successful job completion. The exact capability required by the product must be demonstrated on frozen, genuinely unseen examples before implementation is treated as successful or the output is used operationally.

Decomposition is not automatically progress. If the local model continues making semantic mistakes on narrow facts, further decomposition is evidence that the product boundary is wrong, not justification to keep spending tokens.

## Separate Technical And Semantic Success

Every audit must report these independently:

1. Transport and service completion.
2. Output-schema validity.
3. Exact evidence presence and speaker attribution.
4. Semantic evidence relevance.
5. Exact decision accuracy.
6. Critical-error count.
7. Supported-call coverage.
8. Permitted operational use.

Success in an earlier layer never proves success in a later layer. In particular, schema-valid JSON and verbatim evidence do not establish that the evidence supports the claimed decision.

## Mandatory Pre-Inference Record

Before any capability gate uses model tokens, its frozen record must state:

- one exact capability and product use;
- the exact model key, provider identifier, immutable model digest when available, quantisation, prompt hash, schema hash, and inference settings;
- a genuinely unseen manifest and proof of prior-use exclusions;
- manager-confirmed expected labels with exact evidence;
- minimum decision accuracy, evidence integrity, coverage, and critical-safety thresholds;
- the maximum number of jobs, attempts, retries, and tokens;
- the stopping condition and whether one mechanical repair is allowed.

Thresholds cannot be weakened after outputs are seen. Failed or consumed calls cannot be relabelled as unseen.

## Hard Stop Rules

The following rules are mandatory:

1. A semantic failure rejects the tested capability. A semantically incorrect but schema-valid result is not a near pass.
2. A transport or formatting defect may receive at most one bounded repair only when the capability, prompt meaning, labels, and unseen set remain unchanged. If model inference occurred, the set is consumed.
3. After an atomic or otherwise narrow factual capability fails an unseen semantic gate, no further same-model decomposition, prompt variant, successor version, or adjacent fact lane may be used to rescue that evaluator family.
4. Two consecutive semantic gate failures at the same or narrowing level are an unconditional family-level stop, even if neither failure is individually catastrophic.
5. Any critical false positive or critical safeguard miss stops the applicable operational use immediately.
6. A stopped family can reopen only for a materially different model identified by a new immutable digest, or for a product design in which the model no longer owns a semantic decision. Reopening requires a new frozen hypothesis, budget, unseen set, and explicit manager authorisation.
7. Human review cannot be used to rescue unsupported model decisions or inflate model coverage. Unsupported outputs are excluded or `not_scored` according to the product contract.

The current Qwen Spiel family reached the hard stop. V3, v4, v5, and v6 are retained as failed or unpromoted research evidence. No further Qwen Spiel decomposition or inference is permitted.

## Promotion And Production Rules

- Every capability starts as `untested` or `research_only`.
- Only a frozen, independently passing capability may be marked `promoted`.
- Promotion is scoped to the exact fact, model digest, prompt/schema version, supported population, and product use tested.
- A promoted fact does not promote a composite evaluator, downstream rule, automatic route, ranking, queue, or report.
- Unpromoted output must not be labelled authoritative, drive automatic routing, create operational workload, affect a denominator, or appear in performance, coaching, compliance, disciplinary, financial, lead-removal, or CRM decisions.
- Software tests verify implementation behavior. They do not promote semantic model capability.
- The application pins and validates the current register for the process lifetime. A missing, malformed, changed, unknown, or unpromoted capability fails closed; register changes require an application restart.
- Submission permission and operational-consumption permission are separate. Neither may be inferred from the other.
- Historical records remain immutable research artifacts with authority `none`; quarantine must preserve rather than delete them.

## Current Enforcement State

As of 2026-07-22, all 20 registered capabilities are unpromoted. Live submission and operational consumption are disabled end to end. Evaluation Studio is a controlled validation laboratory whose historical research archive remains read-only; active semantic projections are null, model-backed operational routes are unavailable, queued work is quarantined, and the scheduled evaluation task is present but disabled. Validation Lab writes are human benchmark records only and cannot grant model authority.

## Durable Evidence And Review

The current machine-readable capability register is stored under `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`. Each audit must update or supersede that register and link its evidence. `AGENTS.md`, `docs/DECISIONS.md`, `docs/QUALITY_SCORE.md`, the autonomous backlog, run log, and session handover must remain consistent with any stop or promotion decision.

No future agent may infer that a documented implementation, active template, completed batch, or passing test means the local model is accurate.
