"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REGISTER_PATTERN = /^LOCAL_MODEL_CAPABILITY_REGISTER_(\d{4}-\d{2}-\d{2})\.json$/;
const PROMOTED_STATUS = "promoted";
const OPERATIONAL_USE = "operational_decision";
const SUBMISSION_USE = "model_submission";

const GOAL_CAPABILITY_IDS = Object.freeze({
  call_intelligence_foundation: "call_intelligence_foundation_complete",
  offer_acceptance_classification: "offer_acceptance_v3",
  callback_opportunity: "callback_v3_state",
  objection_handling: "objection_handling_v2",
  procedure_adherence: "procedure_adherence_v2",
  lead_record_disposition_evidence_audit: "lead_record_v4",
  spiel_quality: "spiel_quality_v3"
});

const CAPABILITY_DISPLAY_DETAILS = Object.freeze({
  call_intelligence_foundation_complete: {
    scope: "Complete Foundation call-state decision and its automatic specialist-routing product.",
    exclusions: ["No routing, opportunity, efficiency, contact, authority, coaching, or operational decision."],
    nextAction: "Keep retired. A materially different candidate needs a new frozen program."
  },
  legacy_transcript_evaluation_unrouted: {
    scope: "Former generic call-page transcript-evaluation request.",
    exclusions: ["No current task binding, frozen contract, model submission, or operational result."],
    nextAction: "Keep the route retired unless a new exact capability is independently promoted.",
    provenance: { modelKey: "not_executed", providerModel: "no valid project route", modelDigest: "not_recorded", runtime: "not_executed" }
  },
  execution_and_json_schema: {
    scope: "Local transport completion and structured JSON/schema conformance only.",
    exclusions: ["No semantic meaning, evidence relevance, decision accuracy, or business authority."],
    nextAction: "Use only as infrastructure evidence; never promote a semantic decision from this result."
  },
  foundation_offer_presented: {
    scope: "Whether the transcript contains an offer-presentation event in the audited Foundation contract.",
    exclusions: ["No offer acceptance, commitment, price accuracy, sale, or opportunity decision."],
    nextAction: "Research only; require a new frozen exact-use gate before any consumption."
  },
  foundation_price_presented: {
    scope: "Whether a price-presentation event appears in the audited Foundation contract.",
    exclusions: ["No price correctness, customer acceptance, payment, sale, or revenue decision."],
    nextAction: "Research only; require a new frozen exact-use gate before any consumption."
  },
  foundation_decision_maker_status: {
    scope: "Customer decision-maker or authority status within the Foundation evaluator.",
    exclusions: ["No routing, qualification, contact-removal, or salesperson-performance use."],
    nextAction: "Failed. Reopen only with a materially different candidate and unseen evidence."
  },
  foundation_objection_present: {
    scope: "Presence of a customer objection within the Foundation evaluator.",
    exclusions: ["No objection-handling quality, coaching, compliance, or routing use."],
    nextAction: "Failed. Reopen only with a materially different candidate and unseen evidence."
  },
  foundation_efficiency_status: {
    scope: "Foundation progression/efficiency status for the call.",
    exclusions: ["No ranking, performance management, coaching, or productivity denominator."],
    nextAction: "Failed. Keep all operational efficiency fields unknown."
  },
  offer_acceptance_v3: {
    scope: "Final offer-acceptance state, including conditions and controlling chronology.",
    exclusions: ["No accepted-offer queue, CRM action, sale, payment, fulfilment, or revenue claim."],
    nextAction: "Failed. A materially different candidate must pass a new frozen gate."
  },
  callback_v3_state: {
    scope: "Callback/follow-up state, channel, and timing from transcript chronology.",
    exclusions: ["No callback queue, due date, completion, causation, or scheduling decision."],
    nextAction: "Failed. Use deterministic later-record facts only."
  },
  objection_handling_v2: {
    scope: "Quality and outcome of seller objection handling.",
    exclusions: ["No coaching, ranking, compliance, discipline, or call-quality score."],
    nextAction: "Failed. Leave this judgment to explicit benchmark research or manager review."
  },
  procedure_adherence_v2: {
    scope: "Seller adherence to the audited sales procedure.",
    exclusions: ["No coaching, ranking, compliance, discipline, or procedure score."],
    nextAction: "Failed. Leave operational procedure status unknown."
  },
  lead_record_v4: {
    scope: "Transcript evidence about lead-record invalidity, unusability, and alleged record defects.",
    exclusions: ["No lead removal, suppression, correction, refund, CRM mutation, or accusation decision."],
    nextAction: "Restricted and unpromoted. Use literal evidence or an explicit manager overlay only."
  },
  spiel_quality_v3: {
    scope: "Composite Call Handling and Spiel bands after purpose/scope/chronology judgment.",
    exclusions: ["No quality band, coaching, ranking, compliance, discipline, or operational score."],
    nextAction: "Failed family. Do not retry or decompose Qwen Spiel."
  },
  spiel_fact_extraction_v4: {
    scope: "Multi-fact Spiel chronology and evidence extraction under the v4 contract.",
    exclusions: ["No Gate B, purpose, scope, safeguard, band, or operational fact consumption."],
    nextAction: "Retired. Do not repair with another Qwen prompt."
  },
  spiel_v5_third_party_authority: {
    scope: "Atomic fact: whether a third party controls the relevant authority decision.",
    exclusions: ["No purpose, scope, Spiel band, handling band, or downstream deterministic score."],
    nextAction: "Failed atomic gate. Same-model rescue is prohibited."
  },
  spiel_v5_wrong_contact: {
    scope: "Atomic fact: whether the call establishes a wrong-contact state.",
    exclusions: ["No lead action, purpose, scope, Spiel band, handling band, or downstream score."],
    nextAction: "Failed atomic gate. Same-model rescue is prohibited."
  },
  spiel_v5_business_permanently_closed: {
    scope: "Atomic fact: whether the business is permanently closed.",
    exclusions: ["No lead removal, purpose, scope, Spiel band, handling band, or downstream score."],
    nextAction: "Failed atomic gate. Same-model rescue is prohibited."
  },
  spiel_v6_candidate_span_nomination: {
    scope: "Unexecuted candidate-span nomination design for a further Spiel decomposition.",
    exclusions: ["No label freeze, inference, test batch, span use, or quality decision."],
    nextAction: "Stopped untested. Do not execute under the current Qwen family."
  },
  legacy_transcript_intelligence_and_numeric_quality: {
    scope: "Legacy transcript-intelligence summary and uncalibrated numeric quality score.",
    exclusions: ["No active call intelligence, numeric quality, ranking, coaching, or operational decision."],
    nextAction: "Keep retired or replace only through a new independently governed capability.",
    provenance: { modelKey: "mixed_historical_legacy_routes", providerModel: "Qwen 8B, GPT-OSS 20B, and the later Qwen route", modelDigest: "not_consistently_recorded", runtime: "historical local execution" }
  }
});

