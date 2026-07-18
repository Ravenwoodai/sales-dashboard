"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBadLeadClaim } = require("../src/badLeadClaim");
const {
  attachFoundationContextToResults,
  buildCallIntelligenceFoundationReport,
  buildOfferAcceptanceReport,
  buildEvaluationStudioInput,
  buildEvaluationStudioReportRollups,
  buildManagerReviewPrefillCorrections,
  CALL_INTELLIGENCE_FOUNDATION_GOAL,
  CALL_INTELLIGENCE_FOUNDATION_SCHEMA_VERSION,
  createDefaultEvaluationStudio,
  evaluationResultFacets,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION,
  OFFER_ACCEPTANCE_GOAL,
  OFFER_ACCEPTANCE_SCHEMA_VERSION,
  listEvaluationResults,
  normalizeEvaluationResult,
  normalizeEvaluationStudio,
  quarantineEvaluationRun,
  resumeEvaluationRun,
  upsertEvaluationResult,
  validateCallIntelligenceFoundationResult,
  validateOfferAcceptanceResult,
  validateLeadRecordDispositionAuditResult
} = require("../src/evaluationStudio");
const {
  archiveEvaluationKnowledgebaseEntry,
  dashboardPersistence,
  readStore,
  saveEvaluationKnowledgebaseEntry,
  saveEvaluationResult,
  saveEvaluationRun,
  saveEvaluationTemplate,
  writeStore
} = require("../src/storage");

function validFoundationResult(overrides = {}) {
  return {
    schema_version: CALL_INTELLIGENCE_FOUNDATION_SCHEMA_VERSION,
    evaluation_goal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
    call_id: "call-foundation-1",
    status: "usable",
    confidence: 0.9,
    evidence_availability: "available",
    transcript_quality: "high",
    contact_result: "live_decision_maker",
    decision_maker_status: "confirmed",
    conversation_stage: "next_step_agreed",
    offer_presented: true,
    price_presented: true,
    objection_present: true,
    customer_outcome: "conditional_interest",
    next_step_status: "actionable",
    follow_up_timing: "tomorrow afternoon",
    lead_record_signal: "none",
    called_on_behalf_of: "SES Yearbook",
    commercial_context: {
      product_or_package: "Community Bronze",
      quoted_amount_available: true,
      quoted_amount: 550,
      currency: "AUD"
    },
    intelligence_lenses: {
      opportunity_status: "actionable",
      measurement_eligibility: "eligible",
      efficiency_status: "efficient_progression"
    },
    specialist_routes: {
      offer_acceptance_classification: false,
      callback_opportunity: false,
      objection_handling: false,
      procedure_adherence: false,
      lead_record_disposition_evidence_audit: false
    },
    evidence: [
      {
        supports: "called_on_behalf_of",
        speaker: "salesperson",
        quote: "I am calling on behalf of SES Yearbook."
      },
      {
        supports: "offer_presented",
        speaker: "salesperson",
        quote: "Our Community Bronze support is $550 for the year."
      },
      {
        supports: "next_step_status",
        speaker: "customer",
        quote: "I need to speak with my partner, so call me tomorrow afternoon."
      }
    ],
    manager_review_recommended: false,
    manager_summary: "A live decision-maker showed conditional interest and agreed to an actionable callback.",
    limitations: [],
    findings: [],
    ...overrides
  };
}

function tempStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-evaluation-studio-")), "state.json");
}

function claimUuidFactory(start = 1) {
  let value = start;
  return () => `10000000-0000-4000-8000-${(value++).toString(16).padStart(12, "0")}`;
}

function validDispositionAuditResult(overrides = {}) {
  return {
    schema_version: LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION,
    evaluation_goal: LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
    call_id: "call-audit-1",
    status: "usable",
    confidence: 0.84,
    evidence_availability: "available",
    transcript_quality: "high",
    record_evidence: {
      classification: "supported_invalidity",
      reason: "wrong_number",
      rationale: "The recipient explicitly stated that the number was wrong."
    },
    allegation_assessment: {
      availability: "present",
      claim_id: "10000000-0000-4000-8000-000000000001",
      claimed_reason: "wrong_number",
      assessment: "supported",
      rationale: "The allegation matches the recipient's direct statement."
    },
    evidence: [
      {
        speaker: "customer",
        quote: "You have the wrong number.",
        relevance: "supports"
      }
    ],
    recommendation: "correct_or_remove_record",
    manager_review_recommended: true,
    manager_summary: "Direct call evidence supports a wrong-number allegation; manager review is recommended.",
    limitations: ["This recommendation does not alter the lead record or claim status."],
    findings: [],
    model_metadata: { provider_model: "local-test-model" },
    ...overrides
  };
}

function auditValidationContext(overrides = {}) {
  return {
    call: {
      callId: "call-audit-1",
      contactClassification: "wrong_number",
      localOutcome: "wrong_number",
      transcriptQuality: "high",
      transcript: "Customer: You have the wrong number.",
      ...overrides
    }
  };
}

function absentAllegationResult({ quote, summary, confidence = 0.84, ...overrides } = {}) {
  return validDispositionAuditResult({
    confidence,
    record_evidence: {
      classification: "no_supporting_evidence",
      reason: "none",
      rationale: summary || "The transcript is usable but does not support lead-record invalidity."
    },
    allegation_assessment: {
      availability: "none",
      claim_id: null,
      claimed_reason: null,
      assessment: "absent",
      rationale: "No trusted salesperson allegation was supplied."
    },
    evidence: quote ? [{ speaker: "customer", quote, relevance: "context" }] : [],
    recommendation: "continue_normal_workflow",
    manager_review_recommended: false,
    manager_summary: summary || "Usable contact evidence does not support record invalidity.",
    ...overrides
  });
}

function validOfferAcceptanceResult(overrides = {}) {
  return {
    schema_version: OFFER_ACCEPTANCE_SCHEMA_VERSION,
    evaluation_goal: OFFER_ACCEPTANCE_GOAL,
    call_id: "call-offer-1",
    status: "usable",
    confidence: 0.9,
    evidence_availability: "available",
    transcript_quality: "high",
    category: 3,
    classification: "customer_accepted_offer",
    offer_presented: true,
    customer_commitment: "explicit_unconditional_agreement",
    unresolved_condition: false,
    offer_evidence: {
      speaker: "salesperson",
      quote: "We are booking the spot now at $440 and payment can wait until October.",
      summary: "The salesperson presented a specific $440 booking with deferred payment."
    },
    customer_response_evidence: {
      speaker: "customer",
      quote: "Send the invoice and we'll get that sorted.",
      summary: "The customer committed to the booking and requested the invoice."
    },
    manager_review_recommended: false,
    manager_summary: "The customer explicitly accepted the presented $440 booking.",
    limitations: ["This does not prove payment, fulfilment, recognized revenue, or a closed CRM opportunity."],
    findings: [],
    ...overrides
  };
}

function offerAcceptanceContext(transcript) {
  return {
    call: {
      callId: "call-offer-1",
      transcriptQuality: "high",
      transcript
    }
  };
}

test("Evaluation Studio result facets support browse filters without changing stored results", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const invalid = normalizeEvaluationResult({
    importId: "import-local-results",
    runId: "run-local-results",
    templateId: template.id,
    result: validDispositionAuditResult()
  }, { template });
  const normal = normalizeEvaluationResult({
    importId: "import-local-results",
    runId: "run-local-results",
    templateId: template.id,
    result: absentAllegationResult({
      quote: "We are not interested.",
      summary: "A clear human rejection does not support record invalidity.",
      call_id: "call-normal-rejection"
    })
  }, { template });
  const studio = normalizeEvaluationStudio({ evaluationResults: [invalid, normal] });

  assert.deepEqual(evaluationResultFacets(invalid), {
    recordClassification: "supported_invalidity",
    recordReason: "wrong_number",
    operationalClassification: "none",
    recommendation: "correct_or_remove_record",
    allegationAssessment: "supported"
  });
  assert.equal(listEvaluationResults(studio, { recordClassification: "supported_invalidity" }).length, 1);
  assert.equal(listEvaluationResults(studio, { recordReason: "wrong_number" })[0].callId, "call-audit-1");
  assert.equal(listEvaluationResults(studio, { allegationAssessment: "absent" })[0].callId, "call-normal-rejection");
  assert.equal(listEvaluationResults(studio, { recommendation: "continue_normal_workflow" }).length, 1);
  assert.equal(studio.evaluationResults.length, 2);
});

test("Evaluation Studio seeds Neuron knowledgebase and LatentPulse governance templates", () => {
  const studio = createDefaultEvaluationStudio();
  const kbSources = new Set(studio.knowledgebaseEntries.map((entry) => entry.sourceProject));
  const templateGoals = new Set(studio.evaluationTemplates.map((template) => template.evaluationGoal));

  assert.equal(kbSources.has("Neuron-Compute-Training"), true);
  assert.equal(kbSources.has("LatentPulse"), true);
  assert.equal(studio.knowledgebaseEntries.every((entry) => entry.approvalStatus === "pending_manager_approval"), true);
  assert.equal(templateGoals.has("procedure_adherence"), true);
  assert.equal(templateGoals.has("objection_handling"), true);
  assert.equal(templateGoals.has("callback_opportunity"), true);
  assert.equal(templateGoals.has(OFFER_ACCEPTANCE_GOAL), true);
  assert.equal(templateGoals.has(LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL), true);
  assert.equal(templateGoals.has("lead_validity_utilisation"), false);
});

test("Offer Acceptance template preserves the manager-calibrated three-category boundary", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);

  assert.ok(template);
  assert.equal(template.id, "template_offer_acceptance_classification_v2");
  assert.equal(template.version, 2);
  assert.equal(template.outputSchema.schema_version, OFFER_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(template.outputSchema.category, "integer");
  assert.match(template.instructions, /send the invoice and we'll get that sorted/i);
  assert.match(template.instructions, /subject to partner, owner, manager, finance-team/i);
  assert.match(template.instructions, /not proof that payment cleared/i);
});

test("Call Intelligence Foundation is seeded as a neutral three-lens evaluator with represented organisation capture", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);

  assert.ok(template);
  assert.equal(template.id, "template_call_intelligence_foundation_v6");
  assert.equal(template.version, 6);
  assert.equal(template.outputSchema.schema_version, CALL_INTELLIGENCE_FOUNDATION_SCHEMA_VERSION);
  assert.match(template.instructions, /do not produce an overall call score/i);
  assert.match(template.instructions, /opportunity status, measurement eligibility, and efficiency status/i);
  assert.match(template.instructions, /specialist Offer Acceptance evaluator/i);
  assert.match(template.instructions, /No product pitched/i);
  assert.match(template.instructions, /including no-contact and terminal calls/i);
  assert.match(template.instructions, /independent of the customer's response/i);
  assert.match(template.instructions, /final agreed state/i);
  assert.match(template.instructions, /in about a year, 12 months, next year/i);
  assert.match(template.instructions, /Local paramedics \/ Ambulance Active Journal/i);
  assert.ok(template.outputSchema.called_on_behalf_of);
});

