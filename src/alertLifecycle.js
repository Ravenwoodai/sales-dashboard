"use strict";

const crypto = require("crypto");

const DEFAULT_ALERT_ACTOR = "local_manager";
const ALERT_STATUSES = [
  "new",
  "acknowledged",
  "in_progress",
  "resolved",
  "dismissed",
  "false_positive",
  "parked"
];
const ACTIVE_ALERT_STATUSES = ["new", "acknowledged", "in_progress"];
const CLOSED_ALERT_STATUSES = ["resolved", "dismissed", "false_positive"];

const STATUS_LABELS = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
  false_positive: "Likely false positive",
  parked: "Parked"
};

const ACTIONS = {
  acknowledge: "acknowledged",
  acknowledged: "acknowledged",
  in_progress: "in_progress",
  mark_in_progress: "in_progress",
  resolve: "resolved",
  resolved: "resolved",
  dismiss: "dismissed",
  dismissed: "dismissed",
  false_positive: "false_positive",
  mark_false_positive: "false_positive",
  reopen: "new",
  note: null,
  add_note: null
};

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function normalizeAlertStatus(status) {
  const normalized = normalizeKey(status);
  if (normalized === "active") return "new";
  if (normalized === "inprogress") return "in_progress";
  if (normalized === "falsepositive") return "false_positive";
  return ALERT_STATUSES.includes(normalized) ? normalized : "new";
}

function statusLabel(status) {
  return STATUS_LABELS[normalizeAlertStatus(status)] || "New";
}

function isActiveAlertStatus(status) {
  return ACTIVE_ALERT_STATUSES.includes(normalizeAlertStatus(status));
}

function isClosedAlertStatus(status) {
  return CLOSED_ALERT_STATUSES.includes(normalizeAlertStatus(status));
}

function normalizeAlertAction(action) {
  const normalized = normalizeKey(action);
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, normalized)) return "";
  return normalized;
}

function statusForAction(action, currentStatus = "new") {
  const normalized = normalizeAlertAction(action);
  if (!normalized) return "";
  const nextStatus = ACTIONS[normalized];
  return nextStatus === null ? normalizeAlertStatus(currentStatus) : nextStatus;
}

function ruleIdForAlert(alert = {}) {
  const category = String(alert.category || alert.ruleId || "alert").trim() || "alert";
  const slug = normalizeKey(category).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "alert";
  return alert.ruleId || `rule_${slug}`;
}

function alertIdFor(importId, alert = {}) {
  const key = `${importId || "current"}|${alert.category || alert.ruleId || "alert"}|${alert.callId || ""}|${alert.severity || "notice"}`;
  return `alert_${digest(key, 20)}`;
}

function confidenceLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "Confidence unavailable";
  return `${Math.round(number * 100)}% confidence`;
}

function recommendedActionForAlert(alert = {}) {
  const category = String(alert.category || "").toLowerCase();
  if (category.includes("opt-out") || category.includes("complaint") || category.includes("risk")) {
    return "Review transcript proof and confirm any customer-risk handling.";
  }
  if (category.includes("follow-up")) {
    return "Check whether a follow-up action is needed or already completed outside this upload.";
  }
  return "Review the linked call proof and decide the next manager action.";
}

function normalizeHistory(history) {
  return Array.isArray(history) ? history.filter((entry) => entry && typeof entry === "object") : [];
}

function normalizedManagerNotes(event = {}) {
  if (typeof event.managerNotes === "string") return event.managerNotes;
  if (Array.isArray(event.managerNotes)) {
    return event.managerNotes.map((entry) => typeof entry === "string" ? entry : entry?.note).filter(Boolean).join("\n");
  }
  return "";
}

