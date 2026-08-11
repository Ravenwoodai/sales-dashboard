"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  loadConfig,
  reportingPeriod,
  runCommand,
  runWeeklyLeadUtilisation,
  assertExclusionPolicy,
} = require("./weeklyLeadUtilisationOrchestrator");

const MANIFEST_SCHEMA = "weekly_lead_management_orchestrator.v1";

function clean(value) {
  return String(value ?? "").trim();
}

function interpolate(value, tokens) {
  return String(value ?? "").replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) throw new Error(`Unknown configuration token: ${key}`);
    return String(tokens[key]);
  });
}

function resolveConfiguredPath(value, tokens, baseDir) {
  const resolved = interpolate(value, tokens);
  return path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(baseDir, resolved);
}

function resolvePythonExecutable(configuredValue, tokens, baseDir) {
  if (clean(configuredValue)) {
    const configured = interpolate(configuredValue, tokens);
    if (path.isAbsolute(configured)) return path.normalize(configured);
    if (configured.includes("/") || configured.includes("\\")) return path.resolve(baseDir, configured);
    return configured;
  }
  const bundled = path.join(
    process.env.USERPROFILE || "",
    ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe",
  );
  return fs.existsSync(bundled) ? bundled : "python";
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertSignature(filePath, signature, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const handle = fs.openSync(filePath, "r");
  try {
    const expected = Buffer.from(signature);
    const actual = Buffer.alloc(expected.length);
    fs.readSync(handle, actual, 0, actual.length, 0);
    if (!actual.equals(expected)) throw new Error(`${label} has an invalid file signature: ${filePath}`);
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
  return { ...detail, id, status, at: new Date().toISOString() };
}

function normalizeCommand(command, tokens, baseDir) {
  if (!command || typeof command !== "object") throw new Error("Configured delivery command is invalid.");
  const executable = interpolate(clean(command.executable), tokens);
  if (!executable) throw new Error("Configured delivery executable is required.");
  return {
    executable,
    args: Array.isArray(command.args) ? command.args.map((value) => interpolate(String(value), tokens)) : [],
    cwd: resolveConfiguredPath(command.cwd || baseDir, tokens, baseDir),
  };
}

async function runWeeklyLeadManagement(options) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const loaded = loadConfig(options.configPath);
  const config = loaded.config;
  const exclusionPolicy = assertExclusionPolicy(config.report);
  const period = reportingPeriod(options.startDate);
  const runId = `${period.startDate}_to_${period.endDate}`;
  const tokens = {
    root,
    configDir: loaded.configDir,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    sourceEnd: period.sourceEndDate,
    runId,
  };
  const configuredOutputRoot = config.leadManagement?.outputRoot || "{{root}}\\outputs\\weekly-lead-management";
  const outputRoot = resolveConfiguredPath(configuredOutputRoot, tokens, loaded.configDir);
  const outputDir = path.join(outputRoot, runId);
  const workDir = path.join(root, "work", "weekly-lead-management", runId);
  const manifestPath = path.join(
    outputDir,
    options.dryRun ? "dry-run-manifest.json" : "orchestration-manifest.json",
  );
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    status: options.dryRun ? "dry_run" : "running",
    runId,
    generatedAt: new Date().toISOString(),
    reportingPeriod: period,
    configFileName: path.basename(loaded.configPath),
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
  await fsp.mkdir(workDir, { recursive: true });

  let leadResult;
  await runStage("build_lead_utilisation_source_pack", async () => {
    leadResult = await runWeeklyLeadUtilisation({
      root,
      configPath: loaded.configPath,
      startDate: period.startDate,
      dryRun: Boolean(options.dryRun),
      acquire: Boolean(options.acquire),
      sendEmail: false,
    });
    if (!options.dryRun && leadResult.manifest.status !== "complete") {
      throw new Error(`Lead Utilisation source pack is not complete: ${leadResult.manifest.status}`);
    }
    return { status: leadResult.manifest.status, manifestPath: leadResult.manifestPath };
  });

  if (options.dryRun) {
    manifest.status = "dry_run_complete";
    manifest.completedAt = new Date().toISOString();
    await writeManifest(manifestPath, manifest);
    return { manifestPath, outputDir, manifest };
  }

  const leadOutputDir = leadResult.outputDir;
  const leadWorkbook = leadResult.reportWorkbook;
  const leadPdf = leadResult.reportPdf;
  const leadDataPath = path.join(leadOutputDir, "report_data.json");
  for (const [filePath, signature, label] of [
    [leadWorkbook, "PK", "Lead Utilisation workbook"],
    [leadPdf, "%PDF-", "Lead Utilisation PDF"],
  ]) assertSignature(filePath, signature, label);
  if (!fs.existsSync(leadDataPath)) throw new Error(`Lead Utilisation report data is missing: ${leadDataPath}`);

  const managerExclusions = config.report.managerTeamExclusions || [];
  const salespersonExclusions = config.report.salespersonExclusions || [];
  const voicemailStem = `Voicemail_Follow_Up_Report_${runId}`;
  const voicemailWorkbook = path.join(outputDir, `${voicemailStem}.xlsx`);
  const voicemailPdf = path.join(outputDir, `${voicemailStem}.pdf`);
  const voicemailDataPath = path.join(outputDir, "voicemail_report_data.json");
  const voicemailQaPath = path.join(outputDir, "voicemail_qa.json");
  const sourceConfigPath = path.join(root, "data", "store", "performance-cohorts.json");

  await runStage("build_voicemail_workbook", async () => {
    runCommand({
      executable: process.execPath,
      args: [
        "--max-old-space-size=16384",
        path.join(root, "scripts", "build-weekly-voicemail-report.mjs"),
        "--root", root,
        "--start", period.startDate,
        "--output", outputDir,
        "--filename", path.basename(voicemailWorkbook),
        "--source-config", sourceConfigPath,
        "--report-data", voicemailDataPath,
        "--qa", voicemailQaPath,
        "--work", path.join(workDir, "voicemail"),
        "--manager-exclusions", managerExclusions.join(";"),
        "--salesperson-exclusions", salespersonExclusions.join(";"),
        "--exclusion-display", exclusionPolicy.exclusionDisplay,
      ],
      cwd: root,
    }, { label: "Weekly Voicemail workbook build" });
    assertSignature(voicemailWorkbook, "PK", "Voicemail workbook");
    const qa = JSON.parse(fs.readFileSync(voicemailQaPath, "utf8"));
    if (qa.formulaErrorMatches !== 0 || !qa.cohortChecks?.current?.length || !qa.cohortChecks?.previous?.length) {
      throw new Error("Voicemail workbook QA did not pass.");
    }
    const data = JSON.parse(fs.readFileSync(voicemailDataPath, "utf8"));
    if (clean(data.exclusionPolicy?.display) !== exclusionPolicy.exclusionDisplay) {
      throw new Error("Voicemail workbook does not match the configured exclusion policy.");
    }
    return { workbookFileName: path.basename(voicemailWorkbook), checked: data.totals.checked, followed: data.totals.followed };
  });

  const logoPath = resolveConfiguredPath(config.report.logoPath, tokens, loaded.configDir);
  const pythonExecutable = resolvePythonExecutable(config.report.pythonExecutable, tokens, loaded.configDir);
  await runStage("render_voicemail_pdf", async () => {
    runCommand({
      executable: pythonExecutable,
      args: [
        path.join(root, "scripts", "render-weekly-voicemail-pdf.py"),
        "--data", voicemailDataPath,
        "--output", voicemailPdf,
        "--logo", logoPath,
      ],
      cwd: root,
    }, { label: "Weekly Voicemail PDF render" });
    assertSignature(voicemailPdf, "%PDF-", "Voicemail PDF");
    return { pdfFileName: path.basename(voicemailPdf) };
  });

  const combinedStem = `Weekly_Lead_Management_Report_${runId}`;
  const combinedWorkbook = path.join(outputDir, `${combinedStem}.xlsx`);
  const combinedPdf = path.join(outputDir, `${combinedStem}.pdf`);
  const combinedWorkbookQa = path.join(outputDir, "combined_workbook_qa.json");
  await runStage("build_combined_workbook", async () => {
    runCommand({
      executable: process.execPath,
      args: [
        "--max-old-space-size=16384",
        path.join(root, "scripts", "build-combined-weekly-report.mjs"),
        "--root", root,
        "--lead-workbook", leadWorkbook,
        "--voicemail-workbook", voicemailWorkbook,
        "--lead-data", leadDataPath,
        "--voicemail-data", voicemailDataPath,
        "--output", combinedWorkbook,
        "--qa", combinedWorkbookQa,
        "--work", path.join(workDir, "combined-workbook"),
      ],
      cwd: root,
    }, { label: "Combined weekly workbook build" });
    assertSignature(combinedWorkbook, "PK", "Combined weekly workbook");
    const qa = JSON.parse(fs.readFileSync(combinedWorkbookQa, "utf8"));
    if (qa.formulaErrorMatches !== 0 || qa.sheets.length < 18) throw new Error("Combined workbook QA did not pass.");
    return { workbookFileName: path.basename(combinedWorkbook), sheetCount: qa.sheets.length };
  });

  await runStage("render_combined_pdf", async () => {
    runCommand({
      executable: pythonExecutable,
      args: [
        path.join(root, "scripts", "render-combined-weekly-report-pdf.py"),
        "--lead-data", leadDataPath,
        "--voicemail-data", voicemailDataPath,
        "--lead-pdf", leadPdf,
        "--voicemail-pdf", voicemailPdf,
        "--output", combinedPdf,
        "--logo", logoPath,
        "--work", path.join(workDir, "combined-pdf"),
      ],
      cwd: root,
    }, { label: "Combined weekly PDF render" });
    assertSignature(combinedPdf, "%PDF-", "Combined weekly PDF");
    return { pdfFileName: path.basename(combinedPdf) };
  });

  if (options.sendEmail) {
    const delivery = config.leadManagement?.delivery || config.delivery;
    if (!delivery?.command || !clean(delivery.recipient)) {
      throw new Error("Email delivery was requested but no Lead Management delivery command/recipient is configured.");
    }
    await runStage("email_combined_report", async () => {
      const deliveryTokens = {
        ...tokens,
        outputDir,
        xlsx: combinedWorkbook,
        pdf: combinedPdf,
        recipient: delivery.recipient,
      };
      runCommand(normalizeCommand(delivery.command, deliveryTokens, loaded.configDir), { label: "Combined report email delivery" });
      return { recipient: delivery.recipient, attachments: [path.basename(combinedWorkbook), path.basename(combinedPdf)] };
    });
  }

  manifest.sources = {
    leadUtilisationManifest: { fileName: path.basename(leadResult.manifestPath), sha256: sha256File(leadResult.manifestPath) },
    leadWorkbook: { fileName: path.basename(leadWorkbook), sha256: sha256File(leadWorkbook) },
    leadPdf: { fileName: path.basename(leadPdf), sha256: sha256File(leadPdf) },
  };
  manifest.outputs = {
    workbook: { fileName: path.basename(combinedWorkbook), sha256: sha256File(combinedWorkbook) },
    pdf: { fileName: path.basename(combinedPdf), sha256: sha256File(combinedPdf) },
    voicemailWorkbook: { fileName: path.basename(voicemailWorkbook), sha256: sha256File(voicemailWorkbook) },
    voicemailPdf: { fileName: path.basename(voicemailPdf), sha256: sha256File(voicemailPdf) },
    voicemailData: { fileName: path.basename(voicemailDataPath), sha256: sha256File(voicemailDataPath) },
    voicemailQa: { fileName: path.basename(voicemailQaPath), sha256: sha256File(voicemailQaPath) },
    combinedWorkbookQa: { fileName: path.basename(combinedWorkbookQa), sha256: sha256File(combinedWorkbookQa) },
  };
  manifest.status = "complete";
  manifest.completedAt = new Date().toISOString();
  await writeManifest(manifestPath, manifest);
  return { manifestPath, outputDir, combinedWorkbook, combinedPdf, manifest };
}

module.exports = {
  MANIFEST_SCHEMA,
  interpolate,
  runWeeklyLeadManagement,
};