test("Call Intelligence Foundation v6 archives older templates without changing their stored contracts", () => {
  const studio = normalizeEvaluationStudio({
    knowledgebaseEntries: [],
    evaluationRuns: [],
    evaluationResults: [],
    evaluationTemplates: [{
      id: "template_call_intelligence_foundation_v1",
      name: "Call Intelligence Foundation",
      evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
      version: 1,
      instructions: "Retired optional-number contract.",
      outputSchema: { schema_version: "call_intelligence_foundation.v1", commercial_context: { quoted_amount: "number|null" } },
      isActive: true
    }, {
      id: "template_call_intelligence_foundation_v2",
      name: "Call Intelligence Foundation",
      evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
      version: 2,
      instructions: "Previous Foundation contract without represented organisation capture.",
      outputSchema: { schema_version: "call_intelligence_foundation.v1", commercial_context: { quoted_amount_available: "boolean", quoted_amount: "number" } },
      isActive: true
    }, {
      id: "template_call_intelligence_foundation_v3",
      name: "Call Intelligence Foundation",
      evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
      version: 3,
      instructions: "Previous represented-organisation contract before terminal evidence strengthening.",
      outputSchema: { schema_version: "call_intelligence_foundation.v2", called_on_behalf_of: "string" },
      isActive: true
    }, {
      id: "template_call_intelligence_foundation_v4",
      name: "Call Intelligence Foundation",
      evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
      version: 4,
      instructions: "Previous represented-organisation prompt before the explicit independent-field example.",
      outputSchema: { schema_version: "call_intelligence_foundation.v2", called_on_behalf_of: "string" },
      isActive: true
    }, {
      id: "template_call_intelligence_foundation_v5",
      name: "Call Intelligence Foundation",
      evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
      version: 5,
      instructions: "Previous Foundation contract before final-outcome reconciliation.",
      outputSchema: { schema_version: "call_intelligence_foundation.v2", called_on_behalf_of: "string" },
      isActive: true
    }]
  });
  const historical = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v1");
  const previous = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v2");
  const previousEvidencePrompt = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v3");
  const previousIndependentPrompt = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v4");
  const previousFinalOutcomePrompt = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v5");
  const active = studio.evaluationTemplates.find((item) => item.id === "template_call_intelligence_foundation_v6");
  assert.equal(historical.isActive, false);
  assert.equal(previous.isActive, false);
  assert.equal(previousEvidencePrompt.isActive, false);
  assert.equal(previousIndependentPrompt.isActive, false);
  assert.equal(previousFinalOutcomePrompt.isActive, false);
  assert.equal(active.isActive, true);
  assert.equal(active.outputSchema.commercial_context.quoted_amount_available, "boolean");
  assert.equal(active.outputSchema.commercial_context.quoted_amount, "number");
  assert.equal(active.outputSchema.schema_version, "call_intelligence_foundation.v3");
  assert.ok(active.outputSchema.called_on_behalf_of);
});

test("Call Intelligence Foundation validates transcript proof and derives specialist routes locally", () => {
  const transcript = "Salesperson: I am calling on behalf of SES Yearbook. Our Community Bronze support is $550 for the year. Customer: I need to speak with my partner, so call me tomorrow afternoon.";
  const context = { call: { transcript, transcriptQuality: "high", contactClassification: "customer" } };
  const validated = validateCallIntelligenceFoundationResult({
    result: {
      ...validFoundationResult(),
      specialist_routes: {
        offer_acceptance_classification: true,
        callback_opportunity: true,
        objection_handling: true,
        procedure_adherence: true,
        lead_record_disposition_evidence_audit: false
      }
    },
    validationContext: context
  });
  assert.equal(validated.contact_result, "live_decision_maker");

  const template = createDefaultEvaluationStudio().evaluationTemplates.find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult(),
    validationContext: context
  }).result;
  assert.equal(saved.foundationAssessment.intelligenceLenses.opportunity_status, "actionable");
  assert.equal(saved.foundationAssessment.calledOnBehalfOf, "SES Yearbook");
  assert.equal(saved.foundationAssessment.specialistRoutes.offer_acceptance_classification, true);
  assert.equal(saved.foundationAssessment.specialistRoutes.callback_opportunity, true);
  assert.equal(saved.foundationAssessment.specialistRoutes.objection_handling, true);
  assert.equal(saved.foundationAssessment.specialistRoutes.procedure_adherence, true);
  assert.equal(saved.foundationAssessment.specialistRoutes.lead_record_disposition_evidence_audit, false);
  assert.equal(saved.foundationAssessment.routingAdjustments.length, 4);
  assert.equal(saved.findings.some((finding) => finding.field === "opportunity_status" && finding.value === "actionable"), true);
  const timingFinding = saved.findings.find((finding) => finding.field === "follow_up_timing");
  assert.equal(timingFinding.value, "tomorrow afternoon");
  assert.match(timingFinding.evidence, /call me tomorrow afternoon/i);
  const normalizedOlderResult = normalizeEvaluationResult({
    ...saved,
    findings: saved.findings.filter((finding) => finding.field !== "follow_up_timing")
  });
  assert.equal(normalizedOlderResult.findings.some((finding) => finding.field === "follow_up_timing" && finding.value === "tomorrow afternoon"), true);

  assert.throws(() => validateCallIntelligenceFoundationResult({
    result: validFoundationResult({ follow_up_timing: "in two days" }),
    validationContext: context
  }), /exact timing phrase/);

  assert.throws(() => validateCallIntelligenceFoundationResult({
    result: validFoundationResult({
      evidence: [{ supports: "offer_presented", speaker: "salesperson", quote: "A fabricated offer quote." }]
    }),
    validationContext: context
  }), /quote was not found in the supplied transcript/);

  assert.throws(() => validateCallIntelligenceFoundationResult({
    result: validFoundationResult({
      evidence: validFoundationResult().evidence.filter((item) => item.supports !== "called_on_behalf_of")
    }),
    validationContext: context
  }), /requires an exact supporting transcript excerpt/);

  assert.throws(() => validateCallIntelligenceFoundationResult({
    result: validFoundationResult({
      evidence: validFoundationResult().evidence.map((item) => item.supports === "called_on_behalf_of"
        ? { ...item, quote: "I need to speak with my partner, so call me tomorrow afternoon." }
        : item)
    }),
    validationContext: context
  }), /must identify the represented organisation or publication/);

  const noPitch = validateCallIntelligenceFoundationResult({
    result: validFoundationResult({
      called_on_behalf_of: "No product pitched",
      offer_presented: false,
      price_presented: false,
      evidence: validFoundationResult().evidence.filter((item) => !["called_on_behalf_of", "offer_presented"].includes(item.supports))
    }),
    validationContext: context
  });
  assert.equal(noPitch.called_on_behalf_of, "No product pitched");

  const repaired = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      evidence: validFoundationResult().evidence.filter((item) => item.supports !== "called_on_behalf_of")
    }),
    validationContext: context
  }).result;
  assert.equal(repaired.foundationAssessment.evidence.some((item) => item.supports === "called_on_behalf_of" && /SES Yearbook/.test(item.quote)), true);

  assert.throws(() => validateCallIntelligenceFoundationResult({
    result: validFoundationResult({
      called_on_behalf_of: "No product pitched",
      evidence: validFoundationResult().evidence.filter((item) => item.supports !== "called_on_behalf_of")
    }),
    validationContext: context
  }), /offer_presented cannot be true/);
});

test("Foundation conservatively caps confidence that exceeds the evidence-availability contract", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const result = validFoundationResult({
    status: "insufficient_evidence",
    confidence: 0.5,
    evidence_availability: "unavailable",
    transcript_quality: "medium",
    contact_result: "unknown",
    decision_maker_status: "unknown",
    conversation_stage: "no_contact",
    offer_presented: false,
    price_presented: false,
    objection_present: false,
    customer_outcome: "unknown",
    next_step_status: "none",
    follow_up_timing: "",
    lead_record_signal: "unknown",
    called_on_behalf_of: "No product pitched",
    commercial_context: {
      product_or_package: "",
      quoted_amount_available: false,
      quoted_amount: 0,
      currency: "unknown"
    },
    intelligence_lenses: {
      opportunity_status: "none",
      measurement_eligibility: "insufficient_evidence",
      efficiency_status: "unable_to_assess"
    },
    evidence: [],
    manager_summary: "The transcript is too limited to support a reliable classification."
  });

  assert.throws(() => validateCallIntelligenceFoundationResult({ result }), /confidence of 0\.35 or lower/);

  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result,
    validationContext: { call: { transcript: "Customer: Hello?", transcriptQuality: "medium" } }
  }).result;

  assert.equal(saved.confidence, 0.35);
  assert.equal(saved.foundationAssessment.routingAdjustments.some((item) =>
    item.field === "confidence" && item.from === 0.5 && item.to === 0.35
  ), true);
});

test("Foundation reconciles model terminal mistakes against trusted live-contact metadata", () => {
  const transcript = "Salesperson: I am calling on behalf of SES Yearbook. Customer: Yes, I am the owner. Salesperson: We provide a community support listing.";
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      contact_result: "voicemail",
      price_presented: false,
      objection_present: false,
      customer_outcome: "information_requested",
      follow_up_timing: "",
      commercial_context: {
        product_or_package: "community support listing",
        quoted_amount_available: false,
        quoted_amount: 0,
        currency: "unknown"
      },
      evidence: [
        { supports: "called_on_behalf_of", speaker: "salesperson", quote: "I am calling on behalf of SES Yearbook." },
        { supports: "contact_result", speaker: "customer", quote: "Yes, I am the owner." }
      ]
    }),
    validationContext: { call: { transcript, transcriptQuality: "high", contactClassification: "customer" } }
  }).result;

  assert.equal(saved.foundationAssessment.contactResult, "live_decision_maker");
  assert.equal(saved.foundationAssessment.intelligenceLenses.measurement_eligibility, "eligible");
  assert.equal(saved.foundationAssessment.specialistRoutes.procedure_adherence, true);
});

test("Foundation preserves true no-contact calls and suppresses sales-specialist routing", () => {
  const transcript = "Voicemail: Please leave a message after the tone.";
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      contact_result: "live_decision_maker",
      decision_maker_status: "unknown",
      conversation_stage: "introduction",
      follow_up_timing: "tomorrow afternoon",
      called_on_behalf_of: "No product pitched",
      evidence: [{ supports: "contact_result", speaker: "system", quote: "Please leave a message after the tone." }]
    }),
    validationContext: { call: { transcript, transcriptQuality: "high", contactClassification: "voicemail", localOutcome: "no_contact" } }
  }).result;

  assert.equal(saved.foundationAssessment.contactResult, "voicemail");
  assert.equal(saved.foundationAssessment.customerOutcome, "no_contact");
  assert.equal(saved.foundationAssessment.followUpTiming, "");
  assert.equal(saved.foundationAssessment.intelligenceLenses.measurement_eligibility, "excluded_terminal");
  assert.equal(saved.foundationAssessment.intelligenceLenses.efficiency_status, "terminal_complete");
  assert.equal(saved.foundationAssessment.specialistRoutes.offer_acceptance_classification, false);
  assert.equal(saved.foundationAssessment.specialistRoutes.callback_opportunity, false);
  assert.equal(saved.foundationAssessment.specialistRoutes.procedure_adherence, false);
});

