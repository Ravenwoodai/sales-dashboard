"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const CONFIG_SCHEMA = "weekly_lead_utilisation_orchestrator.v1";
const MANIFEST_SCHEMA = "weekly_lead_utilisation_run.v1";
const POPULATION_CONTRACT = "carma_approved_sales_show_new_customers_false.v1";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeExclusionLabels(values) {
  return [...new Set((values || [])
    .map((value) => clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean))]
    .sort();
}

function exclusionPolicyPayload(report = {}) {
  return {
    managerTeamExclusions: normalizeExclusionLabels(report.managerTeamExclusions),
    salespersonExclusions: normalizeExclusionLabels(report.salespersonExclusions),
  };
}

function exclusionPolicySha256(report = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(exclusionPolicyPayload(report)))
    .digest("hex");
}

function assertExclusionPolicy(report = {}) {
  const payload = exclusionPolicyPayload(report);
  if (!payload.managerTeamExclusions.length || !payload.salespersonExclusions.length) {
    throw new Error("Both manager-team and salesperson exclusion lists are required.");
  }
  if (!clean(report.exclusionDisplay)) {
    throw new Error("report.exclusionDisplay is required.");
  }
  const configuredHash = clean(report.exclusionPolicySha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(configuredHash)) {
    throw new Error("report.exclusionPolicySha256 must be a SHA-256 hash.");
  }
  const actualHash = exclusionPolicySha256(report);
  if (configuredHash !== actualHash) {
    throw new Error("The configured personnel exclusions do not match report.exclusionPolicySha256.");
  }
  return { ...payload, exclusionDisplay: clean(report.exclusionDisplay), sha256: actualHash };
}

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) throw new Error(`${label} must be YYYY-MM-DD.`);
  const [year, month, day] = clean(value).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
}

function addDays(isoDate, days) {
  assertIsoDate(isoDate, "date");
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function assertMonday(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1) {
    throw new Error(`Reporting start must be a Monday: ${isoDate}`);
  }
}

function reportingPeriod(startDate) {
  assertIsoDate(startDate, "reporting start");
  assertMonday(startDate);
  return {
    startDate,
    endDate: addDays(startDate, 4),
    sourceEndDate: addDays(startDate, 6),
    timezone: "Australia/Melbourne",
  };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function interpolate(value, tokens) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in tokens)) throw new Error(`Unknown orchestration token: ${match}`);
    return String(tokens[key]);
  });
}

function resolveConfiguredPath(value, tokens, baseDir) {
  const resolved = interpolate(clean(value), tokens);
  if (!resolved) return "";
  return path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(baseDir, resolved);
}

