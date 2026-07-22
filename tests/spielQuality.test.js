"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const { renderEvaluationStudioPage } = require("../src/dashboardRenderer");
const {
  SPIEL_QUALITY_GOAL,
  SPIEL_QUALITY_KNOWLEDGEBASE_IDS,
  SPIEL_QUALITY_SCHEMA_VERSION,
  createDefaultEvaluationStudio,
  createEvaluationRun,
  listEvaluationResults,
  normalizeEvaluationStudio,
  reconcileSpielQualityOutput,
  upsertEvaluationResult,
  validateSpielQualityResult
} = require("../src/evaluationStudio");

const dimensionDefaults = Object.freeze({
  opening_and_rapport: "met",
  purpose_and_transparency: "met",
  offer_clarity: "met",
  delivery_and_listening: "met",
  objection_judgement: "not_applicable",
  commitment_and_confirmation: "not_applicable",
  payment_timing: "not_applicable",
  operational_accuracy: "met",
  customer_boundary: "met"
});

function spielOutput(fixture, overrides = {}) {
  const improvement = overrides.improvement || "";
  const policyFinding = overrides.policyFinding || null;
  const quality = overrides.callHandlingQuality || "acceptable";
  const scope = overrides.assessmentScope || "spiel_and_handling";
  const output = {
    schema_version: SPIEL_QUALITY_SCHEMA_VERSION,
    evaluation_goal: SPIEL_QUALITY_GOAL,
    call_id: fixture.id,
    status: "usable",
    confidence: 0.88,
    evidence_availability: "available",
    transcript_quality: "high",
    call_purpose: overrides.callPurpose || "new_offer",
    assessment_scope: scope,
    call_handling_quality: quality,
    spiel_quality: scope === "spiel_and_handling" ? (overrides.spielQuality || quality) : "not_assessable",
    primary_reason_code: overrides.primaryReasonCode || (quality === "strong" ? "strong_execution" : quality === "needs_improvement" ? "minor_execution_gap" : "none"),
    quality_reason: overrides.qualityReason || "The salesperson handled the applicable part of the call in line with the calibrated standard.",
    dimensions: { ...dimensionDefaults, ...(overrides.dimensions || {}) },
    policy_findings: policyFinding ? [{ ...policyFinding, evidence_quote: fixture.quote }] : [],
    strengths: overrides.noStrength ? [] : quality === "strong" && scope === "spiel_and_handling"
      ? [
          { summary: "The salesperson responded appropriately to the situation.", evidence_quote: fixture.quote },
          { summary: "The salesperson completed the applicable stage particularly well.", evidence_quote: fixture.quote }
        ]
      : [{ summary: "The salesperson responded appropriately to the situation.", evidence_quote: fixture.quote }],
    improvements: improvement ? [{ summary: improvement, evidence_quote: fixture.quote }] : [],
    coaching_action: improvement ? "Correct the identified material gap on the next comparable call." : "No material coaching action",
    suggested_phrase: "",
    evidence: [{ claim_type: overrides.claimType || "handling", speaker: overrides.speaker || "salesperson", quote: fixture.quote }],
    manager_review_recommended: Boolean(policyFinding),
    manager_summary: overrides.managerSummary || "The quality band reflects the salesperson's conduct, not whether the customer bought.",
    limitations: [],
    findings: []
  };
  return output;
}

function storeFixture(studio, fixture, overrides = {}) {
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === SPIEL_QUALITY_GOAL);
  return upsertEvaluationResult(studio, {
    importId: "spiel-calibration",
    runId: "spiel-calibration-run",
    templateId: template.id,
    result: spielOutput(fixture, overrides),
    validationContext: { call: { callId: fixture.id, transcript: fixture.transcript } }
  });
}

test("Spiel Quality seeds five draft references and binds only those references to its template", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === SPIEL_QUALITY_GOAL);
  assert.ok(template);
  assert.deepEqual(template.knowledgebaseIds, SPIEL_QUALITY_KNOWLEDGEBASE_IDS);
  const entries = studio.knowledgebaseEntries.filter((item) => SPIEL_QUALITY_KNOWLEDGEBASE_IDS.includes(item.id));
  assert.equal(entries.length, 5);
  assert.equal(entries.every((item) => item.approvalStatus === "pending_manager_approval"), true);

  const approvedUnrelated = {
    ...studio.knowledgebaseEntries[0],
    id: "kb-approved-but-unrelated",
    approvalStatus: "approved_current"
  };
  const oneApprovedSpielEntry = {
    ...entries[0],
    approvalStatus: "approved_current"
  };
  const normalized = normalizeEvaluationStudio({
    ...studio,
    knowledgebaseEntries: [approvedUnrelated, oneApprovedSpielEntry, ...studio.knowledgebaseEntries.filter((item) => item.id !== entries[0].id)]
  });
  const created = createEvaluationRun(normalized, { templateId: template.id }, { importId: "spiel-scope", plannedCallCount: 1 });
  assert.deepEqual(created.run.knowledgebaseIds, [oneApprovedSpielEntry.id]);
  assert.equal(created.run.knowledgebaseIds.includes(approvedUnrelated.id), false);
  assert.equal(created.run.excludedKnowledgebaseIds.length, 4);
});

