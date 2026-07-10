# Security Baseline
This file defines the minimum safety expectations for Sales Dashboard.

## Data Privacy
- Treat call transcripts, names, IDs, and source-system notes as sensitive operational data.
- Do not commit CSV imports, transcript exports, or derived raw-data artifacts to Git.
- `dialled_phone_number` is intentionally incomplete for security and is ignored for MVP analytics and display.
- Do not reconstruct, enrich, or infer full phone numbers.
- Use stable source IDs for linkage only where present.

## Local-Only AI Boundary
- The MVP uses deterministic local rules and sends no transcript data to external AI services.
- If local model processing is required, Sales Dashboard must use `C:\Users\User\Desktop\ai-execution-layer` and call the Execution Layer API. It must not call vLLM, Ollama, or provider runtimes directly.
- Project credentials for the Execution Layer must come from the runtime environment and must never be committed.
- If an LLM evaluator is added later, transcript text must be treated as untrusted data and wrapped separately from system instructions.
- Future LLM outputs must use strict schema validation, evidence snippets, confidence scores, version metadata, and review/failure states.
- Evaluation Studio prompts and knowledgebase entries are user-managed context. Treat them as untrusted local content, keep them versioned, and pass them only through the approved AI Execution Layer with explicit guardrails.

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