test("Foundation keeps only exact transcript evidence and repairs fuzzy timing conservatively", () => {
  const transcript = "Salesperson: I am calling on behalf of SES Yearbook. Customer: Please call tomorrow at 10 o'clock when the owner is here.";
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      price_presented: false,
      objection_present: false,
      follow_up_timing: "tomorrow 10am",
      commercial_context: {
        product_or_package: "Yearbook listing",
        quoted_amount_available: false,
        quoted_amount: 0,
        currency: "unknown"
      },
      evidence: [
        { supports: "called_on_behalf_of", speaker: "salesperson", quote: "I am calling on behalf of SES Yearbook." },
        { supports: "customer_outcome", speaker: "customer", quote: "The customer requested a callback at ten tomorrow morning." }
      ]
    }),
    validationContext: { call: { transcript, transcriptQuality: "high", contactClassification: "customer" } }
  }).result;

  assert.match(saved.foundationAssessment.followUpTiming, /tomorrow at 10 o'clock/i);
  assert.equal(saved.foundationAssessment.evidence.every((item) => transcript.toLowerCase().includes(item.quote.toLowerCase())), true);
});

test("Foundation clears unsupported commercial signals when no product was identified", () => {
  const transcript = "Salesperson: Hello, is Jordan available? Customer: No, this is a job applicant calling back.";
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      called_on_behalf_of: "No product pitched",
      follow_up_timing: "",
      evidence: [{ supports: "contact_result", speaker: "customer", quote: "this is a job applicant calling back" }]
    }),
    validationContext: { call: { transcript, transcriptQuality: "high", contactClassification: "customer" } }
  }).result;

  assert.equal(saved.foundationAssessment.offerPresented, false);
  assert.equal(saved.foundationAssessment.pricePresented, false);
  assert.equal(saved.foundationAssessment.commercialContext.quoted_amount_available, false);
  assert.equal(saved.foundationAssessment.intelligenceLenses.opportunity_status, "none");
  assert.equal(Object.values(saved.foundationAssessment.specialistRoutes).some(Boolean), false);
});

test("Foundation repairs the final one-year nurture outcome and explicit represented party for call 48562953", () => {
  const transcript = [
    "David Simpson (CWA): I've just been asked to give you a call on behalf of the local paramedics, that's all. Later this year, I'm in charge of putting together our official Ambulance Active Journal through the local area.",
    "David Simpson (CWA): We are asking local businesses to support your AMBOs by running a support ad in that journal.",
    "Customer: I have to sort this out. Give me a ring back. I said I'm all for it. I'm just quite busy at the moment, so I'll have to give you a ring back or something sometime soon.",
    "Customer: I am possibly selling the store. It just hasn't been great.",
    "David Simpson (CWA): What we might do is contact you a little bit later on, maybe in a year's time, and see if it's still going. How's that sound?",
    "Customer: Yes, sounds good. Thank you very much."
  ].join(" ");
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validFoundationResult({
      call_id: "48562953",
      price_presented: false,
      customer_outcome: "callback_requested",
      follow_up_timing: "sometime soon",
      called_on_behalf_of: "No product pitched",
      commercial_context: {
        product_or_package: "support ad",
        quoted_amount_available: false,
        quoted_amount: 0,
        currency: "unknown"
      },
      intelligence_lenses: {
        opportunity_status: "actionable",
        measurement_eligibility: "eligible",
        efficiency_status: "efficient_progression"
      },
      evidence: [
        {
          supports: "offer_presented",
          speaker: "salesperson",
          quote: "We are asking local businesses to support your AMBOs by running a support ad in that journal."
        },
        {
          supports: "customer_outcome",
          speaker: "customer",
          quote: "I have to sort this out. Give me a ring back. I said I'm all for it."
        }
      ]
    }),
    validationContext: {
      call: {
        callId: "48562953",
        transcript,
        transcriptQuality: "high",
        contactClassification: "customer",
        localOutcome: "callback_requested"
      }
    }
  }).result;

  assert.equal(saved.foundationAssessment.customerOutcome, "long_term_nurture");
  assert.equal(saved.foundationAssessment.followUpTiming, "in a year's time");
  assert.equal(saved.foundationAssessment.calledOnBehalfOf, "Local paramedics / Ambulance Active Journal");
  assert.equal(saved.foundationAssessment.intelligenceLenses.opportunity_status, "possible");
  assert.equal(saved.foundationAssessment.specialistRoutes.callback_opportunity, false);
  assert.equal(saved.foundationAssessment.specialistRoutes.offer_acceptance_classification, true);
  assert.match(saved.foundationAssessment.evidence.find((item) => item.supports === "called_on_behalf_of").quote, /local paramedics/i);
});

test("specialist result rows inherit represented party and timing from the call's latest Foundation result", () => {
  const foundation = normalizeEvaluationResult({
    id: "foundation-result",
    callId: "48562953",
    evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
    foundationAssessment: {
      calledOnBehalfOf: "Local paramedics / Ambulance Active Journal",
      followUpTiming: "in a year's time",
      customerOutcome: "long_term_nurture"
    },
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  });
  const specialist = normalizeEvaluationResult({
    id: "specialist-result",
    callId: "48562953",
    evaluationGoal: "lead_validity_utilisation",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  });
  const studio = normalizeEvaluationStudio({ evaluationResults: [specialist, foundation] });
  const enriched = attachFoundationContextToResults(studio, [specialist]);

  assert.equal(enriched[0].foundationContext.calledOnBehalfOf, "Local paramedics / Ambulance Active Journal");
  assert.equal(enriched[0].foundationContext.followUpTiming, "in a year's time");
  assert.equal(enriched[0].foundationContext.sourceResultId, "foundation-result");
});

test("every result row inherits the call's authoritative Offer Acceptance outcome", () => {
  const foundation = normalizeEvaluationResult({
    id: "foundation-with-accepted-offer",
    callId: "accepted-call",
    evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
    foundationAssessment: {
      intelligenceLenses: { opportunity_status: "actionable" },
      specialistRoutes: { offer_acceptance_classification: true }
    },
    managerSummary: "Foundation found an actionable next step.",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  });
  const accepted = normalizeEvaluationResult({
    id: "authoritative-accepted-offer",
    callId: "accepted-call",
    evaluationGoal: OFFER_ACCEPTANCE_GOAL,
    acceptanceAssessment: {
      category: 3,
      classification: "customer_accepted_offer",
      offerPresented: true,
      customerCommitment: "explicit_unconditional_agreement",
      unresolvedCondition: false
    },
    managerSummary: "The customer accepted the offer and agreed to pay next Wednesday.",
    confidence: 0.95,
    status: "usable",
    evidenceAvailability: "available",
    createdAt: "2026-07-17T00:01:00.000Z",
    updatedAt: "2026-07-17T00:01:00.000Z"
  });
  const studio = normalizeEvaluationStudio({ evaluationResults: [foundation, accepted] });
  const enriched = attachFoundationContextToResults(studio, [foundation]);

  assert.equal(enriched[0].offerAcceptanceContext.sourceResultId, "authoritative-accepted-offer");
  assert.equal(enriched[0].offerAcceptanceContext.acceptanceAssessment.classification, "customer_accepted_offer");
  assert.equal(enriched[0].offerAcceptanceContext.confidence, 0.95);
});

test("specialist rows use a narrow exact-transcript Foundation fallback when no Foundation result exists", () => {
  const specialist = normalizeEvaluationResult({
    id: "legacy-specialist-result",
    callId: "48562953",
    evaluationGoal: "lead_validity_utilisation",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  });
  const transcript = [
    "David Simpson (CWA): I've just been asked to give you a call on behalf of the local paramedics, that's all. Later this year, I'm putting together our official Ambulance Active Journal.",
    "Customer: Give me a ring back sometime soon.",
    "David Simpson (CWA): What we might do is contact you maybe in a year's time and see if it's still going."
  ].join(" ");
  const enriched = attachFoundationContextToResults(
    normalizeEvaluationStudio({ evaluationResults: [specialist] }),
    [specialist],
    [{ callId: "48562953", transcript, localOutcome: "long_term_deferral" }]
  );

  assert.equal(enriched[0].foundationContext.calledOnBehalfOf, "Local paramedics / Ambulance Active Journal");
  assert.equal(enriched[0].foundationContext.followUpTiming, "in a year's time");
  assert.equal(enriched[0].foundationContext.customerOutcome, "long_term_nurture");
  assert.equal(enriched[0].foundationContext.contextProvenance, "deterministic_transcript_fallback");
});

test("Call Intelligence Foundation report keeps opportunity, measurement, efficiency, and quoted context separate", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates.find((item) => item.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL);
  const transcript = "Salesperson: I am calling on behalf of SES Yearbook. Our Community Bronze support is $550 for the year. Customer: I need to speak with my partner, so call me tomorrow afternoon.";
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    importId: "foundation-import",
    result: validFoundationResult(),
    validationContext: { call: { transcript, transcriptQuality: "high", contactClassification: "customer" } }
  }).studio;
  const report = buildCallIntelligenceFoundationReport(saved, {
    importId: "foundation-import",
    calls: [{ callId: "call-foundation-1", salesperson: "Alex", source: "GoogleMaps", date: "2026-07-16" }]
  });

  assert.equal(report.totals.evaluated, 1);
  assert.equal(report.totals.measurementEligible, 1);
  assert.equal(report.totals.actionableOpportunities, 1);
  assert.equal(report.totals.efficiencyGaps, 0);
  assert.equal(report.totals.quotedAmounts.AUD, 550);
  assert.equal(report.totals.noProductPitched, 0);
  assert.equal(report.byCalledOnBehalfOf[0].label, "SES Yearbook");
  assert.equal(report.bySalesperson[0].label, "Alex");
  assert.equal(report.bySource[0].opportunityRate, 1);
  assert.match(report.definition, /Specialist evaluators remain authoritative/i);
  assert.equal(listEvaluationResults(saved, { foundationOpportunityStatus: "actionable_or_accepted" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationMeasurementEligibility: "eligible" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationEfficiencyStatus: "efficient_progression" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationCalledOnBehalfOf: "SES Yearbook" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationFollowUpTiming: "tomorrow afternoon" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationFollowUpTiming: "next week" }).length, 0);
  assert.equal(listEvaluationResults(saved, { foundationOfferPresented: "true" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationQuotedAmountAvailable: "true" }).length, 1);
  assert.equal(listEvaluationResults(saved, { foundationEfficiencyStatus: "actionable_gap" }).length, 0);
});

test("Offer Acceptance validation accepts explicit commitment and keeps conditional approval at category 2", () => {
  const acceptedTranscript = "Salesperson: We are booking the spot now at $440 and payment can wait until October. Customer: Send the invoice and we'll get that sorted.";
  const accepted = validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult(),
    validationContext: offerAcceptanceContext(acceptedTranscript)
  });
  assert.equal(accepted.category, 3);
  assert.equal(accepted.classification, "customer_accepted_offer");

  const conditionalTranscript = "Salesperson: Can we allocate you a spot so we know you're on board? Customer: Just put us in it, but it needs finance-team approval first.";
  const conditional = validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult({
      category: 2,
      classification: "interested_follow_up_only",
      customer_commitment: "conditional_or_pending",
      unresolved_condition: true,
      offer_evidence: {
        speaker: "salesperson",
        quote: "Can we allocate you a spot so we know you're on board?",
        summary: "The salesperson asked to allocate a support spot."
      },
      customer_response_evidence: {
        speaker: "customer",
        quote: "Just put us in it, but it needs finance-team approval first.",
        summary: "The customer remained subject to finance-team approval."
      },
      manager_summary: "The response was positive but conditional on finance approval."
    }),
    validationContext: offerAcceptanceContext(conditionalTranscript)
  });
  assert.equal(conditional.category, 2);
  assert.equal(conditional.unresolved_condition, true);
});

