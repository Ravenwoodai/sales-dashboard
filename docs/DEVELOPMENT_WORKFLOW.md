# Development Workflow
This file defines the recommended execution loop for Sales Dashboard.

## Workflow
understand -> plan -> implement -> verify -> document -> hand over

## Stage 1 - Load Context
Read:
- /AGENTS.md
- /AI_SYSTEM.md
- /docs/PROJECT.md
- /docs/AGENT_CONTEXT.md
- /docs/ARCHITECTURE.md
- /docs/SYSTEM_MAP.md
- /docs/UI_DESIGN_STANDARD.md
- /docs/PLANS.md
- /docs/QUALITY_SCORE.md
- /SECURITY.md
- /agent/INSTRUCTIONS.md
- /runtime/AUTONOMOUS_BACKLOG.md

## Stage 2 - Confirm The Plan
- Use the backlog for immediate task selection.
- Use docs/PLANS.md when the work spans multiple steps or decisions.

## Stage 3 - Implement
- Make the smallest effective change.
- Preserve architectural legibility.
- Avoid unrelated refactors.

## Stage 4 - Verify
- Run node src/main.js or the closest safe equivalent.
- Validate the touched behavior directly.
- Add or update tests when the area is stable enough to verify automatically.

## Stage 5 - Update The Record
After meaningful changes update:
- docs affected by behavior or architecture changes
- docs/QUALITY_SCORE.md when risk or confidence changed
- runtime/RUN_LOG.md
- runtime/SESSION_HANDOVER.md

## Stage 6 - Continue Or Escalate
- Continue until the task is done or blocked.
- Escalate only when external intent or judgment is required.