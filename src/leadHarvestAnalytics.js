"use strict";

const ZERO_TOTALS = Object.freeze({
  candidateCalls: 0,
  newBusinessCandidateCalls: 0,
  warmBusinessCandidateCalls: 0,
  openCandidates: 0,
  matchingUnavailable: 0,
  laterMatchingCallObserved: 0,
  openNewBusinessCandidates: 0,
  newBusinessMatchingUnavailable: 0,
  newBusinessLaterMatchingCallObserved: 0,
  newBusinessHarvestQueue: 0,
  highPriorityNewBusiness: 0
});

function summarizeLeadHarvestRecords() {
  return {
    totals: { ...ZERO_TOTALS },
    salespersonRows: [],
    sourceRows: [],
    statusRows: [],
    priorityRows: [],
    objectionRows: [],
    handlingRows: [],
    latestRows: [],
    records: []
  };
}

function candidateSignals() {
  return {
    status: "unavailable",
    reason: "Semantic interest, objection, callback, timing, and seller-handling meaning is not evaluated."
  };
}

function buildLeadHarvestModel() {
  return {
    schemaVersion: "sales_dashboard_lead_harvest.retired.v3",
    status: "unavailable",
    authorityStatus: "retired_unvalidated_semantic_rules",
    definitions: {
      leadHarvestCandidate: "Unavailable. Interest, objection, callback, timing, and seller-handling meaning is outside the validated literal-rule boundary.",
      recordMatching: "Stable-ID call matching remains available only in neutral reattempt activity views."
    },
    ...summarizeLeadHarvestRecords()
  };
}

module.exports = {
  buildLeadHarvestModel,
  candidateSignals,
  summarizeLeadHarvestRecords
};
