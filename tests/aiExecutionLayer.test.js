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
  getAiBatch,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitAiBatch,
  submitAiTask
} = require("../src/aiExecutionLayer");
const { saveAiJobReference, readStore } = require("../src/storage");
const { canonicalHash } = require("../src/localModelCapability");

function promotedOfferCapabilityRegister() {
  const inferenceSettings = {
    think: false,
    temperature: 0,
    maximum_completion_tokens: 512,
    num_ctx: 32768,
    seed: 7,
    top_p: 1
  };
  return {
    schema_version: "sales_dashboard_local_model_capability_register.v1",
    program_status: "test",
    capabilities: [{
      id: "offer_acceptance_v3",
      status: "promoted",
      promotion_contract: {
        task_type: "sales_dashboard_evaluation_studio",
        evaluation_goal: "offer_acceptance_classification",
        model_key: "pinned-model-key",
        provider_model: "pinned-provider-model",
        model_digest: "model-digest",
        prompt_hash: "prompt-hash",
        schema_version: "schema.v1",
        schema_hash: "schema-hash",
        inference_settings_hash: canonicalHash(inferenceSettings),
        inference_settings: inferenceSettings,
        execution_contract_revision: "verified-contract-v1",
        execution_layer_enforces_inference_settings: true,
        validation_manifest_hash: "manifest-hash",
        promotion_audit_hash: "audit-hash",
        evidence_contract_version: "evidence.v1",
        minimum_evidence: { exact_quote_count: 1 },
        supported_population: { population_id: "population-1", definition_hash: "population-hash" },
        permitted_uses: ["model_submission", "operational_decision"]
      }
    }]
  };
}

function promotedOfferSubmissionOptions() {
  return {
    capabilityRegister: promotedOfferCapabilityRegister(),
    evaluationGoal: "offer_acceptance_classification",
    taskType: "sales_dashboard_evaluation_studio",
    promptHash: "prompt-hash",
    schemaVersion: "schema.v1",
    schemaHash: "schema-hash",
    populationId: "population-1",
    populationDefinitionHash: "population-hash"
  };
}

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
    aiVoiceAssistantDetected: true,
    aiVoiceAssistantConfidence: 0.94,
    aiVoiceAssistantResponse: "handled_well",
    aiVoiceAssistantHandledSuccessfully: true,
    aiVoiceAssistantBailed: false,
    aiVoiceAssistantTactics: ["Explained reason", "Asked for callback"],
    aiVoiceAssistantFutureStatus: "future_human_contact",
    aiVoiceAssistantFutureCallId: "48500002",
    stableIds: [{ field: "AllocatedLeadID", value: "lead-1" }],
    evidence: [{ signal: "follow_up", text: "Please call me back.", confidence: 0.86 }],
    transcript: "Customer: Please call me back later today.",
    rawFields: {
      call_id: "48500001",
      Salesperson: "Riley Example",
      NoSaleType: "LEGACY_DISPOSITION_SENTINEL",
      Baz_DetailedNotes: "LEGACY_NOTE_SENTINEL"
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
  assert.equal(input.deterministic_baseline.ai_voice_assistant.detected, true);
  assert.equal(input.deterministic_baseline.ai_voice_assistant.response_classification, "handled_well");
  assert.ok(input.guardrails.some((guardrail) => guardrail.includes("Redacted phone")));
  assert.equal(input.sanitized_raw_fields.call_id, "48500001");
  assert.equal(input.sanitized_raw_fields.NoSaleType, undefined);
  assert.equal(input.sanitized_raw_fields.Baz_DetailedNotes, undefined);
  assert.doesNotMatch(JSON.stringify(input), /LEGACY_DISPOSITION_SENTINEL|LEGACY_NOTE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(input), /dispositionMatchesTranscript|imported_no_sale|outcome_mismatch/i);
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
  assert.ok(input.instructions.some((item) => item.includes("ai_call_assistant_encountered")));
  assert.ok(input.instructions.some((item) => item.includes("payment_or_order_intent")));
  assert.ok(input.instructions.some((item) => item.includes("mortgage")));
  assert.ok(input.output_contract.events);
  assert.ok(input.guardrails.some((item) => item.includes("OrderCount")));
  assert.equal(input.sanitized_raw_fields.NoSaleType, undefined);
  assert.equal(input.sanitized_raw_fields.Baz_DetailedNotes, undefined);
  assert.doesNotMatch(JSON.stringify(input), /LEGACY_DISPOSITION_SENTINEL|LEGACY_NOTE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(input), /dispositionMatchesTranscript|imported_no_sale|outcome_mismatch/i);
});

