"use strict";

const crypto = require("crypto");
const { isUntrustedLegacyField } = require("./untrustedLegacyFields");

const BAD_LEAD_CLAIM_SCHEMA_VERSION = "bad_lead_claim.v1";

const BAD_LEAD_CLAIM_REASONS = Object.freeze([
  "wrong_number",
  "private_non_business",
  "disconnected_or_unallocated",
  "business_closed_permanently",
  "identity_mismatch",
  "duplicate",
  "out_of_scope",
  "do_not_contact",
  "unsafe_abusive",
  "other"
]);

const BAD_LEAD_CLAIM_STATUSES = Object.freeze([
  "submitted",
  "under_review",
  "confirmed",
  "rejected",
  "withdrawn"
]);

const ACTIVE_BAD_LEAD_CLAIM_STATUSES = Object.freeze([
  "submitted",
  "under_review"
]);

const BAD_LEAD_CLAIM_SUBMITTER_ROLES = Object.freeze([
  "salesperson",
  "manager",
  "system_import"
]);

const CREATE_FIELDS = new Set([
  "lead_id",
  "call_id",
  "claimed_reason",
  "claim_text"
]);

const UPDATE_FIELDS = new Set([
  "claim_status",
  "decision_note"
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  submitted: Object.freeze(["under_review", "withdrawn"]),
  under_review: Object.freeze(["confirmed", "rejected", "withdrawn"]),
  confirmed: Object.freeze([]),
  rejected: Object.freeze([]),
  withdrawn: Object.freeze([])
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_CLAIM_TEXT_PATTERN = /\bno[_\s-]*sale[_\s-]*type\b|\bbaz[_\s-]*detailed[_\s-]*notes?\b/i;

function claimError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, { field, required = false, maxLength = 2000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw claimError(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw claimError(`${field} must be text.`);
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw claimError(`${field} is required.`);
    return null;
  }
  if (text.length > maxLength) throw claimError(`${field} must be ${maxLength} characters or fewer.`);
  return text;
}

function assertNoLegacyFields(value, path = "claim") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLegacyFields(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, item]) => {
    if (isUntrustedLegacyField(key)) {
      throw claimError(`Excluded legacy field is not allowed in bad-lead claims: ${path}.${key}`);
    }
    assertNoLegacyFields(item, `${path}.${key}`);
  });
}

function assertAllowedFields(input, allowedFields, operation) {
  if (!isPlainObject(input)) throw claimError(`${operation} input must be an object.`);
  assertNoLegacyFields(input);
  const unsupported = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unsupported.length) {
    throw claimError(`Unsupported ${operation} field${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}`);
  }
}

function assertNoLegacyClaimText(value, field = "claim_text") {
  const text = String(value || "");
  if (LEGACY_CLAIM_TEXT_PATTERN.test(text)) {
    throw claimError(`Excluded legacy field references are not allowed in ${field}.`);
  }
}

function requireEnum(value, allowed, field) {
  const normalized = cleanText(value, { field, required: true, maxLength: 100 });
  if (!allowed.includes(normalized)) throw claimError(`Invalid ${field}: ${normalized}`);
  return normalized;
}

function trustedTimestamp(context = {}) {
  const value = context.now || new Date().toISOString();
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw claimError("Trusted service timestamp must be a valid ISO timestamp.");
  }
  return new Date(value).toISOString();
}

function requireIsoTimestamp(value, field) {
  const text = cleanText(value, { field, required: true, maxLength: 100 });
  if (Number.isNaN(Date.parse(text))) throw claimError(`${field} must be a valid ISO timestamp.`, 500);
  return text;
}

function requireUuid(value, field) {
  const uuid = cleanText(value, { field, required: true, maxLength: 100 });
  if (!UUID_PATTERN.test(uuid)) throw claimError(`${field} must be a UUID.`, 500);
  return uuid;
}

function newUuid(context = {}) {
  const value = context.uuidFactory ? context.uuidFactory() : crypto.randomUUID();
  const uuid = String(value || "").trim();
  if (!UUID_PATTERN.test(uuid)) {
    throw claimError("Trusted claim ID generator must return a UUID.");
  }
  return uuid;
}

function submitterContext(context = {}) {
  return {
    userId: cleanText(context.submittedByUserId, { field: "submittedByUserId", required: true, maxLength: 200 }),
    role: requireEnum(context.submittedByRole, BAD_LEAD_CLAIM_SUBMITTER_ROLES, "submittedByRole")
  };
}

function actorContext(context = {}) {
  return {
    userId: cleanText(context.actorUserId, { field: "actorUserId", required: true, maxLength: 200 }),
    role: requireEnum(context.actorRole, BAD_LEAD_CLAIM_SUBMITTER_ROLES, "actorRole")
  };
}

