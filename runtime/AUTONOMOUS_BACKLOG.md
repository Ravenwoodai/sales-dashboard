# Autonomous Backlog
This file contains the machine-readable task list for the repository.

# Status Values
Allowed values:
TODO  IN_PROGRESS  BLOCKED  DONE

# Backlog

| ID | Priority | Task | Dependencies | Status | Blocker | Next Action | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | P0 | Verify the primary runtime boots from the scaffold | - | DONE | - | - | The main workflow starts successfully or the startup gap is clearly documented |
| 2 | P0 | Refine the project brief and acceptance criteria | 1 | DONE | - | - | The repository documents a concrete first milestone and its success criteria |
| 3 | P1 | Capture the first execution plan | 2 | DONE | - | - | A repo-local plan explains how the next meaningful slice will be executed |
| 4 | P1 | Maintain Project Context | 2 | DONE | - | - | Both Project Context files exist, follow the required structure, and match the current repo state |
| 5 | P1 | Implement the first vertical slice | 3,4 | DONE | - | - | The repository delivers one complete workflow beyond the initial scaffold |
| 6 | P1 | Add smoke verification for the critical path | 5 | DONE | - | - | The critical workflow can be validated without relying only on manual inspection |
| 7 | P1 | Tighten architecture and ownership docs | 5 | DONE | - | - | Architecture, ownership, and key decisions are accurate and current |
| 8 | P2 | Review runtime, security, and recovery assumptions | 1 | DONE | - | - | Security.md, docs/BACKUP_RECOVERY.md, and .ai context reflect real operational assumptions |
| 9 | P2 | Refresh the quality score and risk register | 5 | DONE | - | - | Quality and risk are visible enough for the next agent to prioritize accurately |
| 10 | P1 | Build the first user journey in the UI | 5 | DONE | - | - | A real user can complete one key journey in the browser |
| 11 | P0 | Add durable scheduled import storage and manager review state | 5 | DONE | - | - | Multiple scheduled CSVs can be tracked without losing history or storing sensitive imports in Git |
| 12 | P1 | Add strict-schema LLM evaluator option | 11 | TODO | - | Add versioned local/approved model evaluation behind schema validation and retry/quarantine states | AI outputs are structured, evidence-backed, confidence-scored, and auditable |
| 13 | P1 | Add dashboard controls for review and alert lifecycle state | 11 | TODO | - | Add UI actions to acknowledge alerts, save manager confirmations, and filter review states | Managers can manage review state without calling APIs directly |
| 14 | P2 | Add scheduled import automation | 11 | TODO | - | Define the watched/drop folder or scheduler contract for recurring CSV arrivals | New CSV exports can be ingested predictably without manual restart |
