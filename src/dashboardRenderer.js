"use strict";

const {
  CORRECTION_FIELDS,
  MANAGER_REVIEW_STATUSES,
  REVIEW_SCOPES,
  normalizeManagerReview,
  reviewStatusLabel,
  reviewStatusTone
} = require("./managerReview");
const { EVALUATION_GOALS, evaluationResultFacets } = require("./evaluationStudio");
const {
  formatAestDateTime,
  formatSourceDateTimeValue,
  formatSourceDateValue
} = require("./dateTimeFormat");

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-AU");
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatRatioPercent(value) {
  if (value === null || value === undefined) return "n/a";
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatDateRange(range) {
  if (!range || !range.start || !range.end) return "No CSV loaded";
  if (range.sourceStart && range.sourceEnd) {
    return `${formatSourceDateTimeValue(range.sourceStart)} to ${formatSourceDateTimeValue(range.sourceEnd)} (${range.sourceTimezoneLabel || "Source call time (AEST)"})`;
  }
  if (range.display) return range.display;
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Date range unavailable";
  return `${formatAestDateTime(start)} to ${formatAestDateTime(end)}`;
}

function formatDateTime(value) {
  return formatAestDateTime(value);
}

function formatSourceTime(row = {}) {
  return row.sourceTime || formatSourceDateTimeValue(row.date, row.time);
}

function formatSourceDate(value) {
  return formatSourceDateValue(value);
}

function humanizeSlug(value) {
  return String(value || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function shortHash(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 12) : "Unavailable";
}

function safeSourceFilename(value) {
  const text = String(value || "CSV import").trim();
  const filename = text.split(/[\\/]/).filter(Boolean).pop() || text;
  return filename.slice(0, 160);
}

const COLUMN_DESCRIPTIONS = Object.freeze({
  action: "The action available for this row.",
  actions: "The actions available for this row. Actions only affect the selected record.",
  actor: "The locally recorded user or system actor responsible for this event.",
  affected: "The number of records affected by this item or action.",
  alert: "The alert type and the call or signal that caused it to be created.",
  answer: "The evaluator's plain-language conclusion for this record.",
  audit: "The stored evaluation or processing audit details for this row.",
  business: "The business segment or business context associated with this record.",
  call: "The call identifier. Select it to open the full transcript proof when available.",
  calls: "The number of calls represented by this row.",
  carrier: "The carrier or telephony-system category detected for this call.",
  check: "Whether the result suggests a manual check before relying on it.",
  confidence: "How strongly the available evidence supports this result. It is not a probability of sale.",
  contact: "The detected contact state, such as customer, voicemail, no answer or system audio.",
  corrections: "The number or details of separately stored human corrections. Original data remains preserved.",
  count: "The number of matching records represented by this row.",
  created_by: "Who or what created the customer record according to the imported call data.",
  creator: "The imported creator category or identifier associated with this record.",
  customer_id: "The imported customer identifier used to connect related calls. It is not a performance measure.",
  date: "The source call date shown in Australian format without browser timezone shifting.",
  day: "The source call calendar day represented by this row.",
  derived_outcome: "The locally derived outcome based on call evidence. It is not an imported or manager-confirmed disposition.",
  duration: "The call duration recorded by the source data.",
  evidence: "The transcript or metadata evidence supporting the displayed finding.",
  evidence_snippet: "A short proof excerpt. Open the call to inspect the fuller transcript context.",
  field: "The evaluated or corrected field represented by this row.",
  finding: "The evidence-backed signal identified by the evaluator.",
  follow_up: "The detected follow-up state. A later matching call is not the same as confirmed completion.",
  follow_up_signals: "The number of calls containing evidence of a callback or follow-up requirement.",
  from: "The previous value or status before this recorded change.",
  import: "The source import associated with this record or saved snapshot.",
  intelligence: "The available deterministic or local-model intelligence for this call.",
  item: "The queue, report or review item represented by this row.",
  job: "The local AI Execution Layer job associated with this evaluation.",
  lead_state: "The evidence-based working state of the lead. It does not automatically change CRM or lead status.",
  llm: "The local model processing state and result availability for this record.",
  loaded: "When this import or record was loaded into the local dashboard, shown in AEST.",
  local_outcome: "The deterministic local outcome inferred from call evidence, kept separate from raw imported fields.",
  manager_review: "The separately stored human-review state. It is not the same as alert lifecycle status.",
  note: "The locally stored note associated with this item.",
  notes: "Locally stored notes associated with this item. Notes do not replace source evidence.",
  objection: "The objection or barrier indicated by the call transcript.",
  open: "Opens the detailed evidence or transcript view for this row.",
  outcome: "The evidence-backed call outcome shown for this row. It is not confirmed revenue or conversion.",
  proof: "The transcript or record link used to inspect the evidence behind this row.",
  provenance: "Where the displayed value came from, such as raw import, deterministic logic, local model or human review.",
  rate: "The percentage of the relevant matching population represented by this row.",
  reason: "The reason supporting the displayed classification, status or action.",
  recommendation: "The suggested next step based on available evidence. It is advisory and does not change operational records.",
  record_age: "Days between the source call and the valid CustomerImportDate, or CustomerCreateDate when no valid import date exists.",
  region: "The call region supplied or derived from the active call data.",
  report: "The saved report record. Hidden or parked historical reports remain excluded from normal views.",
  response: "The response or handling observed in the call evidence.",
  review: "The local review state or review action associated with this row.",
  reviewed: "The number or state of records that have a completed human review.",
  run: "The Evaluation Studio run identifier and evaluator used.",
  salesperson: "The salesperson associated with the call records represented by this row.",
  scope: "The call, alert, signal or workflow area covered by this review.",
  score: "The displayed evidence-based score and its local scoring scale. It is not confirmed sales performance.",
  segment: "The New Business or Warm Business segment derived from the available order-history context.",
  select: "Selects this row for a bulk action. Unselected rows are not changed.",
  severity: "The operational priority assigned to this alert or review signal.",
  share: "The percentage share of the relevant matching population.",
  signal: "The evidence-backed signal or classification represented by this row.",
  source: "The CustomerImportSource or other source context supplied by the call data.",
  source_time: "The source call date and time shown in AEST without browser timezone shifting.",
  status: "The current stored state for this item. Its exact meaning depends on the workflow shown.",
  subtype: "The more specific category detected within the broader call or system-audio type.",
  summary: "A concise explanation of the evidence and conclusion for this row.",
  task: "The local processing task type associated with this job.",
  time: "The source call time shown in AEST.",
  to: "The new value or status after this recorded change.",
  trust: "The evidence, confidence and provenance conditions that determine how safely this result can be used.",
  type: "The category of record, run, alert, report or workflow item shown.",
  updated: "When this record was last stored or changed, shown in AEST.",
  use: "How this signal may safely be interpreted or used in the dashboard.",
  value: "The value stored or displayed for the named field.",
  versions: "The evaluator template and knowledgebase versions preserved with this run.",
  when: "When the event or change occurred, shown in AEST."
});

const COLUMN_HELP_STYLES = `
  .column-help { position: relative; display: inline-flex; align-items: center; gap: 5px; cursor: help; outline: none; }
  .column-help-mark { display: inline-grid; place-items: center; width: 15px; height: 15px; border: 1px solid rgba(86, 214, 229, 0.5); border-radius: 50%; color: var(--accent); font-size: 10px; font-weight: 800; line-height: 1; }
  .column-tooltip { position: absolute; z-index: 30; top: calc(100% + 8px); left: 0; width: min(280px, calc(100vw - 48px)); padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); background: var(--background); box-shadow: var(--shadow); font-size: 12px; font-weight: 500; line-height: 1.4; text-align: left; text-transform: none; visibility: hidden; opacity: 0; transform: translateY(-3px); transition: opacity 120ms ease, transform 120ms ease; pointer-events: none; }
  th:nth-last-child(-n + 2) .column-tooltip { right: 0; left: auto; }
  .column-help:hover .column-tooltip, .column-help:focus-visible .column-tooltip { visibility: visible; opacity: 1; transform: translateY(0); }
`;

function normalizeColumnLabel(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function columnDescription(label, provided = "") {
  if (String(provided || "").trim()) return String(provided).trim();
  const key = normalizeColumnLabel(label);
  if (COLUMN_DESCRIPTIONS[key]) return COLUMN_DESCRIPTIONS[key];
  const plain = String(label || "this field").trim();
  if (/^(avg|average)\b/i.test(plain)) return `The average ${plain.replace(/^(avg|average)\s*/i, "").toLowerCase()} for records represented by this row.`;
  if (/(rate|share|coverage|percent|%)$/i.test(plain)) return `The percentage of the relevant matching population represented by ${plain.toLowerCase()}.`;
  if (/(calls|records|leads|alerts|candidates|encounters|follow-ups|bails|items)$/i.test(plain)) return `The number of ${plain.toLowerCase()} represented by this row.`;
  return `The ${plain.toLowerCase()} value shown for this row.`;
}

function renderTableHeading(header) {
  const labelValue = typeof header === "string" ? header : header?.label;
  const descriptionValue = columnDescription(labelValue, typeof header === "string" ? "" : header?.description);
  const label = escapeHtml(labelValue);
  const description = escapeHtml(descriptionValue);
  return `<th scope="col"><span class="column-help" tabindex="0" aria-label="${escapeHtml(`${labelValue}: ${descriptionValue}`)}">${label}<span class="column-help-mark" aria-hidden="true">?</span><span class="column-tooltip" role="tooltip">${description}</span></span></th>`;
}

function formatDays(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return `${formatNumber(Math.round(Number(value)))}d`;
}

function formatRecordAge(row = {}) {
  if (row.daysSinceRecord === null || row.daysSinceRecord === undefined || Number.isNaN(Number(row.daysSinceRecord))) {
    return `<span class="muted small">No valid date</span>`;
  }
  const basis = row.recordAgeBasisLabel || "Record date";
  return `${formatDays(row.daysSinceRecord)}<br /><span class="muted small">${escapeHtml(basis)}</span>`;
}

function drilldownUrl(metric, filters = {}) {
  const params = new URLSearchParams();
  if (metric) params.set("metric", metric);
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value));
    }
  });
  return `/drilldown?${params.toString()}`;
}

function dashboardFilterUrl(filters = {}, hash = "") {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value));
    }
  });
  return `/${params.toString() ? `?${params.toString()}` : ""}${hash ? `#${hash}` : ""}`;
}

function dataLink(metric, value, filters = {}) {
  return `<a class="data-link" href="${escapeHtml(drilldownUrl(metric, filters))}">${escapeHtml(value)}</a>`;
}

function callLink(callId, label = callId) {
  if (!callId) return "";
  return `<a class="data-link mono" href="/calls/${encodeURIComponent(callId)}">${escapeHtml(label)}</a>`;
}

function customerIdValue(row) {
  const value = row?.customerId || row?.customer_id || "";
  return String(value || "").trim() || "Not available";
}

function contactIdValue(row) {
  const direct = row?.contactId || row?.ContactId || row?.rawFields?.ContactId || "";
  if (String(direct || "").trim()) return String(direct).trim();
  const stable = (row?.stableIds || []).find((item) => item.field === "ContactId");
  if (stable?.value) return String(stable.value).trim();
  if (row?.stableLeadSource === "ContactId" && row?.stableLeadValue) return String(row.stableLeadValue).trim();
  return "";
}

function customerIdCell(row, href = "") {
  const value = customerIdValue(row);
  const backupContactId = value === "Not available" ? contactIdValue(row) : "";
  const content = `<span class="mono">${escapeHtml(value)}</span>${backupContactId ? `<br /><span class="muted small">ContactId: <span class="mono">${escapeHtml(backupContactId)}</span></span>` : ""}`;
  return href && value !== "Not available"
    ? `<a class="data-link mono" href="${escapeHtml(href)}">${escapeHtml(value)}</a>`
    : content;
}

function badge(label, tone = "neutral") {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function provenanceTone(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("needed")) return "critical";
  if (text.includes("manager")) return "success";
  if (text.includes("llm-reviewed")) return "success";
  if (text.includes("deterministic")) return "notice";
  if (text.includes("raw imported")) return "neutral";
  if (text.includes("failed")) return "critical";
  if (text.includes("unprocessed") || text.includes("not requested")) return "warning";
  return "neutral";
}

function provenanceBadge(label) {
  return badge(label || "Unknown", provenanceTone(label));
}

function llmReviewState(row = {}) {
  const status = String(row.llm_status || row.llmStatus || "not_requested").trim() || "not_requested";
  const quality = String(row.llm_result_quality || "").trim();
  const hasResult = Boolean(String(row.llm_result_json || "").trim());
  const validQuality = ["complete_json", "salvaged_raw", "salvage_available"].includes(quality);
  if (status === "completed" && hasResult && validQuality) return "LLM-reviewed";
  if (status === "failed" || (status === "completed" && (!hasResult || !validQuality))) return "Failed";
  if (status === "queued") return "Unprocessed";
  if (status === "not_requested") return "Not requested";
  return status ? status.replace(/_/g, " ") : "Unknown";
}

function confidenceBandLabel(band) {
  if (band === "high") return "High confidence";
  if (band === "medium") return "Medium confidence";
  if (band === "low") return "Low confidence";
  if (band === "unusable") return "Unusable transcript";
  return "Confidence unavailable";
}

function confidenceBandTone(band) {
  if (band === "high") return "success";
  if (band === "medium") return "notice";
  if (band === "low") return "warning";
  if (band === "unusable") return "critical";
  return "neutral";
}

function confidenceBadgeForRow(row = {}) {
  const band = row.confidenceBand || row.transcriptQuality || "unknown";
  return badge(row.confidenceLabel || confidenceBandLabel(band), confidenceBandTone(band));
}

function alertStatusTone(status = "") {
  const normalized = String(status || "new").toLowerCase();
  if (normalized === "new") return "critical";
  if (normalized === "acknowledged" || normalized === "in_progress") return "notice";
  if (normalized === "resolved") return "success";
  if (normalized === "dismissed" || normalized === "false_positive") return "neutral";
  if (normalized === "parked") return "warning";
  return "neutral";
}

function alertStatusLabel(status = "") {
  const labels = {
    new: "New",
    acknowledged: "Acknowledged",
    in_progress: "In progress",
    resolved: "Resolved",
    dismissed: "Dismissed",
    false_positive: "Likely false positive",
    parked: "Parked"
  };
  return labels[status] || String(status || "New").replace(/_/g, " ");
}

function alertConfidenceBadge(row = {}) {
  if (row.confidenceLabel) return badge(row.confidenceLabel, row.confidence ? "notice" : "neutral");
  return badge("Confidence unavailable", "neutral");
}

function alertLifecycleCounts(summary = {}) {
  const status = summary.byStatus || {};
  return [
    badge(`${formatNumber(summary.active || 0)} active`, (summary.active || 0) ? "critical" : "neutral"),
    badge(`${formatNumber(status.new || 0)} new`, (status.new || 0) ? "critical" : "neutral"),
    badge(`${formatNumber(status.acknowledged || 0)} acknowledged`, (status.acknowledged || 0) ? "notice" : "neutral"),
    badge(`${formatNumber(status.in_progress || 0)} in progress`, (status.in_progress || 0) ? "notice" : "neutral"),
    badge(`${formatNumber(summary.closed || 0)} closed`, (summary.closed || 0) ? "success" : "neutral")
  ].join("");
}

function alertSeverityCounts(summary = {}) {
  const severity = summary.bySeverity || {};
  return [
    badge(`${formatNumber(severity.critical || 0)} critical`, (severity.critical || 0) ? "critical" : "neutral"),
    badge(`${formatNumber(severity.warning || 0)} warning`, (severity.warning || 0) ? "warning" : "neutral"),
    badge(`${formatNumber(severity.notice || 0)} notice`, (severity.notice || 0) ? "notice" : "neutral")
  ].join("");
}

function hiddenAlertFormFields(row = {}, returnTo = "", importId = "") {
  return `
    <input type="hidden" name="alertId" value="${escapeHtml(row.id || row.alertId || "")}" />
    <input type="hidden" name="importId" value="${escapeHtml(importId || row.importId || "")}" />
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo || "/#alerts")}" />`;
}

