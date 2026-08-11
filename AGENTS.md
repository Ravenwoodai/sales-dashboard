# AGENTS
This is the entry map for coding agents working in Sales Dashboard.
Use this file as the table of contents, then load deeper docs only as needed.

## Startup Order
1. /AI_SYSTEM.md
2. /docs/CARMA_DATA_LAYER.md
3. /docs/PROJECT.md
4. /docs/PROJECT_CONTEXT.md
5. /docs/AGENT_CONTEXT.md
6. /docs/ARCHITECTURE.md
7. /docs/SYSTEM_MAP.md
8. /docs/UI_DESIGN_STANDARD.md
9. /docs/PLANS.md
10. /docs/QUALITY_SCORE.md
11. /docs/CONSTRAINTS.md
12. /SECURITY.md
13. /agent/INSTRUCTIONS.md
14. /runtime/AUTONOMOUS_BACKLOG.md

## Mandatory Data-Catalog Preflight
- For every task that uses, searches for, compares, validates, reports on, refreshes, downloads, or extracts data, the first data-discovery action must be to inspect `data/carma/catalog.json` and read the matching entry's authority, coverage, source path, hashes, availability and limitations.
- If the catalog is missing, its configured source is newer than the catalog, or the requested dataset/period is not clearly represented, run `npm run carma:refresh-data-layer` and inspect the refreshed catalog before searching elsewhere.
- Do not claim that data is missing, unavailable, incomplete or not previously extracted until the catalog and the source/manifest named by the relevant catalog entry have both been checked.
- Do not start or recommend a new Carma extraction, download or backfill when the catalog already points to adequate governed data. Reuse the catalogued source and preserve its authority and limitations.
- Before using a catalogued dataset, state a brief catalog receipt in the work record or user update: catalog key, coverage inspected, selected source and any limitation that affects the answer. A silent catalog check is insufficient for consequential reporting.
- If the catalog conflicts with a file or report, stop and reconcile freshness, hashes and coverage. Never choose the apparently convenient source without resolving the conflict.
- This preflight is mandatory even when a familiar path, prior report, chat history or remembered extract appears to answer the request. Memory and directory searches do not replace the catalog.

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
- Local data discovery and availability: /data/carma/catalog.json, governed by /docs/CARMA_DATA_LAYER.md

## Working Rules
- Prefer the smallest effective change.
- Keep repo-local docs ahead of chat-only context.
- Update plans, quality notes, and runtime state when behavior changes.
- Escalate to humans only when judgment or external intent is required.

## Local Model Capability Stop Rule
- Read `/docs/LOCAL_MODEL_CAPABILITY_POLICY.md` before designing, running, promoting, routing, or operationally consuming any local-model output.
- Decomposition is not automatically progress. Once the local model fails an atomic or otherwise narrow unseen semantic gate, do not create another same-model decomposition, prompt version, successor evaluator, or adjacent fact lane to rescue that evaluator family.
- Treat valid JSON, exact quotes, completed jobs, passing tests, and plausible explanations as technical evidence only. They do not prove semantic accuracy.
- The current Qwen Spiel family has reached the hard stop. V3-v6 are failed, unpromoted, or stopped research artifacts; do not spend more Qwen tokens on that family.
- Consult the current `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_*.json` before relying on any local-model capability. Unpromoted output must not be called authoritative or drive routes, queues, denominators, rankings, coaching, compliance, discipline, finance, lead actions, or CRM decisions.

## Codex model selection and escalation
- Default development setting: **GPT-5.6 Terra** with **Medium** reasoning.
- Downgrade to **GPT-5.6 Luna** with **Low** reasoning only for bounded, objectively validated work: documentation, fixtures, mechanical tests, report formatting, read-only inventories, or straightforward extraction, classification, and transformation.
- Escalate to **GPT-5.6 Sol** with **High** reasoning when task consequences or difficulty warrant it, not merely because a named file or subsystem is touched. Terra Medium remains suitable for a narrow, well-specified, reversible, strongly validated change in a sensitive area.
- Recommend Sol High for material changes or reviews involving scheduler/worker/runtime startup; dispatch, queues, retries, timeouts, locking, concurrency, idempotency, or recovery; Carma or strict ABN/ABR matching; schema, migrations, or data integrity; Buyer API auth/privacy/security; production LLM routing/fallbacks; paid-search bid/budget/yield policy; autonomous-lane decisions; financial, pricing, margin, or revenue logic; rollback, kill-switch, approval, or audit controls; ambiguous cross-cutting architecture; weakly tested high-blast-radius changes; or difficult multi-subsystem incidents.
- Before a high-risk write, pause for confirmation when the active model is unknown or known to be below the recommendation and the change could materially affect security, financial decisions, autonomous action, data integrity, or production availability. Unknown active state is not permission to infer compliance. Display:

  ```text
  MODEL ESCALATION RECOMMENDED
  Current setting: <known setting or unknown>
  Recommended setting: GPT-5.6 Sol with high reasoning
  Reason: <specific task and repository risk>
  Risk of continuing: <specific possible failure>
  Next action: switch the parent task or delegate a Sol review
  ```

- Never claim the active parent model changed unless Codex explicitly confirms it. A Sol reviewer may be delegated automatically for read-only review but must never make application changes. When a Sol review is used for a high-risk write, wait for it; resolve blocking findings or obtain explicit user acceptance before writing. If the reviewer is unavailable, remain paused and escalate to the user. A reviewer does not authorize an underpowered parent to implement the change. Do not interrupt routine work solely because a stronger model exists.
- Keep production application model routing separate from development-time Codex selection.

## Objective
Keep the repository legible, enforceable, and easy for future agent runs to continue.
