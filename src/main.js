"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  checkAiExecutionHealth,
  EVALUATION_STUDIO_TASK_TYPE,
  getAiJob,
  publicAiExecutionStatus,
  recordAiJobFeedback,
  resolveAiExecutionConfig,
  submitAiTask
} = require("./aiExecutionLayer");
const {
  localModelCapabilityCatalog,
  localModelCapabilityDecision,
  localModelCapabilitySummary,
  isOperationalEvaluationResult,
  SUBMISSION_USE
} = require("./localModelCapability");
const {
  createDraftManifest,
  freezeManifest,
  readValidationLab,
  saveManifestLabels,
  validationLabView,
  writeValidationLab
} = require("./evaluationValidationLab");
const { buildVoicemailInboundReport } = require("./voicemailRecovery");
const {
  buildVoicemailPilotAttributionReport,
  emptyVoicemailPilotAttributionReport,
  voicemailPilotLoadError
} = require("./voicemailPilotAttribution");
const { analyzeCsvText, attachInternalItems, buildFilteredAnalysis, internalItemsFor } = require("./analysis");
const { buildDrilldownResult, findCallProof } = require("./drilldown");
const { normalizeFilterState } = require("./globalFilters");
const { summarizeLeadReattemptRecords } = require("./leadReattemptAnalytics");
const { summarizeSystemAudioRecords } = require("./systemAudioAnalytics");
const {
  buildSalesOpportunityActionCentre,
  buildSalesOpportunityManagementBrief,
  filterSalesOpportunityRecords
} = require("./salesOpportunityActionCentre");
const {
  getIntelligenceSummary,
  listCallIntelligence,
  replaceImportIntelligence,
  resolveIntelligenceDbPath
} = require("./intelligenceDatabase");
const { readAllocationFile } = require("./allocationCoverage");
const { activeReportsOnly, buildParkedAllocationDiagnostic, classifyReportVisibility } = require("./allocationParking");
const { normalizeAlertEvent, resolveAlertLifecycleActor } = require("./alertLifecycle");
const {
  attachFoundationContextToResults,
  buildCallIntelligenceFoundationReport,
  buildOfferAcceptanceReport,
  buildEvaluationStudioInput,
  buildEvaluationStudioReportRollups,
  buildManagerReviewPrefillCorrections,
  CALL_INTELLIGENCE_FOUNDATION_GOAL,
  CALLBACK_OPPORTUNITY_GOAL,
  EVALUATION_STUDIO_ACTOR,
  FOUNDATION_SPECIALIST_GOALS,
  LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL,
  OFFER_ACCEPTANCE_GOAL,
  OBJECTION_HANDLING_GOAL,
  PROCEDURE_ADHERENCE_GOAL,
  evaluationStudioSummary,
  listEvaluationResults,
  listEvaluationTemplates,
  listKnowledgebaseEntries,
  managerReviewReasonForEvaluationResult,
  managerReviewScopeForEvaluationGoal,
  normalizeEvaluationStudio
} = require("./evaluationStudio");
const { normalizeManagerReview, resolveManagerReviewActor } = require("./managerReview");
const {
  buildTypedSpecialistRecoveryBacklog,
  selectTypedSpecialistRecoveryBatch
} = require("./overnightEvaluationAutomation");
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
  saveAiJobReferences,
  saveEvaluationKnowledgebaseEntry,
  saveEvaluationHarvestBatch,
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
const { alertContainsUntrustedLegacyData, managerReviewContainsUntrustedLegacyData, sanitizeImportSummary, sanitizeManagerReviewForPublic, sanitizeUntrustedLegacyDataForPublic } = require("./untrustedLegacyFields");

const DEFAULT_LOGO_PATH = path.join(__dirname, "assets", "sales-dashboard-logo.png");
const BRAND_LOGO_LIMIT_BYTES = 768 * 1024;
const BRAND_LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
const EVALUATION_STUDIO_AUTO_HARVEST_MAX_RUNS = 5;
const EVALUATION_STUDIO_AUTO_HARVEST_MAX_JOBS = 100;
const EVALUATION_STUDIO_SUBMISSION_CONCURRENCY = 12;
const EVALUATION_STUDIO_SUBMISSION_MAX_ATTEMPTS = 3;
const EVALUATION_STUDIO_SUBMISSION_RETRY_DELAY_MS = 150;
const EVALUATION_STUDIO_EXECUTION_CONTRACT_REVISION = "dynamic-schema-v1";
const EVALUATION_STUDIO_OFFER_ACCEPTANCE_VALIDATION_REVISION = 7;
const EVALUATION_STUDIO_LEAD_RECORD_AUDIT_VALIDATION_REVISION = 3;
const EVALUATION_STUDIO_TYPED_SPECIALIST_VALIDATION_REVISION = 3;

function capabilityQuarantineError(decision) {
  const error = new Error(`Local-model capability ${decision.capabilityId} is unavailable: ${decision.reason}. Historical outputs remain research-only.`);
  error.code = "LOCAL_MODEL_CAPABILITY_QUARANTINED";
  error.status = 423;
  error.statusCode = 423;
  error.payload = { capability: decision };
  return error;
}

function assertEvaluationTemplateSubmissionAllowed(template = {}, body = {}, aiConfig = {}) {
  const outputSchema = template.outputSchema || {};
  const schemaVersion = outputSchema.properties?.schema_version?.const || outputSchema.$id || "";
  const submissionContext = {
    use: SUBMISSION_USE,
    taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
    evaluationGoal: template.evaluationGoal,
    model: body.model || aiConfig.model,
    providerModel: body.providerModel,
    modelDigest: body.modelDigest,
    promptHash: template.promptHash,
    schemaVersion,
    schemaHash: crypto.createHash("sha256").update(JSON.stringify(outputSchema)).digest("hex"),
    inferenceSettingsHash: body.inferenceSettingsHash,
    inferenceSettings: body.inferenceSettings,
    executionContractRevision: body.executionContractRevision,
    populationId: template.supportedPopulation?.populationId,
    populationDefinitionHash: template.supportedPopulation?.definitionHash,
    metadata: {
      evaluation_goal: template.evaluationGoal,
      source_type: body.sourceType || "evaluation_studio"
    }
  };
  const decision = localModelCapabilityDecision(submissionContext);
  if (!decision.permitted) throw capabilityQuarantineError(decision);
  return {
    decision,
    submissionContext: {
      ...submissionContext,
      model: decision.promotionContract?.model_key,
      providerModel: decision.promotionContract?.provider_model,
      modelDigest: decision.promotionContract?.model_digest,
      inferenceSettingsHash: decision.promotionContract?.inference_settings_hash,
      inferenceSettings: decision.promotionContract?.inference_settings,
      executionContractRevision: decision.promotionContract?.execution_contract_revision
    }
  };
}

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

function resolveVoicemailPilotPath(argv = process.argv.slice(2), env = process.env) {
  const pilotFlagIndex = argv.findIndex((arg) => arg === "--voicemail-pilot" || arg === "--voicemail-pilot-path");
  if (pilotFlagIndex >= 0 && argv[pilotFlagIndex + 1]) {
    return path.resolve(argv[pilotFlagIndex + 1]);
  }
  if (env.SALES_DASHBOARD_VOICEMAIL_PILOT_PATH) {
    return path.resolve(env.SALES_DASHBOARD_VOICEMAIL_PILOT_PATH);
  }
  return null;
}

function loadVoicemailPilotAttribution(pilotPath, calls = []) {
  if (!pilotPath) return emptyVoicemailPilotAttributionReport({ configured: false });
  try {
    const source = readTabularFile(pilotPath);
    return buildVoicemailPilotAttributionReport(source, calls, { configured: true });
  } catch (error) {
    return voicemailPilotLoadError(error, path.basename(pilotPath));
  }
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
  const hasResult = Boolean(String(row.llm_result_json || "").trim());
  if (hasResult) return "Research-only archive";
  if (status === "queued") return "Retired queue record";
  if (status === "failed" || status === "completed") return "Retired historical record";
  return "No research artifact";
}