test("Offer Acceptance storage reconciles category 2 as unresolved without weakening direct validation", () => {
  const transcript = "Salesperson: I can email the $550 offer. Customer: Send it through and I will think about it.";
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);
  const output = validOfferAcceptanceResult({
    category: 2,
    classification: "interested_follow_up_only",
    customer_commitment: "interest_only",
    unresolved_condition: false,
    offer_evidence: {
      speaker: "salesperson",
      quote: "I can email the $550 offer.",
      summary: "The salesperson offered to email the $550 offer."
    },
    customer_response_evidence: {
      speaker: "customer",
      quote: "Send it through and I will think about it.",
      summary: "The customer agreed only to review the material."
    },
    manager_summary: "The customer showed interest with no unresolved condition."
  });

  assert.throws(() => validateOfferAcceptanceResult({
    result: output,
    validationContext: offerAcceptanceContext(transcript)
  }), /category 2 requires an unresolved condition/i);

  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: output,
    validationContext: offerAcceptanceContext(transcript)
  }).result;
  assert.equal(saved.acceptanceAssessment.unresolvedCondition, true);
  assert.match(saved.managerSummary, /acceptance remained unresolved/i);
  assert.equal(saved.acceptanceAssessment.semanticAdjustments.some((item) => item.field === "unresolved_condition"), true);
});

test("Offer Acceptance conservatively downgrades a proofless no-sale result without weakening category 3", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates
    .find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);
  const result = validOfferAcceptanceResult({
    status: "usable",
    confidence: 0.95,
    evidence_availability: "unavailable",
    category: 1,
    classification: "no_sale_signal",
    offer_presented: false,
    customer_commitment: "none",
    unresolved_condition: false,
    offer_evidence: {
      speaker: "unknown",
      quote: "",
      summary: "No offer was presented in the transcript."
    },
    customer_response_evidence: {
      speaker: "unknown",
      quote: "",
      summary: "No customer response to an offer was observed."
    }
  });

  assert.throws(() => validateOfferAcceptanceResult({ result }), /usable status cannot have unavailable evidence/);

  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result,
    validationContext: { call: { transcript: "Customer: Hello?", transcriptQuality: "high" } }
  }).result;

  assert.equal(saved.status, "insufficient_evidence");
  assert.equal(saved.confidence, 0.35);
  assert.equal(saved.acceptanceAssessment.classification, "no_sale_signal");
  assert.equal(saved.acceptanceAssessment.semanticAdjustments.some((item) =>
    item.field === "status" && item.from === "usable" && item.to === "insufficient_evidence"
  ), true);

  assert.throws(() => validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult({ evidence_availability: "unavailable" })
  }), /category 3 must be usable and have available evidence|usable status cannot have unavailable evidence/);
});

test("Offer Acceptance validation accepts a completed acceptance action and rejects unsafe category 3 outputs", () => {
  const actionTranscript = "Salesperson: Reply to the text with the word agree; that is all I need for now. Customer: I am responding now.";
  const completedAction = validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult({
      customer_commitment: "acceptance_action_completed",
      offer_evidence: {
        speaker: "salesperson",
        quote: "Reply to the text with the word agree; that is all I need for now.",
        summary: "The salesperson stated the required acceptance action."
      },
      customer_response_evidence: {
        speaker: "customer",
        quote: "I am responding now.",
        summary: "The customer completed the stated acceptance action during the call."
      },
      manager_summary: "The customer completed the stated acceptance action during the call."
    }),
    validationContext: offerAcceptanceContext(actionTranscript)
  });
  assert.equal(completedAction.category, 3);

  assert.throws(() => validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult({ unresolved_condition: true }),
    validationContext: offerAcceptanceContext("Salesperson: We are booking the spot now at $440 and payment can wait until October. Customer: Send the invoice and we'll get that sorted.")
  }), /category 3 cannot have an unresolved condition/);

  assert.throws(() => validateOfferAcceptanceResult({
    result: validOfferAcceptanceResult(),
    validationContext: offerAcceptanceContext("Salesperson: Different offer. Customer: Different response.")
  }), /offer_evidence\.quote was not found/);
});

test("Offer Acceptance ingestion shortens only transcript-verified evidence excerpts", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates.find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);
  const longOffer = Array.from({ length: 24 }, (_, index) => `Package detail ${index + 1} costs $550 and remains payable before September.`).join(" ");
  const response = "I am interested, but I need to speak with my wife before deciding.";
  const transcript = `Salesperson: ${longOffer} Customer: ${response}`;
  const savedLong = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validOfferAcceptanceResult({
      call_id: "call-offer-long",
      category: 2,
      classification: "interested_follow_up_only",
      customer_commitment: "conditional_or_pending",
      unresolved_condition: true,
      offer_evidence: {
        speaker: "salesperson",
        quote: longOffer,
        summary: "The salesperson presented a $550 package."
      },
      customer_response_evidence: {
        speaker: "customer",
        quote: response,
        summary: "The customer remained subject to speaking with their wife."
      }
    }),
    validationContext: offerAcceptanceContext(transcript)
  }).result;

  assert.equal(savedLong.acceptanceAssessment.offerEvidence.quote.length <= 500, true);
  assert.equal(savedLong.acceptanceAssessment.semanticAdjustments.length, 1);
  assert.equal(transcript.includes(savedLong.acceptanceAssessment.offerEvidence.quote), true);

  const joinedQuote = "The package costs $550. ... Payment can wait until September.";
  const joinedTranscript = `Salesperson: The package costs $550. There are several inclusions. Payment can wait until September. Customer: ${response}`;
  const savedJoined = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validOfferAcceptanceResult({
      call_id: "call-offer-joined",
      category: 2,
      classification: "interested_follow_up_only",
      customer_commitment: "conditional_or_pending",
      unresolved_condition: true,
      offer_evidence: {
        speaker: "salesperson",
        quote: joinedQuote,
        summary: "The salesperson presented a $550 package with deferred payment."
      },
      customer_response_evidence: {
        speaker: "customer",
        quote: response,
        summary: "The customer remained subject to speaking with their wife."
      }
    }),
    validationContext: offerAcceptanceContext(joinedTranscript)
  }).result;

  assert.doesNotMatch(savedJoined.acceptanceAssessment.offerEvidence.quote, /\.\.\.|…/);
  assert.equal(joinedTranscript.includes(savedJoined.acceptanceAssessment.offerEvidence.quote), true);
  assert.equal(savedJoined.acceptanceAssessment.semanticAdjustments.length, 1);
});

test("Offer Acceptance repairs a close model paraphrase only to an exact transcript excerpt", () => {
  const template = createDefaultEvaluationStudio().evaluationTemplates.find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);
  const transcript = "Salesperson: At the end of the day, it is just $550, so $550 to say thanks to our paramedics. Customer: Maybe you could send me a link and I will review it.";
  const saved = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    templateId: template.id,
    result: validOfferAcceptanceResult({
      category: 2,
      classification: "interested_follow_up_only",
      customer_commitment: "interest_only",
      unresolved_condition: true,
      offer_evidence: {
        speaker: "salesperson",
        quote: "It's just $550, so $550 to say thanks to our paramedics",
        summary: "The salesperson presented the $550 offer."
      },
      customer_response_evidence: {
        speaker: "customer",
        quote: "Maybe you could send me a link and I will review it.",
        summary: "The customer agreed only to review a link."
      }
    }),
    validationContext: offerAcceptanceContext(transcript)
  }).result;

  assert.equal(transcript.toLowerCase().includes(saved.acceptanceAssessment.offerEvidence.quote.toLowerCase()), true);
  assert.equal(saved.acceptanceAssessment.semanticAdjustments.some((item) => item.field === "offer_evidence.quote"), true);
});

test("Offer Acceptance reporting calculates acceptance rate and salesperson, source, and date breakdowns", () => {
  const studio = normalizeEvaluationStudio({
    evaluationTemplates: [],
    knowledgebaseEntries: [],
    evaluationRuns: [{
      id: "offer-report-run",
      importId: "offer-report-import",
      templateId: "template_offer_acceptance_classification_v1",
      templateSnapshot: { evaluationGoal: OFFER_ACCEPTANCE_GOAL },
      status: "partially_completed",
      plannedCallCount: 4,
      completedCallCount: 3,
      failedCallCount: 1,
      createdAt: "2026-07-16T07:00:00.000Z",
      errors: [{ error: "Offer Acceptance evaluation output is invalid: offer_evidence.quote must be 500 characters or fewer." }]
    }],
    evaluationResults: [
      ["accepted-a", 3, "customer_accepted_offer"],
      ["follow-up-a", 2, "interested_follow_up_only"],
      ["no-sale-b", 1, "no_sale_signal"]
    ].map(([callId, category, classification], index) => ({
      id: `result-${index}`,
      importId: "offer-report-import",
      callId,
      evaluationGoal: OFFER_ACCEPTANCE_GOAL,
      status: "usable",
      confidence: 0.9,
      evidenceAvailability: "available",
      transcriptQuality: "high",
      acceptanceAssessment: { category, classification },
      updatedAt: `2026-07-16T07:0${index}:00.000Z`
    }))
  });
  const report = buildOfferAcceptanceReport(studio, {
    importId: "offer-report-import",
    calls: [
      { callId: "accepted-a", salesperson: "Seller A", source: "Referral", date: "16/07/2026" },
      { callId: "follow-up-a", salesperson: "Seller A", source: "Referral", date: "16/07/2026" },
      { callId: "no-sale-b", salesperson: "Seller B", source: "GoogleMaps", date: "15/07/2026" }
    ]
  });

  assert.deepEqual(report.totals, {
    classified: 3,
    accepted: 1,
    followUpOnly: 1,
    noSaleSignal: 1,
    acceptanceRate: 1 / 3
  });
  assert.deepEqual(report.bySalesperson.find((row) => row.label === "Seller A"), {
    label: "Seller A",
    classified: 2,
    accepted: 1,
    followUpOnly: 1,
    noSaleSignal: 0,
    acceptanceRate: 0.5
  });
  assert.equal(report.bySource.find((row) => row.label === "Referral").accepted, 1);
  assert.equal(report.byDate.find((row) => row.label === "16/07/2026").classified, 2);
  assert.deepEqual(report.latestRun.failureReasons, [{ label: "Evidence quote exceeded 500 characters", count: 1 }]);
  assert.deepEqual(report.latestRun.failures, [{ callId: "", customerId: "Not available", category: "", reason: "Evidence quote exceeded 500 characters" }]);
  assert.equal(listEvaluationResults(studio, { acceptanceClassification: "customer_accepted_offer" }).length, 1);
});

