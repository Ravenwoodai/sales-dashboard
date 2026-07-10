"use strict";

const crypto = require("crypto");

const EVALUATION_STUDIO_SCHEMA_VERSION = "sales_dashboard_evaluation_studio.v1";
const EVALUATION_STUDIO_ACTOR = "local_manager";

const KNOWLEDGEBASE_CATEGORIES = new Set([
  "procedure",
  "sales_script",
  "objection_handling",
  "payment_ask",
  "close",
  "callback_handling",
  "lead_validity",
  "coaching",
  "compliance",
  "product_context",
  "examples",
  "manager_guidance",
  "general"
]);

const EVALUATION_GOALS = new Set([
  "procedure_adherence",
  "salesperson_procedure_adherence",
  "stage_failure_detection",
  "intro_quality",
  "close_payment_ask_quality",
  "lead_utilisation",
  "objection_handling",
  "objection_detection",
  "callback_opportunity",
  "follow_up_quality",
  "follow_up_leakage",
  "lead_validity_utilisation",
  "lead_still_valid",
  "lead_spent_utilised",
  "tough_lead_vs_poor_attempt",
  "coaching_opportunity",
  "risk_compliance_review",
  "outcome_mismatch_review"
]);

const EVALUATION_RUN_STATUSES = new Set([
  "draft",
  "queued",
  "running",
  "completed",
  "partially_completed",
  "failed",
  "quarantined",
  "cancelled"
]);

const EVALUATION_RUN_TYPES = new Set([
  "batch",
  "prompt_test"
]);

const EVALUATION_RESULT_STATUSES = new Set([
  "usable",
  "insufficient_evidence",
  "failed"
]);

const EVIDENCE_AVAILABILITY = new Set([
  "available",
  "partial",
  "unavailable"
]);

const TRANSCRIPT_QUALITIES = new Set([
  "high",
  "medium",
  "low",
  "unusable",
  "unknown"
]);

const BLOCKED_FIELD_PATTERN = /(allocation|campaign|qty[_\s-]*actioned|stable[_\s-]*lead|lead[_\s-]*day|allocated[_\s-]*versus[_\s-]*called|reconciliation)/i;
const BLOCKED_RESULT_PATTERN = /(allocation[_\s-]*(coverage|reconciliation)|qty[_\s-]*actioned|stable[_\s-]*lead|lead[_\s-]*day|allocated[_\s-]*versus[_\s-]*called|leads[_\s-]*(allocated|remaining)|observed[_\s-]*vs[_\s-]*actioned|campaign[_\s-]*allocation)/i;

const EVALUATION_FINDING_TO_CORRECTION_FIELD = Object.freeze({
  contact_classification: "contact_classification",
  probable_live_human: "probable_live_human",
  live_human: "probable_live_human",
  meaningful_conversation: "meaningful_conversation",
  actionable_conversation: "actionable_conversation",
  voicemail_flag: "voicemail_flag",
  voicemail: "voicemail_flag",
  system_audio_flag: "system_audio_flag",
  system_audio: "system_audio_flag",
  no_answer_probable: "no_answer_probable",
  no_answer: "no_answer_probable",
  wrong_number_flag: "wrong_number_flag",
  wrong_number: "wrong_number_flag",
  local_outcome: "local_outcome_category",
  local_outcome_category: "local_outcome_category",
  outcome_category: "local_outcome_category",
  local_outcome_detail: "local_outcome_detail",
  outcome_detail: "local_outcome_detail",
  outcome_mismatch: "outcome_mismatch_confirmed",
  outcome_mismatch_confirmed: "outcome_mismatch_confirmed",
  callback_requested: "follow_up_required",
  callback_required: "follow_up_required",
  follow_up_required: "follow_up_required",
  follow_up_needed: "follow_up_required",
  follow_up_status: "follow_up_status",
  callback_status: "follow_up_status",
  follow_up_channel: "follow_up_channel",
  callback_channel: "follow_up_channel",
  callback_timing: "follow_up_due_text",
  follow_up_timing: "follow_up_due_text",
  follow_up_due_text: "follow_up_due_text",
  follow_up_due_datetime: "follow_up_due_datetime",
  follow_up_manually_completed: "follow_up_manually_completed",
  manually_completed: "follow_up_manually_completed",
  follow_up_dismissed: "follow_up_dismissed",
  coaching_flag: "coaching_flag_confirmed",
  coaching_flag_confirmed: "coaching_flag_confirmed",
  coaching_priority: "coaching_priority",
  coaching_note: "coaching_note",
  risk_flag: "risk_flag_confirmed",
  risk_flag_confirmed: "risk_flag_confirmed",
  complaint: "complaint_confirmed",
  complaint_confirmed: "complaint_confirmed",
  opt_out: "opt_out_confirmed",
  opt_out_confirmed: "opt_out_confirmed",
  compliance_review_required: "compliance_review_required",
  evidence_assessment: "evidence_assessment"
});

const DEFAULT_OUTPUT_SCHEMA = {
  schema_version: "sales_dashboard_evaluation_result.v1",
  evaluation_goal: "string",
  call_id: "string",
  status: "usable|insufficient_evidence|failed",
  confidence: "number 0-1",
  evidence_availability: "available|partial|unavailable",
  transcript_quality: "high|medium|low|unusable|unknown",
  findings: [
    {
      field: "string",
      value: "string|boolean|number|null",
      evidence: "short transcript quote",
      confidence: "number 0-1",
      manager_review_recommended: "boolean"
    }
  ],
  manager_summary: "short manager-friendly summary",
  limitations: ["string"]
};

const DEFAULT_KNOWLEDGEBASE_ENTRIES = [
  {
    id: "kb_neuron_standard_sales_procedure",
    title: "Standard Sales Procedure",
    category: "procedure",
    tags: ["script", "intro", "purpose", "offer", "close"],
    sourceProject: "Neuron-Compute-Training",
    sourceReference: "docs/STANDARD_SES_YEARBOOK_SPIEL.md and attached sales playbooks",
    content: [
      "Use this as the procedure-adherence baseline. A complete attempt should have a clear opener, confirm the right person where possible, explain the purpose of the call, frame the publication/support offer plainly, handle the customer's main concern, ask for a next step, and confirm any agreed follow-up.",
      "Do not score a call down for a valid terminal outcome such as wrong number, clear opt-out, complaint, or a customer who was properly spieled and declined."
    ].join("\n\n")
  },
  {
    id: "kb_neuron_objection_recovery_patterns",
    title: "Objection Recovery Patterns",
    category: "objection_handling",
    tags: ["objections", "recovery", "coaching"],
    sourceProject: "Neuron-Compute-Training",
    sourceReference: "attached_assets/conversation_recovery_patterns_1773036587280.md",
    content: [
      "Objection handling should be assessed as acknowledge, reassure, reframe, then offer a sensible next step.",
      "Common objection categories include affordability, not the decision maker, too busy, call later, not interested, wants information, needs partner approval, scepticism or trust concern, timing issue, and no clear objection.",
      "A callback request after a positive response should become a reviewable follow-up opportunity, not a confirmed sale."
    ].join("\n\n")
  },
  {
    id: "kb_neuron_call_scoring_framework",
    title: "Sales Call Scoring Framework",
    category: "coaching",
    tags: ["scorecard", "stage_failure", "coaching"],
    sourceProject: "Neuron-Compute-Training",
    sourceReference: "attached_assets/sales_call_scoring_model_1773036587280.md",
    content: [
      "Use stage-level coaching rather than blame. Assess opener, rapport, purpose framing, offer presentation, objection handling, payment or next-step ask, close, and confirmation.",
      "Where evidence is weak, label the issue as review needed or insufficient evidence. Do not claim confirmed conversion, lost revenue, or salesperson fault."
    ].join("\n\n")
  },
  {
    id: "kb_neuron_callback_and_lead_validity",
    title: "Callback Opportunity And Lead Validity Rules",
    category: "callback_handling",
    tags: ["lead_harvest", "callback", "follow_up", "lead_validity"],
    sourceProject: "Neuron-Compute-Training",
    sourceReference: "attached_assets/sales_rag_pipeline_1773037344086.md plus Sales Dashboard guardrails",
    content: [
      "A lead may still be valid when the customer shows interest, asks for a callback, requests information, explains timing or budget constraints, or asks to speak later.",
      "Use 'later matching call observed' only when the active call data contains a later stable-ID match. It does not prove completion.",
      "Use manager-confirmed completed only when a manager explicitly records completion through the review workflow."
    ].join("\n\n")
  },
  {
    id: "kb_latentpulse_structured_evidence_governance",
    title: "Structured Evidence Governance",
    category: "manager_guidance",
    tags: ["schema", "confidence", "evidence", "review"],
    sourceProject: "LatentPulse",
    sourceReference: "docs/PHASE1_LOCAL_APIS.md and docs/PHASE1_REVIEW_ASSISTANT_TRAINING.md",
    content: [
      "Every model output must be structured, evidence-backed, confidence-labelled, and reviewable. Missing evidence should be labelled rather than hidden.",
      "Local model results are assistant evidence only. Manager review is the governance layer that confirms, corrects, rejects, or escalates findings."
    ].join("\n\n")
  }
];