let pinnedDefaultRegisterPath = "";
let cachedFileRegister = null;

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalHash(value) {
  return hash(JSON.stringify(canonicalValue(value)));
}

function latestRegisterPath(options = {}) {
  if (options.registerPath) return path.resolve(options.registerPath);
  if (pinnedDefaultRegisterPath) return pinnedDefaultRegisterPath;
  const runtimePath = path.resolve(__dirname, "..", "runtime");
  const candidates = fs.readdirSync(runtimePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && REGISTER_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!candidates.length) throw new Error("No local-model capability register is available.");
  pinnedDefaultRegisterPath = path.join(runtimePath, candidates[0]);
  return pinnedDefaultRegisterPath;
}

function validateRegister(register = {}) {
  if (register.schema_version !== "sales_dashboard_local_model_capability_register.v1") {
    throw new Error("The local-model capability register schema is missing or unsupported.");
  }
  if (!Array.isArray(register.capabilities)) {
    throw new Error("The local-model capability register has no capabilities array.");
  }
  const ids = new Set();
  register.capabilities.forEach((capability) => {
    const id = clean(capability?.id);
    if (!id || ids.has(id)) throw new Error("Every local-model capability must have a unique non-empty ID.");
    ids.add(id);
    if (!clean(capability.status)) throw new Error(`Capability ${id} has no status.`);
    if (capability.status === PROMOTED_STATUS && !completePromotionContract(capability)) {
      throw new Error(`Promoted capability ${id} has an incomplete or internally inconsistent promotion contract.`);
    }
  });
  return register;
}

function loadLocalModelCapabilityRegister(options = {}) {
  if (options.register && typeof options.register === "object") {
    const register = validateRegister(structuredClone(options.register));
    return { register, registerPath: "in_memory_test_register", registerHash: hash(JSON.stringify(register)) };
  }
  const registerPath = latestRegisterPath(options);
  const stat = fs.statSync(registerPath);
  const cacheKey = `${registerPath}:${stat.size}:${stat.mtimeMs}`;
  if (cachedFileRegister?.cacheKey === cacheKey) return cachedFileRegister.loaded;
  const raw = fs.readFileSync(registerPath, "utf8");
  const loaded = {
    register: validateRegister(JSON.parse(raw)),
    registerPath,
    registerHash: hash(raw)
  };
  cachedFileRegister = { cacheKey, loaded };
  return loaded;
}

