# Weekly Lead Utilisation Orchestration

## Purpose

This workflow builds three Weekly Lead Management Excel/PDF packs from one Monday start date: Overall, New Business only and Warm only. Each pack retains Lead Utilisation, Voicemail Follow-up and Call Activity & Rhythm as separate lenses, adds a side-by-side manager view, and preserves the ongoing overall/team/person trend sections. The split packs are accepted only when New Business plus Warm reconciles exactly to Overall for the current week and every retained historical trend. Sales Dashboard owns report calculation, validation, rendering and optional delivery. Carma Reports remains the acquisition owner for Carma-hosted allocation and approved-sales evidence. The two projects are connected by versioned files and commands; Carma extraction code and credentials are not copied into Sales Dashboard.

## Weekly inputs

Prepare these sources for the requested Monday-to-Friday reporting week:

1. `WeeklyLeadAllocationExport_<Monday>_to_<Sunday>.csv`
   - produced by Carma Reports with `npm run weekly-allocation:extract -- --start <Monday> --end <Sunday>`;
   - the report calculation keeps allocations received Monday through Friday only.
2. `WeeklyCallExport_<Monday>_to_<Sunday>.csv`
   - produced by Carma Reports with `npm run weekly-call:extract -- --start <Monday> --end <Sunday>`;
   - the utilisation calculation and activity totals keep Monday-through-Friday calls only.
3. The established primary call-history CSV, where one exists.
   - retained as the primary call source for the supporting Lead Result Dashboard;
   - the weekly call file remains the period supplement.
4. The unfiltered Carma `Approved Sales by Customer for Period` XLSX for `<Monday>` through `<Sunday>`.
   - the parameterized Carma command sets and verifies `Show New Customers In Period = False`, all asset groups and the exact dates before downloading the data-only XLSX;
   - the evidence refresh then extracts exact order/customer/approval evidence, parses retained allocation-history PDFs and builds the governed SQLite database.
5. A governed `carma-evidence.sqlite` containing one complete, unfiltered Approved Sales run for `<Monday>` through `<Sunday>`.
   - population contract: `carma_approved_sales_show_new_customers_false.v1`;
   - `show_new_customers_only` must be `0`;
   - `completeness_status` must be `complete`;
   - SQLite integrity must return `ok`.
6. The approved Countrywide Austral report logo.

The Carma database is needed only for the Allocated versus Self-Sourced approved-sales split. Called/Wasted, voicemail Follow-up Failure and outbound-call context are rebuilt from the weekly allocation and call files. When configured, the immutable primary call history is merged ahead of the weekly supplement and exact duplicate Call IDs are removed.

## One-time setup

Copy `config/weekly-lead-utilisation.example.json` to an ignored local configuration file and replace the example paths. Keep credentials and authentication state in Carma Reports; never put them in this configuration.

The configuration controls:

- allocation, weekly-call and optional primary-call source locations;
- governed Carma evidence database location;
- report output root and logo;
- exact manager-team and salesperson exclusions supplied by ignored local configuration;
- the append-only verified trend-history path and the person-level minimum allocation threshold (default `100`);
- optional allocation/evidence refresh commands;
- optional Outlook delivery command and recipient.

## Commands

Normal Monday operation is one double-click:

`Run Weekly Lead Management Report.cmd`

The launcher automatically selects the last completed Monday-to-Friday week, downloads both weekly CSV exports, refreshes the governed Approved Sales evidence, builds the Lead Utilisation and Voicemail source reports, assembles and validates the combined XLSX/PDF pack, and leaves email delivery off unless explicitly requested from PowerShell.

Validate the complete combined command without generating the workbook/PDF stages:

```powershell
npm run report:weekly-lead-management -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD --dry-run
```

Build from already retained sources:

```powershell
npm run report:weekly-lead-management -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD
```

Add `--acquire` to refresh the governed weekly inputs first. Add `--send-email` only when external delivery is explicitly intended. The legacy `report:weekly-lead-utilisation` command remains available for a Lead Utilisation-only source pack.

Validate dates, source uniqueness, source hashes and Carma evidence without changing imported data or generating reports:

```powershell
npm run report:weekly-lead-utilisation -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD --dry-run
```

Build the complete report pack from sources that are already present:

```powershell
npm run report:weekly-lead-utilisation -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD
```

Run configured acquisition commands first, then build:

```powershell
npm run report:weekly-lead-utilisation -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD --acquire
```

Send the verified XLSX and PDF after a successful build:

```powershell
npm run report:weekly-lead-utilisation -- --config "C:\path\weekly-lead-utilisation.json" --start YYYY-MM-DD --send-email
```

Use `--acquire --send-email` together only when both acquisition commands and delivery are configured and the operator intends those external actions.

## What the orchestrator does