function wildcardRegex(fileNamePattern) {
  const escaped = fileNamePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

function resolveSingleFile(patternValue, tokens, baseDir, label) {
  const filePattern = resolveConfiguredPath(patternValue, tokens, baseDir);
  if (!filePattern) throw new Error(`${label} path is not configured.`);
  if (!/[?*]/.test(filePattern)) {
    if (!fs.existsSync(filePattern)) throw new Error(`${label} is missing: ${filePattern}`);
    if (!fs.statSync(filePattern).isFile()) throw new Error(`${label} is not a file: ${filePattern}`);
    return filePattern;
  }
  const directory = path.dirname(filePattern);
  if (!fs.existsSync(directory)) throw new Error(`${label} directory is missing: ${directory}`);
  const matcher = wildcardRegex(path.basename(filePattern));
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
  if (matches.length !== 1) {
    throw new Error(`${label} pattern must resolve to exactly one file; found ${matches.length}: ${filePattern}`);
  }
  return matches[0];
}

function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Orchestration config is missing: ${absolutePath}`);
  const config = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (config.schemaVersion !== CONFIG_SCHEMA) throw new Error(`Unsupported orchestration config: ${config.schemaVersion || "missing"}`);
  if (config.timezone !== "Australia/Melbourne") throw new Error("Orchestration timezone must be Australia/Melbourne.");
  if (!config.sources?.allocationPath || !config.sources?.callPath) throw new Error("Allocation and call source paths are required.");
  if (!config.carmaEvidence?.databasePath) throw new Error("A governed Carma evidence database path is required.");
  if (!config.report?.outputRoot || !config.report?.logoPath) throw new Error("Report outputRoot and logoPath are required.");
  assertExclusionPolicy(config.report);
  return { config, configPath: absolutePath, configDir: path.dirname(absolutePath) };
}

function weeklyLeadUtilisationTrendContract(config, tokens, configDir) {
  const personMinimumAllocations = Number(config.report?.personMinimumAllocations ?? 100);
  if (!Number.isFinite(personMinimumAllocations) || personMinimumAllocations < 1) {
    throw new Error("report.personMinimumAllocations must be a positive number.");
  }
  return {
    trendHistoryPath: resolveConfiguredPath(
      config.report?.trendHistoryPath || "{{root}}\\data\\store\\lead-utilisation-trend-history.json",
      tokens,
      configDir,
    ),
    personMinimumAllocations,
  };
}

function normalizeCommand(command, tokens, baseDir) {
  if (!command || typeof command !== "object") throw new Error("Configured command is invalid.");
  const executable = interpolate(clean(command.executable), tokens);
  if (!executable) throw new Error("Configured command executable is required.");
  return {
    executable,
    args: Array.isArray(command.args) ? command.args.map((value) => interpolate(String(value), tokens)) : [],
    cwd: resolveConfiguredPath(command.cwd || baseDir, tokens, baseDir),
  };
}

function runCommand(command, options = {}) {
  const isWindowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command.executable);
  const executable = isWindowsCommandScript ? (process.env.ComSpec || "cmd.exe") : command.executable;
  const commandArgs = isWindowsCommandScript
    ? ["/d", "/s", "/c", command.executable, ...command.args]
    : command.args;
  const result = spawnSync(executable, commandArgs, {
    cwd: command.cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = clean(result.stderr) || clean(result.stdout) || `exit code ${result.status}`;
    throw new Error(`${options.label || command.executable} failed: ${detail}`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "", exitCode: result.status };
}

function verifyEvidencePeriod(databasePath, periodStart, periodEnd) {
  if (!fs.existsSync(databasePath)) throw new Error(`Carma evidence database is missing: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== "ok") throw new Error(`Carma database integrity failed: ${integrity.join(", ")}`);
    const run = db.prepare(`
      SELECT run_id, population_contract, show_new_customers_only, completeness_status,
             period_start, period_end, row_count
      FROM extraction_runs
      WHERE dataset_type = 'approved_sales' AND period_start = ? AND period_end = ?
      ORDER BY extracted_at DESC
      LIMIT 1
    `).get(periodStart, periodEnd);
    if (!run) throw new Error(`Carma evidence has no approved-sales run for ${periodStart} to ${periodEnd}.`);
    if (
      run.population_contract !== POPULATION_CONTRACT
      || Number(run.show_new_customers_only) !== 0
      || run.completeness_status !== "complete"
      || Number(run.row_count) <= 0
    ) {
      throw new Error(`Carma evidence run is not governed and complete: ${JSON.stringify(run)}`);
    }
    return run;
  } finally {
    db.close();
  }
}

function assertFileSignature(filePath, signature, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(signature.length);
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (!buffer.equals(Buffer.from(signature))) throw new Error(`${label} has an invalid file signature: ${filePath}`);
  } finally {
    fs.closeSync(handle);
  }
}

async function writeManifest(filePath, manifest) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fsp.rename(temporaryPath, filePath);
}

function stageRecord(id, status, detail = {}) {
  return { id, status, at: new Date().toISOString(), ...detail };
}

function resolvePythonExecutable(configuredValue, tokens, baseDir) {
  if (clean(configuredValue)) {
    const configured = interpolate(clean(configuredValue), tokens);
    if (path.isAbsolute(configured)) return path.normalize(configured);
    if (configured.includes("/") || configured.includes("\\")) return path.resolve(baseDir, configured);
    return configured;
  }
  const bundled = path.join(
    process.env.USERPROFILE || "",
    ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"
  );
  return fs.existsSync(bundled) ? bundled : "python";
}

