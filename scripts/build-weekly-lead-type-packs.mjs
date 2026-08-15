import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function argsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return result;
}

const args = argsFrom(process.argv.slice(2));
for (const required of ["start", "config", "overall-management-dir", "overall-lead-dir", "source-config", "policy", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}
const root = path.resolve(String(args.root || process.cwd()));
const start = String(args.start);
const endDate = new Date(`${start}T00:00:00Z`);
if (!Number.isFinite(endDate.getTime()) || endDate.getUTCDay() !== 1) throw new Error("--start must be a Monday.");
endDate.setUTCDate(endDate.getUTCDate() + 4);
const end = endDate.toISOString().slice(0, 10);
const runId = `${start}_to_${end}`;
const config = JSON.parse(await fs.readFile(path.resolve(String(args.config)), "utf8"));
const overallManagementDir = path.resolve(String(args["overall-management-dir"]));
const overallLeadDir = path.resolve(String(args["overall-lead-dir"]));
const sourceConfigPath = path.resolve(String(args["source-config"]));
const policyPath = path.resolve(String(args.policy));
const outputRoot = path.resolve(String(args.output));
const workRoot = path.resolve(String(args.work || path.join(root, "work", "weekly-lead-management", runId, "lead-type-packs")));
const managerExclusions = config.report.managerTeamExclusions || [];
const salespersonExclusions = config.report.salespersonExclusions || [];
const exclusionDisplay = String(config.report.exclusionDisplay || "");
const minimumAllocations = String(config.report.personMinimumAllocations || 100);
const logoPath = path.resolve(String(config.report.logoPath).replace("{{root}}", root));
const python = config.report.pythonExecutable || path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
const sha256 = (filePath) => crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex");

function run(label, executable, commandArgs, cwd = root) {
  const result = spawnSync(executable, commandArgs, { cwd, encoding: "utf8", maxBuffer: 40 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(`${label} failed: ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout || "").trim();
}

function addDays(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sourceForWeek(sources, prefix, weekStart) {
  const sourceEnd = addDays(weekStart, 6);
  const pattern = new RegExp(`${prefix}_${weekStart}_to_${sourceEnd}(?:_[a-f0-9]+)?\\.csv$`, "i");
  const matches = sources.filter((source) => pattern.test(path.basename(source.path)));
  if (matches.length !== 1) throw new Error(`Expected one ${prefix} source for ${weekStart}; found ${matches.length}.`);
  return matches[0].path;
}

await fs.mkdir(outputRoot, { recursive: true });
await fs.mkdir(workRoot, { recursive: true });
const sourceWork = path.join(workRoot, "sources");
run("Lead-type source preparation", process.execPath, [
  path.join(root, "scripts", "prepare-weekly-lead-type-sources.mjs"),
  "--source-config", sourceConfigPath,
  "--policy", policyPath,
  "--output", sourceWork,
  "--manager-exclusions", managerExclusions.join(";"),
  "--salesperson-exclusions", salespersonExclusions.join(";"),
]);
const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceWork, "source-manifest.json"), "utf8"));
const originalSourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
const weekStarts = (originalSourceConfig.allocationSources || [])
  .map((source) => path.basename(source.path).match(/WeeklyLeadAllocationExport_(\d{4}-\d{2}-\d{2})_to_/)?.[1])
  .filter((value) => value && value <= start)
  .sort()
  .slice(-3);
if (weekStarts.length !== 3 || weekStarts.at(-1) !== start) throw new Error("Lead-type trends require the current week plus two prior retained allocation weeks.");

const overallReportDataPath = path.join(overallLeadDir, "report_data.json");
const overallVoicemailPath = path.join(overallManagementDir, "voicemail_report_data.json");
const overallCallPath = path.join(overallManagementDir, "call_activity_analysis.json");
const overallSalesPath = path.join(overallLeadDir, "sales_source_split.json");
const leadResultDir = path.join(overallLeadDir, "lead-result-dashboard");
const leadResultWorkbooks = (await fs.readdir(leadResultDir)).filter((name) => /^lead-result-dashboard_.*\.xlsx$/i.test(name));
if (leadResultWorkbooks.length !== 1) throw new Error(`Expected one Lead Result Dashboard workbook; found ${leadResultWorkbooks.length}.`);
const leadResultWorkbook = path.join(leadResultDir, leadResultWorkbooks[0]);
const carmaDatabase = path.join(overallLeadDir, "carma-evidence", "carma-evidence.sqlite");
for (const requiredPath of [overallReportDataPath, overallVoicemailPath, overallCallPath, overallSalesPath, leadResultWorkbook, carmaDatabase]) {
  if (!fsSync.existsSync(requiredPath)) throw new Error(`Required overall report input is missing: ${requiredPath}`);
}

const packs = {};
for (const leadType of ["New Business", "Warm"]) {
  const slug = leadType === "New Business" ? "new-business" : "warm";
  const labelSlug = leadType === "New Business" ? "New_Business" : "Warm";
  const packDir = path.join(outputRoot, slug);
  const scopeWork = path.join(workRoot, slug);
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(scopeWork, { recursive: true });
  const leadConfig = JSON.parse(await fs.readFile(sourceManifest.configs[leadType].leadConfigPath, "utf8"));
  const trendHistory = path.join(root, "data", "store", `lead-utilisation-trend-history-${slug}.json`);
  let currentLead = null;
  for (const weekStart of weekStarts) {
    const weekEnd = addDays(weekStart, 4);
    const current = weekStart === start;
    const reportDir = current ? packDir : path.join(scopeWork, "trend-build", `${weekStart}_to_${weekEnd}`);
    const allocation = sourceForWeek(leadConfig.allocationSources, "WeeklyLeadAllocationExport", weekStart);
    const calls = sourceForWeek(leadConfig.callSources.filter((source) => source.role === "weekly_supplement"), "WeeklyCallExport", weekStart);
    const roster = sourceManifest.rosterFiles[weekStart];
    if (!roster) throw new Error(`No full locked roster was generated for ${weekStart}.`);
    const workbook = path.join(reportDir, `Lead_Utilisation_and_Wastage_Report_${labelSlug}_Only_${weekStart}_to_${weekEnd}.xlsx`);
    run(`${leadType} Lead Utilisation ${weekStart}`, process.execPath, [
      "--max-old-space-size=16384", path.join(root, "scripts", "build-lead-utilisation-report.mjs"),
      "--allocation", allocation, "--calls", calls,
      "--start", weekStart, "--end", weekEnd,
      "--output", reportDir, "--filename", path.basename(workbook),
      "--manager-exclusions", managerExclusions.join(";"),
      "--salesperson-exclusions", salespersonExclusions.join(";"),
      "--exclusion-display", exclusionDisplay,
      "--trend-history", trendHistory,
      "--person-minimum-allocations", minimumAllocations,
      "--lead-type-scope", leadType,
      "--roster-report-data", roster,
    ]);
    if (current) currentLead = { workbook, data: path.join(reportDir, "report_data.json") };
  }

  run(`${leadType} approved-sales split`, process.execPath, [
    "--max-old-space-size=16384", path.join(root, "scripts", "build-weekly-lead-type-sales-splits.mjs"),
    "--workbook", leadResultWorkbook,
    "--database", carmaDatabase,
    "--source-config", sourceConfigPath,
    "--policy", policyPath,
    "--report-data", currentLead.data,
    "--output", scopeWork,
  ]);
  const salesSplit = path.join(scopeWork, slug, "sales_source_split.json");
  const leadPdf = path.join(packDir, `Lead_Utilisation_and_Wastage_Report_${labelSlug}_Only_${runId}.pdf`);
  run(`${leadType} Lead Utilisation PDF`, python, [
    path.join(root, "scripts", "render-lead-utilisation-pdf.py"),
    "--report-data", currentLead.data,
    "--sales-split", salesSplit,
    "--output", leadPdf,
    "--logo", logoPath,
  ]);

  const voicemailData = path.join(packDir, "voicemail_report_data.json");
  const voicemailQa = path.join(packDir, "voicemail_qa.json");
  const voicemailWorkbook = path.join(packDir, `Voicemail_Follow_Up_Report_${labelSlug}_Only_${runId}.xlsx`);
  run(`${leadType} Voicemail workbook`, process.execPath, [
    "--max-old-space-size=16384", path.join(root, "scripts", "build-weekly-voicemail-report.mjs"),
    "--root", root, "--start", start, "--output", packDir,
    "--filename", path.basename(voicemailWorkbook),
    "--source-config", sourceManifest.configs[leadType].voicemailConfigPath,
    "--report-data", voicemailData, "--qa", voicemailQa,
    "--work", path.join(scopeWork, "voicemail"),
    "--manager-exclusions", managerExclusions.join(";"),
    "--salesperson-exclusions", salespersonExclusions.join(";"),
    "--exclusion-display", exclusionDisplay,
    "--lead-type-scope", leadType,
  ]);
  const voicemailPdf = path.join(packDir, `Voicemail_Follow_Up_Report_${labelSlug}_Only_${runId}.pdf`);
  run(`${leadType} Voicemail PDF`, python, [path.join(root, "scripts", "render-weekly-voicemail-pdf.py"), "--data", voicemailData, "--output", voicemailPdf, "--logo", logoPath]);

  const callData = path.join(packDir, "call_activity_analysis.json");
  run(`${leadType} Call Activity analysis`, process.execPath, [
    path.join(root, "scripts", "build-call-activity-analysis.cjs"),
    "--current-report", currentLead.data,
    "--source-config", sourceManifest.configs[leadType].leadConfigPath,
    "--trend-history", trendHistory,
    "--output", callData,
    "--lead-type-scope", leadType,
  ]);
  const callWorkbook = path.join(packDir, `Call_Activity_and_Rhythm_Report_${labelSlug}_Only_${runId}.xlsx`);
  const callQa = path.join(packDir, "call_activity_qa.json");
  run(`${leadType} Call Activity workbook`, process.execPath, [
    "--max-old-space-size=16384", path.join(root, "scripts", "build-call-activity-rhythm-report.mjs"),
    "--analysis", callData, "--output", callWorkbook, "--qa", callQa, "--work", path.join(scopeWork, "call-activity"),
  ]);
  const callPdf = path.join(packDir, `Call_Activity_and_Rhythm_Report_${labelSlug}_Only_${runId}.pdf`);
  run(`${leadType} Call Activity PDF`, python, [path.join(root, "scripts", "render-call-activity-rhythm-pdf.py"), "--analysis", callData, "--output", callPdf, "--logo", logoPath]);

  const combinedStem = `Weekly_Lead_Management_Report_${labelSlug}_Only_${runId}`;
  const combinedCore = path.join(scopeWork, `${combinedStem}.core.xlsx`);
  const combinedWorkbook = path.join(packDir, `${combinedStem}.xlsx`);
  const combinedCoreQa = path.join(packDir, "combined_workbook_qa.json");
  run(`${leadType} combined core workbook`, process.execPath, [
    "--max-old-space-size=16384", path.join(root, "scripts", "build-combined-weekly-report.mjs"),
    "--root", root, "--lead-workbook", currentLead.workbook, "--voicemail-workbook", voicemailWorkbook,
    "--lead-data", currentLead.data, "--voicemail-data", voicemailData, "--call-data", callData,
    "--output", combinedCore, "--qa", combinedCoreQa, "--work", path.join(scopeWork, "combined-core"),
    "--lead-type-scope", leadType,
  ]);
  const combinedCallQa = path.join(packDir, "combined_call_activity_qa.json");
  run(`${leadType} combined Call Activity append`, process.execPath, [
    "--max-old-space-size=16384", path.join(root, "scripts", "build-call-activity-rhythm-report.mjs"),
    "--analysis", callData, "--base-workbook", combinedCore, "--output", combinedWorkbook,
    "--qa", combinedCallQa, "--work", path.join(scopeWork, "combined-call"),
  ]);
  const combinedPdf = path.join(packDir, `${combinedStem}.pdf`);
  run(`${leadType} combined PDF`, python, [
    path.join(root, "scripts", "render-combined-weekly-report-pdf.py"),
    "--lead-data", currentLead.data, "--voicemail-data", voicemailData, "--call-data", callData,
    "--lead-pdf", leadPdf, "--voicemail-pdf", voicemailPdf, "--call-pdf", callPdf,
    "--output", combinedPdf, "--logo", logoPath, "--work", path.join(scopeWork, "combined-pdf"),
    "--lead-type-scope", leadType,
  ]);
  packs[leadType] = { packDir, leadData: currentLead.data, voicemailData, callData, salesSplit, combinedWorkbook, combinedPdf };
}

const overallLead = JSON.parse(await fs.readFile(overallReportDataPath, "utf8"));
const overallVoicemail = JSON.parse(await fs.readFile(overallVoicemailPath, "utf8"));
const overallCall = JSON.parse(await fs.readFile(overallCallPath, "utf8"));
const overallSales = JSON.parse(await fs.readFile(overallSalesPath, "utf8"));
const scoped = {};
for (const [leadType, pack] of Object.entries(packs)) scoped[leadType] = {
  lead: JSON.parse(await fs.readFile(pack.leadData, "utf8")),
  voicemail: JSON.parse(await fs.readFile(pack.voicemailData, "utf8")),
  call: JSON.parse(await fs.readFile(pack.callData, "utf8")),
  sales: JSON.parse(await fs.readFile(pack.salesSplit, "utf8")),
};
const checks = [];
const addCheck = (section, metric, overall, newBusiness, warm) => checks.push({ section, metric, overall, newBusiness, warm, splitTotal: newBusiness + warm, passed: Math.abs(overall - newBusiness - warm) < 0.000001 });
for (const metric of ["received", "called", "wasted", "firstCallVoicemails", "followUpFailures", "outboundCalls", "allocatedLeadCallAttempts", "otherOutboundCalls"]) {
  addCheck("Lead Utilisation", metric, overallLead.totals[metric], scoped["New Business"].lead.totals[metric], scoped.Warm.lead.totals[metric]);
}
for (const metric of ["checked", "followed", "notByFriday", "noLater"]) {
  addCheck("Voicemail current", metric, overallVoicemail.totals[metric], scoped["New Business"].voicemail.totals[metric], scoped.Warm.voicemail.totals[metric]);
  addCheck("Voicemail previous", metric, overallVoicemail.previousTotals[metric], scoped["New Business"].voicemail.previousTotals[metric], scoped.Warm.voicemail.previousTotals[metric]);
}
for (const metric of ["calls", "durationObserved", "positiveDurationCalls", "zeroDurationCalls", "literalNoContactCalls", "nonLiteralCalls"]) {
  addCheck("Call Activity", metric, overallCall.weeks.at(-1).overall[metric], scoped["New Business"].call.weeks.at(-1).overall[metric], scoped.Warm.call.weeks.at(-1).overall[metric]);
}
addCheck("Approved Sales", "classifiedSales", overallSales.totals.classifiedSales, scoped["New Business"].sales.totals.classifiedSales, scoped.Warm.sales.totals.classifiedSales);
for (const series of overallLead.ongoingTrends.overall.series || []) {
  const newSeries = scoped["New Business"].lead.ongoingTrends.overall.series.find((row) => row.period.startDate === series.period.startDate);
  const warmSeries = scoped.Warm.lead.ongoingTrends.overall.series.find((row) => row.period.startDate === series.period.startDate);
  if (!newSeries || !warmSeries) throw new Error(`Scoped trend history is missing ${series.period.startDate}.`);
  for (const metric of ["received", "called", "wasted", "outboundCalls", "allocatedLeadCallAttempts", "otherOutboundCalls"]) {
    addCheck(`Historical trend ${series.period.startDate}`, metric, series.metrics[metric], newSeries.metrics[metric], warmSeries.metrics[metric]);
  }
}
const failed = checks.filter((row) => !row.passed);
const reconciliation = {
  schemaVersion: "weekly_lead_type_reconciliation.v1",
  status: failed.length ? "failed" : "complete",
  reportingPeriod: { start, end },
  policyVersion: sourceManifest.policy.version,
  checks,
  failedChecks: failed,
};
const reconciliationPath = path.join(outputRoot, "lead-type-reconciliation.json");
await fs.writeFile(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`, "utf8");
if (failed.length) throw new Error(`New Business + Warm reconciliation failed: ${failed.map((row) => `${row.section}/${row.metric}`).join(", ")}`);

const manifest = {
  schemaVersion: "weekly_lead_type_packs.v1",
  status: "complete",
  generatedAt: new Date().toISOString(),
  reportingPeriod: { start, end },
  policy: sourceManifest.policy,
  reconciliation: { fileName: path.basename(reconciliationPath), sha256: sha256(reconciliationPath), checks: checks.length },
  packs: Object.fromEntries(Object.entries(packs).map(([leadType, pack]) => [leadType, {
    workbook: { path: pack.combinedWorkbook, sha256: sha256(pack.combinedWorkbook) },
    pdf: { path: pack.combinedPdf, sha256: sha256(pack.combinedPdf) },
  }])),
};
const manifestPath = path.join(outputRoot, "lead-type-pack-manifest.json");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ manifestPath, reconciliationPath, checks: checks.length, packs: manifest.packs }, null, 2));
