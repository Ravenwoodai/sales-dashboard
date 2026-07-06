# Build Prompt
Build a CLI tool called Agent Forge.

Purpose:
Generate AI-ready project repositories with documentation, agent harness, and autonomous backlog system.

Stack:
Node.js CLI

Libraries:
commander
inquirer
fs-extra
chalk

Features:

Project generator
Template selection
Stack selection
Automatic harness installation
Prompt library generation
Backlog generation

Generated repo must contain:

docs
agent
runtime
prompts
.ai
src
tests

Templates must populate:

PROJECT.md
SPEC.md
ARCHITECTURE.md
SYSTEM_MAP.md
DECISIONS.md
CONSTRAINTS.md
DEVELOPMENT_WORKFLOW.md
REPO_AUDIT.md
INSTRUCTIONS.md
SOUL.md
AUTONOMOUS_BACKLOG.md
AUTONOMOUS_RULES.md
RUN_LOG.md
SESSION_HANDOVER.md
BLOCKERS.md

Create templates folder and generator logic.

CLI command:

npx agent-forge init