const DEFAULT_EVALUATION_TEMPLATES = [
  {
    id: "template_procedure_adherence_v1",
    name: "Procedure Adherence Review",
    evaluationGoal: "procedure_adherence",
    description: "Checks whether the attempt followed the expected sales procedure and identifies the stage where the attempt weakened.",
    instructions: [
      "Evaluate whether the salesperson followed the standard procedure using only the transcript and supplied knowledgebase.",
      "Identify the strongest stage-level issue if one exists: intro, rapport, purpose, offer, objection handling, payment or next-step ask, close, confirmation, or no issue found.",
      "If the call reached a valid terminal outcome, do not label it as waste."
    ].join("\n")
  },
  {
    id: "template_objection_handling_v1",
    name: "Objection And Handling Review",
    evaluationGoal: "objection_handling",
    description: "Tags customer objections and evaluates whether the salesperson acknowledged and handled them.",
    instructions: [
      "Detect the customer's main objection, if any.",
      "Classify whether the salesperson acknowledged, reassured, reframed, and offered a next step.",
      "Separate tough-lead evidence from poor-attempt evidence and recommend manager review when uncertain."
    ].join("\n")
  },
  {
    id: "template_callback_opportunity_v1",
    name: "Callback Opportunity And Lead Harvest",
    evaluationGoal: "callback_opportunity",
    description: "Finds positive-response callback opportunities and handover notes for the next salesperson.",
    instructions: [
      "Identify whether the customer gave a positive or soft-positive response and requested a callback, information, or later timing.",
      "Extract possible name, callback timing, objection, useful handover context, and confidence.",
      "Do not call the follow-up completed unless manager-confirmed completion exists."
    ].join("\n")
  },
  {
    id: "template_lead_validity_utilisation_v1",
    name: "Lead Validity And Utilisation",
    evaluationGoal: "lead_validity_utilisation",
    description: "Assesses whether the lead appears spent, still valid, tough, or possibly under-utilised.",
    instructions: [
      "Do not treat one dial as waste by itself.",
      "A possible utilisation issue requires evidence such as no human reached, voicemail/no answer/system audio, no spiel delivered, positive callback not followed up, or unresolved next step.",
      "Return insufficient_evidence when the transcript or future data window cannot support a firm signal."
    ].join("\n")
  }
];

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return clean(value).split(",");
}

function normalizeTags(value) {
  return Array.from(new Set(toArray(value)
    .map((item) => clean(item).toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)))
    .slice(0, 20);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on", "active"].includes(clean(value).toLowerCase());
}

