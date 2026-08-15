"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  BAD_LEAD_CLAIM_SCHEMA_VERSION,
  applyBadLeadClaimTransition,
  createBadLeadClaim,
  selectBadLeadClaimsForEvaluation
} = require("../src/badLeadClaim");
const {
  dashboardPersistence,
  listBadLeadClaims,
  readStore,
  saveBadLeadClaim,
  updateBadLeadClaim
} = require("../src/storage");

function uuidFactory(start = 1) {
  let value = start;
  return () => `00000000-0000-4000-8000-${(value++).toString(16).padStart(12, "0")}`;
}

function createContext(overrides = {}) {
  return {
    submittedByUserId: "salesperson-17",
    submittedByRole: "salesperson",
    now: "2026-07-11T08:00:00.000Z",
    uuidFactory: uuidFactory(),
    ...overrides
  };
}

function managerContext(overrides = {}) {
  return {
    actorUserId: "manager-3",
    actorRole: "manager",
    now: "2026-07-11T09:00:00.000Z",
    uuidFactory: uuidFactory(100),
    ...overrides
  };
}

function tempStorePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-claim-"));
  return path.join(directory, "state.json");
}

test("bad-lead claim creation records only the submitted allegation and trusted submitter context", () => {
  const claim = createBadLeadClaim({
    lead_id: "lead-123",
    call_id: "call-456",
    claimed_reason: "wrong_number",
    claim_text: "Recipient stated that this is the wrong business."
  }, createContext());

  assert.equal(claim.schema_version, BAD_LEAD_CLAIM_SCHEMA_VERSION);
  assert.equal(claim.claim_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(claim.lead_id, "lead-123");
  assert.equal(claim.call_id, "call-456");
  assert.equal(claim.submitted_by_user_id, "salesperson-17");
  assert.equal(claim.submitted_by_role, "salesperson");
  assert.equal(claim.claimed_reason, "wrong_number");
  assert.equal(claim.claim_status, "submitted");
  assert.deepEqual(claim.manager_decision, {
    decision_by_user_id: null,
    decision_at: null,
    decision_note: null
  });
  assert.equal(claim.claim_history.length, 1);
  assert.equal(claim.claim_history[0].action, "submitted");
  assert.equal("system_evidence" in claim, false);
});

test("claim creation does not infer a reason and rejects identity or lifecycle fields in the allegation payload", () => {
  assert.throws(() => createBadLeadClaim({
    lead_id: "lead-123",
    claim_text: "This sounds like a wrong number."
  }, createContext()), /claimed_reason is required/);

  assert.throws(() => createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "wrong_number",
    submitted_by_user_id: "spoofed-manager"
  }, createContext()), /Unsupported claim creation field/);

  assert.throws(() => createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "not_a_real_reason"
  }, createContext()), /Invalid claimed_reason/);
});

test("claim creation rejects legacy fields and normalized aliases", () => {
  for (const legacyField of ["NoSaleType", "no_sale_type", "Baz_DetailedNotes", "baz-detailed-notes"]) {
    assert.throws(() => createBadLeadClaim({
      lead_id: "lead-123",
      claimed_reason: "other",
      [legacyField]: "legacy value"
    }, createContext()), /Excluded legacy field/);
  }
  assert.throws(() => createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "other",
    claim_text: "Copied from No Sale Type."
  }, createContext()), /Excluded legacy field references/);
});

test("evaluation claim selection prefers exact call claims then exact lead-only claims", () => {
  const exactCall = createBadLeadClaim({
    lead_id: "lead-123",
    call_id: "call-456",
    claimed_reason: "wrong_number",
    claim_text: "The salesperson alleges that the recipient identified a wrong number."
  }, createContext({ uuidFactory: uuidFactory(10) }));
  const leadOnly = applyBadLeadClaimTransition(createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "out_of_scope",
    claim_text: "The salesperson alleges the lead is outside the supplied criteria."
  }, createContext({ uuidFactory: uuidFactory(20) })), {
    claim_status: "under_review"
  }, managerContext({ uuidFactory: uuidFactory(30) }));
  const inactive = applyBadLeadClaimTransition(applyBadLeadClaimTransition(createBadLeadClaim({
    lead_id: "lead-123",
    call_id: "call-456",
    claimed_reason: "duplicate"
  }, createContext({ uuidFactory: uuidFactory(40) })), {
    claim_status: "under_review"
  }, managerContext({ uuidFactory: uuidFactory(50) })), {
    claim_status: "rejected"
  }, managerContext({ uuidFactory: uuidFactory(60) }));
  const claims = [leadOnly, inactive, exactCall];

  const callMatch = selectBadLeadClaimsForEvaluation(claims, {
    callId: "call-456",
    rawFields: { AllocatedLeadID: "lead-123" },
    stableIds: [{ field: "AllocatedLeadID", value: "lead-123" }]
  });
  assert.equal(callMatch.match_basis, "call_id");
  assert.equal(callMatch.availability, "present");
  assert.equal(callMatch.claim.claim_id, exactCall.claim_id);
  assert.equal("manager_decision" in callMatch.claim, false);
  assert.equal("claim_history" in callMatch.claim, false);

  const leadMatch = selectBadLeadClaimsForEvaluation(claims, {
    callId: "different-call",
    rawFields: { AllocatedLeadID: "lead-123" },
    stableIds: [{ field: "AllocatedLeadID", value: "lead-123" }]
  });
  assert.equal(leadMatch.match_basis, "lead_id");
  assert.equal(leadMatch.claim.claim_id, leadOnly.claim_id);
});

