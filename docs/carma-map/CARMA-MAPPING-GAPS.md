# Carma Read-Only Mapping Gaps

## Completion status

The navigation and report inventory is not complete yet.

The current machine-readable inventory contains 38 navigation entries, four
proven reports and four proven screens. Retained evidence establishes the
16-item primary workspace navigation, the 17-item application menu and 12
Customer Management contextual tabs. It still cannot prove the complete
submenu surface visible on 30 July 2026.

Separate sanitized cache evidence identifies six additional technical report
files not yet placed in the menu tree. Three have parsable parameter schemas.
Their endpoint history does not establish their current display labels,
locations or permissions.

## Current blocking condition

The saved encrypted credential has now been submitted four times in the
in-app browser. The latest sequence first opened Carma's `/Logout` route,
which returned to the root login form, and then submitted a clean sign-in.
Carma reloaded the same empty login form without an error or new 2FA challenge.
No operational control was activated and no login-stage screenshot was taken.

This is recorded as an authentication/runtime issue, not as evidence that the
account lacks access.

## Evidence still required

- current verification of the retained top-level menus and tabs;
- every submenu under each top-level menu, especially the complete Reporting
  branch;
- every sibling item, including pages that have never been extracted;
- placement and exact UI labels for the six unplaced cached report
  references;
- exact current ordering and duplicate labels;
- every report under every Reporting category;
- current parameter labels, defaults, control types and safe-to-observe
  options;
- the seven Approved Sales Asset Group labels;
- full export-format lists where they can be inspected without exporting;
- contents of the top-level `Pay Reporting` and `Sales Team Reports`
  destinations without assuming they are Reporting submenus;
- current permission-denied/hidden states visible to this account; and
- a second-pass revisit proving that no visible branch was skipped.

## Explicit unknowns

- hidden administrator-only modules;
- modules available only to other roles;
- routes not reachable from the current navigation;
- backend jobs and integrations not represented in the UI;
- effects of operational buttons that cannot be tested without mutation; and
- business rules that require creating or changing a real record.

These remain unknown rather than being inferred.

## Completion test

The inventory may be called complete only when:

1. an authenticated current-UI pass records every visible top-level item;
2. each expandable item is opened and all visible children are captured;
3. every visible Reporting leaf is classified and parameter-inventoried;
4. a second traversal returns the same visible route set or explains the
   difference;
5. unknown and mutating controls remain unactivated;
6. the machine-readable inventory and human-readable map reconcile; and
7. the final browser log shows zero state-changing actions.