function clampNumber(value, fallback = null, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function safeJsonSchema(value) {
  if (!value) return DEFAULT_OUTPUT_SCHEMA;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    const wrapped = new Error(`Output schema must be valid JSON: ${error.message}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }
}

function assertNoParkedAllocationLanguage(value, fieldName = "field") {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  if (BLOCKED_FIELD_PATTERN.test(text)) {
    const error = new Error(`${fieldName} cannot reference parked campaign/allocation concepts.`);
    error.statusCode = 400;
    throw error;
  }
}

function assertNoParkedResultLanguage(value, fieldName = "field") {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  if (BLOCKED_RESULT_PATTERN.test(text)) {
    const error = new Error(`${fieldName} cannot reference parked campaign/allocation concepts.`);
    error.statusCode = 400;
    throw error;
  }
}

function normalizeCategory(value) {
  const category = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "general";
  return KNOWLEDGEBASE_CATEGORIES.has(category) ? category : "general";
}

function normalizeGoal(value) {
  const goal = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!goal) {
    const error = new Error("Evaluation goal is required.");
    error.statusCode = 400;
    throw error;
  }
  if (goal.length > 100) {
    const error = new Error("Evaluation goal must be 100 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }
  assertNoParkedAllocationLanguage(goal, "evaluationGoal");
  return goal;
}

function normalizeRunStatus(value, fallback = "queued") {
  const status = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  if (EVALUATION_RUN_STATUSES.has(status)) return status;
  const error = new Error("Unknown evaluation run status.");
  error.statusCode = 400;
  throw error;
}

function normalizeRunType(value, fallback = "batch") {
  const type = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  return EVALUATION_RUN_TYPES.has(type) ? type : fallback;
}

function normalizeResultStatus(value, fallback = "usable") {
  const status = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  if (EVALUATION_RESULT_STATUSES.has(status)) return status;
  const error = new Error("Unknown evaluation result status.");
  error.statusCode = 400;
  throw error;
}

function normalizeEvidenceAvailability(value) {
  const text = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return EVIDENCE_AVAILABILITY.has(text) ? text : "unavailable";
}

function normalizeTranscriptQuality(value) {
  const text = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return TRANSCRIPT_QUALITIES.has(text) ? text : "unknown";
}

function confidenceBand(confidence, status = "usable", transcriptQuality = "unknown") {
  if (status === "failed") return "unusable";
  if (transcriptQuality === "unusable") return "unusable";
  if (confidence === null || confidence === undefined) return "confidence_unavailable";
  if (confidence >= 0.78) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

function normalizeKnowledgebaseEntry(entry = {}) {
  const title = clean(entry.title) || "Untitled knowledgebase entry";
  const content = clean(entry.content);
  const createdAt = entry.createdAt || nowIso();
  const version = Number(entry.version || 1);
  return {
    id: clean(entry.id) || `kb_${digest(`${title}\n${content}`, 20)}`,
    title: title.slice(0, 180),
    content,
    category: normalizeCategory(entry.category),
    tags: normalizeTags(entry.tags),
    status: parseBoolean(entry.isActive, entry.status !== "archived") ? "active" : "archived",
    isActive: parseBoolean(entry.isActive, entry.status !== "archived"),
    version,
    contentHash: digest(content, 24),
    sourceProject: clean(entry.sourceProject),
    sourceReference: clean(entry.sourceReference),
    createdBy: clean(entry.createdBy) || EVALUATION_STUDIO_ACTOR,
    updatedBy: clean(entry.updatedBy) || EVALUATION_STUDIO_ACTOR,
    createdAt,
    updatedAt: entry.updatedAt || createdAt
  };
}

function normalizeEvaluationTemplate(template = {}) {
  const name = clean(template.name) || "Untitled evaluation template";
  const instructions = clean(template.instructions || template.promptInstructions || template.systemPrompt);
  const outputSchema = safeJsonSchema(template.outputSchema);
  assertNoParkedAllocationLanguage(template.evaluationGoal || template.goal || "procedure_adherence", "evaluationGoal");
  assertNoParkedAllocationLanguage(outputSchema, "outputSchema");
  const createdAt = template.createdAt || nowIso();
  const version = Number(template.version || 1);
  const evaluationGoal = normalizeGoal(template.evaluationGoal || template.goal || "procedure_adherence");
  return {
    id: clean(template.id) || `template_${digest(`${name}\n${evaluationGoal}`, 20)}`,
    name: name.slice(0, 180),
    description: clean(template.description).slice(0, 500),
    evaluationGoal,
    instructions,
    outputSchema,
    tags: normalizeTags(template.tags),
    status: parseBoolean(template.isActive, template.status !== "archived") ? "active" : "archived",
    isActive: parseBoolean(template.isActive, template.status !== "archived"),
    version,
    promptHash: digest(`${instructions}\n${JSON.stringify(outputSchema)}`, 24),
    sourceProject: clean(template.sourceProject),
    sourceReference: clean(template.sourceReference),
    createdBy: clean(template.createdBy) || EVALUATION_STUDIO_ACTOR,
    updatedBy: clean(template.updatedBy) || EVALUATION_STUDIO_ACTOR,
    createdAt,
    updatedAt: template.updatedAt || createdAt
  };
}

function normalizeEvaluationRun(run = {}) {
  const createdAt = run.createdAt || nowIso();
  return {
    id: clean(run.id) || `eval_run_${digest(`${run.importId || "current"}\n${run.templateId || ""}\n${createdAt}`, 20)}`,
    importId: clean(run.importId) || "current",
    runType: normalizeRunType(run.runType || run.type),
    templateId: clean(run.templateId),
    templateVersion: Number(run.templateVersion || run.templateSnapshot?.version || 1),
    templateSnapshot: run.templateSnapshot || null,
    knowledgebaseIds: normalizeTags(run.knowledgebaseIds || []),
    knowledgebaseSnapshot: Array.isArray(run.knowledgebaseSnapshot) ? run.knowledgebaseSnapshot : [],
    status: normalizeRunStatus(run.status || "queued"),
    requestedBy: clean(run.requestedBy) || EVALUATION_STUDIO_ACTOR,
    createdAt,
    updatedAt: run.updatedAt || createdAt,
    startedAt: clean(run.startedAt),
    completedAt: clean(run.completedAt),
    callSelection: run.callSelection || {},
    plannedCallCount: Number(run.plannedCallCount || 0),
    queuedJobCount: Number(run.queuedJobCount || 0),
    completedCallCount: Number(run.completedCallCount || 0),
    failedCallCount: Number(run.failedCallCount || 0),
    queuedJobs: Array.isArray(run.queuedJobs) ? run.queuedJobs : [],
    errors: Array.isArray(run.errors) ? run.errors : [],
    quarantineReason: clean(run.quarantineReason || run.quarantine_reason),
    quarantinedAt: clean(run.quarantinedAt || run.quarantined_at),
    quarantinedBy: clean(run.quarantinedBy || run.quarantined_by),
    resumedAt: clean(run.resumedAt || run.resumed_at),
    resumedBy: clean(run.resumedBy || run.resumed_by),
    resumeCount: Number(run.resumeCount || run.resume_count || 0),
    runHistory: Array.isArray(run.runHistory || run.run_history) ? (run.runHistory || run.run_history).filter((entry) => entry && typeof entry === "object") : [],
    guardrails: Array.isArray(run.guardrails) ? run.guardrails : defaultEvaluationGuardrails()
  };
}

function normalizeFinding(finding = {}, index = 0) {
  const field = clean(finding.field || finding.field_name || finding.name || `finding_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || `finding_${index + 1}`;
  assertNoParkedResultLanguage(field, "finding field");
  const confidence = clampNumber(finding.confidence, null);
  const evidence = clean(finding.evidence || finding.source_snippet || finding.sourceSnippet || finding.quote || finding.proof).slice(0, 900);
  const value = finding.value === undefined ? finding.result ?? finding.classification ?? null : finding.value;
  const rawValue = finding.rawValue ?? finding.raw_value ?? "";
  const deterministicValue = finding.deterministicValue ?? finding.deterministic_value ?? finding.baselineValue ?? finding.baseline_value ?? "";
  const llmValue = finding.llmValue ?? finding.llm_value ?? finding.modelValue ?? finding.model_value ?? "";
  const previousDisplayValue = finding.previousDisplayValue ?? finding.previous_display_value ?? deterministicValue ?? "";
  assertNoParkedResultLanguage(value, "finding value");
  assertNoParkedResultLanguage(evidence, "finding evidence");
  assertNoParkedResultLanguage(rawValue, "finding raw value");
  assertNoParkedResultLanguage(deterministicValue, "finding deterministic value");
  assertNoParkedResultLanguage(llmValue, "finding model value");
  assertNoParkedResultLanguage(previousDisplayValue, "finding previous display value");
  return {
    field,
    value,
    evidence,
    rawValue: clean(rawValue).slice(0, 500),
    deterministicValue: clean(deterministicValue).slice(0, 500),
    llmValue: clean(llmValue).slice(0, 500),
    previousDisplayValue: clean(previousDisplayValue).slice(0, 500),
    confidence,
    confidenceBand: confidenceBand(confidence),
    managerReviewRecommended: parseBoolean(finding.manager_review_recommended ?? finding.managerReviewRecommended, false),
    note: clean(finding.note || finding.reason || finding.rationale).slice(0, 500)
  };
}

function suggestionValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return clean(value).slice(0, 500);
}

function buildManagerReviewPrefillCorrections(result = {}, options = {}) {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const suggestions = new Map();
  findings.forEach((finding) => {
    const field = clean(finding.field)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const fieldName = EVALUATION_FINDING_TO_CORRECTION_FIELD[field];
    if (!fieldName) return;
    const suggestedValue = suggestionValue(finding.value);
    if (!suggestedValue && finding.value !== false && finding.value !== 0) return;
    const confidence = clampNumber(finding.confidence, null);
    const candidate = {
      fieldName,
      previousDisplayValue: clean(finding.previousDisplayValue || finding.deterministicValue || "").slice(0, 500),
      deterministicValue: clean(finding.deterministicValue || finding.previousDisplayValue || "").slice(0, 500),
      rawValue: clean(finding.rawValue || "").slice(0, 500),
      llmValue: clean(finding.llmValue || suggestedValue).slice(0, 500),
      managerSuggestedValue: suggestedValue,
      suggestedValue,
      correctionReason: clean(finding.note || result.managerSummary || "Evaluation Studio suggested this as a manager-review prefill.").slice(0, 500),
      evidenceAssessment: result.evidenceAvailability === "available"
        ? "evaluation_evidence_available"
        : result.evidenceAvailability === "partial"
          ? "evaluation_evidence_partial"
          : "evaluation_evidence_unavailable",
      evidence: clean(finding.evidence || "").slice(0, 900),
      confidence,
      confidenceBand: confidenceBand(confidence),
      sourceResultId: clean(result.id),
      sourceFindingField: field,
      sourceEvaluationGoal: clean(result.evaluationGoal),
      sourceProvenance: clean(result.provenance || "evaluation_studio_local_model"),
      note: "Suggested only. Manager must confirm before it becomes a manager correction."
    };
    const existing = suggestions.get(fieldName);
    if (!existing || Number(candidate.confidence || 0) > Number(existing.confidence || 0)) {
      suggestions.set(fieldName, candidate);
    }
  });
  return Array.from(suggestions.values()).slice(0, Number(options.limit || 8));
}

function normalizeEvaluationResult(record = {}, context = {}) {
  const output = record.result || record.output || record.response || record.payload || record.structuredOutput || record;
  const run = context.run || {};
  const template = context.template || run.templateSnapshot || {};
  const createdAt = record.createdAt || nowIso();
  const importId = clean(record.importId || record.import_id || output.import_id || output.importId || run.importId || context.importId || "current");
  const callId = clean(record.callId || record.call_id || output.call_id || output.callId || output.source_record_id || output.metadata?.source_record_id);
  if (!callId) {
    const error = new Error("callId is required for an Evaluation Studio result.");
    error.statusCode = 400;
    throw error;
  }
  const evaluationGoal = normalizeGoal(output.evaluation_goal || output.evaluationGoal || record.evaluationGoal || template.evaluationGoal || "procedure_adherence");
  const status = normalizeResultStatus(output.status || record.status || "usable");
  const evidenceAvailability = normalizeEvidenceAvailability(output.evidence_availability || output.evidenceAvailability || record.evidenceAvailability);
  const transcriptQuality = normalizeTranscriptQuality(output.transcript_quality || output.transcriptQuality || record.transcriptQuality);
  const confidence = clampNumber(output.confidence ?? record.confidence, null);
  const rawFindings = Array.isArray(output.findings || record.findings)
    ? output.findings || record.findings
    : output.findings || record.findings
      ? [output.findings || record.findings]
      : [];
  const findings = rawFindings.slice(0, 30).map(normalizeFinding);
  const limitations = toArray(output.limitations || record.limitations).map((item) => clean(item).slice(0, 500)).filter(Boolean).slice(0, 20);
  const managerSummary = clean(output.manager_summary || output.managerSummary || record.managerSummary || output.summary).slice(0, 1200);
  const runKnowledgebaseSnapshot = Array.isArray(run.knowledgebaseSnapshot) ? run.knowledgebaseSnapshot : [];
  const explicitKnowledgebaseIds = toArray(record.knowledgebaseIds || record.knowledgebaseEntryIds || output.knowledgebase_ids || output.knowledgebaseIds || output.knowledgebase_entry_ids)
    .map(clean)
    .filter(Boolean);
  const knowledgebaseIds = explicitKnowledgebaseIds.length
    ? explicitKnowledgebaseIds
    : runKnowledgebaseSnapshot.map((entry) => clean(entry.id)).filter(Boolean);
  const explicitKnowledgebaseVersions = Array.isArray(record.knowledgebaseVersions || output.knowledgebase_versions || output.knowledgebaseVersions)
    ? record.knowledgebaseVersions || output.knowledgebase_versions || output.knowledgebaseVersions
    : [];
  const knowledgebaseVersions = explicitKnowledgebaseVersions.length
    ? explicitKnowledgebaseVersions.map((entry) => ({
      id: clean(entry.id || entry.knowledgebaseId || entry.knowledgebase_id),
      version: Number(entry.version || entry.knowledgebaseVersion || entry.knowledgebase_version || 1),
      contentHash: clean(entry.contentHash || entry.content_hash)
    })).filter((entry) => entry.id)
    : runKnowledgebaseSnapshot.map((entry) => ({
      id: clean(entry.id),
      version: Number(entry.version || 1),
      contentHash: clean(entry.contentHash || entry.content_hash)
    })).filter((entry) => entry.id);
  assertNoParkedResultLanguage(managerSummary, "manager summary");
  limitations.forEach((limitation) => assertNoParkedResultLanguage(limitation, "limitation"));
  const reviewRecommended = parseBoolean(output.manager_review_recommended ?? output.managerReviewRecommended ?? record.managerReviewRecommended, false)
    || findings.some((finding) => finding.managerReviewRecommended)
    || status === "insufficient_evidence"
    || evidenceAvailability === "unavailable";
  const normalized = {
    id: clean(record.id),
    runId: clean(record.runId || record.evaluationRunId || record.evaluation_run_id || output.run_id || run.id),
    importId,
    callId,
    jobId: clean(record.jobId || record.job_id || output.job_id || output.jobId),
    templateId: clean(record.templateId || record.evaluationTemplateId || output.template_id || output.templateId || template.id),
    templateVersion: Number(record.templateVersion || output.template_version || template.version || 1),
    promptHash: clean(record.promptHash || output.prompt_hash || template.promptHash),
    knowledgebaseIds,
    knowledgebaseVersions,
    evaluationGoal,
    status,
    confidence,
    confidenceBand: confidenceBand(confidence, status, transcriptQuality),
    evidenceAvailability,
    transcriptQuality,
    findings,
    managerSummary,
    limitations,
    managerReviewRecommended: reviewRecommended,
    provenance: clean(record.provenance || output.provenance) || "evaluation_studio_local_model",
    source: "evaluation_studio",
    outputHash: digest(JSON.stringify({
      status,
      confidence,
      evidenceAvailability,
      transcriptQuality,
      findings,
      managerSummary,
      limitations
    }), 24),
    resultVersion: Number(record.resultVersion || 1),
    isLatest: record.isLatest !== false,
    createdBy: clean(record.createdBy) || EVALUATION_STUDIO_ACTOR,
    updatedBy: clean(record.updatedBy) || EVALUATION_STUDIO_ACTOR,
    createdAt,
    updatedAt: record.updatedAt || createdAt
  };
  normalized.id = normalized.id || `eval_result_${digest(`${normalized.importId}\n${normalized.callId}\n${normalized.runId}\n${normalized.templateId}\n${normalized.jobId}\n${normalized.outputHash}`, 24)}`;
  return normalized;
}

function defaultEvaluationGuardrails() {
  return [
    "Use active call/transcript data only.",
    "Do not use parked campaign/allocation imports.",
    "Do not claim confirmed sales, revenue, order value, close rate, true conversion, or lost revenue.",
    "Treat raw NoSaleType, Baz notes, deterministic outputs, and LLM outputs as context, not final truth.",
    "Return insufficient evidence rather than guessing.",
    "Manager corrections must remain separate manager-reviewed overlays."
  ];
}

function createDefaultEvaluationStudio() {
  return {
    schemaVersion: EVALUATION_STUDIO_SCHEMA_VERSION,
    seededFrom: ["Neuron-Compute-Training", "LatentPulse"],
    seededAt: nowIso(),
    knowledgebaseEntries: DEFAULT_KNOWLEDGEBASE_ENTRIES.map(normalizeKnowledgebaseEntry),
    evaluationTemplates: DEFAULT_EVALUATION_TEMPLATES.map((template) => normalizeEvaluationTemplate({
      ...template,
      outputSchema: DEFAULT_OUTPUT_SCHEMA,
      tags: [template.evaluationGoal, "seeded"],
      sourceProject: template.evaluationGoal === "lead_validity_utilisation" ? "LatentPulse" : "Neuron-Compute-Training",
      sourceReference: template.evaluationGoal === "lead_validity_utilisation"
        ? "Structured evidence governance and Sales Dashboard guardrails"
        : "Neuron sales training prompt and knowledgebase patterns"
    })),
    evaluationRuns: [],
    evaluationResults: []
  };
}

function normalizeEvaluationStudio(value = null) {
  if (!value || typeof value !== "object") return createDefaultEvaluationStudio();
  return {
    ...createDefaultEvaluationStudio(),
    ...value,
    schemaVersion: EVALUATION_STUDIO_SCHEMA_VERSION,
    knowledgebaseEntries: Array.isArray(value.knowledgebaseEntries)
      ? value.knowledgebaseEntries.map(normalizeKnowledgebaseEntry)
      : [],
    evaluationTemplates: Array.isArray(value.evaluationTemplates)
      ? value.evaluationTemplates.map(normalizeEvaluationTemplate)
      : [],
    evaluationRuns: Array.isArray(value.evaluationRuns)
      ? value.evaluationRuns.map(normalizeEvaluationRun)
      : [],
    evaluationResults: Array.isArray(value.evaluationResults)
      ? value.evaluationResults.map((result) => normalizeEvaluationResult(result))
      : []
  };
}

function evaluationStudioSummary(studio = {}, currentImportId = null, options = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const activeKnowledgebase = normalized.knowledgebaseEntries.filter((entry) => entry.isActive);
  const activeTemplates = normalized.evaluationTemplates.filter((template) => template.isActive);
  const runs = currentImportId
    ? normalized.evaluationRuns.filter((run) => run.importId === currentImportId)
    : normalized.evaluationRuns;
  const callIds = options.callIds
    ? new Set(Array.from(options.callIds).map(clean).filter(Boolean))
    : null;
  const byStatus = {};
  runs.forEach((run) => {
    byStatus[run.status] = (byStatus[run.status] || 0) + 1;
  });
  const results = listEvaluationResults(normalized, {
    importId: currentImportId || "",
    callIds
  });
  const resultsByStatus = {};
  const resultsByGoal = {};
  results.forEach((result) => {
    resultsByStatus[result.status] = (resultsByStatus[result.status] || 0) + 1;
    resultsByGoal[result.evaluationGoal] = (resultsByGoal[result.evaluationGoal] || 0) + 1;
  });
  const confidenceValues = results.map((result) => result.confidence).filter((value) => Number.isFinite(Number(value)));
  const lastRun = runs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  const lastResult = results.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  return {
    schemaVersion: "sales_dashboard_evaluation_studio_summary.v1",
    activeKnowledgebaseEntries: activeKnowledgebase.length,
    archivedKnowledgebaseEntries: normalized.knowledgebaseEntries.length - activeKnowledgebase.length,
    activeTemplates: activeTemplates.length,
    archivedTemplates: normalized.evaluationTemplates.length - activeTemplates.length,
    runs: runs.length,
    byStatus,
    results: results.length,
    resultsByStatus,
    resultsByGoal,
    reviewRecommendedResults: results.filter((result) => result.managerReviewRecommended).length,
    evidenceUnavailableResults: results.filter((result) => result.evidenceAvailability === "unavailable").length,
    averageConfidence: confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + Number(value), 0) / confidenceValues.length
      : null,
    filteredCallIds: callIds ? callIds.size : null,
    lastRun,
    lastResult,
    seededFrom: normalized.seededFrom || []
  };
}