1. Requires an ISO Monday start date and derives Friday report end plus Sunday source envelope.
2. Resolves every source pattern to exactly one file and records SHA-256 hashes.
3. Optionally runs both configured Carma Reports weekly CSV acquisition commands without a shell.
4. Opens the Carma evidence database read-only and rejects the wrong period, filtered population, incomplete run or failed integrity check.
5. Imports the weekly allocation/call files with immutable raw-byte preservation.
6. Rebuilds and validates the supporting Lead Result Dashboard.
7. Rebuilds the Lead Utilisation workbook at allocation grain, appends its QA-passed sanitised snapshot to the ongoing trend history and adds overall, team and threshold-qualified person trend tabs.
8. Extracts the governed Allocated/Self-Sourced sales split for the same included salesperson population and Monday-Friday approval period.
9. Renders the fixed-layout A4 landscape PDF, including the same ongoing trend charts and sample-gated callouts.
10. Builds the Friday-cutoff Voicemail workbook and PDF from the same retained call bundle and exact exclusion policy, including current/prior team and person movement.
11. Builds the Call Activity & Rhythm analysis, workbook and PDF from the exact Lead Utilisation roster and exclusion-policy key, reconciling each retained week's outbound calls before exposing duration, short-call or calling-pace review prompts.
12. Assembles the 25-sheet Overall Weekly Lead Management workbook in two bounded memory passes and the consolidated PDF with three executive pages plus the complete Lead Utilisation, Voicemail and Call Activity sections. No blended score is produced.
13. Applies the versioned exact-campaign lead-type policy to allocations, calls, voicemail anchors and approved sales. Calls without a permitted Customer ID are New Business; otherwise the deterministic exact/nearest allocation rule supplies the type, with Admin-nearest calls Warm and customers absent from all retained allocation logs New Business. Self Sourced approved sales are New Business.
14. Rebuilds the New Business and Warm histories from the same retained weeks and exclusion policy, creates matching 25-sheet XLSX/PDF packs and requires every current and historical additive metric to reconcile exactly to Overall.
15. Optionally emails only explicitly configured verified attachments.
16. Writes a `weekly_lead_management_orchestrator.v3` `orchestration-manifest.json` atomically after every stage, including source/output hashes, split-pack manifests, reconciliation evidence and failure details.

The ongoing trend section is a mandatory weekly contract, not an optional presentation layer. The orchestrator rejects a generated workbook when the trend model or configured allocation threshold is missing. The exclusion lists and display are supplied by ignored local configuration and protected by `report.exclusionPolicySha256`; the run fails if the lists drift from that hash.

## Fail-closed behaviour

The run stops before delivery when any of these conditions occurs:

- the supplied start date is not Monday;
- a source file is missing or a wildcard matches zero/multiple files;
- the Carma evidence period is absent, filtered or incomplete;
- SQLite integrity fails;
- the Lead Result Dashboard reconciliation or formula scan fails;
- the Lead Utilisation QA table contains any non-PASS result;
- either the current or prior Voicemail Monday-to-Friday cohort is incomplete;
- the shared exclusion contract differs between the Lead Utilisation and Voicemail sections;
- the Voicemail or combined workbook formula scan fails;
- the Call Activity analysis does not reconcile to the Lead Utilisation roster, period or exclusion policy;
- the combined workbook does not contain the full 25-sheet contract;
- the allocated/self-sourced split contains an unknown classification or fails to reconcile;
- any allocation, call, voicemail anchor or approved sale is not classified as exactly New Business or Warm;
- either split workbook/PDF fails its report QA, formula, render or signature checks;
- New Business plus Warm differs from Overall for any current-week or retained historical metric;
- the XLSX/PDF signatures are invalid;
- an email attachment is missing.

## Carma Reports boundary

Do not copy the Carma browser automation, credentials, selectors or extraction logic into this repository. Carma Reports is the system that knows how to authenticate, navigate Carma and retain exact order/allocation evidence. Sales Dashboard consumes its governed output and verifies the contract.

Both weekly CSV downloaders are parameterized and called by `--acquire`. Carma Reports also exposes `npm run weekly-approved-sales:evidence -- --start <Monday> --end <Sunday>`, which parameter-confirms and downloads the unfiltered report, then runs or resumes exact-order evidence capture. `--source-xlsx <path>` exists only for retained-source replay. Sales Dashboard then runs allocation coverage/PDF parsing and the governed database build through `npm run weekly-approved-sales-evidence:refresh`. A fresh Carma login or 2FA may still be required. The report orchestrator never substitutes a stale week, filtered sales report or approximate source attribution.

## Monday 6:00 AM download-only task

Windows task `Carma Monday Weekly Export Download` runs `Carma Reports\scripts\monitor-weekly-exports.ps1` every Monday at 6:00 AM local Australia/Sydney time for the logged-on Windows user. It checks only the most recently completed Monday-Sunday source envelope and downloads only the exact weekly allocation and call CSVs. It does not build a report, refresh Approved Sales evidence or send email.

The task validates both CSVs through the existing downloaders and records an atomic completion marker bound to both retained SHA-256 hashes. Once both files are complete, a manual repeat verifies the retained files and exits without contacting Carma. If the source is exceptionally unpublished at 6:00 AM, the run records `waiting_for_source` and requires a manual later retry. The direct files are retained under `Carma Reports\output\weekly-allocation-exports\<Monday>_to_<Sunday>` and `Carma Reports\output\weekly-call-exports\<Monday>_to_<Sunday>`.

