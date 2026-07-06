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
