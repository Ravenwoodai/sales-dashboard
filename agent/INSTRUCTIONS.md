# Development Instructions
These are the coding guidelines for agents working in Sales Dashboard.

## Core Principles
- clarity over cleverness
- stability over novelty
- smallest effective change
- explicit documentation over hidden assumptions

## Structural Rules
- Keep product logic in src/.
- Keep tests in tests/.
- Keep durable product and engineering knowledge in docs/.
- Keep live task state in runtime/.

## Implementation Rules
- Validate inputs and external boundaries.
- Prefer predictable, composable abstractions.
- Add comments only when they reduce real ambiguity.
- Update docs when behavior or architecture changes.

## UI Implementation Defaults
- Use /docs/UI_DESIGN_STANDARD.md before creating or changing user-facing screens.
- Treat the UI standard as the default visual and interaction baseline unless the repository has a stronger product-specific design system.
- Verify UI changes in the real running app whenever possible.

## Verification Rules
- Run the nearest safe verification command for the touched area.
- Add tests when the workflow is stable enough to automate.
- Record meaningful work and blockers in runtime state files.

## Mandatory Data Discovery
Before using data or looking for data, agents must:
1. Inspect `data/carma/catalog.json` before doing a broad file search or assuming a source must be acquired.
2. Refresh it with `npm run carma:refresh-data-layer` when missing or stale, then inspect it again.
3. Open the catalogued source manifest or file and verify the requested date coverage, authority, hashes/freshness and stated limitations.
4. Reuse an adequate catalogued source instead of rerunning extraction or building a duplicate dataset.
5. Record the catalog key, coverage checked, source selected and material limitation in the task update or runtime log.

Agents must not say data is unavailable, ask for a new extraction, or begin a backfill until those five checks are complete. Familiar filenames, prior chat context, remembered outputs and ad hoc directory searches are secondary evidence only.

## Context Maintenance Responsibility
Agents must:
1. Check whether docs/PROJECT_CONTEXT.md and docs/PROJECT_CONTEXT.json are present.
2. Generate them if either file is missing.
3. Regenerate them when the system structure changes.
4. Keep the markdown and JSON versions consistent.

Use:
- prompts/GENERATE_PROJECT_CONTEXT.md
