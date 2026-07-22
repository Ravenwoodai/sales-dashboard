# Plans

## Active Plan

### Trusted Local Product Boundary

- Goal: keep Sales Dashboard useful without exposing any decision that the current Qwen model cannot make accurately.
- Active surface: source facts, exact stable-ID relationships, conservative literal transcript states, transcript proof, and manager-authored review overlays.
- Model state: 20 audited capabilities, zero promoted. Submission and operational consumption are closed.
- Required invariant: an unknown semantic state stays unknown; technical completion never upgrades it into a business fact.
- Status: implemented and verified on 2026-07-22. Preserve this boundary in future changes.

## Completed Remediation

### Evaluation Trust And Validation Studio

- Added a read-only capability catalog showing exact scope, model/provenance, status, authority, exclusions, controlling evidence, failure reason, and permitted next action for all 20 registered capabilities.
- Added an isolated benchmark Validation Lab with repository/runtime/result/run/manifest prior-use exclusion, genuinely-unseen manifests, direct-quote human labelling in batches of at most five, immutable freezes, predeclared thresholds/budgets/stop rules, exact candidate result-set checks, and frozen-evidence comparisons.
- Kept the entire historical knowledge/template/run/result archive immutable and visibly separated from benchmark truth.
- Added a strict promotion framework: the promotion partition requires at least 100 frozen calls with positive, hard-negative, and unsupported coverage; passing only creates an external-approval candidate and never promotes automatically.
- Added a deterministic voicemail and inbound-evidence lane covering exact voicemail prompts, literal callback requests, exact approved-template use, stable-ID chronology, later inbound relationships, and observed source-salesperson handling. Commercial and causal conclusions remain unknown.
- Verified the current 19,914-call import has 1,972 exact voicemail encounters, 22 transcript-verifiable callback requests, no exact approved-template message, 135 later-inbound relationships, and 113 clean chronology links with no intervening matching outbound attempt.

### Capability Control

- Added a machine-readable capability register and fail-closed policy enforcement.
- Bound every Sales Dashboard model submission/consumption path to the current register.
- Blocked direct transcript evaluation, Evaluation Studio result ingestion, run creation, prompt testing, run resume, result harvest, automatic routing, automatic polling, overnight execution, and ad-hoc execution.
- Historical job/result APIs return research-only state with authority `none`.

### Active-State Quarantine

- Quarantined 167 queued model jobs and five queued Evaluation Studio runs without deleting history.
- Confirmed zero queued/running Sales Dashboard model work afterward.
- Verified the `Sales Dashboard Overnight Evaluations` scheduled task is present but disabled.
- Left the separate Execution Layer untouched because it may serve another project; Sales Dashboard is disconnected from it.

### Deterministic Boundary

- Replaced semantic transcript decisions with exact literal detections only.
- Set human-contact, meaningful/actionable conversation, decision-maker, sentiment, next-step, valid-no-sale, quality scores, and confidence fields to null/unknown.
- Limited literal outcomes to recognised no-answer, machine/carrier voicemail or system audio, direct Customer wrong number, and direct Customer opt-out.
- Kept literal AI-assistant phrase detection as descriptive evidence only.
- Restricted reattempt reporting to source/stable-ID facts without claiming contact, lead quality, or follow-up completion.

### Product And UI

- Reduced the dashboard to six understandable workspaces: Overview, Opportunities, Follow-Up, Alerts & Reviews, Intelligence, and Records & Reports.
- Made Opportunities unavailable until a relevant capability is promoted.
- Retired Lead Harvest and hidden semantic team-performance panels.
- Rebuilt Evaluation Studio as a controlled validation laboratory while keeping the historical research archive read-only and exposing no model-run controls.
- Locked every Evaluation Studio mutation path, including research metadata edits and result-to-review/feedback handoff.
- Kept transcript proof and manager-authored review available on call pages.

### Verification

- Audited the active 19,914-call SQLite dataset: every call has `llm_status=not_requested`; all audited semantic fields are null.
- Audited Evaluation Studio and job state: no active runs and no unresolved jobs.
- Added `npm run audit:trusted-boundary` to make the capability, database, active-job, and active-run invariants repeatable.
- Proved blocked write requests leave stored run/result/job counts unchanged.
- Verified the scheduled task is disabled and cannot execute; controller capability preflight remains a second fail-closed boundary.
- Browser-checked every workspace, Evaluation Studio, and a call proof page; no operational model controls or hidden semantic quality metrics were present and no console warnings/errors occurred.

## Conditional Future Plan

### New Evaluator Research

Do not start this plan merely because semantic automation would be convenient.

It may begin only when all conditions are met:

1. The candidate is a materially different model or a genuinely deterministic rule, not another Qwen decomposition.
2. The exact facts and excluded calls are written before inference.
3. Human expected labels and evidence are frozen on genuinely unseen calls.
4. Minimum evidence and critical-error thresholds are predeclared per fact.
5. Technical success and semantic promotion are scored separately.
6. Failure of an atomic unseen semantic gate stops that evaluator family.
7. Operational use receives separate explicit approval after promotion.

Until then, improve source-record reporting, literal evidence, manager review usability, browser accessibility, and local performance without introducing semantic claims.
