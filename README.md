# Sales Dashboard

Local call intelligence dashboard for scheduled CSV/XLSX transcript exports. Separate campaign/allocation imports are preserved only as parked diagnostics and are excluded from active analytics.

## Run

```powershell
node src/main.js --csv "C:\Users\User\Downloads\July 1 Data.csv"
```

The legacy allocation flag is still accepted, but allocation data is parked and does not create dashboard metrics:

```powershell
node src/main.js --csv "C:\Users\User\Downloads\CallData 07.07.2026.xlsx" --allocations "C:\Users\User\Downloads\allocations 07.07.2026.xlsx"
```

Open:

```text
http://127.0.0.1:3000
```

Health:

```text
http://127.0.0.1:3000/health
```

## Test

```powershell
node --test tests/*.test.js
```

## MVP Guardrails

- `dialled_phone_number` is intentionally incomplete for security and ignored for MVP analytics.
- Valid `CustomerImportDate` and `CustomerCreateDate` are used only for source-quality Record Age; malformed date fragments are treated as missing.
- The current CSV does not support sales conversion, revenue, order value, or won/lost outcome reporting.
- No external AI service is used in the MVP.
- Separate campaign/allocation imports are parked. They are preserved as inactive metadata, but excluded from active dashboard metrics, reports, alerts, filters, source/list quality, and AI transcript context.

## Local Storage

The dashboard stores derived local artifacts under `data/`, which is ignored by Git:

- import history
- sanitized evaluation artifacts
- alert/review state
- generated report library

Future reports can be saved for dashboard viewing with:

```text
POST http://127.0.0.1:3000/api/reports
```

Body:

```json
{
  "title": "Report title",
  "type": "generated_report",
  "summary": "Short dashboard summary",
  "content": "Markdown report body",
  "metadata": { "source": "Codex" }
}
```

Saved reports can be opened from the dashboard Reports Library or directly at:

```text
http://127.0.0.1:3000/reports/<report-id>
```

## Drill-Down Proof

Dashboard metrics and lead-utilization report links open the rows behind the number:

```text
http://127.0.0.1:3000/drilldown?metric=lead.singleAttemptNoContact
```

JSON is available at:

```text
http://127.0.0.1:3000/api/drilldown?metric=lead.singleAttemptNoContact
```

Individual call proof pages show sanitized raw source fields, transcript proof, evidence, and manager review capture:

```text
http://127.0.0.1:3000/calls/<call-id>
```

The redacted phone field, `CustomerCreateDate`, and `CustomerImportDate` are excluded from raw proof fields.

## Parked Allocation Data

Optional allocation files may still be supplied from `.xlsx` or `.csv` sources, but they are not used by active analytics. The parser is preserved for future review, and `/api/allocations` returns only parked status metadata.

```text
LEAD CAMPAIGN, QTY ALLOCATED, QTY ACTIONED, QTY REMAINING, DATE, SALES MANAGER, SALESPERSON, TYPE
```

JSON is available at:

```text
GET /api/allocations
```

## Local AI Execution Layer

When local model processing is required, Sales Dashboard uses:

```text
C:\Users\User\Desktop\ai-execution-layer
```

It calls the Execution Layer API, not vLLM/Ollama directly. Enable it with environment variables:

```powershell
$env:SALES_DASHBOARD_AI_ENABLED="true"
$env:SALES_DASHBOARD_AI_EXECUTION_LAYER_PATH="C:\Users\User\Desktop\ai-execution-layer"
$env:SALES_DASHBOARD_AI_EXECUTION_BASE_URL="http://127.0.0.1:8080"
$env:SALES_DASHBOARD_AI_PROJECT_API_KEY="<sales-dashboard-project-key>"
$env:SALES_DASHBOARD_AI_TASK_TYPE="sales_transcript_evaluation"
```

Status:

```text
http://127.0.0.1:3000/api/ai/status
```

Transcript intelligence is indexed locally in SQLite on import load. These endpoints expose the lead-utilisation database and optional local LLM enrichment flow:

```text
GET  /api/intelligence/summary
GET  /api/intelligence/summary?businessSegment=warm
GET  /api/intelligence/calls?businessSegment=new&limit=250
POST /api/intelligence/rebuild
POST /api/intelligence/llm-extractions
POST /api/intelligence/llm-results
```

See `docs/AI_EXECUTION_LAYER.md`.
