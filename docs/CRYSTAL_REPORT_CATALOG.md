# Crystal Report Source Catalogue

## Intake Status

Archive assessed: `C:\Users\User\Downloads\datasalesdash.zip` on 14 July 2026.

The archive contains nine SAP Crystal Reports with embedded saved-record streams. The `.rpt` files are valuable, usable **authoritative weekly report artifacts** and should be retained as the primary saved output. The current dashboard importer cannot yet safely extract their rows and headers directly because Crystal stores them in a proprietary binary/report-layout format. The active product must not infer undocumented fields from that binary or make active metrics depend on a brittle layout parser.

For dashboard automation, retain the `.rpt` and create a companion CSV/XLSX (preferred) or another structured export with column headers, report run timestamp, period filters, and stable join keys. This lets the dashboard use the data while preserving the original report as the audit source. A future controlled Crystal extractor may remove the companion-export requirement after it is validated per report version.

## Weekly Reports — Condensed Running Guide

### Operating intent

These reports are currently generated manually by a human. They are a future AI-agent workflow only after the report parameters, export reliability, date controls, data checks, and human exception handling are validated. An agent must not advance a reporting window or publish a weekly pack unattended.

### Date rule

For reports requiring manual dates:

- **Start Date:** the day after the End Date of the previous successfully completed report.
- **End Date:** the last fully completed calendar day.
- Do not advance the date range until the report has been generated, saved, and checked.
- Preferred retained export: **`.rpt`**. If it fails, use PDF, Excel, or another usable format. For dashboard ingestion, also retain a structured CSV/XLSX companion export whenever possible.

### Report instructions

| Report | Parameters and basic instructions | Reference example |
| --- | --- | --- |
| Leads Called By Import Data | Run normally. The report provides its own date range. Check and record the displayed dates. | `CrystalReportViewer1 (10).rpt` |
| Lead Import Data Management | `SummaryOnly = False`; `GroupBYDay = True`; enter the controlled Start Date and End Date. | `CrystalReportViewer1 (9).rpt` |
| New Business Added | Enter the controlled Start Date and End Date. Run and check that the report covers the correct period. | `CrystalReportViewer1 (6).rpt` |
| Leads Created by Salesperson | Run normally. The report provides its own date range. Check and record the displayed dates. | `CrystalReportViewer1 (8).rpt` |
| New Business Leads Sold by Allocation — Active | Enter controlled dates. Set `TopCount = 99`, `SummaryOnly = False`, `GroupBySource = True`, `GroupBySalesperson = False`, `Mobile = False`, `ShowTerminatedSalespeople = False`. This returns current employees only. | `CrystalReportViewer1 (3)(2).rpt` |
| New Business Leads Sold by Allocation — Terminated | Use the same dates and settings as Active, but set `ShowTerminatedSalespeople = True`. This returns former employees only. | `CrystalReportViewer1 (4)(2).rpt` |
| Lead Generators Sales | Set `ShowGeneratorNames = True`, `ShowAllEntries = True`, `SortByWeekSold = False`. | `CrystalReportViewer1 (5).rpt` |
| Lead Generators Results | Set `ShowDetails = True`. The `False` version is not required for the normal weekly report pack. | `CrystalReportViewer1 (11).rpt` |

### Basic completion check

For every report:

1. Confirm the correct report and parameters were used.
2. Confirm the date range is correct where applicable.
3. Confirm the report opens and contains the expected headings.
4. Save as `.rpt`, or use another usable format if `.rpt` fails.
5. Use a clear filename containing the report name and reporting period.
6. Record any failed, blank, or unusual report for review; do not treat it as a successfully completed period.

## Catalogue