## Monday operator checklist

1. Double-click `Run Weekly Lead Management Report.cmd`.
2. If the launcher opens the dedicated Carma Chrome window, sign in and complete 2FA, then press Enter in the launcher window.
3. Leave the process running while exact-order/allocation evidence is captured. Rerunning the launcher resumes retained completed order evidence.
4. Read the final status. The verified combined XLSX, PDF, supporting Voicemail files and orchestration manifest are under `outputs\\weekly-lead-management\\<Monday>_to_<Friday>`.

For explicit email delivery after a successful run:

```powershell
powershell -File .\scripts\run-monday-lead-management.ps1 -SendEmail
```

## Verified retained-week result

The full pipeline was integration-tested for Monday 27 July to Friday 31 July 2026 using the retained Monday-Sunday source envelope. It completed every stage and produced:

- 25,992 Lead Allocations Received;
- 16,407 Lead Allocations Called;
- 9,585 Lead Allocations Wasted;
- 63.1% Lead Utilisation;
- 36.9% Lead Wastage;
- 33,699 Outbound Calls Made;
- 766 Follow-up Failures;
- 478 included approved sales split into 416 Sale From Allocated Lead and 62 Self Sourced, with zero Attribution Withheld.

The workbook QA checks, formula-error scan, supporting dashboard reconciliations, all rendered workbook sheets and all six PDF pages passed review. The integration run did not send email.

The call downloader was live-tested against the retained 27 July-2 August source and reproduced the exact source hash with 35,229 calls: 34,108 outbound and 1,121 inbound. A live 3-9 August attempt correctly failed closed because Carma had not yet published that weekly source.

An isolated retained-week replay on 9 August reacquired both weekly CSVs through the same `npm.cmd` configuration used by the Monday launcher, validated the governed 535-order evidence database, and rebuilt every downstream artifact. It reproduced every accepted aggregate and salesperson sales-source row exactly, passed all 14 report QA checks, zero formula errors, all seven workbook renders, all six PDF pages, 7/7 focused orchestration tests and 470/470 repository tests. The orchestrator explicitly routes Windows `.cmd` files through the Windows command host.

## Live 3-7 August run

The retained Monday proof run acquired both exact weekly CSVs, completed governed Approved Sales evidence, applied the hash-locked exclusion policy, reconciled the allocated/self-sourced split and passed report QA. Source figures and the named exclusion list remain in ignored local manifests rather than public documentation.

The ongoing pack supports append-only verified weekly history and adds overall, manager-team and threshold-qualified salesperson trend views. Week-on-week improvement/regression uses the configured percentage-point threshold; outliers remain unscored until enough prior comparable weeks exist; no Most Improved ranking is produced.

For this report workflow, Carma Reports calls the Approved Sales extractor with `--weekly-report-evidence`. This captures the exact target-order summary and exact allocation-history PDF required by the governed weekly database without expanding unrelated full customer-history detail. The extractor's default archival mode is unchanged.

The orchestrator must pass the freshly verified run-specific `carma-evidence.sqlite` to the supporting Lead Result Dashboard through `--carma-database`. This prevents a valid but stale global evidence database from silently supplying the sales-source split. The completed manifest, report data and output hashes are under `outputs/weekly-lead-utilisation/2026-08-03_to_2026-08-07`.

The combined command was regenerated for 3-7 August 2026 under `weekly_lead_management_orchestrator.v3`. The Overall pack remains the authoritative complete pack. Separate 25-sheet New Business and Warm workbooks and matching PDFs are generated from the same sources, roster and exclusion policy. Their current-week and three-week trend measures pass 41 exact additive reconciliation checks against Overall. Email remains explicit-only.

## Automatic Monday generation

Codex automation `Weekly Lead Management Report Generation` checks each Monday at 6:30 AM, 9:30 AM and 12:30 PM Australia/Sydney time, beginning after the existing 6:00 AM Carma weekly-export download task. The repeated checks catch later-arriving reports; a complete verified v3 run is a no-op. Each check validates the catalog, matching retained weekly manifest and complete governed Approved Sales evidence before generating Overall, New Business and Warm without acquisition or email. It requires the split packs and histories to reconcile exactly before reporting success. Missing, stale, filtered or ambiguous inputs stop that check; the automation never substitutes a prior week or sends attachments.

## Carma authentication preflight

Carma Reports owns a canonical persistent Chrome profile and two fail-closed session checks. `Carma Session Health Monitor` runs at Windows logon and hourly; `Carma Monday Authentication Preflight` runs Monday at 5:30 AM before the weekly workflow. Both reuse CDP port 9222, defer to the browser activity lock while a report is active, and refresh retained browser state only after authenticated Reporting proof. If Carma requires 2FA, the visible page is preserved for the operator and no OTP automation is attempted. See the local `PROCESS-CARMA-SESSION-RETENTION.md` in the Carma Reports workspace.
