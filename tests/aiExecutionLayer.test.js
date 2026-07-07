"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_LAYER_PATH,
  buildTranscriptIntelligenceInput,
  buildTranscriptEvaluationInput,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitAiTask
} = require("../src/aiExecutionLayer");
const { saveAiJobReference, readStore } = require("../src/storage");

function tempStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-ai-")), "state.json");
}

function fakeCall() {
  return {
    callId: "48500001",
    salesperson: "Riley Example",
    date: "1/07/2026",
    time: "09:00:00",
    contactClassification: "customer",
    localOutcome: "callback_requested",
    importedNoSale: "Blank",
    followUpStatus: "indeterminate_insufficient_future_data",
    followUpChannel: "call",
    transcriptQuality: "high",
    durationSeconds: 60,
    stableIds: [{ field: "AllocatedLeadID", value: "lead-1" }],
    evidence: [{ signal: "follow_up", text: "Please call me back.", confidence: 0.86 }],
    transcript: "Customer: Please call me back later today.",
    rawFields: {
      call_id: "48500001",
      Salesperson: "Riley Example"
    }
  };
}

test("AI execution config points at the local execution-layer path and hides credentials from status", () => {
  const config = resolveAiExecutionConfig({
    SALES_DASHBOARD_AI_ENABLED: "true",
    SALES_DASHBOARD_AI_PROJECT_API_KEY: "secret-key"
  });
  const status = publicAiExecutionStatus(config);

  assert.equal(config.layerPath, DEFAULT_LAYER_PATH);
  assert.equal(status.enabled, true);
  assert.equal("projectApiKey" in status, false);
  assert.equal(status.baseUrl, "http://127.0.0.1:8080");
  assert.equal(status.taskType, "sales_transcript_evaluation");
});

test("transcript evaluation input includes guardrails and sanitized call evidence", () => {
  const input = buildTranscriptEvaluationInput(fakeCall(), { importId: "import-test", sourceName: "sample.csv" });

  assert.equal(input.source.call_id, "48500001");
  assert.match(input.transcript, /Please call me back/);
  assert.equal(input.deterministic_baseline.local_outcome, "callback_requested");
  assert.ok(input.guardrails.some((guardrail) => guardrail.includes("Redacted phone")));
  assert.equal(input.sanitized_raw_fields.call_id, "48500001");
});

test("transcript intelligence input asks local LLM for structured extraction", () => {
  const deterministic = {
    call: {
      extractionVersion: "call_intelligence.v1",
      leadUtilizationScore: 5,
      briefReason: "Strong next step.",
      evidenceSnippet: "Customer: Please call me back later today."
    },
    entities: [],
    events: [
      {
        eventType: "customer_requested_callback",
        evidence: "Customer: Please call me back later today.",
        confidence: 0.8
      }
    ],
    riskFlags: []
  };
  const input = buildTranscriptIntelligenceInput(fakeCall(), deterministic, { importId: "import-test", sourceName: "sample.csv" });

  assert.equal(input.schema_version, "sales_dashboard_call_intelligence_llm.v1");
  assert.equal(input.source.call_id, "48500001");
  assert.equal(input.deterministic_intelligence.call.leadUtilizationScore, 5);
  assert.ok(input.instructions.some((item) => item.includes("strict JSON")));
  assert.ok(input.instructions.some((item) => item.includes("real transcript phrase")));
  assert.ok(input.instructions.some((item) => item.includes("payment_or_order_intent")));
  assert.ok(input.instructions.some((item) => item.includes("mortgage")));
  assert.ok(input.output_contract.events);
  assert.ok(input.guardrails.some((item) => item.includes("OrderCount")));
});

test("submitAiTask calls the execution layer through POST /run-task", async () => {
  const requests = [];
  const result = await submitAiTask({ text: "hello" }, {
    config: {
      enabled: true,
      layerPath: DEFAULT_LAYER_PATH,
      layerPathExists: true,
      baseUrl: "http://127.0.0.1:8080",
      projectApiKey: "project-key",
      taskType: "sales_transcript_evaluation",
      model: "auto",
      priority: "normal",
      responseMode: "async"
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ job_id: "job-1", status: "queued" })
      };
    }
  });

  assert.equal(result.job_id, "job-1");
  assert.equal(requests[0].url, "http://127.0.0.1:8080/run-task");
  assert.equal(requests[0].options.headers.Authorization, "Bearer project-key");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.task_type, "sales_transcript_evaluation");
  assert.equal(body.response_mode, "async");
});

test("saveAiJobReference stores local AI job linkage without raw model output", () => {
  const storePath = tempStorePath();
  saveAiJobReference({
    importId: "import-test",
    callId: "48500001",
    jobId: "job-1",
    taskType: "sales_transcript_evaluation",
    status: "queued"
  }, { storePath });
  const store = readStore({ storePath });

  assert.equal(store.aiJobs.length, 1);
  assert.equal(store.aiJobs[0].callId, "48500001");
  assert.equal(store.aiJobs[0].jobId, "job-1");
});
