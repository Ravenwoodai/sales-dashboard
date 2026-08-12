import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
for (const required of ["mapping", "inventory", "overrides", "output"]) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}

const clean = (value) => String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
const norm = (value) => clean(value).toLowerCase();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function rowsFromTsv(lines) {
  const headers = lines[0].split("\t");
  return lines.slice(1).filter((line) => line.trim()).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

const mappingPath = path.resolve(String(args.mapping));
const inventoryPath = path.resolve(String(args.inventory));
const overridesPath = path.resolve(String(args.overrides));
const outputPath = path.resolve(String(args.output));
const mappingText = await fs.readFile(mappingPath, "utf8");
const inventoryText = await fs.readFile(inventoryPath, "utf8");
const overridesText = await fs.readFile(overridesPath, "utf8");
const lines = mappingText.replace(/\r/g, "").split("\n");
const blank = lines.findIndex((line) => !line.trim());
if (blank < 1) throw new Error("Campaign mapping does not contain the expected two sections.");
const otherRows = rowsFromTsv(lines.slice(0, blank));
let familyStart = blank + 1;
while (!lines[familyStart]?.trim()) familyStart += 1;
const familyRows = rowsFromTsv(lines.slice(familyStart));
const otherTypes = new Map(otherRows.map((row) => [norm(row["Exact Campaign Name"]), clean(row["LEAD TYPE"])]));
const familyTypes = new Map(familyRows.map((row) => [norm(row["Campaign Family"]), clean(row["LEAD TYPE"])]));
const inventory = JSON.parse(inventoryText);
const exact = new Map();
for (const row of inventory.rows || []) {
  const name = clean(row.exact_campaign_name);
  const leadType = norm(row.family) === "other" ? otherTypes.get(norm(name)) : familyTypes.get(norm(row.family));
  if (!["New Business", "Warm"].includes(leadType)) throw new Error(`No lead type for campaign: ${name}`);
  const key = norm(name);
  if (exact.has(key) && exact.get(key).leadType !== leadType) throw new Error(`Conflicting lead type for campaign: ${name}`);
  if (!exact.has(key)) exact.set(key, { exactCampaignName: name, leadType });
}
const overrides = JSON.parse(overridesText).rules || [];
for (const row of overrides) {
  const name = clean(row.exactCampaignName);
  const leadType = clean(row.leadType);
  if (!["New Business", "Warm"].includes(leadType)) throw new Error(`Invalid override lead type for: ${name}`);
  const key = norm(name);
  if (exact.has(key) && exact.get(key).leadType !== leadType) throw new Error(`Override conflicts with the retained campaign mapping: ${name}`);
  exact.set(key, { exactCampaignName: name, leadType });
}

const policy = {
  schemaVersion: "weekly_lead_type_policy.v1",
  policyVersion: "2026-08-12.1",
  labels: ["New Business", "Warm"],
  callRules: [
    "No permitted customer ID means New Business.",
    "Use the latest exact customer-and-salesperson allocation at or before the call when one exists.",
    "A customer absent from all available allocation logs means New Business.",
    "Otherwise use the exact salesperson's earliest later allocation, then the customer's latest earlier allocation, then the customer's earliest later allocation.",
    "If that nearest allocation person is Admin or Admin User, classify the call as Warm.",
    "Otherwise use the mapped lead type of that nearest allocation campaign."
  ],
  salesRules: [
    "Self Sourced approved sales are New Business.",
    "Sale From Allocated Lead uses the latest exact seller allocation before approval and its mapped campaign lead type.",
    "The 35 manager-reviewed historical campaign overrides are Warm."
  ],
  sources: {
    mappingSha256: sha256(mappingText),
    inventorySha256: sha256(inventoryText),
    overridesSha256: sha256(overridesText),
    compiledAt: new Date().toISOString()
  },
  campaignRules: [...exact.values()].sort((a, b) => a.exactCampaignName.localeCompare(b.exactCampaignName)),
  historicalOverrideCount: overrides.length
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, campaignRules: policy.campaignRules.length, historicalOverrideCount: policy.historicalOverrideCount, sources: policy.sources }, null, 2));
