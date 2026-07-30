"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_DIRECTORY = path.resolve(
  REPOSITORY_ROOT,
  "..",
  "Carma Reports"
);
const DESTINATION_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "docs",
  "carma-map"
);

const FILES = [
  {
    source: "CARMA-APPLICATION-MAP.md",
    destination: "CARMA-APPLICATION-MAP.md"
  },
  {
    source: "CARMA-REPORT-CATALOG.md",
    destination: "CARMA-REPORT-CATALOG.md"
  },
  {
    source: "CARMA-MAPPING-GAPS.md",
    destination: "CARMA-MAPPING-GAPS.md"
  },
  {
    source: "mapping/carma-read-only-inventory.json",
    destination: "carma-read-only-inventory.json"
  },
  {
    source: "mapping/retained-navigation-evidence-2026-07-24.json",
    destination: "retained-navigation-evidence-2026-07-24.json"
  },
  {
    source: "mapping/cached-report-evidence.json",
    destination: "cached-report-evidence.json"
  }
];

const FORBIDDEN_CONTENT = [
  { label: "GitHub token", pattern: /gh[opsu]_[A-Za-z0-9_]+/ },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "Crystal session state", pattern: /__CRYSTALSTATE/i },
  { label: "Crystal context identifier", pattern: /ContextIDCrystalReportViewer/i },
  { label: "saved credential file", pattern: /carma-credential\.clixml/i },
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  }
];

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source-dir" && argv[index + 1]) {
      parsed.sourceDirectory = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function inspectSensitiveContent(relativePath, content) {
  for (const rule of FORBIDDEN_CONTENT) {
    if (rule.pattern.test(content)) {
      throw new Error(
        `${relativePath} contains forbidden ${rule.label} content.`
      );
    }
  }
}

function parseJson(relativePath, buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${relativePath} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function validateInventory(inventory) {
  if (
    inventory.schemaVersion !==
    "carma_read_only_navigation_report_inventory.v1"
  ) {
    throw new Error("Unsupported Carma map inventory schema.");
  }
  if (inventory.safetyPolicy?.mode !== "strict_read_only") {
    throw new Error("Carma map is not marked strict read-only.");
  }
  if (
    inventory.currentPass?.mutationsPerformed !== 0 ||
    inventory.currentPass?.businessRecordsSelected !== 0
  ) {
    throw new Error("Carma map records a mutation or selected business row.");
  }
  if (
    inventory.currentPass?.authentication?.credentialOrCodeCaptured !== false ||
    inventory.currentPass?.authentication?.loginScreenshotCaptured !== false
  ) {
    throw new Error("Carma map authentication privacy counters are unsafe.");
  }
}

function validateSupportingEvidence(fileName, value) {
  const expectedSchemas = {
    "retained-navigation-evidence-2026-07-24.json":
      "carma_retained_navigation_evidence.v1",
    "cached-report-evidence.json": "carma_cached_report_evidence.v1"
  };
  if (value.schemaVersion !== expectedSchemas[fileName]) {
    throw new Error(`Unsupported schema in ${fileName}.`);
  }
}

function synchronize(sourceDirectory = DEFAULT_SOURCE_DIRECTORY) {
  if (!fs.existsSync(sourceDirectory)) {
    throw new Error(`Carma Reports source directory is missing.`);
  }
  fs.mkdirSync(DESTINATION_DIRECTORY, { recursive: true });

  const stagedFiles = [];
  let inventory = null;

  for (const entry of FILES) {
    const sourcePath = path.resolve(sourceDirectory, entry.source);
    const sourceRelativePath = path.relative(sourceDirectory, sourcePath);
    if (
      sourceRelativePath.startsWith("..") ||
      path.isAbsolute(sourceRelativePath)
    ) {
      throw new Error(`Source path escapes the Carma Reports directory.`);
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Required sanitized map file is missing: ${entry.source}`);
    }

    const buffer = fs.readFileSync(sourcePath);
    inspectSensitiveContent(entry.source, buffer.toString("utf8"));

    if (entry.destination.endsWith(".json")) {
      const parsed = parseJson(entry.source, buffer);
      if (entry.destination === "carma-read-only-inventory.json") {
        validateInventory(parsed);
        inventory = parsed;
      } else {
        validateSupportingEvidence(entry.destination, parsed);
      }
    }

    const destinationPath = path.join(
      DESTINATION_DIRECTORY,
      entry.destination
    );
    fs.copyFileSync(sourcePath, destinationPath);
    stagedFiles.push({
      sourceRelativePath: entry.source.replaceAll("\\", "/"),
      destination: `docs/carma-map/${entry.destination}`,
      bytes: buffer.length,
      sha256: sha256(buffer)
    });
  }

  const customerManagement = (inventory.screens || []).find(
    (screen) => screen.id === "screen.customer_management"
  );
  const manifest = {
    schemaVersion: "sales_dashboard_carma_map_snapshot.v1",
    generatedAt: new Date().toISOString(),
    sourceRootName: path.basename(sourceDirectory),
    privacy:
      "Sanitized structural map only. No raw CRM rows, customer/contact values, credentials, one-time codes, browser state or session values are included.",
    status: inventory.scope?.currentStatus || "unknown",
    counts: {
      navigationEntries: (inventory.navigation || []).length,
      placedReports: (inventory.reports || []).length,
      screens: (inventory.screens || []).length,
      customerManagementTabs:
        customerManagement?.contextualTabs?.length || 0,
      cachedTechnicalReportFiles:
        inventory.cachedReportEvidence?.technicalReportFiles || 0,
      mutationsPerformed: inventory.currentPass?.mutationsPerformed,
      businessRecordsSelected: inventory.currentPass?.businessRecordsSelected
    },
    files: stagedFiles
  };

  const manifestPath = path.join(
    DESTINATION_DIRECTORY,
    "snapshot-manifest.json"
  );
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return {
    destination: path.relative(REPOSITORY_ROOT, DESTINATION_DIRECTORY),
    ...manifest.counts,
    snapshotFiles: stagedFiles.length + 1
  };
}

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  try {
    process.stdout.write(
      `${JSON.stringify(synchronize(options.sourceDirectory), null, 2)}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_SOURCE_DIRECTORY,
  DESTINATION_DIRECTORY,
  FILES,
  synchronize
};