function normalizeAlertEvent(event = {}) {
  const status = event.parkedDataRelated ? "parked" : normalizeAlertStatus(event.status);
  const id = event.id || event.alertId || "";
  return {
    ...event,
    id,
    alertId: event.alertId || id,
    ruleId: event.ruleId || ruleIdForAlert(event),
    status,
    statusLabel: statusLabel(status),
    active: isActiveAlertStatus(status),
    closed: isClosedAlertStatus(status),
    parkedDataRelated: Boolean(event.parkedDataRelated || status === "parked"),
    falsePositive: status === "false_positive" || Boolean(event.falsePositive),
    managerNotes: normalizedManagerNotes(event),
    managerNoteEntries: Array.isArray(event.managerNoteEntries) ? event.managerNoteEntries : [],
    lifecycleHistory: normalizeHistory(event.lifecycleHistory),
    latestAction: event.latestAction || "",
    latestActionAt: event.latestActionAt || "",
    alertProvenance: event.alertProvenance || event.provenance || "Deterministic",
    provenance: event.provenance || event.alertProvenance || "Deterministic",
    confidence: event.confidence ?? null,
    confidenceLabel: event.confidenceLabel || confidenceLabel(event.confidence)
  };
}

function mergeAlertWithEvent(alert = {}, event = null, importId = "current") {
  const id = alert.id || alert.alertId || alertIdFor(importId, alert);
  const normalized = event ? normalizeAlertEvent({ ...event, id: event.id || id }) : normalizeAlertEvent({
    id,
    alertId: id,
    importId,
    callId: alert.callId,
    category: alert.category,
    severity: alert.severity,
    status: alert.status || "new",
    createdAt: alert.createdAt || "",
    updatedAt: alert.updatedAt || ""
  });
  const status = normalized.parkedDataRelated ? "parked" : normalizeAlertStatus(normalized.status);
  return {
    ...alert,
    id,
    alertId: id,
    ruleId: normalized.ruleId || ruleIdForAlert(alert),
    importId: normalized.importId || importId,
    status,
    statusLabel: statusLabel(status),
    active: isActiveAlertStatus(status),
    closed: isClosedAlertStatus(status),
    createdAt: normalized.createdAt || alert.createdAt || "",
    updatedAt: normalized.updatedAt || alert.updatedAt || "",
    acknowledgedBy: normalized.acknowledgedBy || "",
    acknowledgedAt: normalized.acknowledgedAt || "",
    inProgressBy: normalized.inProgressBy || "",
    inProgressAt: normalized.inProgressAt || "",
    resolvedBy: normalized.resolvedBy || "",
    resolvedAt: normalized.resolvedAt || "",
    dismissedBy: normalized.dismissedBy || "",
    dismissedAt: normalized.dismissedAt || "",
    falsePositiveBy: normalized.falsePositiveBy || "",
    falsePositiveAt: normalized.falsePositiveAt || "",
    managerNotes: normalized.managerNotes || "",
    managerNoteEntries: normalized.managerNoteEntries || [],
    latestAction: normalized.latestAction || "",
    latestActionAt: normalized.latestActionAt || "",
    lifecycleHistory: normalized.lifecycleHistory || [],
    evidence: alert.evidence || normalized.evidence || "",
    evidenceSummary: alert.evidenceSummary || normalized.evidenceSummary || "Evidence unavailable",
    evidenceAvailable: Boolean(alert.evidence || alert.evidenceSummary || normalized.evidence || normalized.evidenceSummary),
    confidence: alert.confidence ?? normalized.confidence ?? null,
    confidenceLabel: alert.confidenceLabel || normalized.confidenceLabel || confidenceLabel(alert.confidence),
    provenance: alert.provenance || normalized.provenance || "Deterministic",
    alertProvenance: alert.alertProvenance || normalized.alertProvenance || "Deterministic",
    recommendedAction: alert.recommendedAction || recommendedActionForAlert(alert)
  };
}

function appendNoteText(existing, note, actor, at) {
  const text = String(note || "").trim();
  if (!text) return existing || "";
  const prefix = `[${at}] ${actor}: `;
  return [existing, `${prefix}${text}`].filter(Boolean).join("\n");
}

function resolveAlertLifecycleActor() {
  return DEFAULT_ALERT_ACTOR;
}