function alertActionForm(row = {}, action, label, returnTo = "", importId = "") {
  return `<form class="inline-alert-form" method="post" action="/alerts">
    ${hiddenAlertFormFields(row, returnTo, importId)}
    <input type="hidden" name="action" value="${escapeHtml(action)}" />
    <button type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function managerReviewActionForm(row = {}, action, label, options = {}) {
  const returnTo = options.returnTo || "/#alerts";
  const importId = options.importId || row.importId || "";
  const scope = options.reviewScope || row.reviewScope || (row.alertId || row.id ? "alert" : "call");
  const source = options.source || (scope === "alert" ? "alert_centre" : "dashboard");
  const reviewId = row.managerReviewId || options.reviewId || "";
  return `<form class="inline-alert-form" method="post" action="/reviews">
    <input type="hidden" name="callId" value="${escapeHtml(row.callId || row.call_id || "")}" />
    <input type="hidden" name="alertId" value="${escapeHtml(row.alertId || row.id || "")}" />
    <input type="hidden" name="reviewId" value="${escapeHtml(reviewId)}" />
    <input type="hidden" name="importId" value="${escapeHtml(importId)}" />
    <input type="hidden" name="reviewScope" value="${escapeHtml(scope)}" />
    <input type="hidden" name="source" value="${escapeHtml(source)}" />
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
    <input type="hidden" name="action" value="${escapeHtml(action)}" />
    <button type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function alertLifecycleControls(row = {}, returnTo = "", importId = "") {
  const status = row.status || "new";
  const actions = [];
  if (status === "new") actions.push(["acknowledge", "Acknowledge"], ["in_progress", "In progress"]);
  if (status === "acknowledged") actions.push(["in_progress", "In progress"]);
  if (status === "resolved" || status === "dismissed" || status === "false_positive") actions.push(["reopen", "Reopen"]);
  if (status !== "resolved") actions.push(["resolve", "Resolve"]);
  if (status !== "dismissed") actions.push(["dismiss", "Dismiss"]);
  if (status !== "false_positive") actions.push(["false_positive", "False positive"]);
  return `<div class="alert-actions">${actions.map(([action, label]) => alertActionForm(row, action, label, returnTo, importId)).join("")}</div>`;
}

function renderManagerNotes(row = {}) {
  const notes = String(row.managerNotes || "").trim();
  return notes
    ? `<span class="evidence">${escapeHtml(compactText(notes, 480))}</span>`
    : `<span class="muted small">No manager notes</span>`;
}

function renderAlertCentre(alertRows = [], summary = {}, options = {}) {
  const returnTo = options.returnTo || "/#alerts";
  const importId = options.importId || "";
  const filterSummary = options.filterSummary || {};
  const activeFilterText = filterSummary.active
    ? `${formatNumber(filterSummary.filteredRecords || 0)} of ${formatNumber(filterSummary.totalRecords || 0)} calls included by global filters.`
    : "All active call records are included.";
  const bulkForm = `<form id="alert-bulk-form" class="bulk-alert-form" method="post" action="/alerts">
    <input type="hidden" name="importId" value="${escapeHtml(importId)}" />
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
    <label>
      <span class="muted small">Bulk note</span>
      <textarea name="note" placeholder="Optional note for selected alerts"></textarea>
    </label>
    <div class="filter-actions">
      <button type="submit" name="action" value="acknowledge">Acknowledge selected</button>
      <button type="submit" name="action" value="in_progress">Mark in progress</button>
      <button type="submit" name="action" value="resolve">Resolve selected</button>
      <button type="submit" name="action" value="dismiss">Dismiss selected</button>
      <button type="submit" name="action" value="false_positive">False positive selected</button>
    </div>
  </form>`;
  return `
    <div class="alert-summary">
      <div class="stack">${alertLifecycleCounts(summary)}</div>
      <div class="stack">${alertSeverityCounts(summary)}</div>
      <p class="muted small">${escapeHtml(activeFilterText)} Active alerts are New, Acknowledged, and In progress. Parked allocation-related alerts are excluded.</p>
    </div>
    ${bulkForm}
    ${table([
      { label: "Select", render: (row) => `<input class="table-checkbox" form="alert-bulk-form" type="checkbox" name="alertIds" value="${escapeHtml(row.id || row.alertId || "")}" />` },
      { label: "Status", render: (row) => badge(alertStatusLabel(row.status), alertStatusTone(row.status)) },
      { label: "Manager review", render: (row) => `${managerReviewBadge(row, new Map())}<br />${managerCorrectionSummary(row, new Map())}<br />${managerSuggestedCorrectionSummary(row, new Map())}<div class="alert-actions">${managerReviewActionForm(row, "mark_review_needed", "Review call", { returnTo, importId, reviewScope: "alert", source: "alert_centre" })}</div>` },
      { label: "Severity", render: (row) => badge(row.severity, row.severity === "critical" ? "critical" : row.severity === "warning" ? "warning" : "notice") },
      { label: "Alert", render: (row) => `<strong>${escapeHtml(row.category || row.ruleId || "Alert")}</strong><br /><span class="muted small">${escapeHtml(row.message || "")}</span><br /><span class="muted small mono">${escapeHtml(row.ruleId || "")}</span>` },
      { label: "Affected", render: (row) => `${customerIdCell(row)}<br /><span class="muted small">Owner: ${escapeHtml(row.owner || "Unknown")}</span><br />${callLink(row.callId)}` },
      { label: "Evidence", render: (row) => `${renderEvidenceSummary(row, { fallback: row.message })}<br /><span class="muted small">${escapeHtml(row.recommendedAction || "Review the linked call proof.")}</span>` },
      { label: "Trust", render: (row) => `${provenanceBadge(row.alertProvenance || row.provenance || "Deterministic")} ${alertConfidenceBadge(row)}<br /><span class="muted small">Created ${escapeHtml(formatDateTime(row.createdAt))}<br />Latest ${escapeHtml(formatDateTime(row.latestActionAt || row.updatedAt || row.createdAt))}</span>` },
      { label: "Notes", render: (row) => renderManagerNotes(row) },
      { label: "Actions", render: (row) => `${alertLifecycleControls(row, returnTo, importId)}
        <form class="alert-note-form" method="post" action="/alerts">
          ${hiddenAlertFormFields(row, returnTo, importId)}
          <input type="hidden" name="action" value="note" />
          <textarea name="note" placeholder="Add note"></textarea>
          <button type="submit">Save note</button>
        </form>` }
    ], alertRows, "No active alerts match the current filters.")}
  `;
}

function confidenceMix(row = {}) {
  const parts = [
    `H ${formatNumber(row.highConfidence || 0)}`,
    `M ${formatNumber(row.mediumConfidence || 0)}`,
    `L ${formatNumber(row.lowConfidence || 0)}`,
    `Unusable ${formatNumber(row.unusableTranscript || 0)}`
  ];
  const reviewOnly = Number(row.reviewOnlySignals || 0);
  return `${parts.join(" / ")}${reviewOnly ? ` | ${formatNumber(reviewOnly)} review-only` : ""}`;
}

function countRate(count, total) {
  return `${formatNumber(count)} (${formatPercent(percentOf(count, total))})`;
}

function managerReviewedCallIds(persistence = {}) {
  return new Set(Array.isArray(persistence.managerReviewedCallIds) ? persistence.managerReviewedCallIds : []);
}

function managerReviewSummaryMap(persistence = {}) {
  return new Map((persistence.managerReviewSummaries || []).map((review) => [review.callId, review]));
}

function managerReviewSummaryFor(row = {}, persistenceOrMap = new Map()) {
  const callId = row.callId || row.call_id || "";
  if (persistenceOrMap instanceof Map) return persistenceOrMap.get(callId) || null;
  return managerReviewSummaryMap(persistenceOrMap).get(callId) || null;
}

function managerReviewState(row = {}, reviewedIdsOrPersistence = new Set()) {
  const callId = row.callId || row.call_id || "";
  if (reviewedIdsOrPersistence instanceof Set) return reviewedIdsOrPersistence.has(callId) ? "Manager-reviewed" : (row.managerReviewStatus || "Unreviewed");
  const summary = managerReviewSummaryFor(row, reviewedIdsOrPersistence);
  return summary?.reviewStatus || row.managerReviewStatus || "unreviewed";
}

function managerReviewBadge(row = {}, persistenceOrMap = new Map()) {
  const status = managerReviewState(row, persistenceOrMap);
  return badge(reviewStatusLabel(status), reviewStatusTone(status));
}

function managerCorrectionSummary(row = {}, persistenceOrMap = new Map()) {
  const summary = managerReviewSummaryFor(row, persistenceOrMap);
  const fields = row.managerCorrectedFields || summary?.correctedFields || [];
  const latest = row.managerCorrectedOutcome || summary?.latestCorrection?.managerCorrectedValue || "";
  if (!fields.length && !latest) return `<span class="muted small">No manager correction</span>`;
  const fieldText = fields.length ? fields.slice(0, 3).join(", ") : "corrected value";
  return `<span class="evidence">${escapeHtml(fieldText)}${latest ? `<br /><span class="muted small">Preferred: ${escapeHtml(latest)}</span>` : ""}</span>`;
}

function managerSuggestedCorrectionSummary(row = {}, persistenceOrMap = new Map()) {
  const summary = managerReviewSummaryFor(row, persistenceOrMap);
  const fields = row.managerSuggestedCorrectionFields || summary?.suggestedCorrectionFields || [];
  const latest = row.managerSuggestedValue || summary?.latestSuggestedCorrection?.managerSuggestedValue || summary?.latestSuggestedCorrection?.suggestedValue || "";
  if (!fields.length && !latest) return "";
  const fieldText = fields.length ? fields.slice(0, 3).join(", ") : "suggested value";
  return `<span class="muted small">Suggested prefill: ${escapeHtml(fieldText)}${latest ? `<br />Value: ${escapeHtml(latest)}` : ""}</span>`;
}

function aiAssistantResponseBadge(row) {
  if (!row?.aiVoiceAssistantDetected) return badge("Not detected", "neutral");
  if (row.aiVoiceAssistantBailed) return badge("Bailed", "critical");
  if (row.aiVoiceAssistantHandledSuccessfully) return badge("Handled well", "success");
  return badge(row.aiVoiceAssistantResponse || "Partial", "warning");
}

function tacticList(labels) {
  const rows = Array.isArray(labels) ? labels.filter(Boolean) : [];
  if (!rows.length) return `<span class="muted small">No clear tactic</span>`;
  return `<span class="evidence">${escapeHtml(rows.slice(0, 4).join(", "))}</span>`;
}

function aiAssistantFutureStatus(row) {
  const status = row?.aiVoiceAssistantFutureStatus || "not_applicable";
  const futureCallId = row?.aiVoiceAssistantFutureCallId || "";
  if (futureCallId) {
    return `<span class="evidence">${escapeHtml(status.replace(/_/g, " "))}${callLink(futureCallId, "Future call")}</span>`;
  }
  return `<span class="muted small">${escapeHtml(status.replace(/_/g, " "))}</span>`;
}

function callLinks(callIds = []) {
  const rows = Array.isArray(callIds) ? callIds.filter(Boolean) : [];
  if (!rows.length) return `<span class="muted small">No calls</span>`;
  return rows.slice(0, 8).map((callId) => callLink(callId)).join("<br />");
}

function formatDecimal(value) {
  return Number(value || 0).toFixed(2);
}

function metricCard(label, value, detail, tone = "", href = "") {
  const content = `
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
    <div class="metric-detail">${escapeHtml(detail)}</div>`;
  return href
    ? `<a class="metric ${tone}" href="${escapeHtml(href)}">${content}</a>`
    : `<article class="metric ${tone}">${content}</article>`;
}

function table(headers, rows, emptyMessage = "No rows to show") {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map(renderTableHeading).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${headers.map((header) => `<td>${header.render ? header.render(row) : escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}
    </tbody>
  </table></div>`;
}

function formatConfidence(value) {
  const number = Number(value || 0);
  return number > 0 ? `${Math.round(number * 100)}%` : "n/a";
}

function toneForResultQuality(quality) {
  if (quality === "complete_json") return "success";
  if (quality === "salvaged_raw" || quality === "salvage_available") return "warning";
  if (quality === "queued") return "notice";
  if (["empty_text", "raw_only", "unparseable", "missing", "no_summary", "failed"].includes(quality)) return "critical";
  return "neutral";
}

function auditList(items, type) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return `<div class="audit-empty">No ${escapeHtml(type)} extracted.</div>`;
  return `<div class="audit-list">
    ${rows.map((item) => {
      const label = item.event_type || item.entity_type || item.flag_type || item.type || type;
      const value = item.normalized_value || item.raw_value || "";
      const evidence = item.evidence || "";
      const meta = [
        item.severity,
        item.speaker,
        item.follow_up_required ? "follow-up" : "",
        item.manager_review_recommended ? "review" : "",
        formatConfidence(item.confidence)
      ].filter(Boolean).join(" | ");
      return `<div class="audit-item">
        <div><strong>${escapeHtml(label)}</strong>${value ? ` <span class="mono">${escapeHtml(value)}</span>` : ""}</div>
        <div class="muted small">${escapeHtml(meta)}</div>
        <div class="audit-evidence">${escapeHtml(evidence ? compactText(evidence, 220) : "Evidence unavailable")}</div>
      </div>`;
    }).join("")}
  </div>`;
}

function rawResultPreview(row) {
  const raw = row.llm_result_json || "";
  if (!raw) return "";
  return `<details class="raw-result">
    <summary>Raw model result</summary>
    <pre>${escapeHtml(raw)}</pre>
  </details>`;
}

function renderIntelligenceAuditDetails(row) {
  const quality = row.llm_result_quality || row.llm_status || "not_requested";
  const qualityLabel = row.llm_result_quality_label || quality;
  const needsRerun = Number(row.llm_result_needs_rerun || 0) === 1;
  const detailsId = `audit-${String(row.call_id || "").replace(/[^A-Za-z0-9_-]/g, "")}`;
  return `<details class="audit-details" id="${escapeHtml(detailsId)}">
    <summary>
      <span>Audit extraction</span>
      ${provenanceBadge(llmReviewState(row))}
      ${badge(qualityLabel, toneForResultQuality(quality))}
      ${needsRerun ? badge("Needs rerun", "critical") : ""}
    </summary>
    <div class="audit-grid">
      <div class="audit-section">
        <h3>Model Summary</h3>
        <div class="audit-kv">
          <span>Confidence</span><strong class="mono">${escapeHtml(formatConfidence(row.llm_confidence))}</strong>
          <span>Provenance</span><strong>${escapeHtml(llmReviewState(row))}</strong>
          <span>Outcome</span><strong>${escapeHtml(row.overall_call_outcome || "unknown")}</strong>
          <span>Sentiment</span><strong>${escapeHtml(row.customer_sentiment || "unknown")}</strong>
          <span>Decision maker</span><strong>${escapeHtml(row.decision_maker_status || "unknown")}</strong>
          <span>Lead score</span><strong class="mono">${formatNumber(row.lead_utilization_score)} / 5</strong>
          <span>Salesperson score</span><strong class="mono">${formatNumber(row.salesperson_quality_score)} / 100</strong>
        </div>
        <p class="audit-reason">${escapeHtml(row.brief_reason || row.lead_reason || "No model summary reason was stored.")}</p>
        <p class="audit-evidence">${escapeHtml(compactText(row.evidence_snippet || "", 360))}</p>
        <div class="stack">
          ${row.lead_waste_risk ? badge("Utilisation review signal", "critical") : ""}
          ${row.lead_high_quality_utilized ? badge("High quality use", "success") : ""}
          ${row.manager_review_required ? badge("Manager review", "critical") : ""}
          ${row.risk_flag_exists ? badge("Risk flag", "warning") : ""}
          <a class="proof-link" href="/calls/${encodeURIComponent(row.call_id)}">Open transcript proof</a>
        </div>
      </div>
      <div class="audit-section">
        <h3>Events</h3>
        ${auditList(row.llm_events, "events")}
      </div>
      <div class="audit-section">
        <h3>Entities</h3>
        ${auditList(row.llm_entities, "entities")}
      </div>
      <div class="audit-section">
        <h3>Risk Flags</h3>
        ${auditList(row.llm_risk_flags, "risk flags")}
      </div>
    </div>
    ${rawResultPreview(row)}
  </details>`;
}

function intelligenceAuditTable(headers, rows, emptyMessage = "No calls match this intelligence queue yet.") {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="table-wrap audit-table-wrap"><table class="audit-table">
    <thead><tr>${headers.map(renderTableHeading).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `
        <tr>${headers.map((header) => `<td>${header.render ? header.render(row) : escapeHtml(row[header.key])}</td>`).join("")}</tr>
        <tr class="audit-row"><td colspan="${headers.length}">${renderIntelligenceAuditDetails(row)}</td></tr>
      `).join("")}
    </tbody>
  </table></div>`;
}

function renderReportContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push(`<h1>${escapeHtml(line.slice(2).trim())}</h1>`);
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`);
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(`<li>${escapeHtml(lines[index].slice(2).trim())}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderMarkdownTable(tableLines));
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("# ") &&
      !lines[index].startsWith("## ") &&
      !lines[index].startsWith("- ") &&
      !lines[index].startsWith("|")
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

function renderMarkdownTable(lines) {
  const rows = lines
    .filter((line) => !/^\|\s*-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  if (!rows.length) return "";
  const [headers, ...bodyRows] = rows;
  return `<div class="table-wrap report-table"><table>
    <thead><tr>${headers.map(renderTableHeading).join("")}</tr></thead>
    <tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function renderReportDrilldownPanel(report) {
  if (!report || report.type !== "lead_utilization_report") return "";
  const links = [
    ["Potential lead under-utilisation", "reattempt.oneDialNoContactNoLater"],
    ["One-dial no-contact", "reattempt.oneDialRiskyNoContact"],
    ["Records dialed", "reattempt.leadsTouched"],
    ["Records dialed once", "reattempt.oneAndDone"],
    ["Valid one-dial outcomes", "reattempt.oneDialValidOutcome"],
    ["Ambiguous one-dial excluded", "reattempt.oneDialNeedsReview"]
  ];
  return `<div class="drill-actions">
    ${links.map(([label, metric]) => `<a class="button-link" href="${escapeHtml(drilldownUrl(metric))}">${escapeHtml(label)}</a>`).join("")}
  </div>`;
}

function renderEmptyState(message) {
  return {
    schemaVersion: "sales_dashboard_empty.v1",
    sourceName: "No CSV loaded",
    generatedAt: new Date().toISOString(),
    dateRange: { start: null, end: null },
    dataWindow: { warnings: [], callDataOnly: true },
    intelligenceGovernance: {
      processing: {},
      confidence: {},
      provenance: {}
    },
    totals: {},
    rates: {},
    ignoredFields: [],
    unsupportedMetrics: [],
    missingColumns: [],
    alerts: [],
    alertLifecycleSummary: {
      schemaVersion: "sales_dashboard_alert_lifecycle_summary.v1",
      total: 0,
      active: 0,
      closed: 0,
      parked: 0,
      byStatus: {},
      bySeverity: {}
    },
    reviewQueue: [],
    salespersonScorecards: [],
    sourceMetrics: [],
    sourceQuality: {
      totals: {},
      sourceRows: [],
      creatorRows: [],
      createdByTypeRows: [],
      recordAgeBuckets: [],
      importAgeBuckets: [],
      creatorAgeBuckets: [],
      newBusinessRecordAgeThresholds: [],
      newBusinessImportAgeThresholds: [],
      lowestHumanAnswerSource: null,
      lowestHumanAnswerSources: []
    },
    aiVoiceAssistant: {
      totals: {},
      trendRows: [],
      salespersonRows: [],
      sourceRows: [],
      tacticRows: [],
      latestRows: [],
      topSuccessTactic: null
    },
    systemAudio: {
      totals: {},
      subtypeRows: [],
      salespersonRows: [],
      sourceRows: [],
      trendRows: [],
      latestRows: [],
      records: []
    },
    leadReattempt: {
      totals: {},
      salespersonRows: [],
      sourceRows: [],
      regionRows: [],
      businessSegmentRows: [],
      highestRetrySalespeople: [],
      lowestRetrySalespeople: [],
      records: []
    },
    leadHarvest: {
      totals: {},
      salespersonRows: [],
      sourceRows: [],
      statusRows: [],
      priorityRows: [],
      objectionRows: [],
      handlingRows: [],
      latestRows: [],
      records: []
    },
    businessSegmentMetrics: [],
    businessSegmentViews: {},
    explorerRows: [],
    persistence: {
      currentImportId: null,
      importHistory: [],
      reports: [],
      counts: {
        imports: 0,
        reports: 0,
        alertEvents: 0,
        totalUnparkedAlertEvents: 0,
        closedAlertEvents: 0,
        parkedAlertEvents: 0,
        managerReviews: 0,
        currentAlertEvents: 0,
        currentTotalAlertEvents: 0,
        currentClosedAlertEvents: 0,
        currentManagerReviews: 0,
        acknowledgedAlerts: 0,
        inProgressAlerts: 0,
        resolvedAlerts: 0,
        dismissedAlerts: 0,
        falsePositiveAlerts: 0,
        evaluationKnowledgebaseEntries: 0,
        evaluationTemplates: 0,
        evaluationRuns: 0
      },
      alertLifecycleSummary: {},
      evaluationStudio: {
        summary: {},
        knowledgebaseEntries: [],
        evaluationTemplates: [],
        evaluationRuns: []
      }
    },
    emptyMessage: message
  };
}

function compactText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > 80 ? boundary : maxLength).trim()}...`;
}

function signalLabel(signal) {
  const labels = {
    follow_up: "Follow-up signal found",
    long_term_deferral: "Long-term deferral found",
    complaint: "Complaint or risk wording found",
    opt_out: "Opt-out request found",
    ai_voice_assistant: "AI call assistant encountered"
  };
  return labels[signal] || String(signal || "Transcript proof").replace(/_/g, " ");
}

function evidenceItems(row) {
  return Array.isArray(row?.evidence) ? row.evidence.filter((item) => item) : [];
}

function evidenceSummary(row, fallback = "Evidence unavailable") {
  if (row?.alertEvidenceSummary) return row.alertEvidenceSummary;
  if (row?.evidenceSummary) return row.evidenceSummary;
  if (row?.reason) return row.reason;

  const items = evidenceItems(row);
  const summaries = items.map((item) => {
    if (typeof item === "string") return item;
    return item.summary || signalLabel(item.signal);
  }).filter(Boolean);
  if (summaries.length) return summaries.join("; ");

  if (row?.alertMessage) return row.alertMessage;
  if (row?.message) return row.message;
  if (typeof row?.evidence === "string" && row.evidence.trim()) return compactText(row.evidence);
  return fallback;
}

function proofCallId(row) {
  return row?.callId || row?.primaryCallId || (Array.isArray(row?.callIds) ? row.callIds[0] : "");
}

function renderEvidenceSummary(row, options = {}) {
  const summary = evidenceSummary(row, options.fallback);
  const callId = proofCallId(row);
  const link = options.link === false || !callId
    ? ""
    : `<a class="proof-link" href="/calls/${encodeURIComponent(callId)}">Open proof</a>`;
  return `<span class="evidence-summary"><span>${escapeHtml(compactText(summary, options.maxLength || 180))}</span>${link ? ` ${link}` : ""}</span>`;
}

function turnRoleClass(speaker) {
  const text = String(speaker || "").trim();
  if (/^customer$/i.test(text)) return "customer-turn";
  if (/^agent$/i.test(text) || /\(CWA\)$/i.test(text)) return "salesperson-turn";
  if (/^voicemail$/i.test(text) || /^transcript$/i.test(text)) return "system-turn";
  return "other-turn";
}

function renderTurnList(turns, emptyMessage = "No ordered speaker turns were detected for this excerpt.", options = {}) {
  const rows = (turns || []).filter((turn) => turn?.text);
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  }

  const className = ["turn-list", options.className].filter(Boolean).join(" ");
  return `<div class="${escapeHtml(className)}">
    ${rows.map((turn) => `<div class="turn ${turnRoleClass(turn.speaker)} ${turn.matched ? "matched" : ""}">
      <div class="speaker">${escapeHtml(turn.speaker || "Transcript")}</div>
      <div>${escapeHtml(turn.text)}</div>
    </div>`).join("")}
  </div>`;
}

function isUsefulMatchText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:customer|agent|voicemail|outbound call|inbound call):?$/i.test(text)) return false;
  return text.length > 2;
}

function renderEvidenceProofCards(items) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) {
    return `<div class="empty">Evidence unavailable</div>`;
  }

  return `<div class="proof-list">
    ${rows.map((item) => {
      const matchText = isUsefulMatchText(item.matchText) ? item.matchText : "";
      return `<article class="proof-card">
      <div class="proof-head">
        <strong>${escapeHtml(item.summary || signalLabel(item.signal))}</strong>
        <span class="muted small">${escapeHtml(signalLabel(item.signal))} | ${Math.round(Number(item.confidence || 0) * 100)}%</span>
      </div>
      ${matchText ? `<p class="muted small">Matched phrase: <span class="mono">${escapeHtml(matchText)}</span></p>` : ""}
      ${item.turns?.length ? renderTurnList(item.turns, "No ordered speaker turns were detected for this signal excerpt.", { className: "signal-excerpt-list" }) : `<p class="proof-text">${escapeHtml(item.text || "Evidence unavailable")}</p>`}
    </article>`;
    }).join("")}
  </div>`;
}

function renderDrilldownPage(result) {
  const rows = result.rows || [];
  const baseParams = {
    metric: result.metric,
    ...(result.filterState?.query || {}),
    ...(result.filters?.salesperson ? { salesperson: result.filters.salesperson } : {}),
    ...(result.filters?.source ? { source: result.filters.source } : {}),
    ...(result.filters?.customerId ? { customerId: result.filters.customerId } : {}),
    ...(result.filters?.createdBy ? { createdBy: result.filters.createdBy } : {}),
    ...(result.filters?.createdByType ? { createdByType: result.filters.createdByType } : {}),
    ...(result.filters?.recordAgeBucket ? { recordAgeBucket: result.filters.recordAgeBucket } : {}),
    ...(result.filters?.importAgeBucket ? { importAgeBucket: result.filters.importAgeBucket } : {}),
    ...(result.filters?.createAgeBucket ? { createAgeBucket: result.filters.createAgeBucket } : {}),
    ...(result.filters?.region ? { region: result.filters.region } : {}),
    ...(result.filters?.aiAssistantResponse ? { aiAssistantResponse: result.filters.aiAssistantResponse } : {}),
    ...(result.filters?.aiAssistantTactic ? { aiAssistantTactic: result.filters.aiAssistantTactic } : {}),
    ...(result.filters?.systemAudioSubtype ? { systemAudioSubtype: result.filters.systemAudioSubtype } : {}),
    ...(result.filters?.objectionType ? { objectionType: result.filters.objectionType } : {}),
    ...(result.filters?.handlingType ? { handlingType: result.filters.handlingType } : {}),
    ...(result.filters?.sort ? { sort: result.filters.sort } : {}),
    ...(result.filters?.minImportAgeDays !== null && result.filters?.minImportAgeDays !== undefined ? { minImportAgeDays: result.filters.minImportAgeDays } : {}),
    ...(result.filters?.maxAttempts !== null && result.filters?.maxAttempts !== undefined ? { maxAttempts: result.filters.maxAttempts } : {}),
    ...(result.filters?.businessSegment ? { businessSegment: result.filters.businessSegment } : {})
  };
  const pageUrl = (extra = {}) => `/drilldown?${new URLSearchParams({
    ...baseParams,
    limit: result.limit || 500,
    ...extra
  }).toString()}`;
  const apiPath = `/api/drilldown?${new URLSearchParams({
    ...baseParams,
    limit: result.limit || 500,
    offset: result.offset || 0
  }).toString()}`;
  const fullJsonPath = `/api/drilldown?${new URLSearchParams({
    ...baseParams,
    limit: Math.max(result.count || 1, result.limit || 500),
    offset: 0
  }).toString()}`;
  const isLead = result.kind === "lead";
  const filters = [
    ...(result.filterSummary?.activeFilters || []).map((entry) => `${entry.label}: ${entry.display}`),
    result.filters?.salesperson ? `Salesperson: ${result.filters.salesperson}` : "",
    result.filters?.source ? `Source: ${result.filters.source}` : "",
    result.filters?.customerId ? `Customer ID: ${result.filters.customerId}` : "",
    result.filters?.createdBy ? `Created by: ${result.filters.createdBy}` : "",
    result.filters?.createdByType ? `Creator type: ${result.filters.createdByType}` : "",
    result.filters?.recordAgeBucket ? `Record age: ${result.filters.recordAgeBucket}` : "",
    result.filters?.importAgeBucket ? `Import-date age: ${result.filters.importAgeBucket}` : "",
    result.filters?.createAgeBucket ? `Create age: ${result.filters.createAgeBucket}` : "",
    result.filters?.region ? `Region: ${result.filters.region}` : "",
    result.filters?.aiAssistantResponse ? `AI response: ${result.filters.aiAssistantResponse}` : "",
    result.filters?.aiAssistantTactic ? `AI tactic: ${result.filters.aiAssistantTactic}` : "",
    result.filters?.systemAudioSubtype ? `System audio: ${result.filters.systemAudioSubtype}` : "",
    result.filters?.objectionType ? `Objection: ${result.filters.objectionType}` : "",
    result.filters?.handlingType ? `Handling: ${result.filters.handlingType}` : "",
    result.filters?.sort ? `Order: ${result.filters.sort}` : "",
    result.filters?.minImportAgeDays !== null && result.filters?.minImportAgeDays !== undefined ? `Record age older than: ${result.filters.minImportAgeDays} days` : "",
    result.filters?.maxAttempts !== null && result.filters?.maxAttempts !== undefined ? `Attempts: ${result.filters.maxAttempts}` : "",
    result.filters?.businessSegmentLabel ? `Business: ${result.filters.businessSegmentLabel}` : ""
  ].filter(Boolean);
  const visibleStart = result.count ? (result.offset || 0) + 1 : 0;
  const visibleEnd = result.count ? (result.offset || 0) + result.displayedCount : 0;
  const isReattempt = result.kind === "reattempt";
  const isSystemAudio = result.kind === "systemAudio";
  const isHarvest = result.kind === "harvest";

  const rowTable = isLead
    ? table([
      { label: "Day", key: "day" },
      { label: "Customer ID", render: (row) => customerIdCell(row) },
      { label: "Salesperson", key: "salesperson" },
      { label: "Match key", render: (row) => `<span class="mono">${escapeHtml(row.stableLeadSource)}:${escapeHtml(row.stableLeadValue)}</span>` },
      { label: "Reason", key: "reason" },
      { label: "Calls", render: (row) => row.callIds.map((callId) => callLink(callId)).join("<br />") },
      { label: "Proof", render: (row) => renderEvidenceSummary(row, { fallback: row.reason }) }
    ], rows, "No matched contact records match this drill-down.")
    : isReattempt
      ? table([
        { label: "Customer ID", render: (row) => customerIdCell(row) },
        { label: "Salesperson", key: "salesperson" },
        { label: "Match key", render: (row) => `<span class="mono">${escapeHtml(row.stableLeadSource)}:${escapeHtml(row.stableLeadValue)}</span>` },
        { label: "Source", key: "source" },
        { label: "Region", key: "region" },
        { label: "Business", key: "businessSegmentLabel" },
        { label: "Personal calls", render: (row) => `<span class="mono">${formatNumber(row.personalCallCount)}</span>` },
        { label: "One-dial bucket", render: (row) => row.oneAndDone ? badge(row.oneDialBucketLabel || "One-dial", row.oneDialBucket === "risky_one_dial_no_contact" ? "critical" : row.oneDialBucket === "valid_one_dial_outcome" ? "success" : "warning") : `<span class="muted small">Retried</span>` },
        { label: "Bucket reason", render: (row) => `<span class="evidence">${escapeHtml(row.oneDialReason || "n/a")}</span>` },
        { label: "Same salesperson calls", render: (row) => callLinks(row.callIds) },
        { label: "Later by anyone", render: (row) => row.laterCallByAnyone ? callLinks(row.laterCallIdsByAnyone) : `<span class="muted small">No later call found</span>` },
        { label: "All calls", render: (row) => callLinks(row.allCallIds) }
      ], rows, "No reattempt records match this drill-down.")
    : isSystemAudio
      ? table([
        { label: "Call", render: (row) => callLink(row.callId) },
        { label: "Customer ID", render: (row) => customerIdCell(row) },
        { label: "Time", render: (row) => escapeHtml(formatSourceTime(row)) },
        { label: "Salesperson", key: "salesperson" },
        { label: "Source", key: "source" },
        { label: "Subtype", key: "subtypeLabel" },
        { label: "Response", render: (row) => row.handledSuccessfully ? badge("Handled", "success") : row.bailed ? badge("Bailed", "critical") : row.partial ? badge("Partial", "warning") : `<span class="muted small">n/a</span>` },
        { label: "Recovered", render: (row) => row.futureCallId ? callLink(row.futureCallId, "Future call") : `<span class="muted small">${escapeHtml(String(row.futureStatus || "").replace(/_/g, " "))}</span>` },
        { label: "Proof", render: (row) => `<span class="evidence">${escapeHtml(row.transcriptPreview || "Open call proof")}</span>` }
      ], rows, "No system audio records match this drill-down.")
    : isHarvest
      ? table([
        { label: "Call", render: (row) => callLink(row.callId) },
        { label: "Customer ID", render: (row) => customerIdCell(row) },
        { label: "Source time", render: (row) => `<span class="mono">${escapeHtml(formatSourceTime(row))}</span>` },
        { label: "Salesperson", key: "salesperson" },
        { label: "Source", key: "source" },
        { label: "Business", key: "businessSegmentLabel" },
        { label: "Possible name", render: (row) => escapeHtml(row.possibleContactName || row.possibleDecisionMakerName || "Not stated") },
        { label: "Objection", render: (row) => `${escapeHtml(row.objectionLabel || "Unknown")}<br /><span class="muted small">${escapeHtml(row.objectionEvidence || "Evidence unavailable")}</span>` },
        { label: "Salesperson handling", render: (row) => `${escapeHtml(row.salespersonHandlingLabel || "Unknown")}<br /><span class="muted small">${escapeHtml(row.salespersonHandlingEvidence || "Evidence unavailable")}</span>` },
        { label: "Callback timing", render: (row) => `${escapeHtml(row.callbackTimingSummary || "Timing not specified")}<br /><span class="muted small">${escapeHtml(row.callbackTimingText || "Open proof to confirm timing")}</span>` },
        { label: "Status", render: (row) => badge(row.statusLabel || row.status, row.status === "open_no_later_matching_call" ? "warning" : row.status === "later_matching_call_observed" ? "success" : "neutral") },
        { label: "Later match", render: (row) => row.laterCallId ? callLink(row.laterCallId, "Later call") : `<span class="muted small">${escapeHtml(row.matchingConfidence === "unavailable" ? "Matching unavailable" : "No later matching call observed")}</span>` },
        { label: "Confidence", render: (row) => badge(row.confidenceLabel || "Confidence unavailable", row.confidenceBand === "high" ? "success" : row.confidenceBand === "medium" ? "notice" : "warning") },
        { label: "Handover context", render: (row) => `<span class="evidence-summary">${escapeHtml(row.handoverSummary || row.positiveSignalSummary || "Open call evidence to inspect context")}<a class="proof-link" href="/calls/${encodeURIComponent(row.callId)}">Open call evidence</a></span>` },
        { label: "Evidence snippet", render: (row) => `<span class="evidence-summary">${escapeHtml((row.evidenceSnippets || [row.evidenceSummary || "Evidence unavailable"])[0])}</span>` }
      ], rows, "No lead harvest records match this drill-down.")
    : table([
      { label: "Call", render: (row) => callLink(row.callId) },
      { label: "Customer ID", render: (row) => customerIdCell(row) },
      { label: "Time", render: (row) => escapeHtml(formatSourceTime(row)) },
      { label: "Salesperson", key: "salesperson" },
      { label: "Source", key: "source" },
      { label: "Business", key: "businessSegmentLabel" },
      { label: "Record age", render: (row) => formatRecordAge(row) },
      { label: "Created by", render: (row) => row.customerCreatedBy ? `${escapeHtml(row.customerCreatedBy)}<br /><span class="muted small">${escapeHtml(row.customerCreatedByType || "Unknown")}</span>` : `<span class="muted">n/a</span>` },
      { label: "Duration", render: (row) => `${formatNumber(row.durationSeconds)}s` },
      { label: "Contact", key: "contactClassification" },
      { label: "Outcome", key: "localOutcome" },
      { label: "Follow-up", key: "followUpStatus" },
      { label: "AI assistant", render: (row) => aiAssistantResponseBadge(row) },
      { label: "Tactics", render: (row) => tacticList(row.aiVoiceAssistantTactics) },
      { label: "Future", render: (row) => aiAssistantFutureStatus(row) },
      { label: "Proof", render: (row) => renderEvidenceSummary(row) }
    ], rows, "No call records match this drill-down.");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(result.title)} - Sales Dashboard</title>
    <style>
      ${COLUMN_HELP_STYLES}
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      :root {
        --background: #080A0F;
        --surface: #0D1117;
        --surface-elevated: #131A24;
        --surface-soft: #182131;
        --border: #263244;
        --border-subtle: #1D2735;
        --foreground: #F4F7FB;
        --muted-foreground: #8A94A6;
        --primary: #C9A45C;
        --accent: #56D6E5;
        --success: #34D399;
        --warning: #F59E0B;
        --danger: #F87171;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main {
        width: min(1280px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 40px;
        display: grid;
        gap: 16px;
      }
      .topbar, .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .topbar {
        padding: 18px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .page-title {
        display: flex;
        gap: 18px;
        align-items: flex-start;
        min-width: 0;
      }
      .page-brand {
        display: inline-flex;
        align-items: center;
        min-width: 174px;
        max-width: 220px;
        padding-top: 3px;
      }
      .page-brand img {
        display: block;
        width: 100%;
        height: auto;
      }
      .panel { padding: 18px; overflow: hidden; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.12; font-weight: 800; }
      .page-kicker {
        color: var(--primary);
        font-size: 12px;
        font-weight: 760;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .muted { color: var(--muted-foreground); }
      .small { font-size: 13px; }
      .stack, .drill-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .button-link, .data-link, .proof-link {
        color: var(--accent);
        font-weight: 760;
        text-decoration: none;
      }
      .button-link {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 6px;
        background: var(--surface-elevated);
        border: 1px solid var(--border);
      }
      .button-link:hover, .data-link:hover, .proof-link:hover {
        color: var(--foreground);
        border-color: rgba(86, 214, 229, 0.58);
      }
      .button-link.selected {
        color: var(--primary);
        border-color: rgba(201, 164, 92, 0.58);
        background: rgba(201, 164, 92, 0.10);
      }
      .data-link { border-bottom: 1px solid rgba(86, 214, 229, 0.32); }
      .proof-link { display: block; margin-top: 5px; font-size: 12px; }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
        color: var(--muted-foreground);
        background: rgba(138, 148, 166, 0.10);
        border: 1px solid rgba(138, 148, 166, 0.18);
      }
      .mono { font-family: "Geist Mono", "Cascadia Code", Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
      .table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 8px; }
      table { width: 100%; min-width: 920px; border-collapse: collapse; }
      th, td { padding: 10px; border-bottom: 1px solid var(--border-subtle); text-align: left; vertical-align: top; font-size: 13px; }
      th { color: var(--muted-foreground); background: var(--surface-elevated); text-transform: uppercase; font-size: 11px; }
      tbody tr:hover { background: rgba(86, 214, 229, 0.035); }
      .evidence-summary { display: block; max-width: 280px; color: var(--muted-foreground); line-height: 1.4; }
      .empty { padding: 18px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted-foreground); background: var(--surface-elevated); }
      @media (max-width: 760px) {
        main { width: min(100vw - 24px, 1280px); padding: 12px 0 32px; }
        .topbar, .page-title { flex-direction: column; }
        .page-brand { min-width: 0; width: 190px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div class="page-title">
          <a class="page-brand" href="/#overview"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></a>
          <div>
            <p class="page-kicker">Drill-down proof</p>
            <h1>${escapeHtml(result.title)}</h1>
            <p class="muted">${escapeHtml(result.description)}</p>
            <p class="muted small">${escapeHtml(filters.length ? filters.join(" | ") : "No extra filters")} | Showing ${formatNumber(visibleStart)}-${formatNumber(visibleEnd)} of ${formatNumber(result.count)} records.</p>
          </div>
        </div>
        <div class="drill-actions">
          <a class="button-link" href="/#overview">Dashboard</a>
          <a class="button-link" href="${escapeHtml(apiPath)}">JSON</a>
          <a class="button-link" href="${escapeHtml(fullJsonPath)}">Full JSON</a>
        </div>
      </header>
      <section class="panel">
        <div class="stack" style="margin-bottom: 12px;">
          <span class="badge">${escapeHtml(result.metric)}</span>
          <span class="badge">${escapeHtml(isLead ? "Matched-record proof" : isReattempt ? "Reattempt proof" : isSystemAudio ? "System audio proof" : isHarvest ? "Lead harvest proof" : "Call-row proof")}</span>
          <span class="badge">Ignored: ${escapeHtml(result.excludedRawFields.join(", "))}</span>
        </div>
        <div class="drill-actions" style="margin-bottom: 12px;">
          ${result.previousOffset !== null && result.previousOffset !== undefined ? `<a class="button-link" href="${escapeHtml(pageUrl({ offset: result.previousOffset }))}">Previous</a>` : ""}
          ${result.nextOffset !== null && result.nextOffset !== undefined ? `<a class="button-link" href="${escapeHtml(pageUrl({ offset: result.nextOffset }))}">Next</a>` : ""}
        </div>
        ${rowTable}
      </section>
    </main>
  </body>
</html>`;
}

function renderRawFieldTable(fields) {
  const rows = Object.entries(fields || {}).map(([field, value]) => ({ field, value }));
  return table([
    { label: "Field", render: (row) => `<span class="mono">${escapeHtml(row.field)}</span>` },
    { label: "Value", render: (row) => `<span>${escapeHtml(row.value)}</span>` }
  ], rows, "No raw fields available.");
}

function renderSourceAttributionTable(call) {
  return table([
    { label: "Field", key: "field" },
    { label: "Value", render: (row) => row.mono ? `<span class="mono">${escapeHtml(row.value)}</span>` : escapeHtml(row.value) }
  ], [
    { field: "Customer ID", value: customerIdValue(call), mono: true },
    ...(contactIdValue(call) && customerIdValue(call) === "Not available" ? [{ field: "ContactId backup", value: contactIdValue(call), mono: true }] : []),
    { field: "Source category", value: call.customerImportSource || call.source || "Self Sourced" },
    { field: "Source rule", value: call.customerImportSourceInferred ? call.customerImportSourceInferenceReason || "Inferred source category" : "Raw CustomerImportSource" },
    { field: "Raw CustomerImportSource", value: call.customerImportSourceRaw || "Blank" },
    { field: "Record age", value: call.daysSinceRecord === null || call.daysSinceRecord === undefined ? "No valid date" : `${formatDays(call.daysSinceRecord)} (${call.recordAgeBasisLabel || "Record date"})`, mono: true },
    { field: "CustomerImportDate", value: call.customerImportDateIso || "Not available", mono: true },
    { field: "Bulk source age", value: formatDays(call.daysSinceImport), mono: true },
    { field: "CustomerCreatedBy", value: call.customerCreatedBy || "Not available" },
    { field: "CustomerCreatedByType", value: call.customerCreatedByType || "Not available" },
    { field: "CustomerCreateDate", value: call.customerCreateDateIso || "Not available", mono: true },
    { field: "Manual creation age", value: formatDays(call.daysSinceCreated), mono: true }
  ], "No source attribution fields available for this call.");
}

function renderReviewCorrections(review) {
  const corrections = review?.corrections || [];
  if (!corrections.length) return `<span class="muted small">No corrections recorded</span>`;
  return corrections.slice(-4).map((correction) => [
    `<strong>${escapeHtml(correction.fieldName)}</strong>`,
    `Previous: ${escapeHtml(correction.previousDisplayValue || correction.deterministicValue || "Not supplied")}`,
    `Manager: ${escapeHtml(correction.managerCorrectedValue || "Not supplied")}`,
    correction.evidenceAssessment ? `Evidence: ${escapeHtml(correction.evidenceAssessment)}` : ""
  ].filter(Boolean).join("<br />")).join("<hr />");
}

function renderReviewSuggestions(review) {
  const suggestions = review?.suggestedCorrections || [];
  if (!suggestions.length) return `<span class="muted small">No suggested prefill</span>`;
  return suggestions.slice(0, 4).map((suggestion) => [
    `<strong>${escapeHtml(suggestion.fieldName)}</strong>`,
    `Suggested: ${escapeHtml(suggestion.managerSuggestedValue || suggestion.suggestedValue || "Not supplied")}`,
    suggestion.previousDisplayValue ? `Previous: ${escapeHtml(suggestion.previousDisplayValue)}` : "",
    suggestion.confidence !== null && suggestion.confidence !== undefined ? `Confidence: ${formatPercent(Number(suggestion.confidence || 0))}` : "Confidence unavailable",
    suggestion.evidence ? `Evidence: ${escapeHtml(compactText(suggestion.evidence, 180))}` : "Evidence unavailable",
    `<span class="muted small">Suggested only; not a manager correction until confirmed.</span>`
  ].filter(Boolean).join("<br />")).join("<hr />");
}

function renderReviewHistory(reviews) {
  const rows = (reviews || []).map(normalizeManagerReview);
  return table([
    { label: "Status", render: (row) => badge(reviewStatusLabel(row.reviewStatus), reviewStatusTone(row.reviewStatus)) },
    { label: "Scope", render: (row) => escapeHtml(row.reviewScope || "call") },
    { label: "Suggested prefill", render: (row) => renderReviewSuggestions(row) },
    { label: "Corrections", render: (row) => renderReviewCorrections(row) },
    { label: "Notes", render: (row) => `<span class="evidence">${escapeHtml(row.managerNotes || "No notes")}</span>` },
    { label: "Reviewed", render: (row) => `${escapeHtml(row.reviewedBy || "local_manager")}<br /><span class="muted small">${escapeHtml(formatDateTime(row.updatedAt || row.reviewedAt || row.createdAt))}</span>` }
  ], rows, "No manager reviews saved for this call.");
}

function renderReviewEventHistory(reviews) {
  const events = (reviews || []).flatMap((review) => normalizeManagerReview(review).reviewHistory || [])
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return table([
    { label: "Action", key: "action" },
    { label: "From", key: "previousStatus" },
    { label: "To", key: "newStatus" },
    { label: "Actor", key: "actor" },
    { label: "Note", render: (row) => `<span class="evidence">${escapeHtml(row.note || "")}</span>` },
    { label: "When", render: (row) => formatDateTime(row.timestamp) }
  ], events, "No manager review history events yet.");
}

function correctionFieldOptions(selected = "") {
  const labels = {
    contact_classification: "Contact classification",
    local_outcome_category: "Local outcome category",
    local_outcome_detail: "Local outcome detail",
    follow_up_required: "Follow-up required",
    follow_up_status: "Follow-up status",
    follow_up_channel: "Follow-up channel",
    follow_up_due_text: "Follow-up due text",
    follow_up_due_datetime: "Follow-up due date/time",
    follow_up_manually_completed: "Follow-up manually completed",
    follow_up_dismissed: "Follow-up dismissed",
    coaching_flag_confirmed: "Coaching flag confirmed",
    coaching_priority: "Coaching priority",
    coaching_note: "Coaching note",
    risk_flag_confirmed: "Risk flag confirmed",
    complaint_confirmed: "Complaint confirmed",
    opt_out_confirmed: "Opt-out confirmed",
    compliance_review_required: "Compliance review required",
    evidence_assessment: "Evidence assessment"
  };
  return [
    `<option value="">No field correction</option>`,
    ...CORRECTION_FIELDS.map((field) => `<option value="${escapeHtml(field)}" ${selected === field ? "selected" : ""}>${escapeHtml(labels[field] || field.replace(/_/g, " "))}</option>`)
  ].join("");
}

function renderAiJobHistory(aiJobs) {
  return table([
    { label: "Job", render: (row) => `<a class="data-link mono" href="${escapeHtml(row.resultLink || `/api/ai/jobs/${encodeURIComponent(row.jobId)}`)}">${escapeHtml(row.jobId)}</a>` },
    { label: "Task", key: "taskType" },
    { label: "Status", key: "status" },
    { label: "Updated", render: (row) => formatDateTime(row.updatedAt || row.createdAt) }
  ], aiJobs || [], "No local AI jobs submitted for this call.");
}

function renderAiExecutionPanel(call, options = {}) {
  const aiStatus = options.aiStatus || {};
  const aiJobs = options.aiJobs || [];
  const statusText = aiStatus.enabled
    ? aiStatus.configured
      ? `Configured for ${aiStatus.taskType} at ${aiStatus.baseUrl}`
      : `Enabled but missing ${Array.isArray(aiStatus.missing) ? aiStatus.missing.join(", ") : "configuration"}`
    : "Disabled. Set SALES_DASHBOARD_AI_ENABLED=true to allow local model submissions.";

  return `<section class="grid-2">
        <div class="panel">
          <h2>Local AI Processing</h2>
          <p class="muted small" style="margin-bottom: 12px;">${escapeHtml(statusText)}</p>
          <p class="muted small" style="margin-bottom: 12px;">Execution layer path: <span class="mono">${escapeHtml(aiStatus.layerPath || "")}</span></p>
          ${aiStatus.configured ? `<form method="post" action="/ai/transcript-evaluations">
            <input type="hidden" name="callId" value="${escapeHtml(call.callId)}" />
            <input type="hidden" name="importId" value="${escapeHtml(options.importId || "")}" />
            <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo || `/calls/${encodeURIComponent(call.callId)}`)}" />
            <button type="submit">Submit To Local AI</button>
          </form>` : `<div class="empty">Local AI submission is not active for this dashboard session.</div>`}
        </div>
        <div class="panel">
          <h2>AI Job History</h2>
          ${renderAiJobHistory(aiJobs)}
        </div>
      </section>`;
}

