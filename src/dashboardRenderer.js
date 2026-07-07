"use strict";

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
  const start = new Date(range.start);
  const end = new Date(range.end);
  return `${start.toLocaleDateString("en-AU")} ${start.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return `${parsed.toLocaleDateString("en-AU")} ${parsed.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDays(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return `${formatNumber(Math.round(Number(value)))}d`;
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

function customerIdCell(row, href = "") {
  const value = customerIdValue(row);
  const content = `<span class="mono">${escapeHtml(value)}</span>`;
  return href && value !== "Not available"
    ? `<a class="data-link mono" href="${escapeHtml(href)}">${escapeHtml(value)}</a>`
    : content;
}

function badge(label, tone = "neutral") {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
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
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
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
        ${evidence ? `<div class="audit-evidence">${escapeHtml(compactText(evidence, 220))}</div>` : ""}
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
      ${badge(qualityLabel, toneForResultQuality(quality))}
      ${needsRerun ? badge("Needs rerun", "critical") : ""}
    </summary>
    <div class="audit-grid">
      <div class="audit-section">
        <h3>Model Summary</h3>
        <div class="audit-kv">
          <span>Confidence</span><strong class="mono">${escapeHtml(formatConfidence(row.llm_confidence))}</strong>
          <span>Outcome</span><strong>${escapeHtml(row.overall_call_outcome || "unknown")}</strong>
          <span>Sentiment</span><strong>${escapeHtml(row.customer_sentiment || "unknown")}</strong>
          <span>Decision maker</span><strong>${escapeHtml(row.decision_maker_status || "unknown")}</strong>
          <span>Lead score</span><strong class="mono">${formatNumber(row.lead_utilization_score)} / 5</strong>
          <span>Salesperson score</span><strong class="mono">${formatNumber(row.salesperson_quality_score)} / 100</strong>
        </div>
        <p class="audit-reason">${escapeHtml(row.brief_reason || row.lead_reason || "No model summary reason was stored.")}</p>
        <p class="audit-evidence">${escapeHtml(compactText(row.evidence_snippet || "", 360))}</p>
        <div class="stack">
          ${row.lead_waste_risk ? badge("Lead waste risk", "critical") : ""}
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
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
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
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function renderReportDrilldownPanel(report) {
  if (!report || report.type !== "lead_utilization_report") return "";
  const links = [
    ["Potential wasted indicators", "lead.wastedLeadIndicators"],
    ["Missed callbacks", "lead.callbackMissedSameDay"],
    ["Single-attempt no-contact", "lead.singleAttemptNoContact"],
    ["Future callbacks pending", "lead.callbackFutureNeedsUpload"],
    ["No-contact retried", "lead.noContactRetriedSameDay"]
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
    totals: {},
    rates: {},
    ignoredFields: [],
    unsupportedMetrics: [],
    missingColumns: [],
    alerts: [],
    reviewQueue: [],
    salespersonScorecards: [],
    sourceMetrics: [],
    sourceQuality: {
      totals: {},
      sourceRows: [],
      creatorRows: [],
      createdByTypeRows: [],
      importAgeBuckets: [],
      creatorAgeBuckets: [],
      newBusinessImportAgeThresholds: [],
      lowestHumanAnswerSource: null,
      lowestHumanAnswerSources: []
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
        managerReviews: 0,
        currentAlertEvents: 0,
        currentManagerReviews: 0,
        acknowledgedAlerts: 0
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
    outcome_mismatch: "Imported outcome may not match transcript",
    complaint: "Complaint or risk wording found",
    opt_out: "Opt-out request found"
  };
  return labels[signal] || String(signal || "Transcript proof").replace(/_/g, " ");
}

function evidenceItems(row) {
  return Array.isArray(row?.evidence) ? row.evidence.filter((item) => item) : [];
}

function evidenceSummary(row, fallback = "Open the call proof to review transcript evidence") {
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
  if (row?.transcriptPreview) return compactText(row.transcriptPreview);
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

function renderTurnList(turns, emptyMessage = "No ordered speaker turns were detected for this excerpt.") {
  const rows = (turns || []).filter((turn) => turn?.text);
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return `<div class="turn-list">
    ${rows.map((turn) => `<div class="turn ${turn.matched ? "matched" : ""}">
      <div class="speaker">${escapeHtml(turn.speaker || "Transcript")}</div>
      <div>${escapeHtml(turn.text)}</div>
    </div>`).join("")}
  </div>`;
}

function renderEvidenceProofCards(items) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) {
    return `<div class="empty">No evidence snippets were generated for this call.</div>`;
  }

  return `<div class="proof-list">
    ${rows.map((item) => `<article class="proof-card">
      <div class="proof-head">
        <strong>${escapeHtml(item.summary || signalLabel(item.signal))}</strong>
        <span class="muted small">${escapeHtml(signalLabel(item.signal))} | ${Math.round(Number(item.confidence || 0) * 100)}%</span>
      </div>
      ${item.matchText ? `<p class="muted small">Matched phrase: <span class="mono">${escapeHtml(item.matchText)}</span></p>` : ""}
      ${item.turns?.length ? renderTurnList(item.turns) : `<p class="proof-text">${escapeHtml(item.text || "No ordered speaker turns were detected for this proof point.")}</p>`}
    </article>`).join("")}
  </div>`;
}

function renderDrilldownPage(result) {
  const rows = result.rows || [];
  const baseParams = {
    metric: result.metric,
    ...(result.filters?.salesperson ? { salesperson: result.filters.salesperson } : {}),
    ...(result.filters?.source ? { source: result.filters.source } : {}),
    ...(result.filters?.customerId ? { customerId: result.filters.customerId } : {}),
    ...(result.filters?.createdBy ? { createdBy: result.filters.createdBy } : {}),
    ...(result.filters?.createdByType ? { createdByType: result.filters.createdByType } : {}),
    ...(result.filters?.importAgeBucket ? { importAgeBucket: result.filters.importAgeBucket } : {}),
    ...(result.filters?.createAgeBucket ? { createAgeBucket: result.filters.createAgeBucket } : {}),
    ...(result.filters?.minImportAgeDays !== null && result.filters?.minImportAgeDays !== undefined ? { minImportAgeDays: result.filters.minImportAgeDays } : {}),
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
    result.filters?.salesperson ? `Salesperson: ${result.filters.salesperson}` : "",
    result.filters?.source ? `Source: ${result.filters.source}` : "",
    result.filters?.customerId ? `Customer ID: ${result.filters.customerId}` : "",
    result.filters?.createdBy ? `Created by: ${result.filters.createdBy}` : "",
    result.filters?.createdByType ? `Creator type: ${result.filters.createdByType}` : "",
    result.filters?.importAgeBucket ? `Import age: ${result.filters.importAgeBucket}` : "",
    result.filters?.createAgeBucket ? `Create age: ${result.filters.createAgeBucket}` : "",
    result.filters?.minImportAgeDays !== null && result.filters?.minImportAgeDays !== undefined ? `Imported older than: ${result.filters.minImportAgeDays} days` : "",
    result.filters?.businessSegmentLabel ? `Business: ${result.filters.businessSegmentLabel}` : ""
  ].filter(Boolean);
  const visibleStart = result.count ? (result.offset || 0) + 1 : 0;
  const visibleEnd = result.count ? (result.offset || 0) + result.displayedCount : 0;

  const rowTable = isLead
    ? table([
      { label: "Day", key: "day" },
      { label: "Customer ID", render: (row) => customerIdCell(row) },
      { label: "Salesperson", key: "salesperson" },
      { label: "Stable lead", render: (row) => `<span class="mono">${escapeHtml(row.stableLeadSource)}:${escapeHtml(row.stableLeadValue)}</span>` },
      { label: "Reason", key: "reason" },
      { label: "Calls", render: (row) => row.callIds.map((callId) => callLink(callId)).join("<br />") },
      { label: "Proof", render: (row) => renderEvidenceSummary(row, { fallback: row.reason }) }
    ], rows, "No lead-day records match this drill-down.")
    : table([
      { label: "Call", render: (row) => callLink(row.callId) },
      { label: "Customer ID", render: (row) => customerIdCell(row) },
      { label: "Time", render: (row) => `${escapeHtml(row.date)} ${escapeHtml(row.time)}` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Source", key: "source" },
      { label: "Business", key: "businessSegmentLabel" },
      { label: "Import age", render: (row) => formatDays(row.daysSinceImport) },
      { label: "Created by", render: (row) => row.customerCreatedBy ? `${escapeHtml(row.customerCreatedBy)}<br /><span class="muted small">${escapeHtml(row.customerCreatedByType || "Unknown")}</span>` : `<span class="muted">n/a</span>` },
      { label: "Duration", render: (row) => `${formatNumber(row.durationSeconds)}s` },
      { label: "Contact", key: "contactClassification" },
      { label: "Outcome", key: "localOutcome" },
      { label: "Follow-up", key: "followUpStatus" },
      { label: "Proof", render: (row) => renderEvidenceSummary(row) }
    ], rows, "No call records match this drill-down.");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(result.title)} - Sales Dashboard</title>
    <style>
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
          <span class="badge">${escapeHtml(isLead ? "Lead-day proof" : "Call-row proof")}</span>
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
    { field: "CustomerImportSource", value: call.customerImportSource || call.source || "Unknown source" },
    { field: "CustomerImportDate", value: call.customerImportDateIso || "Not available", mono: true },
    { field: "Bulk source age", value: formatDays(call.daysSinceImport), mono: true },
    { field: "CustomerCreatedBy", value: call.customerCreatedBy || "Not available" },
    { field: "CustomerCreatedByType", value: call.customerCreatedByType || "Not available" },
    { field: "CustomerCreateDate", value: call.customerCreateDateIso || "Not available", mono: true },
    { field: "Manual creation age", value: formatDays(call.daysSinceCreated), mono: true }
  ], "No source attribution fields available for this call.");
}

function renderReviewHistory(reviews) {
  return table([
    { label: "Status", key: "status" },
    { label: "Outcome", key: "confirmedOutcome" },
    { label: "Follow-up required", render: (row) => row.confirmedFollowUpRequired ? "Yes" : "No" },
    { label: "Notes", key: "notes" },
    { label: "Reviewed", render: (row) => formatDateTime(row.updatedAt || row.createdAt) }
  ], reviews || [], "No manager reviews saved for this call.");
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

function dashboardSegmentUrl(segment = "") {
  return segment ? `/?businessSegment=${encodeURIComponent(segment)}#business-split` : "/#business-split";
}

function intelligenceQueueLabel(queue) {
  const labels = {
    waste: "Lead Waste",
    manager_review: "Manager Review",
    llm_completed: "LLM Completed",
    llm_queued: "LLM Queued",
    high_quality: "High Quality"
  };
  return labels[queue] || "Lead Waste";
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
            <p class="muted">${call ? `Customer ID ${escapeHtml(customerIdValue(call))} | ${escapeHtml(call.salesperson)} | ${escapeHtml(call.date)} ${escapeHtml(call.time)} | ${escapeHtml(call.source)}` : "This call was not found in the current import."}</p>
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
            { item: "Contact", value: call.contactClassification },
            { item: "Local outcome", value: call.localOutcome },
            { item: "Imported NoSaleType", value: call.importedNoSale },
            { item: "Follow-up status", value: call.followUpStatus },
            { item: "Follow-up channel", value: call.followUpChannel },
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
        <h2>Evidence</h2>
        <p class="muted small" style="margin-bottom: 12px;">Tables show the summary. These ordered transcript turns show the proof behind it.</p>
        ${renderEvidenceProofCards(evidenceRows)}
      </section>
      <section class="panel">
        <h2>LLM Audit Extraction</h2>
        <p class="muted small" style="margin-bottom: 12px;">This is the model extraction saved in SQLite for this call, separate from the raw transcript proof below.</p>
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
        <h2>Readable Transcript</h2>
        ${renderTurnList(call.transcriptTurns || [], "No speaker turns were detected. Use the raw transcript below for audit.")}
      </section>
      <section class="panel">
        <h2>Raw Transcript</h2>
        <pre>${escapeHtml(call.transcript || "No transcript text available.")}</pre>
      </section>
      ${renderAiExecutionPanel(call, options)}
      <section class="grid-2">
        <div class="panel">
          <h2>Manager Review</h2>
          <form method="post" action="/reviews">
            <input type="hidden" name="callId" value="${escapeHtml(call.callId)}" />
            <input type="hidden" name="importId" value="${escapeHtml(options.importId || "")}" />
            <input type="hidden" name="returnTo" value="${escapeHtml(options.returnTo || `/calls/${encodeURIComponent(call.callId)}`)}" />
            <div class="form-grid">
              <label>Status
                <select name="status">
                  <option value="confirmed">Confirmed correct</option>
                  <option value="incorrect">Incorrect / false positive</option>
                  <option value="follow_up_elsewhere">Follow-up happened elsewhere</option>
                  <option value="needs_review">Needs more review</option>
                </select>
              </label>
              <label>Confirmed outcome
                <input name="confirmedOutcome" value="${escapeHtml(call.localOutcome || "")}" />
              </label>
            </div>
            <label style="margin: 10px 0;">
              <span><input style="width: auto;" type="checkbox" name="confirmedFollowUpRequired" /> Follow-up required</span>
            </label>
            <label>Notes
              <textarea name="notes" placeholder="Why is this correct or incorrect?"></textarea>
            </label>
            <div style="margin-top: 10px;"><button type="submit">Save Review</button></div>
          </form>
        </div>
        <div class="panel">
          <h2>Review History</h2>
          ${renderReviewHistory(options.reviews || [])}
        </div>
      </section>` : `<section class="panel"><div class="empty">Use a call link from a drill-down page or the explorer.</div></section>`}
    </main>
  </body>
</html>`;
}

function renderDashboard(analysis, options = {}) {
  const sourceData = analysis || renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export.");
  const activeSegment = normalizeBusinessSegment(options.businessSegment || options.segment);
  const data = scopedDashboardData(sourceData, activeSegment);
  const segmentLabel = businessSegmentLabel(activeSegment);
  const segmentFilters = activeSegment ? { businessSegment: activeSegment } : {};
  const withSegment = (filters = {}) => ({ ...filters, ...segmentFilters });
  const activeIntelligenceQueue = String(options.intelligenceQueue || "waste").trim() || "waste";
  const intelligenceFilterBase = {
    ...segmentFilters,
    intelligenceQueue: activeIntelligenceQueue
  };
  const hasData = Boolean(analysis && analysis.totals && analysis.totals.uniqueCalls);
  const criticalAlerts = data.alerts.filter((alert) => alert.severity === "critical").length;
  const warningAlerts = data.alerts.filter((alert) => alert.severity === "warning").length;
  const noticeAlerts = data.alerts.filter((alert) => alert.severity === "notice").length;
  const persistence = data.persistence || renderEmptyState("").persistence;
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
  const sourceQualityAgeRows = (sourceQuality.importAgeBuckets || []).slice(0, 8);
  const sourceQualityThresholdRows = sourceQuality.newBusinessImportAgeThresholds || [];
  const sourceQualityWorstSource = sourceQuality.lowestHumanAnswerSource || null;
  const intelligenceSalespersonRows = (intelligence.salespeople || []).slice(0, 10);
  const intelligenceSourceRows = (intelligence.sources || []).slice(0, 10);
  const intelligenceQueueRows = options.intelligenceCalls || [];
  const alertRows = data.alerts.slice(0, 80);
  const reviewRows = data.reviewQueue.slice(0, 80);
  const explorerRows = data.explorerRows.slice(0, 120);
  const importRows = persistence.importHistory.slice(0, 10);
  const reportRows = persistence.reports.slice(0, 10);
  const uniqueCalls = Number(data.totals.uniqueCalls || 0);
  const transcriptCoverage = Number(data.rates.transcriptCoverage || 0);
  const liveHumanRate = Number(data.rates.probableLiveHuman || 0);
  const meaningfulRate = Number(data.rates.meaningfulConversation || 0);
  const followUpRate = Number(data.rates.followUpRequired || 0);
  const riskReviewRate = percentOf(data.totals.riskReviews, uniqueCalls);
  const leadRiskRate = Number(leadTotals.riskRate || 0) * 100;
  const totalUniqueCalls = Number(sourceData.totals.uniqueCalls || 0);
  const warmBusinessCalls = Number(sourceData.totals.warmBusinessCalls || 0);
  const newBusinessCalls = Number(sourceData.totals.newBusinessCalls || Math.max(0, totalUniqueCalls - warmBusinessCalls));
  const warmBusinessRate = Number(sourceData.rates.warmBusiness || percentOf(warmBusinessCalls, totalUniqueCalls));
  const newBusinessRate = Number(sourceData.rates.newBusiness || percentOf(newBusinessCalls, totalUniqueCalls));
  const sourceAge90 = sourceQualityThresholdRows.find((row) => Number(row.thresholdDays) === 90) || { thresholdDays: 90, calls: 0, rate: 0 };
  const scopeNote = activeSegment
    ? `${segmentLabel} results only. Click All Business to return to the full dashboard.`
    : "All calls are included. Click New Business or Warm Business to scope the results below.";
  const queueFilterUrl = (filters = {}) => dashboardFilterUrl({
    ...segmentFilters,
    intelligenceQueue: activeIntelligenceQueue,
    ...filters
  }, "intelligence-queue");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Dashboard</title>
    <style>
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
      .brand-status {
        color: var(--muted-foreground);
        font-size: 12px;
      }
      nav {
        display: grid;
        gap: 4px;
        min-width: 0;
        max-width: 100%;
        padding-top: 14px;
        border-top: 1px solid var(--border-subtle);
        scrollbar-width: none;
      }
      nav::-webkit-scrollbar { display: none; }
      nav a {
        color: var(--muted-foreground);
        text-decoration: none;
        padding: 9px 10px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
      }
      nav a:hover {
        color: var(--foreground);
        background: var(--surface-elevated);
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
        nav { grid-auto-flow: column; overflow-x: auto; }
        .command-grid { grid-template-columns: 1fr; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-2, .guardrails, .audit-grid { grid-template-columns: 1fr; }
        .command-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { padding: 16px; }
        .topbar, .panel-header, aside { flex-direction: column; align-items: stretch; }
        nav { grid-auto-flow: row; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
        nav a { padding: 8px 6px; font-size: 13px; }
        .metrics { grid-template-columns: 1fr; }
        .segment-split { grid-template-columns: 1fr; }
        .command-meta, .pipeline-row { grid-template-columns: 1fr; }
        .pipeline-value { text-align: left; }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <div class="brand">
          <div class="brand-logo"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></div>
          <div>
            <div class="brand-title">Sales Dashboard</div>
            <p class="brand-subtitle">Call intelligence, lead utilization, and manager review evidence.</p>
          </div>
          <div class="brand-tools">
            <label class="logo-upload">
              <span class="upload-button">Upload logo</span>
              <input data-logo-input type="file" accept="image/png,image/jpeg,image/webp" />
            </label>
            <span class="brand-status" data-logo-status></span>
          </div>
        </div>
        <nav aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
          <a href="#business-split">Business Split</a>
          <a href="#source-quality">Source Quality</a>
          <a href="#intelligence">Intelligence</a>
          <a href="#lead-utilization">Lead Use</a>
          <a href="#confidence">Data Confidence</a>
          <a href="#history">Imports</a>
          <a href="#reports">Reports</a>
          <a href="#alerts">Alerts</a>
          <a href="#salespeople">Salespeople</a>
          <a href="#sources">Sources</a>
          <a href="#explorer">Explorer</a>
        </nav>
      </aside>
      <main>
        <header class="topbar" id="overview">
          <div>
            <p class="page-kicker">Executive command centre</p>
            <h1>Sales Dashboard</h1>
            <p class="muted">Local CSV transcript analysis with privacy-safe matching, lead utilization proof, and confidence-aware metrics.</p>
          </div>
          <div class="stack">
            ${hasData ? badge("CSV loaded", "success") : badge("No CSV loaded", "warning")}
            ${activeSegment ? badge(`${segmentLabel} view`, "notice") : ""}
            ${badge(formatDateRange(data.dateRange), "neutral")}
          </div>
        </header>

        ${!hasData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}

        <section class="command-grid" aria-label="Executive command overview">
          <article class="command-panel primary">
            <div class="command-panel-inner">
              <p class="page-kicker">Primary operating signal</p>
              <h2>Conversation Quality</h2>
              <div class="command-value mono">${formatPercent(meaningfulRate)}</div>
              <p class="muted small" style="margin-top: 10px;">${formatNumber(data.totals.meaningfulConversation)} meaningful conversations from ${formatNumber(uniqueCalls)} unique calls.</p>
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
                ${pipelineBar("New business", `${formatNumber(newBusinessCalls)} (${formatPercent(newBusinessRate)})`, newBusinessRate, "accent", dashboardSegmentUrl("new"))}
                ${pipelineBar("Warm business", `${formatNumber(warmBusinessCalls)} (${formatPercent(warmBusinessRate)})`, warmBusinessRate, "primary", dashboardSegmentUrl("warm"))}
                ${pipelineBar("Transcript coverage", formatPercent(transcriptCoverage), transcriptCoverage, "accent", drilldownUrl("calls.transcriptAvailable", withSegment()))}
                ${pipelineBar("Probable live-human", formatPercent(liveHumanRate), liveHumanRate, "primary", drilldownUrl("calls.probableLiveHuman", withSegment()))}
                ${pipelineBar("Meaningful", formatPercent(meaningfulRate), meaningfulRate, "success", drilldownUrl("calls.meaningfulConversation", withSegment()))}
                ${pipelineBar("Follow-up signals", formatPercent(followUpRate), followUpRate, "warning", drilldownUrl("calls.followUpRequired", withSegment()))}
                ${pipelineBar("Risk reviews", formatPercent(riskReviewRate), riskReviewRate, "danger", drilldownUrl("calls.riskReviews", withSegment()))}
                ${pipelineBar("Lead risk indicators", formatRatioPercent(leadTotals.riskRate), leadRiskRate, "danger", drilldownUrl("lead.wastedLeadIndicators", withSegment()))}
              </div>
            </div>
          </article>
        </section>

        <section class="panel" id="business-split">
          <div class="panel-header">
            <div>
              <h2>New Business vs Warm Business</h2>
              <p class="muted small">${escapeHtml(scopeNote)}</p>
            </div>
            <div class="segment-actions">
              <a class="filter-link ${activeSegment ? "" : "selected"}" href="${escapeHtml(dashboardSegmentUrl(""))}">All Business</a>
              ${badge("OrderCount based", "neutral")}
            </div>
          </div>
          <div class="panel-body segment-split">
            <a class="segment-card accent ${activeSegment === "new" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentUrl("new"))}" aria-current="${activeSegment === "new" ? "true" : "false"}">
              <span>New Business</span>
              <strong class="mono">${formatNumber(newBusinessCalls)}</strong>
              <small>${formatPercent(newBusinessRate)} of unique calls | click to filter dashboard</small>
            </a>
            <a class="segment-card primary ${activeSegment === "warm" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentUrl("warm"))}" aria-current="${activeSegment === "warm" ? "true" : "false"}">
              <span>Warm Business</span>
              <strong class="mono">${formatNumber(warmBusinessCalls)}</strong>
              <small>${formatPercent(warmBusinessRate)} of unique calls | click to filter dashboard</small>
            </a>
            <div class="segment-track" aria-label="New Business and Warm Business call split">
              <span class="segment-fill new" style="width: ${Math.max(0, Math.min(100, newBusinessRate)).toFixed(1)}%;"></span>
              <span class="segment-fill warm" style="width: ${Math.max(0, Math.min(100, warmBusinessRate)).toFixed(1)}%;"></span>
            </div>
          </div>
        </section>

        <section class="metrics" aria-label="Executive overview">
          ${metricCard("Unique calls", formatNumber(data.totals.uniqueCalls), `${formatNumber(data.totals.rawRows)} ${activeSegment ? "segment rows" : "raw rows"}, ${formatNumber(data.totals.duplicateCallIds)} duplicate IDs`, "info", drilldownUrl("calls.unique", withSegment()))}
          ${metricCard("Probable live-human rate", formatPercent(data.rates.probableLiveHuman), `${formatNumber(data.totals.probableLiveHuman)} calls with transcript evidence`, "good", drilldownUrl("calls.probableLiveHuman", withSegment()))}
          ${metricCard("Meaningful conversations", formatPercent(data.rates.meaningfulConversation), `${formatNumber(data.totals.meaningfulConversation)} calls qualify`, "good", drilldownUrl("calls.meaningfulConversation", withSegment()))}
          ${metricCard("Follow-up signals", formatNumber(data.totals.followUpRequired), `${formatNumber(data.totals.followUpIndeterminate)} need more future data`, "warn", drilldownUrl("calls.followUpRequired", withSegment()))}
          ${metricCard("Transcript coverage", formatPercent(data.rates.transcriptCoverage), `${formatNumber(data.totals.transcriptAvailable)} transcripts available`, "info", drilldownUrl("calls.transcriptAvailable", withSegment()))}
          ${metricCard("Outcome mismatches", formatNumber(data.totals.outcomeMismatches), `${formatPercent(data.rates.outcomeMismatch)} of unique calls`, "warn", drilldownUrl("calls.outcomeMismatches", withSegment()))}
          ${metricCard("Risk reviews", formatNumber(data.totals.riskReviews), "Complaint or opt-out style signals", "risk", drilldownUrl("calls.riskReviews", withSegment()))}
          ${metricCard("Reports stored", formatNumber(persistence.counts.reports), `${formatNumber(persistence.counts.imports)} saved import snapshots`, "info")}
        </section>

        <section class="panel" id="source-quality">
          <div class="panel-header">
            <div>
              <h2>Customer Source Quality</h2>
              <p class="muted small">Bulk source fields are CustomerImportDate and CustomerImportSource. Manual-entry fields are CustomerCreatedBy, CustomerCreatedByType, and CustomerCreateDate.</p>
            </div>
            ${badge(`${formatNumber(sourceQualityTotals.callsWithImportDate || 0)} import dates`, sourceQualityTotals.callsWithImportDate ? "success" : "warning")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Bulk sourced calls", formatNumber(sourceQualityTotals.callsWithBulkSource), `${formatPercent(sourceQualityTotals.bulkSourceCoverageRate)} source coverage`, "info", drilldownUrl("source.bulkSourced", withSegment()))}
            ${metricCard("New Business >90d import", formatNumber(sourceAge90.calls), `${formatPercent(sourceAge90.rate)} of New Business calls`, "risk", drilldownUrl("source.newBusinessImportedOlderThan", withSegment({ minImportAgeDays: 90 })))}
            ${metricCard("Manual LG/SP calls", formatNumber(sourceQualityTotals.callsWithManualCreator), `${formatNumber(sourceQualityTotals.leadGeneratorCreatedCalls)} LG, ${formatNumber(sourceQualityTotals.salespersonCreatedCalls)} SP`, "good", drilldownUrl("source.manualCreated", withSegment()))}
            ${metricCard("Worst human answer source", sourceQualityWorstSource ? sourceQualityWorstSource.name : "n/a", sourceQualityWorstSource ? `${formatPercent(sourceQualityWorstSource.probableLiveHumanRate)} from ${formatNumber(sourceQualityWorstSource.calls)} calls` : "Needs source data", "warn", sourceQualityWorstSource ? drilldownUrl("calls.unique", withSegment({ source: sourceQualityWorstSource.name })) : "")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>New Business Source Age</h2>
                <p class="muted small">Click a threshold to inspect New Business calls imported more than that many days before the call.</p>
              </div>
            </div>
            ${table([
              { label: "Imported older than", render: (row) => dataLink("source.newBusinessImportedOlderThan", `>${formatNumber(row.thresholdDays)}d`, withSegment({ minImportAgeDays: row.thresholdDays })) },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "Share", render: (row) => formatPercent(row.rate) }
            ], sourceQualityThresholdRows, "No valid CustomerImportDate values are available.")}
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
            { label: "Avg import age", render: (row) => formatDays(row.averageImportAgeDays) },
            { label: "New >90d", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatNumber(row.newBusinessImportedOlderThan90), withSegment({ source: row.name, minImportAgeDays: 90 })) }
          ], sourceQualitySourceRows, "No bulk source rows are available.")}
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Import Age Cohorts</h2>
                <p class="muted small">Cohorts use CustomerImportDate against the call date.</p>
              </div>
            </div>
            ${table([
              { label: "Age", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.unique", withSegment({ importAgeBucket: row.bucket })))}">${escapeHtml(row.bucket)}</a>` },
              { label: "Calls", render: (row) => formatNumber(row.calls) },
              { label: "New", render: (row) => formatNumber(row.newBusinessCalls) },
              { label: "Warm", render: (row) => formatNumber(row.warmBusinessCalls) },
              { label: "Human answer", render: (row) => formatPercent(row.probableLiveHumanRate) },
              { label: "Meaningful", render: (row) => formatPercent(row.meaningfulConversationRate) }
            ], sourceQualityAgeRows, "No import age cohorts are available.")}
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

        <section class="panel" id="intelligence">
          <div class="panel-header">
            <div>
              <h2>Transcript Intelligence</h2>
              <p class="muted small">Database-backed call deconstruction, lead-waste rollups, and local LLM extraction queue state.</p>
            </div>
            ${badge(`${formatNumber(intelligenceTotals.callsIndexed)} calls indexed`, intelligenceTotals.callsIndexed ? "success" : "warning")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Waste-risk leads", formatNumber(intelligenceTotals.wasteRiskLeads), `${formatNumber(intelligenceTotals.leadsIndexed)} leads indexed`, "risk", queueFilterUrl({ intelligenceQueue: "waste", wasteRisk: "1" }))}
            ${metricCard("High-quality utilized", formatNumber(intelligenceTotals.highQualityLeads), `Avg lead score ${Number(intelligenceTotals.avgLeadUtilizationScore || 0).toFixed(1)} / 5`, "good", queueFilterUrl({ intelligenceQueue: "high_quality", highQuality: "1" }))}
            ${metricCard("Repeated short attempts", formatNumber(intelligenceTotals.repeatedShortAttemptLeads), "Lead-level short/no-result pattern", "warn")}
            ${metricCard("Manager review calls", formatNumber(intelligenceTotals.managerReviewCalls), `${formatNumber(intelligenceTotals.riskFlagCalls)} calls have risk flags`, "risk", queueFilterUrl({ intelligenceQueue: "manager_review", managerReview: "1" }))}
            ${metricCard("LLM queued", formatNumber(intelligenceTotals.llmQueued), `${formatNumber(intelligenceTotals.llmCompleted)} completed, ${formatNumber(intelligenceTotals.llmFailed || 0)} failed, ${formatNumber(intelligenceTotals.llmNotRequested)} not requested`, "info", queueFilterUrl({ intelligenceQueue: "llm_queued", llmStatus: "queued" }))}
            ${metricCard("Database", "SQLite", intelligence.dbPath ? "Call intelligence is persisted locally" : "No database summary available", "info")}
          </div>
        </section>

        <section class="panel" id="intelligence-queue">
          <div class="panel-header">
            <div>
              <h2>Intelligence Review Queue</h2>
              <p class="muted small">${escapeHtml(intelligenceQueueLabel(activeIntelligenceQueue))} queue. Filtered call rows below preserve the New/Warm Business scope.</p>
            </div>
            ${badge(`${formatNumber(intelligenceQueueRows.length)} calls shown`, intelligenceQueueRows.length ? "notice" : "neutral")}
          </div>
          <div class="panel-body">
            <div class="stack" style="margin-bottom: 12px;">
              <a class="filter-link ${activeSegment === "new" && activeIntelligenceQueue === "waste" ? "selected" : ""}" href="${escapeHtml(dashboardFilterUrl({ businessSegment: "new", intelligenceQueue: "waste", wasteRisk: "1" }, "intelligence-queue"))}">New Business waste</a>
              <a class="filter-link ${activeSegment === "warm" && activeIntelligenceQueue === "waste" ? "selected" : ""}" href="${escapeHtml(dashboardFilterUrl({ businessSegment: "warm", intelligenceQueue: "waste", wasteRisk: "1" }, "intelligence-queue"))}">Warm Business waste</a>
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
              { label: "Lead state", render: (row) => row.lead_waste_risk ? badge("Waste-risk", "critical") : row.lead_high_quality_utilized ? badge("High quality", "success") : badge("Monitor", "neutral") },
              { label: "Review", render: (row) => row.manager_review_required ? badge("Manager", "critical") : badge("No", "neutral") },
              { label: "LLM", render: (row) => badge(row.llm_status || "not_requested", row.llm_status === "completed" ? "success" : row.llm_status === "queued" ? "notice" : row.llm_status === "failed" ? "critical" : "neutral") },
              { label: "Audit", render: (row) => `${badge(row.llm_result_quality_label || row.llm_status || "Not requested", toneForResultQuality(row.llm_result_quality || row.llm_status))}${row.llm_result_needs_rerun ? ` ${badge("Rerun", "critical")}` : ""}` },
              { label: "Reason", render: (row) => `<span class="evidence-summary">${escapeHtml(row.lead_reason || row.brief_reason || row.evidence_snippet || "")}<a class="proof-link" href="/calls/${encodeURIComponent(row.call_id)}">Open proof</a></span>` }
            ], intelligenceQueueRows, "No calls match this intelligence queue yet.")}
          </div>
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Lead Waste By Salesperson</h2>
                <p class="muted small">Lead-level rollup from transcript intelligence. This is the first-priority management view.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ salesperson: row.salesperson, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.salesperson)}</a>` },
              { label: "Leads", render: (row) => formatNumber(row.leads) },
              { label: "Waste-risk", render: (row) => formatNumber(row.wasteRiskLeads) },
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
                <p class="muted small">Secondary view: lead waste and utilization by import source.</p>
              </div>
            </div>
            ${table([
              { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(queueFilterUrl({ source: row.source, wasteRisk: "1", intelligenceQueue: "waste" }))}">${escapeHtml(row.source)}</a>` },
              { label: "Leads", render: (row) => formatNumber(row.leads) },
              { label: "Waste-risk", render: (row) => formatNumber(row.wasteRiskLeads) },
              { label: "Risk rate", render: (row) => formatRatioPercent(row.wasteRiskRate) },
              { label: "High-quality", render: (row) => formatNumber(row.highQualityLeads) },
              { label: "Repeated short", render: (row) => formatNumber(row.repeatedShortAttemptLeads) },
              { label: "Avg score", render: (row) => `${Number(row.avgScore || 0).toFixed(1)} / 5` }
            ], intelligenceSourceRows, "No transcript-intelligence source rows are available yet.")}
          </div>
        </section>

        <section class="panel" id="lead-utilization">
          <div class="panel-header">
            <div>
              <h2>Lead Utilization Proof</h2>
              <p class="muted small">Lead-day metrics use stable IDs only. Click any number to inspect the contributing lead-days and calls.</p>
            </div>
            ${badge(`${formatNumber(leadTotals.stableLeadDaysWorked)} lead-days`, "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Potential wasted indicators", formatNumber(leadTotals.wastedLeadIndicators), `${formatRatioPercent(leadTotals.riskRate)} of stable lead-days`, "risk", drilldownUrl("lead.wastedLeadIndicators", withSegment()))}
            ${metricCard("Missed explicit callbacks", formatNumber(leadTotals.callbackMissedSameDay), `${formatNumber(leadTotals.callbackCompletedSameDay)} completed same day`, "warn", drilldownUrl("lead.callbackMissedSameDay", withSegment()))}
            ${metricCard("Single-attempt no-contact", formatNumber(leadTotals.singleAttemptNoContact), "No live-human contact and no same-day retry", "risk", drilldownUrl("lead.singleAttemptNoContact", withSegment()))}
            ${metricCard("No-contact retry coverage", formatRatioPercent(leadTotals.noContactRetryRate), `${formatNumber(leadTotals.noContactRetriedSameDay)} of ${formatNumber(leadTotals.noContactLeadDays)} retried`, "info", drilldownUrl("lead.noContactRetriedSameDay", withSegment()))}
            ${metricCard("Future callbacks pending", formatNumber(leadTotals.callbackFutureNeedsUpload), "Needs later CSV uploads before judgement", "info", drilldownUrl("lead.callbackFutureNeedsUpload", withSegment()))}
            ${metricCard("Stable lead-days worked", formatNumber(leadTotals.stableLeadDaysWorked), `${formatNumber(leadTotals.callsWithoutStableLead)} calls lacked stable ID`, "good", drilldownUrl("lead.stableLeadDaysWorked", withSegment()))}
          </div>
        </section>

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
              <p class="muted small">NoSaleType: ${formatPercent(data.rates.noSaleCoverage)}<br />Baz notes: ${formatPercent(data.rates.bazNotesCoverage)}<br />Source: ${formatPercent(data.rates.sourceCoverage)}</p>
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
              { label: "Follow-ups", render: (row) => formatNumber(row.totals?.followUpRequired) },
              { label: "Mismatches", render: (row) => formatNumber(row.totals?.outcomeMismatches) }
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

        <section class="grid-2">
          <div class="panel" id="alerts">
            <div class="panel-header">
              <h2>Alert Centre</h2>
              <div class="stack">
                ${badge(`${criticalAlerts} critical`, criticalAlerts ? "critical" : "neutral")}
                ${badge(`${warningAlerts} warning`, warningAlerts ? "warning" : "neutral")}
                ${badge(`${noticeAlerts} notice`, noticeAlerts ? "notice" : "neutral")}
                ${badge(`${formatNumber(persistence.counts.acknowledgedAlerts)} acknowledged`, persistence.counts.acknowledgedAlerts ? "success" : "neutral")}
              </div>
            </div>
            ${table([
              { label: "Severity", render: (row) => badge(row.severity, row.severity === "critical" ? "critical" : row.severity === "warning" ? "warning" : "notice") },
              { label: "Customer ID", render: (row) => customerIdCell(row) },
              { label: "Category", key: "category" },
              { label: "Owner", key: "owner" },
              { label: "Call", render: (row) => callLink(row.callId) },
              { label: "Proof", render: (row) => renderEvidenceSummary(row, { fallback: row.message }) }
            ], alertRows, "No alert events found.")}
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
              { label: "Follow-up", key: "followUpStatus" },
              { label: "Proof", render: (row) => renderEvidenceSummary(row) }
            ], reviewRows, "No calls need manager review.")}
          </div>
        </section>

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
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), withSegment({ salesperson: row.name })) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), withSegment({ salesperson: row.name })) },
            { label: "Follow-up signals", render: (row) => dataLink("calls.followUpRequired", formatNumber(row.followUpRequired), withSegment({ salesperson: row.name })) },
            { label: "Mismatches", render: (row) => dataLink("calls.outcomeMismatches", formatNumber(row.outcomeMismatches), withSegment({ salesperson: row.name })) },
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
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), withSegment({ source: row.name })) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), withSegment({ source: row.name })) },
            { label: "Follow-up rate", render: (row) => dataLink("calls.followUpRequired", formatPercent(row.followUpRequiredRate), withSegment({ source: row.name })) },
            { label: "Mismatch rate", render: (row) => dataLink("calls.outcomeMismatches", formatPercent(row.outcomeMismatchRate), withSegment({ source: row.name })) }
          ], sourceRows)}
        </section>

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
            { label: "Time", render: (row) => `${escapeHtml(row.date)} ${escapeHtml(row.time)}` },
            { label: "Salesperson", key: "salesperson" },
            { label: "Type", key: "callType" },
            { label: "Business", key: "businessSegmentLabel" },
            { label: "Duration", render: (row) => `${formatNumber(row.durationSeconds)}s` },
            { label: "Contact", key: "contactClassification" },
            { label: "Local outcome", key: "localOutcome" },
            { label: "Imported", key: "importedNoSale" },
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
      </main>
    </div>
    <script>
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
  renderEmptyState,
  renderReportPage,
  escapeHtml
};