function historyEvent({ claimId, action, previousStatus = null, newStatus, actor, at, note = null }, context = {}) {
  return {
    event_id: newUuid(context),
    claim_id: claimId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    actor_user_id: actor.userId,
    actor_role: actor.role,
    at,
    note
  };
}

function createBadLeadClaim(input = {}, context = {}) {
  assertAllowedFields(input, CREATE_FIELDS, "claim creation");
  const submitter = submitterContext(context);
  const at = trustedTimestamp(context);
  const claimId = newUuid(context);
  const claimedReason = requireEnum(input.claimed_reason, BAD_LEAD_CLAIM_REASONS, "claimed_reason");
  assertNoLegacyClaimText(input.claim_text);
  const actor = { userId: submitter.userId, role: submitter.role };

  return {
    claim_id: claimId,
    schema_version: BAD_LEAD_CLAIM_SCHEMA_VERSION,
    lead_id: cleanText(input.lead_id, { field: "lead_id", required: true, maxLength: 200 }),
    call_id: cleanText(input.call_id, { field: "call_id", maxLength: 200 }),
    submitted_by_user_id: submitter.userId,
    submitted_by_role: submitter.role,
    submitted_at: at,
    claimed_reason: claimedReason,
    claim_text: cleanText(input.claim_text, { field: "claim_text", maxLength: 2000 }),
    claim_status: "submitted",
    created_at: at,
    updated_at: at,
    manager_decision: {
      decision_by_user_id: null,
      decision_at: null,
      decision_note: null
    },
    claim_history: [historyEvent({
      claimId,
      action: "submitted",
      newStatus: "submitted",
      actor,
      at
    }, context)]
  };
}

function validateStoredClaim(claim = {}) {
  if (!isPlainObject(claim) || claim.schema_version !== BAD_LEAD_CLAIM_SCHEMA_VERSION) {
    throw claimError("Unsupported or invalid bad-lead claim record.", 500);
  }
  assertNoLegacyFields(claim, "stored_claim");
  requireUuid(claim.claim_id, "claim_id");
  cleanText(claim.lead_id, { field: "lead_id", required: true, maxLength: 200 });
  cleanText(claim.call_id, { field: "call_id", maxLength: 200 });
  cleanText(claim.submitted_by_user_id, { field: "submitted_by_user_id", required: true, maxLength: 200 });
  requireEnum(claim.submitted_by_role, BAD_LEAD_CLAIM_SUBMITTER_ROLES, "submitted_by_role");
  requireIsoTimestamp(claim.submitted_at, "submitted_at");
  requireEnum(claim.claimed_reason, BAD_LEAD_CLAIM_REASONS, "claimed_reason");
  assertNoLegacyClaimText(claim.claim_text);
  cleanText(claim.claim_text, { field: "claim_text", maxLength: 2000 });
  requireEnum(claim.claim_status, BAD_LEAD_CLAIM_STATUSES, "claim_status");
  requireIsoTimestamp(claim.created_at, "created_at");
  requireIsoTimestamp(claim.updated_at, "updated_at");
  if (!isPlainObject(claim.manager_decision)) throw claimError("manager_decision must be an object.", 500);
  if (["confirmed", "rejected"].includes(claim.claim_status)) {
    cleanText(claim.manager_decision.decision_by_user_id, { field: "manager_decision.decision_by_user_id", required: true, maxLength: 200 });
    requireIsoTimestamp(claim.manager_decision.decision_at, "manager_decision.decision_at");
  }
  cleanText(claim.manager_decision.decision_note, { field: "manager_decision.decision_note", maxLength: 2000 });
  if (!Array.isArray(claim.claim_history) || !claim.claim_history.length) {
    throw claimError("claim_history must contain at least one audit event.", 500);
  }
  claim.claim_history.forEach((event) => {
    if (!isPlainObject(event)) throw claimError("claim_history contains an invalid event.", 500);
    requireUuid(event.event_id, "claim_history.event_id");
    if (event.claim_id !== claim.claim_id) throw claimError("claim_history event does not match the claim ID.", 500);
    requireEnum(event.new_status, BAD_LEAD_CLAIM_STATUSES, "claim_history.new_status");
    cleanText(event.actor_user_id, { field: "claim_history.actor_user_id", required: true, maxLength: 200 });
    requireEnum(event.actor_role, BAD_LEAD_CLAIM_SUBMITTER_ROLES, "claim_history.actor_role");
    requireIsoTimestamp(event.at, "claim_history.at");
  });
  return claim;
}

