"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OPERATIONAL_USE,
  SUBMISSION_USE,
  canonicalHash,
  evaluationResultCapability,
  isOperationalEvaluationResult,
  loadLocalModelCapabilityRegister,
  localModelCapabilityCatalog,
  localModelCapabilityDecision,
  localModelCapabilitySummary
} = require("../src/localModelCapability");

function promotedFixture() {
  const inferenceSettings = {
    think: false,
    temperature: 0,
    maximum_completion_tokens: 768,
    num_ctx: 8192,
    seed: 19,
    top_p: 1
  };
  const contract = {
    task_type: "sales_dashboard_evaluation_studio",
    evaluation_goal: "callback_opportunity",
    model_key: "qwen3_30b_callback_frozen",
    provider_model: "qwen3:30b-a3b",
    model_digest: "sha256:model-digest",
    prompt_hash: "sha256:prompt",
    schema_version: "callback_opportunity.v2",
    schema_hash: "sha256:schema",
    inference_settings_hash: canonicalHash(inferenceSettings),
    inference_settings: inferenceSettings,
    execution_layer_enforces_inference_settings: true,
    execution_contract_revision: "ael-contract.v2",
    validation_manifest_hash: "sha256:manifest",
    promotion_audit_hash: "sha256:audit",
    evidence_contract_version: "exact_quote.v1",
    minimum_evidence: { exact_quote_count: 1 },
    supported_population: {
      population_id: "callback_live_human_v1",
      definition_hash: "sha256:population"
    },
    permitted_uses: [SUBMISSION_USE, OPERATIONAL_USE]
  };
  const register = {
    schema_version: "sales_dashboard_local_model_capability_register.v1",
    program_status: "test_only",
    capabilities: [{
      id: "callback_v3_state",
      status: "promoted",
      promotion_contract: contract
    }]
  };
  return { contract, register };
}

function exactOperationalResult(register, contract) {
  const loaded = loadLocalModelCapabilityRegister({ register });
  return {
    evaluationGoal: "callback_opportunity",
    taskType: contract.task_type,
    promptHash: contract.prompt_hash,
    evaluationAudit: {
      capabilityId: "callback_v3_state",
      taskType: contract.task_type,
      model: contract.model_key,
      providerModel: contract.provider_model,
      modelDigest: contract.model_digest,
      promptHash: contract.prompt_hash,
      schemaVersion: contract.schema_version,
      schemaHash: contract.schema_hash,
      inferenceSettingsHash: contract.inference_settings_hash,
      inferenceSettings: contract.inference_settings,
      executionContractRevision: contract.execution_contract_revision,
      populationId: contract.supported_population.population_id,
      populationDefinitionHash: contract.supported_population.definition_hash,
      capabilityRegisterHash: loaded.registerHash,
      promotionContractHash: canonicalHash(contract),
      provenanceAuthority: "execution_layer_verified",
      evidenceValidationStatus: "passed",
      exactQuoteCount: 1,
      transcriptHash: "sha256:transcript"
    }
  };
}

test("the live capability register promotes no local-model evaluator", () => {
  const summary = localModelCapabilitySummary();
  assert.equal(summary.liveSubmissionPermitted, false);
  assert.equal(summary.operationalConsumptionPermitted, false);
  assert.deepEqual(summary.promotedCapabilityIds, []);
  assert.equal(summary.capabilityCount > 0, true);
});

test("the Studio capability catalog exposes scope, provenance, exclusions, evidence, and next action for every capability", () => {
  const catalog = localModelCapabilityCatalog();
  assert.equal(catalog.available, true);
  assert.equal(catalog.capabilities.length, 20);
  assert.equal(catalog.capabilities.every((capability) => capability.scope && capability.status && capability.authority === "none"), true);
  assert.equal(catalog.capabilities.every((capability) => capability.provenance.modelDigest && capability.exclusions.length && capability.failureReason && capability.permittedNextAction), true);
  assert.equal(catalog.capabilities.some((capability) => capability.id === "execution_and_json_schema" && capability.scope.includes("transport")), true);
});

