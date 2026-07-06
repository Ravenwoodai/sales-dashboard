# Quality Score
Use this file to keep quality, risk, and debt visible in Sales Dashboard.

| Area | Score | Notes | Next Step |
| --- | --- | --- | --- |
| Product clarity | 4/5 | MVP scope is explicit: local CSV call intelligence, no sales/revenue claims, phone/date guardrails, local import history, and report library behavior are documented. | Add dashboard controls for manager review actions. |
| Architecture legibility | 4/5 | Main modules are separated across parsing, evaluation, analysis, storage, server, and rendering. | Consider SQLite only if JSON-file persistence becomes too limited. |
| Verification | 4/5 | Tests cover CSV parsing, phone/date exclusions, local mismatch detection, stable-ID follow-up linking, readable evidence summaries, import persistence, report saving, and review state. Browser checks covered the updated proof-summary and call-proof views. | Add automated browser/UI smoke tests once dashboard interactions become richer. |
| Runtime operability | 4/5 | App boots from `node src/main.js`, loads a configured CSV path, writes ignored local store artifacts, and exposes health, summary, imports, reports, and review APIs. | Add scheduled import automation when the source cadence is finalized. |
| Security hygiene | 4/5 | Redacted phone data is preserved only as raw input and excluded from MVP analytics/display; no external AI calls are made. | Add access controls before exposing transcript detail beyond localhost. |

## Current Risk Notes
- The deterministic evaluator is a useful first-pass triage layer, not a final human-quality AI review system.
- Alert volume is high on the July 1 CSV because many meaningful calls have blank imported dispositions.
- Follow-up completion is often indeterminate with a one-day upload because there is not enough future data.
- Transcript speaker order still depends on the CSV transcript source; the UI now preserves that order and avoids clipping evidence mid-word, but it does not perform diarisation correction.
- Local persistence is JSON-file backed under `data/`; it is suitable for MVP history but not multi-user concurrent review.

## Update Rules
- Increase or decrease scores when reality changes.
- Record major risks here instead of leaving them implicit.
- Link plan or decision updates when they change the score materially.
