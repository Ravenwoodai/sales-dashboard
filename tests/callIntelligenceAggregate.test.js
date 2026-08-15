"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCallIntelligenceAggregate,
  parseSourceDate,
  resolveRelativeDate
} = require("../src/callIntelligenceAggregate");

function referenceResults() {
  return [
    {
      id: "foundation-48544948",
      callId: "48544948",
      evaluationGoal: "call_intelligence_foundation",
      status: "usable",
      confidence: 0.92,
      confidenceBand: "high",
      isLatest: true,
      managerSummary: "Customer agreed to a supported next step.",
      foundationAssessment: {
        schemaVersion: "call_intelligence_foundation.v3",
        customerOutcome: "callback_requested",
        nextStepStatus: "actionable",
        followUpTiming: "next Wednesday",
        calledOnBehalfOf: "ACT Emergency Service Volunteers",
        commercialContext: {
          product_or_package: "Emergency Response Volunteer Communication Journal",
          quoted_amount_available: true,
          quoted_amount: 450,
          currency: "AUD"
        },
        specialistRoutes: {
          offer_acceptance_classification: true,
          callback_opportunity: true,
          objection_handling: false,
          procedure_adherence: true,
          lead_record_disposition_evidence_audit: false
        },
        evidence: [{
          supports: "follow_up_timing",
          speaker: "customer",
          quote: "I get paid next Wednesday, so I'll be paying roughly by next Wednesday."
        }]
      }
    },
    {
      id: "offer-48544948",
      callId: "48544948",
      evaluationGoal: "offer_acceptance_classification",
      status: "usable",
      confidence: 0.95,
      confidenceBand: "high",
      evidenceAvailability: "available",
      isLatest: true,
      managerSummary: "Customer explicitly accepted the $450 offer.",
      acceptanceAssessment: {
        schemaVersion: "offer_acceptance_classification.v1",
        category: 3,
        classification: "customer_accepted_offer",
        customerCommitment: "explicit_unconditional_agreement",
        unresolvedCondition: false,
        offerEvidence: {
          speaker: "salesperson",
          quote: "It's a business card-sized coloured ad, which is only $450 for the whole year."
        },
        customerResponseEvidence: {
          speaker: "customer",
          quote: "Yeah. Sure, we'll do it, yeah."
        }
      }
    },
    {
      id: "procedure-48544948",
      callId: "48544948",
      evaluationGoal: "procedure_adherence",
      status: "usable",
      isLatest: true,
      specialistAssessment: { outcome: "evaluated_clear" }
    }
  ];
}

test("unpromoted reference results cannot establish a commercial lifecycle", () => {
  const results = referenceResults();
  const foundationContext = { ...results[0].foundationAssessment, sourceResultId: results[0].id };
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext,
    call: {
      callId: "48544948",
      customerId: "16830601",
      salesperson: "Justin Lucas",
      source: "GoogleMapsCWA",
      date: "02/07/2026",
      transcript: "Salesperson: It's a business card-sized coloured ad, which is only $450 for the whole year. Customer: Yeah. Sure, we'll do it, yeah. I get paid next Wednesday, so I'll be paying roughly by next Wednesday.",
      followUpStatus: "later_attempt_observed",
      followUpMatch: {
        status: "later_attempt_observed",
        matchedCallId: "48563295",
        matchMethod: "exact_stable_identifier",
        completionState: "not_established",
        paymentState: "not_established"
      }
    }
  });

  assert.equal(aggregate.commercialState.offerState, "unknown");
  assert.equal(aggregate.commercialState.acceptanceStrength, "unknown");
  assert.equal(aggregate.commercialState.quotedValue, null);
  assert.equal(aggregate.commercialState.quotedCurrency, "unknown");
  assert.equal(aggregate.commercialState.currencyBasis, "unknown");
  assert.equal(aggregate.commercialState.paymentState, "not_established");
  assert.equal(aggregate.commercialState.intendedPaymentDateRaw, "");
  assert.equal(aggregate.commercialState.intendedPaymentDateResolved, "");
  assert.equal(aggregate.commercialState.paymentVerificationState, "not_verified");
  assert.equal(aggregate.commercialState.invoiceState, "unknown");
  assert.equal(aggregate.commercialState.fulfilmentState, "unknown");
  assert.equal(aggregate.commercialState.revenueState, "unknown");
  assert.equal(aggregate.commercialState.crmState, "unknown");
  assert.equal(aggregate.followUp.completionState, "not_established");
  assert.equal(aggregate.decisionBasis.evaluationGoal, "none");
  assert.equal(aggregate.decisionBasis.authorityStatus, "no_promoted_capability");
  assert.match(aggregate.decisionBasis.summary, /No promoted evaluator/);
  assert.equal(aggregate.keyEvidence.offer, "");
  assert.equal(aggregate.keyEvidence.acceptance, "");
  assert.equal(aggregate.keyEvidence.paymentTiming, "");
});