function findingValueText(value) {
  if (value === undefined || value === null) return "Not supplied";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Not supplied";
  const text = clean(value);
  return text || "Not supplied";
}

function classifyReportFinding(result = {}, finding = {}) {
  const field = clean(finding.field).toLowerCase();
  const value = findingValueText(finding.value).toLowerCase();
  const haystack = `${field} ${value}`.replace(/_/g, " ");
  if (/\b(callback|call back|follow up|later matching call|manual completion)\b/.test(haystack)) {
    return { key: "callbackOpportunities", label: "Callback opportunity" };
  }
  if (/\b(objection|not decision maker|affordability|budget|timing|needs information|decision maker)\b/.test(haystack)) {
    return { key: "objectionsDetected", label: "Objection detected" };
  }
  if (/\b(handling|acknowledged|reframed|next step|poor handling|strong handling)\b/.test(haystack)) {
    return { key: "objectionHandlingSignals", label: "Objection handling signal" };
  }
  if (/\b(coaching|stage failure|procedure|intro|rapport|close|payment ask|poor attempt|tough lead)\b/.test(haystack)) {
    return { key: "coachingOpportunities", label: "Coaching opportunity" };
  }
  if (/\b(lead valid|lead validity|lead utilisation|lead utilization|still valid|spent|under utilised|under utilized|worth retry)\b/.test(haystack)) {
    return { key: "possibleWasteIndicators", label: "Possible lead utilisation issue" };
  }
  if (/\b(risk|complaint|opt_out|compliance|escalation)\b/.test(haystack)) {
    return { key: "riskReviewSignals", label: "Risk or compliance review" };
  }
  return null;
}