function filterContextForStore(store, importId, intelligenceRows = []) {
  const currentAlerts = (store.alertEvents || []).map(normalizeAlertEvent).filter((event) => {
    if (event.parkedDataRelated) return false;
    if (alertContainsUntrustedLegacyData(event)) return false;
    return !importId || event.importId === importId;
  });
  const currentReviews = (store.managerReviews || []).map(normalizeManagerReview).filter((review) => !managerReviewContainsUntrustedLegacyData(review) && (!importId || review.importId === importId));
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

function salesOpportunityActionCentreForRequest(state, url, storePath) {
  const analysis = analysisForRequest(state, url, storePath);
  const store = readStore({ storePath });
  return {
    analysis,
    centre: buildSalesOpportunityActionCentre({
      studio: store.evaluationStudio,
      importId: state.importRecord?.id || "",
      calls: analysis.drilldownRows || [],
      leadHarvestRecords: analysis.leadHarvest?.records || []
    })
  };
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

function importSnapshotReport(importRecord = {}) {
  const safe = sanitizeImportSummary(importRecord);
  const totals = safe.totals || {};
  const rates = safe.rates || {};
  const rows = [
    ["Unique calls", totals.uniqueCalls],
    ["Transcripts available", totals.transcriptAvailable],
    ["Probable live-human", totals.probableLiveHuman],
    ["Meaningful conversations", totals.meaningfulConversation],
    ["Follow-up signals", totals.followUpRequired],
    ["Risk reviews", totals.riskReviews],
    ["Transcript coverage", rates.transcriptCoverage === undefined ? "n/a" : `${Number(rates.transcriptCoverage || 0).toFixed(1)}%`],
    ["Probable live-human rate", rates.probableLiveHuman === undefined ? "n/a" : `${Number(rates.probableLiveHuman || 0).toFixed(1)}%`]
  ];
  return {
    id: safe.id,
    title: `Import Snapshot — ${safe.sourceName || safe.id || "CSV import"}`,
    type: "import_snapshot",
    source: "system",
    summary: `Stored summary for ${Number(totals.uniqueCalls || 0).toLocaleString("en-AU")} unique calls. Historical import snapshots contain aggregate data, not the original row-level CSV.`,
    content: [
      "## Import details",
      "",
      `- Import ID: ${safe.id || "Not supplied"}`,
      `- Source: ${safe.sourceName || "Not supplied"}`,
      `- Loaded: ${safe.lastImportedAt || "Not supplied"}`,
      `- Source period: ${safe.dateRange?.display || safe.dateRange?.sourceStart || "Not supplied"}`,
      "",
      "## Stored metrics",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      ...rows.map(([label, value]) => `| ${label} | ${value ?? 0} |`),
      "",
      "This is the complete safe summary retained for this import. Open the current dashboard call drill-downs for row-level proof from the actively loaded CSV."
    ].join("\n"),
    createdAt: safe.firstImportedAt || safe.lastImportedAt,
    updatedAt: safe.lastImportedAt,
    metadata: safe
  };
}

function managerReviewSnapshotReport(reviews = [], calls = []) {
  const safeRows = reviews.map(sanitizeManagerReviewForPublic);
  const callLookup = new Map((calls || []).map((call) => [String(call.callId || call.call_id || "").trim(), call]));
  const escapeCell = (value) => String(value === undefined || value === null ? "" : value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return {
    id: "current_manager_reviews",
    title: "Current Manager Reviews",
    type: "manager_review_snapshot",
    source: "system",
    summary: `${safeRows.length.toLocaleString("en-AU")} saved manager review records for the active import.`,
    content: [
      "## Saved review records",
      "",
      "| Review ID | Call ID | Customer ID | Status | Scope | Reviewer | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...safeRows.map((row) => {
        const callId = String(row.callId || "").trim();
        const call = callLookup.get(callId) || {};
        const customerId = String(call.customerId || call.customer_id || "").trim() || "Not available";
        const callCell = callId ? `[${callId}](/calls/${encodeURIComponent(callId)})` : "Not supplied";
        return `| ${escapeCell(row.id || row.reviewId)} | ${escapeCell(callCell)} | ${escapeCell(customerId)} | ${escapeCell(row.reviewStatus)} | ${escapeCell(row.reviewScope)} | ${escapeCell(row.reviewedBy || row.updatedBy)} | ${escapeCell(row.updatedAt || row.reviewedAt)} |`;
      }),
      "",
      safeRows.length ? "Open a call from the dashboard to inspect its transcript proof and complete review history." : "No manager reviews are stored for the active import."
    ].join("\n"),
    updatedAt: safeRows.map((row) => row.updatedAt || row.reviewedAt || "").sort().at(-1) || new Date().toISOString(),
    metadata: { reviewCount: safeRows.length }
  };
}

function evaluationStudioApiPayload(store, currentImportId = null, query = {}) {
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const resultImportId = query.importId || (query.currentOnly ? currentImportId : "");
  const resultLimit = normalizeLimit(query.limit, 50, 500);
  const resultOffset = Math.max(0, Number(query.offset || 0));
  const callIds = query.callIds || null;
  const callLookup = new Map((query.calls || []).map((call) => [String(call.callId || call.call_id || "").trim(), call]));
  const withCustomerId = (row) => {
    const call = callLookup.get(String(row?.callId || "").trim()) || {};
    return {
      ...row,
      customerId: String(call.customerId || call.customer_id || "").trim() || "Not available"
    };
  };
  const resultRows = listEvaluationResults(studio, {
    importId: resultImportId,
    runId: query.runId,
    templateId: query.templateId,
    callIds,
    evaluationGoal: query.evaluationGoal || query.goal,
    status: query.resultStatus || query.status,
    recordClassification: query.recordClassification,
    recordReason: query.recordReason,
    operationalClassification: query.operationalClassification,
    recommendation: query.recommendation,
    allegationAssessment: query.allegationAssessment,
    acceptanceClassification: query.acceptanceClassification,
    foundationOpportunityStatus: query.foundationOpportunityStatus,
    foundationMeasurementEligibility: query.foundationMeasurementEligibility,
    foundationEfficiencyStatus: query.foundationEfficiencyStatus,
    foundationCalledOnBehalfOf: query.foundationCalledOnBehalfOf,
    foundationFollowUpTiming: query.foundationFollowUpTiming,
    foundationSpecialistRoute: query.foundationSpecialistRoute,
    foundationOfferPresented: query.foundationOfferPresented,
    foundationQuotedAmountAvailable: query.foundationQuotedAmountAvailable,
    spielCallHandlingQuality: query.spielCallHandlingQuality,
    spielSpielQuality: query.spielSpielQuality,
    spielCallPurpose: query.spielCallPurpose,
    spielPrimaryReasonCode: query.spielPrimaryReasonCode,
    reportSignal: query.reportSignal,
    confidenceBand: query.confidenceBand,
    evidenceAvailability: query.evidenceAvailability,
    reviewRecommended: query.reviewRecommended,
    evidenceUnavailableOnly: query.evidenceUnavailableOnly,
    includeSuperseded: query.includeSuperseded
  });
  const resultGroups = [];
  const resultGroupLookup = new Map();
  resultRows.forEach((result) => {
    const key = String(result.callId || "unknown");
    if (!resultGroupLookup.has(key)) {
      const group = { callId: key, results: [] };
      resultGroupLookup.set(key, group);
      resultGroups.push(group);
    }
    resultGroupLookup.get(key).results.push(result);
  });
  const selectedResultGroups = resultGroups.slice(resultOffset, resultOffset + resultLimit);
  const selectedResultRows = selectedResultGroups.flatMap((group) => group.results);
  const reportRollups = buildEvaluationStudioReportRollups(studio, { importId: resultImportId || currentImportId || "", callIds });
  reportRollups.priorityExamples = (reportRollups.priorityExamples || []).map(withCustomerId);
  const evaluationResults = attachFoundationContextToResults(studio, selectedResultRows, query.calls || []).map(withCustomerId);
  const evidenceQueue = listEvaluationResults(studio, {
    importId: resultImportId,
    callIds,
    reviewRecommended: true
  }).slice(0, resultLimit).map(withCustomerId);
  return {
    schemaVersion: "sales_dashboard_evaluation_studio_api.v1",
    overnightAutomation: query.overnightAutomation || null,
    summary: evaluationStudioSummary(studio, currentImportId, { callIds }),
    reportRollups,
    offerAcceptanceReport: buildOfferAcceptanceReport(studio, {
      importId: resultImportId || currentImportId || "",
      callIds,
      calls: query.calls || []
    }),
    foundationReport: buildCallIntelligenceFoundationReport(studio, {
      importId: resultImportId || currentImportId || "",
      callIds,
      calls: query.calls || []
    }),
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
      .filter((run) => !run.containsUntrustedLegacyData && (!currentImportId || !query.currentOnly || run.importId === currentImportId))
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(sanitizeUntrustedLegacyDataForPublic),
    evaluationResults,
    evidenceQueue,
    resultQuery: {
      importId: resultImportId || null,
      filteredCallIds: callIds ? callIds.size : null,
      limit: resultLimit,
      offset: resultOffset,
      matchingResults: resultRows.length,
      matchingCalls: resultGroups.length,
      displayedResults: selectedResultRows.length,
      displayedCalls: selectedResultGroups.length,
      nextOffset: resultOffset + resultLimit < resultGroups.length ? resultOffset + resultLimit : null,
      previousOffset: resultOffset > 0 ? Math.max(0, resultOffset - resultLimit) : null
    }
  };
}

function evaluationStudioOvernightStatus(storePath) {
  const statePath = path.join(path.dirname(storePath), "evaluation-overnight-state.json");
  let runtime = null;
  try {
    runtime = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {}
  return {
    schemaVersion: "sales_dashboard_overnight_status.v1",
    installed: false,
    schedule: "Disabled by local-model capability quarantine",
    submissionCutoff: null,
    foundationBatchSize: 0,
    specialistRecoveryBatchSize: 0,
    idleRequiredSeconds: null,
    memoryFloorGb: null,
    behavior: "No automatic local-model evaluation is authorised. The former runtime state is retained as research-only audit history.",
    runtime: runtime ? { ...runtime, researchOnly: true, authority: "none" } : null
  };
}

function stripTrustedClaimContextForPublic(value) {
  if (Array.isArray(value)) return value.map(stripTrustedClaimContextForPublic);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (["salesperson_allegation", "trusted_bad_lead_claim_context"].includes(key)) return [];
    return [[key, stripTrustedClaimContextForPublic(item)]];
  }));
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
  const values = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return new Set(values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 50000));
}

function selectIntelligenceExtractionCalls(rows, body = {}, eligibleCallIds = null) {
  const businessSegment = String(body.businessSegment || body.segment || "").trim();
  const salesperson = String(body.salesperson || "").trim();
  const source = String(body.source || body.customerImportSource || "").trim();
  const contactClassification = String(body.contactClassification || body.contact || "").trim();
  const transcriptQuality = String(body.transcriptQuality || body.quality || "").trim();
  const dateFrom = String(body.dateFrom || body.date_from || "").trim().slice(0, 10);
  const dateTo = String(body.dateTo || body.date_to || "").trim().slice(0, 10);
  const minDuration = Math.max(0, Number(body.minDuration || body.min_duration || 0));
  const maxDuration = Math.max(0, Number(body.maxDuration || body.max_duration || 0));
  const search = String(body.search || body.query || "").trim().toLowerCase();
  const selectionMode = String(body.selectionMode || body.selection_mode || body.sort || "newest").trim().toLowerCase();
  const limit = normalizeLimit(body.sampleSize || body.limit, 100, 50000);
  const requestedCallIds = parseCallIdFilter(body.callIds || body.call_ids || body.callId || body.call_id || "");
  if (selectionMode === "call_ids" && !requestedCallIds.size) return [];
  const sourceDate = (call) => String(call.date || call.dateTime || "").slice(0, 10);
  const candidates = (rows || []).filter((call) => {
    if (businessSegment && call.businessSegment !== businessSegment) return false;
    if (salesperson && call.salesperson !== salesperson) return false;
    if (source && call.source !== source && call.customerImportSource !== source) return false;
    if (contactClassification && call.contactClassification !== contactClassification) return false;
    if (transcriptQuality && call.transcriptQuality !== transcriptQuality) return false;
    if (dateFrom && sourceDate(call) < dateFrom) return false;
    if (dateTo && sourceDate(call) > dateTo) return false;
    if (minDuration && Number(call.durationSeconds || 0) < minDuration) return false;
    if (maxDuration && Number(call.durationSeconds || 0) > maxDuration) return false;
    if (search && ![call.callId, call.salesperson, call.source, call.contactClassification, call.localOutcome]
      .some((value) => String(value || "").toLowerCase().includes(search))) return false;
    if (eligibleCallIds && !eligibleCallIds.has(call.callId)) return false;
    if (requestedCallIds.size && !requestedCallIds.has(String(call.callId))) return false;
    return true;
  });
  const ordered = candidates.slice().sort((left, right) => {
    if (selectionMode === "random") {
      const seed = String(body.randomSeed || body.random_seed || "sales-dashboard-local-sample");
      const leftHash = crypto.createHash("sha256").update(`${seed}:${left.callId}`).digest("hex");
      const rightHash = crypto.createHash("sha256").update(`${seed}:${right.callId}`).digest("hex");
      return leftHash.localeCompare(rightHash);
    }
    const comparison = `${sourceDate(left)} ${left.time || ""} ${left.callId || ""}`
      .localeCompare(`${sourceDate(right)} ${right.time || ""} ${right.callId || ""}`);
    return selectionMode === "oldest" || selectionMode === "oldest_first" ? comparison : -comparison;
  });
  if (businessSegment || !body.balancedSegments) {
    return ordered.slice(0, limit);
  }

  const newCalls = ordered.filter((call) => call.businessSegment === "new");
  const warmCalls = ordered.filter((call) => call.businessSegment === "warm");
  const warmTarget = Math.max(1, Math.floor(limit / 2));
  const newTarget = Math.max(0, limit - warmTarget);
  return [
    ...newCalls.slice(0, newTarget),
    ...warmCalls.slice(0, warmTarget)
  ].slice(0, limit);
}

