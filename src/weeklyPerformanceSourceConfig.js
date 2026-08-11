"use strict";

const fs = require("node:fs");
const path = require("node:path");

function pathKey(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function retainWeeklySources(options) {
  const existing = Array.isArray(options.sources) ? options.sources : [];
  const candidates = [
    ...existing.filter((source) => String(source?.role || "") === options.role),
    ...(!existing.some((source) => String(source?.role || "") === options.role) && options.legacyPath
      ? [{ path: options.legacyPath, role: options.role, ...(options.defaults || {}) }]
      : []),
    { path: options.newPath, role: options.role, ...(options.defaults || {}) },
  ];
  const result = [];
  const seen = new Set();
  for (const source of candidates) {
    const sourcePath = path.resolve(String(source?.path || ""));
    if (!sourcePath || (!options.allowMissing && !fs.existsSync(sourcePath))) continue;
    const key = pathKey(sourcePath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...source, path: sourcePath, role: options.role });
  }
  return result;
}

module.exports = { retainWeeklySources };
