"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  checkAiExecutionHealth,
  EVALUATION_STUDIO_TASK_TYPE,
  getAiJob,
  INTELLIGENCE_TASK_TYPE,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitAiTask,
  submitTranscriptIntelligenceExtraction,
  submitTranscriptEvaluation
} = require("./aiExecutionLayer");
const { analyzeCsvText, attachInternalItems, buildFilteredAnalysis, internalItemsFor } = require("./analysis");
const { buildDrilldownResult, findCallProof } = require("./drilldown");
const { normalizeFilterState } = require("./globalFilters");
const { summarizeLeadReattemptRecords } = require("./leadReattemptAnalytics");
const { summarizeLeadHarvestRecords } = require("./leadHarvestAnalytics");
const { summarizeSystemAudioRecords } = require("./systemAudioAnalytics");
const {
  getIntelligenceSummary,
  listCallIntelligence,
  listLlmJobs,
  markLlmJobFailed,
  markLlmJobQueued,
  replaceImportIntelligence,
  resolveIntelligenceDbPath,
  saveLlmIntelligenceResult
} = require("./intelligenceDatabase");
const { readAllocationFile } = require("./allocationCoverage");
const { activeReportsOnly, buildParkedAllocationDiagnostic, classifyReportVisibility } = require("./allocationParking");
const { normalizeAlertEvent, resolveAlertLifecycleActor } = require("./alertLifecycle");
const {
  buildEvaluationStudioInput,
  buildEvaluationStudioReportRollups,
  buildManagerReviewPrefillCorrections,
  EVALUATION_STUDIO_ACTOR,
  evaluationStudioSummary,
  listEvaluationResults,
  listEvaluationTemplates,
  listKnowledgebaseEntries,
  managerReviewReasonForEvaluationResult,
  managerReviewScopeForEvaluationGoal,
  normalizeEvaluationStudio
} = require("./evaluationStudio");
const { normalizeManagerReview, resolveManagerReviewActor } = require("./managerReview");
const { renderCallPage, renderDashboard, renderDrilldownPage, renderEmptyState, renderEvaluationStudioPage, renderReportPage } = require("./dashboardRenderer");
const { readTabularFile } = require("./sourceFile");
const {
  bulkUpdateAlertLifecycle,
  bulkUpdateManagerReviews,
  dashboardPersistence,
  archiveEvaluationKnowledgebaseEntry,
  archiveEvaluationTemplateRecord,
  persistAnalysis,
  quarantineStoredEvaluationRun,
  readStore,
  resumeStoredEvaluationRun,
  resolveStorePath,
  saveAiJobReference,
  saveEvaluationKnowledgebaseEntry,
  saveEvaluationResult,
  saveEvaluationRun,
  saveEvaluationTemplate,
  saveGeneratedReport,
  saveManagerReview,
  updateStoredEvaluationRun,
  updateManagerReview,
  updateAlertLifecycle
} = require("./storage");
const { buildCallIntelligence } = require("./transcriptIntelligence");

const DEFAULT_LOGO_PATH = path.join(__dirname, "assets", "sales-dashboard-logo.png");
const BRAND_LOGO_LIMIT_BYTES = 768 * 1024;
const BRAND_LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
const EVALUATION_STUDIO_AUTO_HARVEST_MAX_RUNS = 5;
const EVALUATION_STUDIO_AUTO_HARVEST_MAX_JOBS = 5;

function resolveCsvPath(argv = process.argv.slice(2), env = process.env) {
  const csvFlagIndex = argv.findIndex((arg) => arg === "--csv" || arg === "--csv-path");
  if (csvFlagIndex >= 0 && argv[csvFlagIndex + 1]) {
    return path.resolve(argv[csvFlagIndex + 1]);
  }
  if (env.SALES_DASHBOARD_CSV_PATH) {
    return path.resolve(env.SALES_DASHBOARD_CSV_PATH);
  }
  return null;
}

function resolveAllocationPath(argv = process.argv.slice(2), env = process.env) {
  const allocationFlagIndex = argv.findIndex((arg) => arg === "--allocations" || arg === "--allocations-path");
  if (allocationFlagIndex >= 0 && argv[allocationFlagIndex + 1]) {
    return path.resolve(argv[allocationFlagIndex + 1]);
  }
  if (env.SALES_DASHBOARD_ALLOCATIONS_PATH) {
    return path.resolve(env.SALES_DASHBOARD_ALLOCATIONS_PATH);
  }
  return null;
}

function brandLogoDirectory(storePath) {
  return path.join(path.dirname(resolveStorePath({ storePath })), "branding");
}

function findBrandLogo(storePath) {
  const directory = brandLogoDirectory(storePath);
  const custom = Object.values(BRAND_LOGO_TYPES)
    .map((extension) => path.join(directory, `logo.${extension}`))
    .find((filePath) => fs.existsSync(filePath));
  return custom || DEFAULT_LOGO_PATH;
}

function mimeForLogo(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function saveBrandLogo(dataUrl, storePath) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Logo upload must be a PNG, JPEG, or WebP image.");
  }

  const [, mimeType, payload] = match;
  const extension = BRAND_LOGO_TYPES[mimeType];
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length || buffer.length > BRAND_LOGO_LIMIT_BYTES) {
    throw new Error("Logo image must be smaller than 768KB.");
  }

  const directory = brandLogoDirectory(storePath);
  fs.mkdirSync(directory, { recursive: true });
  const resolvedDirectory = path.resolve(directory);
  Object.values(BRAND_LOGO_TYPES).forEach((existingExtension) => {
    const existingPath = path.resolve(directory, `logo.${existingExtension}`);
    if (existingPath.startsWith(resolvedDirectory) && fs.existsSync(existingPath)) {
      fs.unlinkSync(existingPath);
    }
  });

  const logoPath = path.resolve(directory, `logo.${extension}`);
  if (!logoPath.startsWith(resolvedDirectory)) {
    throw new Error("Resolved logo path is outside the branding directory.");
  }
  fs.writeFileSync(logoPath, buffer);
  return logoPath;
}

function attachPersistence(analysis, store, currentImportId = null) {
  return attachInternalItems({
    ...analysis,
    persistence: dashboardPersistence(store, currentImportId)
  }, internalItemsFor(analysis));
}

function parkedAllocationForPath(allocationPath) {
  if (!allocationPath) {
    return buildParkedAllocationDiagnostic({ configured: false, readStatus: "not_configured" });
  }

  try {
    const allocation = readAllocationFile(allocationPath);
    return buildParkedAllocationDiagnostic({
      configured: true,
      sourceName: allocation.sourceName,
      sourceType: allocation.sourceType,
      sheetName: allocation.sheetName,
      readStatus: "readable_but_parked"
    });
  } catch (error) {
    return buildParkedAllocationDiagnostic({
      configured: true,
      sourceName: path.basename(allocationPath),
      readStatus: "parked_read_error",
      error: "Allocation source could not be read while parked."
    });
  }
}

function allocationDiagnosticFromState(state, allocationPath) {
  return state.analysis?.parkedAllocation || parkedAllocationForPath(allocationPath);
}

