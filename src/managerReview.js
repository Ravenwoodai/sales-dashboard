"use strict";

const crypto = require("crypto");

const DEFAULT_MANAGER_REVIEW_ACTOR = "local_manager";

const MANAGER_REVIEW_STATUSES = [
  "unreviewed",
  "review_needed",
  "in_review",
  "reviewed_confirmed",
  "reviewed_corrected",
  "dismissed",
  "escalated"
];

const REVIEW_OPEN_STATUSES = ["review_needed", "in_review"];
const REVIEW_COMPLETE_STATUSES = ["reviewed_confirmed", "reviewed_corrected", "dismissed", "escalated"];

const REVIEW_SCOPES = [
  "call",
  "alert",
  "signal",
  "follow_up",
  "coaching",
  "outcome",
  "risk"
];

const CORRECTION_FIELDS = [
  "contact_classification",
  "probable_live_human",
  "meaningful_conversation",
  "actionable_conversation",
  "voicemail_flag",
  "system_audio_flag",
  "no_answer_probable",
  "wrong_number_flag",
  "local_outcome_category",
  "local_outcome_detail",
  "outcome_mismatch_confirmed",
  "follow_up_required",
  "follow_up_status",
  "follow_up_channel",
  "follow_up_due_text",
  "follow_up_due_datetime",
  "follow_up_manually_completed",
  "follow_up_dismissed",
  "coaching_flag_confirmed",
  "coaching_priority",
  "coaching_note",
  "risk_flag_confirmed",
  "complaint_confirmed",
  "opt_out_confirmed",
  "compliance_review_required",
  "evidence_assessment"
];

const PROTECTED_CORRECTION_FIELDS = [
  "transcription_text",
  "raw_transcript",
  "raw_nosaletype",
  "nosaletype",
  "baz_detailednotes",
  "call_id",
  "call_date",
  "call_time",
  "salesperson",
  "dialled_phone_number",
  "callerid",
  "mobile",
  "calltotalseconds",
  "ring_time_seconds",
  "call_duration_seconds",
  "customer_id",
  "contactid",
  "foundcustomerid",
  "foundcontactid",
  "allocatedleadid",
  "allocation",
  "allocationcoverage",
  "allocation_coverage",
  "campaign",
  "campaign_allocation",
  "source_filename",
  "inputhash",
  "import_id",
  "alert_evidence",
  "evidence"
];

const ACTION_TO_STATUS = {
  mark_review_needed: "review_needed",
  review_needed: "review_needed",
  start_review: "in_review",
  in_review: "in_review",
  confirm: "reviewed_confirmed",
  confirmed: "reviewed_confirmed",
  reviewed_confirmed: "reviewed_confirmed",
  correct: "reviewed_corrected",
  corrected: "reviewed_corrected",
  reviewed_corrected: "reviewed_corrected",
  dismiss: "dismissed",
  dismissed: "dismissed",
  escalate: "escalated",
  escalated: "escalated",
  reopen: "review_needed",
  note: null,
  add_note: null
};

const LEGACY_STATUS_ALIASES = {
  not_reviewed: "unreviewed",
  manager_reviewed: "reviewed_confirmed",
  reviewed: "reviewed_confirmed",
  confirmed: "reviewed_confirmed",
  correct: "reviewed_confirmed",
  incorrect: "reviewed_corrected",
  false_positive: "dismissed",
  follow_up_elsewhere: "reviewed_corrected",
  needs_review: "review_needed",
  needs_more_review: "review_needed"
};

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[-\s]+/g, "_");
}

function normalizeReviewStatus(status, fallback = "unreviewed") {
  const normalized = normalizeKey(status);
  const mapped = LEGACY_STATUS_ALIASES[normalized] || normalized;
  return MANAGER_REVIEW_STATUSES.includes(mapped) ? mapped : fallback;
}

function normalizeReviewAction(action, status = "") {
  const normalized = normalizeKey(action || status);
  if (!Object.prototype.hasOwnProperty.call(ACTION_TO_STATUS, normalized)) return "";
  return normalized;
}

function statusForReviewAction(action, currentStatus = "unreviewed") {
  const normalized = normalizeReviewAction(action);
  if (!normalized) return "";
  const nextStatus = ACTION_TO_STATUS[normalized];
  return nextStatus === null ? normalizeReviewStatus(currentStatus) : nextStatus;
}

