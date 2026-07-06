# Bugfix Prompt
Fix a specific bug in this repository with the smallest safe change.

## Required Process
1. Read `AI_SYSTEM.md`, `docs/ARCHITECTURE.md`, `agent/INSTRUCTIONS.md`, and `runtime/AUTONOMOUS_BACKLOG.md`.
2. Reproduce and describe the bug before changing code.
3. Identify root cause and impacted modules.
4. Implement a minimal fix in the correct module.
5. Verify behavior with focused checks/tests.
6. Update `runtime/RUN_LOG.md`, backlog task status, and handover notes.

## Constraints
- Do not introduce unnecessary dependencies.
- Preserve existing architecture unless required for correctness.
- If architecture changes, update `docs/DECISIONS.md` and related docs.
