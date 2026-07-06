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

function dataLink(metric, value, filters = {}) {
  return `<a class="data-link" href="${escapeHtml(drilldownUrl(metric, filters))}">${escapeHtml(value)}</a>`;
}

function callLink(callId, label = callId) {
  if (!callId) return "";
  return `<a class="data-link mono" href="/calls/${encodeURIComponent(callId)}">${escapeHtml(label)}</a>`;
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
    ...(result.filters?.source ? { source: result.filters.source } : {})
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
    result.filters?.source ? `Source: ${result.filters.source}` : ""
  ].filter(Boolean);
  const visibleStart = result.count ? (result.offset || 0) + 1 : 0;
  const visibleEnd = result.count ? (result.offset || 0) + result.displayedCount : 0;

  const rowTable = isLead
    ? table([
      { label: "Day", key: "day" },
      { label: "Salesperson", key: "salesperson" },
      { label: "Stable lead", render: (row) => `<span class="mono">${escapeHtml(row.stableLeadSource)}:${escapeHtml(row.stableLeadValue)}</span>` },
      { label: "Reason", key: "reason" },
      { label: "Calls", render: (row) => row.callIds.map((callId) => callLink(callId)).join("<br />") },
      { label: "Proof", render: (row) => renderEvidenceSummary(row, { fallback: row.reason }) }
    ], rows, "No lead-day records match this drill-down.")
    : table([
      { label: "Call", render: (row) => callLink(row.callId) },
      { label: "Time", render: (row) => `${escapeHtml(row.date)} ${escapeHtml(row.time)}` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Source", key: "source" },
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
      :root {
        --bg: #f4f6f7;
        --panel: #ffffff;
        --panel-alt: #f9fbfc;
        --ink: #16212d;
        --muted: #657383;
        --line: #dfe6ea;
        --accent: #0f766e;
        --accent-dark: #0b4f4a;
        --shadow: 0 14px 34px rgba(22, 33, 45, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background: var(--bg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
        background: var(--panel);
        border: 1px solid var(--line);
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
      .panel { padding: 18px; overflow: hidden; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.15; }
      .muted { color: var(--muted); }
      .small { font-size: 13px; }
      .stack, .drill-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .button-link, .data-link, .proof-link {
        color: var(--accent-dark);
        font-weight: 760;
        text-decoration: none;
      }
      .button-link {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 8px;
        background: #e6f4f2;
      }
      .data-link { border-bottom: 1px solid rgba(15, 118, 110, 0.35); }
      .proof-link { display: block; margin-top: 5px; font-size: 12px; }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        padding: 4px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 750;
        color: #506070;
        background: #edf1f4;
      }
      .mono { font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
      .table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
      table { width: 100%; min-width: 920px; border-collapse: collapse; }
      th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
      th { color: var(--muted); background: var(--panel-alt); text-transform: uppercase; font-size: 11px; }
      .evidence-summary { display: block; max-width: 260px; color: #3c4b59; line-height: 1.35; }
      .empty { padding: 18px; border: 1px dashed #b9c5cc; border-radius: 8px; color: var(--muted); background: var(--panel-alt); }
      @media (max-width: 760px) { .topbar { flex-direction: column; } }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div>
          <h1>${escapeHtml(result.title)}</h1>
          <p class="muted">${escapeHtml(result.description)}</p>
          <p class="muted small">${escapeHtml(filters.length ? filters.join(" | ") : "No extra filters")} · Showing ${formatNumber(visibleStart)}-${formatNumber(visibleEnd)} of ${formatNumber(result.count)} records.</p>
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

function renderCallPage(call, options = {}) {
  const callId = options.callId || call?.callId || "Unknown";
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
      :root {
        --bg: #f4f6f7;
        --panel: #ffffff;
        --panel-alt: #f9fbfc;
        --ink: #16212d;
        --muted: #657383;
        --line: #dfe6ea;
        --accent-dark: #0b4f4a;
        --shadow: 0 14px 34px rgba(22, 33, 45, 0.08);
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: var(--ink); background: var(--bg); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
      main { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 40px; display: grid; gap: 16px; }
      .topbar, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
      .topbar { padding: 18px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .panel { padding: 18px; overflow: hidden; }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.15; }
      h2 { font-size: 18px; margin-bottom: 12px; }
      h3 { font-size: 14px; margin-bottom: 8px; }
      .muted { color: var(--muted); }
      .small { font-size: 13px; }
      .grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
      .button-link, .data-link, button { color: var(--accent-dark); font-weight: 760; text-decoration: none; }
      .button-link, button { display: inline-flex; align-items: center; min-height: 34px; padding: 7px 11px; border-radius: 8px; background: #e6f4f2; border: 0; cursor: pointer; }
      .mono { font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
      .table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 14px; }
      table { width: 100%; min-width: 680px; border-collapse: collapse; }
      th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
      th { color: var(--muted); background: var(--panel-alt); text-transform: uppercase; font-size: 11px; }
      pre { max-height: 520px; overflow: auto; padding: 14px; border-radius: 8px; background: #101820; color: #eff6f7; font: 12px/1.55 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
      .proof-list, .turn-list { display: grid; gap: 10px; }
      .proof-card { padding: 13px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-alt); }
      .proof-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
      .proof-text { margin-top: 8px; color: #344454; line-height: 1.5; }
      .turn-list { max-height: 520px; overflow: auto; }
      .turn { display: grid; grid-template-columns: minmax(100px, 150px) minmax(0, 1fr); gap: 10px; padding: 9px; border: 1px solid var(--line); border-radius: 8px; background: #fff; line-height: 1.45; }
      .turn.matched { border-color: #0f766e; background: #ecfdf5; }
      .speaker { color: #344454; font-weight: 760; }
      label { display: grid; gap: 5px; font-size: 13px; font-weight: 700; color: #344454; }
      input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 9px; font: inherit; }
      textarea { min-height: 92px; resize: vertical; }
      .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .empty { padding: 18px; border: 1px dashed #b9c5cc; border-radius: 8px; color: var(--muted); background: var(--panel-alt); }
      @media (max-width: 860px) { .topbar, .grid-2 { grid-template-columns: 1fr; flex-direction: column; } .form-grid, .turn { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div>
          <h1>Call ${escapeHtml(callId)}</h1>
          <p class="muted">${call ? `${escapeHtml(call.salesperson)} · ${escapeHtml(call.date)} ${escapeHtml(call.time)} · ${escapeHtml(call.source)}` : "This call was not found in the current import."}</p>
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
        <h2>Sanitized Raw Source Fields</h2>
        <p class="muted small" style="margin-bottom: 12px;">The redacted phone field, CustomerCreateDate, and CustomerImportDate are intentionally excluded.</p>
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

function renderDashboard(analysis) {
  const data = analysis || renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export.");
  const hasData = Boolean(analysis && analysis.totals && analysis.totals.uniqueCalls);
  const criticalAlerts = data.alerts.filter((alert) => alert.severity === "critical").length;
  const warningAlerts = data.alerts.filter((alert) => alert.severity === "warning").length;
  const noticeAlerts = data.alerts.filter((alert) => alert.severity === "notice").length;
  const persistence = data.persistence || renderEmptyState("").persistence;
  const leadUtilization = data.leadUtilization || { totals: {} };
  const leadTotals = leadUtilization.totals || {};

  const salespersonRows = data.salespersonScorecards.slice(0, 18);
  const sourceRows = data.sourceMetrics.slice(0, 14);
  const alertRows = data.alerts.slice(0, 80);
  const reviewRows = data.reviewQueue.slice(0, 80);
  const explorerRows = data.explorerRows.slice(0, 120);
  const importRows = persistence.importHistory.slice(0, 10);
  const reportRows = persistence.reports.slice(0, 10);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Dashboard</title>
    <style>
      :root {
        --bg: #f4f6f7;
        --panel: #ffffff;
        --panel-alt: #f9fbfc;
        --ink: #16212d;
        --muted: #657383;
        --line: #dfe6ea;
        --accent: #0f766e;
        --accent-dark: #0b4f4a;
        --blue: #2563eb;
        --green: #138a61;
        --amber: #b45309;
        --red: #b42318;
        --shadow: 0 14px 34px rgba(22, 33, 45, 0.08);
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background: var(--bg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      .layout {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr);
        width: 100%;
        max-width: 100vw;
        overflow-x: hidden;
      }
      aside {
        padding: 22px 18px;
        background: var(--panel);
        border-right: 1px solid var(--line);
        position: sticky;
        top: 0;
        height: 100vh;
        min-width: 0;
        max-width: 100%;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 24px;
        font-weight: 800;
      }
      .brand-mark {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: var(--accent);
        color: #fff;
        display: grid;
        place-items: center;
        font-weight: 850;
      }
      nav {
        display: grid;
        gap: 5px;
        min-width: 0;
        max-width: 100%;
      }
      nav a {
        color: #344454;
        text-decoration: none;
        padding: 9px 10px;
        border-radius: 8px;
        font-size: 14px;
      }
      nav a:hover {
        color: var(--accent-dark);
        background: #e6f4f2;
      }
      main {
        padding: 26px;
        display: grid;
        gap: 18px;
        align-content: start;
        min-width: 0;
      }
      h1, h2, h3, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 30px; line-height: 1.1; }
      h2 { font-size: 18px; }
      h3 { font-size: 15px; }
      .topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .muted { color: var(--muted); }
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
      }
      .success { color: var(--green); background: #e7f5ee; }
      .warning { color: var(--amber); background: #fff2da; }
      .critical { color: var(--red); background: #fde9e7; }
      .notice { color: var(--blue); background: #eaf1ff; }
      .neutral { color: #506070; background: #edf1f4; }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 12px;
      }
      .metric, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
      }
      .metric {
        padding: 15px;
        min-height: 112px;
        color: inherit;
        text-decoration: none;
        display: block;
      }
      a.metric:hover, .data-link:hover, .open-link:hover {
        outline: 2px solid rgba(15, 118, 110, 0.22);
        outline-offset: 2px;
      }
      .metric-label {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 12px;
      }
      .metric-value {
        font-size: 29px;
        line-height: 1;
        font-weight: 850;
      }
      .metric-detail {
        color: var(--muted);
        font-size: 13px;
        margin-top: 10px;
      }
      .metric.good { border-top: 4px solid var(--green); }
      .metric.warn { border-top: 4px solid var(--amber); }
      .metric.risk { border-top: 4px solid var(--red); }
      .metric.info { border-top: 4px solid var(--blue); }
      .panel-header {
        padding: 15px 17px;
        border-bottom: 1px solid var(--line);
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
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-alt);
      }
      .note h3 { margin-bottom: 6px; }
      .empty {
        padding: 18px;
        border: 1px dashed #b9c5cc;
        border-radius: 8px;
        color: var(--muted);
        background: var(--panel-alt);
      }
      .table-wrap {
        max-width: 100%;
        overflow-x: auto;
      }
      table {
        width: 100%;
        min-width: 780px;
        border-collapse: collapse;
      }
      th, td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted);
        text-transform: uppercase;
        font-size: 11px;
        background: var(--panel-alt);
      }
      .evidence-summary { display: block; max-width: 280px; color: #3c4b59; line-height: 1.35; }
      .proof-link { display: block; margin-top: 5px; color: var(--accent-dark); font-size: 12px; font-weight: 760; text-decoration: none; }
      .mono {
        font-family: "Cascadia Code", Consolas, monospace;
        font-size: 12px;
      }
      .data-link, .open-link {
        color: var(--accent-dark);
        font-weight: 760;
        text-decoration: none;
      }
      .data-link {
        border-bottom: 1px solid rgba(15, 118, 110, 0.35);
      }
      details {
        border-top: 1px solid var(--line);
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
        font: 12px/1.55 "Cascadia Code", Consolas, monospace;
        color: #344454;
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
        nav { grid-auto-flow: column; overflow-x: auto; }
        .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-2, .guardrails { grid-template-columns: 1fr; }
      }
      @media (max-width: 640px) {
        main { padding: 16px; }
        .topbar, .panel-header, aside { flex-direction: column; align-items: stretch; }
        .metrics { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <div class="brand"><span class="brand-mark">SD</span><span>Sales Dashboard</span></div>
        <nav aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
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
            <h1>Sales call intelligence</h1>
            <p class="muted">Local CSV transcript analysis with privacy-safe matching and confidence-aware metrics.</p>
          </div>
          <div class="stack">
            ${hasData ? badge("CSV loaded", "success") : badge("No CSV loaded", "warning")}
            ${badge(formatDateRange(data.dateRange), "neutral")}
          </div>
        </header>

        ${!hasData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}

        <section class="metrics" aria-label="Executive overview">
          ${metricCard("Unique calls", formatNumber(data.totals.uniqueCalls), `${formatNumber(data.totals.rawRows)} raw rows, ${formatNumber(data.totals.duplicateCallIds)} duplicate IDs`, "info", drilldownUrl("calls.unique"))}
          ${metricCard("Probable live-human rate", formatPercent(data.rates.probableLiveHuman), `${formatNumber(data.totals.probableLiveHuman)} calls with transcript evidence`, "good", drilldownUrl("calls.probableLiveHuman"))}
          ${metricCard("Meaningful conversations", formatPercent(data.rates.meaningfulConversation), `${formatNumber(data.totals.meaningfulConversation)} calls qualify`, "good", drilldownUrl("calls.meaningfulConversation"))}
          ${metricCard("Follow-up signals", formatNumber(data.totals.followUpRequired), `${formatNumber(data.totals.followUpIndeterminate)} need more future data`, "warn", drilldownUrl("calls.followUpRequired"))}
          ${metricCard("Transcript coverage", formatPercent(data.rates.transcriptCoverage), `${formatNumber(data.totals.transcriptAvailable)} transcripts available`, "info", drilldownUrl("calls.transcriptAvailable"))}
          ${metricCard("Outcome mismatches", formatNumber(data.totals.outcomeMismatches), `${formatPercent(data.rates.outcomeMismatch)} of unique calls`, "warn", drilldownUrl("calls.outcomeMismatches"))}
          ${metricCard("Risk reviews", formatNumber(data.totals.riskReviews), "Complaint or opt-out style signals", "risk", drilldownUrl("calls.riskReviews"))}
          ${metricCard("Reports stored", formatNumber(persistence.counts.reports), `${formatNumber(persistence.counts.imports)} saved import snapshots`, "info")}
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
            ${metricCard("Potential wasted indicators", formatNumber(leadTotals.wastedLeadIndicators), `${formatRatioPercent(leadTotals.riskRate)} of stable lead-days`, "risk", drilldownUrl("lead.wastedLeadIndicators"))}
            ${metricCard("Missed explicit callbacks", formatNumber(leadTotals.callbackMissedSameDay), `${formatNumber(leadTotals.callbackCompletedSameDay)} completed same day`, "warn", drilldownUrl("lead.callbackMissedSameDay"))}
            ${metricCard("Single-attempt no-contact", formatNumber(leadTotals.singleAttemptNoContact), "No live-human contact and no same-day retry", "risk", drilldownUrl("lead.singleAttemptNoContact"))}
            ${metricCard("No-contact retry coverage", formatRatioPercent(leadTotals.noContactRetryRate), `${formatNumber(leadTotals.noContactRetriedSameDay)} of ${formatNumber(leadTotals.noContactLeadDays)} retried`, "info", drilldownUrl("lead.noContactRetriedSameDay"))}
            ${metricCard("Future callbacks pending", formatNumber(leadTotals.callbackFutureNeedsUpload), "Needs later CSV uploads before judgement", "info", drilldownUrl("lead.callbackFutureNeedsUpload"))}
            ${metricCard("Stable lead-days worked", formatNumber(leadTotals.stableLeadDaysWorked), `${formatNumber(leadTotals.callsWithoutStableLead)} calls lacked stable ID`, "good", drilldownUrl("lead.stableLeadDaysWorked"))}
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
            { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), { salesperson: row.name }) },
            { label: "Transcript coverage", render: (row) => formatPercent(row.transcriptCoverageRate) },
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), { salesperson: row.name }) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), { salesperson: row.name }) },
            { label: "Follow-up signals", render: (row) => dataLink("calls.followUpRequired", formatNumber(row.followUpRequired), { salesperson: row.name }) },
            { label: "Mismatches", render: (row) => dataLink("calls.outcomeMismatches", formatNumber(row.outcomeMismatches), { salesperson: row.name }) },
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
            { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), { source: row.name }) },
            { label: "Transcript coverage", render: (row) => formatPercent(row.transcriptCoverageRate) },
            { label: "Live-human", render: (row) => dataLink("calls.probableLiveHuman", formatPercent(row.probableLiveHumanRate), { source: row.name }) },
            { label: "Meaningful", render: (row) => dataLink("calls.meaningfulConversation", formatPercent(row.meaningfulConversationRate), { source: row.name }) },
            { label: "Follow-up rate", render: (row) => dataLink("calls.followUpRequired", formatPercent(row.followUpRequiredRate), { source: row.name }) },
            { label: "Mismatch rate", render: (row) => dataLink("calls.outcomeMismatches", formatPercent(row.outcomeMismatchRate), { source: row.name }) }
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
            { label: "Time", render: (row) => `${escapeHtml(row.date)} ${escapeHtml(row.time)}` },
            { label: "Salesperson", key: "salesperson" },
            { label: "Type", key: "callType" },
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
      :root {
        --bg: #f4f6f7;
        --panel: #ffffff;
        --panel-alt: #f9fbfc;
        --ink: #16212d;
        --muted: #657383;
        --line: #dfe6ea;
        --accent: #0f766e;
        --blue: #2563eb;
        --shadow: 0 14px 34px rgba(22, 33, 45, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background: var(--bg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
        background: var(--panel);
        border: 1px solid var(--line);
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
      .panel { padding: 20px; overflow: hidden; }
      h1, h2, p { margin: 0; letter-spacing: 0; }
      h1 { font-size: 28px; line-height: 1.15; }
      h2 { font-size: 18px; margin: 22px 0 10px; }
      p { margin: 8px 0; color: #344454; }
      ul { margin: 8px 0 16px; padding-left: 22px; }
      li { margin: 5px 0; }
      .muted { color: var(--muted); }
      .small { font-size: 13px; }
      .mono { font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; }
      .open-link, .button-link {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 7px 11px;
        border-radius: 8px;
        background: #e6f4f2;
        color: #0b4f4a;
        text-decoration: none;
        font-weight: 760;
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
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel-alt);
      }
      .meta-card span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
      .table-wrap {
        max-width: 100%;
        overflow-x: auto;
        border: 1px solid var(--line);
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
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted);
        background: var(--panel-alt);
        text-transform: uppercase;
        font-size: 11px;
      }
      pre {
        max-width: 100%;
        overflow-x: auto;
        padding: 14px;
        border-radius: 8px;
        background: #101820;
        color: #eff6f7;
        font: 12px/1.55 "Cascadia Code", Consolas, monospace;
      }
      @media (max-width: 760px) {
        .topbar { flex-direction: column; }
        .metadata { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div>
          <h1>${escapeHtml(reportTitle)}</h1>
          <p class="muted">${hasReport ? escapeHtml(report.summary || "Saved report") : "This report does not exist."}</p>
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