function selectEvaluationBatchCalls(rows, body = {}, studio = {}, importId = "") {
  const evaluationState = String(body.evaluationState || body.evaluation_state || "unevaluated").trim().toLowerCase();
  const templateId = String(body.templateId || body.template_id || "").trim();
  const transcriptRows = (rows || []).filter((call) => String(call.transcript || "").trim());
  const existingResults = listEvaluationResults(studio, {
    importId,
    templateId,
    includeSuperseded: false
  });
  const existingByCall = new Map(existingResults.map((result) => [String(result.callId), result]));
  let eligibleCallIds = null;
  if (evaluationState === "unevaluated") {
    eligibleCallIds = new Set(transcriptRows.map((call) => String(call.callId)).filter((callId) => !existingByCall.has(callId)));
  } else if (evaluationState === "evaluated") {
    eligibleCallIds = new Set(existingByCall.keys());
  } else if (evaluationState === "failed") {
    eligibleCallIds = new Set(existingResults.filter((result) => result.status === "failed").map((result) => String(result.callId)));
  }
  return selectIntelligenceExtractionCalls(transcriptRows, body, eligibleCallIds);
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

function evaluationExecutionAudit(result = {}) {
  const job = result.job && typeof result.job === "object" ? result.job : result;
  // Authority metadata must be supplied by the Execution Layer in the
  // server-owned job envelope. Never trust model_metadata emitted inside the
  // model's result_payload; that content is model-controlled.
  const runtimeMetadata = job.execution_provenance && typeof job.execution_provenance === "object" && !Array.isArray(job.execution_provenance)
    ? job.execution_provenance
    : job.model_metadata && typeof job.model_metadata === "object" && !Array.isArray(job.model_metadata)
      ? job.model_metadata
    : {};
  return {
    taskType: job.task_type || job.taskType || "",
    modelMetadata: {
      model: job.model_used || job.modelUsed || job.model || "",
      providerModel: runtimeMetadata.provider_model || runtimeMetadata.providerModel || "",
      route: job.route_id || job.routeId || "",
      modelDigest: runtimeMetadata.model_digest || runtimeMetadata.modelDigest || "",
      capabilityId: runtimeMetadata.capability_id || runtimeMetadata.capabilityId || "",
      capabilityRegisterHash: runtimeMetadata.capability_register_hash || runtimeMetadata.capabilityRegisterHash || "",
      promotionContractHash: runtimeMetadata.promotion_contract_hash || runtimeMetadata.promotionContractHash || "",
      schemaHash: runtimeMetadata.schema_hash || runtimeMetadata.schemaHash || "",
      inferenceSettingsHash: runtimeMetadata.inference_settings_hash || runtimeMetadata.inferenceSettingsHash || "",
      inferenceSettings: runtimeMetadata.inference_settings || runtimeMetadata.inferenceSettings || null,
      executionContractRevision: runtimeMetadata.execution_contract_revision || runtimeMetadata.executionContractRevision || "",
      populationId: runtimeMetadata.population_id || runtimeMetadata.populationId || "",
      populationDefinitionHash: runtimeMetadata.population_definition_hash || runtimeMetadata.populationDefinitionHash || "",
      provenanceAuthority: runtimeMetadata.provenance_authority || runtimeMetadata.provenanceAuthority || ""
    },
    executionMetadata: {
      promptTokens: job.prompt_tokens ?? job.promptTokens ?? null,
      completionTokens: job.completion_tokens ?? job.completionTokens ?? null,
      totalTokens: job.total_tokens ?? job.totalTokens ?? null,
      executionMs: job.execution_ms ?? job.executionMs ?? null,
      retryCount: job.retry_count ?? job.retryCount ?? null
    }
  };
}

function aiJobIsDone(status) {
  return ["done", "completed", "complete", "succeeded", "success"].includes(String(status || "").toLowerCase());
}

function aiJobIsFailed(status) {
  return ["failed", "error", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function offerAcceptanceEvaluationRun(run = {}) {
  return run.templateSnapshot?.evaluationGoal === OFFER_ACCEPTANCE_GOAL
    || /^template_offer_acceptance_classification_v\d+$/.test(String(run.templateId || ""));
}

function leadRecordAuditEvaluationRun(run = {}) {
  return run.templateSnapshot?.evaluationGoal === LEAD_RECORD_DISPOSITION_EVIDENCE_AUDIT_GOAL
    || /^template_lead_record_disposition_evidence_audit_v\d+$/.test(String(run.templateId || ""));
}

function typedSpecialistEvaluationRun(run = {}) {
  return [CALLBACK_OPPORTUNITY_GOAL, OBJECTION_HANDLING_GOAL, PROCEDURE_ADHERENCE_GOAL]
    .includes(run.templateSnapshot?.evaluationGoal)
    || /^template_(?:callback_opportunity|objection_handling|procedure_adherence)_v\d+$/.test(String(run.templateId || ""));
}

function evaluationStudioSemanticValidationRevision(run = {}) {
  if (offerAcceptanceEvaluationRun(run)) return EVALUATION_STUDIO_OFFER_ACCEPTANCE_VALIDATION_REVISION;
  if (leadRecordAuditEvaluationRun(run)) return EVALUATION_STUDIO_LEAD_RECORD_AUDIT_VALIDATION_REVISION;
  if (typedSpecialistEvaluationRun(run)) return EVALUATION_STUDIO_TYPED_SPECIALIST_VALIDATION_REVISION;
  return 1;
}

function evaluationStudioSemanticFailureCanRetry(run = {}, job = {}) {
  return job.terminalFailureCategory === "evaluator_semantic_validation_failed"
    && (offerAcceptanceEvaluationRun(run) || leadRecordAuditEvaluationRun(run) || typedSpecialistEvaluationRun(run))
    && Number(job.semanticValidationRevision || 0) < evaluationStudioSemanticValidationRevision(run);
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

function evaluationStudioTerminalHarvestFailure(error, resolvedStatus) {
  if (!aiJobIsDone(resolvedStatus)) return null;
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode !== 400) return null;
  return {
    category: "evaluator_semantic_validation_failed",
    error: String(error?.message || "Evaluation result failed semantic validation.").slice(0, 1000)
  };
}

function dedupeEvaluationStudioErrors(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.callId || "", item.jobId || "", item.category || "", item.error || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evaluationStudioHarvestKey(jobs = []) {
  return jobs
    .map((job) => [job.jobId || "", job.status || "", job.resultId || "", job.terminalFailureCategory || ""].join(":"))
    .sort()
    .join("|");
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

function evaluationStudioIdempotencyKey(run = {}, call = {}, template = {}) {
  return [
    "sales-dashboard",
    "evaluation-studio",
    EVALUATION_STUDIO_EXECUTION_CONTRACT_REVISION,
    run.id || "run",
    call.callId || "call",
    template.promptHash || `template-v${template.version || 1}`
  ].join(":");
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

  const preflightStore = readStore({ storePath });
  const preflightStudio = normalizeEvaluationStudio(preflightStore.evaluationStudio);
  const preflightTemplate = preflightStudio.evaluationTemplates.find((item) => item.id === String(body.templateId || body.template_id || "").trim());
  if (!preflightTemplate) {
    const error = new Error("A current Evaluation Studio template is required.");
    error.statusCode = 400;
    throw error;
  }
  const capabilityPreflight = assertEvaluationTemplateSubmissionAllowed(preflightTemplate, body, aiConfig);

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
    sourceName: state.analysis.sourceName,
    badLeadClaims: store.badLeadClaims || []
  });

  if (submitNow) {
    executionLayerResponse = await submitAiTask(taskInput, {
      config: aiConfig,
      fetchImpl,
      taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
      responseMode: body.responseMode,
      capabilityId: capabilityPreflight.decision.capabilityId,
      evaluationGoal: template.evaluationGoal,
      model: capabilityPreflight.submissionContext.model,
      providerModel: capabilityPreflight.submissionContext.providerModel,
      modelDigest: capabilityPreflight.submissionContext.modelDigest,
      promptHash: capabilityPreflight.submissionContext.promptHash,
      schemaVersion: capabilityPreflight.submissionContext.schemaVersion,
      schemaHash: capabilityPreflight.submissionContext.schemaHash,
      inferenceSettingsHash: capabilityPreflight.submissionContext.inferenceSettingsHash,
      inferenceSettings: capabilityPreflight.submissionContext.inferenceSettings,
      executionContractRevision: capabilityPreflight.submissionContext.executionContractRevision,
      populationId: capabilityPreflight.submissionContext.populationId,
      populationDefinitionHash: capabilityPreflight.submissionContext.populationDefinitionHash,
      idempotencyKey: evaluationStudioIdempotencyKey(run, call, template),
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
        ...evaluationExecutionAudit(executionLayerResponse),
        result: aiJobResultPayload(executionLayerResponse),
        validationContext: { call }
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

async function createEvaluationBatchRun(body = {}, options = {}) {
  const { state, storePath, aiConfig, fetchImpl } = options;
  if (!state?.analysis || !state?.importRecord?.id) {
    const error = new Error("No current import is loaded.");
    error.statusCode = 400;
    throw error;
  }
  const importId = body.importId || state.importRecord.id;
  const currentStore = readStore({ storePath });
  const currentStudio = normalizeEvaluationStudio(currentStore.evaluationStudio);
  const selectedTemplate = currentStudio.evaluationTemplates.find((template) => template.id === String(body.templateId || body.template_id || "").trim());
  if (!selectedTemplate) {
    const error = new Error("A current Evaluation Studio template is required.");
    error.statusCode = 400;
    throw error;
  }
  const capabilityPreflight = assertEvaluationTemplateSubmissionAllowed(selectedTemplate, body, aiConfig);
  const autoRouteSpecialists = selectedTemplate?.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL
    && truthy(body.autoRouteSpecialists ?? body.auto_route_specialists ?? false);
  const calls = selectEvaluationBatchCalls(state.analysis.drilldownRows || [], body, currentStudio, importId);
  if (!calls.length) {
    const error = new Error("No calls with transcript text matched this selection.");
    error.statusCode = 400;
    throw error;
  }
  const submitNow = truthy(body.submitNow || body.submit || body.runNow);
  const initial = saveEvaluationRun({
    ...body,
    status: submitNow ? "queued" : (body.status || "queued"),
    callSelection: {
      ...(body.callSelection || {}),
      businessSegment: body.businessSegment || "",
      salesperson: body.salesperson || "",
      source: body.source || "",
      contactClassification: body.contactClassification || "",
      transcriptQuality: body.transcriptQuality || "",
      dateFrom: body.dateFrom || "",
      dateTo: body.dateTo || "",
      minDuration: Number(body.minDuration || 0),
      maxDuration: Number(body.maxDuration || 0),
      selectionMode: body.selectionMode || "newest",
      evaluationState: body.evaluationState || "unevaluated",
      requestedCallIds: Array.from(parseCallIdFilter(body.callIds || body.call_ids || "")),
      limit: normalizeLimit(body.limit, 100, 50000),
      sourceType: body.callSelection?.sourceType || "evaluation_studio_local_selection",
      autoRouteSpecialists,
      parentFoundationRunId: body.callSelection?.parentFoundationRunId || "",
      specialistGoal: body.callSelection?.specialistGoal || ""
    }
  }, {
    importId,
    plannedCallCount: calls.length
  }, { storePath });
  let run = initial.run;
  let store = initial.store;
  if (!submitNow) return { calls, evaluationRun: run, submitted: false, store };

  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const template = studio.evaluationTemplates.find((item) => item.id === run.templateId);
  const knowledgebase = studio.knowledgebaseEntries.filter((entry) => run.knowledgebaseIds.includes(entry.id));
  const queuedJobs = [];
  const queuedAiJobReferences = [];
  const errors = [];
  for (let offset = 0; offset < calls.length; offset += EVALUATION_STUDIO_SUBMISSION_CONCURRENCY) {
    const chunk = calls.slice(offset, offset + EVALUATION_STUDIO_SUBMISSION_CONCURRENCY);
    await Promise.all(chunk.map(async (call) => {
      try {
        const input = buildEvaluationStudioInput(call, template, knowledgebase, {
          importId: run.importId,
          sourceName: state.analysis.sourceName,
          badLeadClaims: store.badLeadClaims || []
        });
        let result = null;
        for (let attempt = 1; attempt <= EVALUATION_STUDIO_SUBMISSION_MAX_ATTEMPTS; attempt += 1) {
          try {
            result = await submitAiTask(input, {
              config: aiConfig,
              fetchImpl,
              taskType: body.taskType || EVALUATION_STUDIO_TASK_TYPE,
              responseMode: body.responseMode,
              capabilityId: capabilityPreflight.decision.capabilityId,
              evaluationGoal: template.evaluationGoal,
              model: capabilityPreflight.submissionContext.model,
              providerModel: capabilityPreflight.submissionContext.providerModel,
              modelDigest: capabilityPreflight.submissionContext.modelDigest,
              promptHash: capabilityPreflight.submissionContext.promptHash,
              schemaVersion: capabilityPreflight.submissionContext.schemaVersion,
              schemaHash: capabilityPreflight.submissionContext.schemaHash,
              inferenceSettingsHash: capabilityPreflight.submissionContext.inferenceSettingsHash,
              inferenceSettings: capabilityPreflight.submissionContext.inferenceSettings,
              executionContractRevision: capabilityPreflight.submissionContext.executionContractRevision,
              populationId: capabilityPreflight.submissionContext.populationId,
              populationDefinitionHash: capabilityPreflight.submissionContext.populationDefinitionHash,
              idempotencyKey: evaluationStudioIdempotencyKey(run, call, template),
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
            break;
          } catch (error) {
            const transient = !error.status || error.status === 429 || error.status >= 500;
            if (!transient || attempt === EVALUATION_STUDIO_SUBMISSION_MAX_ATTEMPTS) throw error;
            await new Promise((resolve) => setTimeout(resolve, EVALUATION_STUDIO_SUBMISSION_RETRY_DELAY_MS * attempt));
          }
        }
        const jobId = aiJobId(result);
        const status = aiJobStatus(result) || "queued";
        if (!jobId) throw new Error("Execution layer response did not include a job ID.");
        queuedAiJobReferences.push({
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
        });
        queuedJobs.push({ callId: call.callId, jobId, status });
      } catch (error) {
        errors.push({ callId: call.callId, error: error.message });
      }
    }));
  }
  const callOrder = new Map(calls.map((call, index) => [String(call.callId), index]));
  queuedJobs.sort((left, right) => (callOrder.get(String(left.callId)) ?? 0) - (callOrder.get(String(right.callId)) ?? 0));
  errors.sort((left, right) => (callOrder.get(String(left.callId)) ?? 0) - (callOrder.get(String(right.callId)) ?? 0));
  if (queuedAiJobReferences.length) {
    store = saveAiJobReferences(queuedAiJobReferences, { storePath }).store;
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
  return { calls, evaluationRun: run, submitted: true, store };
}

async function routeFoundationRunSpecialists(runId, options = {}) {
  const { storePath, aiConfig, fetchImpl, analysis = null } = options;
  let store = readStore({ storePath });
  let studio = normalizeEvaluationStudio(store.evaluationStudio);
  let foundationRun = (studio.evaluationRuns || []).find((run) => run.id === runId);
  if (!foundationRun || foundationRun.templateSnapshot?.evaluationGoal !== CALL_INTELLIGENCE_FOUNDATION_GOAL) {
    return { routed: false, reason: "not_foundation_run", store };
  }
  const routingCapability = localModelCapabilityDecision({
    evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
    taskType: EVALUATION_STUDIO_TASK_TYPE,
    model: foundationRun.executionModel || "",
    promptHash: foundationRun.templateSnapshot?.promptHash || "",
    schemaVersion: foundationRun.templateSnapshot?.outputSchema?.properties?.schema_version?.const || ""
  });
  if (!routingCapability.permitted) {
    return { routed: false, reason: "foundation_capability_quarantined", capability: routingCapability, store };
  }
  if (!foundationRun.callSelection?.autoRouteSpecialists) {
    return { routed: false, reason: "routing_not_requested", store };
  }
  if (!analysis || !Array.isArray(analysis.drilldownRows)) {
    return { routed: false, reason: "source_transcripts_unavailable", store };
  }
  if (foundationRun.specialistRouting?.status === "completed") {
    return { routed: false, reason: "already_completed", routing: foundationRun.specialistRouting, store };
  }

  const foundationResults = listEvaluationResults(studio, {
    importId: foundationRun.importId,
    runId: foundationRun.id,
    evaluationGoal: CALL_INTELLIGENCE_FOUNDATION_GOAL,
    operationalOnly: true
  }).filter((result) => result.status !== "failed" && result.foundationAssessment);
  const routeCallIds = new Map(FOUNDATION_SPECIALIST_GOALS.map((goal) => [goal, []]));
  foundationResults.forEach((result) => {
    const routes = result.foundationAssessment?.specialistRoutes || {};
    FOUNDATION_SPECIALIST_GOALS.forEach((goal) => {
      if (routes[goal]) routeCallIds.get(goal).push(result.callId);
    });
  });

  const childRuns = [];
  const skipped = [];
  const errors = [];
  for (const goal of FOUNDATION_SPECIALIST_GOALS) {
    const callIds = Array.from(new Set(routeCallIds.get(goal) || []));
    if (!callIds.length) {
      skipped.push({ goal, reason: "no_matching_calls", callCount: 0 });
      continue;
    }
    store = readStore({ storePath });
    studio = normalizeEvaluationStudio(store.evaluationStudio);
    const existingChild = (studio.evaluationRuns || []).find((run) =>
      run.callSelection?.parentFoundationRunId === foundationRun.id
      && run.callSelection?.specialistGoal === goal
    );
    if (existingChild) {
      childRuns.push({ goal, runId: existingChild.id, callCount: Number(existingChild.plannedCallCount || 0), reused: true });
      continue;
    }
    const template = (studio.evaluationTemplates || []).find((item) =>
      item.isActive && !item.containsUntrustedLegacyData && item.evaluationGoal === goal
    );
    if (!template) {
      errors.push({ goal, error: "No active specialist template is available." });
      continue;
    }
    try {
      const child = await createEvaluationBatchRun({
        templateId: template.id,
        importId: foundationRun.importId,
        evaluationState: "unevaluated",
        selectionMode: "call_ids",
        callIds: callIds.join(","),
        limit: callIds.length,
        submitNow: true,
        autoRouteSpecialists: false,
        callSelection: {
          sourceType: "foundation_specialist_routing",
          parentFoundationRunId: foundationRun.id,
          specialistGoal: goal
        }
      }, {
        state: {
          analysis,
          importRecord: { id: foundationRun.importId }
        },
        storePath,
        aiConfig,
        fetchImpl
      });
      store = child.store;
      childRuns.push({
        goal,
        runId: child.evaluationRun.id,
        callCount: child.calls.length,
        reused: false
      });
    } catch (error) {
      if (/No calls with transcript text matched this selection/i.test(String(error.message || ""))) {
        skipped.push({ goal, reason: "already_evaluated_or_no_longer_eligible", callCount: callIds.length });
      } else {
        errors.push({ goal, error: String(error.message || error).slice(0, 1000) });
      }
    }
  }

  const timestamp = new Date().toISOString();
  const routing = {
    schemaVersion: "sales_dashboard_foundation_specialist_routing.v1",
    status: errors.length ? "completed_with_errors" : "completed",
    parentRunId: foundationRun.id,
    foundationResultCount: foundationResults.length,
    requestedChecks: FOUNDATION_SPECIALIST_GOALS.reduce((total, goal) => total + (routeCallIds.get(goal) || []).length, 0),
    childRuns,
    skipped,
    errors,
    completedAt: timestamp
  };
  const updated = updateStoredEvaluationRun(foundationRun.id, {
    specialistRouting: routing,
    runHistory: [
      ...(foundationRun.runHistory || []),
      evaluationStudioRunHistoryEvent(foundationRun, "route_specialists", {
        timestamp,
        note: `Foundation routing created or reused ${childRuns.length} specialist runs.`,
        metadata: {
          requestedChecks: routing.requestedChecks,
          childRunCount: childRuns.length,
          skippedCount: skipped.length,
          errorCount: errors.length
        }
      })
    ].slice(-200)
  }, { storePath });
  return { routed: true, routing, evaluationRun: updated.run, store: updated.store };
}

async function harvestEvaluationStudioRunJobs(runId, options = {}) {
  const { storePath, aiConfig, fetchImpl, analysis = null } = options;
  const maxJobs = Number.isFinite(Number(options.maxJobs))
    ? Math.max(1, Math.floor(Number(options.maxJobs)))
    : Number.POSITIVE_INFINITY;
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
  const jobUpdates = new Map();
  const aiJobReferences = [];
  const resultCandidates = [];
  const jobsToProcess = jobs.filter((job) => {
    if (job.resultId) return false;
    if (job.terminalHandledAt && aiJobIsFailed(job.status) && !evaluationStudioSemanticFailureCanRetry(run, job)) return false;
    return true;
  }).slice(0, maxJobs);
  const processJobIds = new Set(jobsToProcess.map((job) => job.jobId));

  for (const jobRef of jobs) {
    if (jobRef.resultId) {
      jobUpdates.set(jobRef.jobId, jobRef);
      continue;
    }
    if (jobRef.terminalHandledAt && aiJobIsFailed(jobRef.status) && !evaluationStudioSemanticFailureCanRetry(run, jobRef)) {
      failed.push({
        callId: jobRef.callId,
        jobId: jobRef.jobId,
        status: jobRef.status,
        error: jobRef.error || "Terminal Evaluation Studio failure already handled.",
        category: jobRef.terminalFailureCategory || "execution_failed",
        alreadyHandled: true
      });
      jobUpdates.set(jobRef.jobId, jobRef);
      continue;
    }
    if (!processJobIds.has(jobRef.jobId)) {
      jobUpdates.set(jobRef.jobId, jobRef);
      continue;
    }
    const recoveringSemanticFailure = evaluationStudioSemanticFailureCanRetry(run, jobRef);
    const validationCall = analysis ? findCallProof(analysis, jobRef.callId) : null;
    if (recoveringSemanticFailure && !String(validationCall?.transcript || "").trim()) {
      errors.push({
        callId: jobRef.callId,
        jobId: jobRef.jobId,
        error: "Recovery requires the current source transcript to verify an exact evidence excerpt."
      });
      jobUpdates.set(jobRef.jobId, {
        ...jobRef,
        lastHarvestError: "Recovery deferred until the source transcript is available.",
        lastCheckedAt: timestamp
      });
      continue;
    }
    const currentAiJob = (store.aiJobs || []).find((job) =>
      job.importId === run.importId && job.callId === jobRef.callId && job.jobId === jobRef.jobId
    ) || {};
    let resolvedStatus = "";
    try {
      const job = await getAiJob(jobRef.jobId, { config: aiConfig, fetchImpl });
      const status = aiJobStatus(job) || jobRef.status || currentAiJob.status || "queued";
      resolvedStatus = status;
      aiJobReferences.push({
        ...currentAiJob,
        importId: run.importId,
        callId: jobRef.callId,
        jobId: jobRef.jobId,
        taskType: currentAiJob.taskType || jobRef.taskType || EVALUATION_STUDIO_TASK_TYPE,
        status,
        metadata: evaluationStudioAiJobMetadata(currentAiJob, run, jobRef)
      });

      if (aiJobIsDone(status)) {
        const alreadyStored = existingEvaluationStudioJobResult(store, run.id, jobRef.callId, jobRef.jobId);
        if (!alreadyStored) {
          resultCandidates.push({
            jobRef,
            status,
            recoveringSemanticFailure,
            input: {
            importId: run.importId,
            runId: run.id,
            templateId: run.templateId,
            jobId: jobRef.jobId,
            callId: jobRef.callId,
            ...evaluationExecutionAudit(job),
            result: aiJobResultPayload(job),
            validationContext: {
              call: validationCall
            }
            }
          });
          continue;
        }
        completed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status,
          resultId: alreadyStored.id,
          alreadyStored: true
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: "completed",
          resultId: alreadyStored.id,
          harvestedAt: timestamp,
          recoveredAt: evaluationStudioSemanticFailureCanRetry(run, jobRef) ? timestamp : jobRef.recoveredAt,
          error: "",
          terminalFailureCategory: "",
          terminalHandledAt: "",
          semanticValidationRevision: evaluationStudioSemanticValidationRevision(run)
        });
      } else if (aiJobIsFailed(status)) {
        const reason = evaluationStudioJobError(job) || "Local AI job failed.";
        failed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status,
          error: reason
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: "failed",
          error: reason,
          terminalFailureCategory: "execution_failed",
          semanticValidationRevision: evaluationStudioSemanticValidationRevision(run),
          terminalHandledAt: timestamp,
          harvestedAt: timestamp
        });
      } else {
        pending.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status,
          lastCheckedAt: timestamp
        });
      }
    } catch (error) {
      const terminalFailure = evaluationStudioTerminalHarvestFailure(error, resolvedStatus);
      if (terminalFailure) {
        failed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status: "failed",
          error: terminalFailure.error,
          category: terminalFailure.category
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: "failed",
          error: terminalFailure.error,
          terminalFailureCategory: terminalFailure.category,
          semanticValidationRevision: evaluationStudioSemanticValidationRevision(run),
          terminalHandledAt: timestamp,
          harvestedAt: timestamp
        });
      } else {
        errors.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          error: error.message
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: jobRef.status || "queued",
          lastHarvestError: error.message,
          lastCheckedAt: timestamp
        });
      }
    }
  }

  if (aiJobReferences.length || resultCandidates.length) {
    const persisted = saveEvaluationHarvestBatch({
      aiJobs: aiJobReferences,
      evaluationResults: resultCandidates.map((candidate) => candidate.input)
    }, { storePath });
    store = persisted.store;
    const savedByJobId = new Map(persisted.results.map((item) => [item.jobId, item]));
    const errorByJobId = new Map(persisted.resultErrors.map((item) => [item.jobId, item]));
    for (const candidate of resultCandidates) {
      const { jobRef, status, recoveringSemanticFailure } = candidate;
      const saved = savedByJobId.get(jobRef.jobId);
      if (saved?.result) {
        completed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status,
          resultId: saved.result.id,
          alreadyStored: saved.alreadyStored
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: "completed",
          resultId: saved.result.id,
          harvestedAt: timestamp,
          recoveredAt: recoveringSemanticFailure ? timestamp : jobRef.recoveredAt,
          error: "",
          terminalFailureCategory: "",
          terminalHandledAt: "",
          semanticValidationRevision: evaluationStudioSemanticValidationRevision(run)
        });
        continue;
      }
      const resultError = errorByJobId.get(jobRef.jobId);
      const error = resultError?.error || Object.assign(new Error(resultError?.message || "Evaluation result could not be stored."), {
        statusCode: resultError?.statusCode || 0
      });
      const terminalFailure = evaluationStudioTerminalHarvestFailure(error, status);
      if (terminalFailure) {
        failed.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          status: "failed",
          error: terminalFailure.error,
          category: terminalFailure.category
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: "failed",
          error: terminalFailure.error,
          terminalFailureCategory: terminalFailure.category,
          semanticValidationRevision: evaluationStudioSemanticValidationRevision(run),
          terminalHandledAt: timestamp,
          harvestedAt: timestamp
        });
      } else {
        errors.push({
          callId: jobRef.callId,
          jobId: jobRef.jobId,
          error: String(error?.message || error)
        });
        jobUpdates.set(jobRef.jobId, {
          ...jobRef,
          status: jobRef.status || "queued",
          lastHarvestError: String(error?.message || error),
          lastCheckedAt: timestamp
        });
      }
    }
  }

  const updatedJobs = jobs.map((job) => jobUpdates.get(job.jobId) || job);

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
  const completedAt = ["completed", "failed", "partially_completed"].includes(nextStatus) && !latestRun.completedAt
    ? timestamp
    : latestRun.completedAt;
  const harvestKey = evaluationStudioHarvestKey(updatedJobs);
  const duplicateHarvest = (latestRun.runHistory || []).some((item) => item?.metadata?.harvestKey === harvestKey);
  const event = evaluationStudioRunHistoryEvent(latestRun, "harvest", {
    timestamp,
    newStatus: nextStatus,
    note: `Harvest checked ${processJobIds.size} of ${jobs.length} local Evaluation Studio jobs.`,
    metadata: {
      completed: completed.length,
      pending: pending.length,
      failed: failed.length,
      errors: errors.length,
      harvestKey
    }
  });
  const completedJobIds = new Set(updatedJobs.filter((job) => aiJobIsDone(job.status)).map((job) => job.jobId));
  const mergedErrors = dedupeEvaluationStudioErrors([
    ...(Array.isArray(latestRun.errors) ? latestRun.errors : []).filter((item) => !completedJobIds.has(item.jobId)),
    ...failed.filter((item) => !item.alreadyHandled).map((item) => ({
      callId: item.callId,
      jobId: item.jobId,
      category: item.category || "execution_failed",
      error: item.error
    })),
    ...errors
  ]).slice(-200);
  let updatedRun = updateStoredEvaluationRun(run.id, {
    status: nextStatus,
    completedAt,
    queuedJobCount: pendingJobCount,
    completedCallCount,
    failedCallCount,
    queuedJobs: updatedJobs,
    errors: mergedErrors,
    runHistory: duplicateHarvest
      ? latestRun.runHistory
      : [...(Array.isArray(latestRun.runHistory) ? latestRun.runHistory : []), event].slice(-200)
  }, { storePath });

  const foundationRoutingReady = updatedRun.run.templateSnapshot?.evaluationGoal === CALL_INTELLIGENCE_FOUNDATION_GOAL
    && updatedRun.run.callSelection?.autoRouteSpecialists
    && pendingJobCount === 0
    && completedCallCount > 0;
  if (foundationRoutingReady) {
    const routed = await routeFoundationRunSpecialists(updatedRun.run.id, {
      storePath,
      aiConfig,
      fetchImpl,
      analysis
    });
    if (routed.evaluationRun) {
      updatedRun = {
        run: routed.evaluationRun,
        store: routed.store
      };
    }
  }

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
  if (!["prompt_test", "batch"].includes(run.runType)) return false;
  if (!["queued", "running", "partially_completed"].includes(status)) return false;
  if (currentImportId && run.importId !== currentImportId) return false;
  if (!jobs.length) return false;
  return jobs.some((job) => {
    const jobId = String(job.jobId || job.job_id || "").trim();
    if (!jobId || job.resultId) return false;
    return !(aiJobIsFailed(job.status) && job.terminalHandledAt)
      || evaluationStudioSemanticFailureCanRetry(run, job);
  });
}