function incrementCounter(map, key, patch = {}) {
  if (!key) return;
  const current = map.get(key) || { key, count: 0, ...patch };
  map.set(key, {
    ...current,
    ...patch,
    count: Number(current.count || 0) + 1
  });
}

function buildEvaluationStudioReportRollups(studio = {}, options = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const importId = clean(options.importId || options.currentImportId);
  const callIds = options.callIds
    ? new Set(Array.from(options.callIds).map(clean).filter(Boolean))
    : null;
  const results = listEvaluationResults(normalized, {
    importId,
    callIds,
    includeSuperseded: false
  });
  const totals = {
    evaluatedResults: results.length,
    evaluatedCalls: new Set(results.map((result) => result.callId).filter(Boolean)).size,
    usableResults: results.filter((result) => result.status === "usable").length,
    insufficientEvidenceResults: results.filter((result) => result.status === "insufficient_evidence").length,
    failedResults: results.filter((result) => result.status === "failed").length,
    evidenceAvailableResults: results.filter((result) => result.evidenceAvailability === "available").length,
    evidencePartialResults: results.filter((result) => result.evidenceAvailability === "partial").length,
    evidenceUnavailableResults: results.filter((result) => result.evidenceAvailability === "unavailable").length,
    managerReviewRecommendedResults: results.filter((result) => result.managerReviewRecommended).length,
    highConfidenceResults: results.filter((result) => result.confidenceBand === "high").length,
    mediumConfidenceResults: results.filter((result) => result.confidenceBand === "medium").length,
    lowOrUnusableConfidenceResults: results.filter((result) => ["low", "unusable", "confidence_unavailable"].includes(result.confidenceBand)).length,
    callbackOpportunities: 0,
    objectionsDetected: 0,
    objectionHandlingSignals: 0,
    coachingOpportunities: 0,
    possibleWasteIndicators: 0,
    riskReviewSignals: 0
  };
  const goalMap = new Map();
  const fieldMap = new Map();
  const signalMap = new Map();
  const examples = [];

  results.forEach((result) => {
    incrementCounter(goalMap, result.evaluationGoal || "unknown", {
      evaluationGoal: result.evaluationGoal || "unknown"
    });
    (result.findings || []).forEach((finding) => {
      incrementCounter(fieldMap, finding.field || "unknown", {
        field: finding.field || "unknown"
      });
      const signal = classifyReportFinding(result, finding);
      if (!signal) return;
      totals[signal.key] += 1;
      incrementCounter(signalMap, signal.key, {
        signal: signal.key,
        label: signal.label
      });
      if (examples.length < 80) {
        examples.push({
          callId: result.callId,
          resultId: result.id,
          runId: result.runId,
          evaluationGoal: result.evaluationGoal,
          signal: signal.key,
          signalLabel: signal.label,
          field: finding.field,
          value: findingValueText(finding.value),
          confidence: finding.confidence,
          confidenceBand: finding.confidenceBand || result.confidenceBand,
          evidenceAvailability: result.evidenceAvailability,
          transcriptQuality: result.transcriptQuality,
          managerReviewRecommended: Boolean(result.managerReviewRecommended || finding.managerReviewRecommended),
          evidence: finding.evidence || result.managerSummary || "Evidence unavailable",
          managerSummary: result.managerSummary,
          reportLanguage: signal.key === "possibleWasteIndicators"
            ? "possible waste indicator"
            : signal.key === "coachingOpportunities"
              ? "coaching opportunity"
              : signal.key === "callbackOpportunities"
                ? "follow-up leakage review signal"
                : "evidence-backed signal"
        });
      }
    });
  });

  const sortedExamples = examples.slice().sort((a, b) => {
    const confidenceOrder = { high: 0, medium: 1, low: 2, unusable: 3, confidence_unavailable: 4 };
    return Number(b.managerReviewRecommended) - Number(a.managerReviewRecommended) ||
      (confidenceOrder[a.confidenceBand] ?? 9) - (confidenceOrder[b.confidenceBand] ?? 9) ||
      a.callId.localeCompare(b.callId);
  });

  return {
    schemaVersion: "sales_dashboard_evaluation_studio_report_rollups.v1",
    scope: {
      importId: importId || "all_imports",
      filteredCallIds: callIds ? callIds.size : null,
      source: "Evaluation Studio local-model results",
      use: "Report-ready lead utilisation and coaching signals for manager review, not disciplinary proof."
    },
    definitions: {
      possibleWasteIndicator: "A local-model evidence signal suggesting a lead utilisation issue or unresolved lead state. It is not a confirmed lost sale.",
      coachingOpportunity: "A local-model evidence signal that a call stage or behaviour may need coaching review.",
      callbackOpportunity: "A local-model evidence signal that a customer asked for a callback, timing, information, or another next step.",
      objectionSignal: "A local-model evidence signal describing the customer's stated objection or blocker.",
      proofStandard: "Counts are based on stored Evaluation Studio findings with evidence, confidence, transcript quality, and manager-review labels."
    },
    warnings: [
      "Do not claim confirmed sales, revenue, order value, close rate, true conversion, or lost revenue from these rollups.",
      "Use proof snippets and manager review before process-change decisions.",
      "No campaign/allocation data is used."
    ],
    totals,
    goalRows: Array.from(goalMap.values()).sort((a, b) => b.count - a.count || a.evaluationGoal.localeCompare(b.evaluationGoal)),
    fieldRows: Array.from(fieldMap.values()).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field)).slice(0, 30),
    signalRows: Array.from(signalMap.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    priorityExamples: sortedExamples.slice(0, 20),
    examples: sortedExamples
  };
}