function capabilityIdFromContext(context = {}) {
  const explicit = clean(context.capabilityId || context.capability_id);
  if (explicit) return explicit;
  const metadata = context.metadata && typeof context.metadata === "object" ? context.metadata : {};
  const input = context.input && typeof context.input === "object" ? context.input : {};
  const sourceType = clean(metadata.source_type || metadata.sourceType).toLowerCase();
  if (sourceType.includes("spiel_quality_v6")) return "spiel_v6_candidate_span_nomination";
  if (sourceType.includes("spiel_quality_v5")) {
    const lane = clean(metadata.fact_lane || input.fact_lane || input.factLane);
    return lane ? `spiel_v5_${lane}` : "spiel_quality_v5_unknown_lane";
  }
  if (sourceType.includes("spiel_quality_v4")) return "spiel_fact_extraction_v4";

  const taskType = clean(context.taskType || context.task_type).toLowerCase();
  if (taskType === "sales_transcript_intelligence_extraction") return "legacy_transcript_intelligence_and_numeric_quality";
  if (taskType === "sales_transcript_evaluation") return "legacy_transcript_evaluation_unrouted";
  if (taskType && taskType !== "sales_dashboard_evaluation_studio") return `unknown_task:${taskType}`;

  const goal = clean(
    context.evaluationGoal
      || context.evaluation_goal
      || metadata.evaluation_goal
      || metadata.evaluationGoal
      || input.evaluation_goal
      || input.evaluationGoal
  );
  return GOAL_CAPABILITY_IDS[goal] || (goal ? `unknown_goal:${goal}` : "unknown_evaluation_capability");
}

function completePromotionContract(capability = {}) {
  const contract = capability.promotion_contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return false;
  const required = [
    "task_type",
    "evaluation_goal",
    "model_key",
    "provider_model",
    "model_digest",
    "prompt_hash",
    "schema_version",
    "schema_hash",
    "inference_settings_hash",
    "execution_contract_revision",
    "validation_manifest_hash",
    "promotion_audit_hash",
    "evidence_contract_version"
  ];
  const settings = contract.inference_settings;
  const settingsComplete = settings && typeof settings === "object" && !Array.isArray(settings)
    && typeof settings.think === "boolean"
    && Number.isFinite(Number(settings.temperature))
    && Number.isInteger(Number(settings.maximum_completion_tokens))
    && Number(settings.maximum_completion_tokens) > 0
    && Number.isInteger(Number(settings.num_ctx))
    && Number(settings.num_ctx) > 0
    && Number.isInteger(Number(settings.seed))
    && Number.isFinite(Number(settings.top_p));
  const population = contract.supported_population;
  const populationComplete = population && typeof population === "object" && !Array.isArray(population)
    && clean(population.population_id)
    && clean(population.definition_hash);
  const evidence = contract.minimum_evidence;
  const evidenceComplete = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    && Number.isInteger(Number(evidence.exact_quote_count))
    && Number(evidence.exact_quote_count) >= 1;
  return required.every((field) => clean(contract[field]))
    && settingsComplete
    && canonicalHash(settings) === clean(contract.inference_settings_hash)
    && populationComplete
    && evidenceComplete
    && contract.execution_layer_enforces_inference_settings === true
    && Array.isArray(contract.permitted_uses)
    && contract.permitted_uses.length > 0;
}

