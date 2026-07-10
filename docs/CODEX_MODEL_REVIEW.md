# Codex Model Review

## Executive recommendation

Use **GPT-5.6 Terra with Medium reasoning** as the default Codex setup for most Sales Dashboard repository work.

This is not a recommendation to use the strongest model by default. The repository is now fairly well documented, locally testable, and bounded by explicit product guardrails. The dominant work is normal implementation, debugging, test repair, report wording, UI consistency, and governance-safe feature extension. The test suite is broad enough that Terra Medium should complete most tasks reliably without the delay and usage cost of defaulting to Sol.

Escalate to **GPT-5.6 Sol with High reasoning** for cross-cutting or high-blast-radius work: storage model changes, Evaluation Studio run/harvest semantics, local AI routing, manager-review governance, alert lifecycle semantics, privacy/security changes, concurrency, scheduled import automation, or any future financial/yield-management decision logic.

Downgrade to **GPT-5.6 Luna with Low or Medium reasoning** for narrow, repetitive, objectively testable work such as label changes, small renderer copy changes, single-helper tests, documentation sync, or one-file fixtures where acceptance criteria are explicit and `node --test tests/*.test.js` is expected to catch mistakes.

Test status during this audit: `node --test tests/*.test.js` passed with **106 passing tests, 0 failures**.

## Scope and repository evidence

This audit inspected repository files only and did not read or copy secrets, `.env` values, raw production records, customer data, or generated report contents from `data/` or `outputs/`. No application code, configuration, dependencies, data, or environment files were modified. The only created artifact is this report.

Key repository evidence:

| Area | Evidence |
| --- | --- |
| Agent operating model | `AGENTS.md:5-18` defines the startup docs; `AGENTS.md:20-29` defines source-of-truth docs; `AGENTS.md:31-35` says to prefer the smallest effective change, keep repo-local docs ahead of chat-only context, update plans/quality/runtime state, and escalate only when human judgment is needed. |
| Stack and run commands | `package.json:5-13` identifies a private local sales dashboard, main entry `src/main.js`, `npm start` as `node src/main.js`, and tests as `node --test tests/*.test.js`. No package lock or dependency manifest beyond `package.json` was found. |
| Product scope | `docs/PROJECT.md:6-30` describes local CSV/XLSX call intelligence, call deduplication, deterministic transcript classification, parked allocation imports, alert lifecycle, manager review, Evaluation Studio, report library governance, and no confirmed sales/revenue/conversion claims. |
| Non-goals and privacy | `docs/PROJECT.md:70-76` says allocation workbooks must not affect active analytics, confirmed sales/revenue claims are unsupported, redacted phone values must not be used for entity resolution, and transcripts/customer data must not be sent to external AI services. `SECURITY.md:5-8` treats transcripts, names, IDs, notes, and phone boundaries as sensitive. |
| Runtime architecture | `docs/ARCHITECTURE.md:4-23` maps the local Node runtime: `src/main.js`, CSV/XLSX normalization, `src/analysis.js`, AEST date formatting, parked allocation parser, global filters, alert lifecycle, manager review, deterministic transcript evaluator, JSON storage, Evaluation Studio, AI Execution Layer, renderer, and JSON APIs. |
| Active safety boundaries | `docs/ARCHITECTURE.md:48-61` states local artifacts live under ignored `data/`, transcript text is escaped, allocation is parked, lead harvest is review-only, alert/review overlays are non-destructive, Evaluation Studio artifacts are auditable metadata, and local model jobs are submitted only through the Execution Layer while the dashboard stores job references rather than raw outputs. |
| Persistence | `src/storage.js:52-69` defaults state to `data/store/state.json` with imports, alert events, manager reviews, AI jobs, Evaluation Studio artifacts, and reports. `src/storage.js:102-119` writes through a temp file and rename. `docs/QUALITY_SCORE.md:20` flags JSON storage as suitable for MVP history but not concurrent multi-user review. |
| SQLite sidecar | `src/intelligenceDatabase.js:1-24` uses Node's `node:sqlite`, sets foreign keys and WAL mode. `src/intelligenceDatabase.js:154-176` creates indexes and uses explicit transaction/rollback helpers. LLM result replacement uses transactional deletion/insertion at `src/intelligenceDatabase.js:996-1022`. |
| Filtering and denominators | `src/globalFilters.js:26-39` lists active filter dimensions, including manager review and alert status. `src/globalFilters.js:98-121` normalizes shared filter state. `src/globalFilters.js:337-363` applies date and value filters. `src/globalFilters.js:454-476` defines empty/low-sample warnings and denominator summaries. |
| Alert lifecycle | `src/alertLifecycle.js:5-16` defines statuses and active/closed semantics. `src/alertLifecycle.js:176-206` normalizes active/closed flags, evidence, confidence, provenance, and recommended action. |
| Manager review governance | `src/managerReview.js:5-18` defines manager review statuses and open/complete states. `src/managerReview.js:40-56` allowlists correction fields. `src/managerReview.js:59-90` blocks raw/protected/allocation/campaign fields. `src/managerReview.js:175-183` rejects protected or unknown correction fields. |
| Evaluation Studio | `src/evaluationStudio.js:45-82` defines run/result states and blocks allocation/stale report concepts. `src/evaluationStudio.js:135-152` defines strict result schema. `src/evaluationStudio.js:155-190` seeds Neuron/LatentPulse-derived knowledgebase material and requires evidence-aware, non-blaming evaluation. `src/evaluationStudio.js:667-671` sets guardrails against allocation, sales/revenue claims, guessing, and silent replacement of manager overlays. |
| AI integration | `src/aiExecutionLayer.js:25-37` resolves local AI config and defaults `model` to `auto`. `src/aiExecutionLayer.js:60-66` refuses submission unless the layer is enabled/configured. `src/aiExecutionLayer.js:81-123` removes parked allocation fields from AI input. `src/aiExecutionLayer.js:126-134` instructs the model to evaluate only supplied transcript/baseline and not invent outcomes or use parked allocation data. `src/aiExecutionLayer.js:301-320` submits to `/run-task` with idempotency key and bearer auth. |
| Evaluation run recovery | `src/main.js:1016-1053` auto-harvests small queued prompt-test runs on Studio/API reads. `src/evaluationStudio.js:1214-1289` implements non-destructive quarantine/resume with history metadata. |
| Report governance | `src/allocationParking.js:47-63` detects stale allocation/stable-target report language. `src/allocationParking.js:71-96` classifies hidden parked-data reports. `src/storage.js:750-832` filters active reports, parked alerts, current manager reviews, Evaluation Studio views, and active/closed/parked counts. `src/main.js:2243-2268` exposes only active reports through normal report APIs. |
| Test coverage | The audit run of `node --test tests/*.test.js` passed 106 tests. `docs/QUALITY_SCORE.md:8` says tests cover parsing, workbook dates, allocation parking, stale report filtering, filter denominator/drilldown consistency, lead harvest, alert lifecycle, manager review, Evaluation Studio, AI execution, SQLite, and privacy/date exclusions. |
| Gaps | `.codex/config.toml` was not present. `.github` CI/workflow directory was not present. `docs/QUALITY_SCORE.md:20-24` calls out JSON storage/concurrency and placeholder local actors as current risks. `runtime/AUTONOMOUS_BACKLOG.md:25` keeps scheduled import automation as TODO. A `src/main.py` file exists with "Agent Forge Web App Starter" HTML at `src/main.py:1-12`, but package/docs point to `src/main.js`; no references to `src/main.py` were found. |

Files related to `recommended-wave-01.csv`, autonomous yield management, learning loops, or margin/pricing automation were not found in active product code. Search hits for "pricing" were ordinary transcript/lead-harvest objection context, not pricing automation. The project has scheduled-import backlog entries, but no implemented cron/scheduler contract was found beyond local reload/import flows.

## Project stage and dominant task types

The project is in **stabilisation plus feature-growth**, not greenfield prototype and not mature multi-user production. The dashboard has many shipped governance features, but it still has MVP limits: local-only operation, JSON-backed workflow state, placeholder `local_manager` actor, no CI directory, and scheduled import automation not yet implemented.

Estimated work mix:

| Work category | Estimated share | Evidence and implications |
| --- | ---: | --- |
| 1. Clear, repetitive, objectively testable work | 25% | Label changes, report wording, Record Age-style field updates, simple filter options, docs/runtime note updates. Tests are quick and broad. Luna can often handle this. |
| 2. Normal implementation, debugging, testing, refactoring | 45% | Most recent work has touched `src/analysis.js`, `src/dashboardRenderer.js`, `src/main.js`, `src/storage.js`, and tests. Terra Medium is the best default because most changes have explicit local tests and clear guardrails. |
| 3. Ambiguous architecture and cross-cutting changes | 15% | Evaluation Studio, global filters, manager review, alert lifecycle, report hiding, AI execution, and persistence interact across many files. Terra High or Sol High should be used depending on blast radius. |
| 4. High-impact financial, security, data-integrity, or autonomous decision work | 5% now, higher if automation expands | The repo explicitly avoids confirmed sales/revenue/yield claims today. Security and data integrity risk still exist through transcript privacy, local AI payloads, report hiding, SQLite/JSON state, and actor attribution. Escalate to Sol High for these. |
| 5. Read-heavy investigations suitable for parallel subagents | 10% | Audits across docs/source/tests/runtime are common. A read-only Sol reviewer or parallel Terra/Luna subagents can help gather evidence, but final synthesis should stay with the lead model. |

Risk assessment:

- Requirement ambiguity is medium. Product rules are well documented, but sales/reporting language and governance semantics are nuanced.
- Architectural complexity is medium-high because metrics, filters, drilldowns, alerts, review overlays, reports, local AI jobs, and persistence interact.
- Test quality is good for a local MVP: 106 tests passed in this audit, and coverage spans core guardrails.
- Mistakes are mostly reversible in code, but less reversible if they pollute local report history, manager review state, AI result state, or user trust in lead-waste conclusions.
- Security/privacy consequences are meaningful: transcripts, names, IDs, notes, and prompt/knowledgebase content are sensitive.
- Financial/margin consequences are currently low because the app explicitly does not claim revenue or conversion. They become high if future work introduces sales attribution, pricing, yield, or operational automation.
- Latency/usage sensitivity matters because the project has high task volume and many routine verification loops.

## Development-time Codex recommendation

Default:

- **Model:** GPT-5.6 Terra
- **Reasoning:** Medium
- **Use for:** ordinary implementation, debugging, test repair, docs sync, UI/reporting clarity, deterministic analytics, dashboard rendering, API additions, and most reviews.
- **Confidence:** High

Why Terra Medium is enough most of the time:

- The repo has explicit startup/source-of-truth docs and working rules (`AGENTS.md:5-35`).
- The active stack is simple at the infrastructure layer: local Node entry, built-in test runner, no dependency graph, no package lock complexity (`package.json:5-13`).
- The current product guardrails are written down in durable docs (`docs/PROJECT.md:14-30`, `docs/ARCHITECTURE.md:48-61`).
- The test suite is broad and green: 106 passing tests during this audit.
- Most day-to-day work can be objectively checked with `node --test tests/*.test.js`.

Why not Sol by default:

- Sol High would be valuable but wasteful for the dominant work. Many tasks are local, bounded, and testable.
- The main risk is not lack of raw intelligence; it is keeping guardrails intact while making small changes. Terra Medium plus tests is a better speed/reliability tradeoff.
- Sol should be saved for high-blast-radius work where deeper judgment changes the outcome.

Why not Luna by default:

- Luna is too light as the default because this codebase has many subtle governance distinctions: alert lifecycle vs manager review, deterministic vs LLM vs manager-reviewed values, parked allocation vs raw `AllocatedLeadID`, report-safe language, and local AI result provenance.
- Luna is appropriate only when the task is narrow and verification is objective.

## Production-runtime model recommendation

The production runtime recommendation is separate from the development-time Codex recommendation.

Current application policy:

- The app should not call OpenAI, Ollama, vLLM, or provider runtimes directly from Sales Dashboard.
- `docs/AI_EXECUTION_LAYER.md:9` says local model processing goes through the Execution Layer API at `POST /run-task` so jobs are authenticated, routed, logged, and traceable.
- `src/aiExecutionLayer.js:25-37` resolves the local execution configuration and defaults the runtime model to `"auto"`.
- `src/aiExecutionLayer.js:301-320` sends jobs to the Execution Layer with a task type, model, response mode, metadata, and idempotency key.
- `docs/AI_EXECUTION_LAYER.md:92-101` says model output must not become source of truth without manager review or a versioned merge policy, and the dashboard should store job references rather than raw model outputs.

Recommended production-runtime policy:

1. Keep **local Execution Layer routing with `model=auto`** as the default until a measured evaluation selects a concrete local model.
2. Keep deterministic rules as the baseline and LLM outputs as evidence/confidence-labelled review signals, not final truth.
3. Route by task class rather than one global model:
   - Fast/small local model for schema-constrained extraction, prompt tests, and low-risk candidate tagging.
   - Balanced local model for normal transcript evaluations, objection handling, and procedure adherence.
   - Strongest local model only for ambiguous, high-risk, compliance-sensitive, or manager-escalated calls.
4. Never let runtime LLM output overwrite raw imports, deterministic outputs, LLM records, alert evidence, or manager corrections.
5. Keep manager review as the confirmation/correction layer.

If a future OpenAI-backed runtime is approved, do not simply mirror the Codex development model. Use a separate runtime eval with representative transcripts and measure JSON validity, evidence grounding, false positives, false negatives, latency, cost, and manager review usefulness.

## Model comparison

| Model option | Best fit | Benefits | Risks in this repo | Recommendation |
| --- | --- | --- | --- | --- |
| GPT-5.6 Luna | Clear, repetitive, high-volume tasks with strong tests | Fastest and lowest usage; good for copy, docs, simple helper/test additions | May miss subtle governance leaks, cross-file filter/report consequences, or local AI state edge cases | Use for narrow, low-risk tasks only |
| GPT-5.6 Terra | Everyday engineering and review | Best balance of reasoning, tool use, speed, and cost; enough for most Node/test/documentation work | May need higher reasoning for storage/concurrency or ambiguous product semantics | **Default** |
| GPT-5.6 Sol | Complex architecture, high-value ambiguity, difficult audits | Stronger judgment for cross-system interactions, governance, security, and data integrity | Slower and more usage-intensive; unnecessary for routine tested changes | Escalation model |

The strongest alternative to the default is **GPT-5.6 Sol High**. It was not selected as the default because most repository work is now bounded by tests and clear docs. Use it when a mistake could silently corrupt state, mislead managers, expose sensitive transcript data, or create incorrect operational conclusions.

## Reasoning-effort recommendation

Default reasoning:

- **Medium** for Terra.

Reasoning guidance:

| Reasoning level | Use when | Avoid when |
| --- | --- | --- |
| Low | Copy/text changes, small docs sync, simple tests, one-line labels, obvious renderer fixes | Any task touching metrics, persistence, AI prompts, privacy, reports, alerts, manager review, or filters |
| Medium | Normal implementation, debugging, test repair, scoped refactors, dashboard/API updates | Cross-cutting architecture, ambiguous product direction, or high-risk data/state work |
| High | Complex logic, edge cases, multi-module changes, storage consistency, report governance, local AI routing, security review | Simple label/format tasks with direct tests |
| Extra High / Max / Ultra | Rare. Use for major architecture decisions, deep regression audits, high-stakes data integrity, future autonomous/scheduled processing, or financial/yield logic if added | Routine feature work; increasing Terra to High is usually enough before jumping to extreme settings |

Do not change models when increasing reasoning effort on the current model would probably be enough. For example, Terra High is a reasonable first escalation for a hard failing test in `src/globalFilters.js` or `src/analysis.js`; Sol High is justified when the task changes product semantics or storage/AI governance.

## Escalation and downgrade matrix

Escalation:

| Trigger | Model/reasoning | Why |
| --- | --- | --- |
| Change touches Evaluation Studio run state, harvest, quarantine/resume, prompt templates, local model payloads, or result-to-review handoff | Sol High | These paths combine local AI, evidence, provenance, queue state, and manager governance (`src/evaluationStudio.js:45-82`, `src/main.js:1016-1053`, `src/evaluationStudio.js:1214-1289`). |
| Change touches `src/aiExecutionLayer.js`, runtime model routing, idempotency, secrets, auth, or external/local AI provider boundaries | Sol High | AI payload and credential boundaries are security-sensitive (`src/aiExecutionLayer.js:25-66`, `src/aiExecutionLayer.js:301-320`, `SECURITY.md:12-17`). |
| Change touches manager review correction allowlists, raw-field protection, actor attribution, or review history | Sol High | Raw/deterministic/LLM outputs must not be overwritten (`src/managerReview.js:40-90`, `docs/ARCHITECTURE.md:58-59`). |
| Change touches alert lifecycle active/closed/parked counts, bulk actions, or parked alert mutation | Terra High or Sol High | Alert counts drive management workflow (`src/alertLifecycle.js:5-16`, `src/storage.js:827-830`). Use Sol if product semantics change. |
| Change touches active metrics, denominator logic, global filters, or drilldown consistency across cards/tables/APIs | Terra High | The code has shared filter state and low-sample logic (`src/globalFilters.js:98-121`, `src/globalFilters.js:337-363`, `src/globalFilters.js:454-476`). |
| Change touches JSON store schema, SQLite schema, migrations, recovery, concurrency, or scheduled imports | Sol High | JSON storage is not multi-user concurrent, and SQLite sidecar has transactional update paths (`src/storage.js:102-119`, `src/intelligenceDatabase.js:169-176`). |
| Change introduces financial, pricing, margin, conversion, yield management, autonomous recommendations, or disciplinary conclusions | Sol High or Extra High | Current product explicitly avoids confirmed sales/revenue/conversion (`docs/PROJECT.md:30`, `docs/PROJECT.md:72-76`). Introducing these changes blast radius. |
| Read-heavy audit across docs/source/tests/runtime with many independent files | Terra High with parallel read-only subagents; Sol High for final synthesis if high-stakes | Good for evidence gathering, but final recommendation needs coherent judgment. |
| Security/privacy review before exposing beyond localhost | Sol High | `SECURITY.md:32` says access controls are needed before exposing transcript detail beyond localhost. |

Downgrade:

| Work type | Model/reasoning | Safety condition |
| --- | --- | --- |
| Documentation-only updates that restate existing behavior | Luna Low or Terra Low | Cite existing source lines and run no risky tools. |
| UI copy/label changes with no metric semantics | Luna Low | Tests or simple browser check confirm rendering. |
| Adding one deterministic test fixture for existing behavior | Luna Medium | No production data, no schema change, acceptance is clear. |
| Small renderer formatting update | Luna Medium | No changes to filtering, AI, manager review, or persistence semantics. |
| Report wording cleanup that removes stale/unsafe language | Luna Medium or Terra Low | Must preserve report hiding and no sales/revenue/allocation claims. |
| Single helper bug with direct unit tests | Terra Low or Medium | Failing test is clear and fix is local. |

## Proposed persistent configuration

These are proposed only. They were not applied during this audit and would not alter the active session.

Proposed root `AGENTS.md` addition:

```md
## Codex Model Escalation
- Default for most work: GPT-5.6 Terra, Medium reasoning.
- Use GPT-5.6 Luna, Low/Medium reasoning for narrow, repetitive, objectively testable documentation, copy, fixture, or single-helper changes.
- Use GPT-5.6 Terra, High reasoning for difficult bugs in filters, metrics, drilldowns, rendering, or report/API consistency.
- Use GPT-5.6 Sol, High reasoning for changes involving local AI routing, Evaluation Studio runs/results, manager-review governance, alert lifecycle semantics, persistence/state recovery, security/privacy, scheduled automation, concurrency, or any future financial/yield/conversion logic.
- Use Extra High/Max/Ultra only for major architecture decisions, high-stakes data-integrity/security audits, or autonomous/financial decision systems.
```

Proposed `.codex/config.toml` default:

```toml
model = "gpt-5.6-terra"
reasoning_effort = "medium"
```

Optional profiles:

```toml
[profiles.luna_fast]
model = "gpt-5.6-luna"
reasoning_effort = "low"

[profiles.luna_tested]
model = "gpt-5.6-luna"
reasoning_effort = "medium"

[profiles.terra_default]
model = "gpt-5.6-terra"
reasoning_effort = "medium"

[profiles.terra_deep]
model = "gpt-5.6-terra"
reasoning_effort = "high"

[profiles.sol_governance]
model = "gpt-5.6-sol"
reasoning_effort = "high"

[profiles.sol_architecture]
model = "gpt-5.6-sol"
reasoning_effort = "extra_high"
```

Optional high-capability read-only reviewer subagent:

- Model: GPT-5.6 Sol
- Reasoning: High
- Mode: read-only; no patches, no data mutation, no environment/config edits.
- Use for: release audits, security/privacy review, storage/recovery review, Evaluation Studio/AI governance review, alert/review workflow regression audits.
- Output: findings with file/line evidence, risk level, and recommended tests.