function listKnowledgebaseEntries(studio = {}, options = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const includeArchived = parseBoolean(options.includeArchived, false);
  const category = clean(options.category);
  const tag = clean(options.tag).toLowerCase();
  return normalized.knowledgebaseEntries.filter((entry) => {
    if (!includeArchived && !entry.isActive) return false;
    if (category && entry.category !== normalizeCategory(category)) return false;
    if (tag && !entry.tags.includes(tag)) return false;
    return true;
  });
}

function listEvaluationTemplates(studio = {}, options = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const includeArchived = parseBoolean(options.includeArchived, false);
  const rawGoal = clean(options.evaluationGoal || options.goal);
  let goal = "";
  if (rawGoal) {
    try {
      goal = normalizeGoal(rawGoal);
    } catch (_error) {
      return [];
    }
  }
  return normalized.evaluationTemplates.filter((template) => {
    if (!includeArchived && !template.isActive) return false;
    if (goal && template.evaluationGoal !== goal) return false;
    return true;
  });
}

function listEvaluationResults(studio = {}, options = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const includeSuperseded = parseBoolean(options.includeSuperseded, false);
  const importId = clean(options.importId);
  const runId = clean(options.runId || options.evaluationRunId);
  const templateId = clean(options.templateId || options.evaluationTemplateId);
  const callId = clean(options.callId || options.call_id);
  const callIds = options.callIds
    ? new Set(Array.from(options.callIds).map(clean).filter(Boolean))
    : null;
  const rawGoal = clean(options.evaluationGoal || options.goal);
  const rawStatus = clean(options.status);
  const reviewOnly = parseBoolean(options.reviewRecommended || options.reviewOnly, false);
  const evidenceUnavailableOnly = parseBoolean(options.evidenceUnavailableOnly, false);
  let goal = "";
  let status = "";
  if (rawGoal) {
    try {
      goal = normalizeGoal(rawGoal);
    } catch (_error) {
      return [];
    }
  }
  if (rawStatus) {
    try {
      status = normalizeResultStatus(rawStatus);
    } catch (_error) {
      return [];
    }
  }
  return normalized.evaluationResults.filter((result) => {
    if (!includeSuperseded && result.isLatest === false) return false;
    if (importId && result.importId !== importId) return false;
    if (runId && result.runId !== runId) return false;
    if (templateId && result.templateId !== templateId) return false;
    if (callId && result.callId !== callId) return false;
    if (callIds && !callIds.has(result.callId)) return false;
    if (goal && result.evaluationGoal !== goal) return false;
    if (status && result.status !== status) return false;
    if (reviewOnly && !result.managerReviewRecommended) return false;
    if (evidenceUnavailableOnly && result.evidenceAvailability !== "unavailable") return false;
    return true;
  }).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function managerReviewScopeForEvaluationGoal(goal = "") {
  const normalized = clean(goal).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["callback_opportunity", "follow_up_quality", "follow_up_leakage"].includes(normalized)) return "follow_up";
  if ([
    "coaching_opportunity",
    "procedure_adherence",
    "salesperson_procedure_adherence",
    "stage_failure_detection",
    "intro_quality",
    "close_payment_ask_quality",
    "tough_lead_vs_poor_attempt"
  ].includes(normalized)) return "coaching";
  if ([
    "objection_handling",
    "objection_detection",
    "outcome_mismatch_review",
    "lead_validity_utilisation",
    "lead_utilisation",
    "lead_still_valid",
    "lead_spent_utilised"
  ].includes(normalized)) return "outcome";
  if (["risk_compliance_review"].includes(normalized)) return "risk";
  return "signal";
}

function managerReviewReasonForEvaluationResult(result = {}) {
  const findingSummary = (result.findings || [])
    .slice(0, 3)
    .map((finding) => `${finding.field}: ${finding.value === null || finding.value === undefined ? "not supplied" : finding.value}`)
    .join("; ");
  const parts = [
    `Evaluation Studio result: ${String(result.evaluationGoal || "evaluation").replace(/_/g, " ")}`,
    `Status: ${String(result.status || "unknown").replace(/_/g, " ")}`,
    `Confidence: ${result.confidence === null || result.confidence === undefined ? "unavailable" : `${Math.round(Number(result.confidence || 0) * 100)}%`}`,
    `Evidence: ${String(result.evidenceAvailability || "unavailable").replace(/_/g, " ")}`,
    findingSummary ? `Findings: ${findingSummary}` : "",
    result.managerSummary ? `Summary: ${result.managerSummary}` : ""
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 1800);
}

