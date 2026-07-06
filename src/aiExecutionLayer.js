"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_LAYER_PATH = "C:\\Users\\User\\Desktop\\ai-execution-layer";
const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_TASK_TYPE = "sales_transcript_evaluation";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function enabledFrom(value) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function trimSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

function resolveAiExecutionConfig(env = process.env) {
  const layerPath = path.resolve(env.SALES_DASHBOARD_AI_EXECUTION_LAYER_PATH || DEFAULT_LAYER_PATH);
  return {
    enabled: enabledFrom(env.SALES_DASHBOARD_AI_ENABLED),
    layerPath,
    layerPathExists: fs.existsSync(layerPath),
    baseUrl: trimSlash(env.SALES_DASHBOARD_AI_EXECUTION_BASE_URL || DEFAULT_BASE_URL),
    projectApiKey: clean(env.SALES_DASHBOARD_AI_PROJECT_API_KEY),
    taskType: clean(env.SALES_DASHBOARD_AI_TASK_TYPE) || DEFAULT_TASK_TYPE,
    model: clean(env.SALES_DASHBOARD_AI_MODEL) || "auto",
    priority: clean(env.SALES_DASHBOARD_AI_PRIORITY) || "normal",
    responseMode: clean(env.SALES_DASHBOARD_AI_RESPONSE_MODE) || "async"
  };
}

function publicAiExecutionStatus(config = resolveAiExecutionConfig()) {
  const missing = [];
  if (!config.layerPathExists) missing.push("layer_path");
  if (config.enabled && !config.projectApiKey) missing.push("project_api_key");
  if (config.enabled && !config.baseUrl) missing.push("base_url");

  return {
    enabled: Boolean(config.enabled),
    configured: Boolean(config.enabled && config.projectApiKey && config.baseUrl && config.layerPathExists),
    layerPath: config.layerPath,
    layerPathExists: Boolean(config.layerPathExists),
    baseUrl: config.baseUrl,
    taskType: config.taskType,
    model: config.model,
    priority: config.priority,
    responseMode: config.responseMode,
    missing
  };
}

function requireConfigured(config) {
  const status = publicAiExecutionStatus(config);
  if (!status.enabled) {
    throw new Error("AI execution layer is disabled. Set SALES_DASHBOARD_AI_ENABLED=true to submit local model jobs.");
  }
  if (!status.configured) {
    throw new Error(`AI execution layer is not configured: missing ${status.missing.join(", ") || "configuration"}.`);
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function buildTranscriptEvaluationInput(call, options = {}) {
  if (!call) throw new Error("call is required");
  return {
    schema_version: "sales_dashboard_transcript_ai_eval.v1",
    instructions: [
      "Evaluate only the supplied transcript and deterministic baseline.",
      "Do not invent contact details, sales outcomes, or follow-up actions.",
      "Return compact JSON with classification, follow_up_assessment, risks, evidence_used, limitations, and confidence."
    ],
    source: {
      system: "Sales Dashboard",
      import_id: options.importId || null,
      source_name: options.sourceName || null,
      call_id: call.callId,
      salesperson: call.salesperson,
      call_date: call.date,
      call_time: call.time
    },
    deterministic_baseline: {
      contact_classification: call.contactClassification,
      local_outcome: call.localOutcome,
      imported_no_sale: call.importedNoSale,
      follow_up_status: call.followUpStatus,
      follow_up_channel: call.followUpChannel,
      transcript_quality: call.transcriptQuality,
      duration_seconds: call.durationSeconds,
      stable_ids: call.stableIds || [],
      evidence: call.evidence || []
    },
    transcript: call.transcript || "",
    sanitized_raw_fields: call.rawFields || {},
    guardrails: [
      "Redacted phone numbers are not available and must not be reconstructed.",
      "CustomerCreateDate and CustomerImportDate are unreliable in the current export.",
      "Treat deterministic scores as baseline evidence, not final truth.",
      "If evidence is insufficient, say so."
    ]
  };
}

async function requestJson(url, options = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime");
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || response.statusText || `HTTP ${response.status}`;
    const wrapped = new Error(`AI execution layer request failed: ${message}`);
    wrapped.status = response.status;
    wrapped.payload = payload;
    throw wrapped;
  }
  return payload;
}

async function checkAiExecutionHealth(options = {}) {
  const config = options.config || resolveAiExecutionConfig(options.env);
  const status = publicAiExecutionStatus(config);
  if (!status.baseUrl) return { ...status, serviceStatus: "unknown" };
  try {
    const health = await requestJson(`${config.baseUrl}/health`, { method: "GET" }, options.fetchImpl);
    return { ...status, serviceStatus: health.status || "unknown", health };
  } catch (error) {
    return { ...status, serviceStatus: "unavailable", error: error.message };
  }
}

async function submitAiTask(input, options = {}) {
  const config = options.config || resolveAiExecutionConfig(options.env);
  requireConfigured(config);
  const taskType = options.taskType || config.taskType;
  const body = {
    task_type: taskType,
    input,
    model: options.model || config.model || "auto",
    priority: options.priority || config.priority || "normal",
    response_mode: options.responseMode || config.responseMode || "async",
    metadata: options.metadata || {}
  };
  const idempotencyKey = options.idempotencyKey || `sales-dashboard:${taskType}:${hash(JSON.stringify(input)).slice(0, 32)}`;
  return requestJson(`${config.baseUrl}/run-task`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.projectApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(options.correlationId ? { "X-Correlation-ID": options.correlationId } : {})
    },
    body: JSON.stringify(body)
  }, options.fetchImpl);
}

async function getAiJob(jobId, options = {}) {
  const config = options.config || resolveAiExecutionConfig(options.env);
  requireConfigured(config);
  return requestJson(`${config.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${config.projectApiKey}`
    }
  }, options.fetchImpl);
}

async function submitTranscriptEvaluation(call, options = {}) {
  const input = buildTranscriptEvaluationInput(call, options);
  return submitAiTask(input, {
    ...options,
    metadata: {
      source_system: "sales_dashboard",
      source_type: "call_transcript",
      source_record_id: call.callId,
      import_id: options.importId || null,
      ...options.metadata
    },
    idempotencyKey: options.idempotencyKey || `sales-dashboard:call:${call.callId}:${hash(JSON.stringify(input)).slice(0, 24)}`
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_LAYER_PATH,
  DEFAULT_TASK_TYPE,
  buildTranscriptEvaluationInput,
  checkAiExecutionHealth,
  getAiJob,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitAiTask,
  submitTranscriptEvaluation
};
