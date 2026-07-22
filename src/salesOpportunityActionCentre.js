"use strict";

const {
  CALL_INTELLIGENCE_FOUNDATION_GOAL,
  CALL_INTELLIGENCE_FOUNDATION_SCHEMA_VERSION,
  CALLBACK_OPPORTUNITY_GOAL,
  CALLBACK_OPPORTUNITY_SCHEMA_VERSION,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION,
  OBJECTION_HANDLING_GOAL,
  OBJECTION_HANDLING_SCHEMA_VERSION,
  OFFER_ACCEPTANCE_GOAL,
  OFFER_ACCEPTANCE_SCHEMA_VERSION,
  PROCEDURE_ADHERENCE_GOAL,
  PROCEDURE_ADHERENCE_SCHEMA_VERSION,
  normalizeEvaluationStudio
} = require("./evaluationStudio");
const {
  isOperationalEvaluationResult,
  localModelCapabilitySummary
} = require("./localModelCapability");

const SCHEMA_VERSION = "sales_dashboard_sales_opportunity_action_centre.v1";
const MINIMUM_COMPARISON_SAMPLE = 30;

const STAGES = Object.freeze([
  { key: "transcript_available", label: "Transcript available", denominatorKey: "all_calls", denominatorLabel: "all filtered calls" },
  { key: "live_contact", label: "Live contact", denominatorKey: "foundation_evaluated", denominatorLabel: "current Foundation-evaluated calls" },
  { key: "confirmed_decision_maker", label: "Confirmed decision-maker", denominatorKey: "foundation_evaluated", denominatorLabel: "current Foundation-evaluated calls" },
  { key: "offer_presented", label: "Offer presented", denominatorKey: "measurement_eligible", denominatorLabel: "Foundation measurement-eligible calls" },
  { key: "actionable_opportunity", label: "Actionable opportunity", denominatorKey: "measurement_eligible", denominatorLabel: "Foundation measurement-eligible calls" },
  { key: "follow_up_only", label: "Follow-up only", denominatorKey: "offer_classified", denominatorLabel: "promoted Offer Acceptance classifications" },
  { key: "accepted_offer", label: "Accepted offer", denominatorKey: "offer_classified", denominatorLabel: "promoted Offer Acceptance classifications" }
]);

const QUEUES = Object.freeze([
  { key: "accepted_admin_verification", label: "Accepted offers requiring admin verification", action: "Verify the accepted offer in the administration or CRM record, then confirm payment and fulfilment separately.", priority: "urgent" },
  { key: "callback_clear_timing", label: "Callbacks with clear timing", action: "Schedule the agreed follow-up using the transcript-grounded timing and preserve the customer context.", priority: "high" },
  { key: "callback_missing_timing", label: "Callbacks without clear timing", action: "Set a specific follow-up time and owner before the opportunity loses context.", priority: "high" },
  { key: "information_review_unresolved", label: "Information or review requests unresolved", action: "Send or confirm the requested information, then obtain a clear decision or next step.", priority: "high" },
  { key: "offer_without_next_step", label: "Offers without an actionable next step", action: "Re-contact the customer and agree a specific next action, channel, owner, and timing.", priority: "medium" },
  { key: "decision_maker_without_offer", label: "Decision-makers reached without an offer", action: "Review why the conversation ended before an offer and decide whether a supported re-contact is appropriate.", priority: "medium" },
  { key: "objection_or_procedure_gap", label: "Objection or procedure handling gaps", action: "Review the exact evidence with the salesperson and agree a targeted coaching or process correction.", priority: "medium" },
  { key: "evidence_or_record_review", label: "Evidence or record issues requiring review", action: "Review the transcript evidence and source record before changing any disposition or operational status.", priority: "review" }
]);

function clean(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function percent(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function callIdOf(call = {}) {
  return clean(call.callId || call.call_id);
}

function uniqueLatestByCall(results = []) {
  const byCall = new Map();
  results.slice().sort((left, right) =>
    Number(right.templateVersion || 0) - Number(left.templateVersion || 0)
      || String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))
  ).forEach((result) => {
    if (result.callId && !byCall.has(result.callId)) byCall.set(result.callId, result);
  });
  return byCall;
}