function upsertKnowledgebaseEntry(studio = {}, input = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const existing = normalized.knowledgebaseEntries.find((entry) => entry.id === clean(input.id));
  const now = nowIso();
  const entry = normalizeKnowledgebaseEntry({
    ...existing,
    ...input,
    version: existing ? Number(existing.version || 1) + 1 : input.version || 1,
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
    updatedBy: EVALUATION_STUDIO_ACTOR,
    createdBy: existing?.createdBy || EVALUATION_STUDIO_ACTOR
  });
  return {
    ...normalized,
    knowledgebaseEntries: [
      entry,
      ...normalized.knowledgebaseEntries.filter((item) => item.id !== entry.id)
    ]
  };
}

function upsertEvaluationTemplate(studio = {}, input = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const existing = normalized.evaluationTemplates.find((template) => template.id === clean(input.id));
  const now = nowIso();
  const template = normalizeEvaluationTemplate({
    ...existing,
    ...input,
    version: existing ? Number(existing.version || 1) + 1 : input.version || 1,
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
    updatedBy: EVALUATION_STUDIO_ACTOR,
    createdBy: existing?.createdBy || EVALUATION_STUDIO_ACTOR
  });
  return {
    ...normalized,
    evaluationTemplates: [
      template,
      ...normalized.evaluationTemplates.filter((item) => item.id !== template.id)
    ]
  };
}

function archiveKnowledgebaseEntry(studio = {}, id) {
  const normalized = normalizeEvaluationStudio(studio);
  const existing = normalized.knowledgebaseEntries.find((entry) => entry.id === clean(id));
  if (!existing) {
    const error = new Error("Knowledgebase entry not found.");
    error.statusCode = 404;
    throw error;
  }
  return upsertKnowledgebaseEntry(normalized, { ...existing, isActive: false, status: "archived" });
}

function archiveEvaluationTemplate(studio = {}, id) {
  const normalized = normalizeEvaluationStudio(studio);
  const existing = normalized.evaluationTemplates.find((template) => template.id === clean(id));
  if (!existing) {
    const error = new Error("Evaluation template not found.");
    error.statusCode = 404;
    throw error;
  }
  return upsertEvaluationTemplate(normalized, { ...existing, isActive: false, status: "archived" });
}

function createEvaluationRun(studio = {}, input = {}, context = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const templateId = clean(input.templateId || input.template_id);
  const template = normalized.evaluationTemplates.find((item) => item.id === templateId && item.isActive);
  if (!template) {
    const error = new Error("Active evaluation template not found.");
    error.statusCode = 404;
    throw error;
  }
  const requestedKbIds = new Set(toArray(input.knowledgebaseIds || input.knowledgebase_ids).map(clean).filter(Boolean));
  const knowledgebase = normalized.knowledgebaseEntries.filter((entry) => {
    if (!entry.isActive) return false;
    return !requestedKbIds.size || requestedKbIds.has(entry.id);
  });
  const createdAt = nowIso();
  const run = normalizeEvaluationRun({
    id: input.id || `eval_run_${digest(`${context.importId || input.importId || "current"}\n${template.id}\n${createdAt}`, 20)}`,
    importId: context.importId || input.importId || "current",
    runType: input.runType || input.type || context.runType || "batch",
    templateId: template.id,
    templateVersion: template.version,
    templateSnapshot: template,
    knowledgebaseIds: knowledgebase.map((entry) => entry.id),
    knowledgebaseSnapshot: knowledgebase.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      tags: entry.tags,
      version: entry.version,
      contentHash: entry.contentHash
    })),
    status: input.status || "queued",
    requestedBy: EVALUATION_STUDIO_ACTOR,
    createdAt,
    updatedAt: createdAt,
    callSelection: input.callSelection || {},
    plannedCallCount: context.plannedCallCount || input.plannedCallCount || 0,
    queuedJobCount: context.queuedJobCount || 0,
    completedCallCount: context.completedCallCount || 0,
    failedCallCount: context.failedCallCount || 0,
    queuedJobs: context.queuedJobs || [],
    errors: context.errors || [],
    guardrails: defaultEvaluationGuardrails()
  });
  return {
    studio: {
      ...normalized,
      evaluationRuns: [
        run,
        ...normalized.evaluationRuns.filter((item) => item.id !== run.id)
      ].slice(0, 1000)
    },
    run
  };
}

function updateEvaluationRun(studio = {}, runId, patch = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  let savedRun = null;
  const runs = normalized.evaluationRuns.map((run) => {
    if (run.id !== runId) return run;
    savedRun = normalizeEvaluationRun({
      ...run,
      ...patch,
      updatedAt: nowIso()
    });
    return savedRun;
  });
  if (!savedRun) {
    const error = new Error("Evaluation run not found.");
    error.statusCode = 404;
    throw error;
  }
  return {
    studio: {
      ...normalized,
      evaluationRuns: runs
    },
    run: savedRun
  };
}

function evaluationRunEventId(runId, action, timestamp, count = 0) {
  return `eval_run_event_${digest(`${runId}|${action}|${timestamp}|${count}`, 20)}`;
}

function appendEvaluationRunEvent(run = {}, action, input = {}) {
  const timestamp = input.now || nowIso();
  const existingHistory = Array.isArray(run.runHistory) ? run.runHistory : [];
  return [
    ...existingHistory,
    {
      eventId: evaluationRunEventId(run.id, action, timestamp, existingHistory.length),
      runId: run.id,
      action,
      previousStatus: run.status,
      newStatus: input.newStatus || run.status,
      actor: EVALUATION_STUDIO_ACTOR,
      timestamp,
      note: clean(input.note || input.reason || input.quarantineReason).slice(0, 1000),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    }
  ].slice(-200);
}

function quarantineEvaluationRun(studio = {}, runId, input = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const id = clean(runId || input.runId || input.id);
  const current = normalized.evaluationRuns.find((run) => run.id === id);
  if (!current) {
    const error = new Error("Evaluation run not found.");
    error.statusCode = 404;
    throw error;
  }
  if (current.status === "completed") {
    const error = new Error("Completed Evaluation Studio runs cannot be quarantined.");
    error.statusCode = 400;
    throw error;
  }
  const timestamp = input.now || nowIso();
  const reason = clean(input.reason || input.quarantineReason || input.note || "Manager quarantined this run for review.").slice(0, 1000);
  const quarantined = normalizeEvaluationRun({
    ...current,
    status: "quarantined",
    quarantineReason: reason,
    quarantinedAt: timestamp,
    quarantinedBy: EVALUATION_STUDIO_ACTOR,
    updatedAt: timestamp,
    runHistory: appendEvaluationRunEvent(current, "quarantine", {
      ...input,
      now: timestamp,
      newStatus: "quarantined",
      note: reason
    })
  });
  return {
    studio: {
      ...normalized,
      evaluationRuns: normalized.evaluationRuns.map((run) => run.id === id ? quarantined : run)
    },
    run: quarantined
  };
}

