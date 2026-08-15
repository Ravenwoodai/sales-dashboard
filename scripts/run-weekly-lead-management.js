"use strict";

const path = require("node:path");
const { runWeeklyLeadManagement } = require("../src/weeklyLeadManagementOrchestrator");

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return args;
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const usage = "Usage: --config <weekly-orchestration.json> --start YYYY-MM-DD [--dry-run] [--acquire] [--send-email]";
  if (args.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (!args.config || !args.start) throw new Error(usage);
  const result = await runWeeklyLeadManagement({
    root: path.resolve(__dirname, ".."),
    configPath: path.resolve(String(args.config)),
    startDate: String(args.start),
    dryRun: Boolean(args["dry-run"]),
    acquire: Boolean(args.acquire),
    sendEmail: Boolean(args["send-email"]),
  });
  process.stdout.write(`${JSON.stringify({
    status: result.manifest.status,
    manifestPath: result.manifestPath,
    outputDir: result.outputDir || "",
    reportWorkbook: result.combinedWorkbook || "",
    reportPdf: result.combinedPdf || "",
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Weekly Lead Management orchestration failed: ${error.message}\n`);
  process.exitCode = 1;
});