function activeTemplateId(studio, goal) {
  return (studio.evaluationTemplates || [])
    .filter((template) => template.isActive && template.evaluationGoal === goal)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0]?.id || "";
}

function currentResultMap(studio, importId, callIds, goal, validator = () => true) {
  const results = (studio.evaluationResults || []).filter((result) => {
    if (result.isLatest === false || result.containsUntrustedLegacyData) return false;
    if (!isOperationalEvaluationResult(result)) return false;
    if (importId && result.importId !== importId) return false;
    if (callIds && !callIds.has(result.callId)) return false;
    if (result.evaluationGoal !== goal) return false;
    return validator(result);
  });
  if (goal === CALL_INTELLIGENCE_FOUNDATION_GOAL) {
    const templateId = activeTemplateId(studio, goal);
    const current = templateId ? results.filter((result) => result.templateId === templateId) : results;
    return uniqueLatestByCall(current);
  }
  return uniqueLatestByCall(results);
}

function evidenceItems(result = {}, assessment = {}) {
  const direct = Array.isArray(assessment.evidence) ? assessment.evidence : [];
  const offer = assessment.offerEvidence?.quote ? [{ claimType: "offer", speaker: assessment.offerEvidence.speaker, quote: assessment.offerEvidence.quote }] : [];
  const response = assessment.customerResponseEvidence?.quote ? [{ claimType: "customer_response", speaker: assessment.customerResponseEvidence.speaker, quote: assessment.customerResponseEvidence.quote }] : [];
  const canonical = [...offer, ...response, ...direct];
  const fallbackFindings = canonical.length ? [] : (result.findings || []).map((finding) => ({
    claimType: finding.field,
    speaker: "unknown",
    quote: finding.evidence
  }));
  return [...canonical, ...fallbackFindings].map((item) => ({
    claimType: clean(item.claimType || item.claim_type || item.supports || "evidence"),
    speaker: clean(item.speaker || "unknown"),
    quote: clean(item.quote)
  })).filter((item) => item.quote);
}

function proofFor(...sources) {
  const seen = new Set();
  const proof = [];
  sources.flat().forEach((item) => {
    if (!item?.quote) return;
    const key = item.quote.toLowerCase();
    if (seen.has(key) || proof.length >= 3) return;
    seen.add(key);
    proof.push(item);
  });
  return proof;
}

function isLiveContact(contactResult) {
  return ["live_decision_maker", "live_non_decision_maker", "gatekeeper", "other_live_contact"].includes(clean(contactResult));
}

function resultAuthority(result, label) {
  return result ? {
    type: "promoted_typed_evaluation",
    label: `${label} — promoted capability`,
    resultId: result.id,
    templateId: result.templateId,
    schemaVersion: result.evaluationAudit?.schemaVersion || result.foundationAssessment?.schemaVersion || result.acceptanceAssessment?.schemaVersion || result.specialistAssessment?.schemaVersion || result.auditAssessment?.schemaVersion || "",
    updatedAt: result.updatedAt || result.createdAt || ""
  } : null;
}

function groupRows(records, field, foundationIds, offerIds, minimumSample) {
  const groups = new Map();
  records.forEach((record) => {
    const label = clean(record[field]) || "Not supplied";
    const row = groups.get(label) || { label, calls: 0, transcripts: 0, foundationEvaluated: 0, measurementEligible: 0, offerClassified: 0, offers: 0, actionable: 0, followUpOnly: 0, accepted: 0 };
    row.calls += 1;
    if (record.stageKeys.includes("transcript_available")) row.transcripts += 1;
    if (foundationIds.has(record.callId)) row.foundationEvaluated += 1;
    if (record.measurementEligible) row.measurementEligible += 1;
    if (offerIds.has(record.callId)) row.offerClassified += 1;
    if (record.stageKeys.includes("offer_presented")) row.offers += 1;
    if (record.stageKeys.includes("actionable_opportunity")) row.actionable += 1;
    if (offerIds.has(record.callId) && record.stageKeys.includes("follow_up_only")) row.followUpOnly += 1;
    if (offerIds.has(record.callId) && record.stageKeys.includes("accepted_offer")) row.accepted += 1;
    groups.set(label, row);
  });
  return Array.from(groups.values()).map((row) => ({
    ...row,
    foundationCoverageRate: percent(row.foundationEvaluated, row.transcripts),
    opportunityRate: percent(row.actionable, row.measurementEligible),
    acceptanceRate: percent(row.accepted, row.offerClassified),
    comparisonEligible: row.foundationEvaluated >= minimumSample,
    sampleWarning: row.foundationEvaluated >= minimumSample ? "" : `Below the ${minimumSample}-call Foundation sample threshold.`
  })).sort((left, right) => left.label.localeCompare(right.label));
}

