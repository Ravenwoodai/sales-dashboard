# Security Baseline
This file defines the minimum safety expectations for Sales Dashboard.

## Data Privacy
- Treat call transcripts, names, IDs, and source-system notes as sensitive operational data.
- Do not commit CSV imports, transcript exports, or derived raw-data artifacts to Git.
- `dialled_phone_number` is intentionally incomplete for security and is ignored for MVP analytics and display.
- Do not reconstruct, enrich, or infer full phone numbers.
- Use stable source IDs for linkage only where present.
- Treat optional voicemail-pilot exports as sensitive source data. Keep them ignored/local, expose only sanitized validation records, never reveal the full configured path, and never persist their raw rows into application stores.

## Local-Only AI Boundary
- The MVP uses deterministic local rules and sends no transcript data to external AI services.
- No local-model capability is currently promoted. Sales Dashboard must remain AI-disabled and must fail closed at submission and operational-consumption boundaries.
- A future independently promoted capability may use only `C:\Users\User\Desktop\ai-execution-layer` through `src/aiExecutionLayer.js`. Sales Dashboard must not call vLLM, Ollama, or provider runtimes directly.
- Project credentials for the Execution Layer must come from the runtime environment and must never be committed.
- If an LLM evaluator is added later, transcript text must be treated as untrusted data and wrapped separately from system instructions.
- Future LLM outputs must use strict schema validation, exact evidence, immutable provenance, and explicit research/promotion/failure states. Model self-reported confidence is not semantic accuracy evidence.
- Historical Evaluation Studio prompts and knowledgebase entries are untrusted local archive content. Keep them versioned and escaped; do not send them to a model while capabilities are unpromoted.
- Human benchmark labels are sensitive local calibration data. Store them only in `data/store/evaluation-validation-lab.json`, validate every evidence quote against the current transcript server-side, and never copy historical model output into benchmark truth.
- Benchmark manifests and candidate reports cannot grant authority. Only a separate externally approved capability-register change may do that after a strict frozen promotion pass.
- A running Execution Layer or local model is not permission. Only the validated capability register may grant an exact submission or consumption use.

## Secrets
- Never commit secrets, tokens, private keys, or real credentials.
- Keep local environment data in untracked files such as `.env`.
- If a new secret is required, document the variable name and purpose without storing the value.

## Display Safety
- Escape transcript and evidence text before rendering.
- Hide ignored privacy-sensitive fields from standard dashboard tables.
- Treat alert lifecycle actors as local placeholders until authentication exists; normal lifecycle actions resolve to `local_manager` server-side and ignore client-supplied actor names.
- Treat manager review actors the same way: review actions resolve to `local_manager` server-side, client-supplied actor/reviewer fields are not authoritative, and manager corrections must not overwrite raw imported fields, deterministic outputs, LLM outputs, or generated alert evidence.
- Manager review notes, correction reasons, and evidence assessments are untrusted display text and must be escaped when rendered.
- Evaluation Studio knowledgebase entries, prompt/template text, output schemas, and run metadata are untrusted display text and must be escaped when rendered.
- Validation Lab manifest names, capability IDs, exact-fact descriptions, reasons, labels, and transcript quotes are untrusted display text and must be escaped. Frozen source and exclusion fingerprints must be checked before comparison.
- Voicemail-pilot IDs, filenames, statuses and validation reasons are untrusted display text and must be escaped. Exact source IDs and ISO timestamps must pass the contract before they affect any displayed denominator.
- Hide parked or superseded report content from normal report APIs and dashboard report views while preserving local store records.
- Add role-based access before exposing transcript detail outside localhost.

## Dependencies
- Prefer built-in platform capabilities before adding packages.
- Add dependencies only when they clearly improve reliability or maintainability.

## Review Triggers
Escalate or document carefully when work touches:
- authentication or authorization
- transcript storage
- CSV retention
- external AI providers
- phone/contact identity linkage
- file deletion or mutation outside the repo