test("Offer Acceptance results are normalized into visible Studio findings", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL);
  const transcript = "Salesperson: We are booking the spot now at $440 and payment can wait until October. Customer: Send the invoice and we'll get that sorted.";
  const saved = upsertEvaluationResult(studio, {
    importId: "import-offer",
    runId: "run-offer",
    templateId: template.id,
    result: validOfferAcceptanceResult(),
    validationContext: offerAcceptanceContext(transcript)
  });
  const result = saved.result;

  assert.equal(result.acceptanceAssessment.category, 3);
  assert.equal(result.acceptanceAssessment.classification, "customer_accepted_offer");
  assert.equal(result.findings.find((item) => item.field === "offer_acceptance_classification").value, "customer_accepted_offer");
  assert.equal(result.findings.find((item) => item.field === "offer_acceptance_category").value, 3);
});

test("existing Evaluation Studio stores receive the active Offer Acceptance template", () => {
  const studio = normalizeEvaluationStudio({
    evaluationTemplates: [{
      id: "existing-template",
      name: "Existing template",
      evaluationGoal: "procedure_adherence",
      instructions: "Review the call.",
      outputSchema: { result: "string" },
      isActive: true
    }],
    knowledgebaseEntries: [],
    evaluationRuns: [],
    evaluationResults: []
  });

  assert.equal(studio.evaluationTemplates.some((item) => item.evaluationGoal === OFFER_ACCEPTANCE_GOAL && item.isActive), true);
});

test("existing Offer Acceptance templates receive v2 while preserving the historical v1 record", () => {
  const studio = normalizeEvaluationStudio({
    evaluationTemplates: [{
      id: "template_offer_acceptance_classification_v1",
      name: "Offer Acceptance (Sale Signal) Review",
      evaluationGoal: OFFER_ACCEPTANCE_GOAL,
      instructions: "Classify the call.",
      outputSchema: {
        schema_version: OFFER_ACCEPTANCE_SCHEMA_VERSION,
        category: "integer 1|2|3"
      },
      isActive: true
    }],
    knowledgebaseEntries: [],
    evaluationRuns: [],
    evaluationResults: []
  });
  const historical = studio.evaluationTemplates.find((item) => item.id === "template_offer_acceptance_classification_v1");
  const template = studio.evaluationTemplates.find((item) => item.id === "template_offer_acceptance_classification_v2");

  assert.equal(historical.isActive, false);
  assert.equal(historical.status, "archived");
  assert.equal(template.isActive, true);
  assert.equal(template.outputSchema.category, "integer");
  assert.match(template.instructions, /one exact contiguous excerpt/i);
});

test("Evaluation Studio replaces the old lead-validity template non-destructively", () => {
  const studio = normalizeEvaluationStudio({
    evaluationTemplates: [{
      id: "template_lead_validity_utilisation_v1",
      name: "Lead Validity And Utilisation",
      evaluationGoal: "lead_validity_utilisation",
      instructions: "Historical instructions.",
      outputSchema: { historical: "string" },
      isActive: true
    }],
    knowledgebaseEntries: [],
    evaluationRuns: [],
    evaluationResults: []
  });
  const historical = studio.evaluationTemplates.find((template) => template.id === "template_lead_validity_utilisation_v1");
  const replacement = studio.evaluationTemplates.find((template) => template.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);

  assert.equal(historical.isActive, false);
  assert.equal(historical.status, "archived");
  assert.equal(replacement.isActive, true);
  assert.equal(replacement.name, "Lead Record & Disposition Evidence Audit");
  assert.equal(replacement.version, 4);
  assert.equal(replacement.outputSchema.schema_version, LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION);
  assert.match(replacement.instructions, /absence of evidence is not contradiction/i);
});

test("Evaluation Studio versions the Lead Record audit template without rewriting historical v1 runs", () => {
  const studio = normalizeEvaluationStudio({
    evaluationTemplates: [{
      id: "template_lead_record_disposition_evidence_audit_v1",
      name: "Lead Record & Disposition Evidence Audit",
      evaluationGoal: LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
      instructions: "Historical v1 instructions.",
      outputSchema: { historical: "string" },
      version: 1,
      isActive: true
    }],
    knowledgebaseEntries: [],
    evaluationRuns: [{
      id: "historical-audit-run",
      importId: "import-july-7",
      templateId: "template_lead_record_disposition_evidence_audit_v1",
      templateVersion: 1,
      templateSnapshot: { id: "template_lead_record_disposition_evidence_audit_v1", version: 1 },
      status: "completed"
    }],
    evaluationResults: []
  });
  const historical = studio.evaluationTemplates.find((item) => item.id === "template_lead_record_disposition_evidence_audit_v1");
  const active = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL && item.isActive);

  assert.equal(historical.isActive, false);
  assert.equal(active.version, 4);
  assert.equal(active.outputSchema.schema_version, LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION);
  assert.equal(studio.evaluationRuns[0].templateId, historical.id);
  assert.equal(studio.evaluationRuns[0].templateSnapshot.version, 1);
});

test("Evaluation Studio knowledgebase entries are versioned and archived non-destructively", () => {
  const storePath = tempStorePath();
  const created = saveEvaluationKnowledgebaseEntry({
    title: "Manager Callback Standard",
    category: "callback_handling",
    tags: "callback, follow up",
    content: "Confirm the best time, reason for callback, and next action.",
    updatedBy: "CEO"
  }, { storePath });

  assert.equal(created.entry.updatedBy, "local_user");
  assert.equal(created.entry.isActive, true);
  assert.equal(created.entry.approvalStatus, "pending_manager_approval");
  assert.equal(created.entry.version, 1);

  const updated = saveEvaluationKnowledgebaseEntry({
    id: created.entry.id,
    title: "Manager Callback Standard",
    category: "callback_handling",
    tags: "callback, follow up",
    content: "Confirm timing, objection, next action, and handover notes.",
    actor: "<script>spoof()</script>"
  }, { storePath });

  assert.equal(updated.entry.version, 2);
  assert.equal(updated.entry.updatedBy, "local_user");

  const archived = archiveEvaluationKnowledgebaseEntry(created.entry.id, { storePath });
  assert.equal(archived.entry.isActive, false);

  const store = readStore({ storePath });
  assert.equal(store.evaluationStudio.knowledgebaseEntries.some((entry) => entry.id === created.entry.id), true);
});

test("Evaluation Studio templates validate strict schemas and block parked-data concepts", () => {
  const storePath = tempStorePath();
  assert.throws(() => saveEvaluationTemplate({
    name: "Bad Schema",
    evaluationGoal: "procedure_adherence",
    instructions: "Return JSON.",
    outputSchema: "{not-json"
  }, { storePath }), /valid JSON/);

  assert.throws(() => saveEvaluationTemplate({
    name: "Bad Parked Data Template",
    evaluationGoal: "procedure_adherence",
    instructions: "Return JSON.",
    outputSchema: { allocationCoverage: "number" }
  }, { storePath }), /parked campaign\/allocation/);

  const saved = saveEvaluationTemplate({
    name: "Objection Review",
    evaluationGoal: "objection_handling",
    instructions: "Detect objection type and handling quality with evidence.",
    outputSchema: { objection_type: "string", handling_quality: "string", evidence: "string", confidence: "0-1" },
    updatedBy: "admin"
  }, { storePath });

  assert.equal(saved.template.evaluationGoal, "objection_handling");
  assert.equal(saved.template.updatedBy, "local_user");
  assert.equal(saved.template.isActive, true);
});

test("Evaluation Studio templates allow safe custom evaluation goals", () => {
  const storePath = tempStorePath();
  const saved = saveEvaluationTemplate({
    name: "Payment Ask Quality Review",
    evaluationGoal: "payment_ask_quality",
    instructions: "Evaluate whether the payment or next-step ask was clear, evidence-backed, and fair.",
    outputSchema: { payment_ask_quality: "string", evidence: "string", confidence: "0-1" },
    updatedBy: "spoofed_actor"
  }, { storePath });

  assert.equal(saved.template.evaluationGoal, "payment_ask_quality");
  assert.equal(saved.template.updatedBy, "local_user");
  assert.equal(saved.template.version, 1);

  assert.throws(() => saveEvaluationTemplate({
    name: "Parked Campaign Goal",
    evaluationGoal: "campaign_allocation_review",
    instructions: "Return JSON.",
    outputSchema: { finding: "string" }
  }, { storePath }), /parked campaign\/allocation/);
});

test("Evaluation Studio run records preserve template and knowledgebase versions", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const result = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 25 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 25
  }, { storePath });

  assert.equal(result.run.importId, "import-july-7");
  assert.equal(result.run.status, "queued");
  assert.equal(result.run.templateSnapshot.id, template.id);
  assert.equal(result.run.templateVersion, template.version);
  assert.equal(result.run.plannedCallCount, 25);
  assert.equal(result.run.knowledgebaseSnapshot.length, 0);
  assert.ok(result.run.excludedKnowledgebaseIds.length >= 1);
  assert.match(result.run.excludedKnowledgebaseReason, /Draft knowledgebase entries/);

  const persistence = dashboardPersistence(result.store, "import-july-7");
  assert.equal(persistence.evaluationStudio.summary.runs, 1);
  assert.equal(persistence.counts.evaluationRuns, 1);
});

test("Evaluation Studio run quarantine and resume are auditable non-destructive states", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const result = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 10 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 10
  }, { storePath });

  const quarantined = quarantineEvaluationRun(result.store.evaluationStudio, result.run.id, {
    reason: "Prompt output did not match schema.",
    now: "2026-07-10T09:30:00.000Z"
  });
  assert.equal(quarantined.run.status, "quarantined");
  assert.equal(quarantined.run.quarantineReason, "Prompt output did not match schema.");
  assert.equal(quarantined.run.quarantinedBy, "local_user");
  assert.equal(quarantined.run.runHistory.length, 1);
  assert.equal(quarantined.run.runHistory[0].action, "quarantine");

  const resumed = resumeEvaluationRun(quarantined.studio, result.run.id, {
    reason: "Schema fixed.",
    now: "2026-07-10T09:35:00.000Z"
  });
  assert.equal(resumed.run.status, "queued");
  assert.equal(resumed.run.resumeCount, 1);
  assert.equal(resumed.run.resumedBy, "local_user");
  assert.equal(resumed.run.quarantineReason, "");
  assert.equal(resumed.run.runHistory.length, 2);
  assert.equal(resumed.run.runHistory[1].action, "resume");

  const completed = {
    ...resumed.studio,
    evaluationRuns: resumed.studio.evaluationRuns.map((run) => run.id === result.run.id ? { ...run, status: "completed" } : run)
  };
  assert.throws(() => quarantineEvaluationRun(completed, result.run.id, { reason: "too late" }), /Completed Evaluation Studio runs cannot be quarantined/);
  assert.throws(() => resumeEvaluationRun(completed, result.run.id, { reason: "too late" }), /Completed Evaluation Studio runs do not need resume/);
});