function exactContractMatch(capability, context, use, loaded) {
  const contract = capability.promotion_contract;
  if (!completePromotionContract(capability)) return { matched: false, reason: "promotion_contract_incomplete" };
  if (!contract.permitted_uses.includes(use)) return { matched: false, reason: `use_not_promoted:${use}` };
  const metadata = context.metadata && typeof context.metadata === "object" ? context.metadata : {};
  const audit = context.evaluationAudit && typeof context.evaluationAudit === "object" ? context.evaluationAudit : {};
  const actual = {
    task_type: clean(context.taskType || context.task_type || metadata.task_type),
    evaluation_goal: clean(context.evaluationGoal || context.evaluation_goal || metadata.evaluation_goal),
    model_key: clean(context.modelKey || context.model_key || context.model || audit.model),
    provider_model: clean(context.providerModel || context.provider_model || metadata.provider_model || audit.providerModel),
    model_digest: clean(context.modelDigest || context.model_digest || metadata.model_digest || audit.modelDigest),
    prompt_hash: clean(context.promptHash || context.prompt_hash || metadata.prompt_hash || audit.promptHash),
    schema_version: clean(context.schemaVersion || context.schema_version || metadata.schema_version || audit.schemaVersion),
    schema_hash: clean(context.schemaHash || context.schema_hash || metadata.schema_hash || audit.schemaHash),
    inference_settings_hash: clean(context.inferenceSettingsHash || context.inference_settings_hash || metadata.inference_settings_hash || audit.inferenceSettingsHash),
    execution_contract_revision: clean(context.executionContractRevision || context.execution_contract_revision || metadata.execution_contract_revision || audit.executionContractRevision)
  };
  for (const [field, expected] of Object.entries(contract)) {
    if (!(field in actual)) continue;
    if (clean(expected) !== actual[field]) return { matched: false, reason: `provenance_mismatch:${field}` };
  }
  const actualSettings = context.inferenceSettings || context.inference_settings || metadata.inference_settings || audit.inferenceSettings;
  if (!actualSettings || canonicalHash(actualSettings) !== contract.inference_settings_hash) {
    return { matched: false, reason: "provenance_mismatch:inference_settings" };
  }
  const populationId = clean(context.populationId || context.population_id || metadata.population_id || audit.populationId);
  const populationDefinitionHash = clean(context.populationDefinitionHash || context.population_definition_hash || metadata.population_definition_hash || audit.populationDefinitionHash);
  if (populationId !== clean(contract.supported_population.population_id)) {
    return { matched: false, reason: "population_mismatch:population_id" };
  }
  if (populationDefinitionHash !== clean(contract.supported_population.definition_hash)) {
    return { matched: false, reason: "population_mismatch:definition_hash" };
  }
  const contractHash = canonicalHash(contract);
  if (use === OPERATIONAL_USE) {
    const provenanceAuthority = clean(context.provenanceAuthority || context.provenance_authority || audit.provenanceAuthority);
    if (provenanceAuthority !== "execution_layer_verified") {
      return { matched: false, reason: "provenance_not_execution_layer_verified" };
    }
    const resultRegisterHash = clean(context.capabilityRegisterHash || context.capability_register_hash || audit.capabilityRegisterHash);
    if (!resultRegisterHash || resultRegisterHash !== loaded.registerHash) {
      return { matched: false, reason: "provenance_mismatch:capability_register_hash" };
    }
    const resultContractHash = clean(context.promotionContractHash || context.promotion_contract_hash || audit.promotionContractHash);
    if (resultContractHash !== contractHash) {
      return { matched: false, reason: "provenance_mismatch:promotion_contract_hash" };
    }
    const evidenceValidationStatus = clean(context.evidenceValidationStatus || context.evidence_validation_status || audit.evidenceValidationStatus);
    if (evidenceValidationStatus !== "passed") {
      return { matched: false, reason: "minimum_evidence_not_validated" };
    }
    const exactQuoteCount = Number(context.exactQuoteCount ?? context.exact_quote_count ?? audit.exactQuoteCount ?? 0);
    if (!Number.isInteger(exactQuoteCount) || exactQuoteCount < Number(contract.minimum_evidence.exact_quote_count)) {
      return { matched: false, reason: "minimum_evidence_not_met" };
    }
    if (!clean(context.transcriptHash || context.transcript_hash || audit.transcriptHash)) {
      return { matched: false, reason: "transcript_hash_missing" };
    }
  }
  return { matched: true, reason: "exact_promoted_contract", contractHash };
}