test("unpromoted Foundation and Offer Acceptance disagreement is not operationally resolved", () => {
  const results = referenceResults();
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026" }
  });
  assert.equal(aggregate.conflicts.length, 0);
  assert.equal(aggregate.decisionBasis.authorityStatus, "no_promoted_capability");
});

test("unpromoted specialist outputs cannot create routing states", () => {
  const results = referenceResults();
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026" }
  });
  assert.equal(aggregate.routing.offer_acceptance_classification.state, "not_evaluated");
  assert.equal(aggregate.routing.callback_opportunity.state, "not_evaluated");
  assert.equal(aggregate.routing.procedure_adherence.state, "not_evaluated");
  assert.equal(aggregate.routing.objection_handling.state, "not_evaluated");
  assert.equal(aggregate.routing.lead_record_disposition_evidence_audit.state, "not_evaluated");
});

test("historical untyped specialist results are not presented as evaluated clear", () => {
  const results = referenceResults().filter((result) => result.evaluationGoal !== "procedure_adherence");
  results.push({
    id: "legacy-procedure",
    callId: "48544948",
    evaluationGoal: "procedure_adherence",
    status: "usable",
    isLatest: true,
    evaluationAudit: { validationStatus: "legacy_generic_contract" },
    findings: [{ field: "result", value: "string" }]
  });
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026" }
  });
  assert.equal(aggregate.routing.procedure_adherence.state, "not_evaluated");
});

test("Australian source dates are parsed as DD/MM/YYYY and relative weekdays retain ambiguity metadata", () => {
  assert.equal(parseSourceDate({ date: "02/07/2026" }).toISOString().slice(0, 10), "2026-07-02");
  const resolved = resolveRelativeDate("next Wednesday", { date: "02/07/2026", time: "11:08:32" });
  assert.equal(resolved.sourceDate, "2026-07-02");
  assert.equal(resolved.resolvedDate, "2026-07-08");
  assert.equal(resolved.timeZoneBasis, "Source call time (AEST)");
  assert.equal(resolved.resolutionStatus, "resolved_with_policy");
  assert.equal(resolved.ambiguity, "possible");
  assert.equal(resolveRelativeDate("tomorrow", { date: "31/12/2026" }).resolvedDate, "2027-01-01");
});

test("unknown timing remains unknown rather than becoming a negative commercial claim", () => {
  const aggregate = buildCallIntelligenceAggregate({ results: [], call: { date: "02/07/2026" } });
  assert.equal(aggregate.commercialState.offerState, "unknown");
  assert.equal(aggregate.commercialState.paymentState, "not_established");
  assert.equal(aggregate.commercialState.quotedValue, null);
  assert.equal(aggregate.commercialState.intendedPaymentDateResolved, "");
  assert.equal(aggregate.decisionBasis.evaluationGoal, "none");
});

test("unpromoted transcript amounts cannot enter commercial state", () => {
  const results = referenceResults();
  results[0].foundationAssessment.commercialContext.quoted_amount = 990000;
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026", transcript: "Salesperson: The quoted amount is $990,000. Customer: Sure, we'll do it." }
  });
  assert.equal(aggregate.commercialState.quotedValue, null);
  assert.equal(aggregate.commercialState.quotedValueReviewRequired, false);
  assert.equal(aggregate.provenanceClaims.find((claim) => claim.claimType === "quoted_value").validationStatus, "unknown");
  assert.match(aggregate.decisionBasis.summary, /No promoted evaluator/);
});