test("unknown and missing registers fail closed", () => {
  const missing = localModelCapabilityDecision({
    taskType: "sales_dashboard_evaluation_studio",
    evaluationGoal: "callback_opportunity"
  }, { registerPath: "Z:\\definitely-missing\\capabilities.json" });
  assert.equal(missing.permitted, false);
  assert.equal(missing.capabilityStatus, "register_unavailable");

  const { register } = promotedFixture();
  const unknown = localModelCapabilityDecision({ capabilityId: "not_registered" }, { register });
  assert.equal(unknown.permitted, false);
  assert.equal(unknown.reason, "capability_not_registered");
});

test("submission requires the exact promoted prompt, schema, population, and use", () => {
  const { register, contract } = promotedFixture();
  const exact = {
    use: SUBMISSION_USE,
    taskType: contract.task_type,
    evaluationGoal: contract.evaluation_goal,
    promptHash: contract.prompt_hash,
    schemaVersion: contract.schema_version,
    schemaHash: contract.schema_hash,
    populationId: contract.supported_population.population_id,
    populationDefinitionHash: contract.supported_population.definition_hash
  };
  const allowed = localModelCapabilityDecision(exact, { register });
  assert.equal(allowed.permitted, true);
  assert.equal(allowed.reason, "exact_promoted_contract");

  for (const [field, value, expectedReason] of [
    ["promptHash", "sha256:wrong", "provenance_mismatch:prompt_hash"],
    ["schemaHash", "sha256:wrong", "provenance_mismatch:schema_hash"],
    ["populationId", "wrong_population", "population_mismatch:population_id"],
    ["populationDefinitionHash", "sha256:wrong", "population_mismatch:definition_hash"]
  ]) {
    const decision = localModelCapabilityDecision({ ...exact, [field]: value }, { register });
    assert.equal(decision.permitted, false, field);
    assert.equal(decision.reason, expectedReason, field);
  }
});

test("operational use requires execution-verified immutable provenance and exact evidence", () => {
  const { register, contract } = promotedFixture();
  const exact = exactOperationalResult(register, contract);
  assert.equal(isOperationalEvaluationResult(exact, { register }), true);
  assert.equal(evaluationResultCapability(exact, { register }).displayState, "promoted");

  const mutations = [
    ["modelDigest", "sha256:wrong", "provenance_mismatch:model_digest"],
    ["capabilityRegisterHash", "sha256:wrong", "provenance_mismatch:capability_register_hash"],
    ["promotionContractHash", "sha256:wrong", "provenance_mismatch:promotion_contract_hash"],
    ["provenanceAuthority", "client_asserted", "provenance_not_execution_layer_verified"],
    ["evidenceValidationStatus", "unchecked", "minimum_evidence_not_validated"],
    ["exactQuoteCount", 0, "minimum_evidence_not_met"],
    ["transcriptHash", "", "transcript_hash_missing"]
  ];
  for (const [field, value, expectedReason] of mutations) {
    const result = structuredClone(exact);
    result.evaluationAudit[field] = value;
    const decision = evaluationResultCapability(result, { register });
    assert.equal(decision.operationallyPermitted, false, field);
    assert.equal(decision.reason, expectedReason, field);
    assert.equal(decision.displayState, "research_only", field);
  }

  const settingsMismatch = structuredClone(exact);
  settingsMismatch.evaluationAudit.inferenceSettings.temperature = 0.2;
  const settingsDecision = evaluationResultCapability(settingsMismatch, { register });
  assert.equal(settingsDecision.operationallyPermitted, false);
  assert.equal(settingsDecision.reason, "provenance_mismatch:inference_settings");
});

test("a status label cannot promote an incomplete contract", () => {
  const { register } = promotedFixture();
  delete register.capabilities[0].promotion_contract.model_digest;
  const decision = localModelCapabilityDecision({
    use: OPERATIONAL_USE,
    capabilityId: "callback_v3_state"
  }, { register });
  assert.equal(decision.permitted, false);
  assert.equal(decision.capabilityStatus, "register_unavailable");
  assert.match(decision.reason, /incomplete or internally inconsistent promotion contract/);
});
