"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createDraftManifest,
  createEmptyValidationLab,
  freezeManifest,
  priorAuditExclusionProof,
  readValidationLab,
  saveManifestLabels,
  strictPromotionTest,
  validationLabView,
  writeValidationLab
} = require("../src/evaluationValidationLab");

function calls(count = 120) {
  return Array.from({ length: count }, (_, index) => ({
    callId: String(41000000 + index),
    dateTime: `2026-07-${String(1 + (index % 6)).padStart(2, "0")}T01:00:00.000Z`,
    sourceTime: "02/07/2026 11:00:00 AEST",
    direction: index % 7 === 0 ? "in" : "out",
    callType: index % 7 === 0 ? "Inbound" : "Click to dial",
    salesperson: `Seller ${index % 5}`,
    source: `Source ${index % 4}`,
    durationSeconds: 30 + index,
    localOutcome: index % 3 === 0 ? "voicemail" : "unknown",
    stableIds: [{ field: "customer_id", value: String(9000 + index) }],
    transcript: `Seller ${index} says hello. Customer ${index} responds.`,
    transcriptTurns: [
      { speaker: `Seller ${index % 5} (CWA)`, text: `Direct seller quote ${index}.` },
      { speaker: "Customer", text: `Direct customer quote ${index}.` }
    ]
  }));
}

function labContext(rows, runtimePath, extra = {}) {
  return { calls: rows, runtimePath, importId: "import_test", studio: { evaluationResults: [], evaluationRuns: [] }, ...extra };
}

test("prior-audit proof excludes runtime mentions and every historical/current result", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-validation-proof-"));
  const repository = path.join(temp, "repository");
  fs.mkdirSync(path.join(repository, "docs"), { recursive: true });
  const rows = calls(5);
  fs.writeFileSync(path.join(temp, "PRIOR_AUDIT.md"), `Call ID ${rows[0].callId}\n`, "utf8");
  fs.writeFileSync(path.join(repository, "docs", "RULE_HISTORY.md"), `Rule fixture ${rows[2].callId}\n`, "utf8");
  const proof = priorAuditExclusionProof(rows, {
    runtimePath: temp,
    repositoryPath: repository,
    studio: {
      evaluationResults: [{ callId: rows[1].callId, evaluationGoal: "spiel_quality" }],
      evaluationRuns: [{ id: "run_failed", callSelection: { requestedCallIds: [rows[3].callId] } }]
    }
  });
  assert.deepEqual(proof.excludedCallIds, [rows[0].callId, rows[1].callId, rows[2].callId, rows[3].callId]);
  assert.equal(proof.evidenceFiles.length, 2);
  assert.match(proof.records[1].sources[0], /historical_result/);
  assert.match(proof.records[2].sources[0], /artifact:docs\/RULE_HISTORY/);
  assert.match(proof.records[3].sources[0], /historical_run/);
});

test("draft manifests select only unseen calls and expose no more than five direct-quote questions", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-validation-draft-"));
  const rows = calls(20);
  fs.writeFileSync(path.join(temp, "PRIOR_AUDIT.md"), `Call ID ${rows[0].callId}\n`, "utf8");
  const result = createDraftManifest(createEmptyValidationLab(), {
    name: "Strict smoke",
    capabilityId: "future_exact_fact_v1",
    exactFact: "one exact frozen fact",
    productUse: "research comparison only",
    partition: "smoke",
    sampleSize: 10
  }, labContext(rows, temp));
  assert.equal(result.manifest.examples.length, 10);
  assert.equal(result.manifest.examples.some((example) => example.callId === rows[0].callId), false);
  assert.equal(result.manifest.operationalUsePermitted, false);
  const view = validationLabView(result.lab, rows);
  assert.equal(view.manifests[0].labelBatch.length, 5);
  assert.equal(view.authority, "benchmark_truth_only");
});

test("human labels require exact transcript turns and save at most five at a time", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-validation-label-"));
  const rows = calls(20);
  const draft = createDraftManifest(createEmptyValidationLab(), {
    capabilityId: "future_exact_fact_v1",
    exactFact: "one exact frozen fact",
    productUse: "research comparison only",
    partition: "smoke",
    sampleSize: 10
  }, labContext(rows, temp));
  const first = draft.manifest.examples[0];
  const saved = saveManifestLabels(draft.lab, draft.manifest.id, [{
    callId: first.callId,
    expectedDecision: "present",
    caseType: "positive",
    supportStatus: "supported",
    controllingReason: "The direct seller quote proves the expected fact.",
    evidenceTurnIndexes: [0]
  }], { calls: rows });
  assert.equal(saved.manifest.examples[0].labelStatus, "confirmed");
  assert.equal(saved.manifest.examples[0].label.evidence[0].quote.startsWith("Direct"), true);
  assert.throws(() => saveManifestLabels(draft.lab, draft.manifest.id, Array.from({ length: 6 }, () => ({ callId: first.callId })), { calls: rows }), /one to 5/);
  assert.throws(() => saveManifestLabels(draft.lab, draft.manifest.id, [{
    callId: first.callId,
    expectedDecision: "present",
    caseType: "positive",
    supportStatus: "supported",
    controllingReason: "reason",
    evidenceTurnIndexes: [99]
  }], { calls: rows }), /does not exist/);
  assert.throws(() => saveManifestLabels(draft.lab, draft.manifest.id, [{
    callId: first.callId,
    expectedDecision: "present",
    caseType: "positive",
    supportStatus: "unsupported",
    controllingReason: "reason",
    evidenceTurnIndexes: [0]
  }], { calls: rows }), /Only unsupported cases/);
});

