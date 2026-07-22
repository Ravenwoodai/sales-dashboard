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
  applyBadLeadClaimTransition,
  createBadLeadClaim,
  validateStoredClaim
} = require("./badLeadClaim");
const {
  applyManagerReviewAction,
  latestReviewByCallId,
  normalizeManagerReview,
  reviewIdFor,
  summarizeManagerReviews
} = require("./managerReview");
const {
  archiveEvaluationTemplate,
  archiveKnowledgebaseEntry,
  buildEvaluationStudioReportRollups,
  createDefaultEvaluationStudio,
  createEvaluationRun,
  evaluationStudioSummary,
  listEvaluationTemplates,
  listEvaluationResults,
  listKnowledgebaseEntries,
  normalizeEvaluationStudio,
  quarantineEvaluationRun,
  resumeEvaluationRun,
  updateEvaluationRun,
  upsertEvaluationResult,
  upsertEvaluationTemplate,
  upsertKnowledgebaseEntry
} = require("./evaluationStudio");
const {
  evaluationStudioSqliteStub,
  isEvaluationStudioSqliteStub,
  loadEvaluationStudio,
  syncEvaluationStudio
} = require("./evaluationStudioDatabase");
const { buildLeadUtilizationReport } = require("./leadUtilizationReport");
const {
  UNTRUSTED_LEGACY_POLICY,
  alertContainsUntrustedLegacyData,
  managerReviewContainsUntrustedLegacyData,
  sanitizeImportSummary,
  sanitizeManagerReviewForPublic,
  sanitizeUntrustedLegacyDataForPublic
} = require("./untrustedLegacyFields");

const STORE_SCHEMA_VERSION = "sales_dashboard_store.v1";
const TRANSIENT_STORE_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);
const STORE_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 250, 400];

function waitSynchronously(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

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
    badLeadClaims: [],
    managerReviews: [],
    aiJobs: [],
    evaluationStudio: createDefaultEvaluationStudio(),
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

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch (error) {
    const store = createEmptyStore();
    store.readError = error.message;
    return store;
  }
  let evaluationStudio;
  if (isEvaluationStudioSqliteStub(parsed.evaluationStudio)) {
    const loaded = loadEvaluationStudio({ ...options, storePath });
    evaluationStudio = loaded.studio;
  } else {
    evaluationStudio = normalizeEvaluationStudio(parsed.evaluationStudio);
  }
  return {
    ...createEmptyStore(),
    ...parsed,
    imports: Array.isArray(parsed.imports) ? parsed.imports : [],
    alertEvents: Array.isArray(parsed.alertEvents) ? parsed.alertEvents : [],
    badLeadClaims: Array.isArray(parsed.badLeadClaims) ? parsed.badLeadClaims : [],
    managerReviews: Array.isArray(parsed.managerReviews) ? parsed.managerReviews.map(normalizeManagerReview) : [],
    aiJobs: Array.isArray(parsed.aiJobs) ? parsed.aiJobs : [],
    evaluationStudio,
    reports: Array.isArray(parsed.reports) ? parsed.reports : []
  };
}