test("Spiel Quality contract reproduces all ten manager-calibrated quality bands", () => {
  const cases = [
    { id: "r1", quote: "Salesperson: I will put November down even though you said before the end of October.", expected: "needs_improvement", overrides: { improvement: "The salesperson unnecessarily extended the customer's payment timing.", primaryReasonCode: "payment_timing_policy_breach", dimensions: { payment_timing: "missed" }, policyFinding: { type: "payment_term_mismatch", severity: "material", summary: "Customer timing was restated later without a request." } } },
    { id: "r2", quote: "Salesperson: I can send the information, but can you commit today?", expected: "acceptable", overrides: { improvement: "The commitment pressure was stronger than the information request required.", primaryReasonCode: "minor_execution_gap" } },
    { id: "r3", quote: "Salesperson: I understand you asked for removal, but let me explain the offer.", expected: "needs_improvement", overrides: { callPurpose: "complaint_or_opt_out", improvement: "The pitch continued after an explicit removal request.", primaryReasonCode: "customer_boundary_breach", dimensions: { customer_boundary: "missed" }, policyFinding: { type: "opt_out_not_completed", severity: "material", summary: "The removal request was not completed before the pitch continued." } } },
    { id: "r4", quote: "Salesperson: I understand the budget issue; we can leave it there or arrange a sensible later step.", expected: "strong", overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", dimensions: { objection_judgement: "met" } } },
    { id: "r5", quote: "Salesperson: I have sent the Police Journal confirmation for the SES booking.", expected: "needs_improvement", overrides: { improvement: "The wrong publication confirmation was sent.", primaryReasonCode: "operational_accuracy_failure", dimensions: { operational_accuracy: "missed" }, policyFinding: { type: "wrong_product_or_document", severity: "material", summary: "The confirmation did not match the accepted publication." } } },
    { id: "r6", quote: "Salesperson: I am sorry to hear that; I will leave you to it and end the call.", expected: "acceptable", overrides: { assessmentScope: "handling_only", primaryReasonCode: "sound_judgement_to_withdraw", claimType: "withdrawal_judgement" } },
    { id: "r7", quote: "Salesperson: I will send the information to the email we have for you.", expected: "acceptable", overrides: { primaryReasonCode: "none" } },
    { id: "r8", quote: "Salesperson: Thank you, I can see the overdue invoice has now been paid.", expected: "strong", overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution", dimensions: { purpose_and_transparency: "not_applicable", offer_clarity: "not_applicable" } } },
    { id: "r9", quote: "Salesperson: You said next Wednesday, but I will note that you can pay in a few weeks.", expected: "needs_improvement", overrides: { improvement: "The salesperson unnecessarily extended clear payment timing.", primaryReasonCode: "payment_timing_policy_breach", dimensions: { payment_timing: "missed" }, policyFinding: { type: "payment_term_mismatch", severity: "material", summary: "The customer's next-Wednesday timing was changed to weeks." } } },
    { id: "r10", quote: "Salesperson: I understand you do not trust the call, so I will leave it there.", expected: "acceptable", overrides: { assessmentScope: "handling_only", primaryReasonCode: "sound_judgement_to_withdraw", claimType: "withdrawal_judgement" } }
  ].map((item) => ({ ...item, transcript: item.quote }));

  let studio = createDefaultEvaluationStudio();
  for (const fixture of cases) {
    const saved = storeFixture(studio, fixture, fixture.overrides);
    studio = saved.studio;
    assert.equal(saved.result.spielQualityAssessment.callHandlingQuality, fixture.expected, fixture.id);
    if (fixture.overrides.assessmentScope === "handling_only") assert.equal(saved.result.spielQualityAssessment.spielQuality, "not_assessable", fixture.id);
  }
});

test("Spiel Quality held-out cases preserve purpose-aware and materiality invariants", () => {
  const heldOut = [
    { id: "h1", quote: "System: The number you called is unavailable.", transcript: "System: The number you called is unavailable.", expected: "not_assessable", overrides: { callPurpose: "terminal_no_contact", assessmentScope: "not_assessable", callHandlingQuality: "not_assessable", spielQuality: "not_assessable", primaryReasonCode: "none", claimType: "boundary", speaker: "system" } },
    { id: "h2", quote: "Salesperson: No problem, thank you for your time and I will leave it there.", expected: "strong", overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", dimensions: { objection_judgement: "met" } } },
    { id: "h3", quote: "Salesperson: I can hear this is not a good time, so I will not keep you.", expected: "acceptable", overrides: { assessmentScope: "handling_only", primaryReasonCode: "sound_judgement_to_withdraw", claimType: "withdrawal_judgement" } },
    { id: "h4", quote: "Salesperson: The confirmation names a different publication from the one you accepted.", expected: "needs_improvement", overrides: { callHandlingQuality: "needs_improvement", spielQuality: "needs_improvement", improvement: "The confirmation used the wrong publication.", primaryReasonCode: "operational_accuracy_failure", policyFinding: { type: "wrong_product_or_document", severity: "material", summary: "The document did not match the offer." }, dimensions: { operational_accuracy: "missed" } } },
    { id: "h5", quote: "Salesperson: Thanks, the existing invoice payment is confirmed and no new offer is being made.", expected: "strong", overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" } }
  ].map((item) => ({ ...item, transcript: item.transcript || item.quote }));

  let studio = createDefaultEvaluationStudio();
  for (const fixture of heldOut) {
    const output = spielOutput(fixture, fixture.overrides);
    const validated = validateSpielQualityResult({ result: output, validationContext: { call: fixture } });
    assert.equal(validated.call_handling_quality, fixture.expected, fixture.id);
    const saved = storeFixture(studio, fixture, fixture.overrides);
    studio = saved.studio;
    assert.equal(saved.result.spielQualityAssessment.callHandlingQuality, fixture.expected, fixture.id);
  }
});

test("Spiel Quality reconciliation downgrades an acceptable result with a material payment-term mismatch", () => {
  const fixture = {
    id: "payment-cap",
    quote: "Salesperson: You said tomorrow, but I will record next month.",
    transcript: "Salesperson: You said tomorrow, but I will record next month."
  };
  const studio = createDefaultEvaluationStudio();
  const saved = storeFixture(studio, fixture, {
    callHandlingQuality: "acceptable",
    spielQuality: "acceptable",
    improvement: "The payment timing was extended.",
    policyFinding: { type: "payment_term_mismatch", severity: "material", summary: "The customer's timing was changed." }
  });
  assert.equal(saved.result.spielQualityAssessment.callHandlingQuality, "needs_improvement");
  assert.equal(saved.result.spielQualityAssessment.primaryReasonCode, "payment_timing_policy_breach");
  assert.equal(saved.result.spielQualityAssessment.dimensions.payment_timing, "missed");
});

test("Spiel Quality semantic safeguards reconcile the calibrated model-drift boundaries", () => {
  const cases = [
    {
      id: "drift-renewal-payment",
      transcript: "Agent: Can you help us again?\nCustomer: I will pay a week before the end of October.\nAgent: I will record November.",
      quote: "Agent: Can you help us again?",
      overrides: { callPurpose: "callback_follow_up", assessmentScope: "handling_only", callHandlingQuality: "not_assessable", primaryReasonCode: "none" },
      expected: "needs_improvement",
      expectedReason: "payment_timing_policy_breach"
    },
    {
      id: "drift-opt-out",
      transcript: "Customer: Please take me off that list.\nAgent: Absolutely, thank you for your time.",
      quote: "Agent: Absolutely, thank you for your time.",
      overrides: { callPurpose: "complaint_or_opt_out", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "sound_judgement_to_withdraw" },
      expected: "needs_improvement",
      expectedReason: "customer_boundary_breach"
    },
    {
      id: "drift-scam-exit",
      transcript: "Customer: This sounds like a scam.\nAgent: What would be holding you back?\nCustomer: I do not trust it.\nAgent: I understand, so I will leave you there.",
      quote: "Agent: I understand, so I will leave you there.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      expectedReason: "sound_judgement_to_withdraw"
    },
    {
      id: "drift-information-request",
      transcript: "Customer: I cannot make business decisions without seeing the data. What is the circulation?\nAgent: Can we count you on board?\nCustomer: I am not interested without seeing the numbers.",
      quote: "Agent: Can we count you on board?",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      expectedReason: "objection_handling_gap"
    },
    {
      id: "drift-payment-follow-up",
      transcript: "Customer: I can do it now.\nAgent: I have sent the invoice now.\nCustomer: It did come through.",
      quote: "Agent: I have sent the invoice now.",
      overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "none" },
      expected: "strong",
      expectedReason: "strong_execution"
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    let validated;
    try {
      validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    } catch (error) {
      error.message = `${fixture.id}: ${error.message}`;
      throw error;
    }
    assert.equal(validated.call_handling_quality, fixture.expected, fixture.id);
    assert.equal(validated.primary_reason_code, fixture.expectedReason, fixture.id);
  }
});

test("Spiel Quality hardening reproduces the six agreed fresh-audit outcomes", () => {
  const cases = [
    {
      id: "48543373",
      transcript: "Agent: We would like you to support the volunteers by running a support ad. It is $550.\nCustomer: Yes.\nAgent: Can we count you on board?",
      quote: "Agent: Can we count you on board?",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "strong",
      expectedPurpose: "new_offer",
      expectedReason: "strong_execution"
    },
    {
      id: "48543985",
      transcript: "Customer: No, still, I won't go for it. I've got a lot of investment, so I'm not looking for it at the moment.\nAgent: I will chop a bit off. Instead of $550, I will make it $440 and let admin know you would rather fix it up in part payments or closer to publication.",
      quote: "Agent: I will chop a bit off. Instead of $550, I will make it $440 and let admin know you would rather fix it up in part payments or closer to publication.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "needs_improvement",
      expectedPurpose: "new_offer",
      expectedReason: "payment_timing_policy_breach"
    },
    {
      id: "48544354",
      transcript: "Customer: Please send it through. I need to research it and see the details.\nAgent: All right, I will shoot you through an email.",
      quote: "Agent: All right, I will shoot you through an email.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      expectedPurpose: "new_offer",
      expectedReason: "minor_execution_gap"
    },
    {
      id: "48544297",
      transcript: "Agent: We would like you to run a support advertisement.\nCustomer: The business is on the market and I am selling it next week, so I cannot commit.\nAgent: That is all good. Thanks for your time.",
      quote: "Agent: That is all good. Thanks for your time.",
      overrides: { callHandlingQuality: "acceptable", improvement: "The offer was not clearly stated before the customer interrupted.", primaryReasonCode: "offer_clarity_gap" },
      expected: "acceptable",
      expectedPurpose: "new_offer",
      expectedReason: "sound_judgement_to_withdraw",
      expectedImprovementCount: 0
    },
    {
      id: "48544301",
      transcript: "Agent: We are organising sponsorship in the official paramedic journal.\nCustomer: Thank you for your call, but I am not interested.\nAgent: No problem. Thanks, and have a great day.",
      quote: "Agent: No problem. Thanks, and have a great day.",
      overrides: { callHandlingQuality: "acceptable", primaryReasonCode: "purpose_or_transparency_gap" },
      expected: "acceptable",
      expectedPurpose: "new_offer",
      expectedReason: "purpose_or_transparency_gap"
    },
    {
      id: "48544271",
      transcript: "Agent: Sponsorship prices in dollars.\nCustomer: Hey, you've called Shannon. I can't get to the phone right now, but if you send through a text with",
      quote: "Customer: Hey, you've called Shannon. I can't get to the phone right now, but if you send through a text with",
      overrides: { callPurpose: "other", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "none", speaker: "customer" },
      expected: "not_assessable",
      expectedPurpose: "terminal_no_contact",
      expectedReason: "none"
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    const validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    assert.equal(validated.call_handling_quality, fixture.expected, fixture.id);
    assert.equal(validated.call_purpose, fixture.expectedPurpose, fixture.id);
    assert.equal(validated.primary_reason_code, fixture.expectedReason, fixture.id);
    if (fixture.expectedImprovementCount !== undefined) assert.equal(validated.improvements.length, fixture.expectedImprovementCount, fixture.id);
  }
});

test("Spiel Quality reconciliation preserves the second-gate purpose, next-step, withdrawal, and pressure boundaries", () => {
  const cases = [
    {
      id: "gate-renewal",
      transcript: "Agent: Thank you for your proud support earlier this year. Can you stay on board?\nCustomer: The economy is slow.\nAgent: No worries, we might try next time.",
      quote: "Agent: No worries, we might try next time.",
      overrides: { callPurpose: "new_offer", callHandlingQuality: "acceptable", primaryReasonCode: "sound_judgement_to_withdraw" },
      expected: "acceptable",
      purpose: "renewal_offer",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-live-offer-pressure",
      transcript: "Agent: We want you to run a support ad in the SES journal.\nCustomer: I am in the middle of something; this is not the right time.\nCustomer: I do not know enough, so I will look it up later.\nAgent: Would this be something you would be keen on? Look it up while we are on the phone.",
      quote: "Agent: Would this be something you would be keen on? Look it up while we are on the phone.",
      overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "none" },
      expected: "needs_improvement",
      purpose: "new_offer",
      reason: "objection_handling_gap"
    },
    {
      id: "gate-information-only",
      transcript: "Customer: I will not do anything today. I will just read that email and go from there.\nAgent: We will send everything as an official email.",
      quote: "Agent: We will send everything as an official email.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "new_offer",
      reason: "minor_execution_gap"
    },
    {
      id: "gate-travel-withdrawal",
      transcript: "Agent: We are asking for a support ad in the journal.\nCustomer: I am going overseas for a month, so I have to pass this time.\nAgent: No stress. No worries.",
      quote: "Agent: No stress. No worries.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "new_offer",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-unowned-next-step",
      transcript: "Agent: I am calling on behalf of the SES about a support advertisement.\nCustomer: I will pass this information to my manager and he will contact you.\nAgent: Thank you. Have a good day.",
      quote: "Customer: I will pass this information to my manager and he will contact you.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", improvement: "Delaying the purpose disclosure reduced clarity.", speaker: "customer" },
      expected: "acceptable",
      purpose: "new_offer",
      reason: "minor_execution_gap",
      improvementPattern: /who will follow up and when/i
    },
    {
      id: "gate-completed-payment",
      transcript: "Customer: I have already paid it and I have got an invoice.\nAgent: That is a mistake on our end. I apologise and will let them know not to bother you.",
      quote: "Agent: That is a mistake on our end. I apologise and will let them know not to bother you.",
      overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "none" },
      expected: "strong",
      purpose: "payment_follow_up",
      reason: "strong_execution"
    },
    {
      id: "gate-financial-refusal-concession",
      transcript: "Agent: The support package is $550.\nCustomer: I am probably not in a financial position to do that.\nAgent: We can set up a payment arrangement and a slight discount brings it down to $440.",
      quote: "Agent: We can set up a payment arrangement and a slight discount brings it down to $440.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "needs_improvement",
      purpose: "new_offer",
      reason: "payment_timing_policy_breach"
    },
    {
      id: "gate-no-budget-arrangement",
      transcript: "Agent: The support package is $550.\nCustomer: I do not have any budget at all.\nAgent: The admin team can set up a payment arrangement that works in with your budget.",
      quote: "Agent: The admin team can set up a payment arrangement that works in with your budget.",
      overrides: { callHandlingQuality: "acceptable", spielQuality: "acceptable", primaryReasonCode: "objection_handling_gap", improvement: "Ask open-ended questions to uncover deeper objections." },
      expected: "needs_improvement",
      purpose: "new_offer",
      reason: "payment_timing_policy_breach",
      improvementPattern: /respect a clear financial refusal/i,
      expectedImprovementCount: 1
    },
    {
      id: "gate-written-confirmation-incomplete",
      transcript: "Agent: Thank you for supporting us again. Do you mind just replying to the text with the word agree?\nCustomer: The text came through.\nAgent: Please reply agree now. Thanks and goodbye.",
      quote: "Agent: Please reply agree now. Thanks and goodbye.",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "renewal_offer",
      reason: "confirmation_gap"
    },
    {
      id: "gate-serious-injury-administration",
      transcript: "Agent: You still want to help out as an anonymous sponsor with no mention of the business, correct?\nCustomer: Yes. I almost lost my fingers in a serious accident.\nAgent: Can you resend the anonymous sponsor email?\nCustomer: I sent it.\nAgent: I still cannot see it, so please send another SMS confirmation.",
      quote: "Agent: Can you resend the anonymous sponsor email?",
      overrides: { callPurpose: "new_offer", assessmentScope: "spiel_and_handling", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "administration",
      reason: "minor_execution_gap"
    },
    {
      id: "gate-vague-gatekeeper-callback",
      transcript: "Customer: The owner is with a client. I can pass on a message.\nAgent: Otherwise I can give him a buzz back later.",
      quote: "Agent: Otherwise I can give him a buzz back later.",
      overrides: { callPurpose: "callback_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "callback_follow_up",
      reason: "minor_execution_gap"
    },
    {
      id: "gate-financial-withdrawal",
      transcript: "Agent: We are asking for a support ad in the journal.\nCustomer: I am pretty tight with cash, so I have to pass.\nAgent: No worries. We will leave it there. Thanks for your time.",
      quote: "Agent: No worries. We will leave it there. Thanks for your time.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "new_offer",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-courtesy-only-terminal",
      transcript: "Agent: Thank you.\nCustomer: Thanks for your call.",
      quote: "Customer: Thanks for your call.",
      overrides: { callPurpose: "other", assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "none", speaker: "customer" },
      expected: "not_assessable",
      purpose: "terminal_no_contact",
      reason: "none"
    },
    {
      id: "gate-mislabeled-human-next-step",
      transcript: "Agent: We are asking for a support ad in the yearbook.\nVoicemail: I need to talk to my partners, then I will give you a call back.\nAgent: After you have spoken to them, give me a buzz back.",
      quote: "Agent: After you have spoken to them, give me a buzz back.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "new_offer",
      reason: "confirmation_gap"
    },
    {
      id: "gate-unresolved-prior-complaint",
      transcript: "Customer: The last salesperson was abusive and would not take no for an answer. I am never ever going to donate again.\nAgent: Fair enough. I will leave you to it. Have a good day.",
      quote: "Agent: Fair enough. I will leave you to it. Have a good day.",
      overrides: { callPurpose: "complaint_or_opt_out", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "complaint_or_opt_out",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-existing-email-confirmed",
      transcript: "Customer: Please email the offer so I can pass it to the owner.\nAgent: Is the email on your website all good?\nCustomer: Yeah, that is all right.\nAgent: I will get that sent to you right away.",
      quote: "Agent: I will get that sent to you right away.",
      overrides: { assessmentScope: "handling_only", callPurpose: "callback_follow_up", callHandlingQuality: "acceptable", primaryReasonCode: "minor_execution_gap", improvement: "Confirm the email address before sending information." },
      expected: "acceptable",
      purpose: "callback_follow_up",
      reason: "none",
      expectedImprovementCount: 0
    },
    {
      id: "gate-retirement-withdrawal",
      transcript: "Customer: We are nearly retired and getting out of the business.\nAgent: No worries. Thank you for your past support and have a good day.",
      quote: "Agent: No worries. Thank you for your past support and have a good day.",
      overrides: { callPurpose: "callback_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "callback_follow_up",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-unemployed-withdrawal",
      transcript: "Customer: I am unemployed and do not have money for that kind of thing.\nAgent: All right. Have a good one.",
      quote: "Agent: All right. Have a good one.",
      overrides: { callPurpose: "other", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      purpose: "other",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-specific-callback-before-offer",
      transcript: "Agent: I am calling on behalf of the SES volunteers.\nCustomer: I am at work. Can we continue this conversation in about an hour when I can talk?\nAgent: Yeah, sure. Perfect. I will call you back.",
      quote: "Agent: Yeah, sure. Perfect. I will call you back.",
      overrides: { callPurpose: "complaint_or_opt_out", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: "strong",
      expectedSpiel: "not_assessable",
      scope: "handling_only",
      purpose: "new_offer",
      reason: "strong_execution"
    },
    {
      id: "gate-live-wrong-contact-before-offer",
      transcript: "Customer: My number is on it, but I do not know why.\nAgent: Maybe I have the wrong number. I will take you off our list. Enjoy the rest of your day.",
      quote: "Agent: Maybe I have the wrong number. I will take you off our list. Enjoy the rest of your day.",
      overrides: { callPurpose: "terminal_no_contact", assessmentScope: "not_assessable", callHandlingQuality: "not_assessable", spielQuality: "not_assessable", primaryReasonCode: "none" },
      expected: "strong",
      expectedSpiel: "not_assessable",
      scope: "handling_only",
      purpose: "other",
      reason: "strong_execution"
    },
    {
      id: "gate-immediate-refusal-before-offer",
      transcript: "Agent: I have been asked to call on behalf of the local SES.\nCustomer: What are you trying to sell? I am not interested. Thanks.",
      quote: "Customer: What are you trying to sell? I am not interested. Thanks.",
      overrides: { callPurpose: "new_offer", assessmentScope: "spiel_and_handling", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: "acceptable",
      expectedSpiel: "not_assessable",
      scope: "handling_only",
      purpose: "other",
      reason: "sound_judgement_to_withdraw"
    },
    {
      id: "gate-bare-leave-message-voicemail",
      transcript: "Agent: Countrywide Australia.\nVoicemail: Hi, this is the business. Leave a message and we can get back to you.",
      quote: "Voicemail: Hi, this is the business. Leave a message and we can get back to you.",
      overrides: { callPurpose: "terminal_no_contact", assessmentScope: "not_assessable", callHandlingQuality: "not_assessable", spielQuality: "not_assessable", primaryReasonCode: "insufficient_evidence", speaker: "unknown" },
      expected: "not_assessable",
      expectedSpiel: "not_assessable",
      scope: "not_assessable",
      purpose: "terminal_no_contact",
      reason: "none"
    },
    {
      id: "gate-business-no-more-withdrawal",
      transcript: "Customer: CNN's are no more.\nAgent: That is all right. I will leave you to it. Have a good one.",
      quote: "Agent: That is all right. I will leave you to it. Have a good one.",
      overrides: { callPurpose: "administration", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution", improvement: "Acknowledge the business closure and confirm the business end." },
      expected: "acceptable",
      expectedSpiel: "not_assessable",
      scope: "handling_only",
      purpose: "administration",
      reason: "sound_judgement_to_withdraw",
      expectedImprovementCount: 0
    },
    {
      id: "gate-wrong-contact-after-full-offer",
      transcript: "Agent: We are looking for community-minded businesses to help with a small support ad in the yearbook.\nCustomer: I think you have called the wrong number. I do not have anything to do with that.\nAgent: No problems. Thank you and have a lovely rest of your day.",
      quote: "Agent: No problems. Thank you and have a lovely rest of your day.",
      overrides: { callPurpose: "new_offer", assessmentScope: "handling_only", callHandlingQuality: "strong", spielQuality: "not_assessable", primaryReasonCode: "strong_execution" },
      expected: "acceptable",
      expectedSpiel: "acceptable",
      scope: "spiel_and_handling",
      purpose: "new_offer",
      reason: "sound_judgement_to_withdraw"
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    let validated;
    try {
      validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    } catch (error) {
      error.message = `${fixture.id}: ${error.message}`;
      throw error;
    }
    assert.equal(validated.call_handling_quality, fixture.expected, fixture.id);
    if (fixture.expectedSpiel) assert.equal(validated.spiel_quality, fixture.expectedSpiel, fixture.id);
    if (fixture.scope) assert.equal(validated.assessment_scope, fixture.scope, fixture.id);
    assert.equal(validated.call_purpose, fixture.purpose, fixture.id);
    assert.equal(validated.primary_reason_code, fixture.reason, `${fixture.id}: ${JSON.stringify({ improvements: validated.improvements, adjustments: reconciled.adjustments })}`);
    if (fixture.improvementPattern) assert.match(validated.improvements.map((item) => item.summary).join(" "), fixture.improvementPattern, fixture.id);
    if (fixture.expectedImprovementCount !== undefined) assert.equal(validated.improvements.length, fixture.expectedImprovementCount, fixture.id);
  }
});

test("Spiel Quality promotion-audit regressions preserve final evidence and the manager pressure boundary", () => {
  const cases = [
    {
      id: "promotion-renewal-not-financial-withdrawal",
      transcript: "Agent: No stress. You supported the diary last year. Can you stick with us and run that support in December?\nCustomer: Yeah mate, that would be good.\nAgent: It is $550 and I have your existing artwork.\nCustomer: Interest rates have made the housing market volatile.\nAgent: No worries. I will shoot the confirmation email through.",
      quote: "Agent: It is $550 and I have your existing artwork.",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "renewal_offer", scope: "spiel_and_handling", handling: "strong", spiel: "strong", reason: "strong_execution" }
    },
    {
      id: "promotion-hardship-payment-plan",
      transcript: "Customer: I am struggling financially and I do not think I will be able to meet my commitment on the subscription.\nAgent: We have until October and admin can work out a payment plan.\nCustomer: I am having to let staff go and I should not have committed.\nAgent: I understand. We will leave you out of it and talk next year.",
      quote: "Agent: We have until October and admin can work out a payment plan.",
      overrides: { callPurpose: "payment_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "sound_judgement_to_withdraw" },
      expected: { purpose: "payment_follow_up", scope: "handling_only", handling: "needs_improvement", spiel: "not_assessable", reason: "payment_timing_policy_breach", policy: "payment_term_mismatch" }
    },
    {
      id: "promotion-live-seller-wrong-number",
      transcript: "Customer: No.\nAgent: Sorry, I am on the wrong number. Wrong number. Sorry.",
      quote: "Agent: Sorry, I am on the wrong number. Wrong number. Sorry.",
      overrides: { callPurpose: "terminal_no_contact", assessmentScope: "not_assessable", callHandlingQuality: "not_assessable", spielQuality: "not_assessable", primaryReasonCode: "insufficient_evidence" },
      unavailable: true,
      expected: { purpose: "other", scope: "handling_only", handling: "strong", spiel: "not_assessable", reason: "strong_execution" }
    },
    {
      id: "promotion-new-imprecise-callback",
      transcript: "Agent: I am calling on behalf of the SES volunteers about our project later this year.\nCustomer: Can I call you back later? Tomorrow, anytime.\nAgent: No worries. I will talk to you tomorrow.",
      quote: "Agent: No worries. I will talk to you tomorrow.",
      overrides: { callPurpose: "callback_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "new_offer", scope: "handling_only", handling: "acceptable", spiel: "not_assessable", reason: "minor_execution_gap" }
    },
    {
      id: "promotion-prior-precise-callback",
      transcript: "Agent: Thanks for returning my call from the other day.\nCustomer: Can you call me back at 5 pm?\nAgent: Perfect. I will call you back at 5 pm.",
      quote: "Agent: Perfect. I will call you back at 5 pm.",
      overrides: { callPurpose: "callback_follow_up", assessmentScope: "handling_only", callHandlingQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "callback_follow_up", scope: "handling_only", handling: "strong", spiel: "not_assessable", reason: "strong_execution" }
    },
    {
      id: "promotion-shareholder-decision",
      transcript: "Agent: We are asking for a $600 support advertisement in the handbook. Can we count you on board?\nCustomer: The middle option sounds good, but I cannot give you a straight answer because I have to talk to the other shareholders.\nAgent: I will send the information and follow up early next week.",
      quote: "Customer: The middle option sounds good, but I cannot give you a straight answer because I have to talk to the other shareholders.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "confirmation_gap", evidencePattern: /other shareholders/i }
    },
    {
      id: "promotion-accounting-team-decision",
      transcript: "Agent: We are looking for local businesses to help with a support ad in the yearbook.\nCustomer: Send everything in an email to my accounting team. I am not a person who can decide things like that.\nAgent: No worries. I will send it through.",
      quote: "Customer: Send everything in an email to my accounting team. I am not a person who can decide things like that.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "confirmation_gap", evidencePattern: /accounting team/i }
    },
    {
      id: "promotion-non-owner-decision-authority",
      transcript: "Agent: We are asking for a support advertisement in the SES journal.\nCustomer: I am not the owner or director of the company. I am just a sales rep in the area.\nAgent: No stress at all. I appreciate your time.",
      quote: "Customer: I am not the owner or director of the company. I am just a sales rep in the area.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "confirmation_gap", evidencePattern: /not the owner or director/i }
    },
    {
      id: "promotion-written-acceptance-after-request-only",
      transcript: "Agent: Did the earlier handbook get sent to the office?\nCustomer: I am not sure if it is sent to my employee yet.\nAgent: You are happy to support us again. Please reply to the text with the word agree.\nCustomer: No worries. Have a good day.",
      quote: "Agent: You are happy to support us again. Please reply to the text with the word agree.",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "renewal_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "confirmation_gap" }
    },
    {
      id: "promotion-respectful-guilt-pressure",
      transcript: "Agent: You supported the police magazine in the past. Could you support the renewal this year?\nCustomer: I am not going to be donating this year.\nAgent: Everyone says they support us, but no one wants to put their hand in their pocket. You would not? All right, never mind. All the best.",
      quote: "Agent: Everyone says they support us, but no one wants to put their hand in their pocket. You would not? All right, never mind. All the best.",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "acceptable", spielQuality: "acceptable", primaryReasonCode: "minor_execution_gap" },
      expected: { purpose: "renewal_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "minor_execution_gap" }
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    if (fixture.unavailable) {
      raw.status = "insufficient_evidence";
      raw.evidence_availability = "unavailable";
      raw.evidence = [];
      raw.strengths = [];
    }
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    const validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    assert.equal(validated.call_purpose, fixture.expected.purpose, fixture.id);
    assert.equal(validated.assessment_scope, fixture.expected.scope, fixture.id);
    assert.equal(validated.call_handling_quality, fixture.expected.handling, fixture.id);
    assert.equal(validated.spiel_quality, fixture.expected.spiel, fixture.id);
    assert.equal(validated.primary_reason_code, fixture.expected.reason, fixture.id);
    if (fixture.expected.policy) assert.equal(validated.policy_findings.some((item) => item.type === fixture.expected.policy), true, fixture.id);
    if (fixture.expected.evidencePattern) assert.match(validated.evidence.map((item) => item.quote).join(" "), fixture.expected.evidencePattern, fixture.id);
  }
});

test("Spiel Quality v3 applies chronological Qwen-safe facts to natural call language", () => {
  const cases = [
    {
      id: "qwen-renewal-before-administration",
      transcript: "Agent: You supported the police diary last year. Could the officers retain your support this year?\nCustomer: Yes, of course.\nAgent: Thank you for helping again. I will send the official tax invoice and confirmation. You still want to help out, correct?",
      quote: "Agent: Thank you for helping again. I will send the official tax invoice and confirmation. You still want to help out, correct?",
      overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "renewal_offer", scope: "spiel_and_handling", handling: "strong", spiel: "strong", reason: "strong_execution" }
    },
    {
      id: "qwen-completed-written-acceptance",
      transcript: "Agent: The community Bronze support is $550. Are you happy to support us?\nCustomer: Yes, that is correct. It might be easier for me to send the long email address through.\nAgent: I have sent the email. Please click I agree at the top.\nCustomer: Yep, it says thank you for your ongoing support and asks me to submit feedback below.",
      quote: "Customer: Yep, it says thank you for your ongoing support and asks me to submit feedback below.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "strong", spiel: "strong", reason: "strong_execution" }
    },
    {
      id: "qwen-no-means-payment-plan",
      transcript: "Agent: We are asking for a $440 support advertisement.\nCustomer: Please keep us in the loop for next year. We just registered and have no means at the moment.\nAgent: Admin can ring next week and work out a payment plan, including two or three part payments.",
      quote: "Agent: Admin can ring next week and work out a payment plan, including two or three part payments.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "needs_improvement", spiel: "needs_improvement", reason: "payment_timing_policy_breach", policy: "payment_term_mismatch" }
    },
    {
      id: "qwen-confirmation-follow-up-hardship",
      transcript: "Agent: We spoke last week and sent the official confirmation by SMS. Did you go through that confirmation?\nCustomer: Please put it on hold. I just started the business, it is up and down, and today I do not even have a job.\nAgent: Would a payment plan weekly, monthly, or fortnightly make it possible?",
      quote: "Agent: Would a payment plan weekly, monthly, or fortnightly make it possible?",
      overrides: { callPurpose: "new_offer", callHandlingQuality: "acceptable", spielQuality: "acceptable", primaryReasonCode: "sound_judgement_to_withdraw" },
      expected: { purpose: "administration", scope: "handling_only", handling: "needs_improvement", spiel: "not_assessable", reason: "payment_timing_policy_breach", policy: "payment_term_mismatch" }
    },
    {
      id: "qwen-customer-requested-part-payments",
      transcript: "Agent: The community support advertisement is $550.\nCustomer: I cannot afford the full amount today. Can I pay it in three part payments?\nAgent: Yes, our administration team can arrange the three part payments you requested.",
      quote: "Customer: I cannot afford the full amount today. Can I pay it in three part payments?",
      overrides: { callHandlingQuality: "acceptable", spielQuality: "acceptable", primaryReasonCode: "none", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "none", policyCount: 0 }
    },
    {
      id: "qwen-business-partner-controls-finance",
      transcript: "Agent: The support advertisement is $460.\nCustomer: You would have to go through my business partner to get that organised.\nAgent: I will call her because we cannot sort anything without her okay if she does the finances.",
      quote: "Customer: You would have to go through my business partner to get that organised.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "confirmation_gap" }
    },
    {
      id: "qwen-customer-wrong-number-seller-apology",
      transcript: "Customer: I do not know that business. This must be a wrong number.\nAgent: Oh, right. Okay. Sorry, mate. All right. Bye-bye. Cheers.",
      quote: "Customer: I do not know that business. This must be a wrong number.",
      overrides: { callPurpose: "terminal_no_contact", assessmentScope: "not_assessable", callHandlingQuality: "not_assessable", spielQuality: "not_assessable", primaryReasonCode: "insufficient_evidence", speaker: "customer" },
      expected: { purpose: "other", scope: "handling_only", handling: "strong", spiel: "not_assessable", reason: "strong_execution" }
    },
    {
      id: "qwen-respectful-financial-recovery",
      transcript: "Agent: We are asking for a community support advertisement.\nCustomer: I am not interested this time. Money is a bit too tight for me.\nAgent: I understand. The entry level is $460 if that helps.\nCustomer: I still cannot justify it at the moment.\nAgent: I appreciate your time. Have a wonderful rest of your day.",
      quote: "Agent: I appreciate your time. Have a wonderful rest of your day.",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      expected: { purpose: "new_offer", scope: "spiel_and_handling", handling: "acceptable", spiel: "acceptable", reason: "sound_judgement_to_withdraw" }
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    const validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    assert.equal(validated.call_purpose, fixture.expected.purpose, fixture.id);
    assert.equal(validated.assessment_scope, fixture.expected.scope, fixture.id);
    assert.equal(validated.call_handling_quality, fixture.expected.handling, fixture.id);
    assert.equal(validated.spiel_quality, fixture.expected.spiel, fixture.id);
    assert.equal(validated.primary_reason_code, fixture.expected.reason, fixture.id);
    if (fixture.expected.policy) assert.equal(validated.policy_findings.some((item) => item.type === fixture.expected.policy), true, fixture.id);
    if (fixture.expected.policyCount !== undefined) assert.equal(validated.policy_findings.length, fixture.expected.policyCount, fixture.id);
  }
});

test("Spiel Quality v3 abstains when Qwen cannot safely resolve purpose or payment permission", () => {
  const cases = [
    {
      id: "qwen-ambiguous-payment-permission",
      transcript: "Agent: The support package is $550.\nCustomer: I cannot afford that. Is there anything you can do to make it easier?\nAgent: We could arrange a payment plan over several months.",
      quote: "Customer: I cannot afford that. Is there anything you can do to make it easier?",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution", speaker: "customer" },
      reasonPattern: /ambiguous customer permission for payment flexibility/i
    },
    {
      id: "qwen-competing-follow-up-and-offer",
      transcript: "Agent: We spoke last week and I sent the official confirmation by SMS.\nCustomer: I wanted to put the earlier matter on hold.\nAgent: Would you like to go ahead with a new support advertisement today?",
      quote: "Agent: Would you like to go ahead with a new support advertisement today?",
      overrides: { callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" },
      reasonPattern: /competing existing-follow-up and fresh-offer purposes/i
    }
  ];

  for (const fixture of cases) {
    const raw = spielOutput(fixture, fixture.overrides);
    const reconciled = reconcileSpielQualityOutput({ result: raw, validationContext: { call: fixture } });
    const validated = validateSpielQualityResult({ result: reconciled.output, validationContext: { call: fixture } });
    assert.equal(validated.status, "insufficient_evidence", fixture.id);
    assert.equal(validated.assessment_scope, "not_assessable", fixture.id);
    assert.equal(validated.call_handling_quality, "not_assessable", fixture.id);
    assert.equal(validated.spiel_quality, "not_assessable", fixture.id);
    assert.equal(validated.primary_reason_code, "insufficient_evidence", fixture.id);
    assert.equal(validated.manager_review_recommended, true, fixture.id);
    assert.match(validated.limitations.join(" "), fixture.reasonPattern, fixture.id);
    const capability = reconciled.adjustments.find((item) => item.field === "automation_capability");
    assert.equal(capability?.to, "human_review_required", fixture.id);
  }
});

test("Spiel Quality v3 archives the prior Qwen template non-destructively", () => {
  const current = createDefaultEvaluationStudio();
  const active = current.evaluationTemplates.find((item) => item.evaluationGoal === SPIEL_QUALITY_GOAL);
  assert.equal(active.id, "template_spiel_quality_v3");
  assert.equal(active.version, 3);
  assert.match(active.instructions, /Qwen-safe capability boundary/i);
  const normalized = normalizeEvaluationStudio({
    ...current,
    evaluationTemplates: [{ ...active, id: "template_spiel_quality_v2", version: 2 }]
  });
  const previous = normalized.evaluationTemplates.find((item) => item.id === "template_spiel_quality_v2");
  const replacement = normalized.evaluationTemplates.find((item) => item.id === "template_spiel_quality_v3");
  assert.equal(previous.isActive, false);
  assert.equal(previous.status, "archived");
  assert.equal(replacement.isActive, true);
});

test("Spiel Quality results filter by handling band, Spiel band, purpose, and calibrated reason", () => {
  const fixtures = [
    { id: "filter-strong", quote: "Salesperson: I clearly presented the renewal offer.", transcript: "Salesperson: I clearly presented the renewal offer.", overrides: { callPurpose: "renewal_offer", callHandlingQuality: "strong", spielQuality: "strong", primaryReasonCode: "strong_execution" } },
    { id: "filter-acceptable", quote: "Salesperson: I will leave it there.", transcript: "Salesperson: I will leave it there.", overrides: { assessmentScope: "handling_only", callHandlingQuality: "acceptable", primaryReasonCode: "sound_judgement_to_withdraw" } },
    { id: "filter-payment", quote: "Salesperson: You said tomorrow, but I will record next month.", transcript: "Salesperson: You said tomorrow, but I will record next month.", overrides: { callHandlingQuality: "needs_improvement", spielQuality: "needs_improvement", improvement: "Preserve the customer's clear payment timing.", primaryReasonCode: "payment_timing_policy_breach", policyFinding: { type: "payment_term_mismatch", severity: "material", summary: "The timing was unnecessarily extended." }, dimensions: { payment_timing: "missed" } } }
  ];
  let studio = createDefaultEvaluationStudio();
  for (const fixture of fixtures) studio = storeFixture(studio, fixture, fixture.overrides).studio;

  assert.deepEqual(listEvaluationResults(studio, { spielCallHandlingQuality: "strong" }).map((row) => row.callId), ["filter-strong"]);
  assert.deepEqual(listEvaluationResults(studio, { spielSpielQuality: "not_assessable" }).map((row) => row.callId), ["filter-acceptable"]);
  assert.deepEqual(listEvaluationResults(studio, { spielCallPurpose: "renewal_offer" }).map((row) => row.callId), ["filter-strong"]);
  assert.deepEqual(listEvaluationResults(studio, { spielPrimaryReasonCode: "payment_timing_policy_breach" }).map((row) => row.callId), ["filter-payment"]);
});

test("Spiel Quality cards retain archived calibration detail without presenting an operational decision", () => {
  const fixture = {
    id: "spiel-display-call",
    quote: "Salesperson: You said next Wednesday, but I will record a few weeks.",
    transcript: "Salesperson: You said next Wednesday, but I will record a few weeks."
  };
  const saved = storeFixture(createDefaultEvaluationStudio(), fixture, {
    callHandlingQuality: "needs_improvement",
    spielQuality: "needs_improvement",
    improvement: "Preserve the customer's latest clear payment timing.",
    primaryReasonCode: "payment_timing_policy_breach",
    policyFinding: { type: "payment_term_mismatch", severity: "material", summary: "The payment timing was unnecessarily extended." },
    dimensions: { payment_timing: "missed" }
  });
  const analysis = analyzeCsvText([
    "call_id,customer_id,Salesperson,CustomerImportSource,call_date,call_time,call_duration_seconds,transcription_text",
    `spiel-display-call,customer-spiel-1,Test Seller,Test Source,2/07/2026,10:00:00,90,"${fixture.transcript}"`
  ].join("\n"));
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 1 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      offerAcceptanceReport: { totals: {}, bySalesperson: [], bySource: [], byDate: [] },
      foundationReport: { totals: {}, rates: {}, bySalesperson: [], bySource: [], byDate: [], byCalledOnBehalfOf: [] },
      resultQuery: { matchingResults: 1, matchingCalls: 1, offset: 0, limit: 25 },
      evaluationResults: [saved.result]
    }
  });

  assert.match(html, /Research only/);
  assert.match(html, /Historical spiel quality research output/i);
  assert.match(html, /Research-only calibration result/);
  assert.match(html, /Call handling quality[\s\S]*Needs Improvement/i);
  assert.match(html, /Payment Timing Policy Breach/);
  assert.match(html, /material payment term mismatch/i);
  assert.match(html, /not promoted for rankings, coaching, reporting, or operational decisions/i);
  assert.match(html, /name="spielCallHandlingQuality"/);
  assert.doesNotMatch(html, /spielCallHandlingQuality=needs_improvement/);
  assert.doesNotMatch(html, /handled the applicable part of the call in line with the calibrated standard/i);
});

test("Spiel Quality cards keep historical Qwen abstentions non-operational", () => {
  const fixture = {
    id: "spiel-capability-call",
    quote: "Customer: I cannot afford that. Is there anything you can do to make it easier?",
    transcript: "Agent: The support package is $550.\nCustomer: I cannot afford that. Is there anything you can do to make it easier?\nAgent: We could arrange a payment plan over several months."
  };
  const saved = storeFixture(createDefaultEvaluationStudio(), fixture, {
    callHandlingQuality: "strong",
    spielQuality: "strong",
    primaryReasonCode: "strong_execution",
    speaker: "customer"
  });
  assert.equal(saved.result.spielQualityAssessment.automationCapability, "human_review_required");
  const analysis = analyzeCsvText([
    "call_id,customer_id,Salesperson,CustomerImportSource,call_date,call_time,call_duration_seconds,transcription_text",
    `spiel-capability-call,customer-spiel-2,Test Seller,Test Source,2/07/2026,10:00:00,90,"${fixture.transcript}"`
  ].join("\n"));
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 1 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      offerAcceptanceReport: { totals: {}, bySalesperson: [], bySource: [], byDate: [] },
      foundationReport: { totals: {}, rates: {}, bySalesperson: [], bySource: [], byDate: [], byCalledOnBehalfOf: [] },
      resultQuery: { matchingResults: 1, matchingCalls: 1, offset: 0, limit: 25 },
      evaluationResults: [saved.result]
    }
  });

  assert.match(html, /Historical result was not scored/);
  assert.match(html, /archived evaluator withheld a score/i);
  assert.match(html, /does not create a human-review assignment/i);
  assert.doesNotMatch(html, /Human review required/);
  assert.doesNotMatch(html, /Spiel: Strong/);
});
