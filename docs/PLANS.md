# Plans
This file tracks execution plans for Sales Dashboard.

## Active Plans
- Review workflow controls
  - Goal: make stored alert and manager-review state editable from the dashboard instead of API-only.
  - Scope: acknowledge/dismiss alerts, save manager confirmations, filter review state, and show resolved history.
  - Risks: avoid treating manager corrections as model truth without versioning.
  - Verification: add API and browser tests around review actions.
  - Status: future work.

## Completed Plans
### MVP Call Intelligence Dashboard
- Goal: build a local first version that loads the July 1 CSV, respects privacy-reduced phone data, evaluates transcripts locally, and renders usable sales operations views.
- Scope shipped: CSV parsing, call deduplication, data-confidence panel, ignored field guardrails, deterministic transcript evaluation, follow-up linking through stable IDs, alert centre, manager review queue, salesperson/source scorecards, sanitized call explorer, and automated tests.
- Risks handled: phone values are ignored, invalid customer date/import date values are ignored, sales/revenue metrics are marked unsupported, and transcript text is escaped before rendering.
- Verification: `node --test tests/*.test.js`; real CSV load via `loadAnalysis("C:/Users/User/Downloads/July 1 Data.csv")`.
- Status: complete.

### Local Persistence And Reports Library
- Goal: persist scheduled import history and make generated reports accessible from the dashboard.
- Scope shipped: local ignored JSON store, import summaries, sanitized evaluation artifacts, alert events, manager-review records, automatic executive-summary reports, `POST /api/reports`, report/detail APIs, import history UI, and Reports Library UI.
- Risks handled: raw CSV is not copied into Git, redacted phone values remain unused, and report content is local-only.
- Verification: `node --test tests/*.test.js`; real CSV load creates an import snapshot and automatic report.
- Status: complete.

### Lead Utilization Follow-Up Leakage Report
- Goal: prove who is and is not utilizing leads without relying on redacted phone numbers.
- Scope shipped: automatic lead-utilization report on each import, stable lead-day matching, strict callback-duty detection, future-callback pending status, no-contact retry coverage, salesperson risk table, evidence samples, and report-library viewer support.
- Risks handled: callback proof excludes loose sales-script wording such as "later this year"; phone numbers and invalid customer date/import fields remain unused.
- Verification: `node --test tests/*.test.js`; real July 1 CSV load creates `Lead Utilization And Follow-Up Leakage - July 1 Data.csv`.
- Status: complete.

### Drill-Down Proof Layer
- Goal: make dashboard/report numbers auditable by opening the exact call rows or lead-day records behind them.
- Scope shipped: `/drilldown` HTML page, `/api/drilldown` JSON endpoint, `/calls/<call-id>` proof page, `/api/calls/<call-id>` JSON endpoint, dashboard metric links, salesperson/source metric links, lead-utilization metric links, report drill-down links, sanitized raw source fields, full local transcript proof, and manager review form submissions.
- Risks handled: `dialled_phone_number`, `CustomerCreateDate`, and `CustomerImportDate` are excluded from raw proof fields; full drill-down rows are kept out of `/api/summary`.
- Verification: `node --test tests/*.test.js`; browser verification of dashboard links, lead drill-down page, call proof page, raw-field exclusions, and report drill-down links.
- Status: complete.

### Local AI Execution Layer Integration
- Goal: route optional local model transcript work through `C:\Users\User\Desktop\ai-execution-layer`.
- Scope shipped: execution-layer adapter, environment-driven configuration, `/api/ai/status`, transcript-evaluation submission endpoint, job polling proxy, local AI job references in the store, call-page submission panel, and integration documentation.
- Risks handled: credentials are environment-only, model runtimes are not called directly, deterministic rules remain the baseline, and Sales Dashboard stores job references rather than raw model outputs.
- Verification: `node --test tests/*.test.js`.
- Status: complete.

### Readable Transcript Evidence Display
- Goal: make transcript evidence easy to scan in dashboard/report tables while preserving raw proof for audit.
- Scope shipped: evidence summaries on dashboard, drill-down, alert, review, explorer, and lead-utilization report surfaces; ordered transcript proof cards on call pages; readable full-transcript turn view; raw transcript retained below the readable view.
- Risks handled: proof snippets no longer start mid-word or flatten several transcript fragments into one table cell; source transcript order is preserved in proof turns instead of being re-sorted by the UI.
- Verification: `node --test tests/*.test.js`; browser verification at `http://127.0.0.1:3101` for drill-down proof summaries, call proof cards, report proof-summary samples, desktop layout, and mobile-width overflow.
- Status: complete.

## Planning Rules
- Keep the MVP grounded in current CSV evidence.
- Do not add sales/revenue claims until reliable fields exist.
- Treat LLM outputs as a future versioned layer, not as a hidden replacement for deterministic checks.
