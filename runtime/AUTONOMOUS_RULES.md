# Autonomous Execution Rules
The backlog is the source of truth for immediate task execution.

## Task Selection
- Choose the highest-priority TODO.
- If priorities tie, choose the lowest ID unless dependencies say otherwise.

## Execution Loop
1. Mark the task IN_PROGRESS.
2. Implement the smallest effective change.
3. Verify the result.
4. Mark the task DONE or BLOCKED.
5. Update runtime/RUN_LOG.md and runtime/SESSION_HANDOVER.md.

## Blocker Rules
- Try at least two credible approaches before blocking a task.
- Record evidence and suggested next steps in runtime/BLOCKERS.md.
- Continue with the next viable task when blocked.

## Documentation Rules
- Update docs when behavior, architecture, or risk changed.
- Keep plans and quality notes synchronized with implementation.