function loadAnalysis(csvPath, options = {}) {
  const storePath = resolveStorePath(options);
  const allocationPath = options.allocationPath || null;
  const parkedAllocation = parkedAllocationForPath(allocationPath);
  if (!csvPath) {
    return {
      analysis: attachPersistence(
        {
          ...renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export."),
          parkedAllocation
        },
        readStore({ storePath })
      ),
      csvPath: null,
      error: null
    };
  }

  try {
    const source = readTabularFile(csvPath);
    const analysis = analyzeCsvText(source.csvText, {
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      parkedAllocation
    });
    const persistence = persistAnalysis(analysis, { csvPath, storePath });
    const intelligence = replaceImportIntelligence(analysis, {
      storePath,
      importId: persistence.importRecord.id
    });
    const intelligenceSummary = {
      ...intelligence.summary,
      segments: {
        new: getIntelligenceSummary({ storePath, importId: persistence.importRecord.id, businessSegment: "new" }),
        warm: getIntelligenceSummary({ storePath, importId: persistence.importRecord.id, businessSegment: "warm" })
      }
    };
    const enrichedAnalysis = attachInternalItems({
      ...analysis,
      intelligence: intelligenceSummary
    }, internalItemsFor(analysis));
    return {
      analysis: attachPersistence(enrichedAnalysis, persistence.store, persistence.importRecord.id),
      csvPath,
      importRecord: persistence.importRecord,
      error: null
    };
  } catch (error) {
    return {
      analysis: attachPersistence({
        ...renderEmptyState(`Unable to load CSV: ${error.message}`),
        parkedAllocation
      }, readStore({ storePath })),
      csvPath,
      error: error.message
    };
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function publicAnalysis(analysis) {
  if (!analysis) return analysis;
  const { drilldownRows, businessSegmentViews, allocationCoverage, parkedAllocation, ...publicFields } = analysis;
  const publicSystemAudio = publicFields.systemAudio ? { ...publicFields.systemAudio, records: [] } : publicFields.systemAudio;
  const publicLeadReattempt = publicFields.leadReattempt ? { ...publicFields.leadReattempt, records: [] } : publicFields.leadReattempt;
  const publicLeadHarvest = publicFields.leadHarvest ? { ...publicFields.leadHarvest, records: [] } : publicFields.leadHarvest;
  const publicBusinessSegmentViews = Object.fromEntries(
    Object.entries(businessSegmentViews || {}).map(([segment, view]) => {
      const { drilldownRows: segmentDrilldownRows, ...publicView } = view;
      return [segment, {
        ...publicView,
        leadReattempt: publicView.leadReattempt ? { ...publicView.leadReattempt, records: [] } : publicView.leadReattempt,
        leadHarvest: publicView.leadHarvest ? { ...publicView.leadHarvest, records: [] } : publicView.leadHarvest,
        systemAudio: publicView.systemAudio ? { ...publicView.systemAudio, records: [] } : publicView.systemAudio
      }];
    })
  );
  return {
    ...publicFields,
    leadReattempt: publicLeadReattempt,
    leadHarvest: publicLeadHarvest,
    systemAudio: publicSystemAudio,
    businessSegmentViews: publicBusinessSegmentViews
  };
}

function llmReviewState(row = {}) {
  const status = String(row.llm_status || "not_requested").trim() || "not_requested";
  const quality = String(row.llm_result_quality || "").trim();
  const hasResult = Boolean(String(row.llm_result_json || "").trim());
  const validQuality = ["complete_json", "salvaged_raw", "salvage_available"].includes(quality);
  if (status === "completed" && hasResult && validQuality) return "LLM-reviewed";
  if (status === "failed" || (status === "completed" && (!hasResult || !validQuality))) return "Failed";
  if (status === "queued") return "Unprocessed";
  if (status === "not_requested") return "Not requested";
  return status || "not_requested";
}

function filterContextForStore(store, importId, intelligenceRows = []) {
  const currentAlerts = (store.alertEvents || []).map(normalizeAlertEvent).filter((event) => {
    if (event.parkedDataRelated) return false;
    return !importId || event.importId === importId;
  });
  const currentReviews = (store.managerReviews || []).map(normalizeManagerReview).filter((review) => !importId || review.importId === importId);
  const alertSeverityByCallId = new Map();
  const alertStatusByCallId = new Map();
  const alertEventById = new Map();
  currentAlerts.forEach((event) => {
    if (event.id) alertEventById.set(event.id, event);
    if (!event.callId) return;
    if (!alertSeverityByCallId.has(event.callId)) alertSeverityByCallId.set(event.callId, []);
    alertSeverityByCallId.get(event.callId).push(event.severity || "notice");
    if (!alertStatusByCallId.has(event.callId)) alertStatusByCallId.set(event.callId, []);
    alertStatusByCallId.get(event.callId).push(event.status || "new");
  });
  const managerReviewStatusByCallId = new Map();
  const managerReviewByCallId = new Map();
  currentReviews.forEach((review) => {
    if (!review.callId) return;
    const existing = managerReviewByCallId.get(review.callId);
    if (!existing || String(review.updatedAt || review.createdAt).localeCompare(String(existing.updatedAt || existing.createdAt)) >= 0) {
      managerReviewByCallId.set(review.callId, review);
      managerReviewStatusByCallId.set(review.callId, review.reviewStatus || "reviewed_confirmed");
    }
  });
  const llmStatusByCallId = new Map();
  const llmReviewLabelByCallId = new Map();
  intelligenceRows.forEach((row) => {
    llmStatusByCallId.set(row.call_id, row.llm_status || "not_requested");
    llmReviewLabelByCallId.set(row.call_id, llmReviewState(row));
  });
  return {
    currentImportId: importId || "current",
    alertEventById,
    alertSeverityByCallId,
    alertStatusByCallId,
    managerReviewByCallId,
    managerReviewStatusByCallId,
    llmStatusByCallId,
    llmReviewLabelByCallId
  };
}

function uniqueCount(rows, key) {
  return new Set((rows || []).map((row) => row[key]).filter(Boolean)).size;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 1000;
}

function average(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
}

function summarizeIntelligenceGroup(rows, key, fallback) {
  const groups = new Map();
  rows.forEach((row) => {
    const value = String(row[key] || fallback || "Unknown").trim() || fallback || "Unknown";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  });
  return Array.from(groups.entries()).map(([name, groupRows]) => {
    const leads = uniqueCount(groupRows, "lead_key") || groupRows.length;
    const wasteRiskLeads = uniqueCount(groupRows.filter((row) => Number(row.lead_waste_risk || 0)), "lead_key");
    const highQualityLeads = uniqueCount(groupRows.filter((row) => Number(row.lead_high_quality_utilized || 0)), "lead_key");
    const repeatedShortAttemptLeads = uniqueCount(groupRows.filter((row) => Number(row.lead_repeated_short_attempt || 0)), "lead_key");
    return {
      [key === "salesperson" ? "salesperson" : "source"]: name,
      leads,
      wasteRiskLeads,
      highQualityLeads,
      repeatedShortAttemptLeads,
      wasteRiskRate: ratio(wasteRiskLeads, leads),
      avgScore: average(groupRows, "lead_utilization_score")
    };
  }).sort((a, b) => b.wasteRiskLeads - a.wasteRiskLeads || b.leads - a.leads || String(a.salesperson || a.source).localeCompare(String(b.salesperson || b.source)));
}

function summarizeFilteredIntelligence(rows = []) {
  const leadsIndexed = uniqueCount(rows, "lead_key") || rows.length;
  const wasteRiskLeads = uniqueCount(rows.filter((row) => Number(row.lead_waste_risk || 0)), "lead_key");
  const highQualityLeads = uniqueCount(rows.filter((row) => Number(row.lead_high_quality_utilized || 0)), "lead_key");
  const repeatedShortAttemptLeads = uniqueCount(rows.filter((row) => Number(row.lead_repeated_short_attempt || 0)), "lead_key");
  return {
    schemaVersion: "sales_dashboard_intelligence_summary.filtered.v1",
    totals: {
      callsIndexed: rows.length,
      leadsIndexed,
      wasteRiskLeads,
      highQualityLeads,
      repeatedShortAttemptLeads,
      managerReviewCalls: rows.filter((row) => Number(row.manager_review_required || 0)).length,
      riskFlagCalls: rows.filter((row) => Number(row.risk_flag_exists || 0)).length,
      avgLeadUtilizationScore: average(rows, "lead_utilization_score"),
      llmQueued: rows.filter((row) => row.llm_status === "queued").length,
      llmCompleted: rows.filter((row) => row.llm_status === "completed").length,
      llmFailed: rows.filter((row) => row.llm_status === "failed").length,
      llmNotRequested: rows.filter((row) => !row.llm_status || row.llm_status === "not_requested").length
    },
    salespeople: summarizeIntelligenceGroup(rows, "salesperson", "Unknown"),
    sources: summarizeIntelligenceGroup(rows, "source", "Unknown source")
  };
}

function allIntelligenceRowsForState(state, storePath) {
  if (!state.importRecord?.id) return [];
  return listCallIntelligence({
    storePath,
    importId: state.importRecord.id,
    limit: 5000
  });
}

function analysisForRequest(state, url, storePath) {
  const store = readStore({ storePath });
  const intelligenceRows = allIntelligenceRowsForState(state, storePath);
  const context = filterContextForStore(store, state.importRecord?.id || null, intelligenceRows);
  const filterState = normalizeFilterState(url.searchParams);
  const filtered = buildFilteredAnalysis(state.analysis, filterState, context);
  const filteredCallIds = new Set((filtered.drilldownRows || []).map((row) => row.callId));
  return attachInternalItems({
    ...filtered,
    persistence: dashboardPersistence(store, state.importRecord?.id || null, {
      evaluationCallIds: filterState.active ? filteredCallIds : null
    }),
    intelligence: filterState.active
      ? summarizeFilteredIntelligence(intelligenceRows.filter((row) => filteredCallIds.has(row.call_id)))
      : filtered.intelligence
  }, internalItemsFor(filtered));
}

function evaluationStudioCallIdsForRequest(state, url, storePath) {
  if (!state.analysis) return null;
  const filterState = normalizeFilterState(url.searchParams);
  if (!filterState.active) return null;
  const store = readStore({ storePath });
  const intelligenceRows = allIntelligenceRowsForState(state, storePath);
  const context = filterContextForStore(store, state.importRecord?.id || null, intelligenceRows);
  const filtered = buildFilteredAnalysis(state.analysis, filterState, context);
  return new Set((filtered.drilldownRows || []).map((row) => row.callId).filter(Boolean));
}

function updateAnalysisPreservingItems(analysis, patch) {
  return attachInternalItems({
    ...analysis,
    ...patch
  }, internalItemsFor(analysis));
}

function readJsonBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function readFormBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(new URLSearchParams(body)));
    request.on("error", reject);
  });
}

function currentIntelligenceSummary(storePath, importId) {
  return {
    ...getIntelligenceSummary({ storePath, importId }),
    segments: {
      new: getIntelligenceSummary({ storePath, importId, businessSegment: "new" }),
      warm: getIntelligenceSummary({ storePath, importId, businessSegment: "warm" })
    }
  };
}

function evaluationStudioApiPayload(store, currentImportId = null, query = {}) {
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const resultImportId = query.importId || (query.currentOnly ? currentImportId : "");
  const resultLimit = normalizeLimit(query.limit, 50, 500);
  const resultOffset = Math.max(0, Number(query.offset || 0));
  const callIds = query.callIds || null;
  const resultRows = listEvaluationResults(studio, {
    importId: resultImportId,
    runId: query.runId,
    templateId: query.templateId,
    callIds,
    evaluationGoal: query.evaluationGoal || query.goal,
    status: query.resultStatus || query.status,
    reviewRecommended: query.reviewRecommended,
    evidenceUnavailableOnly: query.evidenceUnavailableOnly,
    includeSuperseded: query.includeSuperseded
  });
  return {
    schemaVersion: "sales_dashboard_evaluation_studio_api.v1",
    summary: evaluationStudioSummary(studio, currentImportId, { callIds }),
    reportRollups: buildEvaluationStudioReportRollups(studio, { importId: resultImportId || currentImportId || "", callIds }),
    knowledgebaseEntries: listKnowledgebaseEntries(studio, {
      includeArchived: query.includeArchived,
      category: query.category,
      tag: query.tag
    }),
    evaluationTemplates: listEvaluationTemplates(studio, {
      includeArchived: query.includeArchived,
      evaluationGoal: query.evaluationGoal || query.goal
    }),
    evaluationRuns: (studio.evaluationRuns || [])
      .filter((run) => !currentImportId || !query.currentOnly || run.importId === currentImportId)
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    evaluationResults: resultRows.slice(resultOffset, resultOffset + resultLimit),
    evidenceQueue: listEvaluationResults(studio, {
      importId: resultImportId,
      callIds,
      reviewRecommended: true
    }).slice(0, resultLimit),
    resultQuery: {
      importId: resultImportId || null,
      filteredCallIds: callIds ? callIds.size : null,
      limit: resultLimit,
      offset: resultOffset,
      matchingResults: resultRows.length,
      displayedResults: resultRows.slice(resultOffset, resultOffset + resultLimit).length,
      nextOffset: resultOffset + resultLimit < resultRows.length ? resultOffset + resultLimit : null,
      previousOffset: resultOffset > 0 ? Math.max(0, resultOffset - resultLimit) : null
    }
  };
}

function findEvaluationStudioResult(store = {}, resultId = "", currentImportId = "") {
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const id = String(resultId || "").trim();
  if (!id) return null;
  return listEvaluationResults(studio, {
    importId: currentImportId || "",
    includeSuperseded: true
  }).find((result) => result.id === id) || listEvaluationResults(studio, {
    includeSuperseded: true
  }).find((result) => result.id === id) || null;
}

function buildManagerReviewFromEvaluationResult(result = {}, input = {}) {
  const mappedScope = managerReviewScopeForEvaluationGoal(result.evaluationGoal);
  const reason = managerReviewReasonForEvaluationResult(result);
  const callerNote = String(input.note || input.notes || input.managerNotes || "").trim();
  const suggestedCorrections = buildManagerReviewPrefillCorrections(result);
  const note = [
    reason,
    result.id ? `Evaluation result ID: ${result.id}` : "",
    suggestedCorrections.length ? `Suggested correction prefill: ${suggestedCorrections.map((item) => `${item.fieldName}=${item.managerSuggestedValue}`).join("; ")}` : "",
    callerNote
  ].filter(Boolean).join("\n");
  return {
    importId: input.importId || result.importId || "current",
    callId: result.callId,
    action: input.action || "mark_review_needed",
    reviewScope: input.reviewScope || input.scope || mappedScope,
    signalName: input.signalName || `evaluation_studio:${result.evaluationGoal || "evaluation"}:${result.id || result.callId}`,
    source: "evaluation_studio",
    reviewReason: input.reviewReason || reason,
    note,
    suggestedCorrections,
    reviewedBy: resolveManagerReviewActor(input)
  };
}

function normalizeLimit(value, fallback = 250, max = 10000) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["all", "*", "everything"].includes(text)) return max;
  return Math.max(1, Math.min(Number(value || fallback), max));
}

function parseCallIdFilter(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return new Set(values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100));
}