function percentOf(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (Number(value || 0) / Number(total || 0)) * 100));
}

function pipelineBar(label, value, percent, tone = "primary", href = "") {
  const width = Math.max(2, Math.min(100, Number(percent || 0)));
  const content = `
    <span class="pipeline-label">${escapeHtml(label)}</span>
    <span class="pipeline-track" aria-hidden="true"><span class="pipeline-fill ${escapeHtml(tone)}" style="width: ${width.toFixed(1)}%;"></span></span>
    <span class="pipeline-value mono">${escapeHtml(value)}</span>`;
  return href
    ? `<a class="pipeline-row" href="${escapeHtml(href)}">${content}</a>`
    : `<div class="pipeline-row">${content}</div>`;
}

function datasetFact(label, value, options = {}) {
  const tag = options.mono ? "strong" : "strong";
  const className = options.mono ? "mono" : "";
  return `<div class="dataset-fact">
    <span>${escapeHtml(label)}</span>
    <${tag} class="${className}">${escapeHtml(value)}</${tag}>
  </div>`;
}

function renderDataWindowWarnings(data) {
  const warnings = Array.isArray(data.dataWindow?.warnings) ? data.dataWindow.warnings : [];
  const unsupportedWarning = {
    code: "unsupported_sales_revenue_conversion",
    severity: "notice",
    message: "Current active call data does not contain reliable confirmed sales, revenue, order value, close date, or true conversion outcome."
  };
  const rows = [...warnings, unsupportedWarning];
  if (!rows.length) return "";
  return `<div class="window-warnings" aria-label="Reporting-period warnings">
    ${rows.map((warning) => `<div class="window-warning ${escapeHtml(warning.severity || "notice")}">
      <strong>${escapeHtml(warning.code.replace(/_/g, " "))}</strong>
      <p class="muted small">${escapeHtml(warning.message)}</p>
    </div>`).join("")}
  </div>`;
}

function renderDatasetBanner(data, persistence) {
  if (!data || !data.totals || !(data.filterSummary?.totalRecords || data.totals.uniqueCalls)) return "";
  const totals = data.datasetTotals || data.totals || {};
  const importId = persistence?.currentImportId || "Current import";
  const duplicateCount = Number(totals.duplicateCallIds || 0);
  const lastProcessed = persistence?.importHistory?.find((row) => row.id === importId)?.lastImportedAt || data.generatedAt;
  return `<section class="panel dataset-context" id="dataset-context">
    <div class="panel-header">
      <div>
        <p class="section-kicker">Reporting context</p>
        <h2>Active Dataset: ${escapeHtml(safeSourceFilename(data.sourceName))}</h2>
        <p class="muted small">${escapeHtml(formatDateRange(data.dateRange))}</p>
      </div>
      <div class="stack">
        ${badge(`${formatNumber(totals.uniqueCalls || 0)} calls`, "notice")}
        ${badge("Active call data only", "success")}
      </div>
    </div>
    <div class="panel-body">
      <div class="dataset-grid dataset-grid-primary">
        ${datasetFact("Source file", safeSourceFilename(data.sourceName))}
        ${datasetFact("Deduplicated calls", formatNumber(totals.uniqueCalls || 0), { mono: true })}
        ${datasetFact("Active range", formatDateRange(data.dateRange))}
        ${datasetFact("Last processed", formatDateTime(lastProcessed))}
      </div>
      ${renderDataWindowWarnings(data)}
      <details class="context-details">
        <summary>Import details and data handling</summary>
        <div class="dataset-grid context-details-grid">
          ${datasetFact("Import ID", importId, { mono: true })}
          ${datasetFact("File hash", shortHash(data.inputHash), { mono: true })}
          ${datasetFact("Imported rows", formatNumber(totals.rawRows || 0), { mono: true })}
          ${datasetFact("Duplicate rows ignored", formatNumber(duplicateCount), { mono: true })}
        </div>
      </details>
    </div>
  </section>`;
}

function selectedFilterValues(filterState = {}, key) {
  return new Set((filterState.values?.[key] || []).map((value) => String(value)));
}