function resumeEvaluationRun(studio = {}, runId, input = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const id = clean(runId || input.runId || input.id);
  const current = normalized.evaluationRuns.find((run) => run.id === id);
  if (!current) {
    const error = new Error("Evaluation run not found.");
    error.statusCode = 404;
    throw error;
  }
  if (current.status === "completed") {
    const error = new Error("Completed Evaluation Studio runs do not need resume.");
    error.statusCode = 400;
    throw error;
  }
  const timestamp = input.now || nowIso();
  const note = clean(input.reason || input.note || "Manager resumed this run.").slice(0, 1000);
  const resumed = normalizeEvaluationRun({
    ...current,
    status: "queued",
    quarantineReason: "",
    resumedAt: timestamp,
    resumedBy: EVALUATION_STUDIO_ACTOR,
    resumeCount: Number(current.resumeCount || 0) + 1,
    updatedAt: timestamp,
    runHistory: appendEvaluationRunEvent(current, "resume", {
      ...input,
      now: timestamp,
      newStatus: "queued",
      note
    })
  });
  return {
    studio: {
      ...normalized,
      evaluationRuns: normalized.evaluationRuns.map((run) => run.id === id ? resumed : run)
    },
    run: resumed
  };
}

function resultSiblingKey(result) {
  return [
    result.importId,
    result.callId,
    result.runId,
    result.templateId
  ].join("::");
}

function upsertEvaluationResult(studio = {}, input = {}) {
  const normalized = normalizeEvaluationStudio(studio);
  const runId = clean(input.runId || input.evaluationRunId || input.evaluation_run_id || input.result?.run_id);
  const run = runId ? normalized.evaluationRuns.find((item) => item.id === runId) : null;
  const templateId = clean(input.templateId || input.evaluationTemplateId || input.result?.template_id || run?.templateId);
  const template = templateId
    ? normalized.evaluationTemplates.find((item) => item.id === templateId) || run?.templateSnapshot || null
    : run?.templateSnapshot || null;
  const result = normalizeEvaluationResult(input, {
    run,
    template,
    importId: input.importId || run?.importId
  });
  const key = resultSiblingKey(result);
  const existing = normalized.evaluationResults.find((item) => item.id === result.id);
  const siblingVersions = normalized.evaluationResults
    .filter((item) => item.id !== result.id && resultSiblingKey(item) === key)
    .map((item) => Number(item.resultVersion || 1));
  const savedResult = {
    ...result,
    resultVersion: existing ? existing.resultVersion : Math.max(0, ...siblingVersions) + 1,
    isLatest: true,
    createdAt: existing?.createdAt || result.createdAt,
    updatedAt: nowIso(),
    createdBy: existing?.createdBy || EVALUATION_STUDIO_ACTOR,
    updatedBy: EVALUATION_STUDIO_ACTOR
  };
  let results = [
    savedResult,
    ...normalized.evaluationResults
      .filter((item) => item.id !== savedResult.id)
      .map((item) => resultSiblingKey(item) === key ? { ...item, isLatest: false } : item)
  ].slice(0, 50000);
  let runs = normalized.evaluationRuns;
  if (savedResult.runId) {
    const latestRunResults = results.filter((item) => item.runId === savedResult.runId && item.isLatest !== false);
    runs = normalized.evaluationRuns.map((runItem) => {
      if (runItem.id !== savedResult.runId) return runItem;
      const completedCallCount = latestRunResults.filter((item) => item.status !== "failed").length;
      const failedCallCount = latestRunResults.filter((item) => item.status === "failed").length;
      const inspected = completedCallCount + failedCallCount;
      const planned = Number(runItem.plannedCallCount || 0);
      let status = runItem.status;
      let completedAt = runItem.completedAt;
      if (planned && inspected >= planned) {
        status = failedCallCount && completedCallCount ? "partially_completed" : failedCallCount ? "failed" : "completed";
        completedAt = completedAt || nowIso();
      } else if (inspected > 0 && ["draft", "queued"].includes(status)) {
        status = "running";
      }
      return normalizeEvaluationRun({
        ...runItem,
        status,
        completedAt,
        completedCallCount,
        failedCallCount,
        updatedAt: nowIso()
      });
    });
  }
  return {
    studio: {
      ...normalized,
      evaluationRuns: runs,
      evaluationResults: results
    },
    result: savedResult
  };
}

function buildEvaluationStudioInput(call = {}, template = {}, knowledgebaseEntries = [], options = {}) {
  if (!call.callId && !call.call_id) throw new Error("call is required");
  const callId = call.callId || call.call_id;
  const stableIds = Array.isArray(call.stableIds) ? call.stableIds : [];
  const rawContext = {
    AllocatedLeadID: call.rawFields?.AllocatedLeadID || stableIds.find((item) => item.field === "AllocatedLeadID")?.value || "",
    CustomerImportSource: call.customerImportSource || call.source || "",
    CustomerCreatedBy: call.customerCreatedBy || "",
    CustomerCreatedByType: call.customerCreatedByType || "",
    RecordAge: call.daysSinceRecord ?? null
  };
  return {
    schema_version: "sales_dashboard_evaluation_studio_task.v1",
    source: {
      system: "Sales Dashboard",
      import_id: options.importId || null,
      call_id: callId,
      salesperson: call.salesperson || "",
      call_date: call.date || call.callDate || "",
      call_time: call.time || call.callTime || "",
      source_call_time_basis: "Source call time (AEST)"
    },
    evaluation_template: {
      id: template.id,
      name: template.name,
      evaluation_goal: template.evaluationGoal,
      version: template.version,
      prompt_hash: template.promptHash,
      instructions: template.instructions,
      output_schema: template.outputSchema || DEFAULT_OUTPUT_SCHEMA
    },
    knowledgebase: (knowledgebaseEntries || []).filter((entry) => entry?.isActive !== false).map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      tags: entry.tags || [],
      version: entry.version || 1,
      content: entry.content || ""
    })).slice(0, 20),
    deterministic_baseline: {
      contact_classification: call.contactClassification || "",
      local_outcome: call.localOutcome || "",
      follow_up_status: call.followUpStatus || "",
      follow_up_channel: call.followUpChannel || "",
      transcript_quality: call.transcriptQuality || "",
      confidence_band: call.confidenceBand || "",
      evidence: call.evidence || []
    },
    call_csv_context: rawContext,
    transcript: call.transcript || "",
    guardrails: defaultEvaluationGuardrails()
  };
}

module.exports = {
  EVALUATION_GOALS,
  EVALUATION_RESULT_STATUSES,
  EVALUATION_RUN_STATUSES,
  EVALUATION_RUN_TYPES,
  EVALUATION_STUDIO_ACTOR,
  EVALUATION_STUDIO_SCHEMA_VERSION,
  KNOWLEDGEBASE_CATEGORIES,
  archiveEvaluationTemplate,
  archiveKnowledgebaseEntry,
  buildEvaluationStudioInput,
  buildEvaluationStudioReportRollups,
  buildManagerReviewPrefillCorrections,
  createDefaultEvaluationStudio,
  createEvaluationRun,
  defaultEvaluationGuardrails,
  evaluationStudioSummary,
  listEvaluationTemplates,
  listEvaluationResults,
  listKnowledgebaseEntries,
  managerReviewReasonForEvaluationResult,
  managerReviewScopeForEvaluationGoal,
  normalizeEvaluationResult,
  normalizeEvaluationStudio,
  normalizeEvaluationRun,
  normalizeEvaluationTemplate,
  normalizeKnowledgebaseEntry,
  quarantineEvaluationRun,
  resumeEvaluationRun,
  updateEvaluationRun,
  upsertEvaluationResult,
  upsertEvaluationTemplate,
  upsertKnowledgebaseEntry
};
