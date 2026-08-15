# Carma Read-Only Report Catalog

## Scope

This catalog records reports with retained evidence from prior safe Carma
runs. It does not claim that these are all reports visible to the account.
Completion requires a fresh authenticated traversal of every Reporting
submenu, including the capture of siblings that have never been opened.

The application menu also contains top-level destinations named `Pay
Reporting` and `Sales Team Reports`. Their labels are proven, but their
contents are not yet inventoried and are not inferred to be children of the
main `Reporting` menu.

## New Business Leads Sold by Allocation

- Menu: `Reporting > Campaign Reporting > New Business Leads Sold by Allocation`
- Technology/file: Crystal Reports, `LeadsNBSoldbyAllocation.rpt`
- Safety: read-only report
- Known export: Microsoft Excel Workbook Data-only

Parameters:

| Position | Parameter | Type | Known values/meaning |
| ---: | --- | --- | --- |
| 0 | Start Date | Date | Required |
| 1 | End Date | Date | Required |
| 2 | Top Count | Integer | Required; saved process uses 99 |
| 3 | Summary Only | Boolean | True/False |
| 4 | Group By Source | Boolean | True/False |
| 5 | Group By Sales Manager | Boolean | True/False |
| 6 | Mobile Only | Boolean | True/False |
| 7 | Include Terminated Salespeople | Boolean | True/False |

Remaining gaps: current menu siblings, full export-format list and output
column schema.

## Approved Sales by Customer for Period

- Menu: `Reporting > Sales > Approved Sales by Customer for Period`
- Technology/file: Crystal Reports, `SalesApprovedByCustomerForPeriod.rpt`
- Safety: read-only report
- Known export: Microsoft Excel Workbook Data-only

Parameters:

| Position | Parameter | Type | Known values/meaning |
| ---: | --- | --- | --- |
| 0 | Start Date | Date | Required |
| 1 | End Date | Date | Required |
| 2 | Show Only New Customers | Boolean | True is exact membership in that report view; False is the all-customer view |
| 3 | Summary Only | Boolean | True/False |
| 4 | Group By Salesperson | Boolean | True/False |
| 5 | Asset Groups | Multi-select | Seven options observed; all selected in governed extractions |

The seven current Asset Group labels still need to be captured from the live
parameter selector.

## Cancelled Orders by Week

- Menu: `Reporting > Sales > Cancelled Orders by Week`
- Technology/file: Crystal Reports, `CancelledOrdersByWeek.rpt`
- Safety: read-only report
- Known export: Microsoft Excel Workbook Data-only

Parameters:

| Position | Parameter | Type | Known values/meaning |
| ---: | --- | --- | --- |
| 0 | Start Date | Date | Required |
| 1 | End Date | Date | Required |
| 2 | Publications | Multi-select | 21 options in the 29 July snapshot |
| 3 | Editions | Multi-select | 26 options after publications were selected |
| 4 | Group By Week | Boolean | False groups by Publication |
| 5 | Show Inactive Only | Boolean | False means all salespeople; True means terminated salespeople only |

Important behaviour:

- start each authoritative parameter combination from a fresh report instance;
- do not trust the post-run Parameter Panel to re-query changed dates;
- the four Boolean views overlap and must not be summed; and
- publication/edition options are a dated snapshot rather than a permanent
  configuration list.

The complete 29 July publication and edition snapshots remain in
`output/cancelled-orders-by-week-history-2026-07-29/manifest.json`.

## Customer Lead Allocation

- Menu: `Reporting > Salespeople > Customer Lead Allocation`
- Technology/output: Carma report dialog producing
  `CustomerLeadAllocationHistory.pdf`
- Safety: read-only report

Parameter:

| Position | Parameter | Type | Known values/meaning |
| ---: | --- | --- | --- |
| 0 | Customer ID | Numeric identifier | Required |

Known behaviour:

- a matching customer can return a multi-page allocation-history PDF; and
- a non-matching ID can return an explicit empty-report result.

## Additional cached technical report references

A local, read-only scan of the saved Carma browser cache found eight Crystal
report filenames. Two corroborate reports already catalogued above:
`LeadsNBSoldbyAllocation.rpt` and
`SalesApprovedByCustomerForPeriod.rpt`.

The following six technical report files are additional evidence. Their exact
Carma display labels and current menu paths are still unknown, so they are not
silently added to the proven Reporting tree:

| Technical report file | Sanitized cached prompt evidence |
| --- | --- |
| `CarmaNumberSearches.rpt` | No parsable prompt page retained |
| `LeadGenerators.rpt` | `ShowDetails` Boolean, default False |
| `LeadImportData.rpt` | No parsable prompt page retained |
| `LeadImportDataManagement.rpt` | `SummaryOnly` Boolean False; `GroupBYDay` Boolean False; `StartDate` Date; `EndDate` Date |
| `LeadsCalledByImportData.rpt` | No parsable prompt page retained |
| `SalespersonGeneratedLeads.rpt` | `ShowGeneratorNames`, `ShowAllEntries` and `SortByWeekSold`; all Boolean and default False |

This cache evidence proves prior report endpoint observation, not current
visibility or permission. The sanitized source is
`mapping/cached-report-evidence.json`; it contains no report rows,
option-list values, customer data, credentials or session values.

## Inventory rules for reports still to be discovered

For every visible report, capture:

1. exact menu path and sibling order;
2. page heading and report technology;
3. non-secret route/report filename where exposed;
4. every parameter label, position, control type and required state;
5. safe-to-observe dropdown values and dependencies;
6. default values without changing them;
7. available export types without initiating an unnecessary export;
8. empty/error behaviour where already known;
9. dangerous or ambiguous controls; and
10. evidence date and permission/account boundary.

Do not run every parameter combination merely to populate this catalog.
