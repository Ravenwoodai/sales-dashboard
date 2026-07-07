"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildLeadUtilizationReport } = require("./leadUtilizationReport");

const STORE_SCHEMA_VERSION = "sales_dashboard_store.v1";

function resolveStorePath(options = {}) {
  if (options.storePath) return path.resolve(options.storePath);
  if (process.env.SALES_DASHBOARD_STORE_PATH) {
    return path.resolve(process.env.SALES_DASHBOARD_STORE_PATH);
  }
  return path.join(process.cwd(), "data", "store", "state.json");
}

function createEmptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    imports: [],
    alertEvents: [],
    managerReviews: [],
    aiJobs: [],
    reports: []
  };
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStore(options = {}) {
  const storePath = resolveStorePath(options);
  if (!fs.existsSync(storePath)) {
    return createEmptyStore();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      ...createEmptyStore(),
      ...parsed,
      imports: Array.isArray(parsed.imports) ? parsed.imports : [],
      alertEvents: Array.isArray(parsed.alertEvents) ? parsed.alertEvents : [],
      managerReviews: Array.isArray(parsed.managerReviews) ? parsed.managerReviews : [],
      aiJobs: Array.isArray(parsed.aiJobs) ? parsed.aiJobs : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : []
    };
  } catch (error) {
    const store = createEmptyStore();
    store.readError = error.message;
    return store;
  }
}

function writeStore(store, options = {}) {
  const storePath = resolveStorePath(options);
  ensureDirectory(storePath);
  const nextStore = {
    ...store,
    schemaVersion: STORE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, storePath);
  return nextStore;
}

function updateStore(mutator, options = {}) {
  const store = readStore(options);
  const nextStore = mutator(store) || store;
  return writeStore(nextStore, options);
}

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function reportIdFor(title, content) {
  return `report_${digest(`${title}\n${content}`, 20)}`;
}

function importIdForAnalysis(analysis) {
  return `import_${String(analysis.inputHash || digest(Date.now())).slice(0, 20)}`;
}

function buildImportRecord(analysis, options = {}) {
  const importId = options.importId || importIdForAnalysis(analysis);
  return {
    id: importId,
    sourceName: analysis.sourceName || "CSV import",
    sourcePathHash: options.csvPath ? digest(path.resolve(options.csvPath), 20) : null,
    inputHash: analysis.inputHash,
    firstImportedAt: options.existing?.firstImportedAt || new Date().toISOString(),
    lastImportedAt: new Date().toISOString(),
    generatedAt: analysis.generatedAt,
    dateRange: analysis.dateRange,
    totals: analysis.totals,
    rates: analysis.rates,
    ignoredFields: analysis.ignoredFields,
    unsupportedMetrics: analysis.unsupportedMetrics,
    artifactPath: path.join("imports", `${importId}.json`),
    alertCount: analysis.alerts.length,
    reviewQueueCount: analysis.reviewQueue.length,
    evaluationRowCount: Array.isArray(analysis.evaluationRows) ? analysis.evaluationRows.length : 0
  };
}

