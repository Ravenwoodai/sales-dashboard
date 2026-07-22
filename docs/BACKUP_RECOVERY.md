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
1. Confirm tests pass with `npm test`.
2. Avoid copying source CSVs into the repository.
3. Record the current stop/resume point in `runtime/SESSION_HANDOVER.md`.
4. For state work, back up `state.json`, `evaluation-validation-lab.json`, `intelligence.sqlite`, and `evaluation-studio.sqlite` plus any live `-wal`/`-shm` companions while the application is stopped or through a SQLite-safe backup method.

## Recovery Checklist
1. Restore the latest safe repository state.
2. Re-read `AGENTS.md` and the latest handover.
3. Re-run `npm test`.
4. Start the dashboard with the configured CSV path.
5. Run `PRAGMA integrity_check` on both SQLite databases.
6. Confirm the capability register reports zero promoted capabilities and no model job/run became active.
7. Update docs if recovery exposed stale assumptions.
8. Validate the Validation Lab JSON and confirm frozen manifest source/exclusion fingerprints still match before accepting any candidate comparison.

## Model-State Recovery

- Do not restore quarantined jobs/runs to queued state merely to reproduce historical behavior.
- Do not reinstall the scheduled evaluation task.
- Preserve historical model artifacts as research; never copy them into active semantic columns.
- A rollback that predates capability enforcement is unsafe until the fail-closed register boundary is reapplied and verified.
- Never reconstruct missing benchmark labels from historical model output or manager-review state. Missing or corrupt validation-lab state fails closed and requires a new manifest.
