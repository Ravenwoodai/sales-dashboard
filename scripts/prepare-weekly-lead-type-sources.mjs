import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseCsv } = require("../src/csvParser.js");
const {
  NEW_BUSINESS,
  WARM,
  buildAllocationIndexes,
  classifyCall,
  classifyCampaign,
  clean,
  loadPolicy,
  norm,
  parseLocalTimestamp,
} = require("../src/weeklyLeadTypePolicy.js");

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
for (const required of ["source-config", "policy", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}
const sourceConfigPath = path.resolve(String(args["source-config"]));
const outputRoot = path.resolve(String(args.output));
const { policy, campaignTypes, policyPath } = loadPolicy(path.resolve(String(args.policy)));
const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
const listArg = (value) => clean(value) ? String(value).split(";").map(clean).filter(Boolean) : [];
const managerExclusions = new Set(listArg(args["manager-exclusions"]).map(norm));
const salespersonExclusions = new Set(listArg(args["salesperson-exclusions"]).map(norm));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeCsv(filePath, headers, rows) {
  const text = `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
  return { path: filePath, rows: rows.length, sha256: sha256(text) };
}

function uniqueSources(primary, list, role, dateOrder) {
  const result = [];
  const seen = new Set();
  for (const source of [...(list || []), ...(primary ? [{ path: primary, role, dateOrder }] : [])]) {
    if (!source?.path) continue;
    const resolved = path.resolve(String(source.path));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push({ ...source, path: resolved, role: source.role || role, dateOrder: source.dateOrder || dateOrder });
  }
  return result;
}

function sourceStem(sourcePath) {
  return path.basename(sourcePath).replace(/_[a-f0-9]{12}(?=\.csv$)/i, "");
}

function periodFromAllocationFile(sourcePath) {
  const match = path.basename(sourcePath).match(/WeeklyLeadAllocationExport_(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const friday = new Date(`${match[1]}T00:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() + 4);
  return { startDate: match[1], endDate: friday.toISOString().slice(0, 10), sourceEndDate: match[2] };
}

const allocationSources = uniqueSources(sourceConfig.allocationLogPath, sourceConfig.allocationSources, "weekly_allocation", "month_first");
const callSources = uniqueSources(sourceConfig.callCsvPath, [
  ...(sourceConfig.callSources || []),
  ...(sourceConfig.primaryCallCsvPath ? [{ path: sourceConfig.primaryCallCsvPath, role: "primary_history", dateOrder: "day_first" }] : []),
], "weekly_supplement", "month_first");
if (!allocationSources.length || !callSources.length) throw new Error("The performance source configuration must contain allocation and call sources.");

const allocationRows = [];
const allocationFiles = [];
const allocationOutputBySource = new Map();
const rosterFiles = {};
for (const source of allocationSources) {
  const text = await fs.readFile(source.path, "utf8");
  const parsed = parseCsv(text);
  const rows = parsed.rows;
  for (const row of rows) {
    classifyCampaign(row.AllocationName, campaignTypes);
    allocationRows.push(row);
  }
  const outputs = {};
  for (const leadType of [NEW_BUSINESS, WARM]) {
    const slug = leadType === NEW_BUSINESS ? "new-business" : "warm";
    const selected = rows.filter((row) => classifyCampaign(row.AllocationName, campaignTypes) === leadType);
    outputs[leadType] = await writeCsv(path.join(outputRoot, slug, "sources", sourceStem(source.path)), parsed.columns, selected);
  }
  allocationOutputBySource.set(source.path, outputs);
  allocationFiles.push({ sourcePath: source.path, sourceRows: rows.length, outputs });

  const period = periodFromAllocationFile(source.path);
  if (period) {
    const roster = new Map();
    const start = parseLocalTimestamp(period.startDate, "00:00:00");
    const end = parseLocalTimestamp(period.endDate, "23:59:59");
    for (const row of rows) {
      const timestamp = parseLocalTimestamp(row.DateSentToSalesperson_Date, row.DateSentToSalesperson_Time);
      const manager = clean(row.SalesManager) || "Unassigned / Missing Manager";
      const salesperson = clean(row.FullName) || "Unassigned / Missing Salesperson";
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) continue;
      if (managerExclusions.has(norm(manager)) || salespersonExclusions.has(norm(salesperson))) continue;
      if (!roster.has(norm(salesperson))) roster.set(norm(salesperson), { salesperson, manager });
    }
    const rosterPath = path.join(outputRoot, "shared", "rosters", `${period.startDate}_to_${period.endDate}.json`);
    await fs.mkdir(path.dirname(rosterPath), { recursive: true });
    await fs.writeFile(rosterPath, `${JSON.stringify({ reportingPeriod: period, salespeople: [...roster.values()] }, null, 2)}\n`, "utf8");
    rosterFiles[period.startDate] = rosterPath;
  }
}