function filterOptionHtml(options = [], selected = new Set()) {
  return options.slice(0, 80).map((option) => {
    const value = String(option.value || "");
    const label = `${option.label || value} (${formatNumber(option.count || 0)})`;
    return `<option value="${escapeHtml(value)}" ${selected.has(value) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function filterSelect(name, label, options, selected, attributes = "") {
  return `<label class="filter-control">${escapeHtml(label)}
    <select name="${escapeHtml(name)}" ${attributes}>
      ${attributes.includes("multiple") ? "" : `<option value="">All</option>`}
      ${filterOptionHtml(options, selected)}
    </select>
  </label>`;
}

function filterQueryUrl(query = {}, hash = "filters") {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value));
  });
  return `/${params.toString() ? `?${params.toString()}` : ""}${hash ? `#${hash}` : ""}`;
}

function removeFilterEntryQuery(filterState = {}, entry = {}) {
  const query = { ...(filterState.query || {}) };
  if (entry.key === "businessSegment" || entry.key === "dateFrom" || entry.key === "dateTo" || entry.key === "dateTimeFrom" || entry.key === "dateTimeTo") {
    delete query[entry.key];
    return query;
  }
  const values = String(query[entry.key] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value !== entry.value);
  if (values.length) query[entry.key] = values.join(",");
  else delete query[entry.key];
  return query;
}

function renderFilterChips(filterState = {}) {
  const entries = filterState.activeFilters || [];
  if (!entries.length) return `<span class="muted small">No filters active</span>`;
  return entries.map((entry) => `<a class="filter-chip" href="${escapeHtml(filterQueryUrl(removeFilterEntryQuery(filterState, entry)))}">
    <span>${escapeHtml(entry.label)}: ${escapeHtml(entry.display)}</span>
    <strong aria-hidden="true">x</strong>
  </a>`).join("");
}

function renderGlobalFilters(data, renderOptions = {}) {
  const filterState = data.filterState || { values: {}, query: {}, activeFilters: [] };
  const dashboardView = normalizeDashboardView(renderOptions.dashboardView);
  const viewQuery = { ...(filterState.query || {}), view: dashboardView };
  const summary = data.filterSummary || {
    totalRecords: data.totals?.uniqueCalls || 0,
    filteredRecords: data.totals?.uniqueCalls || 0,
    excludedRecords: 0,
    includedRate: 100,
    warnings: [],
    activeFilters: []
  };
  const options = data.filterOptions || {};
  const warnings = summary.warnings || [];
  return `<section class="panel filter-panel" id="filters">
    <div class="panel-header">
      <div>
        <h2>Global Filters</h2>
        <p class="muted small">All active dashboard cards, tables, alerts, scorecards, explorer rows, and drill-downs use this same filtered call population.</p>
      </div>
      ${summary.active ? badge("Filtered view", "notice") : badge("All calls", "success")}
    </div>
    <div class="panel-body">
      <div class="dataset-grid">
        ${datasetFact("Filtered calls", formatNumber(summary.filteredRecords || 0), { mono: true })}
        ${datasetFact("Total calls", formatNumber(summary.totalRecords || 0), { mono: true })}
        ${datasetFact("Records excluded", formatNumber(summary.excludedRecords || 0), { mono: true })}
        ${datasetFact("Included", formatPercent(summary.includedRate || 0), { mono: true })}
      </div>
      ${warnings.length ? `<div class="window-warnings">${warnings.map((warning) => `<div class="window-warning ${escapeHtml(warning.severity || "notice")}">
        <strong>${escapeHtml(warning.code.replace(/_/g, " "))}</strong>
        <p class="muted small">${escapeHtml(warning.message)}</p>
      </div>`).join("")}</div>` : ""}
      <div class="active-filters" aria-label="Active filters">
        ${renderFilterChips({ ...filterState, query: viewQuery, activeFilters: summary.activeFilters || [] })}
      </div>
      <form class="filter-form" method="get" action="/">
        <input type="hidden" name="view" value="${escapeHtml(dashboardView)}" />
        <label class="filter-control">From source date
          <input type="date" name="dateFrom" value="${escapeHtml(filterState.dateFrom || "")}" />
        </label>
        <label class="filter-control">To source date
          <input type="date" name="dateTo" value="${escapeHtml(filterState.dateTo || "")}" />
        </label>
        ${filterSelect("salesperson", "Salesperson", options.salesperson, selectedFilterValues(filterState, "salesperson"))}
        ${filterSelect("callDirection", "Call direction", options.callDirection, selectedFilterValues(filterState, "callDirection"))}
        ${filterSelect("callType", "Call type", options.callType, selectedFilterValues(filterState, "callType"))}
        ${filterSelect("customerImportSource", "Call CSV source", options.customerImportSource, selectedFilterValues(filterState, "customerImportSource"))}
        <details class="filter-advanced">
          <summary>More filters: outcomes, follow-up, confidence, reviews and alerts</summary>
          <div class="filter-form advanced">
            ${filterSelect("contactClassification", "Contact", options.contactClassification, selectedFilterValues(filterState, "contactClassification"))}
            ${filterSelect("localOutcome", "Derived outcome", options.localOutcome, selectedFilterValues(filterState, "localOutcome"))}
            ${filterSelect("followUpStatus", "Follow-up status", options.followUpStatus, selectedFilterValues(filterState, "followUpStatus"))}
            ${filterSelect("confidenceBand", "Confidence", options.confidenceBand, selectedFilterValues(filterState, "confidenceBand"))}
            ${filterSelect("llmStatus", "LLM status", options.llmStatus, selectedFilterValues(filterState, "llmStatus"))}
            ${filterSelect("managerReviewStatus", "Manager review", options.managerReviewStatus, selectedFilterValues(filterState, "managerReviewStatus"))}
            ${filterSelect("alertSeverity", "Alert severity", options.alertSeverity, selectedFilterValues(filterState, "alertSeverity"))}
            ${filterSelect("userId", "User ID", options.userId, selectedFilterValues(filterState, "userId"))}
            ${filterSelect("callerId", "Caller ID", options.callerId, selectedFilterValues(filterState, "callerId"))}
            ${filterSelect("mobile", "Mobile", options.mobile, selectedFilterValues(filterState, "mobile"))}
            ${filterSelect("followUpChannel", "Follow-up channel", options.followUpChannel, selectedFilterValues(filterState, "followUpChannel"))}
            ${filterSelect("transcriptState", "Transcript state", options.transcriptState, selectedFilterValues(filterState, "transcriptState"))}
            ${filterSelect("intelligenceProvenance", "Intelligence provenance", options.intelligenceProvenance, selectedFilterValues(filterState, "intelligenceProvenance"))}
            ${filterSelect("alertStatus", "Alert status", options.alertStatus, selectedFilterValues(filterState, "alertStatus"))}
            ${filterSelect("sourceQualityBucket", "Source quality bucket", options.sourceQualityBucket, selectedFilterValues(filterState, "sourceQualityBucket"))}
          </div>
        </details>
        <div class="filter-actions">
          <button type="submit">Apply filters</button>
          <a class="filter-link" href="${dashboardView === "overview" ? "/#filters" : `/?view=${escapeHtml(dashboardView)}#filters`}">Reset filters</a>
        </div>
      </form>
      <div class="guardrails" style="margin-top: 12px;">
        <div class="note">
          <h3>Denominators</h3>
          <p class="muted small">Executive rates use filtered deduplicated calls unless a card says otherwise. Transcript-derived metrics use calls with transcript evidence; follow-up completion uses calls with follow-up required; alert counts use alerts linked to filtered calls.</p>
        </div>
        <div class="note">
          <h3>Source time</h3>
          <p class="muted small">Date filters use source call date/time and keep ${escapeHtml(summary.sourceTimezoneLabel || "source call time")} boundaries. Date-only filters include the full source call day.</p>
        </div>
      </div>
    </div>
  </section>`;
}

function renderProcessingStatePanel(data, persistence = {}, intelligenceTotals = {}) {
  if (!data || !data.totals || !data.totals.uniqueCalls) return "";
  const governance = data.intelligenceGovernance || {};
  const processing = governance.processing || {};
  const confidence = governance.confidence || {};
  const totalCalls = Number(data.totals.uniqueCalls || processing.totalCalls || 0);
  const llmCompleted = Number(intelligenceTotals.llmCompleted || processing.llmEvaluationsCompleted || 0);
  const llmFailed = Number(intelligenceTotals.llmFailed || processing.llmFailed || 0);
  const llmNotRequested = Number(intelligenceTotals.llmNotRequested || (totalCalls ? Math.max(0, totalCalls - llmCompleted - llmFailed - Number(intelligenceTotals.llmQueued || 0)) : processing.llmNotRequested || 0));
  const reviewGovernance = data.managerReviewGovernance || persistence.managerReviewGovernance || {};
  const managerReviewed = Number(reviewGovernance.reviewedCalls || persistence.counts?.currentManagerReviewedCalls || persistence.counts?.currentManagerReviews || processing.managerReviewedCalls || 0);
  const managerCorrected = Number(reviewGovernance.correctedCalls || persistence.counts?.currentManagerCorrectedCalls || 0);
  const managerReviewNeeded = Number(reviewGovernance.reviewNeededCalls || persistence.counts?.currentManagerReviewNeededCalls || 0);
  const managerEscalated = Number(reviewGovernance.escalatedCalls || persistence.counts?.currentManagerEscalatedCalls || 0);
  const lowUnusable = Number(processing.lowOrUnusableTranscriptCount || 0);
  return `<section class="panel" id="provenance">
    <div class="panel-header">
      <div>
        <h2>Intelligence Provenance</h2>
        <p class="muted small">Transcript-derived metrics are deterministic unless a row is explicitly marked LLM-reviewed or Manager-reviewed.</p>
      </div>
      ${provenanceBadge("Deterministic")}
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Total calls", formatNumber(totalCalls), "Active deduplicated call rows", "info")}
        ${metricCard("Transcripts available", formatNumber(data.totals.transcriptAvailable || 0), `${formatPercent(data.rates.transcriptCoverage || 0)} of calls`, "info")}
        ${metricCard("Deterministic evaluations", formatNumber(processing.deterministicEvaluationsCompleted || totalCalls), "Rules-based local evaluation completed", "good")}
        ${metricCard("LLM-reviewed", formatNumber(llmCompleted), `${formatNumber(llmNotRequested)} not requested, ${formatNumber(llmFailed)} failed`, "info")}
        ${metricCard("Manager-reviewed", formatNumber(managerReviewed), `${formatPercent(reviewGovernance.coverageRate || percentOf(managerReviewed, totalCalls))} coverage`, "good")}
        ${metricCard("Manager-corrected", formatNumber(managerCorrected), `${formatPercent(reviewGovernance.correctionRate || percentOf(managerCorrected, totalCalls))} of filtered calls`, managerCorrected ? "warn" : "good")}
        ${metricCard("Review needed", formatNumber(managerReviewNeeded), "System or manager marked for review", managerReviewNeeded ? "warn" : "good")}
        ${metricCard("Escalated", formatNumber(managerEscalated), "Manager-escalated review items", managerEscalated ? "risk" : "good")}
        ${metricCard("Unprocessed", formatNumber(processing.unprocessedCalls || 0), "No deterministic evaluation available", "warn")}
        ${metricCard("Transcript-derived coverage", formatPercent(processing.transcriptDerivedMetricsCoverageRate || data.rates.transcriptUsableForCoaching || 0), "Usable for coaching-style conclusions", "info")}
        ${metricCard("Low/unusable transcripts", formatNumber(lowUnusable), "Review-only unless supported by stronger evidence", lowUnusable ? "warn" : "good")}
      </div>
      <div class="guardrails" style="margin-top: 12px;">
        <div class="note">
          <h3>Confidence mix</h3>
          <p class="muted small">High: ${countRate(confidence.high || 0, totalCalls)}<br />Medium: ${countRate(confidence.medium || 0, totalCalls)}<br />Low: ${countRate(confidence.low || 0, totalCalls)}<br />Unusable: ${countRate(confidence.unusable || 0, totalCalls)}<br />Unavailable: ${countRate(confidence.unknown || 0, totalCalls)}</p>
        </div>
        <div class="note">
          <h3>Guardrail</h3>
          <p class="muted small">Coaching queues and scorecards include deterministic signals; not all calls are LLM-reviewed. Low-confidence or unusable transcript rows are shown as review-only context and should not be treated as final coaching conclusions without proof.</p>
        </div>
      </div>
    </div>
  </section>`;
}

function renderKnowledgebaseActions(row = {}) {
  const returnTo = "/evaluation-studio";
  const approvalStatus = row.approvalStatus === "approved_current" ? "approved_current" : "pending_manager_approval";
  return `<details class="compact-details">
    <summary>Edit entry</summary>
    <form class="studio-form" method="post" action="/evaluation-studio/knowledgebase">
      <input type="hidden" name="id" value="${escapeHtml(row.id || "")}" />
      <label class="studio-field">Title<input name="title" value="${escapeHtml(row.title || "")}" required /></label>
      <label class="studio-field">Category<input name="category" value="${escapeHtml(row.category || "general")}" /></label>
      <label class="studio-field">Tags<input name="tags" value="${escapeHtml((row.tags || []).join(", "))}" /></label>
      <label class="studio-field">Evaluation use<select name="approvalStatus">
          <option value="pending_manager_approval" ${approvalStatus === "pending_manager_approval" ? "selected" : ""}>Draft - excluded from evaluations</option>
          <option value="approved_current" ${approvalStatus === "approved_current" ? "selected" : ""}>Include in evaluations</option>
        </select></label>
      <label class="studio-field studio-field-full">Local note<textarea name="approvalNote" rows="2" placeholder="Why this reference is included or kept as a draft">${escapeHtml(row.approvalNote || "")}</textarea></label>
      <label class="studio-field studio-field-full">Knowledge content<textarea name="content" rows="8" required>${escapeHtml(row.content || "")}</textarea></label>
      <button type="submit">Save changes</button>
    </form>
    <form class="inline-alert-form" method="post" action="/evaluation-studio/knowledgebase/${encodeURIComponent(row.id || "")}/archive">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button type="submit">Archive entry</button>
    </form>
  </details>`;
}

function renderTemplateActions(row = {}) {
  const returnTo = "/evaluation-studio";
  return `<details class="compact-details">
    <summary>Edit template</summary>
    <form class="studio-form" method="post" action="/evaluation-studio/templates">
      <input type="hidden" name="id" value="${escapeHtml(row.id || "")}" />
      <label class="studio-field">Template name<input name="name" value="${escapeHtml(row.name || "")}" required /></label>
      <label class="studio-field">Evaluation goal<input name="evaluationGoal" value="${escapeHtml(row.evaluationGoal || "procedure_adherence")}" required /></label>
      <label class="studio-field studio-field-full">Tags<input name="tags" value="${escapeHtml((row.tags || []).join(", "))}" /></label>
      <label class="studio-field studio-field-full">Prompt instructions<textarea name="instructions" rows="7" required>${escapeHtml(row.instructions || "")}</textarea></label>
      <label class="studio-field studio-field-full">Result format<textarea name="outputSchema" rows="7" required>${escapeHtml(JSON.stringify(row.outputSchema || {}, null, 2))}</textarea></label>
      <button type="submit">Save changes</button>
    </form>
    <form class="inline-alert-form" method="post" action="/evaluation-studio/templates/${encodeURIComponent(row.id || "")}/archive">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button type="submit">Archive template</button>
    </form>
  </details>`;
}

function renderKnowledgebaseLibraryItem(row = {}) {
  const status = !row.isActive
    ? badge("Archived", "neutral")
    : row.approvalStatus === "approved_current"
      ? badge("Included", "success")
      : badge("Draft", "warning");
  const compatibilityTags = new Set(["pending_manager_approval", "manager_review", "approval_gate"]);
  const tags = (row.tags || []).filter((tag) => !compatibilityTags.has(String(tag))).slice(0, 5).map((tag) => badge(tag, "neutral")).join("") || badge("No tags", "neutral");
  const categoryLabel = row.category === "manager_guidance" ? "Local guidance" : humanizeSlug(row.category || "general");
  return `<article class="studio-library-item">
    <div class="studio-library-main">
      <div class="studio-library-heading">
        <div>
          <h4>${escapeHtml(row.title || "Untitled knowledge entry")}</h4>
          <p class="muted small">${escapeHtml(categoryLabel)} · ${escapeHtml(row.sourceProject || "Local entry")} · Version ${formatNumber(row.version || 1)}</p>
        </div>
        ${status}
      </div>
      <div class="studio-tags">${tags}</div>
      <p class="studio-library-preview">${escapeHtml(String(row.content || "No content supplied.").replace(/\s+/g, " ").slice(0, 220))}${String(row.content || "").length > 220 ? "..." : ""}</p>
    </div>
    ${renderKnowledgebaseActions(row)}
  </article>`;
}

function renderTemplateLibraryItem(row = {}) {
  const tags = (row.tags || []).slice(0, 5).map((tag) => badge(tag, "neutral")).join("") || badge("No tags", "neutral");
  return `<article class="studio-library-item">
    <div class="studio-library-main">
      <div class="studio-library-heading">
        <div>
          <h4>${escapeHtml(row.name || "Untitled template")}</h4>
          <p class="muted small">${escapeHtml(humanizeSlug(row.evaluationGoal || "evaluation"))} · Version ${formatNumber(row.version || 1)} · Prompt ${escapeHtml(shortHash(row.promptHash))}</p>
        </div>
        ${badge(row.isActive ? "Active" : "Archived", row.isActive ? "success" : "neutral")}
      </div>
      <div class="studio-tags">${tags}</div>
      <p class="studio-library-preview">${escapeHtml(String(row.instructions || "No prompt instructions supplied.").replace(/\s+/g, " ").slice(0, 220))}${String(row.instructions || "").length > 220 ? "..." : ""}</p>
    </div>
    ${renderTemplateActions(row)}
  </article>`;
}

function renderEvaluationRunActions(row = {}) {
  const id = row.id || "";
  const status = String(row.status || "queued");
  const jobs = Array.isArray(row.queuedJobs) ? row.queuedJobs : [];
  const hasJob = jobs.some((job) => String(job.jobId || job.job_id || "").trim());
  if (!id || status === "completed") return `<span class="muted small">Results available</span>`;
  const returnTo = "/evaluation-studio";
  const harvestForm = status === "quarantined" ? "" : `<form class="inline-alert-form" method="post" action="/evaluation-studio/runs/${encodeURIComponent(id)}/harvest">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
    <button type="submit">Harvest results</button>
  </form>`;
  const quarantineForm = status === "quarantined" ? "" : `<form class="inline-alert-form" method="post" action="/evaluation-studio/runs/${encodeURIComponent(id)}/quarantine">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
    <label class="advanced-action-field">Reason<input name="reason" placeholder="Why pause this run?" /></label>
    <button type="submit">Quarantine</button>
  </form>`;
  const resumeForm = status === "quarantined" ? `<form class="inline-alert-form" method="post" action="/evaluation-studio/runs/${encodeURIComponent(id)}/resume">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
    <input type="hidden" name="reason" value="Resume from dashboard" />
    <button type="submit">Resume</button>
  </form>` : "";
  const statusMessage = status === "quarantined"
    ? "Paused for review"
    : status === "failed"
      ? "Review run failure"
      : status === "partially_completed"
        ? "Results available; some jobs failed"
        : hasJob
          ? "Processing automatically"
          : "Waiting to start";
  return `<div class="run-action-stack">
    <span class="muted small">${statusMessage}</span>
    <details class="advanced-run-actions">
      <summary>Advanced</summary>
      <div class="alert-actions">${harvestForm}${quarantineForm}${resumeForm}</div>
    </details>
  </div>`;
}

function selectedOption(current, value) {
  return String(current || "") === String(value || "") ? "selected" : "";
}

function evaluationRecommendationLabel(value) {
  const recommendation = String(value || "").trim().toLowerCase();
  const labels = {
    manager_review_recommended: "Manual check suggested",
    independent_record_verification_recommended: "Verify the lead record independently",
    continue_normal_workflow: "Continue normal workflow",
    no_action_recommended: "No record action needed",
    insufficient_evidence: "Review more evidence",
    review_salesperson_allegation: "Check salesperson allegation",
    correct_or_remove_record: "Check and correct the lead record",
    retry_contact: "Keep the lead active and retry contact"
  };
  return labels[recommendation] || humanizeSlug(recommendation || "not supplied");
}

function evaluationRecordAssessmentLabel(value) {
  const classification = String(value || "").trim().toLowerCase();
  const labels = {
    supported_invalidity: "Evidence the record is invalid",
    supported_operational_unusability: "Operational restriction identified",
    contradictory_evidence: "Evidence contradicts the allegation",
    no_supporting_evidence: "No evidence the record is invalid",
    untestable: "Record validity could not be determined",
    insufficient_evidence: "Not enough evidence to assess the record"
  };
  return labels[classification] || humanizeSlug(classification || "not supplied");
}

function evaluationLeadDecisionLabel(facets = {}) {
  const classification = String(facets.recordClassification || "").toLowerCase();
  if (classification === "no_supporting_evidence") return "Keep this lead active";
  if (classification === "supported_invalidity") return "Check and correct the lead record";
  if (classification === "supported_operational_unusability") return "Pause normal contact and check the operational issue";
  if (classification === "contradictory_evidence") return "Check the salesperson allegation";
  return "More evidence is needed";
}

function evaluationAssessmentReason(facets = {}) {
  const classification = String(facets.recordClassification || "").toLowerCase();
  const reason = String(facets.recordReason || "none").toLowerCase();
  if (classification === "no_supporting_evidence") {
    return "The call contains usable evidence, but nothing indicates that the lead record is invalid.";
  }
  if (classification === "supported_invalidity") {
    return `The call contains evidence of ${humanizeSlug(reason)}, so the lead record should be checked before further use.`;
  }
  if (classification === "supported_operational_unusability") {
    return `The record may still be valid, but the call contains a ${humanizeSlug(reason)} issue that needs a manual check.`;
  }
  if (classification === "contradictory_evidence") {
    return `The call evidence contradicts the supplied ${humanizeSlug(reason)} allegation.`;
  }
  return "The supplied material does not support a reliable lead-record decision.";
}

function evaluationSummaryLabel(value) {
  return String(value || "No summary supplied.")
    .replace(/manager review/gi, "manual check")
    .replace(/manager-reviewed/gi, "manually reviewed");
}

function renderEvaluationResultDetails(row = {}) {
  const facets = evaluationResultFacets(row);
  const evidenceSnippets = [];
  const seenEvidence = new Set();
  for (const finding of row.findings || []) {
    const source = String(finding.evidence || finding.note || "").trim();
    if (!source) continue;
    for (const excerpt of source.split(/\s*\|\s*/)) {
      const cleanExcerpt = excerpt.replace(/\s+/g, " ").trim();
      const key = cleanExcerpt.toLowerCase();
      if (!cleanExcerpt || seenEvidence.has(key)) continue;
      seenEvidence.add(key);
      evidenceSnippets.push(cleanExcerpt);
      if (evidenceSnippets.length >= 3) break;
    }
    if (evidenceSnippets.length >= 3) break;
  }
  const evidence = evidenceSnippets.map((excerpt) => `<li>${escapeHtml(excerpt)}</li>`).join("");
  const allegation = String(facets.allegationAssessment || "absent").toLowerCase();
  return `<details class="compact-details result-details">
    <summary>View result</summary>
    <div class="result-decision">
      <span>Lead record decision</span>
      <strong>${escapeHtml(evaluationLeadDecisionLabel(facets))}</strong>
      <p>${escapeHtml(evaluationAssessmentReason(facets))}</p>
    </div>
    <dl class="result-answer-list">
      <div><dt>What the call showed</dt><dd>${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</dd></div>
      <div><dt>Next step</dt><dd>${escapeHtml(evaluationRecommendationLabel(facets.recommendation))}</dd></div>
      <div><dt>Confidence</dt><dd>${row.confidence === null || row.confidence === undefined ? "Unavailable" : formatRatioPercent(row.confidence)} · ${escapeHtml(humanizeSlug(row.evidenceAvailability || "unavailable"))} evidence</dd></div>
      ${allegation !== "absent" ? `<div><dt>Salesperson allegation</dt><dd>${escapeHtml(humanizeSlug(allegation))}</dd></div>` : ""}
    </dl>
    ${evidence ? `<div class="result-proof"><strong>Evidence</strong><ul class="result-evidence-list">${evidence}</ul></div>` : `<p class="muted small">No evidence snippets were stored.</p>`}
    <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
  </details>`;
}

function renderEvaluationStudio(persistence = {}, data = {}, options = {}) {
  const studio = options.studioView || persistence.evaluationStudio || {};
  const summary = studio.summary || {};
  const knowledgebaseRows = (studio.knowledgebaseEntries || []).slice(0, 50);
  const templateRows = (studio.evaluationTemplates || []).slice(0, 50);
  const runRows = (studio.evaluationRuns || []).slice(0, 8);
  const resultRows = studio.evaluationResults || [];
  const evidenceRows = (studio.evidenceQueue || []).slice(0, 8);
  const reportRollups = studio.reportRollups || {};
  const reportTotals = reportRollups.totals || {};
  const reportSignalRows = (reportRollups.signalRows || []).slice(0, 8);
  const reportExampleRows = (reportRollups.priorityExamples || []).slice(0, 8);
  const templateOptions = templateRows.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} (${escapeHtml(template.evaluationGoal || "goal")})</option>`).join("");
  const goalDatalist = Array.from(EVALUATION_GOALS || [])
    .sort()
    .map((goal) => `<option value="${escapeHtml(goal)}">${escapeHtml(humanizeSlug(goal))}</option>`)
    .join("");
  const defaultSchema = JSON.stringify({
    schema_version: "sales_dashboard_evaluation_result.v1",
    status: "usable|insufficient_evidence|failed",
    confidence: "0-1",
    evidence_availability: "available|partial|unavailable",
    manager_summary: "short summary",
    findings: []
  }, null, 2);
  const currentImportId = persistence.currentImportId || "";
  const resultFilters = options.resultFilters || {};
  const resultQuery = studio.resultQuery || {};
  const availableCalls = (data.drilldownRows || []).filter((call) => String(call.transcript || "").trim());
  const salespersonOptions = Array.from(new Set(availableCalls.map((call) => call.salesperson).filter(Boolean))).sort();
  const sourceOptions = Array.from(new Set(availableCalls.map((call) => call.source).filter(Boolean))).sort();
  const contactOptions = Array.from(new Set(availableCalls.map((call) => call.contactClassification).filter(Boolean))).sort();
  const qualityOptions = Array.from(new Set(availableCalls.map((call) => call.transcriptQuality).filter(Boolean))).sort();
  const resultPageUrl = (offset) => {
    const query = new URLSearchParams();
    Object.entries(resultFilters).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined && key !== "offset") query.set(key, value);
    });
    query.set("offset", String(Math.max(0, offset || 0)));
    return `/evaluation-studio?${query.toString()}#results`;
  };
  const seededFrom = (summary.seededFrom || []).join(", ") || "Neuron and LatentPulse patterns";
  return `<section class="panel" id="evaluation-studio">
    <div class="panel-header">
      <div>
        <h2>Evaluation Studio</h2>
        <p class="muted small">Choose transcripts, run a local evaluator, and browse evidence-backed results. Templates and reference material stay editable without an approval workflow.</p>
      </div>
      ${badge("Active call data only", "success")}
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Knowledgebase", formatNumber(summary.activeKnowledgebaseEntries || 0), `${formatNumber(summary.approvedKnowledgebaseEntries || 0)} included, ${formatNumber(summary.pendingApprovalKnowledgebaseEntries || 0)} drafts`, "info")}
        ${metricCard("Evaluation goals", formatNumber(summary.activeTemplates || 0), `${formatNumber(summary.archivedTemplates || 0)} archived templates`, "info")}
        ${metricCard("Batch runs", formatNumber(summary.runs || 0), summary.lastRun ? `Latest: ${escapeHtml(summary.lastRun.status || "queued")}` : "No run queued yet", "warn")}
        ${metricCard("Evaluation results", formatNumber(summary.results || 0), `${formatNumber(summary.reviewRecommendedResults || 0)} suggest a manual check`, summary.reviewRecommendedResults ? "warn" : "info")}
        ${metricCard("Evidence gaps", formatNumber(summary.evidenceUnavailableResults || 0), "Model output labelled evidence unavailable", summary.evidenceUnavailableResults ? "warn" : "good")}
        ${metricCard("Ready to evaluate", formatNumber(availableCalls.length), "Calls with transcript text in the current view", "good")}
      </div>

      <section class="studio-library" id="knowledgebase" aria-labelledby="knowledgebase-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Reference material</p>
            <h3 id="knowledgebase-heading">Knowledgebase</h3>
            <p class="muted small">The company guidance that an evaluation may use: procedure, scripts, objections, callback guidance, and coaching standards.</p>
          </div>
          <span class="muted small">${formatNumber(summary.approvedKnowledgebaseEntries || 0)} included / ${formatNumber(summary.pendingApprovalKnowledgebaseEntries || 0)} drafts</span>
        </div>
          <details class="studio-create">
            <summary>Add knowledgebase entry</summary>
          <form class="studio-form" method="post" action="/evaluation-studio/knowledgebase">
            <input name="title" placeholder="Title" required />
            <select name="category">
              <option value="procedure">Procedure</option>
              <option value="sales_script">Sales script</option>
              <option value="objection_handling">Objection handling</option>
              <option value="callback_handling">Callback handling</option>
              <option value="lead_validity">Lead validity</option>
              <option value="coaching">Coaching</option>
              <option value="compliance">Compliance</option>
              <option value="general">General</option>
            </select>
            <input name="tags" placeholder="Tags, comma separated" />
            <select name="approvalStatus">
              <option value="approved_current" selected>Include in evaluations</option>
              <option value="pending_manager_approval">Save as draft</option>
            </select>
            <textarea name="approvalNote" placeholder="Optional local note" rows="2"></textarea>
            <label class="file-inline-control">
              <span>Load text file</span>
              <input data-knowledgebase-file-input type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" />
            </label>
            <span class="muted small" data-knowledgebase-file-status></span>
            <textarea name="content" placeholder="Knowledgebase content" rows="5" required></textarea>
            <button type="submit">Save entry</button>
          </form>
          </details>
          <div class="studio-library-list">
            ${knowledgebaseRows.length ? knowledgebaseRows.map(renderKnowledgebaseLibraryItem).join("") : `<div class="empty">No knowledgebase entries are available.</div>`}
          </div>
      </section>

      <section class="studio-library" id="templates" aria-labelledby="templates-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Evaluation goals</p>
            <h3 id="templates-heading">Evaluation templates</h3>
            <p class="muted small">Reusable instructions that tell the local model what to assess and what proof to return.</p>
          </div>
          <span class="muted small">${formatNumber(summary.activeTemplates || 0)} active templates</span>
        </div>
          <details class="studio-create">
            <summary>Create evaluation template</summary>
          <form class="studio-form" method="post" action="/evaluation-studio/templates">
            <input name="name" placeholder="Template name" required />
            <input name="evaluationGoal" list="evaluation-goal-options" placeholder="Evaluation goal, e.g. objection_handling" value="callback_opportunity" required />
            <datalist id="evaluation-goal-options">${goalDatalist}</datalist>
            <input name="tags" placeholder="Tags, comma separated" />
            <textarea name="instructions" placeholder="Prompt instructions" rows="5" required></textarea>
            <textarea name="outputSchema" rows="5">${escapeHtml(defaultSchema)}</textarea>
            <button type="submit">Save template</button>
          </form>
          </details>
          <div class="studio-library-list">
            ${templateRows.length ? templateRows.map(renderTemplateLibraryItem).join("") : `<div class="empty">No evaluation templates are available.</div>`}
          </div>
      </section>

      <section class="studio-library" id="run-controls" aria-labelledby="run-controls-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Evaluate transcripts</p>
            <h3 id="run-controls-heading">Choose calls and run an evaluation</h3>
            <p class="muted small">Filters define the exact batch. Preview it first, then submit the selected transcripts to the local model.</p>
          </div>
          <span class="muted small">${formatNumber(availableCalls.length)} calls contain transcript text</span>
        </div>
        <form class="studio-form evaluation-batch-form" method="post" action="/evaluation-studio/runs" data-evaluation-batch-form>
          <input type="hidden" name="importId" value="${escapeHtml(currentImportId)}" />
          <input type="hidden" name="submitNow" value="true" />
          <label class="studio-field">Evaluator<select name="templateId" required>${templateOptions || `<option value="">No active templates</option>`}</select></label>
          <label class="studio-field">Evaluation state<select name="evaluationState">
            <option value="unevaluated">Not yet evaluated with this template</option>
            <option value="all">All matching transcripts</option>
            <option value="evaluated">Previously evaluated</option>
            <option value="failed">Failed results only</option>
          </select></label>
          <label class="studio-field">Business type<select name="businessSegment">
            <option value="">All business types</option><option value="new">New Business</option><option value="warm">Warm Business</option>
          </select></label>
          <label class="studio-field">Salesperson<select name="salesperson"><option value="">All salespeople</option>${salespersonOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
          <label class="studio-field">Source<select name="source"><option value="">All sources</option>${sourceOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>
          <label class="studio-field">Contact state<select name="contactClassification"><option value="">All contact states</option>${contactOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(humanizeSlug(value))}</option>`).join("")}</select></label>
          <label class="studio-field">Transcript quality<select name="transcriptQuality"><option value="">All quality levels</option>${qualityOptions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(humanizeSlug(value))}</option>`).join("")}</select></label>
          <label class="studio-field">Order<select name="selectionMode"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="random">Deterministic random sample</option><option value="call_ids">Specific call IDs</option></select></label>
          <label class="studio-field">From date<input name="dateFrom" type="date" /></label>
          <label class="studio-field">To date<input name="dateTo" type="date" /></label>
          <label class="studio-field">Minimum duration (seconds)<input name="minDuration" type="number" min="0" /></label>
          <label class="studio-field">Maximum duration (seconds)<input name="maxDuration" type="number" min="0" /></label>
          <label class="studio-field">Maximum calls<input name="limit" type="number" min="1" max="50000" value="100" required /></label>
          <label class="studio-field">Search<input name="search" placeholder="Call ID, salesperson, source or outcome" /></label>
          <label class="studio-field studio-field-full">Specific call IDs<textarea name="callIds" rows="3" placeholder="Paste call IDs separated by commas, spaces or new lines"></textarea></label>
          <div class="evaluation-submit-row">
            <button type="button" class="secondary-button" data-selection-preview>Preview selection</button>
            <button type="submit">Run evaluation</button>
            <span class="muted small" data-selection-preview-status>Preview the batch before submitting.</span>
          </div>
        </form>
        <details class="studio-create">
          <summary>Test one transcript first</summary>
          <form class="studio-form" method="post" action="/evaluation-studio/prompt-tests">
            <input type="hidden" name="importId" value="${escapeHtml(currentImportId)}" />
            <input type="hidden" name="submitNow" value="true" />
            <label class="studio-field">Evaluator<select name="templateId" required>${templateOptions || `<option value="">No active templates</option>`}</select></label>
            <label class="studio-field">Call ID<input name="callId" placeholder="Call ID to test" required /></label>
            <button type="submit">Run one-call test</button>
          </form>
        </details>
        <p class="muted small studio-safety-note">Evaluations are read-only overlays. They do not change raw calls, claims, leads, alerts, reports, allocation or CRM records.</p>
      </section>

      <h3 id="runs" class="section-anchor" style="margin-top: 16px;">Recent Evaluation Runs</h3>
      ${table([
        { label: "Run", render: (row) => `<span class="mono">${escapeHtml(String(row.id || "").slice(0, 18))}</span><br /><span class="muted small">${escapeHtml(row.templateSnapshot?.name || row.templateId || "")}</span>` },
        { label: "Type", render: (row) => badge(String(row.runType || "batch").replace(/_/g, " "), row.runType === "prompt_test" ? "notice" : "neutral") },
        { label: "Status", render: (row) => `<span data-evaluation-run-id="${escapeHtml(row.id || "")}" data-evaluation-run-status="${escapeHtml(row.status || "queued")}" data-evaluation-run-has-job="${Array.isArray(row.queuedJobs) && row.queuedJobs.some((job) => String(job.jobId || job.job_id || "").trim()) ? "true" : "false"}">${badge(String(row.status || "queued").replace(/_/g, " "), row.status === "failed" || row.status === "quarantined" ? "critical" : row.status === "running" ? "notice" : row.status === "completed" ? "success" : "neutral")}<br /><span class="muted small">${escapeHtml(row.quarantineReason || (row.resumeCount ? `${formatNumber(row.resumeCount)} resumes` : ""))}</span></span>` },
        { label: "Calls", render: (row) => `${formatNumber(row.plannedCallCount || 0)} planned<br /><span class="muted small">${formatNumber(row.queuedJobCount || 0)} queued, ${formatNumber(row.failedCallCount || 0)} failed</span>` },
        { label: "Versions", render: (row) => `Template v${formatNumber(row.templateVersion || 1)}<br /><span class="muted small">${formatNumber((row.knowledgebaseSnapshot || []).length)} KB entries</span>` },
        { label: "Updated", render: (row) => `${formatDateTime(row.updatedAt || row.createdAt)}<br /><span class="muted small">${formatNumber((row.runHistory || []).length)} history events</span>` },
        { label: "Actions", render: (row) => renderEvaluationRunActions(row) }
      ], runRows, "No evaluation run has been queued yet.")}

      <h3 id="evidence" class="section-anchor" style="margin-top: 16px;">Results Needing Attention</h3>
      <p class="muted small" style="margin: 4px 0 10px;">Results appear here when the evaluator suggests a manual check. This is optional local review, not an approval queue.</p>
      ${table([
        { label: "Call", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "Unknown")}</a><br /><span class="muted small">${escapeHtml(row.evaluationGoal || "evaluation")}</span>` },
        { label: "Status", render: (row) => `${badge(String(row.status || "usable").replace(/_/g, " "), row.status === "failed" ? "critical" : row.status === "insufficient_evidence" ? "warning" : "success")}<br />${badge(String(row.provenance || "evaluation_studio_local_model").replace(/_/g, " "), "notice")}` },
        { label: "Confidence", render: (row) => `${row.confidence === null || row.confidence === undefined ? "Confidence unavailable" : formatRatioPercent(row.confidence)}<br /><span class="muted small">${escapeHtml(String(row.confidenceBand || "confidence_unavailable").replace(/_/g, " "))}</span>` },
        { label: "Evidence", render: (row) => {
          const firstFinding = (row.findings || [])[0] || {};
          return `<span class="evidence">${escapeHtml(firstFinding.evidence || row.managerSummary || "Evidence unavailable")}</span><span class="muted small">${escapeHtml(String(row.evidenceAvailability || "unavailable").replace(/_/g, " "))}</span>`;
        } },
        { label: "Check", render: (row) => row.managerReviewRecommended ? badge("Manual check suggested", "warn") : badge("Optional", "neutral") },
        { label: "Open", render: (row) => `<a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Transcript proof</a>` }
      ], evidenceRows, "No results currently suggest a manual check.")}

      <h3 id="rollups" class="section-anchor" style="margin-top: 16px;">Report-Safe Evaluation Rollups</h3>
      <p class="muted small" style="margin: 4px 0 10px;">Counts below come from labelled Evaluation Studio findings. They are process-review signals with evidence and confidence, not confirmed sales, revenue, conversion, or disciplinary proof.</p>
      <div class="metrics">
        ${metricCard("Evaluated calls", formatNumber(reportTotals.evaluatedCalls || 0), `${formatNumber(reportTotals.evaluatedResults || 0)} stored local-model results`, "info")}
        ${metricCard("Callback opportunities", formatNumber(reportTotals.callbackOpportunities || 0), "Evidence-backed follow-up leakage review signals", "warn")}
        ${metricCard("Possible waste indicators", formatNumber(reportTotals.possibleWasteIndicators || 0), "Lead utilisation issue signals requiring proof review", "risk")}
        ${metricCard("Coaching opportunities", formatNumber(reportTotals.coachingOpportunities || 0), "Procedure or call-stage coaching signals", "notice")}
      </div>
      ${table([
        { label: "Signal", render: (row) => escapeHtml(row.label || row.signal || "Signal") },
        { label: "Count", render: (row) => formatNumber(row.count || 0) },
        { label: "Use", render: (row) => `<span class="muted small">${escapeHtml(row.signal === "possibleWasteIndicators" ? "Review as possible waste indicators only." : row.signal === "coachingOpportunities" ? "Use as coaching opportunities." : "Use as evidence-backed signals.")}</span>` }
      ], reportSignalRows, "No report-safe Evaluation Studio rollups yet.")}
      ${table([
        { label: "Call", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "Unknown")}</a><br /><span class="muted small">${escapeHtml(row.signalLabel || "signal")}</span>` },
        { label: "Finding", render: (row) => `${escapeHtml(row.field || "finding")}<br /><span class="muted small">${escapeHtml(row.value || "Not supplied")}</span>` },
        { label: "Confidence", render: (row) => `${row.confidence === null || row.confidence === undefined ? "Confidence unavailable" : formatRatioPercent(row.confidence)}<br /><span class="muted small">${escapeHtml(String(row.confidenceBand || "confidence_unavailable").replace(/_/g, " "))}</span>` },
        { label: "Proof", render: (row) => `<span class="evidence">${escapeHtml(row.evidence || "Evidence unavailable")}</span>` }
      ], reportExampleRows, "No priority report examples yet.")}

      <section class="studio-library" id="results" aria-labelledby="results-heading">
      <div class="studio-section-heading">
        <div><p class="page-kicker">Browse output</p><h3 id="results-heading">Evaluation Results</h3><p class="muted small">Filter by what the evaluator identified, then open the stored evidence and transcript proof.</p></div>
        <span class="muted small">${formatNumber(resultQuery.matchingResults || resultRows.length)} matching results</span>
      </div>
      <form class="result-filter-form" method="get" action="/evaluation-studio">
        <label>Goal<select name="evaluationGoal"><option value="">All goals</option>${Array.from(EVALUATION_GOALS || []).sort().map((value) => `<option value="${escapeHtml(value)}" ${selectedOption(resultFilters.evaluationGoal, value)}>${escapeHtml(humanizeSlug(value))}</option>`).join("")}</select></label>
        <label>Status<select name="resultStatus"><option value="">All statuses</option>${["usable", "insufficient_evidence", "failed"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.resultStatus, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
        <label>Record assessment<select name="recordClassification"><option value="">All assessments</option>${["supported_invalidity", "supported_operational_unusability", "contradictory_evidence", "no_supporting_evidence", "untestable", "insufficient_evidence"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.recordClassification, value)}>${escapeHtml(evaluationRecordAssessmentLabel(value))}</option>`).join("")}</select></label>
        <label>Reason<input name="recordReason" value="${escapeHtml(resultFilters.recordReason || "")}" placeholder="e.g. wrong_number" /></label>
        <label>Operational issue<select name="operationalClassification"><option value="">All operational findings</option>${["none", "do_not_contact", "unsafe_abusive"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.operationalClassification, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
        <label>Allegation<select name="allegationAssessment"><option value="">All allegation states</option>${["absent", "supported", "contradicted", "untestable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.allegationAssessment, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
        <label>Recommendation<input name="recommendation" value="${escapeHtml(resultFilters.recommendation || "")}" placeholder="e.g. retry_contact" /></label>
        <label>Confidence<select name="confidenceBand"><option value="">All confidence bands</option>${["high", "medium", "low", "unusable", "confidence_unavailable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.confidenceBand, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
        <label>Evidence<select name="evidenceAvailability"><option value="">All evidence states</option>${["available", "partial", "unavailable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.evidenceAvailability, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
        <label>Page size<select name="limit">${[10,25,50,100].map((value) => `<option value="${value}" ${selectedOption(resultFilters.limit || "25", value)}>${value}</option>`).join("")}</select></label>
        <input type="hidden" name="offset" value="0" />
        <div class="result-filter-actions"><button type="submit">Apply filters</button><a class="filter-link" href="/evaluation-studio#results">Clear</a></div>
      </form>
      ${table([
        { label: "Call", description: "The call ID and evaluator used. Select the call ID to open the full transcript proof.", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "unknown")}</a><br /><span class="muted small">${escapeHtml(humanizeSlug(row.evaluationGoal || "evaluation"))}</span>` },
        { label: "Status", description: "Usable means enough evidence was available for this evaluator to make a decision. It does not mean a sale was made or that the lead was good.", render: (row) => badge(String(row.status || "usable").replace(/_/g, " "), row.status === "failed" ? "critical" : row.status === "insufficient_evidence" ? "warning" : "success") },
        { label: "Answer", description: "The conclusion about whether the lead record appears invalid or operationally unusable. No evidence the record is invalid means this call did not support correcting or removing it.", render: (row) => { const facets = evaluationResultFacets(row); return `${escapeHtml(evaluationRecordAssessmentLabel(facets.recordClassification))}<br /><span class="muted small">${escapeHtml(facets.recordReason && facets.recordReason !== "none" ? humanizeSlug(facets.recordReason) : evaluationLeadDecisionLabel(facets))}</span>`; } },
        { label: "Recommendation", description: "The suggested next step based on the available evidence. It is advisory and does not change the lead, claim or CRM.", render: (row) => { const facets = evaluationResultFacets(row); return `<span class="evidence">${escapeHtml(evaluationRecommendationLabel(facets.recommendation))}</span>`; } },
        { label: "Confidence", description: "How strongly the available evidence supports this evaluation result. It is not a probability of sale.", render: (row) => `${row.confidence === null || row.confidence === undefined ? "Unavailable" : formatRatioPercent(row.confidence)}<br /><span class="muted small">${escapeHtml(humanizeSlug(row.evidenceAvailability || "unavailable"))} evidence</span>` },
        { label: "Updated", description: "When this evaluation result was last stored, shown in AEST. Open View result for the explanation and transcript evidence.", render: (row) => `${formatDateTime(row.updatedAt || row.createdAt)}<br />${renderEvaluationResultDetails(row)}` }
      ], resultRows, "No results match these filters.")}
      <nav class="result-pagination" aria-label="Evaluation result pages">
        ${resultQuery.previousOffset !== null && resultQuery.previousOffset !== undefined ? `<a class="filter-link" href="${escapeHtml(resultPageUrl(resultQuery.previousOffset))}">Previous</a>` : `<span class="muted small">Previous</span>`}
        <span class="muted small">Showing ${formatNumber((resultQuery.offset || 0) + (resultRows.length ? 1 : 0))}-${formatNumber((resultQuery.offset || 0) + resultRows.length)} of ${formatNumber(resultQuery.matchingResults || resultRows.length)}</span>
        ${resultQuery.nextOffset !== null && resultQuery.nextOffset !== undefined ? `<a class="filter-link" href="${escapeHtml(resultPageUrl(resultQuery.nextOffset))}">Next</a>` : `<span class="muted small">Next</span>`}
      </nav>
      </section>
    </div>
  </section>`;
}

function renderEvaluationStudioDashboardSummary(persistence = {}) {
  const studio = persistence.evaluationStudio || {};
  const summary = studio.summary || {};
  const reportRollups = studio.reportRollups || {};
  const reportTotals = reportRollups.totals || {};
  return `<section class="panel" id="evaluation-results">
    <div class="panel-header">
      <div>
        <h2>Evaluation Results</h2>
        <p class="muted small">Signals from stored Evaluation Studio runs can support dashboard review. Prompt management and batch evaluation live in the separate studio workspace.</p>
      </div>
      <a class="filter-link" href="/evaluation-studio">Open Evaluation Studio</a>
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Evaluated calls", formatNumber(reportTotals.evaluatedCalls || summary.results || 0), `${formatNumber(reportTotals.evaluatedResults || summary.results || 0)} stored evaluation results`, "info")}
        ${metricCard("Manual check suggested", formatNumber(summary.reviewRecommendedResults || 0), "Evidence-backed results worth checking", summary.reviewRecommendedResults ? "warn" : "good")}
        ${metricCard("Evidence gaps", formatNumber(summary.evidenceUnavailableResults || 0), "Evaluation results labelled evidence unavailable", summary.evidenceUnavailableResults ? "warn" : "good")}
        ${metricCard("Callback signals", formatNumber(reportTotals.callbackOpportunities || 0), "Process-review signals, not confirmed conversion", reportTotals.callbackOpportunities ? "warn" : "info")}
      </div>
      <p class="muted small" style="margin-top: 12px;">Evaluation Studio results remain evidence/confidence-labelled local signals. They do not overwrite raw call data, deterministic metrics, LLM outputs, or optional manual corrections.</p>
    </div>
  </section>`;
}

function renderStudioUtilityScript() {
  return `<script>
      (() => {
        const fileInput = document.querySelector("[data-knowledgebase-file-input]");
        if (!fileInput) return;
        const form = fileInput.closest("form");
        const status = document.querySelector("[data-knowledgebase-file-status]");
        const titleInput = form ? form.querySelector("input[name='title']") : null;
        const contentInput = form ? form.querySelector("textarea[name='content']") : null;
        const setStatus = (message) => {
          if (status) status.textContent = message || "";
        };
        fileInput.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 524288) {
            setStatus("Max 512KB");
            fileInput.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result || "").trim();
            if (!text) {
              setStatus("File was empty");
              fileInput.value = "";
              return;
            }
            if (titleInput && !titleInput.value.trim()) {
              titleInput.value = file.name.replace(/\\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
            }
            if (contentInput) contentInput.value = text;
            setStatus("Loaded; review then save");
            fileInput.value = "";
          };
          reader.onerror = () => {
            setStatus("Could not read file");
            fileInput.value = "";
          };
          reader.readAsText(file);
        });
      })();
      (() => {
        const panelBody = document.querySelector("#evaluation-studio > .panel-body");
        const runControls = document.getElementById("run-controls");
        const metricGrid = panelBody ? panelBody.querySelector(":scope > .metrics") : null;
        const results = document.getElementById("results");
        const runsHeading = document.getElementById("runs");
        const evidenceHeading = document.getElementById("evidence");
        const rollupsHeading = document.getElementById("rollups");
        const runsGroup = runsHeading ? [runsHeading, runsHeading.nextElementSibling].filter(Boolean) : [];
        const evidenceGroup = evidenceHeading
          ? [evidenceHeading, evidenceHeading.nextElementSibling, evidenceHeading.nextElementSibling?.nextElementSibling].filter(Boolean)
          : [];
        const rollupsGroup = [];
        for (let node = rollupsHeading; node && node !== results; node = node.nextElementSibling) rollupsGroup.push(node);
        if (panelBody && runControls && metricGrid) {
          panelBody.insertBefore(runControls, metricGrid);
          if (results) metricGrid.after(results);
          if (results && runsGroup.length) results.after(...runsGroup);
          if (runsGroup.length && evidenceGroup.length) runsGroup.at(-1).after(...evidenceGroup);
          if (evidenceGroup.length && rollupsGroup.length) evidenceGroup.at(-1).after(...rollupsGroup);
        }

        const form = document.querySelector("[data-evaluation-batch-form]");
        const previewButton = document.querySelector("[data-selection-preview]");
        const status = document.querySelector("[data-selection-preview-status]");
        if (!form || !previewButton || !status) return;
        const setStatus = (message, tone = "") => {
          status.textContent = message;
          status.dataset.tone = tone;
        };
        previewButton.addEventListener("click", async () => {
          previewButton.disabled = true;
          setStatus("Checking matching transcripts...");
          try {
            const body = Object.fromEntries(new FormData(form).entries());
            const response = await fetch("/api/evaluation-studio/selection-preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not preview this selection.");
            const examples = (payload.preview || []).slice(0, 3).map((call) => call.callId).filter(Boolean).join(", ");
            setStatus(String(payload.matchingCalls || 0) + " calls selected" + (examples ? "; first: " + examples : "") + ".", "success");
          } catch (error) {
            setStatus(error.message || "Could not preview this selection.", "error");
          } finally {
            previewButton.disabled = false;
          }
        });
        form.addEventListener("input", () => setStatus("Selection changed; preview again."));
      })();
      (() => {
        const runNodes = Array.from(document.querySelectorAll("[data-evaluation-run-id][data-evaluation-run-status][data-evaluation-run-has-job='true']"));
        const activeStatuses = new Set(["queued", "running", "partially_completed"]);
        const activeRuns = new Map(runNodes
          .map((node) => [node.getAttribute("data-evaluation-run-id"), node.getAttribute("data-evaluation-run-status")])
          .filter(([id, status]) => id && activeStatuses.has(status)));
        if (!activeRuns.size) return;
        const poll = async () => {
          try {
            const response = await fetch("/api/evaluation-studio?currentOnly=true", { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json();
            const nextRuns = new Map((payload.evaluationRuns || []).map((run) => [String(run.id || ""), String(run.status || "queued")]));
            const changed = Array.from(activeRuns.entries()).some(([id, status]) => nextRuns.get(id) !== status);
            if (changed) window.location.reload();
          } catch (error) {
            // A temporary status check failure should not interrupt the workspace.
          }
        };
        const timer = window.setInterval(poll, 5000);
        window.addEventListener("beforeunload", () => window.clearInterval(timer), { once: true });
      })();
    </script>`;
}

function renderEvaluationStudioPage(analysis, options = {}) {
  const sourceData = analysis || renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export.");
  const activeSegment = normalizeBusinessSegment(options.businessSegment || options.segment);
  const data = scopedDashboardData(sourceData, activeSegment);
  const basePersistence = data.persistence || renderEmptyState("").persistence;
  const persistence = options.studioView
    ? { ...basePersistence, evaluationStudio: options.studioView }
    : basePersistence;
  const hasAnyData = Boolean(analysis && analysis.totals && (data.filterSummary?.totalRecords || data.totals.uniqueCalls));
  const segmentLabel = businessSegmentLabel(activeSegment);
  const titleDetail = hasAnyData
    ? `${formatNumber(data.totals.uniqueCalls || 0)} active calls available for transcript evaluation`
    : "Load call data before running transcript evaluations.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Evaluation Studio - Sales Dashboard</title>
    <style>
      ${COLUMN_HELP_STYLES}
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      :root {
        --background: #080A0F;
        --surface: #0D1117;
        --surface-elevated: #131A24;
        --surface-soft: #182131;
        --border: #263244;
        --border-subtle: #1D2735;
        --foreground: #F4F7FB;
        --muted-foreground: #8A94A6;
        --primary: #C9A45C;
        --accent: #56D6E5;
        --success: #34D399;
        --warning: #F59E0B;
        --danger: #F87171;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main {
        width: min(1440px, calc(100vw - 40px));
        margin: 0 auto;
        padding: 28px 0 42px;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 18px;
      }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 34px; line-height: 1.08; font-weight: 850; }
      h2 { font-size: 17px; font-weight: 750; }
      h3 { font-size: 14px; font-weight: 750; }
      .topbar, .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        min-width: 0;
      }
      .page-kicker {
        color: var(--primary);
        font-size: 12px;
        font-weight: 750;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .muted { color: var(--muted-foreground); }
      .small { font-size: 13px; }
      .stack, .alert-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .studio-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }
      .studio-nav a, .filter-link, .inline-alert-form button, .studio-form button {
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 6px;
        border: 1px solid rgba(86, 214, 229, 0.36);
        color: var(--foreground);
        background: var(--surface-elevated);
        font: inherit;
        font-size: 13px;
        font-weight: 760;
        text-decoration: none;
        cursor: pointer;
      }
      .studio-nav a.active {
        color: var(--primary);
        border-color: rgba(201, 164, 92, 0.58);
        background: rgba(201, 164, 92, 0.10);
      }
      .studio-jump-nav {
        position: sticky;
        top: 10px;
        z-index: 5;
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        padding: 9px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: rgba(13, 17, 23, 0.96);
        box-shadow: var(--shadow);
      }
      .studio-jump-nav a {
        min-height: 32px;
        display: inline-flex;
        align-items: center;
        padding: 6px 9px;
        border-radius: 6px;
        color: var(--muted-foreground);
        font-size: 12px;
        font-weight: 750;
        text-decoration: none;
      }
      .studio-jump-nav a:hover { color: var(--foreground); background: var(--surface-elevated); }
      .filter-link:hover, .studio-nav a:hover, .inline-alert-form button:hover, .studio-form button:hover {
        border-color: rgba(86, 214, 229, 0.62);
        color: var(--accent);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
        white-space: nowrap;
        border: 1px solid transparent;
      }
      .success { color: var(--success); background: rgba(52, 211, 153, 0.09); border-color: rgba(52, 211, 153, 0.22); }
      .warning { color: var(--warning); background: rgba(245, 158, 11, 0.10); border-color: rgba(245, 158, 11, 0.24); }
      .critical { color: var(--danger); background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.24); }
      .notice { color: var(--accent); background: rgba(86, 214, 229, 0.09); border-color: rgba(86, 214, 229, 0.22); }
      .neutral { color: var(--muted-foreground); background: rgba(138, 148, 166, 0.10); border-color: rgba(138, 148, 166, 0.18); }
      .panel, .metric {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
      }
      .panel-header {
        padding: 15px 17px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .panel-body { min-width: 0; padding: 17px; }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 12px;
      }
      .metric {
        display: block;
        min-height: 116px;
        padding: 15px;
        color: inherit;
        text-decoration: none;
      }
      .metric.good { border-top: 3px solid var(--success); }
      .metric.warn { border-top: 3px solid var(--warning); }
      .metric.risk { border-top: 3px solid var(--danger); }
      .metric.info { border-top: 3px solid var(--accent); }
      .metric-label { color: var(--muted-foreground); font-size: 13px; margin-bottom: 12px; }
      .metric-value { font-size: 29px; line-height: 1; font-weight: 850; }
      .metric-detail { color: var(--muted-foreground); font-size: 13px; margin-top: 10px; }
      .grid-2 {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
      }
      .grid-2 > *, .guardrails > * { min-width: 0; }
      .guardrails {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .note {
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .note h3 { margin-bottom: 6px; }
      .studio-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;
        min-width: 0;
        max-width: 100%;
      }
      .studio-form textarea, .studio-form button { grid-column: 1 / -1; }
      .studio-form input, .studio-form select, .studio-form textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--foreground);
        background: var(--surface-elevated);
        padding: 8px 9px;
        font: inherit;
      }
      .studio-field {
        display: grid;
        gap: 5px;
        min-width: 0;
        color: var(--muted-foreground);
        font-size: 12px;
        font-weight: 700;
      }
      .studio-field input, .studio-field select, .studio-field textarea { min-width: 0; }
      .studio-field-full { grid-column: 1 / -1; }
      .evaluation-batch-form { margin-top: 14px; }
      .evaluation-submit-row {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        padding-top: 4px;
      }
      .evaluation-submit-row button { grid-column: auto; width: auto; min-width: 150px; }
      .secondary-button { background: var(--surface) !important; color: var(--accent) !important; }
      .studio-safety-note { margin-top: 12px; }
      .result-filter-form {
        display: grid;
        grid-template-columns: repeat(5, minmax(130px, 1fr));
        gap: 9px;
        margin: 14px 0;
      }
      .result-filter-form label {
        display: grid;
        gap: 5px;
        color: var(--muted-foreground);
        font-size: 11px;
        font-weight: 750;
        text-transform: uppercase;
      }
      .result-filter-form input, .result-filter-form select {
        width: 100%;
        min-width: 0;
        min-height: 36px;
        padding: 7px 8px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--foreground);
        background: var(--surface);
        font: inherit;
        text-transform: none;
      }
      .result-filter-actions { display: flex; align-items: center; gap: 8px; }
      .result-filter-actions button { min-height: 36px; }
      .result-pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
      }
      .result-details { min-width: 220px; margin-top: 7px; }
      .result-details summary { padding: 6px 0; color: var(--accent); font-size: 12px; }
      .result-decision {
        min-width: 520px;
        padding: 12px 0 10px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .result-decision > span, .result-answer-list dt {
        color: var(--muted-foreground);
        font-size: 10px;
        font-weight: 750;
        text-transform: uppercase;
      }
      .result-decision > strong { display: block; margin-top: 4px; font-size: 16px; }
      .result-decision p { max-width: 760px; margin-top: 6px; color: var(--muted-foreground); font-size: 12px; line-height: 1.45; }
      .result-answer-list {
        display: grid;
        gap: 0;
        min-width: 520px;
        max-width: 780px;
        margin: 0;
      }
      .result-answer-list div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border-subtle); }
      .result-answer-list dd { margin: 0; color: var(--foreground); font-size: 12px; line-height: 1.45; }
      .result-proof { max-width: 780px; padding: 12px 0; }
      .result-proof > strong { font-size: 12px; }
      .result-evidence-list { display: grid; gap: 6px; max-width: 760px; padding-left: 18px; color: var(--muted-foreground); font-size: 12px; line-height: 1.45; }
      .studio-create {
        margin: 10px 0 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .studio-create summary { padding: 10px 12px; color: var(--accent); }
      .studio-create .studio-form { padding: 0 12px 12px; }
      .studio-library {
        margin-top: 14px;
        padding: 16px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .studio-section-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .studio-section-heading .page-kicker { margin-bottom: 5px; }
      .studio-section-heading h3 { font-size: 18px; margin-bottom: 5px; }
      .studio-library-list { display: grid; gap: 10px; }
      .studio-library-item {
        display: block;
        padding: 14px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .studio-library-main { min-width: 0; }
      .studio-library-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .studio-library-heading h4 { margin: 0 0 5px; font-size: 15px; line-height: 1.3; }
      .studio-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .studio-library-preview {
        margin-top: 10px;
        color: var(--muted-foreground);
        font-size: 13px;
        line-height: 1.45;
      }
      .studio-library-item .compact-details {
        margin-top: 12px;
        border-top: 1px solid var(--border-subtle);
      }
      .studio-library-item .compact-details summary {
        padding: 10px 0;
        color: var(--accent);
      }
      .studio-library-item .compact-details .studio-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .studio-library-item .inline-alert-form { display: block; margin-top: 8px; }
      .run-action-stack { display: grid; gap: 7px; min-width: 150px; }
      .advanced-run-actions { border-top: 0; }
      .advanced-run-actions summary { padding: 5px 0; color: var(--muted-foreground); font-size: 12px; }
      .advanced-run-actions .alert-actions { align-items: stretch; }
      .advanced-action-field { display: grid; gap: 4px; color: var(--muted-foreground); font-size: 12px; }
      .advanced-action-field input { min-width: 150px; max-width: 220px; }
      .section-anchor { scroll-margin-top: 70px; }
      .file-inline-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 7px 10px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: rgba(86, 214, 229, 0.08);
        color: var(--accent);
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
      }
      .file-inline-control input {
        max-width: 190px;
        color: var(--muted-foreground);
        font-size: 12px;
      }
      .inline-alert-form { display: inline; }
      .table-wrap {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        overflow-x: auto;
        border-top: 1px solid var(--border-subtle);
      }
      table {
        width: 100%;
        min-width: 780px;
        border-collapse: collapse;
      }
      th, td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--border-subtle);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted-foreground);
        text-transform: uppercase;
        font-size: 11px;
        background: var(--surface-elevated);
      }
      tbody tr:hover { background: rgba(86, 214, 229, 0.035); }
      td strong { color: var(--foreground); }
      .data-link, .open-link { color: var(--accent); font-weight: 760; text-decoration: none; }
      .data-link { border-bottom: 1px solid rgba(86, 214, 229, 0.32); }
      .evidence, .evidence-summary { display: block; max-width: 320px; color: var(--muted-foreground); line-height: 1.4; }
      .empty {
        padding: 18px;
        border: 1px dashed var(--border);
        border-radius: 8px;
        color: var(--muted-foreground);
        background: var(--surface-elevated);
      }
      details { border-top: 1px solid var(--border-subtle); }
      summary { cursor: pointer; padding: 13px 17px; font-weight: 760; }
      .compact-details summary { padding: 8px 0; }
      .mono {
        font-family: "Geist Mono", "Cascadia Code", Consolas, monospace;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      @media (max-width: 1080px) {
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-2, .guardrails { grid-template-columns: minmax(0, 1fr); }
        .result-filter-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { width: min(100vw - 24px, 1440px); padding: 18px 0 30px; }
        .topbar, .panel-header { flex-direction: column; align-items: stretch; }
        .topbar .badge { width: 100%; white-space: normal; }
        .metrics, .studio-form { grid-template-columns: 1fr; }
        .studio-library { padding: 12px; }
        .studio-section-heading { flex-direction: column; }
        .studio-library-item .compact-details .studio-form { grid-template-columns: 1fr; }
        .result-filter-form { grid-template-columns: 1fr; min-width: 0; }
        .result-decision, .result-answer-list { min-width: 0; }
        .result-answer-list div { grid-template-columns: 1fr; gap: 4px; }
        .evaluation-submit-row, .result-pagination { align-items: stretch; flex-direction: column; }
        .evaluation-submit-row button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div>
          <p class="page-kicker">Transcript evaluation workspace</p>
          <h1>Evaluation Studio</h1>
          <p class="muted">${escapeHtml(titleDetail)} Prompt design, batch execution, and result browsing stay in this local workspace.</p>
          <nav class="studio-nav" aria-label="Evaluation Studio navigation">
            <a href="/">Sales Dashboard</a>
            <a href="/evaluation-studio" class="active">Evaluation Studio</a>
            <a href="/api/evaluation-studio">Studio JSON</a>
          </nav>
        </div>
        <div class="stack">
          ${hasAnyData ? badge("Active call data loaded", "success") : badge("No active call data", "warning")}
          ${activeSegment ? badge(`${segmentLabel} view`, "notice") : ""}
          ${badge(formatDateRange(data.dateRange), "neutral")}
        </div>
      </header>
      <nav class="studio-jump-nav" aria-label="Evaluation Studio sections">
        <a href="#run-controls">Evaluate</a>
        <a href="#results">Results</a>
        <a href="#runs">Runs</a>
        <a href="#evidence">Attention</a>
        <a href="#knowledgebase">Knowledgebase</a>
        <a href="#templates">Templates</a>
      </nav>
      ${!hasAnyData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}
      ${renderEvaluationStudio(persistence, data, options)}
    </main>
    ${renderStudioUtilityScript()}
  </body>
</html>`;
}

function normalizeBusinessSegment(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (["new", "new_business"].includes(text)) return "new";
  if (["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(text)) return "warm";
  return "";
}

function businessSegmentLabel(segment) {
  if (segment === "new") return "New Business";
  if (segment === "warm") return "Warm Business";
  return "All Business";
}

const DASHBOARD_VIEW_META = Object.freeze({
  overview: {
    label: "Overview",
    kicker: "Manager overview",
    title: "Sales Dashboard",
    description: "Call activity, reporting context, and the operating signals that need attention first."
  },
  harvest: {
    label: "Lead Harvest",
    kicker: "Callback opportunities",
    title: "Lead Harvest",
    description: "Review positive callback candidates, objections, salesperson handling, and handover evidence."
  },
  follow_up: {
    label: "Follow-Up",
    kicker: "Reattempt and recovery",
    title: "Follow-Up & Reattempts",
    description: "Inspect no-contact reattempt behaviour, later matching calls, and follow-up leakage."
  },
  reviews: {
    label: "Alerts & Reviews",
    kicker: "Manager workflow",
    title: "Alerts & Manager Review",
    description: "Triage active alerts and record manager confirmation, correction, dismissal, or escalation."
  },
  team: {
    label: "Team & Sources",
    kicker: "Coaching and comparison",
    title: "Team & Source Performance",
    description: "Compare salesperson, source, contact-barrier, and call-handling patterns with sample context."
  },
  intelligence: {
    label: "Intelligence",
    kicker: "Transcript evidence",
    title: "Transcript Intelligence",
    description: "Inspect deterministic and locally evaluated signals with confidence, evidence, and provenance."
  },
  records: {
    label: "Records & Reports",
    kicker: "Audit and evidence",
    title: "Records & Reports",
    description: "Open call proof, inspect import history, review data confidence, and access saved reports."
  }
});

function normalizeDashboardView(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (key === "leads") return "harvest";
  return Object.prototype.hasOwnProperty.call(DASHBOARD_VIEW_META, key) ? key : "overview";
}

function dashboardSegmentUrl(segment = "") {
  return segment ? `/?businessSegment=${encodeURIComponent(segment)}#business-split` : "/#business-split";
}

function intelligenceQueueLabel(queue) {
  const labels = {
    waste: "Utilisation Review",
    manager_review: "Manager Review",
    llm_completed: "LLM Completed",
    llm_queued: "LLM Queued",
    high_quality: "High Quality"
  };
  return labels[queue] || "Utilisation Review";
}

function scopedDashboardData(data, segment) {
  if (!segment) return data;
  const view = data.businessSegmentViews?.[segment];
  if (!view) return data;
  return {
    ...data,
    ...view,
    sourceName: data.sourceName,
    generatedAt: data.generatedAt,
    dateRange: data.dateRange,
    dataWindow: data.dataWindow,
    intelligenceGovernance: view.intelligenceGovernance || data.intelligenceGovernance,
    columns: data.columns,
    missingColumns: data.missingColumns,
    ignoredFields: data.ignoredFields,
    unsupportedMetrics: data.unsupportedMetrics,
    fieldCoverage: data.fieldCoverage,
    businessSegmentMetrics: data.businessSegmentMetrics,
    businessSegmentViews: data.businessSegmentViews,
    intelligence: data.intelligence?.segments?.[segment] || data.intelligence,
    persistence: data.persistence
  };
}

function renderCallPage(call, options = {}) {
  const callId = options.callId || call?.callId || "Unknown";
  const intelligenceAudit = options.intelligenceAudit || null;
  const managerReviews = (options.reviews || []).map(normalizeManagerReview);
  const latestManagerReview = managerReviews.slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
  const hasManagerReview = managerReviews.length > 0;
  const evidenceRows = (call?.evidence || []).map((item) => ({
    signal: item.signal,
    summary: item.summary,
    confidence: item.confidence,
    text: item.text,
    turns: item.turns || [],
    matchText: item.matchText || ""
  }));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Call ${escapeHtml(callId)} - Sales Dashboard</title>
    <style>
      ${COLUMN_HELP_STYLES}
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      :root {
        --background: #080A0F;
        --surface: #0D1117;
        --surface-elevated: #131A24;
        --surface-soft: #182131;
        --border: #263244;
        --border-subtle: #1D2735;
        --foreground: #F4F7FB;
        --muted-foreground: #8A94A6;
        --primary: #C9A45C;
        --accent: #56D6E5;
        --success: #34D399;
        --warning: #F59E0B;
        --danger: #F87171;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main { width: min(1240px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 42px; display: grid; gap: 16px; }
      .topbar, .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); }
      .topbar { padding: 18px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .call-title { display: flex; gap: 18px; align-items: flex-start; min-width: 0; }
      .call-brand { display: inline-flex; align-items: center; min-width: 170px; max-width: 220px; padding-top: 3px; }
      .call-brand img { display: block; width: 100%; height: auto; }
      .panel { padding: 18px; overflow: hidden; }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.12; font-weight: 800; }
      h2 { font-size: 18px; margin-bottom: 12px; font-weight: 750; }
      h3 { font-size: 14px; margin-bottom: 8px; font-weight: 750; }
      .page-kicker { color: var(--primary); font-size: 12px; font-weight: 760; text-transform: uppercase; margin-bottom: 6px; }
      .muted { color: var(--muted-foreground); }
      .small { font-size: 13px; }
      .grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
      .button-link, .data-link, button { color: var(--accent); font-weight: 760; text-decoration: none; }
      .button-link, button {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 6px;
        background: var(--surface-elevated);
        border: 1px solid var(--border);
        cursor: pointer;
      }
      .button-link:hover, button:hover { border-color: rgba(86, 214, 229, 0.58); color: var(--foreground); }
      .mono { font-family: "Geist Mono", "Cascadia Code", Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
      .table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 8px; margin-bottom: 14px; }
      table { width: 100%; min-width: 540px; border-collapse: collapse; }
      th, td { padding: 10px; border-bottom: 1px solid var(--border-subtle); text-align: left; vertical-align: top; font-size: 13px; }
      td { overflow-wrap: anywhere; }
      th { color: var(--muted-foreground); background: var(--surface-elevated); text-transform: uppercase; font-size: 11px; }
      tbody tr:hover { background: rgba(86, 214, 229, 0.035); }
      pre { max-height: 520px; overflow: auto; padding: 14px; border-radius: 8px; background: #05070B; color: var(--foreground); border: 1px solid var(--border-subtle); font: 12px/1.55 "Geist Mono", "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
      .proof-list, .turn-list { display: grid; gap: 10px; }
      .proof-card { padding: 13px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); }
      .proof-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
      .proof-text { margin-top: 8px; color: var(--muted-foreground); line-height: 1.5; }
      .turn-list { max-height: 520px; overflow: auto; }
      .turn { display: grid; grid-template-columns: minmax(100px, 150px) minmax(0, 1fr); gap: 10px; padding: 9px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); line-height: 1.45; }
      .transcript-timeline { max-height: none; }
      .transcript-timeline .turn { padding: 12px; }
      .turn.customer-turn { border-color: rgba(86, 214, 229, 0.36); background: rgba(86, 214, 229, 0.06); }
      .turn.salesperson-turn { border-color: rgba(201, 164, 92, 0.30); background: rgba(201, 164, 92, 0.055); }
      .turn.matched { border-color: rgba(86, 214, 229, 0.62); background: rgba(86, 214, 229, 0.07); }
      .speaker { color: var(--primary); font-weight: 760; }
      label { display: grid; gap: 5px; font-size: 13px; font-weight: 700; color: var(--foreground); }
      input, select, textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 9px; font: inherit; color: var(--foreground); background: var(--surface-elevated); }
      input:focus, select:focus, textarea:focus { outline: 2px solid rgba(86, 214, 229, 0.26); outline-offset: 2px; border-color: rgba(86, 214, 229, 0.62); }
      textarea { min-height: 92px; resize: vertical; }
      .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .empty { padding: 18px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted-foreground); background: var(--surface-elevated); }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
        border: 1px solid transparent;
      }
      .success { color: var(--success); background: rgba(52, 211, 153, 0.09); border-color: rgba(52, 211, 153, 0.22); }
      .warning { color: var(--warning); background: rgba(245, 158, 11, 0.10); border-color: rgba(245, 158, 11, 0.24); }
      .critical { color: var(--danger); background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.24); }
      .notice { color: var(--accent); background: rgba(86, 214, 229, 0.09); border-color: rgba(86, 214, 229, 0.22); }
      .neutral { color: var(--muted-foreground); background: rgba(138, 148, 166, 0.10); border-color: rgba(138, 148, 166, 0.18); }
      .stack { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .audit-details { border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); }
      .audit-details > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; cursor: pointer; font-weight: 760; }
      .audit-grid { display: grid; grid-template-columns: minmax(280px, 1.2fr) repeat(3, minmax(210px, 1fr)); gap: 10px; padding: 0 12px 12px; }
      .audit-section { min-width: 0; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface); }
      .audit-section h3 { margin-bottom: 9px; }
      .audit-kv { display: grid; grid-template-columns: minmax(112px, auto) minmax(0, 1fr); gap: 7px 10px; margin-bottom: 11px; }
      .audit-kv span { color: var(--muted-foreground); font-size: 12px; }
      .audit-kv strong { font-size: 12px; }
      .audit-reason { color: var(--foreground); font-size: 13px; line-height: 1.45; margin-bottom: 8px; }
      .audit-evidence { color: var(--muted-foreground); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
      .audit-list { display: grid; gap: 8px; }
      .audit-item { padding: 9px; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--surface-elevated); }
      .audit-empty { color: var(--muted-foreground); font-size: 12px; padding: 9px; border: 1px dashed var(--border); border-radius: 7px; }
      .raw-result { margin: 0 12px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: #05070B; }
      .raw-result summary { padding: 10px 12px; cursor: pointer; font-weight: 760; }
      .raw-result pre { max-height: 360px; border: 0; padding: 0 12px 12px; color: var(--muted-foreground); }
      @media (max-width: 860px) { .topbar, .call-title, .grid-2, .audit-grid { grid-template-columns: 1fr; flex-direction: column; } .form-grid, .turn { grid-template-columns: 1fr; } .call-brand { min-width: 0; width: 190px; } table { min-width: 0; table-layout: fixed; } }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div class="call-title">
          <a class="call-brand" href="/#overview"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></a>
          <div>
            <p class="page-kicker">Call proof</p>
            <h1>Call ${escapeHtml(callId)}</h1>
            <p class="muted">${call ? `Customer ID ${escapeHtml(customerIdValue(call))} | ${escapeHtml(call.salesperson)} | ${escapeHtml(formatSourceTime(call))} | ${escapeHtml(call.source)}` : "This call was not found in the current import."}</p>
          </div>
        </div>
        <a class="button-link" href="/#overview">Dashboard</a>
      </header>
      ${call ? `<section class="grid-2">
        <div class="panel">
          <h2>Classification</h2>
          ${table([
            { label: "Item", key: "item" },
            { label: "Value", key: "value" }
          ], [
            { item: "Customer ID", value: customerIdValue(call) },
            ...(contactIdValue(call) && customerIdValue(call) === "Not available" ? [{ item: "ContactId backup", value: contactIdValue(call) }] : []),
            { item: "Contact", value: `${call.contactClassification} | ${call.contactClassificationProvenance || "Deterministic"} | ${call.confidenceLabel || "Confidence unavailable"}` },
            { item: "Deterministic derived outcome", value: `${call.localOutcome} | ${call.localOutcomeProvenance || "Deterministic"}` },
            { item: "LLM review state", value: llmReviewState(intelligenceAudit || call) },
            { item: "Manager review state", value: hasManagerReview ? `${reviewStatusLabel(latestManagerReview.reviewStatus)} | Manager-reviewed` : "Unreviewed" },
            ...(latestManagerReview?.corrections?.length ? [{ item: "Manager-corrected fields", value: latestManagerReview.corrections.map((correction) => `${correction.fieldName}: ${correction.managerCorrectedValue}`).join(" | ") }] : []),
            { item: "Order history", value: call.orderHistoryLabel || (Number(call.orderCount || 0) > 0 ? "Previous Sales History" : "No Sales History") },
            { item: "Follow-up status", value: `${call.followUpStatus} | ${call.followUpProvenance || "Deterministic"}` },
            { item: "Follow-up channel", value: call.followUpChannel },
            { item: "AI assistant", value: call.aiVoiceAssistantDetected ? `${call.aiVoiceAssistantResponse || "detected"} (${Math.round(Number(call.aiVoiceAssistantConfidence || 0) * 100)}% confidence)` : "Not detected" },
            { item: "AI response", value: call.aiVoiceAssistantDetected ? call.aiVoiceAssistantBailed ? "Bailed" : call.aiVoiceAssistantHandledSuccessfully ? "Handled well" : "Partial" : "Not applicable" },
            { item: "AI tactics", value: call.aiVoiceAssistantDetected ? (call.aiVoiceAssistantTactics || []).join(", ") || "No clear tactic" : "Not applicable" },
            { item: "AI future status", value: call.aiVoiceAssistantFutureStatus ? call.aiVoiceAssistantFutureStatus.replace(/_/g, " ") : "Not applicable" },
            { item: "System audio subtype", value: call.systemAudioDetected ? call.systemAudioSubtypeLabel || call.systemAudioSubtype : "Not detected" },
            { item: "Transcript quality", value: call.transcriptQuality },
            { item: "Duration", value: `${formatNumber(call.durationSeconds)}s` }
          ])}
        </div>
        <div class="panel">
          <h2>Stable IDs Used</h2>
          ${table([
            { label: "Field", key: "field" },
            { label: "Value", render: (row) => `<span class="mono">${escapeHtml(row.value)}</span>` }
          ], call.stableIds || [], "No stable IDs were available for this call.")}
        </div>
      </section>
      <section class="panel">
        <h2>Transcript Timeline</h2>
        <p class="muted small" style="margin-bottom: 12px;">Full source transcript in detected speaker-turn order. Use this for normal reading; signal cards below are excerpts only.</p>
        ${renderTurnList(call.transcriptTurns || [], "No speaker turns were detected. Use the raw transcript below for audit.", { className: "transcript-timeline" })}
      </section>
      <section class="panel">
        <h2>Detected Signals</h2>
        <p class="muted small" style="margin-bottom: 12px;">These excerpts explain why deterministic summaries were flagged. They are not the full conversation and may repeat nearby turns for context.</p>
        ${renderEvidenceProofCards(evidenceRows)}
      </section>
      <section class="panel">
        <h2>LLM Audit Extraction</h2>
        <p class="muted small" style="margin-bottom: 12px;">Current state: ${escapeHtml(llmReviewState(intelligenceAudit || {}))}. This model extraction is separate from deterministic transcript proof and raw imported fields.</p>
        ${intelligenceAudit ? renderIntelligenceAuditDetails(intelligenceAudit) : `<div class="empty">No LLM intelligence extraction is saved for this call yet.</div>`}
      </section>
      <section class="panel">
        <h2>Source Attribution</h2>
        ${renderSourceAttributionTable(call)}
      </section>
      <section class="panel">
        <h2>Sanitized Raw Source Fields</h2>
        <p class="muted small" style="margin-bottom: 12px;">The redacted phone field is intentionally excluded. Source dates are normalized above when valid.</p>
        ${renderRawFieldTable(call.rawFields)}
      </section>
      <section class="panel">
        <h2>Raw Transcript</h2>
        <pre>${escapeHtml(call.transcript || "No transcript text available.")}</pre>
      </section>
      ${renderAiExecutionPanel(call, options)}
      <section class="grid-2">
        <div class="panel">
          <h2>Manager Review</h2>
          <p class="muted small" style="margin-bottom: 12px;">Manager review is separate from alert lifecycle. Corrections are stored as manager-reviewed overlays; raw imported, deterministic, and LLM values remain available.</p>
          <form method="post" action="/reviews">
            <input type="hidden" name="callId" value="${escapeHtml(call.callId)}" />
            <input type="hidden" name="importId" value="${escapeHtml(options.importId || "")}" />
            <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo || `/calls/${encodeURIComponent(call.callId)}`)}" />
            ${latestManagerReview ? `<input type="hidden" name="reviewId" value="${escapeHtml(latestManagerReview.reviewId)}" />` : ""}
            <input type="hidden" name="source" value="call_detail" />
            <div class="form-grid">
              <label>Review action
                <select name="action">
                  <option value="confirm">Confirm classification</option>
                  <option value="correct">Correct classification</option>
                  <option value="mark_review_needed">Mark review needed</option>
                  <option value="start_review">Start review</option>
                  <option value="dismiss">Dismiss review item</option>
                  <option value="escalate">Escalate</option>
                  <option value="reopen">Reopen</option>
                  <option value="note">Add note only</option>
                </select>
              </label>
              <label>Review scope
                <select name="reviewScope">
                  ${REVIEW_SCOPES.map((scope) => `<option value="${escapeHtml(scope)}" ${latestManagerReview?.reviewScope === scope ? "selected" : ""}>${escapeHtml(scope.replace(/_/g, " "))}</option>`).join("")}
                </select>
              </label>
              <label>Correction field
                <select name="fieldName">
                  ${correctionFieldOptions()}
                </select>
              </label>
              <label>Manager corrected value
                <input name="managerCorrectedValue" placeholder="Leave blank unless correcting a field" />
              </label>
            </div>
            <input type="hidden" name="previousDisplayValue" value="${escapeHtml(call.localOutcome || "")}" />
            <input type="hidden" name="deterministicValue" value="${escapeHtml(call.localOutcome || "")}" />
            <label style="margin-top: 10px;">Evidence assessment
              <select name="evidenceAssessment">
                <option value="">Not assessed</option>
                <option value="evidence_accepted">Evidence accepted</option>
                <option value="evidence_insufficient">Evidence insufficient</option>
                <option value="evidence_unavailable_accepted">Evidence unavailable but accepted</option>
                <option value="evidence_unavailable_rejected">Evidence unavailable and rejected</option>
              </select>
            </label>
            <label style="margin-top: 10px;">Review reason
              <input name="reviewReason" placeholder="Why is this being reviewed?" />
            </label>
            <label style="margin-top: 10px;">Manager note
              <textarea name="note" placeholder="Decision, coaching note, or correction reason"></textarea>
            </label>
            <div style="margin-top: 10px;"><button type="submit">Save Manager Review</button></div>
          </form>
        </div>
        <div class="panel">
          <h2>Review History</h2>
          ${renderReviewHistory(managerReviews)}
          <h2 style="margin-top: 16px;">Audit Trail</h2>
          ${renderReviewEventHistory(managerReviews)}
        </div>
      </section>` : `<section class="panel"><div class="empty">Use a call link from a drill-down page or the explorer.</div></section>`}
    </main>
  </body>
</html>`;
}

function renderDashboard(analysis, options = {}) {
  const sourceData = analysis || renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export.");
  const activeView = normalizeDashboardView(options.dashboardView || options.view);
  const viewMeta = DASHBOARD_VIEW_META[activeView];
  const activeSegment = normalizeBusinessSegment(options.businessSegment || options.segment);
  const data = scopedDashboardData(sourceData, activeSegment);
  const segmentLabel = businessSegmentLabel(activeSegment);
  const globalFilterQuery = data.filterState?.query || {};
  const filterQueryWithoutBusiness = { ...globalFilterQuery };
  delete filterQueryWithoutBusiness.businessSegment;
  const segmentFilters = activeSegment ? { businessSegment: activeSegment } : {};
  const workspaceAttr = (...views) => `data-dashboard-view="${views.join(" ")}"${views.includes(activeView) ? "" : " hidden"}`;
  const workspaceHref = (view, hash = "") => dashboardFilterUrl({
    ...globalFilterQuery,
    ...segmentFilters,
    view: normalizeDashboardView(view)
  }, hash);
  const withSegment = (filters = {}) => ({ ...globalFilterQuery, ...filters, ...segmentFilters });
  const dashboardSegmentHref = (segment = "") => dashboardFilterUrl({
    ...filterQueryWithoutBusiness,
    view: activeView,
    ...(segment ? { businessSegment: segment } : {})
  }, "business-split");
  const activeIntelligenceQueue = String(options.intelligenceQueue || "waste").trim() || "waste";
  const intelligenceFilterBase = {
    ...globalFilterQuery,
    ...segmentFilters,
    intelligenceQueue: activeIntelligenceQueue
  };
  const hasAnyData = Boolean(analysis && analysis.totals && (data.filterSummary?.totalRecords || data.totals.uniqueCalls));
  const hasData = Boolean(analysis && analysis.totals && data.totals.uniqueCalls);
  const persistence = data.persistence || renderEmptyState("").persistence;
  const alertSummary = data.alertLifecycleSummary || persistence.alertLifecycleSummary || { bySeverity: {}, byStatus: {} };
  const criticalAlerts = alertSummary.bySeverity?.critical ?? data.alerts.filter((alert) => alert.severity === "critical").length;
  const warningAlerts = alertSummary.bySeverity?.warning ?? data.alerts.filter((alert) => alert.severity === "warning").length;
  const noticeAlerts = alertSummary.bySeverity?.notice ?? data.alerts.filter((alert) => alert.severity === "notice").length;
  const reviewedIds = managerReviewedCallIds(persistence);
  const reviewSummaryMap = managerReviewSummaryMap(persistence);
  const leadUtilization = data.leadUtilization || { totals: {} };
  const leadTotals = leadUtilization.totals || {};
  const intelligence = data.intelligence || { totals: {}, salespeople: [], sources: [] };
  const intelligenceTotals = intelligence.totals || {};

  const salespersonRows = data.salespersonScorecards.slice(0, 18);
  const sourceRows = data.sourceMetrics.slice(0, 14);
  const sourceQuality = data.sourceQuality || renderEmptyState("").sourceQuality;
  const sourceQualityTotals = sourceQuality.totals || {};
  const sourceQualitySourceRows = (sourceQuality.sourceRows || []).slice(0, 14);
  const sourceQualityCreatorRows = (sourceQuality.creatorRows || []).slice(0, 12);
  const sourceQualityTypeRows = (sourceQuality.createdByTypeRows || []).slice(0, 6);
  const sourceQualityAgeRows = (sourceQuality.recordAgeBuckets || sourceQuality.importAgeBuckets || []).slice(0, 8);
  const sourceQualityThresholdRows = sourceQuality.newBusinessRecordAgeThresholds || sourceQuality.newBusinessImportAgeThresholds || [];
  const sourceQualityWorstSource = sourceQuality.lowestHumanAnswerSource || null;
  const aiVoiceAssistant = data.aiVoiceAssistant || renderEmptyState("").aiVoiceAssistant;
  const aiAssistantTotals = aiVoiceAssistant.totals || {};
  const aiAssistantTrendRows = (aiVoiceAssistant.trendRows || []).slice(-12);
  const aiAssistantSalespersonRows = (aiVoiceAssistant.salespersonRows || []).slice(0, 12);
  const aiAssistantTacticRows = (aiVoiceAssistant.tacticRows || []).slice(0, 10);
  const aiAssistantLatestRows = (aiVoiceAssistant.latestRows || []).slice(0, 12);
  const aiAssistantTopTactic = aiVoiceAssistant.topSuccessTactic || null;
  const systemAudio = data.systemAudio || renderEmptyState("").systemAudio;
  const systemAudioTotals = systemAudio.totals || {};
  const systemAudioSubtypeRows = (systemAudio.subtypeRows || []).slice(0, 8);
  const systemAudioSalespersonRows = (systemAudio.salespersonRows || []).slice(0, 12);
  const systemAudioSourceRows = (systemAudio.sourceRows || []).slice(0, 10);
  const systemAudioTrendRows = (systemAudio.trendRows || []).slice(-12);
  const systemAudioLatestRows = (systemAudio.latestRows || []).slice(0, 12);
  const leadReattempt = data.leadReattempt || renderEmptyState("").leadReattempt;
  const leadReattemptTotals = leadReattempt.totals || {};
  const leadReattemptSalespersonRows = (leadReattempt.salespersonRows || []).slice(0, 18);
  const leadReattemptHighestRows = (leadReattempt.highestRetrySalespeople || []).slice(0, 10);
  const leadReattemptRiskRows = (leadReattempt.highestUnderUtilizationSalespeople || leadReattempt.highestOneDialRiskSalespeople || leadReattempt.lowestRetrySalespeople || []).slice(0, 10);
  const leadReattemptSourceRows = (leadReattempt.sourceRows || []).slice(0, 12);
  const leadReattemptRegionRows = (leadReattempt.regionRows || []).slice(0, 12);
  const leadReattemptSegmentRows = leadReattempt.businessSegmentRows || [];
  const leadHarvest = data.leadHarvest || renderEmptyState("").leadHarvest;
  const leadHarvestTotals = leadHarvest.totals || {};
  const leadHarvestSalespersonRows = (leadHarvest.salespersonRows || []).slice(0, 14);
  const leadHarvestSourceRows = (leadHarvest.sourceRows || []).slice(0, 10);
  const leadHarvestObjectionRows = (leadHarvest.objectionRows || []).slice(0, 8);
  const leadHarvestHandlingRows = (leadHarvest.handlingRows || []).slice(0, 8);
  const leadHarvestScopeSegment = activeSegment || "new";
  const leadHarvestScopeLabel = activeSegment ? segmentLabel : "New Business";
  const leadHarvestScopeFilters = withSegment({ businessSegment: leadHarvestScopeSegment });
  const leadHarvestCandidateMetric = leadHarvestScopeSegment === "warm" ? "harvest.warmBusinessCandidates" : "harvest.newBusinessCandidates";
  const leadHarvestScopeIsDefaultNew = leadHarvestScopeSegment === "new";
  const leadHarvestCandidateCalls = leadHarvestScopeIsDefaultNew ? leadHarvestTotals.newBusinessCandidateCalls || 0 : leadHarvestTotals.candidateCalls || 0;
  const leadHarvestOpenNoLater = leadHarvestScopeIsDefaultNew ? leadHarvestTotals.openNewBusinessCandidates || 0 : leadHarvestTotals.openCandidates || 0;
  const leadHarvestMatchingUnavailable = leadHarvestScopeIsDefaultNew ? leadHarvestTotals.newBusinessMatchingUnavailable || 0 : leadHarvestTotals.matchingUnavailable || 0;
  const leadHarvestLaterObserved = leadHarvestScopeIsDefaultNew ? leadHarvestTotals.newBusinessLaterMatchingCallObserved || 0 : leadHarvestTotals.laterMatchingCallObserved || 0;
  const leadHarvestQueueCount = leadHarvestOpenNoLater + leadHarvestMatchingUnavailable;
  const leadHarvestLatestRows = (leadHarvest.latestRows || leadHarvest.records || [])
    .filter((row) => row.businessSegment === leadHarvestScopeSegment)
    .slice(0, 18);
  const leadHarvestNewestUrl = drilldownUrl("harvest.reviewQueue", { ...leadHarvestScopeFilters, limit: 250, sort: "newest" });
  const leadHarvestOldestUrl = drilldownUrl("harvest.reviewQueue", { ...leadHarvestScopeFilters, limit: 250, sort: "oldest" });
  const leadHarvestAllUrl = drilldownUrl("harvest.reviewQueue", { ...leadHarvestScopeFilters, limit: Math.max(leadHarvestQueueCount || 1, 250), sort: "oldest" });
  const leadHarvestHighPriorityCount = (leadHarvest.records || [])
    .filter((row) => row.businessSegment === leadHarvestScopeSegment && row.reviewPriority === "high")
    .length || (leadHarvestScopeIsDefaultNew ? Number(leadHarvestTotals.highPriorityNewBusiness || 0) : 0);
  const leadHarvestScopedCandidates = (row) => leadHarvestScopeSegment === "new"
    ? Number(row.newBusinessCandidateCalls || 0)
    : leadHarvestScopeSegment === "warm"
      ? Number(row.warmBusinessCandidateCalls || 0)
      : Number(row.candidateCalls || 0);
  const leadHarvestScopedOpen = (row) => leadHarvestScopeSegment === "new"
    ? Number(row.newBusinessOpenCandidates || 0)
    : leadHarvestScopeSegment === "warm"
      ? Number(row.warmBusinessOpenCandidates || 0)
      : Number(row.openCandidates || 0);
  const leadHarvestScopedLater = (row) => leadHarvestScopeSegment === "new"
    ? Number(row.newBusinessLaterMatchingCallObserved || 0)
    : leadHarvestScopeSegment === "warm"
      ? Number(row.warmBusinessLaterMatchingCallObserved || 0)
      : Number(row.laterMatchingCallObserved || 0);
  const leadHarvestScopedUnavailable = (row) => leadHarvestScopeSegment === "new"
    ? Number(row.newBusinessMatchingUnavailable || 0)
    : leadHarvestScopeSegment === "warm"
      ? Number(row.warmBusinessMatchingUnavailable || 0)
      : Number(row.matchingUnavailable || 0);
  const intelligenceSalespersonRows = (intelligence.salespeople || []).slice(0, 10);
  const intelligenceSourceRows = (intelligence.sources || []).slice(0, 10);
  const intelligenceQueueRows = options.intelligenceCalls || [];
  const alertRows = data.alerts.slice(0, 30);
  const reviewRows = data.reviewQueue.slice(0, 30);
  const explorerRows = data.explorerRows.slice(0, 60);
  const importRows = persistence.importHistory.slice(0, 10);
  const reportRows = persistence.reports.slice(0, 10);
  const uniqueCalls = Number(data.totals.uniqueCalls || 0);
  const transcriptCoverage = Number(data.rates.transcriptCoverage || 0);
  const liveHumanRate = Number(data.rates.probableLiveHuman || 0);
  const meaningfulRate = Number(data.rates.meaningfulConversation || 0);
  const followUpRate = Number(data.rates.followUpRequired || 0);
  const aiAssistantEncounterRate = Number(data.rates.aiVoiceAssistantEncounter || aiAssistantTotals.encounterRate || 0);
  const aiAssistantBailRate = Number(data.rates.aiVoiceAssistantBail || aiAssistantTotals.bailRate || 0);
  const aiAssistantHandledRate = Number(data.rates.aiVoiceAssistantHandled || aiAssistantTotals.handledRate || 0);
  const aiAssistantFutureHumanRate = Number(data.rates.aiVoiceAssistantFutureHuman || aiAssistantTotals.futureHumanContactRate || 0);
  const riskReviewRate = percentOf(data.totals.riskReviews, uniqueCalls);
  const leadRiskRate = Number(leadReattemptTotals.oneDialNoContactNoLaterRate || 0);
  const totalUniqueCalls = Number(sourceData.totals.uniqueCalls || 0);
  const warmBusinessCalls = Number(sourceData.totals.warmBusinessCalls || 0);
  const newBusinessCalls = Number(sourceData.totals.newBusinessCalls || Math.max(0, totalUniqueCalls - warmBusinessCalls));
  const warmBusinessRate = Number(sourceData.rates.warmBusiness || percentOf(warmBusinessCalls, totalUniqueCalls));
  const newBusinessRate = Number(sourceData.rates.newBusiness || percentOf(newBusinessCalls, totalUniqueCalls));
  const sourceAge90 = sourceQualityThresholdRows.find((row) => Number(row.thresholdDays) === 90) || { thresholdDays: 90, calls: 0, rate: 0 };
  const scopeNote = activeSegment
    ? `${segmentLabel} results only. Click All Business to return to the full dashboard.`
    : "All calls are included. Click New Business or Warm Business to scope the results below.";
  const alertReturnTo = workspaceHref("reviews", "alerts");
  const queueFilterUrl = (filters = {}) => dashboardFilterUrl({
    ...globalFilterQuery,
    ...segmentFilters,
    view: activeView,
    intelligenceQueue: activeIntelligenceQueue,
    ...filters
  }, "intelligence-queue");
  const managerReviewNeededCount = Number(data.managerReviewGovernance?.reviewNeededCalls || persistence.counts?.currentManagerReviewNeededCalls || reviewRows.length || 0);
  const activeAlertCount = Number(alertSummary.active || persistence.counts.currentAlertEvents || 0);
  const sectionLinksByView = {
    overview: [["overview", "Overview"], ["dataset-context", "Dataset"], ["filters", "Filters"], ["business-split", "Business split"], ["attention", "Needs attention"]],
    harvest: [["lead-harvest", "Review queue"], ["harvest-objections", "Objections"], ["harvest-evidence", "Evidence"]],
    follow_up: [["lead-reattempts", "Reattempts"], ["lead-utilization", "Follow-up proof"]],
    reviews: [["alerts", "Alerts & reviews"]],
    team: [["salespeople", "Salespeople"], ["sources", "Sources"], ["source-quality", "Source quality"], ["ai-assistants", "AI assistants"], ["system-audio", "System audio"]],
    intelligence: [["provenance", "Provenance"], ["evaluation-results", "Evaluation results"], ["intelligence", "Call intelligence"], ["intelligence-queue", "Evidence queue"]],
    records: [["explorer", "Call explorer"], ["confidence", "Data confidence"], ["history", "Imports"], ["reports", "Reports"]]
  };
  const currentSectionLinks = sectionLinksByView[activeView] || sectionLinksByView.overview;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Dashboard</title>
    <style>
      ${COLUMN_HELP_STYLES}
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      :root {
        --background: #080A0F;
        --surface: #0D1117;
        --surface-elevated: #131A24;
        --surface-soft: #182131;
        --border: #263244;
        --border-subtle: #1D2735;
        --foreground: #F4F7FB;
        --muted-foreground: #8A94A6;
        --primary: #C9A45C;
        --accent: #56D6E5;
        --success: #34D399;
        --warning: #F59E0B;
        --danger: #F87171;
        --chart-1: #C9A45C;
        --chart-2: #56D6E5;
        --chart-3: #34D399;
        --chart-4: #8B5CF6;
        --chart-5: #F87171;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
        --soft-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      .layout {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 272px minmax(0, 1fr);
        width: 100%;
        max-width: 100vw;
        overflow-x: hidden;
      }
      aside {
        padding: 24px 18px;
        background: var(--surface);
        border-right: 1px solid var(--border-subtle);
        position: sticky;
        top: 0;
        height: 100vh;
        min-width: 0;
        max-width: 100%;
        overflow-y: auto;
      }
      .brand {
        display: grid;
        gap: 12px;
        margin-bottom: 22px;
      }
      .brand-logo {
        width: 100%;
        min-height: 48px;
        display: flex;
        align-items: center;
      }
      .brand-logo img {
        display: block;
        width: min(210px, 100%);
        height: auto;
      }
      .brand-title {
        color: var(--foreground);
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .brand-subtitle {
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.45;
        margin-top: 4px;
      }
      .brand-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .logo-upload input {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .upload-button {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 6px 9px;
        border-radius: 6px;
        border: 1px solid var(--border);
        color: var(--foreground);
        background: var(--surface-elevated);
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
      }
      .upload-button:hover {
        border-color: rgba(86, 214, 229, 0.65);
        color: var(--accent);
      }
      .file-inline-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 7px 10px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: rgba(86, 214, 229, 0.08);
        color: var(--accent);
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
      }
      .file-inline-control input {
        max-width: 190px;
        color: var(--muted-foreground);
        font-size: 12px;
      }
      .brand-status {
        color: var(--muted-foreground);
        font-size: 12px;
      }
      .product-switcher {
        display: grid;
        gap: 6px;
        margin-bottom: 14px;
        padding: 8px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--background);
      }
      .product-switcher a {
        min-height: 34px;
        display: flex;
        align-items: center;
        padding: 7px 9px;
        border-radius: 6px;
        color: var(--muted-foreground);
        font-size: 13px;
        font-weight: 750;
        text-decoration: none;
      }
      .product-switcher a.active {
        color: var(--foreground);
        background: var(--surface-elevated);
        border: 1px solid var(--border);
      }
      .brand-settings {
        border: 0;
        margin-top: -4px;
      }
      .brand-settings summary {
        padding: 7px 0;
        color: var(--muted-foreground);
        font-size: 12px;
      }
      aside nav {
        display: grid;
        gap: 4px;
        min-width: 0;
        max-width: 100%;
        padding-top: 14px;
        border-top: 1px solid var(--border-subtle);
        scrollbar-width: none;
      }
      aside nav::-webkit-scrollbar { display: none; }
      aside nav a {
        color: var(--muted-foreground);
        text-decoration: none;
        padding: 9px 10px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
      }
      aside nav a:hover,
      aside nav a.active {
        color: var(--foreground);
        background: var(--surface-elevated);
      }
      aside nav a.active {
        border-left: 2px solid var(--accent);
        padding-left: 8px;
      }
      .nav-label {
        margin: 12px 10px 4px;
        color: var(--muted-foreground);
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }
      main {
        padding: 28px;
        display: grid;
        gap: 18px;
        align-content: start;
        min-width: 0;
      }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 31px; line-height: 1.08; font-weight: 800; }
      h2 { font-size: 17px; font-weight: 750; }
      h3 { font-size: 14px; font-weight: 750; }
      .topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .page-kicker {
        color: var(--primary);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .section-kicker {
        color: var(--accent);
        font-size: 10px;
        font-weight: 800;
        margin-bottom: 5px;
        text-transform: uppercase;
      }
      .workspace-tabs {
        display: none;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 14px;
      }
      .workspace-tabs a {
        min-height: 34px;
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--muted-foreground);
        background: var(--surface);
        font-size: 12px;
        font-weight: 750;
        text-decoration: none;
      }
      .workspace-tabs a.active {
        color: var(--foreground);
        border-color: rgba(86, 214, 229, 0.52);
        background: rgba(86, 214, 229, 0.08);
      }
      .muted { color: var(--muted-foreground); }
      .small { font-size: 13px; }
      .stack {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
        white-space: nowrap;
        border: 1px solid transparent;
      }
      .success { color: var(--success); background: rgba(52, 211, 153, 0.09); border-color: rgba(52, 211, 153, 0.22); }
      .warning { color: var(--warning); background: rgba(245, 158, 11, 0.10); border-color: rgba(245, 158, 11, 0.24); }
      .critical { color: var(--danger); background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.24); }
      .notice { color: var(--accent); background: rgba(86, 214, 229, 0.09); border-color: rgba(86, 214, 229, 0.22); }
      .neutral { color: var(--muted-foreground); background: rgba(138, 148, 166, 0.10); border-color: rgba(138, 148, 166, 0.18); }
      .command-grid {
        display: grid;
        grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.55fr);
        gap: 14px;
        min-width: 0;
      }
      .command-panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
      }
      .command-panel.primary {
        background: var(--surface-elevated);
      }
      .command-panel-inner {
        padding: 18px;
      }
      .command-value {
        font-size: 44px;
        line-height: 0.95;
        font-weight: 800;
        margin-top: 14px;
      }
      .command-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .dataset-context .panel-header {
        align-items: flex-start;
      }
      .dataset-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 10px;
      }
      .dataset-grid-primary {
        grid-template-columns: 1fr 0.8fr 1.8fr 1.1fr;
      }
      .dataset-fact {
        min-width: 0;
        padding: 11px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .dataset-fact span {
        display: block;
        color: var(--muted-foreground);
        font-size: 11px;
        font-weight: 750;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .dataset-fact strong {
        display: block;
        overflow-wrap: anywhere;
        color: var(--foreground);
        font-size: 13px;
        line-height: 1.35;
      }
      .context-details {
        margin-top: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .context-details summary {
        padding: 10px 12px;
        color: var(--muted-foreground);
        font-size: 12px;
      }
      .context-details-grid { padding: 0 12px 12px; }
      .filter-panel .panel-body {
        display: grid;
        gap: 12px;
      }
      .filter-form {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 10px;
        align-items: end;
      }
      .filter-form.advanced {
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        padding: 12px 0 0;
      }
      .studio-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;
        min-width: 0;
        max-width: 100%;
      }
      .studio-form textarea,
      .studio-form button {
        grid-column: 1 / -1;
      }
      .studio-form input,
      .studio-form select,
      .studio-form textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--foreground);
        background: var(--surface-elevated);
        padding: 8px 9px;
        font: inherit;
      }
      .filter-control {
        display: grid;
        gap: 6px;
        color: var(--muted-foreground);
        font-size: 12px;
        font-weight: 750;
        text-transform: uppercase;
      }
      .filter-control input,
      .filter-control select {
        width: 100%;
        min-height: 36px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--foreground);
        background: var(--surface-elevated);
        padding: 8px 9px;
        font: inherit;
        text-transform: none;
      }
      .active-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .filter-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 5px 9px;
        border-radius: 999px;
        border: 1px solid rgba(86, 214, 229, 0.30);
        background: rgba(86, 214, 229, 0.08);
        color: var(--foreground);
        font-size: 12px;
        font-weight: 750;
        text-decoration: none;
      }
      .filter-chip strong {
        color: var(--muted-foreground);
      }
      .filter-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .filter-actions button {
        min-height: 36px;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid rgba(86, 214, 229, 0.45);
        color: var(--foreground);
        background: var(--surface-elevated);
        font: inherit;
        font-weight: 760;
        cursor: pointer;
      }
      .bulk-alert-form {
        display: grid;
        gap: 10px;
        margin: 12px 0;
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .bulk-alert-form textarea,
      .alert-note-form textarea {
        width: 100%;
        min-height: 54px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--foreground);
        background: var(--surface-elevated);
        padding: 8px 9px;
        font: inherit;
        resize: vertical;
      }
      .alert-summary {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      .alert-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .inline-alert-form {
        display: inline;
      }
      .inline-alert-form button,
      .alert-note-form button {
        min-height: 30px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(86, 214, 229, 0.36);
        color: var(--foreground);
        background: var(--surface-elevated);
        font: inherit;
        font-size: 12px;
        font-weight: 740;
        cursor: pointer;
      }
      .alert-note-form {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }
      .table-checkbox {
        width: 18px;
        height: 18px;
      }
      .filter-advanced {
        grid-column: 1 / -1;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .filter-advanced summary {
        padding: 10px 12px;
      }
      .filtered-no-data-body {
        display: none;
      }
      .window-warnings {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .window-warning {
        padding: 11px;
        border: 1px solid var(--border-subtle);
        border-left: 3px solid var(--accent);
        border-radius: 8px;
        background: var(--surface);
      }
      .window-warning.warning { border-left-color: var(--warning); }
      .window-warning.critical { border-left-color: var(--danger); }
      .window-warning strong {
        display: block;
        margin-bottom: 5px;
        color: var(--foreground);
        font-size: 13px;
        text-transform: capitalize;
      }
      .mini-stat {
        padding: 10px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .mini-stat span {
        display: block;
        color: var(--muted-foreground);
        font-size: 11px;
        margin-bottom: 5px;
        text-transform: uppercase;
      }
      .mini-stat strong {
        color: var(--foreground);
        font-size: 14px;
      }
      .pipeline {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .pipeline-row {
        display: grid;
        grid-template-columns: minmax(130px, 0.9fr) minmax(120px, 1.3fr) minmax(58px, auto);
        gap: 10px;
        align-items: center;
        min-height: 28px;
        color: inherit;
        text-decoration: none;
      }
      .pipeline-row:hover .pipeline-label {
        color: var(--accent);
      }
      .pipeline-label {
        color: var(--muted-foreground);
        font-size: 13px;
      }
      .pipeline-track {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--surface-soft);
        border: 1px solid var(--border-subtle);
      }
      .pipeline-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--primary);
      }
      .pipeline-fill.primary { background: var(--primary); }
      .pipeline-fill.accent { background: var(--accent); }
      .pipeline-fill.success { background: var(--success); }
      .pipeline-fill.warning { background: var(--warning); }
      .pipeline-fill.danger { background: var(--danger); }
      .pipeline-value {
        color: var(--foreground);
        text-align: right;
      }
      .segment-split {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .segment-card {
        padding: 14px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
        color: inherit;
        text-decoration: none;
        transition: border-color 140ms ease, background 140ms ease;
      }
      .segment-card:hover {
        border-color: rgba(86, 214, 229, 0.45);
        background: var(--surface-soft);
      }
      .segment-card.selected {
        border-color: rgba(201, 164, 92, 0.72);
        background: linear-gradient(180deg, rgba(201, 164, 92, 0.12), rgba(19, 26, 36, 1));
      }
      .segment-card span {
        display: block;
        color: var(--muted-foreground);
        font-size: 12px;
        font-weight: 750;
        text-transform: uppercase;
      }
      .segment-card strong {
        display: block;
        margin-top: 8px;
        font-size: 32px;
        line-height: 1;
        font-weight: 850;
      }
      .segment-card small {
        display: block;
        color: var(--muted-foreground);
        margin-top: 9px;
        line-height: 1.4;
      }
      .segment-card.accent { border-top: 3px solid var(--accent); }
      .segment-card.primary { border-top: 3px solid var(--primary); }
      .segment-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
      }
      .segment-track {
        grid-column: 1 / -1;
        display: flex;
        height: 12px;
        overflow: hidden;
        border: 1px solid var(--border-subtle);
        border-radius: 999px;
        background: var(--surface-soft);
      }
      .segment-fill {
        display: block;
        height: 100%;
      }
      .segment-fill.new { background: var(--accent); }
      .segment-fill.warm { background: var(--primary); }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 12px;
      }
      .attention-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 12px;
      }
      .attention-item {
        min-width: 0;
        display: grid;
        gap: 7px;
        padding: 14px;
        border: 1px solid var(--border-subtle);
        border-left: 3px solid var(--accent);
        border-radius: 8px;
        color: inherit;
        background: var(--surface-elevated);
        text-decoration: none;
      }
      .attention-item.warning { border-left-color: var(--warning); }
      .attention-item.danger { border-left-color: var(--danger); }
      .attention-item.success { border-left-color: var(--success); }
      .attention-item span { color: var(--muted-foreground); font-size: 12px; font-weight: 750; text-transform: uppercase; }
      .attention-item strong { color: var(--foreground); font-size: 25px; }
      .attention-item small { color: var(--muted-foreground); line-height: 1.4; }
      .attention-item:hover { border-color: rgba(86, 214, 229, 0.48); background: var(--surface-soft); }
      .metric, .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
      }
      .metric {
        padding: 15px;
        min-height: 116px;
        color: inherit;
        text-decoration: none;
        display: block;
        transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
      }
      a.metric:hover, .data-link:hover, .open-link:hover {
        outline: 2px solid rgba(86, 214, 229, 0.24);
        outline-offset: 2px;
      }
      a.metric:hover {
        border-color: rgba(86, 214, 229, 0.45);
        background: var(--surface-elevated);
        transform: translateY(-1px);
      }
      .metric-label {
        color: var(--muted-foreground);
        font-size: 13px;
        margin-bottom: 12px;
      }
      .metric-value {
        font-size: 29px;
        line-height: 1;
        font-weight: 850;
      }
      .metric-detail {
        color: var(--muted-foreground);
        font-size: 13px;
        margin-top: 10px;
      }
      .metric.good { border-top: 3px solid var(--success); }
      .metric.warn { border-top: 3px solid var(--warning); }
      .metric.risk { border-top: 3px solid var(--danger); }
      .metric.info { border-top: 3px solid var(--accent); }
      .panel-header {
        padding: 15px 17px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .panel-body { padding: 17px; }
      .grid-2 {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
        min-width: 0;
      }
      .workspace-flow { display: contents; }
      .grid-2 > *,
      .guardrails > *,
      .audit-grid > * {
        min-width: 0;
      }
      .guardrails {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .note {
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .note h3 { margin-bottom: 6px; }
      .empty {
        padding: 18px;
        border: 1px dashed var(--border);
        border-radius: 8px;
        color: var(--muted-foreground);
        background: var(--surface-elevated);
      }
      .table-wrap {
        max-width: 100%;
        overflow-x: auto;
        border-top: 1px solid var(--border-subtle);
      }
      table {
        width: 100%;
        min-width: 780px;
        border-collapse: collapse;
      }
      th, td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--border-subtle);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted-foreground);
        text-transform: uppercase;
        font-size: 11px;
        background: var(--surface-elevated);
      }
      tbody tr:hover { background: rgba(86, 214, 229, 0.035); }
      td strong { color: var(--foreground); }
      .evidence, .evidence-summary { display: block; max-width: 300px; color: var(--muted-foreground); line-height: 1.4; }
      .proof-link { display: block; margin-top: 5px; color: var(--accent); font-size: 12px; font-weight: 760; text-decoration: none; }
      .mono {
        font-family: "Geist Mono", "Cascadia Code", Consolas, monospace;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .metric-value, .command-value, td:nth-child(n+2) { font-variant-numeric: tabular-nums; }
      .data-link, .open-link, .filter-link {
        color: var(--accent);
        font-weight: 760;
        text-decoration: none;
      }
      .data-link {
        border-bottom: 1px solid rgba(86, 214, 229, 0.32);
      }
      .filter-link {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 6px;
        background: var(--surface-elevated);
        border: 1px solid var(--border);
      }
      .filter-link:hover {
        color: var(--foreground);
        border-color: rgba(86, 214, 229, 0.58);
      }
      .filter-link.selected {
        color: var(--primary);
        border-color: rgba(201, 164, 92, 0.58);
        background: rgba(201, 164, 92, 0.10);
      }
      details {
        border-top: 1px solid var(--border-subtle);
      }
      summary {
        cursor: pointer;
        padding: 13px 17px;
        font-weight: 760;
      }
      pre {
        margin: 0;
        padding: 0 17px 17px;
        white-space: pre-wrap;
        font: 12px/1.55 "Geist Mono", "Cascadia Code", Consolas, monospace;
        color: var(--muted-foreground);
      }
      .audit-table-wrap { border-top: 1px solid var(--border-subtle); }
      .audit-table { min-width: 1040px; }
      .audit-row td {
        padding: 0;
        background: var(--surface);
      }
      .audit-row:hover { background: transparent; }
      .audit-details {
        border-top: 0;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--surface);
      }
      .audit-details > summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 11px 14px;
        color: var(--foreground);
      }
      .audit-grid {
        display: grid;
        grid-template-columns: minmax(280px, 1.2fr) repeat(3, minmax(210px, 1fr));
        gap: 10px;
        padding: 0 14px 14px;
      }
      .audit-section {
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .audit-section h3 {
        margin-bottom: 9px;
        color: var(--foreground);
      }
      .audit-kv {
        display: grid;
        grid-template-columns: minmax(112px, auto) minmax(0, 1fr);
        gap: 7px 10px;
        margin-bottom: 11px;
      }
      .audit-kv span {
        color: var(--muted-foreground);
        font-size: 12px;
      }
      .audit-kv strong { font-size: 12px; }
      .audit-reason {
        color: var(--foreground);
        font-size: 13px;
        line-height: 1.45;
        margin-bottom: 8px;
      }
      .audit-evidence {
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      .audit-list {
        display: grid;
        gap: 8px;
      }
      .audit-item {
        padding: 9px;
        border: 1px solid var(--border-subtle);
        border-radius: 7px;
        background: var(--surface);
      }
      .audit-empty {
        color: var(--muted-foreground);
        font-size: 12px;
        padding: 9px;
        border: 1px dashed var(--border);
        border-radius: 7px;
      }
      .raw-result {
        margin: 0 14px 14px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: #05070B;
      }
      .raw-result summary { padding: 10px 12px; }
      .raw-result pre {
        max-height: 360px;
        overflow: auto;
        padding: 0 12px 12px;
        color: var(--muted-foreground);
      }
      @media (max-width: 1080px) {
        .layout { grid-template-columns: minmax(0, 1fr); }
        aside {
          position: static;
          height: auto;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
        }
        .brand { margin-bottom: 0; }
        .brand-logo img { width: min(190px, 48vw); }
        aside nav { display: none; }
        .product-switcher { grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; }
        .brand-settings { display: none; }
        .workspace-tabs { display: flex; }
        .command-grid { grid-template-columns: 1fr; }
        .metrics, .attention-grid, .filter-form, .filter-form.advanced { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .dataset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-2, .guardrails, .audit-grid, .window-warnings { grid-template-columns: 1fr; }
        .command-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { padding: 16px; }
        .topbar, .panel-header, aside { flex-direction: column; align-items: stretch; }
        .product-switcher { width: 100%; }
        .workspace-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .metrics, .attention-grid, .dataset-grid, .dataset-grid-primary, .filter-form, .filter-form.advanced, .studio-form { grid-template-columns: 1fr; }
        .segment-split { grid-template-columns: 1fr; }
        .command-meta, .pipeline-row { grid-template-columns: 1fr; }
        .pipeline-value { text-align: left; }
      }
    </style>
  </head>
  <body data-dashboard-view="${escapeHtml(activeView)}">
    <div class="layout">
      <aside>
        <div class="brand">
          <div class="brand-logo"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></div>
          <div>
            <div class="brand-title">Sales Dashboard</div>
            <p class="brand-subtitle">Manager reporting, lead utilisation, and call evidence.</p>
          </div>
          <details class="brand-settings">
            <summary>Branding settings</summary>
            <div class="brand-tools">
              <label class="logo-upload">
                <span class="upload-button">Upload logo</span>
                <input data-logo-input type="file" accept="image/png,image/jpeg,image/webp" />
              </label>
              <span class="brand-status" data-logo-status></span>
            </div>
          </details>
        </div>
        <div class="product-switcher" aria-label="Product areas">
          <a class="active" href="${escapeHtml(workspaceHref(activeView, "overview"))}" aria-current="page">Sales Dashboard</a>
          <a href="/evaluation-studio">Evaluation Studio</a>
        </div>
        <nav aria-label="Sales Dashboard workspaces">
          <span class="nav-label">Workspaces</span>
          ${Object.entries(DASHBOARD_VIEW_META).map(([key, meta]) => `<a class="${key === activeView ? "active" : ""}" href="${escapeHtml(workspaceHref(key, key === "overview" ? "overview" : ""))}" ${key === activeView ? 'aria-current="page"' : ""}>${escapeHtml(meta.label)}</a>`).join("")}
          <span class="nav-label">On this page</span>
          ${currentSectionLinks.map(([id, label]) => `<a href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`).join("")}
        </nav>
      </aside>
      <main>
        <header class="topbar" id="overview">
          <div>
            <p class="page-kicker">${escapeHtml(viewMeta.kicker)}</p>
            <h1>${escapeHtml(viewMeta.title)}</h1>
            <p class="muted">${escapeHtml(viewMeta.description)}</p>
            <nav class="workspace-tabs" aria-label="Sales Dashboard workspaces">
              ${Object.entries(DASHBOARD_VIEW_META).map(([key, meta]) => `<a class="${key === activeView ? "active" : ""}" href="${escapeHtml(workspaceHref(key))}" ${key === activeView ? 'aria-current="page"' : ""}>${escapeHtml(meta.label)}</a>`).join("")}
            </nav>
          </div>
          <div class="stack">
            ${hasAnyData ? badge("CSV loaded", "success") : badge("No CSV loaded", "warning")}
            ${activeSegment ? badge(`${segmentLabel} view`, "notice") : ""}
            ${badge(formatDateRange(data.dateRange), "neutral")}
          </div>
        </header>

        ${renderDatasetBanner(sourceData, persistence)}

        ${hasAnyData ? renderGlobalFilters(data, { dashboardView: activeView }) : ""}

        ${["overview", "intelligence"].includes(activeView) ? renderProcessingStatePanel(data, persistence, intelligenceTotals) : ""}

        <div class="workspace-flow" ${workspaceAttr("intelligence")}>
          ${renderEvaluationStudioDashboardSummary(persistence)}
        </div>

        ${!hasAnyData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}
        ${hasAnyData && !hasData ? `<section class="panel"><div class="panel-body"><div class="empty">No calls match the selected filters. Clear filters or broaden the date range before interpreting performance.</div></div></section>` : ""}

        <div class="${hasAnyData && !hasData ? "filtered-no-data-body" : ""}">
        <section class="command-grid" aria-label="Executive command overview" ${workspaceAttr("overview")}>
          <article class="command-panel primary">
            <div class="command-panel-inner">
              <p class="page-kicker">Primary operating signal</p>
              <h2>Conversation Quality</h2>
              <div class="command-value mono">${formatPercent(meaningfulRate)}</div>
              <p class="muted small" style="margin-top: 10px;">${formatNumber(data.totals.meaningfulConversation)} deterministic meaningful-conversation signals from ${formatNumber(uniqueCalls)} unique calls.</p>
              <div class="command-meta">
                <div class="mini-stat"><span>Live-human</span><strong class="mono">${formatPercent(liveHumanRate)}</strong></div>
                <div class="mini-stat"><span>Follow-up</span><strong class="mono">${formatNumber(data.totals.followUpRequired)}</strong></div>
                <div class="mini-stat"><span>Risk review</span><strong class="mono">${formatNumber(data.totals.riskReviews)}</strong></div>
              </div>
            </div>
          </article>
          <article class="command-panel">
            <div class="panel-header">
              <div>
                <h2>Conversation Pipeline</h2>
                <p class="muted small">Supported call and lead-readiness metrics only; revenue fields are not inferred.</p>
              </div>
              ${badge(`${formatNumber(data.totals.salespeople || 0)} salespeople`, "neutral")}
            </div>
            <div class="command-panel-inner">
              <div class="pipeline">
                ${pipelineBar("Unique calls", formatNumber(uniqueCalls), 100, "primary", drilldownUrl("calls.unique", withSegment()))}
                ${pipelineBar("New business", `${formatNumber(newBusinessCalls)} (${formatPercent(newBusinessRate)})`, newBusinessRate, "accent", dashboardSegmentHref("new"))}
                ${pipelineBar("Warm business", `${formatNumber(warmBusinessCalls)} (${formatPercent(warmBusinessRate)})`, warmBusinessRate, "primary", dashboardSegmentHref("warm"))}
                ${pipelineBar("Transcript coverage", formatPercent(transcriptCoverage), transcriptCoverage, "accent", drilldownUrl("calls.transcriptAvailable", withSegment()))}
                ${pipelineBar("AI assistants", `${formatNumber(aiAssistantTotals.encounters || 0)} (${formatPercent(aiAssistantEncounterRate)})`, aiAssistantEncounterRate, "warning", drilldownUrl("calls.aiVoiceAssistant", withSegment()))}
                ${pipelineBar("Probable live-human", formatPercent(liveHumanRate), liveHumanRate, "primary", drilldownUrl("calls.probableLiveHuman", withSegment()))}
                ${pipelineBar("Meaningful", formatPercent(meaningfulRate), meaningfulRate, "success", drilldownUrl("calls.meaningfulConversation", withSegment()))}
                ${pipelineBar("Follow-up signals", formatPercent(followUpRate), followUpRate, "warning", drilldownUrl("calls.followUpRequired", withSegment()))}
                ${pipelineBar("Risk reviews", formatPercent(riskReviewRate), riskReviewRate, "danger", drilldownUrl("calls.riskReviews", withSegment()))}
                ${pipelineBar("No-contact utilisation risk", formatPercent(leadRiskRate), leadRiskRate, "danger", drilldownUrl("reattempt.oneDialNoContactNoLater", withSegment()))}
              </div>
            </div>
          </article>
        </section>

        <section class="panel" id="business-split" ${workspaceAttr("overview")}>
          <div class="panel-header">
            <div>
              <h2>New Business vs Warm Business</h2>
              <p class="muted small">${escapeHtml(scopeNote)}</p>
            </div>
            <div class="segment-actions">
              <a class="filter-link ${activeSegment ? "" : "selected"}" href="${escapeHtml(dashboardSegmentHref(""))}">All Business</a>
              ${badge("OrderCount based", "neutral")}
            </div>
          </div>
          <div class="panel-body segment-split">
            <a class="segment-card accent ${activeSegment === "new" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentHref("new"))}" aria-current="${activeSegment === "new" ? "true" : "false"}">
              <span>New Business</span>
              <strong class="mono">${formatNumber(newBusinessCalls)}</strong>
              <small>${formatPercent(newBusinessRate)} of unique calls | No Sales History</small>
            </a>
            <a class="segment-card primary ${activeSegment === "warm" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentHref("warm"))}" aria-current="${activeSegment === "warm" ? "true" : "false"}">
              <span>Warm Business</span>
              <strong class="mono">${formatNumber(warmBusinessCalls)}</strong>
              <small>${formatPercent(warmBusinessRate)} of unique calls | Previous Sales History</small>
            </a>
            <div class="segment-track" aria-label="New Business and Warm Business call split">
              <span class="segment-fill new" style="width: ${Math.max(0, Math.min(100, newBusinessRate)).toFixed(1)}%;"></span>
              <span class="segment-fill warm" style="width: ${Math.max(0, Math.min(100, warmBusinessRate)).toFixed(1)}%;"></span>
            </div>
          </div>
        </section>

        <section class="metrics" aria-label="Executive overview" ${workspaceAttr("overview")}>
          ${metricCard("Unique calls", formatNumber(data.totals.uniqueCalls), `${formatNumber(data.totals.rawRows)} ${activeSegment ? "segment rows" : "raw rows"}, ${formatNumber(data.totals.duplicateCallIds)} duplicate IDs`, "info", drilldownUrl("calls.unique", withSegment()))}
          ${metricCard("Probable live-human rate", formatPercent(data.rates.probableLiveHuman), `${formatNumber(data.totals.probableLiveHuman)} deterministic signals; proof required`, "good", drilldownUrl("calls.probableLiveHuman", withSegment()))}
          ${metricCard("Meaningful conversations", formatPercent(data.rates.meaningfulConversation), `${formatNumber(data.totals.meaningfulConversation)} deterministic calls qualify; high ${formatNumber(data.intelligenceGovernance?.confidence?.high || 0)}, medium ${formatNumber(data.intelligenceGovernance?.confidence?.medium || 0)}, low ${formatNumber(data.intelligenceGovernance?.confidence?.low || 0)}`, "good", drilldownUrl("calls.meaningfulConversation", withSegment()))}
          ${metricCard("Follow-up signals", formatNumber(data.totals.followUpRequired), `Deterministic; ${formatNumber(data.totals.followUpIndeterminate)} need more future data`, "warn", drilldownUrl("calls.followUpRequired", withSegment()))}
          ${metricCard("AI assistants", formatNumber(aiAssistantTotals.encounters || 0), `${formatPercent(aiAssistantEncounterRate)} encounter rate`, "warn", drilldownUrl("calls.aiVoiceAssistant", withSegment()))}
          ${metricCard("Transcript coverage", formatPercent(data.rates.transcriptCoverage), `${formatNumber(data.totals.transcriptAvailable)} transcripts available; blanks mean no pickup`, "info", drilldownUrl("calls.transcriptAvailable", withSegment()))}
          ${metricCard("Risk reviews", formatNumber(data.totals.riskReviews), "Deterministic complaint or opt-out style signals", "risk", drilldownUrl("calls.riskReviews", withSegment()))}
          ${metricCard("Reports stored", formatNumber(persistence.counts.reports), `${formatNumber(persistence.counts.imports)} saved import snapshots`, "info")}
        </section>

        <section class="panel" id="attention" ${workspaceAttr("overview")}>
          <div class="panel-header">
            <div>
              <p class="section-kicker">Priority queues</p>
              <h2>What Needs Attention</h2>
              <p class="muted small">Open a focused workspace to review the evidence behind each queue.</p>
            </div>
          </div>
          <div class="panel-body attention-grid">
            <a class="attention-item warning" href="${escapeHtml(workspaceHref("harvest", "lead-harvest"))}">
              <span>Lead harvest</span><strong class="mono">${formatNumber(leadHarvestQueueCount)}</strong><small>Open callback candidates and records where matching is unavailable.</small>
            </a>
            <a class="attention-item danger" href="${escapeHtml(workspaceHref("reviews", "alerts"))}">
              <span>Active alerts</span><strong class="mono">${formatNumber(activeAlertCount)}</strong><small>New, acknowledged, or in-progress alerts in the filtered call set.</small>
            </a>
            <a class="attention-item warning" href="${escapeHtml(workspaceHref("reviews", "alerts"))}">
              <span>Review needed</span><strong class="mono">${formatNumber(managerReviewNeededCount)}</strong><small>Calls requiring a manager decision, correction, or dismissal.</small>
            </a>
            <a class="attention-item" href="${escapeHtml(workspaceHref("follow_up", "lead-utilization"))}">
              <span>Follow-up signals</span><strong class="mono">${formatNumber(data.totals.followUpRequired || 0)}</strong><small>Evidence-backed follow-up signals; future-data limits still apply.</small>
            </a>
          </div>
        </section>

        <div class="workspace-flow" ${workspaceAttr("team")}>
        <section class="panel" id="ai-assistants">
          <div class="panel-header">
            <div>
              <h2>AI Call Assistant Encounters</h2>
              <p class="muted small">Tracks AI voicemail and screened-call services separately from normal voicemail, with proof, confidence, and future-contact recovery.</p>
            </div>
            ${badge(`${formatPercent(aiAssistantTotals.highConfidenceRate || 0)} high-confidence`, (aiAssistantTotals.highConfidenceEncounters || 0) ? "success" : "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Encounters", formatNumber(aiAssistantTotals.encounters || 0), `${formatPercent(aiAssistantEncounterRate)} of scoped calls`, "warn", drilldownUrl("calls.aiVoiceAssistant", withSegment()))}
            ${metricCard("Bail rate", formatPercent(aiAssistantBailRate), `${formatNumber(aiAssistantTotals.bailed || 0)} bail events`, "risk", drilldownUrl("calls.aiVoiceAssistantBailed", withSegment()))}
            ${metricCard("Handled well", formatPercent(aiAssistantHandledRate), `${formatNumber(aiAssistantTotals.handledSuccessfully || 0)} structured responses`, "good", drilldownUrl("calls.aiVoiceAssistantHandled", withSegment()))}
            ${metricCard("Recovered later", formatPercent(aiAssistantFutureHumanRate), `${formatNumber(aiAssistantTotals.futureHumanContact || 0)} later human contacts`, "info", drilldownUrl("calls.aiVoiceAssistantFutureHuman", withSegment()))}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>AI Assistant Trend</h2>
                <p class="muted small">Daily trend uses call date. Future recovery updates automatically when later matching customer or lead calls are imported.</p>
              </div>
            </div>
            ${table([
              { label: "Date", render: (row) => `<span class="mono">${escapeHtml(formatSourceDate(row.label || row.date))}</span>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "Encounters", render: (row) => dataLink("calls.aiVoiceAssistant", formatNumber(row.encounters), withSegment()) },
              { label: "Rate", render: (row) => formatPercent(row.encounterRate) },
              { label: "Bails", render: (row) => dataLink("calls.aiVoiceAssistantBailed", formatNumber(row.bailed), withSegment()) },
              { label: "Handled", render: (row) => dataLink("calls.aiVoiceAssistantHandled", formatNumber(row.handledSuccessfully), withSegment()) },
              { label: "Recovered", render: (row) => dataLink("calls.aiVoiceAssistantFutureHuman", formatNumber(row.futureHumanContact), withSegment()) }
            ], aiAssistantTrendRows, "No AI call assistant encounters are available in this scope.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Salesperson AI Assistant Handling</h2>
                <p class="muted small">Bail means the transcript shows the assistant but no useful response from the salesperson.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.aiVoiceAssistant", withSegment({ salesperson: row.salesperson })))}">${escapeHtml(row.salesperson)}</a>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "Encounters", render: (row) => dataLink("calls.aiVoiceAssistant", formatNumber(row.encounters), withSegment({ salesperson: row.salesperson })) },
              { label: "Encounter rate", render: (row) => formatPercent(row.encounterRate) },
              { label: "Bail rate", render: (row) => dataLink("calls.aiVoiceAssistantBailed", formatPercent(row.bailRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Handled", render: (row) => dataLink("calls.aiVoiceAssistantHandled", formatPercent(row.handledRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Recovered", render: (row) => dataLink("calls.aiVoiceAssistantFutureHuman", formatPercent(row.futureHumanContactRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Top tactic", render: (row) => escapeHtml(row.topTactic) }
            ], aiAssistantSalespersonRows, "No salesperson has AI call assistant encounters in this scope.")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>What Works Against AI Assistants</h2>
                <p class="muted small">Tactics are extracted from salesperson turns and compared against handled and recovered outcomes.</p>
              </div>
              ${aiAssistantTopTactic ? badge(`Best: ${aiAssistantTopTactic.label}`, "success") : badge("No tactic data", "neutral")}
            </div>
            ${table([
              { label: "Tactic", render: (row) => escapeHtml(row.label) },
              { label: "Used", render: (row) => formatNumber(row.encounters) },
              { label: "Handled rate", render: (row) => formatPercent(row.handledRate) },
              { label: "Bail rate", render: (row) => formatPercent(row.bailRate) },
              { label: "Recovered later", render: (row) => formatPercent(row.futureHumanContactRate) }
            ], aiAssistantTacticRows, "No tactics were detected for AI assistant encounters.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Latest AI Assistant Proof</h2>
                <p class="muted small">Open any call to inspect the transcript phrase and salesperson response.</p>
              </div>
            </div>
            ${table([
              { label: "Call", render: (row) => callLink(row.callId) },
              { label: "Customer ID", render: (row) => customerIdCell(row) },
              { label: "Salesperson", key: "salesperson" },
              { label: "Response", render: (row) => row.bailed ? badge("Bailed", "critical") : row.handledSuccessfully ? badge("Handled", "success") : badge("Partial", "warning") },
              { label: "Tactics", render: (row) => tacticList(row.tacticLabels) },
              { label: "Future", render: (row) => row.futureCallId ? callLink(row.futureCallId, "Future call") : `<span class="muted small">${escapeHtml(String(row.futureStatus || "").replace(/_/g, " "))}</span>` }
            ], aiAssistantLatestRows, "No AI call assistant proof rows are available.")}
          </div>
        </section>

        <section class="panel" id="system-audio">
          <div class="panel-header">
            <div>
              <h2>System Audio Audit</h2>
              <p class="muted small">Tracks automated phone barriers separately from customer conversations: call screening, carrier messages, and machine voicemail.</p>
            </div>
            ${badge(`${formatNumber(systemAudioTotals.encounters || 0)} barriers`, systemAudioTotals.encounters ? "warning" : "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("System barriers", formatNumber(systemAudioTotals.encounters || 0), `${formatPercent(systemAudioTotals.encounterRate || 0)} of scoped calls`, "warn", drilldownUrl("calls.systemAudio", withSegment()))}
            ${metricCard("Call screening", formatNumber(systemAudioTotals.callScreening || 0), "AI assistants and screened-call prompts", "warn", drilldownUrl("calls.systemAudio.call_screening", withSegment()))}
            ${metricCard("Carrier system", formatNumber(systemAudioTotals.carrierPhoneSystem || 0), "Busy, unavailable, disconnected messages", "info", drilldownUrl("calls.systemAudio.carrier_phone_system", withSegment()))}
            ${metricCard("Machine voicemail", formatNumber(systemAudioTotals.machineVoicemail || 0), "Mailbox and leave-message greetings", "info", drilldownUrl("calls.systemAudio.machine_voicemail", withSegment()))}
            ${metricCard("Recovered later", formatPercent(systemAudioTotals.futureHumanContactRate || 0), `${formatNumber(systemAudioTotals.futureHumanContact || 0)} later human contacts`, "good", drilldownUrl("calls.systemAudioRecovered", withSegment()))}
            ${metricCard("Screening bails", formatPercent(systemAudioTotals.bailRate || 0), `${formatNumber(systemAudioTotals.bailed || 0)} call-screening bail events`, "risk", drilldownUrl("calls.systemAudioBailed", withSegment()))}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>System Audio Subtypes</h2>
                <p class="muted small">Subtype rules make the operational issue visible instead of hiding everything under system_audio.</p>
              </div>
            </div>
            ${table([
              { label: "Subtype", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl(`calls.systemAudio.${row.subtype}`, withSegment({ systemAudioSubtype: row.subtype })))}">${escapeHtml(row.subtypeLabel || row.name)}</a>` },
              { label: "Calls", render: (row) => formatNumber(row.encounters) },
              { label: "Share", render: (row) => formatPercent(percentOf(row.encounters, systemAudioTotals.encounters || 0)) },
              { label: "Recovered", render: (row) => dataLink("calls.systemAudioRecovered", formatPercent(row.futureHumanContactRate), withSegment({ systemAudioSubtype: row.subtype })) }
            ], systemAudioSubtypeRows, "No system audio barriers were detected.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>System Audio Trend</h2>
                <p class="muted small">Shows whether automated barriers are increasing or decreasing over time.</p>
              </div>
            </div>
            ${table([
              { label: "Date", render: (row) => `<span class="mono">${escapeHtml(formatSourceDate(row.label || row.date))}</span>` },
              { label: "Barriers", render: (row) => dataLink("calls.systemAudio", formatNumber(row.encounters), withSegment()) },
              { label: "Screening", render: (row) => formatNumber(row.callScreening) },
              { label: "Carrier", render: (row) => formatNumber(row.carrierPhoneSystem) },
              { label: "Recovered", render: (row) => formatPercent(row.futureHumanContactRate) }
            ], systemAudioTrendRows, "No system audio trend rows are available.")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>System Audio By Salesperson</h2>
                <p class="muted small">For call-screening rows, handled/bail rates show whether a useful message was left.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.systemAudio", withSegment({ salesperson: row.salesperson })))}">${escapeHtml(row.salesperson)}</a>` },
              { label: "Barriers", render: (row) => formatNumber(row.encounters) },
              { label: "Screening", render: (row) => formatNumber(row.callScreening) },
              { label: "Handled", render: (row) => dataLink("calls.systemAudioHandled", formatPercent(row.handledRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Bailed", render: (row) => dataLink("calls.systemAudioBailed", formatPercent(row.bailRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Recovered", render: (row) => dataLink("calls.systemAudioRecovered", formatPercent(row.futureHumanContactRate), withSegment({ salesperson: row.salesperson })) }
            ], systemAudioSalespersonRows, "No salesperson system audio rows are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>System Audio By Source</h2>
                <p class="muted small">Shows whether a source is generating more automated barriers and whether those barriers are later recovered.</p>
              </div>
            </div>
            ${table([
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.systemAudio", withSegment({ source: row.source })))}">${escapeHtml(row.source)}</a>` },
              { label: "Barriers", render: (row) => formatNumber(row.encounters) },
              { label: "Screening", render: (row) => formatNumber(row.callScreening) },
              { label: "Carrier", render: (row) => formatNumber(row.carrierPhoneSystem) },
              { label: "Recovered", render: (row) => dataLink("calls.systemAudioRecovered", formatPercent(row.futureHumanContactRate), withSegment({ source: row.source })) }
            ], systemAudioSourceRows, "No source system audio rows are available.")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Latest System Audio Proof</h2>
              <p class="muted small">Open any call to inspect the transcript phrase behind the subtype.</p>
            </div>
          </div>
          ${table([
            { label: "Call", render: (row) => callLink(row.callId) },
            { label: "Customer ID", render: (row) => customerIdCell(row) },
            { label: "Salesperson", key: "salesperson" },
            { label: "Source", key: "source" },
            { label: "Subtype", key: "subtypeLabel" },
            { label: "Response", render: (row) => row.handledSuccessfully ? badge("Handled", "success") : row.bailed ? badge("Bailed", "critical") : row.partial ? badge("Partial", "warning") : `<span class="muted small">n/a</span>` },
            { label: "Future", render: (row) => row.futureCallId ? callLink(row.futureCallId, "Future call") : `<span class="muted small">${escapeHtml(String(row.futureStatus || "").replace(/_/g, " "))}</span>` }
          ], systemAudioLatestRows, "No system audio proof rows are available.")}
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("follow_up")}>
        <section class="panel" id="lead-reattempts">
          <div class="panel-header">
            <div>
              <h2>Lead Reattempt Behaviour</h2>
              <p class="muted small">Matched customer/contact retry behaviour by salesperson. The main utilisation risk is one-dial no-contact records with no later matching call observed.</p>
            </div>
            ${badge(`${formatNumber(leadReattemptTotals.leadsTouched || 0)} matched records`, leadReattemptTotals.leadsTouched ? "success" : "warning")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Personal retry rate", formatPercent(leadReattemptTotals.personalRetryRate), `${formatNumber(leadReattemptTotals.personallyRetriedLeads || 0)} records retried by same salesperson`, "good", drilldownUrl("reattempt.personalRetried", withSegment()))}
            ${metricCard("One-dial records", formatPercent(leadReattemptTotals.oneAndDoneRate), `${formatNumber(leadReattemptTotals.oneAndDoneLeads || 0)} records dialed once`, "warn", drilldownUrl("reattempt.oneAndDone", withSegment()))}
            ${metricCard("Potential lead under-utilisation", formatPercent(leadReattemptTotals.oneDialNoContactNoLaterRate), `${formatNumber(leadReattemptTotals.oneDialNoContactNoLaterLeads || 0)} one-dial no-contact with no later match`, "risk", drilldownUrl("reattempt.oneDialNoContactNoLater", withSegment()))}
            ${metricCard("One-dial no-contact records", formatPercent(leadReattemptTotals.riskyOneDialNoContactRate), `${formatNumber(leadReattemptTotals.riskyOneDialNoContactLeads || 0)} of one-dial records`, "warn", drilldownUrl("reattempt.oneDialRiskyNoContact", withSegment()))}
            ${metricCard("Valid one-dial outcomes", formatPercent(leadReattemptTotals.validOneDialOutcomeRate), `${formatNumber(leadReattemptTotals.validOneDialOutcomeLeads || 0)} of one-dial records`, "good", drilldownUrl("reattempt.oneDialValidOutcome", withSegment()))}
            ${metricCard("Ambiguous one-dial excluded", formatPercent(leadReattemptTotals.oneDialNeedsReviewRate), `${formatNumber(leadReattemptTotals.oneDialNeedsReviewLeads || 0)} records excluded`, "warn", drilldownUrl("reattempt.oneDialNeedsReview", withSegment()))}
            ${metricCard("No later call by anyone", formatPercent(leadReattemptTotals.noLaterCallByAnyoneRate), `${formatNumber(leadReattemptTotals.noLaterCallByAnyoneLeads || 0)} records with no later call found`, "risk", drilldownUrl("reattempt.noLaterCallByAnyone", withSegment()))}
            ${metricCard("Avg calls per record", formatDecimal(leadReattemptTotals.averageCallsPerLead), `${formatNumber(leadReattemptTotals.callsWithoutStableLead || 0)} calls lacked matching ID`, "info", drilldownUrl("reattempt.leadsTouched", withSegment()))}
            ${metricCard("Max attempts on one record", formatNumber(leadReattemptTotals.maxAttemptsOnOneLead || 0), "Highest same-salesperson attempt count", "info", drilldownUrl("reattempt.maxAttemptsOnOneLead", withSegment()))}
            ${metricCard("Records dialed", formatNumber(leadReattemptTotals.leadsTouched || 0), "Salesperson plus matched records dialed", "info", drilldownUrl("reattempt.leadsTouched", withSegment()))}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Reattempt Behaviour By Salesperson</h2>
              <p class="muted small">Click any percentage to inspect the exact customer IDs and call IDs behind the rate.</p>
            </div>
          </div>
          ${table([
            { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("reattempt.leadsTouched", withSegment({ salesperson: row.salesperson })))}">${escapeHtml(row.salesperson)}</a>` },
            { label: "Records dialed", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ salesperson: row.salesperson })) },
            { label: "Personal retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
            { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
            { label: "Valid", render: (row) => dataLink("reattempt.oneDialValidOutcome", formatNumber(row.validOneDialOutcomeLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "No-contact", render: (row) => dataLink("reattempt.oneDialRiskyNoContact", formatNumber(row.riskyOneDialNoContactLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatNumber(row.oneDialNoContactNoLaterLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "Ambiguous excluded", render: (row) => dataLink("reattempt.oneDialNeedsReview", formatNumber(row.oneDialNeedsReviewLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "No later by anyone", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ salesperson: row.salesperson })) },
            { label: "Avg calls/lead", render: (row) => formatDecimal(row.averageCallsPerLead) },
            { label: "Max attempts", render: (row) => dataLink("reattempt.maxAttemptsOnOneLead", formatNumber(row.maxAttemptsOnOneLead), withSegment({ salesperson: row.salesperson, maxAttempts: row.maxAttemptsOnOneLead })) }
          ], leadReattemptSalespersonRows, "No matched reattempt rows are available.")}
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Highest Retry Discipline</h2>
                <p class="muted small">Salespeople with at least 25 matched records, ranked by personal retry rate.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", key: "salesperson" },
              { label: "Records", render: (row) => formatNumber(row.leadsTouched) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
              { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatPercent(row.oneDialNoContactNoLaterRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Avg calls", render: (row) => formatDecimal(row.averageCallsPerLead) }
            ], leadReattemptHighestRows, "No high-volume retry rows are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Highest Potential Lead Under-Utilisation</h2>
                <p class="muted small">Salespeople with at least 25 matched records, ranked by one-dial no-contact rows with no later matching call observed.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", key: "salesperson" },
              { label: "Records", render: (row) => formatNumber(row.leadsTouched) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
              { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatPercent(row.oneDialNoContactNoLaterRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Ambiguous excluded", render: (row) => dataLink("reattempt.oneDialNeedsReview", formatNumber(row.oneDialNeedsReviewLeads), withSegment({ salesperson: row.salesperson })) },
              { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ salesperson: row.salesperson })) }
            ], leadReattemptRiskRows, "No one-dial no-contact/no-later rows are available.")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Patterns In What Gets Retried</h2>
              <p class="muted small">Compares retry behaviour by New/Warm status, source, and region/location signals from the upload.</p>
            </div>
          </div>
          ${table([
            { label: "Segment", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("reattempt.leadsTouched", withSegment({ businessSegment: row.businessSegment })))}">${escapeHtml(row.businessSegmentLabel || row.name)}</a>` },
            { label: "Records", render: (row) => formatNumber(row.leadsTouched) },
            { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), { businessSegment: row.businessSegment }) },
            { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), { businessSegment: row.businessSegment }) },
            { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatPercent(row.oneDialNoContactNoLaterRate), { businessSegment: row.businessSegment }) },
            { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), { businessSegment: row.businessSegment }) },
            { label: "Avg calls", render: (row) => formatDecimal(row.averageCallsPerLead) }
          ], leadReattemptSegmentRows, "No business segment reattempt rows are available.")}
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Reattempt Patterns By Source</h2>
                <p class="muted small">Uses CustomerImportSource where available; missing values are categorized as Facebook for LG records and Self Sourced otherwise.</p>
              </div>
            </div>
            ${table([
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("reattempt.leadsTouched", withSegment({ source: row.source })))}">${escapeHtml(row.source)}</a>` },
              { label: "Records", render: (row) => formatNumber(row.leadsTouched) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ source: row.source })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ source: row.source })) },
              { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatPercent(row.oneDialNoContactNoLaterRate), withSegment({ source: row.source })) },
              { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ source: row.source })) }
            ], leadReattemptSourceRows, "No source pattern rows are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Reattempt Patterns By Region</h2>
                <p class="muted small">Uses CallRegion where present; blank CallRegion is categorized as Australia.</p>
              </div>
            </div>
            ${table([
              { label: "Region", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("reattempt.leadsTouched", withSegment({ region: row.region })))}">${escapeHtml(row.region)}</a>` },
              { label: "Records", render: (row) => formatNumber(row.leadsTouched) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ region: row.region })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ region: row.region })) },
              { label: "No-contact, no later", render: (row) => dataLink("reattempt.oneDialNoContactNoLater", formatPercent(row.oneDialNoContactNoLaterRate), withSegment({ region: row.region })) },
              { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ region: row.region })) }
            ], leadReattemptRegionRows, "No region pattern rows are available.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("harvest")}>
        <section class="panel" id="lead-harvest">
          <div class="panel-header">
            <div>
              <h2>Lead Harvest Queue</h2>
              <p class="muted small">${escapeHtml(leadHarvestScopeLabel)} calls where deterministic evidence shows a live-human conversation, a positive response, and a callback/follow-up request. These are evidence-backed review candidates, not confirmed sales outcomes.</p>
            </div>
            ${badge(`${formatNumber(leadHarvestQueueCount)} to review`, leadHarvestQueueCount ? "warning" : "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Open harvest candidates", formatNumber(leadHarvestQueueCount), `${formatNumber(leadHarvestOpenNoLater)} no later matching call; ${formatNumber(leadHarvestMatchingUnavailable)} matching unavailable`, "risk", drilldownUrl("harvest.reviewQueue", leadHarvestScopeFilters))}
            ${metricCard("All candidates", formatNumber(leadHarvestCandidateCalls), `${escapeHtml(leadHarvestScopeLabel)} positive callback candidates`, "warn", drilldownUrl(leadHarvestCandidateMetric, leadHarvestScopeFilters))}
            ${metricCard("Later matching call observed", formatNumber(leadHarvestLaterObserved), "A later stable-ID call exists; this does not prove completion", "good", drilldownUrl("harvest.laterObserved", leadHarvestScopeFilters))}
            ${metricCard("High-priority review", formatNumber(leadHarvestHighPriorityCount), "High/medium confidence open candidates", "info", drilldownUrl("harvest.reviewQueue", leadHarvestScopeFilters))}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Harvest Candidates By Salesperson</h2>
                <p class="muted small">Open candidates are calls with no later stable-ID match in the active data. Matching unavailable means the row lacks a stable source ID, so follow-up cannot be proven from this dataset.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("harvest.openCandidates", { ...leadHarvestScopeFilters, salesperson: row.salesperson }))}">${escapeHtml(row.salesperson)}</a>` },
              { label: "Candidates", render: (row) => dataLink(leadHarvestCandidateMetric, formatNumber(leadHarvestScopedCandidates(row)), { ...leadHarvestScopeFilters, salesperson: row.salesperson }) },
              { label: "Open", render: (row) => dataLink("harvest.openCandidates", formatNumber(leadHarvestScopedOpen(row)), { ...leadHarvestScopeFilters, salesperson: row.salesperson }) },
              { label: "Later matching call observed", render: (row) => dataLink("harvest.laterObserved", formatNumber(leadHarvestScopedLater(row)), { ...leadHarvestScopeFilters, salesperson: row.salesperson }) },
              { label: "Matching unavailable", render: (row) => dataLink("harvest.matchingUnavailable", formatNumber(leadHarvestScopedUnavailable(row)), { ...leadHarvestScopeFilters, salesperson: row.salesperson }) },
              { label: "High/medium confidence", render: (row) => formatNumber(row.highOrMediumConfidence || 0) }
            ], leadHarvestSalespersonRows.filter((row) => leadHarvestScopedCandidates(row)), "No lead harvest candidates are available in this scope.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Harvest Candidates By Source</h2>
                <p class="muted small">Source uses call CSV source fields only. Parked allocation/campaign data is not used.</p>
              </div>
            </div>
            ${table([
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("harvest.openCandidates", { ...leadHarvestScopeFilters, source: row.source }))}">${escapeHtml(row.source)}</a>` },
              { label: "Candidates", render: (row) => dataLink(leadHarvestCandidateMetric, formatNumber(leadHarvestScopedCandidates(row)), { ...leadHarvestScopeFilters, source: row.source }) },
              { label: "Open", render: (row) => dataLink("harvest.openCandidates", formatNumber(leadHarvestScopedOpen(row)), { ...leadHarvestScopeFilters, source: row.source }) },
              { label: "Later matching call observed", render: (row) => dataLink("harvest.laterObserved", formatNumber(leadHarvestScopedLater(row)), { ...leadHarvestScopeFilters, source: row.source }) },
              { label: "Matching unavailable", render: (row) => dataLink("harvest.matchingUnavailable", formatNumber(leadHarvestScopedUnavailable(row)), { ...leadHarvestScopeFilters, source: row.source }) }
            ], leadHarvestSourceRows.filter((row) => leadHarvestScopedCandidates(row)), "No source-level harvest rows are available in this scope.")}
          </div>
        </section>

        <section class="grid-2" id="harvest-objections">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Harvest Objections</h2>
                <p class="muted small">Detected from customer transcript turns only. Treat as review tags, not final truth.</p>
              </div>
            </div>
            ${table([
              { label: "Objection", render: (row) => escapeHtml(row.objectionLabel || row.objectionType || "Unknown") },
              { label: "Candidates", render: (row) => dataLink(leadHarvestCandidateMetric, formatNumber(leadHarvestScopedCandidates(row)), { ...leadHarvestScopeFilters, objectionType: row.objectionType }) },
              { label: "Open", render: (row) => dataLink("harvest.openCandidates", formatNumber(leadHarvestScopedOpen(row)), { ...leadHarvestScopeFilters, objectionType: row.objectionType }) },
              { label: "Matching unavailable", render: (row) => dataLink("harvest.matchingUnavailable", formatNumber(leadHarvestScopedUnavailable(row)), { ...leadHarvestScopeFilters, objectionType: row.objectionType }) }
            ], leadHarvestObjectionRows.filter((row) => leadHarvestScopedCandidates(row)), "No objection tags are available in this scope.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Salesperson Handling</h2>
                <p class="muted small">Detected from salesperson transcript turns. This indicates response style, not a manager-confirmed quality grade.</p>
              </div>
            </div>
            ${table([
              { label: "Handling", render: (row) => escapeHtml(row.salespersonHandlingLabel || row.salespersonHandlingType || "Unknown") },
              { label: "Candidates", render: (row) => dataLink(leadHarvestCandidateMetric, formatNumber(leadHarvestScopedCandidates(row)), { ...leadHarvestScopeFilters, handlingType: row.salespersonHandlingType }) },
              { label: "Open", render: (row) => dataLink("harvest.openCandidates", formatNumber(leadHarvestScopedOpen(row)), { ...leadHarvestScopeFilters, handlingType: row.salespersonHandlingType }) },
              { label: "Matching unavailable", render: (row) => dataLink("harvest.matchingUnavailable", formatNumber(leadHarvestScopedUnavailable(row)), { ...leadHarvestScopeFilters, handlingType: row.salespersonHandlingType }) }
            ], leadHarvestHandlingRows.filter((row) => leadHarvestScopedCandidates(row)), "No handling tags are available in this scope.")}
          </div>
        </section>

        <section class="panel" id="harvest-evidence">
          <div class="panel-header">
            <div>
              <h2>Lead Harvest Evidence Queue</h2>
              <p class="muted small">Use this as a callback prep list. Names, objections, handling, and timing are possible extracted context and should be checked against the call evidence before action.</p>
            </div>
            <div class="stack">
              ${badge(`${formatNumber(leadHarvestLatestRows.length)} newest shown`, leadHarvestLatestRows.length ? "notice" : "neutral")}
              <a class="button-link" href="${escapeHtml(leadHarvestNewestUrl)}">Newest</a>
              <a class="button-link" href="${escapeHtml(leadHarvestOldestUrl)}">Oldest</a>
              <a class="button-link" href="${escapeHtml(leadHarvestAllUrl)}">View all</a>
            </div>
          </div>
          ${table([
            { label: "Call", render: (row) => callLink(row.callId) },
            { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("harvest.openCandidates", { ...leadHarvestScopeFilters, salesperson: row.salesperson }))}">${escapeHtml(row.salesperson)}</a>` },
            { label: "Source", render: (row) => escapeHtml(row.source) },
            { label: "Source time", render: (row) => `<span class="mono">${escapeHtml(row.sourceTime)}</span>` },
            { label: "Possible name", render: (row) => escapeHtml(row.possibleContactName || row.possibleDecisionMakerName || "Not stated") },
            { label: "Objection", render: (row) => `${escapeHtml(row.objectionLabel || "Unknown")}<br /><span class="muted small">${escapeHtml(row.objectionEvidence || "Evidence unavailable")}</span>` },
            { label: "Salesperson handling", render: (row) => `${escapeHtml(row.salespersonHandlingLabel || "Unknown")}<br /><span class="muted small">${escapeHtml(row.salespersonHandlingEvidence || "Evidence unavailable")}</span>` },
            { label: "Callback timing", render: (row) => `${escapeHtml(row.callbackTimingSummary || "Timing not specified")}<br /><span class="muted small">${escapeHtml(row.callbackTimingText || "Open proof to confirm timing")}</span>` },
            { label: "Status", render: (row) => badge(row.statusLabel || row.status, row.status === "open_no_later_matching_call" ? "warning" : row.status === "later_matching_call_observed" ? "success" : "neutral") },
            { label: "Confidence", render: (row) => badge(row.confidenceLabel || "Confidence unavailable", row.confidenceBand === "high" ? "success" : row.confidenceBand === "medium" ? "notice" : "warning") },
            { label: "Handover context", render: (row) => `<span class="evidence-summary">${escapeHtml(row.handoverSummary || row.positiveSignalSummary || "Open call evidence to inspect context")}<a class="open-link" href="/calls/${encodeURIComponent(row.callId)}">Open call evidence</a></span>` },
            { label: "Evidence snippet", render: (row) => `<span class="evidence">${escapeHtml((row.evidenceSnippets || [row.evidenceSummary || "Evidence unavailable"])[0])}</span>` }
          ], leadHarvestLatestRows, "No positive callback harvest candidates are available in this scope.")}
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("team")}>
        <section class="panel" id="source-quality">
          <div class="panel-header">
            <div>
              <h2>Customer Source Quality</h2>
              <p class="muted small">Bulk/manual source fields are raw call CSV context. Human-answer and follow-up rates are deterministic transcript-derived signals with confidence context, not LLM-reviewed conclusions unless labelled elsewhere.</p>
            </div>
            ${badge(`${formatNumber(sourceQualityTotals.callsWithRecordAge || 0)} record ages`, sourceQualityTotals.callsWithRecordAge ? "success" : "warning")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Bulk sourced calls", formatNumber(sourceQualityTotals.callsWithBulkSource), `${formatPercent(sourceQualityTotals.bulkSourceCoverageRate)} source coverage`, "info", drilldownUrl("source.bulkSourced", withSegment()))}
            ${metricCard("New Business >90d record age", formatNumber(sourceAge90.calls), `${formatPercent(sourceAge90.rate)} of New Business calls`, "risk", drilldownUrl("source.newBusinessRecordOlderThan", withSegment({ minImportAgeDays: 90 })))}
            ${metricCard("Manual LG/SP calls", formatNumber(sourceQualityTotals.callsWithManualCreator), `${formatNumber(sourceQualityTotals.leadGeneratorCreatedCalls)} LG, ${formatNumber(sourceQualityTotals.salespersonCreatedCalls)} SP`, "good", drilldownUrl("source.manualCreated", withSegment()))}
            ${metricCard("Self sourced no raw attribution", formatNumber(sourceQualityTotals.callsMissingSourceAttribution), `${formatPercent(sourceQualityTotals.missingSourceAttributionRate)} inferred Self Sourced records`, "info", drilldownUrl("source.missingAttribution", withSegment()))}
            ${metricCard("Worst human answer source", sourceQualityWorstSource ? sourceQualityWorstSource.name : "n/a", sourceQualityWorstSource ? `${formatPercent(sourceQualityWorstSource.probableLiveHumanRate)} from ${formatNumber(sourceQualityWorstSource.calls)} calls` : "Needs source data", "warn", sourceQualityWorstSource ? drilldownUrl("calls.unique", withSegment({ source: sourceQualityWorstSource.name })) : "")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>New Business Record Age</h2>
                <p class="muted small">Click a threshold to inspect New Business calls where Record Age is more than that many days before the call. Record Age uses import date first, then manual creation date.</p>
              </div>
            </div>
            ${table([
              { label: "Record age older than", render: (row) => dataLink("source.newBusinessRecordOlderThan", `>${formatNumber(row.thresholdDays)}d`, withSegment({ minImportAgeDays: row.thresholdDays })) },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "Share", render: (row) => formatPercent(row.rate) }
            ], sourceQualityThresholdRows, "No valid CustomerImportDate or CustomerCreateDate values are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Manual Entry Mix</h2>
                <p class="muted small">LG means lead generator. SP means salesperson.</p>
              </div>
            </div>
            ${table([
              { label: "Type", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("source.manualCreated", withSegment({ createdByType: row.createdByType })))}">${escapeHtml(row.createdByTypeLabel || row.name)}</a>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "New", render: (row) => formatNumber(row.newBusinessCalls) },
              { label: "Warm", render: (row) => formatNumber(row.warmBusinessCalls) },
              { label: "Human answer", render: (row) => formatPercent(row.probableLiveHumanRate) },
              { label: "Avg age", render: (row) => formatDays(row.averageCreateAgeDays) }
            ], sourceQualityTypeRows, "No manual LG/SP creator fields are available.")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Bulk Source Overview</h2>
              <p class="muted small">Human answer rate is the key source-quality signal; low rates point to weaker lead supply or older lists.</p>
            </div>
          </div>
          ${table([
            { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.unique", withSegment({ source: row.name })))}">${escapeHtml(row.name)}</a>` },
            { label: "Calls", render: (row) => formatNumber(row.calls) },
            { label: "New", render: (row) => formatNumber(row.newBusinessCalls) },
            { label: "Warm", render: (row) => formatNumber(row.warmBusinessCalls) },
            { label: "Human answer", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), withSegment({ source: row.name })) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), withSegment({ source: row.name })) },
            { label: "Avg record age", render: (row) => formatDays(row.averageRecordAgeDays) },
            { label: "New >90d", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatNumber(row.newBusinessRecordOlderThan90 ?? row.newBusinessImportedOlderThan90), withSegment({ source: row.name, minImportAgeDays: 90 })) }
          ], sourceQualitySourceRows, "No bulk source rows are available.")}
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Record Age Cohorts</h2>
                <p class="muted small">Record Age uses CustomerImportDate where valid, otherwise CustomerCreateDate where valid.</p>
              </div>
            </div>
            ${table([
              { label: "Record age", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.unique", withSegment({ recordAgeBucket: row.bucket })))}">${escapeHtml(row.bucket)}</a>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "New", render: (row) => formatNumber(row.newBusinessCalls) },
              { label: "Warm", render: (row) => formatNumber(row.warmBusinessCalls) },
              { label: "Human answer", render: (row) => formatPercent(row.probableLiveHumanRate) },
              { label: "Meaningful", render: (row) => formatPercent(row.meaningfulConversationRate) }
            ], sourceQualityAgeRows, "No record age cohorts are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Manual Creator Overview</h2>
                <p class="muted small">Creator-level view for lead generators and salespeople who manually entered customers.</p>
              </div>
            </div>
            ${table([
              { label: "Creator", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("source.manualCreated", withSegment({ createdBy: row.createdBy })))}">${escapeHtml(row.createdBy || row.name)}</a><br /><span class="muted small">${escapeHtml(row.createdByTypeLabel || row.createdByType || "Unknown")}</span>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "New", render: (row) => formatNumber(row.newBusinessCalls) },
              { label: "Warm", render: (row) => formatNumber(row.warmBusinessCalls) },
              { label: "Human answer", render: (row) => formatPercent(row.probableLiveHumanRate) },
              { label: "Avg create age", render: (row) => formatDays(row.averageCreateAgeDays) }
            ], sourceQualityCreatorRows, "No manual creator rows are available.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("intelligence")}>
        <section class="panel" id="intelligence">
          <div class="panel-header">
            <div>
              <h2>Transcript Intelligence</h2>
              <p class="muted small">Database-backed deterministic call deconstruction, lead-utilisation rollups, and local LLM extraction queue state. Deterministic records are not LLM-reviewed unless labelled as such.</p>
            </div>
            ${badge(`${formatNumber(intelligenceTotals.callsIndexed)} calls indexed`, intelligenceTotals.callsIndexed ? "success" : "warning")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Utilisation review signals", formatNumber(intelligenceTotals.wasteRiskLeads), `${formatNumber(intelligenceTotals.leadsIndexed)} leads indexed`, "risk", queueFilterUrl({ intelligenceQueue: "waste", wasteRisk: "1" }))}
            ${metricCard("High-quality utilized", formatNumber(intelligenceTotals.highQualityLeads), `Avg lead score ${Number(intelligenceTotals.avgLeadUtilizationScore || 0).toFixed(1)} / 5`, "good", queueFilterUrl({ intelligenceQueue: "high_quality", highQuality: "1" }))}
            ${metricCard("Repeated short attempts", formatNumber(intelligenceTotals.repeatedShortAttemptLeads), "Lead-level short/no-result pattern", "warn")}
            ${metricCard("Manager review calls", formatNumber(intelligenceTotals.managerReviewCalls), `${formatNumber(intelligenceTotals.riskFlagCalls)} deterministic risk-flag calls`, "risk", queueFilterUrl({ intelligenceQueue: "manager_review", managerReview: "1" }))}
            ${metricCard("LLM queue state", formatNumber(intelligenceTotals.llmQueued), `${formatNumber(intelligenceTotals.llmCompleted)} reviewed, ${formatNumber(intelligenceTotals.llmFailed || 0)} failed, ${formatNumber(intelligenceTotals.llmNotRequested)} not requested`, "info", queueFilterUrl({ intelligenceQueue: "llm_queued", llmStatus: "queued" }))}
            ${metricCard("Database", "SQLite", intelligence.dbPath ? "Call intelligence is persisted locally" : "No database summary available", "info")}
          </div>
        </section>

        <section class="panel" id="intelligence-queue">
          <div class="panel-header">
            <div>
              <h2>Intelligence Review Queue</h2>
              <p class="muted small">${escapeHtml(intelligenceQueueLabel(activeIntelligenceQueue))} queue. Filtered rows show deterministic, LLM, and manager-review provenance separately.</p>
            </div>
            ${badge(`${formatNumber(intelligenceQueueRows.length)} calls shown`, intelligenceQueueRows.length ? "notice" : "neutral")}
          </div>
          <div class="panel-body">
            <div class="stack" style="margin-bottom: 12px;">
              <a class="filter-link ${activeSegment === "new" && activeIntelligenceQueue === "waste" ? "selected" : ""}" href="${escapeHtml(dashboardFilterUrl({ ...globalFilterQuery, businessSegment: "new", intelligenceQueue: "waste", wasteRisk: "1" }, "intelligence-queue"))}">New Business utilisation review</a>
              <a class="filter-link ${activeSegment === "warm" && activeIntelligenceQueue === "waste" ? "selected" : ""}" href="${escapeHtml(dashboardFilterUrl({ ...globalFilterQuery, businessSegment: "warm", intelligenceQueue: "waste", wasteRisk: "1" }, "intelligence-queue"))}">Warm Business utilisation review</a>
              <a class="filter-link ${activeIntelligenceQueue === "manager_review" ? "selected" : ""}" href="${escapeHtml(queueFilterUrl({ intelligenceQueue: "manager_review", managerReview: "1" }))}">Manager review</a>
              <a class="filter-link ${activeIntelligenceQueue === "llm_completed" ? "selected" : ""}" href="${escapeHtml(queueFilterUrl({ intelligenceQueue: "llm_completed", llmStatus: "completed" }))}">LLM completed</a>
              <a class="filter-link ${activeIntelligenceQueue === "llm_queued" ? "selected" : ""}" href="${escapeHtml(queueFilterUrl({ intelligenceQueue: "llm_queued", llmStatus: "queued" }))}">LLM queued</a>
            </div>
            ${intelligenceAuditTable([
              { label: "Call", render: (row) => callLink(row.call_id) },
              { label: "Customer ID", render: (row) => customerIdCell(row, queueFilterUrl({ customerId: row.customer_id, intelligenceQueue: activeIntelligenceQueue })) },
              { label: "Segment", render: (row) => escapeHtml(row.business_segment_label || businessSegmentLabel(row.business_segment)) },
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ salesperson: row.salesperson, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.salesperson || "Unknown")}</a>` },
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ source: row.source, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.source || "Unknown source")}</a>` },
              { label: "Score", render: (row) => `<span class="mono">${formatNumber(row.lead_utilization_score)} / 5</span>` },
              { label: "Lead state", render: (row) => row.lead_waste_risk ? badge("Utilisation review", "critical") : row.lead_high_quality_utilized ? badge("High quality", "success") : badge("Monitor", "neutral") },
              { label: "Provenance", render: (row) => `${provenanceBadge("Deterministic")} ${provenanceBadge(llmReviewState(row))}` },
              { label: "Review", render: (row) => row.manager_review_required ? provenanceBadge("Manager review needed") : provenanceBadge("Manager unprocessed") },
              { label: "LLM", render: (row) => provenanceBadge(llmReviewState(row)) },
              { label: "Audit", render: (row) => `${badge(row.llm_result_quality_label || row.llm_status || "Not requested", toneForResultQuality(row.llm_result_quality || row.llm_status))}${row.llm_result_needs_rerun ? ` ${badge("Rerun", "critical")}` : ""}` },
              { label: "Confidence", render: (row) => row.llm_status === "completed" && row.llm_confidence ? badge(formatConfidence(row.llm_confidence), "success") : badge("Confidence unavailable", "neutral") },
              { label: "Reason", render: (row) => `<span class="evidence-summary">${escapeHtml(row.lead_reason || row.brief_reason || row.evidence_snippet || "Evidence unavailable")}<a class="proof-link" href="/calls/${encodeURIComponent(row.call_id)}">Open proof</a></span>` }
            ], intelligenceQueueRows, "No calls match this intelligence queue yet.")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
              <h2>Utilisation Review By Salesperson</h2>
                <p class="muted small">Lead-level deterministic rollup. Low-confidence or unusable transcript rows are review-only and should not be treated as final coaching conclusions without proof.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ salesperson: row.salesperson, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.salesperson)}</a>` },
              { label: "Leads", render: (row) => formatNumber(row.leads) },
              { label: "Review signals", render: (row) => formatNumber(row.wasteRiskLeads) },
              { label: "Risk rate", render: (row) => formatRatioPercent(row.wasteRiskRate) },
              { label: "High-quality", render: (row) => formatNumber(row.highQualityLeads) },
              { label: "Repeated short", render: (row) => formatNumber(row.repeatedShortAttemptLeads) },
              { label: "Avg score", render: (row) => `${Number(row.avgScore || 0).toFixed(1)} / 5` }
            ], intelligenceSalespersonRows, "No transcript-intelligence salesperson rows are available yet.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
              <h2>Source Quality Signals</h2>
                <p class="muted small">Secondary deterministic view by call CSV source. Confidence and evidence should be checked before drawing coaching conclusions.</p>
              </div>
            </div>
            ${table([
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ source: row.source, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.source)}</a>` },
              { label: "Leads", render: (row) => formatNumber(row.leads) },
              { label: "Review signals", render: (row) => formatNumber(row.wasteRiskLeads) },
              { label: "Risk rate", render: (row) => formatRatioPercent(row.wasteRiskRate) },
              { label: "High-quality", render: (row) => formatNumber(row.highQualityLeads) },
              { label: "Repeated short", render: (row) => formatNumber(row.repeatedShortAttemptLeads) },
              { label: "Avg score", render: (row) => `${Number(row.avgScore || 0).toFixed(1)} / 5` }
            ], intelligenceSourceRows, "No transcript-intelligence source rows are available yet.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("follow_up")}>
        <section class="panel" id="lead-utilization">
          <div class="panel-header">
            <div>
              <h2>No-Contact Utilisation Proof</h2>
              <p class="muted small">Matched-record metrics use source IDs only. This section does not rank live conversations or ambiguous one-dial records.</p>
            </div>
            ${badge(`${formatNumber(leadTotals.stableLeadDaysWorked)} matched records`, "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Potential lead under-utilisation", formatNumber(leadReattemptTotals.oneDialNoContactNoLaterLeads || leadTotals.singleAttemptNoContact || 0), "One-dial no-contact with no later matching call observed", "risk", drilldownUrl("reattempt.oneDialNoContactNoLater", withSegment()))}
            ${metricCard("One-dial no-contact", formatNumber(leadReattemptTotals.riskyOneDialNoContactLeads || 0), "Explicit no-contact or no usable speech evidence", "warn", drilldownUrl("reattempt.oneDialRiskyNoContact", withSegment()))}
            ${metricCard("One-dial records", formatNumber(leadReattemptTotals.oneAndDoneLeads || 0), "Dialed once by the salesperson", "info", drilldownUrl("reattempt.oneAndDone", withSegment()))}
            ${metricCard("No-contact retry coverage", formatRatioPercent(leadTotals.noContactRetryRate), `${formatNumber(leadTotals.noContactRetriedSameDay)} of ${formatNumber(leadTotals.noContactLeadDays)} retried`, "info", drilldownUrl("lead.noContactRetriedSameDay", withSegment()))}
            ${metricCard("Matched records dialed", formatNumber(leadReattemptTotals.leadsTouched || leadTotals.stableLeadDaysWorked || 0), `${formatNumber(leadReattemptTotals.callsWithoutStableLead || leadTotals.callsWithoutStableLead || 0)} calls lacked matching ID`, "good", drilldownUrl("reattempt.leadsTouched", withSegment()))}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("records")}>
        <section class="panel" id="confidence">
          <div class="panel-header">
            <div>
              <h2>Data Confidence</h2>
              <p class="muted small">Unsupported fields are preserved but excluded from MVP metrics.</p>
            </div>
            <div class="stack">
              ${badge(`${formatPercent(data.rates.durationRelationMatch)} duration checks match`, data.rates.durationRelationMatch === 100 ? "success" : "warning")}
              ${badge(`${data.missingColumns.length} missing required columns`, data.missingColumns.length ? "critical" : "success")}
            </div>
          </div>
          <div class="panel-body guardrails">
            <div class="note">
              <h3>Fields ignored for MVP analytics</h3>
              <p class="muted small">${data.ignoredFields.map((item) => `${item.field}: ${item.reason}`).map(escapeHtml).join("<br />")}</p>
            </div>
            <div class="note">
              <h3>Metrics not claimed</h3>
              <p class="muted small">${data.unsupportedMetrics.map(escapeHtml).join("<br />")}</p>
            </div>
            <div class="note">
              <h3>Coverage</h3>
              <p class="muted small">Source attribution: ${formatPercent(data.rates.sourceCoverage)}<br />Untrusted legacy disposition and note fields are excluded from active use.</p>
            </div>
            <div class="note">
              <h3>Contact-rate definitions</h3>
              <p class="muted small">Telephony connected means call duration is above zero. Probable live-human and meaningful conversation require transcript evidence and are not inferred from duration alone.</p>
            </div>
          </div>
        </section>

        <section class="grid-2">
          <div class="panel" id="history">
            <div class="panel-header">
              <div>
                <h2>Import History</h2>
                <p class="muted small">Each CSV load stores a derived local snapshot without copying the raw CSV into Git.</p>
              </div>
              ${badge(`${formatNumber(persistence.counts.imports)} saved`, "neutral")}
            </div>
            ${table([
              { label: "Import", render: (row) => `<span class="mono">${escapeHtml(row.id)}</span>` },
              { label: "Source", key: "sourceName" },
              { label: "Loaded", render: (row) => formatDateTime(row.lastImportedAt) },
              { label: "Calls", render: (row) => formatNumber(row.totals?.uniqueCalls) },
              { label: "AI assistants", render: (row) => formatNumber(row.totals?.aiVoiceAssistantEncounters || 0) },
              { label: "Follow-ups", render: (row) => formatNumber(row.totals?.followUpRequired) },
            ], importRows, "No imports have been saved yet.")}
          </div>

          <div class="panel" id="reports">
            <div class="panel-header">
              <div>
                <h2>Reports Library</h2>
                <p class="muted small">Generated reports are stored locally and can be viewed from the dashboard/API.</p>
              </div>
              ${badge(`${formatNumber(persistence.counts.reports)} reports`, "neutral")}
            </div>
            ${table([
              { label: "Report", render: (row) => `<strong>${escapeHtml(row.title)}</strong><br /><span class="muted small mono">${escapeHtml(row.id)}</span>` },
              { label: "Type", render: (row) => badge(row.type || "report", row.source === "system" ? "notice" : "neutral") },
              { label: "Updated", render: (row) => formatDateTime(row.updatedAt || row.createdAt) },
              { label: "Summary", render: (row) => `<span class="evidence">${escapeHtml(row.summary || row.content || "")}</span>` },
              { label: "Open", render: (row) => `<a class="open-link" href="/reports/${encodeURIComponent(row.id)}">View</a>` }
            ], reportRows, "No reports saved yet.")}
            <details>
              <summary>Report saving endpoint</summary>
              <pre>${escapeHtml(JSON.stringify({
                method: "POST",
                path: "/api/reports",
                body: {
                  title: "Report title",
                  type: "generated_report",
                  summary: "Short dashboard summary",
                  content: "Markdown report body",
                  metadata: { source: "Codex" }
                }
              }, null, 2))}</pre>
            </details>
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("reviews")}>
        <section class="grid-2">
          <div class="panel" id="alerts">
            <div class="panel-header">
              <div>
                <h2>Alert Centre</h2>
                <p class="muted small">Lifecycle workflow for call-data alerts in the current global filter scope.</p>
              </div>
              <div class="stack">
                ${badge(`${formatNumber(alertSummary.active || persistence.counts.currentAlertEvents || 0)} active`, (alertSummary.active || persistence.counts.currentAlertEvents) ? "critical" : "neutral")}
                ${badge(`${criticalAlerts} critical`, criticalAlerts ? "critical" : "neutral")}
                ${badge(`${warningAlerts} warning`, warningAlerts ? "warning" : "neutral")}
                ${badge(`${noticeAlerts} notice`, noticeAlerts ? "notice" : "neutral")}
              </div>
            </div>
            ${renderAlertCentre(alertRows, alertSummary, {
              returnTo: alertReturnTo,
              importId: persistence.currentImportId || data.persistence?.currentImportId || "",
              filterSummary: data.filterSummary
            })}
          </div>

          <div class="panel">
            <div class="panel-header">
              <h2>Manager Review Queue</h2>
              <div class="stack">
                ${badge(`${formatNumber(reviewRows.length)} shown`, "neutral")}
                ${badge(`${formatNumber(persistence.counts.currentManagerReviews)} saved reviews`, persistence.counts.currentManagerReviews ? "success" : "neutral")}
              </div>
            </div>
            ${table([
              { label: "Call", render: (row) => callLink(row.callId) },
              { label: "Customer ID", render: (row) => customerIdCell(row) },
              { label: "Salesperson", key: "salesperson" },
              { label: "Local outcome", render: (row) => badge(row.localOutcome, row.reviewRequired ? "warning" : "neutral") },
              { label: "Review", render: (row) => `${managerReviewBadge(row, reviewSummaryMap)}<br />${managerCorrectionSummary(row, reviewSummaryMap)}<br />${managerSuggestedCorrectionSummary(row, reviewSummaryMap)}` },
              { label: "Provenance", render: (row) => `${provenanceBadge(row.localOutcomeProvenance || "Deterministic")} ${provenanceBadge(managerReviewState(row, persistence))}` },
              { label: "Confidence", render: (row) => confidenceBadgeForRow(row) },
              { label: "Follow-up", key: "followUpStatus" },
              { label: "Proof", render: (row) => renderEvidenceSummary(row) },
              { label: "Actions", render: (row) => `<div class="alert-actions">${managerReviewActionForm(row, "confirm", "Confirm", { returnTo: alertReturnTo, importId: persistence.currentImportId || "", reviewScope: "call", source: "manager_review_queue" })}${managerReviewActionForm(row, "dismiss", "Dismiss", { returnTo: alertReturnTo, importId: persistence.currentImportId || "", reviewScope: "call", source: "manager_review_queue" })}</div>` }
            ], reviewRows, "No calls need manager review.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("team")}>
        <section class="panel" id="salespeople">
          <div class="panel-header">
            <div>
              <h2>Salesperson Scorecards</h2>
              <p class="muted small">Performance views include sample size and transcript coverage. Low samples should not be treated as rankings.</p>
            </div>
          </div>
          ${table([
            { label: "Salesperson", key: "name" },
            { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), withSegment({ salesperson: row.name })) },
            { label: "Transcript coverage", render: (row) => formatPercent(row.transcriptCoverageRate) },
            { label: "Confidence mix", render: (row) => `<span class="muted small">${escapeHtml(confidenceMix(row))}</span>` },
            { label: "Review-only", render: (row) => formatNumber(row.reviewOnlySignals || 0) },
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), withSegment({ salesperson: row.name })) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), withSegment({ salesperson: row.name })) },
            { label: "Follow-up signals", render: (row) => dataLink("calls.followUpRequired", formatNumber(row.followUpRequired), withSegment({ salesperson: row.name })) },
            { label: "Avg duration", render: (row) => `${formatNumber(row.averageDurationSeconds)}s` }
          ], salespersonRows)}
        </section>

        <section class="panel" id="sources">
          <div class="panel-header">
            <div>
              <h2>Source / List Quality</h2>
              <p class="muted small">Source quality uses import-source fields only. Redacted phone values are not used.</p>
            </div>
          </div>
          ${table([
            { label: "Source", key: "name" },
            { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), withSegment({ source: row.name })) },
            { label: "Transcript coverage", render: (row) => formatPercent(row.transcriptCoverageRate) },
            { label: "Confidence mix", render: (row) => `<span class="muted small">${escapeHtml(confidenceMix(row))}</span>` },
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), withSegment({ source: row.name })) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), withSegment({ source: row.name })) },
            { label: "Follow-up rate", render: (row) => dataLink("calls.followUpRequired", formatPercent(row.followUpRequiredRate), withSegment({ source: row.name })) },
          ], sourceRows)}
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("records")}>
        <section class="panel" id="explorer">
          <div class="panel-header">
            <div>
              <h2>Raw Call Explorer</h2>
              <p class="muted small">Shows sanitized source fields, local outcomes, proof summaries, and transcript previews.</p>
            </div>
            ${badge(`${formatNumber(explorerRows.length)} recent calls`, "neutral")}
          </div>
          ${table([
            { label: "Call", render: (row) => callLink(row.callId) },
            { label: "Customer ID", render: (row) => customerIdCell(row) },
            { label: "Time", render: (row) => escapeHtml(formatSourceTime(row)) },
            { label: "Salesperson", key: "salesperson" },
            { label: "Type", key: "callType" },
            { label: "Business", key: "businessSegmentLabel" },
            { label: "Duration", render: (row) => `${formatNumber(row.durationSeconds)}s` },
            { label: "Contact", key: "contactClassification" },
            { label: "Review", render: (row) => `${managerReviewBadge(row, reviewSummaryMap)}<br />${managerCorrectionSummary(row, reviewSummaryMap)}<br />${managerSuggestedCorrectionSummary(row, reviewSummaryMap)}` },
            { label: "Provenance", render: (row) => `${provenanceBadge(row.contactClassificationProvenance || "Deterministic")} ${provenanceBadge(managerReviewState(row, persistence))}` },
            { label: "Confidence", render: (row) => confidenceBadgeForRow(row) },
            { label: "Derived outcome", render: (row) => `${escapeHtml(row.localOutcome)}<br />${provenanceBadge(row.localOutcomeProvenance || "Deterministic")}${row.managerCorrectedOutcome ? `<br />${provenanceBadge("Manager-reviewed")} <span class="muted small">${escapeHtml(row.managerCorrectedOutcome)}</span>` : ""}` },
            { label: "Proof", render: (row) => renderEvidenceSummary(row) }
          ], explorerRows, "No call rows loaded.")}
          <details>
            <summary>Analysis metadata</summary>
            <pre>${escapeHtml(JSON.stringify({
              schemaVersion: data.schemaVersion,
              sourceName: data.sourceName,
              generatedAt: data.generatedAt,
              inputHash: data.inputHash,
              ignoredFields: data.ignoredFields,
              missingColumns: data.missingColumns
            }, null, 2))}</pre>
          </details>
        </section>
        </div>
        </div>
      </main>
    </div>
    <script>
      (() => {
        const fileInput = document.querySelector("[data-knowledgebase-file-input]");
        if (!fileInput) return;
        const form = fileInput.closest("form");
        const status = document.querySelector("[data-knowledgebase-file-status]");
        const titleInput = form ? form.querySelector("input[name='title']") : null;
        const contentInput = form ? form.querySelector("textarea[name='content']") : null;
        const setStatus = (message) => {
          if (status) status.textContent = message || "";
        };
        fileInput.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 524288) {
            setStatus("Max 512KB");
            fileInput.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result || "").trim();
            if (!text) {
              setStatus("File was empty");
              fileInput.value = "";
              return;
            }
            if (titleInput && !titleInput.value.trim()) {
              titleInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
            }
            if (contentInput) contentInput.value = text;
            setStatus("Loaded; review then save");
            fileInput.value = "";
          };
          reader.onerror = () => {
            setStatus("Could not read file");
            fileInput.value = "";
          };
          reader.readAsText(file);
        });
      })();
      (() => {
        const input = document.querySelector("[data-logo-input]");
        const status = document.querySelector("[data-logo-status]");
        const logos = document.querySelectorAll("[data-brand-logo]");
        if (!input) return;
        const setStatus = (message) => {
          if (status) status.textContent = message || "";
        };
        input.addEventListener("change", () => {
          const file = input.files && input.files[0];
          if (!file) return;
          if (!/^image\\/(png|jpeg|webp)$/.test(file.type)) {
            setStatus("PNG, JPG, or WebP only");
            input.value = "";
            return;
          }
          if (file.size > 786432) {
            setStatus("Max 768KB");
            input.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              setStatus("Uploading...");
              const response = await fetch("/api/branding/logo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataUrl: reader.result })
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok || !payload.ok) throw new Error(payload.error || "Upload failed");
              const nextSrc = "/branding/logo?t=" + Date.now();
              logos.forEach((logo) => { logo.src = nextSrc; });
              setStatus("Saved");
            } catch (error) {
              setStatus(error.message || "Upload failed");
            } finally {
              input.value = "";
            }
          };
          reader.readAsDataURL(file);
        });
      })();
    </script>
  </body>
</html>`;
}

function renderReportPage(report) {
  const reportTitle = report?.title || "Report not found";
  const hasReport = Boolean(report);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(reportTitle)} - Sales Dashboard</title>
    <style>
      ${COLUMN_HELP_STYLES}
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      :root {
        --background: #080A0F;
        --surface: #0D1117;
        --surface-elevated: #131A24;
        --surface-soft: #182131;
        --border: #263244;
        --border-subtle: #1D2735;
        --foreground: #F4F7FB;
        --muted-foreground: #8A94A6;
        --primary: #C9A45C;
        --accent: #56D6E5;
        --success: #34D399;
        --warning: #F59E0B;
        --danger: #F87171;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 40px;
        display: grid;
        gap: 16px;
      }
      .topbar, .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .topbar {
        padding: 18px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .page-title {
        display: flex;
        gap: 18px;
        align-items: flex-start;
        min-width: 0;
      }
      .page-brand {
        display: inline-flex;
        align-items: center;
        min-width: 174px;
        max-width: 220px;
        padding-top: 3px;
      }
      .page-brand img {
        display: block;
        width: 100%;
        height: auto;
      }
      .panel { padding: 20px; overflow: hidden; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.12; font-weight: 800; }
      h2 { color: var(--foreground); font-size: 18px; margin: 22px 0 10px; }
      p { margin: 8px 0; color: var(--muted-foreground); }
      ul { margin: 8px 0 16px; padding-left: 22px; }
      li { margin: 5px 0; }
      li::marker { color: var(--primary); }
      .page-kicker {
        color: var(--primary);
        font-size: 12px;
        font-weight: 760;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .muted { color: var(--muted-foreground); }
      .small { font-size: 13px; }
      .mono { font-family: "Geist Mono", "Cascadia Code", Consolas, monospace; font-size: 12px; font-variant-numeric: tabular-nums; }
      .open-link, .button-link {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 6px;
        background: var(--surface-elevated);
        border: 1px solid var(--border);
        color: var(--accent);
        text-decoration: none;
        font-weight: 760;
      }
      .open-link:hover, .button-link:hover {
        color: var(--foreground);
        border-color: rgba(86, 214, 229, 0.58);
      }
      .metadata {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .drill-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 4px;
      }
      .meta-card {
        padding: 11px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .meta-card span { display: block; color: var(--muted-foreground); font-size: 12px; margin-bottom: 4px; }
      .meta-card strong { color: var(--foreground); overflow-wrap: anywhere; }
      .table-wrap {
        max-width: 100%;
        overflow-x: auto;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        margin: 12px 0 18px;
      }
      table {
        width: 100%;
        min-width: 760px;
        border-collapse: collapse;
      }
      th, td {
        padding: 10px;
        border-bottom: 1px solid var(--border-subtle);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted-foreground);
        background: var(--surface-elevated);
        text-transform: uppercase;
        font-size: 11px;
      }
      tbody tr:hover { background: rgba(86, 214, 229, 0.035); }
      pre {
        max-width: 100%;
        overflow-x: auto;
        padding: 14px;
        border-radius: 8px;
        background: #05070B;
        color: var(--foreground);
        border: 1px solid var(--border-subtle);
        font: 12px/1.55 "Geist Mono", "Cascadia Code", Consolas, monospace;
      }
      summary {
        color: var(--foreground);
        cursor: pointer;
        font-weight: 760;
        padding-top: 14px;
      }
      @media (max-width: 760px) {
        main { width: min(100vw - 24px, 1180px); padding: 12px 0 32px; }
        .topbar, .page-title { flex-direction: column; }
        .page-brand { min-width: 0; width: 190px; }
        .metadata { grid-template-columns: 1fr; }
        table { min-width: 0; table-layout: fixed; }
        td { overflow-wrap: anywhere; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div class="page-title">
          <a class="page-brand" href="/#overview"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></a>
          <div>
            <p class="page-kicker">Saved report</p>
            <h1>${escapeHtml(reportTitle)}</h1>
            <p class="muted">${hasReport ? escapeHtml(report.summary || "Saved report") : "This report does not exist."}</p>
          </div>
        </div>
        <a class="button-link" href="/#reports">Back to Reports</a>
      </header>
      ${hasReport ? `<section class="panel">
        <div class="metadata">
          <div class="meta-card"><span>Report ID</span><strong class="mono">${escapeHtml(report.id)}</strong></div>
          <div class="meta-card"><span>Type</span><strong>${escapeHtml(report.type || "report")}</strong></div>
          <div class="meta-card"><span>Source</span><strong>${escapeHtml(report.source || "unknown")}</strong></div>
          <div class="meta-card"><span>Updated</span><strong>${escapeHtml(formatDateTime(report.updatedAt || report.createdAt))}</strong></div>
        </div>
        <div class="report-content">
          ${renderReportDrilldownPanel(report)}
          ${renderReportContent(report.content || report.summary || "")}
        </div>
        <details>
          <summary>Raw report record</summary>
          <pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
        </details>
      </section>` : `<section class="panel"><p>Use the Reports Library to open an existing report.</p></section>`}
    </main>
  </body>
</html>`;
}

module.exports = {
  renderCallPage,
  renderDashboard,
  renderDrilldownPage,
  renderEvaluationStudioPage,
  renderEmptyState,
  renderReportPage,
  escapeHtml
};
