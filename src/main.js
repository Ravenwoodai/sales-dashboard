"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  checkAiExecutionHealth,
  getAiJob,
  INTELLIGENCE_TASK_TYPE,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitTranscriptIntelligenceExtraction,
  submitTranscriptEvaluation
} = require("./aiExecutionLayer");
const { analyzeCsvText } = require("./analysis");
const { buildDrilldownResult, findCallProof } = require("./drilldown");
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
const { renderCallPage, renderDashboard, renderDrilldownPage, renderEmptyState, renderReportPage } = require("./dashboardRenderer");
const {
  dashboardPersistence,
  persistAnalysis,
  readStore,
  resolveStorePath,
  saveAiJobReference,
  saveGeneratedReport,
  saveManagerReview
} = require("./storage");
const { buildCallIntelligence } = require("./transcriptIntelligence");

const DEFAULT_LOGO_PATH = path.join(__dirname, "assets", "sales-dashboard-logo.png");
const BRAND_LOGO_LIMIT_BYTES = 768 * 1024;
const BRAND_LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

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
  return {
    ...analysis,
    persistence: dashboardPersistence(store, currentImportId)
  };
}

function loadAnalysis(csvPath, options = {}) {
  const storePath = resolveStorePath(options);
  if (!csvPath) {
    return {
      analysis: attachPersistence(
        renderEmptyState("Set SALES_DASHBOARD_CSV_PATH or start with --csv to load a scheduled CSV export."),
        readStore({ storePath })
      ),
      csvPath: null,
      error: null
    };
  }

  try {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const analysis = analyzeCsvText(csvText, { sourceName: path.basename(csvPath) });
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
    const enrichedAnalysis = {
      ...analysis,
      intelligence: intelligenceSummary
    };
    return {
      analysis: attachPersistence(enrichedAnalysis, persistence.store, persistence.importRecord.id),
      csvPath,
      importRecord: persistence.importRecord,
      error: null
    };
  } catch (error) {
    return {
      analysis: attachPersistence(renderEmptyState(`Unable to load CSV: ${error.message}`), readStore({ storePath })),
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
  const { drilldownRows, businessSegmentViews, ...publicFields } = analysis;
  const publicBusinessSegmentViews = Object.fromEntries(
    Object.entries(businessSegmentViews || {}).map(([segment, view]) => {
      const { drilldownRows: segmentDrilldownRows, ...publicView } = view;
      return [segment, publicView];
    })
  );
  return {
    ...publicFields,
    businessSegmentViews: publicBusinessSegmentViews
  };
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

function normalizeLimit(value, fallback = 250, max = 10000) {
  return Math.max(1, Math.min(Number(value || fallback), max));
}

function parseCallIdFilter(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return new Set(values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100));
}

function selectIntelligenceExtractionCalls(rows, body = {}, eligibleCallIds = null) {
  const businessSegment = String(body.businessSegment || body.segment || "").trim();
  const limit = normalizeLimit(body.sampleSize || body.limit, 100, 10000);
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

function createServer(options = {}) {
  const env = options.env || process.env;
  const csvPath = options.csvPath || resolveCsvPath(options.argv || process.argv.slice(2), env);
  const storePath = resolveStorePath(options);
  const aiConfig = resolveAiExecutionConfig(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let state = loadAnalysis(csvPath, { storePath });

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
      sendJson(response, 200, publicAnalysis(state.analysis));
      return;
    }

    if (url.pathname === "/api/source-quality" && request.method === "GET") {
      const query = Object.fromEntries(url.searchParams.entries());
      const requestedSegment = String(query.businessSegment || query.segment || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
      const businessSegment = requestedSegment === "new" || requestedSegment === "new_business"
        ? "new"
        : ["warm", "warm_business", "existing", "existing_business", "previous", "previous_sales"].includes(requestedSegment)
          ? "warm"
          : "";
      const sourceQuality = businessSegment && state.analysis?.businessSegmentViews?.[businessSegment]?.sourceQuality
        ? state.analysis.businessSegmentViews[businessSegment].sourceQuality
        : state.analysis?.sourceQuality || {};
      const minImportAgeDays = query.minImportAgeDays || query.days || query.importAgeDays || "";
      const matchingCalls = minImportAgeDays && state.analysis
        ? buildDrilldownResult(state.analysis, {
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

    if (url.pathname === "/api/drilldown" && request.method === "GET") {
      sendJson(response, 200, buildDrilldownResult(state.analysis, Object.fromEntries(url.searchParams.entries())));
      return;
    }

    if (url.pathname === "/api/intelligence/summary" && request.method === "GET") {
      sendJson(response, 200, getIntelligenceSummary({
        storePath,
        importId: state.importRecord?.id || null,
        businessSegment: url.searchParams.get("businessSegment") || url.searchParams.get("segment") || ""
      }));
      return;
    }

    if (url.pathname === "/api/intelligence/calls" && request.method === "GET") {
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
        })
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
        state.analysis = {
          ...state.analysis,
          intelligence: intelligenceSummary
        };
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
        state.analysis = {
          ...state.analysis,
          intelligence: summary,
          persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
        };
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
          state.analysis = {
            ...state.analysis,
            intelligence: summary,
            persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
          };
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
          state.analysis = {
            ...state.analysis,
            intelligence: summary,
            persistence: dashboardPersistence(readStore({ storePath }), state.importRecord.id)
          };
        }

        sendJson(response, 200, { ok: true, saved: { importId: saved.importId, callId: saved.callId, jobId: saved.jobId }, summary });
      } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.message, details: error.payload || null });
      }
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
      sendJson(response, 200, { reports: store.reports });
      return;
    }

    if (url.pathname.startsWith("/api/reports/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.replace("/api/reports/", ""));
      const store = readStore({ storePath });
      const report = store.reports.find((item) => item.id === id);
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
        state.analysis = attachPersistence(state.analysis, result.store, state.importRecord?.id || null);
        sendJson(response, 201, { ok: true, report: result.report });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (url.pathname === "/api/reviews" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const result = saveManagerReview({
          ...body,
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
        saveManagerReview({
          importId: form.get("importId") || state.importRecord?.id || "current",
          callId,
          status: form.get("status") || "reviewed",
          confirmedOutcome: form.get("confirmedOutcome") || "",
          confirmedFollowUpRequired: form.get("confirmedFollowUpRequired") === "on",
          notes: form.get("notes") || "",
          reviewedBy: form.get("reviewedBy") || "Manager"
        }, { storePath });
        response.writeHead(303, { Location: returnTo });
        response.end();
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
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
      state = loadAnalysis(csvPath, { storePath });
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
      const report = store.reports.find((item) => item.id === id);
      response.writeHead(report ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderReportPage(report));
      return;
    }

    if (url.pathname === "/drilldown" && request.method === "GET") {
      const result = buildDrilldownResult(state.analysis, Object.fromEntries(url.searchParams.entries()));
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
      const reviews = store.managerReviews.filter((review) => review.callId === callId);
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

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    const activeBusinessSegment = url.searchParams.get("businessSegment") || url.searchParams.get("segment") || "";
    const intelligenceQueue = url.searchParams.get("intelligenceQueue") || "waste";
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
      })
      : [];
    response.end(renderDashboard(state.analysis, {
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
    console.log(`Sales Dashboard listening on http://${host}:${port}`);
    console.log(csvPath ? `CSV source: ${csvPath}` : "CSV source: not configured");
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  resolveCsvPath,
  loadAnalysis,
  attachPersistence,
  createServer,
  startServer,
  saveGeneratedReport
};
