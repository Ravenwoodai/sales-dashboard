# AI System Control File
This file defines the operating rules for all coding agents working in Sales Dashboard.
Agents should start with /AGENTS.md and use this file for the hard guardrails.

## System Objective
Build and maintain Sales Dashboard with a repository that is legible to both humans and agents.
Primary goals:
- correctness
- stability
- smallest effective change
- documentation accuracy
- plan-driven execution

## Required Startup Procedure
Read these files before editing code:
1. /AGENTS.md
2. /docs/PROJECT.md
3. /docs/PROJECT_CONTEXT.md
4. /docs/AGENT_CONTEXT.md
5. /docs/ARCHITECTURE.md
6. /docs/SYSTEM_MAP.md
7. /docs/UI_DESIGN_STANDARD.md
8. /docs/PLANS.md
9. /docs/QUALITY_SCORE.md
10. /SECURITY.md
11. /agent/INSTRUCTIONS.md
12. /runtime/AUTONOMOUS_BACKLOG.md

## Operating Principles
### Smallest Effective Change
Prefer narrow, high-confidence edits over broad speculative refactors.

### Repository Knowledge Is The System Of Record
If a decision matters, write it into the repository.
Chat history, temporary notes, and tacit knowledge are not reliable sources of truth.

### Plans Are First-Class
Use /docs/PLANS.md for meaningful work before implementation expands.
Update the plan when scope or decisions change.

### Quality Must Stay Visible
Use /docs/QUALITY_SCORE.md to track confidence and debt by area.
Do not let quality concerns stay implicit.

### Documentation Must Stay Accurate
When behavior, architecture, or workflow changes:
- update the relevant docs
- update runtime state files
- capture durable decisions in /docs/DECISIONS.md

### UI Work Uses The Default Design Standard
When creating or changing a user-facing interface, use /docs/UI_DESIGN_STANDARD.md as the default product UI baseline.

### Context Consistency Rule
Agents must ensure /docs/PROJECT_CONTEXT.md and /docs/PROJECT_CONTEXT.json stay current.
Trigger regeneration when:
- architecture changes
- new entities are introduced
- system flow changes
- major backlog updates occur
If the Project Context artifacts are outdated, regenerate them before marking the task done.

## Autonomous Work Rules
1. Select the highest-priority TODO from /runtime/AUTONOMOUS_BACKLOG.md.
2. Mark it IN_PROGRESS.
3. Implement and verify the change.
4. Mark it DONE or BLOCKED.
5. Log meaningful work in /runtime/RUN_LOG.md.

## Handling Blockers
If blocked:
1. Try at least two credible approaches.
2. Record evidence in /runtime/BLOCKERS.md.
3. Update the backlog state.
4. Continue with the next viable task.

## Code Safety Rules
Agents must not:
- change secrets or local credentials
- silently rewrite architecture
- delete code without verifying it is obsolete
- leave docs or runtime state stale after meaningful changes

## Session Handover
Before stopping work update:
- /runtime/RUN_LOG.md
- /runtime/SESSION_HANDOVER.md
- /docs/QUALITY_SCORE.md when quality or risk changed