| ID | Business report | Archive file | Category | Saved-record payload | Recommended status | Initial dashboard use |
| --- | --- | --- | --- | ---: | --- | --- |
| CR-01 | Leads Called By Import Data | `CrystalReportViewer1 (10).rpt` | Source utilisation / lead-age evidence | 1.40 MB | Intake candidate | Compare calls to import cohorts; support record-age and stale-import coverage views. |
| CR-02 | Lead Import Data Management | `CrystalReportViewer1 (9).rpt` | Lead inventory / import lifecycle | 1.64 MB | Intake candidate | Import catalogue, source health, import dates, counts, and traceable source coverage. |
| CR-03 | New Business Added | `CrystalReportViewer1 (6).rpt` | New lead creation flow | 0.78 MB | Intake candidate | New-business supply trend and lead-generator contribution, without conversion claims. |
| CR-04 | Leads Created by Salesperson | `CrystalReportViewer1 (8).rpt` | Salesperson-created lead evidence | 0.04 MB | Intake candidate | Validate the existing SP-created-record signal and distinguish manual creation from historical imports. |
| CR-05 | New Business Leads Sold by Allocation — Active | `CrystalReportViewer1 (3).rpt` | Commercial allocation / sales outcome | 3.43 MB | Quarantined pending policy | Read-only reconciliation only after a governed stable allocation/lead key and sales-outcome definition are supplied. |
| CR-06 | New Business Leads Sold by Allocation — Terminated | `CrystalReportViewer1 (4).rpt` | Commercial allocation / terminated outcome | 3.44 MB | Quarantined pending policy | Data-quality and lifecycle audit only; never count as confirmed sales, loss, or salesperson performance without definitions. |
| CR-07 | Lead Generators Sales | `CrystalReportViewer1 (5).rpt` | Commercial generator outcome | 1.32 MB | Quarantined pending policy | Potential future source-yield reconciliation; requires sale/value definitions, dates, and attribution policy. |
| CR-08 | Lead Generators Results | `CrystalReportViewer1 (11).rpt` | Generator operational performance | 6.60 MB | Intake candidate with review | Operational creation/quality/volume trends once schema and definitions are confirmed; keep commercial fields quarantined. |
| CR-09 | Unmapped legacy report | `CrystalReportViewer1 (2).rpt` | Unknown | 1.40 MB | Hold for identification | File was present in the archive but not mapped in the supplied report list. Identify its business name and purpose before use. |

## Evidence Of File State

- All nine files are compound-document Crystal Reports with `SavedRecordsStream` payloads, so they likely include a saved report result rather than only layout definitions.
- The archived files have distinct SHA-256 fingerprints; no duplicate file was detected.
- The static record data is snapshot evidence. It must be labelled with the report run date/period once exported; it cannot be assumed current.

## Recommended Integration Sequence

1. **Catalogued-source intake**: obtain CSV/XLSX exports for CR-01 to CR-04 and the non-commercial fields of CR-08. Store an import manifest with report ID, source filename, extracted-at timestamp, period filters, row count, column list, hash, and validation result.
2. **Read-only intelligence layer**: create report-specific adapters that normalize only documented fields. Keep each source optional, versioned, and visibly stale when unavailable. Use stable CRM IDs only; never phone numbers.
3. **Cross-source evidence views**: add a Source Provenance workspace showing import cohorts, newly added records, salesperson-created records, and call activity. Present discrepancy counts as reconciliation candidates, not corrected attribution.
4. **Commercial-data governance**: before CR-05 to CR-07 are made active, approve the definitive allocation key, sale/outcome meaning, reporting period, cancelled/terminated treatment, revenue/value definition, and reattribution policy. Until then these reports stay quarantined from scorecards, alerts, rankings, reports, and autonomous actions.
5. **Reconciliation and review workflow**: expose mismatches as auditable manager-review candidates with exact source rows and reasons. Never overwrite source attribution or make CRM changes automatically.

## Minimum Export Contract

Every CSV/XLSX export should include, where applicable:

- a report run timestamp and period/date filter;
- a report-specific immutable row identifier;
- `customer_id`, `contact_id`, `lead_id`, allocation ID, or equivalent stable key;
- source/import ID and import date;
- creator ID/type and creation date;
- allocation status and lifecycle timestamps;
- explicit sale/outcome status, outcome date, cancellation/termination reason, and value/currency only when formally defined;
- a data dictionary explaining each field and permitted values.

Do not include or use phone values for matching. Do not use the excluded legacy `NoSaleType` or `Baz_DetailedNotes` fields as a substitute for defined commercial outcomes.

## Current Decision

The first implementation slice is a **catalogue + non-commercial source-provenance intake**. It can enrich the dashboard safely after usable CSV/XLSX exports arrive. Commercial allocation and sales reports require an explicit product decision before any active dashboard use.
