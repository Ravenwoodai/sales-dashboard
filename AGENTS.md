# AGENTS
This is the entry map for coding agents working in Sales Dashboard.
Use this file as the table of contents, then load deeper docs only as needed.

## Startup Order
1. /AI_SYSTEM.md
2. /docs/PROJECT.md
3. /docs/PROJECT_CONTEXT.md
4. /docs/AGENT_CONTEXT.md
5. /docs/ARCHITECTURE.md
6. /docs/SYSTEM_MAP.md
7. /docs/UI_DESIGN_STANDARD.md
8. /docs/PLANS.md
9. /docs/QUALITY_SCORE.md
10. /docs/CONSTRAINTS.md
11. /SECURITY.md
12. /agent/INSTRUCTIONS.md
13. /runtime/AUTONOMOUS_BACKLOG.md

## Source Of Truth
- Product intent: /docs/PROJECT.md and /docs/SPEC.md
- Portable project summary: /docs/PROJECT_CONTEXT.md and /docs/PROJECT_CONTEXT.json
- Fast handoff: /docs/AGENT_CONTEXT.md
- Architecture and ownership: /docs/ARCHITECTURE.md and /docs/SYSTEM_MAP.md
- Default UI style: /docs/UI_DESIGN_STANDARD.md
- Plans and quality: /docs/PLANS.md and /docs/QUALITY_SCORE.md
- Constraints and safety: /docs/CONSTRAINTS.md and /SECURITY.md
- Decision history and direction: /docs/DECISIONS.md and /docs/ROADMAP.md
- Live execution state: /runtime/AUTONOMOUS_BACKLOG.md, /runtime/RUN_LOG.md, /runtime/SESSION_HANDOVER.md, and /runtime/BLOCKERS.md

## Working Rules
- Prefer the smallest effective change.
- Keep repo-local docs ahead of chat-only context.
- Update plans, quality notes, and runtime state when behavior changes.
- Escalate to humans only when judgment or external intent is required.

## Codex model selection and escalation
- Default development setting: **GPT-5.6 Terra** with **Medium** reasoning.
- Downgrade to **GPT-5.6 Luna** with **Low** reasoning only for bounded, objectively validated work: documentation, fixtures, mechanical tests, report formatting, read-only inventories, or straightforward extraction, classification, and transformation.
- Escalate to **GPT-5.6 Sol** with **High** reasoning when task consequences or difficulty warrant it, not merely because a named file or subsystem is touched. Terra Medium remains suitable for a narrow, well-specified, reversible, strongly validated change in a sensitive area.
- Recommend Sol High for material changes or reviews involving scheduler/worker/runtime startup; dispatch, queues, retries, timeouts, locking, concurrency, idempotency, or recovery; Carma or strict ABN/ABR matching; schema, migrations, or data integrity; Buyer API auth/privacy/security; production LLM routing/fallbacks; paid-search bid/budget/yield policy; autonomous-lane decisions; financial, pricing, margin, or revenue logic; rollback, kill-switch, approval, or audit controls; ambiguous cross-cutting architecture; weakly tested high-blast-radius changes; or difficult multi-subsystem incidents.
- Before a high-risk write, pause for confirmation when the current model is known to be below the recommendation and the change could materially affect security, financial decisions, autonomous action, data integrity, or production availability. Display:

  ```text
  MODEL ESCALATION RECOMMENDED
  Current setting: <known setting or unknown>
  Recommended setting: GPT-5.6 Sol with high reasoning
  Reason: <specific task and repository risk>
  Risk of continuing: <specific possible failure>
  Next action: switch the parent task or delegate a Sol review
  ```

- Never claim the active parent model changed unless Codex explicitly confirms it. A Sol reviewer may be delegated automatically for read-only review but must never make application changes. Do not interrupt routine work solely because a stronger model exists.
- Keep production application model routing separate from development-time Codex selection.

## Objective
Keep the repository legible, enforceable, and easy for future agent runs to continue.
