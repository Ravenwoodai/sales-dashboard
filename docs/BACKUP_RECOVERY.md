# Backup And Recovery

## Baseline
- Use source control as the primary recovery tool.
- Keep critical repo-local knowledge in versioned files.
- Do not store scheduled CSV imports or transcript exports in Git.

## CSV Source Recovery
- The app reads the CSV from the configured path at runtime.
- If the dashboard is empty, confirm `--csv <path>` or `SALES_DASHBOARD_CSV_PATH`.
- If the CSV path changes, update run instructions and handover notes.

## Before High-Risk Work
1. Confirm tests pass with `node --test tests/*.test.js`.
2. Avoid copying source CSVs into the repository.
3. Record the current stop/resume point in `runtime/SESSION_HANDOVER.md`.

## Recovery Checklist
1. Restore the latest safe repository state.
2. Re-read `AGENTS.md` and the latest handover.
3. Re-run `node --test tests/*.test.js`.
4. Start the dashboard with the configured CSV path.
5. Update docs if recovery exposed stale assumptions.