## Validation plan

Benchmark Terra Medium against Luna Medium, Terra High, and Sol High using representative tasks from this repo. Record correctness, test pass rate, first-attempt success, repair turns, missed review findings, elapsed time, usage/credits where observable, human review time, and whether acceptance criteria were met.

Suggested benchmark tasks:

| Task | Why representative | Expected escalation |
| --- | --- | --- |
| 1. Change a dashboard label and update one assertion | Clear UI/test task | Luna Low/Medium should pass |
| 2. Fix a source-call date/AEST formatting edge case | Date correctness and user trust | Terra Medium or High |
| 3. Add a new call-data-only filter and matching drilldown proof | Shared filters/denominators | Terra High |
| 4. Audit report hiding for a new stale phrase without hiding `AllocatedLeadID` raw context | Governance and false positives | Terra Medium/High |
| 5. Repair a failing alert lifecycle bulk-action test | Workflow state and active count semantics | Terra Medium/High |
| 6. Add a manager review correction field while preserving raw-field protection | Governance and allowlists | Sol High if schema/semantics change |
| 7. Fix an Evaluation Studio prompt-test run stuck in running state | Queue/harvest/state | Sol High |
| 8. Add a safe custom Evaluation Studio template fixture | Local AI schema/guardrails | Terra High |
| 9. Review SQLite LLM-result replacement for stale-result edge cases | Transaction/data integrity | Sol High |
| 10. Design scheduled import automation without implementing it | Architecture and operational risk | Sol High or Extra High |
| 11. Add a lead-harvest objection/handling tag with proof examples | Deterministic analytics and report language | Terra Medium |
| 12. Review privacy before exposing dashboard beyond localhost | Security boundary | Sol High |

Acceptance thresholds:

- Luna is acceptable only if first-attempt success is high on low-risk tasks and no guardrail regressions are missed.
- Terra Medium remains default if it passes most normal tasks with few repair turns and no high-severity missed findings.
- Terra High or Sol High should become the working profile only if Terra Medium repeatedly misses cross-file issues, silently breaks tests, or mishandles governance semantics.
- Sol High should be reserved if it improves correctness on high-risk tasks enough to justify elapsed time and usage.

## Assumptions, gaps and confidence

Assumptions:

- The named GPT-5.6 Sol/Terra/Luna options are available in the user's Codex environment.
- The goal is repository development efficiency, not maximum theoretical capability.
- Current local tests remain the main objective validation tool.

Gaps found:

- No `.codex/config.toml` exists, so there is no current repo-persistent model setting to inspect.
- No `.github` CI/workflow directory was found, so verification is local unless another external CI exists outside the repo.
- JSON state is explicitly MVP-suitable but not a concurrent multi-user workflow engine (`docs/QUALITY_SCORE.md:20-24`).
- Authentication is not implemented; `local_manager` is a placeholder actor for alert lifecycle and manager review.
- Scheduled import automation is documented as TODO (`runtime/AUTONOMOUS_BACKLOG.md:25`).
- `src/main.py` appears to be an unreferenced starter artifact, while `package.json:6-9` and docs point to `src/main.js`.
- No active recommended-wave/yield-management/learning-loop implementation was found.

Confidence: **High** for the development-time recommendation because repo evidence is consistent, tests are green, and the dominant work is bounded and verifiable. Confidence is **Medium** for production runtime model policy because the actual local Execution Layer model inventory and performance benchmark data were outside this repo.

DEFAULT RECOMMENDATION
Model: GPT-5.6 Terra
Reasoning: Medium
Use for: Normal Sales Dashboard implementation, debugging, testing, documentation, report/UI refinement, deterministic analytics, and routine code review.
Escalate to: GPT-5.6 Sol with High reasoning
Escalate when: Work touches local AI routing, Evaluation Studio run/result governance, manager-review correction semantics, alert lifecycle definitions, persistence/schema/recovery, security/privacy boundaries, scheduled/concurrent processing, or any future financial/yield/conversion logic.
Downgrade to: GPT-5.6 Luna with Low or Medium reasoning
Downgrade when: The task is narrow, repetitive, objectively testable, low-blast-radius, and limited to docs/copy/small fixtures/single-helper changes with clear acceptance criteria.
Confidence: high
