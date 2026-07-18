"use strict";

const fs = require("fs");
const path = require("path");
const { isEvaluationStudioSqliteStub, loadEvaluationStudio, resolveEvaluationStudioDbPath } = require("../src/evaluationStudioDatabase");
const { readStore, resolveStorePath, writeStore } = require("../src/storage");

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function main() {
  const storePath = resolveStorePath({});
  if (!fs.existsSync(storePath)) throw new Error(`State store does not exist: ${storePath}`);
  const rawStore = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (isEvaluationStudioSqliteStub(rawStore.evaluationStudio)) {
    const loaded = loadEvaluationStudio({ storePath });
    process.stdout.write(`${JSON.stringify({
      status: "already_migrated",
      storePath,
      dbPath: loaded.dbPath,
      contentHash: loaded.contentHash,
      counts: loaded.counts
    }, null, 2)}\n`);
    return;
  }

  const backupPath = path.join(
    path.dirname(storePath),
    `${path.basename(storePath, path.extname(storePath))}.pre-evaluation-studio-sqlite-${timestampForFile()}.json`
  );
  fs.copyFileSync(storePath, backupPath, fs.constants.COPYFILE_EXCL);
  const hydrated = readStore({ storePath });
  const expectedCounts = {
    knowledgebaseEntries: hydrated.evaluationStudio.knowledgebaseEntries.length,
    evaluationTemplates: hydrated.evaluationStudio.evaluationTemplates.length,
    evaluationRuns: hydrated.evaluationStudio.evaluationRuns.length,
    evaluationResults: hydrated.evaluationStudio.evaluationResults.length
  };
  writeStore(hydrated, { storePath });
  const persistedRaw = JSON.parse(fs.readFileSync(storePath, "utf8"));
  if (!isEvaluationStudioSqliteStub(persistedRaw.evaluationStudio)) {
    throw new Error("Migration did not replace embedded Evaluation Studio history with a SQLite pointer.");
  }
  const loaded = loadEvaluationStudio({ storePath });
  if (JSON.stringify(loaded.counts) !== JSON.stringify(expectedCounts)) {
    throw new Error(`Migration count verification failed: expected ${JSON.stringify(expectedCounts)}, received ${JSON.stringify(loaded.counts)}.`);
  }
  const readBack = readStore({ storePath });
  const readBackCounts = {
    knowledgebaseEntries: readBack.evaluationStudio.knowledgebaseEntries.length,
    evaluationTemplates: readBack.evaluationStudio.evaluationTemplates.length,
    evaluationRuns: readBack.evaluationStudio.evaluationRuns.length,
    evaluationResults: readBack.evaluationStudio.evaluationResults.length
  };
  if (JSON.stringify(readBackCounts) !== JSON.stringify(expectedCounts)) {
    throw new Error("Hydrated state-store verification failed after migration.");
  }
  process.stdout.write(`${JSON.stringify({
    status: "migrated_and_verified",
    storePath,
    backupPath,
    dbPath: resolveEvaluationStudioDbPath({ storePath }),
    contentHash: loaded.contentHash,
    counts: loaded.counts
  }, null, 2)}\n`);
}

main();