function selectIntelligenceExtractionCalls(rows, body = {}, eligibleCallIds = null) {
  const businessSegment = String(body.businessSegment || body.segment || "").trim();
  const limit = normalizeLimit(body.sampleSize || body.limit, 100, 50000);
  const requestedCallIds = parseCallIdFilter(body.callIds || body.call_ids || body.callId || body.call_id || "");
  const candidates = (rows || []).filter((call) => {
    if (businessSegment && call.businessSegment !== businessSegment) return false;
    if (eligibleCallIds && !eligibleCallIds.has(call.callId)) return false;
    if (requestedCallIds.size && !requestedCallIds.has(String(call.callId))) return false;
    return true;
  });
  if (businessSegment || !body.balancedSegments) {
    return candidates.slice(0, limit);
  }

  const newCalls = candidates.filter((call) => call.businessSegment === "new");
  const warmCalls = candidates.filter((call) => call.businessSegment === "warm");
  const warmTarget = Math.max(1, Math.floor(limit / 2));
  const newTarget = Math.max(0, limit - warmTarget);
  return [
    ...newCalls.slice(0, newTarget),
    ...warmCalls.slice(0, warmTarget)
  ].slice(0, limit);
}

function aiJobId(result = {}) {
  return result.job_id || result.jobId || result.id || result.job?.id || result.job?.job_id || "";
}

function aiJobStatus(result = {}) {
  return String(result.status || result.job?.status || "").toLowerCase();
}

function aiJobResultPayload(result = {}) {
  return result.result_payload || result.resultPayload || result.result || result.output || result.response || result.data || result.job?.result_payload || result.job?.resultPayload || result.job?.result || result;
}

function aiJobIsDone(status) {
  return ["done", "completed", "complete", "succeeded", "success"].includes(String(status || "").toLowerCase());
}

function aiJobIsFailed(status) {
  return ["failed", "error", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function evaluationStudioRunHistoryEvent(run = {}, action, input = {}) {
  const timestamp = input.timestamp || new Date().toISOString();
  const history = Array.isArray(run.runHistory) ? run.runHistory : [];
  return {
    eventId: `eval_run_event_${String(run.id || "run").replace(/[^a-zA-Z0-9_-]/g, "_")}_${action}_${timestamp.replace(/[^0-9]/g, "")}_${history.length}`,
    runId: run.id || "",
    action,
    previousStatus: run.status || "",
    newStatus: input.newStatus || run.status || "",
    actor: EVALUATION_STUDIO_ACTOR,
    timestamp,
    note: String(input.note || "").trim().slice(0, 1000),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

function existingEvaluationStudioJobResult(store = {}, runId, callId, jobId) {
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  return (studio.evaluationResults || []).find((result) =>
    result.isLatest !== false
    && result.runId === runId
    && result.callId === callId
    && (!jobId || result.jobId === jobId)
  ) || null;
}

function evaluationStudioJobError(job = {}) {
  const error = job.error || job.message || job.details || job.job?.error || job.job?.message || "";
  if (!error) return "";
  return typeof error === "string" ? error : JSON.stringify(error).slice(0, 1000);
}

function evaluationStudioAiJobMetadata(existing = {}, run = {}, jobRef = {}) {
  return {
    ...(existing.metadata || {}),
    source: "evaluation_studio",
    evaluationRunId: run.id,
    evaluationTemplateId: run.templateId,
    evaluationGoal: run.templateSnapshot?.evaluationGoal || jobRef.evaluationGoal || ""
  };
}

function evaluationStudioHarvestStatus(run = {}, pendingCount = 0, completedCount = 0, failedCount = 0) {
  if (pendingCount > 0) return "running";
  if (failedCount > 0 && completedCount > 0) return "partially_completed";
  if (failedCount > 0) return "failed";
  if (Number(run.plannedCallCount || 0) && completedCount >= Number(run.plannedCallCount || 0)) return "completed";
  if (completedCount > 0) return "partially_completed";
  return run.status || "queued";
}

async function createEvaluationPromptTest(body = {}, options = {}) {
  const { state, storePath, aiConfig, fetchImpl } = options;
  if (!state?.analysis || !state?.importRecord?.id) {
    const error = new Error("No current import is loaded.");
    error.statusCode = 400;
    throw error;
  }
  const requestedCallId = String(body.callId || body.call_id || body.sampleCallId || body.sample_call_id || "").trim();
  const call = requestedCallId
    ? findCallProof(state.analysis, requestedCallId)
    : selectIntelligenceExtractionCalls(state.analysis.drilldownRows || [], { ...body, limit: 1 }, null)
      .find((candidate) => String(candidate.transcript || "").trim());
  if (!call) {
    const error = new Error("A matching call with transcript evidence was not found.");
    error.statusCode = 404;
    throw error;
  }
  if (!String(call.transcript || "").trim()) {
    const error = new Error("Prompt tests require a call with transcript text.");
    error.statusCode = 400;
    throw error;
  }

  const submitNow = truthy(body.submitNow || body.submit || body.runNow);
  const importId = body.importId || state.importRecord.id;
  const initial = saveEvaluationRun({
    ...body,
    runType: "prompt_test",
    status: submitNow ? "queued" : "draft",
    callSelection: {
      ...(body.callSelection || {}),
      mode: "prompt_test",
      callId: call.callId,
      businessSegment: body.businessSegment || body.segment || "",
      source: "evaluation_studio_prompt_test"
    }
  }, {
    importId,
    plannedCallCount: 1,
    runType: "prompt_test"
  }, { storePath });
  let run = initial.run;
  let store = initial.store;
  let evaluationResult = null;
  let executionLayerResponse = null;
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const template = studio.evaluationTemplates.find((item) => item.id === run.templateId);
  const knowledgebase = studio.knowledgebaseEntries.filter((entry) => run.knowledgebaseIds.includes(entry.id));
  const taskInput = buildEvaluationStudioInput(call, template, knowledgebase, {
    importId: run.importId,
    sourceName: state.analysis.sourceName
  });

  if (submitNow) {
    executionLayerResponse = await submitAiTask(taskInput, {
      config: aiConfig,
      fetchImpl,
      taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
      responseMode: body.responseMode,
      metadata: {
        source_system: "sales_dashboard",
        source_type: "evaluation_studio_prompt_test",
        source_record_id: call.callId,
        import_id: run.importId,
        evaluation_run_id: run.id,
        evaluation_template_id: template.id,
        evaluation_goal: template.evaluationGoal,
        run_type: "prompt_test"
      }
    });
    const jobId = aiJobId(executionLayerResponse);
    const status = aiJobStatus(executionLayerResponse) || "queued";
    if (!jobId) {
      const error = new Error("Execution layer response did not include a job ID.");
      error.statusCode = 502;
      throw error;
    }
    saveAiJobReference({
      importId: run.importId,
      callId: call.callId,
      jobId,
      taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
      status,
      metadata: {
        source: "evaluation_studio_prompt_test",
        evaluationRunId: run.id,
        evaluationTemplateId: template.id,
        evaluationGoal: template.evaluationGoal
      }
    }, { storePath });

    if (aiJobIsDone(status)) {
      const saved = saveEvaluationResult({
        importId: run.importId,
        runId: run.id,
        templateId: template.id,
        jobId,
        result: aiJobResultPayload(executionLayerResponse)
      }, { storePath });
      evaluationResult = saved.result;
      store = saved.store;
      run = normalizeEvaluationStudio(store.evaluationStudio).evaluationRuns.find((item) => item.id === run.id) || run;
    } else if (aiJobIsFailed(status)) {
      const updated = updateStoredEvaluationRun(run.id, {
        status: "failed",
        startedAt: new Date().toISOString(),
        failedCallCount: 1,
        errors: [{ callId: call.callId, jobId, error: executionLayerResponse.error || executionLayerResponse.job?.error || "Local prompt test failed" }]
      }, { storePath });
      run = updated.run;
      store = updated.store;
    } else {
      const updated = updateStoredEvaluationRun(run.id, {
        status: "running",
        startedAt: new Date().toISOString(),
        queuedJobCount: 1,
        queuedJobs: [{ callId: call.callId, jobId, status }]
      }, { storePath });
      run = updated.run;
      store = updated.store;
    }
  }

  return {
    callId: call.callId,
    submitted: submitNow,
    taskInput,
    evaluationRun: run,
    evaluationResult,
    executionLayerResponse,
    store
  };
}

async function harvestEvaluationStudioRunJobs(runId, options = {}) {
  const { storePath, aiConfig, fetchImpl } = options;
  let store = readStore({ storePath });
  let studio = normalizeEvaluationStudio(store.evaluationStudio);
  const run = (studio.evaluationRuns || []).find((item) => item.id === runId);
  if (!run) {
    const error = new Error("Evaluation Studio run not found.");
    error.statusCode = 404;
    throw error;
  }
  if (run.status === "quarantined") {
    const error = new Error("Quarantined Evaluation Studio runs must be resumed before harvesting.");
    error.statusCode = 400;
    throw error;
  }

  const jobs = (Array.isArray(run.queuedJobs) ? run.queuedJobs : [])
    .map((job) => ({
      ...job,
      callId: String(job.callId || job.call_id || "").trim(),
      jobId: String(job.jobId || job.job_id || "").trim()
    }))
    .filter((job) => job.jobId);
  if (!jobs.length) {
    const error = new Error("This Evaluation Studio run has no queued local AI jobs to harvest.");
    error.statusCode = 400;
    throw error;
  }

  const completed = [];
  const pending = [];
  const failed = [];
  const errors = [];
  const timestamp = new Date().toISOString();
  const updatedJobs = [];

  for (const jobRef of jobs) {
    const currentAiJob = (store.aiJobs || []).find((job) =>
      job.importId === run.importId && job.callId === jobRef.callId && job.jobId === jobRef.jobId
    ) || {};
    try {
      const job = await getAiJob(jobRef.jobId, { config: aiConfig, fetchImpl });
      const status = aiJobStatus(job) || jobRef.status || currentAiJob.status || "queued";
      const savedJob = saveAiJobReference({
        ...currentAiJob,
        importId: run.importId,
        callId: jobRef.callId,
        jobId: jobRef.jobId,
        taskType: currentAiJob.taskType || jobRef.taskType || EVALUATION_STUDIO_TASK_TYPE,
        status,
        metadata: evaluationStudioAiJobMetadata(currentAiJob, run, jobRef)
      }, { storePath });
      store = savedJob.store;

      if (aiJobIsDone(status)) {
        const alreadyStored = existingEvaluationStudioJobResult(store, run.id, jobRef.callId, jobRef.jobId);
        let result = alreadyStored;
        if (!alreadyStored) {
          const savedResult = saveEvaluationResult({
            importId: run.importId,
            runId: run.id,
            templateId: run.templateId,
            jobId: jobRef.jobId,
            callId: jobRef.callId,
            result: aiJobResultPayload(job)
          }, { storePath });
          result = savedResult.result;
          store = savedResult.store;
        }
        completed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status,
          resultId: result.id,
          alreadyStored: Boolean(alreadyStored)
        });
        updatedJobs.push({
          ...jobRef,
          status: "completed",
          resultId: result.id,
          harvestedAt: timestamp
        });
      } else if (aiJobIsFailed(status)) {
        const reason = evaluationStudioJobError(job) || "Local AI job failed.";
        failed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status,
          error: reason
        });
        updatedJobs.push({
          ...jobRef,
          status: "failed",
          error: reason,
          harvestedAt: timestamp
        });
      } else {
        pending.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status
        });
        updatedJobs.push({
          ...jobRef,
          status,
          lastCheckedAt: timestamp
        });
      }
    } catch (error) {
      errors.push({
        callId: jobRef.callId,
        jobId: jobRef.jobId,
        error: error.message
      });
      updatedJobs.push({
        ...jobRef,
        status: jobRef.status || "queued",
        lastHarvestError: error.message,
        lastCheckedAt: timestamp
      });
    }
  }

  store = readStore({ storePath });
  studio = normalizeEvaluationStudio(store.evaluationStudio);
  const latestRun = (studio.evaluationRuns || []).find((item) => item.id === run.id) || run;
  const latestResults = (studio.evaluationResults || []).filter((result) =>
    result.runId === run.id && result.isLatest !== false
  );
  const completedCallCount = latestResults.filter((result) => result.status !== "failed").length;
  const failedCallCount = updatedJobs.filter((job) => aiJobIsFailed(job.status)).length;
  const pendingJobCount = updatedJobs.filter((job) => !aiJobIsDone(job.status) && !aiJobIsFailed(job.status)).length;
  const nextStatus = evaluationStudioHarvestStatus(latestRun, pendingJobCount, completedCallCount, failedCallCount);
  const completedAt = nextStatus === "completed" && !latestRun.completedAt ? timestamp : latestRun.completedAt;
  const event = evaluationStudioRunHistoryEvent(latestRun, "harvest", {
    timestamp,
    newStatus: nextStatus,
    note: `Harvest checked ${jobs.length} local Evaluation Studio jobs.`,
    metadata: {
      completed: completed.length,
      pending: pending.length,
      failed: failed.length,
      errors: errors.length
    }
  });
  const updatedRun = updateStoredEvaluationRun(run.id, {
    status: nextStatus,
    completedAt,
    queuedJobCount: pendingJobCount,
    completedCallCount,
    failedCallCount,
    queuedJobs: updatedJobs,
    errors: [
      ...(Array.isArray(latestRun.errors) ? latestRun.errors : []),
      ...failed.map((item) => ({ callId: item.callId, jobId: item.jobId, error: item.error })),
      ...errors
    ].slice(-200),
    runHistory: [
      ...(Array.isArray(latestRun.runHistory) ? latestRun.runHistory : []),
      event
    ].slice(-200)
  }, { storePath });

  return {
    evaluationRun: updatedRun.run,
    completed,
    pending,
    failed,
    errors,
    store: updatedRun.store
  };
}