test("AI inputs exclude parked allocation import fields but keep call AllocatedLeadID", () => {
  const call = fakeCall();
  call.rawFields = {
    call_id: "48500001",
    Salesperson: "Riley Example",
    AllocatedLeadID: "lead-1",
    allocationCoverage: { totals: { allocated: 10 } },
    allocationRows: [{ campaign: "Fresh Leads" }],
    campaignRows: [{ campaign: "Fresh Leads" }],
    "QTY ACTIONED": "3",
    allocated: "10",
    actioned: "3",
    remaining: "7",
    reconciliationStatus: "matched"
  };
  const deterministic = {
    call: { extractionVersion: "call_intelligence.v1" },
    entities: [],
    events: [],
    riskFlags: []
  };

  const evaluationInput = buildTranscriptEvaluationInput(call);
  const intelligenceInput = buildTranscriptIntelligenceInput(call, deterministic);

  assert.equal(evaluationInput.sanitized_raw_fields.AllocatedLeadID, "lead-1");
  assert.equal(intelligenceInput.sanitized_raw_fields.AllocatedLeadID, "lead-1");
  for (const fields of [evaluationInput.sanitized_raw_fields, intelligenceInput.sanitized_raw_fields]) {
    assert.equal(fields.allocationCoverage, undefined);
    assert.equal(fields.allocationRows, undefined);
    assert.equal(fields.campaignRows, undefined);
    assert.equal(fields["QTY ACTIONED"], undefined);
    assert.equal(fields.allocated, undefined);
    assert.equal(fields.actioned, undefined);
    assert.equal(fields.remaining, undefined);
    assert.equal(fields.reconciliationStatus, undefined);
  }
});

test("submitAiTask calls the execution layer only for an exact promoted contract", async () => {
  const requests = [];
  const result = await submitAiTask({ text: "hello" }, {
    ...promotedOfferSubmissionOptions(),
    config: {
      enabled: true,
      layerPath: DEFAULT_LAYER_PATH,
      layerPathExists: true,
      baseUrl: "http://127.0.0.1:8080",
      projectApiKey: "project-key",
      taskType: "sales_dashboard_evaluation_studio",
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
  assert.equal(body.task_type, "sales_dashboard_evaluation_studio");
  assert.equal(body.model, "pinned-model-key");
  assert.equal(body.input.execution_constraints.max_completion_tokens, 512);
  assert.equal(body.metadata.provider_model, "pinned-provider-model");
  assert.equal(body.metadata.promotion_contract_hash.length, 64);
  assert.equal(body.response_mode, "async");
});

test("controlled batches use one authenticated /run-batch request and can be polled", async () => {
  const requests = [];
  const config = {
    enabled: true,
    layerPath: DEFAULT_LAYER_PATH,
    layerPathExists: true,
    baseUrl: "http://127.0.0.1:8080",
    projectApiKey: "project-key",
    taskType: "sales_dashboard_evaluation_studio",
    model: "qwen3:30b",
    priority: "normal",
    responseMode: "async"
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: url.endsWith("/run-batch") ? 202 : 200,
      text: async () => JSON.stringify(url.endsWith("/run-batch")
        ? { batch: { id: "batch-1" }, items: [{ job_id: "job-1", submission_status: "accepted" }] }
        : { batch: { id: "batch-1", status: "processing" }, items: [] })
    };
  };
  const created = await submitAiBatch([{ itemId: "call-1", input: { transcript: "complete" } }], {
    ...promotedOfferSubmissionOptions(),
    config,
    fetchImpl,
    batchName: "Spiel v4 Gate A",
    idempotencyKey: "spiel-v4-gate-a"
  });
  const detail = await getAiBatch(created.batch.id, { config, fetchImpl });

  assert.equal(detail.batch.id, "batch-1");
  assert.equal(requests[0].url, "http://127.0.0.1:8080/run-batch");
  assert.equal(requests[1].url, "http://127.0.0.1:8080/batches/batch-1");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].item_id, "call-1");
  assert.equal(body.items[0].model, "pinned-model-key");
  assert.equal(body.defaults.response_mode, "async");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "spiel-v4-gate-a");
});

test("unpromoted submissions fail before any network request", async () => {
  let fetchCalls = 0;
  const config = {
    enabled: true,
    layerPath: DEFAULT_LAYER_PATH,
    layerPathExists: true,
    baseUrl: "http://127.0.0.1:8080",
    projectApiKey: "project-key",
    taskType: "sales_dashboard_evaluation_studio",
    model: "auto",
    priority: "normal",
    responseMode: "async"
  };
  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error("network should not be reached");
  };
  await assert.rejects(() => submitAiTask({ text: "must not leave process" }, {
    config,
    evaluationGoal: "offer_acceptance_classification",
    fetchImpl
  }), (error) => error.code === "LOCAL_MODEL_CAPABILITY_QUARANTINED" && error.status === 423);
  await assert.rejects(() => submitAiBatch([{ itemId: "research-runner", input: { transcript: "must not leave process" } }], {
    config,
    evaluationGoal: "spiel_quality",
    fetchImpl
  }), (error) => error.code === "LOCAL_MODEL_CAPABILITY_QUARANTINED" && error.status === 423);
  assert.equal(fetchCalls, 0);
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