function localModelCapabilityDecision(context = {}, options = {}) {
  let loaded;
  try {
    loaded = loadLocalModelCapabilityRegister(options);
  } catch (error) {
    return {
      capabilityId: capabilityIdFromContext(context),
      capabilityStatus: "register_unavailable",
      permitted: false,
      use: clean(context.use) || OPERATIONAL_USE,
      reason: `register_unavailable:${error.message}`,
      registerPath: "",
      registerHash: ""
    };
  }
  const capabilityId = capabilityIdFromContext(context);
  const capability = loaded.register.capabilities.find((entry) => entry.id === capabilityId) || null;
  const use = clean(context.use) || OPERATIONAL_USE;
  if (!capability) {
    return {
      capabilityId,
      capabilityStatus: "unknown",
      permitted: false,
      use,
      reason: "capability_not_registered",
      registerPath: loaded.registerPath,
      registerHash: loaded.registerHash
    };
  }
  if (capability.status !== PROMOTED_STATUS) {
    return {
      capabilityId,
      capabilityStatus: capability.status,
      permitted: false,
      use,
      reason: `capability_not_promoted:${capability.status}`,
      registerPath: loaded.registerPath,
      registerHash: loaded.registerHash
    };
  }
  const matchContext = use === SUBMISSION_USE ? {
    ...context,
    model: capability.promotion_contract?.model_key,
    providerModel: capability.promotion_contract?.provider_model,
    modelDigest: capability.promotion_contract?.model_digest,
    inferenceSettingsHash: capability.promotion_contract?.inference_settings_hash,
    inferenceSettings: capability.promotion_contract?.inference_settings,
    executionContractRevision: capability.promotion_contract?.execution_contract_revision
  } : context;
  const match = exactContractMatch(capability, matchContext, use, loaded);
  return {
    capabilityId,
    capabilityStatus: capability.status,
    permitted: match.matched,
    use,
    reason: match.reason,
    registerPath: loaded.registerPath,
    registerHash: loaded.registerHash,
    promotionContract: capability.promotion_contract,
    promotionContractHash: match.contractHash || canonicalHash(capability.promotion_contract)
  };
}

function capabilityError(decision) {
  const error = new Error(`Local-model capability ${decision.capabilityId} is quarantined: ${decision.reason}.`);
  error.code = "LOCAL_MODEL_CAPABILITY_QUARANTINED";
  error.status = 423;
  error.statusCode = 423;
  error.payload = { capability: decision };
  return error;
}

function assertLocalModelSubmissionAllowed(context = {}, options = {}) {
  const decision = localModelCapabilityDecision({ ...context, use: SUBMISSION_USE }, options);
  if (!decision.permitted) throw capabilityError(decision);
  return decision;
}

function evaluationResultCapability(result = {}, options = {}) {
  const decision = localModelCapabilityDecision({
    use: OPERATIONAL_USE,
    capabilityId: result.evaluationAudit?.capabilityId,
    evaluationGoal: result.evaluationGoal,
    taskType: result.taskType || result.evaluationAudit?.taskType || "sales_dashboard_evaluation_studio",
    model: result.evaluationAudit?.model,
    providerModel: result.evaluationAudit?.providerModel,
    modelDigest: result.evaluationAudit?.modelDigest,
    promptHash: result.promptHash || result.evaluationAudit?.promptHash,
    schemaVersion: result.evaluationAudit?.schemaVersion,
    schemaHash: result.evaluationAudit?.schemaHash,
    inferenceSettingsHash: result.evaluationAudit?.inferenceSettingsHash,
    inferenceSettings: result.evaluationAudit?.inferenceSettings,
    executionContractRevision: result.evaluationAudit?.executionContractRevision,
    populationId: result.evaluationAudit?.populationId,
    populationDefinitionHash: result.evaluationAudit?.populationDefinitionHash,
    capabilityRegisterHash: result.evaluationAudit?.capabilityRegisterHash,
    promotionContractHash: result.evaluationAudit?.promotionContractHash,
    provenanceAuthority: result.evaluationAudit?.provenanceAuthority,
    evidenceValidationStatus: result.evaluationAudit?.evidenceValidationStatus,
    exactQuoteCount: result.evaluationAudit?.exactQuoteCount,
    transcriptHash: result.evaluationAudit?.transcriptHash,
    evaluationAudit: result.evaluationAudit
  }, options);
  return {
    ...decision,
    displayState: decision.permitted ? "promoted" : "research_only",
    authorityLabel: decision.permitted ? "Promoted capability" : "Unpromoted research — not operational",
    operationallyPermitted: decision.permitted
  };
}

function isOperationalEvaluationResult(result = {}, options = {}) {
  return evaluationResultCapability(result, options).operationallyPermitted === true;
}