function buildSalesOpportunityActionCentre(input = {}) {
  const studioInput = input.studio || {};
  const studio = Array.isArray(studioInput.evaluationResults) && Array.isArray(studioInput.evaluationTemplates)
    ? studioInput
    : normalizeEvaluationStudio(studioInput);
  const calls = Array.isArray(input.calls) ? input.calls : [];
  const importId = clean(input.importId);
  const minimumSample = Number(input.minimumSample || MINIMUM_COMPARISON_SAMPLE);
  const callIds = new Set(calls.map(callIdOf).filter(Boolean));
  let capabilityPolicy;
  try {
    capabilityPolicy = localModelCapabilitySummary();
  } catch (error) {
    capabilityPolicy = {
      programStatus: "register_unavailable",
      operationalConsumptionPermitted: false,
      error: error.message
    };
  }
  const foundationByCall = currentResultMap(studio, importId, callIds, CALL_INTELLIGENCE_FOUNDATION_GOAL,
    (result) => result.foundationAssessment?.schemaVersion === CALL_INTELLIGENCE_FOUNDATION_SCHEMA_VERSION);
  const offerByCall = currentResultMap(studio, importId, callIds, OFFER_ACCEPTANCE_GOAL,
    (result) => result.status === "usable" && result.acceptanceAssessment?.schemaVersion === OFFER_ACCEPTANCE_SCHEMA_VERSION);
  const callbackByCall = currentResultMap(studio, importId, callIds, CALLBACK_OPPORTUNITY_GOAL,
    (result) => result.status === "usable" && result.specialistAssessment?.schemaVersion === CALLBACK_OPPORTUNITY_SCHEMA_VERSION && result.evaluationAudit?.validationStatus !== "legacy_generic_contract");
  const objectionByCall = currentResultMap(studio, importId, callIds, OBJECTION_HANDLING_GOAL,
    (result) => result.status === "usable" && result.specialistAssessment?.schemaVersion === OBJECTION_HANDLING_SCHEMA_VERSION && result.evaluationAudit?.validationStatus !== "legacy_generic_contract");
  const procedureByCall = currentResultMap(studio, importId, callIds, PROCEDURE_ADHERENCE_GOAL,
    (result) => result.status === "usable" && result.specialistAssessment?.schemaVersion === PROCEDURE_ADHERENCE_SCHEMA_VERSION && result.evaluationAudit?.validationStatus !== "legacy_generic_contract");
  const auditByCall = currentResultMap(studio, importId, callIds, LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
    (result) => result.auditAssessment?.schemaVersion === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_SCHEMA_VERSION);
  const leadHarvestByCall = new Map((input.leadHarvestRecords || []).map((record) => [callIdOf(record), record]));

  const records = calls.map((call) => {
    const callId = callIdOf(call);
    const foundationResult = foundationByCall.get(callId);
    const foundation = foundationResult?.foundationAssessment || null;
    const offerResult = offerByCall.get(callId);
    const offer = offerResult?.acceptanceAssessment || null;
    const callbackResult = callbackByCall.get(callId);
    const callback = callbackResult?.specialistAssessment || null;
    const objectionResult = objectionByCall.get(callId);
    const objection = objectionResult?.specialistAssessment || null;
    const procedureResult = procedureByCall.get(callId);
    const procedure = procedureResult?.specialistAssessment || null;
    const auditResult = auditByCall.get(callId);
    const audit = auditResult?.auditAssessment || null;
    const harvest = leadHarvestByCall.get(callId) || null;
    const lenses = foundation?.intelligenceLenses || {};
    const stageKeys = [];
    if (clean(call.transcript)) stageKeys.push("transcript_available");
    if (foundation) stageKeys.push("foundation_evaluated");
    if (foundation && Object.values(foundation.specialistRoutes || {}).some(Boolean)) stageKeys.push("specialist_routed");
    if (offerResult || callbackResult || objectionResult || procedureResult || auditResult) stageKeys.push("typed_specialist");
    if (foundation && isLiveContact(foundation.contactResult)) stageKeys.push("live_contact");
    if (foundation?.decisionMakerStatus === "confirmed") stageKeys.push("confirmed_decision_maker");
    if (foundation?.offerPresented || offer?.offerPresented) stageKeys.push("offer_presented");
    if (["actionable", "accepted"].includes(lenses.opportunity_status)) stageKeys.push("actionable_opportunity");
    if (lenses.measurement_eligibility === "eligible") stageKeys.push("measurement_eligible");
    if (offer?.classification === "interested_follow_up_only") stageKeys.push("follow_up_only");
    if (offer?.classification === "customer_accepted_offer") stageKeys.push("accepted_offer");
    if (offerResult) stageKeys.push("offer_classified");

    const queueKeys = [];
    if (offer?.classification === "customer_accepted_offer") queueKeys.push("accepted_admin_verification");
    const foundationCallbackCandidate = Boolean(foundation?.specialistRoutes?.[CALLBACK_OPPORTUNITY_GOAL])
      && foundation?.customerOutcome !== "long_term_nurture";
    const typedCallback = callback && ["requested", "promised", "timing_only"].includes(callback.callbackState);
    const callbackTiming = clean(callback?.timingRaw || (foundationCallbackCandidate ? foundation?.followUpTiming : ""));
    if ((typedCallback || (!callbackResult && foundationCallbackCandidate)) && callbackTiming) queueKeys.push("callback_clear_timing");
    if ((typedCallback || (!callbackResult && foundationCallbackCandidate)) && !callbackTiming) queueKeys.push("callback_missing_timing");
    if (offer?.classification === "interested_follow_up_only" && (
      offer.customerCommitment === "conditional_or_pending"
      || foundation?.customerOutcome === "information_requested"
      || foundation?.customerOutcome === "conditional_interest"
    )) queueKeys.push("information_review_unresolved");
    if (foundation?.offerPresented && ["none", "vague", "unknown"].includes(foundation.nextStepStatus) && offer?.classification !== "customer_accepted_offer") queueKeys.push("offer_without_next_step");
    if (foundation?.decisionMakerStatus === "confirmed" && !foundation.offerPresented) queueKeys.push("decision_maker_without_offer");
    if (["handling_gap", "partially_handled"].includes(objection?.outcome) || procedure?.outcome === "issue_found") queueKeys.push("objection_or_procedure_gap");
    const auditReview = audit && (
      audit.recommendation && audit.recommendation !== "no_action"
      || ["supported_invalidity", "supported_operational_unusability", "contradictory_evidence", "untestable"].includes(audit.recordEvidence?.classification)
    );
    if (auditReview || (!auditResult && foundation?.specialistRoutes?.[LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL])) queueKeys.push("evidence_or_record_review");

    const selectedQueue = QUEUES.find((queue) => queueKeys.includes(queue.key));
    const evidence = proofFor(
      offerResult ? evidenceItems(offerResult, offer) : [],
      callbackResult ? evidenceItems(callbackResult, callback) : [],
      objectionResult ? evidenceItems(objectionResult, objection) : [],
      procedureResult ? evidenceItems(procedureResult, procedure) : [],
      auditResult ? evidenceItems(auditResult, audit) : [],
      foundationResult ? evidenceItems(foundationResult, foundation) : []
    );
    const decisionAuthorities = [
      resultAuthority(offerResult, "Offer Acceptance"),
      resultAuthority(callbackResult, "Callback Opportunity"),
      resultAuthority(objectionResult, "Objection Handling"),
      resultAuthority(procedureResult, "Procedure Adherence"),
      resultAuthority(auditResult, "Lead Record Evidence Audit"),
      resultAuthority(foundationResult, "Call Intelligence Foundation")
    ].filter(Boolean);
    if (!callbackResult && foundationCallbackCandidate) decisionAuthorities.unshift({
      type: "foundation_candidate_pending_specialist",
      label: "Foundation callback candidate — typed Callback Opportunity evaluation pending",
      resultId: foundationResult.id,
      templateId: foundationResult.templateId,
      schemaVersion: foundation.schemaVersion,
      updatedAt: foundationResult.updatedAt || foundationResult.createdAt || ""
    });
    if (!auditResult && foundation?.specialistRoutes?.[LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL]) decisionAuthorities.unshift({
      type: "foundation_candidate_pending_specialist",
      label: "Foundation record-review candidate — typed Lead Record Evidence Audit pending",
      resultId: foundationResult.id,
      templateId: foundationResult.templateId,
      schemaVersion: foundation.schemaVersion,
      updatedAt: foundationResult.updatedAt || foundationResult.createdAt || ""
    });
    const strongestResult = offerResult || callbackResult || objectionResult || procedureResult || auditResult || foundationResult;
    return {
      callId,
      customerId: clean(call.customerId || call.customer_id) || "Not available",
      salesperson: clean(call.salesperson) || "Not supplied",
      source: clean(call.source || call.customerImportSource) || "Not supplied",
      date: clean(call.date) || "Not supplied",
      sourceTime: clean(call.sourceTime || call.date) || "Not supplied",
      businessSegment: clean(call.businessSegment) || "Not supplied",
      representedOrganisation: clean(foundation?.calledOnBehalfOf) || "Not captured",
      productOrPackage: clean(foundation?.commercialContext?.product_or_package) || "Not captured",
      quotedAmountAvailable: Boolean(foundation?.commercialContext?.quoted_amount_available),
      quotedAmount: foundation?.commercialContext?.quoted_amount_available ? Number(foundation.commercialContext.quoted_amount || 0) : null,
      currency: clean(foundation?.commercialContext?.currency) || "unknown",
      callbackTiming: callbackTiming || "Not captured",
      recommendedAction: selectedQueue?.action || "No action queue assigned from current evidence.",
      priority: selectedQueue?.priority || "none",
      stageKeys,
      queueKeys,
      measurementEligible: lenses.measurement_eligibility === "eligible",
      evidenceStrength: strongestResult?.confidenceBand || "not evaluated",
      evidenceAvailability: strongestResult?.evidenceAvailability || "not evaluated",
      proof: evidence,
      decisionAuthorities,
      typedSpecialists: {
        offerAcceptance: Boolean(offerResult),
        callbackOpportunity: Boolean(callbackResult),
        objectionHandling: Boolean(objectionResult),
        procedureAdherence: Boolean(procedureResult),
        leadRecordAudit: Boolean(auditResult)
      },
      laterCallStatus: harvest?.status === "later_matching_call_observed" ? "Later matching call observed within uploaded data" : harvest ? "No later matching call observed within uploaded data window" : "Not assessed for deterministic later-call linkage",
      laterCallId: clean(harvest?.laterMatchingCallId),
      acceptedOfferState: offer?.classification === "customer_accepted_offer" ? "accepted_offer_signal" : "not_established",
      paymentState: "not_verified",
      fulfilmentState: "unknown",
      recognisedRevenueState: "unknown",
      crmWonState: "unknown"
    };
  });

  const denominatorCounts = {
    all_calls: records.length,
    foundation_evaluated: foundationByCall.size,
    measurement_eligible: records.filter((record) => record.measurementEligible).length,
    offer_classified: offerByCall.size
  };
  const funnel = STAGES.map((stage) => {
    const count = records.filter((record) => record.stageKeys.includes(stage.key)).length;
    const denominator = denominatorCounts[stage.denominatorKey] || 0;
    return { ...stage, count, denominator, rate: percent(count, denominator) };
  });
  const actionQueues = QUEUES.map((queue) => {
    const count = records.filter((record) => record.queueKeys.includes(queue.key)).length;
    return { ...queue, count, rate: percent(count, Math.max(1, foundationByCall.size)) };
  });
  const transcriptCalls = denominatorCounts.all_calls ? funnel.find((row) => row.key === "transcript_available").count : 0;
  const byDate = groupRows(records, "date", foundationByCall, offerByCall, minimumSample);
  const coverageRate = percent(foundationByCall.size, transcriptCalls);
  const datesWithTranscripts = byDate.filter((row) => row.transcripts > 0);
  const maxDateShare = transcriptCalls ? Math.max(0, ...datesWithTranscripts.map((row) => row.transcripts / transcriptCalls)) : 0;
  const largestFoundationDate = byDate.slice().sort((left, right) => right.foundationEvaluated - left.foundationEvaluated)[0] || null;
  const largestFoundationDateShare = foundationByCall.size ? Number(largestFoundationDate?.foundationEvaluated || 0) / foundationByCall.size : 0;
  const typedResultsByGoal = {
    [OFFER_ACCEPTANCE_GOAL]: offerByCall,
    [CALLBACK_OPPORTUNITY_GOAL]: callbackByCall,
    [OBJECTION_HANDLING_GOAL]: objectionByCall,
    [PROCEDURE_ADHERENCE_GOAL]: procedureByCall,
    [LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL]: auditByCall
  };
  let routedChecks = 0;
  let currentTypedChecks = 0;
  Array.from(foundationByCall.values()).forEach((result) => {
    Object.entries(result.foundationAssessment?.specialistRoutes || {}).forEach(([goal, routed]) => {
      if (!routed) return;
      routedChecks += 1;
      if (typedResultsByGoal[goal]?.has(result.callId)) currentTypedChecks += 1;
    });
  });
  const availableTypedSpecialistDecisions = callbackByCall.size + objectionByCall.size + procedureByCall.size + auditByCall.size + offerByCall.size;
  const warnings = [];
  if (!capabilityPolicy.operationalConsumptionPermitted) warnings.push("Local-model capability quarantine is active. Historical evaluator results are research-only and excluded from every action queue, denominator, and authority decision.");
  if (coverageRate !== null && coverageRate < 0.8) warnings.push(`Current Foundation coverage is ${(coverageRate * 100).toFixed(1)}% of transcript-bearing calls. The evaluated sample is partial and must not be described as representative.`);
  if (largestFoundationDateShare > 0.5) warnings.push(`${(largestFoundationDateShare * 100).toFixed(1)}% of current Foundation results fall on ${largestFoundationDate?.label || "one source date"}; the evaluated cohort is chronologically concentrated.`);
  if (datesWithTranscripts.length < 7) warnings.push(`The uploaded cohort spans ${datesWithTranscripts.length} source dates with transcripts, which is too narrow for stable trend claims.`);
  if (routedChecks > currentTypedChecks) warnings.push(`Typed specialist recovery is incomplete: ${currentTypedChecks} current typed specialist decisions are available for ${routedChecks} routed checks. Foundation-only candidates remain labelled pending specialist review.`);
  warnings.push("No later call observed means only that no stable-ID match was found inside the uploaded data window; it is not proof of a missed or overdue follow-up.");
  const readyForPerformanceComparison = Boolean(capabilityPolicy.operationalConsumptionPermitted
    && coverageRate >= 0.8
    && largestFoundationDateShare <= 0.5
    && datesWithTranscripts.length >= 7
    && routedChecks <= currentTypedChecks);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    importId,
    capabilityBoundary: {
      programStatus: capabilityPolicy.programStatus,
      operationalConsumptionPermitted: Boolean(capabilityPolicy.operationalConsumptionPermitted),
      registerHash: capabilityPolicy.registerHash || "",
      message: capabilityPolicy.operationalConsumptionPermitted
        ? "Only exact promoted capabilities contribute to this view."
        : "No local-model evaluator is promoted. Historical results are visible only in Evaluation Studio research history."
    },
    definitions: {
      funnel: "Only deterministic transcript availability and independently promoted evaluator decisions may contribute. Current unpromoted evaluator history is excluded.",
      acceptedOffer: "No operational accepted-offer signal is available until Offer Acceptance passes an independent promotion gate with exact provenance.",
      candidateAuthority: "Foundation and specialist outputs are research-only until their exact capabilities are promoted. They cannot create candidates or actions.",
      laterCall: "Later-call status is limited to stable-ID matches within the uploaded data window."
    },
    coverage: {
      allCalls: records.length,
      transcriptCalls,
      foundationEvaluated: foundationByCall.size,
      foundationCoverageRate: coverageRate,
      measurementEligible: denominatorCounts.measurement_eligible,
      offerClassified: offerByCall.size,
      routedSpecialistChecks: routedChecks,
      currentTypedSpecialistDecisions: currentTypedChecks,
      availableTypedSpecialistDecisions,
      sourceDatesWithTranscripts: datesWithTranscripts.length,
      largestDateShare: maxDateShare,
      largestSourceDate: datesWithTranscripts.slice().sort((left, right) => right.transcripts - left.transcripts)[0]?.label || "",
      largestFoundationDateShare,
      largestFoundationSourceDate: largestFoundationDate?.label || "",
      minimumComparisonSample: minimumSample,
      readyForPerformanceComparison,
      readinessLabel: readyForPerformanceComparison ? "Ready for cautious cohort comparison" : "Not ready for representative performance ranking",
      warnings
    },
    funnel: capabilityPolicy.operationalConsumptionPermitted ? funnel : funnel.filter((row) => row.key === "transcript_available"),
    actionQueues: capabilityPolicy.operationalConsumptionPermitted ? actionQueues : [],
    cohorts: {
      bySalesperson: groupRows(records, "salesperson", foundationByCall, offerByCall, minimumSample),
      bySource: groupRows(records, "source", foundationByCall, offerByCall, minimumSample),
      byDate
    },
    records
  };
}

