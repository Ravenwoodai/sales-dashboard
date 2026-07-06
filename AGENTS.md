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

## Objective
Keep the repository legible, enforceable, and easy for future agent runs to continue.