function writeImportArtifact(analysis, importRecord, options = {}) {
  const storePath = resolveStorePath(options);
  const artifactPath = path.join(path.dirname(storePath), importRecord.artifactPath);
  ensureDirectory(artifactPath);
  const artifact = {
    schemaVersion: "sales_dashboard_import_artifact.v1",
    importId: importRecord.id,
    sourceName: importRecord.sourceName,
    generatedAt: new Date().toISOString(),
    inputHash: analysis.inputHash,
    dateRange: analysis.dateRange,
    totals: analysis.totals,
    rates: analysis.rates,
    ignoredFields: analysis.ignoredFields,
    unsupportedMetrics: analysis.unsupportedMetrics,
    evaluationRows: analysis.evaluationRows || [],
    alerts: analysis.alerts || [],
    reviewQueue: analysis.reviewQueue || [],
    salespersonScorecards: analysis.salespersonScorecards || [],
    sourceMetrics: analysis.sourceMetrics || []
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

function buildAlertEvents(analysis, importId, existingEvents = []) {
  const existingById = new Map(existingEvents.map((event) => [event.id, event]));
  return (analysis.alerts || []).map((alert) => {
    const id = `alert_${digest(`${importId}|${alert.category}|${alert.callId}|${alert.severity}`, 20)}`;
    const existing = existingById.get(id);
    return {
      id,
      importId,
      callId: alert.callId,
      category: alert.category,
      severity: alert.severity,
      owner: alert.owner,
      message: alert.message,
      evidence: alert.evidence,
      evidenceSummary: alert.evidenceSummary,
      status: existing?.status || "new",
      falsePositive: existing?.falsePositive || false,
      managerNotes: existing?.managerNotes || "",
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

function buildAutomaticReport(analysis, importRecord) {
  const title = `Executive Summary - ${importRecord.sourceName}`;
  const content = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Import ID: ${importRecord.id}`,
    "",
    "## Key Metrics",
    `- Unique calls: ${analysis.totals.uniqueCalls}`,
    `- Raw rows: ${analysis.totals.rawRows}`,
    `- Duplicate call IDs: ${analysis.totals.duplicateCallIds}`,
    `- Transcript coverage: ${analysis.rates.transcriptCoverage}%`,
    `- Probable live-human rate: ${analysis.rates.probableLiveHuman}%`,
    `- Meaningful conversation rate: ${analysis.rates.meaningfulConversation}%`,
    `- Follow-up signals: ${analysis.totals.followUpRequired}`,
    `- Outcome mismatches: ${analysis.totals.outcomeMismatches}`,
    `- Risk reviews: ${analysis.totals.riskReviews}`,
    "",
    "## Guardrails",
    "- Redacted phone values were not used for matching, attribution, or display.",
    "- Valid CustomerImportDate and CustomerCreateDate values were parsed for source-quality analytics; malformed date fragments were treated as missing.",
    "- Confirmed sales, revenue, order value, close date, and won/lost outcome are unsupported by the current CSV."
  ].join("\n");

  return {
    id: `report_${importRecord.id}_executive_summary`,
    title,
    type: "executive_summary",
    source: "system",
    format: "markdown",
    summary: `${analysis.totals.uniqueCalls} unique calls, ${analysis.totals.followUpRequired} follow-up signals, ${analysis.totals.outcomeMismatches} outcome mismatches.`,
    content,
    metadata: {
      importId: importRecord.id,
      sourceName: importRecord.sourceName,
      inputHash: analysis.inputHash,
      generatedBy: "automatic_import_summary"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function persistAnalysis(analysis, options = {}) {
  const importId = importIdForAnalysis(analysis);
  const storePath = resolveStorePath(options);
  const currentStore = readStore({ storePath });
  const existingImport = currentStore.imports.find((record) => record.id === importId);
  const importRecord = buildImportRecord(analysis, { ...options, importId, existing: existingImport });
  writeImportArtifact(analysis, importRecord, { storePath });

  const executiveReport = buildAutomaticReport(analysis, importRecord);
  const automaticReports = [
    buildLeadUtilizationReport(analysis, importRecord),
    executiveReport
  ].filter(Boolean);
  const nextStore = updateStore((store) => {
    const imports = store.imports.filter((record) => record.id !== importId);
    imports.unshift(importRecord);

    const otherAlerts = store.alertEvents.filter((event) => event.importId !== importId);
    const alertEvents = [...buildAlertEvents(analysis, importId, store.alertEvents), ...otherAlerts];

    const automaticReportIds = new Set(automaticReports.map((report) => report.id));
    const previousReports = new Map(store.reports.map((report) => [report.id, report]));
    const reports = store.reports.filter((report) => !automaticReportIds.has(report.id));
    reports.unshift(...automaticReports.map((report) => ({
      ...report,
      createdAt: previousReports.get(report.id)?.createdAt || report.createdAt
    })));

    return {
      ...store,
      imports: imports.slice(0, 50),
      alertEvents: alertEvents.slice(0, 10000),
      reports: reports.slice(0, 500)
    };
  }, { storePath });

  return {
    importRecord,
    automaticReport: executiveReport,
    automaticReports,
    store: nextStore
  };
}

function saveGeneratedReport(report, options = {}) {
  const now = new Date().toISOString();
  const title = String(report.title || "Generated Report").trim();
  const content = String(report.content || report.summary || "").trim();
  const record = {
    id: report.id || reportIdFor(title, `${content}\n${now}`),
    title,
    type: report.type || "generated_report",
    source: report.source || "codex",
    format: report.format || "markdown",
    summary: String(report.summary || content.slice(0, 220)).trim(),
    content,
    metadata: report.metadata || {},
    createdAt: report.createdAt || now,
    updatedAt: now
  };

  const store = updateStore((currentStore) => ({
    ...currentStore,
    reports: [record, ...currentStore.reports.filter((item) => item.id !== record.id)].slice(0, 500)
  }), options);

  return {
    report: record,
    store
  };
}

function saveManagerReview(review, options = {}) {
  const now = new Date().toISOString();
  const callId = String(review.callId || "").trim();
  if (!callId) {
    throw new Error("callId is required for manager review");
  }
  const importId = review.importId || "current";
  const id = review.id || `review_${digest(`${importId}|${callId}`, 20)}`;
  const record = {
    id,
    importId,
    callId,
    status: review.status || "reviewed",
    confirmedOutcome: review.confirmedOutcome || "",
    confirmedFollowUpRequired: Boolean(review.confirmedFollowUpRequired),
    notes: review.notes || "",
    reviewedBy: review.reviewedBy || "Manager",
    createdAt: review.createdAt || now,
    updatedAt: now
  };

  const store = updateStore((currentStore) => ({
    ...currentStore,
    managerReviews: [
      record,
      ...currentStore.managerReviews.filter((item) => item.id !== id)
    ].slice(0, 10000)
  }), options);

  return {
    review: record,
    store
  };
}

function saveAiJobReference(job, options = {}) {
  const now = new Date().toISOString();
  const jobId = String(job.jobId || job.job_id || "").trim();
  if (!jobId) {
    throw new Error("jobId is required for AI job reference");
  }
  const callId = String(job.callId || "").trim();
  const importId = job.importId || "current";
  const id = job.id || `ai_job_${digest(`${importId}|${callId}|${jobId}`, 20)}`;
  const record = {
    id,
    importId,
    callId,
    jobId,
    taskType: job.taskType || "",
    status: job.status || "submitted",
    resultLink: job.resultLink || `/api/ai/jobs/${encodeURIComponent(jobId)}`,
    metadata: job.metadata || {},
    createdAt: job.createdAt || now,
    updatedAt: now
  };

  const store = updateStore((currentStore) => ({
    ...currentStore,
    aiJobs: [
      record,
      ...currentStore.aiJobs.filter((item) => item.id !== id)
    ].slice(0, 10000)
  }), options);

  return {
    aiJob: record,
    store
  };
}

function dashboardPersistence(store, currentImportId = null) {
  const reports = [...store.reports].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const imports = [...store.imports].sort((a, b) => String(b.lastImportedAt).localeCompare(String(a.lastImportedAt)));
  const currentAlerts = currentImportId
    ? store.alertEvents.filter((event) => event.importId === currentImportId)
    : store.alertEvents;
  const currentReviews = currentImportId
    ? store.managerReviews.filter((review) => review.importId === currentImportId)
    : store.managerReviews;
  const currentAiJobs = currentImportId
    ? store.aiJobs.filter((job) => job.importId === currentImportId)
    : store.aiJobs;

  return {
    schemaVersion: "sales_dashboard_persistence_view.v1",
    currentImportId,
    importHistory: imports.slice(0, 20),
    reports: reports.slice(0, 30),
    counts: {
      imports: store.imports.length,
      reports: store.reports.length,
      alertEvents: store.alertEvents.length,
      managerReviews: store.managerReviews.length,
      aiJobs: store.aiJobs.length,
      currentAlertEvents: currentAlerts.length,
      currentManagerReviews: currentReviews.length,
      currentAiJobs: currentAiJobs.length,
      acknowledgedAlerts: currentAlerts.filter((event) => event.status !== "new").length
    }
  };
}

module.exports = {
  STORE_SCHEMA_VERSION,
  resolveStorePath,
  createEmptyStore,
  readStore,
  writeStore,
  updateStore,
  persistAnalysis,
  saveGeneratedReport,
  saveAiJobReference,
  saveManagerReview,
  dashboardPersistence
};