function writeStore(store, options = {}) {
  const storePath = resolveStorePath(options);
  ensureDirectory(storePath);
  const evaluationStudioSync = syncEvaluationStudio(store.evaluationStudio, { ...options, storePath });
  const nextStore = {
    ...store,
    schemaVersion: STORE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    evaluationStudio: evaluationStudioSync.studio
  };
  const persistedStore = {
    ...nextStore,
    evaluationStudio: evaluationStudioSqliteStub(evaluationStudioSync)
  };
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(persistedStore, null, 2)}\n`, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, storePath);
      break;
    } catch (error) {
      const retryDelay = STORE_RENAME_RETRY_DELAYS_MS[attempt];
      if (!TRANSIENT_STORE_RENAME_ERRORS.has(error?.code) || retryDelay === undefined) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // Preserve the original persistence error.
        }
        throw error;
      }
      waitSynchronously(retryDelay);
    }
  }
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
    untrustedLegacyFields: UNTRUSTED_LEGACY_POLICY,
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
    untrustedLegacyFields: UNTRUSTED_LEGACY_POLICY,
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
      provenance: alert.provenance || alert.alertProvenance || existing?.provenance || "Restricted direct-customer opt-out rule",
      alertProvenance: alert.alertProvenance || existing?.alertProvenance || "Restricted direct-customer opt-out rule",
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
    `- Literal AI call assistant detections: ${analysis.totals.aiVoiceAssistantEncounters || 0}`,
    `- Literal system-audio detections: ${analysis.systemAudio?.totals?.encounters || 0}`,
    `- Lead personal retry rate: ${analysis.leadReattempt?.totals?.personalRetryRate || 0}%`,
    `- One-dial records: ${analysis.leadReattempt?.totals?.oneAndDoneLeads || 0} (${analysis.leadReattempt?.totals?.oneAndDoneRate || 0}% of matched records dialed)`,
    `- Literal one-dial no-contact records: ${analysis.leadReattempt?.totals?.literalOneDialNoContactLeads || 0}`,
    `- Literal one-dial no-contact records with no later match in this dataset: ${analysis.leadReattempt?.totals?.literalOneDialNoContactNoLaterLeads || 0}`,
    `- One-dial records without a validated literal state: ${analysis.leadReattempt?.totals?.oneDialNeedsReviewLeads || 0}`,
    `- Direct-customer opt-out reviews: ${analysis.totals.riskReviews}`,
    `- Manager-reviewed calls: ${analysis.managerReviewGovernance?.reviewedCalls || 0}`,
    `- Manager-corrected calls: ${analysis.managerReviewGovernance?.correctedCalls || 0}`,
    `- Manager review-needed calls: ${analysis.managerReviewGovernance?.reviewNeededCalls || 0}`,
    `- Manager-escalated calls: ${analysis.managerReviewGovernance?.escalatedCalls || 0}`,
    `- Active alerts: ${analysis.alertLifecycleSummary?.active ?? (analysis.alerts || []).length}`,
    `- New alerts: ${analysis.alertLifecycleSummary?.new ?? (analysis.alerts || []).length}`,
    "",
    "## Guardrails",
    "- Semantic transcript outcomes, callbacks, interest, complaints, quality, coaching, and performance decisions were not evaluated.",
    "- Blank transcripts remain unknown; they are not counted as no-answer or no-contact.",
    "- Redacted phone values were not used for matching, attribution, or display.",
    "- Untrusted legacy disposition and note fields were preserved in the raw source only and excluded from active analytics, AI context, alerts, filters, reports, and normal UI.",
    "- Valid CustomerImportDate and CustomerCreateDate values were parsed for source-quality analytics; malformed date fragments were treated as missing.",
    "- Confirmed sales, revenue, order value, close date, and won/lost outcome are unsupported by the current CSV."
  ].join("\n");

  return {
    id: `report_${importRecord.id}_executive_summary`,
    title,
    type: "executive_summary",
    source: "system",
    format: "markdown",
    summary: `${analysis.totals.uniqueCalls} unique calls, ${analysis.totals.riskReviews} direct opt-out reviews, ${analysis.managerReviewGovernance?.reviewedCalls || 0} manager-reviewed calls; semantic transcript decisions unavailable.`,
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

function findBadLeadClaim(claims = [], claimId) {
  const id = String(claimId || "").trim();
  if (!id) return null;
  const claim = claims.find((item) => item?.claim_id === id);
  return claim ? validateStoredClaim(claim) : null;
}

function listBadLeadClaims(filters = {}, options = {}) {
  const store = readStore(options);
  const leadId = String(filters.leadId || filters.lead_id || "").trim();
  const callId = String(filters.callId || filters.call_id || "").trim();
  const status = String(filters.status || filters.claim_status || "").trim();
  return (store.badLeadClaims || [])
    .map(validateStoredClaim)
    .filter((claim) => !leadId || claim.lead_id === leadId)
    .filter((claim) => !callId || claim.call_id === callId)
    .filter((claim) => !status || claim.claim_status === status)
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function saveBadLeadClaim(input = {}, trustedContext = {}, options = {}) {
  const claim = createBadLeadClaim(input, trustedContext);
  const store = updateStore((currentStore) => {
    if (findBadLeadClaim(currentStore.badLeadClaims || [], claim.claim_id)) {
      const error = new Error("Bad-lead claim ID already exists.");
      error.statusCode = 409;
      throw error;
    }
    return {
      ...currentStore,
      badLeadClaims: [claim, ...(currentStore.badLeadClaims || [])]
    };
  }, options);
  return { claim, store };
}

function updateBadLeadClaim(claimId, input = {}, trustedContext = {}, options = {}) {
  const id = String(claimId || "").trim();
  if (!id) {
    const error = new Error("Bad-lead claim ID is required.");
    error.statusCode = 400;
    throw error;
  }
  let updatedClaim = null;
  const store = updateStore((currentStore) => {
    const existing = findBadLeadClaim(currentStore.badLeadClaims || [], id);
    if (!existing) {
      const error = new Error("Bad-lead claim not found.");
      error.statusCode = 404;
      throw error;
    }
    updatedClaim = applyBadLeadClaimTransition(existing, input, trustedContext);
    return {
      ...currentStore,
      badLeadClaims: (currentStore.badLeadClaims || []).map((claim) => claim.claim_id === id ? updatedClaim : claim)
    };
  }, options);
  return { claim: updatedClaim, store };
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
    const historical = findManagerReview(currentStore.managerReviews, id, importId);
    const targetId = historical && managerReviewContainsUntrustedLegacyData(historical) ? `${id}_current` : id;
    const existing = findManagerReview(currentStore.managerReviews, targetId, importId);
    savedReview = applyManagerReviewAction(existing, {
      action: reviewInput.action || reviewInput.reviewAction || (reviewInput.corrections?.length ? "correct" : ""),
      ...reviewInput,
      id: targetId,
      reviewId: targetId
    });
    return {
      ...currentStore,
      managerReviews: [
        savedReview,
        ...currentStore.managerReviews.map(normalizeManagerReview).filter((item) => item.id !== targetId && item.reviewId !== targetId)
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
    if (managerReviewContainsUntrustedLegacyData(existing)) {
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
      if (managerReviewContainsUntrustedLegacyData(review)) return review;
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

function aiJobReferenceRecord(job, now = new Date().toISOString()) {
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
  return record;
}

function saveAiJobReferences(jobs = [], options = {}) {
  const now = new Date().toISOString();
  const records = jobs.map((job) => aiJobReferenceRecord(job, now));
  if (!records.length) {
    return { aiJobs: [], store: readStore(options) };
  }
  const recordIds = new Set(records.map((record) => record.id));
  const store = updateStore((currentStore) => ({
    ...currentStore,
    aiJobs: [
      ...records,
      ...currentStore.aiJobs.filter((item) => !recordIds.has(item.id))
    ].slice(0, 10000)
  }), options);
  return { aiJobs: records, store };
}

function saveAiJobReference(job, options = {}) {
  const saved = saveAiJobReferences([job], options);

  return {
    aiJob: saved.aiJobs[0],
    store: saved.store
  };
}

function saveEvaluationHarvestBatch(input = {}, options = {}) {
  const now = new Date().toISOString();
  const aiJobRecords = (Array.isArray(input.aiJobs) ? input.aiJobs : [])
    .map((job) => aiJobReferenceRecord(job, now));
  const evaluationResults = Array.isArray(input.evaluationResults) ? input.evaluationResults : [];
  const savedResults = [];
  const resultErrors = [];
  const store = updateStore((currentStore) => {
    let studio = normalizeEvaluationStudio(currentStore.evaluationStudio);
    for (const candidate of evaluationResults) {
      const jobId = String(candidate.jobId || candidate.job_id || "").trim();
      const callId = String(candidate.callId || candidate.call_id || "").trim();
      const runId = String(candidate.runId || candidate.evaluationRunId || candidate.evaluation_run_id || "").trim();
      const existing = (studio.evaluationResults || []).find((result) =>
        result.isLatest !== false
        && result.runId === runId
        && result.callId === callId
        && (!jobId || result.jobId === jobId)
      );
      if (existing) {
        savedResults.push({ jobId, callId, runId, result: existing, alreadyStored: true });
        continue;
      }
      try {
        const saved = upsertEvaluationResult(studio, candidate);
        studio = saved.studio;
        savedResults.push({ jobId, callId, runId, result: saved.result, alreadyStored: false });
      } catch (error) {
        resultErrors.push({
          jobId,
          callId,
          runId,
          error,
          statusCode: Number(error?.statusCode || error?.status || 0),
          message: String(error?.message || error).slice(0, 1000)
        });
      }
    }
    const recordIds = new Set(aiJobRecords.map((record) => record.id));
    return {
      ...currentStore,
      aiJobs: aiJobRecords.length
        ? [...aiJobRecords, ...currentStore.aiJobs.filter((item) => !recordIds.has(item.id))].slice(0, 10000)
        : currentStore.aiJobs,
      evaluationStudio: studio
    };
  }, options);
  return {
    aiJobs: aiJobRecords,
    results: savedResults,
    resultErrors,
    store
  };
}

function saveEvaluationKnowledgebaseEntry(input = {}, options = {}) {
  let savedEntry = null;
  const store = updateStore((currentStore) => {
    const nextStudio = upsertKnowledgebaseEntry(currentStore.evaluationStudio, input);
    savedEntry = nextStudio.knowledgebaseEntries.find((entry) => entry.id === (input.id || nextStudio.knowledgebaseEntries[0]?.id)) || nextStudio.knowledgebaseEntries[0];
    return {
      ...currentStore,
      evaluationStudio: nextStudio
    };
  }, options);
  return {
    entry: savedEntry,
    store
  };
}

function archiveEvaluationKnowledgebaseEntry(id, options = {}) {
  let savedEntry = null;
  const store = updateStore((currentStore) => {
    const nextStudio = archiveKnowledgebaseEntry(currentStore.evaluationStudio, id);
    savedEntry = nextStudio.knowledgebaseEntries.find((entry) => entry.id === id);
    return {
      ...currentStore,
      evaluationStudio: nextStudio
    };
  }, options);
  return {
    entry: savedEntry,
    store
  };
}

function saveEvaluationTemplate(input = {}, options = {}) {
  let savedTemplate = null;
  const store = updateStore((currentStore) => {
    const nextStudio = upsertEvaluationTemplate(currentStore.evaluationStudio, input);
    savedTemplate = nextStudio.evaluationTemplates.find((template) => template.id === (input.id || nextStudio.evaluationTemplates[0]?.id)) || nextStudio.evaluationTemplates[0];
    return {
      ...currentStore,
      evaluationStudio: nextStudio
    };
  }, options);
  return {
    template: savedTemplate,
    store
  };
}

function archiveEvaluationTemplateRecord(id, options = {}) {
  let savedTemplate = null;
  const store = updateStore((currentStore) => {
    const nextStudio = archiveEvaluationTemplate(currentStore.evaluationStudio, id);
    savedTemplate = nextStudio.evaluationTemplates.find((template) => template.id === id);
    return {
      ...currentStore,
      evaluationStudio: nextStudio
    };
  }, options);
  return {
    template: savedTemplate,
    store
  };
}

function saveEvaluationRun(input = {}, context = {}, options = {}) {
  let savedRun = null;
  const store = updateStore((currentStore) => {
    const result = createEvaluationRun(currentStore.evaluationStudio, input, context);
    savedRun = result.run;
    return {
      ...currentStore,
      evaluationStudio: result.studio
    };
  }, options);
  return {
    run: savedRun,
    store
  };
}

function updateStoredEvaluationRun(runId, patch = {}, options = {}) {
  let savedRun = null;
  const store = updateStore((currentStore) => {
    const result = updateEvaluationRun(currentStore.evaluationStudio, runId, patch);
    savedRun = result.run;
    return {
      ...currentStore,
      evaluationStudio: result.studio
    };
  }, options);
  return {
    run: savedRun,
    store
  };
}

function quarantineStoredEvaluationRun(runId, input = {}, options = {}) {
  let savedRun = null;
  const store = updateStore((currentStore) => {
    const result = quarantineEvaluationRun(currentStore.evaluationStudio, runId, input);
    savedRun = result.run;
    return {
      ...currentStore,
      evaluationStudio: result.studio
    };
  }, options);
  return {
    run: savedRun,
    store
  };
}

function resumeStoredEvaluationRun(runId, input = {}, options = {}) {
  let savedRun = null;
  const store = updateStore((currentStore) => {
    const result = resumeEvaluationRun(currentStore.evaluationStudio, runId, input);
    savedRun = result.run;
    return {
      ...currentStore,
      evaluationStudio: result.studio
    };
  }, options);
  return {
    run: savedRun,
    store
  };
}

function saveEvaluationResult(input = {}, options = {}) {
  let savedResult = null;
  const store = updateStore((currentStore) => {
    const result = upsertEvaluationResult(currentStore.evaluationStudio, input);
    savedResult = result.result;
    return {
      ...currentStore,
      evaluationStudio: result.studio
    };
  }, options);
  return {
    result: savedResult,
    store
  };
}

function findActiveAlertIndex(events = [], alertId, importId = null) {
  const id = String(alertId || "").trim();
  if (!id) return -1;
  return events.findIndex((event) => {
    if (event.id !== id && event.alertId !== id) return false;
    if (importId && event.importId !== importId) return false;
    if (alertContainsUntrustedLegacyData(event)) return false;
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
      if (alertContainsUntrustedLegacyData(event)) return event;
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

function dashboardPersistence(store, currentImportId = null, options = {}) {
  const allReports = [...store.reports].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const reports = activeReportsOnly(allReports).map((report) => ({
    ...report,
    reportVisibility: classifyReportVisibility(report)
  }));
  const imports = [...store.imports]
    .map(sanitizeImportSummary)
    .sort((a, b) => String(b.lastImportedAt).localeCompare(String(a.lastImportedAt)));
  const rawCurrentAlerts = currentImportId
    ? store.alertEvents.filter((event) => event.importId === currentImportId)
    : store.alertEvents;
  const currentAlerts = rawCurrentAlerts.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && !alertContainsUntrustedLegacyData(event));
  const currentAlertSummary = summarizeAlerts(currentAlerts);
  const allSafeReviews = (store.managerReviews || []).map(normalizeManagerReview).filter((review) => !managerReviewContainsUntrustedLegacyData(review));
  const currentReviews = (currentImportId
    ? store.managerReviews.filter((review) => review.importId === currentImportId)
    : store.managerReviews).map(normalizeManagerReview).filter((review) => !managerReviewContainsUntrustedLegacyData(review));
  const latestReviews = latestReviewByCallId(currentReviews);
  const managerReviewSummaries = Array.from(latestReviews.values()).map(sanitizeManagerReviewForPublic).map((review) => ({
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
    latestCorrection: (review.corrections || []).slice(-1)[0] || null,
    suggestedCorrectionCount: (review.suggestedCorrections || []).length,
    suggestedCorrectionFields: (review.suggestedCorrections || []).map((suggestion) => suggestion.fieldName),
    latestSuggestedCorrection: (review.suggestedCorrections || []).slice(-1)[0] || null
  }));
  const managerReviewGovernance = summarizeManagerReviews(currentReviews);
  const currentAiJobs = currentImportId
    ? store.aiJobs.filter((job) => job.importId === currentImportId)
    : store.aiJobs;
  const evaluationStudio = normalizeEvaluationStudio(store.evaluationStudio);
  const evaluationCallIds = options.evaluationCallIds
    ? new Set(Array.from(options.evaluationCallIds).map((id) => String(id || "").trim()).filter(Boolean))
    : null;
  const evaluationStudioView = {
    summary: evaluationStudioSummary(evaluationStudio, currentImportId, { callIds: evaluationCallIds }),
    reportRollups: buildEvaluationStudioReportRollups(evaluationStudio, { importId: currentImportId || "", callIds: evaluationCallIds }),
    knowledgebaseEntries: listKnowledgebaseEntries(evaluationStudio).slice(0, 50),
    evaluationTemplates: listEvaluationTemplates(evaluationStudio).slice(0, 50),
    evaluationRuns: (evaluationStudio.evaluationRuns || [])
      .filter((run) => !run.containsUntrustedLegacyData && (!currentImportId || run.importId === currentImportId))
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 30)
      .map(sanitizeUntrustedLegacyDataForPublic),
    evaluationResults: listEvaluationResults(evaluationStudio, {
      importId: currentImportId || "",
      callIds: evaluationCallIds,
      reviewRecommended: false
    }).slice(0, 50),
    evidenceQueue: listEvaluationResults(evaluationStudio, {
      importId: currentImportId || "",
      callIds: evaluationCallIds,
      reviewRecommended: true,
      operationalOnly: true
    }).slice(0, 50)
  };

  return {
    schemaVersion: "sales_dashboard_persistence_view.v1",
    currentImportId,
    managerReviewedCallIds: Array.from(new Set(currentReviews.map((review) => review.callId).filter(Boolean))).slice(0, 5000),
    managerReviewSummaries,
    managerReviewStatusByCallId: Object.fromEntries(managerReviewSummaries.map((review) => [review.callId, review.reviewStatus])),
    managerReviewGovernance,
    evaluationStudio: evaluationStudioView,
    importHistory: imports.slice(0, 20),
    reports: reports.slice(0, 30),
    counts: {
      imports: store.imports.length,
      reports: reports.length,
      hiddenParkedReports: allReports.length - reports.length,
      alertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && !alertContainsUntrustedLegacyData(event) && isActiveAlertStatus(event.status)).length,
      closedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && !alertContainsUntrustedLegacyData(event) && isClosedAlertStatus(event.status)).length,
      totalUnparkedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => !event.parkedDataRelated && !alertContainsUntrustedLegacyData(event)).length,
      parkedAlertEvents: store.alertEvents.map(normalizeAlertEvent).filter((event) => event.parkedDataRelated).length,
      managerReviews: allSafeReviews.length,
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
      currentAiJobs: currentAiJobs.length,
      evaluationKnowledgebaseEntries: evaluationStudioView.summary.activeKnowledgebaseEntries,
      evaluationTemplates: evaluationStudioView.summary.activeTemplates,
      evaluationRuns: evaluationStudioView.summary.runs,
      evaluationResults: evaluationStudioView.summary.results,
      evaluationReviewRecommendedResults: evaluationStudioView.summary.reviewRecommendedResults,
      evaluationEvidenceUnavailableResults: evaluationStudioView.summary.evidenceUnavailableResults
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
  findBadLeadClaim,
  listBadLeadClaims,
  saveBadLeadClaim,
  updateBadLeadClaim,
  saveAiJobReference,
  saveAiJobReferences,
  saveEvaluationHarvestBatch,
  saveEvaluationKnowledgebaseEntry,
  archiveEvaluationKnowledgebaseEntry,
  saveEvaluationTemplate,
  archiveEvaluationTemplateRecord,
  saveEvaluationRun,
  updateStoredEvaluationRun,
  quarantineStoredEvaluationRun,
  resumeStoredEvaluationRun,
  saveEvaluationResult,
  saveManagerReview,
  updateManagerReview,
  bulkUpdateManagerReviews,
  updateAlertLifecycle,
  bulkUpdateAlertLifecycle,
  dashboardPersistence
};