function normalizeReviewScope(scope, fallback = "call") {
  const normalized = normalizeKey(scope);
  return REVIEW_SCOPES.includes(normalized) ? normalized : fallback;
}

function requireReviewScope(scope) {
  const normalized = normalizeKey(scope || "call");
  if (!REVIEW_SCOPES.includes(normalized)) {
    const error = new Error("Invalid manager review scope.");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function normalizedCorrectionField(field) {
  return normalizeKey(field);
}

function validateCorrectionField(field) {
  const normalized = normalizedCorrectionField(field);
  if (!normalized || PROTECTED_CORRECTION_FIELDS.includes(normalized) || normalized.includes("allocation") || normalized.includes("campaign")) {
    const error = new Error("Invalid or protected manager correction field.");
    error.statusCode = 400;
    throw error;
  }
  if (!CORRECTION_FIELDS.includes(normalized)) {
    const error = new Error("Invalid manager correction field.");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function resolveManagerReviewActor() {
  return DEFAULT_MANAGER_REVIEW_ACTOR;
}

function reviewIdFor(input = {}) {
  const importId = clean(input.importId) || "current";
  const callId = clean(input.callId || input.call_id);
  const alertId = clean(input.alertId || input.alert_id);
  const scope = normalizeReviewScope(input.reviewScope || input.scope || (alertId ? "alert" : "call"));
  const signal = clean(input.signalName || input.signal_name);
  return `review_${digest(`${importId}|${callId}|${alertId}|${scope}|${signal}`, 20)}`;
}

function historyIdFor(reviewId, action, timestamp, count = 0) {
  return `review_history_${digest(`${reviewId}|${action}|${timestamp}|${count}`, 20)}`;
}

function correctionIdFor(reviewId, fieldName, timestamp, count = 0) {
  return `review_correction_${digest(`${reviewId}|${fieldName}|${timestamp}|${count}`, 20)}`;
}

function normalizeCorrection(correction = {}, review = {}) {
  const fieldName = validateCorrectionField(correction.fieldName || correction.field_name);
  const correctedAt = correction.correctedAt || correction.corrected_at || correction.timestamp || "";
  const correctedBy = correction.correctedBy || correction.corrected_by || DEFAULT_MANAGER_REVIEW_ACTOR;
  return {
    correctionId: correction.correctionId || correction.correction_id || correctionIdFor(review.reviewId || review.id || "review", fieldName, correctedAt || Date.now(), 0),
    reviewId: correction.reviewId || correction.review_id || review.reviewId || review.id || "",
    callId: correction.callId || correction.call_id || review.callId || "",
    alertId: correction.alertId || correction.alert_id || review.alertId || "",
    fieldName,
    rawValue: clean(correction.rawValue ?? correction.raw_value),
    deterministicValue: clean(correction.deterministicValue ?? correction.deterministic_value),
    llmValue: clean(correction.llmValue ?? correction.llm_value),
    previousDisplayValue: clean(correction.previousDisplayValue ?? correction.previous_display_value),
    managerCorrectedValue: clean(correction.managerCorrectedValue ?? correction.manager_corrected_value ?? correction.value),
    correctionReason: clean(correction.correctionReason ?? correction.correction_reason ?? correction.reason),
    correctedBy,
    correctedAt,
    evidenceAssessment: clean(correction.evidenceAssessment ?? correction.evidence_assessment),
    note: clean(correction.note)
  };
}

function normalizeHistory(history = []) {
  return Array.isArray(history) ? history.filter((entry) => entry && typeof entry === "object") : [];
}

function normalizeCorrections(corrections = [], review = {}) {
  return Array.isArray(corrections)
    ? corrections.filter((entry) => entry && typeof entry === "object").map((entry) => normalizeCorrection(entry, review))
    : [];
}

function normalizeManagerReview(review = {}) {
  const callId = clean(review.callId || review.call_id);
  const importId = clean(review.importId || review.import_id) || "current";
  const alertId = clean(review.alertId || review.alert_id);
  const reviewScope = normalizeReviewScope(review.reviewScope || review.review_scope || review.scope || (alertId ? "alert" : "call"));
  const reviewStatus = normalizeReviewStatus(review.reviewStatus || review.review_status || review.status);
  const reviewId = review.reviewId || review.review_id || review.id || reviewIdFor({ importId, callId, alertId, reviewScope, signalName: review.signalName || review.signal_name });
  const normalized = {
    ...review,
    id: reviewId,
    reviewId,
    importId,
    callId,
    alertId,
    signalName: clean(review.signalName || review.signal_name),
    reviewScope,
    reviewStatus,
    status: reviewStatus,
    reviewedBy: review.reviewedBy || review.reviewed_by || DEFAULT_MANAGER_REVIEW_ACTOR,
    reviewedAt: review.reviewedAt || review.reviewed_at || review.updatedAt || review.createdAt || "",
    createdAt: review.createdAt || review.created_at || "",
    updatedAt: review.updatedAt || review.updated_at || "",
    reviewReason: clean(review.reviewReason || review.review_reason),
    managerNotes: clean(review.managerNotes || review.manager_notes || review.notes),
    escalationReason: clean(review.escalationReason || review.escalation_reason),
    source: clean(review.source) || "dashboard",
    latestAction: clean(review.latestAction || review.latest_action),
    latestActionAt: review.latestActionAt || review.latest_action_at || "",
    corrections: [],
    reviewHistory: normalizeHistory(review.reviewHistory || review.review_history),
    confirmedOutcome: clean(review.confirmedOutcome || review.confirmed_outcome),
    confirmedFollowUpRequired: Boolean(review.confirmedFollowUpRequired || review.confirmed_follow_up_required)
  };
  normalized.corrections = normalizeCorrections(review.corrections || [], normalized);
  return normalized;
}

function correctionInputsFrom(input = {}) {
  const corrections = Array.isArray(input.corrections) ? input.corrections.slice() : [];
  const fieldName = input.fieldName || input.field_name || input.correctionField || input.correction_field;
  const value = input.managerCorrectedValue ?? input.manager_corrected_value ?? input.correctedValue ?? input.corrected_value;
  if (fieldName && value !== undefined && value !== null && clean(value) !== "") {
    corrections.push({
      fieldName,
      rawValue: input.rawValue ?? input.raw_value,
      deterministicValue: input.deterministicValue ?? input.deterministic_value,
      llmValue: input.llmValue ?? input.llm_value,
      previousDisplayValue: input.previousDisplayValue ?? input.previous_display_value,
      managerCorrectedValue: value,
      correctionReason: input.correctionReason ?? input.correction_reason ?? input.reason,
      evidenceAssessment: input.evidenceAssessment ?? input.evidence_assessment,
      note: input.note
    });
  }
  if (!corrections.length && input.confirmedOutcome) {
    corrections.push({
      fieldName: "local_outcome_category",
      previousDisplayValue: input.previousDisplayValue || input.localOutcome || "",
      deterministicValue: input.deterministicValue || input.localOutcome || "",
      rawValue: input.rawValue || input.rawNoSaleType || "",
      managerCorrectedValue: input.confirmedOutcome,
      correctionReason: input.correctionReason || input.reason || "Manager confirmed or corrected outcome.",
      note: input.note || input.notes || input.managerNotes || ""
    });
  }
  return corrections;
}

function buildNewCorrections(input = {}, baseReview = {}, actor, timestamp) {
  return correctionInputsFrom(input).map((correction, index) => {
    const fieldName = validateCorrectionField(correction.fieldName || correction.field_name);
    return normalizeCorrection({
      ...correction,
      correctionId: correction.correctionId || correctionIdFor(baseReview.reviewId, fieldName, timestamp, (baseReview.corrections || []).length + index),
      reviewId: baseReview.reviewId,
      callId: baseReview.callId,
      alertId: baseReview.alertId,
      fieldName,
      correctedBy: actor,
      correctedAt: timestamp
    }, baseReview);
  });
}

function appendNote(existing, note, actor, timestamp) {
  const text = clean(note);
  if (!text) return existing || "";
  const entry = `[${timestamp}] ${actor}: ${text}`;
  return [existing, entry].filter(Boolean).join("\n");
}

function applyManagerReviewAction(existingReview = null, input = {}) {
  const now = input.now || new Date().toISOString();
  const actor = resolveManagerReviewActor(input);
  const callId = clean(input.callId || input.call_id || existingReview?.callId || existingReview?.call_id);
  if (!callId) {
    const error = new Error("callId is required for manager review");
    error.statusCode = 400;
    throw error;
  }
  const importId = clean(input.importId || input.import_id || existingReview?.importId || existingReview?.import_id) || "current";
  const alertId = clean(input.alertId || input.alert_id || existingReview?.alertId || existingReview?.alert_id);
  const reviewScope = requireReviewScope(input.reviewScope || input.review_scope || input.scope || existingReview?.reviewScope || existingReview?.review_scope || (alertId ? "alert" : "call"));
  const base = existingReview ? normalizeManagerReview(existingReview) : normalizeManagerReview({
    id: input.id || input.reviewId || reviewIdFor({ importId, callId, alertId, reviewScope, signalName: input.signalName || input.signal_name }),
    importId,
    callId,
    alertId,
    reviewScope,
    signalName: input.signalName || input.signal_name,
    reviewStatus: "unreviewed",
    source: input.source || "dashboard",
    createdAt: now,
    updatedAt: now,
    reviewedBy: actor,
    reviewedAt: now
  });

  const action = normalizeReviewAction(input.action, input.reviewStatus || input.review_status || input.status);
  const explicitStatus = input.reviewStatus || input.review_status || input.status;
  if (!action && explicitStatus && !MANAGER_REVIEW_STATUSES.includes(normalizeReviewStatus(explicitStatus, ""))) {
    const error = new Error("Invalid manager review status.");
    error.statusCode = 400;
    throw error;
  }
  if (!action && input.action) {
    const error = new Error("Invalid manager review action.");
    error.statusCode = 400;
    throw error;
  }

  const fromStatus = normalizeReviewStatus(base.reviewStatus);
  const newCorrections = buildNewCorrections(input, base, actor, now);
  const hasCorrection = newCorrections.length > 0;
  let toStatus = action
    ? statusForReviewAction(action, fromStatus)
    : explicitStatus
      ? normalizeReviewStatus(explicitStatus)
      : fromStatus;
  if (!action && !explicitStatus && hasCorrection) toStatus = "reviewed_corrected";
  if (!action && !explicitStatus && !hasCorrection && clean(input.note || input.notes || input.managerNotes)) toStatus = fromStatus;
  if (toStatus === "unreviewed" && (action || hasCorrection)) toStatus = hasCorrection ? "reviewed_corrected" : "review_needed";

  const note = clean(input.note || input.notes || input.managerNotes || input.reviewNotes);
  const reviewReason = clean(input.reviewReason || input.review_reason || input.reason);
  const escalationReason = clean(input.escalationReason || input.escalation_reason);
  const latestAction = action || (hasCorrection ? "correct" : explicitStatus ? "status_update" : "note");
  const next = {
    ...base,
    id: base.reviewId,
    reviewId: base.reviewId,
    importId,
    callId,
    alertId,
    signalName: clean(input.signalName || input.signal_name || base.signalName),
    reviewScope,
    reviewStatus: toStatus,
    status: toStatus,
    reviewedBy: actor,
    reviewedAt: now,
    updatedAt: now,
    reviewReason: reviewReason || base.reviewReason,
    escalationReason: escalationReason || base.escalationReason,
    managerNotes: appendNote(base.managerNotes, note, actor, now),
    latestAction,
    latestActionAt: now,
    source: clean(input.source) || base.source || "dashboard",
    corrections: [...(base.corrections || []), ...newCorrections],
    reviewHistory: [
      ...(base.reviewHistory || []),
      {
        eventId: historyIdFor(base.reviewId, latestAction, now, (base.reviewHistory || []).length),
        reviewId: base.reviewId,
        callId,
        alertId,
        action: latestAction,
        previousStatus: fromStatus,
        newStatus: toStatus,
        actor,
        timestamp: now,
        note,
        metadata: {
          reviewScope,
          signalName: clean(input.signalName || input.signal_name || base.signalName),
          correctedFields: newCorrections.map((correction) => correction.fieldName)
        }
      }
    ],
    confirmedOutcome: clean(input.confirmedOutcome || base.confirmedOutcome),
    confirmedFollowUpRequired: input.confirmedFollowUpRequired !== undefined
      ? Boolean(input.confirmedFollowUpRequired)
      : base.confirmedFollowUpRequired
  };

  return normalizeManagerReview(next);
}

function reviewStatusLabel(status) {
  const labels = {
    unreviewed: "Unreviewed",
    review_needed: "Review needed",
    in_review: "In review",
    reviewed_confirmed: "Reviewed confirmed",
    reviewed_corrected: "Reviewed corrected",
    dismissed: "Review dismissed",
    escalated: "Escalated"
  };
  return labels[normalizeReviewStatus(status)] || "Unreviewed";
}

function reviewStatusTone(status) {
  const normalized = normalizeReviewStatus(status);
  if (normalized === "reviewed_confirmed") return "success";
  if (normalized === "reviewed_corrected") return "warning";
  if (normalized === "escalated") return "critical";
  if (normalized === "dismissed") return "neutral";
  if (normalized === "review_needed" || normalized === "in_review") return "notice";
  return "neutral";
}

function latestReviewByCallId(reviews = []) {
  const map = new Map();
  reviews.map(normalizeManagerReview).forEach((review) => {
    if (!review.callId) return;
    const existing = map.get(review.callId);
    if (!existing || String(review.updatedAt || review.createdAt).localeCompare(String(existing.updatedAt || existing.createdAt)) >= 0) {
      map.set(review.callId, review);
    }
  });
  return map;
}

function summarizeManagerReviews(reviews = [], callIds = null) {
  const allowedCallIds = callIds ? new Set(Array.from(callIds).filter(Boolean)) : null;
  const normalized = reviews.map(normalizeManagerReview).filter((review) => !allowedCallIds || allowedCallIds.has(review.callId));
  const latest = Array.from(latestReviewByCallId(normalized).values());
  const byStatus = Object.fromEntries(MANAGER_REVIEW_STATUSES.map((status) => [status, 0]));
  const topCorrectedFields = new Map();
  latest.forEach((review) => {
    byStatus[review.reviewStatus] = (byStatus[review.reviewStatus] || 0) + 1;
    (review.corrections || []).forEach((correction) => {
      topCorrectedFields.set(correction.fieldName, (topCorrectedFields.get(correction.fieldName) || 0) + 1);
    });
  });
  const reviewed = latest.filter((review) => REVIEW_COMPLETE_STATUSES.includes(review.reviewStatus) || review.reviewStatus === "in_review").length;
  const corrected = latest.filter((review) => review.reviewStatus === "reviewed_corrected" || (review.corrections || []).length).length;
  return {
    schemaVersion: "sales_dashboard_manager_review_summary.v1",
    totalReviews: normalized.length,
    reviewedCalls: reviewed,
    correctedCalls: corrected,
    escalatedCalls: latest.filter((review) => review.reviewStatus === "escalated").length,
    dismissedCalls: latest.filter((review) => review.reviewStatus === "dismissed").length,
    reviewNeededCalls: latest.filter((review) => review.reviewStatus === "review_needed").length,
    inReviewCalls: latest.filter((review) => review.reviewStatus === "in_review").length,
    reviewedConfirmedCalls: latest.filter((review) => review.reviewStatus === "reviewed_confirmed").length,
    reviewedCorrectedCalls: latest.filter((review) => review.reviewStatus === "reviewed_corrected").length,
    byStatus,
    topCorrectedFields: Array.from(topCorrectedFields.entries())
      .map(([fieldName, count]) => ({ fieldName, count }))
      .sort((a, b) => b.count - a.count || a.fieldName.localeCompare(b.fieldName))
      .slice(0, 10)
  };
}

module.exports = {
  CORRECTION_FIELDS,
  DEFAULT_MANAGER_REVIEW_ACTOR,
  MANAGER_REVIEW_STATUSES,
  REVIEW_COMPLETE_STATUSES,
  REVIEW_OPEN_STATUSES,
  REVIEW_SCOPES,
  applyManagerReviewAction,
  latestReviewByCallId,
  normalizeManagerReview,
  normalizeReviewAction,
  normalizeReviewScope,
  normalizeReviewStatus,
  resolveManagerReviewActor,
  reviewIdFor,
  reviewStatusLabel,
  reviewStatusTone,
  summarizeManagerReviews,
  validateCorrectionField
};