async function autoHarvestEvaluationStudioRuns(options = {}) {
  const {
    storePath,
    aiConfig,
    fetchImpl,
    currentImportId = null,
    analysis = null,
    maxRuns = EVALUATION_STUDIO_AUTO_HARVEST_MAX_RUNS,
    maxJobs = EVALUATION_STUDIO_AUTO_HARVEST_MAX_JOBS
  } = options;
  let store = readStore({ storePath });
  const capabilityPolicy = localModelCapabilitySummary();
  if (!capabilityPolicy.liveSubmissionPermitted || !capabilityPolicy.operationalConsumptionPermitted) {
    return {
      checkedRunCount: 0,
      harvested: [],
      errors: [],
      disabled: true,
      disabledReason: "No exact local-model capability is promoted for submission and operational consumption.",
      capabilityPolicy,
      store
    };
  }
  if (!analysis || !Array.isArray(analysis.drilldownRows)) {
    return {
      checkedRunCount: 0,
      harvested: [],
      errors: [],
      store
    };
  }
  const studio = normalizeEvaluationStudio(store.evaluationStudio);
  const candidates = (studio.evaluationRuns || [])
    .filter((run) => evaluationStudioAutoHarvestCandidate(run, currentImportId))
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, Math.max(0, Number(maxRuns) || 0));
  const harvested = [];
  const errors = [];

  for (const run of candidates) {
    try {
      const result = await harvestEvaluationStudioRunJobs(run.id, {
        storePath,
        aiConfig,
        fetchImpl,
        analysis,
        maxJobs: Math.max(1, Number(maxJobs) || 1)
      });
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

function publicAutoHarvestStatus(autoHarvest = {}) {
  return {
    disabled: autoHarvest.disabled === true,
    disabledReason: autoHarvest.disabledReason || "",
    checkedRunCount: Number(autoHarvest.checkedRunCount || 0),
    harvested: autoHarvest.harvested || [],
    errors: autoHarvest.errors || [],
    capabilityPolicy: autoHarvest.capabilityPolicy || localModelCapabilitySummary()
  };
}

function createServer(options = {}) {
  const env = options.env || process.env;
  const csvPath = options.csvPath || resolveCsvPath(options.argv || process.argv.slice(2), env);
  const allocationPath = options.allocationPath || resolveAllocationPath(options.argv || process.argv.slice(2), env);
  const voicemailPilotPath = options.voicemailPilotPath || resolveVoicemailPilotPath(options.argv || process.argv.slice(2), env);
  const storePath = resolveStorePath(options);
  const aiConfig = resolveAiExecutionConfig(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let state = loadAnalysis(csvPath, { storePath, allocationPath });
  let voicemailPilot = loadVoicemailPilotAttribution(voicemailPilotPath, state.analysis?.drilldownRows || []);

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    const evaluationStudioMutation = !["GET", "HEAD"].includes(request.method)
      && (url.pathname.startsWith("/api/evaluation-studio/") || url.pathname.startsWith("/evaluation-studio/"));
    const permittedReadOnlyStudioPost = request.method === "POST"
      && url.pathname === "/api/evaluation-studio/selection-preview";
    const permittedValidationLabMutation = request.method === "POST" && (
      url.pathname === "/evaluation-studio/validation-lab/manifests"
      || /^\/evaluation-studio\/validation-lab\/manifests\/[^/]+\/(?:labels|freeze)$/.test(url.pathname)
    );
    const retiredStudioResultIngestion = request.method === "POST"
      && url.pathname === "/api/evaluation-studio/results";
    if (evaluationStudioMutation && !permittedReadOnlyStudioPost && !permittedValidationLabMutation && !retiredStudioResultIngestion) {
      sendJson(response, 423, {
        ok: false,
        error: "Evaluation Studio is a read-only research archive while no local-model capability is promoted.",
        code: "EVALUATION_STUDIO_RESEARCH_ARCHIVE_LOCKED",
        researchOnly: true,
        authority: "none",
        capabilityPolicy: localModelCapabilitySummary()
      });
      return;
    }

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
        voicemail_pilot_path_configured: Boolean(voicemailPilotPath),
        voicemail_pilot_status: voicemailPilot.status,
        voicemail_pilot_input_rows: voicemailPilot.totals?.inputRows || 0,
        voicemail_pilot_accepted_assignments: voicemailPilot.totals?.acceptedAssignments || 0,
        voicemail_pilot_rejected_assignments: voicemailPilot.totals?.rejectedAssignments || 0,
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

    if (url.pathname === "/api/local-model-capabilities" && request.method === "GET") {
      try {
        sendJson(response, 200, { ok: true, capabilityPolicy: localModelCapabilitySummary() });
      } catch (error) {
        sendJson(response, 503, { ok: false, error: error.message, liveSubmissionPermitted: false, operationalConsumptionPermitted: false });
      }
      return;
    }

    if (url.pathname === "/api/summary") {
      sendJson(response, 200, publicAnalysis(analysisForRequest(state, url, storePath)));
      return;
    }

    if (url.pathname === "/api/sales-opportunities" && request.method === "GET") {
      const { analysis, centre } = salesOpportunityActionCentreForRequest(state, url, storePath);
      const selected = filterSalesOpportunityRecords(centre, Object.fromEntries(url.searchParams.entries()));
      sendJson(response, 200, {
        ...centre,
        records: selected.records,
        query: selected.query,
        filterState: analysis.filterState || null,
        filterSummary: analysis.filterSummary || null
      });
      return;
    }

    if (url.pathname === "/api/sales-opportunities/brief" && request.method === "GET") {
      const { centre } = salesOpportunityActionCentreForRequest(state, url, storePath);
      const report = buildSalesOpportunityManagementBrief(centre, { baseUrl: `http://${request.headers.host || "127.0.0.1:3040"}` });
      if (url.searchParams.get("format") === "markdown") {
        response.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"sales-opportunity-action-centre-current.md\"",
          "Cache-Control": "no-store"
        });
        response.end(report.content);
      } else {
        sendJson(response, 200, { report });
      }
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
      sendJson(response, 410, {
        ok: false,
        status: "retired",
        error: "Lead Harvest automation is retired because its deterministic semantic rules failed the frozen accuracy audit.",
        permittedAlternative: "/api/lead-reattempts exposes neutral stable-ID activity and restricted literal no-contact facts only."
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
        .find((item) => (item.id === alertId || item.alertId === alertId) && !item.parkedDataRelated && !alertContainsUntrustedLegacyData(item) && (!state.importRecord?.id || item.importId === state.importRecord.id));
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
      sendJson(response, 410, {
        ok: false,
        error: "Legacy transcript intelligence is retired. It truncated transcripts and emitted uncalibrated semantic scores.",
        code: "LEGACY_LOCAL_MODEL_EVALUATOR_RETIRED"
      });
      return;
    }

    if (url.pathname === "/api/intelligence/llm-harvest" && request.method === "POST") {
      sendJson(response, 410, {
        ok: false,
        error: "Legacy local-model intelligence harvesting is retired. Historical payloads remain research-only.",
        code: "LEGACY_LOCAL_MODEL_EVALUATOR_RETIRED"
      });
      return;
    }

    if (url.pathname === "/api/intelligence/llm-results" && request.method === "POST") {
      sendJson(response, 410, {
        ok: false,
        error: "Legacy local-model intelligence result ingestion is retired. Historical payloads remain research-only.",
        code: "LEGACY_LOCAL_MODEL_EVALUATOR_RETIRED"
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/progress" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null,
        analysis: state.analysis,
        maxRuns: 5,
        maxJobs: 10
      });
      if (autoHarvest.harvested.length) {
        state.analysis = attachPersistence(state.analysis, autoHarvest.store, state.importRecord?.id || null);
      }
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      const currentImportId = state.importRecord?.id || null;
      const evaluationRuns = (studio.evaluationRuns || [])
        .filter((run) => !run.containsUntrustedLegacyData && (!currentImportId || run.importId === currentImportId))
        .map((run) => ({
          id: run.id,
          status: run.status,
          completedCallCount: Number(run.completedCallCount || 0),
          failedCallCount: Number(run.failedCallCount || 0),
          queuedJobCount: Number(run.queuedJobCount || 0),
          updatedAt: run.updatedAt || run.createdAt || "",
          hasPendingJobs: evaluationStudioAutoHarvestCandidate(run, currentImportId)
        }));
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_progress.v1",
        evaluationRuns,
        autoHarvest: publicAutoHarvestStatus(autoHarvest)
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null,
        analysis: state.analysis
      });
      const store = autoHarvest.store || readStore({ storePath });
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      const payload = evaluationStudioApiPayload(store, state.importRecord?.id || null, {
        includeArchived: url.searchParams.get("includeArchived"),
        category: url.searchParams.get("category"),
        tag: url.searchParams.get("tag"),
        runId: url.searchParams.get("runId") || url.searchParams.get("evaluationRunId"),
        evaluationGoal: url.searchParams.get("evaluationGoal") || url.searchParams.get("goal"),
        currentOnly: url.searchParams.get("currentOnly"),
        callIds,
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset"),
        resultStatus: url.searchParams.get("resultStatus") || url.searchParams.get("status"),
        recordClassification: url.searchParams.get("recordClassification"),
        recordReason: url.searchParams.get("recordReason"),
        operationalClassification: url.searchParams.get("operationalClassification"),
        recommendation: url.searchParams.get("recommendation"),
        allegationAssessment: url.searchParams.get("allegationAssessment"),
        reportSignal: url.searchParams.get("reportSignal"),
        acceptanceClassification: url.searchParams.get("acceptanceClassification"),
        foundationOpportunityStatus: url.searchParams.get("foundationOpportunityStatus"),
        foundationMeasurementEligibility: url.searchParams.get("foundationMeasurementEligibility"),
        foundationEfficiencyStatus: url.searchParams.get("foundationEfficiencyStatus"),
        foundationCalledOnBehalfOf: url.searchParams.get("foundationCalledOnBehalfOf"),
        foundationFollowUpTiming: url.searchParams.get("foundationFollowUpTiming"),
        foundationSpecialistRoute: url.searchParams.get("foundationSpecialistRoute"),
        foundationOfferPresented: url.searchParams.get("foundationOfferPresented"),
        foundationQuotedAmountAvailable: url.searchParams.get("foundationQuotedAmountAvailable"),
        spielCallHandlingQuality: url.searchParams.get("spielCallHandlingQuality"),
        spielSpielQuality: url.searchParams.get("spielSpielQuality"),
        spielCallPurpose: url.searchParams.get("spielCallPurpose"),
        spielPrimaryReasonCode: url.searchParams.get("spielPrimaryReasonCode"),
        confidenceBand: url.searchParams.get("confidenceBand"),
        evidenceAvailability: url.searchParams.get("evidenceAvailability"),
        reviewRecommended: url.searchParams.get("reviewRecommended") || url.searchParams.get("reviewOnly"),
        overnightAutomation: evaluationStudioOvernightStatus(storePath),
        calls: state.analysis?.drilldownRows || []
      });
      const validation = readValidationLab({ storePath });
      sendJson(response, 200, {
        ...payload,
        autoHarvest: publicAutoHarvestStatus(autoHarvest),
        capabilityCatalog: localModelCapabilityCatalog(),
        validationLab: { ...validationLabView(validation.lab, state.analysis?.drilldownRows || []), readError: validation.error },
        voicemailInbound: buildVoicemailInboundReport(state.analysis?.drilldownRows || []),
        voicemailPilot
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/validation-lab" && request.method === "GET") {
      const validation = readValidationLab({ storePath });
      sendJson(response, validation.error ? 503 : 200, {
        ok: !validation.error,
        validationLab: { ...validationLabView(validation.lab, state.analysis?.drilldownRows || []), readError: validation.error },
        capabilityCatalog: localModelCapabilityCatalog(),
        voicemailInbound: buildVoicemailInboundReport(state.analysis?.drilldownRows || []),
        voicemailPilot
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
        const result = saveEvaluationKnowledgebaseEntry({
          ...body,
          approvalStatus: body.approvalStatus || body.approval_status || "approved_current"
        }, { storePath });
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
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: url.searchParams.get("importId") || state.importRecord?.id || null,
        analysis: state.analysis
      });
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_runs_api.v1",
        autoHarvest: publicAutoHarvestStatus(autoHarvest),
        evaluationRuns: (studio.evaluationRuns || [])
          .filter((run) => !run.containsUntrustedLegacyData && (!url.searchParams.get("importId") || run.importId === url.searchParams.get("importId")))
          .slice()
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          .map(sanitizeUntrustedLegacyDataForPublic)
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/selection-preview" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const body = await readJsonBody(request);
        const store = readStore({ storePath });
        const studio = normalizeEvaluationStudio(store.evaluationStudio);
        const calls = selectEvaluationBatchCalls(
          state.analysis.drilldownRows || [],
          body,
          studio,
          body.importId || state.importRecord.id
        );
        sendJson(response, 200, {
          ok: true,
          matchingCalls: calls.length,
          preview: calls.slice(0, 8).map((call) => ({
            callId: call.callId,
            sourceTime: call.sourceTime,
            salesperson: call.salesperson,
            source: call.source,
            businessSegment: call.businessSegment,
            contactClassification: call.contactClassification,
            transcriptQuality: call.transcriptQuality,
            durationSeconds: call.durationSeconds
          }))
        });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/specialist-recovery" && request.method === "GET") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const capabilityPolicy = localModelCapabilitySummary();
        if (!capabilityPolicy.operationalConsumptionPermitted || !capabilityPolicy.liveSubmissionPermitted) {
          sendJson(response, 200, {
            ok: true,
            blocked: true,
            blocker: "No Foundation or specialist capability is independently promoted for submission and operational consumption.",
            capabilityPolicy,
            backlog: { totalChecks: 0, totalCalls: 0, byGoal: [], researchInventoryExcluded: true },
            nextBatch: null
          });
          return;
        }
        const store = readStore({ storePath });
        const importId = url.searchParams.get("importId") || state.importRecord.id;
        const availableCallIds = new Set((state.analysis.drilldownRows || [])
          .filter((call) => String(call.transcript || "").trim())
          .map((call) => String(call.callId || "").trim())
          .filter(Boolean));
        const backlog = buildTypedSpecialistRecoveryBacklog(store.evaluationStudio, { importId, availableCallIds });
        const batchSize = normalizeLimit(url.searchParams.get("limit"), 100, 250);
        sendJson(response, 200, {
          ok: true,
          backlog,
          nextBatch: selectTypedSpecialistRecoveryBatch(backlog, batchSize)
        });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/runs" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) {
          sendJson(response, 400, { ok: false, error: "No current import is loaded." });
          return;
        }
        const body = await readJsonBody(request);
        const result = await createEvaluationBatchRun(body, { state, storePath, aiConfig, fetchImpl });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, result.submitted ? 202 : 201, {
          ok: true,
          evaluationRun: result.evaluationRun,
          submitted: result.submitted,
          plannedCallCount: result.calls.length,
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/runs/") && url.pathname.endsWith("/harvest") && request.method === "POST") {
      try {
        const capabilityPolicy = localModelCapabilitySummary();
        if (!capabilityPolicy.operationalConsumptionPermitted) {
          throw capabilityQuarantineError({
            capabilityId: "evaluation_run_harvest",
            reason: "no_promoted_operational_capability",
            ...capabilityPolicy
          });
        }
        const runId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/runs/".length, -"/harvest".length));
        const result = await harvestEvaluationStudioRunJobs(runId, {
          storePath,
          aiConfig,
          fetchImpl,
          analysis: state.analysis
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
        const capabilityPolicy = localModelCapabilitySummary();
        if (!capabilityPolicy.liveSubmissionPermitted) {
          throw capabilityQuarantineError({
            capabilityId: "evaluation_run_resume",
            reason: "no_promoted_submission_capability",
            ...capabilityPolicy
          });
        }
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
          taskInput: body.includeTaskInput === false ? null : stripTrustedClaimContextForPublic(result.taskInput),
          executionLayerResponse: stripTrustedClaimContextForPublic(result.executionLayerResponse),
          persistence: dashboardPersistence(result.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/evaluation-studio/report-rollups" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null,
        analysis: state.analysis
      });
      const store = autoHarvest.store || readStore({ storePath });
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      const importId = url.searchParams.get("importId") || (truthy(url.searchParams.get("currentOnly")) ? state.importRecord?.id : "");
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_report_rollups_api.v1",
        autoHarvest: publicAutoHarvestStatus(autoHarvest),
        reportRollups: buildEvaluationStudioReportRollups(studio, { importId: importId || "", callIds }),
        foundationReport: buildCallIntelligenceFoundationReport(studio, {
          importId: importId || state.importRecord?.id || "",
          callIds,
          calls: state.analysis?.drilldownRows || []
        }),
        offerAcceptanceReport: buildOfferAcceptanceReport(studio, {
          importId: importId || state.importRecord?.id || "",
          callIds,
          calls: state.analysis?.drilldownRows || []
        })
      });
      return;
    }

    if (url.pathname === "/api/evaluation-studio/results" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null,
        analysis: state.analysis
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
        recordClassification: url.searchParams.get("recordClassification"),
        recordReason: url.searchParams.get("recordReason"),
        operationalClassification: url.searchParams.get("operationalClassification"),
        recommendation: url.searchParams.get("recommendation"),
        allegationAssessment: url.searchParams.get("allegationAssessment"),
        reportSignal: url.searchParams.get("reportSignal"),
        acceptanceClassification: url.searchParams.get("acceptanceClassification"),
        foundationOpportunityStatus: url.searchParams.get("foundationOpportunityStatus"),
        foundationMeasurementEligibility: url.searchParams.get("foundationMeasurementEligibility"),
        foundationEfficiencyStatus: url.searchParams.get("foundationEfficiencyStatus"),
        foundationCalledOnBehalfOf: url.searchParams.get("foundationCalledOnBehalfOf"),
        foundationFollowUpTiming: url.searchParams.get("foundationFollowUpTiming"),
        foundationSpecialistRoute: url.searchParams.get("foundationSpecialistRoute"),
        foundationOfferPresented: url.searchParams.get("foundationOfferPresented"),
        foundationQuotedAmountAvailable: url.searchParams.get("foundationQuotedAmountAvailable"),
        spielCallHandlingQuality: url.searchParams.get("spielCallHandlingQuality"),
        spielSpielQuality: url.searchParams.get("spielSpielQuality"),
        spielCallPurpose: url.searchParams.get("spielCallPurpose"),
        spielPrimaryReasonCode: url.searchParams.get("spielPrimaryReasonCode"),
        confidenceBand: url.searchParams.get("confidenceBand"),
        evidenceAvailability: url.searchParams.get("evidenceAvailability"),
        reviewRecommended: url.searchParams.get("reviewRecommended") || url.searchParams.get("reviewOnly"),
        evidenceUnavailableOnly: url.searchParams.get("evidenceUnavailableOnly"),
        includeSuperseded: url.searchParams.get("includeSuperseded")
      });
      const resultCallLookup = new Map((state.analysis?.drilldownRows || []).map((call) => [String(call.callId || call.call_id || "").trim(), call]));
      const visibleResults = attachFoundationContextToResults(
        studio,
        results.slice(offset, offset + limit),
        state.analysis?.drilldownRows || []
      ).map((result) => {
        const call = resultCallLookup.get(String(result.callId || "").trim()) || {};
        const customerId = String(call.customerId || call.customer_id || result.customerId || "").trim() || "Not available";
        return {
          ...result,
          customerId,
          callContext: {
            callId: result.callId,
            customerId,
            salesperson: call.salesperson || "",
            source: call.source || call.customerImportSource || "",
            date: call.date || call.callDate || "",
            time: call.time || call.callTime || "",
            sourceTime: call.sourceTime || ""
          }
        };
      });
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_evaluation_studio_results_api.v1",
        autoHarvest: publicAutoHarvestStatus(autoHarvest),
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
      sendJson(response, 410, {
        ok: false,
        error: "Direct Evaluation Studio result ingestion is retired. Results may enter the archive only through a server-verified Execution Layer harvest under an exact promoted capability contract.",
        researchArchivePreserved: true
      });
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
        if (!isOperationalEvaluationResult(evaluationResult)) {
          throw capabilityQuarantineError({
            capabilityId: evaluationResult.localModelCapability?.capabilityId || evaluationResult.evaluationGoal || "unknown",
            reason: "research_only_result_cannot_create_manager_work",
            resultId: evaluationResult.id
          });
        }
        const review = saveManagerReview(buildManagerReviewFromEvaluationResult(evaluationResult, {
          ...body,
          importId: body.importId || evaluationResult.importId || state.importRecord?.id || "current"
        }), { storePath });
        state.analysis = attachPersistence(state.analysis, review.store, state.importRecord?.id || null);
        sendJson(response, 201, {
          ok: true,
          evaluationResult: sanitizeUntrustedLegacyDataForPublic(evaluationResult),
          review: sanitizeManagerReviewForPublic(review.review),
          persistence: dashboardPersistence(review.store, state.importRecord?.id || null)
        });
      } catch (error) {
        sendJson(response, error.statusCode || error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname.startsWith("/api/evaluation-studio/results/") && url.pathname.endsWith("/semantic-feedback") && request.method === "POST") {
      try {
        const resultId = decodeURIComponent(url.pathname.slice("/api/evaluation-studio/results/".length, -"/semantic-feedback".length));
        const body = await readJsonBody(request);
        const store = readStore({ storePath });
        const evaluationResult = findEvaluationStudioResult(store, resultId, body.importId || state.importRecord?.id || "");
        if (!evaluationResult) {
          sendJson(response, 404, { ok: false, error: "Evaluation Studio result not found." });
          return;
        }
        if (!evaluationResult.jobId) {
          sendJson(response, 400, { ok: false, error: "This historical result has no Execution Layer job ID." });
          return;
        }
        const feedback = await recordAiJobFeedback(evaluationResult.jobId, {
          label: body.label,
          notes: body.notes,
          metadata: {
            source_system: "sales_dashboard",
            source_type: "semantic_audit",
            evaluation_result_id: evaluationResult.id,
            evaluation_goal: evaluationResult.evaluationGoal,
            expected_decision: body.expectedDecision || null,
            actual_decision: body.actualDecision || null,
            evidence_relevance: body.evidenceRelevance || null,
            failure_type: body.failureType || null,
            promotion_outcome: body.promotionOutcome || null
          }
        }, { config: aiConfig, fetchImpl });
        sendJson(response, 201, { ok: true, evaluationResultId: evaluationResult.id, jobId: evaluationResult.jobId, feedback });
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
        reviews: reviews.filter((review) => !managerReviewContainsUntrustedLegacyData(review)).map(sanitizeManagerReviewForPublic)
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
      sendJson(response, 410, {
        ok: false,
        error: "The generic transcript-evaluation route is retired because it has no promoted capability or valid task binding.",
        code: "GENERIC_LOCAL_MODEL_ROUTE_RETIRED"
      });
      return;
    }

    if (url.pathname.startsWith("/api/ai/jobs/") && request.method === "GET") {
      try {
        const jobId = decodeURIComponent(url.pathname.replace("/api/ai/jobs/", ""));
        const job = await getAiJob(jobId, { config: aiConfig, fetchImpl });
        sendJson(response, 200, {
          ok: true,
          researchOnly: true,
          authority: "none",
          warning: "Historical execution evidence only. This response cannot drive any dashboard metric, queue, customer action, or staff judgement.",
          job: stripTrustedClaimContextForPublic(job)
        });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
      return;
    }

    if (url.pathname === "/api/imports") {
      const store = readStore({ storePath });
      sendJson(response, 200, {
        imports: store.imports.map(sanitizeImportSummary),
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
        if (managerReviewContainsUntrustedLegacyData(review)) return false;
        if (importId && review.importId !== importId) return false;
        if (callId && review.callId !== callId) return false;
        if (alertId && review.alertId !== alertId) return false;
        if (status && review.reviewStatus !== status) return false;
        if (scope && review.reviewScope !== scope) return false;
        return true;
      });
      sendJson(response, 200, {
        schemaVersion: "sales_dashboard_manager_reviews_api.v1",
        reviews: reviews.map(sanitizeManagerReviewForPublic),
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
        sendJson(response, 201, { ok: true, review: sanitizeManagerReviewForPublic(result.review), persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
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
          reviews: result.reviews.map(sanitizeManagerReviewForPublic),
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
      if (!review || managerReviewContainsUntrustedLegacyData(review) || (state.importRecord?.id && review.importId !== state.importRecord.id)) {
        sendJson(response, 404, { ok: false, error: "Manager review not found" });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        reviewId,
        reviewStatus: review.reviewStatus,
        reviewHistory: review.reviewHistory || [],
          corrections: sanitizeManagerReviewForPublic(review).corrections
      });
      return;
    }

    if (url.pathname.startsWith("/api/manager-reviews/") && request.method === "GET") {
      const reviewId = decodeURIComponent(url.pathname.replace("/api/manager-reviews/", ""));
      const store = readStore({ storePath });
      const review = (store.managerReviews || [])
        .map(normalizeManagerReview)
        .find((item) => item.reviewId === reviewId || item.id === reviewId);
      if (!review || managerReviewContainsUntrustedLegacyData(review) || (state.importRecord?.id && review.importId !== state.importRecord.id)) {
        sendJson(response, 404, { ok: false, error: "Manager review not found" });
        return;
      }
      sendJson(response, 200, { ok: true, review: sanitizeManagerReviewForPublic(review) });
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
        sendJson(response, 200, { ok: true, review: sanitizeManagerReviewForPublic(result.review), persistence: dashboardPersistence(result.store, state.importRecord?.id || null) });
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
        sendJson(response, 201, { ok: true, review: sanitizeManagerReviewForPublic(result.review) });
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
        const id = form.get("id") || "";
        const result = saveEvaluationKnowledgebaseEntry({
          id,
          title: form.get("title") || "",
          category: form.get("category") || "general",
          tags: form.get("tags") || "",
          content: form.get("content") || "",
          approvalStatus: form.get("approvalStatus") || "approved_current",
          approvalNote: form.get("approvalNote") || "",
          ...(!id ? {
            sourceProject: "Sales Dashboard",
            sourceReference: "manager_entered"
          } : {})
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
          knowledgebaseIds: form.get("knowledgebaseIds") || "",
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
          salesperson: form.get("salesperson") || "",
          source: form.get("source") || "",
          contactClassification: form.get("contactClassification") || "",
          transcriptQuality: form.get("transcriptQuality") || "",
          dateFrom: form.get("dateFrom") || "",
          dateTo: form.get("dateTo") || "",
          minDuration: form.get("minDuration") || 0,
          maxDuration: form.get("maxDuration") || 0,
          selectionMode: form.get("selectionMode") || "newest",
          evaluationState: form.get("evaluationState") || "unevaluated",
          callIds: form.get("callIds") || "",
          search: form.get("search") || "",
          randomSeed: form.get("randomSeed") || "sales-dashboard-local-sample",
          limit: form.get("limit") || 100,
          submitNow: form.get("submitNow") || "true",
          autoRouteSpecialists: form.get("autoRouteSpecialists") || "false",
          callSelection: { sourceType: "evaluation_studio_form" }
        };
        const result = await createEvaluationBatchRun(body, { state, storePath, aiConfig, fetchImpl });
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        response.writeHead(303, { Location: `/evaluation-studio?runId=${encodeURIComponent(result.evaluationRun.id)}#runs` });
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
          fetchImpl,
          analysis: state.analysis
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
        const capabilityPolicy = localModelCapabilitySummary();
        if (!capabilityPolicy.liveSubmissionPermitted) {
          throw capabilityQuarantineError({
            capabilityId: "evaluation_run_resume",
            reason: "no_promoted_submission_capability",
            ...capabilityPolicy
          });
        }
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
      sendJson(response, 410, {
        ok: false,
        error: "The generic call-page local-model action is retired. No promoted capability exists.",
        code: "GENERIC_LOCAL_MODEL_ROUTE_RETIRED"
      });
      return;
    }

    if (url.pathname === "/api/reload" && request.method === "POST") {
      state = loadAnalysis(csvPath, { storePath, allocationPath });
      voicemailPilot = loadVoicemailPilotAttribution(voicemailPilotPath, state.analysis?.drilldownRows || []);
      sendJson(response, state.error ? 500 : 200, {
        ok: !state.error,
        error: state.error,
        sourceName: state.analysis.sourceName,
        importId: state.importRecord?.id || null
      });
      return;
    }

    if (url.pathname === "/reports/sales-opportunity-action-centre-current" && request.method === "GET") {
      const { centre } = salesOpportunityActionCentreForRequest(state, url, storePath);
      const report = buildSalesOpportunityManagementBrief(centre, { baseUrl: `http://${request.headers.host || "127.0.0.1:3040"}` });
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderReportPage(report, {
        pageKicker: "Evidence-backed management brief",
        backHref: "/?view=opportunities",
        backLabel: "Back to Opportunity Action Centre"
      }));
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

    if (url.pathname.startsWith("/imports/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.replace("/imports/", ""));
      const store = readStore({ storePath });
      const importRecord = store.imports.find((item) => item.id === id);
      response.writeHead(importRecord ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderReportPage(importRecord ? importSnapshotReport(importRecord) : null, {
        pageKicker: "Stored import snapshot",
        backHref: "/?view=records#history",
        backLabel: "Back to Import History"
      }));
      return;
    }

    if (url.pathname === "/manager-reviews" && request.method === "GET") {
      const store = readStore({ storePath });
      const reviews = (store.managerReviews || [])
        .map(normalizeManagerReview)
        .filter((review) => !managerReviewContainsUntrustedLegacyData(review) && (!state.importRecord?.id || review.importId === state.importRecord.id));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderReportPage(managerReviewSnapshotReport(reviews, state.analysis?.drilldownRows || []), {
        pageKicker: "Manager review records",
        backHref: "/?view=reviews#alerts",
        backLabel: "Back to Alerts & Reviews"
      }));
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
      const studio = normalizeEvaluationStudio(store.evaluationStudio);
      const evaluationResults = attachFoundationContextToResults(studio, listEvaluationResults(studio, {
        importId: state.importRecord?.id || "",
        callId
      }), call ? [call] : []).map((result) => ({
        ...result,
        customerId: String(call?.customerId || call?.customer_id || "").trim() || "Not available"
      }));
      response.writeHead(call ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderCallPage(call, {
        callId,
        reviews,
        aiJobs,
        intelligenceAudit,
        evaluationResults,
        aiStatus: publicAiExecutionStatus(aiConfig),
        importId: state.importRecord?.id || null,
        returnTo: url.searchParams.get("returnTo") || `/calls/${encodeURIComponent(callId)}`
      }));
      return;
    }

    if (url.pathname === "/evaluation-studio/validation-lab/manifests" && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) throw new Error("No current import is loaded.");
        const form = await readFormBody(request);
        const validation = readValidationLab({ storePath });
        if (validation.error) {
          const error = new Error(validation.error);
          error.statusCode = 503;
          throw error;
        }
        const store = readStore({ storePath });
        const result = createDraftManifest(validation.lab, Object.fromEntries(form.entries()), {
          calls: state.analysis.drilldownRows || [],
          importId: state.importRecord.id,
          runtimePath: path.resolve(__dirname, "..", "runtime"),
          repositoryPath: path.resolve(__dirname, ".."),
          studio: store.evaluationStudio
        });
        writeValidationLab(result.lab, { storePath });
        response.writeHead(303, { Location: `/evaluation-studio?manifestId=${encodeURIComponent(result.manifest.id)}#validation-lab` });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message, authority: "benchmark_truth_only" });
      }
      return;
    }

    const validationLabelMatch = url.pathname.match(/^\/evaluation-studio\/validation-lab\/manifests\/([^/]+)\/labels$/);
    if (validationLabelMatch && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) throw new Error("No current import is loaded.");
        const manifestId = decodeURIComponent(validationLabelMatch[1]);
        const form = await readFormBody(request);
        const validation = readValidationLab({ storePath });
        if (validation.error) {
          const error = new Error(validation.error);
          error.statusCode = 503;
          throw error;
        }
        const result = saveManifestLabels(validation.lab, manifestId, [{
          callId: form.get("callId"),
          expectedDecision: form.get("expectedDecision"),
          caseType: form.get("caseType"),
          supportStatus: form.get("supportStatus"),
          critical: form.get("critical"),
          controllingReason: form.get("controllingReason"),
          evidenceTurnIndexes: form.getAll("evidenceTurnIndex")
        }], { calls: state.analysis.drilldownRows || [] });
        writeValidationLab(result.lab, { storePath });
        response.writeHead(303, { Location: `/evaluation-studio?manifestId=${encodeURIComponent(manifestId)}#validation-lab` });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message, authority: "benchmark_truth_only" });
      }
      return;
    }

    const validationFreezeMatch = url.pathname.match(/^\/evaluation-studio\/validation-lab\/manifests\/([^/]+)\/freeze$/);
    if (validationFreezeMatch && request.method === "POST") {
      try {
        if (!state.analysis || !state.importRecord?.id) throw new Error("No current import is loaded.");
        const manifestId = decodeURIComponent(validationFreezeMatch[1]);
        const validation = readValidationLab({ storePath });
        if (validation.error) {
          const error = new Error(validation.error);
          error.statusCode = 503;
          throw error;
        }
        const store = readStore({ storePath });
        const result = freezeManifest(validation.lab, manifestId, {
          calls: state.analysis.drilldownRows || [],
          importId: state.importRecord.id,
          runtimePath: path.resolve(__dirname, "..", "runtime"),
          repositoryPath: path.resolve(__dirname, ".."),
          studio: store.evaluationStudio
        });
        writeValidationLab(result.lab, { storePath });
        response.writeHead(303, { Location: `/evaluation-studio?manifestId=${encodeURIComponent(manifestId)}#validation-lab` });
        response.end();
      } catch (error) {
        sendJson(response, error.statusCode || 400, { ok: false, error: error.message, authority: "benchmark_truth_only" });
      }
      return;
    }

    if (url.pathname === "/evaluation-studio" && request.method === "GET") {
      const autoHarvest = await autoHarvestEvaluationStudioRuns({
        storePath,
        aiConfig,
        fetchImpl,
        currentImportId: state.importRecord?.id || null,
        analysis: state.analysis,
        maxRuns: 5,
        maxJobs: 10
      });
      if (autoHarvest.harvested.length) {
        state.analysis = attachPersistence(state.analysis, autoHarvest.store, state.importRecord?.id || null);
      }
      const store = autoHarvest.store || readStore({ storePath });
      const callIds = evaluationStudioCallIdsForRequest(state, url, storePath);
      const resultFilters = {
        runId: url.searchParams.get("runId") || "",
        evaluationGoal: url.searchParams.get("evaluationGoal") || "",
        reportSignal: url.searchParams.get("reportSignal") || "",
        acceptanceClassification: url.searchParams.get("acceptanceClassification") || "",
        foundationOpportunityStatus: url.searchParams.get("foundationOpportunityStatus") || "",
        foundationMeasurementEligibility: url.searchParams.get("foundationMeasurementEligibility") || "",
        foundationEfficiencyStatus: url.searchParams.get("foundationEfficiencyStatus") || "",
        foundationCalledOnBehalfOf: url.searchParams.get("foundationCalledOnBehalfOf") || "",
        foundationFollowUpTiming: url.searchParams.get("foundationFollowUpTiming") || "",
        foundationSpecialistRoute: url.searchParams.get("foundationSpecialistRoute") || "",
        foundationOfferPresented: url.searchParams.get("foundationOfferPresented") || "",
        foundationQuotedAmountAvailable: url.searchParams.get("foundationQuotedAmountAvailable") || "",
        spielCallHandlingQuality: url.searchParams.get("spielCallHandlingQuality") || "",
        spielSpielQuality: url.searchParams.get("spielSpielQuality") || "",
        spielCallPurpose: url.searchParams.get("spielCallPurpose") || "",
        spielPrimaryReasonCode: url.searchParams.get("spielPrimaryReasonCode") || "",
        resultStatus: url.searchParams.get("resultStatus") || "",
        recordClassification: url.searchParams.get("recordClassification") || "",
        recordReason: url.searchParams.get("recordReason") || "",
        operationalClassification: url.searchParams.get("operationalClassification") || "",
        recommendation: url.searchParams.get("recommendation") || "",
        allegationAssessment: url.searchParams.get("allegationAssessment") || "",
        confidenceBand: url.searchParams.get("confidenceBand") || "",
        evidenceAvailability: url.searchParams.get("evidenceAvailability") || "",
        reviewRecommended: url.searchParams.get("reviewRecommended") || "",
        salesperson: url.searchParams.get("salesperson") || "",
        customerImportSource: url.searchParams.get("customerImportSource") || "",
        dateFrom: url.searchParams.get("dateFrom") || "",
        dateTo: url.searchParams.get("dateTo") || "",
        limit: url.searchParams.get("limit") || "25",
        offset: url.searchParams.get("offset") || "0"
      };
      const activeBusinessSegment = url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "";
      const studioAnalysis = analysisForRequest(state, url, storePath);
      const studioView = evaluationStudioApiPayload(store, state.importRecord?.id || null, {
        ...resultFilters,
        currentOnly: true,
        callIds,
        overnightAutomation: evaluationStudioOvernightStatus(storePath),
        calls: studioAnalysis?.drilldownRows || []
      });
      const validation = readValidationLab({ storePath });
      const validationView = {
        ...validationLabView(validation.lab, studioAnalysis?.drilldownRows || []),
        readError: validation.error
      };
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderEvaluationStudioPage(studioAnalysis, {
        businessSegment: activeBusinessSegment,
        studioView,
        resultFilters,
        capabilityPolicy: localModelCapabilitySummary(),
        capabilityCatalog: localModelCapabilityCatalog(),
        validationLab: validationView,
        voicemailInbound: buildVoicemailInboundReport(studioAnalysis?.drilldownRows || []),
        voicemailPilot,
        selectedManifestId: url.searchParams.get("manifestId") || ""
      }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const activeBusinessSegment = url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "";
    const dashboardView = url.searchParams.get("view") || "overview";
    const intelligenceQueue = url.searchParams.get("intelligenceQueue") || "waste";
    let dashboardAnalysis = analysisForRequest(state, url, storePath);
    if (dashboardView === "opportunities") {
      const store = readStore({ storePath });
      const centre = buildSalesOpportunityActionCentre({
        studio: store.evaluationStudio,
        importId: state.importRecord?.id || "",
        calls: dashboardAnalysis.drilldownRows || [],
        leadHarvestRecords: dashboardAnalysis.leadHarvest?.records || []
      });
      const selected = filterSalesOpportunityRecords(centre, {
        opportunityStage: url.searchParams.get("opportunityStage") || "",
        opportunityQueue: url.searchParams.get("opportunityQueue") || "",
        limit: url.searchParams.get("opportunityLimit") || 100,
        offset: url.searchParams.get("opportunityOffset") || 0
      });
      dashboardAnalysis = updateAnalysisPreservingItems(dashboardAnalysis, {
        salesOpportunityActionCentre: {
          ...centre,
          records: selected.records,
          query: selected.query
        }
      });
    }
    const filteredCallIds = new Set((dashboardAnalysis.drilldownRows || []).map((row) => row.callId));
    const defaultQueueFilters = {
      all: {},
      waste: { wasteRisk: "1" },
      repeated_short: { repeatedShortAttempt: "1" },
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
        repeatedShortAttempt: url.searchParams.get("repeatedShortAttempt") || defaultQueueFilters.repeatedShortAttempt || "",
        llmStatus: url.searchParams.get("llmStatus") || defaultQueueFilters.llmStatus || "",
        callIds: url.searchParams.get("callIds") || "",
        limit: url.searchParams.get("intelligenceLimit") || 40
      }).filter((call) => !dashboardAnalysis.filterState?.active || filteredCallIds.has(call.call_id))
      : [];
    response.end(renderDashboard(dashboardAnalysis, {
      businessSegment: activeBusinessSegment,
      dashboardView,
      intelligenceQueue,
      intelligenceCalls,
      opportunityStage: url.searchParams.get("opportunityStage") || "",
      opportunityQueue: url.searchParams.get("opportunityQueue") || ""
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
    const voicemailPilotPath = resolveVoicemailPilotPath(options.argv || process.argv.slice(2), options.env || process.env);
    console.log(`Sales Dashboard listening on http://${host}:${port}`);
    console.log(csvPath ? `CSV source: ${csvPath}` : "CSV source: not configured");
    console.log(allocationPath ? "Allocation source configured but parked from active analytics" : "Allocation source: not configured");
    console.log(voicemailPilotPath ? "Voicemail pilot source: configured for strict read-only validation" : "Voicemail pilot source: not configured");
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  resolveCsvPath,
  resolveAllocationPath,
  resolveVoicemailPilotPath,
  loadVoicemailPilotAttribution,
  loadAnalysis,
  attachPersistence,
  createServer,
  startServer,
  saveGeneratedReport
};
