"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LAB_SCHEMA_VERSION = "sales_dashboard_evaluation_validation_lab.v1";
const MAX_LABEL_BATCH = 5;
const PARTITION_RULES = Object.freeze({
  smoke: { minimumExamples: 10, defaultExamples: 10, promotionEvidence: false },
  development: { minimumExamples: 50, defaultExamples: 50, promotionEvidence: false },
  promotion: { minimumExamples: 100, defaultExamples: 100, promotionEvidence: true },
  shadow: { minimumExamples: 25, defaultExamples: 25, promotionEvidence: false }
});
const CASE_TYPES = new Set(["positive", "hard_negative", "unsupported"]);
const SUPPORT_STATUSES = new Set(["supported", "unsupported"]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function resolveValidationLabPath(options = {}) {
  if (options.validationLabPath) return path.resolve(options.validationLabPath);
  const storePath = path.resolve(options.storePath || path.join(process.cwd(), "data", "store", "state.json"));
  return path.join(path.dirname(storePath), "evaluation-validation-lab.json");
}

function createEmptyValidationLab() {
  const now = new Date().toISOString();
  return {
    schemaVersion: LAB_SCHEMA_VERSION,
    authority: "benchmark_truth_only",
    operationalUsePermitted: false,
    createdAt: now,
    updatedAt: now,
    manifests: [],
    candidateComparisons: []
  };
}

function normalizeValidationLab(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createEmptyValidationLab();
  if (value.schemaVersion && value.schemaVersion !== LAB_SCHEMA_VERSION) {
    throw new Error("The Evaluation Validation Lab schema is unsupported.");
  }
  return {
    ...createEmptyValidationLab(),
    ...structuredClone(value),
    schemaVersion: LAB_SCHEMA_VERSION,
    authority: "benchmark_truth_only",
    operationalUsePermitted: false,
    manifests: Array.isArray(value.manifests) ? value.manifests : [],
    candidateComparisons: Array.isArray(value.candidateComparisons) ? value.candidateComparisons : []
  };
}

function readValidationLab(options = {}) {
  const labPath = resolveValidationLabPath(options);
  if (!fs.existsSync(labPath)) return { lab: createEmptyValidationLab(), path: labPath, exists: false, error: null };
  try {
    return { lab: normalizeValidationLab(JSON.parse(fs.readFileSync(labPath, "utf8"))), path: labPath, exists: true, error: null };
  } catch (error) {
    return { lab: createEmptyValidationLab(), path: labPath, exists: true, error: `Validation Lab failed closed: ${error.message}` };
  }
}

function writeValidationLab(lab, options = {}) {
  const labPath = resolveValidationLabPath(options);
  fs.mkdirSync(path.dirname(labPath), { recursive: true });
  const normalized = { ...normalizeValidationLab(lab), updatedAt: new Date().toISOString() };
  const tempPath = `${labPath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, labPath);
  return normalized;
}

function runtimeEvidenceFiles(runtimePath) {
  if (!runtimePath || !fs.existsSync(runtimePath)) return [];
  return fs.readdirSync(runtimePath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(runtimePath, entry.name))
    .filter((filePath) => /\.(?:md|json|js|csv)$/i.test(filePath))
    .sort();
}

function repositoryEvidenceFiles(repositoryPath) {
  const root = clean(repositoryPath) ? path.resolve(repositoryPath) : "";
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      if (/\.(?:md|json|js|csv)$/i.test(target)) files.push(target);
      return;
    }
    fs.readdirSync(target, { withFileTypes: true }).forEach((entry) => {
      if ([".git", "data", "node_modules"].includes(entry.name)) return;
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && /\.(?:md|json|js|csv)$/i.test(entry.name)) files.push(child);
    });
  };
  ["docs", "src", "tests", "scripts"].forEach((directory) => visit(path.join(root, directory)));
  ["AGENTS.md", "AI_SYSTEM.md", "SECURITY.md"].forEach((file) => visit(path.join(root, file)));
  return files.sort();
}

function priorAuditExclusionProof(calls = [], context = {}) {
  const knownCallIds = new Set((calls || []).map((call) => clean(call.callId || call.call_id)).filter(Boolean));
  const excluded = new Map();
  const evidenceFiles = [];
  const add = (callId, source) => {
    const id = clean(callId);
    if (!knownCallIds.has(id)) return;
    if (!excluded.has(id)) excluded.set(id, new Set());
    excluded.get(id).add(source);
  };

  const artifactFiles = Array.from(new Set([
    ...runtimeEvidenceFiles(context.runtimePath || path.resolve(__dirname, "..", "runtime")),
    ...repositoryEvidenceFiles(context.repositoryPath)
  ])).sort();
  artifactFiles.forEach((filePath) => {
    const body = fs.readFileSync(filePath, "utf8");
    const ids = Array.from(body.matchAll(/\b\d{8}\b/g), (match) => match[0]).filter((id) => knownCallIds.has(id));
    const relativeRoot = clean(context.repositoryPath) ? path.resolve(context.repositoryPath) : path.resolve(__dirname, "..");
    const relative = path.relative(relativeRoot, filePath).replace(/\\/g, "/");
    if (ids.length) {
      evidenceFiles.push({ path: relative, sha256: crypto.createHash("sha256").update(body).digest("hex"), matchedCallCount: new Set(ids).size });
      ids.forEach((id) => add(id, `artifact:${relative}`));
    }
  });

  const studio = context.studio && typeof context.studio === "object" ? context.studio : {};
  (studio.evaluationResults || []).forEach((result) => add(result.callId, `historical_result:${clean(result.evaluationGoal) || "unknown"}`));
  (studio.evaluationRuns || []).forEach((run) => {
    const runCallIds = [
      ...(run.selectedCallIds || []),
      ...(run.callIds || []),
      ...(run.callSelection?.requestedCallIds || []),
      ...(run.callSelection?.callIds || []),
      ...(run.queuedJobs || []).map((job) => job.callId || job.call_id)
    ];
    runCallIds.forEach((callId) => add(callId, `historical_run:${clean(run.id) || "unknown"}`));
  });
  const lab = normalizeValidationLab(context.lab);
  (lab.manifests || []).forEach((manifest) => {
    (manifest.examples || []).forEach((example) => add(example.callId, `validation_manifest:${clean(manifest.id) || "unknown"}`));
  });

  const records = Array.from(excluded.entries())
    .map(([callId, sources]) => ({ callId, sources: Array.from(sources).sort() }))
    .sort((a, b) => a.callId.localeCompare(b.callId));
  return {
    schemaVersion: "sales_dashboard_prior_audit_exclusion_proof.v1",
    excludedCallIds: records.map((record) => record.callId),
    excludedCallCount: records.length,
    records,
    evidenceFiles,
    fingerprint: canonicalHash({ records, evidenceFiles })
  };
}

function transcriptHash(call = {}) {
  return canonicalHash({ transcript: clean(call.transcript), turns: call.transcriptTurns || [] });
}

function sourceFacts(call = {}) {
  return {
    callId: clean(call.callId),
    sourceTime: clean(call.sourceTime),
    dateTime: clean(call.dateTime),
    direction: clean(call.direction),
    callType: clean(call.callType),
    salesperson: clean(call.salesperson),
    source: clean(call.source),
    durationSeconds: Number(call.durationSeconds || 0),
    localOutcome: clean(call.localOutcome) || "unknown",
    stableIds: Array.isArray(call.stableIds) ? call.stableIds.map((item) => ({ field: clean(item.field), value: clean(item.value) })).filter((item) => item.field && item.value) : []
  };
}

function provisionalStratum(call = {}) {
  const outcome = clean(call.localOutcome).toLowerCase();
  if (["voicemail", "wrong_number", "opt_out", "no_answer", "system_audio"].includes(outcome)) return "literal_positive_candidate";
  if (clean(call.transcript) && (call.transcriptTurns || []).length >= 2) return "hard_negative_candidate";
  return "unsupported_candidate";
}

function diversifiedCandidates(calls = [], limit = 10, seed = "") {
  const buckets = new Map();
  calls.forEach((call) => {
    const key = [provisionalStratum(call), clean(call.direction), clean(call.source) || "unknown"].join("|");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(call);
  });
  const orderedBuckets = Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, rows]) => rows.sort((a, b) => canonicalHash(`${seed}:${clean(a.callId)}`).localeCompare(canonicalHash(`${seed}:${clean(b.callId)}`))));
  const selected = [];
  while (selected.length < limit && orderedBuckets.some((rows) => rows.length)) {
    orderedBuckets.forEach((rows) => {
      if (selected.length < limit && rows.length) selected.push(rows.shift());
    });
  }
  return selected;
}

function manifestId(input = {}, now = new Date()) {
  return `manifest_${canonicalHash(`${clean(input.capabilityId)}:${clean(input.partition)}:${now.toISOString()}:${clean(input.name)}`).slice(0, 20)}`;
}

function normalizeThreshold(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 1)) : fallback;
}

function createDraftManifest(labValue, input = {}, context = {}) {
  const lab = normalizeValidationLab(labValue);
  const calls = Array.isArray(context.calls) ? context.calls : [];
  const partition = clean(input.partition).toLowerCase();
  const partitionRule = PARTITION_RULES[partition];
  if (!partitionRule) throw new Error("Partition must be smoke, development, promotion, or shadow.");
  const capabilityId = clean(input.capabilityId);
  const exactFact = clean(input.exactFact);
  const productUse = clean(input.productUse);
  if (!capabilityId || !exactFact || !productUse) throw new Error("Capability, exact fact, and product use are required before selection.");
  const requestedSize = Math.max(1, Math.min(Number(input.sampleSize || partitionRule.defaultExamples), 1000));
  const proof = priorAuditExclusionProof(calls, { ...context, lab });
  const excluded = new Set(proof.excludedCallIds);
  const eligible = calls.filter((call) => clean(call.callId) && clean(call.transcript) && !excluded.has(clean(call.callId)));
  const selected = diversifiedCandidates(eligible, requestedSize, `${capabilityId}:${partition}:${clean(context.importId)}`);
  if (!selected.length) throw new Error("No genuinely unseen transcript calls remain after prior-audit and historical-result exclusions.");
  const now = new Date();
  const manifest = {
    id: manifestId({ ...input, capabilityId, partition }, now),
    schemaVersion: "sales_dashboard_frozen_benchmark_manifest.v1",
    name: clean(input.name) || `${capabilityId} ${partition}`,
    status: "draft_labeling",
    authority: "benchmark_truth_only",
    operationalUsePermitted: false,
    capabilityId,
    exactFact,
    productUse,
    partition,
    sourceImportId: clean(context.importId),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    labelsFrozenAt: null,
    manifestFingerprint: null,
    priorAuditExclusion: proof,
    selectionContract: {
      requestedSize,
      selectedSize: selected.length,
      eligibleBeforeSelection: eligible.length,
      completePriorAuditExclusion: true,
      excludesHistoricalAndCurrentResults: true,
      excludesPriorValidationManifests: true,
      deterministicDiversitySelection: true,
      candidateInferenceBeforeFreezePermitted: false
    },
    evidenceContract: {
      minimumExactQuotesPerDecision: Math.max(1, Math.min(Number(input.minimumExactQuotesPerDecision || 1), 10)),
      speakerAndTurnRequired: true,
      quoteMustMatchCurrentTranscript: true,
      unsupportedStillRequiresEvidence: true
    },
    promotionContract: {
      minimumDecisionAccuracy: normalizeThreshold(input.minimumDecisionAccuracy, 0.95),
      minimumEvidenceIntegrity: normalizeThreshold(input.minimumEvidenceIntegrity, 1),
      minimumCoverage: normalizeThreshold(input.minimumCoverage, 0.9),
      maximumCriticalErrors: 0,
      maximumJobs: Math.max(0, Number(input.maximumJobs || 0)),
      maximumAttempts: Math.max(0, Number(input.maximumAttempts || 0)),
      maximumRetries: Math.max(0, Number(input.maximumRetries || 0)),
      maximumTokens: Math.max(0, Number(input.maximumTokens || 0)),
      maximumExecutionMs: Math.max(0, Number(input.maximumExecutionMs || 0)),
      externalApprovalRequired: true,
      narrowSemanticFailureStopsFamily: true
    },
    examples: selected.map((call) => {
      const facts = sourceFacts(call);
      return {
        callId: facts.callId,
        transcriptHash: transcriptHash(call),
        sourceFacts: facts,
        sourceFactsHash: canonicalHash(facts),
        provisionalStratum: provisionalStratum(call),
        labelStatus: "pending",
        label: null
      };
    })
  };
  return { lab: { ...lab, manifests: [...lab.manifests, manifest] }, manifest };
}

function callLookup(calls = []) {
  return new Map((calls || []).map((call) => [clean(call.callId || call.call_id), call]));
}

function findManifest(lab, manifestIdValue) {
  const manifest = (lab.manifests || []).find((item) => item.id === clean(manifestIdValue));
  if (!manifest) throw new Error("Validation manifest not found.");
  return manifest;
}

function verifyExampleSource(example = {}, call = {}) {
  if (!call || !clean(call.callId)) return "source_call_missing";
  if (transcriptHash(call) !== clean(example.transcriptHash)) return "transcript_hash_changed";
  if (canonicalHash(sourceFacts(call)) !== clean(example.sourceFactsHash)) return "source_facts_changed";
  return "verified";
}

function evidenceFromTurnIndexes(call = {}, indexes = []) {
  const turns = Array.isArray(call.transcriptTurns) ? call.transcriptTurns : [];
  const unique = Array.from(new Set((indexes || []).map((value) => Number(value)).filter((value) => Number.isInteger(value))));
  return unique.map((turnIndex) => {
    const turn = turns[turnIndex];
    if (!turn) throw new Error(`Evidence turn ${turnIndex} does not exist in the source transcript.`);
    return { turnIndex, speaker: clean(turn.speaker), quote: clean(turn.text) };
  });
}

function verifyLabelEvidence(example = {}, call = {}, minimumExactQuotes = 1) {
  const label = example.label || {};
  if (!clean(label.expectedDecision) || !clean(label.controllingReason)) return "label_decision_or_reason_missing";
  if (!CASE_TYPES.has(clean(label.caseType))) return "label_case_type_invalid";
  if (!SUPPORT_STATUSES.has(clean(label.supportStatus))) return "label_support_status_invalid";
  if ((label.caseType === "unsupported") !== (label.supportStatus === "unsupported")) return "unsupported_case_contract_invalid";
  if (!Array.isArray(label.evidence) || label.evidence.length < Number(minimumExactQuotes || 1)) return "label_exact_evidence_missing";
  const turns = Array.isArray(call?.transcriptTurns) ? call.transcriptTurns : [];
  for (const evidence of label.evidence) {
    const turnIndex = Number(evidence.turnIndex);
    const turn = Number.isInteger(turnIndex) ? turns[turnIndex] : null;
    if (!turn) return "label_evidence_turn_missing";
    if (clean(evidence.speaker) !== clean(turn.speaker) || clean(evidence.quote) !== clean(turn.text)) return "label_evidence_no_longer_exact";
  }
  if (canonicalHash(label.evidence) !== clean(label.evidenceHash)) return "label_evidence_hash_invalid";
  return "verified";
}

function saveManifestLabels(labValue, manifestIdValue, labels = [], context = {}) {
  const lab = normalizeValidationLab(labValue);
  if (!Array.isArray(labels) || !labels.length || labels.length > MAX_LABEL_BATCH) {
    throw new Error(`Human labels must be saved in batches of one to ${MAX_LABEL_BATCH}.`);
  }
  const manifest = findManifest(lab, manifestIdValue);
  if (manifest.status !== "draft_labeling") throw new Error("Frozen or retired manifests are immutable.");
  const calls = callLookup(context.calls);
  const labelsByCall = new Map(labels.map((label) => [clean(label.callId), label]));
  const now = new Date().toISOString();
  const nextExamples = manifest.examples.map((example) => {
    const input = labelsByCall.get(clean(example.callId));
    if (!input) return example;
    const call = calls.get(clean(example.callId));
    const sourceStatus = verifyExampleSource(example, call);
    if (sourceStatus !== "verified") throw new Error(`Call ${example.callId} cannot be labelled: ${sourceStatus}.`);
    const expectedDecision = clean(input.expectedDecision);
    const controllingReason = clean(input.controllingReason);
    const caseType = clean(input.caseType).toLowerCase();
    const supportStatus = clean(input.supportStatus).toLowerCase();
    if (!expectedDecision || !controllingReason) throw new Error(`Call ${example.callId} requires an expected decision and controlling reason.`);
    if (!CASE_TYPES.has(caseType)) throw new Error(`Call ${example.callId} requires positive, hard_negative, or unsupported case type.`);
    if (!SUPPORT_STATUSES.has(supportStatus)) throw new Error(`Call ${example.callId} requires supported or unsupported support status.`);
    if ((caseType === "unsupported") !== (supportStatus === "unsupported")) throw new Error("Only unsupported cases may use support status unsupported.");
    const evidence = evidenceFromTurnIndexes(call, input.evidenceTurnIndexes || []);
    if (evidence.length < Number(manifest.evidenceContract.minimumExactQuotesPerDecision || 1)) {
      throw new Error(`Call ${example.callId} does not meet the minimum exact-evidence requirement.`);
    }
    return {
      ...example,
      labelStatus: "confirmed",
      label: {
        expectedDecision,
        caseType,
        supportStatus,
        critical: input.critical === true || ["1", "true", "yes", "on"].includes(clean(input.critical).toLowerCase()),
        controllingReason,
        evidence,
        evidenceHash: canonicalHash(evidence),
        labelledBy: "local_manager",
        labelledAt: now,
        frozen: false
      }
    };
  });
  if (labelsByCall.size !== labels.length || labels.some((label) => !manifest.examples.some((example) => example.callId === clean(label.callId)))) {
    throw new Error("Every submitted label must belong to the selected manifest.");
  }
  const nextManifest = { ...manifest, examples: nextExamples, updatedAt: now };
  return {
    lab: { ...lab, manifests: lab.manifests.map((item) => item.id === manifest.id ? nextManifest : item) },
    manifest: nextManifest
  };
}

function caseBalance(examples = []) {
  const counts = { positive: 0, hard_negative: 0, unsupported: 0 };
  examples.forEach((example) => {
    if (CASE_TYPES.has(example.label?.caseType)) counts[example.label.caseType] += 1;
  });
  const minimumPerType = Math.max(1, Math.ceil(examples.length * 0.1));
  return {
    counts,
    minimumPerType,
    balanced: Object.values(counts).every((count) => count >= minimumPerType)
  };
}

function freezeReadiness(manifest = {}, calls = []) {
  const rule = PARTITION_RULES[manifest.partition] || { minimumExamples: Number.MAX_SAFE_INTEGER };
  const lookup = callLookup(calls);
  const blockers = [];
  if ((manifest.examples || []).length < rule.minimumExamples) blockers.push(`partition_requires_${rule.minimumExamples}_examples`);
  if ((manifest.examples || []).some((example) => example.labelStatus !== "confirmed" || !example.label)) blockers.push("human_labels_incomplete");
  const sourceFailures = (manifest.examples || [])
    .map((example) => ({ callId: example.callId, status: verifyExampleSource(example, lookup.get(example.callId)) }))
    .filter((item) => item.status !== "verified");
  if (sourceFailures.length) blockers.push("source_or_transcript_changed");
  const labelEvidenceFailures = (manifest.examples || [])
    .filter((example) => example.labelStatus === "confirmed" && example.label)
    .map((example) => ({
      callId: example.callId,
      status: verifyLabelEvidence(example, lookup.get(example.callId), manifest.evidenceContract?.minimumExactQuotesPerDecision || 1)
    }))
    .filter((item) => item.status !== "verified");
  if (labelEvidenceFailures.length) blockers.push("frozen_label_evidence_invalid");
  const balance = caseBalance(manifest.examples || []);
  if (!balance.balanced) blockers.push("positive_hard_negative_unsupported_balance_not_met");
  return { ready: blockers.length === 0, blockers, sourceFailures, labelEvidenceFailures, balance, minimumExamples: rule.minimumExamples };
}

function manifestFingerprintValue(manifest = {}) {
  const copy = structuredClone(manifest);
  copy.manifestFingerprint = null;
  return canonicalHash(copy);
}

function freezeManifest(labValue, manifestIdValue, context = {}) {
  const lab = normalizeValidationLab(labValue);
  const manifest = findManifest(lab, manifestIdValue);
  if (manifest.status !== "draft_labeling") throw new Error("Only a draft labelling manifest can be frozen.");
  const readiness = freezeReadiness(manifest, context.calls || []);
  if (!readiness.ready) throw new Error(`Manifest cannot be frozen: ${readiness.blockers.join(", ")}.`);
  const freshProof = priorAuditExclusionProof(context.calls || [], { ...context, lab: { ...lab, manifests: lab.manifests.filter((item) => item.id !== manifest.id) } });
  if (freshProof.fingerprint !== manifest.priorAuditExclusion.fingerprint) {
    throw new Error("Manifest cannot be frozen because the prior-audit exclusion universe changed after selection.");
  }
  const now = new Date().toISOString();
  const frozen = {
    ...manifest,
    status: "frozen",
    labelsFrozenAt: now,
    updatedAt: now,
    examples: manifest.examples.map((example) => ({ ...example, label: { ...example.label, frozen: true, frozenAt: now } })),
    freezeReadiness: readiness,
    manifestFingerprint: null
  };
  frozen.manifestFingerprint = manifestFingerprintValue(frozen);
  return {
    lab: { ...lab, manifests: lab.manifests.map((item) => item.id === manifest.id ? frozen : item) },
    manifest: frozen
  };
}

function compareCandidate(manifest = {}, candidate = {}, context = {}) {
  const results = Array.isArray(candidate.results) ? candidate.results : [];
  const resultByCall = new Map(results.map((result) => [clean(result.callId), result]));
  const resultCallIds = results.map((result) => clean(result.callId)).filter(Boolean);
  const resultCallIdCounts = resultCallIds.reduce((counts, callId) => counts.set(callId, (counts.get(callId) || 0) + 1), new Map());
  const manifestCallIds = new Set((manifest.examples || []).map((example) => example.callId));
  const duplicateCallIds = Array.from(resultCallIdCounts.entries()).filter(([, count]) => count > 1).map(([callId]) => callId).sort();
  const unexpectedCallIds = Array.from(new Set(resultCallIds.filter((callId) => !manifestCallIds.has(callId)))).sort();
  const missingCallIds = Array.from(manifestCallIds).filter((callId) => !resultByCall.has(callId)).sort();
  const calls = callLookup(context.calls);
  let exact = 0;
  let evidenceValid = 0;
  let abstentions = 0;
  let criticalErrors = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let unsupportedErrors = 0;
  const caseResults = { positive: { total: 0, exact: 0 }, hard_negative: { total: 0, exact: 0 }, unsupported: { total: 0, exact: 0 } };
  const rows = (manifest.examples || []).map((example) => {
    const expected = example.label || {};
    const actual = resultByCall.get(example.callId) || null;
    const isAbstention = !actual || ["abstain", "not_scored", "unsupported"].includes(clean(actual.status).toLowerCase());
    const decisionExact = Boolean(actual && clean(actual.decision) === clean(expected.expectedDecision));
    let evidence = [];
    try {
      evidence = actual ? evidenceFromTurnIndexes(calls.get(example.callId), actual.evidenceTurnIndexes || []) : [];
    } catch {}
    const evidenceMeetsMinimum = evidence.length >= Number(manifest.evidenceContract?.minimumExactQuotesPerDecision || 1);
    const frozenEvidenceTurnIndexes = new Set((expected.evidence || []).map((item) => Number(item.turnIndex)).filter(Number.isInteger));
    const evidenceMatchesFrozen = evidenceMeetsMinimum && evidence.every((item) => frozenEvidenceTurnIndexes.has(item.turnIndex));
    if (decisionExact) exact += 1;
    if (evidenceMatchesFrozen) evidenceValid += 1;
    if (isAbstention) abstentions += 1;
    if (expected.critical === true && !decisionExact) criticalErrors += 1;
    if (expected.caseType === "positive" && !decisionExact) falseNegatives += 1;
    if (expected.caseType === "hard_negative" && !decisionExact && !isAbstention) falsePositives += 1;
    if (expected.caseType === "unsupported" && !decisionExact) unsupportedErrors += 1;
    if (caseResults[expected.caseType]) {
      caseResults[expected.caseType].total += 1;
      if (decisionExact) caseResults[expected.caseType].exact += 1;
    }
    return { callId: example.callId, expected: expected.expectedDecision, actual: actual?.decision || null, decisionExact, evidenceMeetsMinimum, evidenceMatchesFrozen, abstention: isAbstention, caseType: expected.caseType };
  });
  const total = rows.length;
  const supportedTotal = rows.filter((row) => row.caseType !== "unsupported").length;
  const supportedAnswered = rows.filter((row) => row.caseType !== "unsupported" && !row.abstention).length;
  const supplied = new Set(results.map((result) => clean(result.callId)).filter((callId) => manifestCallIds.has(callId))).size;
  return {
    schemaVersion: "sales_dashboard_candidate_comparison.v1",
    manifestId: manifest.id,
    manifestFingerprint: manifest.manifestFingerprint,
    candidateId: clean(candidate.id) || "unnamed_candidate",
    candidateFamily: clean(candidate.family),
    materiallyDifferentCandidate: candidate.materiallyDifferentCandidate === true,
    totals: {
      examples: total,
      supplied,
      received: results.length,
      duplicateCallIds,
      unexpectedCallIds,
      missingCallIds,
      exact,
      falseResults: total - exact,
      falsePositives,
      falseNegatives,
      unsupportedErrors,
      abstentions,
      evidenceValid,
      criticalErrors,
      accuracy: total ? exact / total : 0,
      coverage: supportedTotal ? supportedAnswered / supportedTotal : 0,
      supportedExamples: supportedTotal,
      evidenceIntegrity: total ? evidenceValid / total : 0
    },
    caseResults,
    resourceUse: candidate.resourceUse || null,
    rows
  };
}

function strictPromotionTest(manifest = {}, candidate = {}, context = {}) {
  const blockers = [];
  if (manifest.partition !== "promotion") blockers.push("not_a_promotion_partition");
  if (manifest.status !== "frozen") blockers.push("manifest_not_frozen");
  if ((manifest.examples || []).length < PARTITION_RULES.promotion.minimumExamples) blockers.push("fewer_than_100_genuinely_unseen_examples");
  if (manifestFingerprintValue(manifest) !== clean(manifest.manifestFingerprint)) blockers.push("manifest_fingerprint_invalid");
  if (!manifest.labelsFrozenAt) blockers.push("labels_not_frozen");
  const candidateType = clean(candidate.type);
  const evaluationStartedAt = clean(candidate.inferenceStartedAt || candidate.evaluatedAt);
  if (!evaluationStartedAt || !Number.isFinite(Date.parse(evaluationStartedAt)) || (manifest.labelsFrozenAt && Date.parse(evaluationStartedAt) <= Date.parse(manifest.labelsFrozenAt))) blockers.push("candidate_inference_not_after_label_freeze");
  if (candidateType === "deterministic_rule") {
    if (!clean(candidate.ruleHash)) blockers.push("deterministic_rule_hash_missing");
  } else {
    if (candidate.materiallyDifferentCandidate !== true) blockers.push("candidate_not_materially_different_or_deterministic");
    if (!clean(candidate.provenance?.modelDigest) || !clean(candidate.provenance?.providerModel) || !clean(candidate.materialDifferenceEvidence)) blockers.push("material_difference_provenance_incomplete");
    if ((context.disallowedModelDigests || []).map(clean).includes(clean(candidate.provenance?.modelDigest))) blockers.push("candidate_model_digest_is_disallowed");
  }
  if (!Array.isArray(candidate.results) || !candidate.results.length) blockers.push("candidate_results_missing");
  const comparison = blockers.includes("candidate_results_missing") ? null : compareCandidate(manifest, candidate, context);
  if (comparison) {
    const contract = manifest.promotionContract || {};
    if (comparison.totals.duplicateCallIds.length || comparison.totals.unexpectedCallIds.length || comparison.totals.missingCallIds.length || comparison.totals.received !== comparison.totals.examples) blockers.push("candidate_result_set_mismatch");
    if (comparison.totals.accuracy < Number(contract.minimumDecisionAccuracy ?? 1)) blockers.push("decision_accuracy_below_threshold");
    if (comparison.totals.evidenceIntegrity < Number(contract.minimumEvidenceIntegrity ?? 1)) blockers.push("evidence_integrity_below_threshold");
    if (comparison.totals.coverage < Number(contract.minimumCoverage ?? 1)) blockers.push("coverage_below_threshold");
    if (comparison.totals.criticalErrors > Number(contract.maximumCriticalErrors || 0)) blockers.push("critical_error_limit_exceeded");
    const resourceUse = candidate.resourceUse || {};
    if (candidateType !== "deterministic_rule" && (Number(contract.maximumJobs || 0) <= 0 || Number(contract.maximumAttempts || 0) <= 0 || Number(contract.maximumTokens || 0) <= 0 || Number(contract.maximumExecutionMs || 0) <= 0)) blockers.push("model_resource_budget_not_predeclared");
    if (Number(contract.maximumJobs || 0) > 0 && Number(resourceUse.jobs || 0) > Number(contract.maximumJobs)) blockers.push("job_budget_exceeded");
    if (Number(contract.maximumAttempts || 0) > 0 && Number(resourceUse.attempts || 0) > Number(contract.maximumAttempts)) blockers.push("attempt_budget_exceeded");
    if (Number(contract.maximumRetries || 0) >= 0 && Number(resourceUse.retries || 0) > Number(contract.maximumRetries || 0)) blockers.push("retry_budget_exceeded");
    if (Number(contract.maximumTokens || 0) > 0 && Number(resourceUse.tokens || 0) > Number(contract.maximumTokens)) blockers.push("token_budget_exceeded");
    if (Number(contract.maximumExecutionMs || 0) > 0 && Number(resourceUse.executionMs || 0) > Number(contract.maximumExecutionMs)) blockers.push("execution_time_budget_exceeded");
  }
  return {
    eligibleForExternalApproval: blockers.length === 0,
    promoted: false,
    externalApprovalStillRequired: true,
    stopCandidateFamily: blockers.some((blocker) => ["decision_accuracy_below_threshold", "evidence_integrity_below_threshold", "coverage_below_threshold", "critical_error_limit_exceeded"].includes(blocker)),
    blockers,
    comparison
  };
}

function validationLabView(labValue, calls = []) {
  const lab = normalizeValidationLab(labValue);
  const lookup = callLookup(calls);
  const manifests = lab.manifests.slice().sort((a, b) => clean(b.updatedAt).localeCompare(clean(a.updatedAt))).map((manifest) => {
    const readiness = freezeReadiness(manifest, calls);
    const pending = (manifest.examples || []).filter((example) => example.labelStatus !== "confirmed").slice(0, MAX_LABEL_BATCH);
    return {
      ...manifest,
      readiness,
      labelBatch: pending.map((example) => {
        const call = lookup.get(example.callId) || {};
        return {
          ...example,
          context: {
            sourceTime: clean(call.sourceTime),
            direction: clean(call.direction),
            callType: clean(call.callType),
            salesperson: clean(call.salesperson),
            source: clean(call.source),
            durationSeconds: Number(call.durationSeconds || 0),
            transcriptTurns: Array.isArray(call.transcriptTurns) ? call.transcriptTurns : [],
            transcriptProofHref: `/calls/${encodeURIComponent(example.callId)}`
          }
        };
      })
    };
  });
  return {
    schemaVersion: LAB_SCHEMA_VERSION,
    authority: "benchmark_truth_only",
    operationalUsePermitted: false,
    readError: null,
    summary: {
      manifests: manifests.length,
      drafts: manifests.filter((manifest) => manifest.status === "draft_labeling").length,
      frozen: manifests.filter((manifest) => manifest.status === "frozen").length,
      examples: manifests.reduce((sum, manifest) => sum + (manifest.examples || []).length, 0),
      confirmedLabels: manifests.reduce((sum, manifest) => sum + (manifest.examples || []).filter((example) => example.labelStatus === "confirmed").length, 0),
      promotionEligible: 0
    },
    partitionRules: PARTITION_RULES,
    manifests,
    candidateComparisons: lab.candidateComparisons || []
  };
}

module.exports = {
  CASE_TYPES,
  LAB_SCHEMA_VERSION,
  MAX_LABEL_BATCH,
  PARTITION_RULES,
  canonicalHash,
  caseBalance,
  compareCandidate,
  createDraftManifest,
  createEmptyValidationLab,
  freezeManifest,
  freezeReadiness,
  manifestFingerprintValue,
  normalizeValidationLab,
  priorAuditExclusionProof,
  readValidationLab,
  resolveValidationLabPath,
  saveManifestLabels,
  strictPromotionTest,
  transcriptHash,
  validationLabView,
  verifyExampleSource,
  writeValidationLab
};
