# Context Bundle Generator
Use this guide when preparing portable context bundles for external agents or cross-repo handoffs.

## Bundle Types
### QUICK
- docs/PROJECT_CONTEXT.md

### ENGINEERING
- docs/PROJECT_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/SYSTEM_MAP.md

### DEBUG
- docs/PROJECT_CONTEXT.md
- runtime/AUTONOMOUS_BACKLOG.md
- runtime/RUN_LOG.md
- runtime/BLOCKERS.md

### FULL
- docs/PROJECT_CONTEXT.md
- docs/PROJECT.md
- docs/SPEC.md if it exists
- docs/ARCHITECTURE.md
- docs/SYSTEM_MAP.md
- docs/UI_DESIGN_STANDARD.md if it exists
- docs/AGENT_CONTEXT.md
- docs/ORCHESTRATION_MODEL.md if it exists
- runtime/AUTONOMOUS_BACKLOG.md

### COMPREHENSIVE
- AGENTS.md
- AI_SYSTEM.md
- docs/PROJECT_CONTEXT.md
- docs/PROJECT.md
- docs/SPEC.md if it exists
- docs/AGENT_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/SYSTEM_MAP.md
- docs/UI_DESIGN_STANDARD.md if it exists
- docs/ORCHESTRATION_MODEL.md if it exists
- docs/PLANS.md
- docs/QUALITY_SCORE.md
- docs/DECISIONS.md if it exists
- SECURITY.md
- agent/INSTRUCTIONS.md
- .ai/context.json
- package.json
- runtime/AUTONOMOUS_BACKLOG.md
- runtime/SESSION_HANDOVER.md
- runtime/BLOCKERS.md if it exists

## Output Format
# CONTEXT BUNDLE

## INSTRUCTIONS FOR RECEIVING AGENT
You are given structured context for a system.
- Do not assume missing behavior
- Ask if unclear
- Follow provided documents

---

## PROJECT_CONTEXT
<content>

---

## FILE_NAME
<content>

---

## Token Limits
- QUICK: 2000
- ENGINEERING: 6000
- DEBUG: 6000
- FULL: 16000
- COMPREHENSIVE: 24000

## Truncation Rules
- Never truncate PROJECT_CONTEXT.md
- For QUICK, ENGINEERING, DEBUG, and FULL, then truncate in this order:
  1. RUN_LOG.md from the oldest entries first
  2. AUTONOMOUS_BACKLOG.md from the lowest-priority work first
  3. SPEC.md
  4. ARCHITECTURE.md
- For COMPREHENSIVE, truncate lower-priority sections first, starting with BLOCKERS, SESSION_HANDOVER, AUTONOMOUS_BACKLOG, package metadata, `.ai/context.json`, agent instructions, security notes, and then older planning or architecture docs as needed.
- Add this marker whenever truncation occurs:
  [TRUNCATED: token limit reached]

## Notes
- Skip missing optional files cleanly.
- Keep bundle generation deterministic.
- Prefer repo-local files over chat-only explanations.
- Do not include workflow prompt files such as prompts/AUDIT_PROMPT.md in context bundles.