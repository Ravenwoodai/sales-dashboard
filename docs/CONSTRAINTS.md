# Constraints
This file records practical constraints for Sales Dashboard.

## Product Constraints
- Keep the first milestone narrow and testable.
- Avoid undocumented scope growth.
- Expose only source facts, exact stable-ID relationships, closed literal transcript detections, and explicit manager overlays.
- Unknown semantic states must remain unknown; missing automation is not permission to infer.
- Do not present historical model output as current intelligence, opportunity, quality, coaching, compliance, or lead action.

## Technical Constraints
- Primary stack: Node.js
- Primary runtime: web
- Primary artifact: src/main.js
- Prefer stable, well-understood libraries before adding complexity.

## Process Constraints
- Work should follow the backlog-driven loop.
- Meaningful changes should update plans, quality notes, and runtime state.
- Architectural changes must be captured in docs/DECISIONS.md.
- Local-model work must follow `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` and the current machine-readable capability register. Technical completion is not semantic promotion.
- Decomposition is not automatically progress. After an atomic or otherwise narrow unseen semantic failure, do not spend more tokens on a same-model prompt variant, decomposition, successor evaluator, or adjacent fact lane.
- A model submission or operational result consumption requires an explicitly promoted exact capability. Missing/malformed/stale/unpromoted register state fails closed.
- Historical research may be preserved and inspected, but it cannot mutate active state or supply an operational denominator.
- Benchmark human labels are calibration truth only. They must stay in the isolated validation-lab store, use exact transcript evidence, arrive in batches of at most five, and never enter routine manager-review queues.
- A promotion test requires at least 100 frozen, genuinely unseen, case-balanced calls with unchanged source hashes, predeclared thresholds, resource budgets, and stop rules. A passing report means eligible for external approval, never automatically promoted.
- Ten-call smoke and fifty-call development partitions may reveal failure, but cannot establish promotion.
- Deterministic voicemail/inbound reporting may state exact prompts, literal message wording, stable-ID chronology, later inbound relationships, and observed handling only. It must not infer callback causation, receptiveness, conversion, sale, revenue, profit, or ROI.

## Safety Constraints
- Do not commit secrets.
- Validate destructive filesystem or shell actions carefully.
- Keep recovery guidance current when runtime or storage assumptions change.
- Do not enable or reinstall scheduled/ad-hoc model execution while the capability register has zero promoted capabilities.
- Do not stop or mutate a separately running AI Execution Layer merely because Sales Dashboard is disconnected from it; it may serve another project.