test("Evaluation Studio task input keeps call AllocatedLeadID raw-only and excludes parked metrics", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const input = buildEvaluationStudioInput({
    callId: "call-1",
    salesperson: "Riley Example",
    date: "2026-07-01",
    time: "15:58:37",
    contactClassification: "voicemail",
    localOutcome: "no_contact",
    followUpStatus: "indeterminate",
    transcriptQuality: "medium",
    stableIds: [{ field: "AllocatedLeadID", value: "lead-raw-1" }],
    rawFields: {
      AllocatedLeadID: "lead-raw-1",
      "QTY ACTIONED": "999"
    },
    transcript: "Voicemail: Please leave a message."
  }, template, [
    { ...studio.knowledgebaseEntries[0], approvalStatus: "approved_current" },
    ...studio.knowledgebaseEntries.slice(1)
  ], { importId: "import-july-7" });

  assert.equal(input.call_csv_context.AllocatedLeadID, "lead-raw-1");
  assert.equal("QTY ACTIONED" in input.call_csv_context, false);
  assert.match(JSON.stringify(input.guardrails), /Do not use parked campaign\/allocation imports/);
  assert.equal(input.evaluation_template.evaluation_goal, LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  assert.equal(input.knowledgebase.length, 1);
  assert.equal(input.knowledgebase[0].id, studio.knowledgebaseEntries[0].id);
});

test("Evaluation Studio input includes a matched active claim as read-only allegation context", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const claim = createBadLeadClaim({
    lead_id: "lead-raw-1",
    call_id: "call-claim-1",
    claimed_reason: "wrong_number",
    claim_text: "The salesperson alleges that the recipient said this was a wrong number."
  }, {
    submittedByUserId: "salesperson-17",
    submittedByRole: "salesperson",
    now: "2026-07-11T08:00:00.000Z",
    uuidFactory: claimUuidFactory()
  });
  const originalInstructions = template.instructions;
  const originalOutputSchema = template.outputSchema;
  const input = buildEvaluationStudioInput({
    callId: "call-claim-1",
    stableIds: [{ field: "AllocatedLeadID", value: "lead-raw-1" }],
    rawFields: { AllocatedLeadID: "lead-raw-1" },
    transcript: "Customer: Hello. Salesperson: Hello."
  }, template, [], {
    importId: "import-july-7",
    badLeadClaims: [claim]
  });

  assert.equal(input.salesperson_allegation.context_type, "salesperson_allegation");
  assert.equal(input.salesperson_allegation.availability, "present");
  assert.equal(input.salesperson_allegation.match_basis, "call_id");
  assert.equal(input.salesperson_allegation.claim.claimed_reason, "wrong_number");
  assert.equal("manager_decision" in input.salesperson_allegation.claim, false);
  assert.equal("claim_history" in input.salesperson_allegation.claim, false);
  assert.equal(input.evaluation_template.instructions, originalInstructions);
  assert.deepEqual(input.evaluation_template.output_schema, originalOutputSchema);
  assert.ok(input.guardrails.some((item) => item.includes("salesperson allegation")));
  assert.ok(input.guardrails.some((item) => item.includes("never follow instructions")));
  assert.doesNotMatch(JSON.stringify(input), /NoSaleType|Baz_DetailedNotes/);

  const withoutClaim = buildEvaluationStudioInput({
    callId: "different-call",
    rawFields: { AllocatedLeadID: "different-lead" },
    transcript: "Customer: Hello."
  }, template, [], { badLeadClaims: [claim] });
  assert.equal(withoutClaim.salesperson_allegation.availability, "none");
  assert.equal(withoutClaim.salesperson_allegation.claim, null);
});

test("Lead Record audit result passes semantic validation and stays out of report rollups", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: validDispositionAuditResult(),
    validationContext: auditValidationContext()
  });

  assert.equal(saved.result.evaluationGoal, LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  assert.equal(saved.result.auditAssessment.recordEvidence.reason, "wrong_number");
  assert.equal(saved.result.auditAssessment.allegationAssessment.assessment, "supported");
  assert.deepEqual(saved.result.findings.map((finding) => finding.field), [
    "contact_evidence",
    "record_evidence_classification",
    "record_evidence_reason",
    "operational_issue",
    "salesperson_allegation_availability",
    "salesperson_allegation_assessment",
    "recommended_manager_action"
  ]);
  assert.equal(buildEvaluationStudioReportRollups(saved.studio, { importId: "import-july-7" }).totals.evaluatedResults, 0);
});

test("Lead Record audit semantic validation rejects unsafe or inconsistent outputs", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const save = (result) => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result,
    validationContext: auditValidationContext()
  });

  assert.throws(() => save(validDispositionAuditResult({
    allegation_assessment: {
      availability: "none",
      claim_id: "invented-claim",
      claimed_reason: "wrong_number",
      assessment: "supported",
      rationale: "Invented allegation."
    }
  })), /unavailable allegation must have assessment absent/);
  assert.throws(() => save(validDispositionAuditResult({ evidence: [] })), /require verified transcript\/system evidence/);
  assert.throws(() => save(validDispositionAuditResult({ claim_status: "confirmed" })), /unsupported field: claim_status/i);
  assert.throws(() => save(validDispositionAuditResult({ recommendation: "suppress_lead" })), /recommendation has unsupported value/);
  assert.throws(() => save(validDispositionAuditResult({ schema_version: "sales_dashboard_evaluation_result.v1" })), /schema_version must be/);
  assert.throws(() => save(validDispositionAuditResult({ findings: [{ field: "claim_status", value: "confirmed" }] })), /findings must be an empty array/);
});

test("Lead Record audit enforces invalidity recommendation and manager-review mappings", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const save = (result) => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result,
    validationContext: auditValidationContext()
  });

  const accepted = save(validDispositionAuditResult({ confidence: 0.95 }));
  assert.equal(accepted.result.managerReviewRecommended, true);
  assert.equal(accepted.result.auditAssessment.recommendation, "correct_or_remove_record");
  assert.equal(accepted.result.findings.every((finding) => finding.managerReviewRecommended), true);
  assert.throws(() => validateLeadRecordDispositionAuditResult({
    result: validDispositionAuditResult({ recommendation: "continue_normal_workflow" }),
    validationContext: auditValidationContext()
  }), /requires recommendation correct_or_remove_record/);
  assert.throws(() => validateLeadRecordDispositionAuditResult({
    result: validDispositionAuditResult({ manager_review_recommended: false }),
    validationContext: auditValidationContext()
  }), /requires manager review/);
  const corrected = save(validDispositionAuditResult({
    recommendation: "continue_normal_workflow",
    manager_review_recommended: false
  }));
  assert.equal(corrected.result.auditAssessment.recommendation, "correct_or_remove_record");
  assert.equal(corrected.result.managerReviewRecommended, true);
  assert.equal(corrected.result.auditAssessment.semanticAdjustments.some((item) => item.field === "recommendation"), true);
  assert.equal(corrected.result.auditAssessment.semanticAdjustments.some((item) => item.field === "manager_review_recommended"), true);
  const correctedLivePattern = save(absentAllegationResult({
    quote: "You have the wrong number.",
    confidence: 0.95
  }));
  assert.equal(correctedLivePattern.result.auditAssessment.recordEvidence.classification, "supported_invalidity");
  assert.equal(correctedLivePattern.result.auditAssessment.recordEvidence.reason, "wrong_number");
  assert.equal(correctedLivePattern.result.auditAssessment.recommendation, "correct_or_remove_record");
  assert.equal(correctedLivePattern.result.managerReviewRecommended, true);
  assert.throws(() => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({
      quote: "I am not interested.",
      recommendation: "correct_or_remove_record"
    }),
    validationContext: auditValidationContext({
      contactClassification: "customer",
      localOutcome: "not_interested",
      transcript: "Customer: I am not interested."
    })
  }), /requires supported invalidity/);
});

test("Lead Record audit maps explicit do-not-contact evidence to advisory operational review", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const quote = "Yeah, mate, I'm not interested, to be honest. Can you take me off that list because there is a do not call that this number's attached to.";
  const context = auditValidationContext({
    contactClassification: "customer",
    localOutcome: "opt_out",
    transcript: `Customer: ${quote}`
  });
  const raw = absentAllegationResult({ quote, confidence: 0.9 });

  assert.throws(() => validateLeadRecordDispositionAuditResult({ result: raw, validationContext: context }), /explicit do-not-contact evidence requires operational unusability/);
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: raw,
    validationContext: context
  });

  assert.equal(saved.result.auditAssessment.recordEvidence.classification, "supported_operational_unusability");
  assert.equal(saved.result.auditAssessment.recordEvidence.reason, "do_not_contact");
  assert.equal(saved.result.auditAssessment.recommendation, "manager_review_recommended");
  assert.equal(saved.result.managerReviewRecommended, true);
  assert.match(saved.result.managerSummary, /do-not-contact evidence requires manager review/i);
  assert.equal(saved.result.findings.find((item) => item.field === "operational_issue")?.value, "do_not_contact");
});

test("Lead Record audit maps direct serious threats to advisory operational review", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const quote = "I wish I could see them face to face. I would love to have a crack at them.";
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({ quote, confidence: 0.9 }),
    validationContext: auditValidationContext({
      contactClassification: "customer",
      localOutcome: "complaint",
      transcript: `Customer: ${quote}`
    })
  });

  assert.equal(saved.result.auditAssessment.recordEvidence.classification, "supported_operational_unusability");
  assert.equal(saved.result.auditAssessment.recordEvidence.reason, "unsafe_abusive");
  assert.equal(saved.result.auditAssessment.recommendation, "manager_review_recommended");
  assert.equal(saved.result.managerReviewRecommended, true);
  assert.equal(saved.result.confidence, 0.75);
  assert.match(saved.result.managerSummary, /serious threat or abuse evidence requires manager review/i);
  assert.equal(saved.result.findings.find((item) => item.field === "operational_issue")?.value, "unsafe_abusive");
});

test("Lead Record audit maps explicit permanent closure to advisory record correction review", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const quote = "That business is closed down.";
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({
      quote,
      confidence: 0.9,
      record_evidence: {
        classification: "supported_operational_unusability",
        reason: "business_closed_permanently",
        rationale: "The business is closed."
      }
    }),
    validationContext: auditValidationContext({
      contactClassification: "customer",
      localOutcome: "other",
      transcript: `Customer: ${quote}`
    })
  });

  assert.equal(saved.result.auditAssessment.recordEvidence.classification, "supported_invalidity");
  assert.equal(saved.result.auditAssessment.recordEvidence.reason, "business_closed_permanently");
  assert.equal(saved.result.auditAssessment.recommendation, "correct_or_remove_record");
  assert.equal(saved.result.managerReviewRecommended, true);
  assert.match(saved.result.managerSummary, /advisory record correction or removal review/i);
});

test("Lead Record audit does not treat hedged closure wording as permanent closure proof", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const quote = "I don't think they're currently operating.";
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: validDispositionAuditResult({
      confidence: 0.92,
      record_evidence: {
        classification: "supported_invalidity",
        reason: "business_closed_permanently",
        rationale: "The business appears closed."
      },
      allegation_assessment: {
        availability: "present",
        claim_id: "10000000-0000-4000-8000-000000000004",
        claimed_reason: "business_closed_permanently",
        assessment: "supported",
        rationale: "The statement appears to support the allegation."
      },
      evidence: [{ speaker: "customer", quote, relevance: "supports" }],
      recommendation: "correct_or_remove_record",
      manager_review_recommended: true
    }),
    validationContext: auditValidationContext({
      contactClassification: "customer",
      localOutcome: "other",
      transcript: `Customer: ${quote}`
    })
  });

  assert.equal(saved.result.auditAssessment.recordEvidence.classification, "untestable");
  assert.equal(saved.result.auditAssessment.recordEvidence.reason, "unknown");
  assert.equal(saved.result.auditAssessment.allegationAssessment.assessment, "untestable");
  assert.equal(saved.result.auditAssessment.recommendation, "independent_record_verification_recommended");
  assert.equal(saved.result.managerReviewRecommended, true);
  assert.equal(saved.result.evidenceAvailability, "partial");
  assert.equal(saved.result.confidence, 0.75);
  assert.match(saved.result.managerSummary, /independently verify/i);
});