function localModelCapabilitySummary(options = {}) {
  let loaded;
  try {
    loaded = loadLocalModelCapabilityRegister(options);
  } catch (error) {
    return {
      schemaVersion: "sales_dashboard_local_model_capability_summary.v1",
      programStatus: "register_unavailable",
      registerPath: "",
      registerHash: "",
      capabilityCount: 0,
      statuses: {},
      promotedCapabilityIds: [],
      liveSubmissionPermitted: false,
      operationalConsumptionPermitted: false,
      error: error.message
    };
  }
  const statuses = {};
  loaded.register.capabilities.forEach((capability) => {
    statuses[capability.status] = (statuses[capability.status] || 0) + 1;
  });
  const promoted = loaded.register.capabilities.filter((capability) => capability.status === PROMOTED_STATUS && completePromotionContract(capability));
  return {
    schemaVersion: "sales_dashboard_local_model_capability_summary.v1",
    programStatus: loaded.register.program_status || "unknown",
    registerPath: loaded.registerPath,
    registerHash: loaded.registerHash,
    capabilityCount: loaded.register.capabilities.length,
    statuses,
    promotedCapabilityIds: promoted.map((capability) => capability.id),
    liveSubmissionPermitted: promoted.some((capability) => capability.promotion_contract.permitted_uses.includes(SUBMISSION_USE)),
    operationalConsumptionPermitted: promoted.some((capability) => capability.promotion_contract.permitted_uses.includes(OPERATIONAL_USE))
  };
}

function localModelCapabilityCatalog(options = {}) {
  let loaded;
  try {
    loaded = loadLocalModelCapabilityRegister(options);
  } catch (error) {
    return {
      schemaVersion: "sales_dashboard_local_model_capability_catalog.v1",
      available: false,
      authority: "none",
      error: error.message,
      capabilities: []
    };
  }
  const register = loaded.register;
  return {
    schemaVersion: "sales_dashboard_local_model_capability_catalog.v1",
    available: true,
    authority: "none",
    registerPath: loaded.registerPath,
    registerHash: loaded.registerHash,
    createdAt: register.created_at || "",
    programStatus: register.program_status || "unknown",
    model: register.model || null,
    allowedUses: register.allowed_uses || [],
    prohibitedUses: register.prohibited_uses || [],
    controllingEvidence: register.controlling_evidence || [],
    capabilities: register.capabilities.map((capability) => {
      const detail = CAPABILITY_DISPLAY_DETAILS[capability.id] || {
        scope: "No exact operational scope was frozen for this historical capability.",
        exclusions: ["All operational use is excluded until an exact capability passes an independent gate."],
        nextAction: "Define a new exact scope and frozen unseen test before any future research."
      };
      const numericEvidence = Object.fromEntries(Object.entries(capability).filter(([, value]) => typeof value === "number"));
      const recordedEvidence = capability.evidence || (Object.keys(numericEvidence).length ? numericEvidence : null);
      const status = clean(capability.status);
      const failureReason = capability.reason || (
        status === PROMOTED_STATUS
          ? "Passed the exact frozen promotion contract."
          : /technical/.test(status)
            ? "Only transport/schema behavior was verified; semantic relevance and decision accuracy were not promoted."
            : /restricted/.test(status)
              ? `Recorded subfield evidence (${recordedEvidence ? JSON.stringify(recordedEvidence) : "no standalone score"}) did not establish the complete exact product use or receive promotion approval.`
              : /failed/.test(status)
                ? `Frozen semantic evidence (${recordedEvidence ? JSON.stringify(recordedEvidence) : "see controlling audit"}) failed the tested capability; valid structure did not rescue the decision.`
                : `The recorded status is ${status}; no exact operational promotion exists.`
      );
      const provenance = detail.provenance || {
        modelKey: register.model?.model_key || "not_recorded",
        providerModel: register.model?.provider_model || "not_recorded",
        modelDigest: register.model?.local_digest || "not_recorded",
        runtime: register.model?.runtime || "not_recorded"
      };
      return {
        id: capability.id,
        scope: detail.scope,
        status: capability.status,
        authority: capability.status === PROMOTED_STATUS && completePromotionContract(capability) ? "exact_promoted_contract" : "none",
        provenance: {
          ...provenance,
          registerHash: loaded.registerHash
        },
        exclusions: detail.exclusions,
        evidence: recordedEvidence,
        controllingEvidence: register.controlling_evidence || [],
        failureReason,
        permittedNextAction: detail.nextAction
      };
    })
  };
}

module.exports = {
  GOAL_CAPABILITY_IDS,
  OPERATIONAL_USE,
  PROMOTED_STATUS,
  SUBMISSION_USE,
  assertLocalModelSubmissionAllowed,
  canonicalHash,
  capabilityIdFromContext,
  evaluationResultCapability,
  isOperationalEvaluationResult,
  loadLocalModelCapabilityRegister,
  localModelCapabilityCatalog,
  localModelCapabilityDecision,
  localModelCapabilitySummary
};
