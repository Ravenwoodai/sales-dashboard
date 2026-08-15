# Weekly Uncalled Lead Review

## Purpose

The report explains the weekly uncalled-lead population without repeating the full Weekly Lead Management Report. It uses the same Monday-to-Friday call-matching rule and the same exclusions.

## Run command

Run from the Sales Dashboard folder:

```powershell
npm run report:uncalled-lead-review -- --start YYYY-MM-DD
```

`--start` must be the Monday of the reporting week. A successful run creates one XLSX evidence workbook and one concise PDF in:

```text
outputs/uncalled-lead-review/YYYY-MM-DD_to_YYYY-MM-DD/
```

If the exact retained weekly allocation manifest is absent, the command stops and names the missing file. It does not estimate a report. Repeating a completed unchanged run is a safe no-op. Use `--force` only after intentionally reviewing changed inputs or generator rules.

## Simple classification

- Clear A/B business-name category signal: `Missed commercial opportunity`.
- Clear restricted, infrastructure or non-commercial name signal: `Should not have been called`.
- Blank or placeholder business name: `Could not practically be called`.
- Anything unclear: `Uncertain / manual research`.

The PDF is the manager summary. The workbook contains the full filterable row-level evidence, breakdowns, source receipt, method and QA checks.

## Current source coverage

- 20-24 July 2026: available and generated.
- 27-31 July 2026: available and generated.
- 3-7 August 2026: available and generated.
- 13-17 July 2026: not generated because the governed weekly allocation manifest `manifest_2026-07-13_to_2026-07-19.json` is absent. Call data exists, but calls alone cannot establish which leads were allocated that week.
