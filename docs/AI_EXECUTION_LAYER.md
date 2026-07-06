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

## Endpoints Added

```text
GET  /api/ai/status
GET  /api/ai/status?health=true
POST /api/ai/transcript-evaluation
GET  /api/ai/jobs/<job-id>
POST /ai/transcript-evaluations
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
- Do not use `CustomerCreateDate` or `CustomerImportDate` until the export provides reliable timestamps.
- Store only job references in the dashboard store; detailed model outputs remain in the Execution Layer job record.
