# Autonomous Backlog

Allowed statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

| ID | Priority | Task | Status | Blocker / Boundary | Next Action | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | P0 | Boot local web app and import call exports | DONE | - | - | Health and active import verified |
| 2 | P0 | Persist local import, alert, review, report, and archive history | DONE | - | - | JSON/SQLite stores pass integrity checks |
| 3 | P0 | Enforce excluded phone, legacy-field, allocation, and commercial-claim boundaries | DONE | - | - | Tests and live projections show no forbidden use |
| 4 | P1 | Provide transcript proof and manager review overlays | DONE | - | - | Call page shows evidence and non-destructive review history |
| 5 | P1 | Provide six evidence-focused dashboard workspaces | DONE | - | - | Browser checks pass with no semantic scores or model controls |
| 6 | P0 | Complete comprehensive local-model accuracy audit | DONE | - | - | Technical and semantic evidence separated for every evaluator |
| 7 | P0 | Stop Qwen Spiel after repeated narrow semantic failure | DONE | Same-model rescue prohibited | - | V3-v6 preserved as failed/stopped research only |
| 8 | P0 | Enforce machine-readable capability register end to end | DONE | - | - | All submission/consumption paths fail closed for unpromoted capabilities |
| 9 | P0 | Quarantine active unpromoted jobs and runs | DONE | - | - | Zero active model jobs/runs; history preserved |
| 10 | P0 | Remove scheduled/ad-hoc unpromoted execution | DONE | - | - | Scheduled task absent/disabled; controllers reject before network access |
| 11 | P0 | Retire Lead Harvest and model-backed operational actions | DONE | - | - | APIs/UI unavailable and historical logic has no active consumer |
| 12 | P0 | Convert Evaluation Studio to research-only archive | DONE | - | - | No create/submit/run/resume/harvest controls; authority is none |
| 13 | P0 | Null active semantic projections and retain literal evidence only | DONE | - | - | Active DB audit shows semantic fields null and literal evidence complete |
| 14 | P0 | Reconcile documentation with trusted runtime boundary | DONE | - | - | Startup, architecture, plan, quality, context, runtime, and decision docs agree |
| 15 | P1 | Add recurring scheduled import automation | TODO | Watched/drop-folder contract not chosen | Define an import-only scheduler that has no model dependency | New exports ingest predictably without enabling inference |
| 16 | P1 | Add authentication for non-local/multi-user use | TODO | Product scope not approved | Define users, roles, and deployment boundary | Review actors are authenticated and authorised |
| 17 | P2 | Optimise Evaluation Studio archive pagination | TODO | No proven urgency beyond slower archive reads | Measure archive latency and query paginated SQLite directly if warranted | Archive reads meet agreed local latency without changing history |
| 18 | P0 | Research a future semantic evaluator | BLOCKED | No materially different candidate or approved frozen program | Do nothing until the conditions in `docs/LOCAL_MODEL_CAPABILITY_POLICY.md` are met | Exact capability passes predeclared genuinely unseen gates and receives separate operational approval |
| 19 | P0 | Make evaluator authority and failure evidence understandable | DONE | - | - | Studio catalog shows scope, provenance, authority, exclusions, evidence, failure, and next action for every registered capability |
| 20 | P0 | Isolate genuinely unseen benchmark truth | DONE | - | - | Manifests exclude prior/current use, labels require exact quotes in batches of at most five, freezes are immutable, and no benchmark route calls a model |
| 21 | P1 | Add deterministic voicemail and inbound evidence | DONE | - | - | Exact prompt/message/chronology/linkage/handler facts are visible without causal, receptiveness, or commercial inference |
| 22 | P0 | Validate a materially different semantic candidate | BLOCKED | No approved candidate; Qwen family hard-stopped | Use the existing strict promotion partition only after a materially different candidate and explicit authorisation exist | At least 100 frozen balanced calls pass predeclared thresholds/budgets, then receive separate external approval |
| 23 | P1 | Add optional voicemail-pilot attribution import | DONE | - | - | Invalid/ambiguous records fail closed; explicit callback/sale/profit facts retain provenance; tests, browser checks and trusted-boundary audit pass |

## Governing Rule

Items 18 and 22 are not normal implementation backlog. They must not be advanced through another Qwen prompt, decomposition, replay, or adjacent fact lane. The Validation Lab is infrastructure for falsification, not evidence that any candidate works. The deterministic/literal product remains the required operating state unless a genuinely new research program is explicitly approved.
