# Session Handover

Date: 2026-07-23

## Outcome

Sales Dashboard now operates inside an enforced zero-promoted local-model boundary. Evaluation Studio is a controlled validation laboratory with a capability catalog, deterministic voicemail/inbound evidence, optional fail-closed source-system pilot attribution, an isolated human-labelled benchmark store, and a separately marked immutable historical research archive. Historical Qwen work is research-only and cannot submit, route, score, rank, coach, or create operational actions.

## Capability State

- Policy: `docs/LOCAL_MODEL_CAPABILITY_POLICY.md`
- Register: `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`
- Audit: `runtime/LOCAL_MODEL_COMPREHENSIVE_AUDIT_2026-07-22.md`
- Program status: `semantic_capability_boundary_rejected`
- Audited capabilities: 20
- Promoted capabilities: 0
- Live submission permitted: false
- Operational consumption permitted: false
- Qwen Spiel v3-v6: failed/stopped research; no further Qwen inference or same-model decomposition.

## Remediation Completed

- Added/pinned register validation in `src/localModelCapability.js`.
- Applied fail-closed assertions to direct AI routes, Evaluation Studio, result ingestion, automatic routing/polling, overnight controller, and ad-hoc controller.
- Quarantined 167 queued jobs and five queued Evaluation Studio runs without deleting history.
- Verified the `Sales Dashboard Overnight Evaluations` Windows task is present but disabled; it was not enabled, run, or changed during the rebuild.
- Retired Lead Harvest and operational model-result ingestion.
- Made Opportunities explicitly unavailable and rebuilt Evaluation Studio as a fail-closed validation laboratory.
- Locked Evaluation Studio knowledge/template edits, quarantine/resume/harvest, semantic feedback, and result-to-review handoff so the research archive is genuinely read-only.
- Added a read-only catalog for all 20 registered capabilities. Every entry shows exact scope, exclusions, provenance, failure evidence, status, authority `none`, and the only permitted next action.
- Added a deterministic voicemail-recovery evidence lane. It uses closed transcript phrases, strict chronology, exact stable-ID linkage, and explicit ambiguity handling; it never infers callback causation, receptiveness, sale, gross profit, or commercial uplift.
- Added optional voicemail-pilot CSV/XLSX validation through `--voicemail-pilot` or `SALES_DASHBOARD_VOICEMAIL_PILOT_PATH`. It validates source preassignment, event/call linkage, source handler, CRM outcome, signed minor-unit gross profit and separate currency facts in memory only.
- Invalid pilot assignments never enter treatment/control denominators. Invalid message/callback/sale/profit facts become measure-level `not_scored`. Callback lift is withheld unless both arms exist and every accepted assignment has a complete equal-duration observation window.
- Pilot loading creates no model job, Evaluation Studio run/result, review, queue, active-intelligence mutation, CRM write or persisted pilot row.
- Added an isolated Validation Lab store and safe manifest/label/freeze routes. Labels require an exact transcript quote and turn, are entered in batches of at most five, and never create operational work.
- Added a strict promotion-candidate test requiring a frozen 100-call unseen benchmark, balanced positive/hard-negative/unsupported cases, post-freeze candidate results, exact evidence provenance, declared resource ceilings, and zero critical errors. Passing establishes eligibility for external approval only and never self-promotes.
- Removed semantic team-performance UI and active model-backed rollups/queues.
- Reduced transcript evaluation to exact literal states/events only.
- Set active semantic call, event, and lead projections to null/unknown.
- Preserved call transcript proof and explicit manager review overlays.
- Reconciled product, specification, architecture, system map, constraints, plans, quality, project context, decisions, backlog, blockers, and this handoff.

## Live Runtime

