"use strict";

const {
  CORRECTION_FIELDS,
  MANAGER_REVIEW_STATUSES,
  REVIEW_SCOPES,
  normalizeManagerReview,
  reviewStatusLabel,
  reviewStatusTone
} = require("./managerReview");
const { CALL_INTELLIGENCE_FOUNDATION_GOAL, EVALUATION_GOALS, OFFER_ACCEPTANCE_GOAL, SPIEL_QUALITY_GOAL, evaluationResultFacets } = require("./evaluationStudio");
const {
  formatAestDateTime,
  formatSourceDateTimeValue,
  formatSourceDateValue,
  isoDateFromParts,
  parseSourceDateParts
} = require("./dateTimeFormat");
const { publicLeadResultDashboard } = require("./leadResultDashboard");

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

const TABLE_COLUMN_STYLES = `
  [hidden] { display: none !important; }
  .table-column-toolbar {
    position: relative;
    z-index: 12;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: 38px;
    margin: 0 0 8px;
  }
  .panel:has(.table-column-toolbar),
  .audit-details:has(.table-column-toolbar) { overflow: visible !important; }
  .table-columns-menu { position: relative; }
  .table-columns-menu > summary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted-foreground);
    background: var(--surface-elevated);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    list-style: none;
  }
  .table-columns-menu > summary::-webkit-details-marker { display: none; }
  .table-columns-menu > summary::before { content: "☷"; color: var(--accent); font-size: 14px; }
  .table-columns-menu[open] > summary,
  .table-columns-menu > summary:hover { color: var(--foreground); border-color: rgba(166, 107, 255, 0.55); }
  .table-columns-count { color: var(--muted-soft); font-variant-numeric: tabular-nums; }
  .table-columns-popover {
    position: absolute;
    top: calc(100% + 7px);
    right: 0;
    width: min(300px, calc(100vw - 32px));
    max-height: min(520px, calc(100vh - 100px));
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .table-columns-title { margin: 0 0 2px; color: var(--foreground); font-size: 13px; font-weight: 750; }
  .table-columns-help { margin: 0 0 10px; color: var(--muted-foreground); font-size: 12px; line-height: 1.4; }
  .table-columns-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .table-columns-presets button {
    min-height: 30px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted-foreground);
    background: var(--surface-elevated);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .table-columns-presets button:hover { color: var(--foreground); border-color: rgba(166, 107, 255, 0.55); }
  .table-columns-list { display: grid; gap: 2px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
  .table-columns-option {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 6px;
    border-radius: 6px;
    color: var(--foreground);
    font-size: 12px;
    cursor: pointer;
  }
  .table-columns-option:hover { background: var(--surface-elevated); }
  .table-columns-option input { width: 15px; height: 15px; margin: 1px 0 0; accent-color: var(--accent); }
  .table-columns-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 520px) {
    .table-column-toolbar { justify-content: stretch; }
    .table-columns-menu { width: 100%; }
    .table-columns-menu > summary { justify-content: center; width: 100%; }
    .table-columns-popover { right: auto; left: 0; width: 100%; }
  }
  @media print { .table-column-toolbar { display: none !important; } }
`;

const TABLE_COLUMNS_SCRIPT = `<script>
  (() => {
    const STORAGE_PREFIX = "sales-dashboard-table-columns:v1:";
    const slug = (value) => String(value || "table").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "table";
    const tableLabel = (header, index) => {
      if (header.dataset.columnLabel) return header.dataset.columnLabel;
      const help = header.querySelector(".column-help");
      if (help && help.childNodes[0]) return String(help.childNodes[0].textContent || "").trim() || "Column " + (index + 1);
      const button = header.querySelector("button");
      if (button && button.childNodes[0]) return String(button.childNodes[0].textContent || "").trim() || "Column " + (index + 1);
      return String(header.textContent || "").replace(/[?\u2195]/g, "").trim() || "Column " + (index + 1);
    };
    const tables = Array.from(document.querySelectorAll("table")).filter((table) => table.tHead && table.tHead.rows[0]);
    tables.forEach((table, tableIndex) => {
      if (table.dataset.columnMenuReady === "true") return;
      const headers = Array.from(table.tHead.rows[0].cells);
      if (headers.length < 2) return;
      const labels = headers.map(tableLabel);
      const keys = headers.map((header, index) => header.dataset.columnKey || slug(labels[index]));
      const scope = table.closest("section[id]")?.id || table.closest("[id]")?.id || "table-" + (tableIndex + 1);
      const tableKey = table.dataset.tableKey || [location.pathname, scope, keys.join("|")].join(":");
      const storageKey = STORAGE_PREFIX + tableKey;
      const defaultVisible = new Set(keys.filter((key) => !String(table.dataset.defaultHidden || "").split(",").includes(key)));
      const auditVisible = new Set(keys);
      const preferredCompact = ["business", "business-name", "customer-id", "salesperson", "manager", "status", "result", "approved-sales", "observed-sales"];
      const compactVisible = new Set();
      keys.forEach((key, index) => {
        if (index < 2 || preferredCompact.includes(key)) compactVisible.add(key);
      });
      if (compactVisible.size > 6) {
        Array.from(compactVisible).slice(6).forEach((key) => compactVisible.delete(key));
      }
      const configuredCompact = String(table.dataset.compactColumns || "").split(",").map((key) => key.trim()).filter((key) => keys.includes(key));
      if (configuredCompact.length) {
        compactVisible.clear();
        configuredCompact.forEach((key) => compactVisible.add(key));
      }
      let visible = new Set(defaultVisible);
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
        if (Array.isArray(saved)) {
          const valid = saved.filter((key) => keys.includes(key));
          if (valid.length) visible = new Set(valid);
        }
      } catch {}

      const toolbar = document.createElement("div");
      toolbar.className = "table-column-toolbar";
      toolbar.innerHTML = '<details class="table-columns-menu"><summary>Columns <span class="table-columns-count"></span></summary><div class="table-columns-popover"><p class="table-columns-title">Choose visible columns</p><p class="table-columns-help">This changes only your table view on this computer. Data, totals and exports stay unchanged.</p><div class="table-columns-presets"><button type="button" data-column-preset="audit">Audit view</button><button type="button" data-column-preset="compact">Compact view</button><button type="button" data-column-preset="reset">Reset</button></div><div class="table-columns-list"></div><span class="table-columns-status" aria-live="polite"></span></div></details>';
      const list = toolbar.querySelector(".table-columns-list");
      const count = toolbar.querySelector(".table-columns-count");
      const status = toolbar.querySelector(".table-columns-status");
      const inputs = [];
      labels.forEach((label, index) => {
        const option = document.createElement("label");
        option.className = "table-columns-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = keys[index];
        input.checked = visible.has(keys[index]);
        const text = document.createElement("span");
        text.textContent = label;
        option.append(input, text);
        list.append(option);
        inputs.push(input);
      });
      const wrap = table.closest(".table-wrap");
      (wrap || table).before(toolbar);
      table.dataset.columnMenuReady = "true";

      const persist = () => {
        try { window.localStorage.setItem(storageKey, JSON.stringify(Array.from(visible))); } catch {}
      };
      const apply = (announce = false) => {
        headers.forEach((header, index) => {
          const shown = visible.has(keys[index]);
          header.hidden = !shown;
          Array.from(table.tBodies).forEach((body) => Array.from(body.rows).forEach((row) => {
            if (row.cells[index]) row.cells[index].hidden = !shown;
          }));
          inputs[index].checked = shown;
        });
        count.textContent = visible.size + " of " + keys.length;
        if (announce) status.textContent = visible.size + " of " + keys.length + " columns shown.";
      };
      const usePreset = (preset, persistChoice = true) => {
        visible = new Set(preset);
        if (!visible.size) visible.add(keys[0]);
        if (persistChoice) persist();
        apply(true);
      };
      inputs.forEach((input, index) => input.addEventListener("change", () => {
        if (!input.checked && visible.size === 1) {
          input.checked = true;
          status.textContent = "At least one column must remain visible.";
          return;
        }
        if (input.checked) visible.add(keys[index]); else visible.delete(keys[index]);
        persist();
        apply(true);
      }));
      toolbar.querySelectorAll("[data-column-preset]").forEach((button) => button.addEventListener("click", () => {
        const preset = button.dataset.columnPreset;
        if (preset === "audit") usePreset(auditVisible);
        if (preset === "compact") usePreset(compactVisible);
        if (preset === "reset") {
          try { window.localStorage.removeItem(storageKey); } catch {}
          usePreset(defaultVisible, false);
        }
      }));
      toolbar.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          toolbar.querySelector("details").open = false;
          toolbar.querySelector("summary").focus();
        }
      });
      apply();
    });
  })();
</script>`;

const PANELIFY_THEME_STYLES = `
  ${TABLE_COLUMN_STYLES}
  :root {
    color-scheme: dark;
    --background: #0D101B;
    --surface: #181B2A;
    --surface-elevated: #1C1F30;
    --surface-soft: #22263A;
    --sidebar: #151827;
    --topnav: #10131F;
    --border: rgba(255, 255, 255, 0.10);
    --border-subtle: rgba(255, 255, 255, 0.065);
    --foreground: #F5F5F8;
    --muted-foreground: #9CA3B8;
    --muted-soft: #747C91;
    --primary: #8B5CF6;
    --accent: #A66BFF;
    --pink: #E851B9;
    --success: #34D399;
    --warning: #FBBF24;
    --danger: #FB7185;
    --chart-1: #8B5CF6;
    --chart-2: #A66BFF;
    --chart-3: #E851B9;
    --chart-4: #60A5FA;
    --chart-5: #34D399;
    --accent-gradient: linear-gradient(108deg, #7C5CFC 0%, #A65FF2 54%, #DD56BA 100%);
    --shadow: 0 18px 42px rgba(2, 4, 12, 0.24);
    --soft-shadow: 0 10px 24px rgba(2, 4, 12, 0.18);
    --radius-panel: 14px;
    --radius-control: 10px;
    --transition: 170ms ease;
  }
  * { scrollbar-color: rgba(166, 107, 255, 0.34) transparent; scrollbar-width: thin; }
  *::-webkit-scrollbar { width: 7px; height: 7px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: rgba(166, 107, 255, 0.30); border-radius: 999px; }
  html { background: var(--background); }
  body {
    background: var(--background);
    color: var(--foreground);
    font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  a, button, input, select, textarea, summary { transition: border-color var(--transition), background-color var(--transition), color var(--transition), opacity var(--transition), transform var(--transition), box-shadow var(--transition); }
  :where(a, button, input, select, textarea, summary):focus-visible {
    outline: 2px solid rgba(166, 107, 255, 0.88) !important;
    outline-offset: 3px !important;
  }
  h1 { color: var(--foreground); font-size: clamp(28px, 2.4vw, 34px); font-weight: 700; letter-spacing: -0.035em; }
  h2 { color: var(--foreground); font-size: 17px; font-weight: 650; letter-spacing: -0.015em; }
  h3 { color: var(--foreground); font-weight: 650; }
  .muted { color: var(--muted-foreground); }
  .small { font-size: 13px; }
  .mono, .metric-value, .command-value, td:nth-child(n+2) {
    font-variant-numeric: tabular-nums;
  }
  .page-kicker, .section-kicker {
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.095em;
  }
  .panel,
  .metric,
  .command-panel,
  .topbar,
  .audit-details,
  .commercial-summary {
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: none;
  }
  .panel { overflow: clip; }
  .panel-header {
    min-height: 68px;
    padding: 18px 21px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .panel-header > div:first-child { min-width: 0; }
  .panel-header h2 + p { margin-top: 5px; }
  .panel-body { padding: 20px 21px; }
  .metric {
    position: relative;
    min-height: 128px;
    padding: 18px;
    border-color: var(--border-subtle);
    background: var(--surface);
    overflow: hidden;
  }
  .metric::before {
    content: "";
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.92), rgba(232, 81, 185, 0.38), transparent 84%);
    opacity: 0.72;
  }
  .metric.good::before { background: linear-gradient(90deg, var(--success), transparent 78%); }
  .metric.warn::before { background: linear-gradient(90deg, var(--warning), transparent 78%); }
  .metric.risk::before { background: linear-gradient(90deg, var(--danger), transparent 78%); }
  .metric.good, .metric.warn, .metric.risk, .metric.info { border-top-width: 1px; }
  a.metric:hover {
    border-color: rgba(166, 107, 255, 0.46);
    background: var(--surface-elevated);
    transform: translateY(-1px);
    box-shadow: var(--soft-shadow);
  }
  .metric-label {
    margin-bottom: 14px;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.015em;
  }
  .metric-value {
    color: var(--foreground);
    font-family: "Geist Mono", "Cascadia Code", Consolas, monospace;
    font-size: clamp(24px, 2vw, 29px);
    font-weight: 650;
    letter-spacing: -0.045em;
  }
  .metric-detail { color: var(--muted-foreground); font-size: 12px; line-height: 1.45; }
  .badge {
    min-height: 25px;
    padding: 4px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.012em;
  }
  .success { color: #62DDA9; background: rgba(52, 211, 153, 0.09); border-color: rgba(52, 211, 153, 0.22); }
  .warning { color: #F6C95B; background: rgba(251, 191, 36, 0.09); border-color: rgba(251, 191, 36, 0.22); }
  .critical { color: #FF8CA0; background: rgba(251, 113, 133, 0.09); border-color: rgba(251, 113, 133, 0.22); }
  .notice { color: #C19AFF; background: rgba(139, 92, 246, 0.11); border-color: rgba(166, 107, 255, 0.26); }
  .neutral { color: #AEB5C8; background: rgba(156, 163, 184, 0.07); border-color: rgba(156, 163, 184, 0.16); }
  .data-link, .open-link, .button-link, .proof-link, .filter-link, .aggregate-drill-link {
    color: #B99AFF;
  }
  .data-link { border-bottom-color: rgba(166, 107, 255, 0.34); }
  .data-link:hover, .open-link:hover, .button-link:hover, .proof-link:hover, .filter-link:hover, .aggregate-drill-link:hover {
    color: #E5D7FF;
  }
  button,
  .button,
  .button-link,
  .open-link,
  .filter-link,
  .upload-button {
    min-height: 38px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--foreground);
    background: var(--surface-elevated);
    box-shadow: none;
  }
  button:hover,
  .button:hover,
  .button-link:hover,
  .open-link:hover,
  .filter-link:hover,
  .upload-button:hover {
    border-color: rgba(166, 107, 255, 0.46);
    background: var(--surface-soft);
  }
  .filter-actions button[type="submit"],
  .studio-form > button[type="submit"],
  .button.primary {
    border-color: rgba(166, 107, 255, 0.56);
    color: #FFFFFF;
    background: var(--accent-gradient);
    box-shadow: 0 8px 20px rgba(139, 92, 246, 0.18);
  }
  input,
  select,
  textarea,
  .filter-control input,
  .filter-control select,
  .studio-form input,
  .studio-form select,
  .studio-form textarea {
    min-height: 39px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--foreground);
    background: #141725;
  }
  input::placeholder, textarea::placeholder { color: var(--muted-soft); }
  input:focus, select:focus, textarea:focus {
    border-color: rgba(166, 107, 255, 0.64);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.10);
  }
  .filter-control {
    color: var(--muted-foreground);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
  }
  .filter-chip {
    border-color: rgba(166, 107, 255, 0.30);
    color: #D8C5FF;
    background: rgba(139, 92, 246, 0.10);
  }
  .filter-advanced,
  .bulk-alert-form,
  .context-details {
    border-color: var(--border-subtle);
    border-radius: 12px;
    background: #141725;
  }
  .table-wrap {
    border-color: var(--border-subtle);
    background: var(--surface);
  }
  table { border-collapse: separate; border-spacing: 0; }
  th, td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 12.5px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 2;
    color: var(--muted-foreground);
    background: #1A1D2D;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.065em;
  }
  tbody tr { background: transparent; }
  tbody tr:hover { background: rgba(139, 92, 246, 0.055); }
  tbody tr:last-child td { border-bottom: 0; }
  .column-help-mark {
    border-color: rgba(166, 107, 255, 0.48);
    color: var(--accent);
  }
  .column-tooltip {
    border-color: var(--border);
    border-radius: 10px;
    background: #202336;
    box-shadow: var(--soft-shadow);
  }
  .note,
  .dataset-fact,
  .mini-stat,
  .attention-item,
  .segment-card,
  .action-queue-card,
  .opportunity-stage,
  .opportunity-record,
  .audit-section,
  .proof-card,
  .turn,
  .meta-card {
    border-color: var(--border-subtle);
    border-radius: 11px;
    background: var(--surface-elevated);
  }
  .note, .dataset-fact, .mini-stat { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.015); }
  .empty {
    border-color: rgba(166, 107, 255, 0.24);
    border-radius: 12px;
    color: var(--muted-foreground);
    background: rgba(139, 92, 246, 0.045);
  }
  .pipeline-track,
  .segment-track {
    border-color: var(--border-subtle);
    background: #10131F;
  }
  .pipeline-fill.primary,
  .segment-fill.warm { background: var(--accent-gradient); }
  .pipeline-fill.accent,
  .segment-fill.new { background: linear-gradient(90deg, #60A5FA, #8B5CF6); }
  .pipeline-fill.success { background: var(--success); }
  .pipeline-fill.warning { background: var(--warning); }
  .pipeline-fill.danger { background: var(--danger); }
  pre, .raw-result {
    border-color: var(--border-subtle);
    border-radius: 11px;
    background: #090B13;
  }
  details { border-color: var(--border-subtle); }
  summary:hover { color: #D9C7FF; }

  body[data-dashboard-view] { overflow-x: hidden; }
  body[data-dashboard-view] .layout { display: block; min-height: 100vh; overflow: visible; }
  body[data-dashboard-view] aside {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 60;
    width: 264px;
    height: 100vh;
    padding: 18px 14px;
    overflow-x: hidden;
    overflow-y: auto;
    border-right: 1px solid var(--border-subtle);
    background: var(--sidebar);
    transition: width var(--transition), transform var(--transition);
  }
  .app-frame {
    min-width: 0;
    min-height: 100vh;
    margin-left: 264px;
    transition: margin-left var(--transition);
  }
  .app-topnav {
    position: sticky;
    top: 0;
    z-index: 45;
    min-height: 68px;
    display: grid;
    grid-template-columns: minmax(190px, 0.85fr) minmax(280px, 560px) minmax(220px, 0.85fr);
    gap: 18px;
    align-items: center;
    padding: 12px 30px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--topnav);
  }
  .topnav-context { min-width: 0; display: grid; gap: 2px; }
  .topnav-context span { color: var(--muted-soft); font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; }
  .topnav-context strong { overflow: hidden; color: var(--foreground); font-size: 13px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
  .top-search {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    min-height: 42px;
    padding: 4px 5px 4px 13px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: #171A29;
  }
  .top-search:focus-within {
    border-color: rgba(166, 107, 255, 0.60);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.09);
  }
  .search-mark {
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--muted-soft);
    border-radius: 50%;
    position: relative;
  }
  .search-mark::after {
    content: "";
    position: absolute;
    width: 6px;
    height: 1.5px;
    right: -5px;
    bottom: -2px;
    border-radius: 2px;
    background: var(--muted-soft);
    transform: rotate(45deg);
  }
  .top-search input {
    min-height: 30px;
    padding: 3px 5px;
    border: 0;
    background: transparent;
    box-shadow: none;
    font-size: 13px;
  }
  .top-search input:focus { outline: 0 !important; box-shadow: none; }
  .top-search button {
    min-height: 30px;
    padding: 5px 10px;
    border-radius: 9px;
    color: #E5D8FF;
    font-size: 11px;
  }
  .topnav-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
  .topnav-link {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted-foreground);
    background: var(--surface);
    font-size: 12px;
    font-weight: 620;
    text-decoration: none;
  }
  .topnav-link:hover { border-color: rgba(166, 107, 255, 0.42); color: var(--foreground); }
  .sidebar-mobile-toggle { display: none; }
  body[data-dashboard-view] .app-frame > main {
    width: auto;
    max-width: none;
    margin: 0;
    padding: 30px 32px 48px;
    gap: 16px;
  }
  body[data-dashboard-view] .topbar {
    padding: 2px 0 8px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  body[data-dashboard-view] .topbar > div:first-child { max-width: 820px; }
  body[data-dashboard-view] .topbar h1 + p { margin-top: 8px; max-width: 780px; }
  body[data-dashboard-view] .metrics {
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 14px;
  }
  body[data-dashboard-view] .command-grid { gap: 16px; }
  body[data-dashboard-view] .command-panel { border-radius: var(--radius-panel); background: var(--surface); }
  body[data-dashboard-view] .command-panel.primary {
    position: relative;
    background: var(--surface-elevated);
    overflow: hidden;
  }
  body[data-dashboard-view] .command-panel.primary::after {
    content: "";
    position: absolute;
    width: 210px;
    height: 210px;
    right: -130px;
    top: -145px;
    border-radius: 50%;
    background: rgba(139, 92, 246, 0.16);
    filter: blur(2px);
    pointer-events: none;
  }
  body[data-dashboard-view] .command-value {
    color: #FBFAFF;
    font-family: "Geist Mono", "Cascadia Code", Consolas, monospace;
    font-size: clamp(38px, 4vw, 50px);
    font-weight: 650;
    letter-spacing: -0.055em;
  }
  body[data-dashboard-view] .dataset-grid { gap: 12px; }
  body[data-dashboard-view] .filter-form { gap: 12px; }
  body[data-dashboard-view] .workspace-tabs { display: none; }
  body[data-dashboard-view] aside .brand {
    position: relative;
    min-height: 92px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    margin: 0 0 15px;
    padding: 4px 3px 13px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .brand-identity { min-width: 0; display: grid; gap: 9px; }
  body[data-dashboard-view] .brand-logo { min-height: 34px; }
  body[data-dashboard-view] .brand-logo img { width: min(184px, 100%); max-height: 34px; object-fit: contain; object-position: left center; }
  body[data-dashboard-view] .brand-title { font-size: 12px; font-weight: 650; letter-spacing: 0.04em; text-transform: none; }
  body[data-dashboard-view] .brand-subtitle { color: var(--muted-soft); font-size: 11px; }
  .brand-monogram {
    display: none;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid rgba(166, 107, 255, 0.34);
    border-radius: 11px;
    color: #E8DBFF;
    background: linear-gradient(145deg, rgba(139, 92, 246, 0.30), rgba(232, 81, 185, 0.13));
    font-family: "Geist Mono", monospace;
    font-size: 12px;
    font-weight: 700;
  }
  .sidebar-collapse {
    width: 34px;
    min-width: 34px;
    min-height: 34px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 9px;
    color: var(--muted-foreground);
  }
  .sidebar-collapse.sidebar-mobile-toggle { display: none; }
  .sidebar-collapse-mark,
  .sidebar-collapse-mark::before,
  .sidebar-collapse-mark::after {
    width: 14px;
    height: 1.5px;
    display: block;
    border-radius: 2px;
    background: currentColor;
  }
  .sidebar-collapse-mark { position: relative; }
  .sidebar-collapse-mark::before, .sidebar-collapse-mark::after { content: ""; position: absolute; left: 0; }
  .sidebar-collapse-mark::before { top: -5px; }
  .sidebar-collapse-mark::after { top: 5px; }
  body[data-dashboard-view] .product-switcher {
    gap: 4px;
    margin-bottom: 12px;
    padding: 5px;
    border: 1px solid var(--border-subtle);
    border-radius: 11px;
    background: #10131F;
  }
  body[data-dashboard-view] .product-switcher a {
    min-height: 36px;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 620;
  }
  body[data-dashboard-view] .product-switcher a.active {
    border-color: rgba(166, 107, 255, 0.24);
    background: rgba(139, 92, 246, 0.13);
  }
  body[data-dashboard-view] aside nav {
    gap: 3px;
    padding-top: 8px;
    border-top: 0;
    scrollbar-width: thin;
  }
  body[data-dashboard-view] aside nav a {
    position: relative;
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 11px;
    border: 1px solid transparent;
    border-radius: 9px;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 560;
  }
  body[data-dashboard-view] aside nav a:hover {
    color: var(--foreground);
    background: rgba(255, 255, 255, 0.035);
  }
  body[data-dashboard-view] aside nav a.active {
    padding-left: 11px;
    border: 1px solid rgba(166, 107, 255, 0.24);
    color: #F5F0FF;
    background: rgba(97, 63, 180, 0.34);
  }
  body[data-dashboard-view] aside nav a.active::before {
    content: "";
    position: absolute;
    left: -15px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 4px 4px 0;
    background: linear-gradient(180deg, #A66BFF, #E851B9);
  }
  .nav-icon {
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(156, 163, 184, 0.17);
    border-radius: 6px;
    color: var(--muted-soft);
    font-family: "Geist Mono", monospace;
    font-size: 12px;
    line-height: 1;
  }
  aside nav a.active .nav-icon, aside nav a:hover .nav-icon {
    border-color: rgba(166, 107, 255, 0.34);
    color: #B98AFF;
  }
  .nav-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  body[data-dashboard-view] .nav-label {
    margin: 15px 10px 6px;
    color: var(--muted-soft);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
  }
  .on-page-link { min-height: 34px !important; padding-block: 6px !important; font-size: 11px !important; }
  .sidebar-overlay { display: none; }
  body.sidebar-collapsed .app-frame { margin-left: 84px; }
  body.sidebar-collapsed aside { width: 84px; }
  body.sidebar-collapsed aside .brand { grid-template-columns: 1fr; justify-items: center; }
  body.sidebar-collapsed aside .brand-identity > :not(.brand-monogram),
  body.sidebar-collapsed aside .product-switcher .nav-text,
  body.sidebar-collapsed aside .nav-text,
  body.sidebar-collapsed aside .nav-label,
  body.sidebar-collapsed aside .on-page-link,
  body.sidebar-collapsed aside .brand-settings { display: none; }
  body.sidebar-collapsed aside .brand-monogram { display: grid; }
  body.sidebar-collapsed aside .brand-identity { justify-items: center; }
  body.sidebar-collapsed aside .sidebar-collapse { margin: 0 auto; }
  body.sidebar-collapsed aside .product-switcher { padding: 5px; }
  body.sidebar-collapsed aside .product-switcher a,
  body.sidebar-collapsed aside nav a { justify-content: center; padding-inline: 8px; }
  body.sidebar-collapsed aside nav a.active::before { left: -15px; }
  body.sidebar-collapsed aside nav a[aria-current="page"] { overflow: visible; }

  .sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }
  .lead-chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    min-width: 0;
  }
  .lead-chart-grid-primary { grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.85fr); }
  .lead-chart-grid > * { min-width: 0; }
  .lead-chart-panel .panel-header { align-items: flex-start; }
  .lead-chart-panel .panel-body { min-width: 0; }
  .lead-chart-panel code {
    color: #CDB7FF;
    font-family: "Geist Mono", "Cascadia Code", Consolas, monospace;
    font-size: 0.92em;
  }
  .lead-chart-figure,
  .lead-age-figure,
  .lead-usage-funnel { margin: 0; }
  .lead-chart-legend {
    min-height: 26px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
    margin-bottom: 15px;
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .lead-chart-legend span { display: inline-flex; gap: 6px; align-items: center; }
  .lead-chart-legend i,
  .lead-age-legend i {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    display: inline-block;
    border-radius: 3px;
    background: var(--legend-color, var(--muted-soft));
  }
  .series-0 { background: var(--chart-1) !important; }
  .series-1 { background: var(--chart-2) !important; }
  .series-2 { background: var(--chart-3) !important; }
  .series-3 { background: var(--chart-4) !important; }
  .series-4 { background: var(--chart-5) !important; }
  .series-5 { background: var(--warning) !important; }
  .series-6 { background: var(--muted-soft) !important; }
  .daily-allocation-chart {
    height: 270px;
    display: grid;
    grid-template-columns: repeat(var(--daily-column-count), minmax(0, 1fr));
    gap: clamp(12px, 2.2vw, 26px);
    align-items: end;
    padding: 18px 10px 0;
    border-radius: 11px;
    background:
      repeating-linear-gradient(to bottom, transparent 0, transparent 53px, rgba(255, 255, 255, 0.055) 54px),
      #141725;
  }
  .daily-allocation-column {
    min-width: 0;
    height: 100%;
    display: grid;
    grid-template-rows: 22px minmax(0, 1fr) 28px;
    gap: 6px;
    align-items: end;
    color: var(--muted-foreground);
    font-size: 11px;
    text-align: center;
  }
  .daily-allocation-column > strong { color: var(--foreground); font-size: 11px; font-weight: 650; }
  .daily-allocation-track {
    width: min(56px, 76%);
    height: 100%;
    display: flex;
    align-items: end;
    justify-self: center;
    border-radius: 8px 8px 3px 3px;
    background: rgba(255, 255, 255, 0.022);
    overflow: hidden;
  }
  .daily-allocation-stack {
    width: 100%;
    height: var(--column-height);
    min-height: 2px;
    display: flex;
    flex-direction: column-reverse;
    border-radius: 8px 8px 3px 3px;
    overflow: hidden;
  }
  .daily-allocation-stack > span {
    min-height: 1px;
    flex-grow: var(--segment-grow);
    border-top: 1px solid rgba(13, 16, 27, 0.24);
  }
  .lead-chart-list,
  .lead-age-legend {
    display: grid;
    gap: 13px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .lead-chart-row { min-width: 0; display: grid; gap: 6px; }
  .lead-chart-row-link {
    min-width: 0;
    display: grid;
    gap: 6px;
    color: inherit;
    text-decoration: none;
    border-radius: 8px;
    outline: none;
  }
  .lead-chart-row-link:hover .lead-chart-label,
  .lead-chart-row-link:focus-visible .lead-chart-label { color: #CDB7FF; }
  .lead-chart-row-link:focus-visible { box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.32); }
  .lead-chart-row.low-sample .lead-chart-detail::after {
    content: "Low sample";
    display: inline-flex;
    margin-left: 7px;
    padding: 1px 6px;
    border: 1px solid rgba(251, 191, 36, 0.28);
    border-radius: 999px;
    color: #F4D88A;
    font-size: 9px;
    font-weight: 650;
    letter-spacing: 0.02em;
    vertical-align: 1px;
  }
  .lead-chart-row.not-scored .lead-chart-fill {
    background: repeating-linear-gradient(135deg, rgba(156, 163, 184, 0.22) 0 4px, rgba(156, 163, 184, 0.07) 4px 8px) !important;
  }
  .lead-chart-row-head {
    min-width: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
  }
  .lead-chart-label { min-width: 0; color: var(--foreground); font-size: 12px; font-weight: 620; overflow-wrap: anywhere; }
  .lead-chart-value { flex: 0 0 auto; color: var(--foreground); font-size: 12px; }
  .lead-chart-track {
    position: relative;
    height: 7px;
    display: block;
    border-radius: 999px;
    background: #10131F;
    overflow: visible;
  }
  .lead-chart-reference {
    position: absolute;
    top: -4px;
    bottom: -4px;
    left: var(--reference-left);
    width: 2px;
    border-radius: 2px;
    background: #FBBF24;
    box-shadow: 0 0 0 1px rgba(13, 16, 27, 0.72);
  }
  .lead-chart-fill {
    width: var(--chart-width);
    height: 100%;
    display: block;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--chart-1), var(--chart-2));
  }
  .lead-chart-fill.pink { background: linear-gradient(90deg, var(--chart-1), var(--pink)); }
  .lead-chart-fill.blue { background: linear-gradient(90deg, #527FEA, var(--chart-4)); }
  .lead-chart-detail {
    min-width: 0;
    color: var(--muted-foreground);
    font-size: 10.5px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .lead-chart-more {
    margin-top: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: #141725;
  }
  .lead-chart-more summary { padding: 10px 12px; color: #CDB7FF; font-size: 11px; }
  .lead-chart-more .lead-chart-list { padding: 12px; border-top: 1px solid var(--border-subtle); }
  .daily-allocation-details ul {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 12px;
    border-top: 1px solid var(--border-subtle);
    list-style: none;
  }
  .daily-allocation-details li { display: grid; gap: 4px; }
  .daily-allocation-details strong { color: var(--foreground); font-size: 11px; }
  .daily-allocation-details span { color: var(--muted-foreground); font-size: 10.5px; line-height: 1.5; }
  .lead-chart-boundary { padding-top: 0; }
  .lead-chart-boundary p { padding-top: 13px; border-top: 1px solid var(--border-subtle); }
  .lead-age-figure {
    min-height: 284px;
    display: grid;
    grid-template-columns: minmax(170px, 0.85fr) minmax(220px, 1.15fr);
    gap: 24px;
    align-items: center;
  }
  .lead-age-donut {
    width: min(210px, 100%);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    justify-self: center;
    border-radius: 50%;
    background: var(--donut-fill);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  }
  .lead-age-donut > div {
    width: 58%;
    aspect-ratio: 1;
    display: grid;
    place-content: center;
    gap: 3px;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
    background: var(--surface);
    text-align: center;
  }
  .lead-age-donut strong { color: var(--foreground); font-size: 20px; }
  .lead-age-donut span { color: var(--muted-foreground); font-size: 10px; }
  .lead-age-legend li {
    min-width: 0;
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
    color: var(--muted-foreground);
    font-size: 11px;
  }
  .lead-age-legend li > a {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
    color: inherit;
    text-decoration: none;
    border-radius: 7px;
  }
  .lead-age-legend li > a:hover span,
  .lead-age-legend li > a:focus-visible span { color: #CDB7FF; }
  .lead-age-legend strong { color: var(--foreground); font-size: 11px; }
  .lead-age-legend small { min-width: 44px; text-align: right; }
  .lead-usage-layout { display: grid; gap: 17px; }
  .lead-usage-funnel { display: grid; gap: 11px; }
  .lead-usage-stage { display: grid; gap: 5px; color: inherit; text-decoration: none; border-radius: 7px; }
  a.lead-usage-stage:hover,
  a.lead-usage-stage:focus-visible { background: rgba(139, 92, 246, 0.07); }
  .lead-usage-stage > div { display: flex; justify-content: space-between; gap: 12px; color: var(--muted-foreground); font-size: 11px; }
  .lead-usage-stage strong { color: var(--foreground); font-size: 11px; }
  .lead-usage-track { height: 9px; display: block; border-radius: 999px; background: #10131F; overflow: hidden; }
  .lead-usage-track > span { width: var(--usage-width); height: 100%; display: block; border-radius: inherit; }
  .lead-usage-signals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .lead-usage-signals > div,
  .lead-usage-signals > a {
    min-width: 0;
    display: grid;
    gap: 5px;
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: #141725;
    color: inherit;
    text-decoration: none;
  }
  .lead-usage-signals > a:hover,
  .lead-usage-signals > a:focus-visible { border-color: rgba(166, 107, 255, 0.5); background: #181B2A; }
  .lead-usage-signals span { color: var(--muted-foreground); font-size: 10px; line-height: 1.35; }
  .lead-usage-signals strong { color: var(--foreground); font-size: 15px; }
  .allocation-frequency {
    display: grid;
    gap: 12px;
    padding-top: 15px;
    border-top: 1px solid var(--border-subtle);
  }
  .allocation-frequency h3 { font-size: 12px; }
  .daily-allocation-column { color: var(--muted-foreground); text-decoration: none; border-radius: 8px; }
  a.daily-allocation-column:hover,
  a.daily-allocation-column:focus-visible { background: rgba(139, 92, 246, 0.08); outline: none; box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.28); }
  .performance-range-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
    padding: 14px 20px;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(13, 16, 27, 0.34);
  }
  .performance-range-form label { display: grid; gap: 5px; color: var(--muted-foreground); font-size: 10px; font-weight: 700; }
  .performance-range-form input {
    min-height: 40px;
    padding: 8px 10px;
    color: var(--foreground);
    color-scheme: dark;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-elevated);
    font: inherit;
  }
  .performance-range-form .button { min-height: 40px; }
  .performance-range-form > .muted { align-self: center; margin-left: auto; }
  .sales-heatmap-wrap { max-width: 100%; overflow-x: auto; padding-bottom: 4px; }
  .sales-activity-heatmap {
    min-width: max(760px, calc(190px + var(--heatmap-columns) * 96px));
    display: grid;
    grid-template-columns: minmax(190px, 1.35fr) repeat(var(--heatmap-columns), minmax(82px, 1fr));
    gap: 6px;
    align-items: stretch;
  }
  .heatmap-corner,
  .heatmap-date,
  .heatmap-source,
  .heatmap-cell {
    min-height: 58px;
    display: grid;
    align-content: center;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 9px;
  }
  .heatmap-corner,
  .heatmap-date { color: var(--muted-foreground); background: #141725; font-size: 10px; font-weight: 700; }
  .heatmap-date { text-align: center; }
  .heatmap-date small { font-size: 9px; font-weight: 500; }
  .heatmap-source { grid-template-columns: minmax(0, 1fr) auto; align-items: center; color: var(--foreground); background: #141725; font-size: 11px; }
  .heatmap-source strong { color: #CDB7FF; }
  .heatmap-cell {
    place-content: center;
    color: var(--foreground);
    text-align: center;
    text-decoration: none;
    background: rgba(139, 92, 246, var(--heat-intensity, 0.12));
    border-color: rgba(166, 107, 255, 0.34);
  }
  .heatmap-cell strong { font-size: 15px; }
  .heatmap-cell small { color: rgba(245, 245, 247, 0.82); font-size: 9px; }
  .heatmap-cell.empty-cell { color: var(--muted-foreground); background: rgba(255, 255, 255, 0.018); border-style: dashed; }
  a.heatmap-cell:hover,
  a.heatmap-cell:focus-visible { border-color: #CDB7FF; outline: none; box-shadow: inset 0 0 0 1px #CDB7FF; transform: translateY(-1px); }
  .complete-range-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 10px 20px 14px;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(13, 16, 27, 0.34);
  }
  .button.disabled { cursor: not-allowed; opacity: 0.52; }
  .lead-results-workspace { gap: 18px; }
  .lead-result-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .lead-result-chart-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--border-subtle);
  }
  .lead-result-chart-grid > article {
    min-width: 0;
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 21px;
    background: var(--surface);
  }
  .lead-result-chart-grid > article > h3 { font-size: 14px; }
  .lead-result-guidance { display: grid; gap: 8px; }
  .lead-result-guidance > div {
    padding: 11px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 9px;
    background: var(--surface-elevated);
  }
  .lead-result-guidance > div.warning { color: #F6C95B; background: rgba(251, 191, 36, 0.06); }
  .lead-result-guidance strong { display: block; margin-bottom: 4px; font-size: 11px; }
  .lead-result-guidance p { white-space: normal; }
  .lead-result-panel-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    padding: 20px;
  }
  .lead-result-compact-panel {
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgba(96, 165, 250, 0.22);
    border-radius: 11px;
    background: rgba(96, 165, 250, 0.045);
  }
  .lead-result-compact-panel.team { border-color: rgba(52, 211, 153, 0.24); background: rgba(52, 211, 153, 0.045); }
  .lead-result-compact-panel h3 {
    padding: 12px 14px;
    color: #B9D6FF;
    border-bottom: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(96, 165, 250, 0.08);
    font-size: 12px;
  }
  .lead-result-compact-panel.team h3 { color: #88E0C0; border-color: rgba(52, 211, 153, 0.18); background: rgba(52, 211, 153, 0.08); }
  .lead-result-compact-panel ol { display: grid; margin: 0; padding: 0; list-style: none; }
  .lead-result-compact-panel li + li { border-top: 1px solid var(--border-subtle); }
  .lead-result-compact-panel li > a,
  .lead-result-compact-panel li > span,
  .lead-result-compact-panel li { color: inherit; text-decoration: none; }
  .lead-result-compact-panel li > a { display: grid; gap: 3px; padding: 11px 14px; }
  .lead-result-compact-panel li > div { display: grid; gap: 3px; padding: 11px 14px; }
  .lead-result-compact-panel li > a:hover,
  .lead-result-compact-panel li > a:focus-visible { background: rgba(166, 107, 255, 0.09); }
  .lead-result-compact-panel li strong { color: var(--foreground); font-size: 12px; }
  .lead-result-compact-panel li span { color: var(--muted-foreground); font-size: 11px; line-height: 1.4; }
  .lead-result-compact-panel li small { color: var(--muted-soft); font-size: 10px; line-height: 1.4; }
  .lead-result-compact-panel > p { padding: 14px; }
  .lead-result-rankings-wrap { max-height: none; overflow: auto; }
  .performance-rankings table { min-width: 2200px; }
  .performance-rankings thead { position: sticky; top: 0; z-index: 3; }
  .performance-rankings tbody tr:hover { background: rgba(166, 107, 255, 0.055); }
  .sort-button {
    width: 100%;
    display: inline-flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    padding: 0;
    color: inherit;
    border: 0;
    border-radius: 4px;
    background: transparent;
    font: inherit;
    text-align: left;
  }
  .sort-button:hover, .sort-button:focus-visible { color: #E5D7FF; background: transparent; }
  .sort-button[aria-sort="ascending"] span::after { content: "↑"; }
  .sort-button[aria-sort="descending"] span::after { content: "↓"; }
  .sort-button[aria-sort] span { font-size: 0; }
  .sort-button[aria-sort] span::after { font-size: 11px; }

  body:not([data-dashboard-view]) main {
    width: min(1500px, calc(100vw - 48px));
    padding-top: 24px;
  }
  body:not([data-dashboard-view]) .topbar { padding: 20px 22px; }
  body:not([data-dashboard-view]) .page-brand,
  body:not([data-dashboard-view]) .call-brand { min-width: 150px; max-width: 188px; }

  @media (max-width: 1100px) {
    body[data-dashboard-view] aside {
      width: 264px;
      transform: translateX(-100%);
      box-shadow: 18px 0 42px rgba(0, 0, 0, 0.34);
    }
    body[data-dashboard-view] .app-frame,
    body.sidebar-collapsed .app-frame { margin-left: 0; }
    body.sidebar-open aside { transform: translateX(0); }
    .sidebar-overlay {
      position: fixed;
      inset: 0;
      z-index: 55;
      display: block;
      border: 0;
      border-radius: 0;
      background: rgba(5, 7, 14, 0.66);
      opacity: 0;
      pointer-events: none;
    }
    body.sidebar-open .sidebar-overlay { opacity: 1; pointer-events: auto; }
    .sidebar-collapse.sidebar-mobile-toggle { display: grid; }
    body[data-dashboard-view] .app-topnav {
      grid-template-columns: auto minmax(220px, 1fr) auto;
      padding-inline: 20px;
    }
    .topnav-context { display: none; }
    body[data-dashboard-view] aside .brand-logo { display: flex; }
    body[data-dashboard-view] aside .brand-identity > div:not(.brand-logo) { display: block; }
    body[data-dashboard-view] aside .product-switcher .nav-text,
    body[data-dashboard-view] aside .nav-text { display: inline; }
    body[data-dashboard-view] aside .nav-label { display: block; }
    body[data-dashboard-view] aside .on-page-link { display: flex; }
    body[data-dashboard-view] aside .brand-settings { display: block; }
    body[data-dashboard-view] aside .brand-monogram { display: none; }
  }
  @media (max-width: 900px) {
    .lead-chart-grid,
    .lead-chart-grid-primary,
    .lead-result-chart-grid,
    .lead-result-panel-grid { grid-template-columns: 1fr; }
    .lead-result-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    body[data-dashboard-view] {
      max-width: 100vw;
      overflow-x: clip;
    }
    body[data-dashboard-view] .layout,
    body[data-dashboard-view] .app-frame,
    body[data-dashboard-view] .app-frame > main,
    body[data-dashboard-view] .app-topnav,
    body[data-dashboard-view] .topbar,
    body[data-dashboard-view] .workspace-flow,
    body[data-dashboard-view] .panel,
    body[data-dashboard-view] .panel-header,
    body[data-dashboard-view] .panel-body,
    body[data-dashboard-view] .metrics,
    body[data-dashboard-view] .metric {
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    body[data-dashboard-view] .app-topnav {
      min-height: auto;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      padding: 10px 14px;
    }
    .top-search {
      grid-column: 1 / -1;
      grid-row: 2;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    .top-search input { min-width: 0; }
    .topnav-actions {
      grid-column: 2;
      grid-row: 1;
      min-width: 0;
      max-width: 100%;
      justify-self: end;
    }
    .topnav-actions .topnav-link:not(:last-child) { display: none; }
    body[data-dashboard-view] .app-frame > main { padding: 20px 16px 38px; }
    body[data-dashboard-view] .topbar { gap: 14px; }
    body[data-dashboard-view] .topbar > div,
    body[data-dashboard-view] .topbar p,
    body[data-dashboard-view] .panel-header > *,
    body[data-dashboard-view] .panel-body > * {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    body[data-dashboard-view] .topbar .stack,
    body[data-dashboard-view] .panel-header .stack {
      display: flex;
      width: 100%;
      flex-wrap: wrap;
    }
    body[data-dashboard-view] .topbar .badge {
      width: auto;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    body[data-dashboard-view] .metrics { grid-template-columns: 1fr; }
    .lead-result-kpis { grid-template-columns: 1fr; }
    .metric { min-height: 112px; }
    .panel-header, .panel-body { padding-inline: 16px; }
    .lead-age-figure { min-height: 0; grid-template-columns: 1fr; }
    .lead-age-donut { width: min(190px, 72vw); }
    .performance-range-form { align-items: stretch; padding-inline: 16px; }
    .performance-range-form label { flex: 1 1 140px; }
    .performance-range-form > .muted { width: 100%; margin-left: 0; }
    body:not([data-dashboard-view]) main { width: min(100vw - 24px, 1500px); padding-top: 12px; }
  }
  @media (max-width: 520px) {
    body[data-dashboard-view] .topnav-actions { display: none; }
    body[data-dashboard-view] .app-topnav {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .daily-allocation-chart { height: 230px; gap: 5px; padding-inline: 2px; }
    .daily-allocation-track { width: min(34px, 88%); }
    .lead-chart-row-head { align-items: flex-start; }
    .lead-chart-value { text-align: right; }
    .lead-usage-signals { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #FFFFFF !important; color: #111827 !important; }
    body[data-dashboard-view] aside,
    body[data-dashboard-view] .app-topnav,
    body[data-dashboard-view] .sidebar-overlay {
      display: none !important;
    }
    body[data-dashboard-view] .app-frame {
      margin: 0 !important;
    }
    body[data-dashboard-view] .app-frame > main,
    body:not([data-dashboard-view]) main {
      width: 100% !important;
      padding: 0 !important;
    }
    .panel, .metric, .topbar { break-inside: avoid; box-shadow: none !important; }
  }
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
  const key = normalizeColumnLabel(typeof header === "string" ? labelValue : header?.columnKey || header?.key || labelValue);
  return `<th scope="col" data-column-key="${escapeHtml(key)}" data-column-label="${label}"><span class="column-help" tabindex="0" aria-label="${escapeHtml(`${labelValue}: ${descriptionValue}`)}">${label}<span class="column-help-mark" aria-hidden="true">?</span><span class="column-tooltip" role="tooltip">${description}</span></span></th>`;
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

function sourceDateFilters(value) {
  const isoDate = isoDateFromParts(parseSourceDateParts(value) || {});
  return isoDate ? { dateFrom: isoDate, dateTo: isoDate } : {};
}

function hrefDataLink(value, href, label = "") {
  const ariaLabel = label ? ` aria-label="${escapeHtml(label)}"` : "";
  return href
    ? `<a class="data-link" href="${escapeHtml(href)}"${ariaLabel}>${escapeHtml(value)}</a>`
    : escapeHtml(value);
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

function linkedBadge(label, tone = "neutral", href = "") {
  return href
    ? `<a class="badge ${tone}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : badge(label, tone);
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
  const hasResult = Boolean(String(row.llm_result_json || "").trim());
  if (hasResult) return "Research-only archive";
  if (status === "queued") return "Retired queue record";
  if (status === "failed" || status === "completed") return "Retired historical record";
  return "No research artifact";
}

function confidenceBandLabel(band) {
  if (band === "high") return "High confidence";
  if (band === "medium") return "Medium confidence";
  if (band === "low") return "Low confidence";
  if (band === "unusable") return "Unusable transcript";
  return "Confidence unavailable";
}

function resultConfidenceBand(row = {}) {
  if (row.confidenceBand) return row.confidenceBand;
  if (row.status === "failed" || row.transcriptQuality === "unusable") return "unusable";
  const confidence = Number(row.confidence);
  if (!Number.isFinite(confidence)) return "confidence_unavailable";
  if (confidence >= 0.78) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
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
    : `<article class="metric ${tone}" data-drilldown="not-applicable" title="No row-level drill-down is available for this status or configuration value.">${content}</article>`;
}

function evaluationResultsUrl(filters = {}) {
  const query = new URLSearchParams();
  Object.entries({ limit: 100, offset: 0, ...filters }).forEach(([key, value]) => {
    if (value === "" || value === null || value === undefined) return;
    query.set(key, String(value));
  });
  return `/evaluation-studio?${query.toString()}#results`;
}

function evaluationBreakdownFilters(dimension, label) {
  if (dimension === "Salesperson") return { salesperson: label };
  if (dimension === "Source") return { customerImportSource: label };
  if (dimension === "Called on behalf of") return { foundationCalledOnBehalfOf: label };
  if (dimension === "Date") {
    const isoDate = isoDateFromParts(parseSourceDateParts(label) || {});
    return isoDate ? { dateFrom: isoDate, dateTo: isoDate } : {};
  }
  return {};
}

function aggregateResultLink(value, filters = {}, label = "") {
  const accessibleLabel = label || `View the ${formatNumber(value)} contributing evaluation results`;
  return `<a class="aggregate-drill-link" href="${escapeHtml(evaluationResultsUrl(filters))}" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(value)}</a>`;
}

function table(headers, rows, emptyMessage = "No rows to show", options = {}) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  }

  const tableAttributes = [
    options.key ? `data-table-key="${escapeHtml(options.key)}"` : "",
    options.defaultHidden?.length ? `data-default-hidden="${escapeHtml(options.defaultHidden.join(","))}"` : "",
    options.compactColumns?.length ? `data-compact-columns="${escapeHtml(options.compactColumns.join(","))}"` : ""
  ].filter(Boolean).join(" ");
  return `<div class="table-wrap"><table${tableAttributes ? ` ${tableAttributes}` : ""}>
    <thead><tr>${headers.map(renderTableHeading).join("")}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${headers.map((header) => `<td data-label="${escapeHtml(header.label || header.key || "Value")}">${header.render ? header.render(row) : escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}
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
  const detailsId = `audit-${String(row.call_id || "").replace(/[^A-Za-z0-9_-]/g, "")}`;
  return `<details class="audit-details" id="${escapeHtml(detailsId)}">
    <summary>
      <span>Audit extraction</span>
      ${provenanceBadge(llmReviewState(row))}
      ${badge(qualityLabel, toneForResultQuality(quality))}
      ${badge("Not operational", "warning")}
    </summary>
    <div class="audit-grid">
      <div class="audit-section">
        <h3>Research boundary</h3>
        <div class="notice-box"><strong>Failed or unpromoted evaluator</strong><p>This payload is retained only to audit model behaviour. Its labels, confidence, scores, events, entities, and risk flags must not influence customer handling, staff assessment, reporting, or queues.</p></div>
        <a class="proof-link" href="/calls/${encodeURIComponent(row.call_id)}">Open transcript for direct inspection</a>
      </div>
      <div class="audit-section">
        <h3>Archived event suggestions</h3>
        ${auditList(row.llm_events, "events")}
      </div>
      <div class="audit-section">
        <h3>Archived entity suggestions</h3>
        ${auditList(row.llm_entities, "entities")}
      </div>
      <div class="audit-section">
        <h3>Archived risk-flag suggestions</h3>
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
    <tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderSafeReportInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function renderSafeReportInline(value) {
  const text = String(value || "");
  const linkPattern = /\[([^\]]+)\]\((\/[^\s)]+)\)/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(linkPattern)) {
    html += escapeHtml(text.slice(cursor, match.index));
    html += `<a class="data-link" href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`;
    cursor = Number(match.index) + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function renderReportDrilldownPanel(report) {
  if (!report || report.type !== "lead_utilization_report") return "";
  return `<div class="note"><strong>Retired report.</strong> This historical report used an unvalidated utilisation judgement and is not operational.</div>`;
}

function renderReportControls(report = {}) {
  const controls = report.controls;
  if (!controls?.action) return "";
  return `<form class="report-controls" method="get" action="${escapeHtml(controls.action)}">
    ${controls.salesperson ? `<input type="hidden" name="reportSalesperson" value="${escapeHtml(controls.salesperson)}" />` : ""}
    <label>From date
      <input type="date" name="dateFrom" value="${escapeHtml(controls.dateFrom || "")}" />
    </label>
    <label>To date
      <input type="date" name="dateTo" value="${escapeHtml(controls.dateTo || "")}" />
    </label>
    <label>Calls in the attempt plan
      <input type="number" min="2" max="10" name="requiredAttempts" value="${escapeHtml(controls.requiredAttempts || 4)}" />
    </label>
    <label>Waiting days after the last call
      <input type="number" min="0" max="30" name="graceDays" value="${escapeHtml(controls.graceDays ?? 3)}" />
    </label>
    <button type="submit">Update report</button>
  </form>`;
}

function renderReportChart(title, rows = []) {
  if (!rows.length) return "";
  const maximum = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return `<section class="report-chart">
    <h2>${escapeHtml(title)}</h2>
    <div class="report-bars">${rows.map((row) => {
      const value = Number(row.value || 0);
      const width = Math.max(value > 0 ? 1.5 : 0, (value / maximum) * 100);
      return `<div class="report-bar-row">
        <div class="report-bar-label"><strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(value)}</span></div>
        <div class="report-bar-track"><span class="report-bar-fill ${escapeHtml(row.tone || "neutral")}" style="width:${width}%"></span></div>
        ${row.explanation ? `<p>${escapeHtml(row.explanation)}</p>` : ""}
      </div>`;
    }).join("")}</div>
  </section>`;
}

function renderReportCharts(report = {}) {
  const charts = report.charts || {};
  if (!(charts.status?.length || charts.attempts?.length)) return "";
  return `<div class="report-chart-grid">
    ${renderReportChart("What happened to the records", charts.status || [])}
    ${renderReportChart("How many calls are visible", charts.attempts || [])}
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

function renderPerformanceEvidenceTable(result = {}) {
  const rows = result.rows || [];
  const evidenceRef = (row) => `<span class="mono">${escapeHtml(row.evidenceRef || "Unavailable")}</span>`;
  const performanceEvidenceUrl = (metric, filters = {}) => `/drilldown?${new URLSearchParams({
    metric,
    ...filters,
    ...(result.returnView ? { returnView: result.returnView } : {}),
    ...(result.period?.startDate ? { performanceFrom: result.period.startDate } : {}),
    ...(result.period?.endDate ? { performanceTo: result.period.endDate } : {})
  }).toString()}`;
  const acquisitionSourceCell = (row) => `${escapeHtml(row.acquisitionSource || "Unknown")}${
    row.acquisitionSourceProven
      ? ""
      : `<br /><span class="muted small">Source not proven</span>`
  }`;
  const callStatus = (row) => row.callObservationStatus === "exact_call_observed"
    ? badge("Exact call observed", "success")
    : badge("Allocated lead with no recorded call", "warning");
  const conversionStatus = (row) => {
    if (row.observedConversionStatus === "observed_converted") return badge("Approved order observed", "success");
    if (row.observedConversionStatus === "no_approved_order_observed") return badge("No approved order observed", "neutral");
    return badge("Not scored", "warning");
  };
  if (result.recordType === "salesperson_summary") {
    return table([
      { label: "Evidence", render: evidenceRef },
      { label: "Salesperson", key: "salesperson" },
      { label: "Manager", key: "manager" },
      { label: "Sent Leads", render: (row) => `<span class="mono">${formatNumber(row.sentAllocationEvents)}</span>` },
      { label: "Unique Leads", render: (row) => `<span class="mono">${formatNumber(row.uniqueCustomers)}</span>` },
      { label: "Approved Sales", render: (row) => `<span class="mono">${formatNumber(row.approvedSales)}</span>` },
      { label: "Allocated / Self", render: (row) => `${formatNumber(row.companySourcedSales)} / ${formatNumber(row.selfSourcedSales)}` },
      { label: "Exact Calls Observed", render: (row) => `<span class="mono">${formatNumber(row.customersCalledAfterAllocation)}</span>` },
      { label: "Scoring", render: (row) => `${escapeHtml(row.salesCoverageStatus || "Unknown")}<br /><span class="muted small">${escapeHtml(row.callCoverageStatus || "Unknown")}</span>` }
    ], rows, "No salespeople receiving leads match this drill-down.");
  }
  if (result.recordType === "allocation_event") {
    return table([
      { label: "Evidence", render: evidenceRef },
      { label: "Sent", render: (row) => `<span class="mono">${escapeHtml([row.sentDate, row.sentTime].filter(Boolean).join(" "))}</span>` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Manager", key: "manager" },
      { label: "Allocation source", key: "source" },
      { label: "Allocation", key: "allocationName" },
      { label: "Lead import date", render: (row) => row.leadImportDate ? `<span class="mono">${escapeHtml(row.leadImportDate)}</span>` : `<span class="muted small">${escapeHtml(row.leadImportDateStatus || "Unavailable")}</span>` },
      { label: "Lead age", key: "leadAgeBucket" }
    ], rows, "No privacy-safe allocation events match this drill-down.");
  }
  if (result.recordType === "repeat_allocation_event") {
    return table([
      { label: "Evidence", render: evidenceRef },
      { label: "First sent", render: (row) => `<span class="mono">${escapeHtml(row.firstSentDate || "Unavailable")}</span>` },
      { label: "Repeat sent", render: (row) => `<span class="mono">${escapeHtml([row.repeatSentDate, row.repeatSentTime].filter(Boolean).join(" "))}</span>` },
      { label: "Repeat number", render: (row) => `<span class="mono">${formatNumber(row.repeatNumber)}</span>` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Manager", key: "manager" },
      { label: "Allocation source", key: "source" },
      { label: "Allocation", key: "allocationName" }
    ], rows, "No privacy-safe repeat allocation events match this drill-down.");
  }
  if (result.recordType === "allocated_lead") {
    return table([
      { label: "Evidence", render: evidenceRef },
      { label: "First sent", render: (row) => `<span class="mono">${escapeHtml(row.firstSentDate || "Unavailable")}</span>` },
      { label: "Sent events", render: (row) => `<span class="mono">${formatNumber(row.sentEventCount)}</span>` },
      { label: "Recipients", render: (row) => `${formatNumber(row.recipientCount)}<br /><span class="muted small">${escapeHtml((row.recipients || []).join(", "))}</span>` },
      { label: "Allocation sources", render: (row) => escapeHtml((row.sources || []).join(", ")) },
      { label: "Observed call", render: (row) => row.anyExactCallObserved ? badge("Observed", "success") : badge("Not observed", "warning") }
    ], rows, "No privacy-safe allocated leads match this drill-down.");
  }
  if (result.recordType === "allocation_pair") {
    return table([
      { label: "Evidence", render: evidenceRef },
      ...(result.privacyMode === "local_manager_identifiers" ? [
        { label: "Business Name", key: "companyName", columnKey: "business_name", description: "The business name from the governed allocation record, included so this row can be audited locally." },
        { label: "Customer ID", render: (row) => `<span class="mono">${escapeHtml(row.customerId || "Unavailable")}</span>`, description: "The governed customer identifier used to reconcile this allocation evidence." }
      ] : []),
      { label: "First sent", render: (row) => `<span class="mono">${escapeHtml([row.firstSentDate, row.firstSentTime].filter(Boolean).join(" "))}</span>` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Manager", key: "manager" },
      { label: "Allocation source", key: "source" },
      { label: "Sent events", render: (row) => `<span class="mono">${formatNumber(row.sentEventCount)}</span>` },
      { label: "Call observation", render: (row) => `${callStatus(row)}${row.firstObservedCallDate ? `<br /><span class="muted small">First observed ${escapeHtml(row.firstObservedCallDate)}</span>` : ""}` },
      { label: "Observed sales", render: (row) => `${conversionStatus(row)}${row.exactApprovedOrders !== null && row.exactApprovedOrders !== undefined ? `<br /><span class="muted small">${formatNumber(row.exactApprovedOrders)} orders · ${Number(row.exactApprovedValue || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" })}</span>` : ""}` }
    ], rows, "No customer-recipient allocation pairs match this drill-down.", {
      key: `performance-drilldown-${result.metric}`,
      compactColumns: result.privacyMode === "local_manager_identifiers"
        ? ["business_name", "customer_id", "salesperson", "manager", "call_observation", "observed_sales"]
        : ["evidence", "salesperson", "manager", "call_observation", "observed_sales"]
    });
  }
  if (result.recordType === "approved_sale") {
    return table([
      { label: "Order / invoice", render: (row) => `<span class="mono">${escapeHtml(row.orderNumber || "Unavailable")}</span>` },
      { label: "Business", key: "businessName" },
      { label: "Customer ID", render: (row) => `<span class="mono">${escapeHtml(row.customerId || "Unavailable")}</span>` },
      { label: "Approved", render: (row) => `<span class="mono">${escapeHtml(row.approvalDate || "Unavailable")}</span>` },
      { label: "Seller", key: "seller" },
      { label: "Acquisition source", render: acquisitionSourceCell },
      { label: "Lead classification", key: "leadSourceClassification" },
      { label: "Approved amount", render: (row) => Number(row.approvedValue || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" }) },
      {
        label: "Lead-source proof",
        render: (row) => row.leadSourceProofStatus === "exact_governed_history_pre_sale_seller_allocation"
          ? `<a class="allocation-link" href="${escapeHtml(performanceEvidenceUrl("performance.exactAllocationLink", { orderNumber: row.orderNumber }))}">
              ${badge("Company Sourced", "success")}
              <span>Exact seller allocation in governed history<br /><strong>View pre-sale allocation</strong></span>
            </a>`
          : row.leadSourceProofStatus === "exact_weekly_pre_sale_seller_allocation"
            ? `<a class="allocation-link" href="${escapeHtml(performanceEvidenceUrl("performance.weeklyAllocationLink", { orderNumber: row.orderNumber }))}">
                ${badge("Company Sourced", "success")}
                <span>Exact customer and full-seller allocation before approval<br /><strong>View weekly allocation proof</strong></span>
              </a>`
          : row.leadSourceProofStatus === "no_exact_pre_sale_seller_allocation_in_combined_sources"
            ? `${badge("Self Sourced", "notice")}<br /><span class="muted small">No exact pre-sale seller allocation in the combined reports</span>`
            : `${badge("Proof unavailable", "warning")}<br /><span class="muted small">Historical classification proof did not reconcile</span>`
      },
      {
        label: "Weekly allocation match",
        render: (row) => row.weeklyAllocationMatchStatus === "matched_in_selected_week"
          ? `<a class="allocation-link" href="${escapeHtml(performanceEvidenceUrl("performance.weeklyAllocationLink", { orderNumber: row.orderNumber }))}">
              ${badge("Matched", "success")}
              <span>${escapeHtml(row.allocationSource)} · ${escapeHtml(row.firstAllocationDate)}<br /><strong>View selected-week match</strong></span>
            </a>`
          : `${badge("Not in weekly log", "neutral")}<br /><span class="muted small">Cannot downgrade governed history</span>`
      }
    ], rows, "No approved-sale evidence matches this drill-down.");
  }
  if (result.recordType === "historical_allocation_link") {
    return table([
      { label: "Order / invoice", render: (row) => `<span class="mono">${escapeHtml(row.orderNumber || "Unavailable")}</span>` },
      { label: "Business", key: "businessName" },
      { label: "Customer ID", render: (row) => `<span class="mono">${escapeHtml(row.customerId || "Unavailable")}</span>` },
      { label: "Approved", render: (row) => `<span class="mono">${escapeHtml(row.approvalDate || "Unavailable")}</span>` },
      { label: "Seller", key: "seller" },
      { label: "Approved amount", render: (row) => Number(row.approvedValue || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" }) },
      { label: "Acquisition source", render: acquisitionSourceCell },
      { label: "Lead classification", key: "leadSourceClassification" },
      { label: "Allocation item", render: (row) => `<span class="mono">${escapeHtml(row.allocationItemId || "Unavailable")}</span>` },
      { label: "History ID", render: (row) => `<span class="mono">${escapeHtml(row.allocationHistoryId || "Unavailable")}</span>` },
      { label: "Allocated to", key: "allocationRecipient" },
      { label: "Manager", key: "allocationManager" },
      { label: "Effective start", render: (row) => `<span class="mono">${escapeHtml(row.allocationEffectiveStart || "Unavailable")}</span>` },
      { label: "Inactivated", render: (row) => `<span class="mono">${escapeHtml(row.allocationInactivatedAt || "Still active / unavailable")}</span>` },
      { label: "Active at sale", render: (row) => row.allocationActiveAtSale ? badge("Yes", "success") : badge("No", "neutral") },
      { label: "Description", key: "allocationDescription" },
      { label: "Governing rule", render: (row) => `<span class="evidence-summary">${escapeHtml(row.linkRule || "Unavailable")}</span>` }
    ], rows, "No authoritative historical allocation proof matches this order.");
  }
  if (result.recordType === "weekly_allocation_link") {
    return table([
      { label: "Order / invoice", render: (row) => `<span class="mono">${escapeHtml(row.orderNumber || "Unavailable")}</span>` },
      { label: "Business", key: "businessName" },
      { label: "Customer ID", render: (row) => `<span class="mono">${escapeHtml(row.customerId || "Unavailable")}</span>` },
      { label: "Approved", render: (row) => `<span class="mono">${escapeHtml(row.approvalDate || "Unavailable")}</span>` },
      { label: "Seller", key: "seller" },
      { label: "Approved amount", render: (row) => Number(row.approvedValue || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" }) },
      { label: "Lead classification", key: "leadSourceClassification" },
      { label: "Allocation item", render: (row) => `<span class="mono">${escapeHtml(row.allocationItemId || "Unavailable")}</span>` },
      { label: "Allocated to", key: "allocationRecipient" },
      { label: "Manager", key: "allocationManager" },
      { label: "Allocation sent", render: (row) => `<span class="mono">${escapeHtml([row.allocationSentDate, row.allocationSentTime].filter(Boolean).join(" ") || "Unavailable")}</span>` },
      { label: "Allocation source", key: "allocationSource" },
      { label: "Allocation", key: "allocationName" },
      { label: "Weekly-match rule", render: (row) => `<span class="evidence-summary">${escapeHtml(row.linkRule || "Unavailable")}</span>` }
    ], rows, "No selected-week allocation match exists for this order.");
  }
  if (result.recordType === "duplicate_allocation") {
    return table([
      { label: "Evidence", render: evidenceRef },
      { label: "Sent", render: (row) => `<span class="mono">${escapeHtml([row.sentDate, row.sentTime].filter(Boolean).join(" "))}</span>` },
      { label: "Salesperson", key: "salesperson" },
      { label: "Manager", key: "manager" },
      { label: "Allocation source", key: "source" },
      { label: "Allocation", key: "allocationName" },
      { label: "Reason", key: "exclusionReason" }
    ], rows, "No privacy-safe logical duplicate evidence matches this drill-down.");
  }
  return `<div class="empty">No supported privacy-safe evidence table is available.</div>`;
}

function renderDrilldownPage(result) {
  const rows = result.rows || [];
  const isPerformance = result.kind === "performanceAggregate";
  const isIdentifiedPerformance = isPerformance && result.privacyMode === "local_manager_identifiers";
  const baseParams = {
    metric: result.metric,
    ...(result.filterState?.query || {}),
    ...(result.filters?.salesperson ? { salesperson: result.filters.salesperson } : {}),
    ...(result.filters?.manager ? { manager: result.filters.manager } : {}),
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
    ...(result.filters?.businessSegment ? { businessSegment: result.filters.businessSegment } : {}),
    ...(result.filters?.acquisitionSource ? { acquisitionSource: result.filters.acquisitionSource } : {}),
    ...(result.filters?.approvalDate ? { approvalDate: result.filters.approvalDate } : {}),
    ...(result.filters?.sentDate ? { sentDate: result.filters.sentDate } : {}),
    ...(result.filters?.classification ? { classification: result.filters.classification } : {}),
    ...(result.filters?.leadAgeBucket ? { leadAgeBucket: result.filters.leadAgeBucket } : {}),
    ...(result.filters?.callObservationStatus ? { callObservationStatus: result.filters.callObservationStatus } : {}),
    ...(result.filters?.conversionStatus ? { conversionStatus: result.filters.conversionStatus } : {}),
    ...(result.filters?.allocationFrequency ? { allocationFrequency: result.filters.allocationFrequency } : {}),
    ...(result.filters?.orderNumber ? { orderNumber: result.filters.orderNumber } : {}),
    ...(result.reconciliation?.metric ? { reconcile: result.reconciliation.metric } : {}),
    ...(result.returnView ? { returnView: result.returnView } : {}),
    ...(isPerformance && result.period?.startDate ? { performanceFrom: result.period.startDate } : {}),
    ...(isPerformance && result.period?.endDate ? { performanceTo: result.period.endDate } : {})
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
    result.filters?.manager ? `Manager team: ${result.filters.manager}` : "",
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
    result.filters?.businessSegmentLabel ? `Business: ${result.filters.businessSegmentLabel}` : "",
    result.filters?.acquisitionSource ? `Acquisition source: ${result.filters.acquisitionSource}` : "",
    result.filters?.approvalDate ? `Approval date: ${result.filters.approvalDate}` : "",
    result.filters?.sentDate ? `Sent date: ${result.filters.sentDate}` : "",
    result.filters?.classification ? `Lead classification: ${result.filters.classification}` : "",
    result.filters?.leadAgeBucket ? `Lead age: ${result.filters.leadAgeBucket}` : "",
    result.filters?.callObservationStatus ? `Call observation: ${result.filters.callObservationStatus}` : "",
    result.filters?.conversionStatus ? `Observed conversion: ${result.filters.conversionStatus}` : "",
    result.filters?.allocationFrequency ? `Allocation frequency: ${result.filters.allocationFrequency}` : "",
    result.filters?.orderNumber ? `Order / invoice: ${result.filters.orderNumber}` : "",
    isPerformance && result.period?.label ? `Performance period: ${result.period.label}` : ""
  ].filter(Boolean);
  const visibleStart = result.count ? (result.offset || 0) + 1 : 0;
  const visibleEnd = result.count ? (result.offset || 0) + result.displayedCount : 0;
  const isReattempt = result.kind === "reattempt";
  const isSystemAudio = result.kind === "systemAudio";
  const isHarvest = result.kind === "harvest";
  const reconciliationPanel = isPerformance && result.reconciliation
    ? `<div class="note" style="margin-bottom:12px;"><strong>Figure reconciliation</strong><p class="muted small">${formatNumber(result.reconciliation.numerator)} Sales From Allocated Leads ÷ ${formatNumber(result.reconciliation.denominator)} classified Approved Sales = ${formatRatioPercent(result.reconciliation.value)}. ${formatRatioPercent(result.reconciliation.sourceCoverage)} of Approved Sales are classified${result.reconciliation.attributionWithheldSales ? `; ${formatNumber(result.reconciliation.attributionWithheldSales)} unresolved sale${result.reconciliation.attributionWithheldSales === 1 ? "" : "s"} create${result.reconciliation.attributionWithheldSales === 1 ? "s" : ""} a possible range of ${formatRatioPercent(result.reconciliation.lowerBound)}–${formatRatioPercent(result.reconciliation.upperBound)}. ${result.reconciliation.comparable ? "This remains comparable because unresolved attribution is below 3%." : "This is provisional and excluded from source-share comparisons because unresolved attribution is 3% or more."}` : " with no unresolved attribution."}</p></div>`
    : "";

  const rowTable = isPerformance
    ? renderPerformanceEvidenceTable(result)
    : isLead
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
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      ${COLUMN_HELP_STYLES}
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
      .allocation-link {
        display: inline-flex;
        align-items: flex-start;
        gap: 7px;
        color: var(--muted-foreground);
        text-decoration: none;
        line-height: 1.35;
      }
      .allocation-link strong { color: var(--accent); font-size: 12px; }
      .allocation-link:hover strong { color: var(--foreground); }
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
      ${PANELIFY_THEME_STYLES}
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div class="page-title">
          <a class="page-brand" href="/#overview"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></a>
          <div>
            <p class="page-kicker">${isIdentifiedPerformance ? "Local manager source evidence" : isPerformance ? "Privacy-safe source evidence" : "Drill-down proof"}</p>
            <h1>${escapeHtml(result.title)}</h1>
            <p class="muted">${escapeHtml(result.description)}</p>
            <p class="muted small">${escapeHtml(filters.length ? filters.join(" | ") : "No extra filters")} | Showing ${formatNumber(visibleStart)}-${formatNumber(visibleEnd)} of ${formatNumber(result.count)} records.</p>
          </div>
        </div>
        <div class="drill-actions">
          <a class="button-link" href="${isPerformance ? escapeHtml(`${result.returnView === "lead_results" ? "/lead-results-dashboard" : "/"}?${new URLSearchParams({ ...(result.returnView === "lead_results" ? {} : { view: "performance" }), performanceFrom: result.period?.startDate || "", performanceTo: result.period?.endDate || "" }).toString()}#${result.returnView === "lead_results" ? "lead-results-summary" : "performance-summary"}`) : "/#overview"}">Dashboard</a>
          <a class="button-link" href="${escapeHtml(apiPath)}">JSON</a>
          <a class="button-link" href="${escapeHtml(fullJsonPath)}">Full JSON</a>
        </div>
      </header>
      <section class="panel">
        <div class="stack" style="margin-bottom: 12px;">
          <span class="badge">${escapeHtml(result.metric)}</span>
          <span class="badge">${escapeHtml(isIdentifiedPerformance ? "Local identifiers included" : isPerformance ? "Privacy-safe evidence breakdown" : isLead ? "Matched-record proof" : isReattempt ? "Reattempt proof" : isSystemAudio ? "System audio proof" : isHarvest ? "Lead harvest proof" : "Call-row proof")}</span>
          <span class="badge">Ignored: ${escapeHtml((result.excludedRawFields || result.excludedFields || []).join(", "))}</span>
        </div>
        ${isPerformance && result.limitations?.length ? `<div class="empty" style="margin-bottom:12px;">${result.limitations.map((item) => escapeHtml(item)).join("<br />")}</div>` : ""}
        ${reconciliationPanel}
        <div class="drill-actions" style="margin-bottom: 12px;">
          ${result.previousOffset !== null && result.previousOffset !== undefined ? `<a class="button-link" href="${escapeHtml(pageUrl({ offset: result.previousOffset }))}">Previous</a>` : ""}
          ${result.nextOffset !== null && result.nextOffset !== undefined ? `<a class="button-link" href="${escapeHtml(pageUrl({ offset: result.nextOffset }))}">Next</a>` : ""}
        </div>
        ${rowTable}
      </section>
    </main>
    ${TABLE_COLUMNS_SCRIPT}
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
  const capabilityPolicy = aiStatus.capabilityPolicy || {};
  const statusText = capabilityPolicy.liveSubmissionPermitted
    ? "A promoted capability is available through the governed Evaluation Studio."
    : "Local-model evaluation is quarantined. No current evaluator is independently promoted.";

  return `<section class="grid-2">
        <div class="panel">
          <h2>Local-model status</h2>
          <p class="muted small" style="margin-bottom: 12px;">${escapeHtml(statusText)}</p>
          <div class="notice-box"><strong>No call submission available</strong><p>Historical model jobs are retained below for audit only. They cannot create outcomes, actions, scores, queues, or routes.</p></div>
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
  const content = `
    <span>${escapeHtml(label)}</span>
    <${tag} class="${className}">${escapeHtml(value)}</${tag}>`;
  return options.href
    ? `<a class="dataset-fact" href="${escapeHtml(options.href)}">${content}</a>`
    : `<div class="dataset-fact" data-drilldown="not-applicable" title="No record-level drill-down is available for this summary or configuration value.">${content}</div>`;
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
  const importHref = persistence?.currentImportId ? `/imports/${encodeURIComponent(persistence.currentImportId)}` : "";
  const allCallsHref = drilldownUrl("calls.unique");
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
        ${linkedBadge(`${formatNumber(totals.uniqueCalls || 0)} calls`, "notice", allCallsHref)}
        ${linkedBadge("Active call data only", "success", allCallsHref)}
      </div>
    </div>
    <div class="panel-body">
      <div class="dataset-grid dataset-grid-primary">
        ${datasetFact("Source file", safeSourceFilename(data.sourceName), { href: importHref })}
        ${datasetFact("Deduplicated calls", formatNumber(totals.uniqueCalls || 0), { mono: true, href: allCallsHref })}
        ${datasetFact("Active range", formatDateRange(data.dateRange), { href: allCallsHref })}
        ${datasetFact("Last processed", formatDateTime(lastProcessed), { href: importHref })}
      </div>
      ${renderDataWindowWarnings(data)}
      <details class="context-details">
        <summary>Import details and data handling</summary>
        <div class="dataset-grid context-details-grid">
          ${datasetFact("Import ID", importId, { mono: true, href: importHref })}
          ${datasetFact("File hash", shortHash(data.inputHash), { mono: true, href: importHref })}
          ${datasetFact("Imported rows", formatNumber(totals.rawRows || 0), { mono: true, href: importHref })}
          ${datasetFact("Duplicate rows ignored", formatNumber(duplicateCount), { mono: true, href: importHref })}
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
        ${datasetFact("Filtered calls", formatNumber(summary.filteredRecords || 0), { mono: true, href: drilldownUrl("calls.unique", filterState.query || {}) })}
        ${datasetFact("Total calls", formatNumber(summary.totalRecords || 0), { mono: true, href: drilldownUrl("calls.unique") })}
        ${datasetFact("Records excluded", formatNumber(summary.excludedRecords || 0), { mono: true })}
        ${datasetFact("Included", formatPercent(summary.includedRate || 0), { mono: true, href: drilldownUrl("calls.unique", filterState.query || {}) })}
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
          <summary>More filters: literal triage, raw fields, reviews and alerts</summary>
          <div class="filter-form advanced">
            ${filterSelect("contactClassification", "Literal contact triage", options.contactClassification, selectedFilterValues(filterState, "contactClassification"))}
            ${filterSelect("localOutcome", "Literal terminal triage", options.localOutcome, selectedFilterValues(filterState, "localOutcome"))}
            ${filterSelect("llmStatus", "LLM status", options.llmStatus, selectedFilterValues(filterState, "llmStatus"))}
            ${filterSelect("managerReviewStatus", "Manager review", options.managerReviewStatus, selectedFilterValues(filterState, "managerReviewStatus"))}
            ${filterSelect("alertSeverity", "Alert severity", options.alertSeverity, selectedFilterValues(filterState, "alertSeverity"))}
            ${filterSelect("userId", "User ID", options.userId, selectedFilterValues(filterState, "userId"))}
            ${filterSelect("callerId", "Caller ID", options.callerId, selectedFilterValues(filterState, "callerId"))}
            ${filterSelect("mobile", "Mobile", options.mobile, selectedFilterValues(filterState, "mobile"))}
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
          <p class="muted small">Activity rates use filtered deduplicated calls unless a card says otherwise. Transcript availability is a raw coverage fact. Literal-triage counts require an exact rule match; manager counts require a saved manager action.</p>
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
  const reviewGovernance = data.managerReviewGovernance || persistence.managerReviewGovernance || {};
  const managerReviewed = Number(reviewGovernance.reviewedCalls || persistence.counts?.currentManagerReviewedCalls || persistence.counts?.currentManagerReviews || processing.managerReviewedCalls || 0);
  const managerCorrected = Number(reviewGovernance.correctedCalls || persistence.counts?.currentManagerCorrectedCalls || 0);
  const managerReviewNeeded = Number(reviewGovernance.reviewNeededCalls || persistence.counts?.currentManagerReviewNeededCalls || 0);
  const managerEscalated = Number(reviewGovernance.escalatedCalls || persistence.counts?.currentManagerEscalatedCalls || 0);
  const filterQuery = data.filterState?.query || {};
  const reviewedStatuses = ["reviewed_confirmed", "reviewed_corrected", "dismissed", "escalated"].join(",");
  return `<section class="panel" id="provenance">
    <div class="panel-header">
      <div>
        <h2>Intelligence Provenance</h2>
        <p class="muted small">Operational reporting uses raw call facts, restricted literal triage, or manager-reviewed data. Semantic rule and local-model outputs are not operational.</p>
      </div>
      ${provenanceBadge("Restricted literal rule")}
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Total calls", formatNumber(totalCalls), "Active deduplicated call rows", "info", drilldownUrl("calls.unique", filterQuery))}
        ${metricCard("Transcripts available", formatNumber(data.totals.transcriptAvailable || 0), `${formatPercent(data.rates.transcriptCoverage || 0)} of calls`, "info", drilldownUrl("calls.transcriptAvailable", filterQuery))}
        ${metricCard("Literal triage rows", formatNumber(processing.literalTriageRowsCompleted || totalCalls), "Machine/no-answer/voicemail and direct-customer boundary phrases only", "info", drilldownUrl("calls.unique", filterQuery))}
        ${metricCard("Semantic transcript decisions", "Unavailable", "Rules failed the frozen accuracy audit", "neutral")}
        ${metricCard("Operational local-model decisions", "0", "No evaluator is promoted", "neutral", "/evaluation-studio")}
        ${metricCard("Manager-reviewed", formatNumber(managerReviewed), `${formatPercent(reviewGovernance.coverageRate || percentOf(managerReviewed, totalCalls))} coverage`, "good", drilldownUrl("calls.unique", { ...filterQuery, managerReviewStatus: reviewedStatuses }))}
        ${metricCard("Manager-corrected", formatNumber(managerCorrected), `${formatPercent(reviewGovernance.correctionRate || percentOf(managerCorrected, totalCalls))} of filtered calls`, managerCorrected ? "warn" : "good", drilldownUrl("calls.unique", { ...filterQuery, managerReviewStatus: "reviewed_corrected" }))}
        ${metricCard("Review needed", formatNumber(managerReviewNeeded), "System or manager marked for review", managerReviewNeeded ? "warn" : "good", drilldownUrl("calls.unique", { ...filterQuery, managerReviewStatus: "review_needed" }))}
        ${metricCard("Escalated", formatNumber(managerEscalated), "Manager-escalated review items", managerEscalated ? "risk" : "good", drilldownUrl("calls.unique", { ...filterQuery, managerReviewStatus: "escalated" }))}
        ${metricCard("Coaching-grade transcript decisions", "0", "No automated evaluator is authorised for coaching", "neutral")}
      </div>
      <div class="guardrails" style="margin-top: 12px;">
        <div class="note">
          <h3>Deterministic boundary</h3>
          <p class="muted small">Allowed: literal machine audio, explicit no-answer/voicemail, direct customer wrong-number wording, direct customer not-interested wording, and direct customer opt-out wording. These are triage matches, not quality or performance decisions.</p>
        </div>
        <div class="note">
          <h3>Guardrail</h3>
          <p class="muted small">Semantic rule outputs and historical model outputs are excluded from callbacks, accepted-offer claims, coaching, scorecards, rankings, compliance, customer actions, and staff decisions.</p>
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
      <label class="studio-field studio-field-full">Knowledgebase IDs<input name="knowledgebaseIds" value="${escapeHtml((row.knowledgebaseIds || []).join(", "))}" placeholder="Only these included entries will be sent to this evaluator" /></label>
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

function renderKnowledgebaseLibraryItem(row = {}, options = {}) {
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
    ${options.editable ? renderKnowledgebaseActions(row) : `<span class="muted small">Read-only research archive</span>`}
  </article>`;
}

function renderTemplateLibraryItem(row = {}, options = {}) {
  const tags = (row.tags || []).slice(0, 5).map((tag) => badge(tag, "neutral")).join("") || badge("No tags", "neutral");
  const lifecycleBadge = row.evaluationGoal === SPIEL_QUALITY_GOAL
    ? `${badge(row.isActive ? "Active" : "Archived", row.isActive ? "success" : "neutral")}${badge("Calibration only", "warning")}`
    : badge(row.isActive ? "Active" : "Archived", row.isActive ? "success" : "neutral");
  return `<article class="studio-library-item">
    <div class="studio-library-main">
      <div class="studio-library-heading">
        <div>
          <h4>${escapeHtml(row.name || "Untitled template")}</h4>
          <p class="muted small">${escapeHtml(humanizeSlug(row.evaluationGoal || "evaluation"))} · Version ${formatNumber(row.version || 1)} · Prompt ${escapeHtml(shortHash(row.promptHash))}</p>
        </div>
        ${lifecycleBadge}
      </div>
      <div class="studio-tags">${tags}</div>
      <p class="studio-library-preview">${escapeHtml(String(row.instructions || "No prompt instructions supplied.").replace(/\s+/g, " ").slice(0, 220))}${String(row.instructions || "").length > 220 ? "..." : ""}</p>
      <p class="muted small">${formatNumber((row.knowledgebaseIds || []).length)} template-scoped knowledgebase entr${(row.knowledgebaseIds || []).length === 1 ? "y" : "ies"}</p>
    </div>
    ${options.editable ? renderTemplateActions(row) : `<span class="muted small">Read-only research archive</span>`}
  </article>`;
}

function renderEvaluationRunActions(row = {}) {
  const id = row.id || "";
  const status = String(row.status || "queued");
  if (!id) return `<span class="muted small">No run identifier</span>`;
  const resultsLink = `<a class="filter-link" href="${escapeHtml(evaluationResultsUrl({ runId: id }))}">View run results</a>`;
  return `<div class="run-action-stack">
    ${badge(status === "quarantined" ? "quarantined research" : "research history", "neutral")}
    <span class="muted small">Live run controls are disabled by capability policy.</span>
    ${Number(row.completedCallCount || 0) ? resultsLink : ""}
  </div>`;
}

function evaluationRunFailureLabel(value) {
  const error = String(value || "").trim();
  if (/quote must be 500 characters or fewer/i.test(error)) return "Evidence quote exceeded 500 characters";
  if (/quote was not found in the supplied transcript/i.test(error)) return "Evidence quote was not one exact contiguous transcript excerpt";
  if (/category must be integer/i.test(error)) return "Category used the retired string format";
  return error.replace(/^Offer Acceptance evaluation output is invalid:\s*/i, "") || "Evaluation failed validation";
}

function renderEvaluationRunFailureSummary(row = {}, callLookup = new Map()) {
  const errors = Array.isArray(row.errors) ? row.errors : [];
  if (!errors.length) return "";
  const counts = new Map();
  errors.forEach((entry) => {
    const label = evaluationRunFailureLabel(entry.error);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const affected = errors.map((entry) => {
    const callId = String(entry.callId || "").trim();
    const call = callLookup.get(callId) || {};
    return `<li>${callId ? `${callLink(callId)} · ` : ""}<strong>Customer ID: <span class="mono">${escapeHtml(customerIdValue(call))}</span></strong> · ${escapeHtml(evaluationRunFailureLabel(entry.error))}</li>`;
  }).join("");
  return `<details class="compact-details run-failure-details" id="run-failures-${escapeHtml(row.id || "unknown")}">
    <summary>Why ${formatNumber(errors.length)} failed</summary>
    ${affected ? `<strong class="small">Affected records</strong><ul class="result-evidence-list">${affected}</ul>` : ""}
    <ul class="result-evidence-list">${Array.from(counts, ([label, count]) => `<li>${formatNumber(count)} × ${escapeHtml(label)}</li>`).join("")}</ul>
  </details>`;
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

function offerAcceptanceOutcome(row = {}) {
  const assessment = row.acceptanceAssessment || {};
  const classification = String(assessment.classification || "").toLowerCase();
  const outcomes = {
    customer_accepted_offer: { label: "Customer accepted offer", tone: "success", short: "Accepted" },
    interested_follow_up_only: { label: "Interested — follow-up only", tone: "warning", short: "Follow-up only" },
    no_sale_signal: { label: "No sale signal", tone: "neutral", short: "No sale signal" }
  };
  return outcomes[classification] || { label: "Not classified", tone: "critical", short: "Not classified" };
}

function authoritativeOfferAcceptanceContext(row = {}) {
  if (row.sharedOfferAcceptanceContext?.acceptanceAssessment
    && row.sharedOfferAcceptanceContext?.localModelCapability?.operationallyPermitted === true) {
    return row.sharedOfferAcceptanceContext;
  }
  if (row.acceptanceAssessment && row.localModelCapability?.operationallyPermitted === true) {
    return {
      sourceResultId: row.id || "",
      acceptanceAssessment: row.acceptanceAssessment,
      managerSummary: row.managerSummary,
      confidence: row.confidence,
      confidenceBand: row.confidenceBand,
      evidenceAvailability: row.evidenceAvailability,
      status: row.status,
      updatedAt: row.updatedAt || row.createdAt
    };
  }
  return null;
}

function isLegacyUntypedSpecialist(row = {}) {
  return ["callback_opportunity", "procedure_adherence", "objection_handling"].includes(row.evaluationGoal)
    && (!row.specialistAssessment || row.evaluationAudit?.validationStatus === "legacy_generic_contract");
}

function evaluationRecordSummary(row = {}) {
  if (row.localModelCapability?.operationallyPermitted !== true) {
    return `Historical ${humanizeSlug(row.evaluationGoal || "evaluation")} research output. It is retained for audit but is not a current customer outcome, score, finding, or action.`;
  }
  if (isLegacyUntypedSpecialist(row)) {
    return "Historical untyped specialist result. Its excerpts may help an audit, but it is not a current typed pass/fail classification; rerun this call with the active v2 specialist template.";
  }
  const authoritative = authoritativeOfferAcceptanceContext(row);
  if (authoritative) {
    const outcome = offerAcceptanceOutcome({ acceptanceAssessment: authoritative.acceptanceAssessment });
    const summary = evaluationSummaryLabel(authoritative.managerSummary || row.managerSummary);
    const evaluatorSummary = evaluationSummaryLabel(row.managerSummary);
    const distinctEvaluatorSummary = row.evaluationGoal !== OFFER_ACCEPTANCE_GOAL
      && evaluatorSummary.toLowerCase() !== summary.toLowerCase()
      ? ` This ${humanizeSlug(row.evaluationGoal || "evaluation")} evaluation also found: ${evaluatorSummary}`
      : "";
    const boundary = authoritative.acceptanceAssessment?.classification === "customer_accepted_offer"
      ? "This records acceptance of the offer; payment and fulfilment are not yet confirmed."
      : "This is the promoted Offer Acceptance classification for the call.";
    return `${outcome.label}. ${summary} ${boundary}${distinctEvaluatorSummary}`;
  }
  if (row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL || row.foundationAssessment) {
    const assessment = row.foundationAssessment || {};
    const opportunity = humanizeSlug(assessment.intelligenceLenses?.opportunity_status || "not classified");
    const routed = assessment.specialistRoutes?.offer_acceptance_classification === true;
    const status = routed
      ? `Foundation identified an ${opportunity} opportunity and routed it to Offer Acceptance; no promoted Offer Acceptance result is stored yet.`
      : `Foundation classified this as an ${opportunity} opportunity.`;
    return `${status} ${evaluationSummaryLabel(row.managerSummary)}`;
  }
  return evaluationSummaryLabel(row.managerSummary);
}

function renderFoundationReport(report = {}) {
  const totals = report.totals || {};
  const rates = report.rates || {};
  const latestRun = report.latestRun || null;
  const foundationBase = { evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL };
  const breakdownColumns = (dimension) => [
    { label: dimension, description: `The ${dimension.toLowerCase()} attached to the Foundation-evaluated call. Select it to inspect every contributing result.`, render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label) }; const value = dimension === "Date" ? formatSourceDate(row.label) : row.label || "Not supplied"; return aggregateResultLink(value, filters, `View all Foundation results for ${value}`); } },
    { label: "Evaluated", description: "Calls with a stored Call Intelligence Foundation result. Select the count to inspect those results.", render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label) }; return aggregateResultLink(formatNumber(row.evaluated || 0), filters, `View ${row.evaluated || 0} evaluated calls for ${row.label}`); } },
    { label: "Eligible", description: "Live sales conversations suitable for denominator-based performance measurement. Select the count to inspect them.", render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label), foundationMeasurementEligibility: "eligible" }; return aggregateResultLink(formatNumber(row.measurementEligible || 0), filters, `View ${row.measurementEligible || 0} measurement-eligible calls for ${row.label}`); } },
    { label: "Opportunities", description: "Accepted or actionable Foundation opportunities. Select the count to inspect the contributing results.", render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label), foundationOpportunityStatus: "actionable_or_accepted" }; return aggregateResultLink(formatNumber(row.actionableOpportunities || 0), filters, `View ${row.actionableOpportunities || 0} actionable or accepted opportunities for ${row.label}`); } },
    { label: "Offer shown", description: "Calls where transcript evidence supports that an offer was presented. Select the count to inspect them.", render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label), foundationOfferPresented: "true" }; return aggregateResultLink(formatNumber(row.offerPresented || 0), filters, `View ${row.offerPresented || 0} calls with an offer presented for ${row.label}`); } },
    { label: "Efficiency gaps", description: "Meaningful calls with an evidence-backed next-step or process gap; not proof of salesperson fault. Select the count to inspect them.", render: (row) => { const filters = { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label), foundationEfficiencyStatus: "actionable_gap" }; return aggregateResultLink(formatNumber(row.efficiencyGaps || 0), filters, `View ${row.efficiencyGaps || 0} efficiency-gap calls for ${row.label}`); } },
    { label: "Opportunity rate", description: "Actionable opportunities divided by measurement-eligible calls. Select the rate to inspect all Foundation results in this group.", render: (row) => row.opportunityRate === null || row.opportunityRate === undefined ? "n/a" : aggregateResultLink(formatRatioPercent(row.opportunityRate), { ...foundationBase, ...evaluationBreakdownFilters(dimension, row.label) }, `View the calls behind the ${formatRatioPercent(row.opportunityRate)} opportunity rate for ${row.label}`) }
  ];
  const routing = latestRun?.specialistRouting || null;
  return `<section class="studio-library foundation-report" id="foundation-report" aria-labelledby="foundation-report-heading">
    <div class="studio-section-heading">
      <div>
        <p class="page-kicker">Daily intelligence foundation</p>
        <h3 id="foundation-report-heading">Opportunity, Measurement & Efficiency</h3>
        <p class="muted small">These are independent evidence lenses, not one overall score. A specialist result is operational only after its exact capability and immutable provenance contract are promoted.</p>
      </div>
      ${linkedBadge(`${formatNumber(totals.evaluated || 0)} evaluated`, "notice", evaluationResultsUrl(foundationBase))}
    </div>
    <div class="metrics foundation-metrics">
      ${metricCard("Measurement eligible", formatNumber(totals.measurementEligible || 0), rates.measurementEligibilityRate === null || rates.measurementEligibilityRate === undefined ? "No Foundation results yet" : formatRatioPercent(rates.measurementEligibilityRate), "info", evaluationResultsUrl({ ...foundationBase, foundationMeasurementEligibility: "eligible" }))}
      ${metricCard("Actionable opportunities", formatNumber(totals.actionableOpportunities || 0), rates.opportunityRate === null || rates.opportunityRate === undefined ? "Eligible-call rate unavailable" : `${formatRatioPercent(rates.opportunityRate)} of eligible calls`, totals.actionableOpportunities ? "warn" : "info", evaluationResultsUrl({ ...foundationBase, foundationOpportunityStatus: "actionable_or_accepted" }))}
      ${metricCard("Efficiency gaps", formatNumber(totals.efficiencyGaps || 0), rates.efficiencyGapRate === null || rates.efficiencyGapRate === undefined ? "Eligible-call rate unavailable" : `${formatRatioPercent(rates.efficiencyGapRate)} of eligible calls`, totals.efficiencyGaps ? "warn" : "good", evaluationResultsUrl({ ...foundationBase, foundationEfficiencyStatus: "actionable_gap" }))}
      ${metricCard("Offer presented", formatNumber(totals.offerPresented || 0), rates.offerPresentationRate === null || rates.offerPresentationRate === undefined ? "Eligible-call rate unavailable" : `${formatRatioPercent(rates.offerPresentationRate)} of eligible calls`, "info", evaluationResultsUrl({ ...foundationBase, foundationOfferPresented: "true" }))}
      ${metricCard("No product pitched", formatNumber(totals.noProductPitched || 0), "The represented organisation or product was not reached or stated", totals.noProductPitched ? "warn" : "good", evaluationResultsUrl({ ...foundationBase, foundationCalledOnBehalfOf: "No product pitched" }))}
      ${metricCard("Specialist checks", `${formatNumber(totals.completedSpecialistChecks || 0)} / ${formatNumber(totals.routedSpecialistChecks || 0)}`, rates.specialistCompletionRate === null || rates.specialistCompletionRate === undefined ? "No routed checks yet" : `${formatRatioPercent(rates.specialistCompletionRate)} completed`, totals.routedSpecialistChecks > totals.completedSpecialistChecks ? "warn" : "good", evaluationResultsUrl(foundationBase))}
    </div>
    <p class="muted small">A quoted price was captured in ${aggregateResultLink(formatNumber(totals.quotedAmountCalls || 0), { ...foundationBase, foundationQuotedAmountAvailable: "true" }, `View ${totals.quotedAmountCalls || 0} Foundation results with a quoted amount`)} unique calls${totals.implausibleQuotedAmountCalls ? `; ${formatNumber(totals.implausibleQuotedAmountCalls)} unusually large transcript amounts require review` : ""}. Prices are not totalled because offered options are not accepted value or revenue, and speech transcription can distort numbers.</p>
    ${report.resultBasis?.duplicateOrHistoricalResultsExcluded ? `<p class="muted small">Reporting baseline: active ${escapeHtml(report.resultBasis.templateId || "Foundation template")}, one result per unique call. ${formatNumber(report.resultBasis.duplicateOrHistoricalResultsExcluded)} older-template or rerun results remain available in the audit view but are excluded from these totals.</p>` : ""}
    ${routing ? `<p class="muted small">Latest routing: ${formatNumber(routing.requestedChecks || 0)} requested specialist checks across ${formatNumber((routing.childRuns || []).length)} child runs${(routing.errors || []).length ? `; ${formatNumber(routing.errors.length)} routing errors` : ""}.</p>` : ""}
    <div class="offer-breakdown-grid">
      <div><h4>By salesperson</h4>${table(breakdownColumns("Salesperson"), (report.bySalesperson || []).slice(0, 25), "Run Call Intelligence Foundation to build salesperson intelligence.")}</div>
      <div><h4>By source</h4>${table(breakdownColumns("Source"), (report.bySource || []).slice(0, 25), "Run Call Intelligence Foundation to build source intelligence.")}</div>
      <div><h4>By call date</h4>${table(breakdownColumns("Date"), (report.byDate || []).slice(0, 31), "Run Call Intelligence Foundation to build daily intelligence.")}</div>
      <div><h4>By represented organisation</h4>${table(breakdownColumns("Called on behalf of"), (report.byCalledOnBehalfOf || []).slice(0, 50), "Run the current Call Intelligence Foundation to identify who each salesperson called on behalf of.")}</div>
    </div>
  </section>`;
}

function renderOfferAcceptanceReport(report = {}) {
  const totals = report.totals || {};
  const latestRun = report.latestRun || null;
  const offerBase = { evaluationGoal: OFFER_ACCEPTANCE_GOAL };
  const breakdownColumns = (dimension) => [
    { label: dimension, description: `The ${dimension.toLowerCase()} attached to the evaluated call. Select it to inspect every contributing result.`, render: (row) => { const filters = { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label) }; const value = dimension === "Date" ? formatSourceDate(row.label) : row.label || "Not supplied"; return aggregateResultLink(value, filters, `View all Offer Acceptance results for ${value}`); } },
    { label: "Classified", description: "Offer Acceptance calls with a stored category 1, 2, or 3 result. Select the count to inspect them.", render: (row) => aggregateResultLink(formatNumber(row.classified || 0), { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label) }, `View ${row.classified || 0} classified calls for ${row.label}`) },
    { label: "Accepted", description: "Calls classified as Customer accepted offer under the configured transcript definition. Select the count to inspect them.", render: (row) => aggregateResultLink(formatNumber(row.accepted || 0), { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label), acceptanceClassification: "customer_accepted_offer" }, `View ${row.accepted || 0} accepted calls for ${row.label}`) },
    { label: "Follow-up only", description: "Calls where the customer showed interest but had not committed to the offer. Select the count to inspect them.", render: (row) => aggregateResultLink(formatNumber(row.followUpOnly || 0), { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label), acceptanceClassification: "interested_follow_up_only" }, `View ${row.followUpOnly || 0} follow-up-only calls for ${row.label}`) },
    { label: "No sale signal", description: "Calls with no qualifying acceptance or follow-up-only signal. Select the count to inspect them.", render: (row) => aggregateResultLink(formatNumber(row.noSaleSignal || 0), { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label), acceptanceClassification: "no_sale_signal" }, `View ${row.noSaleSignal || 0} no-sale-signal calls for ${row.label}`) },
    { label: "Acceptance rate", description: "Accepted divided by successfully classified Offer Acceptance calls. Failed calls are excluded. Select the rate to inspect the denominator.", render: (row) => row.acceptanceRate === null || row.acceptanceRate === undefined ? "n/a" : aggregateResultLink(formatRatioPercent(row.acceptanceRate), { ...offerBase, ...evaluationBreakdownFilters(dimension, row.label) }, `View the calls behind the ${formatRatioPercent(row.acceptanceRate)} acceptance rate for ${row.label}`) }
  ];
  const failureReasons = (latestRun?.failureReasons || []).map((reason) => `${formatNumber(reason.count)} × ${reason.label}`).join("; ");
  const failedCallRows = (latestRun?.failures || []).map((failure) => `<li>${failure.callId ? `<a class="data-link mono" href="/calls/${encodeURIComponent(failure.callId)}">${escapeHtml(failure.callId)}</a> · ` : ""}<strong>Customer ID: <span class="mono">${escapeHtml(failure.customerId || "Not available")}</span></strong> · ${escapeHtml(failure.reason || "Evaluation failed validation")}</li>`).join("");
  return `<section class="studio-library offer-acceptance-report" id="offer-acceptance-report" aria-labelledby="offer-acceptance-report-heading">
    <div class="studio-section-heading">
      <div>
        <p class="page-kicker">Offer outcome reporting</p>
        <h3 id="offer-acceptance-report-heading">Offer Acceptance Performance</h3>
        <p class="muted small">Acceptance rate is Accepted ÷ Classified. Failed calls are shown separately and are not counted in the rate. “Accepted” is transcript evidence of acceptance under this evaluator, not proof of payment or recognised revenue.</p>
      </div>
      ${linkedBadge(`${formatNumber(totals.classified || 0)} classified`, "notice", evaluationResultsUrl(offerBase))}
    </div>
    <div class="metrics offer-acceptance-metrics">
      ${metricCard("Offer acceptance rate", totals.acceptanceRate === null || totals.acceptanceRate === undefined ? "n/a" : formatRatioPercent(totals.acceptanceRate), `${formatNumber(totals.accepted || 0)} accepted / ${formatNumber(totals.classified || 0)} classified`, totals.accepted ? "good" : "info", evaluationResultsUrl(offerBase))}
      ${metricCard("Accepted", formatNumber(totals.accepted || 0), "Customer committed to the presented offer", totals.accepted ? "good" : "info", evaluationResultsUrl({ ...offerBase, acceptanceClassification: "customer_accepted_offer" }))}
      ${metricCard("Follow-up only", formatNumber(totals.followUpOnly || 0), "Interest shown; decision still unresolved", totals.followUpOnly ? "warn" : "info", evaluationResultsUrl({ ...offerBase, acceptanceClassification: "interested_follow_up_only" }))}
      ${metricCard("No sale signal", formatNumber(totals.noSaleSignal || 0), "No acceptance or qualifying follow-up signal", "info", evaluationResultsUrl({ ...offerBase, acceptanceClassification: "no_sale_signal" }))}
      ${metricCard("Latest run failures", formatNumber(latestRun?.failed || 0), latestRun ? `${formatNumber(latestRun.classified || 0)} classified from ${formatNumber(latestRun.planned || 0)} planned; failure details are listed below` : "No Offer Acceptance run yet", latestRun?.failed ? "risk" : "good", latestRun?.failed ? "#offer-latest-failures" : evaluationResultsUrl(offerBase))}
    </div>
    ${report.resultBasis?.duplicateRerunsExcluded ? `<p class="muted small">These totals count one promoted result per unique call. ${formatNumber(report.resultBasis.duplicateRerunsExcluded)} rerun or older-template results remain available in the audit view but do not inflate the denominator.</p>` : ""}
    ${report.resultBasis?.nonUsableOrUnclassifiedExcluded ? `<p class="muted small">${formatNumber(report.resultBasis.nonUsableOrUnclassifiedExcluded)} stored result${report.resultBasis.nonUsableOrUnclassifiedExcluded === 1 ? " is" : "s are"} excluded because the call was not usable or successfully classified.</p>` : ""}
    ${latestRun?.failed ? `<div class="window-warning warning offer-failure-summary" id="offer-latest-failures"><strong>Why the latest run had ${formatNumber(latestRun.failed)} failures</strong><p class="muted small">${escapeHtml(failureReasons || "The failed outputs did not pass evidence validation.")}</p>${failedCallRows ? `<ul class="result-evidence-list">${failedCallRows}</ul>` : ""}<a class="filter-link" href="#runs">Open the latest run record</a></div>` : ""}
    <div class="offer-breakdown-grid">
      <div><h4>By salesperson</h4>${table(breakdownColumns("Salesperson"), (report.bySalesperson || []).slice(0, 25), "No classified Offer Acceptance results for this salesperson filter.")}</div>
      <div><h4>By source</h4>${table(breakdownColumns("Source"), (report.bySource || []).slice(0, 25), "No classified Offer Acceptance results for this source filter.")}</div>
      <div><h4>By call date</h4>${table(breakdownColumns("Date"), (report.byDate || []).slice(0, 31), "No classified Offer Acceptance results for this date filter.")}</div>
    </div>
  </section>`;
}

function evaluationAuditMarkup(row = {}) {
  const audit = row.evaluationAudit || {};
  if (!Object.values(audit).some((value) => value !== "" && value !== null && value !== undefined)) return "";
  return `<details class="compact-details evaluation-audit-details"><summary>Evaluation audit details</summary><dl class="result-answer-list">
    <div><dt>Model</dt><dd>${escapeHtml(audit.providerModel || audit.model || "Not recorded for this historical result")}</dd></div>
    <div><dt>Prompt hash</dt><dd class="mono">${escapeHtml(audit.promptHash || "Not recorded")}</dd></div>
    <div><dt>Schema</dt><dd>${escapeHtml(audit.schemaVersion || "Legacy generic contract")}</dd></div>
    <div><dt>Validation</dt><dd>${escapeHtml(humanizeSlug(audit.validationStatus || "unknown"))}</dd></div>
    <div><dt>Transcript hash</dt><dd class="mono">${escapeHtml(audit.transcriptHash || "Not recorded")}</dd></div>
    <div><dt>Transcript size</dt><dd>${audit.transcriptCharacterCount === null || audit.transcriptCharacterCount === undefined ? "Not recorded" : `${formatNumber(audit.transcriptCharacterCount)} characters`}</dd></div>
    <div><dt>Tokens</dt><dd>${audit.promptTokens === null || audit.promptTokens === undefined ? "Not recorded" : `${formatNumber(audit.promptTokens)} prompt / ${formatNumber(audit.completionTokens || 0)} completion`}</dd></div>
    <div><dt>Execution</dt><dd>${audit.executionMs === null || audit.executionMs === undefined ? "Not recorded" : `${formatNumber(audit.executionMs)} ms`}${audit.retryCount === null || audit.retryCount === undefined ? "" : ` · ${formatNumber(audit.retryCount)} retries`}</dd></div>
    <div><dt>Confidence type</dt><dd>${escapeHtml(humanizeSlug(audit.confidenceKind || "unknown"))}</dd></div>
  </dl></details>`;
}

function renderEvaluationResultDetails(row = {}) {
  const operational = row.localModelCapability?.operationallyPermitted === true;
  const archivedClaimPrefix = operational ? "" : "Archived model claim: ";
  if (row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL || row.foundationAssessment) {
    const assessment = row.foundationAssessment || {};
    const lenses = assessment.intelligenceLenses || {};
    const authoritative = authoritativeOfferAcceptanceContext(row);
    const authoritativeOutcome = authoritative
      ? offerAcceptanceOutcome({ acceptanceAssessment: authoritative.acceptanceAssessment })
      : null;
    const routes = Object.entries(assessment.specialistRoutes || {}).filter(([, enabled]) => enabled).map(([goal]) => humanizeSlug(goal));
    const evidence = (assessment.evidence || []).map((item) => `<li><strong>${escapeHtml(humanizeSlug(item.supports || "evidence"))}:</strong> ${escapeHtml(item.quote || "")}</li>`).join("");
    return `<details class="compact-details result-details foundation-result-details">
      <summary>View result</summary>
      ${authoritativeOutcome ? `<div class="result-decision authoritative-offer-decision">
        <span>Promoted Offer Acceptance result</span>
        <strong>${escapeHtml(authoritativeOutcome.label)}</strong>
        <p>${escapeHtml(evaluationSummaryLabel(authoritative.managerSummary))}</p>
      </div>` : ""}
      <div class="result-decision">
        <span>Foundation intelligence</span>
        <strong>${escapeHtml(humanizeSlug(lenses.opportunity_status || "not classified"))} opportunity</strong>
        <p>${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</p>
      </div>
      <dl class="result-answer-list">
        <div><dt>Measurement</dt><dd>${escapeHtml(humanizeSlug(lenses.measurement_eligibility || "not supplied"))}</dd></div>
        <div><dt>Efficiency</dt><dd>${escapeHtml(humanizeSlug(lenses.efficiency_status || "not supplied"))}</dd></div>
        <div><dt>Conversation stage</dt><dd>${escapeHtml(humanizeSlug(assessment.conversationStage || "not supplied"))}</dd></div>
        <div><dt>Called on behalf of</dt><dd>${escapeHtml(assessment.calledOnBehalfOf || "Not captured (older Foundation version)")}</dd></div>
        <div><dt>Customer outcome</dt><dd>${escapeHtml(humanizeSlug(assessment.customerOutcome || "not supplied"))}</dd></div>
        <div><dt>Next step</dt><dd>${escapeHtml(humanizeSlug(assessment.nextStepStatus || "not supplied"))}</dd></div>
        <div><dt>Callback timing</dt><dd>${escapeHtml(assessment.followUpTiming || "Not supplied")}</dd></div>
        <div><dt>Specialist routing</dt><dd>${escapeHtml(routes.join(", ") || "No specialist check required")}</dd></div>
      </dl>
      ${evidence ? `<div class="result-proof"><strong>Transcript evidence</strong><ul class="result-evidence-list">${evidence}</ul></div>` : `<p class="muted small">No transcript excerpt was stored for this result.</p>`}
      <p class="muted small">This historical output is research-only unless its exact evaluator and provenance contract are promoted.</p>
      ${evaluationAuditMarkup(row)}
      <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
    </details>`;
  }
  if (row.evaluationGoal === OFFER_ACCEPTANCE_GOAL || row.acceptanceAssessment) {
    const assessment = row.acceptanceAssessment || {};
    const outcome = offerAcceptanceOutcome(row);
    const offerEvidence = assessment.offerEvidence || {};
    const responseEvidence = assessment.customerResponseEvidence || {};
    const proof = [
      offerEvidence.quote ? `<li><strong>Offer:</strong> ${escapeHtml(offerEvidence.quote)}</li>` : "",
      responseEvidence.quote ? `<li><strong>Customer:</strong> ${escapeHtml(responseEvidence.quote)}</li>` : ""
    ].filter(Boolean).join("");
    return `<details class="compact-details result-details offer-result-details">
      <summary>View result</summary>
      <div class="result-decision">
        <span>${operational ? "Promoted offer acceptance result" : "Archived model claim (not a decision)"}</span>
        <strong>${escapeHtml(`${archivedClaimPrefix}${outcome.label}`)}</strong>
        <p>${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</p>
      </div>
      <dl class="result-answer-list">
        <div><dt>Offer presented</dt><dd>${assessment.offerPresented ? "Yes" : "No"}</dd></div>
        <div><dt>Customer response</dt><dd>${escapeHtml(responseEvidence.summary || humanizeSlug(assessment.customerCommitment || "not supplied"))}</dd></div>
        <div><dt>Unresolved condition</dt><dd>${assessment.unresolvedCondition ? "Yes — this prevents an accepted classification" : "No"}</dd></div>
        <div><dt>Model-reported confidence (audit)</dt><dd>${row.confidence === null || row.confidence === undefined ? "Unavailable" : formatRatioPercent(row.confidence)} · uncalibrated · ${escapeHtml(humanizeSlug(row.evidenceAvailability || "unavailable"))} evidence</dd></div>
      </dl>
      ${proof ? `<div class="result-proof"><strong>Transcript evidence</strong><ul class="result-evidence-list">${proof}</ul></div>` : `<p class="muted small">No transcript excerpt was stored for this result.</p>`}
      ${evaluationAuditMarkup(row)}
      <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
    </details>`;
  }
  if (row.evaluationGoal === SPIEL_QUALITY_GOAL || row.spielQualityAssessment) {
    const assessment = row.spielQualityAssessment || {};
    const capabilityReviewRequired = assessment.automationCapability === "human_review_required";
    const policyFindings = (assessment.policyFindings || []).map((item) => `<li><strong>${escapeHtml(humanizeSlug(item.type || "finding"))}:</strong> ${escapeHtml(item.summary || "")}<br /><span class="evidence">${escapeHtml(item.evidence_quote || "")}</span></li>`).join("");
    const strengths = (assessment.strengths || []).map((item) => `<li><strong>${escapeHtml(item.summary || "Strength")}</strong><br /><span class="evidence">${escapeHtml(item.evidence_quote || "")}</span></li>`).join("");
    const improvements = (assessment.improvements || []).map((item) => `<li><strong>${escapeHtml(item.summary || "Improvement")}</strong><br /><span class="evidence">${escapeHtml(item.evidence_quote || "")}</span></li>`).join("");
    const dimensions = Object.entries(assessment.dimensions || {}).map(([key, value]) => `<div><dt>${escapeHtml(humanizeSlug(key))}</dt><dd>${escapeHtml(humanizeSlug(value || "unknown"))}</dd></div>`).join("");
    return `<details class="compact-details result-details typed-specialist-details"><summary>View result</summary>
      <div class="notice-box"><strong>Research-only calibration result</strong><p>This evaluator is not promoted for rankings, coaching, reporting, or operational decisions.</p></div>
      ${capabilityReviewRequired ? `<div class="notice-box"><strong>Historical result was not scored</strong><p>The archived evaluator withheld a score${assessment.automationCapabilityReason ? `: ${escapeHtml(assessment.automationCapabilityReason)}` : "."} This does not create a human-review assignment.</p></div>` : ""}
      <div class="result-decision"><span>Call handling quality</span><strong>${escapeHtml(humanizeSlug(assessment.callHandlingQuality || "not assessable"))}</strong><p>${escapeHtml(assessment.qualityReason || evaluationSummaryLabel(row.managerSummary))}</p></div>
      <dl class="result-answer-list">
        <div><dt>Historical capability claim</dt><dd>${escapeHtml(capabilityReviewRequired ? "Not scored" : "Historically marked supported — unpromoted")}</dd></div>
        <div><dt>Call purpose</dt><dd>${escapeHtml(humanizeSlug(assessment.callPurpose || "unknown"))}</dd></div>
        <div><dt>Assessment scope</dt><dd>${escapeHtml(humanizeSlug(assessment.assessmentScope || "not assessable"))}</dd></div>
        <div><dt>Spiel quality</dt><dd>${escapeHtml(humanizeSlug(assessment.spielQuality || "not assessable"))}</dd></div>
        <div><dt>Primary reason</dt><dd>${escapeHtml(humanizeSlug(assessment.primaryReasonCode || "none"))}</dd></div>
        ${dimensions}
      </dl>
      ${policyFindings ? `<div class="result-proof"><strong>Material findings</strong><ul class="result-evidence-list">${policyFindings}</ul></div>` : ""}
      <div class="result-proof"><strong>Demonstrated strengths</strong>${strengths ? `<ul class="result-evidence-list">${strengths}</ul>` : `<p class="muted small">No distinct strength was recorded.</p>`}</div>
      <div class="result-proof"><strong>Material improvements</strong>${improvements ? `<ul class="result-evidence-list">${improvements}</ul>` : `<p class="muted small">No material weakness was recorded.</p>`}</div>
      <dl class="result-answer-list"><div><dt>Highest-priority coaching action</dt><dd>${escapeHtml(assessment.coachingAction || "Not supplied")}</dd></div>${assessment.suggestedPhrase ? `<div><dt>Suggested phrase</dt><dd>${escapeHtml(assessment.suggestedPhrase)}</dd></div>` : ""}</dl>
      ${evaluationAuditMarkup(row)}
      <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
    </details>`;
  }
  if (row.specialistAssessment) {
    const assessment = row.specialistAssessment;
    const evidence = (assessment.evidence || []).map((item) => `<li><strong>${escapeHtml(humanizeSlug(item.claim_type || "evidence"))}:</strong> ${escapeHtml(item.quote || "")}</li>`).join("");
    const facts = row.evaluationGoal === "callback_opportunity"
      ? [
          ["Callback state", assessment.callbackState],
          ["Next-action channel", assessment.nextActionChannel],
          ["Timing", assessment.timingRaw || "Not supplied"],
          ["Customer intent", assessment.customerIntent],
          ["Objection", assessment.objection || "None captured"]
        ]
      : row.evaluationGoal === "procedure_adherence"
        ? [["Evaluation outcome", assessment.outcome], ["Strongest issue stage", assessment.strongestIssueStage], ["Issue", assessment.issueSummary || "No issue identified"]]
        : [["Objection state", assessment.objectionState], ["Objection type", assessment.objectionType], ["Handling outcome", assessment.outcome], ["Handling actions", (assessment.handlingActions || []).join(", ") || "None"]];
    return `<details class="compact-details result-details typed-specialist-details"><summary>View result</summary>
      <div class="result-decision"><span>${operational ? escapeHtml(humanizeSlug(row.evaluationGoal)) : "Archived model claim (not a decision)"}</span><strong>${escapeHtml(`${archivedClaimPrefix}${humanizeSlug(assessment.outcome || assessment.callbackState || "evaluated")}`)}</strong><p>${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</p></div>
      <dl class="result-answer-list">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(humanizeSlug(value || "unknown"))}</dd></div>`).join("")}</dl>
      ${evidence ? `<div class="result-proof"><strong>Transcript evidence</strong><ul class="result-evidence-list">${evidence}</ul></div>` : `<p class="muted small">No exact transcript excerpt was stored.</p>`}
      ${evaluationAuditMarkup(row)}
      <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
    </details>`;
  }
  if (isLegacyUntypedSpecialist(row)) {
    const evidenceSnippets = [];
    const seen = new Set();
    for (const finding of row.findings || []) {
      const excerpt = String(finding.evidence || finding.note || "").replace(/\s+/g, " ").trim();
      const key = excerpt.toLowerCase();
      if (!excerpt || seen.has(key)) continue;
      seen.add(key);
      evidenceSnippets.push(excerpt);
      if (evidenceSnippets.length >= 3) break;
    }
    const evidence = evidenceSnippets.map((excerpt) => `<li>${escapeHtml(excerpt)}</li>`).join("");
    return `<details class="compact-details result-details legacy-specialist-details"><summary>View historical result</summary>
      <div class="result-decision"><span>${escapeHtml(humanizeSlug(row.evaluationGoal))}</span><strong>Historical untyped result</strong><p>This older result did not use the current specialist schema and must not be read as evaluated-clear or issue-found.</p></div>
      ${evidence ? `<div class="result-proof"><strong>Historical evidence excerpts</strong><ul class="result-evidence-list">${evidence}</ul></div>` : `<p class="muted small">No reliable evidence excerpt was stored.</p>`}
      <p class="muted small">Rerun with the active v2 specialist template before using this call in pass/fail, coaching, or callback reporting.</p>
      ${evaluationAuditMarkup(row)}
      <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a></div>
    </details>`;
  }
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
      <span>${operational ? "Promoted lead record decision" : "Archived model claim (not a decision)"}</span>
      <strong>${escapeHtml(`${archivedClaimPrefix}${evaluationLeadDecisionLabel(facets)}`)}</strong>
      <p>${escapeHtml(evaluationAssessmentReason(facets))}</p>
    </div>
    <dl class="result-answer-list">
      <div><dt>What the call showed</dt><dd>${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</dd></div>
      <div><dt>${operational ? "Next step" : "Model-suggested next step (not an action)"}</dt><dd>${escapeHtml(evaluationRecommendationLabel(facets.recommendation))}</dd></div>
      <div><dt>Model-reported confidence (audit)</dt><dd>${row.confidence === null || row.confidence === undefined ? "Unavailable" : formatRatioPercent(row.confidence)} · uncalibrated · ${escapeHtml(humanizeSlug(row.evidenceAvailability || "unavailable"))} evidence</dd></div>
      ${allegation !== "absent" ? `<div><dt>Salesperson allegation</dt><dd>${escapeHtml(humanizeSlug(allegation))}</dd></div>` : ""}
    </dl>
    ${evidence ? `<div class="result-proof"><strong>Evidence</strong><ul class="result-evidence-list">${evidence}</ul></div>` : `<p class="muted small">No evidence snippets were stored.</p>`}
    ${evaluationAuditMarkup(row)}
    <div class="stack"><a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript proof</a>${row.jobId ? `<span class="mono muted">Job ${escapeHtml(String(row.jobId).slice(0, 18))}</span>` : ""}</div>
  </details>`;
}

function evaluationResultOutcomeMarkup(row = {}, options = {}) {
  if (row.localModelCapability?.operationallyPermitted !== true) {
    return `${badge("Research only", "warning")}<span class="muted small">Unpromoted model output — no operational meaning</span>`;
  }
  const authoritative = authoritativeOfferAcceptanceContext(row);
  if (authoritative && (!options.preferOwnEvaluation || row.evaluationGoal === OFFER_ACCEPTANCE_GOAL)) {
    const outcome = offerAcceptanceOutcome({ acceptanceAssessment: authoritative.acceptanceAssessment });
    const foundationOpportunity = row.foundationAssessment?.intelligenceLenses?.opportunity_status;
    const secondary = row.evaluationGoal === OFFER_ACCEPTANCE_GOAL
      ? humanizeSlug(authoritative.acceptanceAssessment?.customerCommitment || "not supplied")
      : `Promoted Offer Acceptance${foundationOpportunity ? ` · Foundation: ${humanizeSlug(foundationOpportunity)} opportunity` : ""}`;
    return `${linkedBadge(outcome.label, outcome.tone, evaluationResultsUrl({ evaluationGoal: OFFER_ACCEPTANCE_GOAL, acceptanceClassification: authoritative.acceptanceAssessment?.classification }))}<span class="muted small">${escapeHtml(secondary)}</span>`;
  }
  if (row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL || row.foundationAssessment) {
    const lenses = row.foundationAssessment?.intelligenceLenses || {};
    const opportunity = lenses.opportunity_status || "unknown";
    const tone = opportunity === "accepted" ? "notice" : ["possible", "actionable"].includes(opportunity) ? "warning" : "neutral";
    return `${linkedBadge(`${humanizeSlug(opportunity)} opportunity`, tone, evaluationResultsUrl({ evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL, foundationOpportunityStatus: opportunity }))}<span class="muted small">${hrefDataLink(humanizeSlug(lenses.measurement_eligibility || "not supplied"), evaluationResultsUrl({ evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL, foundationMeasurementEligibility: lenses.measurement_eligibility }))} · ${hrefDataLink(humanizeSlug(lenses.efficiency_status || "not supplied"), evaluationResultsUrl({ evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL, foundationEfficiencyStatus: lenses.efficiency_status }))}</span>`;
  }
  if (row.evaluationGoal === SPIEL_QUALITY_GOAL || row.spielQualityAssessment) {
    const assessment = row.spielQualityAssessment || {};
    if (assessment.automationCapability === "human_review_required") {
      return `${badge("Human review", "warning")}<span class="muted small">Qwen-safe boundary · automated score withheld</span>`;
    }
    const quality = assessment.callHandlingQuality || "not_assessable";
    const tones = {
      strong: "success",
      acceptable: "notice",
      needs_improvement: "warning",
      poor: "critical",
      not_assessable: "neutral"
    };
    const qualityLink = evaluationResultsUrl({
      evaluationGoal: SPIEL_QUALITY_GOAL,
      spielCallHandlingQuality: quality
    });
    const secondary = assessment.assessmentScope === "spiel_and_handling"
      ? `Spiel: ${humanizeSlug(assessment.spielQuality || "not assessable")} · ${humanizeSlug(assessment.primaryReasonCode || "none")}`
      : `${humanizeSlug(assessment.assessmentScope || "not assessable")} · ${humanizeSlug(assessment.primaryReasonCode || "none")}`;
    return `${linkedBadge(humanizeSlug(quality), tones[quality] || "neutral", qualityLink)}<span class="muted small">${escapeHtml(secondary)}</span>`;
  }
  if (isLegacyUntypedSpecialist(row)) {
    return `${badge("Historical untyped result", "warning")}<span class="muted small">Rerun with active v2 before reporting</span>`;
  }
  if (row.evaluationGoal === "lead_validity_utilisation" && row.sharedFoundationContext?.customerOutcome === "long_term_nurture") {
    return `${badge("Long-term nurture", "neutral")}<span class="muted small">Current transcript context · archived evaluation retained</span>`;
  }
  const facets = evaluationResultFacets(row);
  return `<strong>${hrefDataLink(evaluationRecordAssessmentLabel(facets.recordClassification), evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, recordClassification: facets.recordClassification }))}</strong><span class="muted small">${facets.recordReason && facets.recordReason !== "none" ? hrefDataLink(humanizeSlug(facets.recordReason), evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, recordReason: facets.recordReason })) : escapeHtml(evaluationLeadDecisionLabel(facets))}</span>`;
}

function evaluationResultExplanationMarkup(row = {}, options = {}) {
  const longTermCorrection = row.evaluationGoal === "lead_validity_utilisation" && row.sharedFoundationContext?.customerOutcome === "long_term_nurture"
    ? `<strong>Current correction:</strong> Final agreed timing is ${escapeHtml(row.sharedFoundationContext.followUpTiming || "long-term nurture")}; this supersedes the earlier provisional callback request.<br /><span class="muted small">Historical evaluator summary preserved below.</span><br />`
    : "";
  if (row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL || row.foundationAssessment || row.evaluationGoal === OFFER_ACCEPTANCE_GOAL || row.acceptanceAssessment || row.sharedOfferAcceptanceContext || row.evaluationGoal === SPIEL_QUALITY_GOAL || row.spielQualityAssessment) {
    const summary = options.preferOwnEvaluation ? evaluationSummaryLabel(row.managerSummary) : evaluationRecordSummary(row);
    return `<span class="evidence">${escapeHtml(summary)}</span>`;
  }
  const facets = evaluationResultFacets(row);
  return `${longTermCorrection}<span class="evidence">${escapeHtml(evaluationSummaryLabel(row.managerSummary))}</span><span class="muted small">${escapeHtml(evaluationRecommendationLabel(facets.recommendation))}</span>`;
}

function renderEvaluationResultCard(row = {}, options = {}) {
  const call = row.callContext || {};
  const customerId = customerIdValue({ ...row, ...call });
  const foundation = row.sharedFoundationContext || null;
  const authoritativeOffer = options.grouped && row.evaluationGoal !== OFFER_ACCEPTANCE_GOAL
    ? null
    : authoritativeOfferAcceptanceContext(row);
  const timing = foundation?.followUpTiming
    ? hrefDataLink(foundation.followUpTiming, evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, foundationFollowUpTiming: foundation.followUpTiming }), `View results with callback timing ${foundation.followUpTiming}`)
    : `<span class="muted">${foundation ? "No timing captured" : "Awaiting Foundation evaluation"}</span>`;
  const primaryConfidence = authoritativeOffer?.confidence ?? row.confidence;
  const primaryStatus = authoritativeOffer?.status || row.status;
  const primaryEvidenceAvailability = authoritativeOffer?.evidenceAvailability || row.evidenceAvailability;
  const primaryConfidenceBand = authoritativeOffer?.confidenceBand || resultConfidenceBand(row);
  const confidence = confidenceBandLabel(primaryConfidenceBand);
  const evidenceStatus = primaryStatus === "usable" ? "Evidence sufficient" : humanizeSlug(primaryStatus || "evidence status unavailable");
  const confidenceContext = row.callIntelligence?.confidence?.reason || (authoritativeOffer && row.evaluationGoal !== OFFER_ACCEPTANCE_GOAL
    ? `Offer Acceptance evidence · Foundation confidence ${confidenceBandLabel(row.confidenceBand)}`
    : `${evidenceStatus} · ${humanizeSlug(primaryEvidenceAvailability || "unavailable")}`);
  const confidenceHref = evaluationResultsUrl({
    evaluationGoal: authoritativeOffer ? OFFER_ACCEPTANCE_GOAL : row.evaluationGoal,
    confidenceBand: primaryConfidenceBand
  });
  return `<article class="evaluation-result-card"${options.grouped ? ` data-grouped="true"` : ""} role="listitem" id="evaluation-result-${escapeHtml(row.id || row.callId || "result")}">
    ${row.localModelCapability?.operationallyPermitted === true ? "" : `<div class="notice-box"><strong>Historical research — not a decision</strong><p>This model output failed or has not passed semantic promotion. Do not use it for customer status, staff assessment, coaching, compliance, lead action, or reporting.</p></div>`}
    <header class="evaluation-result-card-header">
      <div>
        <span class="result-card-label">Call</span>
        <a class="data-link mono evaluation-result-call" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "unknown")}</a>
        <p class="muted small"><strong>Customer ID: <span class="mono">${escapeHtml(customerId)}</span></strong><br />${call.salesperson ? hrefDataLink(call.salesperson, evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, salesperson: call.salesperson })) : "Salesperson not supplied"} · ${call.source ? hrefDataLink(call.source, evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, customerImportSource: call.source })) : "Source not supplied"}<br />${(call.sourceTime || call.date) ? hrefDataLink(call.sourceTime || call.date, evaluationResultsUrl({ evaluationGoal: row.evaluationGoal, ...sourceDateFilters(call.date || call.sourceTime) })) : "Call date not supplied"}</p>
      </div>
      <div class="evaluation-result-type">
        <span class="result-card-label">Evaluation type</span>
        ${hrefDataLink(row.evaluationTypeLabel || "Evaluation", evaluationResultsUrl({ evaluationGoal: row.evaluationGoal }), `View all ${row.evaluationTypeLabel || "evaluation"} results`)}
        <span class="muted small">${escapeHtml(row.evaluationRunType === "prompt_test" ? "One-call test" : row.evaluationRunType === "batch" ? "Batch evaluation" : "Stored result")} · Template v${formatNumber(row.templateVersion || 1)}</span>
      </div>
      <a class="filter-link evaluation-result-proof-link" href="/calls/${encodeURIComponent(row.callId || "")}">Open transcript</a>
    </header>
    <div class="evaluation-result-facts">
      <div><span class="result-card-label">Called on behalf of</span><strong>${foundation?.calledOnBehalfOf ? hrefDataLink(foundation.calledOnBehalfOf, evaluationResultsUrl({ evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL, foundationCalledOnBehalfOf: foundation.calledOnBehalfOf })) : escapeHtml(foundation ? "Not captured" : "Awaiting Foundation evaluation")}</strong></div>
      <div><span class="result-card-label">Callback timing</span>${timing}</div>
      <div class="evaluation-result-outcome"><span class="result-card-label">Result</span>${evaluationResultOutcomeMarkup(row, { preferOwnEvaluation: options.grouped })}</div>
      <div><span class="result-card-label">Confidence</span><strong>${hrefDataLink(confidence, confidenceHref)}</strong><span class="muted small">${escapeHtml(confidenceContext)}</span></div>
    </div>
    <div class="evaluation-result-explanation">
      <span class="result-card-label">Record summary</span>
      ${evaluationResultExplanationMarkup(row, { preferOwnEvaluation: options.grouped })}
    </div>
    <div class="evaluation-result-updated"><span class="result-card-label">Updated</span><span>${formatDateTime(row.updatedAt || row.createdAt)}</span></div>
    ${renderEvaluationResultDetails(row)}
  </article>`;
}

function groupEvaluationDisplayRows(rows = []) {
  const groups = [];
  const lookup = new Map();
  rows.forEach((row) => {
    const key = String(row.callId || "unknown");
    if (!lookup.has(key)) {
      const group = { callId: key, rows: [] };
      lookup.set(key, group);
      groups.push(group);
    }
    lookup.get(key).rows.push(row);
  });
  return groups;
}

function renderEvaluationCallGroup(group = {}) {
  const priority = (row) => row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL
    ? 0
    : row.evaluationGoal === OFFER_ACCEPTANCE_GOAL
      ? 1
      : 2;
  const rows = (group.rows || []).slice().sort((left, right) => priority(left) - priority(right)
    || String(left.evaluationTypeLabel || left.evaluationGoal).localeCompare(String(right.evaluationTypeLabel || right.evaluationGoal)));
  const offerRow = rows.find((row) => row.evaluationGoal === OFFER_ACCEPTANCE_GOAL && row.acceptanceAssessment);
  const primary = offerRow
    || rows.find((row) => authoritativeOfferAcceptanceContext(row))
    || rows.find((row) => row.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL)
    || rows[0]
    || {};
  const call = rows.find((row) => Object.keys(row.callContext || {}).length)?.callContext || primary.callContext || {};
  const customerId = customerIdValue({ ...primary, ...call });
  const authoritative = authoritativeOfferAcceptanceContext(primary);
  const aggregate = primary.callIntelligence || rows.find((row) => row.callIntelligence)?.callIntelligence || null;
  const confidenceBand = aggregate?.confidence?.band || authoritative?.confidenceBand || primary.confidenceBand || "unknown";
  const types = Array.from(new Set(rows.map((row) => row.evaluationTypeLabel || humanizeSlug(row.evaluationGoal || "evaluation"))));
  const sourceTime = call.sourceTime || call.date;
  const salesperson = call.salesperson
    ? hrefDataLink(call.salesperson, evaluationResultsUrl({ salesperson: call.salesperson }), `View all evaluated calls for ${call.salesperson}`)
    : "Salesperson not supplied";
  const source = call.source
    ? hrefDataLink(call.source, evaluationResultsUrl({ customerImportSource: call.source }), `View all evaluated calls from ${call.source}`)
    : "Source not supplied";
  const callDate = sourceTime
    ? hrefDataLink(formatSourceTime(call), evaluationResultsUrl(sourceDateFilters(call.date || sourceTime)), `View all evaluated calls from ${formatSourceTime(call)}`)
    : "Call date not supplied";
  const commercial = aggregate?.commercialState || null;
  const quotedValue = commercial?.quotedValue === null || commercial?.quotedValue === undefined
    ? "Unknown"
    : `${commercial.quotedCurrency && commercial.quotedCurrency !== "unknown" ? `${commercial.quotedCurrency} ` : ""}${formatNumber(commercial.quotedValue)} quoted`;
  const conflicts = (aggregate?.conflicts || []).map((conflict) => `<li><strong>${escapeHtml(humanizeSlug(conflict.type))}</strong>: Foundation ${escapeHtml(humanizeSlug(conflict.foundationValue))}; specialist ${escapeHtml(humanizeSlug(conflict.specialistValue))}. Resolved by ${escapeHtml(humanizeSlug(conflict.resolutionRule))}.</li>`).join("");
  const provenance = (aggregate?.provenanceClaims || []).map((claim) => `<li>${badge(humanizeSlug(claim.sourceType), claim.sourceType === "call_metadata" ? "neutral" : claim.sourceType === "specialist_result" ? "success" : claim.sourceType === "deterministic_derivation" ? "notice" : "info")} <strong>${escapeHtml(humanizeSlug(claim.claimType))}</strong>: ${escapeHtml(claim.value === null || claim.value === "" ? "Unknown" : String(claim.value))}${claim.evidence ? `<br /><span class="evidence">${escapeHtml(claim.evidence)}</span>` : ""}</li>`).join("");
  const routing = Object.entries(aggregate?.routing || {}).map(([goal, route]) => `<li><strong>${escapeHtml(humanizeSlug(goal))}</strong>: ${escapeHtml(humanizeSlug(route.state))}${route.resultId ? ` · result ${escapeHtml(route.resultId)}` : ""}</li>`).join("");
  const keyEvidence = aggregate?.keyEvidence || {};
  const keyEvidenceMarkup = [
    ["Presented offer", keyEvidence.offer],
    ["Customer acceptance", keyEvidence.acceptance],
    ["Payment timing", keyEvidence.paymentTiming]
  ].filter(([, quote]) => quote).map(([label, quote]) => `<li><strong>${escapeHtml(label)}:</strong> <span class="evidence">${escapeHtml(quote)}</span></li>`).join("");
  return `<article class="evaluation-call-group" role="listitem" data-call-id="${escapeHtml(group.callId || "unknown")}">
    <header class="evaluation-call-group-header">
      <div class="evaluation-call-identity">
        <span class="result-card-label">Call</span>
        <a class="data-link mono" href="/calls/${encodeURIComponent(group.callId || "")}">${escapeHtml(group.callId || "unknown")}</a>
        <strong class="small">Customer ID: <span class="mono">${escapeHtml(customerId)}</span></strong>
        <span class="muted small">${salesperson} · ${source}<br />${callDate}</span>
      </div>
      <div class="evaluation-call-current-outcome">
        <span class="result-card-label">Model-output status</span>
        ${evaluationResultOutcomeMarkup(primary)}
        <span class="muted small">Historical model confidence is uncalibrated and non-operational.</span>
      </div>
      <div class="evaluation-call-count">
        ${badge(`${formatNumber(rows.length)} evaluation${rows.length === 1 ? "" : "s"}`, rows.length > 1 ? "notice" : "neutral")}
        <a class="filter-link" href="/calls/${encodeURIComponent(group.callId || "")}">Open transcript</a>
      </div>
    </header>
    <div class="evaluation-call-summary">
      <span class="result-card-label">Archive note</span>
      <p>${escapeHtml(evaluationRecordSummary(primary))}</p>
    </div>
    ${commercial ? `<dl class="result-answer-list call-commercial-state">
      <div><dt>Accepted-offer state</dt><dd>${escapeHtml(humanizeSlug(commercial.offerState))} · ${escapeHtml(humanizeSlug(commercial.acceptanceStrength))}</dd></div>
      <div><dt>Quoted value</dt><dd>${escapeHtml(quotedValue)} · ${escapeHtml(humanizeSlug(commercial.currencyBasis))} currency basis</dd></div>
      <div><dt>Payment</dt><dd>${escapeHtml(humanizeSlug(commercial.paymentState))} · ${escapeHtml(humanizeSlug(commercial.paymentVerificationState))}</dd></div>
      <div><dt>Intended payment timing</dt><dd>${escapeHtml(commercial.intendedPaymentDateRaw || "Unknown")}${commercial.intendedPaymentDateResolved ? ` → ${escapeHtml(commercial.intendedPaymentDateResolved)}` : ""}${commercial.intendedPaymentDateResolution?.ambiguity === "possible" ? " · policy-resolved; raw wording retained" : ""}</dd></div>
      <div><dt>Invoice / fulfilment</dt><dd>${escapeHtml(humanizeSlug(commercial.invoiceState))} / ${escapeHtml(humanizeSlug(commercial.fulfilmentState))}</dd></div>
      <div><dt>Revenue / CRM</dt><dd>${escapeHtml(humanizeSlug(commercial.revenueState))} / ${escapeHtml(humanizeSlug(commercial.crmState))}</dd></div>
      <div><dt>Follow-up evidence</dt><dd>${escapeHtml(humanizeSlug(aggregate.followUp?.status || "unknown"))}${aggregate.followUp?.matchedCallId ? ` · related call ${escapeHtml(aggregate.followUp.matchedCallId)} · completion not established` : ""}</dd></div>
      <div><dt>Operational next step</dt><dd>${escapeHtml(aggregate.operationalNextAction || "No verified next action established")}</dd></div>
    </dl>` : ""}
    ${keyEvidenceMarkup ? `<details class="compact-details"><summary>View strongest transcript evidence</summary><ul class="result-evidence-list">${keyEvidenceMarkup}</ul></details>` : ""}
    ${conflicts ? `<div class="notice-box"><strong>Resolved evaluator conflict</strong><ul>${conflicts}</ul></div>` : ""}
    ${routing ? `<details class="compact-details"><summary>View specialist routing and evaluation states</summary><ul class="result-evidence-list">${routing}</ul></details>` : ""}
    ${provenance ? `<details class="compact-details"><summary>View claim provenance</summary><ul class="result-evidence-list">${provenance}</ul></details>` : ""}
    <details class="evaluation-call-evaluations">
      <summary>View ${formatNumber(rows.length)} evaluation${rows.length === 1 ? "" : "s"}: ${escapeHtml(types.join(", "))}</summary>
      <div class="evaluation-result-list grouped-results" role="list">${rows.map((row) => renderEvaluationResultCard(row, { grouped: true })).join("")}</div>
    </details>
  </article>`;
}

function renderAuthorityLegend() {
  return `<div class="authority-legend" aria-label="Evidence authority definitions">
    <div><span class="authority-chip source">Source Fact</span><p class="muted small">Copied from a permitted source field without interpreting intent.</p></div>
    <div><span class="authority-chip derived">Deterministic Derived Fact</span><p class="muted small">Produced by a closed, inspectable rule with exact evidence.</p></div>
    <div><span class="authority-chip judgment">Semantic Judgment</span><p class="muted small">Unavailable unless a separately promoted capability or explicit manager benchmark label supplies it.</p></div>
  </div>`;
}

function renderCapabilityCatalog(catalog = {}) {
  const rows = catalog.capabilities || [];
  const stopped = rows.filter((row) => /failed|stopped|retire|disabled/.test(String(row.status || ""))).length;
  return `<section class="studio-library" id="capability-register" aria-labelledby="capability-register-heading">
    <div class="studio-section-heading">
      <div><p class="page-kicker">Authority register</p><h3 id="capability-register-heading">What each evaluator is actually allowed to do</h3><p class="muted small">Every row states the exact recorded scope and why it has no current authority. Technical completion is shown separately from semantic accuracy.</p></div>
      ${badge(catalog.available ? "0 promoted" : "register unavailable", catalog.available ? "warning" : "danger")}
    </div>
    ${!catalog.available ? `<div class="callout danger"><strong>Capability register unavailable.</strong> ${escapeHtml(catalog.error || "All model use remains denied.")}</div>` : `
      <div class="metrics">
        ${metricCard("Registered capabilities", formatNumber(rows.length), "Every known local-model lane", "info")}
        ${metricCard("Promoted", "0", "No submission or operational authority", "neutral")}
        ${metricCard("Failed / stopped", formatNumber(stopped), "Preserved as research evidence", "warning")}
        ${metricCard("Model digest", shortHash(catalog.model?.local_digest), "Pinned historical provenance", "neutral")}
      </div>
      <div class="capability-list">
        ${rows.map((row) => `<details class="capability-record">
          <summary><span class="mono">${escapeHtml(row.id)}</span>${badge(humanizeSlug(row.status), /technical/.test(row.status) ? "notice" : /failed|stopped|retire/.test(row.status) ? "danger" : "neutral")}${badge("authority: none", "warning")}</summary>
          <dl class="result-answer-list">
            <div><dt>Exact scope</dt><dd>${escapeHtml(row.scope)}</dd></div>
            <div><dt>Provenance</dt><dd><span class="mono">${escapeHtml(row.provenance?.modelKey || "not recorded")}</span><br /><span class="muted small">${escapeHtml(row.provenance?.providerModel || "not recorded")} · digest ${escapeHtml(shortHash(row.provenance?.modelDigest))}</span></dd></div>
            <div><dt>Status / authority</dt><dd>${escapeHtml(row.status)} / none</dd></div>
            <div><dt>Exclusions</dt><dd>${(row.exclusions || []).map((item) => `<span class="evidence">${escapeHtml(item)}</span>`).join("")}</dd></div>
            <div><dt>Recorded evidence</dt><dd><span class="mono small">${escapeHtml(row.evidence ? JSON.stringify(row.evidence) : "No standalone numeric result recorded")}</span></dd></div>
            <div><dt>Failure reason</dt><dd>${escapeHtml(row.failureReason)}</dd></div>
            <div><dt>Permitted next action</dt><dd>${escapeHtml(row.permittedNextAction)}</dd></div>
          </dl>
        </details>`).join("")}
      </div>
      <details class="compact-details"><summary>Register provenance and controlling audits</summary><dl class="result-answer-list">
        <div><dt>Register hash</dt><dd class="mono">${escapeHtml(catalog.registerHash || "Unavailable")}</dd></div>
        <div><dt>Program status</dt><dd>${escapeHtml(catalog.programStatus || "unknown")}</dd></div>
        <div><dt>Allowed uses</dt><dd>${(catalog.allowedUses || []).map((item) => `<span class="evidence">${escapeHtml(item)}</span>`).join("") || "None"}</dd></div>
        <div><dt>Prohibited uses</dt><dd>${(catalog.prohibitedUses || []).map((item) => `<span class="evidence">${escapeHtml(item)}</span>`).join("") || "All operational use"}</dd></div>
        <div><dt>Controlling evidence</dt><dd>${(catalog.controllingEvidence || []).map((item) => `<span class="mono small">${escapeHtml(item)}</span>`).join("<br />")}</dd></div>
      </dl></details>`}
  </section>`;
}

function renderVoicemailInboundLane(report = {}) {
  const totals = report.totals || {};
  const explicit = report.explicitImportedSource || {};
  const evidenceRows = (report.records || [])
    .filter((row) => row.message?.status === "observed" || row.inboundLink?.status === "observed" || row.inboundLink?.status === "not_scored")
    .slice(0, 12);
  return `<section class="studio-library" id="voicemail-inbound" aria-labelledby="voicemail-inbound-heading">
    <div class="studio-section-heading">
      <div><p class="page-kicker">First trusted lane</p><h3 id="voicemail-inbound-heading">Voicemail and later inbound evidence</h3><p class="muted small">Recomputed from the active import. The lane measures literal wording, chronology and stable-ID relationships; it never calls a later inbound record a caused callback.</p></div>
      ${badge("deterministic · no model", "success")}
    </div>
    ${renderAuthorityLegend()}
    <div class="metrics">
      ${metricCard("Calls", formatNumber(totals.calls), `${formatNumber(totals.outboundCalls)} outbound · ${formatNumber(totals.inboundCalls)} inbound`, "info")}
      ${metricCard("Exact voicemail", formatNumber(totals.exactVoicemail), `${formatRatioPercent(totals.exactVoicemailRate)} of outbound`, "info")}
      ${metricCard("Literal callback requests", formatNumber(totals.transcriptVerifiableCallbackRequests), `${formatRatioPercent(totals.callbackRequestRate)} of exact voicemail`, "notice")}
      ${metricCard("Exact approved wording", formatNumber(totals.exactApprovedMessages), `${formatRatioPercent(totals.exactApprovedMessageRate)} · complete wording required`, totals.exactApprovedMessages ? "success" : "neutral")}
      ${metricCard("Clean chronology links", formatNumber(totals.uniquelyLinkedLaterInbound), `${formatNumber(totals.laterInboundRelationshipObserved)} later-inbound relationships · ${formatNumber(totals.ambiguousLaterInboundLinks)} ambiguous`, "notice")}
      ${metricCard("Commercial outcome", "Unavailable", "No trusted CRM sale or gross-profit fields", "neutral")}
    </div>
    <div class="callout warning"><strong>Do not read this as callback conversion.</strong> A later inbound call sharing a stable ID is an observed record relationship only. Message causation, receptiveness, sale and gross profit remain unknown.</div>
    <div class="result-answer-list">
      <div><dt>Approved wording contract</dt><dd><span class="evidence">${escapeHtml(report.approvedMessageTemplate || "Unavailable")}</span><span class="muted small">The salesperson name is the only variable. Paraphrases remain separate literal callback-request evidence, not approved-message compliance.</span></dd></div>
      <div><dt>Explicit imported-source subset</dt><dd>${formatNumber(explicit.outboundCalls)} outbound · ${formatNumber(explicit.exactVoicemail)} exact voicemail · ${formatNumber(explicit.transcriptVerifiableCallbackRequests)} literal callback requests · ${formatNumber(explicit.laterInboundRelationshipObserved)} later-inbound relationships · ${formatNumber(explicit.uniquelyLinkedLaterInbound)} with no intervening matching outbound</dd></div>
      <div><dt>Recorded handling</dt><dd>${formatNumber(totals.originalSalespersonHandlingObserved)} original-salesperson · ${formatNumber(totals.overflowHandlingObserved)} different-salesperson · ${formatNumber(totals.handlingUnknown)} unknown, using exact source salesperson plus a matching CWA speaker turn</dd></div>
      <div><dt>Full-coverage-day average</dt><dd>${formatNumber(report.completeDayAverage?.totalCalls)} calls · ${formatNumber(report.completeDayAverage?.outboundCalls)} outbound · ${formatNumber(report.completeDayAverage?.inboundCalls)} inbound · ${formatNumber(report.completeDayAverage?.exactVoicemail)} exact voicemail across ${(report.completeDayAverage?.dates || []).map(formatSourceDate).join(", ")}<br /><span class="muted small">${escapeHtml(report.completeDayAverage?.qualificationRule || "Date coverage rule unavailable")}</span></dd></div>
    </div>
    <details class="compact-details"><summary>Daily source facts and definitions</summary>
      ${table([
        { label: "Date", render: (row) => `${escapeHtml(formatSourceDate(row.date))}${row.completeDate ? `<br />${badge("full coverage", "success")}` : `<br />${badge("partial coverage", "warning")}`}` },
        { label: "Calls", render: (row) => formatNumber(row.totalCalls) },
        { label: "Outbound", render: (row) => formatNumber(row.outboundCalls) },
        { label: "Inbound", render: (row) => formatNumber(row.inboundCalls) },
        { label: "Exact voicemail", render: (row) => formatNumber(row.exactVoicemail) }
      ], report.daily || [], "No valid source dates are available.")}
      <ul class="muted small">${(report.provenance?.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
    </details>
    <details class="compact-details"><summary>Inspect exact message and linkage evidence (${formatNumber(evidenceRows.length)} examples)</summary>
      ${table([
        { label: "Outbound call", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.outboundCallId)}">${escapeHtml(row.outboundCallId)}</a><br /><span class="muted small">${escapeHtml(row.outboundSourceTime)}</span>` },
        { label: "Message fact", render: (row) => `${badge(humanizeSlug(row.message?.status), row.message?.status === "observed" ? "success" : "neutral")}<br /><span class="muted small">${escapeHtml(row.message?.reason)}</span>` },
        { label: "Exact evidence", render: (row) => row.message?.callbackRequest ? `<span class="evidence">${escapeHtml(row.message.callbackRequest.speaker)}: ${escapeHtml(row.message.callbackRequest.quote)}</span>` : `<span class="muted small">No literal callback request observed after the prompt.</span>` },
        { label: "Later inbound", render: (row) => `${badge(humanizeSlug(row.inboundLink?.status), row.inboundLink?.status === "observed" ? "notice" : "neutral")} ${row.inboundLink?.eventAttributionStatus ? badge(`event link: ${humanizeSlug(row.inboundLink.eventAttributionStatus)}`, row.inboundLink.eventAttributionStatus === "observed" ? "success" : "warning") : ""}<br /><span class="muted small">${escapeHtml(row.inboundLink?.eventAttributionReason || row.inboundLink?.reason)}</span>${row.inboundLink?.inboundCallId ? `<br /><a class="data-link mono" href="/calls/${encodeURIComponent(row.inboundLink.inboundCallId)}">${escapeHtml(row.inboundLink.inboundCallId)}</a>` : ""}` }
      ], evidenceRows, "No message or later-inbound evidence is available.")}
    </details>
  </section>`;
}

function formatMinorCurrency(minorUnits, currency) {
  if (!Number.isFinite(Number(minorUnits)) || !currency) return "n/a";
  return `${currency} ${(Number(minorUnits) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pilotMeasureMarkup(measure = {}, value = "") {
  const tone = measure.status === "observed"
    ? "success"
    : measure.status === "not_scored"
      ? "danger"
      : measure.status === "unknown_incomplete_window"
        ? "warning"
        : "neutral";
  const reasons = (measure.reasons || []).map(humanizeSlug).join("; ");
  return `${badge(humanizeSlug(measure.status || "unknown"), tone)}${value ? `<br /><span class="small">${escapeHtml(value)}</span>` : ""}${reasons ? `<br /><span class="muted small">${escapeHtml(reasons)}</span>` : ""}`;
}

function renderVoicemailPilotAttribution(report = {}) {
  const totals = report.totals || {};
  const configured = report.configured === true;
  const invalidSource = ["load_error", "invalid_source"].includes(report.status);
  const statusTone = !configured ? "neutral" : invalidSource ? "danger" : report.status === "ready" ? "success" : "warning";
  const itt = report.intentionToTreat || {};
  const armRows = report.arms || [];
  const acceptedExamples = (report.acceptedRecords || []).slice(0, 20);
  const rejectedExamples = (report.rejectedRecords || []).slice(0, 20);
  const sourceLabel = [report.source?.sourceName, report.source?.sheetName].filter(Boolean).join(" / ");

  return `<section class="studio-library" id="voicemail-pilot" aria-labelledby="voicemail-pilot-heading">
    <div class="studio-section-heading">
      <div><p class="page-kicker">Controlled source attribution</p><h3 id="voicemail-pilot-heading">Voicemail recovery pilot</h3><p class="muted small">Optional source-system proof for preassignment, message completion, explicit callback links, handlers and CRM outcomes. This import is read-only and creates no model job, evaluation result or operational queue.</p></div>
      ${badge(humanizeSlug(report.status || "not_configured"), statusTone)}
    </div>
    ${renderAuthorityLegend()}
    ${!configured ? `<div class="callout"><strong>No pilot export is configured.</strong> Start with <span class="mono">--voicemail-pilot &lt;path&gt;</span> or set <span class="mono">SALES_DASHBOARD_VOICEMAIL_PILOT_PATH</span>. Until an export passes the contract, callback lift, sales and gross profit remain unavailable.</div>` : ""}
    ${configured && sourceLabel ? `<p class="muted small">Source file: <span class="mono">${escapeHtml(sourceLabel)}</span>. The full local path is deliberately not exposed.</p>` : ""}
    ${invalidSource ? `<div class="callout danger"><strong>Pilot source rejected.</strong> Nothing from this file is scored or joined to an operational record.<ul>${(report.fileErrors || []).map((item) => `<li>${escapeHtml(humanizeSlug(item))}</li>`).join("")}</ul></div>` : ""}
    ${configured && !invalidSource ? `
      <div class="metrics">
        ${metricCard("Pilot rows", formatNumber(totals.inputRows), "One row per preassigned voicemail opportunity", "info")}
        ${metricCard("Accepted assignments", formatNumber(totals.acceptedAssignments), `${formatNumber(totals.rejectedAssignments)} rejected before denominators`, totals.rejectedAssignments ? "warning" : "success")}
        ${metricCard("Measure exclusions", formatNumber(totals.measureNotScored), "Invalid downstream facts remain not scored", totals.measureNotScored ? "warning" : "neutral")}
        ${metricCard("Explicit callbacks", formatNumber(totals.callbacksObserved), "Exact inbound call ID plus allowed provenance", "notice")}
        ${metricCard("CRM outcomes", formatNumber(totals.salesObserved), "Explicit sale ID, state and timestamp", "info")}
        ${metricCard("ITT callback lift", itt.status === "measured_comparison" ? `${(Number(itt.absoluteDifference || 0) * 100).toFixed(1)} pp` : "Unavailable", humanizeSlug(itt.reason || "not_available"), itt.status === "measured_comparison" ? "notice" : "neutral")}
      </div>
      <div class="callout ${itt.status === "measured_comparison" ? "warning" : "danger"}"><strong>${itt.status === "measured_comparison" ? "Measured comparison only." : "Callback-lift result withheld."}</strong> ${escapeHtml(itt.interpretation || humanizeSlug(itt.reason || "Required proof is incomplete."))}</div>
      ${table([
        { label: "Pilot arm", render: (row) => `<strong>${escapeHtml(humanizeSlug(row.arm))}</strong>` },
        { label: "Assigned", render: (row) => formatNumber(row.assigned) },
        { label: "Approved message", render: (row) => `${formatNumber(row.approvedMessages)}<br /><span class="muted small">${formatRatioPercent(row.arm === "treatment" ? (row.assigned ? row.approvedMessages / row.assigned : null) : null)} treatment compliance</span>` },
        { label: "Callback outcome", render: (row) => `${formatNumber(row.callbacksObserved)} observed / ${formatNumber(row.callbacksNotObservedInCompletedWindow)} not observed<br /><span class="muted small">${formatNumber(row.callbacksUnknownIncompleteWindow)} incomplete window; ${formatNumber(row.callbacksNotScored)} not scored</span>` },
        { label: "Callback rate", render: (row) => `${escapeHtml(formatRatioPercent(row.resolvedCallbackRate))}<br /><span class="muted small">${escapeHtml(humanizeSlug(row.callbackRateStatus))}</span>` },
        { label: "Handling", render: (row) => `${formatNumber(row.originalSalespersonHandling)} original / ${formatNumber(row.differentSalespersonHandling)} different<br /><span class="muted small">${formatNumber(row.handlerUnknown)} unknown</span>` },
        { label: "CRM outcomes", render: (row) => `${formatNumber(row.salesWon)} won / ${formatNumber(row.salesLost)} lost<br /><span class="muted small">${formatNumber(row.salesPending)} pending; ${formatNumber(row.salesReversed)} reversed; ${formatNumber(row.commercialObservationIncomplete)} incomplete windows; ${formatNumber(row.saleNotScored + row.financialScopeNotScored + row.commercialScopeNotScored)} not scored facts</span>` }
      ], armRows, "No accepted pilot assignments are available.")}
      <details class="compact-details"><summary>Attribution provenance and gross profit</summary>
        <dl class="result-answer-list">
          ${(report.attributionSources || []).map((row) => `<div><dt>${escapeHtml(humanizeSlug(row.source))}</dt><dd>${formatNumber(row.callbacks)} explicit callback link${row.callbacks === 1 ? "" : "s"}</dd></div>`).join("")}
        </dl>
        ${table([
          { label: "Currency", render: (row) => `<strong>${escapeHtml(row.currency)}</strong>` },
          { label: "Gross profit", render: (row) => formatMinorCurrency(row.totalMinorUnits, row.currency) },
          { label: "Assigned opportunities", render: (row) => formatNumber(row.assignedOpportunities) },
          { label: "Evidence coverage", render: (row) => `${badge(humanizeSlug(row.grossProfitStatus), row.grossProfitStatus === "available_complete_equal_window" ? "success" : "warning")}<br /><span class="muted small">${formatNumber(row.profitCompleteAssignments)} / ${formatNumber(row.assignedOpportunities)} complete</span>` },
          { label: "Per assigned", render: (row) => formatMinorCurrency(row.grossProfitPerAssignedMinorUnits, row.currency) },
          { label: "Per won sale", render: (row) => `${formatMinorCurrency(row.grossProfitPerWonSaleMinorUnits, row.currency)}<br /><span class="muted small">${formatNumber(row.wonSalesWithProfit)} won with profit</span>` }
        ], report.grossProfitByCurrency || [], "No valid gross-profit records are available. Currencies are never combined or converted.")}
      </details>
      <details class="compact-details"><summary>Inspect accepted source records (${formatNumber(acceptedExamples.length)} shown)</summary>
        ${table([
          { label: "Pilot record", render: (row) => `<span class="mono">${escapeHtml(row.pilotRecordId)}</span><br />${badge(humanizeSlug(row.pilotArm), "notice")}` },
          { label: "Outbound proof", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.outboundCall?.callId || "")}">${escapeHtml(row.outboundCall?.callId || "unknown")}</a><br /><span class="muted small">${escapeHtml(row.outboundCall?.sourceTime || "time unavailable")} · event ${escapeHtml(row.voicemailEventId)}</span>` },
          { label: "Message", render: (row) => pilotMeasureMarkup(row.message, row.message?.value ? humanizeSlug(row.message.value) : "") },
          { label: "Callback", render: (row) => `${pilotMeasureMarkup(row.callback, row.callback?.attributionSource ? humanizeSlug(row.callback.attributionSource) : "")}${row.callback?.callId ? `<br /><a class="data-link mono" href="/calls/${encodeURIComponent(row.callback.callId)}">${escapeHtml(row.callback.callId)}</a>` : ""}` },
          { label: "Sale / profit", render: (row) => `${pilotMeasureMarkup(row.financialScope, row.financialScope?.currency || "")}${pilotMeasureMarkup(row.commercialScope, row.commercialScope?.completedAt || "")}${pilotMeasureMarkup(row.sale, row.sale?.value ? humanizeSlug(row.sale.value) : "")}${row.profit?.status === "observed" ? `<br /><strong>${escapeHtml(formatMinorCurrency(row.profit.minorUnits, row.profit.currency))}</strong>` : row.profit?.status === "not_scored" ? `<br />${pilotMeasureMarkup(row.profit)}` : ""}` }
        ], acceptedExamples, "No accepted source records are available.")}
      </details>
      ${rejectedExamples.length ? `<details class="compact-details"><summary>Inspect rejected assignments (${formatNumber(rejectedExamples.length)} shown)</summary>${table([
        { label: "Source row", render: (row) => formatNumber(row.rowNumber) },
        { label: "Pilot record", render: (row) => `<span class="mono">${escapeHtml(row.pilotRecordId || "missing")}</span>` },
        { label: "Outbound call", render: (row) => row.outboundCallId ? `<a class="data-link mono" href="/calls/${encodeURIComponent(row.outboundCallId)}">${escapeHtml(row.outboundCallId)}</a>` : `<span class="muted small">missing</span>` },
        { label: "Controlling reasons", render: (row) => (row.reasons || []).map((item) => `<span class="evidence">${escapeHtml(humanizeSlug(item))}</span>`).join("") }
      ], rejectedExamples, "No rejected assignments.")}</details>` : ""}
    ` : ""}
    <details class="compact-details"><summary>Required source contract and safety boundary</summary>
      <p class="muted small">Required columns: ${(report.contract?.requiredColumns || []).map((column) => `<span class="mono">${escapeHtml(column)}</span>`).join(", ") || "Load the repository contract for the complete field list."}</p>
      <ul class="muted small">${(report.provenance?.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
    </details>
  </section>`;
}

function renderValidationLabelQuestion(manifest = {}, example = {}) {
  const context = example.context || {};
  const turns = context.transcriptTurns || [];
  return `<article class="benchmark-question">
    <div class="benchmark-question-header"><div><p class="page-kicker">Direct-quote question</p><h4>Call <a class="data-link mono" href="${escapeHtml(context.transcriptProofHref || "#")}">${escapeHtml(example.callId)}</a></h4><p class="muted small">${escapeHtml(context.sourceTime || "Time unavailable")} · ${escapeHtml(context.direction || "unknown")} · ${escapeHtml(context.salesperson || "Unknown seller")} · ${formatNumber(context.durationSeconds)} sec</p></div>${badge(humanizeSlug(example.provisionalStratum), "neutral")}</div>
    <p><strong>Human question:</strong> For <em>${escapeHtml(manifest.exactFact)}</em>, what exact decision should the benchmark expect?</p>
    <form class="benchmark-label-form" method="post" action="/evaluation-studio/validation-lab/manifests/${encodeURIComponent(manifest.id)}/labels">
      <input type="hidden" name="callId" value="${escapeHtml(example.callId)}" />
      <fieldset class="quote-timeline"><legend>Select the exact quote(s) that control your decision</legend>
        ${turns.map((turn, index) => `<label class="quote-turn"><input type="checkbox" name="evidenceTurnIndex" value="${index}" /><span><strong>${escapeHtml(turn.speaker || "Transcript")}</strong><q>${escapeHtml(turn.text)}</q></span></label>`).join("") || `<div class="empty">No transcript turns are available. This call cannot be frozen.</div>`}
      </fieldset>
      <div class="benchmark-label-grid">
        <label>Expected decision<input name="expectedDecision" required placeholder="Exact closed label, e.g. present" /></label>
        <label>Case type<select name="caseType" required><option value="positive">Positive</option><option value="hard_negative">Hard negative</option><option value="unsupported">Unsupported</option></select></label>
        <label>Evidence support<select name="supportStatus" required><option value="supported">Selected quote supports a closed decision</option><option value="unsupported">Evidence cannot support a closed decision / not scored</option></select></label>
        <label><span><input type="checkbox" name="critical" value="true" /> Critical safety case</span><span class="muted small">Any wrong decision must stop the candidate use.</span></label>
        <label class="studio-field-full">Controlling reason<textarea name="controllingReason" rows="3" required placeholder="Why the selected quote controls this exact decision"></textarea></label>
      </div>
      <div class="evaluation-submit-row"><button type="submit">Save benchmark label</button><span class="muted small">This writes benchmark truth only. It creates no operational review or model job.</span></div>
    </form>
  </article>`;
}

function renderValidationManifest(manifest = {}, selectedManifestId = "") {
  const examples = manifest.examples || [];
  const labelled = examples.filter((example) => example.labelStatus === "confirmed").length;
  const readiness = manifest.readiness || {};
  const open = selectedManifestId === manifest.id || manifest.status === "draft_labeling";
  return `<details class="validation-manifest"${open ? " open" : ""}>
    <summary><span><strong>${escapeHtml(manifest.name)}</strong><span class="mono small">${escapeHtml(manifest.id)}</span></span>${badge(humanizeSlug(manifest.partition), "notice")}${badge(humanizeSlug(manifest.status), manifest.status === "frozen" ? "success" : "warning")}</summary>
    <div class="manifest-contract-grid">
      <div><span>Exact fact</span><strong>${escapeHtml(manifest.exactFact)}</strong></div>
      <div><span>Product use</span><strong>${escapeHtml(manifest.productUse)}</strong></div>
      <div><span>Human labels</span><strong>${formatNumber(labelled)} / ${formatNumber(examples.length)}</strong></div>
      <div><span>Prior-audit exclusions</span><strong>${formatNumber(manifest.priorAuditExclusion?.excludedCallCount)}</strong></div>
      <div><span>Evidence minimum</span><strong>${formatNumber(manifest.evidenceContract?.minimumExactQuotesPerDecision)} exact quote per decision</strong></div>
      <div><span>Fingerprint</span><strong class="mono">${escapeHtml(shortHash(manifest.manifestFingerprint || manifest.priorAuditExclusion?.fingerprint))}</strong></div>
    </div>
    ${manifest.status === "draft_labeling" ? `
      <div class="callout ${readiness.ready ? "success" : "warning"}"><strong>${readiness.ready ? "Ready to freeze." : "Freeze blocked."}</strong> ${readiness.ready ? "All labels, evidence, minimum size and case balance are valid." : escapeHtml((readiness.blockers || []).map(humanizeSlug).join(" · "))}</div>
      <div class="benchmark-batch-heading"><div><h4>Human labelling batch</h4><p class="muted small">At most five unseen calls are shown. Read the exact chronological quotes, decide the closed label, and select the controlling evidence.</p></div>${badge(`${formatNumber((manifest.labelBatch || []).length)} questions`, "info")}</div>
      <div class="benchmark-question-list">${(manifest.labelBatch || []).map((example) => renderValidationLabelQuestion(manifest, example)).join("") || `<div class="empty">No pending labels remain. Check freeze readiness below.</div>`}</div>
      <form method="post" action="/evaluation-studio/validation-lab/manifests/${encodeURIComponent(manifest.id)}/freeze" class="evaluation-submit-row">
        <button type="submit"${readiness.ready ? "" : " disabled"}>Freeze labels and manifest</button>
        <span class="muted small">Freezing is irreversible. It does not authorise inference or promotion.</span>
      </form>` : `
      <div class="callout success"><strong>Labels frozen before inference.</strong> Fingerprint <span class="mono">${escapeHtml(manifest.manifestFingerprint)}</span>. No candidate is promoted by freezing.</div>`}
    <details class="compact-details"><summary>Selection, balance, thresholds and stop rule</summary><dl class="result-answer-list">
      <div><dt>Selection</dt><dd>${formatNumber(manifest.selectionContract?.selectedSize)} of ${formatNumber(manifest.selectionContract?.eligibleBeforeSelection)} eligible unseen calls; historical results, prior audits and other manifests excluded.</dd></div>
      <div><dt>Case balance</dt><dd>${formatNumber(readiness.balance?.counts?.positive)} positive · ${formatNumber(readiness.balance?.counts?.hard_negative)} hard negative · ${formatNumber(readiness.balance?.counts?.unsupported)} unsupported; minimum ${formatNumber(readiness.balance?.minimumPerType)} each.</dd></div>
      <div><dt>Promotion thresholds</dt><dd>${formatPercent(Number(manifest.promotionContract?.minimumDecisionAccuracy || 0) * 100)} decision accuracy · ${formatPercent(Number(manifest.promotionContract?.minimumEvidenceIntegrity || 0) * 100)} evidence integrity · ${formatPercent(Number(manifest.promotionContract?.minimumCoverage || 0) * 100)} coverage · zero critical errors.</dd></div>
      <div><dt>Resource budget</dt><dd>${formatNumber(manifest.promotionContract?.maximumJobs)} jobs · ${formatNumber(manifest.promotionContract?.maximumAttempts)} attempts · ${formatNumber(manifest.promotionContract?.maximumRetries)} retries · ${formatNumber(manifest.promotionContract?.maximumTokens)} tokens · ${formatNumber(manifest.promotionContract?.maximumExecutionMs)} ms. Zero model budgets permit deterministic comparison only.</dd></div>
      <div><dt>Stop rule</dt><dd>A failed narrow unseen semantic gate stops the candidate family. It does not trigger another decomposition.</dd></div>
      <div><dt>Authority</dt><dd>Benchmark truth only; no queue, denominator, ranking, coaching, compliance, finance, lead or CRM use.</dd></div>
    </dl></details>
  </details>`;
}

function renderCandidateComparisons(comparisons = []) {
  if (!comparisons.length) return `<div class="empty"><strong>No candidate comparison has been recorded.</strong><br />A frozen manifest is evidence preparation, not permission to run a candidate.</div>`;
  return `<div class="validation-manifest-list">${comparisons.map((record) => {
    const comparison = record.comparison || record;
    const totals = comparison.totals || {};
    return `<details class="validation-manifest"><summary><span><strong>${escapeHtml(comparison.candidateId || "Candidate")}</strong><span class="mono small">Manifest ${escapeHtml(shortHash(comparison.manifestFingerprint || comparison.manifestId))}</span></span>${badge(record.eligibleForExternalApproval ? "gate passed · approval required" : "gate failed", record.eligibleForExternalApproval ? "success" : "danger")}</summary>
      <div class="metrics">
        ${metricCard("Exact decisions", `${formatNumber(totals.exact)} / ${formatNumber(totals.examples)}`, formatPercent(Number(totals.accuracy || 0) * 100), "info")}
        ${metricCard("False positive / negative", `${formatNumber(totals.falsePositives)} / ${formatNumber(totals.falseNegatives)}`, `${formatNumber(totals.unsupportedErrors)} unsupported errors`, "warning")}
        ${metricCard("Abstentions", formatNumber(totals.abstentions), `${formatPercent(Number(totals.coverage || 0) * 100)} supported-call coverage`, "neutral")}
        ${metricCard("Evidence integrity", formatPercent(Number(totals.evidenceIntegrity || 0) * 100), `${formatNumber(totals.criticalErrors)} critical errors`, totals.criticalErrors ? "risk" : "good")}
      </div>
      <dl class="result-answer-list">
        <div><dt>Stop-rule status</dt><dd>${record.stopCandidateFamily ? "Candidate family stopped by semantic/evidence failure" : "No stop triggered by this recorded comparison"}</dd></div>
        <div><dt>Resource use</dt><dd class="mono">${escapeHtml(JSON.stringify(comparison.resourceUse || null))}</dd></div>
        <div><dt>Gate blockers</dt><dd>${escapeHtml((record.blockers || []).map(humanizeSlug).join(" · ") || "None; separate external approval is still mandatory")}</dd></div>
        <div><dt>Promotion</dt><dd>Not promoted by this comparison. The capability register is unchanged.</dd></div>
      </dl>
    </details>`;
  }).join("")}</div>`;
}

function renderValidationLab(lab = {}, options = {}) {
  const summary = lab.summary || {};
  const manifests = lab.manifests || [];
  return `<section class="studio-library" id="validation-lab" aria-labelledby="validation-lab-heading">
    <div class="studio-section-heading"><div><p class="page-kicker">Controlled research</p><h3 id="validation-lab-heading">Benchmark Builder and Human Truth</h3><p class="muted small">Build genuinely unseen sets, quiz a manager with direct chronological quotes, and freeze labels before any future candidate inference. This is not an operational human-review queue.</p></div>${badge("benchmark only", "notice")}</div>
    ${lab.readError ? `<div class="callout danger"><strong>Validation Lab is unavailable.</strong> ${escapeHtml(lab.readError)} No benchmark mutation is permitted until the store is repaired.</div>` : `
      <div class="metrics">
        ${metricCard("Manifests", formatNumber(summary.manifests), `${formatNumber(summary.frozen)} frozen`, "info")}
        ${metricCard("Unseen examples", formatNumber(summary.examples), "Transcript hashes pinned", "notice")}
        ${metricCard("Human labels", formatNumber(summary.confirmedLabels), "Exact evidence required", "info")}
        ${metricCard("Promoted candidates", "0", "External approval still required after a pass", "neutral")}
      </div>
      <details class="benchmark-create"><summary>Create an unseen benchmark manifest</summary>
        <form class="studio-form" method="post" action="/evaluation-studio/validation-lab/manifests">
          <label>Manifest name<input name="name" placeholder="Exact fact — smoke 1" /></label>
          <label>Partition<select name="partition"><option value="smoke">Smoke (minimum 10)</option><option value="development">Development (minimum 50)</option><option value="promotion">Promotion (minimum 100)</option><option value="shadow">Shadow (minimum 25)</option></select></label>
          <label>Capability ID<input name="capabilityId" required placeholder="materially_different_candidate_exact_fact_v1" /></label>
          <label>Sample size<input name="sampleSize" type="number" min="1" max="1000" value="10" required /></label>
          <label class="studio-field-full">Exact fact<input name="exactFact" required placeholder="One closed decision only" /></label>
          <label class="studio-field-full">Research product use<input name="productUse" required value="research comparison only" /></label>
          <label>Minimum decision accuracy<input name="minimumDecisionAccuracy" type="number" min="0" max="1" step="0.01" value="0.95" /></label>
          <label>Minimum evidence integrity<input name="minimumEvidenceIntegrity" type="number" min="0" max="1" step="0.01" value="1" /></label>
          <label>Minimum supported coverage<input name="minimumCoverage" type="number" min="0" max="1" step="0.01" value="0.90" /></label>
          <label>Exact quotes per decision<input name="minimumExactQuotesPerDecision" type="number" min="1" max="10" value="1" /></label>
          <label>Maximum model jobs<input name="maximumJobs" type="number" min="0" value="0" /></label>
          <label>Maximum model attempts<input name="maximumAttempts" type="number" min="0" value="0" /></label>
          <label>Maximum retries<input name="maximumRetries" type="number" min="0" value="0" /></label>
          <label>Maximum model tokens<input name="maximumTokens" type="number" min="0" value="0" /></label>
          <label>Maximum execution milliseconds<input name="maximumExecutionMs" type="number" min="0" value="0" /></label>
          <span class="muted small studio-field-full">Zero budgets are valid only for a deterministic rule. A future model manifest must predeclare positive job, attempt, token, and execution-time caps before labels are frozen.</span>
          <button type="submit">Create unseen draft</button>
          <span class="muted small">Selection is deterministic and excludes every current/historical Studio result, every prior manifest, and call IDs found in runtime audit artifacts.</span>
        </form>
      </details>
      <div class="validation-manifest-list">${manifests.map((manifest) => renderValidationManifest(manifest, options.selectedManifestId)).join("") || `<div class="empty"><strong>No benchmark manifest exists.</strong><br />Create a smoke set first. Ten calls can test workflow only; they cannot promote a capability.</div>`}</div>`}
    <section class="candidate-gate-summary"><div class="studio-section-heading"><div><p class="page-kicker">Promotion boundary</p><h4>Candidate comparison and strict unseen test</h4></div>${badge("no candidate authorised", "warning")}</div>
      <p class="muted small">A future deterministic rule or materially different model is compared field by field for false positives, false negatives, abstentions, unsupported cases, evidence integrity, critical errors, category accuracy and resource use. Promotion requires at least 100 frozen genuinely unseen examples, predeclared thresholds and budget, zero critical errors, a passing stop-rule check, and separate external approval.</p>
      <div class="callout warning"><strong>No inference control exists here.</strong> Freezing benchmark truth does not submit a job, consume tokens, or promote anything.</div>
      ${renderCandidateComparisons(lab.candidateComparisons || [])}
    </section>
  </section>`;
}

function renderEvaluationStudio(persistence = {}, data = {}, options = {}) {
  const studio = options.studioView || persistence.evaluationStudio || {};
  const capabilityPolicy = options.capabilityPolicy || {};
  const summary = studio.summary || {};
  const knowledgebaseRows = (studio.knowledgebaseEntries || []).slice(0, 50);
  const templateRows = (studio.evaluationTemplates || []).slice(0, 50);
  const runRows = (studio.evaluationRuns || []).slice(0, 8);
  const activeRunStatuses = new Set(["queued", "running", "partially_completed"]);
  const evaluationRunHasPendingJobs = (run) => Number(run.queuedJobCount || 0) > 0
    || (run.queuedJobs || []).some((job) => {
      if (!String(job.jobId || job.job_id || "").trim()) return false;
      const status = String(job.status || "queued").toLowerCase();
      if (["completed", "succeeded", "success", "cancelled", "canceled"].includes(status)) return false;
      if (["failed", "error"].includes(status)) return !job.terminalHandledAt;
      return true;
    });
  const activeRunSnapshot = (studio.evaluationRuns || [])
    .filter((run) => activeRunStatuses.has(String(run.status || "").toLowerCase()))
    .filter(evaluationRunHasPendingJobs)
    .map((run) => [String(run.id || ""), [
      String(run.status || "queued"),
      Number(run.completedCallCount || 0),
      Number(run.failedCallCount || 0),
      Number(run.queuedJobCount || 0),
      String(run.updatedAt || "")
    ].join("|")]);
  const resultRows = studio.evaluationResults || [];
  const evidenceRows = (studio.evidenceQueue || []).slice(0, 8);
  const reportRollups = studio.reportRollups || {};
  const foundationReport = studio.foundationReport || {};
  const offerAcceptanceReport = studio.offerAcceptanceReport || {};
  const reportTotals = reportRollups.totals || {};
  const reportSignalRows = (reportRollups.signalRows || []).slice(0, 8);
  const reportExampleRows = (reportRollups.priorityExamples || []).slice(0, 8);
  const defaultTemplateId = templateRows.find((template) => template.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL)?.id
    || templateRows[0]?.id
    || "";
  const templateOptions = templateRows.map((template) => `<option value="${escapeHtml(template.id)}"${template.id === defaultTemplateId ? " selected" : ""}>${escapeHtml(template.name)} (${escapeHtml(template.evaluationGoal || "goal")})${template.evaluationGoal === SPIEL_QUALITY_GOAL ? " - Calibration only" : ""}</option>`).join("");
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
  const advancedResultFiltersActive = [
    "runId", "reportSignal",
    "resultStatus", "recordClassification", "recordReason", "operationalClassification", "allegationAssessment",
    "recommendation", "foundationOpportunityStatus", "foundationMeasurementEligibility", "foundationEfficiencyStatus",
    "foundationCalledOnBehalfOf", "foundationFollowUpTiming", "foundationSpecialistRoute", "foundationOfferPresented", "foundationQuotedAmountAvailable",
    "spielCallHandlingQuality", "spielSpielQuality", "spielCallPurpose", "spielPrimaryReasonCode",
    "confidenceBand", "evidenceAvailability", "reviewRecommended"
  ].some((key) => String(resultFilters[key] || "").trim());
  const resultQuery = studio.resultQuery || {};
  const allCalls = data.drilldownRows || [];
  const availableCalls = allCalls.filter((call) => String(call.transcript || "").trim());
  const salespersonOptions = Array.from(new Set(availableCalls.map((call) => call.salesperson).filter(Boolean))).sort();
  const sourceOptions = Array.from(new Set(availableCalls.map((call) => call.source).filter(Boolean))).sort();
  const contactOptions = Array.from(new Set(availableCalls.map((call) => call.contactClassification).filter(Boolean))).sort();
  const qualityOptions = Array.from(new Set(availableCalls.map((call) => call.transcriptQuality).filter(Boolean))).sort();
  const callLookup = new Map(allCalls.map((call) => [String(call.callId || ""), call]));
  const withCallIdentity = (row) => {
    const call = callLookup.get(String(row?.callId || "")) || {};
    return {
      ...row,
      customerId: customerIdValue({ ...row, ...call }),
      callContext: call
    };
  };
  const evidenceDisplayRows = evidenceRows.map(withCallIdentity);
  const reportExampleDisplayRows = reportExampleRows.map(withCallIdentity);
  const runLookup = new Map((studio.evaluationRuns || []).map((run) => [String(run.id || ""), run]));
  const templateLookup = new Map(templateRows.map((template) => [String(template.id || ""), template]));
  const resultDisplayRows = resultRows.map((row) => {
    const run = runLookup.get(String(row.runId || "")) || {};
    const template = templateLookup.get(String(row.templateId || "")) || {};
    return {
      ...row,
      callContext: { customerId: row.customerId, ...(callLookup.get(String(row.callId || "")) || {}) },
      sharedFoundationContext: row.foundationContext || row.foundationAssessment || null,
      sharedOfferAcceptanceContext: row.offerAcceptanceContext || (row.acceptanceAssessment ? {
        sourceResultId: row.id || "",
        acceptanceAssessment: row.acceptanceAssessment,
        managerSummary: row.managerSummary,
        confidence: row.confidence,
        confidenceBand: row.confidenceBand,
        evidenceAvailability: row.evidenceAvailability,
        status: row.status,
        updatedAt: row.updatedAt || row.createdAt
      } : null),
      evaluationTypeLabel: run.templateSnapshot?.name || template.name || humanizeSlug(row.evaluationGoal || "evaluation"),
      evaluationRunType: run.runType || "stored_result"
    };
  });
  const resultCallGroups = groupEvaluationDisplayRows(resultDisplayRows);
  const matchingCallCount = Number.isFinite(Number(resultQuery.matchingCalls))
    ? Number(resultQuery.matchingCalls)
    : new Set(resultRows.map((row) => String(row.callId || "unknown"))).size;
  const resultPageUrl = (offset) => {
    const query = new URLSearchParams();
    Object.entries(resultFilters).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined && key !== "offset") query.set(key, value);
    });
    query.set("offset", String(Math.max(0, offset || 0)));
    return `/evaluation-studio?${query.toString()}#results`;
  };
  const seededFrom = (summary.seededFrom || []).join(", ") || "Neuron and LatentPulse patterns";
  const overnight = studio.overnightAutomation || {};
  const overnightRuntime = overnight.runtime || {};
  const overnightStatus = humanizeSlug(overnightRuntime.status || (overnight.installed ? "scheduled" : "not installed"));
  const overnightTone = overnightRuntime.status === "complete"
    ? "success"
    : overnightRuntime.status === "halted_on_quality_gate" || overnightRuntime.status === "retrying_after_error"
      ? "danger"
      : overnightRuntime.status === "processing" || overnightRuntime.status === "submitted"
        ? "notice"
        : "neutral";
  return `<section class="panel" id="evaluation-studio" data-operational-model-use-permitted="${capabilityPolicy.liveSubmissionPermitted ? "true" : "false"}">
    <div class="panel-header">
      <div>
        <h2>Evaluation Trust and Validation Studio</h2>
        <p class="muted small">See what is trusted, build benchmark truth without inference, inspect deterministic evidence, and audit quarantined historical model work.</p>
      </div>
      ${badge(capabilityPolicy.liveSubmissionPermitted ? "Promoted capability available" : "AI quarantined — research only", capabilityPolicy.liveSubmissionPermitted ? "success" : "warning")}
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Knowledgebase", formatNumber(summary.activeKnowledgebaseEntries || 0), `${formatNumber(summary.approvedKnowledgebaseEntries || 0)} included, ${formatNumber(summary.pendingApprovalKnowledgebaseEntries || 0)} drafts`, "info", "#knowledgebase")}
        ${metricCard("Stored templates", formatNumber(summary.activeTemplates || 0), "Research configuration only", "info", "#templates")}
        ${metricCard("Historical runs", formatNumber(summary.runs || 0), "No live run controls", "neutral", "#runs")}
        ${metricCard("Research results", formatNumber(summary.researchOnlyResults ?? summary.results ?? 0), "Excluded from operations", "warn", evaluationResultsUrl())}
        ${metricCard("Operational AI results", formatNumber(summary.operationalResults || 0), "Requires exact promotion and provenance", summary.operationalResults ? "good" : "neutral", evaluationResultsUrl())}
        ${metricCard("Evidence gaps", formatNumber(summary.evidenceUnavailableResults || 0), "Historical model audit detail", "neutral", evaluationResultsUrl({ evidenceAvailability: "unavailable" }))}
      </div>

      ${!capabilityPolicy.liveSubmissionPermitted ? `<div class="callout warning"><strong>Capability quarantine is active.</strong> Healthy infrastructure, valid JSON, exact quotes, and passing tests do not establish semantic accuracy. No model job can be started from this application.</div>` : ""}

      ${renderCapabilityCatalog(options.capabilityCatalog || {})}

      ${renderVoicemailInboundLane(options.voicemailInbound || {})}

      ${renderVoicemailPilotAttribution(options.voicemailPilot || {})}

      ${renderValidationLab(options.validationLab || {}, { selectedManifestId: options.selectedManifestId || "" })}

      <section class="studio-library historical-boundary" id="historical-research" aria-labelledby="historical-research-heading"><div class="studio-section-heading"><div><p class="page-kicker">Immutable archive</p><h3 id="historical-research-heading">Historical Research — read only, authority none</h3><p class="muted small">Everything below preserves old prompts, templates, runs and outputs for audit. It cannot be edited, submitted, resumed, harvested, reconciled, routed, or used in an operational denominator.</p></div>${badge("authority: none", "warning")}</div></section>

      ${capabilityPolicy.liveSubmissionPermitted ? `<section class="studio-library" id="overnight-evaluations" aria-labelledby="overnight-evaluations-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Automatic backlog processing</p>
            <h3 id="overnight-evaluations-heading">Overnight evaluations</h3>
            <p class="muted small">Runs ${escapeHtml(overnight.schedule || "22:00-06:00 Australia/Melbourne")}; pauses before the next call when you use the PC or available memory falls below ${escapeHtml(overnight.memoryFloorGb ?? 4)} GB.</p>
          </div>
          ${badge(overnightStatus, overnightTone)}
        </div>
        <div class="result-answer-list">
          <div><dt>Processing</dt><dd>${escapeHtml(overnight.behavior || "One Foundation batch and its recommended specialists at a time.")}</dd></div>
          <div><dt>Safety boundary</dt><dd>Next batch starts only below 2% Foundation and specialist failure rates, with specialist routing complete.</dd></div>
          <div><dt>New batch cutoff</dt><dd>${escapeHtml(overnight.submissionCutoff || "04:30 Australia/Melbourne")} so the current cycle has time to finish before 06:00.</dd></div>
          <div><dt>Last update</dt><dd>${escapeHtml(overnightRuntime.updatedAt ? formatDateTime(overnightRuntime.updatedAt) : "Scheduled for the next overnight window")}</dd></div>
          <div><dt>Current reason</dt><dd>${escapeHtml(overnightRuntime.reason || overnightRuntime.error || "Waiting for the overnight window")}</dd></div>
        </div>
      </section>` : `<section class="studio-library" id="overnight-evaluations" aria-labelledby="overnight-evaluations-heading"><div class="studio-section-heading"><div><p class="page-kicker">Automatic processing</p><h3 id="overnight-evaluations-heading">Overnight evaluations disabled</h3><p class="muted small">The scheduled Foundation and specialist backlog is not authorised. Structural worker health cannot reopen it.</p></div>${badge("disabled", "warning")}</div></section>`}

      <section class="studio-library" id="knowledgebase" aria-labelledby="knowledgebase-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Reference material</p>
            <h3 id="knowledgebase-heading">Knowledgebase</h3>
            <p class="muted small">Historical reference material preserved with old research. While quarantine is active, none of it can be sent to a model.</p>
          </div>
          <span class="muted small">${formatNumber(summary.approvedKnowledgebaseEntries || 0)} included / ${formatNumber(summary.pendingApprovalKnowledgebaseEntries || 0)} drafts</span>
        </div>
          ${capabilityPolicy.liveSubmissionPermitted ? `<details class="studio-create">
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
          </details>` : ""}
          <div class="studio-library-list">
            ${knowledgebaseRows.length ? knowledgebaseRows.map((row) => renderKnowledgebaseLibraryItem(row, { editable: capabilityPolicy.liveSubmissionPermitted })).join("") : `<div class="empty">No knowledgebase entries are available.</div>`}
          </div>
      </section>

      <section class="studio-library" id="templates" aria-labelledby="templates-heading">
        <div class="studio-section-heading">
          <div>
            <p class="page-kicker">Evaluation goals</p>
            <h3 id="templates-heading">Evaluation templates</h3>
            <p class="muted small">Historical prompt and schema artifacts. They are not active evaluators and cannot be submitted while unpromoted.</p>
          </div>
          <span class="muted small">${formatNumber(summary.activeTemplates || 0)} active templates</span>
        </div>
          ${capabilityPolicy.liveSubmissionPermitted ? `<details class="studio-create">
            <summary>Create evaluation template</summary>
          <form class="studio-form" method="post" action="/evaluation-studio/templates">
            <input name="name" placeholder="Template name" required />
            <input name="evaluationGoal" list="evaluation-goal-options" placeholder="Evaluation goal, e.g. objection_handling" value="callback_opportunity" required />
            <datalist id="evaluation-goal-options">${goalDatalist}</datalist>
            <input name="tags" placeholder="Tags, comma separated" />
            <input name="knowledgebaseIds" placeholder="Knowledgebase IDs, comma separated (optional)" />
            <textarea name="instructions" placeholder="Prompt instructions" rows="5" required></textarea>
            <textarea name="outputSchema" rows="5">${escapeHtml(defaultSchema)}</textarea>
            <button type="submit">Save template</button>
          </form>
          </details>` : ""}
          <div class="studio-library-list">
            ${templateRows.length ? templateRows.map((row) => renderTemplateLibraryItem(row, { editable: capabilityPolicy.liveSubmissionPermitted })).join("") : `<div class="empty">No evaluation templates are available.</div>`}
          </div>
      </section>

      ${capabilityPolicy.liveSubmissionPermitted ? `<section class="studio-library" id="run-controls" aria-labelledby="run-controls-heading">
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
          <label class="studio-field studio-field-full"><span><input name="autoRouteSpecialists" type="checkbox" value="true" /> Automatically route Foundation results to separately promoted specialist evaluators</span><span class="muted small">Off by default. Every target capability must independently pass its exact promotion and provenance contract.</span></label>
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
      </section>` : `<section class="studio-library" id="run-controls" aria-labelledby="run-controls-heading">
        <div class="studio-section-heading">
          <div><p class="page-kicker">Evaluation quarantine</p><h3 id="run-controls-heading">No model evaluation is available</h3></div>
          ${badge("research only", "warning")}
        </div>
        <div class="notice-box"><strong>The model service is not the authority gate.</strong><p>No current evaluator has passed its frozen semantic promotion audit. Batch runs, one-call tests, automatic specialist routing, and custom-template inference are disabled. Historical templates and results remain below for transparent audit only.</p></div>
      </section>`}

      <h3 id="runs" class="section-anchor" style="margin-top: 16px;">Recent Evaluation Runs</h3>
      ${table([
        { label: "Run", render: (row) => `${hrefDataLink(String(row.id || "").slice(0, 18), evaluationResultsUrl({ runId: row.id }), `View results from run ${row.id}`)}<br /><span class="muted small">${escapeHtml(row.templateSnapshot?.name || row.templateId || "")}</span>` },
        { label: "Type", render: (row) => badge(String(row.runType || "batch").replace(/_/g, " "), row.runType === "prompt_test" ? "notice" : "neutral") },
        { label: "Status", render: (row) => `<span data-evaluation-run-id="${escapeHtml(row.id || "")}" data-evaluation-run-status="${escapeHtml(row.status || "queued")}" data-evaluation-run-has-pending-job="${evaluationRunHasPendingJobs(row) ? "true" : "false"}">${badge(String(row.status || "queued").replace(/_/g, " "), row.status === "failed" || row.status === "quarantined" ? "critical" : row.status === "running" ? "notice" : row.status === "completed" ? "success" : "neutral")}<br /><span class="muted small">${escapeHtml(row.quarantineReason || (row.resumeCount ? `${formatNumber(row.resumeCount)} resumes` : ""))}</span></span>` },
        { label: "Calls", render: (row) => `${formatNumber(row.plannedCallCount || 0)} planned<br /><span class="muted small">${aggregateResultLink(formatNumber(row.completedCallCount || 0), { runId: row.id }, `View ${row.completedCallCount || 0} classified results from this run`)} classified, ${formatNumber(row.queuedJobCount || 0)} queued, ${row.failedCallCount ? hrefDataLink(`${formatNumber(row.failedCallCount)} failed`, `#run-failures-${row.id}`, `Review ${row.failedCallCount} failures from this run`) : "0 failed"}</span>${renderEvaluationRunFailureSummary(row, callLookup)}` },
        { label: "Versions", render: (row) => `Template v${formatNumber(row.templateVersion || 1)}<br /><span class="muted small">${formatNumber((row.knowledgebaseSnapshot || []).length)} KB entries</span>` },
        { label: "Updated", render: (row) => `${formatDateTime(row.updatedAt || row.createdAt)}<br /><span class="muted small">${formatNumber((row.runHistory || []).length)} history events</span>` },
        { label: "Actions", render: (row) => renderEvaluationRunActions(row) }
      ], runRows, "No evaluation run has been queued yet.")}

      <h3 id="evidence" class="section-anchor" style="margin-top: 16px;">Historical Research Flags</h3>
      <p class="muted small" style="margin: 4px 0 10px;">These are model-generated research flags retained for audit. They are not review assignments or operational findings.</p>
      ${table([
        { label: "Call", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "Unknown")}</a><br /><span class="muted small">${escapeHtml(row.evaluationGoal || "evaluation")}</span>` },
        { label: "Customer ID", render: (row) => customerIdCell(row) },
        { label: "Archive status", render: (row) => `${badge(String(row.status || "stored").replace(/_/g, " "), row.status === "failed" ? "critical" : "neutral")}<br />${badge("Research only", "warning")}` },
        { label: "Confidence", render: (row) => `${escapeHtml(confidenceBandLabel(row.confidenceBand))}<br /><span class="muted small">Evidence-strength band; numeric model value is uncalibrated</span>` },
        { label: "Evidence", render: (row) => {
          const firstFinding = (row.findings || [])[0] || {};
          return `<span class="evidence">${escapeHtml(firstFinding.evidence || row.managerSummary || "Evidence unavailable")}</span><span class="muted small">${escapeHtml(String(row.evidenceAvailability || "unavailable").replace(/_/g, " "))}</span>`;
        } },
        { label: "Historical flag", render: (row) => row.managerReviewRecommended ? badge("Archived model flag", "warning") : badge("None", "neutral") },
        { label: "Open", render: (row) => `<a class="filter-link" href="/calls/${encodeURIComponent(row.callId || "")}">Transcript proof</a>` }
      ], evidenceDisplayRows, "No archived model flags are present.")}

      ${capabilityPolicy.operationalConsumptionPermitted ? `<h3 id="rollups" class="section-anchor" style="margin-top: 16px;">Operational Evaluation Rollups</h3>
      <p class="muted small" style="margin: 4px 0 10px;">Unpromoted historical results are excluded. These counts remain zero until an exact semantic capability and its provenance contract are promoted.</p>
      <div class="metrics">
        ${metricCard("Operationally evaluated calls", formatNumber(reportTotals.evaluatedCalls || 0), `${formatNumber(reportTotals.researchOnlyResultsExcluded || 0)} research results excluded`, "info", evaluationResultsUrl())}
        ${metricCard("Callback opportunities", formatNumber(reportTotals.callbackOpportunities || 0), "Evidence-backed follow-up leakage review signals", "warn", evaluationResultsUrl({ reportSignal: "callbackOpportunities" }))}
        ${metricCard("Possible waste indicators", formatNumber(reportTotals.possibleWasteIndicators || 0), "Lead utilisation issue signals requiring proof review", "risk", evaluationResultsUrl({ reportSignal: "possibleWasteIndicators" }))}
        ${metricCard("Coaching opportunities", formatNumber(reportTotals.coachingOpportunities || 0), "Procedure or call-stage coaching signals", "notice", evaluationResultsUrl({ reportSignal: "coachingOpportunities" }))}
      </div>
      ${table([
        { label: "Signal", render: (row) => aggregateResultLink(row.label || row.signal || "Signal", { reportSignal: row.signal }, `View results contributing to ${row.label || row.signal}`) },
        { label: "Count", render: (row) => aggregateResultLink(formatNumber(row.count || 0), { reportSignal: row.signal }, `View results contributing to ${row.count || 0} ${row.label || row.signal} findings`) },
        { label: "Use", render: (row) => `<span class="muted small">${escapeHtml(row.signal === "possibleWasteIndicators" ? "Review as possible waste indicators only." : row.signal === "coachingOpportunities" ? "Use as coaching opportunities." : "Use as evidence-backed signals.")}</span>` }
      ], reportSignalRows, "No report-safe Evaluation Studio rollups yet.")}
      ${table([
        { label: "Call", render: (row) => `<a class="data-link mono" href="/calls/${encodeURIComponent(row.callId || "")}">${escapeHtml(row.callId || "Unknown")}</a><br /><span class="muted small">${escapeHtml(row.signalLabel || "signal")}</span>` },
        { label: "Customer ID", render: (row) => customerIdCell(row) },
        { label: "Finding", render: (row) => `${escapeHtml(row.field || "finding")}<br /><span class="muted small">${escapeHtml(row.value || "Not supplied")}</span>` },
        { label: "Confidence", render: (row) => `${escapeHtml(confidenceBandLabel(row.confidenceBand))}<br /><span class="muted small">Evidence-strength band; numeric model value is uncalibrated</span>` },
        { label: "Proof", render: (row) => `<span class="evidence">${escapeHtml(row.evidence || "Evidence unavailable")}</span>` }
      ], reportExampleDisplayRows, "No priority report examples yet.")}

      ${renderFoundationReport(foundationReport)}

      ${renderOfferAcceptanceReport(offerAcceptanceReport)}` : `<section class="studio-library" id="rollups" aria-labelledby="operational-reporting-unavailable-heading">
        <div class="studio-section-heading"><div><p class="page-kicker">Trust boundary</p><h3 id="operational-reporting-unavailable-heading">Operational AI reporting is unavailable</h3><p class="muted small">No evaluator has passed the frozen semantic promotion and immutable provenance contract. Historical outputs are excluded from every rate, denominator, customer action, staff judgement, and management recommendation.</p></div>${badge("0 promoted", "warning")}</div>
        <div class="metrics">${metricCard("Operationally evaluated calls", "0", `${formatNumber(reportTotals.researchOnlyResultsExcluded || 0)} research results excluded`, "neutral")}${metricCard("AI-derived actions", "0", "No promoted capability", "neutral")}</div>
      </section>`}

      <section class="studio-library" id="results" aria-labelledby="results-heading">
      <div class="studio-section-heading" data-evaluation-studio-progress data-active-runs="${escapeHtml(JSON.stringify(activeRunSnapshot))}">
        <div><p class="page-kicker">Research archive</p><h3 id="results-heading">Historical Model Outputs Grouped by Call</h3><p class="muted small">These records preserve what the model returned. None is a current customer outcome, staff judgement, action, or trusted score unless the exact capability and immutable provenance are promoted.</p></div>
        <div class="studio-result-progress">
          ${hrefDataLink(`${formatNumber(matchingCallCount)} calls · ${formatNumber(resultQuery.matchingResults || resultRows.length)} evaluations`, resultPageUrl(0), "Open the first page of matching evaluated calls")}
          <span class="muted small">${activeRunSnapshot.length ? "Live updates every 5 seconds while evaluations run" : "Current stored results"}</span>
        </div>
      </div>
      ${(resultFilters.runId || resultFilters.reportSignal) ? `<div class="active-filters" aria-label="Aggregate drill-down filters">
        ${resultFilters.runId ? `<span class="filter-chip"><span>Run: ${escapeHtml(String(resultFilters.runId).slice(0, 24))}</span></span><input form="evaluation-result-filters" type="hidden" name="runId" value="${escapeHtml(resultFilters.runId)}" />` : ""}
        ${resultFilters.reportSignal ? `<span class="filter-chip"><span>Signal: ${escapeHtml(humanizeSlug(resultFilters.reportSignal))}</span></span><input form="evaluation-result-filters" type="hidden" name="reportSignal" value="${escapeHtml(resultFilters.reportSignal)}" />` : ""}
      </div>` : ""}
      <form id="evaluation-result-filters" class="result-filter-form" method="get" action="/evaluation-studio">
        <label>Goal<select name="evaluationGoal"><option value="">All goals</option>${Array.from(EVALUATION_GOALS || []).sort().map((value) => `<option value="${escapeHtml(value)}" ${selectedOption(resultFilters.evaluationGoal, value)}>${escapeHtml(humanizeSlug(value))}</option>`).join("")}</select></label>
        <label>Offer outcome<select name="acceptanceClassification"><option value="">All offer outcomes</option>${[
          ["customer_accepted_offer", "Model claimed accepted offer"],
          ["interested_follow_up_only", "Model claimed follow-up interest"],
          ["no_sale_signal", "Model claimed no sale signal"]
        ].map(([value, label]) => `<option value="${value}" ${selectedOption(resultFilters.acceptanceClassification, value)}>${escapeHtml(label)}</option>`).join("")}</select></label>
        <label>Salesperson<select name="salesperson"><option value="">All salespeople</option>${salespersonOptions.map((value) => `<option value="${escapeHtml(value)}" ${selectedOption(resultFilters.salesperson, value)}>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>Source<select name="customerImportSource"><option value="">All sources</option>${sourceOptions.map((value) => `<option value="${escapeHtml(value)}" ${selectedOption(resultFilters.customerImportSource, value)}>${escapeHtml(value)}</option>`).join("")}</select></label>
        <label>From call date<input name="dateFrom" type="date" value="${escapeHtml(resultFilters.dateFrom || "")}" /></label>
        <label>To call date<input name="dateTo" type="date" value="${escapeHtml(resultFilters.dateTo || "")}" /></label>
        <label>Calls per page<select name="limit">${[10,25,50,100].map((value) => `<option value="${value}" ${selectedOption(resultFilters.limit || "25", value)}>${value}</option>`).join("")}</select></label>
        <details class="result-filter-advanced"${advancedResultFiltersActive ? " open" : ""}>
          <summary>Other evaluator filters</summary>
          <div class="result-filter-advanced-grid">
            <label>Evidence status<select name="resultStatus"><option value="">All evidence statuses</option>${["usable", "insufficient_evidence", "failed"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.resultStatus, value)}>${value === "usable" ? "Evidence sufficient" : humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Record assessment<select name="recordClassification"><option value="">All assessments</option>${["supported_invalidity", "supported_operational_unusability", "contradictory_evidence", "no_supporting_evidence", "untestable", "insufficient_evidence"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.recordClassification, value)}>${escapeHtml(evaluationRecordAssessmentLabel(value))}</option>`).join("")}</select></label>
            <label>Reason<input name="recordReason" value="${escapeHtml(resultFilters.recordReason || "")}" placeholder="e.g. wrong_number" /></label>
            <label>Operational issue<select name="operationalClassification"><option value="">All operational findings</option>${["none", "do_not_contact", "unsafe_abusive"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.operationalClassification, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Allegation<select name="allegationAssessment"><option value="">All allegation states</option>${["absent", "supported", "contradicted", "untestable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.allegationAssessment, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Recommendation<input name="recommendation" value="${escapeHtml(resultFilters.recommendation || "")}" placeholder="e.g. retry_contact" /></label>
            <label>Foundation opportunity<select name="foundationOpportunityStatus"><option value="">All opportunity states</option>${[["actionable_or_accepted", "Actionable or accepted"], ["accepted", "Accepted candidate"], ["actionable", "Actionable"], ["possible", "Possible"], ["none", "None"]].map(([value, label]) => `<option value="${value}" ${selectedOption(resultFilters.foundationOpportunityStatus, value)}>${label}</option>`).join("")}</select></label>
            <label>Foundation measurement<select name="foundationMeasurementEligibility"><option value="">All measurement states</option>${["eligible", "ineligible", "unknown"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.foundationMeasurementEligibility, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Foundation efficiency<select name="foundationEfficiencyStatus"><option value="">All efficiency states</option>${["efficient_progression", "actionable_gap", "terminal_complete", "not_applicable", "unknown"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.foundationEfficiencyStatus, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Called on behalf of<input name="foundationCalledOnBehalfOf" value="${escapeHtml(resultFilters.foundationCalledOnBehalfOf || "")}" placeholder="Exact represented organisation" /></label>
            <label>Callback timing<input name="foundationFollowUpTiming" value="${escapeHtml(resultFilters.foundationFollowUpTiming || "")}" placeholder="Exact captured timing" /></label>
            <label>Foundation specialist route<select name="foundationSpecialistRoute"><option value="">All specialist routes</option>${["offer_acceptance_classification", "callback_opportunity", "objection_handling", "procedure_adherence", "lead_record_disposition_evidence_audit"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.foundationSpecialistRoute, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Offer presented<select name="foundationOfferPresented"><option value="">Either</option><option value="true" ${selectedOption(resultFilters.foundationOfferPresented, "true")}>Yes</option><option value="false" ${selectedOption(resultFilters.foundationOfferPresented, "false")}>No</option></select></label>
            <label>Quoted amount captured<select name="foundationQuotedAmountAvailable"><option value="">Either</option><option value="true" ${selectedOption(resultFilters.foundationQuotedAmountAvailable, "true")}>Yes</option><option value="false" ${selectedOption(resultFilters.foundationQuotedAmountAvailable, "false")}>No</option></select></label>
            <label>Call handling quality<select name="spielCallHandlingQuality"><option value="">All call-handling bands</option>${["strong", "acceptable", "needs_improvement", "poor", "not_assessable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.spielCallHandlingQuality, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Spiel quality<select name="spielSpielQuality"><option value="">All Spiel bands</option>${["strong", "acceptable", "needs_improvement", "poor", "not_assessable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.spielSpielQuality, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Call purpose<select name="spielCallPurpose"><option value="">All call purposes</option>${["new_offer", "renewal_offer", "payment_follow_up", "callback_follow_up", "administration", "complaint_or_opt_out", "terminal_no_contact", "other", "unknown"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.spielCallPurpose, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Spiel reason<input name="spielPrimaryReasonCode" value="${escapeHtml(resultFilters.spielPrimaryReasonCode || "")}" placeholder="e.g. payment_timing_policy_breach" /></label>
            <label>Manual check suggested<select name="reviewRecommended"><option value="">All results</option><option value="true" ${selectedOption(resultFilters.reviewRecommended, "true")}>Suggested only</option></select></label>
            <label>Confidence<select name="confidenceBand"><option value="">All confidence bands</option>${["high", "medium", "low", "unusable", "confidence_unavailable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.confidenceBand, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
            <label>Evidence<select name="evidenceAvailability"><option value="">All evidence states</option>${["available", "partial", "unavailable"].map((value) => `<option value="${value}" ${selectedOption(resultFilters.evidenceAvailability, value)}>${humanizeSlug(value)}</option>`).join("")}</select></label>
          </div>
        </details>
        <input type="hidden" name="offset" value="0" />
        <div class="result-filter-actions"><button type="submit">Apply filters</button><a class="filter-link" href="/evaluation-studio#results">Clear</a></div>
      </form>
      ${resultCallGroups.length
        ? `<div class="evaluation-call-group-list" role="list">${resultCallGroups.map(renderEvaluationCallGroup).join("")}</div>`
        : `<div class="empty">No results match these filters.</div>`}
      <nav class="result-pagination" aria-label="Evaluation result pages">
        ${resultQuery.previousOffset !== null && resultQuery.previousOffset !== undefined ? `<a class="filter-link" href="${escapeHtml(resultPageUrl(resultQuery.previousOffset))}">Previous</a>` : `<span class="muted small">Previous</span>`}
        <span class="muted small">Showing calls ${formatNumber((resultQuery.offset || 0) + (resultCallGroups.length ? 1 : 0))}-${formatNumber((resultQuery.offset || 0) + resultCallGroups.length)} of ${formatNumber(matchingCallCount)} · ${formatNumber(resultQuery.matchingResults || resultRows.length)} matching evaluations</span>
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
        <h2>Evaluation Research Archive</h2>
        <p class="muted small">Historical local-model outputs are visible for audit only. No current evaluator is promoted for operational use.</p>
      </div>
      <a class="filter-link" href="/evaluation-studio">Open Evaluation Studio</a>
    </div>
    <div class="panel-body">
      <div class="metrics">
        ${metricCard("Operational AI decisions", formatNumber(reportTotals.evaluatedCalls || 0), "Zero until an exact capability is promoted", "neutral", "/evaluation-studio#rollups")}
        ${metricCard("Research outputs", formatNumber(summary.researchOnlyResults || summary.results || 0), "Quarantined and excluded from operations", "warning", "/evaluation-studio#results")}
        ${metricCard("Promoted capabilities", summary.operationalModelUsePermitted ? "Available" : "0", "Capability register controls this boundary", summary.operationalModelUsePermitted ? "success" : "neutral", "/evaluation-studio")}
      </div>
      <p class="muted small" style="margin-top: 12px;">Research outputs never enter denominators, rankings, coaching, customer actions, CRM actions, compliance, finance, or automatic routing.</p>
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
        const foundationReport = document.getElementById("foundation-report");
        const offerReport = document.getElementById("offer-acceptance-report");
        const runsHeading = document.getElementById("runs");
        const evidenceHeading = document.getElementById("evidence");
        const rollupsHeading = document.getElementById("rollups");
        const runsGroup = runsHeading ? [runsHeading, runsHeading.nextElementSibling].filter(Boolean) : [];
        const evidenceGroup = evidenceHeading
          ? [evidenceHeading, evidenceHeading.nextElementSibling, evidenceHeading.nextElementSibling?.nextElementSibling].filter(Boolean)
          : [];
        const rollupsGroup = [];
        for (let node = rollupsHeading; node && node !== foundationReport && node !== offerReport && node !== results; node = node.nextElementSibling) rollupsGroup.push(node);
        if (panelBody && runControls && metricGrid) {
          const operationalModelUsePermitted = document.getElementById("evaluation-studio")?.dataset.operationalModelUsePermitted === "true";
          if (operationalModelUsePermitted) {
            panelBody.insertBefore(runControls, metricGrid);
            if (foundationReport) metricGrid.after(foundationReport);
            if (offerReport) (foundationReport || metricGrid).after(offerReport);
            if (results) (offerReport || foundationReport || metricGrid).after(results);
            if (results && runsGroup.length) results.after(...runsGroup);
            if (runsGroup.length && evidenceGroup.length) runsGroup.at(-1).after(...evidenceGroup);
            if (evidenceGroup.length && rollupsGroup.length) evidenceGroup.at(-1).after(...rollupsGroup);
          } else {
            const quarantineCallout = panelBody.querySelector(":scope > .callout");
            if (quarantineCallout) quarantineCallout.before(runControls);
          }
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
        const progressNode = document.querySelector("[data-evaluation-studio-progress]");
        const activeStatuses = new Set(["queued", "running", "partially_completed"]);
        const stateKey = "sales-dashboard-evaluation-studio-refresh-state.v1";
        const pageKey = window.location.pathname + window.location.search;
        const trackedForms = () => Array.from(document.querySelectorAll("[data-evaluation-batch-form], form[action='/evaluation-studio/prompt-tests'], #evaluation-result-filters"));
        const restoreRefreshState = () => {
          try {
            const saved = JSON.parse(window.sessionStorage.getItem(stateKey) || "null");
            if (!saved || saved.pageKey !== pageKey) return;
            window.sessionStorage.removeItem(stateKey);
            trackedForms().forEach((form, formIndex) => {
              const controls = saved.formState?.[formIndex] || [];
              Array.from(form.elements || []).forEach((control, controlIndex) => {
                const stored = controls[controlIndex];
                if (!stored || !control.name || ["file", "submit", "button"].includes(String(control.type || "").toLowerCase())) return;
                if (["checkbox", "radio"].includes(String(control.type || "").toLowerCase())) control.checked = Boolean(stored.checked);
                else control.value = stored.value ?? "";
              });
            });
            (saved.openCallIds || []).forEach((callId) => {
              const group = Array.from(document.querySelectorAll(".evaluation-call-group"))
                .find((item) => item.getAttribute("data-call-id") === String(callId));
              const details = group ? group.querySelector("details") : null;
              if (details) details.open = true;
            });
            window.requestAnimationFrame(() => window.scrollTo(Number(saved.scrollX || 0), Number(saved.scrollY || 0)));
          } catch (error) {
            try { window.sessionStorage.removeItem(stateKey); } catch (storageError) { /* Storage is optional. */ }
          }
        };
        const preserveRefreshState = () => {
          try {
            const openCallIds = Array.from(document.querySelectorAll(".evaluation-call-group details[open]"))
              .map((details) => details.closest(".evaluation-call-group")?.getAttribute("data-call-id"))
              .filter(Boolean);
            const formState = trackedForms().map((form) => Array.from(form.elements || []).map((control) => ({
              value: control.value,
              checked: Boolean(control.checked)
            })));
            window.sessionStorage.setItem(stateKey, JSON.stringify({
              pageKey,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              openCallIds,
              formState
            }));
          } catch (error) {
            // Refresh can continue when session storage is unavailable.
          }
        };
        const progressSignature = (run) => [
          String(run.status || "queued"),
          Number(run.completedCallCount || 0),
          Number(run.failedCallCount || 0),
          Number(run.queuedJobCount || 0),
          String(run.updatedAt || "")
        ].join("|");
        restoreRefreshState();
        let activeRuns = new Map();
        try {
          activeRuns = new Map(JSON.parse(progressNode?.getAttribute("data-active-runs") || "[]"));
        } catch (error) {
          activeRuns = new Map();
        }
        if (!activeRuns.size) return;
        let polling = false;
        const poll = async () => {
          if (polling) return;
          polling = true;
          try {
            const response = await fetch("/api/evaluation-studio/progress?currentOnly=true", { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json();
            const nextRuns = new Map((payload.evaluationRuns || [])
              .filter((run) => run.hasPendingJobs && activeStatuses.has(String(run.status || "").toLowerCase()))
              .map((run) => [String(run.id || ""), progressSignature(run)]));
            const changed = activeRuns.size !== nextRuns.size
              || Array.from(activeRuns.entries()).some(([id, signature]) => nextRuns.get(id) !== signature);
            if (changed) {
              preserveRefreshState();
              window.location.reload();
            }
          } catch (error) {
            // A temporary status check failure should not interrupt the workspace.
          } finally {
            polling = false;
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
  const operationalModelUsePermitted = persistence.evaluationStudio?.summary?.operationalModelUsePermitted === true;
  const segmentLabel = businessSegmentLabel(activeSegment);
  const titleDetail = hasAnyData
    ? operationalModelUsePermitted
      ? `${formatNumber(data.totals.uniqueCalls || 0)} active calls available for promoted transcript evaluation`
      : `${formatNumber(data.totals.uniqueCalls || 0)} active calls; model evaluation is quarantined`
    : "Load call data to inspect the research archive.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Evaluation Studio - Sales Dashboard</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      ${COLUMN_HELP_STYLES}
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
        overflow-x: hidden;
        color: var(--foreground);
        background: var(--background);
        font-family: "Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      main {
        width: min(1440px, calc(100vw - 40px));
        min-width: 0;
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
        text-decoration: none;
      }
      .success { color: var(--success); background: rgba(52, 211, 153, 0.09); border-color: rgba(52, 211, 153, 0.22); }
      .warning { color: var(--warning); background: rgba(245, 158, 11, 0.10); border-color: rgba(245, 158, 11, 0.24); }
      .critical, .danger { color: var(--danger); background: rgba(248, 113, 113, 0.10); border-color: rgba(248, 113, 113, 0.24); }
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
      a.metric:hover { border-color: rgba(86, 214, 229, 0.62); transform: translateY(-1px); }
      .aggregate-drill-link {
        color: var(--accent);
        font-weight: 800;
        text-decoration: none;
        border-bottom: 1px solid rgba(86, 214, 229, 0.34);
      }
      .aggregate-drill-link:hover, .aggregate-drill-link:focus-visible { color: var(--foreground); border-color: var(--accent); }
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
      .studio-field input[type="checkbox"] { width: auto; min-width: auto; margin-right: 7px; }
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
      .result-filter-advanced { grid-column: 1 / -1; border: 1px solid var(--border-subtle); border-radius: 6px; background: var(--surface); }
      .result-filter-advanced > summary { padding: 9px 10px; color: var(--accent); font-size: 12px; font-weight: 700; }
      .result-filter-advanced-grid { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 9px; padding: 0 10px 10px; }
      .result-pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
      }
      .evaluation-result-list { display: grid; gap: 12px; min-width: 0; }
      .evaluation-call-group-list { display: grid; gap: 14px; min-width: 0; }
      .evaluation-call-group {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 9px;
        background: var(--surface);
        overflow: hidden;
      }
      .evaluation-call-group-header {
        display: grid;
        grid-template-columns: minmax(210px, 0.85fr) minmax(260px, 1.45fr) auto;
        gap: 16px;
        align-items: start;
        padding: 16px;
      }
      .evaluation-call-identity, .evaluation-call-current-outcome, .evaluation-call-count { display: grid; gap: 6px; min-width: 0; }
      .evaluation-call-count { justify-items: end; }
      .evaluation-call-summary { display: grid; gap: 7px; padding: 13px 16px; border-top: 1px solid var(--border-subtle); background: var(--surface-elevated); }
      .evaluation-call-summary p { color: var(--foreground); font-size: 13px; line-height: 1.5; }
      .evaluation-call-evaluations { border-top: 1px solid var(--border-subtle); }
      .evaluation-call-evaluations > summary { color: var(--accent); font-size: 13px; }
      .grouped-results { padding: 0 14px 14px; }
      .evaluation-result-card[data-grouped="true"] { background: var(--surface-elevated); box-shadow: none; }
      .evaluation-result-card[data-grouped="true"] .evaluation-result-card-header { grid-template-columns: minmax(0, 1fr) auto; }
      .evaluation-result-card[data-grouped="true"] .evaluation-result-card-header > div:first-child { display: none; }
      .evaluation-result-card {
        min-width: 0;
        padding: 15px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface);
      }
      .evaluation-result-card-header {
        display: grid;
        grid-template-columns: minmax(190px, 0.8fr) minmax(220px, 1.2fr) auto;
        gap: 16px;
        align-items: start;
        padding-bottom: 13px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .evaluation-result-card-header > *, .evaluation-result-facts > * { min-width: 0; }
      .evaluation-result-type, .evaluation-result-outcome, .evaluation-result-card-header > div { display: grid; gap: 5px; }
      .evaluation-result-proof-link { align-self: start; white-space: nowrap; }
      .evaluation-result-call { display: inline-block; width: max-content; margin: 4px 0 5px; }
      .result-card-label {
        display: block;
        color: var(--muted-foreground);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .evaluation-result-facts {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        padding: 13px 0;
        border-bottom: 1px solid var(--border-subtle);
      }
      .evaluation-result-facts > div { display: grid; align-content: start; gap: 6px; }
      .evaluation-result-facts strong, .evaluation-result-explanation { overflow-wrap: anywhere; }
      .evaluation-result-explanation { display: grid; gap: 6px; padding: 13px 0; }
      .evaluation-result-explanation .evidence { max-width: none; }
      .evaluation-result-updated { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding-top: 2px; }
      .evaluation-result-card .result-details { width: 100%; min-width: 0; margin-top: 11px; }
      .evaluation-result-card .result-decision, .evaluation-result-card .result-answer-list { width: 100%; min-width: 0; max-width: none; }
      .evaluation-result-card .result-proof, .evaluation-result-card .result-evidence-list { max-width: none; }
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
      .run-failure-details summary { margin-top: 5px; color: var(--warning); font-size: 11px; }
      .run-failure-details .result-evidence-list { min-width: 280px; margin: 6px 0 0; }
      .offer-acceptance-report { border-color: rgba(52, 211, 153, 0.4); }
      .offer-acceptance-metrics { margin-top: 14px; }
      .offer-failure-summary { margin-top: 12px; }
      .offer-breakdown-grid { display: grid; gap: 18px; margin-top: 18px; }
      .offer-breakdown-grid h4 { margin-bottom: 8px; color: var(--foreground); }
      .studio-create {
        margin: 10px 0 12px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .studio-create summary { padding: 10px 12px; color: var(--accent); }
      .studio-create .studio-form { padding: 0 12px 12px; }
      .benchmark-create { margin: 10px 0 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface); }
      .benchmark-create summary { padding: 10px 12px; color: var(--accent); }
      .benchmark-create .studio-form { padding: 0 12px 12px; }
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
      .studio-result-progress { display: grid; justify-items: end; gap: 5px; min-width: max-content; text-align: right; }
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
      .callout {
        margin-top: 12px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-left-width: 3px;
        border-radius: 8px;
        color: var(--muted-foreground);
        background: var(--surface);
        font-size: 13px;
        line-height: 1.5;
      }
      .callout strong { color: var(--foreground); }
      .callout.warning { border-left-color: var(--warning); }
      .callout.success { border-left-color: var(--success); }
      .callout.danger { border-left-color: var(--danger); }
      .historical-boundary { border-color: rgba(245, 158, 11, 0.38); background: rgba(245, 158, 11, 0.045); }
      .authority-legend {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0;
      }
      .authority-legend > div { padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface); }
      .authority-legend p { margin-top: 8px; line-height: 1.45; }
      .authority-chip { display: inline-flex; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
      .authority-chip.source { color: var(--accent); background: rgba(86, 214, 229, 0.1); }
      .authority-chip.derived { color: var(--success); background: rgba(52, 211, 153, 0.1); }
      .authority-chip.judgment { color: var(--warning); background: rgba(245, 158, 11, 0.1); }
      .capability-list, .validation-manifest-list, .benchmark-question-list { display: grid; gap: 10px; margin-top: 14px; }
      .capability-record, .validation-manifest, .benchmark-question { border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface); overflow: hidden; }
      .capability-record > summary, .validation-manifest > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; border: 0; }
      .capability-record > summary .mono { margin-right: auto; }
      .capability-record .result-answer-list, .validation-manifest .result-answer-list { max-width: none; min-width: 0; padding: 0 14px 14px; }
      .manifest-contract-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        padding: 0 14px 14px;
      }
      .manifest-contract-grid > div { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: 7px; }
      .manifest-contract-grid span { color: var(--muted-foreground); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .validation-manifest > .callout, .validation-manifest > .benchmark-batch-heading, .validation-manifest > .benchmark-question-list, .validation-manifest > .evaluation-submit-row, .validation-manifest > .compact-details { margin-left: 14px; margin-right: 14px; }
      .benchmark-batch-heading, .benchmark-question-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 16px; }
      .benchmark-question { padding: 14px; }
      .benchmark-question h4 { margin: 0; }
      .benchmark-question > p { margin: 12px 0; line-height: 1.5; }
      .benchmark-label-form { display: grid; gap: 12px; }
      .quote-timeline { display: grid; gap: 8px; max-height: 420px; margin: 0; padding: 12px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
      .quote-timeline legend { padding: 0 6px; color: var(--accent); font-size: 12px; font-weight: 800; }
      .quote-turn { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start; padding: 9px; border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }
      .quote-turn:hover { border-color: rgba(86, 214, 229, 0.46); }
      .quote-turn input { margin-top: 3px; }
      .quote-turn span { display: grid; gap: 5px; min-width: 0; }
      .quote-turn strong { color: var(--accent); font-size: 11px; }
      .quote-turn q { color: var(--foreground); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
      .benchmark-label-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .benchmark-label-grid label { display: grid; gap: 5px; color: var(--muted-foreground); font-size: 11px; font-weight: 750; }
      .benchmark-label-grid input, .benchmark-label-grid select, .benchmark-label-grid textarea { width: 100%; min-width: 0; padding: 8px 9px; border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); background: var(--surface-elevated); font: inherit; }
      .benchmark-label-grid input[type="checkbox"] { width: auto; min-width: auto; margin-right: 7px; }
      .candidate-gate-summary { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
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
        .result-filter-advanced-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .evaluation-result-card-header { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .evaluation-call-group-header { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .evaluation-call-count { grid-column: 1 / -1; justify-items: start; }
        .evaluation-result-proof-link { justify-self: start; }
        .evaluation-result-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .manifest-contract-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { width: min(100vw - 24px, 1440px); padding: 18px 0 30px; }
        .topbar, .panel-header { flex-direction: column; align-items: stretch; }
        .topbar .badge { width: 100%; white-space: normal; }
        .metrics, .studio-form { grid-template-columns: 1fr; }
        .authority-legend, .manifest-contract-grid, .benchmark-label-grid { grid-template-columns: 1fr; }
        .studio-library { padding: 12px; }
        .studio-section-heading { flex-direction: column; }
        .studio-result-progress { justify-items: start; min-width: 0; text-align: left; }
        .studio-library-item .compact-details .studio-form { grid-template-columns: 1fr; }
        .result-filter-form { grid-template-columns: 1fr; min-width: 0; }
        .result-filter-advanced-grid { grid-template-columns: 1fr; }
        .result-decision, .result-answer-list { min-width: 0; }
        .result-answer-list div { grid-template-columns: 1fr; gap: 4px; }
        .evaluation-submit-row, .result-pagination { align-items: stretch; flex-direction: column; }
        .evaluation-submit-row button { width: 100%; }
        .evaluation-result-card-header, .evaluation-result-facts { grid-template-columns: 1fr; }
        .evaluation-call-group-header { grid-template-columns: 1fr; }
        .evaluation-call-count { grid-column: auto; justify-items: start; }
        .evaluation-result-card[data-grouped="true"] .evaluation-result-card-header { grid-template-columns: 1fr; }
        .evaluation-result-proof-link { width: 100%; justify-content: center; }
        .table-wrap { overflow: visible; border: 0; }
        .table-wrap table, .table-wrap tbody, .table-wrap tr, .table-wrap td { display: block; width: 100%; min-width: 0; }
        .table-wrap thead {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .table-wrap tbody { display: grid; gap: 10px; }
        .table-wrap tr { padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface); }
        .table-wrap td { display: grid; grid-template-columns: minmax(110px, 34%) minmax(0, 1fr); gap: 10px; padding: 8px 0; overflow-wrap: anywhere; }
        .table-wrap td::before { content: attr(data-label); color: var(--muted-foreground); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      }
      ${PANELIFY_THEME_STYLES}
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div>
          <p class="page-kicker">${operationalModelUsePermitted ? "Governed evaluation workspace" : "Controlled validation laboratory"}</p>
          <h1>Evaluation Studio</h1>
          <p class="muted">${escapeHtml(titleDetail)} ${operationalModelUsePermitted ? "Promoted evaluation controls and result browsing stay in this local workspace." : "Use deterministic evidence and frozen human benchmark truth here; historical model work remains a separate immutable archive and no inference is available."}</p>
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
        <a href="#capability-register">Capabilities</a>
        <a href="#voicemail-inbound">Voicemail & inbound</a>
        <a href="#voicemail-pilot">Pilot attribution</a>
        <a href="#validation-lab">Benchmark lab</a>
        <a href="#historical-research">Historical research</a>
        <a href="#run-controls">${operationalModelUsePermitted ? "Evaluate" : "AI unavailable"}</a>
        ${operationalModelUsePermitted ? `<a href="#foundation-report">Foundation</a>` : ""}
        <a href="#results">Results</a>
        <a href="#runs">Runs</a>
        <a href="#evidence">Historical flags</a>
        <a href="#knowledgebase">Knowledgebase</a>
        <a href="#templates">Templates</a>
      </nav>
      ${!hasAnyData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}
      ${renderEvaluationStudio(persistence, data, options)}
    </main>
    ${renderStudioUtilityScript()}
    ${TABLE_COLUMNS_SCRIPT}
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
    icon: "◫",
    label: "Overview",
    kicker: "Manager overview",
    title: "Sales Dashboard",
    description: "Call activity, reporting context, and the operating signals that need attention first."
  },
  opportunities: {
    icon: "↗",
    label: "Opportunities",
    kicker: "Evidence-backed action",
    title: "Sales Opportunity Action Centre",
    description: "See evaluation readiness first, then drill into supported opportunity stages and the customer actions that need attention."
  },
  follow_up: {
    icon: "↻",
    label: "Follow-Up",
    kicker: "Literal reattempt evidence",
    title: "Reattempt Activity",
    description: "Inspect matched call attempts and literal no-contact evidence. Semantic callback and follow-up decisions are unavailable."
  },
  reviews: {
    icon: "!",
    label: "Alerts & Reviews",
    kicker: "Manager workflow",
    title: "Alerts & Manager Review",
    description: "Triage active alerts and record manager confirmation, correction, dismissal, or escalation."
  },
  intelligence: {
    icon: "◎",
    label: "Intelligence",
    kicker: "Restricted transcript evidence",
    title: "Literal Transcript Triage",
    description: "Inspect raw transcript facts, restricted literal triage, and provenance. Semantic evaluation and automated scoring are unavailable."
  },
  performance: {
    icon: "◇",
    label: "Performance & Cohorts",
    kicker: "Governed commercial evidence",
    title: "Performance & Cohorts",
    description: "Compare workload, approved-sales productivity, execution timing, and matured allocation cohorts with explicit attribution limits."
  },
  lead_results: {
    icon: "LR",
    label: "Lead Results Dashboard",
    kicker: "Complete governed results",
    title: "Lead Result Dashboard",
    description: "Review the workbook-equivalent lead results, manager evidence, recognition prompts, and complete Performance Rankings in one scrollable page."
  },
  records: {
    icon: "▤",
    label: "Records & Reports",
    kicker: "Audit and evidence",
    title: "Records & Reports",
    description: "Open call proof, inspect import history, review data confidence, and access saved reports."
  }
});

function normalizeDashboardView(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (key === "leads") return "harvest";
  if (key === "lead_result" || key === "lead_results_dashboard") return "lead_results";
  return Object.prototype.hasOwnProperty.call(DASHBOARD_VIEW_META, key) ? key : "overview";
}

function dashboardSegmentUrl(segment = "") {
  return segment ? `/?businessSegment=${encodeURIComponent(segment)}#business-split` : "/#business-split";
}

function intelligenceQueueLabel(queue) {
  const labels = {
    all: "All Indexed Calls",
    waste: "Utilisation Review",
    repeated_short: "Repeated Short Attempts",
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
  const evaluationResults = options.evaluationResults || [];
  const offerResult = evaluationResults.find((result) => result.evaluationGoal === OFFER_ACCEPTANCE_GOAL && result.acceptanceAssessment) || null;
  const foundationResult = evaluationResults.find((result) => result.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL && result.foundationAssessment) || null;
  const summaryResult = offerResult || foundationResult || evaluationResults[0] || null;
  const summaryRow = summaryResult ? {
    ...summaryResult,
    sharedOfferAcceptanceContext: summaryResult.offerAcceptanceContext || (offerResult ? {
      sourceResultId: offerResult.id,
      acceptanceAssessment: offerResult.acceptanceAssessment,
      managerSummary: offerResult.managerSummary,
      confidence: offerResult.confidence,
      evidenceAvailability: offerResult.evidenceAvailability,
      status: offerResult.status,
      updatedAt: offerResult.updatedAt || offerResult.createdAt
    } : null)
  } : null;
  const callAggregate = summaryRow?.callIntelligence || evaluationResults.find((result) => result.callIntelligence)?.callIntelligence || null;
  const callCommercial = callAggregate?.commercialState || null;
  const callQuotedValue = callCommercial?.quotedValue === null || callCommercial?.quotedValue === undefined
    ? "Unknown"
    : `${callCommercial.quotedCurrency && callCommercial.quotedCurrency !== "unknown" ? `${callCommercial.quotedCurrency} ` : ""}${formatNumber(callCommercial.quotedValue)} quoted`;
  const callKeyEvidence = [
    ["Presented offer", callAggregate?.keyEvidence?.offer],
    ["Customer acceptance", callAggregate?.keyEvidence?.acceptance],
    ["Payment timing", callAggregate?.keyEvidence?.paymentTiming]
  ].filter(([, quote]) => quote).map(([label, quote]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(quote)}</li>`).join("");
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
      ${COLUMN_HELP_STYLES}
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
      .commercial-summary { display: grid; gap: 8px; margin-top: 12px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); }
      .commercial-summary details summary { cursor: pointer; font-weight: 760; }
      .commercial-summary ul { display: grid; gap: 7px; margin: 9px 0 0; padding-left: 20px; }
      @media (max-width: 860px) { .topbar, .call-title, .grid-2, .audit-grid { grid-template-columns: 1fr; flex-direction: column; } .form-grid, .turn { grid-template-columns: 1fr; } .call-brand { min-width: 0; width: 190px; } table { min-width: 0; table-layout: fixed; } }
      ${PANELIFY_THEME_STYLES}
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
      ${call ? `<section class="panel call-summary-panel">
        <p class="page-kicker">Record summary</p>
        <h2>What this call currently tells you</h2>
        <p><strong>Customer ID: <span class="mono">${escapeHtml(customerIdValue(call))}</span></strong></p>
        ${summaryRow ? `<div class="stack" style="margin: 10px 0;">${evaluationResultOutcomeMarkup(summaryRow)}</div><p class="muted">${escapeHtml(callAggregate?.decisionBasis?.summary || evaluationRecordSummary(summaryRow))}</p>${callAggregate?.decisionBasis?.authorityStatus === "promoted_capability" ? `<p><strong>Next action:</strong> ${escapeHtml(callAggregate.operationalNextAction)}</p>${callCommercial ? `<div class="commercial-summary"><strong>Commercial lifecycle</strong><span>Offer: ${escapeHtml(humanizeSlug(callCommercial.offerState))} | ${escapeHtml(humanizeSlug(callCommercial.acceptanceStrength))}</span><span>Quoted value: ${escapeHtml(callQuotedValue)}</span><span>Payment: ${escapeHtml(humanizeSlug(callCommercial.paymentState))} | ${escapeHtml(humanizeSlug(callCommercial.paymentVerificationState))}</span><span>Intended timing: ${escapeHtml(callCommercial.intendedPaymentDateRaw || "Unknown")}${callCommercial.intendedPaymentDateResolved ? ` → ${escapeHtml(callCommercial.intendedPaymentDateResolved)}` : ""}</span><span>Revenue / CRM: ${escapeHtml(humanizeSlug(callCommercial.revenueState))} / ${escapeHtml(humanizeSlug(callCommercial.crmState))}</span>${callKeyEvidence ? `<details><summary>View strongest transcript evidence</summary><ul>${callKeyEvidence}</ul></details>` : ""}</div>` : ""}` : `<p class="muted">Historical model output is quarantined. Inspect the transcript directly; no AI-derived action or commercial state is available.</p>`}` : `<p class="muted">No Evaluation Studio result has been stored for this call. The deterministic classifications below remain available.</p>`}
      </section>` : ""}
      ${call ? `<section class="grid-2">
        <div class="panel">
          <h2>Classification</h2>
          ${table([
            { label: "Item", key: "item" },
            { label: "Value", key: "value" }
          ], [
            { item: "Customer ID", value: customerIdValue(call) },
            ...(contactIdValue(call) && customerIdValue(call) === "Not available" ? [{ item: "ContactId backup", value: contactIdValue(call) }] : []),
            { item: "Literal contact triage", value: `${call.contactClassification} | ${call.contactClassificationProvenance || "Restricted literal rule"}` },
            { item: "Literal terminal state", value: `${call.localOutcome} | ${call.localOutcomeProvenance || "Restricted literal rule"}` },
            { item: "LLM review state", value: llmReviewState(intelligenceAudit || call) },
            { item: "Manager review state", value: hasManagerReview ? `${reviewStatusLabel(latestManagerReview.reviewStatus)} | Manager-reviewed` : "Unreviewed" },
            ...(latestManagerReview?.corrections?.length ? [{ item: "Manager-corrected fields", value: latestManagerReview.corrections.map((correction) => `${correction.fieldName}: ${correction.managerCorrectedValue}`).join(" | ") }] : []),
            { item: "Business relationship", value: call.businessSegmentLabel || businessSegmentLabel(call.businessSegment) },
            { item: "Order history", value: call.orderHistoryLabel || (Number(call.orderCount || 0) > 0 ? "Previous Sales History" : "No Sales History") },
            { item: "Relationship evidence", value: `${call.businessRelationshipEvidenceTier || "fallback"} | ${call.businessRelationshipRule || "order_count_fallback"}` },
            ...(call.businessRelationshipBoundaryAt ? [{ item: "First-sale boundary used", value: call.businessRelationshipBoundaryAt }] : []),
            ...(call.businessRelationshipInvoiceNumber ? [{ item: "Invoice number", value: call.businessRelationshipInvoiceNumber }] : []),
            { item: "Relationship reason", value: call.businessRelationshipExplanation || "Mandatory binary fallback policy applied." },
            { item: "Semantic follow-up evaluation", value: "Unavailable" },
            { item: "AI assistant literal phrase", value: call.aiVoiceAssistantDetected ? "Detected; handling not scored" : "Not detected" },
            { item: "System audio subtype", value: call.systemAudioDetected ? call.systemAudioSubtypeLabel || call.systemAudioSubtype : "Not detected" },
            { item: "Automated transcript quality", value: "Unavailable" },
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
        <h2>Historical Local-Model Research</h2>
        <p class="muted small" style="margin-bottom: 12px;">Current state: ${escapeHtml(llmReviewState(intelligenceAudit || {}))}. Stored model payloads are audit history only and never override deterministic transcript proof.</p>
        ${intelligenceAudit ? renderIntelligenceAuditDetails(intelligenceAudit) : `<div class="empty">No historical local-model artifact is saved for this call.</div>`}
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
          <p class="muted small" style="margin-bottom: 12px;">Manager review is separate from alert lifecycle. Corrections are stored as manager-reviewed overlays; raw facts, restricted literal triage, and quarantined model history remain distinct.</p>
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
    ${TABLE_COLUMNS_SCRIPT}
  </body>
</html>`;
}

function renderSalesOpportunityActionCentre(centre = {}, options = {}) {
  const coverage = centre.coverage || {};
  const funnel = centre.funnel || [];
  const queues = centre.actionQueues || [];
  const records = centre.records || [];
  const query = centre.query || {};
  const globalFilters = options.globalFilters || {};
  const segmentFilters = options.segmentFilters || {};
  const activeStage = String(options.opportunityStage || query.stage || "");
  const activeQueue = String(options.opportunityQueue || query.queue || "");
  if (centre.capabilityBoundary?.operationalConsumptionPermitted !== true) {
    return `<div class="opportunity-workspace">
      <section class="panel" id="opportunity-readiness">
        <div class="panel-header"><div><p class="page-kicker">Trust boundary</p><h2>AI opportunity actions are unavailable</h2><p class="muted small">${escapeHtml(centre.capabilityBoundary?.message || "No local-model evaluator is promoted.")}</p></div>${badge("research excluded", "warning")}</div>
        <div class="metrics">${metricCard("Transcript calls", formatNumber(coverage.transcriptCalls || 0), `${formatNumber(coverage.allCalls || 0)} filtered calls`, "info", drilldownUrl("calls.transcriptAvailable", options.globalFilters || {}))}${metricCard("Operational AI decisions", "0", "No promoted capability", "neutral")}${metricCard("AI action queues", "0", "Historical model results excluded", "neutral")}</div>
        <div class="callout warning"><strong>No false confidence.</strong> Stored Foundation, Offer, Callback, Objection, Procedure, Lead Record, and Spiel outputs cannot create customer work, performance comparisons, accepted-offer claims, or coaching actions.</div>
        <div class="actions"><a class="button secondary" href="/?view=overview">Return to trusted overview</a><a class="button secondary" href="/evaluation-studio#results">Open research archive</a></div>
      </section>
    </div>`;
  }
  const opportunityUrl = (filters = {}, hash = "opportunity-results") => dashboardFilterUrl({
    ...globalFilters,
    ...segmentFilters,
    view: "opportunities",
    ...filters
  }, hash);
  const stageUrl = (stage, extra = {}) => opportunityUrl({ opportunityStage: stage, opportunityQueue: "", opportunityOffset: "", ...extra });
  const queueUrl = (queue, extra = {}) => opportunityUrl({ opportunityQueue: queue, opportunityStage: "", opportunityOffset: "", ...extra });
  const allUrl = (extra = {}) => opportunityUrl({ opportunityQueue: "", opportunityStage: "", opportunityOffset: "", ...extra });
  const queueLabel = (key) => queues.find((queue) => queue.key === key)?.label || humanizeSlug(key);
  const money = (record) => record.quotedAmountAvailable
    ? `${record.currency === "unknown" ? "" : `${record.currency} `}${Number(record.quotedAmount || 0).toLocaleString("en-AU")}`
    : "Not captured";
  const cohortFilters = (filterKey, row) => filterKey === "date" ? sourceDateFilters(row.label) : { [filterKey]: row.label };
  const cohortTable = (rows, dimension, filterKey) => `<div class="opportunity-cohort-table">${table([
    { label: dimension, description: `${dimension} label in the imported call metadata. Rows are alphabetical and are not a ranking.`, render: (row) => hrefDataLink(row.label, allUrl(cohortFilters(filterKey, row))) },
    { label: "Transcript calls", description: "Transcript-bearing calls in this filtered cohort.", render: (row) => hrefDataLink(formatNumber(row.transcripts), stageUrl("transcript_available", cohortFilters(filterKey, row))) },
    { label: "Foundation evaluated", description: "Current Call Intelligence Foundation results. This is the denominator used for the sample warning.", render: (row) => hrefDataLink(formatNumber(row.foundationEvaluated), stageUrl("foundation_evaluated", cohortFilters(filterKey, row))) },
    { label: "Coverage", description: "Current Foundation-evaluated calls divided by transcript-bearing calls for this row.", render: (row) => hrefDataLink(formatRatioPercent(row.foundationCoverageRate), stageUrl("foundation_evaluated", cohortFilters(filterKey, row))) },
    { label: "Offers", description: "Calls where current evidence records an offer presented.", render: (row) => hrefDataLink(formatNumber(row.offers), stageUrl("offer_presented", cohortFilters(filterKey, row))) },
    { label: "Actionable", description: "Foundation actionable or accepted opportunity candidates. Foundation cannot establish an accepted offer.", render: (row) => hrefDataLink(formatNumber(row.actionable), stageUrl("actionable_opportunity", cohortFilters(filterKey, row))) },
    { label: "Accepted", description: "Authoritative Offer Acceptance classifications of customer accepted offer.", render: (row) => hrefDataLink(formatNumber(row.accepted), stageUrl("accepted_offer", cohortFilters(filterKey, row))) },
    { label: "Acceptance rate", description: "Accepted offers divided by promoted Offer Acceptance classifications for this row.", render: (row) => `${hrefDataLink(formatRatioPercent(row.acceptanceRate), stageUrl("offer_classified", cohortFilters(filterKey, row)))}<br /><span class="muted small">${row.comparisonEligible ? "Minimum sample met" : escapeHtml(row.sampleWarning)}</span>` }
  ], rows, `No ${dimension.toLowerCase()} cohort evidence is available.`)}</div>`;

  return `<div class="opportunity-workspace">
    <section class="panel" id="opportunity-readiness">
      <div class="panel-header">
        <div>
          <p class="page-kicker">Coverage before comparison</p>
          <h2>Can these results support performance comparisons?</h2>
          <p class="muted small">The answer is shown before any salesperson or source breakdown so partial evaluation coverage cannot look representative.</p>
        </div>
        ${badge(coverage.readinessLabel || "Readiness unavailable", coverage.readyForPerformanceComparison ? "success" : "warning")}
      </div>
      <div class="metrics">
        ${metricCard("Transcript calls", formatNumber(coverage.transcriptCalls), `${formatNumber(coverage.allCalls)} filtered calls`, "info", stageUrl("transcript_available"))}
        ${metricCard("Foundation coverage", formatRatioPercent(coverage.foundationCoverageRate), `${formatNumber(coverage.foundationEvaluated)} of ${formatNumber(coverage.transcriptCalls)} transcript calls`, coverage.readyForPerformanceComparison ? "good" : "warn", stageUrl("foundation_evaluated"))}
        ${metricCard("Measurement eligible", formatNumber(coverage.measurementEligible), "Foundation evidence denominator", "info", stageUrl("measurement_eligible"))}
        ${metricCard("Offer classified", formatNumber(coverage.offerClassified), "Authoritative Offer Acceptance denominator", "info", stageUrl("offer_classified"))}
        ${metricCard("Typed specialist decisions", formatNumber(coverage.currentTypedSpecialistDecisions), `${formatNumber(coverage.routedSpecialistChecks)} routed Foundation checks`, coverage.currentTypedSpecialistDecisions >= coverage.routedSpecialistChecks ? "good" : "warn", stageUrl("typed_specialist"))}
        ${metricCard("Source dates", formatNumber(coverage.sourceDatesWithTranscripts), `${formatRatioPercent(coverage.largestFoundationDateShare)} of Foundation results on ${coverage.largestFoundationSourceDate || "the largest date"}`, coverage.sourceDatesWithTranscripts >= 7 ? "good" : "warn", stageUrl("foundation_evaluated", sourceDateFilters(coverage.largestFoundationSourceDate)))}
      </div>
      <div class="opportunity-warning-list">
        ${(coverage.warnings || []).map((warning) => `<div class="callout warning">${escapeHtml(warning)}</div>`).join("")}
      </div>
    </section>

    <section class="panel" id="opportunity-funnel">
      <div class="panel-header">
        <div><p class="page-kicker">Evidence checkpoints</p><h2>Opportunity funnel</h2><p class="muted small">${escapeHtml(centre.definitions?.funnel || "")}</p></div>
      </div>
      <div class="opportunity-funnel">
        ${funnel.map((stage, index) => `<a class="opportunity-stage ${activeStage === stage.key ? "selected" : ""}" href="${escapeHtml(stageUrl(stage.key))}">
          <span class="opportunity-stage-number">${index + 1}</span>
          <span><strong>${escapeHtml(stage.label)}</strong><span class="opportunity-stage-value mono">${formatNumber(stage.count)} · ${formatRatioPercent(stage.rate)}</span><small>${formatNumber(stage.count)} of ${formatNumber(stage.denominator)} ${escapeHtml(stage.denominatorLabel)}</small></span>
        </a>`).join("")}
      </div>
    </section>

    <section class="panel" id="opportunity-actions">
      <div class="panel-header">
        <div><p class="page-kicker">Prioritised customer work</p><h2>Action queues</h2><p class="muted small">One call can appear in more than one queue when independent evidence supports more than one action.</p></div>
        <div class="actions"><a class="button secondary" href="/reports/sales-opportunity-action-centre-current">Open management brief</a><a class="button secondary" href="/api/sales-opportunities/brief?format=markdown">Download Markdown</a></div>
      </div>
      <div class="action-queue-grid">
        ${queues.map((queue) => `<a class="action-queue-card ${activeQueue === queue.key ? "selected" : ""}" href="${escapeHtml(queueUrl(queue.key))}">
          <span>${badge(queue.priority, queue.priority === "urgent" ? "critical" : queue.priority === "high" ? "warning" : "neutral")}</span>
          <strong>${escapeHtml(queue.label)}</strong>
          <span class="mono action-queue-count">${formatNumber(queue.count)}</span>
          <small>${escapeHtml(queue.action)}</small>
        </a>`).join("")}
      </div>
    </section>

    <section class="panel" id="opportunity-cohorts">
      <div class="panel-header"><div><p class="page-kicker">Directional cohort view</p><h2>Salespeople and sources</h2><p class="muted small">Alphabetical evidence cohorts, not a leaderboard. Each row shows coverage and its own denominator; comparisons below ${formatNumber(coverage.minimumComparisonSample)} Foundation-evaluated calls are flagged.</p></div></div>
      <h3>By salesperson</h3>
      ${cohortTable(centre.cohorts?.bySalesperson || [], "Salesperson", "salesperson")}
      <h3 style="margin-top: 24px;">By source</h3>
      ${cohortTable(centre.cohorts?.bySource || [], "Source", "source")}
      <h3 style="margin-top: 24px;">By call date</h3>
      ${cohortTable(centre.cohorts?.byDate || [], "Call date", "date")}
    </section>

    <section class="panel" id="opportunity-results">
      <div class="panel-header">
        <div><p class="page-kicker">Contributing calls</p><h2>${activeQueue ? escapeHtml(queueLabel(activeQueue)) : activeStage ? escapeHtml(funnel.find((stage) => stage.key === activeStage)?.label || humanizeSlug(activeStage)) : "All opportunity evidence"}</h2><p class="muted small">${formatNumber(query.matchingRecords || records.length)} matching calls. Customer ID is always shown as supplied or Not available.</p></div>
        ${(activeQueue || activeStage) ? `<a class="button secondary" href="${escapeHtml(allUrl())}">Clear opportunity filter</a>` : ""}
      </div>
      <div class="opportunity-records">
        ${records.length ? records.map((record) => `<article class="opportunity-record">
          <div class="opportunity-record-head">
            <div><span class="muted small">Call</span><strong>${callLink(record.callId)}</strong><span class="muted small">Customer ID: <span class="mono">${escapeHtml(record.customerId)}</span></span></div>
            <div class="stack">${badge(record.priority, record.priority === "urgent" ? "critical" : record.priority === "high" ? "warning" : "neutral")}${badge(`${record.evidenceStrength} evidence`, record.evidenceStrength === "high" ? "success" : record.evidenceStrength === "low" ? "warning" : "neutral")}</div>
          </div>
          <dl class="opportunity-facts">
            <div><dt>Salesperson</dt><dd>${hrefDataLink(record.salesperson, allUrl({ salesperson: record.salesperson }))}</dd></div>
            <div><dt>Source</dt><dd>${hrefDataLink(record.source, allUrl({ source: record.source }))}</dd></div>
            <div><dt>Call date</dt><dd>${hrefDataLink(record.sourceTime, allUrl(sourceDateFilters(record.date)))}</dd></div>
            <div><dt>Business segment</dt><dd>${escapeHtml(humanizeSlug(record.businessSegment))}</dd></div>
            <div><dt>Called on behalf of</dt><dd>${escapeHtml(record.representedOrganisation)}</dd></div>
            <div><dt>Offer context</dt><dd>${escapeHtml(record.productOrPackage)} · ${escapeHtml(money(record))}</dd></div>
            <div><dt>Callback timing</dt><dd>${escapeHtml(record.callbackTiming)}</dd></div>
            <div><dt>Later-call evidence</dt><dd>${escapeHtml(record.laterCallStatus)}${record.laterCallId ? ` · ${callLink(record.laterCallId)}` : ""}</dd></div>
          </dl>
          <div class="opportunity-action"><strong>Recommended action</strong><span>${escapeHtml(record.recommendedAction)}</span></div>
          <div class="opportunity-tags">${record.queueKeys.map((key) => linkedBadge(queueLabel(key), "notice", queueUrl(key))).join("")}${record.stageKeys.filter((key) => funnel.some((stage) => stage.key === key)).map((key) => linkedBadge(funnel.find((stage) => stage.key === key).label, "neutral", stageUrl(key))).join("")}</div>
          <div class="commercial-boundary"><strong>Commercial state:</strong> accepted offer ${escapeHtml(record.acceptedOfferState)} · payment ${escapeHtml(record.paymentState)} · fulfilment ${escapeHtml(record.fulfilmentState)} · recognised revenue ${escapeHtml(record.recognisedRevenueState)} · CRM won ${escapeHtml(record.crmWonState)}</div>
          <div class="opportunity-proof"><strong>Exact transcript proof</strong>${record.proof.length ? `<ul>${record.proof.map((proof) => `<li><span class="muted small">${escapeHtml(proof.speaker)} · ${escapeHtml(humanizeSlug(proof.claimType))}</span><q>${escapeHtml(proof.quote)}</q></li>`).join("")}</ul>` : `<p class="muted small">No validated exact proof is stored for this row; review the call before action.</p>`}</div>
          <details><summary>Decision authority and provenance</summary><ul>${record.decisionAuthorities.length ? record.decisionAuthorities.map((authority) => `<li><strong>${escapeHtml(authority.label)}</strong> · ${escapeHtml(humanizeSlug(authority.type))} · schema ${escapeHtml(authority.schemaVersion || "not supplied")}</li>`).join("") : "<li>No current evaluator authority.</li>"}</ul></details>
        </article>`).join("") : `<div class="empty">No calls match this opportunity filter.</div>`}
      </div>
      ${(query.previousOffset !== null && query.previousOffset !== undefined) || (query.nextOffset !== null && query.nextOffset !== undefined) ? `<div class="actions opportunity-pagination">${query.previousOffset !== null && query.previousOffset !== undefined ? `<a class="button secondary" href="${escapeHtml(opportunityUrl({ opportunityStage: activeStage, opportunityQueue: activeQueue, opportunityOffset: query.previousOffset }))}">Previous</a>` : ""}${query.nextOffset !== null && query.nextOffset !== undefined ? `<a class="button secondary" href="${escapeHtml(opportunityUrl({ opportunityStage: activeStage, opportunityQueue: activeQueue, opportunityOffset: query.nextOffset }))}">Next</a>` : ""}</div>` : ""}
    </section>
  </div>`;
}

const LEAD_CHART_COLORS = Object.freeze([
  "#8B5CF6",
  "#A66BFF",
  "#E851B9",
  "#60A5FA",
  "#34D399",
  "#FBBF24",
  "#747C91"
]);

function chartPercent(value, maximum = 100) {
  const numeric = Number(value);
  const max = Number(maximum);
  if (!Number.isFinite(numeric) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (numeric / max) * 100));
}

function renderChartRow(row, options = {}) {
  const value = Number(options.value?.(row) || 0);
  const maximum = Number(options.maximum || 0);
  const width = chartPercent(value, maximum);
  const reference = Number(options.reference?.(row));
  const referenceWidth = Number.isFinite(reference) ? chartPercent(reference, maximum) : null;
  const status = options.status?.(row) || "";
  const lowSample = options.lowSample?.(row);
  const classes = ["lead-chart-row", lowSample ? "low-sample" : "", status === "not_scored" ? "not-scored" : ""]
    .filter(Boolean)
    .join(" ");
  const content = `
    <div class="lead-chart-row-head">
      <span class="lead-chart-label">${escapeHtml(options.label?.(row) || "Unknown")}</span>
      <strong class="lead-chart-value mono">${options.valueLabel?.(row) || formatNumber(value)}</strong>
    </div>
    <span class="lead-chart-track" aria-hidden="true"><span class="lead-chart-fill ${escapeHtml(options.tone || "violet")}" style="--chart-width:${width.toFixed(2)}%"></span>${referenceWidth === null ? "" : `<span class="lead-chart-reference" style="--reference-left:${referenceWidth.toFixed(2)}%"></span>`}</span>
    ${options.detail ? `<span class="lead-chart-detail">${options.detail(row)}</span>` : ""}`;
  const href = options.href?.(row) || "";
  return `<li class="${classes}">${href
    ? `<a class="lead-chart-row-link" href="${escapeHtml(href)}">${content}</a>`
    : content}</li>`;
}

function renderChartList(rows = [], options = {}) {
  if (!rows.length) return `<div class="empty">${escapeHtml(options.emptyMessage || "No chart data is available.")}</div>`;
  const visibleLimit = Math.max(1, Number(options.visibleLimit || 6));
  const visible = rows.slice(0, visibleLimit);
  const remaining = rows.slice(visibleLimit);
  const renderRows = (items) => `<ul class="lead-chart-list">${items.map((row) => renderChartRow(row, options)).join("")}</ul>`;
  return `${renderRows(visible)}${remaining.length ? `<details class="lead-chart-more"><summary>Show ${formatNumber(remaining.length)} additional sources</summary>${renderRows(remaining)}</details>` : ""}`;
}

function renderDailyAllocationChart(dailyRows = [], sourceRows = [], options = {}) {
  if (!dailyRows.length) return `<div class="empty">No daily allocation events are available.</div>`;
  const visibleSources = sourceRows
    .filter((row) => Number(row.sentAllocationEvents || 0) > 0)
    .slice(0, 5)
    .map((row, index) => ({ source: row.source, index }));
  const visibleKeys = new Set(visibleSources.map((row) => row.source));
  const hasOther = dailyRows.some((day) => (
    (day.sources || []).some((source) => !visibleKeys.has(source.source))
  ));
  const legend = [
    ...visibleSources,
    ...(hasOther ? [{ source: "Other sources", index: 5 }] : [])
  ];
  const maximum = Math.max(...dailyRows.map((row) => Number(row.sentAllocationEvents || 0)), 1);
  const dayLabel = (value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
  };
  return `<figure class="lead-chart-figure">
    <figcaption class="sr-only">Deduplicated sent allocation events by allocation source and sent date.</figcaption>
    <div class="lead-chart-legend" aria-label="Allocation source legend">${legend.map((item) => `<span><i class="series-${item.index}" aria-hidden="true"></i>${escapeHtml(item.source)}</span>`).join("")}</div>
    <div class="daily-allocation-chart" style="--daily-column-count:${dailyRows.length}">
      ${dailyRows.map((day) => {
        const segments = visibleSources.map((visible) => {
          const source = (day.sources || []).find((item) => item.source === visible.source);
          return {
            source: visible.source,
            count: Number(source?.sentAllocationEvents || 0),
            index: visible.index
          };
        });
        if (hasOther) {
          segments.push({
            source: "Other sources",
            count: (day.sources || [])
              .filter((source) => !visibleKeys.has(source.source))
              .reduce((sum, source) => sum + Number(source.sentAllocationEvents || 0), 0),
            index: 5
          });
        }
        const height = chartPercent(day.sentAllocationEvents, maximum);
        const content = `
          <strong class="mono">${formatNumber(day.sentAllocationEvents)}</strong>
          <div class="daily-allocation-track" aria-label="${escapeHtml(`${day.date}: ${formatNumber(day.sentAllocationEvents)} sent allocation events`)}">
            <div class="daily-allocation-stack" style="--column-height:${height.toFixed(2)}%">
              ${segments.filter((segment) => segment.count > 0).map((segment) => `<span class="series-${segment.index}" style="--segment-grow:${segment.count}" title="${escapeHtml(`${segment.source}: ${formatNumber(segment.count)}`)}"></span>`).join("")}
            </div>
          </div>
          <span>${escapeHtml(dayLabel(day.date))}</span>`;
        const href = options.href?.(day) || "";
        return href
          ? `<a class="daily-allocation-column" href="${escapeHtml(href)}">${content}</a>`
          : `<div class="daily-allocation-column">${content}</div>`;
      }).join("")}
    </div>
    <details class="lead-chart-more daily-allocation-details">
      <summary>View exact daily source quantities</summary>
      <ul>${dailyRows.map((day) => `<li><strong>${escapeHtml(dayLabel(day.date))} · ${formatNumber(day.sentAllocationEvents)} sent events</strong><span>${(day.sources || []).map((source) => `${escapeHtml(source.source)} ${formatNumber(source.sentAllocationEvents)}`).join(" · ")}</span></li>`).join("")}</ul>
    </details>
  </figure>`;
}

function renderLeadAgeChart(rows = [], total = 0, options = {}) {
  if (!rows.length || !total) return `<div class="empty">No valid allocation-age distribution is available.</div>`;
  let cursor = 0;
  const stops = rows.map((row, index) => {
    const start = cursor;
    cursor = Math.min(100, cursor + Number(row.share || 0));
    if (index === rows.length - 1) cursor = 100;
    return `${LEAD_CHART_COLORS[index % LEAD_CHART_COLORS.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  return `<figure class="lead-age-figure">
    <div class="lead-age-donut" style="--donut-fill:conic-gradient(${stops.join(",")})" aria-hidden="true">
      <div><strong class="mono">${formatNumber(total)}</strong><span>sent events</span></div>
    </div>
    <figcaption>
      <ul class="lead-age-legend">${rows.map((row, index) => {
        const content = `<i style="--legend-color:${LEAD_CHART_COLORS[index % LEAD_CHART_COLORS.length]}" aria-hidden="true"></i><span>${escapeHtml(row.label)}</span><strong class="mono">${formatNumber(row.sentAllocationEvents)}</strong><small>${formatPercent(row.share)}</small>`;
        const href = options.href?.(row) || "";
        return `<li>${href ? `<a href="${escapeHtml(href)}">${content}</a>` : content}</li>`;
      }).join("")}</ul>
    </figcaption>
  </figure>`;
}

function renderLeadUsage(usage = {}, totals = {}, allocationFrequency = [], options = {}) {
  const stages = [
    { label: "Raw rows", value: totals.rawAllocationRows },
    { label: "Sent events", value: totals.deduplicatedSentEvents },
    { label: "Customer-recipient pairs", value: usage.uniqueCustomerRecipientPairs },
    { label: "Unique leads", value: usage.uniqueCustomers }
  ];
  const maximum = Math.max(...stages.map((stage) => Number(stage.value || 0)), 1);
  return `<div class="lead-usage-layout">
    <figure class="lead-usage-funnel">
      <figcaption class="sr-only">Allocation rows retained through deduplication and unique lead grouping.</figcaption>
      ${stages.map((stage, index) => {
        const content = `
        <div><span>${escapeHtml(stage.label)}</span><strong class="mono">${formatNumber(stage.value)}</strong></div>
        <span class="lead-usage-track" aria-hidden="true"><span class="series-${Math.min(index, 4)}" style="--usage-width:${chartPercent(stage.value, maximum).toFixed(2)}%"></span></span>`;
        const href = options.stageHref?.(stage) || "";
        return href
          ? `<a class="lead-usage-stage" href="${escapeHtml(href)}">${content}</a>`
          : `<div class="lead-usage-stage">${content}</div>`;
      }).join("")}
    </figure>
    <div class="lead-usage-signals">
      <a href="${escapeHtml(options.repeatHref || "#lead-usage")}"><span>Repeat sends, same recipient</span><strong class="mono">${formatNumber(usage.repeatSentEventsSameRecipient)}</strong></a>
      <a href="${escapeHtml(options.crossRecipientHref || "#lead-usage")}"><span>Cross-recipient leads</span><strong class="mono">${formatNumber(usage.crossRecipientCustomers)}</strong></a>
      <a href="${escapeHtml(options.duplicateHref || "#lead-usage")}"><span>Duplicate rows excluded</span><strong class="mono">${formatNumber(usage.logicalDuplicateRows)}</strong></a>
      <div><span>Conflicting source pairs</span><strong class="mono">${formatNumber(usage.conflictingSourcePairs)}</strong></div>
    </div>
    <div class="allocation-frequency">
      <h3>Sent-event frequency per customer-recipient pair</h3>
      ${renderChartList(allocationFrequency, {
        label: (row) => row.label,
        value: (row) => row.customerRecipientPairs,
        valueLabel: (row) => `${formatNumber(row.customerRecipientPairs)} · ${formatPercent(row.share)}`,
        maximum: Math.max(...allocationFrequency.map((row) => Number(row.customerRecipientPairs || 0)), 1),
        tone: "blue",
        visibleLimit: 4,
        href: (row) => options.frequencyHref?.(row) || ""
      })}
    </div>
  </div>`;
}

function renderPerformanceRangeForm(report = {}) {
  const selectedStart = report.period?.startDate || report.availablePeriod?.startDate || "";
  const selectedEnd = report.period?.endDate || report.availablePeriod?.endDate || "";
  const minimum = report.availablePeriod?.startDate || "";
  const maximum = report.availablePeriod?.endDate || "";
  if (!minimum || !maximum) return "";
  return `<form class="performance-range-form" action="/" method="get" aria-label="Performance reporting period">
    <input type="hidden" name="view" value="performance" />
    <label><span>From</span><input type="date" name="performanceFrom" value="${escapeHtml(selectedStart)}" min="${escapeHtml(minimum)}" max="${escapeHtml(maximum)}" required /></label>
    <label><span>To</span><input type="date" name="performanceTo" value="${escapeHtml(selectedEnd)}" min="${escapeHtml(minimum)}" max="${escapeHtml(maximum)}" required /></label>
    <button class="button secondary" type="submit">Apply range</button>
    <a class="button secondary" href="/?view=performance#performance-summary">Reset</a>
    <span class="muted small">Australia/Sydney allocation dates · available ${escapeHtml(minimum)} to ${escapeHtml(maximum)}</span>
  </form>`;
}

function renderLeadResultRangeForm(state = {}) {
  const report = state.report || {};
  const selectedStart = report.period?.startDate || report.availablePeriod?.startDate || "";
  const selectedEnd = report.period?.endDate || report.availablePeriod?.endDate || "";
  const minimum = report.availablePeriod?.startDate || "";
  const maximum = report.availablePeriod?.endDate || "";
  const completeRanges = state.completeRanges || [];
  if (!minimum || !maximum) return "";
  const selectedQuery = new URLSearchParams({ performanceFrom: selectedStart, performanceTo: selectedEnd });
  return `<div class="lead-results-range-control">
    <form class="performance-range-form" action="/lead-results-dashboard" method="get" aria-label="Lead Results reporting period">
      <label><span>From</span><input type="date" name="performanceFrom" value="${escapeHtml(selectedStart)}" min="${escapeHtml(minimum)}" max="${escapeHtml(maximum)}" required /></label>
      <label><span>To</span><input type="date" name="performanceTo" value="${escapeHtml(selectedEnd)}" min="${escapeHtml(minimum)}" max="${escapeHtml(maximum)}" required /></label>
      <button class="button secondary" type="submit">Display complete range</button>
      <a class="button secondary" href="/lead-results-dashboard#lead-results-summary">Reset</a>
      ${state.available ? `<a class="button" href="/exports/lead-results-dashboard.xlsx?${escapeHtml(selectedQuery.toString())}">Export selected range</a>` : `<span class="button disabled" aria-disabled="true" title="Export is available only after the selected period passes every completeness check.">Export unavailable</span>`}
      <span class="muted small">Australia/Sydney dates · configured ${escapeHtml(minimum)} to ${escapeHtml(maximum)}</span>
    </form>
    <div class="complete-range-presets" aria-label="Complete governed ranges">
      <span class="muted small">Complete governed ranges:</span>
      ${completeRanges.length ? completeRanges.map((range) => `<a class="filter-chip" href="${escapeHtml(`/lead-results-dashboard?${new URLSearchParams({ performanceFrom: range.startDate, performanceTo: range.endDate }).toString()}#lead-results-summary`)}"><span>${escapeHtml(range.label)}</span></a>`).join("") : `<span class="muted small">None currently overlap the configured allocation source.</span>`}
    </div>
  </div>`;
}

function renderLeadResultGuidance(guidance = {}) {
  return `<div class="lead-result-guidance">
    <div><strong>How to read</strong><p class="muted small">${escapeHtml(guidance.howToRead || "Use this as descriptive manager evidence.")}</p></div>
    <div><strong>What this chart shows</strong><p class="muted small">${escapeHtml(guidance.whatItShows || "Governed selected-period evidence.")}</p></div>
    <div class="warning"><strong>What to know</strong><p class="small">${escapeHtml(guidance.whatToKnow || "Review the evidence boundary before interpreting the result.").replace(/\n/g, "<br />")}</p></div>
  </div>`;
}

function renderLeadResultPanel(title, rows = [], { team = false, empty = "No eligible result for this period.", rowContent, rowHref } = {}) {
  return `<section class="lead-result-compact-panel ${team ? "team" : "individual"}">
    <h3>${escapeHtml(title)}</h3>
    ${rows.length ? `<ol>${rows.map((row) => {
      const content = rowContent(row);
      const href = rowHref?.(row) || "";
      return `<li>${href ? `<a href="${escapeHtml(href)}">${content}</a>` : `<div>${content}</div>`}</li>`;
    }).join("")}</ol>` : `<p class="muted small">${escapeHtml(empty)}</p>`}
  </section>`;
}

function renderLeadResultsDashboard(state = {}) {
  const report = state.report || {};
  if (!state.configured) {
    return `<section class="panel" id="lead-results-summary">
      <div class="panel-header"><div><p class="page-kicker">Local configuration</p><h2>Lead Result Dashboard</h2><p class="muted small">Configure the governed weekly allocation sources and read-only Carma evidence contract to enable this page.</p></div>${badge("Not configured", "warning")}</div>
      <div class="panel-body"><div class="empty">No Lead Results source is configured.</div></div>
    </section>`;
  }
  if (!state.available || !state.model) {
    const reasons = state.completeness?.unavailableReasons || [report.error || "The selected range is incomplete."];
    return `<section class="panel" id="lead-results-summary">
      <div class="panel-header"><div><p class="page-kicker">Completeness gate</p><h2>Lead Result Dashboard unavailable</h2><p class="muted small">The selected period is not displayed because zero or partial evidence would be misleading.</p></div>${badge("Incomplete range", "critical")}</div>
      ${renderLeadResultRangeForm(state)}
      <div class="panel-body"><div class="empty"><strong>Select a fully governed range.</strong><br />${reasons.map(escapeHtml).join("<br />")}</div></div>
      <div class="panel-body guardrails">
        ${Object.entries(state.completeness?.checks || {}).map(([key, passed]) => `<div class="note"><h3>${escapeHtml(humanizeSlug(key))}</h3><p class="muted small">${passed ? "Passed" : "Not satisfied"}</p></div>`).join("")}
      </div>
    </section>`;
  }

  const payload = publicLeadResultDashboard(state);
  const model = state.model;
  const totals = payload.totals;
  const views = payload.performanceViews || {};
  const managerRows = payload.managerRows || [];
  const rankings = payload.rankings || [];
  const selectedRange = {
    performanceFrom: payload.period.startDate,
    performanceTo: payload.period.endDate,
    returnView: "lead_results"
  };
  const evidenceHref = (metric, filters = {}) => drilldownUrl(metric, { ...selectedRange, ...filters });
  const currency = (value) => Number(value || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const share = (value) => formatRatioPercent(Number(value || 0));
  const sourceCoverageDetail = (row) => {
    const coverage = share(row.sourceCoverage);
    if (!Number(row.attributionWithheldSales ?? row.withheld)) return `Complete · ${coverage} classified`;
    const range = `${share(row.allocatedLeadShareLowerBound)}–${share(row.allocatedLeadShareUpperBound)}`;
    return `${row.sourceShareComparable ? "High coverage" : "Provisional"} · ${coverage} classified · possible range ${range}`;
  };
  const managerShareRows = [...managerRows].sort((a, b) => Number(b.allocatedLeadShare || 0) - Number(a.allocatedLeadShare || 0));
  const managerLoadRows = [...managerRows].sort((a, b) => Number(b.leadsPerActiveSalesperson || 0) - Number(a.leadsPerActiveSalesperson || 0));
  const managerBacklogRows = [...managerRows].sort((a, b) => Number(b.noExactCallObserved || 0) - Number(a.noExactCallObserved || 0));
  const leaderHref = (row, team = false, reconcile = true) => evidenceHref("performance.approvedOrders", {
    ...(team ? { manager: row.manager } : { seller: row.salesperson || row.displayName }),
    ...(reconcile ? { reconcile: "allocatedLeadShare" } : {})
  });
  const attentionContent = (row, team = false) => `<strong>${escapeHtml(team ? `${row.manager} team` : row.displayName)}</strong><span>${(row.concerns?.length ? row.concerns : ["Review the underlying selected-period evidence."]).map(escapeHtml).join("<br />")}</span>`;
  const trophyHref = (row, team = false) => {
    if (!row.candidate || row.candidate.startsWith("No eligible")) return "";
    const personOrManager = team
      ? { manager: row.candidate.replace(/ team$/i, "") }
      : { seller: row.candidate };
    if (/Self-Sourcing/i.test(row.trophy)) return evidenceHref("performance.approvedOrders", { ...personOrManager, classification: "Self Sourced" });
    if (/Utilisation|Follow-Up/i.test(row.trophy)) return evidenceHref("performance.called", team ? { manager: personOrManager.manager } : { salesperson: row.candidate });
    return evidenceHref("performance.approvedOrders", { ...personOrManager, ...(/Company-Supplied Sales Share|Versatility/i.test(row.trophy) ? { reconcile: "allocatedLeadShare" } : {}) });
  };
  const trophyContent = (row) => `<strong>${escapeHtml(row.trophy)}</strong><span>${escapeHtml(row.candidate)} · ${escapeHtml(row.metric)}</span><small>${escapeHtml(row.context)}${row.runnersUp ? ` Runners-up: ${escapeHtml(row.runnersUp)}.` : ""}</small>`;

  return `<div class="workspace-flow lead-results-workspace">
    <section class="panel lead-results-hero" id="lead-results-summary">
      <div class="panel-header">
        <div><p class="page-kicker">Lead result dashboard</p><h2>${escapeHtml(payload.period.label)}</h2><p class="muted small">Workbook-equivalent weekly allocation workload and Approved Sales evidence. Generated ${escapeHtml(formatDateTime(payload.generatedAt))}.</p></div>
        <div class="stack">${badge("Complete governed range", "success")}${badge("Carma read-only", "neutral")}${badge(payload.dataQuality.callCoverageComplete ? "Call scoring available" : "Call scoring withheld", payload.dataQuality.callCoverageComplete ? "success" : "warning")}</div>
      </div>
      ${renderLeadResultRangeForm(state)}
      <div class="panel-body"><div class="note warning"><h3>Evidence boundary</h3><p class="muted small">Sales From Allocated Leads require the exact customer, exact seller, and an allocation before an explicit approval timestamp, with no allocation-age limit. Weekly Sent Leads are separate workload context. ${payload.dataQuality.callCoverageComplete ? `Leads Uncalled is limited to the governed reporting window ending ${escapeHtml(payload.dataQuality.callEvidenceThrough || payload.period.endDate)}.` : `Allocated Leads With No Recorded Call is an operational review backlog through ${escapeHtml(payload.dataQuality.callEvidenceThrough || "the displayed cutoff")}, not authoritative proof that no call occurred.`}</p></div></div>
      <div class="panel-body metrics lead-result-kpis">
        ${metricCard("Total Sent Leads", formatNumber(totals.sentLeads), "Deduplicated allocation workload events", "info", evidenceHref("performance.sentEvents"))}
        ${metricCard("Unique Leads Sent", formatNumber(totals.uniqueLeadsSent), "Exact customer-recipient allocation pairs", "good", evidenceHref("performance.allocationPairs"))}
        ${metricCard("Approved Sales", formatNumber(totals.approvedSales), "Complete governed selected-period population", "good", evidenceHref("performance.approvedOrders"))}
        ${metricCard("Approved Sales Value", currency(totals.approvedSalesValue), "CRM approved amount; not payment, profit, or recognised revenue", "info", evidenceHref("performance.approvedOrders"))}
        ${metricCard("Sales From Allocated Leads % of Classified Sales", share(totals.allocatedLeadShare), `${formatNumber(totals.allocatedLeadSales)} of ${formatNumber(totals.classifiedSales)} classified Approved Sales · ${sourceCoverageDetail(totals)}`, "info", evidenceHref("performance.approvedOrders", { reconcile: "allocatedLeadShare" }))}
        ${metricCard("Sales From Allocated Leads", formatNumber(totals.allocatedLeadSales), "Exact seller pre-sale allocation evidence", "good", evidenceHref("performance.approvedOrders", { classification: "Company Sourced" }))}
        ${metricCard("Self Sourced Sales", formatNumber(totals.selfSourcedSales), "Approved Sales without qualifying exact pre-sale seller allocation", "warning", evidenceHref("performance.approvedOrders", { classification: "Self Sourced" }))}
        ${metricCard("Salespeople Receiving Leads", formatNumber(totals.salespeopleReceivingLeads), "Recipients with at least one valid Sent Lead in the selected period", "info", evidenceHref("performance.salespeople"))}
      </div>
    </section>

    <section class="panel" id="lead-results-call-activity">
      <div class="panel-header"><div><p class="page-kicker">Weekly call exports</p><h2>Call Activity &amp; Workload Context</h2><p class="muted small">Deduplicated selected-period calls. Duration does not prove live-human contact; calls per sale is not conversion.</p></div>${badge(payload.dataQuality.callDurationCoverageComplete ? "Duration coverage complete" : "Duration coverage incomplete", payload.dataQuality.callDurationCoverageComplete ? "success" : "warning")}</div>
      <div class="panel-body metrics">
        ${metricCard("Weekly Calls", formatNumber(totals.weeklyCallCount), `${formatNumber(totals.weeklyOutboundCallCount)} outbound`, "info")}
        ${metricCard("Average Call Time", totals.weeklyAverageCallDurationSeconds === null ? "Unavailable" : `${Number(totals.weeklyAverageCallDurationSeconds).toFixed(1)}s`, "Mean call_duration_seconds", "info")}
        ${metricCard("Total Call Time", `${(Number(totals.weeklyTotalCallDurationSeconds || 0) / 3600).toFixed(1)}h`, "Selected reporting period", "neutral")}
        ${metricCard("Short Calls", formatNumber(totals.weeklyShortCallCount), `More than zero and under ${formatNumber(payload.dataQuality.shortCallSeconds)} seconds`, "warning")}
        ${metricCard("Long Calls", formatNumber(totals.weeklyLongCallCount), `At least ${formatNumber(payload.dataQuality.longCallSeconds / 60)} minutes`, "good")}
        ${metricCard("Zero-Duration Calls", formatNumber(totals.weeklyZeroDurationCalls), "Recorded call_duration_seconds equals zero", "warning")}
        ${metricCard("Calls per Approved Sale", totals.weeklyCallsPerApprovedSale === null ? "—" : Number(totals.weeklyCallsPerApprovedSale).toFixed(1), "Workload ratio only; not causal conversion", "neutral")}
      </div>
    </section>

    <section class="panel" id="lead-results-manager-charts">
      <div class="panel-header"><div><p class="page-kicker">Manager analysis</p><h2>Manager Team Results</h2><p class="muted small">Teal sections are manager-team results. Every team rate divides aggregated team totals; salesperson percentages are never averaged.</p></div>${badge(`${formatNumber(managerRows.length)} teams`, "notice")}</div>
      <div class="lead-result-chart-grid">
        <article><h3>Company Supplied Share of Sales by Manager</h3>${renderChartList(managerShareRows, { label: (row) => row.manager, value: (row) => row.allocatedLeadShare || 0, valueLabel: (row) => share(row.allocatedLeadShare), maximum: 1, visibleLimit: Math.max(1, managerRows.length), tone: "blue", href: (row) => evidenceHref("performance.approvedOrders", { manager: row.manager, reconcile: "allocatedLeadShare" }), detail: (row) => `<span>${formatNumber(row.allocatedLeadSales)} of ${formatNumber(row.classifiedSales)} classified sales · ${escapeHtml(sourceCoverageDetail(row))} · ${formatNumber(row.sent)} weekly Sent Leads</span>` })}${renderLeadResultGuidance(payload.chartGuidance.efficiency)}</article>
        <article><h3>Weekly Lead Allocation vs Company Supplied Sales</h3>${renderChartList(managerShareRows, { label: (row) => row.manager, value: (row) => row.allocatedSalesShare || 0, valueLabel: (row) => `${share(row.leadShare)} / ${share(row.allocatedSalesShare)}`, maximum: 1, visibleLimit: Math.max(1, managerRows.length), tone: "pink", href: (row) => evidenceHref("performance.approvedOrders", { manager: row.manager }), detail: () => `<span>Weekly lead allocation share / Company supplied sales share</span>` })}${renderLeadResultGuidance(payload.chartGuidance.shares)}</article>
        <article><h3>Sent Leads per Salesperson Receiving Leads</h3>${renderChartList(managerLoadRows, { label: (row) => row.manager, value: (row) => row.leadsPerActiveSalesperson || 0, reference: (row) => row.companyObservedPerRecipientAverage, valueLabel: (row) => Number(row.leadsPerActiveSalesperson || 0).toFixed(1), maximum: Math.max(...managerLoadRows.map((row) => Number(row.leadsPerActiveSalesperson || 0)), 1), visibleLimit: Math.max(1, managerRows.length), tone: "blue", href: (row) => evidenceHref("performance.salespeople", { manager: row.manager }), detail: (row) => `<span>${formatNumber(row.sent)} Sent Leads across ${formatNumber(row.activeSalespeople)} recipients · company reference ${Number(row.companyObservedPerRecipientAverage || 0).toFixed(1)}</span>` })}${renderLeadResultGuidance(payload.chartGuidance.active)}</article>
        <article><h3>${escapeHtml(payload.dataQuality.uncalledLabel)} by Team</h3>${renderChartList(managerBacklogRows, { label: (row) => row.manager, value: (row) => row.noExactCallObserved || 0, valueLabel: (row) => formatNumber(row.noExactCallObserved), maximum: Math.max(...managerBacklogRows.map((row) => Number(row.noExactCallObserved || 0)), 1), visibleLimit: Math.max(1, managerRows.length), tone: "pink", href: (row) => evidenceHref("performance.noCallObserved", { manager: row.manager }), detail: (row) => `<span>${formatNumber(row.noExactCallObserved)} of ${formatNumber(row.unique)} pairs · ${payload.dataQuality.callCoverageComplete ? "reporting-window uncalled" : "recorded-call review backlog"}</span>` })}${renderLeadResultGuidance(payload.chartGuidance.callBacklog)}</article>
      </div>
    </section>

    <section class="panel" id="lead-results-manager-summary">
      <div class="panel-header"><div><h2>Manager Summary</h2><p class="muted small">Counts, weighted source shares, observed recipient load, and call-review backlog for each exact Manager label.</p></div></div>
      ${table([
        { label: "Manager", render: (row) => `<strong>${escapeHtml(row.manager)}</strong>` },
        { label: "Salespeople receiving leads", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.salespeople", { manager: row.manager }))}">${formatNumber(row.activeSalespeople)}</a>` },
        { label: "Weekly Sent Leads", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.sentEvents", { manager: row.manager }))}">${formatNumber(row.sent)}</a>` },
        { label: "Unique Leads", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.allocationPairs", { manager: row.manager }))}">${formatNumber(row.unique)}</a>` },
        { label: "Approved Sales", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { manager: row.manager }))}">${formatNumber(row.sales)}</a>` },
        { label: "Sales From Allocated Leads", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { manager: row.manager, classification: "Company Sourced" }))}">${formatNumber(row.allocatedLeadSales)}</a>` },
        { label: "Sales From Allocated Leads % of Classified Sales", render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { manager: row.manager, reconcile: "allocatedLeadShare" }))}">${share(row.allocatedLeadShare)}</a><br /><span class="muted small">${escapeHtml(sourceCoverageDetail(row))}</span>` },
        { label: payload.dataQuality.uncalledLabel, render: (row) => `<a class="data-link" href="${escapeHtml(evidenceHref("performance.noCallObserved", { manager: row.manager }))}">${formatNumber(row.noExactCallObserved)}</a>` },
        { label: "Manager own sales", render: (row) => row.managerOwnSales ? `<a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.manager }))}">${formatNumber(row.managerOwnSales)}</a>` : "0" }
      ], managerRows, "No manager rows are available for this complete period.")}
    </section>

    <section class="panel" id="lead-results-performance-views">
      <div class="panel-header"><div><p class="page-kicker">Performance and recognition prompts</p><h2>Performance &amp; Trophies</h2><p class="muted small">Blue panels show individual salesperson results; teal panels show manager-team results. These are deterministic human-review prompts, never automatic personnel actions.</p></div></div>
      <div class="lead-result-panel-grid">
        ${renderLeadResultPanel("Salesperson Results Worthy of Investigation", views.salespeopleResultsWorthyOfInvestigation || [], { rowContent: (row) => attentionContent(row, false), rowHref: (row) => leaderHref(row, false) })}
        ${renderLeadResultPanel("Team Results Worthy of Investigation", views.teamResultsWorthyOfInvestigation || [], { team: true, rowContent: (row) => attentionContent(row, true), rowHref: (row) => leaderHref(row, true) })}
        ${renderLeadResultPanel("Lead Burners — High Allocation / Weak Company-Supplied Sales Mix", views.leadBurnersByResult || [], { rowContent: (row) => `<strong>${escapeHtml(row.displayName)}</strong><span>${formatNumber(row.sent)} Sent Leads · ${share(row.allocatedLeadShare)} of classified sales from allocated leads</span><small>Investigation prompt only; selected-week leads are not a causal conversion denominator.</small>`, rowHref: (row) => leaderHref(row, false) })}
        ${renderLeadResultPanel("Lead Burners — Highest Uncalled %", views.leadBurnersByUncalled || [], { rowContent: (row) => `<strong>${escapeHtml(row.displayName)}</strong><span>${share(row.uncalledRate)} · ${formatNumber(row.noExactCallObserved)} of ${formatNumber(row.unique)} allocated pairs</span><small>Only shown when the governed reporting-window call gate passes; minimum 25 allocated pairs.</small>`, rowHref: (row) => evidenceHref("performance.noCallObserved", { salesperson: row.salesperson }) })}
        ${renderLeadResultPanel("Individual Trophy Candidates", views.salespersonTrophies || [], { rowContent: trophyContent, rowHref: (row) => trophyHref(row, false) })}
        ${renderLeadResultPanel("Team Trophy Candidates", views.teamTrophies || [], { team: true, rowContent: trophyContent, rowHref: (row) => trophyHref(row, true) })}
      </div>
    </section>

    <section class="panel" id="lead-results-checks">
      <div class="panel-header"><div><h2>Completeness &amp; Interpretation Checks</h2><p class="muted small">The selected screen and export are available only while all required checks pass.</p></div>${badge("All required checks passed", "success")}</div>
      <div class="panel-body guardrails">${Object.entries(payload.completeness.checks).map(([key, passed]) => `<div class="note"><h3>${escapeHtml(humanizeSlug(key))}</h3><p class="muted small">${passed ? "Passed" : "Not satisfied"}</p></div>`).join("")}</div>
      <div class="panel-body"><p class="muted small">Company-supplied lead call scoring: ${payload.dataQuality.callCoverageComplete ? "available" : "withheld because a genuine call identity, timestamp or weekday-coverage gate is incomplete"}. Self-sourcing attempts without a Customer ID: ${formatNumber(payload.dataQuality.unlinkedSelfSourcingCallAttempts)}; these are separate activity, not company-supplied lead calls or Self-Sourced Sales. Blocking call identity issues: ${formatNumber(payload.dataQuality.missingCallJoinKeys)}. Empty weekend dates are treated as no weekend activity.</p></div>
    </section>

    <section class="panel performance-rankings" id="performance-rankings">
      <div class="panel-header"><div><p class="page-kicker">Complete workbook table</p><h2>Performance Rankings</h2><p class="muted small">All observed recipients are included. Sorting changes only the table view and never creates an automated personnel band, decision, or action.</p></div>${badge(`${formatNumber(rankings.length)} results`, "notice")}</div>
      <div class="panel-body"><div class="note"><p class="muted small">${payload.previousPeriod ? `Compared with ${escapeHtml(payload.previousPeriod.startDate)} to ${escapeHtml(payload.previousPeriod.endDate)} where both periods meet the sample gates.` : "Baseline period: no compatible fully prior governed snapshot is available."} Prior-period figures have no row-level drilldown because retained snapshots contain aggregates, not source evidence.</p></div></div>
      <div class="table-wrap lead-result-rankings-wrap">
        <table data-sortable-table>
          <thead><tr>${[
            ["Salesperson", "text"], ["Manager", "text"], ["Weekly Sent Leads", "number"], ["Unique Leads Sent", "number"], [payload.dataQuality.uncalledLabel, "number"], ["Weekly Calls", "number"], ["Average Call Time", "number"], ["Median Call Time", "number"], ["Short Calls", "number"], ["Long Calls", "number"], ["Calls per Approved Sale", "number"], ["Reallocations", "number"], ["Approved Sales", "number"], ["Sales Value", "number"], ["Sales From Allocated Leads % of Classified Sales", "number"], ["Sales From Allocated Leads", "number"], ["Self-Sourced Sales", "number"], ["Prior Sent Leads", "number"], ["Prior Approved Sales", "number"], ["Prior Sales From Allocated Leads % of Classified Sales", "number"], ["Change in Sales From Allocated Leads %", "number"], ["Company-Supplied Sales Share Outcome", "text"], ["Source Attribution Withheld", "number"], ["Source Attribution Status", "text"]
          ].map(([label, type], index) => `<th scope="col"><button type="button" class="sort-button" data-sort-column="${index}" data-sort-type="${type}">${escapeHtml(label)}<span aria-hidden="true">↕</span></button></th>`).join("")}</tr></thead>
          <tbody>${rankings.map((row) => `<tr>
            <td data-sort-value="${escapeHtml(row.salesperson)}"><strong>${escapeHtml(row.salesperson)}</strong></td>
            <td data-sort-value="${escapeHtml(row.manager)}">${escapeHtml(row.manager)}</td>
            <td data-sort-value="${row.sentLeads}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.sentEvents", { salesperson: row.salesperson }))}">${formatNumber(row.sentLeads)}</a></td>
            <td data-sort-value="${row.uniqueLeads}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.allocationPairs", { salesperson: row.salesperson }))}">${formatNumber(row.uniqueLeads)}</a></td>
            <td data-sort-value="${row.noExactCallObserved}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.noCallObserved", { salesperson: row.salesperson }))}">${formatNumber(row.noExactCallObserved)}</a></td>
            <td data-sort-value="${row.weeklyCallCount}">${formatNumber(row.weeklyCallCount)}</td>
            <td data-sort-value="${row.weeklyAverageCallDurationSeconds ?? -1}">${row.weeklyAverageCallDurationSeconds === null ? "—" : `${Number(row.weeklyAverageCallDurationSeconds).toFixed(1)}s`}</td>
            <td data-sort-value="${row.weeklyMedianCallDurationSeconds ?? -1}">${row.weeklyMedianCallDurationSeconds === null ? "—" : `${Number(row.weeklyMedianCallDurationSeconds).toFixed(1)}s`}</td>
            <td data-sort-value="${row.weeklyShortCallCount}">${formatNumber(row.weeklyShortCallCount)}</td>
            <td data-sort-value="${row.weeklyLongCallCount}">${formatNumber(row.weeklyLongCallCount)}</td>
            <td data-sort-value="${row.weeklyCallsPerApprovedSale ?? -1}">${row.weeklyCallsPerApprovedSale === null ? "—" : Number(row.weeklyCallsPerApprovedSale).toFixed(1)}</td>
            <td data-sort-value="${row.reallocations}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.repeatSends", { salesperson: row.salesperson }))}">${formatNumber(row.reallocations)}</a></td>
            <td data-sort-value="${row.approvedSales}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.salesperson }))}">${formatNumber(row.approvedSales)}</a></td>
            <td data-sort-value="${row.approvedSalesValue}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.salesperson }))}">${currency(row.approvedSalesValue)}</a></td>
            <td data-sort-value="${row.allocatedLeadShare}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.salesperson, reconcile: "allocatedLeadShare" }))}">${share(row.allocatedLeadShare)}</a><br /><span class="muted small">${escapeHtml(sourceCoverageDetail(row))}</span></td>
            <td data-sort-value="${row.allocatedLeadSales}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.salesperson, classification: "Company Sourced" }))}">${formatNumber(row.allocatedLeadSales)}</a></td>
            <td data-sort-value="${row.selfSourcedSales}"><a class="data-link" href="${escapeHtml(evidenceHref("performance.approvedOrders", { seller: row.salesperson, classification: "Self Sourced" }))}">${formatNumber(row.selfSourcedSales)}</a></td>
            <td data-sort-value="${row.priorSentLeads ?? -1}" title="Historical aggregate only; no row-level evidence retained.">${row.priorSentLeads === null ? "—" : formatNumber(row.priorSentLeads)}</td>
            <td data-sort-value="${row.priorApprovedSales ?? -1}" title="Historical aggregate only; no row-level evidence retained.">${row.priorApprovedSales === null ? "—" : formatNumber(row.priorApprovedSales)}</td>
            <td data-sort-value="${row.priorAllocatedLeadShare ?? -1}" title="Historical aggregate only; no row-level evidence retained.">${row.priorAllocatedLeadShare === null ? "—" : share(row.priorAllocatedLeadShare)}</td>
            <td data-sort-value="${row.change ?? -999}" title="Derived from current governed evidence and the prior retained aggregate.">${row.change === null ? "—" : `${row.change >= 0 ? "+" : ""}${(row.change * 100).toFixed(1)} pp`}</td>
            <td data-sort-value="${escapeHtml(row.result)}">${escapeHtml(row.result)}</td>
            <td data-sort-value="${row.attributionWithheldSales}">${formatNumber(row.attributionWithheldSales)}</td>
            <td data-sort-value="${escapeHtml(row.sourceAttributionStatus)}">${row.sourceAttributionStatus === "Complete" ? badge("Complete", "success") : row.sourceAttributionStatus === "High coverage" ? badge("High coverage", "notice") : badge("Provisional", "warning")}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="panel-body"><p class="muted small">This table is governed manager evidence. It must not drive automatic discipline, pay, lead removal, compliance, or CRM action. ${payload.dataQuality.callCoverageComplete ? "Leads Uncalled is limited to the governed reporting window." : "Allocated Leads With No Recorded Call remains an operational review backlog, not authoritative ‘not called’."}</p></div>
    </section>
  </div>`;
}

function renderSalesActivityHeatmap(cells = [], options = {}) {
  const dimensionLabel = options.dimensionLabel || "Acquisition source";
  const accessibleDimensionLabel = options.accessibleDimensionLabel
    || dimensionLabel.toLowerCase();
  if (!cells.length) {
    return `<div class="empty">No covered approved-sale ${escapeHtml(accessibleDimensionLabel)}-by-date activity is available for this period.</div>`;
  }
  const dates = Array.from(new Set(cells.map((cell) => cell.approvalDate))).sort();
  const sourceTotals = new Map();
  cells.forEach((cell) => {
    sourceTotals.set(cell.source, (sourceTotals.get(cell.source) || 0) + Number(cell.approvedOrders || 0));
  });
  const sources = Array.from(sourceTotals.keys()).sort((a, b) => (
    sourceTotals.get(b) - sourceTotals.get(a) || a.localeCompare(b)
  ));
  const byKey = new Map(cells.map((cell) => [`${cell.source}|${cell.approvalDate}`, cell]));
  const maximum = Math.max(...cells.map((cell) => Number(cell.approvedOrders || 0)), 1);
  const dateLabel = (value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
  };
  return `<div class="sales-heatmap-wrap">
    <div class="sales-activity-heatmap" role="table" aria-label="${escapeHtml(`Approved orders by ${accessibleDimensionLabel} and approval date`)}" style="--heatmap-columns:${dates.length}">
      <div class="heatmap-corner" role="columnheader">${escapeHtml(dimensionLabel)}</div>
      ${dates.map((date) => `<div class="heatmap-date" role="columnheader"><span>${escapeHtml(dateLabel(date))}</span><small>${escapeHtml(date)}</small></div>`).join("")}
      ${sources.map((source) => `
        <div class="heatmap-source" role="rowheader"><span>${escapeHtml(source)}</span><strong class="mono">${formatNumber(sourceTotals.get(source))}</strong></div>
        ${dates.map((date) => {
          const cell = byKey.get(`${source}|${date}`);
          if (!cell) return `<div class="heatmap-cell empty-cell" role="cell"><span>0</span></div>`;
          const intensity = 0.12 + (Number(cell.approvedOrders || 0) / maximum) * 0.78;
          const content = `<strong class="mono">${formatNumber(cell.approvedOrders)}</strong><small>${escapeHtml(options.currency?.(cell.approvedValue) || formatNumber(cell.approvedValue))}</small>`;
          const href = options.href?.(cell) || "";
          return href
            ? `<a class="heatmap-cell" role="cell" href="${escapeHtml(href)}" style="--heat-intensity:${intensity.toFixed(3)}" aria-label="${escapeHtml(`${source}, ${date}: ${formatNumber(cell.approvedOrders)} approved orders, ${options.currency?.(cell.approvedValue) || formatNumber(cell.approvedValue)}`)}">${content}</a>`
            : `<div class="heatmap-cell" role="cell" style="--heat-intensity:${intensity.toFixed(3)}">${content}</div>`;
        }).join("")}
      `).join("")}
    </div>
  </div>`;
}

function renderPerformanceCohorts(report = {}) {
  if (!report.configured) {
    return `<section class="panel" id="performance-summary">
      <div class="panel-header"><div><p class="page-kicker">Local configuration</p><h2>Performance & Cohorts</h2><p class="muted small">Configure a raw allocation log and the read-only Carma evidence contract to enable this workspace.</p></div>${badge("Not configured", "warning")}</div>
      <div class="panel-body"><div class="empty">No performance cohort source is configured. Raw call analytics remain separate and unchanged.</div></div>
    </section>`;
  }
  if (!report.available) {
    return `<section class="panel" id="performance-summary">
      <div class="panel-header"><div><p class="page-kicker">Source validation</p><h2>Performance & Cohorts unavailable</h2><p class="muted small">The report failed closed before calculating a personnel comparison.</p></div>${badge("Unavailable", "critical")}</div>
      ${renderPerformanceRangeForm(report)}
      <div class="panel-body"><div class="empty">${escapeHtml(report.error || "Performance source validation failed.")}</div></div>
    </section>`;
  }

  const totals = report.totals || {};
  const rows = report.comparison?.rows || [];
  const cohortWindows = report.cohortWindows || [];
  const dataQuality = report.dataQuality || {};
  const uncalledLabel = dataQuality.callCoverageComplete
    ? "Leads Uncalled Within Reporting Window"
    : "Allocated Leads With No Recorded Call by Evidence Cutoff";
  const history = report.history || [];
  const approvedSalesHistory = report.approvedSalesHistory || {};
  const approvedSalesHistoryRows = approvedSalesHistory.rows || [];
  const leadAnalytics = report.leadAnalytics || {};
  const sourceAllocationRows = leadAnalytics.sourceAllocationRows || [];
  const approvedSalesSourceRows = leadAnalytics.approvedSalesByAcquisitionSource || [];
  const leadUsage = leadAnalytics.usage || {};
  const leadLinkage = leadAnalytics.linkage || {};
  const conversionRows = sourceAllocationRows.filter((row) => (
    Number(row.uniqueCustomerRecipientPairs || 0) > 0
  ));
  const currency = (value) => Number(value || 0).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const exactCurrency = (value) => Number(value || 0).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const statusLabel = (row) => {
    if (!row.comparisonEligible) return badge("Low sample", "neutral");
    return badge("Full sample", "notice");
  };
  const cohortValue = (window) => window.status === "measured"
    ? formatPercent(window.conversionRate)
    : "Not mature";
  const conversionMaximum = 100;
  const approvedSalesMaximum = Math.max(
    ...approvedSalesSourceRows.map((row) => Number(row.approvedOrders || 0)),
    1
  );
  const selectedRange = {
    performanceFrom: report.period?.startDate || "",
    performanceTo: report.period?.endDate || ""
  };
  const performanceDrilldown = (metric, filters = {}) => drilldownUrl(metric, {
    ...selectedRange,
    ...filters
  });

  return `<div class="workspace-flow">
    <section class="panel" id="performance-summary">
      <div class="panel-header">
        <div>
          <p class="page-kicker">Lead allocation and observed outcomes</p>
          <h2>${escapeHtml(report.period?.label || "Configured period")}</h2>
          <p class="muted small">Allocation source, volume, age, reuse and exact customer-recipient approvals for the current reporting period. One-week approval rates remain immature.</p>
        </div>
        <div class="stack">${badge("Deterministic", "success")}${badge("Carma read-only", "neutral")}${badge(report.comparison?.salesCoverageStatus === "verified" ? "Sales coverage verified" : "Sales coverage not verified", report.comparison?.salesCoverageStatus === "verified" ? "success" : "warning")}</div>
      </div>
      ${renderPerformanceRangeForm(report)}
      <div class="panel-body metrics">
        ${metricCard("Sent allocation events", formatNumber(totals.deduplicatedSentEvents), `${formatNumber(totals.logicalDuplicateRows)} logical duplicate rows excluded`, "info", performanceDrilldown("performance.sentEvents"))}
        ${metricCard("Distinct allocated leads", formatNumber(leadUsage.uniqueCustomers), `${formatNumber(leadUsage.uniqueCustomerRecipientPairs)} exact customer-recipient pairs`, "info", performanceDrilldown("performance.distinctLeads"))}
        ${metricCard("Approved orders in period", report.comparison?.salesCoverageStatus === "verified" ? formatNumber(leadLinkage.approvedOrdersInPeriod) : "Not scored", report.comparison?.salesCoverageStatus === "verified" ? "Validated all-approved-sales population" : "Sales coverage is not verified", "good", performanceDrilldown("performance.approvedOrders"))}
        ${metricCard("Observed approval rate", leadAnalytics.conversionWindowStatus === "observed_same_week_immature" ? formatPercent(leadLinkage.observedConversionRate) : "Not scored", leadAnalytics.conversionWindowStatus === "observed_same_week_immature" ? `${formatNumber(leadLinkage.exactSourceLinkedConvertedCustomerRecipientPairs)} exact converted pairs / ${formatNumber(leadLinkage.sourceEligibleCustomerRecipientPairs)} source-eligible pairs · one-week immature` : "Not scored until approved-sales coverage is verified", "info", performanceDrilldown("performance.observedConversion", { conversionStatus: "observed_converted" }))}
        ${metricCard("Selected-week linked value", leadAnalytics.conversionWindowStatus === "observed_same_week_immature" ? currency(leadLinkage.exactSourceLinkedApprovedValue) : "Not scored", "CRM approved amount exactly matched to the selected weekly allocation log; not payment, profit or recognised revenue", "info", performanceDrilldown("performance.linkedSales"))}
        ${metricCard("Repeat sent events", formatNumber(leadUsage.repeatSentEventsSameRecipient), `${formatNumber(leadUsage.crossRecipientCustomers)} customers reached more than one recipient; usage signals, not proven waste`, "info", performanceDrilldown("performance.repeatSends"))}
        ${metricCard("Exact call observed", formatNumber(leadAnalytics.callObservation?.observedCalledCustomerRecipientPairs), "Customer-recipient pairs with an exact post-allocation call in the supplied call export", "good", performanceDrilldown("performance.called"))}
        ${metricCard(uncalledLabel, formatNumber(leadAnalytics.callObservation?.noExactCallObservedCustomerRecipientPairs), dataQuality.callCoverageComplete ? "No exact customer-recipient call was recorded inside the governed reporting window" : "Unresolved in the incomplete call supplement; not proof that no call occurred", "warning", performanceDrilldown("performance.noCallObserved"))}
      </div>
      <div class="panel-body"><div class="note"><h3>Local manager surface</h3><p class="muted small">This workspace has no authentication or role-based access control. Keep it local; publishing remains disabled until access control and privacy review are added.</p></div></div>
    </section>

    <div class="lead-chart-grid lead-chart-grid-primary" id="lead-source-mix">
      <section class="panel lead-chart-panel" id="lead-source-flow">
        <div class="panel-header">
          <div><p class="page-kicker">Allocation rhythm</p><h2>Lead Allocation by Source</h2><p class="muted small">Deduplicated sent events by allocation <code>DataSource</code> and observed date. The five largest source values are shown separately; remaining exact values are grouped only here. Absent dates are not treated as zero.</p></div>
          ${badge(`${formatNumber(totals.deduplicatedSentEvents)} events`, "notice")}
        </div>
        <div class="panel-body">${renderDailyAllocationChart(leadAnalytics.dailyAllocations || [], sourceAllocationRows, {
          href: (day) => performanceDrilldown("performance.sentEvents", { sentDate: day.date })
        })}</div>
      </section>

      <section class="panel lead-chart-panel" id="lead-usage">
        <div class="panel-header">
          <div><p class="page-kicker">Quantity and reuse</p><h2>Lead Usage &amp; Reuse</h2><p class="muted small">Source-record quantities that surface repeat use and cross-recipient handling for investigation. They do not independently prove wastage.</p></div>
          ${badge("Usage signals", "neutral")}
        </div>
        <div class="panel-body">${renderLeadUsage(leadUsage, totals, leadAnalytics.allocationFrequency || [], {
          stageHref: (stage) => stage.label === "Sent events"
            ? performanceDrilldown("performance.sentEvents")
            : stage.label === "Customer-recipient pairs"
              ? performanceDrilldown("performance.allocationPairs")
              : stage.label === "Unique leads"
                ? performanceDrilldown("performance.distinctLeads")
                : "",
          repeatHref: performanceDrilldown("performance.repeatSends"),
          crossRecipientHref: performanceDrilldown("performance.crossRecipient"),
          duplicateHref: performanceDrilldown("performance.duplicateRows"),
          frequencyHref: (row) => performanceDrilldown("performance.allocationPairs", {
            allocationFrequency: row.key || row.frequency || row.label
          })
        })}</div>
      </section>
    </div>

    <div class="lead-chart-grid" id="lead-source-outcomes">
      <section class="panel lead-chart-panel" id="lead-conversion">
        <div class="panel-header">
          <div><p class="page-kicker">One-week observation</p><h2>Observed Source Conversion</h2><p class="muted small">Exact customer plus exact recipient seller approved after first allocation and by period end. Rows remain ordered by allocation volume; bars use a shared 0–100% scale.</p></div>
          ${leadAnalytics.conversionWindowStatus === "observed_same_week_immature" ? badge("Immature cohort", "warning") : badge("Not scored", "warning")}
        </div>
        <div class="panel-body">
          ${leadAnalytics.conversionWindowStatus === "observed_same_week_immature" ? renderChartList(conversionRows, {
            label: (row) => row.source,
            value: (row) => row.observedConversionRate,
            valueLabel: (row) => row.observedConversionRate === null
              ? "Not scored"
              : formatPercent(row.observedConversionRate),
            maximum: conversionMaximum,
            tone: "pink",
            visibleLimit: 7,
            lowSample: (row) => Number(row.uniqueCustomerRecipientPairs || 0) < 100,
            status: (row) => row.observedConversionRate === null ? "not_scored" : "",
            href: (row) => performanceDrilldown("performance.observedConversion", { source: row.source }),
            detail: (row) => row.observedConversionRate === null
              ? `<span>Conflicting source values · ${formatNumber(row.uniqueCustomerRecipientPairs)} pairs excluded from the source-rate denominator</span>`
              : `<span>${formatNumber(row.exactConvertedCustomerRecipientPairs)} converted customer-recipient pairs / ${formatNumber(row.uniqueCustomerRecipientPairs)} pairs · ${formatNumber(row.exactApprovedOrders)} approved orders · ${currency(row.exactApprovedValue)}${Number(row.uniqueCustomerRecipientPairs || 0) < 100 ? " · low sample" : ""}</span>`
          }) : `<div class="empty">Observed source conversion is not scored because reconciled all-approved-sales coverage does not span the reporting period.</div>`}
        </div>
        <div class="panel-body lead-chart-boundary"><p class="muted small">Later approvals may increase these rates. This chart is not a mature source-quality ranking and does not establish that an allocation or call caused a sale.</p></div>
      </section>

      <section class="panel lead-chart-panel" id="lead-sales-source">
        <div class="panel-header">
          <div><p class="page-kicker">Approved-sale distribution</p><h2>Approved Sales by Acquisition Source</h2><p class="muted small">Recorded Carma acquisition channels for approved orders in the period; missing or unproven channels display as <strong>Source not recorded</strong>. This taxonomy remains separate from lead classification and allocation <code>DataSource</code>.</p></div>
          ${report.comparison?.salesCoverageStatus === "verified" ? badge(`${formatNumber(leadLinkage.approvedOrdersInPeriod)} orders`, "success") : badge("Not scored", "warning")}
        </div>
        <div class="panel-body">
          ${renderChartList(approvedSalesSourceRows, {
            label: (row) => row.source,
            value: (row) => row.approvedOrders,
            valueLabel: (row) => `${formatNumber(row.approvedOrders)} · ${formatPercent(row.orderShare)}`,
            maximum: approvedSalesMaximum,
            tone: "blue",
            visibleLimit: 7,
            href: (row) => performanceDrilldown("performance.approvedOrders", { acquisitionSource: row.source }),
            detail: (row) => `<span>${currency(row.approvedValue)} CRM approved amount</span>`,
            emptyMessage: report.comparison?.salesCoverageStatus === "verified"
              ? "No approved-sale acquisition sources are available."
              : "Approved sales by acquisition source is not scored until coverage is verified."
          })}
        </div>
      </section>
    </div>

    <section class="panel lead-chart-panel" id="sales-activity-heatmap">
      <div class="panel-header">
        <div><p class="page-kicker">What sold, and when</p><h2>Sales Activity by Lead Classification</h2><p class="muted small">Approved-order quantity by reconciled Company Sourced/Self Sourced classification and approval date. Select any populated cell to inspect the local manager evidence.</p></div>
        ${report.comparison?.salesCoverageStatus === "verified" ? badge("Classification × approval date", "notice") : badge("Not scored", "warning")}
      </div>
      <div class="panel-body">${renderSalesActivityHeatmap(leadAnalytics.salesHeatmap || [], {
        currency,
        dimensionLabel: "Lead classification",
        href: (cell) => performanceDrilldown("performance.salesHeatmap", {
          classification: cell.source,
          approvalDate: cell.approvalDate
        })
      })}</div>
      <div class="panel-body lead-chart-boundary"><p class="muted small">Classification combines complete governed Carma history with positive exact customer-and-full-seller proof from the configured weekly allocation export. A missing weekly match never downgrades Company Sourced. Acquisition channel remains separately visible above.</p></div>
    </section>

    <section class="panel" id="lead-call-observation">
      <div class="panel-header">
        <div><p class="page-kicker">Lead execution evidence</p><h2>Allocation-to-Call Observation</h2><p class="muted small">Exact customer plus exact allocation recipient calls observed at or after first allocation in the selected period.</p></div>
        ${badge(leadAnalytics.callObservation?.status === "complete_exact_join_evidence" ? "Exact joins observed" : "Incomplete supplement", "warning")}
      </div>
      <div class="panel-body metrics">
        ${metricCard("Exact call observed", formatNumber(leadAnalytics.callObservation?.observedCalledCustomerRecipientPairs), "Positive exact-match evidence in the supplied call export", "good", performanceDrilldown("performance.called"))}
        ${metricCard(uncalledLabel, formatNumber(leadAnalytics.callObservation?.noExactCallObservedCustomerRecipientPairs), dataQuality.callCoverageComplete ? "No exact customer-recipient call was recorded inside the governed reporting window" : "Unresolved in this supplement; click to inspect the affected allocation pairs", "warning", performanceDrilldown("performance.noCallObserved"))}
        ${metricCard("Authoritative not called", leadAnalytics.callObservation?.authoritativeNotCalledCustomerRecipientPairs === null ? "Not scored" : formatNumber(leadAnalytics.callObservation.authoritativeNotCalledCustomerRecipientPairs), "Requires a reconciled, closed-window call extraction manifest", "neutral")}
        ${metricCard("Observation through", leadAnalytics.callObservation?.observationThrough || "Unavailable", "Latest valid call date in the supplied supplement", "info")}
      </div>
      <div class="panel-body"><div class="note"><h3>Important boundary</h3><p class="muted small">${escapeHtml(leadAnalytics.callObservation?.limitation || (dataQuality.callCoverageComplete ? "Leads Uncalled is confined to the governed reporting window." : "A missing exact recorded call is not proof that no call occurred."))}</p></div></div>
    </section>

    <div class="lead-chart-grid" id="lead-inventory">
      <section class="panel lead-chart-panel" id="lead-age">
        <div class="panel-header">
          <div><p class="page-kicker">Inventory age</p><h2>Lead Age at Allocation</h2><p class="muted small">Allocation events grouped by calendar days from <code>LeadImportDate_Date</code> to the sent date. No customer-create-date fallback is applied.</p></div>
          ${dataQuality.leadImportDateColumnPresent ? badge("Source dated", "neutral") : badge("Date unavailable", "warning")}
        </div>
        <div class="panel-body">${renderLeadAgeChart(leadAnalytics.leadAgeBuckets || [], totals.deduplicatedSentEvents, {
          href: (row) => performanceDrilldown("performance.leadAge", { leadAgeBucket: row.key })
        })}</div>
      </section>

      <section class="panel lead-chart-panel" id="lead-source-volume">
        <div class="panel-header">
          <div><p class="page-kicker">Source quantity</p><h2>Allocation Volume by Source</h2><p class="muted small">Every exact allocation source remains available. Bars show deduplicated sent-event quantity; distinct pair and customer counts remain visible beneath each value.</p></div>
          ${dataQuality.allocationSourceColumnPresent ? badge(`${formatNumber(sourceAllocationRows.length)} source values`, "neutral") : badge("Source unavailable", "warning")}
        </div>
        <div class="panel-body">
          ${renderChartList(sourceAllocationRows.filter((row) => Number(row.sentAllocationEvents || 0) > 0), {
            label: (row) => row.source,
            value: (row) => row.sentAllocationEvents,
            valueLabel: (row) => formatNumber(row.sentAllocationEvents),
            maximum: Math.max(...sourceAllocationRows.map((row) => Number(row.sentAllocationEvents || 0)), 1),
            tone: "violet",
            visibleLimit: 7,
            href: (row) => performanceDrilldown("performance.sentEvents", { source: row.source }),
            detail: (row) => `<span>${formatNumber(row.uniqueCustomerRecipientPairs)} customer-recipient pairs · ${formatNumber(row.uniqueCustomers)} distinct customers</span>`
          })}
        </div>
      </section>
    </div>

    <section class="panel" id="cohort-conversion">
      <div class="panel-header">
        <div><h2>Mature Cohort Conversion</h2><p class="muted small">Exact customer and exact seller approval within 30, 60 or 90 days after allocation. Only fully matured customers enter a denominator.</p></div>
        ${badge(cohortWindows.some((window) => window.status === "measured") ? "Measured cohorts available" : "Awaiting maturity", cohortWindows.some((window) => window.status === "measured") ? "success" : "warning")}
      </div>
      <div class="panel-body metrics">
        ${cohortWindows.map((window) => metricCard(
          `${formatNumber(window.days)}-day conversion`,
          cohortValue(window),
          window.status === "measured"
            ? `${formatNumber(window.convertedCustomers)} of ${formatNumber(window.matureCustomers)} mature customer-recipient pairs`
            : `Evidence currently runs through ${escapeHtml(window.evidenceThrough)}; no ${formatNumber(window.days)}-day cohort is mature`,
          window.status === "measured" ? "good" : "neutral"
        )).join("")}
      </div>
    </section>

    <section class="panel performance-comparison" id="salesperson-comparison">
      <div class="panel-header">
        <div><h2>Fair Salesperson Comparison</h2><p class="muted small">All source recipients are shown alphabetically. A minimum of ${formatNumber(report.comparison?.minimumAllocations)} sent events marks a fuller sample; it does not create a rank or performance band.</p></div>
        ${badge(`${formatNumber(rows.length)} rows`, "neutral")}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            ${["Sample", "Salesperson", "Manager", "Sent events", "Unique customers", "Approved sales", "Sales proxy", "Call coverage", "Within 24h", "Reallocation"].map((label) => renderTableHeading(label)).join("")}
          </tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td data-label="Sample">${statusLabel(row)}</td>
            <td data-label="Salesperson"><strong>${escapeHtml(row.salesperson)}</strong><br /><span class="muted small">Personnel role not verified</span></td>
            <td data-label="Manager">${escapeHtml((row.managers || [row.manager]).join(", "))}</td>
            <td data-label="Sent events"><a class="data-link" href="${escapeHtml(performanceDrilldown("performance.sentEvents", { salesperson: row.salesperson }))}">${formatNumber(row.sentAllocationEvents)}</a></td>
            <td data-label="Unique customers"><a class="data-link" href="${escapeHtml(performanceDrilldown("performance.distinctLeads", { salesperson: row.salesperson }))}">${formatNumber(row.uniqueCustomers)}</a></td>
            <td data-label="Approved sales"><a class="data-link" href="${escapeHtml(performanceDrilldown("performance.approvedOrders", { seller: row.salesperson }))}">${formatNumber(row.approvedSales)}</a><br /><span class="muted small"><a class="data-link" href="${escapeHtml(performanceDrilldown("performance.approvedOrders", { seller: row.salesperson, classification: "Company Sourced" }))}">${formatNumber(row.companySourcedSales)} Company</a> / <a class="data-link" href="${escapeHtml(performanceDrilldown("performance.approvedOrders", { seller: row.salesperson, classification: "Self Sourced" }))}">${formatNumber(row.selfSourcedSales)} Self</a> · ${currency(row.approvedSalesValue)}</span></td>
            <td data-label="Sales proxy">${row.salesCoverageStatus === "verified" ? `<a class="data-link" href="${escapeHtml(performanceDrilldown("performance.approvedOrders", { seller: row.salesperson }))}"><strong>${formatPercent(row.approvedSalesPerSentEvent)}</strong></a><br /><span class="muted small">${formatPercent(row.approvedSalesPerUniqueCustomer)} per unique customer</span>` : `<strong>Not scored</strong><br /><span class="muted small">Sales coverage unverified</span>`}</td>
            <td data-label="Call coverage">${row.callCoverageStatus === "measured" ? `<a class="data-link" href="${escapeHtml(performanceDrilldown("performance.called", { salesperson: row.salesperson }))}">${formatPercent(row.observedCallCoverageRate)}</a>` : `<strong>Not scored</strong><br /><a class="data-link muted small" href="${escapeHtml(performanceDrilldown("performance.called", { salesperson: row.salesperson }))}">${formatNumber(row.customersCalledAfterAllocation)} observed</a>`}</td>
            <td data-label="Within 24h">${row.callCoverageStatus === "measured" ? formatPercent(row.callWithin24HoursRate) : "Not scored"}</td>
            <td data-label="Reallocation"><a class="data-link" href="${escapeHtml(performanceDrilldown("performance.repeatSends", { salesperson: row.salesperson }))}">${formatNumber(row.reallocationEvents)}</a><br /><span class="muted small">${formatPercent(row.reallocationRate)}</span></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="panel-body"><p class="muted small">This table is descriptive source evidence for manager investigation. It must not be used as an automatic discipline, lead-removal, pay, or CRM decision.</p></div>
    </section>

    <section class="panel" id="performance-history">
      <div class="panel-header"><div><h2>Approved-Sales Evidence Coverage</h2><p class="muted small">Only the reconciled, unfiltered all-customer extraction runs below can supply current conversion denominators. New-customer-only reports and Campaign Quantity snapshots are excluded.</p></div>${badge(`${formatNumber(history.length)} denominator runs`, "success")}</div>
      ${table([
        { label: "Period", render: (row) => escapeHtml(row.period) },
        { label: "Extracted rows", render: (row) => formatNumber(row.approvedSales) },
        { label: "Observed orders", render: (row) => formatNumber(row.observedApprovedSales) },
        { label: "Observed approved value", render: (row) => exactCurrency(row.approvedSalesValue) },
        { label: "Reconciliation", render: (row) => row.coverageStatus === "reconciled" ? badge("Reconciled", "success") : badge("Not eligible", "warning") },
        { label: "Source", render: (row) => escapeHtml(row.sourceLabel || "Carma approved-sales extraction") }
      ], history, "No governed all-approved-sales extraction coverage is available.")}
      ${approvedSalesHistory.available ? `<div class="panel-body"><h3>Long-range Carma report history</h3><p class="muted small">This separate historical context retains both Carma report modes at order level: all approved sales and the exact subset returned by “Show only new customers”. It does not replace the denominator coverage above.</p></div>${table([
        { label: "Period", render: (row) => escapeHtml(row.period) },
        { label: "All approved orders", render: (row) => formatNumber(row.allApprovedOrders) },
        { label: "Carma marked new", render: (row) => `${formatNumber(row.newCustomerOrders)}<br /><span class="muted small">${row.newCustomerShare === null ? "n/a" : `${formatNumber(row.newCustomerShare)}% of orders`}</span>` },
        { label: "All approved value", render: (row) => currency(row.allApprovedValue) },
        { label: "Marked-new value", render: (row) => currency(row.newCustomerApprovedValue) },
        { label: "Classification quality", render: (row) => row.classificationQuality === "exact_report_membership_historical_marker_sparse" ? badge("Historical marker sparse", "warning") : badge("Exact report membership", "success") },
        { label: "Reconciliation", render: (row) => row.reconciliationStatus.startsWith("exact_order_subset_reconciled") ? badge(row.matchedOrderFieldVariations ? `Reconciled · ${formatNumber(row.matchedOrderFieldVariations)} source variations` : "Reconciled", row.matchedOrderFieldVariations ? "notice" : "success") : badge("Not reconciled", "warning") }
      ], approvedSalesHistoryRows, "No classified approved-sales history is available.")}` : `<div class="panel-body"><p class="muted small">${escapeHtml(approvedSalesHistory.error || "The order-level all/new-customer history is not configured.")}</p></div>`}
      ${approvedSalesHistory.available ? `<div class="panel-body"><div class="note"><h3>Important historical boundary</h3><p class="muted small">${escapeHtml(approvedSalesHistory.definitions?.nonMembershipMeaning || "A false new-customer marker is not independent proof of an existing customer.")}. Carma’s marker changes sharply from ${escapeHtml(approvedSalesHistory.definitions?.historicalMarkerCliffStart || "the observed boundary")}; sparse earlier periods stay flagged rather than being presented as clean historical truth.</p></div></div>` : ""}
    </section>

    <section class="panel" id="performance-quality">
      <div class="panel-header"><div><h2>Data Quality & Interpretation</h2><p class="muted small">The report fails closed on required allocation fields and discloses unresolved cross-system identity and date-window differences.</p></div>${dataQuality.callCoverageComplete ? badge(dataQuality.dateWindowMismatch ? "Extra call dates disclosed" : "Call dates covered", dataQuality.dateWindowMismatch ? "warning" : "success") : badge("Call timing not scored", "warning")}</div>
      <div class="panel-body guardrails">
        <div class="note"><h3>Source windows</h3><p class="muted small">Allocation dates: ${(dataQuality.allocationDates || []).map(escapeHtml).join(", ") || "none"}<br />Call dates: ${(dataQuality.callDates || []).map(escapeHtml).join(", ") || "none"}</p></div>
        <div class="note"><h3>Personnel identity</h3><p class="muted small">${escapeHtml(dataQuality.salespersonIdentityRule || "Exact source labels only.")}<br />Shared allocation/call user IDs: ${formatNumber(dataQuality.sharedUserIds)}. Multi-manager recipient labels: ${formatNumber(dataQuality.multipleManagerSalespeople)}.</p></div>
        <div class="note"><h3>Stable joins</h3><p class="muted small">Customer linkage uses exact CustomerID/customer_id only. Phone, fuzzy-name and partial-ID matching are prohibited.</p></div>
        <div class="note"><h3>Lead chart inputs</h3><p class="muted small">Unknown-source sent events: ${formatNumber(leadUsage.unknownSourceSentEvents)}. Conflicting source pairs / conflicting logical rows: ${formatNumber(leadUsage.conflictingSourcePairs)} / ${formatNumber(leadUsage.logicalDimensionConflictRows)}.<br />Lead-import dates valid / missing / invalid / future / conflicting: ${formatNumber(dataQuality.validLeadImportDateEvents)} / ${formatNumber(dataQuality.missingLeadImportDateEvents)} / ${formatNumber(dataQuality.invalidLeadImportDateEvents)} / ${formatNumber(dataQuality.futureLeadImportDateEvents)} / ${formatNumber(dataQuality.conflictingLeadImportDateEvents)}.</p></div>
        <div class="note"><h3>Scoring gates</h3><p class="muted small">Sales coverage: ${escapeHtml(dataQuality.approvedSalesCoverageStatus || "not verified")}. Company-supplied lead call timing: ${dataQuality.callCoverageComplete ? "measured; blank-customer self-sourcing attempts and empty weekends do not block" : "not scored because a genuine identity, timestamp or weekday-coverage issue remains"}. Invalid allocation/call/sale timestamps: ${formatNumber(dataQuality.invalidAllocationTimestamps)} / ${formatNumber(dataQuality.invalidCallTimestamps)} / ${formatNumber(dataQuality.invalidSalesTimestamps)}. Missing call IDs/blocking identity issues: ${formatNumber(dataQuality.missingCallIds)} / ${formatNumber(dataQuality.missingCallJoinKeys)}. Separate customer-ID-free self-sourcing attempts: ${formatNumber(dataQuality.unlinkedSelfSourcingCallAttempts)}.</p></div>
        <div class="note"><h3>Source fingerprints</h3><p class="muted small">Allocation ${escapeHtml(shortHash(report.provenance?.allocationLogSha256))} · Calls ${escapeHtml(shortHash(report.provenance?.callExportSha256))} · Carma ${escapeHtml(shortHash(report.provenance?.carmaEvidenceSha256))} · History ${escapeHtml(shortHash(report.provenance?.approvedSalesHistorySha256))}. Local paths and raw customer rows are not exposed.</p></div>
      </div>
      <div class="panel-body"><details><summary>Definitions and limitations</summary><dl class="definition-list">${Object.entries(report.definitions || {}).map(([key, value]) => `<div><dt>${escapeHtml(humanizeSlug(key))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><ul>${(report.limitations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details></div>
    </section>
  </div>`;
}

function pruneInactiveDashboardWorkspaces(html) {
  let output = String(html || "");
  const inactiveWorkspace = /<(div|section)\b(?=[^>]*\bdata-dashboard-view="[^"]+")[^>]*\bhidden(?:\s|>)[^>]*>/gi;
  let match = inactiveWorkspace.exec(output);

  while (match) {
    const start = match.index;
    const tagName = match[1];
    const matchingTag = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    matchingTag.lastIndex = start + match[0].length;
    let depth = 1;
    let tag = matchingTag.exec(output);

    while (tag && depth > 0) {
      if (/^<\//.test(tag[0])) {
        depth -= 1;
      } else if (!/\/\s*>$/.test(tag[0])) {
        depth += 1;
      }
      if (depth > 0) tag = matchingTag.exec(output);
    }

    if (!tag || depth !== 0) {
      return output;
    }

    output = `${output.slice(0, start)}${output.slice(matchingTag.lastIndex)}`;
    inactiveWorkspace.lastIndex = start;
    match = inactiveWorkspace.exec(output);
  }

  return output;
}

function renderDashboard(analysis, options = {}) {
  const sourceData = analysis || renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export.");
  const activeView = normalizeDashboardView(options.dashboardView || options.view);
  const performanceApiHref = `/api/performance-cohorts?${new URLSearchParams({
    ...(options.performanceCohorts?.period?.startDate ? { performanceFrom: options.performanceCohorts.period.startDate } : {}),
    ...(options.performanceCohorts?.period?.endDate ? { performanceTo: options.performanceCohorts.period.endDate } : {})
  }).toString()}`;
  const leadResultsApiHref = `/api/lead-results-dashboard?${new URLSearchParams({
    ...(options.leadResultsDashboard?.report?.period?.startDate ? { performanceFrom: options.leadResultsDashboard.report.period.startDate } : {}),
    ...(options.leadResultsDashboard?.report?.period?.endDate ? { performanceTo: options.leadResultsDashboard.report.period.endDate } : {})
  }).toString()}`;
  const viewMeta = DASHBOARD_VIEW_META[activeView];
  const activeSegment = normalizeBusinessSegment(options.businessSegment || options.segment);
  const data = scopedDashboardData(sourceData, activeSegment);
  const segmentLabel = businessSegmentLabel(activeSegment);
  const globalFilterQuery = data.filterState?.query || {};
  const filterQueryWithoutBusiness = { ...globalFilterQuery };
  delete filterQueryWithoutBusiness.businessSegment;
  const segmentFilters = activeSegment ? { businessSegment: activeSegment } : {};
  const workspaceAttr = (...views) => `data-dashboard-view="${views.join(" ")}"${views.includes(activeView) ? "" : " hidden"}`;
  const workspaceHref = (view, hash = "") => {
    const normalizedView = normalizeDashboardView(view);
    if (normalizedView === "lead_results") {
      const query = new URLSearchParams();
      const selectedPeriod = options.leadResultsDashboard?.report?.period;
      if (activeView === "lead_results" && selectedPeriod?.startDate) query.set("performanceFrom", selectedPeriod.startDate);
      if (activeView === "lead_results" && selectedPeriod?.endDate) query.set("performanceTo", selectedPeriod.endDate);
      return `/lead-results-dashboard${query.toString() ? `?${query.toString()}` : ""}${hash ? `#${hash}` : ""}`;
    }
    return dashboardFilterUrl({
      ...globalFilterQuery,
      ...segmentFilters,
      view: normalizedView
    }, hash);
  };
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
  const carmaEvidence = options.carmaEvidence || {
    configured: false,
    available: false,
    status: "not_configured",
    readOnly: true,
    totals: {},
    rows: [],
    limitations: []
  };
  const carmaTotals = carmaEvidence.totals || {};
  const carmaRows = (carmaEvidence.rows || []).slice(0, 60);
  const performanceCohorts = options.performanceCohorts || {
    configured: false,
    available: false,
    status: "not_configured",
    comparison: { rows: [] },
    totals: {}
  };
  const leadResultsDashboard = options.leadResultsDashboard || {
    configured: performanceCohorts.configured === true,
    available: false,
    report: performanceCohorts,
    completeness: { checks: {}, unavailableReasons: [] },
    completeRanges: [],
    model: null
  };

  const salespersonRows = data.salespersonScorecards.slice(0, 18);
  const sourceRows = data.sourceMetrics.slice(0, 14);
  const sourceQuality = data.sourceQuality || renderEmptyState("").sourceQuality;
  const sourceQualityTotals = sourceQuality.totals || {};
  const sourceQualitySourceRows = (sourceQuality.sourceRows || []).slice(0, 14);
  const sourceQualityCreatorRows = (sourceQuality.creatorRows || []).slice(0, 12);
  const sourceQualityTypeRows = (sourceQuality.createdByTypeRows || []).slice(0, 6);
  const sourceQualityAgeRows = (sourceQuality.recordAgeBuckets || sourceQuality.importAgeBuckets || []).slice(0, 8);
  const sourceQualityThresholdRows = sourceQuality.newBusinessRecordAgeThresholds || sourceQuality.newBusinessImportAgeThresholds || [];
  const selfSourcingAttribution = data.selfSourcingAttribution || { totals: {}, thresholds: [], legacyImportSources: [], conclusion: {}, limitations: [] };
  const weeklyLeadIntelligence = data.weeklyLeadIntelligence || { totals: {}, originRows: [], weeklyRows: [], workflowFields: [], limitations: [] };
  const aiVoiceAssistant = data.aiVoiceAssistant || renderEmptyState("").aiVoiceAssistant;
  const aiAssistantTotals = aiVoiceAssistant.totals || {};
  const leadReattempt = data.leadReattempt || renderEmptyState("").leadReattempt;
  const followUpOverviewParams = new URLSearchParams({
    ...globalFilterQuery,
    ...segmentFilters,
    requiredAttempts: "4",
    graceDays: "3"
  });
  const followUpOverviewHref = `/reports/follow-up-overview?${followUpOverviewParams.toString()}`;
  const individualFollowUpHref = (salesperson) => `/reports/follow-up-individual?${new URLSearchParams({
    ...globalFilterQuery,
    ...segmentFilters,
    reportSalesperson: salesperson,
    requiredAttempts: "4",
    graceDays: "3"
  }).toString()}`;
  const leadReattemptTotals = leadReattempt.totals || {};
  const leadReattemptSalespersonRows = (leadReattempt.salespersonRows || []).slice(0, 18);
  const leadReattemptHighestRows = (leadReattempt.highestRetrySalespeople || []).slice(0, 10);
  const leadReattemptLiteralRows = (leadReattempt.highestLiteralNoContactSalespeople || []).slice(0, 10);
  const leadReattemptSourceRows = (leadReattempt.sourceRows || []).slice(0, 12);
  const leadReattemptRegionRows = (leadReattempt.regionRows || []).slice(0, 12);
  const leadReattemptSegmentRows = leadReattempt.businessSegmentRows || [];
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
  const aiAssistantEncounterRate = Number(data.rates.aiVoiceAssistantEncounter || aiAssistantTotals.encounterRate || 0);
  const riskReviewRate = percentOf(data.totals.riskReviews, uniqueCalls);
  const totalUniqueCalls = Number(sourceData.totals.uniqueCalls || 0);
  const warmBusinessCalls = Number(sourceData.totals.warmBusinessCalls || 0);
  const newBusinessCalls = Number(sourceData.totals.newBusinessCalls || Math.max(0, totalUniqueCalls - warmBusinessCalls));
  const warmBusinessRate = Number(sourceData.rates.warmBusiness || percentOf(warmBusinessCalls, totalUniqueCalls));
  const newBusinessRate = Number(sourceData.rates.newBusiness || percentOf(newBusinessCalls, totalUniqueCalls));
  const businessRelationship = sourceData.businessRelationship || {
    exactCalls: 0,
    supportingCalls: 0,
    fallbackCalls: totalUniqueCalls,
    unknownCalls: 0
  };
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
    opportunities: data.salesOpportunityActionCentre?.capabilityBoundary?.operationalConsumptionPermitted === true
      ? [["opportunity-readiness", "Readiness"], ["opportunity-funnel", "Funnel"], ["opportunity-actions", "Action queues"], ["opportunity-cohorts", "Cohorts"], ["opportunity-results", "Contributing calls"]]
      : [["opportunity-readiness", "Trust boundary"]],
    harvest: [["lead-harvest", "Review queue"], ["harvest-objections", "Objections"], ["harvest-evidence", "Evidence"]],
    follow_up: [["lead-reattempts", "Reattempts"], ["lead-utilization", "Follow-up proof"]],
    reviews: [["alerts", "Alerts & reviews"]],
    team: [["salespeople", "Salespeople"], ["sources", "Sources"], ["source-quality", "Source quality"], ["ai-assistants", "AI assistants"], ["system-audio", "System audio"]],
    intelligence: [["provenance", "Provenance"], ["evaluation-results", "Evaluation results"], ["intelligence", "Call intelligence"], ["intelligence-queue", "Evidence queue"]],
    performance: [["performance-summary", "Lead summary"], ["lead-source-mix", "Source & lead mix"], ["cohort-conversion", "Mature cohorts"], ["salesperson-comparison", "Salespeople"], ["performance-history", "History"], ["performance-quality", "Data quality"]],
    lead_results: [["lead-results-summary", "Summary"], ["lead-results-manager-charts", "Manager charts"], ["lead-results-manager-summary", "Manager summary"], ["lead-results-performance-views", "Performance & trophies"], ["lead-results-checks", "Checks"], ["performance-rankings", "Performance rankings"]],
    records: [["carma-evidence", "Carma evidence"], ["explorer", "Call explorer"], ["confidence", "Data confidence"], ["history", "Imports"], ["reports", "Reports"]]
  };
  const currentSectionLinks = sectionLinksByView[activeView] || sectionLinksByView.overview;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sales Dashboard</title>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700;800&display=swap");
      ${COLUMN_HELP_STYLES}
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
        grid-template-columns: minmax(0, 1fr);
        gap: 18px;
        align-content: start;
        min-width: 0;
        max-width: 100%;
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
        color: inherit;
        text-decoration: none;
      }
      a.dataset-fact:hover { border-color: rgba(86, 214, 229, 0.55); background: var(--surface-soft); }
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
      .opportunity-workspace { display: grid; gap: 14px; min-width: 0; }
      .opportunity-warning-list { display: grid; gap: 8px; padding: 0 17px 17px; }
      .opportunity-warning-list .callout { padding: 10px 12px; border: 1px solid rgba(245, 158, 11, 0.32); border-left: 3px solid var(--warning); border-radius: 7px; color: var(--muted-foreground); background: rgba(245, 158, 11, 0.06); font-size: 13px; line-height: 1.45; }
      .opportunity-funnel { display: grid; grid-template-columns: repeat(7, minmax(130px, 1fr)); gap: 8px; padding: 17px; overflow-x: auto; }
      .opportunity-stage { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; min-width: 145px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 8px; color: inherit; background: var(--surface-elevated); text-decoration: none; }
      .opportunity-stage:hover, .opportunity-stage.selected { border-color: var(--accent); background: var(--surface-soft); }
      .opportunity-stage-number { display: grid; place-items: center; width: 23px; height: 23px; border-radius: 50%; color: var(--background); background: var(--accent); font-size: 11px; font-weight: 850; }
      .opportunity-stage strong, .opportunity-stage small, .opportunity-stage-value { display: block; }
      .opportunity-stage strong { min-height: 34px; font-size: 12px; }
      .opportunity-stage-value { margin: 8px 0 5px; color: var(--accent); font-weight: 800; }
      .opportunity-stage small { color: var(--muted-foreground); line-height: 1.35; }
      .action-queue-grid { display: grid; grid-template-columns: repeat(4, minmax(190px, 1fr)); gap: 10px; padding: 17px; }
      .action-queue-card { display: grid; gap: 9px; min-width: 0; padding: 14px; border: 1px solid var(--border-subtle); border-radius: 8px; color: inherit; background: var(--surface-elevated); text-decoration: none; }
      .action-queue-card:hover, .action-queue-card.selected { border-color: var(--primary); background: var(--surface-soft); }
      .action-queue-card small { color: var(--muted-foreground); line-height: 1.4; }
      .action-queue-count { color: var(--primary); font-size: 25px; font-weight: 850; }
      #opportunity-cohorts > h3 { padding: 0 17px; }
      .opportunity-records { display: grid; gap: 12px; padding: 17px; }
      .opportunity-record { min-width: 0; padding: 16px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); }
      .opportunity-record-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .opportunity-record-head > div:first-child { display: grid; gap: 4px; }
      .opportunity-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 14px 0; border: 1px solid var(--border-subtle); border-radius: 7px; overflow: hidden; background: var(--border-subtle); }
      .opportunity-facts > div { min-width: 0; padding: 10px; background: var(--surface); }
      .opportunity-facts dt { margin-bottom: 5px; color: var(--muted-foreground); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .opportunity-facts dd { margin: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; }
      .opportunity-action, .commercial-boundary { display: grid; gap: 5px; margin-top: 10px; padding: 11px; border-radius: 7px; background: var(--surface-soft); font-size: 13px; line-height: 1.45; }
      .commercial-boundary { border-left: 3px solid var(--warning); color: var(--muted-foreground); }
      .opportunity-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
      .opportunity-proof { margin-top: 14px; }
      .opportunity-proof ul { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
      .opportunity-proof li { display: grid; gap: 3px; padding: 9px 10px; border-left: 2px solid var(--accent); background: var(--surface); }
      .opportunity-proof q { overflow-wrap: anywhere; font-size: 13px; line-height: 1.45; }
      .opportunity-record details { margin-top: 12px; }
      .opportunity-pagination { padding: 0 17px 17px; }
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
      .performance-comparison .warning-row { background: rgba(245, 158, 11, 0.06); }
      .performance-comparison td strong { color: var(--foreground); }
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
        .action-queue-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .opportunity-funnel { grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; }
        .opportunity-stage { min-width: 0; }
        .opportunity-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 640px) {
        main { padding: 16px; }
        .topbar, .panel-header, aside { flex-direction: column; align-items: stretch; }
        .topbar .stack { min-width: 0; width: 100%; }
        .topbar .badge { width: 100%; white-space: normal; overflow-wrap: anywhere; }
        .product-switcher { width: 100%; }
        .workspace-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .metrics, .attention-grid, .dataset-grid, .dataset-grid-primary, .filter-form, .filter-form.advanced, .studio-form { grid-template-columns: 1fr; }
        .segment-split { grid-template-columns: 1fr; }
        .command-meta, .pipeline-row { grid-template-columns: 1fr; }
        .pipeline-value { text-align: left; }
        .action-queue-grid, .opportunity-funnel, .opportunity-facts { grid-template-columns: 1fr; }
        .opportunity-record-head { flex-direction: column; }
        .opportunity-cohort-table .table-wrap { overflow: visible; }
        .performance-comparison .table-wrap { overflow: visible; }
        .opportunity-cohort-table table, .opportunity-cohort-table tbody, .opportunity-cohort-table tr, .opportunity-cohort-table td,
        .performance-comparison table, .performance-comparison tbody, .performance-comparison tr, .performance-comparison td { display: block; width: 100%; min-width: 0; }
        .opportunity-cohort-table thead, .performance-comparison thead { display: none; }
        .opportunity-cohort-table tr, .performance-comparison tr { padding: 8px 0; border-bottom: 1px solid var(--border); }
        .opportunity-cohort-table td, .performance-comparison td { display: grid; grid-template-columns: minmax(110px, 0.8fr) minmax(0, 1fr); gap: 10px; border-bottom: 1px solid var(--border-subtle); overflow-wrap: anywhere; }
        .opportunity-cohort-table td::before, .performance-comparison td::before { content: attr(data-label); color: var(--muted-foreground); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      }
      ${PANELIFY_THEME_STYLES}
    </style>
  </head>
  <body data-dashboard-view="${escapeHtml(activeView)}">
    <div class="layout">
      <aside aria-label="Application navigation">
        <div class="brand">
          <div class="brand-identity">
            <span class="brand-monogram" aria-hidden="true">SD</span>
            <div class="brand-logo"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></div>
            <div>
              <div class="brand-title">Sales Dashboard</div>
              <p class="brand-subtitle">Manager reporting and evidence.</p>
            </div>
          </div>
          <button class="sidebar-collapse" type="button" data-sidebar-toggle aria-label="Collapse navigation" aria-expanded="true"><span class="sidebar-collapse-mark" aria-hidden="true"></span></button>
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
          <a class="active" href="${escapeHtml(workspaceHref(activeView, "overview"))}" aria-current="page"><span class="nav-icon" aria-hidden="true">S</span><span class="nav-text">Sales Dashboard</span></a>
          <a href="/evaluation-studio"><span class="nav-icon" aria-hidden="true">E</span><span class="nav-text">Evaluation Studio</span></a>
        </div>
        <nav aria-label="Sales Dashboard workspaces">
          <span class="nav-label">Workspace</span>
          ${Object.entries(DASHBOARD_VIEW_META).map(([key, meta]) => `<a class="${key === activeView ? "active" : ""}" href="${escapeHtml(workspaceHref(key, key === "overview" ? "overview" : ""))}" ${key === activeView ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${escapeHtml(meta.icon)}</span><span class="nav-text">${escapeHtml(meta.label)}</span></a>`).join("")}
          <span class="nav-label">On this page</span>
          ${currentSectionLinks.map(([id, label]) => `<a class="on-page-link" href="#${escapeHtml(id)}"><span class="nav-icon" aria-hidden="true">&middot;</span><span class="nav-text">${escapeHtml(label)}</span></a>`).join("")}
        </nav>
      </aside>
      <button class="sidebar-overlay" type="button" data-sidebar-overlay aria-label="Close navigation"></button>
      <div class="app-frame">
        <nav class="app-topnav" aria-label="Dashboard utilities">
          <button class="sidebar-collapse sidebar-mobile-toggle" type="button" data-sidebar-toggle aria-label="Open navigation" aria-expanded="false"><span class="sidebar-collapse-mark" aria-hidden="true"></span></button>
          <div class="topnav-context">
            <span>Sales Dashboard / ${escapeHtml(viewMeta.label)}</span>
            <strong>${escapeHtml(viewMeta.kicker)}</strong>
          </div>
          <form class="top-search" method="get" action="/drilldown" role="search">
            <input type="hidden" name="metric" value="calls.unique" />
            <span class="search-mark" aria-hidden="true"></span>
            <input type="search" name="customerId" aria-label="Search exact customer ID" placeholder="Search exact customer ID" />
            <button type="submit">Search</button>
          </form>
          <div class="topnav-actions">
            <a class="topnav-link" href="${activeView === "performance" ? escapeHtml(performanceApiHref) : activeView === "lead_results" ? escapeHtml(leadResultsApiHref) : "#filters"}">${["performance", "lead_results"].includes(activeView) ? "Data API" : "Filters"}</a>
            <a class="topnav-link" href="/evaluation-studio">Evaluation Studio</a>
          </div>
        </nav>
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
            ${!["performance", "lead_results"].includes(activeView) ? (hasAnyData ? badge("CSV loaded", "success") : badge("No CSV loaded", "warning")) : ""}
            ${carmaEvidence.available ? badge("Carma linked read-only", "success") : badge("Carma not linked", "neutral")}
            ${activeView === "performance" ? badge(performanceCohorts.available ? "Performance data ready" : "Performance data unavailable", performanceCohorts.available ? "success" : "warning") : ""}
            ${activeView === "lead_results" ? badge(leadResultsDashboard.available ? "Complete Lead Results ready" : "Complete Lead Results unavailable", leadResultsDashboard.available ? "success" : "warning") : ""}
            ${activeSegment ? badge(`${segmentLabel} view`, "notice") : ""}
            ${badge(["performance", "lead_results"].includes(activeView) ? (performanceCohorts.period?.label || "No performance period") : formatDateRange(data.dateRange), "neutral")}
          </div>
        </header>

        ${!["performance", "lead_results"].includes(activeView) ? renderDatasetBanner(sourceData, persistence) : ""}

        ${hasAnyData && !["performance", "lead_results"].includes(activeView) ? renderGlobalFilters(data, { dashboardView: activeView }) : ""}

        ${["overview", "intelligence"].includes(activeView) ? renderProcessingStatePanel(data, persistence, intelligenceTotals) : ""}

        <div class="workspace-flow" ${workspaceAttr("intelligence")}>
          ${renderEvaluationStudioDashboardSummary(persistence)}
        </div>

        ${!["performance", "lead_results"].includes(activeView) && !hasAnyData ? `<section class="panel"><div class="panel-body"><div class="empty">${escapeHtml(data.emptyMessage)}</div></div></section>` : ""}
        ${!["performance", "lead_results"].includes(activeView) && hasAnyData && !hasData ? `<section class="panel"><div class="panel-body"><div class="empty">No calls match the selected filters. Clear filters or broaden the date range before interpreting performance.</div></div></section>` : ""}

        <div class="workspace-flow" ${workspaceAttr("performance")}>
          ${renderPerformanceCohorts(performanceCohorts)}
        </div>

        <div class="workspace-flow" ${workspaceAttr("lead_results")}>
          ${renderLeadResultsDashboard(leadResultsDashboard)}
        </div>

        <div class="workspace-flow" ${workspaceAttr("opportunities")}>
          ${hasData ? renderSalesOpportunityActionCentre(data.salesOpportunityActionCentre || {}, {
            globalFilters: globalFilterQuery,
            segmentFilters,
            opportunityStage: options.opportunityStage,
            opportunityQueue: options.opportunityQueue
          }) : ""}
        </div>

        <div class="${hasAnyData && !hasData ? "filtered-no-data-body" : ""}">
        <section class="command-grid" aria-label="Executive command overview" ${workspaceAttr("overview")}>
          <article class="command-panel primary">
            <div class="command-panel-inner">
              <p class="page-kicker">Primary operating signal</p>
              <h2>Call Activity</h2>
              <div class="command-value mono">${hrefDataLink(formatNumber(uniqueCalls), drilldownUrl("calls.unique", withSegment()), "View active calls")}</div>
              <p class="muted small" style="margin-top: 10px;">Active deduplicated calls. No automated conversation-quality judgment is authorised.</p>
              <div class="command-meta">
                <div class="mini-stat"><span>Transcripts</span><strong class="mono">${hrefDataLink(formatPercent(transcriptCoverage), drilldownUrl("calls.transcriptAvailable", withSegment()))}</strong></div>
                <div class="mini-stat"><span>New business</span><strong class="mono">${formatPercent(newBusinessRate)}</strong></div>
                <div class="mini-stat"><span>Warm business</span><strong class="mono">${formatPercent(warmBusinessRate)}</strong></div>
              </div>
            </div>
          </article>
          <article class="command-panel">
            <div class="panel-header">
              <div>
                <h2>Trusted Data Coverage</h2>
                <p class="muted small">Raw call facts and restricted literal triage only. Semantic transcript decisions are unavailable.</p>
              </div>
              ${linkedBadge(`${formatNumber(data.totals.salespeople || 0)} salespeople`, "neutral", drilldownUrl("calls.unique", withSegment()))}
            </div>
            <div class="command-panel-inner">
              <div class="pipeline">
                ${pipelineBar("Unique calls", formatNumber(uniqueCalls), 100, "primary", drilldownUrl("calls.unique", withSegment()))}
                ${pipelineBar("New business", `${formatNumber(newBusinessCalls)} (${formatPercent(newBusinessRate)})`, newBusinessRate, "accent", dashboardSegmentHref("new"))}
                ${pipelineBar("Warm business", `${formatNumber(warmBusinessCalls)} (${formatPercent(warmBusinessRate)})`, warmBusinessRate, "primary", dashboardSegmentHref("warm"))}
                ${pipelineBar("Transcript coverage", formatPercent(transcriptCoverage), transcriptCoverage, "accent", drilldownUrl("calls.transcriptAvailable", withSegment()))}
                ${pipelineBar("Literal AI-assistant phrases", `${formatNumber(aiAssistantTotals.encounters || 0)} (${formatPercent(aiAssistantEncounterRate)})`, aiAssistantEncounterRate, "warning", drilldownUrl("calls.aiVoiceAssistant", withSegment()))}
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
              ${badge("Binary event-time policy", "neutral")}
            </div>
          </div>
          <div class="panel-body segment-split">
            <a class="segment-card accent ${activeSegment === "new" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentHref("new"))}" aria-current="${activeSegment === "new" ? "true" : "false"}">
              <span>New Business</span>
              <strong class="mono">${formatNumber(newBusinessCalls)}</strong>
              <small>${formatPercent(newBusinessRate)} of unique calls | No prior sale established before call</small>
            </a>
            <a class="segment-card primary ${activeSegment === "warm" ? "selected" : ""}" href="${escapeHtml(dashboardSegmentHref("warm"))}" aria-current="${activeSegment === "warm" ? "true" : "false"}">
              <span>Warm Business</span>
              <strong class="mono">${formatNumber(warmBusinessCalls)}</strong>
              <small>${formatPercent(warmBusinessRate)} of unique calls | Prior invoice/order established</small>
            </a>
            <div class="segment-track" aria-label="New Business and Warm Business call split">
              <span class="segment-fill new" style="width: ${Math.max(0, Math.min(100, newBusinessRate)).toFixed(1)}%;"></span>
              <span class="segment-fill warm" style="width: ${Math.max(0, Math.min(100, warmBusinessRate)).toFixed(1)}%;"></span>
            </div>
          </div>
        </section>

        <section class="metrics" aria-label="Executive overview" ${workspaceAttr("overview")}>
          ${metricCard("Unique calls", formatNumber(data.totals.uniqueCalls), `${formatNumber(data.totals.rawRows)} ${activeSegment ? "segment rows" : "raw rows"}, ${formatNumber(data.totals.duplicateCallIds)} duplicate IDs`, "info", drilldownUrl("calls.unique", withSegment()))}
          ${metricCard("Transcript coverage", formatPercent(data.rates.transcriptCoverage), `${formatNumber(data.totals.transcriptAvailable)} transcript records available; a blank does not prove no answer`, "info", drilldownUrl("calls.transcriptAvailable", withSegment()))}
          ${metricCard("New Business", formatNumber(newBusinessCalls), `${formatPercent(newBusinessRate)} of active calls`, "info", dashboardSegmentHref("new"))}
          ${metricCard("Warm Business", formatNumber(warmBusinessCalls), `${formatPercent(warmBusinessRate)} of active calls`, "info", dashboardSegmentHref("warm"))}
          ${metricCard("Literal AI-assistant phrases", formatNumber(aiAssistantTotals.encounters || 0), "Detection only; handling was not scored", "warn", drilldownUrl("calls.aiVoiceAssistant", withSegment()))}
          ${metricCard("Direct opt-out review", formatNumber(data.totals.riskReviews), "Exact customer opt-out phrase; verify transcript before action", "risk", drilldownUrl("calls.riskReviews", withSegment()))}
          ${metricCard("Semantic transcript evaluation", "Unavailable", "No automated quality, outcome, callback, or coaching decision", "neutral")}
          ${metricCard("Reports stored", formatNumber(persistence.counts.reports), `${formatNumber(persistence.counts.imports)} saved import snapshots`, "info", workspaceHref("records", "reports"))}
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
            <a class="attention-item danger" href="${escapeHtml(workspaceHref("reviews", "alerts"))}">
              <span>Direct opt-out alerts</span><strong class="mono">${formatNumber(activeAlertCount)}</strong><small>Literal customer opt-out phrases awaiting human verification.</small>
            </a>
            <a class="attention-item warning" href="${escapeHtml(workspaceHref("reviews", "alerts"))}">
              <span>Review needed</span><strong class="mono">${formatNumber(managerReviewNeededCount)}</strong><small>Calls requiring a manager decision, correction, or dismissal.</small>
            </a>
            <a class="attention-item" href="${escapeHtml(workspaceHref("intelligence", "intelligence"))}">
              <span>Semantic decisions</span><strong class="mono">0</strong><small>Unavailable until an exact evaluator passes frozen promotion.</small>
            </a>
          </div>
          <p class="muted small">${formatNumber(businessRelationship.exactCalls || 0)} calls use exact invoice/order timing, ${formatNumber(businessRelationship.supportingCalls || 0)} use dated supporting evidence, and ${formatNumber(businessRelationship.fallbackCalls || 0)} use the labelled binary fallback. Unknown calls: 0.</p>
        </section>

        <div class="workspace-flow" ${workspaceAttr("follow_up")}>
        <section class="panel" id="lead-reattempts">
          <div class="panel-header">
            <div>
              <h2>Lead Reattempt Behaviour &amp; Salesperson Evidence</h2>
              <p class="muted small">Matched customer/contact call counts plus restricted literal no-contact evidence. The separate report applies a four-attempt policy and a three-day observation window without turning ambiguous calls into findings.</p>
            </div>
            <div class="drill-actions">
              ${linkedBadge(`${formatNumber(leadReattemptTotals.leadsTouched || 0)} matched records`, leadReattemptTotals.leadsTouched ? "success" : "warning", drilldownUrl("reattempt.leadsTouched", withSegment()))}
              <a class="button-link" href="${escapeHtml(followUpOverviewHref)}">Open defensible overview report</a>
            </div>
          </div>
          <div class="panel-body metrics">
            ${metricCard("Personal retry rate", formatPercent(leadReattemptTotals.personalRetryRate), `${formatNumber(leadReattemptTotals.personallyRetriedLeads || 0)} records retried by same salesperson`, "good", drilldownUrl("reattempt.personalRetried", withSegment()))}
            ${metricCard("One-dial records", formatPercent(leadReattemptTotals.oneAndDoneRate), `${formatNumber(leadReattemptTotals.oneAndDoneLeads || 0)} records dialed once`, "warn", drilldownUrl("reattempt.oneAndDone", withSegment()))}
            ${metricCard("Literal one-dial no-contact, no later match", formatPercent(leadReattemptTotals.literalOneDialNoContactNoLaterRate), `${formatNumber(leadReattemptTotals.literalOneDialNoContactNoLaterLeads || 0)} matched records`, "info", drilldownUrl("reattempt.oneDialLiteralNoContactNoLater", withSegment()))}
            ${metricCard("Literal one-dial no-contact", formatPercent(leadReattemptTotals.literalOneDialNoContactRate), `${formatNumber(leadReattemptTotals.literalOneDialNoContactLeads || 0)} of one-dial records`, "info", drilldownUrl("reattempt.oneDialLiteralNoContact", withSegment()))}
            ${metricCard("Literal terminal one-dial states", formatPercent(leadReattemptTotals.validOneDialOutcomeRate), `${formatNumber(leadReattemptTotals.validOneDialOutcomeLeads || 0)} of one-dial records`, "info", drilldownUrl("reattempt.oneDialValidOutcome", withSegment()))}
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
              <p class="muted small">Click a metric for exact-ID proof, or generate the individual report only when a manager needs the complete evidence chain.</p>
            </div>
          </div>
          ${table([
            { label: "Salesperson", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("reattempt.leadsTouched", withSegment({ salesperson: row.salesperson })))}">${escapeHtml(row.salesperson)}</a>` },
            { label: "Records dialed", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ salesperson: row.salesperson })) },
            { label: "Personal retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
            { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
            { label: "Valid", render: (row) => dataLink("reattempt.oneDialValidOutcome", formatNumber(row.validOneDialOutcomeLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "Literal no-contact", render: (row) => dataLink("reattempt.oneDialLiteralNoContact", formatNumber(row.literalOneDialNoContactLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatNumber(row.literalOneDialNoContactNoLaterLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "Ambiguous excluded", render: (row) => dataLink("reattempt.oneDialNeedsReview", formatNumber(row.oneDialNeedsReviewLeads), withSegment({ salesperson: row.salesperson })) },
            { label: "No later by anyone", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ salesperson: row.salesperson })) },
            { label: "Avg calls/lead", render: (row) => dataLink("reattempt.leadsTouched", formatDecimal(row.averageCallsPerLead), withSegment({ salesperson: row.salesperson })) },
            { label: "Max attempts", render: (row) => dataLink("reattempt.maxAttemptsOnOneLead", formatNumber(row.maxAttemptsOnOneLead), withSegment({ salesperson: row.salesperson, maxAttempts: row.maxAttemptsOnOneLead })) },
            { label: "Individual report", render: (row) => `<a class="button-link" href="${escapeHtml(individualFollowUpHref(row.salesperson))}">Generate</a>` }
          ], leadReattemptSalespersonRows, "No matched reattempt rows are available.")}
        </section>

        <section class="grid-2">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Most Repeated Outreach</h2>
                <p class="muted small">Salespeople with at least 25 matched records, ordered by same-salesperson retry rate. This is activity, not a quality ranking.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => dataLink("reattempt.leadsTouched", row.salesperson, withSegment({ salesperson: row.salesperson })) },
              { label: "Records", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ salesperson: row.salesperson })) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatPercent(row.literalOneDialNoContactNoLaterRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Avg calls", render: (row) => dataLink("reattempt.leadsTouched", formatDecimal(row.averageCallsPerLead), withSegment({ salesperson: row.salesperson })) }
            ], leadReattemptHighestRows, "No high-volume retry rows are available.")}
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2>Largest One-Dial Literal No-Contact Share</h2>
                <p class="muted small">Salespeople with at least 25 matched records, ordered by literal no-contact rows with no later matching call in this dataset. This is an activity view, not a performance judgement.</p>
              </div>
            </div>
            ${table([
              { label: "Salesperson", render: (row) => dataLink("reattempt.leadsTouched", row.salesperson, withSegment({ salesperson: row.salesperson })) },
              { label: "Records", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ salesperson: row.salesperson })) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ salesperson: row.salesperson })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatPercent(row.literalOneDialNoContactNoLaterRate), withSegment({ salesperson: row.salesperson })) },
              { label: "Ambiguous excluded", render: (row) => dataLink("reattempt.oneDialNeedsReview", formatNumber(row.oneDialNeedsReviewLeads), withSegment({ salesperson: row.salesperson })) },
              { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ salesperson: row.salesperson })) }
            ], leadReattemptLiteralRows, "No literal one-dial no-contact/no-later rows are available.")}
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
            { label: "Records", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), { businessSegment: row.businessSegment }) },
            { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), { businessSegment: row.businessSegment }) },
            { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), { businessSegment: row.businessSegment }) },
            { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatPercent(row.literalOneDialNoContactNoLaterRate), { businessSegment: row.businessSegment }) },
            { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), { businessSegment: row.businessSegment }) },
            { label: "Avg calls", render: (row) => dataLink("reattempt.leadsTouched", formatDecimal(row.averageCallsPerLead), { businessSegment: row.businessSegment }) }
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
              { label: "Records", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ source: row.source })) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ source: row.source })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ source: row.source })) },
              { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatPercent(row.literalOneDialNoContactNoLaterRate), withSegment({ source: row.source })) },
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
              { label: "Records", render: (row) => dataLink("reattempt.leadsTouched", formatNumber(row.leadsTouched), withSegment({ region: row.region })) },
              { label: "Retry", render: (row) => dataLink("reattempt.personalRetried", formatPercent(row.personalRetryRate), withSegment({ region: row.region })) },
              { label: "One-dial", render: (row) => dataLink("reattempt.oneAndDone", formatPercent(row.oneAndDoneRate), withSegment({ region: row.region })) },
              { label: "Literal no-contact, no later", render: (row) => dataLink("reattempt.oneDialLiteralNoContactNoLater", formatPercent(row.literalOneDialNoContactNoLaterRate), withSegment({ region: row.region })) },
              { label: "No later", render: (row) => dataLink("reattempt.noLaterCallByAnyone", formatPercent(row.noLaterCallByAnyoneRate), withSegment({ region: row.region })) }
            ], leadReattemptRegionRows, "No region pattern rows are available.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("records")}>
        <section class="panel" id="source-quality">
          <div class="panel-header">
            <div>
              <h2>Customer Source Records</h2>
              <p class="muted small">Bulk/manual source fields and record ages come directly from the imported call data. They describe record provenance and age only; they do not measure lead quality or seller performance.</p>
            </div>
            ${linkedBadge(`${formatNumber(sourceQualityTotals.callsWithRecordAge || 0)} record ages`, sourceQualityTotals.callsWithRecordAge ? "success" : "warning", drilldownUrl("source.recordAgeAvailable", withSegment()))}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Bulk sourced calls", formatNumber(sourceQualityTotals.callsWithBulkSource), `${formatPercent(sourceQualityTotals.bulkSourceCoverageRate)} source coverage`, "info", drilldownUrl("source.bulkSourced", withSegment()))}
            ${metricCard("New Business >90d record age", formatNumber(sourceAge90.calls), `${formatPercent(sourceAge90.rate)} of New Business calls`, "risk", drilldownUrl("source.newBusinessRecordOlderThan", withSegment({ minImportAgeDays: 90 })))}
            ${metricCard("Manual LG/SP calls", formatNumber(sourceQualityTotals.callsWithManualCreator), `${formatNumber(sourceQualityTotals.leadGeneratorCreatedCalls)} LG, ${formatNumber(sourceQualityTotals.salespersonCreatedCalls)} SP`, "good", drilldownUrl("source.manualCreated", withSegment()))}
            ${metricCard("Self sourced no raw attribution", formatNumber(sourceQualityTotals.callsMissingSourceAttribution), `${formatPercent(sourceQualityTotals.missingSourceAttributionRate)} inferred Self Sourced records`, "info", drilldownUrl("source.missingAttribution", withSegment()))}
            ${metricCard("Record-age coverage", formatNumber(sourceQualityTotals.callsWithRecordAge || 0), "Rows with a valid import or creation date", "info", drilldownUrl("source.recordAgeAvailable", withSegment()))}
          </div>
        </section>

        <section class="panel" id="self-sourcing-attribution">
          <div class="panel-header">
            <div>
              <h2>Self-Sourcing Attribution Audit</h2>
              <p class="muted small">Tests whether the call mix is dominated by long-held CRM records, while keeping a strict boundary between an attribution-review signal and proof that a salesperson found a number online.</p>
            </div>
            ${badge(selfSourcingAttribution?.conclusion?.longHeldRecordsAreMajority ? "Long-held records are the majority" : "Long-held records are not the majority", selfSourcingAttribution?.conclusion?.longHeldRecordsAreMajority ? "warning" : "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("New Business calls", formatNumber(selfSourcingAttribution?.totals?.newBusinessCalls || 0), "Event-time relationship policy", "info", drilldownUrl("calls.newBusiness", withSegment({ businessSegment: "new" })))}
            ${metricCard("Records >90 days", formatNumber(selfSourcingAttribution?.thresholds?.find((row) => row.thresholdDays === 90)?.longHeldRecordCalls || 0), `${formatPercent(selfSourcingAttribution?.thresholds?.find((row) => row.thresholdDays === 90)?.longHeldRecordRate || 0)} of New Business calls`, "risk", drilldownUrl("source.newBusinessRecordOlderThan", withSegment({ businessSegment: "new", minImportAgeDays: 90 })))}
            ${metricCard("Confirmed imports >90 days", formatNumber(selfSourcingAttribution?.thresholds?.find((row) => row.thresholdDays === 90)?.confirmedLegacyImportCalls || 0), `${formatPercent(selfSourcingAttribution?.thresholds?.find((row) => row.thresholdDays === 90)?.confirmedLegacyImportRate || 0)} have a valid import date`, "warning", drilldownUrl("source.newBusinessImportedOlderThan", withSegment({ businessSegment: "new", minImportAgeDays: 90 })))}
            ${metricCard("SP-created >90 days", formatNumber(selfSourcingAttribution?.thresholds?.find((row) => row.thresholdDays === 90)?.salespersonCreatedLongHeldCalls || 0), "Manual salesperson creation, not online-source proof", "info", drilldownUrl("source.manualCreated", withSegment({ businessSegment: "new", createdByType: "SP", minImportAgeDays: 90 })))}
          </div>
          <div class="grid-2">
            <div>
              <p class="muted small">${escapeHtml(selfSourcingAttribution?.conclusion?.statement || "No active call data is available.")}</p>
              ${table([
                { label: "Record age at call", render: (row) => dataLink("source.newBusinessRecordOlderThan", `>${formatNumber(row.thresholdDays)} days`, withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) },
                { label: "Calls", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatNumber(row.longHeldRecordCalls), withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) },
                { label: "Share", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatPercent(row.longHeldRecordRate), withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) },
                { label: "Distinct records", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatNumber(row.longHeldDistinctRecords), withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) },
                { label: "Confirmed legacy imports", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatNumber(row.confirmedLegacyImportCalls), withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) },
                { label: "Import share", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatPercent(row.confirmedLegacyImportRate), withSegment({ businessSegment: "new", minImportAgeDays: row.thresholdDays })) }
              ], selfSourcingAttribution?.thresholds || [], "No valid record-date evidence is available.")}
            </div>
            <div>
              <p class="muted small">${escapeHtml(selfSourcingAttribution?.conclusion?.attributionStatement || "")}</p>
              ${table([
                { label: "Confirmed import source", render: (row) => dataLink("source.newBusinessImportedOlderThan", row.source, withSegment({ businessSegment: "new", source: row.source, minImportAgeDays: 90 })) },
                { label: "Calls >90 days", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatNumber(row.legacyImportCalls), withSegment({ businessSegment: "new", source: row.source, minImportAgeDays: 90 })) },
                { label: "Distinct records", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatNumber(row.legacyImportDistinctRecords), withSegment({ businessSegment: "new", source: row.source, minImportAgeDays: 90 })) },
                { label: "Share of legacy imports", render: (row) => dataLink("source.newBusinessImportedOlderThan", formatPercent(row.shareOfConfirmedLegacyImports), withSegment({ businessSegment: "new", source: row.source, minImportAgeDays: 90 })) }
              ], (selfSourcingAttribution?.legacyImportSources || []).slice(0, 8), "No confirmed legacy import dates are available.")}
            </div>
          </div>
          <p class="muted small">${escapeHtml((selfSourcingAttribution?.limitations || []).join(" "))}</p>
        </section>

        <section class="panel" id="weekly-lead-intelligence">
          <div class="panel-header">
            <div>
              <h2>Weekly Lead Intelligence</h2>
              <p class="muted small">Lead supply and operational workflow context from the two attached weekly spreadsheet exports. This is separate from the active call-data metrics.</p>
            </div>
            ${badge(weeklyLeadIntelligence.statusLabel || "No weekly export loaded", weeklyLeadIntelligence.status === "attached_snapshot" ? "notice" : "neutral")}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Leads imported", formatNumber(weeklyLeadIntelligence.totals?.totalImported || 0), `${formatNumber(weeklyLeadIntelligence.totals?.weeksCovered || 0)} weekly periods in the supplied snapshot`, "info", "#weekly-lead-origin")}
            ${metricCard("Largest supply week", formatNumber(weeklyLeadIntelligence.totals?.highestWeekImported || 0), `Week starting ${weeklyLeadIntelligence.totals?.highestWeekStarting || "n/a"}`, "good", "#weekly-lead-trend")}
            ${metricCard("Latest supply week", formatNumber(weeklyLeadIntelligence.totals?.latestWeekImported || 0), `${formatNumber(weeklyLeadIntelligence.totals?.latestVsPeakChange || 0)}% versus the supplied peak week`, "warning", "#weekly-lead-trend")}
            ${metricCard("Lead-generator handoff", "Next week", "Generator entries should be compared with the following week's allocation and calling activity", "info", "#weekly-lead-workflow")}
          </div>
          <div class="grid-2">
            <div>
              <h3 id="weekly-lead-origin">Lead supply by origin</h3>
              ${table([
                { label: "Origin", render: (row) => `${escapeHtml(row.origin)}<br /><span class="muted small">${escapeHtml(row.description)}</span>` },
                { label: "Leads imported", render: (row) => formatNumber(row.leadsImported) },
                { label: "Share", render: (row) => formatPercent(row.shareOfImportedLeads) }
              ], weeklyLeadIntelligence.originRows || [], "No lead-supply rows are available.")}
            </div>
            <div>
              <h3 id="weekly-lead-trend">Weekly supply trend</h3>
              ${table([
                { label: "Week starting", key: "weekStarting" },
                { label: "Leads imported", render: (row) => formatNumber(row.leadsImported) }
              ], (weeklyLeadIntelligence.weeklyRows || []).slice(0, 8), "No weekly trend is available.")}
            </div>
          </div>
          <div class="callout notice" id="weekly-lead-workflow">
            <strong>Workflow fields available:</strong> ${escapeHtml((weeklyLeadIntelligence.workflowFields || []).join(", "))}. ${escapeHtml(weeklyLeadIntelligence.cohortRule || "")}
          </div>
          <p class="muted small">${escapeHtml((weeklyLeadIntelligence.limitations || []).join(" "))}</p>
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
              { label: "Calls", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatNumber(row.calls), withSegment({ minImportAgeDays: row.thresholdDays })) },
              { label: "Share", render: (row) => dataLink("source.newBusinessRecordOlderThan", formatPercent(row.rate), withSegment({ minImportAgeDays: row.thresholdDays })) }
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
              { label: "Calls", render: (row) => dataLink("source.manualCreated", formatNumber(row.calls), withSegment({ createdByType: row.createdByType })) },
              { label: "New", render: (row) => dataLink("source.manualCreated", formatNumber(row.newBusinessCalls), withSegment({ createdByType: row.createdByType, businessSegment: "new" })) },
              { label: "Warm", render: (row) => dataLink("source.manualCreated", formatNumber(row.warmBusinessCalls), withSegment({ createdByType: row.createdByType, businessSegment: "warm" })) },
              { label: "Avg age", render: (row) => dataLink("source.manualCreated", formatDays(row.averageCreateAgeDays), withSegment({ createdByType: row.createdByType })) }
            ], sourceQualityTypeRows, "No manual LG/SP creator fields are available.")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Bulk Source Records</h2>
              <p class="muted small">Raw source, business segment, and record-age counts. No semantic outcome or quality comparison is made.</p>
            </div>
          </div>
          ${table([
            { label: "Source", render: (row) => `<a class="data-link" href="${escapeHtml(drilldownUrl("calls.unique", withSegment({ source: row.name })))}">${escapeHtml(row.name)}</a>` },
            { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), withSegment({ source: row.name })) },
            { label: "New", render: (row) => dataLink("calls.newBusiness", formatNumber(row.newBusinessCalls), withSegment({ source: row.name, businessSegment: "new" })) },
            { label: "Warm", render: (row) => dataLink("calls.warmBusiness", formatNumber(row.warmBusinessCalls), withSegment({ source: row.name, businessSegment: "warm" })) },
            { label: "Avg record age", render: (row) => dataLink("calls.unique", formatDays(row.averageRecordAgeDays), withSegment({ source: row.name })) },
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
              { label: "Calls", render: (row) => dataLink("calls.unique", formatNumber(row.calls), withSegment({ recordAgeBucket: row.bucket })) },
              { label: "New", render: (row) => dataLink("calls.newBusiness", formatNumber(row.newBusinessCalls), withSegment({ recordAgeBucket: row.bucket, businessSegment: "new" })) },
              { label: "Warm", render: (row) => dataLink("calls.warmBusiness", formatNumber(row.warmBusinessCalls), withSegment({ recordAgeBucket: row.bucket, businessSegment: "warm" })) },
              { label: "Avg record age", render: (row) => formatDays(row.averageRecordAgeDays) }
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
              { label: "Calls", render: (row) => dataLink("source.manualCreated", formatNumber(row.calls), withSegment({ createdBy: row.createdBy })) },
              { label: "New", render: (row) => dataLink("source.manualCreated", formatNumber(row.newBusinessCalls), withSegment({ createdBy: row.createdBy, businessSegment: "new" })) },
              { label: "Warm", render: (row) => dataLink("source.manualCreated", formatNumber(row.warmBusinessCalls), withSegment({ createdBy: row.createdBy, businessSegment: "warm" })) },
              { label: "Avg create age", render: (row) => dataLink("source.manualCreated", formatDays(row.averageCreateAgeDays), withSegment({ createdBy: row.createdBy })) }
            ], sourceQualityCreatorRows, "No manual creator rows are available.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("intelligence")}>
        <section class="panel" id="intelligence">
          <div class="panel-header">
            <div>
              <h2>Restricted Literal Transcript Triage</h2>
              <p class="muted small">Database-backed literal matches only: machine/no-answer/voicemail, direct customer wrong-number wording, direct customer not-interested wording, and direct customer opt-out wording. No semantic outcome, follow-up, quality, or lead score is created.</p>
            </div>
            ${linkedBadge(`${formatNumber(intelligenceTotals.callsIndexed)} calls indexed`, intelligenceTotals.callsIndexed ? "success" : "warning", queueFilterUrl({ intelligenceQueue: "all", wasteRisk: "" }))}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Literal triage rows", formatNumber(intelligenceTotals.callsIndexed), "No semantic score or quality grade", "info", queueFilterUrl({ intelligenceQueue: "all", wasteRisk: "", highQuality: "", repeatedShortAttempt: "" }))}
            ${metricCard("Direct opt-out review", formatNumber(intelligenceTotals.managerReviewCalls), "Exact customer phrase; manager verification still required", intelligenceTotals.managerReviewCalls ? "risk" : "neutral", queueFilterUrl({ intelligenceQueue: "manager_review", managerReview: "1", wasteRisk: "", highQuality: "", repeatedShortAttempt: "" }))}
            ${metricCard("Lead utilisation score", "Unavailable", "The semantic rules failed accuracy review", "neutral")}
            ${metricCard("Automated call quality", "Unavailable", "No evaluator is authorised", "neutral")}
            ${metricCard("Local-model operations", "Disabled", "No promoted capability", "neutral", "/evaluation-studio")}
            ${metricCard("Database", "SQLite", intelligence.dbPath ? "Call intelligence is persisted locally" : "No database summary available", "info")}
          </div>
        </section>

        <section class="panel" id="intelligence-queue">
          <div class="panel-header">
            <div>
              <h2>Literal Triage Evidence</h2>
              <p class="muted small">Exact rule matches are evidence pointers for transcript review, not customer outcomes or staff judgments.</p>
            </div>
            ${linkedBadge(`${formatNumber(intelligenceQueueRows.length)} calls shown`, intelligenceQueueRows.length ? "notice" : "neutral", queueFilterUrl())}
          </div>
          <div class="panel-body">
            <div class="stack" style="margin-bottom: 12px;">
              <a class="filter-link ${activeIntelligenceQueue === "all" ? "selected" : ""}" href="${escapeHtml(queueFilterUrl({ intelligenceQueue: "all", managerReview: "", wasteRisk: "", highQuality: "", repeatedShortAttempt: "" }))}">All literal triage rows</a>
              <a class="filter-link ${activeIntelligenceQueue === "manager_review" ? "selected" : ""}" href="${escapeHtml(queueFilterUrl({ intelligenceQueue: "manager_review", managerReview: "1", wasteRisk: "", highQuality: "", repeatedShortAttempt: "" }))}">Direct opt-out review</a>
            </div>
            ${intelligenceAuditTable([
              { label: "Call", render: (row) => callLink(row.call_id) },
              { label: "Customer ID", render: (row) => customerIdCell(row, queueFilterUrl({ customerId: row.customer_id, intelligenceQueue: activeIntelligenceQueue })) },
              { label: "Segment", render: (row) => escapeHtml(row.business_segment_label || businessSegmentLabel(row.business_segment)) },
              { label: "Salesperson", render: (row) => escapeHtml(row.salesperson || "Unknown") },
              { label: "Source", render: (row) => escapeHtml(row.source || "Unknown source") },
              { label: "Literal contact state", render: (row) => badge(humanizeSlug(row.overall_call_outcome || row.contact_classification || "unknown"), "neutral") },
              { label: "Provenance", render: () => provenanceBadge("Restricted literal rule") },
              { label: "Review", render: (row) => row.manager_review_required ? provenanceBadge("Verify direct opt-out") : provenanceBadge("No action created") },
              { label: "Model archive", render: (row) => row.llm_result_json ? `<a class="filter-link" href="/calls/${encodeURIComponent(row.call_id)}">Research only</a>` : badge("None", "neutral") },
              { label: "Reason", render: (row) => `<span class="evidence-summary">${escapeHtml(row.lead_reason || row.brief_reason || row.evidence_snippet || "Evidence unavailable")}<a class="proof-link" href="/calls/${encodeURIComponent(row.call_id)}">Open proof</a></span>` }
            ], intelligenceQueueRows, "No calls match this intelligence queue yet.")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header"><div><h2>Semantic scorecards unavailable</h2><p class="muted small">Salesperson quality, source quality, lead utilisation, callback, interest, complaint, and coaching comparisons remain absent until an exact evaluator passes a frozen unseen promotion test.</p></div></div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("follow_up")}>
        <section class="panel" id="lead-utilization">
          <div class="panel-header">
            <div>
              <h2>Literal No-Contact Activity</h2>
              <p class="muted small">Matched-record counts use source IDs and exact literal no-contact evidence only. These figures do not measure lead quality, seller performance, or under-utilisation.</p>
            </div>
            ${linkedBadge(`${formatNumber(leadTotals.stableLeadDaysWorked)} matched records`, "neutral", drilldownUrl("lead.stableLeadDaysWorked", withSegment()))}
          </div>
          <div class="panel-body metrics">
            ${metricCard("Literal one-dial no-contact, no later match", formatNumber(leadReattemptTotals.literalOneDialNoContactNoLaterLeads || leadTotals.singleAttemptNoContact || 0), "Neutral activity triage; not a performance judgement", "info", drilldownUrl("reattempt.oneDialLiteralNoContactNoLater", withSegment()))}
            ${metricCard("Literal one-dial no-contact", formatNumber(leadReattemptTotals.literalOneDialNoContactLeads || 0), "Exact no-answer, machine-voicemail, or carrier-system evidence only; blank stays unknown", "info", drilldownUrl("reattempt.oneDialLiteralNoContact", withSegment()))}
            ${metricCard("One-dial records", formatNumber(leadReattemptTotals.oneAndDoneLeads || 0), "Dialed once by the salesperson", "info", drilldownUrl("reattempt.oneAndDone", withSegment()))}
            ${metricCard("No-contact retry coverage", formatRatioPercent(leadTotals.noContactRetryRate), `${formatNumber(leadTotals.noContactRetriedSameDay)} of ${formatNumber(leadTotals.noContactLeadDays)} retried`, "info", drilldownUrl("lead.noContactRetriedSameDay", withSegment()))}
            ${metricCard("Matched records dialed", formatNumber(leadReattemptTotals.leadsTouched || leadTotals.stableLeadDaysWorked || 0), `${formatNumber(leadReattemptTotals.callsWithoutStableLead || leadTotals.callsWithoutStableLead || 0)} calls lacked matching ID`, "good", drilldownUrl("reattempt.leadsTouched", withSegment()))}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("records")}>
        <section class="panel" id="carma-evidence">
          <div class="panel-header">
            <div>
              <h2>Carma Sale & Lead-Source Evidence</h2>
              <p class="muted small">Default classification: Company Sourced when the actual seller had any exact pre-sale allocation; otherwise Self Sourced. Acquisition sources and campaigns remain separate.</p>
            </div>
            <div class="stack">
              ${badge(carmaEvidence.available ? "Contract available" : humanizeSlug(carmaEvidence.status || "not_configured"), carmaEvidence.available ? "success" : "warning")}
              ${carmaEvidence.readOnly ? badge("Read-only", "neutral") : badge("Write access blocked", "critical")}
            </div>
          </div>
          ${carmaEvidence.available ? `
          <div class="panel-body metrics">
            ${metricCard("Approved sales", formatNumber(carmaTotals.orders || 0), "Carma orders in the versioned evidence contract", "info", "/api/carma-evidence")}
            ${metricCard("Company sourced", formatNumber(carmaTotals.companySourcedOrders || 0), "Actual seller allocated before approval", "good", "/api/carma-evidence?classification=Company%20Sourced")}
            ${metricCard("Self sourced", formatNumber(carmaTotals.selfSourcedOrders || 0), "No exact actual-seller pre-sale allocation", "info", "/api/carma-evidence?classification=Self%20Sourced")}
            ${metricCard("Exact customers linked", formatNumber(carmaTotals.exactCustomerMatches || 0), `${formatNumber(carmaTotals.matchingCalls || 0)} call records`, "good", "/api/carma-evidence")}
            ${metricCard("Source checks", `${formatNumber(carmaTotals.sourceMatches || 0)}/${formatNumber(carmaTotals.sourceComparisons || 0)}`, "Comparable Carma and Dashboard import-source facts", carmaTotals.sourceMatches === carmaTotals.sourceComparisons ? "good" : "warning", "/api/carma-evidence")}
            ${metricCard("Import-date checks", `${formatNumber(carmaTotals.importDateMatches || 0)}/${formatNumber(carmaTotals.importDateComparisons || 0)}`, "Comparable source import dates", carmaTotals.importDateMatches === carmaTotals.importDateComparisons ? "good" : "warning", "/api/carma-evidence")}
            ${metricCard("Credit contradictions", formatNumber(carmaTotals.directReportingErrors || 0), "Carma external credit exceeds current policy allowance", carmaTotals.directReportingErrors ? "risk" : "good", "/api/carma-evidence?errorsOnly=true")}
            ${metricCard("Join authority", "Exact ID", "customer_id only; causation is not inferred", "neutral")}
          </div>
          ${table([
            { label: "Order", render: (row) => `<span class="mono">${escapeHtml(row.orderNumber)}</span>` },
            { label: "Customer", render: (row) => `<strong>${escapeHtml(row.customer || "Unknown")}</strong><br /><span class="muted small mono">${escapeHtml(row.customerId)}</span>` },
            { label: "Actual seller", render: (row) => escapeHtml(row.actualSeller || "Unknown") },
            { label: "Seller allocated", render: (row) => escapeHtml(row.sellerAllocationDate || "No exact allocation") },
            { label: "Approved", render: (row) => escapeHtml(formatDateTime(row.saleApprovalDate)) },
            { label: "Approved value", render: (row) => `$${Number(row.saleValue || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: "Sourcing method", render: (row) => `<strong>${escapeHtml(row.leadSourceClassification || "Unknown")}</strong><br /><span class="muted small">${escapeHtml(row.leadSourceClassificationReason || "")}</span>` },
            { label: "Acquisition source", render: (row) => `${escapeHtml(row.acquisitionSourceType || "Not recorded")}${row.campaign ? `<br /><span class="muted small">Campaign: ${escapeHtml(row.campaign)}</span>` : ""}` },
            { label: "Policy credited source", render: (row) => escapeHtml(row.policyCreditedSource || "Unverified") },
            { label: "Carma credited source", render: (row) => `${escapeHtml(row.carmaCreditedSource || "Unverified")}<br /><span class="muted small">${escapeHtml(row.reportingFinding || "")}</span>` },
            { label: "Call proof", render: (row) => `${row.callId ? callLink(row.callId) : "No linked call"}<br />${provenanceBadge(row.joinProof || "Exact customer_id")}` },
            { label: "Reconciliation", render: (row) => `${badge(humanizeSlug(row.validationStatus || "unknown"), row.directReportingError ? "critical" : row.validationStatus === "verified" ? "success" : "warning")}<br /><span class="muted small">Source ${escapeHtml(row.sourceComparison)} · date ${escapeHtml(row.importDateComparison)}</span>` }
          ], carmaRows, "No exact customer_id matches exist between the active call cohort and the Carma evidence contract.")}
          <div class="panel-body">
            <p class="muted small">Showing up to 60 exact joined rows. The full sanitized result is available at <a class="open-link" href="/api/carma-evidence">/api/carma-evidence</a>. Approved sale value is not paid or recognised revenue.</p>
          </div>
          ` : `
          <div class="panel-body">
            <div class="empty">${escapeHtml(carmaEvidence.error || "Configure a versioned Carma evidence database to enable exact customer proof.")}</div>
          </div>
          `}
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
              ${linkedBadge(`${formatNumber(persistence.counts.imports)} saved`, "neutral", "#history")}
            </div>
            ${table([
              { label: "Import", render: (row) => hrefDataLink(row.id, `/imports/${encodeURIComponent(row.id)}`) },
              { label: "Source", render: (row) => hrefDataLink(row.sourceName, `/imports/${encodeURIComponent(row.id)}`) },
              { label: "Loaded", render: (row) => hrefDataLink(formatDateTime(row.lastImportedAt), `/imports/${encodeURIComponent(row.id)}`) },
              { label: "Calls", render: (row) => hrefDataLink(formatNumber(row.totals?.uniqueCalls), `/imports/${encodeURIComponent(row.id)}`) },
              { label: "AI assistants", render: (row) => hrefDataLink(formatNumber(row.totals?.aiVoiceAssistantEncounters || 0), `/imports/${encodeURIComponent(row.id)}`) },
              { label: "Semantic evaluation", render: (row) => hrefDataLink("Unavailable", `/imports/${encodeURIComponent(row.id)}`) },
            ], importRows, "No imports have been saved yet.")}
          </div>

          <div class="panel" id="reports">
            <div class="panel-header">
              <div>
                <h2>Reports Library</h2>
                <p class="muted small">Generated reports are stored locally and can be viewed from the dashboard/API.</p>
              </div>
              ${linkedBadge(`${formatNumber(persistence.counts.reports)} reports`, "neutral", "#reports")}
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
                <p class="muted small">Lifecycle workflow for direct customer opt-out phrase matches and manager-created alerts. Every rule match requires transcript verification.</p>
              </div>
              <div class="stack">
                ${linkedBadge(`${formatNumber(alertSummary.active || persistence.counts.currentAlertEvents || 0)} active`, (alertSummary.active || persistence.counts.currentAlertEvents) ? "critical" : "neutral", "#alerts")}
                ${linkedBadge(`${criticalAlerts} critical`, criticalAlerts ? "critical" : "neutral", dashboardFilterUrl({ ...globalFilterQuery, ...segmentFilters, view: "reviews", alertSeverity: "critical" }, "alerts"))}
                ${linkedBadge(`${warningAlerts} warning`, warningAlerts ? "warning" : "neutral", dashboardFilterUrl({ ...globalFilterQuery, ...segmentFilters, view: "reviews", alertSeverity: "warning" }, "alerts"))}
                ${linkedBadge(`${noticeAlerts} notice`, noticeAlerts ? "notice" : "neutral", dashboardFilterUrl({ ...globalFilterQuery, ...segmentFilters, view: "reviews", alertSeverity: "notice" }, "alerts"))}
              </div>
            </div>
            ${renderAlertCentre(alertRows, alertSummary, {
              returnTo: alertReturnTo,
              importId: persistence.currentImportId || data.persistence?.currentImportId || "",
              filterSummary: data.filterSummary
            })}
          </div>

          <div class="panel" id="manager-review-queue">
            <div class="panel-header">
              <h2>Manager Review Queue</h2>
              <div class="stack">
                ${linkedBadge(`${formatNumber(reviewRows.length)} shown`, "neutral", "#manager-review-queue")}
                ${linkedBadge(`${formatNumber(persistence.counts.currentManagerReviews)} saved reviews`, persistence.counts.currentManagerReviews ? "success" : "neutral", "/manager-reviews")}
              </div>
            </div>
            ${table([
              { label: "Call", render: (row) => callLink(row.callId) },
              { label: "Customer ID", render: (row) => customerIdCell(row) },
              { label: "Salesperson", render: (row) => dataLink("calls.unique", row.salesperson || "Unknown", withSegment({ salesperson: row.salesperson })) },
              { label: "Literal triage state", render: (row) => badge(row.localOutcome, row.reviewRequired ? "warning" : "neutral") },
              { label: "Review", render: (row) => `${managerReviewBadge(row, reviewSummaryMap)}<br />${managerCorrectionSummary(row, reviewSummaryMap)}<br />${managerSuggestedCorrectionSummary(row, reviewSummaryMap)}` },
              { label: "Provenance", render: (row) => `${provenanceBadge(row.localOutcomeProvenance || "Restricted literal rule")} ${provenanceBadge(managerReviewState(row, persistence))}` },
              { label: "Proof", render: (row) => renderEvidenceSummary(row) },
              { label: "Actions", render: (row) => `<div class="alert-actions">${managerReviewActionForm(row, "confirm", "Confirm", { returnTo: alertReturnTo, importId: persistence.currentImportId || "", reviewScope: "call", source: "manager_review_queue" })}${managerReviewActionForm(row, "dismiss", "Dismiss", { returnTo: alertReturnTo, importId: persistence.currentImportId || "", reviewScope: "call", source: "manager_review_queue" })}</div>` }
            ], reviewRows, "No calls need manager review.")}
          </div>
        </section>

        </div>

        <div class="workspace-flow" ${workspaceAttr("records")}>
        <section class="panel" id="explorer">
          <div class="panel-header">
            <div>
              <h2>Raw Call Explorer</h2>
              <p class="muted small">Shows sanitized source fields, local outcomes, proof summaries, and transcript previews.</p>
            </div>
            ${linkedBadge(`${formatNumber(explorerRows.length)} recent calls`, "neutral", drilldownUrl("calls.unique", withSegment({ sort: "newest" })))}
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
      (() => {
        const body = document.body;
        const toggles = Array.from(document.querySelectorAll("[data-sidebar-toggle]"));
        const overlay = document.querySelector("[data-sidebar-overlay]");
        const desktop = window.matchMedia("(min-width: 1101px)");
        const setExpandedState = () => {
          const expanded = desktop.matches
            ? !body.classList.contains("sidebar-collapsed")
            : body.classList.contains("sidebar-open");
          toggles.forEach((toggle) => {
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", desktop.matches
              ? (expanded ? "Collapse navigation" : "Expand navigation")
              : (expanded ? "Close navigation" : "Open navigation"));
          });
        };
        try {
          if (desktop.matches && window.localStorage.getItem("sales-dashboard-sidebar") === "collapsed") {
            body.classList.add("sidebar-collapsed");
          }
        } catch {}
        const toggleSidebar = () => {
          if (desktop.matches) {
            body.classList.toggle("sidebar-collapsed");
            try {
              window.localStorage.setItem(
                "sales-dashboard-sidebar",
                body.classList.contains("sidebar-collapsed") ? "collapsed" : "expanded"
              );
            } catch {}
          } else {
            body.classList.toggle("sidebar-open");
          }
          setExpandedState();
        };
        toggles.forEach((toggle) => toggle.addEventListener("click", toggleSidebar));
        if (overlay) overlay.addEventListener("click", () => {
          body.classList.remove("sidebar-open");
          setExpandedState();
        });
        document.querySelectorAll("aside nav a, .product-switcher a").forEach((link) => {
          link.addEventListener("click", () => {
            if (!desktop.matches) body.classList.remove("sidebar-open");
          });
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && body.classList.contains("sidebar-open")) {
            body.classList.remove("sidebar-open");
            setExpandedState();
          }
        });
        desktop.addEventListener("change", () => {
          body.classList.remove("sidebar-open");
          setExpandedState();
        });
        setExpandedState();
      })();
      (() => {
        document.querySelectorAll("[data-sortable-table]").forEach((table) => {
          const body = table.tBodies[0];
          if (!body) return;
          table.querySelectorAll("[data-sort-column]").forEach((button) => {
            button.addEventListener("click", () => {
              const column = Number(button.dataset.sortColumn || 0);
              const type = button.dataset.sortType || "text";
              const nextDirection = button.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
              table.querySelectorAll("[data-sort-column]").forEach((other) => other.removeAttribute("aria-sort"));
              button.setAttribute("aria-sort", nextDirection);
              const direction = nextDirection === "ascending" ? 1 : -1;
              const rows = Array.from(body.rows);
              rows.sort((left, right) => {
                const leftValue = left.cells[column]?.dataset.sortValue || left.cells[column]?.textContent || "";
                const rightValue = right.cells[column]?.dataset.sortValue || right.cells[column]?.textContent || "";
                if (type === "number") return (Number(leftValue) - Number(rightValue)) * direction;
                return leftValue.localeCompare(rightValue, "en-AU", { numeric: true, sensitivity: "base" }) * direction;
              });
              rows.forEach((row) => body.appendChild(row));
            });
          });
        });
      })();
    </script>
    ${TABLE_COLUMNS_SCRIPT}
  </body>
</html>`;
  return activeView === "performance"
    ? pruneInactiveDashboardWorkspaces(html)
    : html;
}

function renderReportPage(report, options = {}) {
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
      ${COLUMN_HELP_STYLES}
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
      .data-link {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
      }
      .data-link:hover { color: var(--foreground); text-decoration: underline; }
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
      .report-controls {
        display: grid;
        grid-template-columns: repeat(4, minmax(140px, 1fr)) auto;
        gap: 10px;
        align-items: end;
        margin: 14px 0 20px;
        padding: 14px;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        background: var(--surface-elevated);
      }
      .report-controls label { display: grid; gap: 6px; color: var(--muted-foreground); font-size: 12px; font-weight: 700; }
      .report-controls input {
        width: 100%;
        min-height: 38px;
        padding: 8px 10px;
        color: var(--foreground);
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        font: inherit;
      }
      .report-controls button {
        min-height: 38px;
        padding: 8px 14px;
        color: #080A0F;
        background: var(--primary);
        border: 0;
        border-radius: 6px;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .report-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 4px 0 20px; }
      .report-chart { min-width: 0; padding: 16px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-elevated); }
      .report-chart h2 { margin: 0 0 14px; }
      .report-bars { display: grid; gap: 12px; }
      .report-bar-label { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
      .report-bar-label span { font-family: "Geist Mono", Consolas, monospace; color: var(--foreground); }
      .report-bar-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--surface); margin-top: 5px; }
      .report-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--muted-foreground); }
      .report-bar-fill.warning { background: var(--warning); }
      .report-bar-fill.notice { background: var(--accent); }
      .report-bar-fill.success { background: var(--success); }
      .report-bar-row p { margin: 5px 0 0; font-size: 12px; line-height: 1.4; }
      @media (max-width: 760px) {
        main { width: min(100vw - 24px, 1180px); padding: 12px 0 32px; }
        .topbar, .page-title { flex-direction: column; }
        .page-brand { min-width: 0; width: 190px; }
        .metadata { grid-template-columns: 1fr; }
        .report-controls, .report-chart-grid { grid-template-columns: 1fr; }
        table { min-width: 0; table-layout: fixed; }
        td { overflow-wrap: anywhere; }
      }
      ${PANELIFY_THEME_STYLES}
    </style>
  </head>
  <body>
    <main>
      <header class="topbar">
        <div class="page-title">
          <a class="page-brand" href="/#overview"><img data-brand-logo src="/branding/logo" alt="Countrywide Austral" /></a>
          <div>
            <p class="page-kicker">${escapeHtml(options.pageKicker || "Saved report")}</p>
            <h1>${escapeHtml(reportTitle)}</h1>
            <p class="muted">${hasReport ? escapeHtml(report.summary || "Saved report") : "This report does not exist."}</p>
          </div>
        </div>
        <a class="button-link" href="${escapeHtml(options.backHref || "/#reports")}">${escapeHtml(options.backLabel || "Back to Reports")}</a>
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
          ${renderReportControls(report)}
          ${renderReportCharts(report)}
          ${renderReportContent(report.content || report.summary || "")}
        </div>
        <details>
          <summary>Raw report record</summary>
          <pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
        </details>
      </section>` : `<section class="panel"><p>Use the Reports Library to open an existing report.</p></section>`}
    </main>
    ${TABLE_COLUMNS_SCRIPT}
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
