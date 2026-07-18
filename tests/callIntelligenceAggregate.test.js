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

test("reference call separates accepted offer, intended payment, and unverified commercial lifecycle states", () => {
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

  assert.equal(aggregate.commercialState.offerState, "accepted_offer_signal");
  assert.equal(aggregate.commercialState.acceptanceStrength, "explicit");
  assert.equal(aggregate.commercialState.quotedValue, 450);
  assert.equal(aggregate.commercialState.quotedCurrency, "AUD");
  assert.equal(aggregate.commercialState.currencyBasis, "metadata_inferred");
  assert.equal(aggregate.commercialState.paymentState, "customer_stated_intention");
  assert.equal(aggregate.commercialState.intendedPaymentDateRaw, "next Wednesday");
  assert.equal(aggregate.commercialState.intendedPaymentDateResolved, "2026-07-08");
  assert.equal(aggregate.commercialState.paymentVerificationState, "not_verified");
  assert.equal(aggregate.commercialState.invoiceState, "unknown");
  assert.equal(aggregate.commercialState.fulfilmentState, "unknown");
  assert.equal(aggregate.commercialState.revenueState, "unknown");
  assert.equal(aggregate.commercialState.crmState, "unknown");
  assert.equal(aggregate.followUp.completionState, "not_established");
  assert.match(aggregate.authoritativeResult.summary, /Accepted offer — payment pending verification/);
  assert.match(aggregate.authoritativeResult.summary, /not established/);
  assert.match(aggregate.keyEvidence.offer, /\$450/);
  assert.match(aggregate.keyEvidence.acceptance, /we'll do it/i);
  assert.match(aggregate.keyEvidence.paymentTiming, /next Wednesday/i);
});

test("Foundation and authoritative Offer Acceptance disagreement is recorded with its resolution rule", () => {
  const results = referenceResults();
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026" }
  });
  assert.equal(aggregate.conflicts.length, 1);
  assert.equal(aggregate.conflicts[0].type, "foundation_specialist_acceptance_disagreement");
  assert.equal(aggregate.conflicts[0].resolutionRule, "offer_acceptance_specialist_authoritative");
  assert.equal(aggregate.conflicts[0].resolvedValue, "customer_accepted_offer");
});

test("specialist routing distinguishes not routed, pending, evaluated clear, and evaluated issue", () => {
  const results = referenceResults();
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026" }
  });
  assert.equal(aggregate.routing.offer_acceptance_classification.state, "evaluated_issue_found");
  assert.equal(aggregate.routing.callback_opportunity.state, "routed_pending");
  assert.equal(aggregate.routing.procedure_adherence.state, "evaluated_clear");
  assert.equal(aggregate.routing.objection_handling.state, "not_routed_no_trigger");
  assert.equal(aggregate.routing.lead_record_disposition_evidence_audit.state, "not_routed_no_trigger");
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
  assert.equal(aggregate.routing.procedure_adherence.state, "evaluated_legacy_untyped");
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
  assert.equal(aggregate.authoritativeResult.evaluationGoal, "none");
});

test("implausibly large transcript amounts remain raw context but require review", () => {
  const results = referenceResults();
  results[0].foundationAssessment.commercialContext.quoted_amount = 990000;
  const aggregate = buildCallIntelligenceAggregate({
    results,
    foundationContext: { ...results[0].foundationAssessment, sourceResultId: results[0].id },
    call: { date: "02/07/2026", transcript: "Salesperson: The quoted amount is $990,000. Customer: Sure, we'll do it." }
  });
  assert.equal(aggregate.commercialState.quotedValue, 990000);
  assert.equal(aggregate.commercialState.quotedValueReviewRequired, true);
  assert.equal(aggregate.provenanceClaims.find((claim) => claim.claimType === "quoted_value").validationStatus, "implausible_transcript_amount_review_required");
  assert.match(aggregate.authoritativeResult.summary, /requires review before use/i);
});
