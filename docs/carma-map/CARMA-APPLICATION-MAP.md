# Carma Read-Only Application Map

## Status

This is the working map for a strictly read-only inventory of the Carma
navigation and reporting surface visible to the saved account.

Current status: **in progress**. The entries below are supported by retained
prior live extraction evidence. A current authenticated traversal of every
visible menu branch is still required before this can be called complete.

Machine-readable source:
`mapping/carma-read-only-inventory.json`.

## Safety boundary

Permitted actions:

- open menus and hover submenus;
- navigate to already-authorised screens;
- inspect labels, fields, filters, tables and non-secret route metadata;
- open dropdowns that do not change a business record;
- run previously proven read-only reports with bounded parameters; and
- retain local report output when it is required as evidence.

Forbidden actions:

- Save, Delete, Approve, Cancel, Allocate, Reallocate, Send or Process;
- payment, refund or financial-posting actions;
- create, save or submit a batch;
- select business-record rows;
- use unverified `Additional Actions`; or
- write anything back to Carma.

An unknown control is documented but not activated.

## Retained primary workspace navigation

The following exact 16-item sequence appeared 857 times in retained read-only
captures dated 24 July 2026:

1. My Mail
2. Search
3. Campaigns
4. Events
5. History
6. Payment Plans
7. Digital Inventory
8. Sales
9. Sales Summary
10. Sales Totals
11. Graphs
12. Debt Collections
13. Admin Email Status
14. Maintain Orders
15. Our People
16. Banking

These labels prove that the destinations were visible. They do not prove that
every destination is read-only. Financial, maintenance, operational and
record-editing areas remain label-only and must be inspected conservatively.

## Retained application menu

The following exact 17-item sequence appeared 600 times in the same retained
captures:

1. Handbooks Distribution
2. Add New Businesses
3. Home
4. Collections
5. Custom Lists
6. Menu Editor
7. Production
8. Reporting
9. Payruns
10. Pay Reporting
11. Sales Team Reports
12. Pending Cancellations
13. Template Editor
14. Learning Hub
15. Material
16. AdHoc Maintenace
17. Logout

`AdHoc Maintenace` is preserved exactly as it appeared in Carma. `Logout` is
a session action, not a destination to activate during a mapping pass.

## Proven Reporting paths

```text
Reporting
|-- Campaign Reporting
|   `-- New Business Leads Sold by Allocation
|-- Sales
|   |-- Approved Sales by Customer for Period
|   `-- Cancelled Orders by Week
`-- Salespeople
    `-- Customer Lead Allocation
```

This is not yet the complete Reporting tree. It contains only paths with
retained proof from prior read-only runs.

## Reporting surface

| Menu path | Type | Parameters established | Output |
| --- | --- | --- | --- |
| Reporting > Campaign Reporting > New Business Leads Sold by Allocation | Crystal report | Start/end date, top count and five Boolean layout/scope selectors | XLSX Data-only |
| Reporting > Sales > Approved Sales by Customer for Period | Crystal report | Start/end date, new-customer-only, summary-only, group-by-salesperson and seven Asset Groups | XLSX Data-only |
| Reporting > Sales > Cancelled Orders by Week | Crystal report | Start/end date, publications, dependent editions, group-by-week and inactive-only | XLSX Data-only |
| Reporting > Salespeople > Customer Lead Allocation | Report dialog | Customer ID | PDF or explicit empty result |

`CARMA-REPORT-CATALOG.md` contains the parameter-level detail.

The saved browser cache also contains eight technical Crystal report
filenames. Two corroborate known reports and six are unplaced report
references. Three of the unplaced reports retain a total of eight safely
sanitized parameter definitions. They remain outside the proven tree until a
menu path is observed.

## Non-report operational surface

### Debt Collections

`Debt Collections` is a top-level operational screen rather than a Reporting
submenu report. It is included because it exposes important read-only
historical data and also contains dangerous business-record controls.

Safe observed surface:

- Debt Collections Batch dropdown;
- period/start/end filters;
- virtualized results grid;
- displayed Order Amount, Payments and Amount Owing totals.

Never activate its grid checkboxes, export actions, batch-creation controls or
unknown Additional Actions during mapping.

### Customer Management

Retained captures at route `/CustomerManagement` consistently showed these 12
contextual tabs across all 25 sampled artifacts:

1. Address
2. Admin Notes
3. Admin Notes (Show all)
4. Company
5. Contacts
6. History
7. Invoicing Summary
8. OrderSummary
9. Payments
10. Sales History
11. Sales Totals
12. Summary

This proves the visible tab labels, not the controls or business rules inside
them. No customer record should be selected solely to map these tabs.

### Campaign Allocations

The `Campaigns` destination has retained read-only extraction proof for a
Campaign Allocations grid at `/CustomerManagement`.

Observed filters and surface:

- Start Date and End Date;
- Admin Campaigns Only;
- Salespeople selector;
- virtualized allocation grid; and
- identifiers, quantity/actioned/remaining, created date, manager, allocation
  target/source and name-detail fields.

The grid is mixed-risk. Mapping must not create, edit, delete, allocate,
reallocate, save or select business rows for action.

### Our People

The `Our People` destination has retained proof for a filterable people
directory at `/CustomerManagement`.

Observed surface:

- Active Only;
- grid field selector and read-only filters;
- account, employment, role, login and contact fields; and
- a 200-record grid ceiling.

This screen contains personal and employment information. Mapping must avoid
record changes, password fields/actions, save controls and bulk actions. Field
names are inventoried, but no field values are copied into the map.

## Evidence classification

- `live_current_ui`: observed again in the authenticated current mapping pass.
- `prior_live_proof`: retained output or a proven read-only process exists.
- `local_process_contract`: present only in saved automation/configuration.
- `unknown`: cannot yet be established safely.

No entry is silently upgraded from prior proof to current proof.

## Authentication note

Four 30 July attempts used the saved encrypted credential. The latest sequence
first opened Carma's `/Logout` route, which returned to the root login form,
then made a clean sign-in submission. Carma again reloaded the empty login
form without an error or fresh 2FA challenge. No credential, one-time code or
login screenshot is stored in this inventory. The current-UI traversal
therefore remains pending.
