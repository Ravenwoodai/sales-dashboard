# AI Execution Layer Integration

## Current Status

Sales Dashboard is intentionally disconnected from local-model execution.

- `SALES_DASHBOARD_AI_ENABLED` must remain false/absent for normal operation.
- The current capability register has zero promoted capabilities.
- Every model submission and operational-polling path fails closed before network access.
- A separately running AI Execution Layer at port 8080 may serve another project; its availability does not enable Sales Dashboard.

## Authority

Read these before any change:

- `docs/LOCAL_MODEL_CAPABILITY_POLICY.md`
- `runtime/LOCAL_MODEL_CAPABILITY_REGISTER_2026-07-22.json`
- `runtime/LOCAL_MODEL_COMPREHENSIVE_AUDIT_2026-07-22.md`

The register, not an environment variable or healthy worker, decides whether an exact capability may submit or be consumed.

## Retained Architecture

If a future capability is independently promoted, Sales Dashboard may communicate only through the local AI Execution Layer client in `src/aiExecutionLayer.js`. It must never call Ollama, vLLM, or a provider runtime directly. Credentials must remain outside the repository.

This retained architecture is not current authorisation.

## Current Endpoint Behavior

- `GET /api/ai/status`: reports AI disabled and the public capability boundary.
- `GET /api/ai/status?health=true`: may report the disconnected service status but cannot grant permission.
- `GET /api/ai/jobs/<job-id>`: sanitized historical research only, with `researchOnly: true` and authority `none`.
- `POST /api/ai/transcript-evaluation`: retired (`410`).
- `POST /ai/transcript-evaluations`: retired (`410`).
- `POST /api/evaluation-studio/results`: retired (`410`).
- Evaluation Studio run/prompt/resume/harvest mutations: capability-locked (`423`).
- Evaluation Studio knowledge/template/archive/feedback/review-handoff mutations: read-only archive lock (`423`).
- Evaluation Studio Validation Lab manifest/label/freeze forms: permitted only against the isolated human-benchmark store; they contain no model submission or historical-result write path.

Blocked requests must not make a model-service request or change local job/run/result counts.

## Historical Contracts

Historical task types, dynamic schemas, worker leases, idempotency keys, validation, and job provenance remain preserved in source and archive data for audit. They prove technical execution only. They do not prove semantic accuracy and must not be used to reopen the route.

## Future Reopening Requirements

Before any model integration is enabled:

1. A materially different model candidate passes a predeclared genuinely unseen semantic promotion test. A deterministic rule may be validated and approved without enabling model integration.
2. The exact capability is added to the register as promoted for submission and, separately, operational consumption.
3. The parent application is restarted so it binds the new register.
4. Tests prove all other capabilities remain denied.
5. A live canary is separately authorised and audited before scale-out.

Do not use a smoke-test job to decide whether these requirements are satisfied.
