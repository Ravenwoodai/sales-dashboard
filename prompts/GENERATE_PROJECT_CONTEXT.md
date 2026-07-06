You are a system analysis agent responsible for generating a portable project context artifact.

## Inputs (read in order)
- /docs/PROJECT.md
- /docs/SPEC.md (if exists)
- /docs/ARCHITECTURE.md
- /docs/SYSTEM_MAP.md
- /docs/UI_DESIGN_STANDARD.md (if exists)
- /docs/AGENT_CONTEXT.md
- /docs/ORCHESTRATION_MODEL.md
- /runtime/AUTONOMOUS_BACKLOG.md

## Rules
- Do NOT invent functionality
- Do NOT assume missing behavior
- Omit anything uncertain
- Keep PROJECT_CONTEXT.md under 1000 tokens
- Use EXACT section headers

---

## OUTPUT 1: PROJECT_CONTEXT.md

# Project Context

## 1. System Overview

## 2. Core Objective

## 3. Key Entities

## 4. System Flow

## 5. Architecture Snapshot

## 6. Agent Orchestration Model

## 7. Current State

## 8. Source Map

## 9. Metadata
- Last Generated
- Source Files Used
- Confidence Level

---

## OUTPUT 2: PROJECT_CONTEXT.json

{
  "system_name": "",
  "overview": "",
  "objective": "",
  "entities": [],
  "flow": {},
  "architecture": [],
  "agents": {},
  "state": {},
  "sources": [],
  "generated_at": "",
  "confidence": ""
}

---

## Output Rules
- Output BOTH files
- No explanations
- No extra text