- Browser verification used an isolated AI-disabled server at `http://127.0.0.1:3042/`; that server was stopped after verification.
- Source: `data/source/CallData 07.07.2026.csv`
- Active import: `import_41f2f2d8a2f439c7e92f`
- Calls: 19,914
- Health: `status=ok`, CSV loaded, AI execution disabled/unconfigured.
- The isolated verification server was started with `SALES_DASHBOARD_AI_ENABLED=false`.
- A separate service may still listen on port 8080 for another project. Sales Dashboard is disconnected; do not stop that service merely for this project.
- Temporary pilot UAT servers on ports 3042-3044 were stopped after populated, empty, invalid-source and mobile verification. Pre-existing Sales Dashboard processes on ports 3040/3041 were not restarted or stopped.

Restart safely with:

```powershell
$env:PORT='3042'
$env:SALES_DASHBOARD_AI_ENABLED='false'
node src/main.js --csv "data/source/CallData 07.07.2026.csv"
```

To load a real pilot export after it is supplied, append:

```powershell
--voicemail-pilot "<local pilot.csv or .xlsx>"
```

The exact columns and proof rules are in `docs/VOICEMAIL_CALLBACK_ATTRIBUTION.md`. Do not adapt an ordinary call/analysis export into a pilot file; missing source events must remain unavailable.

## Recoverable Baseline

- Online-safe backup: `data/store/backups/trusted-baseline-20260723-080137/`.
- `state.json`, `intelligence.sqlite`, and `evaluation-studio.sqlite` were copied with hashes recorded in `BACKUP_MANIFEST.md`.
- Both backup SQLite files passed `PRAGMA integrity_check=ok`.
- Trusted implementation baseline commits before the pilot change: `2790f14` and `c1a7eb8`.

Do not restart without the CSV argument unless an equivalent configured path exists.

## Database Audit

### `data/store/intelligence.sqlite`

- `PRAGMA integrity_check`: `ok`
- Active calls: 19,914
- `llm_status=not_requested`: 19,914
- Audited semantic call columns non-null: 0
- Audited semantic event confidence/follow-up columns non-null: 0
- Audited semantic lead score/quality/human/meaningful/next-step fields non-null: 0
- Literal outcomes: 1,972 voicemail; 1,149 system audio; 97 wrong number; 14 opt-out; 16,682 unknown
- Every literal event/risk record has exact evidence.

### `data/store/evaluation-studio.sqlite`

- `PRAGMA integrity_check`: `ok`
- Runs: 148 total; 108 current-import
- Current run states: 93 completed, 5 failed, 9 partially completed, 1 quarantined
- Active runs: 0
- Results: 4,313 total; 3,894 current-import; 3,835 latest/research-only

### `data/store/state.json`

- Jobs: 4,557 total
- Done: 4,380
- Failed: 10
- Quarantined: 167
- Active: 0

### `data/store/evaluation-validation-lab.json`

- Separate from both production intelligence and the historical Evaluation Studio archive.
- Not created during this rebuild because no real benchmark manifest was started.
- Writes atomically on first use and fails closed on corruption.
- Current unseen-candidate proof: 19,914 source calls; 2,188 excluded call IDs across 42 evidence files.

## API Boundary Proof

The following live requests were tested and left job/run/result counts unchanged:

- `GET /api/lead-harvest` -> `410`
- `POST /api/ai/transcript-evaluation` -> `410`
- `POST /ai/transcript-evaluations` -> `410`
- `POST /api/evaluation-studio/results` -> `410`
- `POST /api/evaluation-studio/runs` -> `423`
- `POST /api/evaluation-studio/prompt-tests` -> `423`
- `POST /api/evaluation-studio/runs/<id>/harvest` -> `423`
- `POST /api/evaluation-studio/runs/<id>/resume` -> `423`
- Evaluation Studio knowledge/template/archive/feedback/review-handoff mutations -> `423`

The only newly permitted Evaluation Studio writes are benchmark-only HTML form routes for manifest creation, exact-evidence labels, and manifest freeze. They write only the isolated Validation Lab store, have no model path, and do not mutate jobs, runs, results, active intelligence, or historical research.