test("Lead Record audit treats clear human rejections as usable evidence without an allegation", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const cases = [
    "I am not interested.",
    "I cannot afford it right now.",
    "We already have a supplier."
  ];

  for (const quote of cases) {
    const saved = upsertEvaluationResult(studio, {
      importId: "import-july-7",
      templateId: template.id,
      result: absentAllegationResult({ quote, confidence: 0.9 }),
      validationContext: auditValidationContext({
        contactClassification: "customer",
        localOutcome: "not_interested",
        transcriptQuality: "high",
        transcript: `Customer: ${quote}`
      })
    });
    assert.equal(saved.result.status, "usable");
    assert.equal(saved.result.evidenceAvailability, "available");
    assert.equal(saved.result.auditAssessment.recordEvidence.classification, "no_supporting_evidence");
    assert.equal(saved.result.auditAssessment.allegationAssessment.assessment, "absent");
    assert.equal(saved.result.managerReviewRecommended, false);
  }

  assert.throws(() => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({
      quote: null,
      status: "insufficient_evidence",
      confidence: 0.25,
      evidence_availability: "unavailable",
      record_evidence: { classification: "untestable", reason: "unknown", rationale: "No allegation was supplied." },
      recommendation: "insufficient_evidence"
    }),
    validationContext: auditValidationContext({
      contactClassification: "customer",
      localOutcome: "not_interested",
      transcriptQuality: "high",
      transcript: "Customer: I am not interested."
    })
  }), /clear human rejection must be usable available evidence/);
});

test("Lead Record audit keeps voicemail and no-answer evidence separate from invalidity", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  for (const contactClassification of ["voicemail", "no_answer"]) {
    const quote = contactClassification === "voicemail" ? "Please leave a message." : "The call was not answered.";
    const result = absentAllegationResult({
      quote,
      status: "usable",
      confidence: 0.65,
      evidence_availability: "available",
      transcript_quality: "medium",
      record_evidence: { classification: "untestable", reason: "unknown", rationale: "One attempt cannot establish record invalidity." },
      recommendation: "retry_contact"
    });
    const saved = upsertEvaluationResult(studio, {
      importId: "import-july-7",
      templateId: template.id,
      result,
      validationContext: auditValidationContext({
        contactClassification,
        localOutcome: contactClassification,
        transcriptQuality: "medium",
        transcript: `System: ${quote}`
      })
    });
    assert.equal(saved.result.auditAssessment.recommendation, "retry_contact");
    assert.equal(saved.result.managerReviewRecommended, false);
  }
});

test("Lead Record audit enforces evidence, confidence, and quote-verification relationships", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const save = (result, validationContext = auditValidationContext()) => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result,
    validationContext
  });

  assert.throws(() => save(absentAllegationResult({
    quote: null,
    status: "insufficient_evidence",
    confidence: 0.95,
    evidence_availability: "unavailable",
    transcript_quality: "unusable",
    record_evidence: { classification: "untestable", reason: "unknown", rationale: "Nothing usable was supplied." },
    recommendation: "insufficient_evidence"
  }), auditValidationContext({ transcript: "", transcriptQuality: "unusable", contactClassification: "unknown", localOutcome: "unknown" })), /caps confidence at 0.35/);
  assert.throws(() => save(
    validDispositionAuditResult({ confidence: 0.8, evidence_availability: "partial" }),
    auditValidationContext({ contactClassification: "customer", localOutcome: "other" })
  ), /partial evidence caps confidence at 0.75/);
  assert.throws(() => save(validDispositionAuditResult({ confidence: 0.95, evidence: [] })), /require verified transcript\/system evidence/);
  assert.throws(() => save(validDispositionAuditResult({ evidence: [{ speaker: "customer", quote: "A quote not in the transcript.", relevance: "supports" }] })), /require verified transcript\/system evidence/);
});

test("Lead Record audit repairs exact evidence and degrades proofless no-finding output conservatively", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const longQuote = "I do not know what the tax position will be. ".repeat(16).trim();
  const transcript = `Customer: ${longQuote}`;
  const repaired = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({
      quote: longQuote,
      summary: "The call contains no evidence that the lead record is invalid."
    }),
    validationContext: auditValidationContext({ transcript, contactClassification: "customer", localOutcome: "other" })
  }).result;
  assert.equal(repaired.auditAssessment.evidence[0].quote.length <= 500, true);
  assert.equal(transcript.includes(repaired.auditAssessment.evidence[0].quote), true);

  const proofless = upsertEvaluationResult(createDefaultEvaluationStudio(), {
    importId: "import-july-7",
    templateId: template.id,
    result: absentAllegationResult({
      quote: null,
      confidence: 0.9,
      evidence_availability: "available",
      summary: "No invalidity signal was found."
    }),
    validationContext: auditValidationContext({
      transcript: "Customer: Hello, I am listening.",
      contactClassification: "customer",
      localOutcome: "other"
    })
  }).result;
  assert.equal(proofless.status, "insufficient_evidence");
  assert.equal(proofless.evidenceAvailability, "unavailable");
  assert.equal(proofless.confidence, 0.35);
  assert.equal(proofless.auditAssessment.evidence.length, 0);
});

test("Lead Record audit enforces contradicted-allegation review mappings", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const contradicted = validDispositionAuditResult({
    record_evidence: { classification: "contradictory_evidence", reason: "wrong_number", rationale: "The recipient confirmed the intended business." },
    allegation_assessment: {
      availability: "present",
      claim_id: "10000000-0000-4000-8000-000000000001",
      claimed_reason: "wrong_number",
      assessment: "contradicted",
      rationale: "The transcript directly contradicts the allegation."
    },
    evidence: [{ speaker: "customer", quote: "Yes, this is the correct business.", relevance: "contradicts" }],
    recommendation: "review_salesperson_allegation",
    manager_review_recommended: true
  });
  const context = auditValidationContext({
    contactClassification: "customer",
    localOutcome: "other",
    transcript: "Customer: Yes, this is the correct business."
  });
  const saved = upsertEvaluationResult(studio, { importId: "import-july-7", templateId: template.id, result: contradicted, validationContext: context });
  assert.equal(saved.result.managerReviewRecommended, true);
  assert.equal(saved.result.auditAssessment.recommendation, "review_salesperson_allegation");
  assert.throws(() => validateLeadRecordDispositionAuditResult({
    result: { ...contradicted, recommendation: "continue_normal_workflow" },
    validationContext: context
  }), /requires recommendation review_salesperson_allegation/);
  const corrected = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    result: { ...contradicted, recommendation: "continue_normal_workflow", manager_review_recommended: false },
    validationContext: context
  });
  assert.equal(corrected.result.auditAssessment.recommendation, "review_salesperson_allegation");
  assert.equal(corrected.result.managerReviewRecommended, true);
});

test("Lead Record audit persistence does not mutate trusted claims or operational records", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  store.badLeadClaims = [createBadLeadClaim({
    lead_id: "lead-preserved",
    call_id: "call-audit-1",
    claimed_reason: "wrong_number",
    claim_text: "Recipient said the number was wrong."
  }, {
    submittedByUserId: "salesperson-17",
    submittedByRole: "salesperson",
    now: "2026-07-11T08:00:00.000Z",
    uuidFactory: claimUuidFactory()
  })];
  writeStore(store, { storePath });
  const beforeClaims = JSON.stringify(readStore({ storePath }).badLeadClaims);

  saveEvaluationResult({
    importId: "import-july-7",
    templateId: template.id,
    result: validDispositionAuditResult(),
    validationContext: auditValidationContext()
  }, { storePath });

  const after = readStore({ storePath });
  assert.equal(JSON.stringify(after.badLeadClaims), beforeClaims);
  assert.equal(after.badLeadClaims[0].claim_status, "submitted");
  assert.equal(after.evaluationStudio.evaluationResults.length, 1);
});

test("Lead Record audit permits explicit absent allegations without inventing claim data", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    templateId: template.id,
    validationContext: auditValidationContext({
      contactClassification: "unknown",
      localOutcome: "unknown",
      transcriptQuality: "unusable",
      transcript: ""
    }),
    result: validDispositionAuditResult({
      status: "insufficient_evidence",
      confidence: 0.25,
      evidence_availability: "unavailable",
      transcript_quality: "unusable",
      record_evidence: {
        classification: "untestable",
        reason: "unknown",
        rationale: "The available call contains no usable evidence."
      },
      allegation_assessment: {
        availability: "none",
        claim_id: null,
        claimed_reason: null,
        assessment: "absent",
        rationale: "No trusted salesperson allegation was supplied."
      },
      evidence: [],
      recommendation: "insufficient_evidence",
      manager_review_recommended: false,
      manager_summary: "No allegation or usable call evidence is available."
    })
  });
  assert.equal(saved.result.auditAssessment.allegationAssessment.assessment, "absent");
});

test("historical generic v1 Evaluation Studio results remain compatible", () => {
  const historical = normalizeEvaluationResult({
    callId: "historical-call",
    evaluationGoal: "callback_opportunity",
    status: "usable",
    confidence: 0.72,
    evidenceAvailability: "available",
    transcriptQuality: "medium",
    findings: [{
      field: "callback_requested",
      value: true,
      evidence: "Customer: Please call tomorrow.",
      confidence: 0.72
    }]
  });
  assert.equal(historical.evaluationGoal, "callback_opportunity");
  assert.equal(historical.findings.length, 1);
  assert.equal("auditAssessment" in historical, false);
});

test("Evaluation Studio keeps pending historical knowledge visible but out of evaluation context", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "procedure_adherence");
  const pending = studio.knowledgebaseEntries[0];
  const approved = {
    ...studio.knowledgebaseEntries[1],
    id: "approved-current-procedure",
    approvalStatus: "approved_current",
    approvalNote: "Manager verified this as the current approved procedure."
  };

  const input = buildEvaluationStudioInput({ callId: "call-approval", transcript: "Customer: Hello." }, template, [pending, approved]);
  assert.equal(input.knowledgebase.length, 1);
  assert.equal(input.knowledgebase[0].id, "approved-current-procedure");
});

test("Evaluation Studio includes only manager-approved knowledge in a new run snapshot", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "procedure_adherence");
  const approved = saveEvaluationKnowledgebaseEntry({
    title: "Current Approved Procedure",
    category: "procedure",
    tags: "current, approved",
    content: "Use the manager-approved current procedure only.",
    approvalStatus: "approved_current",
    approvalNote: "Manager approved for the current offer."
  }, { storePath });

  const run = saveEvaluationRun({ templateId: template.id }, {
    importId: "import-approval-test",
    plannedCallCount: 1
  }, { storePath }).run;

  assert.deepEqual(run.knowledgebaseIds, [approved.entry.id]);
  assert.equal(run.knowledgebaseSnapshot[0].title, "Current Approved Procedure");
  assert.ok(run.excludedKnowledgebaseIds.length >= 1);
});