function evaluationStudioAutoHarvestCandidate(run = {}, currentImportId = null) {
  const status = String(run.status || "").toLowerCase();
  const jobs = Array.isArray(run.queuedJobs) ? run.queuedJobs : [];
  if (run.runType !== "prompt_test") return false;
  if (!["queued", "running", "partially_completed"].includes(status)) return false;
  if (currentImportId && run.importId !== currentImportId) return false;
  if (!jobs.length || jobs.length > EVALUATION_STUDIO_AUTO_HARVEST_MAX_JOBS) return false;
  return jobs.some((job) => String(job.jobId || job.job_id || "").trim() && !job.resultId);
}

async function autoHarvestEvaluationStudioPromptTests(options = {}) {
  const { storePath, aiConfig, fetchImpl, currentImportId = null } = options;
  let store = readStore({ storePath });
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const candidates = (studio.evaluationRuns || [])
    .filter((run) => evaluationStudioAutoHarvestCandidate(run, currentImportId))
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, EVALUATION_STUDIO_AUTO_HARVEST_MAX_RUNS);
  const harvested = [];
  const errors = [];

  for (const run of candidates) {
    try {
      const result = await harvestEvaluationStudioRunJobs(run.id, { storePath, aiConfig, fetchImpl });
      store = result.store;
      harvested.push({
        runId: run.id,
        status: result.evaluationRun.status,
        completed: result.completed.length,
        pending: result.pending.length,
        failed: result.failed.length,
        errors: result.errors.length
      });
    } catch (error) {
      errors.push({
        runId: run.id,
        error: error.message
      });
    }
  }

  return {
    checkedRunCount: candidates.length,
    harvested,
    errors,
    store
  };
}