function filterSalesOpportunityRecords(centre = {}, options = {}) {
  const stage = clean(options.stage || options.opportunityStage);
  const queue = clean(options.queue || options.opportunityQueue);
  const records = (centre.records || []).filter((record) => {
    if (stage && !record.stageKeys.includes(stage)) return false;
    if (queue && !record.queueKeys.includes(queue)) return false;
    return true;
  }).sort((left, right) => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, review: 3, none: 4 };
    return (priorityOrder[left.priority] ?? 9) - (priorityOrder[right.priority] ?? 9)
      || String(right.date).localeCompare(String(left.date))
      || String(left.callId).localeCompare(String(right.callId));
  });
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 1000));
  const offset = Math.max(0, Number(options.offset || 0));
  return {
    records: records.slice(offset, offset + limit),
    query: {
      stage,
      queue,
      limit,
      offset,
      matchingRecords: records.length,
      displayedRecords: Math.min(limit, Math.max(0, records.length - offset)),
      nextOffset: offset + limit < records.length ? offset + limit : null,
      previousOffset: offset > 0 ? Math.max(0, offset - limit) : null
    }
  };
}

function buildSalesOpportunityManagementBrief(centre = {}, options = {}) {
  const baseUrl = clean(options.baseUrl) || "http://127.0.0.1:3040";
  if (centre.capabilityBoundary?.operationalConsumptionPermitted !== true) {
    const generatedAt = centre.generatedAt || new Date().toISOString();
    return {
      id: "sales-opportunity-action-centre-current",
      title: "Sales Opportunity Action Centre — Unavailable",
      type: "sales_opportunity_action_centre",
      createdAt: generatedAt,
      content: [
        "# Sales Opportunity Action Centre — Unavailable",
        "",
        `Generated: ${generatedAt}`,
        "",
        "No local-model evaluator is promoted for operational consumption.",
        "",
        "Historical model outputs are quarantined as research and cannot create action queues, customer outcomes, coaching, rankings, accepted-offer claims, or management recommendations.",
        "",
        `Transcript-bearing calls remain available for direct inspection: ${centre.coverage?.transcriptCalls || 0}.`
      ].join("\n")
    };
  }
  const largestQueues = (centre.actionQueues || []).filter((row) => row.count > 0).slice().sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const examples = (centre.records || []).filter((record) => record.queueKeys.length && record.proof.length)
    .slice().sort((left, right) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, review: 3 };
      return (priorityOrder[left.priority] ?? 9) - (priorityOrder[right.priority] ?? 9) || String(right.date).localeCompare(String(left.date));
    }).slice(0, 10);
  const lines = [
    "# Sales Opportunity Action Centre — Current Management Brief",
    "",
    `Generated: ${centre.generatedAt || new Date().toISOString()}`,
    "",
    "## Readiness and scope",
    "",
    `- ${centre.coverage?.readinessLabel || "Readiness unavailable"}.`,
    `- Foundation coverage: ${centre.coverage?.foundationEvaluated || 0} of ${centre.coverage?.transcriptCalls || 0} transcript-bearing calls (${centre.coverage?.foundationCoverageRate === null ? "n/a" : `${(centre.coverage.foundationCoverageRate * 100).toFixed(1)}%`}).`,
    `- Promoted Offer Acceptance classifications: ${centre.coverage?.offerClassified || 0}.`,
    `- Current typed specialist decisions: ${centre.coverage?.currentTypedSpecialistDecisions || 0} for ${centre.coverage?.routedSpecialistChecks || 0} routed checks.`,
    "",
    "## Largest supported action pools",
    "",
    ...(largestQueues.length ? largestQueues.slice(0, 8).map((queue) => `- ${queue.label}: ${queue.count} calls. Recommended action: ${queue.action}`) : ["- No action pools are supported by the current evidence."]),
    "",
    "## Strongest supported patterns",
    "",
    ...(centre.funnel || []).map((stage) => `- ${stage.label}: ${stage.count} of ${stage.denominator} ${stage.denominatorLabel} (${stage.rate === null ? "n/a" : `${(stage.rate * 100).toFixed(1)}%`}).`),
    "",
    "These are descriptive evidence patterns in the current uploaded and evaluated cohort. They do not establish causal salesperson or source performance.",
    "",
    "## Limitations",
    "",
    ...(centre.coverage?.warnings || []).map((warning) => `- ${warning}`),
    "- Accepted offer remains separate from payment, fulfilment, recognised revenue, and CRM won status.",
    "",
    "## Example calls",
    ""
  ];
  examples.forEach((record, index) => {
    const queueLabels = (centre.actionQueues || []).filter((queue) => record.queueKeys.includes(queue.key)).map((queue) => queue.label).join("; ");
    lines.push(`### ${index + 1}. Call ${record.callId}`);
    lines.push("");
    lines.push(`- Customer ID: ${record.customerId}`);
    lines.push(`- Salesperson / source / date: ${record.salesperson} / ${record.source} / ${record.sourceTime}`);
    lines.push(`- Called on behalf of: ${record.representedOrganisation}`);
    lines.push(`- Action pool: ${queueLabels}`);
    lines.push(`- Recommended action: ${record.recommendedAction}`);
    lines.push(`- Evidence strength: ${record.evidenceStrength}; availability: ${record.evidenceAvailability}.`);
    record.proof.slice(0, 2).forEach((proof) => lines.push(`- Exact proof (${proof.speaker}, ${proof.claimType}): “${proof.quote.replace(/[\r\n]+/g, " ") }”`));
    lines.push(`- Open call: ${baseUrl}/calls/${encodeURIComponent(record.callId)}`);
    lines.push("");
  });
  return {
    id: "sales-opportunity-action-centre-current",
    title: "Sales Opportunity Action Centre — Current Management Brief",
    type: "sales_opportunity_action_centre",
    createdAt: centre.generatedAt || new Date().toISOString(),
    summary: `${largestQueues[0]?.count || 0} calls in the largest supported action pool; ${centre.coverage?.readinessLabel || "readiness unavailable"}.`,
    content: lines.join("\n"),
    metadata: {
      importId: centre.importId || "",
      readiness: centre.coverage?.readinessLabel || "",
      foundationCoverageRate: centre.coverage?.foundationCoverageRate ?? null,
      examples: examples.length
    }
  };
}

module.exports = {
  MINIMUM_COMPARISON_SAMPLE,
  QUEUES,
  SCHEMA_VERSION,
  STAGES,
  buildSalesOpportunityActionCentre,
  buildSalesOpportunityManagementBrief,
  filterSalesOpportunityRecords
};
