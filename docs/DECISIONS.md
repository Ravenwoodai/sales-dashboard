# Decision Log
This document records durable decisions for Sales Dashboard.
Use short ADR-style entries so future agents know not just what changed, but why.

## ADR Format
Each entry should include:
- Decision ID
- Date
- Status
- Decision
- Context
- Consequences

## ADR-001 - Repository-Local Knowledge Is The System Of Record
Date: 2026-07-05
Status: Accepted
Decision: Important product and engineering context must live in the repository, not only in chat or memory.
Context: Agents can only act on what they can discover while running.
Consequences:
- onboarding becomes faster
- context is more durable
- documentation upkeep becomes part of normal development

## ADR-002 - Plans And Quality Are First-Class Artifacts
Date: 2026-07-05
Status: Accepted
Decision: Meaningful work should update docs/PLANS.md and docs/QUALITY_SCORE.md instead of leaving intent and debt implicit.
Context: Fast iteration without visible plans and quality signals creates drift.
Consequences:
- easier handoffs
- clearer prioritization
- explicit debt tracking

## ADR-003 - Prefer Small, Verifiable Changes
Date: 2026-07-05
Status: Accepted
Decision: Favor the smallest change that can be verified end-to-end.
Context: Smaller diffs are easier for agents to reason about and recover from.
Consequences:
- lower regression risk
- faster reviews
- fewer cascading documentation mismatches

## ADR-004 - Ignore Redacted Phone Values For MVP Analytics
Date: 2026-07-05
Status: Accepted
Decision: `dialled_phone_number` is intentionally incomplete for security and must not be used for matching, repeat-contact metrics, inbound attribution, follow-up linking, phone-quality scoring, or dashboard display in the MVP.
Context: The source system provides privacy-reduced phone values. Treating them as bad data or trying to reconstruct identity would violate the product's privacy boundary.
Consequences:
- stable source IDs are the only allowed linkage keys in the MVP
- missing stable IDs produce unknown linkage instead of inferred linkage
- a future `secure_contact_key` would be the right privacy-safe way to support phone-level matching

## ADR-005 - Start With Deterministic Local Evaluation
Date: 2026-07-05
Status: Accepted
Decision: The MVP uses deterministic local transcript rules before introducing an LLM-backed evaluator.
Context: The first product slice needs auditable, private, testable behavior from the current CSV.
Consequences:
- no transcript data leaves the machine
- evaluation can be tested with fixtures
- future LLM outputs must be schema-validated and versioned rather than silently replacing current logic

## ADR-006 - No Sales Or Revenue Claims From Current CSV
Date: 2026-07-05
Status: Accepted
Decision: The dashboard must not claim confirmed sales conversion, revenue, order value, close date, revenue attribution, or won/lost commercial outcome from the current data.
Context: The current CSV lacks reliable sales/revenue outcome fields.
Consequences:
- dashboard language stays focused on call quality, contactability, follow-up signals, source quality, and review queues
- future data requests should prioritize confirmed outcome and value fields before conversion dashboards are built

## ADR-007 - Store Derived Artifacts Locally Under Ignored Data Folder
Date: 2026-07-05
Status: Accepted
Decision: Persist import history, sanitized evaluation artifacts, alert/review state, and generated reports under `data/`, which is ignored by Git.
Context: The product needs history and a report library, but raw CSVs and transcript-derived artifacts should remain local and out of source control.
Consequences:
- dashboard history survives server restarts
- generated reports can be viewed later from the dashboard
- JSON-file storage remains simple for MVP but may need SQLite when concurrency or larger history arrives

## ADR-008 - Future Generated Reports Must Enter The Reports Library
Date: 2026-07-05
Status: Accepted
Decision: When Codex generates a data extract, analysis, or report for the user, it should save a report record through `POST /api/reports` or `saveGeneratedReport(...)`.
Context: The user wants generated data and reports accessible from the Sales Dashboard instead of stranded in chat.
Consequences:
- report title, summary, markdown content, metadata, and timestamps are retained locally
- the dashboard becomes the default place to revisit generated analysis
- future agent work should include report-saving as a normal closeout step when a report is produced