function createServer(options = {}) {
  const env = options.env || process.env;
  const csvPath = options.csvPath || resolveCsvPath(options.argv || process.argv.slice(2), env);
  const allocationPath = options.allocationPath || resolveAllocationPath(options.argv || process.argv.slice(2), env);
  const storePath = resolveStorePath(options);
  const aiConfig = resolveAiExecutionConfig(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let state = loadAnalysis(csvPath, { storePath, allocationPath });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/branding/logo" && request.method === "GET") {
      const logoPath = findBrandLogo(storePath);
      try {
        const body = fs.readFileSync(logoPath);
        response.writeHead(200, {
          "Content-Type": mimeForLogo(logoPath),
          "Cache-Control": "no-store",
          "Content-Length": body.length
        });
        response.end(body);
      } catch (error) {
        sendJson(response, 404, { error: "Logo not found" });
      }
      return;
    }

    if (url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "sales-dashboard",
        csv_loaded: Boolean(state.csvPath && !state.error),
        csv_path_configured: Boolean(state.csvPath),
        allocations_loaded: false,
        allocations_path_configured: Boolean(allocationPath),
        allocation_data_status: allocationDiagnosticFromState(state, allocationPath).status,
        allocation_data_excluded_from_active_analytics: true,
        allocation_active_metrics_available: false,
        store_path_configured: Boolean(storePath),
        current_import_id: state.importRecord?.id || null,
        ai_execution: publicAiExecutionStatus(aiConfig)
      });
      return;
    }

    if (url.pathname === "/api/branding/logo" && request.method === "POST") {
      try {
        const body = await readJsonBody(request, BRAND_LOGO_LIMIT_BYTES * 2);
        const logoPath = saveBrandLogo(body.dataUrl, storePath);
        sendJson(response, 201, {
          ok: true,
          logo: "/branding/logo",
          bytes: fs.statSync(logoPath).size
        });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/ai/status" && request.method === "GET") {
      if (url.searchParams.get("health") === "true") {
        sendJson(response, 200, await checkAiExecutionHealth({ config: aiConfig, fetchImpl }));
      } else {
        sendJson(response, 200, publicAiExecutionStatus(aiConfig));
      }
      return;
    }

    if (url.pathname === "/api/summary") {
      sendJson(response, 200, publicAnalysis(analysisForRequest(state, url, storePath)));
      return;
    }

    if (url.pathname === "/api/allocations" && request.method === "GET") {
      sendJson(response, 200, allocationDiagnosticFromState(state, allocationPath));
      return;
    }

    if (url.pathname === "/api/source-quality" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const requestedSegment = String(query.businessSegment || query.segment || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = requestedSegment === "new" || requestedSegment === "new_business"
        ? "new"
        : ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
          ? "warm"
          : "";
      const sourceQuality = businessSegment && requestAnalysis?.businessSegmentViews?.[businessSegment]?.sourceQuality
        ? requestAnalysis.businessSegmentViews[businessSegment].sourceQuality
        : requestAnalysis?.sourceQuality || {};
      const minImportAgeDays = query.minImportAgeDays || query.days || query.importAgeDays || "";
      const matchingCalls = minImportAgeDays && requestAnalysis
        ? buildDrilldownResult(requestAnalysis, {
          metric: "source.newBusinessImportedOlderThan",
          businessSegment,
          source: query.source || "",
          minImportAgeDays
        }).count
        : null;
      sendJson(response, 200, {
        ...sourceQuality,
        query: {
          source: query.source || "",
          businessSegment,
          minImportAgeDays: minImportAgeDays || null,
          matchingCalls
        }
      });
      return;
    }

    if (url.pathname === "/api/ai-voice-assistants" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const requestedSegment = String(query.businessSegment || query.segment || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = requestedSegment === "new" || requestedSegment === "new_business"
        ? "new"
        : ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
          ? "warm"
          : "";
      const aiVoiceAssistant = businessSegment && requestAnalysis?.businessSegmentViews?.[businessSegment]?.aiVoiceAssistant
        ? requestAnalysis.businessSegmentViews[businessSegment].aiVoiceAssistant
        : requestAnalysis?.aiVoiceAssistant || {};
      sendJson(response, 200, {
        ...aiVoiceAssistant,
        query: {
          businessSegment
        }
      });
      return;
    }

    if (url.pathname === "/api/system-audio" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const requestedSegment = String(query.businessSegment || query.segment || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = requestedSegment === "new" || requestedSegment === "new_business"
        ? "new"
        : ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
          ? "warm"
          : "";
      const source = String(query.source || "").trim();
      const salesperson = String(query.salesperson || "").trim();
      const subtype = String(query.systemAudioSubtype || query.subtype || "").trim();
      const systemAudio = businessSegment && requestAnalysis?.businessSegmentViews?.[businessSegment]?.systemAudio
        ? requestAnalysis.businessSegmentViews[businessSegment].systemAudio
        : requestAnalysis?.systemAudio || {};
      const hasRecordFilters = Boolean(source || salesperson || subtype);
      const filteredRecords = hasRecordFilters
        ? (systemAudio.records || []).filter((record) => {
          if (source && record.source !== source) return false;
          if (salesperson && record.salesperson !== salesperson) return false;
          if (subtype && record.subtype !== subtype) return false;
          return true;
        })
        : systemAudio.records || [];
      const filteredSystemAudio = hasRecordFilters
        ? {
          schemaVersion: systemAudio.schemaVersion,
          definitions: systemAudio.definitions,
          ...summarizeSystemAudioRecords(filteredRecords)
        }
        : systemAudio;
      sendJson(response, 200, {
        ...filteredSystemAudio,
        query: {
          businessSegment,
          source,
          salesperson,
          subtype,
          matchingRecords: hasRecordFilters ? filteredRecords.length : null
        }
      });
      return;
    }

    if (url.pathname === "/api/lead-reattempts" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const requestedSegment = String(query.businessSegment || query.segment || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = requestedSegment === "new" || requestedSegment === "new_business"
        ? "new"
        : ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
          ? "warm"
          : "";
      const source = String(query.source || "").trim();
      const salesperson = String(query.salesperson || "").trim();
      const region = String(query.region || query.callRegion || "").trim();
      const leadReattempt = businessSegment && requestAnalysis?.businessSegmentViews?.[businessSegment]?.leadReattempt
        ? requestAnalysis.businessSegmentViews[businessSegment].leadReattempt
        : requestAnalysis?.leadReattempt || {};
      const hasRecordFilters = Boolean(source || salesperson || region);
      const filteredRecords = hasRecordFilters
        ? (leadReattempt.records || []).filter((record) => {
          if (source && record.source !== source) return false;
          if (salesperson && record.salesperson !== salesperson) return false;
          if (region && record.region !== region) return false;
          return true;
        })
        : leadReattempt.records || [];
      const filteredLeadReattempt = hasRecordFilters
        ? {
          schemaVersion: leadReattempt.schemaVersion,
          definitions: leadReattempt.definitions,
          ...summarizeLeadReattemptRecords(filteredRecords)
        }
        : leadReattempt;
      sendJson(response, 200, {
        ...filteredLeadReattempt,
        query: {
          businessSegment,
          source,
          salesperson,
          region,
          matchingRecords: hasRecordFilters ? filteredRecords.length : null
        }
      });
      return;
    }

    if (url.pathname === "/api/lead-harvest" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const requestedSegment = String(query.businessSegment || query.segment || "new").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
        ? "warm"
        : requestedSegment === "all" || requestedSegment === "all_business"
          ? ""
          : "new";
      const source = String(query.source || "").trim();
      const salesperson = String(query.salesperson || "").trim();
      const status = String(query.status || query.harvestStatus || "").trim();
      const confidenceBand = String(query.confidenceBand || query.confidence || "").trim();
      const objectionType = String(query.objectionType || query.objection || "").trim();
      const handlingType = String(query.handlingType || query.salespersonHandlingType || "").trim();
      const sort = String(query.sort || query.order || "").trim().toLowerCase();
      const limit = Math.max(1, Math.min(Number(query.limit || 10000), 10000));
      const offset = Math.max(0, Number(query.offset || 0));
      const leadHarvest = businessSegment && requestAnalysis?.businessSegmentViews?.[businessSegment]?.leadHarvest
        ? requestAnalysis.businessSegmentViews[businessSegment].leadHarvest
        : requestAnalysis?.leadHarvest || {};
      const records = (leadHarvest.records || []).filter((record) => {
        if (businessSegment && record.businessSegment !== businessSegment) return false;
        if (source && record.source !== source) return false;
        if (salesperson && record.salesperson !== salesperson) return false;
        if (status && record.status !== status) return false;
        if (confidenceBand && record.confidenceBand !== confidenceBand) return false;
        if (objectionType && record.objectionType !== objectionType) return false;
        if (handlingType && record.salespersonHandlingType !== handlingType) return false;
        return true;
      }).sort((a, b) => {
        if (sort === "oldest" || sort === "oldest_first") return Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.callId || "").localeCompare(String(b.callId || ""));
        if (sort === "newest" || sort === "newest_first") return Number(b.timestamp || 0) - Number(a.timestamp || 0) || String(a.callId || "").localeCompare(String(b.callId || ""));
        return 0;
      });
      const visibleRecords = records.slice(offset, offset + limit);
      sendJson(response, 200, {
        schemaVersion: leadHarvest.schemaVersion || "sales_dashboard_lead_harvest.v1",
        definitions: leadHarvest.definitions || {},
        ...summarizeLeadHarvestRecords(records),
        records: visibleRecords,
        query: {
          businessSegment,
          source,
          salesperson,
          status,
          confidenceBand,
          objectionType,
          handlingType,
          sort,
          limit,
          offset,
          displayedRecords: visibleRecords.length,
          matchingRecords: records.length,
          nextOffset: offset + limit < records.length ? offset + limit : null,
          previousOffset: offset > 0 ? Math.max(0, offset - limit) : null
        },
        filterState: requestAnalysis.filterState || null,
        filterSummary: requestAnalysis.filterSummary || null
      });
      return;
    }

    if (url.pathname === "/api/drilldown" && request.method === "GET") {
      sendJson(response, 200, buildDrilldownResult(analysisForRequest(state, url, storePath), Object.fromEntries(url.searchParams.entries())));
      return;
    }

    if (url.pathname === "/api/alerts" && request.method === "GET") {
      const requestAnalysis = analysisForRequest(state, url, storePath);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_alerts_api.v1",
        importId: state.importRecord?.id || null,
        alerts: requestAnalysis.alerts || [],
        summary: requestAnalysis.alertLifecycleSummary || null,
        filterState: requestAnalysis.filterState || null,
        filterSummary: requestAnalysis.filterSummary || null
      });
      return;
    }

    if (url.pathname === "/api/alerts/bulk" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const alertIds = Array.isArray(body.alertIds) ? body.alertIds : String(body.alertIds || body.alertId || "").split(",");
        const result = bulkUpdateAlertLifecycle(alertIds, {
          action: body.action || body.status,
          note: body.note || body.reason || body.managerNotes || "",
          actor: resolveAlertLifecycleActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          alerts: result.alertEvents,
          missingAlertIds: result.missingAlertIds,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/alerts/") && url.pathname.endsWith("/history") && request.method === "GET") {
      const alertId = decodeURIComponent(url.pathname.slice("/api/alerts/".length, -"/history".length));
      const store = readStore({ storePath });
      const event = (store.alertEvents || [])
        .map(normalizeAlertEvent)
        .find((item) => (item.id === alertId || item.alertId === alertId) && !item.parkedDataRelated && (!state.importRecord?.id || item.importId === state.importRecord.id));
      if (!event) {
        sendJson(response, 404, { ok: false, error: "Alert not found" });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        alertId,
        status: event.status,
        managerNotes: event.managerNotes || "",
        lifecycleHistory: event.lifecycleHistory || []
      });
      return;
    }

    if (url.pathname.startsWith("/api/alerts/") && request.method === "PATCH") {
      try {
        const alertId = decodeURIComponent(url.pathname.replace("/api/alerts/", ""));
        const body = await readJsonBody(request);
        const result = updateAlertLifecycle(alertId, {
          action: body.action || body.status,
          note: body.note || body.reason || body.managerNotes || "",
          actor: resolveAlertLifecycleActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          alert: result.alertEvent,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/intelligence/summary" && request.method === "GET") {
      const requestAnalysis = analysisForRequest(state, url, storePath);
      sendJson(response, 200, requestAnalysis.filterState?.active
        ? requestAnalysis.intelligence
        : getIntelligenceSummary({
          storePath,
          importId: state.importRecord?.id || null,
          businessSegment: url.searchParams.get("businessSegment") || url.searchParams.get("segment") || ""
        }));
      return;
    }

    if (url.pathname === "/api/intelligence/calls" && request.method === "GET") {
      const requestAnalysis = analysisForRequest(state, url, storePath);
      const filteredCallIds = new Set((requestAnalysis.drilldownRows || []).map((row) => row.callId));
      sendJson(response, 200, {
        calls: listCallIntelligence({
          storePath,
          importId: state.importRecord?.id || null,
          businessSegment: url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "",
          salesperson: url.searchParams.get("salesperson") || "",
          source: url.searchParams.get("source") || "",
          customerId: url.searchParams.get("customerId") || url.searchParams.get("customer_id") || "",
          managerReview: url.searchParams.get("managerReview") || "",
          riskFlag: url.searchParams.get("riskFlag") || "",
          wasteRisk: url.searchParams.get("wasteRisk") || "",
          highQuality: url.searchParams.get("highQuality") || "",
          repeatedShortAttempt: url.searchParams.get("repeatedShortAttempt") || "",
          llmStatus: url.searchParams.get("llmStatus") || "",
          callIds: url.searchParams.get("callIds") || "",
          limit: url.searchParams.get("limit") || 250,
          offset: url.searchParams.get("offset") || 0
        }).filter((call) => !requestAnalysis.filterState?.active || filteredCallIds.has(call.call_id))
      });
      return;
    }

    if (url.pathname === "/api/intelligence/rebuild" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const result = replaceImportIntelligence(state.analysis, {
          storePath,
          importId: state.importRecord.id
        });
        const intelligenceSummary = currentIntelligenceSummary(storePath, state.importRecord.id);
        state.analysis = updateAnalysisPreservingItems(state.analysis, {
          intelligence: intelligenceSummary
        });
        sendJson(response, 200, { ok: true, ...result, summary: intelligenceSummary });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/intelligence/llm-extractions" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const body = await readJsonBody(request);
        const businessSegment = String(body.businessSegment || body.segment || "").trim();
        const eligibleCallIds = body.includePreviouslyAttempted
          ? null
          : new Set(listCallIntelligence({
            storePath,
            importId: state.importRecord.id,
            businessSegment,
            callIds: body.callIds || body.call_ids || body.callId || body.call_id || "",
            llmStatus: body.llmStatus || "not_requested",
            limit: 5000
          }).map((call) => call.call_id));
        const calls = selectIntelligenceExtractionCalls(state.analysis.drilldownRows || [], body, eligibleCallIds);
        const queued = [];
        const completed = [];
        const errors = [];

        for (const call of calls) {
          try {
            const deterministic = buildCallIntelligence(call, {
              importId: state.importRecord.id,
              inputHash: state.analysis.inputHash,
              sourceName: state.analysis.sourceName
            });
            const result = await submitTranscriptIntelligenceExtraction(call, deterministic, {
              config: aiConfig,
              fetchImpl,
              importId: state.importRecord.id,
              sourceName: state.analysis.sourceName,
              maxTranscriptChars: body.maxTranscriptChars || 8000,
              responseMode: body.responseMode,
              metadata: {
                source: "bulk_intelligence_extraction",
                businessSegment: businessSegment || null
              }
            });
            const jobId = aiJobId(result);
            const status = aiJobStatus(result) || "queued";
            const saved = saveAiJobReference({
              importId: state.importRecord.id,
              callId: call.callId,
              jobId,
              taskType: INTELLIGENCE_TASK_TYPE,
              status,
              metadata: {
                source: "bulk_intelligence_extraction",
                intelligenceDbPath: resolveIntelligenceDbPath({ storePath })
              }
            }, { storePath });
            if (aiJobIsDone(status)) {
              saveLlmIntelligenceResult({
                storePath,
                importId: state.importRecord.id,
                callId: call.callId,
                jobId,
                result: aiJobResultPayload(result)
              });
              completed.push({ callId: call.callId, jobId, status });
            } else if (aiJobIsFailed(status)) {
              markLlmJobFailed({
                storePath,
                importId: state.importRecord.id,
                callId: call.callId,
                jobId,
                reason: result.error || result.job?.error || "Local LLM job failed"
              });
              errors.push({ callId: call.callId, jobId, error: result.error || result.job?.error || "Local LLM job failed" });
            } else {
              markLlmJobQueued({
                storePath,
                importId: state.importRecord.id,
                callId: call.callId,
                jobId
              });
              queued.push({ callId: call.callId, jobId, status: saved.aiJob.status });
            }
          } catch (error) {
            errors.push({ callId: call.callId, error: error.message });
          }
        }

        const summary = currentIntelligenceSummary(storePath, state.importRecord.id);
        state.analysis = updateAnalysisPreservingItems(state.analysis, {
          intelligence: summary,
          persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
        });
        sendJson(response, errors.length ? 207 : 202, {
          ok: errors.length === 0,
          requested: calls.length,
          queued: queued.length,
          completed: completed.length,
          errors,
          queuedCalls: queued,
          completedCalls: completed,
          summary
        });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/intelligence/llm-harvest" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const body = await readJsonBody(request);
        const importId = body.importId || body.import_id || state.importRecord.id;
        const queuedJobs = listLlmJobs({
          storePath,
          importId,
          businessSegment: body.businessSegment || body.segment || "",
          limit: body.limit || 100
        });
        const completed = [];
        const pending = [];
        const failed = [];
        const errors = [];

        for (const row of queuedJobs) {
          try {
            const job = await getAiJob(row.llm_job_id, { config: aiConfig, fetchImpl });
            const status = aiJobStatus(job);
            if (aiJobIsDone(status)) {
              saveLlmIntelligenceResult({
                storePath,
                importId: row.import_id,
                callId: row.call_id,
                jobId: row.llm_job_id,
                result: aiJobResultPayload(job)
              });
              completed.push({ callId: row.call_id, jobId: row.llm_job_id, status });
            } else if (aiJobIsFailed(status)) {
              markLlmJobFailed({
                storePath,
                importId: row.import_id,
                callId: row.call_id,
                jobId: row.llm_job_id,
                reason: job.error || job.job?.error || "Local LLM job failed"
              });
              failed.push({ callId: row.call_id, jobId: row.llm_job_id, status, error: job.error || job.job?.error || "" });
            } else {
              pending.push({ callId: row.call_id, jobId: row.llm_job_id, status: status || "queued" });
            }
          } catch (error) {
            errors.push({ callId: row.call_id, jobId: row.llm_job_id, error: error.message });
          }
        }

        const summary = currentIntelligenceSummary(storePath, importId);
        if (state.importRecord.id === importId) {
          state.analysis = updateAnalysisPreservingItems(state.analysis, {
            intelligence: summary,
            persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
          });
        }

        sendJson(response, errors.length ? 207 : 200, {
          ok: errors.length === 0,
          inspected: queuedJobs.length,
          completed,
          pending,
          failed,
          errors,
          summary
        });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/intelligence/llm-results" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }

        const body = await readJsonBody(request, 10 * 1024 * 1024);
        const importId = body.importId || body.import_id || state.importRecord.id;
        const callId = body.callId || body.call_id || body.source_record_id || body.metadata?.source_record_id || "";
        const jobId = body.jobId || body.job_id || body.id || body.job?.id || body.job?.job_id || "";
        let result = body.result || body.output || body.response || body.data || body.payload || body.job || null;

        if (!result && jobId && body.fetchJob !== false) {
          result = await getAiJob(jobId, { config: aiConfig, fetchImpl });
        }

        const saved = saveLlmIntelligenceResult({
          storePath,
          importId,
          callId,
          jobId,
          result: result || body
        });
        const summary = currentIntelligenceSummary(storePath, importId);
        if (state.importRecord.id === importId) {
          state.analysis = updateAnalysisPreservingItems(state.analysis, {
            intelligence: summary,
            persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
          });
        }

        sendJson(response, 200, { ok: true, saved: { importId: saved.importId, callId: saved.callId, jobId: saved.jobId }, summary });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioPromptTests({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null
      });
      const store = autoHarvest.store || readStore({ storePath });
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      const payload = evaluationStudioApiPayload(store, state.importRecord?.id || null, {
        includeArchived: url.searchParams.get("includeArchived"),
        category: url.searchParams.get("category"),
        tag: url.searchParams.get("tag"),
        evaluationGoal: url.searchParams.get("evaluationGoal") || url.searchParams.get("goal"),
        currentOnly: url.searchParams.get("currentOnly"),
        callIds
      });
      sendJson(response, 200, {
        ...payload,
        autoHarvest: {
          checkedRunCount: autoHarvest.checkedRunCount,
          harvested: autoHarvest.harvested,
          errors: autoHarvest.errors
        }
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/knowledgebase" && request.method === "GET") {
      const store = readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_knowledgebase_api.v1",
        knowledgebaseEntries: listKnowledgebaseEntries(studio, {
          includeArchived: url.searchParams.get("includeArchived"),
          category: url.searchParams.get("category"),
          tag: url.searchParams.get("tag")
        })
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/knowledgebase" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveEvaluationKnowledgebaseEntry(body, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, { ok: true, knowledgebaseEntry: result.entry, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/knowledgebase/") && ["PATCH", "PUT", "DELETE"].includes(request.method)) {
      try {
        const id = decodeURIComponent(url.pathname.replace("/api/evaluation-studio/knowledgebase/", ""));
        const result = request.method === "DELETE"
          ? archiveEvaluationKnowledgebaseEntry(id, { storePath })
          : saveEvaluationKnowledgebaseEntry({ ...(await readJsonBody(request)), id }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, { ok: true, knowledgebaseEntry: result.entry, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/templates" && request.method === "GET") {
      const store = readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_templates_api.v1",
        evaluationTemplates: listEvaluationTemplates(studio, {
          includeArchived: url.searchParams.get("includeArchived"),
          evaluationGoal: url.searchParams.get("evaluationGoal") || url.searchParams.get("goal")
        })
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/templates" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveEvaluationTemplate(body, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, { ok: true, evaluationTemplate: result.template, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/templates/") && ["PATCH", "PUT", "DELETE"].includes(request.method)) {
      try {
        const id = decodeURIComponent(url.pathname.replace("/api/evaluation-studio/templates/", ""));
        const result = request.method === "DELETE"
          ? archiveEvaluationTemplateRecord(id, { storePath })
          : saveEvaluationTemplate({ ...(await readJsonBody(request)), id }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, { ok: true, evaluationTemplate: result.template, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/runs" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioPromptTests({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: url.searchParams.get("importId") || state.importRecord?.id || null
      });
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_runs_api.v1",
        autoHarvest: {
          checkedRunCount: autoHarvest.checkedRunCount,
          harvested: autoHarvest.harvested,
          errors: autoHarvest.errors
        },
        evaluationRuns: (studio.evaluationRuns || [])
          .filter((run) => !url.searchParams.get("importId") || run.importId === url.searchParams.get("importId"))
          .slice()
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/runs" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const body = await readJsonBody(request);
        const calls = selectIntelligenceExtractionCalls(state.analysis.drilldownRows || [], body, null)
          .filter((call) => String(call.transcript || "").trim());
        const initial = saveEvaluationRun(body, {
          importId: body.importId || state.importRecord.id,
          plannedCallCount: calls.length
        }, { storePath });
        let run = initial.run;
        let store = initial.store;
        const submitNow = ["1", "true", "yes", "on"].includes(String(body.submitNow || body.submit || "").toLowerCase());
        if (submitNow && calls.length) {
          const studio = normalizeEvaluationStudio(store.evaluationStudio);
          const template = studio.evaluationTemplates.find((item) => item.id === run.templateId);
          const knowledgebase = studio.knowledgebaseEntries.filter((entry) => run.knowledgebaseIds.includes(entry.id));
          const queuedJobs = [];
          const errors = [];
          for (const call of calls) {
            try {
              const input = buildEvaluationStudioInput(call, template, knowledgebase, {
                importId: run.importId,
                sourceName: state.analysis.sourceName
              });
              const result = await submitAiTask(input, {
                config: aiConfig,
                fetchImpl,
                taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
                responseMode: body.responseMode,
                metadata: {
                  source_system: "sales_dashboard",
                  source_type: "evaluation_studio_batch",
                  source_record_id: call.callId,
                  import_id: run.importId,
                  evaluation_run_id: run.id,
                  evaluation_template_id: template.id,
                  evaluation_goal: template.evaluationGoal
                }
              });
              const jobId = aiJobId(result);
              const status = aiJobStatus(result) || "queued";
              if (!jobId) throw new Error("Execution layer response did not include a job ID.");
              saveAiJobReference({
                importId: run.importId,
                callId: call.callId,
                jobId,
                taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
                status,
                metadata: {
                  source: "evaluation_studio",
                  evaluationRunId: run.id,
                  evaluationTemplateId: template.id,
                  evaluationGoal: template.evaluationGoal
                }
              }, { storePath });
              queuedJobs.push({ callId: call.callId, jobId, status });
            } catch (error) {
              errors.push({ callId: call.callId, error: error.message });
            }
          }
          const updated = updateStoredEvaluationRun(run.id, {
            status: queuedJobs.length && errors.length ? "partially_completed" : queuedJobs.length ? "running" : "failed",
            startedAt: new Date().toISOString(),
            queuedJobCount: queuedJobs.length,
            failedCallCount: errors.length,
            queuedJobs,
            errors
          }, { storePath });
          run = updated.run;
          store = updated.store;
        }
        state.analysis = attachPersistence(state.analysis, store, state.importRecord?.id || null);
        sendJson(response, submitNow ? 202 : 201, {
          ok: true,
          evaluationRun: run,
          submitted: submitNow,
          plannedCallCount: calls.length,
          persistence: dashboardPersistence(store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/runs/") && url.pathname.endsWith("/harvest") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/runs/".length, -"/harvest".length));
        const result = await harvestEvaluationStudioRunJobs(runId, {
          storePath,
          aiConfig,
          fetchImpl
        });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          evaluationRun: result.evaluationRun,
          completed: result.completed,
          pending: result.pending,
          failed: result.failed,
          errors: result.errors,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/runs/") && url.pathname.endsWith("/quarantine") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/runs/".length, -"/quarantine".length));
        const body = await readJsonBody(request);
        const result = quarantineStoredEvaluationRun(runId, {
          reason: body.reason || body.quarantineReason || body.note || "",
          metadata: { source: "api" }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          evaluationRun: result.run,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/runs/") && url.pathname.endsWith("/resume") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/runs/".length, -"/resume".length));
        const body = await readJsonBody(request);
        const result = resumeStoredEvaluationRun(runId, {
          reason: body.reason || body.note || "",
          metadata: { source: "api" }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          evaluationRun: result.run,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/prompt-tests" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = await createEvaluationPromptTest(body, {
          state,
          storePath,
          aiConfig,
          fetchImpl
        });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, result.submitted ? 202 : 201, {
          ok: true,
          submitted: result.submitted,
          callId: result.callId,
          evaluationRun: result.evaluationRun,
          evaluationResult: result.evaluationResult,
          taskInput: body.includeTaskInput === false ? null : result.taskInput,
          executionLayerResponse: result.executionLayerResponse,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/report-rollups" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioPromptTests({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null
      });
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      const importId = url.searchParams.get("importId") || (truthy(url.searchParams.get("currentOnly")) ? state.importRecord?.id : "");
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_report_rollups_api.v1",
        autoHarvest: {
          checkedRunCount: autoHarvest.checkedRunCount,
          harvested: autoHarvest.harvested,
          errors: autoHarvest.errors
        },
        reportRollups: buildEvaluationStudioReportRollups(studio, { importId: importId || "", callIds })
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/results" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioPromptTests({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null
      });
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      const limit = normalizeLimit(url.searchParams.get("limit"), 100, 1000);
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const importId = url.searchParams.get("importId")
        || (url.searchParams.get("currentOnly") ? state.importRecord?.id || "" : "");
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      const results = listEvaluationResults(studio, {
        importId,
        runId: url.searchParams.get("runId") || url.searchParams.get("evaluationRunId"),
        templateId: url.searchParams.get("templateId") || url.searchParams.get("evaluationTemplateId"),
        callId: url.searchParams.get("callId"),
        callIds,
        evaluationGoal: url.searchParams.get("evaluationGoal") || url.searchParams.get("goal"),
        status: url.searchParams.get("status"),
        reviewRecommended: url.searchParams.get("reviewRecommended") || url.searchParams.get("reviewOnly"),
        evidenceUnavailableOnly: url.searchParams.get("evidenceUnavailableOnly"),
        includeSuperseded: url.searchParams.get("includeSuperseded")
      });
      const visibleResults = results.slice(offset, offset + limit);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_results_api.v1",
        autoHarvest: {
          checkedRunCount: autoHarvest.checkedRunCount,
          harvested: autoHarvest.harvested,
          errors: autoHarvest.errors
        },
        results: visibleResults,
        query: {
          importId: importId || null,
          filteredCallIds: callIds ? callIds.size : null,
          limit,
          offset,
          displayedResults: visibleResults.length,
          matchingResults: results.length,
          nextOffset: offset + limit < results.length ? offset + limit : null,
          previousOffset: offset > 0 ? Math.max(0, offset - limit) : null
        }
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/results" && request.method === "POST") {
      try {
        const body = await readJsonBody(request, 5 * 1024 * 1024);
        const payload = {
          ...body,
          importId: body.importId || body.import_id || state.importRecord?.id || "current",
          runId: body.runId || body.evaluationRunId || body.evaluation_run_id,
          templateId: body.templateId || body.evaluationTemplateId || body.template_id,
          jobId: body.jobId || body.job_id || body.id || body.job?.id || body.job?.job_id,
          result: body.result || body.output || body.response || body.data || body.payload || body.job || body
        };
        const result = saveEvaluationResult(payload, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, {
          ok: true,
          evaluationResult: result.result,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/results/") && url.pathname.endsWith("/review") && request.method === "POST") {
      try {
        const resultId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/results/".length, -"/review".length));
        const body = await readJsonBody(request);
        const store = readStore({ storePath });
        const evaluationResult = findEvaluationStudioResult(store, resultId, body.importId || state.importRecord?.id || "");
        if (!evaluationResult) {
          sendJson(response, 404, { ok: false, error: "Evaluation Studio result not found." });
          return;
        }
        const review = saveManagerReview(buildManagerReviewFromEvaluationResult(evaluationResult, {
          ...body,
          importId: body.importId || evaluationResult.importId || state.importRecord?.id || "current"
        }), { storePath });
        state.analysis = attachPersistence(state.analysis, review.store, state.importRecord?.id || null);
        sendJson(response, 201, {
          ok: true,
          evaluationResult,
          review: review.review,
          persistence: dashboardPersistence(review.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/results/") && url.pathname.endsWith("/review") && request.method === "POST") {
      try {
        const resultId = decodeURIComponent(url.pathname.slice("/evaluation-studio/results/".length, -"/review".length));
        const form = await readFormBody(request);
        const returnTo = form.get("returnTo") || "/evaluation-studio";
        const store = readStore({ storePath });
        const evaluationResult = findEvaluationStudioResult(store, resultId, form.get("importId") || state.importRecord?.id || "");
        if (!evaluationResult) {
          sendJson(response, 404, { ok: false, error: "Evaluation Studio result not found." });
          return;
        }
        const review = saveManagerReview(buildManagerReviewFromEvaluationResult(evaluationResult, {
          importId: form.get("importId") || evaluationResult.importId || state.importRecord?.id || "current",
          action: form.get("action") || "mark_review_needed",
          reviewScope: form.get("reviewScope") || "",
          signalName: form.get("signalName") || "",
          note: form.get("note") || "",
          reviewReason: form.get("reviewReason") || "",
          reviewedBy: resolveManagerReviewActor(form)
        }), { storePath });
        state.analysis = attachPersistence(state.analysis, review.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/calls/") && url.pathname.endsWith("/reviews") && request.method === "GET") {
      const callId = decodeURIComponent(url.pathname.slice("/api/calls/".length, -"/reviews".length));
      const store = readStore({ storePath });
      const reviews = (store.managerReviews || [])
        .map(normalizeManagerReview)
        .filter((review) => review.callId === callId && (!state.importRecord?.id || review.importId === state.importRecord.id));
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_call_reviews_api.v1",
        callId,
        reviews
      });
      return;
    }

    if (url.pathname.startsWith("/api/calls/") && request.method === "GET") {
      const callId = decodeURIComponent(url.pathname.replace("/api/calls/", ""));
      const call = findCallProof(state.analysis, callId);
      if (!call) {
        sendJson(response, 404, { error: "Call not found" });
        return;
      }
      sendJson(response, 200, { call });
      return;
    }

    if (url.pathname === "/api/ai/transcript-evaluation" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const call = findCallProof(state.analysis, body.callId);
        if (!call) {
          sendJson(response, 404, { ok: false, error: "Call not found" });
          return;
        }
        const result = await submitTranscriptEvaluation(call, {
          config: aiConfig,
          fetchImpl,
          importId: body.importId || state.importRecord?.id || null,
          sourceName: state.analysis.sourceName,
          responseMode: body.responseMode,
          metadata: body.metadata || {}
        });
        const saved = saveAiJobReference({
          importId: state.importRecord?.id || "current",
          callId: call.callId,
          jobId: result.job_id,
          taskType: aiConfig.taskType,
          status: result.status || "submitted",
          metadata: {
            source: "api",
            executionLayerBaseUrl: aiConfig.baseUrl
          }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, saved.store, state.importRecord?.id || null);
        sendJson(response, 202, { ok: true, job: saved.aiJob, executionLayerResponse: result });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/ai/jobs/") && request.method === "GET") {
      try {
        const jobId = decodeURIComponent(url.pathname.replace("/api/ai/jobs/", ""));
        const job = await getAiJob(jobId, { config: aiConfig, fetchImpl });
        sendJson(response, 200, { ok: true, job });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/imports") {
      const store = readStore({ storePath });
      sendJson(response, 200, {
        imports: store.imports,
        currentImportId: state.importRecord?.id || null
      });
      return;
    }

    if (url.pathname === "/api/reports" && request.method === "GET") {
      const store = readStore({ storePath });
      sendJson(response, 200, {
        reports: activeReportsOnly(store.reports),
        hiddenReports: store.reports.length - activeReportsOnly(store.reports).length
      });
      return;
    }

    if (url.pathname.startsWith("/api/reports/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.replace("/api/reports/", ""));
      const store = readStore({ storePath });
      const report = activeReportsOnly(store.reports).find((item) => item.id === id);
      if (!report) {
        sendJson(response, 404, { error: "Report not found" });
        return;
      }
      sendJson(response, 200, { report });
      return;
    }

    if (url.pathname === "/api/reports" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveGeneratedReport(body, { storePath });
        const reportVisibility = classifyReportVisibility(result.report);
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, {
          ok: true,
          report: reportVisibility.hiddenFromActiveReports ? null : result.report,
          reportHidden: reportVisibility.hiddenFromActiveReports,
          reportVisibility
        });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/manager-reviews" && request.method === "GET") {
      const store = readStore({ storePath });
      const importId = url.searchParams.get("importId") || state.importRecord?.id || "";
      const callId = url.searchParams.get("callId") || url.searchParams.get("call_id") || "";
      const alertId = url.searchParams.get("alertId") || url.searchParams.get("alert_id") || "";
      const status = url.searchParams.get("reviewStatus") || url.searchParams.get("status") || "";
      const scope = url.searchParams.get("reviewScope") || url.searchParams.get("scope") || "";
      const reviews = (store.managerReviews || []).map(normalizeManagerReview).filter((review) => {
        if (importId && review.importId !== importId) return false;
        if (callId && review.callId !== callId) return false;
        if (alertId && review.alertId !== alertId) return false;
        if (status && review.reviewStatus !== status) return false;
        if (scope && review.reviewScope !== scope) return false;
        return true;
      });
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_manager_reviews_api.v1",
        reviews,
        persistence: dashboardPersistence(store, state.importRecord?.id || null)
      });
      return;
    }

    if (url.pathname === "/api/manager-reviews" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveManagerReview({
          ...body,
          reviewedBy: resolveManagerReviewActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, { ok: true, review: result.review, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/manager-reviews/bulk" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const reviewIds = Array.isArray(body.reviewIds) ? body.reviewIds : String(body.reviewIds || body.reviewId || "").split(",");
        const result = bulkUpdateManagerReviews(reviewIds, {
          ...body,
          reviewedBy: resolveManagerReviewActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, {
          ok: true,
          reviews: result.reviews,
          missingReviewIds: result.missingReviewIds,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/manager-reviews/") && url.pathname.endsWith("/history") && request.method === "GET") {
      const reviewId = decodeURIComponent(url.pathname.slice("/api/manager-reviews/".length, -"/history".length));
      const store = readStore({ storePath });
      const review = (store.managerReviews || [])
        .map(normalizeManagerReview)
        .find((item) => item.reviewId === reviewId || item.id === reviewId);
      if (!review || (state.importRecord?.id && review.importId !== state.importRecord.id)) {
        sendJson(response, 404, { ok: false, error: "Manager review not found" });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        reviewId,
        reviewStatus: review.reviewStatus,
        reviewHistory: review.reviewHistory || [],
        corrections: review.corrections || []
      });
      return;
    }

    if (url.pathname.startsWith("/api/manager-reviews/") && request.method === "GET") {
      const reviewId = decodeURIComponent(url.pathname.replace("/api/manager-reviews/", ""));
      const store = readStore({ storePath });
      const review = (store.managerReviews || [])
        .map(normalizeManagerReview)
        .find((item) => item.reviewId === reviewId || item.id === reviewId);
      if (!review || (state.importRecord?.id && review.importId !== state.importRecord.id)) {
        sendJson(response, 404, { ok: false, error: "Manager review not found" });
        return;
      }
      sendJson(response, 200, { ok: true, review });
      return;
    }

    if (url.pathname.startsWith("/api/manager-reviews/") && request.method === "PATCH") {
      try {
        const reviewId = decodeURIComponent(url.pathname.replace("/api/manager-reviews/", ""));
        const body = await readJsonBody(request);
        const result = updateManagerReview(reviewId, {
          ...body,
          reviewedBy: resolveManagerReviewActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 200, { ok: true, review: result.review, persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/reviews" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveManagerReview({
          ...body,
          reviewedBy: resolveManagerReviewActor(body),
          importId: body.importId || state.importRecord?.id || "current"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, { ok: true, review: result.review });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/reviews" && request.method === "POST") {
      try {
        const form = await readFormBody(request);
        const callId = form.get("callId") || "";
        const returnTo = form.get("returnTo") || `/calls/${encodeURIComponent(callId)}`;
        const reviewId = form.get("reviewId") || "";
        const payload = {
          importId: form.get("importId") || state.importRecord?.id || "current",
          callId,
          alertId: form.get("alertId") || "",
          reviewScope: form.get("reviewScope") || "call",
          signalName: form.get("signalName") || "",
          action: form.get("action") || form.get("reviewAction") || "",
          reviewStatus: form.get("reviewStatus") || form.get("status") || "",
          source: form.get("source") || "call_detail",
          reviewReason: form.get("reviewReason") || "",
          escalationReason: form.get("escalationReason") || "",
          note: form.get("note") || form.get("notes") || "",
          fieldName: form.get("fieldName") || form.get("correctionField") || "",
          managerCorrectedValue: form.get("managerCorrectedValue") || form.get("correctedValue") || "",
          previousDisplayValue: form.get("previousDisplayValue") || "",
          rawValue: form.get("rawValue") || "",
          deterministicValue: form.get("deterministicValue") || "",
          llmValue: form.get("llmValue") || "",
          correctionReason: form.get("correctionReason") || "",
          evidenceAssessment: form.get("evidenceAssessment") || "",
          confirmedOutcome: form.get("confirmedOutcome") || "",
          confirmedFollowUpRequired: form.get("confirmedFollowUpRequired") === "on",
          reviewedBy: resolveManagerReviewActor(form)
        };
        if (reviewId) updateManagerReview(reviewId, payload, { storePath });
        else saveManagerReview(payload, { storePath });
        state.analysis = attachPersistence(state.analysis, readStore({ storePath }), state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/evaluation-studio/knowledgebase" && request.method === "POST") {
      try {
        const form = await readFormBody(request);
        const result = saveEvaluationKnowledgebaseEntry({
          id: form.get("id") || "",
          title: form.get("title") || "",
          category: form.get("category") || "general",
          tags: form.get("tags") || "",
          content: form.get("content") || "",
          sourceProject: "Sales Dashboard",
          sourceReference: "manager_entered"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/knowledgebase/") && url.pathname.endsWith("/archive") && request.method === "POST") {
      try {
        const id = decodeURIComponent(url.pathname.slice("/evaluation-studio/knowledgebase/".length, -"/archive".length));
        const form = await readFormBody(request);
        const result = archiveEvaluationKnowledgebaseEntry(id, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: form.get("returnTo") || "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/evaluation-studio/templates" && request.method === "POST") {
      try {
        const form = await readFormBody(request, 2 * 1024 * 1024);
        const result = saveEvaluationTemplate({
          id: form.get("id") || "",
          name: form.get("name") || "",
          evaluationGoal: form.get("evaluationGoal") || "",
          tags: form.get("tags") || "",
          instructions: form.get("instructions") || "",
          outputSchema: form.get("outputSchema") || "",
          sourceProject: "Sales Dashboard",
          sourceReference: "manager_entered"
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/templates/") && url.pathname.endsWith("/archive") && request.method === "POST") {
      try {
        const id = decodeURIComponent(url.pathname.slice("/evaluation-studio/templates/".length, -"/archive".length));
        const form = await readFormBody(request);
        const result = archiveEvaluationTemplateRecord(id, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: form.get("returnTo") || "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/evaluation-studio/runs" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const form = await readFormBody(request);
        const body = {
          templateId: form.get("templateId") || "",
          importId: form.get("importId") || state.importRecord.id,
          businessSegment: form.get("businessSegment") || "",
          limit: form.get("limit") || 100,
          callSelection: {
            businessSegment: form.get("businessSegment") || "",
            limit: form.get("limit") || 100,
            source: "dashboard_form"
          }
        };
        const calls = selectIntelligenceExtractionCalls(state.analysis.drilldownRows || [], body, null)
          .filter((call) => String(call.transcript || "").trim());
        const result = saveEvaluationRun(body, {
          importId: state.importRecord.id,
          plannedCallCount: calls.length
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/runs/") && url.pathname.endsWith("/harvest") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/evaluation-studio/runs/".length, -"/harvest".length));
        const form = await readFormBody(request);
        const returnTo = form.get("returnTo") || "/evaluation-studio";
        const result = await harvestEvaluationStudioRunJobs(runId, {
          storePath,
          aiConfig,
          fetchImpl
        });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/runs/") && url.pathname.endsWith("/quarantine") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/evaluation-studio/runs/".length, -"/quarantine".length));
        const form = await readFormBody(request);
        const returnTo = form.get("returnTo") || "/evaluation-studio";
        const result = quarantineStoredEvaluationRun(runId, {
          reason: form.get("reason") || form.get("quarantineReason") || form.get("note") || "",
          metadata: { source: "dashboard_form" }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname.startsWith("/evaluation-studio/runs/") && url.pathname.endsWith("/resume") && request.method === "POST") {
      try {
        const runId = decodeURIComponent(url.pathname.slice("/evaluation-studio/runs/".length, -"/resume".length));
        const form = await readFormBody(request);
        const returnTo = form.get("returnTo") || "/evaluation-studio";
        const result = resumeStoredEvaluationRun(runId, {
          reason: form.get("reason") || form.get("note") || "",
          metadata: { source: "dashboard_form" }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/evaluation-studio/prompt-tests" && request.method === "POST") {
      try {
        const form = await readFormBody(request);
        const body = {
          importId: form.get("importId") || state.importRecord?.id || "current",
          templateId: form.get("templateId") || "",
          callId: form.get("callId") || "",
          businessSegment: form.get("businessSegment") || "",
          submitNow: form.get("submitNow") || ""
        };
        const result = await createEvaluationPromptTest(body, {
          state,
          storePath,
          aiConfig,
          fetchImpl
        });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: "/evaluation-studio" });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/alerts" && request.method === "POST") {
      try {
        const form = await readFormBody(request);
        const alertIds = [
          ...form.getAll("alertIds"),
          form.get("alertId") || ""
        ].map((id) => String(id || "").trim()).filter(Boolean);
        const returnTo = form.get("returnTo") || "/#alerts";
        const action = form.get("action") || "";
        const note = form.get("note") || form.get("reason") || "";
        const actor = resolveAlertLifecycleActor(form);
        const importId = form.get("importId") || state.importRecord?.id || "current";
        const result = alertIds.length > 1
          ? bulkUpdateAlertLifecycle(alertIds, { action, note, actor, importId }, { storePath })
          : updateAlertLifecycle(alertIds[0], { action, note, actor, importId }, { storePath });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/ai/transcript-evaluations" && request.method === "POST") {
      try {
        const form = await readFormBody(request);
        const callId = form.get("callId") || "";
        const returnTo = form.get("returnTo") || `/calls/${encodeURIComponent(callId)}`;
        const call = findCallProof(state.analysis, callId);
        if (!call) {
          sendJson(response, 404, { ok: false, error: "Call not found" });
          return;
        }
        const result = await submitTranscriptEvaluation(call, {
          config: aiConfig,
          fetchImpl,
          importId: form.get("importId") || state.importRecord?.id || null,
          sourceName: state.analysis.sourceName
        });
        const saved = saveAiJobReference({
          importId: state.importRecord?.id || "current",
          callId: call.callId,
          jobId: result.job_id,
          taskType: aiConfig.taskType,
          status: result.status || "submitted",
          metadata: {
            source: "call_page",
            executionLayerBaseUrl: aiConfig.baseUrl
          }
        }, { storePath });
        state.analysis = attachPersistence(state.analysis, saved.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/reload" && request.method === "POST") {
      state = loadAnalysis(csvPath, { storePath, allocationPath });
      sendJson(response, state.error ? 500 : 200, {
        ok: !state.error,
        error: state.error,
        sourceName: state.analysis.sourceName,
        importId: state.importRecord?.id || null
      });
      return;
    }

    if (url.pathname.startsWith("/reports/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.replace("/reports/", ""));
      const store = readStore({ storePath });
      const report = activeReportsOnly(store.reports).find((item) => item.id === id);
      response.writeHead(report ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderReportPage(report));
      return;
    }

    if (url.pathname === "/drilldown" && request.method === "GET") {
      const result = buildDrilldownResult(analysisForRequest(state, url, storePath), Object.fromEntries(url.searchParams.entries()));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderDrilldownPage(result));
      return;
    }

    if (url.pathname.startsWith("/calls/") && request.method === "GET") {
      const callId = decodeURIComponent(url.pathname.replace("/calls/", ""));
      const call = findCallProof(state.analysis, callId);
      const store = readStore({ storePath });
      const reviews = store.managerReviews
        .map(normalizeManagerReview)
        .filter((review) => review.callId === callId && (!state.importRecord?.id || review.importId === state.importRecord.id));
      const intelligenceAudit = state.importRecord?.id
        ? listCallIntelligence({
          storePath,
          importId: state.importRecord.id,
          callIds: callId,
          limit: 1
        })[0] || null
        : null;
      const aiJobs = store.aiJobs
        .filter((job) => job.callId === callId)
        .map((job) => intelligenceAudit?.llm_job_id && job.jobId === intelligenceAudit.llm_job_id
          ? {
            ...job,
            status: intelligenceAudit.llm_status || job.status,
            updatedAt: intelligenceAudit.updated_at || job.updatedAt
          }
          : job);
      response.writeHead(call ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderCallPage(call, {
        callId,
        reviews,
        aiJobs,
        intelligenceAudit,
        aiStatus: publicAiExecutionStatus(aiConfig),
        importId: state.importRecord?.id || null,
        returnTo: url.searchParams.get("returnTo") || `/calls/${encodeURIComponent(callId)}`
      }));
      return;
    }

    if (url.pathname === "/evaluation-studio" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioPromptTests({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null
      });
      if (autoHarvest.harvested.length) {
        state.analysis = attachPersistence(state.analysis, autoHarvest.store, state.importRecord?.id || null);
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      const activeBusinessSegment = url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "";
      const studioAnalysis = analysisForRequest(state, url, storePath);
      response.end(renderEvaluationStudioPage(studioAnalysis, {
        businessSegment: activeBusinessSegment
      }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const activeBusinessSegment = url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "";
    const intelligenceQueue = url.searchParams.get("intelligenceQueue") || "waste";
    const dashboardAnalysis = analysisForRequest(state, url, storePath);
    const filteredCallIds = new Set((dashboardAnalysis.drilldownRows || []).map((row) => row.callId));
    const defaultQueueFilters = {
      waste: { wasteRisk: "1" },
      manager_review: { managerReview: "1" },
      llm_completed: { llmStatus: "completed" },
      llm_queued: { llmStatus: "queued" },
      high_quality: { highQuality: "1" }
    }[intelligenceQueue] || { wasteRisk: "1" };
    const intelligenceCalls = state.importRecord?.id
      ? listCallIntelligence({
        storePath,
        importId: state.importRecord.id,
        businessSegment: activeBusinessSegment,
        salesperson: url.searchParams.get("salesperson") || "",
        source: url.searchParams.get("source") || "",
        customerId: url.searchParams.get("customerId") || url.searchParams.get("customer_id") || "",
        managerReview: url.searchParams.get("managerReview") || defaultQueueFilters.managerReview || "",
        wasteRisk: url.searchParams.get("wasteRisk") || defaultQueueFilters.wasteRisk || "",
        highQuality: url.searchParams.get("highQuality") || defaultQueueFilters.highQuality || "",
        llmStatus: url.searchParams.get("llmStatus") || defaultQueueFilters.llmStatus || "",
        callIds: url.searchParams.get("callIds") || "",
        limit: url.searchParams.get("intelligenceLimit") || 80
      }).filter((call) => !dashboardAnalysis.filterState?.active || filteredCallIds.has(call.call_id))
      : [];
    response.end(renderDashboard(dashboardAnalysis, {
      businessSegment: activeBusinessSegment,
      intelligenceQueue,
      intelligenceCalls
    }));
  });
}

function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 3000);
  const host = options.host || process.env.HOST || "127.0.0.1";
  const server = createServer(options);
  server.listen(port, host, () => {
    const csvPath = resolveCsvPath(options.argv || process.argv.slice(2), options.env || process.env);
    const allocationPath = resolveAllocationPath(options.argv || process.argv.slice(2), options.env || process.env);
    console.log(`Sales Dashboard listening on http://${host}:${port}`);
    console.log(csvPath ? `CSV source: ${csvPath}` : "CSV source: not configured");
    console.log(allocationPath ? "Allocation source configured but parked from active analytics" : "Allocation source: not configured");
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  resolveCsvPath,
  resolveAllocationPath,
  loadAnalysis,
  attachPersistence,
  createServer,
  startServer,
  saveGeneratedReport
};
