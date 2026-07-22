"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CALL_INTELLIGENCE_FOUNDATION_GOAL,
  CALLBACK_OPPORTUNITY_GOAL,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
  OBJECTION_HANDLING_GOAL,
  OFFER_ACCEPTANCE_GOAL,
  PROCEDURE_ADHERENCE_GOAL,
  createDefaultEvaluationStudio
} = require("../src/evaluationStudio");
const {
  buildSalesOpportunityActionCentre,
  buildSalesOpportunityManagementBrief,
  filterSalesOpportunityRecords
} = require("../src/salesOpportunityActionCentre");

const importId = "import_test";

function baseResult({ id, callId, goal, templateId, assessment, status = "usable", confidenceBand = "high", validationStatus = "schema_and_semantic_validated" }) {
  return {
    id,
    runId: `run_${id}`,
    importId,
    callId,
    templateId,
    templateVersion: Number((templateId.match(/v(\d+)$/) || [])[1] || 1),
    promptHash: "prompt",
    evaluationGoal: goal,
    status,
    confidence: confidenceBand === "high" ? 0.92 : 0.7,
    confidenceBand,
    evidenceAvailability: "available",
    transcriptQuality: "high",
    findings: [],
    managerSummary: "Evidence-backed test result.",
    managerReviewRecommended: false,
    provenance: "evaluation_studio_local_model",
    source: "evaluation_studio",
    evaluationAudit: { schemaVersion: assessment.schemaVersion, validationStatus },
    resultVersion: 1,
    isLatest: true,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    containsUntrustedLegacyData: false,
    ...(goal === CALL_INTELLIGENCE_FOUNDATION_GOAL ? { foundationAssessment: assessment } : {}),
    ...(goal === OFFER_ACCEPTANCE_GOAL ? { acceptanceAssessment: assessment } : {}),
    ...([CALLBACK_OPPORTUNITY_GOAL, OBJECTION_HANDLING_GOAL, PROCEDURE_ADHERENCE_GOAL].includes(goal) ? { specialistAssessment: assessment } : {}),
    ...(goal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL ? { auditAssessment: assessment } : {})
  };
}

function foundation(callId, patch = {}) {
  const assessment = {
    schemaVersion: "call_intelligence_foundation.v3",
    contactResult: "live_decision_maker",
    decisionMakerStatus: "confirmed",
    conversationStage: "offer_presented",
    offerPresented: true,
    pricePresented: true,
    objectionPresent: false,
    customerOutcome: "callback_requested",
    nextStepStatus: "actionable",
    followUpTiming: "next Wednesday",
    leadRecordSignal: "none",
    calledOnBehalfOf: "ACT Emergency Service Volunteers",
    commercialContext: { product_or_package: "Supporter advertisement", quoted_amount_available: true, quoted_amount: 550, currency: "AUD" },
    intelligenceLenses: { opportunity_status: "actionable", measurement_eligibility: "eligible", efficiency_status: "efficient_progression" },
    specialistRoutes: { offer_acceptance_classification: true, callback_opportunity: true, objection_handling: false, procedure_adherence: false, lead_record_disposition_evidence_audit: false },
    evidence: [
      { supports: "offer_presented", speaker: "salesperson", quote: "The supporter advertisement is five hundred and fifty dollars." },
      { supports: "follow_up_timing", speaker: "customer", quote: "I get paid next Wednesday." }
    ],
    ...patch
  };
  return baseResult({ id: `foundation_${callId}`, callId, goal: CALL_INTELLIGENCE_FOUNDATION_GOAL, templateId: "template_call_intelligence_foundation_v6", assessment });
}

function studioWithResults(results) {
  const studio = createDefaultEvaluationStudio();
  return { ...studio, evaluationResults: results };
}

