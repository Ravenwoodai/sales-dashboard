"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  activeReportsOnly,
  buildParkedAllocationDiagnostic,
  classifyReportVisibility,
  parkedAllocationFromLegacyCoverage,
  reportContainsParkedAllocationData
} = require("./allocationParking");
const {
  alertIdFor,
  applyAlertLifecycleAction,
  isActiveAlertStatus,
  isClosedAlertStatus,
  normalizeAlertEvent,
  ruleIdForAlert,
  summarizeAlerts
} = require("./alertLifecycle");
const {
  applyManagerReviewAction,
  latestReviewByCallId,
  normalizeManagerReview,
  reviewIdFor,
  summarizeManagerReviews
} = require("./managerReview");
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
      managerReviews: Array.isArray(parsed.managerReviews) ? parsed.managerReviews.map(normalizeManagerReview) : [],
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

function parkedAllocationForAnalysis(analysis = {}) {
  const parkedAllocation = analysis.parkedAllocation || parkedAllocationFromLegacyCoverage(analysis.allocationCoverage);
  if (!parkedAllocation?.configured) return null;
  return buildParkedAllocationDiagnostic(parkedAllocation);
}

function buildImportRecord(analysis, options = {}) {
  const importId = options.importId || importIdForAnalysis(analysis);
  const parkedAllocation = parkedAllocationForAnalysis(analysis);
  return {
    id: importId,
    sourceName: analysis.sourceName || "CSV import",
    sourcePathHash: options.csvPath ? digest(path.resolve(options.csvPath), 20) : null,
    inputHash: analysis.inputHash,
    firstImportedAt: options.existing?.firstImportedAt || new Date().toISOString(),
    lastImportedAt: new Date().toISOString(),
    generatedAt: analysis.generatedAt,
    dateRange: analysis.dateRange,
    dataWindow: analysis.dataWindow,
    intelligenceGovernance: analysis.intelligenceGovernance,
    totals: analysis.totals,
    rates: analysis.rates,
    ignoredFields: analysis.ignoredFields,
    unsupportedMetrics: analysis.unsupportedMetrics,
    parkedAllocation,
    containsParkedAllocationData: Boolean(parkedAllocation || analysis.allocationCoverage),
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
    dataWindow: analysis.dataWindow,
    intelligenceGovernance: analysis.intelligenceGovernance,
    totals: analysis.totals,
    rates: analysis.rates,
    ignoredFields: analysis.ignoredFields,
    unsupportedMetrics: analysis.unsupportedMetrics,
    evaluationRows: analysis.evaluationRows || [],
    alerts: analysis.alerts || [],
    reviewQueue: analysis.reviewQueue || [],
    salespersonScorecards: analysis.salespersonScorecards || [],
    sourceMetrics: analysis.sourceMetrics || [],
    parkedAllocation: parkedAllocationForAnalysis(analysis),
    containsParkedAllocationData: Boolean(parkedAllocationForAnalysis(analysis) || analysis.allocationCoverage),
    aiVoiceAssistant: analysis.aiVoiceAssistant || null,
    systemAudio: analysis.systemAudio
      ? {
        ...analysis.systemAudio,
        records: []
      }
      : null,
    leadReattempt: analysis.leadReattempt
      ? {
        ...analysis.leadReattempt,
        records: []
      }
      : null
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

function buildAlertEvents(analysis, importId, existingEvents = []) {
  const existingById = new Map(existingEvents.map((event) => [event.id, normalizeAlertEvent(event)]));
  return (analysis.alerts || []).map((alert) => {
    const id = alertIdFor(importId, alert);
    const existing = existingById.get(id);
    return normalizeAlertEvent({
      ...existing,
      id,
      alertId: id,
      importId,
      ruleId: existing?.ruleId || ruleIdForAlert(alert),
      callId: alert.callId,
      category: alert.category,
      severity: alert.severity,
      owner: alert.owner,
      message: alert.message,
      evidence: alert.evidence,
      evidenceSummary: alert.evidenceSummary,
      source: alert.source || "call_transcript",
      parkedDataRelated: Boolean(alert.parkedDataRelated || alert.source === "allocation" || String(alert.category || "").toLowerCase().includes("allocation")),
      status: existing?.status || "new",
      falsePositive: existing?.falsePositive || false,
      managerNotes: existing?.managerNotes || "",
      managerNoteEntries: existing?.managerNoteEntries || [],
      lifecycleHistory: existing?.lifecycleHistory || [],
      acknowledgedBy: existing?.acknowledgedBy || "",
      acknowledgedAt: existing?.acknowledgedAt || "",
      inProgressBy: existing?.inProgressBy || "",
      inProgressAt: existing?.inProgressAt || "",
      resolvedBy: existing?.resolvedBy || "",
      resolvedAt: existing?.resolvedAt || "",
      dismissedBy: existing?.dismissedBy || "",
      dismissedAt: existing?.dismissedAt || "",
      falsePositiveBy: existing?.falsePositiveBy || "",
      falsePositiveAt: existing?.falsePositiveAt || "",
      latestAction: existing?.latestAction || "",
      latestActionAt: existing?.latestActionAt || "",
      provenance: alert.provenance || alert.alertProvenance || existing?.provenance || "Deterministic",
      alertProvenance: alert.alertProvenance || existing?.alertProvenance || "Deterministic",
      confidence: alert.confidence ?? existing?.confidence ?? null,
      confidenceLabel: alert.confidenceLabel || existing?.confidenceLabel || "",
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });
}

function buildAutomaticReport(analysis, importRecord) {
  const title = `Executive Summary - ${importRecord.sourceName}`;
  const parkedAllocation = parkedAllocationForAnalysis(analysis);
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
    `- AI call assistant encounters: ${analysis.totals.aiVoiceAssistantEncounters || 0}`,
    `- AI call assistant bail rate: ${analysis.rates.aiVoiceAssistantBail || 0}%`,
    `- System audio barriers: ${analysis.systemAudio?.totals?.encounters || 0}`,
    `- System audio recovered later: ${analysis.systemAudio?.totals?.futureHumanContact || 0}`,
    `- Lead personal retry rate: ${analysis.leadReattempt?.totals?.personalRetryRate || 0}%`,
    `- One-dial records: ${analysis.leadReattempt?.totals?.oneAndDoneLeads || 0} (${analysis.leadReattempt?.totals?.oneAndDoneRate || 0}% of matched records dialed)`,
    `- Potential lead under-utilisation: ${analysis.leadReattempt?.totals?.oneDialNoContactNoLaterLeads || 0} one-dial no-contact records with no later matching call observed`,
    `- One-dial no-contact records: ${analysis.leadReattempt?.totals?.riskyOneDialNoContactLeads || 0} (${analysis.leadReattempt?.totals?.riskyOneDialNoContactRate || 0}% of one-dial records)`,
    `- Ambiguous one-dial records excluded from utilisation-risk scoring: ${analysis.leadReattempt?.totals?.oneDialNeedsReviewLeads || 0}`,
    `- Outcome mismatches: ${analysis.totals.outcomeMismatches}`,
    `- Risk reviews: ${analysis.totals.riskReviews}`,
    `- Manager-reviewed calls: ${analysis.managerReviewGovernance?.reviewedCalls || 0}`,
    `- Manager-corrected calls: ${analysis.managerReviewGovernance?.correctedCalls || 0}`,
    `- Manager review-needed calls: ${analysis.managerReviewGovernance?.reviewNeededCalls || 0}`,
    `- Manager-escalated calls: ${analysis.managerReviewGovernance?.escalatedCalls || 0}`,
    `- Active alerts: ${analysis.alertLifecycleSummary?.active ?? (analysis.alerts || []).length}`,
    `- New alerts: ${analysis.alertLifecycleSummary?.new ?? (analysis.alerts || []).length}`,
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
    summary: `${analysis.totals.uniqueCalls} unique calls, ${analysis.totals.followUpRequired} follow-up signals, ${analysis.totals.outcomeMismatches} outcome mismatches, ${analysis.managerReviewGovernance?.reviewedCalls || 0} manager-reviewed calls.`,
    content,
    metadata: {
      importId: importRecord.id,
      sourceName: importRecord.sourceName,
      inputHash: analysis.inputHash,
      generatedBy: "automatic_import_summary",
      parkedAllocationExcluded: Boolean(parkedAllocation)
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
    containsParkedAllocationData: Boolean(report.containsParkedAllocationData || report.parkedDataRelated),
    createdAt: report.createdAt || now,
    updatedAt: now
  };
  record.containsParkedAllocationData = Boolean(record.containsParkedAllocationData || reportContainsParkedAllocationData(record));
  record.reportVisibility = classifyReportVisibility(record);

  const store = updateStore((currentStore) => ({
    ...currentStore,
    reports: [record, ...currentStore.reports.filter((item) => item.id !== record.id)].slice(0, 500)
  }), options);

  return {
    report: record,
    store
  };
}

function findManagerReview(reviews = [], reviewId, importId = null) {
  const id = String(reviewId || "").trim();
  if (!id) return null;
  return reviews.map(normalizeManagerReview).find((review) => {
    if (review.id !== id && review.reviewId !== id) return false;
    if (importId && review.importId !== importId) return false;
    return true;
  }) || null;
}

function saveManagerReview(review, options = {}) {
  const importId = review.importId || options.importId || "current";
  const reviewInput = { ...review, importId };
  const id = reviewInput.id || reviewInput.reviewId || reviewIdFor(reviewInput);
  let savedReview = null;
  const store = updateStore((currentStore) => {
    const existing = findManagerReview(currentStore.managerReviews, id, importId);
    savedReview = applyManagerReviewAction(existing, {
      action: reviewInput.action || reviewInput.reviewAction || (reviewInput.corrections?.length ? "correct" : ""),
      ...reviewInput,
      id,
      reviewId: id
    });
    return {
      ...currentStore,
      managerReviews: [
        savedReview,
        ...currentStore.managerReviews.map(normalizeManagerReview).filter((item) => item.id !== id && item.reviewId !== id)
      ].slice(0, 10000)
    };
  }, options);

  return {
    review: normalizeManagerReview(savedReview),
    store
  };
}

function updateManagerReview(reviewId, input = {}, options = {}) {
  const importId = input.importId || options.importId || null;
  let savedReview = null;
  const store = updateStore((currentStore) => {
    const existing = findManagerReview(currentStore.managerReviews, reviewId, importId);
    if (!existing) {
      const error = new Error("Manager review not found");
      error.statusCode = 404;
      throw error;
    }
    savedReview = applyManagerReviewAction(existing, input);
    return {
      ...currentStore,
      managerReviews: [
        savedReview,
        ...currentStore.managerReviews.map(normalizeManagerReview).filter((item) => item.id !== existing.id && item.reviewId !== existing.reviewId)
      ].slice(0, 10000)
    };
  }, options);
  return { review: normalizeManagerReview(savedReview), store };
}

function bulkUpdateManagerReviews(reviewIds = [], input = {}, options = {}) {
  const ids = Array.from(new Set((Array.isArray(reviewIds) ? reviewIds : [reviewIds])
    .map((id) => String(id || "").trim())
    .filter(Boolean)));
  if (!ids.length) {
    const error = new Error("At least one manager review ID is required.");
    error.statusCode = 400;
    throw error;
  }
  const importId = input.importId || options.importId || null;
  const updated = [];
  const missingReviewIds = [];
  const store = updateStore((currentStore) => {
    const idSet = new Set(ids);
    const reviews = (currentStore.managerReviews || []).map(normalizeManagerReview).map((review) => {
      if (!idSet.has(review.id) && !idSet.has(review.reviewId)) return review;
      if (importId && review.importId !== importId) return review;
      const next = applyManagerReviewAction(review, input);
      updated.push(next);
      return next;
    });
    ids.forEach((id) => {
      if (!updated.some((review) => review.id === id || review.reviewId === id)) missingReviewIds.push(id);
    });
    if (!updated.length) {
      const error = new Error("No matching manager reviews were updated.");
      error.statusCode = 404;
      throw error;
    }
    return {
      ...currentStore,
      managerReviews: reviews.slice(0, 10000)
    };
  }, options);
  return {
    reviews: updated.map(normalizeManagerReview),
    missingReviewIds,
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

function findActiveAlertIndex(events = [], alertId, importId = null) {
  const id = String(alertId || "").trim();
  if (!id) return -1;
  return events.findIndex((event) => {
    if (event.id !== id && event.alertId !== id) return false;
    if (importId && event.importId !== importId) return false;
    return true;
  });
}

function updateAlertLifecycle(alertId, input = {}, options = {}) {
  const importId = input.importId || options.importId || null;
  const store = updateStore((currentStore) => {
    const index = findActiveAlertIndex(currentStore.alertEvents || [], alertId, importId);
    if (index < 0) {
      const error = new Error("Alert not found");
      error.statusCode = 404;
      throw error;
    }
    const current = currentStore.alertEvents[index];
    const next = applyAlertLifecycleAction(current, input);
    const alertEvents = currentStore.alertEvents.slice();
    alertEvents[index] = next;
    return {
      ...currentStore,
      alertEvents
    };
  }, options);
  const alertEvent = (store.alertEvents || []).find((event) => {
    if (event.id !== alertId && event.alertId !== alertId) return false;
    if (importId && event.importId !== importId) return false;
    return true;
  });
  return { alertEvent: normalizeAlertEvent(alertEvent), store };
}

function bulkUpdateAlertLifecycle(alertIds = [], input = {}, options = {}) {
  const ids = Array.from(new Set((Array.isArray(alertIds) ? alertIds : [alertIds])
    .map((id) => String(id || "").trim())
    .filter(Boolean)));
  if (!ids.length) {
    const error = new Error("At least one alert ID is required.");
    error.statusCode = 400;
    throw error;
  }
  const importId = input.importId || options.importId || null;
  const updatedIds = [];
  const missingAlertIds = [];
  const store = updateStore((currentStore) => {
    const idSet = new Set(ids);
    const alertEvents = (currentStore.alertEvents || []).map((event) => {
      const eventId = event.id || event.alertId;
      if (!idSet.has(eventId) || (importId && event.importId !== importId)) return event;
      updatedIds.push(eventId);
      return applyAlertLifecycleAction(event, input);
    });
    ids.forEach((id) => {
      if (!updatedIds.includes(id)) missingAlertIds.push(id);
    });
    if (!updatedIds.length) {
      const error = new Error("No matching alerts were updated.");
      error.statusCode = 404;
      throw error;
    }
    return {
      ...currentStore,
      alertEvents
    };
  }, options);
  const updatedSet = new Set(updatedIds);
  return {
    alertEvents: (store.alertEvents || []).filter((event) => updatedSet.has(event.id || event.alertId)).map(normalizeAlertEvent),
    missingAlertIds,
    store
  };
}

function dashboardPersistence(store, currentImportId = null) {
  const allReports = [...store.reports].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const reports = activeReportsOnly(allReports).map((report) => ({
    ...report,
    reportVisibility: classifyReportVisibility(report)
  }));
  const imports = [...store.imports].sort((a, b) => String(b.lastImportedAt).localeCompare(String(a.lastImportedAt)));
  const rawCurrentAlerts = currentImportId
    ? store.alertEvents.filter((event) => event.importId === currentImportId)
    : store.alertEvents;
  const currentAlerts = rawCurrentAlerts.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated);
  const currentAlertSummary = summarizeAlerts(currentAlerts);
  const currentReviews = (currentImportId
    ? store.managerReviews.filter((review) => review.importId === currentImportId)
    : store.managerReviews).map(normalizeManagerReview);
  const latestReviews = latestReviewByCallId(currentReviews);
  const managerReviewSummaries = Array.from(latestReviews.values()).map((review) => ({
    reviewId: review.reviewId,
    callId: review.callId,
    alertId: review.alertId,
    reviewScope: review.reviewScope,
    reviewStatus: review.reviewStatus,
    reviewedBy: review.reviewedBy,
    reviewedAt: review.reviewedAt,
    updatedAt: review.updatedAt,
    managerNotes: review.managerNotes,
    correctionCount: (review.corrections || []).length,
    correctedFields: (review.corrections || []).map((correction) => correction.fieldName),
    latestCorrection: (review.corrections || []).slice(-1)[0] || null
  }));
  const managerReviewGovernance = summarizeManagerReviews(currentReviews);
  const currentAiJobs = currentImportId
    ? store.aiJobs.filter((job) => job.importId === currentImportId)
    : store.aiJobs;

  return {
    schemaVersion: "sales_dashboard_persistence_view.v1",
    currentImportId,
    managerReviewedCallIds: Array.from(new Set(currentReviews.map((review) => review.callId).filter(Boolean))).slice(0, 5000),
    managerReviewSummaries,
    managerReviewStatusByCallId: Object.fromEntries(managerReviewSummaries.map((review) => [review.callId, review.reviewStatus])),
    managerReviewGovernance,
    importHistory: imports.slice(0, 20),
    reports: reports.slice(0, 30),
    counts: {
      imports: store.imports.length,
      reports: reports.length,
      hiddenParkedReports: allReports.length - reports.length,
      alertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && isActiveAlertStatus(event.status)).length,
      closedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && isClosedAlertStatus(event.status)).length,
      totalUnparkedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated).length,
      parkedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => event.parkedDataRelated).length,
      managerReviews: store.managerReviews.length,
      aiJobs: store.aiJobs.length,
      currentAlertEvents: currentAlertSummary.active,
      currentTotalAlertEvents: currentAlertSummary.total,
      currentClosedAlertEvents: currentAlertSummary.closed,
      newAlerts: currentAlertSummary.new,
      acknowledgedAlerts: currentAlertSummary.acknowledged,
      inProgressAlerts: currentAlertSummary.inProgress,
      resolvedAlerts: currentAlertSummary.resolved,
      dismissedAlerts: currentAlertSummary.dismissed,
      falsePositiveAlerts: currentAlertSummary.falsePositive,
      currentManagerReviews: currentReviews.length,
      currentManagerReviewedCalls: managerReviewGovernance.reviewedCalls,
      currentManagerCorrectedCalls: managerReviewGovernance.correctedCalls,
      currentManagerEscalatedCalls: managerReviewGovernance.escalatedCalls,
      currentManagerReviewNeededCalls: managerReviewGovernance.reviewNeededCalls,
      currentAiJobs: currentAiJobs.length
    },
    alertLifecycleSummary: currentAlertSummary
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
  updateManagerReview,
  bulkUpdateManagerReviews,
  updateAlertLifecycle,
  bulkUpdateAlertLifecycle,
  dashboardPersistence
};