test("evaluation claim selection never matches approximate or non-lead identifiers", () => {
  const claim = createBadLeadClaim({
    lead_id: "customer-123",
    claimed_reason: "identity_mismatch",
    claim_text: "Example Business is alleged to have a different identity."
  }, createContext({ uuidFactory: uuidFactory(70) }));

  const unmatched = selectBadLeadClaimsForEvaluation([claim], {
    callId: "call-other",
    salesperson: "salesperson-17",
    transcript: "The customer said Example Business.",
    rawFields: { customer_id: "customer-123", dialled_phone_number: "customer-123" },
    stableIds: [{ field: "customer_id", value: "customer-123" }]
  });
  assert.equal(unmatched.availability, "none");
  assert.equal(unmatched.claim, null);
});

test("manager decisions append history without changing the original allegation", () => {
  const original = createBadLeadClaim({
    lead_id: "lead-123",
    call_id: "call-456",
    claimed_reason: "business_closed_permanently",
    claim_text: "Salesperson alleges the premises are permanently closed."
  }, createContext());
  const underReview = applyBadLeadClaimTransition(original, {
    claim_status: "under_review"
  }, managerContext());
  const confirmed = applyBadLeadClaimTransition(underReview, {
    claim_status: "confirmed",
    decision_note: "Manager independently confirmed the closure."
  }, managerContext({
    now: "2026-07-11T10:00:00.000Z",
    uuidFactory: uuidFactory(200)
  }));

  assert.equal(confirmed.claim_status, "confirmed");
  assert.equal(confirmed.claimed_reason, original.claimed_reason);
  assert.equal(confirmed.claim_text, original.claim_text);
  assert.equal(confirmed.submitted_by_user_id, original.submitted_by_user_id);
  assert.equal(confirmed.manager_decision.decision_by_user_id, "manager-3");
  assert.equal(confirmed.manager_decision.decision_at, "2026-07-11T10:00:00.000Z");
  assert.match(confirmed.manager_decision.decision_note, /independently confirmed/);
  assert.deepEqual(confirmed.claim_history.map((event) => event.action), [
    "submitted",
    "status_changed",
    "manager_decision_recorded"
  ]);
  assert.throws(() => applyBadLeadClaimTransition(confirmed, {
    claim_status: "under_review"
  }, managerContext()), /Invalid bad-lead claim transition/);
});

test("claim updates reject client-supplied actor and manager-decision metadata", () => {
  const original = createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "wrong_number"
  }, createContext());

  assert.throws(() => applyBadLeadClaimTransition(original, {
    claim_status: "under_review",
    actor_user_id: "spoofed-manager"
  }, managerContext()), /Unsupported claim update field/);
  assert.throws(() => applyBadLeadClaimTransition(original, {
    claim_status: "under_review",
    manager_decision: {
      decision_by_user_id: "spoofed-manager"
    }
  }, managerContext()), /Unsupported claim update field/);
});

test("only managers may review or decide claims and only the submitter or manager may withdraw", () => {
  const original = createBadLeadClaim({
    lead_id: "lead-123",
    claimed_reason: "duplicate"
  }, createContext());

  assert.throws(() => applyBadLeadClaimTransition(original, {
    claim_status: "under_review"
  }, {
    actorUserId: "salesperson-17",
    actorRole: "salesperson",
    now: "2026-07-11T09:00:00.000Z",
    uuidFactory: uuidFactory(300)
  }), /Only a manager/);

  assert.throws(() => applyBadLeadClaimTransition(original, {
    claim_status: "withdrawn"
  }, {
    actorUserId: "salesperson-99",
    actorRole: "salesperson",
    now: "2026-07-11T09:00:00.000Z",
    uuidFactory: uuidFactory(400)
  }), /original submitter or a manager/);

  const withdrawn = applyBadLeadClaimTransition(original, {
    claim_status: "withdrawn"
  }, {
    actorUserId: "salesperson-17",
    actorRole: "salesperson",
    now: "2026-07-11T09:00:00.000Z",
    uuidFactory: uuidFactory(500)
  });
  assert.equal(withdrawn.claim_status, "withdrawn");
});

test("bad-lead claims persist and remain absent from normal dashboard persistence", () => {
  const storePath = tempStorePath();
  const saved = saveBadLeadClaim({
    lead_id: "lead-123",
    call_id: "call-456",
    claimed_reason: "out_of_scope",
    claim_text: "The business appears outside the supplied target criteria."
  }, createContext(), { storePath }).claim;

  assert.equal(readStore({ storePath }).badLeadClaims.length, 1);
  assert.equal(listBadLeadClaims({ leadId: "lead-123" }, { storePath }).length, 1);
  assert.equal(listBadLeadClaims({ callId: "different-call" }, { storePath }).length, 0);

  updateBadLeadClaim(saved.claim_id, {
    claim_status: "under_review"
  }, managerContext(), { storePath });
  const decided = updateBadLeadClaim(saved.claim_id, {
    claim_status: "rejected",
    decision_note: "Evidence did not establish that the lead was outside scope."
  }, managerContext({
    now: "2026-07-11T10:00:00.000Z",
    uuidFactory: uuidFactory(600)
  }), { storePath }).claim;

  assert.equal(decided.claim_status, "rejected");
  assert.equal(readStore({ storePath }).badLeadClaims[0].claim_history.length, 3);
  const publicPersistence = dashboardPersistence(readStore({ storePath }));
  assert.equal("badLeadClaims" in publicPersistence, false);
  assert.doesNotMatch(JSON.stringify(publicPersistence), /lead-123|outside the supplied target criteria/i);
});