const calls = [
  { callId: "1", customerId: "C-1", salesperson: "Alex", source: "Google", date: "02/07/2026", sourceTime: "02/07/2026 10:00:00 AEST", businessSegment: "new", transcript: "Transcript one" },
  { callId: "2", customerId: "", salesperson: "Alex", source: "Facebook", date: "03/07/2026", sourceTime: "03/07/2026 11:00:00 AEST", businessSegment: "new", transcript: "Transcript two" },
  { callId: "3", customerId: "C-3", salesperson: "Bea", source: "Google", date: "03/07/2026", sourceTime: "03/07/2026 12:00:00 AEST", businessSegment: "warm", transcript: "Transcript three" }
];

test("quarantines unpromoted funnel, queues, commercial claims, and proof", () => {
  const accepted = baseResult({
    id: "offer_1",
    callId: "1",
    goal: OFFER_ACCEPTANCE_GOAL,
    templateId: "template_offer_acceptance_classification_v3",
    assessment: {
      schemaVersion: "offer_acceptance_classification.v1",
      category: 3,
      classification: "customer_accepted_offer",
      offerPresented: true,
      customerCommitment: "explicit_unconditional_agreement",
      unresolvedCondition: false,
      offerEvidence: { speaker: "salesperson", quote: "The supporter advertisement is five hundred and fifty dollars.", summary: "Offer" },
      customerResponseEvidence: { speaker: "customer", quote: "Yes, I will do that.", summary: "Acceptance" }
    }
  });
  const typedCallback = baseResult({
    id: "callback_2",
    callId: "2",
    goal: CALLBACK_OPPORTUNITY_GOAL,
    templateId: "template_callback_opportunity_v2",
    assessment: {
      schemaVersion: "callback_opportunity.v2",
      callbackState: "requested",
      nextActionChannel: "call",
      timingRaw: "Friday morning",
      customerIntent: "interest",
      objection: "",
      handoverSummary: "Call Friday morning.",
      evidence: [{ claim_type: "timing", speaker: "customer", quote: "Call me Friday morning." }]
    }
  });
  const centre = buildSalesOpportunityActionCentre({
    studio: studioWithResults([foundation("1"), foundation("2"), accepted, typedCallback]),
    importId,
    calls
  });

  assert.equal(centre.coverage.transcriptCalls, 3);
  assert.equal(centre.coverage.foundationEvaluated, 0);
  assert.equal(centre.coverage.readyForPerformanceComparison, false);
  assert.match(centre.coverage.warnings.join(" "), /capability quarantine is active/i);
  assert.equal(centre.funnel.length, 1);
  assert.equal(centre.funnel[0].key, "transcript_available");
  assert.deepEqual(centre.actionQueues, []);

  const acceptedRecord = centre.records.find((record) => record.callId === "1");
  assert.equal(acceptedRecord.acceptedOfferState, "not_established");
  assert.equal(acceptedRecord.paymentState, "not_verified");
  assert.equal(acceptedRecord.fulfilmentState, "unknown");
  assert.equal(acceptedRecord.recognisedRevenueState, "unknown");
  assert.equal(acceptedRecord.crmWonState, "unknown");
  assert.deepEqual(acceptedRecord.proof, []);
  assert.equal(centre.records.find((record) => record.callId === "2").customerId, "Not available");
});

test("ignores every unpromoted specialist and Foundation candidate", () => {
  const legacy = baseResult({
    id: "legacy_objection",
    callId: "1",
    goal: OBJECTION_HANDLING_GOAL,
    templateId: "template_objection_handling_v1",
    assessment: { schemaVersion: "objection_handling.v1", outcome: "handling_gap", evidence: [{ quote: "Legacy quote" }] },
    validationStatus: "legacy_generic_contract"
  });
  delete legacy.specialistAssessment;
  legacy.findings = [{ field: "outcome", value: "handling_gap", evidence: "Legacy quote" }];
  const centre = buildSalesOpportunityActionCentre({ studio: studioWithResults([foundation("1"), legacy]), importId, calls: [calls[0]] });
  const record = centre.records[0];

  assert.equal(record.queueKeys.includes("objection_or_procedure_gap"), false);
  assert.equal(record.queueKeys.includes("callback_clear_timing"), false);
  assert.equal(record.typedSpecialists.callbackOpportunity, false);
  assert.deepEqual(record.decisionAuthorities, []);
});

