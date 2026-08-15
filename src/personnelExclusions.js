"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXCLUSION_SCHEMA = "sales_dashboard_personnel_exclusions.v1";
const DEFAULT_LOCAL_PATH = path.join(__dirname, "..", "data", "store", "personnel-exclusions.json");
const EXCLUDED_PERSONNEL = [];

function normalizePersonnelName(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const EXCLUDED_PERSONNEL_KEYS = new Set();

function configurePersonnelExclusions(values) {
  const labels = [...new Map((values || [])
    .map((value) => String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " "))
    .filter(Boolean)
    .map((label) => [normalizePersonnelName(label), label]))
    .values()];
  EXCLUDED_PERSONNEL.splice(0, EXCLUDED_PERSONNEL.length, ...labels);
  EXCLUDED_PERSONNEL_KEYS.clear();
  labels.forEach((label) => EXCLUDED_PERSONNEL_KEYS.add(normalizePersonnelName(label)));
  return [...EXCLUDED_PERSONNEL];
}

function loadPersonnelExclusions(filePath = process.env.SALES_DASHBOARD_PERSONNEL_EXCLUSIONS_PATH || DEFAULT_LOCAL_PATH) {
  if (!filePath || !fs.existsSync(filePath)) return configurePersonnelExclusions([]);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.schemaVersion !== EXCLUSION_SCHEMA || !Array.isArray(parsed.excludedPersonnel)) {
    throw new Error("Unsupported personnel-exclusions configuration.");
  }
  return configurePersonnelExclusions(parsed.excludedPersonnel);
}

loadPersonnelExclusions();

function isExcludedPersonnel(value) {
  return EXCLUDED_PERSONNEL_KEYS.has(normalizePersonnelName(value));
}

function visiblePersonnelLabel(value, fallback = "Unknown") {
  const label = String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
  if (!label) return fallback;
  return isExcludedPersonnel(label) ? "Excluded personnel" : label;
}

function visibleManagerLabel(value, fallback = "Unknown") {
  const label = String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
  return label || fallback;
}

module.exports = {
  EXCLUSION_SCHEMA,
  EXCLUDED_PERSONNEL,
  configurePersonnelExclusions,
  isExcludedPersonnel,
  loadPersonnelExclusions,
  normalizePersonnelName,
  visibleManagerLabel,
  visiblePersonnelLabel
};