test("a promotion manifest needs 100 frozen balanced labels and remains unpromoted without a candidate gate", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-validation-promotion-"));
  const rows = calls(120);
  let result = createDraftManifest(createEmptyValidationLab(), {
    capabilityId: "materially_different_future_candidate_v1",
    exactFact: "one exact frozen fact",
    productUse: "research comparison only",
    partition: "promotion",
    sampleSize: 100,
    minimumDecisionAccuracy: 0.95,
    minimumEvidenceIntegrity: 1,
    minimumCoverage: 0.9
  }, labContext(rows, temp));
  for (let offset = 0; offset < 100; offset += 5) {
    const batch = result.manifest.examples.slice(offset, offset + 5).map((example, index) => {
      const position = offset + index;
      const caseType = position < 34 ? "positive" : position < 67 ? "hard_negative" : "unsupported";
      return {
        callId: example.callId,
        expectedDecision: caseType === "positive" ? "present" : caseType === "hard_negative" ? "absent" : "not_scored",
        caseType,
        supportStatus: caseType === "unsupported" ? "unsupported" : "supported",
        critical: position === 0,
        controllingReason: `Frozen reason for ${caseType}.`,
        evidenceTurnIndexes: [caseType === "positive" ? 0 : 1]
      };
    });
    result = saveManifestLabels(result.lab, result.manifest.id, batch, { calls: rows });
  }
  const tamperedLab = structuredClone(result.lab);
  tamperedLab.manifests[0].examples[0].label.evidence[0].quote = "altered after human confirmation";
  assert.throws(() => freezeManifest(tamperedLab, result.manifest.id, labContext(rows, temp)), /frozen_label_evidence_invalid/);
  const frozen = freezeManifest(result.lab, result.manifest.id, labContext(rows, temp));
  assert.equal(frozen.manifest.status, "frozen");
  assert.equal(frozen.manifest.examples.length, 100);
  assert.equal(frozen.manifest.freezeReadiness.balance.balanced, true);
  assert.match(frozen.manifest.manifestFingerprint, /^[a-f0-9]{64}$/);
  const gate = strictPromotionTest(frozen.manifest, {}, { calls: rows });
  assert.equal(gate.eligibleForExternalApproval, false);
  assert.equal(gate.promoted, false);
  assert.equal(gate.blockers.includes("candidate_results_missing"), true);

  const passingCandidate = {
    id: "deterministic_exact_fact_v1",
    type: "deterministic_rule",
    ruleHash: "sha256:deterministic-exact-fact-v1",
    inferenceStartedAt: new Date(Date.parse(frozen.manifest.labelsFrozenAt) + 1000).toISOString(),
    results: frozen.manifest.examples.map((example) => ({
      callId: example.callId,
      decision: example.label.expectedDecision,
      status: example.label.supportStatus === "unsupported" ? "unsupported" : "decided",
      evidenceTurnIndexes: [example.label.caseType === "positive" ? 0 : 1]
    })),
    resourceUse: { jobs: 0, attempts: 0, retries: 0, tokens: 0 }
  };
  const passed = strictPromotionTest(frozen.manifest, passingCandidate, { calls: rows });
  assert.equal(passed.eligibleForExternalApproval, true);
  assert.equal(passed.promoted, false);
  assert.equal(passed.externalApprovalStillRequired, true);
  assert.equal(passed.comparison.totals.falsePositives, 0);
  assert.equal(passed.comparison.totals.falseNegatives, 0);
  assert.equal(passed.comparison.totals.unsupportedErrors, 0);
  assert.equal(passed.comparison.totals.coverage, 1);

  const duplicateCandidate = {
    ...passingCandidate,
    results: [...passingCandidate.results, passingCandidate.results[0]]
  };
  const duplicateGate = strictPromotionTest(frozen.manifest, duplicateCandidate, { calls: rows });
  assert.equal(duplicateGate.eligibleForExternalApproval, false);
  assert.equal(duplicateGate.blockers.includes("candidate_result_set_mismatch"), true);

  const wrongEvidenceCandidate = {
    ...passingCandidate,
    results: passingCandidate.results.map((candidateResult, index) => index === 0
      ? { ...candidateResult, evidenceTurnIndexes: [1] }
      : candidateResult)
  };
  const wrongEvidenceGate = strictPromotionTest(frozen.manifest, wrongEvidenceCandidate, { calls: rows });
  assert.equal(wrongEvidenceGate.eligibleForExternalApproval, false);
  assert.equal(wrongEvidenceGate.blockers.includes("evidence_integrity_below_threshold"), true);
});

test("Validation Lab persistence is separate, atomic, and fail closed on corruption", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-validation-store-"));
  const storePath = path.join(temp, "state.json");
  const written = writeValidationLab(createEmptyValidationLab(), { storePath });
  assert.equal(written.operationalUsePermitted, false);
  const loaded = readValidationLab({ storePath });
  assert.equal(loaded.error, null);
  fs.writeFileSync(loaded.path, "not json", "utf8");
  const corrupt = readValidationLab({ storePath });
  assert.match(corrupt.error, /failed closed/);
  assert.equal(corrupt.lab.manifests.length, 0);
});
