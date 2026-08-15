# Codex Model Review

Date: 2026-07-22

This document concerns development-time Codex selection. Production/local evaluator capability is a separate question controlled by `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` and the capability register.

## Development-Time Default

- Default: GPT-5.6 Terra with medium reasoning.
- Use GPT-5.6 Luna with low reasoning for bounded, repetitive, objectively validated documentation, fixtures, formatting, or mechanical transformations.
- Use GPT-5.6 Sol with high reasoning for high-blast-radius architecture, scheduler/worker/runtime, queues/retries/locking, schema/data integrity, local-model routing, security/privacy, financial/commercial logic, rollback/kill-switch, or difficult cross-subsystem incidents.

The repository `AGENTS.md` contains the authoritative escalation rules.

## Current Production-Model Decision

No local model is approved for Sales Dashboard operational evaluation.

- The Qwen service and queue were technically functional.
- No complete active Qwen evaluator passed its independent frozen semantic audit.
- The current register contains 20 capabilities and zero promoted capabilities.
- Sales Dashboard must not submit, route, poll for operational use, ingest, rank, coach, or act on local-model output.
- Historical Qwen output is research-only with authority `none`.

This replaces the older idea of routing different evaluation tasks to fast/balanced/strong local models. There is no evidence-backed production evaluator tier to route to today.

## Task Matrix

| Task | Development setting | Reason |
| --- | --- | --- |
| Documentation/copy/fixtures with objective checks | Luna low or Terra low | Bounded and reversible |
| Ordinary implementation/debugging/tests | Terra medium | Best normal speed/reliability balance |
| Filters, denominators, reports, UI semantics | Terra high when cross-cutting | Incorrect wording or counts can mislead managers |
| Capability register, AI routes, Evaluation Studio boundaries | Sol high | Production model governance and data-state risk |
| SQLite schema/migration/recovery/concurrency | Sol high | Data-integrity risk |
| Scheduler/worker/queue/retry/lock changes | Sol high | Runtime and autonomous-action risk |
| Security/privacy or non-local exposure | Sol high | Sensitive transcript/customer data |
| Sales/revenue/pricing/ROI/discipline automation | Sol high or do not implement without explicit product approval | High-impact unsupported decision space |

## Persistent Recommendation

```text
Default: GPT-5.6 Terra, medium reasoning
Escalation: GPT-5.6 Sol, high reasoning
Mechanical downgrade: GPT-5.6 Luna, low reasoning
```

Do not infer that a stronger development-time Codex model changes the capability of the production Qwen model. A Sol code review can improve safeguards; it cannot promote an evaluator without valid unseen semantic evidence.
