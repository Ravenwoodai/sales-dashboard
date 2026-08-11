"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("top-level agent instructions enforce the catalog-first data gate", () => {
  const agents = read("AGENTS.md");
  const dataLayer = read("docs/CARMA_DATA_LAYER.md");
  const instructions = read("agent/INSTRUCTIONS.md");

  assert.ok(
    agents.indexOf("/docs/CARMA_DATA_LAYER.md") < agents.indexOf("/docs/PROJECT.md"),
    "Carma data-layer instructions must remain ahead of general project context"
  );
  for (const requiredText of [
    "Mandatory Data-Catalog Preflight",
    "the first data-discovery action must be to inspect `data/carma/catalog.json`",
    "Do not claim that data is missing",
    "Do not start or recommend a new Carma extraction",
    "state a brief catalog receipt"
  ]) {
    assert.match(agents, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(dataLayer, /Mandatory catalog-first gate/);
  assert.match(dataLayer, /An agent may not claim data is unavailable/);
  assert.match(instructions, /Agents must not say data is unavailable/);
  assert.match(instructions, /Record the catalog key, coverage checked, source selected and material limitation/);
});
