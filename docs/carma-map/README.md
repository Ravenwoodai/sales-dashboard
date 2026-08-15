# Carma Read-Only Mapping Snapshot

## Purpose

This folder preserves the sanitized Carma navigation and report inventory
created in the sibling `Carma Reports` workspace. It is durable context for
future Sales Dashboard work and for designing a smaller read-only Carma
replacement.

The snapshot contains structural metadata only:

- exact retained top-level navigation sequences;
- known Reporting paths and parameter schemas;
- safely observed screens, tabs, filters and field names;
- conservative safety classifications;
- unplaced cached Crystal report references; and
- explicit mapping and authentication gaps.

It contains no raw Carma report rows, customer or contact values, credentials,
one-time codes, browser state or session values.

## Current coverage

- 38 machine-readable navigation entries.
- 16 retained primary workspace items.
- 17 retained application-menu items.
- Four reports with proven menu paths and parameters.
- Four mapped operational screens.
- Twelve retained Customer Management tabs.
- Eight cached technical Crystal report references, including six whose
  current display labels and menu paths remain unknown.
- Zero recorded Carma mutations and zero selected business rows.

The current mapping estimate is approximately 35–45% of a complete functional
Carma specification. It is sufficient to start a recognisable read-only lite
replica, but not to reproduce Carma's write workflows or switch off the legacy
system.

## Resume point

The local evidence sweep is complete. Current live verification is blocked
because Carma reloads the empty login form after submitting the saved
credential, without displaying an error or a fresh 2FA challenge.

When authentication works again:

1. reuse the saved encrypted credential first;
2. request a new one-time code only if Carma visibly presents a fresh 2FA
   challenge;
3. expand every visible menu and submenu without activating operational
   controls;
4. place the six cached report references in their exact current menu paths;
5. capture remaining report parameters, defaults and safe option lists;
6. perform a second traversal to prove no visible branch was skipped; and
7. keep the mutation and business-row-selection counters at zero.

## Files

- `CARMA-APPLICATION-MAP.md`: human-readable navigation and screen map.
- `CARMA-REPORT-CATALOG.md`: known reports, parameters and unplaced report
  references.
- `CARMA-MAPPING-GAPS.md`: current authentication blocker and remaining
  evidence.
- `carma-read-only-inventory.json`: machine-readable canonical inventory.
- `retained-navigation-evidence-2026-07-24.json`: sanitized retained
  navigation/tab observations.
- `cached-report-evidence.json`: sanitized cached report filenames and prompt
  schemas.
- `snapshot-manifest.json`: hashes and reconciliation counts for this snapshot.

## Refresh

From the Sales Dashboard repository:

```powershell
node scripts/sync-carma-navigation-map.js --source-dir "<path-to-Carma Reports>"
```

The synchronizer validates the strict read-only counters, supported schemas
and sensitive-content guardrails before copying the snapshot.
