"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { normalizeEvaluationStudio } = require("./evaluationStudio");

const EVALUATION_STUDIO_DB_SCHEMA_VERSION = "sales_dashboard_evaluation_studio_db.v1";
const EVALUATION_STUDIO_SQLITE_MODE = "sqlite";
const COLLECTIONS = Object.freeze([
  ["knowledgebaseEntries", "evaluation_knowledgebase_entries"],
  ["evaluationTemplates", "evaluation_templates"],
  ["evaluationRuns", "evaluation_runs"],
  ["evaluationResults", "evaluation_results"]
]);

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function resolveEvaluationStudioDbPath(options = {}) {
  if (options.evaluationStudioDbPath) return path.resolve(options.evaluationStudioDbPath);
  if (process.env.SALES_DASHBOARD_EVALUATION_STUDIO_DB_PATH) {
    return path.resolve(process.env.SALES_DASHBOARD_EVALUATION_STUDIO_DB_PATH);
  }
  const storePath = path.resolve(options.storePath || process.env.SALES_DASHBOARD_STORE_PATH || path.join(process.cwd(), "data", "store", "state.json"));
  return path.join(path.dirname(storePath), "evaluation-studio.sqlite");
}

function migrateEvaluationStudioDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_knowledgebase_entries (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      category TEXT,
      approval_status TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_templates (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      evaluation_goal TEXT,
      version INTEGER,
      is_active INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_runs (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      import_id TEXT,
      template_id TEXT,
      evaluation_goal TEXT,
      status TEXT,
      run_type TEXT,
      created_at TEXT,
      updated_at TEXT,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_results (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      import_id TEXT,
      call_id TEXT,
      run_id TEXT,
      template_id TEXT,
      evaluation_goal TEXT,
      status TEXT,
      is_latest INTEGER NOT NULL DEFAULT 1,
      template_version INTEGER,
      result_version INTEGER,
      updated_at TEXT,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eval_templates_goal_active ON evaluation_templates(evaluation_goal, is_active);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_import_status ON evaluation_runs(import_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_import_goal ON evaluation_runs(import_id, evaluation_goal, created_at);
    CREATE INDEX IF NOT EXISTS idx_eval_results_import_call ON evaluation_results(import_id, call_id, is_latest);
    CREATE INDEX IF NOT EXISTS idx_eval_results_import_goal ON evaluation_results(import_id, evaluation_goal, is_latest);
    CREATE INDEX IF NOT EXISTS idx_eval_results_run ON evaluation_results(run_id);
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run("schema_version", EVALUATION_STUDIO_DB_SCHEMA_VERSION);
}

function openEvaluationStudioDb(options = {}) {
  const dbPath = resolveEvaluationStudioDbPath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = FULL;");
  migrateEvaluationStudioDb(db);
  return db;
}

function runTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function collectionRows(studio, key) {
  return (studio[key] || []).map((payload, sortOrder) => {
    const payloadJson = JSON.stringify(payload);
    return {
      id: String(payload.id || "").trim(),
      sortOrder,
      payload,
      payloadJson,
      payloadHash: digest(payloadJson)
    };
  });
}

function requireRowIds(rows, key) {
  const ids = new Set();
  rows.forEach((row) => {
    if (!row.id) throw new Error(`Evaluation Studio ${key} contains a record without an ID.`);
    if (ids.has(row.id)) throw new Error(`Evaluation Studio ${key} contains duplicate ID ${row.id}.`);
    ids.add(row.id);
  });
}

function rowValues(table, row) {
  const payload = row.payload;
  if (table === "evaluation_knowledgebase_entries") return [
    row.id, row.sortOrder, payload.category || "", payload.approvalStatus || "", payload.isActive ? 1 : 0,
    payload.updatedAt || "", row.payloadHash, row.payloadJson
  ];
  if (table === "evaluation_templates") return [
    row.id, row.sortOrder, payload.evaluationGoal || "", Number(payload.version || 1), payload.isActive ? 1 : 0,
    payload.updatedAt || "", row.payloadHash, row.payloadJson
  ];
  if (table === "evaluation_runs") return [
    row.id, row.sortOrder, payload.importId || "", payload.templateId || "",
    payload.templateSnapshot?.evaluationGoal || payload.evaluationGoal || "", payload.status || "", payload.runType || "",
    payload.createdAt || "", payload.updatedAt || "", row.payloadHash, row.payloadJson
  ];
  return [
    row.id, row.sortOrder, payload.importId || "", payload.callId || "", payload.runId || "", payload.templateId || "",
    payload.evaluationGoal || "", payload.status || "", payload.isLatest === false ? 0 : 1,
    Number(payload.templateVersion || 1), Number(payload.resultVersion || 1), payload.updatedAt || "",
    row.payloadHash, row.payloadJson
  ];
}

function upsertSql(table) {
  if (table === "evaluation_knowledgebase_entries") return `
    INSERT INTO ${table} (id, sort_order, category, approval_status, is_active, updated_at, payload_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, category=excluded.category,
      approval_status=excluded.approval_status, is_active=excluded.is_active, updated_at=excluded.updated_at,
      payload_hash=excluded.payload_hash, payload_json=excluded.payload_json
    WHERE ${table}.payload_hash <> excluded.payload_hash OR ${table}.sort_order <> excluded.sort_order`;
  if (table === "evaluation_templates") return `
    INSERT INTO ${table} (id, sort_order, evaluation_goal, version, is_active, updated_at, payload_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, evaluation_goal=excluded.evaluation_goal,
      version=excluded.version, is_active=excluded.is_active, updated_at=excluded.updated_at,
      payload_hash=excluded.payload_hash, payload_json=excluded.payload_json
    WHERE ${table}.payload_hash <> excluded.payload_hash OR ${table}.sort_order <> excluded.sort_order`;
  if (table === "evaluation_runs") return `
    INSERT INTO ${table} (id, sort_order, import_id, template_id, evaluation_goal, status, run_type, created_at, updated_at, payload_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, import_id=excluded.import_id,
      template_id=excluded.template_id, evaluation_goal=excluded.evaluation_goal, status=excluded.status,
      run_type=excluded.run_type, created_at=excluded.created_at, updated_at=excluded.updated_at,
      payload_hash=excluded.payload_hash, payload_json=excluded.payload_json
    WHERE ${table}.payload_hash <> excluded.payload_hash OR ${table}.sort_order <> excluded.sort_order`;
  return `
    INSERT INTO ${table} (id, sort_order, import_id, call_id, run_id, template_id, evaluation_goal, status, is_latest,
      template_version, result_version, updated_at, payload_hash, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, import_id=excluded.import_id,
      call_id=excluded.call_id, run_id=excluded.run_id, template_id=excluded.template_id,
      evaluation_goal=excluded.evaluation_goal, status=excluded.status, is_latest=excluded.is_latest,
      template_version=excluded.template_version, result_version=excluded.result_version, updated_at=excluded.updated_at,
      payload_hash=excluded.payload_hash, payload_json=excluded.payload_json
    WHERE ${table}.payload_hash <> excluded.payload_hash OR ${table}.sort_order <> excluded.sort_order`;
}

function syncCollection(db, table, rows) {
  const existing = new Set(db.prepare(`SELECT id FROM ${table}`).all().map((row) => row.id));
  const upsert = db.prepare(upsertSql(table));
  rows.forEach((row) => {
    upsert.run(...rowValues(table, row));
    existing.delete(row.id);
  });
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  existing.forEach((id) => remove.run(id));
}

function studioIndexHash(metadataJson, collections) {
  return digest(JSON.stringify({
    metadataHash: digest(metadataJson),
    collections: Object.fromEntries(collections.map(([key, _table, rows]) => [
      key,
      rows.map((row) => [row.id, row.sortOrder, row.payloadHash])
    ]))
  }));
}

function syncEvaluationStudio(studioValue, options = {}) {
  const studio = normalizeEvaluationStudio(studioValue);
  const metadata = Object.fromEntries(Object.entries(studio).filter(([key]) =>
    !COLLECTIONS.some(([collectionKey]) => collectionKey === key) && key !== "storage"
  ));
  const metadataJson = JSON.stringify(metadata);
  const collections = COLLECTIONS.map(([key, table]) => {
    const rows = collectionRows(studio, key);
    requireRowIds(rows, key);
    return [key, table, rows];
  });
  const contentHash = studioIndexHash(metadataJson, collections);
  const syncedAt = new Date().toISOString();
  const db = openEvaluationStudioDb(options);
  try {
    runTransaction(db, () => {
      collections.forEach(([_key, table, rows]) => syncCollection(db, table, rows));
      const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      setMeta.run("studio_metadata", metadataJson);
      setMeta.run("studio_content_hash", contentHash);
      setMeta.run("last_synced_at", syncedAt);
    });
  } finally {
    db.close();
  }
  const counts = Object.fromEntries(collections.map(([key, _table, rows]) => [key, rows.length]));
  return { studio, contentHash, syncedAt, counts, dbPath: resolveEvaluationStudioDbPath(options) };
}

function loadEvaluationStudio(options = {}) {
  const dbPath = resolveEvaluationStudioDbPath(options);
  if (!fs.existsSync(dbPath)) throw new Error(`Evaluation Studio SQLite database is missing: ${dbPath}`);
  const db = openEvaluationStudioDb(options);
  try {
    const metadataRow = db.prepare("SELECT value FROM meta WHERE key = 'studio_metadata'").get();
    const hashRow = db.prepare("SELECT value FROM meta WHERE key = 'studio_content_hash'").get();
    if (!metadataRow || !hashRow) throw new Error("Evaluation Studio SQLite metadata is incomplete.");
    const metadata = JSON.parse(metadataRow.value);
    const rawStudio = { ...metadata };
    const collectionRowsByKey = [];
    COLLECTIONS.forEach(([key, table]) => {
      const rows = db.prepare(`SELECT id, sort_order, payload_hash, payload_json FROM ${table} ORDER BY sort_order, id`).all();
      rows.forEach((row) => {
        if (digest(row.payload_json) !== row.payload_hash) {
          throw new Error(`Evaluation Studio SQLite payload hash does not match stored ${key} record ${row.id}.`);
        }
      });
      rawStudio[key] = rows.map((row) => JSON.parse(row.payload_json));
      collectionRowsByKey.push([key, table, rows.map((row) => ({
        id: row.id,
        sortOrder: row.sort_order,
        payloadHash: row.payload_hash
      }))]);
    });
    const calculatedHash = studioIndexHash(metadataRow.value, collectionRowsByKey);
    if (calculatedHash !== hashRow.value) throw new Error("Evaluation Studio SQLite integrity hash does not match stored history.");
    return {
      studio: normalizeEvaluationStudio(rawStudio),
      contentHash: hashRow.value,
      syncedAt: db.prepare("SELECT value FROM meta WHERE key = 'last_synced_at'").get()?.value || "",
      counts: Object.fromEntries(COLLECTIONS.map(([key, table]) => [key, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)])),
      dbPath
    };
  } finally {
    db.close();
  }
}

function isEvaluationStudioSqliteStub(value) {
  return value?.storage?.mode === EVALUATION_STUDIO_SQLITE_MODE;
}

function evaluationStudioSqliteStub(sync) {
  return {
    schemaVersion: sync.studio.schemaVersion,
    seededFrom: sync.studio.seededFrom,
    seededAt: sync.studio.seededAt,
    storage: {
      mode: EVALUATION_STUDIO_SQLITE_MODE,
      schemaVersion: EVALUATION_STUDIO_DB_SCHEMA_VERSION,
      databaseFile: path.basename(sync.dbPath),
      contentHash: sync.contentHash,
      lastSyncedAt: sync.syncedAt,
      counts: sync.counts
    }
  };
}

module.exports = {
  EVALUATION_STUDIO_DB_SCHEMA_VERSION,
  EVALUATION_STUDIO_SQLITE_MODE,
  evaluationStudioSqliteStub,
  isEvaluationStudioSqliteStub,
  loadEvaluationStudio,
  migrateEvaluationStudioDb,
  openEvaluationStudioDb,
  resolveEvaluationStudioDbPath,
  syncEvaluationStudio
};