## ADR-009 - Allocation Coverage Uses Aggregate-Safe Joins
Date: 2026-07-07
Status: Superseded by ADR-010
Decision: Lead allocation workbooks can be incorporated as their own dashboard section, but call-record enrichment must join only by date + salesperson + type until the allocation export provides a shared campaign/list ID or stable lead ID.
Context: The July 7 allocation workbook contains campaign, allocated/actioned/remaining counts, date, manager, salesperson, and type. It does not contain lead IDs or a campaign/list key that appears in the call records.
Consequences:
- allocation `QTY ACTIONED` remains an operational source field, not a replacement for raw call count
- campaign rows are allocation-side totals only
- call observations such as stable lead-days, live-human rate, meaningful conversation rate, and one-attempt/no-contact are shown as aggregate comparisons
- future campaign-level attribution requires a new shared identifier, not name matching or phone inference

## ADR-010 - Park Separate Campaign/Allocation Imports
Date: 2026-07-08
Status: Accepted
Decision: Separate campaign/allocation imports are preserved but parked from active dashboard use.
Context: The allocation workbook created confusing allocation-versus-call comparisons and could be over-read as salesperson, campaign, source, or completion performance. The reliable product scope is call/transcript data plus call CSV fields.
Consequences:
- active analysis no longer builds allocation coverage or reconciliation metrics
- `/api/allocations` returns diagnostic parked status only
- normal dashboard navigation, cards, reports, alerts, scorecards, source/list quality, and AI transcript context exclude separate allocation import data
- raw parser code and existing data are preserved for a future explicit decision
- `AllocatedLeadID` remains an allowed call CSV field for call-based matching and raw inspection, but not for allocation-performance inference

## ADR-011 - Alert Lifecycle State Is A Non-Destructive Overlay
Date: 2026-07-08
Status: Accepted
Decision: Alert lifecycle actions are stored as manager workflow metadata over generated call-data alerts, not as rewrites of the generated alert evidence.
Context: Managers need to acknowledge, progress, resolve, dismiss, reopen, note, and mark likely false positives without losing why an alert originally fired. The app is still local-only and has no real user authentication.
Consequences:
- active alert counts include only `new`, `acknowledged`, and `in_progress`
- `resolved`, `dismissed`, `false_positive`, and parked alerts are preserved but excluded from active alert totals
- lifecycle history and manager notes remain auditable in the local JSON store
- authoritative lifecycle actors use the server-resolved `local_manager` placeholder until authentication exists; client-supplied actor names are ignored
- parked allocation-related alerts stay excluded from normal alert workflow endpoints and dashboard views

## ADR-012 - Active Report APIs Hide Parked And Superseded Report Content
Date: 2026-07-08
Status: Accepted
Decision: Normal report APIs and report viewer routes expose only active reports. Parked allocation, stale stable-target, stable lead-day, lead-day, and allocation-like report content remains preserved in the local store but hidden from normal `/api/reports`, `/api/reports/:id`, `/reports/<id>`, and dashboard Reports Library views.
Context: Batch 5 verification found that raw report APIs could still expose historical report bodies with superseded allocation/stable-target terminology even though active dashboard analytics had parked allocation data.
Consequences:
- `/api/reports` returns active, non-parked reports only and reports a hidden-report count
- `/api/reports/:id` and `/reports/<id>` return not-found behavior for hidden reports in normal mode
- `POST /api/reports` preserves hidden report records but does not echo hidden report bodies in its normal response
- stored records are preserved for future explicit admin/internal diagnostics or cleanup decisions
- `AllocatedLeadID` remains allowed in raw call-field context and is not treated as allocation report content by itself

## ADR-013 - Manager Review Corrections Are Governed Overlays
Date: 2026-07-08
Status: Accepted
Decision: Manager review state and corrections are stored as separate review/correction/history overlays instead of rewriting raw imported fields, deterministic evaluation outputs, LLM outputs, or generated alert evidence.
Context: Managers need to confirm, correct, dismiss, escalate, and note call-level or signal-level classifications while preserving the provenance of the original dashboard intelligence. Alert lifecycle already answers whether an alert has been triaged; manager review answers whether a human reviewed or corrected the underlying classification.
Consequences:
- review statuses are `unreviewed`, `review_needed`, `in_review`, `reviewed_confirmed`, `reviewed_corrected`, `dismissed`, and `escalated`
- manager review and alert lifecycle statuses are displayed and stored separately
- corrections use an explicit field allowlist and reject raw imported, metadata, alert-evidence, allocation, and campaign fields
- authoritative review actors use the server-resolved `local_manager` placeholder until authentication exists
- review history, correction reason, evidence assessment, previous displayed value, corrected value, notes, actor, and timestamp are preserved for audit
- aggregate metrics remain deterministic unless a manager-reviewed value is explicitly labelled as such