test("Evaluation Studio stores versioned evidence-backed model results", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const first = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.84,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer showed interest and asked for a callback tomorrow.",
      findings: [
        {
          field: "callback_requested",
          value: true,
          evidence: "Customer: Please call me back tomorrow.",
          confidence: 0.88,
          manager_review_recommended: true
        }
      ],
      limitations: ["No confirmed sale or revenue data is available."]
    }
  });

  assert.equal(first.result.callId, "call-1");
  assert.equal(first.result.confidenceBand, "high");
  assert.equal(first.result.managerReviewRecommended, true);
  assert.equal(first.result.findings[0].evidence, "Customer: Please call me back tomorrow.");

  const second = upsertEvaluationResult(first.studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "insufficient_evidence",
      confidence: 0.42,
      evidence_availability: "partial",
      transcript_quality: "low",
      manager_summary: "Callback signal is possible but transcript evidence is weak.",
      findings: [{ field: "callback_requested", value: "possible", evidence: "call me", confidence: 0.42 }]
    }
  });

  const allResults = listEvaluationResults(second.studio, { importId: "import-july-7", includeSuperseded: true });
  const latestResults = listEvaluationResults(second.studio, { importId: "import-july-7" });
  assert.equal(allResults.length, 2);
  assert.equal(latestResults.length, 1);
  assert.equal(latestResults[0].status, "insufficient_evidence");
  assert.equal(latestResults[0].resultVersion, 2);
});

test("Evaluation Studio builds safe manager-review correction prefill from allowed findings only", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.82,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer asked for a callback tomorrow.",
      findings: [
        {
          field: "callback_requested",
          value: true,
          previous_display_value: "indeterminate",
          evidence: "Customer: please call me back tomorrow.",
          confidence: 0.82,
          manager_review_recommended: true
        },
        {
          field: "callback_timing",
          value: "tomorrow afternoon",
          evidence: "Customer: tomorrow afternoon works.",
          confidence: 0.79
        },
        {
          field: "objection_type",
          value: "affordability",
          evidence: "Customer: I cannot afford it today.",
          confidence: 0.86
        }
      ]
    }
  });

  const suggestions = buildManagerReviewPrefillCorrections(saved.result);
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.fieldName), ["follow_up_required", "follow_up_due_text"]);
  assert.equal(suggestions[0].managerSuggestedValue, "true");
  assert.equal(suggestions[0].previousDisplayValue, "indeterminate");
  assert.equal(suggestions[1].managerSuggestedValue, "tomorrow afternoon");
  assert.equal(suggestions.some((item) => item.fieldName === "objection_type"), false);
  assert.match(suggestions[0].note, /Suggested only/);
});

test("Evaluation Studio result validation blocks parked allocation report concepts", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL);

  assert.throws(() => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
      status: "usable",
      confidence: 0.7,
      evidence_availability: "available",
      transcript_quality: "medium",
      findings: [{ field: "allocation_coverage", value: "bad", evidence: "Old allocation coverage wording." }]
    }
  }), /parked campaign\/allocation/);

  assert.throws(() => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-legacy",
    templateId: template.id,
    result: {
      call_id: "call-legacy",
      evaluation_goal: LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
      status: "usable",
      confidence: 0.7,
      evidence_availability: "available",
      transcript_quality: "medium",
      findings: [{ field: "outcome_mismatch", value: true, evidence: "Legacy imported disposition differs." }]
    }
  }), /parked campaign\/allocation/);
});

test("historical legacy Evaluation Studio records remain readable and preserved but inactive", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  store.evaluationStudio.evaluationResults = [{
    id: "legacy-result",
    importId: "import-july-7",
    callId: "call-legacy",
    evaluationGoal: "outcome_mismatch_review",
    status: "usable",
    findings: [{ field: "outcome_mismatch", value: true, rawValue: "Did Not Answer" }]
  }];
  store.evaluationStudio.evaluationRuns = [{
    id: "legacy-run",
    importId: "import-july-7",
    status: "completed",
    guardrails: ["Use NoSaleType as context."],
    updatedAt: "2026-07-10T00:00:00.000Z"
  }];
  writeStore(store, { storePath });

  const loaded = readStore({ storePath });
  const normalized = normalizeEvaluationStudio(loaded.evaluationStudio);
  assert.equal(normalized.evaluationResults.length, 1);
  assert.equal(normalized.evaluationResults[0].containsUntrustedLegacyData, true);
  assert.equal(listEvaluationResults(normalized).length, 0);
  const persistence = dashboardPersistence(loaded, "import-july-7");
  assert.equal(persistence.evaluationStudio.evaluationResults.length, 0);
  assert.equal(persistence.evaluationStudio.evaluationRuns.length, 0);
  assert.equal(persistence.evaluationStudio.summary.runs, 0);
  assert.equal(persistence.evaluationStudio.summary.lastRun, null);

  saveEvaluationKnowledgebaseEntry({ title: "Current call procedure", content: "Use transcript evidence only." }, { storePath });
  assert.equal(readStore({ storePath }).evaluationStudio.evaluationResults.length, 1);
  assert.equal(readStore({ storePath }).evaluationStudio.evaluationRuns.length, 1);
});

test("approved knowledge and template writes reject excluded legacy context", () => {
  const storePath = tempStorePath();
  assert.throws(() => saveEvaluationKnowledgebaseEntry({
    title: "Legacy disposition guide",
    content: "Use NoSaleType as the source of truth.",
    approvalStatus: "approved_current"
  }, { storePath }), /excluded legacy-data/);
  assert.throws(() => saveEvaluationTemplate({
    name: "Legacy prompt",
    evaluationGoal: "procedure_adherence",
    instructions: "Compare the transcript to Baz_DetailedNotes."
  }, { storePath }), /excluded legacy-data/);
  assert.throws(() => buildEvaluationStudioInput(
    { callId: "call-1", transcript: "Customer: hello" },
    { id: "legacy-template", evaluationGoal: "procedure_adherence", instructions: "Use NoSaleType." },
    []
  ), /excluded legacy-data/);
});

test("Evaluation Studio result persistence updates run counts and evidence queues", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "objection_handling");
  const run = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 2 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 2
  }, { storePath }).run;

  const saved = saveEvaluationResult({
    importId: "import-july-7",
    runId: run.id,
    templateId: template.id,
    jobId: "job-1",
    result: {
      call_id: "call-1",
      evaluation_goal: "objection_handling",
      status: "usable",
      confidence: 0.81,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer raised affordability and salesperson acknowledged it.",
      findings: [{ field: "objection_type", value: "affordability", evidence: "Customer: I cannot afford it right now.", confidence: 0.81, manager_review_recommended: true }]
    }
  }, { storePath });

  assert.equal(saved.result.provenance, "evaluation_studio_local_model");
  assert.equal(saved.result.updatedBy, "local_user");
  assert.equal(saved.result.knowledgebaseIds.length, 0);
  assert.equal(saved.result.knowledgebaseVersions.length, saved.result.knowledgebaseIds.length);
  assert.equal(saved.result.knowledgebaseVersions.every((entry) => entry.id && entry.version >= 1), true);

  const persisted = readStore({ storePath });
  const persistedRun = persisted.evaluationStudio.evaluationRuns.find((item) => item.id === run.id);
  assert.equal(persistedRun.completedCallCount, 1);
  assert.equal(persistedRun.failedCallCount, 0);
  assert.equal(persisted.evaluationStudio.evaluationResults.length, 1);

  const persistence = dashboardPersistence(persisted, "import-july-7");
  assert.equal(persistence.counts.evaluationResults, 1);
  assert.equal(persistence.counts.evaluationReviewRecommendedResults, 1);
  assert.equal(persistence.evaluationStudio.evidenceQueue.length, 1);
  assert.equal(persistence.evaluationStudio.evidenceQueue[0].callId, "call-1");
  assert.equal(persistence.evaluationStudio.reportRollups.totals.objectionsDetected, 1);
});

test("Evaluation Studio report rollups produce report-safe lead utilisation and coaching signals", () => {
  const studio = createDefaultEvaluationStudio();
  const callbackTemplate = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const coachingTemplate = studio.evaluationTemplates.find((item) => item.evaluationGoal === "coaching_opportunity")
    || studio.evaluationTemplates.find((item) => item.evaluationGoal === "procedure_adherence");
  const first = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-callback",
    templateId: callbackTemplate.id,
    jobId: "job-callback",
    result: {
      call_id: "call-callback",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.9,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer wanted a callback and gave an affordability objection.",
      manager_review_recommended: true,
      findings: [
        { field: "callback_requested", value: true, evidence: "Customer: call me back tomorrow.", confidence: 0.9, manager_review_recommended: true },
        { field: "objection_type", value: "budget_affordability", evidence: "Customer: I cannot afford it this week.", confidence: 0.86 },
        { field: "lead_utilisation_status", value: "possible_under_utilised", evidence: "Customer: call me back tomorrow.", confidence: 0.82 }
      ]
    }
  });
  const second = upsertEvaluationResult(first.studio, {
    importId: "import-july-7",
    runId: "run-coaching",
    templateId: coachingTemplate.id,
    jobId: "job-coaching",
    result: {
      call_id: "call-coaching",
      evaluation_goal: "coaching_opportunity",
      status: "usable",
      confidence: 0.72,
      evidence_availability: "partial",
      transcript_quality: "medium",
      manager_summary: "The close may need coaching review.",
      findings: [
        { field: "coaching_priority", value: "medium", evidence: "Agent ended without confirming next step.", confidence: 0.72 },
        { field: "stage_failure", value: "close", evidence: "Agent: no worries, take care.", confidence: 0.7 }
      ]
    }
  });

  const rollups = buildEvaluationStudioReportRollups(second.studio, { importId: "import-july-7" });
  assert.equal(rollups.totals.evaluatedCalls, 2);
  assert.equal(rollups.totals.callbackOpportunities, 1);
  assert.equal(rollups.totals.objectionsDetected, 1);
  assert.equal(rollups.totals.possibleWasteIndicators, 1);
  assert.equal(rollups.totals.coachingOpportunities, 2);
  assert.equal(listEvaluationResults(second.studio, { importId: "import-july-7", reportSignal: "callbackOpportunities" }).map((row) => row.callId).join(","), "call-callback");
  assert.equal(listEvaluationResults(second.studio, { importId: "import-july-7", reportSignal: "possibleWasteIndicators" }).map((row) => row.callId).join(","), "call-callback");
  assert.equal(listEvaluationResults(second.studio, { importId: "import-july-7", reportSignal: "coachingOpportunities" }).map((row) => row.callId).join(","), "call-coaching");
  assert.equal(rollups.priorityExamples.some((row) => row.reportLanguage === "possible waste indicator"), true);
  assert.equal(rollups.warnings.some((warning) => /confirmed sales/i.test(warning)), true);
  assert.equal(/QTY ACTIONED|allocation coverage|stable lead-days/i.test(JSON.stringify(rollups)), false);
});
