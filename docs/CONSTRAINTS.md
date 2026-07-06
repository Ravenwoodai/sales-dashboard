# Constraints
This file records practical constraints for Sales Dashboard.

## Product Constraints
- Keep the first milestone narrow and testable.
- Avoid undocumented scope growth.

## Technical Constraints
- Primary stack: Node.js
- Primary runtime: web
- Primary artifact: src/main.js
- Prefer stable, well-understood libraries before adding complexity.

## Process Constraints
- Work should follow the backlog-driven loop.
- Meaningful changes should update plans, quality notes, and runtime state.
- Architectural changes must be captured in docs/DECISIONS.md.

## Safety Constraints
- Do not commit secrets.
- Validate destructive filesystem or shell actions carefully.
- Keep recovery guidance current when runtime or storage assumptions change.