function explicitLeadIdsForEvaluationCall(call = {}) {
  const stableIds = Array.isArray(call.stableIds) ? call.stableIds : [];
  return Array.from(new Set([
    call.leadId,
    call.lead_id,
    call.rawFields?.AllocatedLeadID,
    stableIds.find((item) => item?.field === "AllocatedLeadID")?.value
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}

function evaluationClaimProjection(claim) {
  return {
    claim_id: claim.claim_id,
    schema_version: claim.schema_version,
    lead_id: claim.lead_id,
    call_id: claim.call_id,
    submitted_by_user_id: claim.submitted_by_user_id,
    submitted_by_role: claim.submitted_by_role,
    submitted_at: claim.submitted_at,
    claimed_reason: claim.claimed_reason,
    claim_text: claim.claim_text,
    claim_status: claim.claim_status
  };
}

function selectBadLeadClaimsForEvaluation(claims = [], call = {}) {
  const callId = String(call.callId || call.call_id || "").trim();
  const unavailable = {
    schema_version: "bad_lead_claim_context.v1",
    context_type: "salesperson_allegation",
    availability: "none",
    match_basis: "none",
    claim: null
  };
  if (!callId || !Array.isArray(claims) || !claims.length) return unavailable;

  const active = claims.filter((claim) => ACTIVE_BAD_LEAD_CLAIM_STATUSES.includes(String(claim?.claim_status || "").trim()));
  const callMatches = active.filter((claim) => String(claim?.call_id || "").trim() === callId);
  const leadIds = new Set(explicitLeadIdsForEvaluationCall(call));
  const candidates = callMatches.length
    ? callMatches
    : active.filter((claim) => !String(claim?.call_id || "").trim() && leadIds.has(String(claim?.lead_id || "").trim()));
  if (!candidates.length) return unavailable;

  const selected = candidates
    .map(validateStoredClaim)
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  return {
    schema_version: "bad_lead_claim_context.v1",
    context_type: "salesperson_allegation",
    availability: "present",
    match_basis: callMatches.length ? "call_id" : "lead_id",
    claim: evaluationClaimProjection(selected[0])
  };
}

function applyBadLeadClaimTransition(existingClaim = {}, input = {}, context = {}) {
  assertAllowedFields(input, UPDATE_FIELDS, "claim update");
  const claim = validateStoredClaim(existingClaim);
  const actor = actorContext(context);
  const at = trustedTimestamp(context);
  const fromStatus = claim.claim_status;
  const toStatus = requireEnum(input.claim_status, BAD_LEAD_CLAIM_STATUSES, "claim_status");

  if (!(ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus)) {
    throw claimError(`Invalid bad-lead claim transition: ${fromStatus} -> ${toStatus}`);
  }

  const managerTransition = ["under_review", "confirmed", "rejected"].includes(toStatus);
  if (managerTransition && actor.role !== "manager") {
    throw claimError("Only a manager may review, confirm, or reject a bad-lead claim.", 403);
  }
  if (toStatus === "withdrawn" && actor.role !== "manager" && actor.userId !== claim.submitted_by_user_id) {
    throw claimError("Only the original submitter or a manager may withdraw a bad-lead claim.", 403);
  }

  const decisionNote = cleanText(input.decision_note, { field: "decision_note", maxLength: 2000 });
  const managerDecision = ["confirmed", "rejected"].includes(toStatus)
    ? {
        decision_by_user_id: actor.userId,
        decision_at: at,
        decision_note: decisionNote
      }
    : claim.manager_decision;

  return {
    ...claim,
    claim_status: toStatus,
    updated_at: at,
    manager_decision: managerDecision,
    claim_history: [
      ...(Array.isArray(claim.claim_history) ? claim.claim_history : []),
      historyEvent({
        claimId: claim.claim_id,
        action: ["confirmed", "rejected"].includes(toStatus) ? "manager_decision_recorded" : "status_changed",
        previousStatus: fromStatus,
        newStatus: toStatus,
        actor,
        at,
        note: decisionNote
      }, context)
    ]
  };
}

module.exports = {
  ACTIVE_BAD_LEAD_CLAIM_STATUSES,
  ALLOWED_TRANSITIONS,
  BAD_LEAD_CLAIM_REASONS,
  BAD_LEAD_CLAIM_SCHEMA_VERSION,
  BAD_LEAD_CLAIM_STATUSES,
  BAD_LEAD_CLAIM_SUBMITTER_ROLES,
  applyBadLeadClaimTransition,
  assertNoLegacyFields,
  createBadLeadClaim,
  selectBadLeadClaimsForEvaluation,
  validateStoredClaim
};
