# Git Sync Guidance
Use this file for safe repository synchronization.

## Baseline Rules
- Inspect local changes before pulling or pushing.
- Prefer short-lived branches or short-lived work sessions.
- Do not overwrite unreviewed work without understanding it first.
- Keep plan and quality docs in the same branch as the code they describe.

## Before Risky Changes
- Confirm the working tree state.
- Confirm backup expectations.
- Capture the current resume point in runtime/SESSION_HANDOVER.md if the work is disruptive.

## During Review
- Prefer smaller diffs with clear intent.
- Convert repeated feedback into docs, tests, or tooling where possible.