Direct overnight/ad-hoc controller execution also fails before network access because `call_intelligence_foundation_complete` is unpromoted.

## Browser Proof

- Checked Evaluation Studio at desktop and 390-pixel mobile widths, plus call 48542628.
- No Lead Harvest surface, model-run control, semantic quality score, human-answer rate, meaningful-conversation rate, or hidden team semantic panel was visible.
- Evaluation Studio presents the no-model boundary first, then capability truth, deterministic evidence, Validation Lab, and only then the historical archive. It exposes no model run/create/submit controls.
- The voicemail evidence lane showed the exact machine prompt and Dylan's literal callback request for call 48542628.
- No desktop or mobile horizontal overflow was present.
- Browser console warnings/errors: none.
- Pilot UAT covered a valid populated source, no configured source, a schema-invalid source, and a 390-pixel mobile viewport. Valid facts rendered with no model/action controls; missing/invalid inputs remained unavailable or rejected; mobile horizontal overflow was false.
- During final UAT, a fixture server was initially started without an isolated store and temporarily added two synthetic `sample.csv` imports/summaries. The real 19,914-call import was immediately restored; the exact synthetic state/artifacts were removed after comparison with the pre-UAT backup; a recoverable copy remains under ignored `tmp/uat-fixture-contamination-20260723/`. Final state has 3 imports, 12 reports, zero `sample.csv` records, and the trusted-boundary audit again passes on import `import_41f2f2d8a2f439c7e92f`.
- Future fixture browser checks must set `SALES_DASHBOARD_STORE_PATH` to a temporary isolated state file. Do not use the default store for fixture data.

## Verification

- Final automated suite: 354/354 passed.
- Trusted-boundary audit: `ok=true`, zero violations, 20 capabilities, zero promoted, 19,914/19,914 calls `llm_status=not_requested`, zero active jobs, and zero active runs.
- Sixteen adversarial historical/model mutation requests returned only `410` or `423`; job/run/result counts and the logical historical archive hash were unchanged.
- Run `npm test`.
- Run `npm run audit:trusted-boundary` for the reusable read-only capability/database/job/run invariant audit.
- Run `git diff --check`.
- Validate `docs/PROJECT_CONTEXT.json` as JSON.
- Check both SQLite databases with `PRAGMA integrity_check`.
- Check `/health` for zero promoted capabilities and disabled operational consumption.
- Re-run the adversarial mutation set after changing any AI/Evaluation Studio route.
- Browser-check all six workspaces and the archive after changing rendering.
- For pilot changes, browser-check populated, not-configured, invalid-source and 390-pixel states; verify store job/run/result counts are unchanged.

## Next Useful Action

- Obtain a real source-system pilot export with the exact immutable identifiers and timestamps in `docs/VOICEMAIL_CALLBACK_ATTRIBUTION.md`.
- Validate it first in Evaluation Studio. Do not interpret recorded callbacks as lift unless both preassigned arms and complete equal-duration outcome windows pass.
- Record pilot costs separately before calculating net contribution; this implementation deliberately does not infer or invent costs.

## Non-Negotiable Next-Session Rules

- Do not submit a local-model job.
- Do not enable the scheduled task or clear controller halts.
- Human labels are benchmark truth only, never a routine review queue. Quiz with exact call quotes in batches of at most five.
- Unsupported cases are scored as `not_scored`; do not force an answer outside the declared evidence boundary.
- Do not treat Validation Lab gate eligibility as promotion. Promotion remains an explicit external approval after all gate evidence exists.
- Do not call historical Foundation, Offer, Callback, Objection, Procedure, Lead Record, Spiel, or Harvest output authoritative.
- Do not repopulate active semantic columns from historical model results.
- Do not use technical success as semantic promotion.
- Do not rescue Qwen with another decomposition.
- Preserve unknown when evidence is not covered by an exact trusted rule.