function applyAlertLifecycleAction(event = {}, input = {}) {
  const action = normalizeAlertAction(input.action || input.status);
  if (!action) {
    const error = new Error("Invalid alert lifecycle action.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizeAlertEvent(event);
  if (normalized.parkedDataRelated || normalized.status === "parked") {
    const error = new Error("Parked alerts are excluded from the active alert workflow.");
    error.statusCode = 403;
    throw error;
  }
  const actor = resolveAlertLifecycleActor(input);
  const at = input.now || new Date().toISOString();
  const fromStatus = normalizeAlertStatus(normalized.status);
  const toStatus = statusForAction(action, fromStatus);
  const note = String(input.note || input.reason || input.managerNotes || "").trim();
  const next = {
    ...normalized,
    status: toStatus,
    statusLabel: statusLabel(toStatus),
    active: isActiveAlertStatus(toStatus),
    closed: isClosedAlertStatus(toStatus),
    falsePositive: toStatus === "false_positive",
    updatedAt: at,
    latestAction: action,
    latestActionAt: at,
    managerNotes: appendNoteText(normalized.managerNotes, note, actor, at),
    managerNoteEntries: note
      ? [...(normalized.managerNoteEntries || []), { note, actor, at, action }]
      : normalized.managerNoteEntries || [],
    lifecycleHistory: [
      ...(normalized.lifecycleHistory || []),
      { action, fromStatus, toStatus, actor, note, at }
    ]
  };

  if (toStatus === "acknowledged") {
    next.acknowledgedBy = actor;
    next.acknowledgedAt = at;
  }
  if (toStatus === "in_progress") {
    next.inProgressBy = actor;
    next.inProgressAt = at;
  }
  if (toStatus === "resolved") {
    next.resolvedBy = actor;
    next.resolvedAt = at;
  }
  if (toStatus === "dismissed") {
    next.dismissedBy = actor;
    next.dismissedAt = at;
  }
  if (toStatus === "false_positive") {
    next.falsePositiveBy = actor;
    next.falsePositiveAt = at;
  }
  if (action === "reopen") {
    next.reopenedBy = actor;
    next.reopenedAt = at;
  }

  return next;
}

function summarizeAlerts(alerts = []) {
  const rows = alerts.map(normalizeAlertEvent);
  const byStatus = Object.fromEntries(ALERT_STATUSES.map((status) => [status, 0]));
  const bySeverity = { critical: 0, warning: 0, notice: 0 };
  rows.forEach((alert) => {
    byStatus[alert.status] = (byStatus[alert.status] || 0) + 1;
    const severity = alert.severity || "notice";
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  });
  return {
    schemaVersion: "sales_dashboard_alert_lifecycle_summary.v1",
    total: rows.length,
    active: rows.filter((alert) => isActiveAlertStatus(alert.status)).length,
    closed: rows.filter((alert) => isClosedAlertStatus(alert.status)).length,
    parked: rows.filter((alert) => alert.parkedDataRelated || alert.status === "parked").length,
    byStatus,
    bySeverity,
    new: byStatus.new || 0,
    acknowledged: byStatus.acknowledged || 0,
    inProgress: byStatus.in_progress || 0,
    resolved: byStatus.resolved || 0,
    dismissed: byStatus.dismissed || 0,
    falsePositive: byStatus.false_positive || 0
  };
}

module.exports = {
  ACTIVE_ALERT_STATUSES,
  ALERT_STATUSES,
  CLOSED_ALERT_STATUSES,
  DEFAULT_ALERT_ACTOR,
  STATUS_LABELS,
  alertIdFor,
  applyAlertLifecycleAction,
  confidenceLabel,
  isActiveAlertStatus,
  isClosedAlertStatus,
  mergeAlertWithEvent,
  normalizeAlertAction,
  normalizeAlertEvent,
  normalizeAlertStatus,
  recommendedActionForAlert,
  resolveAlertLifecycleActor,
  ruleIdForAlert,
  statusForAction,
  statusLabel,
  summarizeAlerts
};
