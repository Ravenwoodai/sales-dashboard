# AI Execution Layer Integration

Sales Dashboard can submit selected transcript evaluation work to the local AI Execution Layer at:

```text
C:\Users\User\Desktop\ai-execution-layer
```

The dashboard does not call vLLM, Ollama, or any local model runtime directly. When local model processing is required, it calls the Execution Layer API at `POST /run-task` so jobs are authenticated, routed, logged, and traceable.

## Default Configuration

The integration is disabled unless explicitly enabled for the running dashboard process:

```powershell
$env:SALES_DASHBOARD_AI_ENABLED="true"
$env:SALES_DASHBOARD_AI_EXECUTION_LAYER_PATH="C:\Users\User\Desktop\ai-execution-layer"
$env:SALES_DASHBOARD_AI_EXECUTION_BASE_URL="http://127.0.0.1:8080"
$env:SALES_DASHBOARD_AI_PROJECT_API_KEY="<sales-dashboard-project-key>"
$env:SALES_DASHBOARD_AI_TASK_TYPE="sales_transcript_evaluation"
node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"
```

Do not commit the project API key. Store it in the user environment, a local `.env` loader, or another private operator process.

Evaluation Studio prompt tests and batch runs use a separate local Execution Layer task type:

```text
sales_dashboard_evaluation_studio
```

That task is for editable Evaluation Studio templates and knowledgebase-driven transcript review. The normal transcript intelligence extraction task remains separate as `sales_transcript_intelligence_extraction`.

### Evaluation Studio output contracts

Evaluation Studio sends the active template's versioned output contract in `evaluation_template.output_schema`. The Execution Layer allowlists dynamic schema authority only for `sales_dashboard_evaluation_studio`, validates and hashes the supplied contract before model execution, includes the canonical schema in the model prompt, and uses it as Ollama's structured-output format where supported. Historical templates using the dashboard's legacy descriptive schema shape are canonicalised to the same bounded JSON Schema subset before execution.

The Execution Layer performs JSON and schema validation. Sales Dashboard then performs evaluator-specific semantic validation. A terminal schema or semantic failure is stored once and moves the run out of `running`; normal harvesting does not resubmit jobs. Raw model attempts remain internal to the Execution Layer and are not returned by the dashboard's public job proxy.

## Endpoints Added

```text
GET  /api/ai/status
GET  /api/ai/status?health=true
POST /api/ai/transcript-evaluation
GET  /api/ai/jobs/<job-id>
POST /ai/transcript-evaluations
POST /api/evaluation-studio/prompt-tests
POST /api/evaluation-studio/runs/<run-id>/harvest
```

`POST /api/ai/transcript-evaluation` accepts:

```json
{
  "callId": "48535907"
}
```

It builds a guarded payload from the call proof record, submits it to `POST /run-task`, stores the returned job id locally, and links the job back to the import and call.

## Task Contract

Default task type:

```text
sales_transcript_evaluation
```

Expected input shape:

```json
{
  "schema_version": "sales_dashboard_transcript_ai_eval.v1",
  "instructions": ["..."],
  "source": {
    "system": "Sales Dashboard",
    "import_id": "import_...",
    "source_name": "July 1 Data.csv",
    "call_id": "48535907",
    "salesperson": "Example",
    "call_date": "1/07/2026",
    "call_time": "8:03:18"
  },
  "deterministic_baseline": {
    "contact_classification": "voicemail",
    "local_outcome": "voicemail",
    "follow_up_status": "not_required",
    "stable_ids": [],
    "evidence": []
  },
  "transcript": "...",
  "sanitized_raw_fields": {},
  "guardrails": []
}
```

The model should return compact JSON with classification, follow-up assessment, risks, evidence used, limitations, and confidence. Model output must not become the source of truth without manager review or a versioned merge policy.

## Safety Rules

- Keep deterministic local rules as the audit baseline.
- Send transcript jobs only through the Execution Layer.
- Do not call vLLM, Ollama, or provider runtimes from Sales Dashboard.
- Do not reconstruct redacted phone numbers.
- Use `CustomerImportDate` and `CustomerCreateDate` only if they have already been parsed as valid source-quality Record Age context by the dashboard; do not infer from malformed date fragments.
- Store only job references in the dashboard store; detailed model outputs remain in the Execution Layer job record.
