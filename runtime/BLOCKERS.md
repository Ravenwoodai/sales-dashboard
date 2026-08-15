# Blockers

## Active Blocker: Semantic Automation

- Date: 2026-07-22
- Task: Any automated semantic call evaluation or model-backed operational action.
- Blocker: No audited Qwen capability is semantically promoted. The current register contains 20 capabilities and zero promoted capabilities.
- Evidence: `runtime/LOCAL_MODEL_COMPREHENSIVE_AUDIT_2026-07-22.md` and `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`.
- Required next step: None for normal product operation. Keep the active product deterministic/literal. Reopen research only for a materially different candidate or a genuinely deterministic rule under a new frozen unseen promotion program.
- Prepared boundary: the isolated Validation Lab can create and freeze genuinely unseen human-labelled benchmarks, but this does not remove the blocker, authorise inference, or promote a capability.

## Cleared Runtime Blockers

- The former port-8080/SQLite-lock incident is not a Sales Dashboard blocker. A separate Execution Layer may be degraded or running for another project, but Sales Dashboard is intentionally disconnected and AI-disabled.
- The old overnight/ad-hoc quality halts are no longer accidental safety controls. Capability enforcement now rejects before network access.
- The Windows task `Sales Dashboard Overnight Evaluations` is present but disabled. Its trigger is retained for audit and must not be enabled while capabilities remain unpromoted.
- Queued Sales Dashboard model work is quarantined; active job/run count is zero.

Do not "fix" these cleared items by restarting inference, reinstalling the task, clearing quarantine, or submitting a smoke-test job.
