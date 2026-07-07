"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_LAYER_PATH = "C:\\Users\\User\\Desktop\\ai-execution-layer";
const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_TASK_TYPE = "sales_transcript_evaluation";
const INTELLIGENCE_TASK_TYPE = "sales_transcript_intelligence_extraction";

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
      customer_id: call.customerId || "",
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
    source_attribution: {
      customer_import_source: call.customerImportSource || call.source || "",
      customer_import_date: call.customerImportDateIso || "",
      days_since_import: call.daysSinceImport,
      customer_created_by: call.customerCreatedBy || "",
      customer_created_by_type: call.customerCreatedByType || "",
      customer_create_date: call.customerCreateDateIso || "",
      days_since_created: call.daysSinceCreated
    },
    transcript: call.transcript || "",
    sanitized_raw_fields: call.rawFields || {},
    guardrails: [
      "Redacted phone numbers are not available and must not be reconstructed.",
      "Use normalized source_attribution dates when present; treat blank or malformed raw date fragments as missing.",
      "Treat deterministic scores as baseline evidence, not final truth.",
      "If evidence is insufficient, say so."
    ]
  };
}

function truncatedText(value, maxChars = 8000) {
  const text = clean(value);
  const limit = Math.max(500, Number(maxChars || 8000));
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}\n\n[Transcript truncated for local model context: ${text.length - limit} characters omitted.]`;
}

function intelligenceRawFields(rawFields = {}) {
  const omitted = new Set(["transcription_text", "Baz_DetailedNotes", "transcript"]);
  return Object.fromEntries(
    Object.entries(rawFields || {}).filter(([key]) => !omitted.has(key))
  );
}

function buildTranscriptIntelligenceInput(call, deterministicIntelligence, options = {}) {
  if (!call) throw new Error("call is required");
  if (!deterministicIntelligence?.call) throw new Error("deterministicIntelligence.call is required");
  const maxTranscriptChars = options.maxTranscriptChars || 8000;
  return {
    schema_version: "sales_dashboard_call_intelligence_llm.v1",
    instructions: [
      "Return minified strict JSON only, with no markdown, prose, wrappers, or duplicated output fields.",
      "Keep the whole response under 900 completion tokens.",
      "Extract facts, events, risk flags, and scoring evidence from the supplied transcript.",
      "Preserve the distinction between transcript facts, interpretations, and scores.",
      "Do not infer revenue, conversion, order value, or CRM outcomes that are not in the transcript.",
      "Every important entity, event, flag, or score must include evidence text and confidence.",
      "Use null or an empty array when evidence is insufficient; do not invent details.",
      "Return at most 2 entities, 2 events, and 2 risk_flags; choose only the strongest evidence.",
      "Keep each evidence string under 140 characters.",
      "Evidence must be a real transcript phrase that supports the exact label; never use a single keyword or category name as evidence.",
      "Only emit payment_or_order_intent when the customer clearly agrees to pay/order/book/proceed with this offer, asks for an invoice, or gives/requests payment details.",
      "Do not infer payment_or_order_intent from unrelated finance wording such as paying a mortgage, bills, wages, rent, fines, debts, tax, or general affordability complaints.",
      "Do not flag ordinary campaign references to Police, SES, ambulance, schools, charities, or Blue Light as legal/compliance risk unless the transcript includes actual threat, deception, fraud concern, complaint, privacy issue, or coercive pressure."
    ],
    output_contract: {
      call_summary: {
        decision_maker_status: "unknown|reached|gatekeeper|unavailable|null",
        overall_call_outcome: "string",
        customer_sentiment: "interested|neutral|skeptical|confused|annoyed|angry|hostile|unknown",
        lead_utilization_score: "integer 0-5",
        salesperson_quality_score: "integer 0-100",
        manager_review_required: "boolean",
        brief_reason: "string",
        confidence: "0-1"
      },
      entities: [
        { entity_type: "string", raw_value: "string", normalized_value: "string|null", speaker: "customer|salesperson|voicemail|unknown", evidence: "string", confidence: "0-1" }
      ],
      events: [
        { event_type: "string", speaker: "customer|salesperson|voicemail|unknown", raw_value: "string|null", normalized_value: "string|null", follow_up_required: "boolean", due_at: "ISO-8601|null", evidence: "string", confidence: "0-1" }
      ],
      risk_flags: [
        { flag_type: "string", severity: "low|medium|high|critical", speaker: "customer|salesperson|unknown", evidence: "string", confidence: "0-1", manager_review_recommended: "boolean" }
      ],
      limitations: ["string"]
    },
    source: {
      system: "Sales Dashboard",
      import_id: options.importId || null,
      source_name: options.sourceName || null,
      call_id: call.callId,
      salesperson: call.salesperson,
      call_date: call.date,
      call_time: call.time
    },
    deterministic_intelligence: deterministicIntelligence,
    transcript: truncatedText(call.transcript || "", maxTranscriptChars),
    sanitized_raw_fields: intelligenceRawFields(call.rawFields || {}),
    guardrails: [
      "Redacted phone values are intentionally unavailable and must not be reconstructed.",
      "OrderCount can indicate historical warmth but is not proof this call converted.",
      "NoSaleType is a weak imported label and may be wrong.",
      "Use transcript evidence first; use structured fields only as context.",
      "If the transcript was truncated, limit conclusions to visible evidence."
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

async function submitTranscriptIntelligenceExtraction(call, deterministicIntelligence, options = {}) {
  const input = buildTranscriptIntelligenceInput(call, deterministicIntelligence, options);
  const taskRevision = options.taskRevision || "evidence-grounded-v4";
  return submitAiTask(input, {
    ...options,
    taskType: options.taskType || INTELLIGENCE_TASK_TYPE,
    metadata: {
      source_system: "sales_dashboard",
      source_type: "call_transcript_intelligence",
      source_record_id: call.callId,
      import_id: options.importId || null,
      extraction_version: deterministicIntelligence.call.extractionVersion,
      task_revision: taskRevision,
      ...options.metadata
    },
    idempotencyKey: options.idempotencyKey || `sales-dashboard:intelligence:${taskRevision}:${call.callId}:${hash(JSON.stringify(input)).slice(0, 24)}`
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_LAYER_PATH,
  DEFAULT_TASK_TYPE,
  INTELLIGENCE_TASK_TYPE,
  buildTranscriptIntelligenceInput,
  buildTranscriptEvaluationInput,
  checkAiExecutionHealth,
  getAiJob,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitAiTask,
  submitTranscriptIntelligenceExtraction,
  submitTranscriptEvaluation
};
