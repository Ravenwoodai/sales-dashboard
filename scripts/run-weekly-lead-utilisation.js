"use strict";

const path = require("node:path");
const { runWeeklyLeadUtilisation } = require("../src/weeklyLeadUtilisationOrchestrator");

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
  if (args.help) {
    process.stdout.write("Usage: --config <weekly-orchestration.json> --start YYYY-MM-DD [--dry-run] [--acquire] [--send-email]\n");
    return;
  }
  if (!args.config || !args.start) {
    throw new Error("Usage: --config <weekly-orchestration.json> --start YYYY-MM-DD [--dry-run] [--acquire] [--send-email]");
  }
  const result = await runWeeklyLeadUtilisation({
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
    reportWorkbook: result.reportWorkbook || "",
    reportPdf: result.reportPdf || "",
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Weekly Lead Utilisation orchestration failed: ${error.message}\n`);
  process.exitCode = 1;
});