const indexes = buildAllocationIndexes(allocationRows, campaignTypes);
const callFiles = [];
const filteredCallOutputBySource = new Map();
const augmentedCallOutputBySource = new Map();
const ruleCounts = {};
for (const source of callSources) {
  const text = await fs.readFile(source.path, "utf8");
  const parsed = parseCsv(text);
  const headers = [...parsed.columns, "ReportLeadType", "ReportLeadTypeRule", "ReportLeadTypeAllocationPerson", "ReportLeadTypeAllocationCampaign"];
  const augmented = parsed.rows.map((row) => {
    const result = classifyCall(row, indexes, { dateOrder: source.dateOrder });
    ruleCounts[result.rule] = (ruleCounts[result.rule] || 0) + 1;
    return {
      ...row,
      ReportLeadType: result.leadType,
      ReportLeadTypeRule: result.rule,
      ReportLeadTypeAllocationPerson: result.allocation?.salesperson || "",
      ReportLeadTypeAllocationCampaign: result.allocation?.allocationName || "",
    };
  });
  const augmentedOutput = await writeCsv(path.join(outputRoot, "shared", "sources", sourceStem(source.path)), headers, augmented);
  augmentedCallOutputBySource.set(source.path, augmentedOutput);
  const outputs = {};
  for (const leadType of [NEW_BUSINESS, WARM]) {
    const slug = leadType === NEW_BUSINESS ? "new-business" : "warm";
    outputs[leadType] = await writeCsv(
      path.join(outputRoot, slug, "sources", sourceStem(source.path)),
      headers,
      augmented.filter((row) => row.ReportLeadType === leadType),
    );
  }
  filteredCallOutputBySource.set(source.path, outputs);
  callFiles.push({ sourcePath: source.path, sourceRows: parsed.rows.length, augmentedOutput, outputs });
}

const configs = {};
for (const leadType of [NEW_BUSINESS, WARM]) {
  const slug = leadType === NEW_BUSINESS ? "new-business" : "warm";
  const allocationPath = allocationOutputBySource.get(path.resolve(String(sourceConfig.allocationLogPath)))?.[leadType]?.path || "";
  const callPath = filteredCallOutputBySource.get(path.resolve(String(sourceConfig.callCsvPath)))?.[leadType]?.path || "";
  const leadConfig = {
    ...sourceConfig,
    allocationLogPath: allocationPath,
    allocationSources: allocationSources.map((source) => ({ ...source, path: allocationOutputBySource.get(source.path)[leadType].path })),
    primaryCallCsvPath: sourceConfig.primaryCallCsvPath ? filteredCallOutputBySource.get(path.resolve(String(sourceConfig.primaryCallCsvPath)))?.[leadType]?.path || "" : "",
    callCsvPath: callPath,
    callSources: callSources.map((source) => ({ ...source, path: filteredCallOutputBySource.get(source.path)[leadType].path })),
    leadTypeScope: { leadType, policyVersion: policy.policyVersion },
  };
  const voicemailConfig = {
    ...sourceConfig,
    allocationSources,
    callSources: callSources.map((source) => ({ ...source, path: augmentedCallOutputBySource.get(source.path).path })),
    leadTypeScope: { leadType, policyVersion: policy.policyVersion },
  };
  const leadConfigPath = path.join(outputRoot, slug, "performance-cohorts.json");
  const voicemailConfigPath = path.join(outputRoot, slug, "voicemail-performance-cohorts.json");
  await fs.mkdir(path.dirname(leadConfigPath), { recursive: true });
  await fs.writeFile(leadConfigPath, `${JSON.stringify(leadConfig, null, 2)}\n`, "utf8");
  await fs.writeFile(voicemailConfigPath, `${JSON.stringify(voicemailConfig, null, 2)}\n`, "utf8");
  configs[leadType] = { leadConfigPath, voicemailConfigPath };
}

const manifest = {
  schemaVersion: "weekly_lead_type_sources.v1",
  generatedAt: new Date().toISOString(),
  policy: { path: policyPath, version: policy.policyVersion, campaignRules: campaignTypes.size },
  allocationFiles,
  callFiles,
  rosterFiles,
  ruleCounts,
  configs,
};
const manifestPath = path.join(outputRoot, "source-manifest.json");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ manifestPath, policy: manifest.policy, ruleCounts, configs, rosterFiles }, null, 2));