async function runWeeklyLeadUtilisation(options) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const loaded = loadConfig(options.configPath);
  const config = loaded.config;
  const period = reportingPeriod(options.startDate);
  const runId = `${period.startDate}_to_${period.endDate}`;
  const initialTokens = {
    root,
    configDir: loaded.configDir,
    carmaReportsRoot: resolveConfiguredPath(config.carmaReportsRoot || "", {}, loaded.configDir),
    periodStart: period.startDate,
    periodEnd: period.endDate,
    sourceEnd: period.sourceEndDate,
    runId,
  };
  const outputRoot = resolveConfiguredPath(config.report.outputRoot, initialTokens, loaded.configDir);
  const outputDir = path.join(outputRoot, runId);
  const tokens = { ...initialTokens, outputRoot, outputDir };
  const manifestPath = path.join(
    outputDir,
    options.dryRun ? "dry-run-manifest.json" : "orchestration-manifest.json",
  );
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    status: options.dryRun ? "dry_run" : "running",
    runId,
    generatedAt: new Date().toISOString(),
    configFileName: path.basename(loaded.configPath),
    reportingPeriod: period,
    stages: [],
    sources: {},
    outputs: {},
  };

  async function runStage(id, action) {
    manifest.stages.push(stageRecord(id, "running"));
    await writeManifest(manifestPath, manifest);
    try {
      const detail = await action();
      manifest.stages[manifest.stages.length - 1] = stageRecord(id, "complete", detail || {});
      await writeManifest(manifestPath, manifest);
      return detail;
    } catch (error) {
      manifest.stages[manifest.stages.length - 1] = stageRecord(id, "failed", { error: error.message });
      manifest.status = "failed";
      manifest.completedAt = new Date().toISOString();
      await writeManifest(manifestPath, manifest);
      throw error;
    }
  }

  await fsp.mkdir(outputDir, { recursive: true });

  if (options.acquire && config.acquisition?.allocationCommand) {
    await runStage("acquire_weekly_allocation", async () => {
      const command = normalizeCommand(config.acquisition.allocationCommand, tokens, loaded.configDir);
      if (!options.dryRun) runCommand(command, { label: "Weekly allocation acquisition" });
      return { mode: options.dryRun ? "planned" : "executed", executable: command.executable, args: command.args };
    });
  }

  if (options.acquire && config.acquisition?.callCommand) {
    await runStage("acquire_weekly_calls", async () => {
      const command = normalizeCommand(config.acquisition.callCommand, tokens, loaded.configDir);
      if (!options.dryRun) runCommand(command, { label: "Weekly call acquisition" });
      return { mode: options.dryRun ? "planned" : "executed", executable: command.executable, args: command.args };
    });
  }

  let allocationPath;
  let callPath;
  let primaryCallPath = "";
  await runStage("resolve_weekly_sources", async () => {
    allocationPath = resolveSingleFile(config.sources.allocationPath, tokens, loaded.configDir, "Weekly allocation export");
    callPath = resolveSingleFile(config.sources.callPath, tokens, loaded.configDir, "Weekly call export");
    if (config.sources.primaryCallPath) {
      primaryCallPath = resolveSingleFile(config.sources.primaryCallPath, tokens, loaded.configDir, "Primary call history");
    }
    manifest.sources = {
      allocation: { fileName: path.basename(allocationPath), sha256: sha256File(allocationPath) },
      calls: { fileName: path.basename(callPath), sha256: sha256File(callPath) },
      ...(primaryCallPath ? { primaryCalls: { fileName: path.basename(primaryCallPath), sha256: sha256File(primaryCallPath) } } : {}),
    };
    tokens.allocationPath = allocationPath;
    tokens.callPath = callPath;
    tokens.primaryCallPath = primaryCallPath;
    return { allocationFileName: path.basename(allocationPath), callFileName: path.basename(callPath) };
  });

  const evidenceDatabasePath = resolveConfiguredPath(config.carmaEvidence.databasePath, tokens, loaded.configDir);
  if (options.acquire && config.carmaEvidence.refreshCommand) {
    await runStage("refresh_carma_sales_evidence", async () => {
      const command = normalizeCommand(config.carmaEvidence.refreshCommand, tokens, loaded.configDir);
      if (!options.dryRun) runCommand(command, { label: "Carma sales evidence refresh" });
      return { mode: options.dryRun ? "planned" : "executed", executable: command.executable, args: command.args };
    });
  }

  await runStage("verify_carma_sales_evidence", async () => {
    if (options.dryRun && config.carmaEvidence.refreshCommand && !fs.existsSync(evidenceDatabasePath)) {
      return { mode: "planned", databasePath: evidenceDatabasePath, note: "Evidence database will be produced by the configured refresh command." };
    }
    const run = verifyEvidencePeriod(evidenceDatabasePath, period.startDate, period.sourceEndDate);
    return { databaseFileName: path.basename(evidenceDatabasePath), databaseSha256: sha256File(evidenceDatabasePath), extractionRun: run };
  });

  if (options.dryRun) {
    manifest.status = "dry_run_complete";
    manifest.completedAt = new Date().toISOString();
    await writeManifest(manifestPath, manifest);
    return { manifestPath, manifest };
  }

  await runStage("import_weekly_exports", async () => {
    const args = [
      path.join(root, "scripts", "import-weekly-performance-exports.mjs"),
      "--allocation", allocationPath,
      "--calls", callPath,
      "--start", period.startDate,
      "--end", period.sourceEndDate,
    ];
    if (primaryCallPath) args.push("--primary-calls", primaryCallPath);
    const result = runCommand({ executable: process.execPath, args, cwd: root }, { label: "Weekly export import" });
    return { stdout: clean(result.stdout).slice(-4000) };
  });

  const leadResultDir = path.join(outputDir, "lead-result-dashboard");
  const leadResultWorkbook = path.join(leadResultDir, `lead-result-dashboard_${period.startDate}_to_${period.sourceEndDate}.xlsx`);
  await runStage("build_lead_result_dashboard", async () => {
    runCommand({
      executable: process.execPath,
      args: [
        path.join(root, "scripts", "build-lead-result-dashboard.mjs"),
        "--output", leadResultDir,
        "--start", period.startDate,
        "--end", period.sourceEndDate,
        "--carma-database", evidenceDatabasePath,
        "--personnel-exclusions", [
          ...(config.report.managerTeamExclusions || []),
          ...(config.report.salespersonExclusions || []),
        ].join(";"),
      ],
      cwd: root,
    }, { label: "Lead Result Dashboard build" });
    const validationPath = path.join(leadResultDir, "validation.json");
    const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
    if (!Object.values(validation.reconciliations || {}).every(Boolean) || (validation.formulaErrors || []).length) {
      throw new Error("Lead Result Dashboard validation did not pass every reconciliation.");
    }
    assertFileSignature(leadResultWorkbook, "PK", "Lead Result Dashboard workbook");
    return { workbookFileName: path.basename(leadResultWorkbook), validationFileName: path.basename(validationPath) };
  });

  const reportFileStem = `Lead_Utilisation_and_Wastage_Report_${period.startDate}_to_${period.endDate}`;
  const reportWorkbook = path.join(outputDir, `${reportFileStem}.xlsx`);
  const reportDataPath = path.join(outputDir, "report_data.json");
  const trendContract = weeklyLeadUtilisationTrendContract(config, tokens, loaded.configDir);
  await runStage("build_lead_utilisation_workbook", async () => {
    runCommand({
      executable: process.execPath,
      args: [
        path.join(root, "scripts", "build-lead-utilisation-report.mjs"),
        "--allocation", allocationPath,
        "--calls", callPath,
        ...(primaryCallPath ? ["--primary-calls", primaryCallPath] : []),
        "--start", period.startDate,
        "--end", period.endDate,
        "--output", outputDir,
        "--filename", path.basename(reportWorkbook),
        "--manager-exclusions", (config.report.managerTeamExclusions || []).join(";"),
        "--salesperson-exclusions", (config.report.salespersonExclusions || []).join(";"),
        "--exclusion-display", config.report.exclusionDisplay,
        "--trend-history", trendContract.trendHistoryPath,
        "--person-minimum-allocations", String(trendContract.personMinimumAllocations),
      ],
      cwd: root,
    }, { label: "Lead Utilisation workbook build" });
    assertFileSignature(reportWorkbook, "PK", "Lead Utilisation workbook");
    const data = JSON.parse(fs.readFileSync(reportDataPath, "utf8"));
    if (!(data.qaChecks || []).every((row) => row.result === "PASS")) throw new Error("Lead Utilisation workbook QA did not pass.");
    if (!data.ongoingTrends || data.ongoingTrends.personMinimumAllocations !== trendContract.personMinimumAllocations) {
      throw new Error("Lead Utilisation workbook is missing the locked ongoing-trend contract.");
    }
    const expectedExclusions = assertExclusionPolicy(config.report);
    const actualManagers = normalizeExclusionLabels(
      (data.exclusions?.managerTeams || []).map((value) => clean(value).replace(/\s+team$/i, "")),
    );
    const actualSalespeople = normalizeExclusionLabels(data.exclusions?.salespeople || []);
    if (
      JSON.stringify(actualManagers) !== JSON.stringify(expectedExclusions.managerTeamExclusions)
      || JSON.stringify(actualSalespeople) !== JSON.stringify(expectedExclusions.salespersonExclusions)
      || clean(data.exclusions?.display) !== expectedExclusions.exclusionDisplay
    ) {
      throw new Error("Lead Utilisation workbook does not match the configured exclusion policy.");
    }
    return {
      workbookFileName: path.basename(reportWorkbook),
      received: data.totals.received,
      called: data.totals.called,
      wasted: data.totals.wasted,
      trendWeeks: data.ongoingTrends?.weekCount || 0,
      qualifyingPeople: data.ongoingTrends?.people?.length || 0,
    };
  });

  const salesSplitPath = path.join(outputDir, "sales_source_split.json");
  await runStage("extract_allocated_self_sourced_sales", async () => {
    runCommand({
      executable: process.execPath,
      args: [
        path.join(root, "scripts", "extract-lead-utilisation-sales-split.mjs"),
        "--workbook", leadResultWorkbook,
        "--report-data", reportDataPath,
        "--output", salesSplitPath,
      ],
      cwd: root,
    }, { label: "Allocated/Self-Sourced sales extraction" });
    const split = JSON.parse(fs.readFileSync(salesSplitPath, "utf8"));
    return { includedSalesRows: split.includedSalesRows, totals: split.totals };
  });

  const logoPath = resolveSingleFile(config.report.logoPath, tokens, loaded.configDir, "Report logo");
  const reportPdf = path.join(outputDir, `${reportFileStem}.pdf`);
  await runStage("render_lead_utilisation_pdf", async () => {
    const pythonExecutable = resolvePythonExecutable(config.report.pythonExecutable, tokens, loaded.configDir);
    const pdfArgs = [
      path.join(root, "scripts", "render-lead-utilisation-pdf.py"),
      "--report-data", reportDataPath,
      "--sales-split", salesSplitPath,
      "--output", reportPdf,
      "--logo", logoPath,
    ];
    if (config.report.fontDir) pdfArgs.push("--font-dir", resolveConfiguredPath(config.report.fontDir, tokens, loaded.configDir));
    runCommand({ executable: pythonExecutable, args: pdfArgs, cwd: root }, { label: "Lead Utilisation PDF render" });
    assertFileSignature(reportPdf, "%PDF-", "Lead Utilisation PDF");
    return { pdfFileName: path.basename(reportPdf) };
  });

  if (options.sendEmail) {
    if (!config.delivery?.command || !clean(config.delivery.recipient)) {
      throw new Error("Email delivery was requested but delivery.command/recipient are not configured.");
    }
    await runStage("email_report", async () => {
      const deliveryTokens = { ...tokens, xlsx: reportWorkbook, pdf: reportPdf, recipient: config.delivery.recipient };
      const command = normalizeCommand(config.delivery.command, deliveryTokens, loaded.configDir);
      runCommand(command, { label: "Report email delivery" });
      return { recipient: config.delivery.recipient, attachments: [path.basename(reportWorkbook), path.basename(reportPdf)] };
    });
  }

  manifest.outputs = {
    workbook: { fileName: path.basename(reportWorkbook), sha256: sha256File(reportWorkbook) },
    pdf: { fileName: path.basename(reportPdf), sha256: sha256File(reportPdf) },
    reportData: { fileName: path.basename(reportDataPath), sha256: sha256File(reportDataPath) },
    salesSplit: { fileName: path.basename(salesSplitPath), sha256: sha256File(salesSplitPath) },
  };
  manifest.status = "complete";
  manifest.completedAt = new Date().toISOString();
  await writeManifest(manifestPath, manifest);
  return { manifestPath, outputDir, reportWorkbook, reportPdf, manifest };
}

module.exports = {
  CONFIG_SCHEMA,
  MANIFEST_SCHEMA,
  addDays,
  assertExclusionPolicy,
  exclusionPolicySha256,
  interpolate,
  loadConfig,
  reportingPeriod,
  resolveSingleFile,
  runCommand,
  runWeeklyLeadUtilisation,
  verifyEvidencePeriod,
  weeklyLeadUtilisationTrendContract,
};
