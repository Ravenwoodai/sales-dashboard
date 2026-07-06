"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  checkAiExecutionHealth,
  getAiJob,
  publicAiExecutionStatus,
  resolveAiExecutionConfig,
  submitTranscriptEvaluation
} = require("./aiExecutionLayer");
const { analyzeCsvText } = require("./analysis");
const { buildDrilldownResult, findCallProof } = require("./drilldown");
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
    return {
      analysis: attachPersistence(analysis, persistence.store, persistence.importRecord.id),
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
  const { drilldownRows, ...publicFields } = analysis;
  return publicFields;
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

function createServer(options = {}) {
  const env = options.env || process.env;
  const csvPath = options.csvPath || resolveCsvPath(options.argv || process.argv.slice(2), env);
  const storePath = resolveStorePath(options);
  const aiConfig = resolveAiExecutionConfig(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let state = loadAnalysis(csvPath, { storePath });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

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

    if (url.pathname === "/api/drilldown" && request.method === "GET") {
      sendJson(response, 200, buildDrilldownResult(state.analysis, Object.fromEntries(url.searchParams.entries())));
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
      const aiJobs = store.aiJobs.filter((job) => job.callId === callId);
      response.writeHead(call ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(renderCallPage(call, {
        callId,
        reviews,
        aiJobs,
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
    response.end(renderDashboard(state.analysis));
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