test("operational filters return no records while capabilities are quarantined", () => {
  const centre = buildSalesOpportunityActionCentre({ studio: studioWithResults([foundation("1"), foundation("2")]), importId, calls });
  const stage = filterSalesOpportunityRecords(centre, { stage: "confirmed_decision_maker", limit: 20 });
  const queue = filterSalesOpportunityRecords(centre, { queue: "callback_clear_timing", limit: 20 });
  assert.deepEqual(stage.records, []);
  assert.deepEqual(queue.records, []);
  assert.equal(stage.query.matchingRecords, 0);
  assert.equal(queue.query.matchingRecords, 0);
});

test("does not classify action queues from unpromoted outputs", () => {
  const queueCalls = ["10", "11", "12", "13", "14"].map((callId) => ({ ...calls[0], callId, customerId: `C-${callId}`, transcript: `Transcript ${callId}` }));
  const noTiming = foundation("10", { followUpTiming: "", nextStepStatus: "vague" });
  const infoFoundation = foundation("11", { customerOutcome: "information_requested" });
  const infoOffer = baseResult({
    id: "offer_11", callId: "11", goal: OFFER_ACCEPTANCE_GOAL, templateId: "template_offer_acceptance_classification_v3",
    assessment: {
      schemaVersion: "offer_acceptance_classification.v1", category: 2, classification: "interested_follow_up_only", offerPresented: true,
      customerCommitment: "conditional_or_pending", unresolvedCondition: true,
      offerEvidence: { speaker: "salesperson", quote: "The advertisement is five hundred dollars.", summary: "Offer" },
      customerResponseEvidence: { speaker: "customer", quote: "Send me the information to review.", summary: "Review requested" }
    }
  });
  const noOffer = foundation("12", {
    offerPresented: false,
    commercialContext: { product_or_package: "", quoted_amount_available: false, quoted_amount: 0, currency: "unknown" },
    specialistRoutes: { offer_acceptance_classification: false, callback_opportunity: false, objection_handling: false, procedure_adherence: false, lead_record_disposition_evidence_audit: false }
  });
  const procedureFoundation = foundation("13", {
    specialistRoutes: { offer_acceptance_classification: false, callback_opportunity: false, objection_handling: false, procedure_adherence: true, lead_record_disposition_evidence_audit: false }
  });
  const procedure = baseResult({
    id: "procedure_13", callId: "13", goal: PROCEDURE_ADHERENCE_GOAL, templateId: "template_procedure_adherence_v2",
    assessment: { schemaVersion: "procedure_adherence.v2", outcome: "issue_found", strongestIssueStage: "close", issueSummary: "No clear close.", evidence: [{ claim_type: "procedure_issue", speaker: "salesperson", quote: "Okay, thanks, bye." }] }
  });
  const auditFoundation = foundation("14", {
    specialistRoutes: { offer_acceptance_classification: false, callback_opportunity: false, objection_handling: false, procedure_adherence: false, lead_record_disposition_evidence_audit: true }
  });
  const centre = buildSalesOpportunityActionCentre({
    studio: studioWithResults([noTiming, infoFoundation, infoOffer, noOffer, procedureFoundation, procedure, auditFoundation]),
    importId,
    calls: queueCalls
  });
  assert.deepEqual(centre.actionQueues, []);
  centre.records.forEach((record) => {
    assert.deepEqual(record.queueKeys, []);
    assert.deepEqual(record.decisionAuthorities, []);
  });
});

test("management brief refuses to export model-derived actions while quarantined", () => {
  const centre = buildSalesOpportunityActionCentre({ studio: studioWithResults([foundation("1"), foundation("2")]), importId, calls });
  const report = buildSalesOpportunityManagementBrief(centre);
  assert.equal(report.id, "sales-opportunity-action-centre-current");
  assert.match(report.content, /Unavailable/);
  assert.match(report.content, /No local-model evaluator is promoted/);
  assert.match(report.content, /cannot create action queues/i);
  assert.doesNotMatch(report.content, /Customer ID: C-1/);
  assert.doesNotMatch(report.content, /best salesperson|best source/i);
});
