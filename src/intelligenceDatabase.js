"use strict";

const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { resolveStorePath } = require("./storage");
const { buildCallIntelligence } = require("./transcriptIntelligence");
const { isOfferPaymentOrOrderIntent } = require("./paymentIntentGuardrails");

const DB_SCHEMA_VERSION = "sales_dashboard_intelligence_db.v1";

function resolveIntelligenceDbPath(options = {}) {
  if (options.dbPath) return path.resolve(options.dbPath);
  if (process.env.SALES_DASHBOARD_INTELLIGENCE_DB_PATH) {
    return path.resolve(process.env.SALES_DASHBOARD_INTELLIGENCE_DB_PATH);
  }
  return path.join(path.dirname(resolveStorePath(options)), "intelligence.sqlite");
}

function openIntelligenceDb(options = {}) {
  const db = new DatabaseSync(resolveIntelligenceDbPath(options));
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateIntelligenceDb(db);
  return db;
}

function migrateIntelligenceDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_intelligence (
      import_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      input_hash TEXT,
      source_name TEXT,
      extraction_version TEXT NOT NULL,
      transcript_hash TEXT NOT NULL,
      lead_key TEXT NOT NULL,
      lead_key_type TEXT NOT NULL,
      customer_id TEXT DEFAULT '',
      salesperson TEXT,
      user_id TEXT,
      source TEXT,
      business_segment TEXT,
      business_segment_label TEXT,
      call_direction TEXT,
      call_type TEXT,
      duration_seconds INTEGER DEFAULT 0,
      transcript_quality TEXT,
      connected_to_human INTEGER DEFAULT 0,
      decision_maker_status TEXT,
      overall_call_outcome TEXT,
      customer_sentiment TEXT,
      next_step_exists INTEGER DEFAULT 0,
      risk_flag_exists INTEGER DEFAULT 0,
      valid_no_sale INTEGER DEFAULT 0,
      lead_utilization_score INTEGER DEFAULT 0,
      salesperson_quality_score INTEGER DEFAULT 0,
      manager_review_required INTEGER DEFAULT 0,
      disposition_matches_transcript INTEGER DEFAULT 1,
      llm_confidence REAL DEFAULT 0,
      deterministic_confidence REAL DEFAULT 0,
      brief_reason TEXT,
      evidence_snippet TEXT,
      llm_status TEXT DEFAULT 'not_requested',
      llm_job_id TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (import_id, call_id)
    );

    CREATE TABLE IF NOT EXISTS intelligence_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      raw_value TEXT,
      normalized_value TEXT,
      speaker TEXT,
      evidence TEXT,
      confidence REAL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      speaker TEXT,
      raw_value TEXT,
      normalized_value TEXT,
      follow_up_required INTEGER DEFAULT 0,
      due_at TEXT,
      evidence TEXT,
      confidence REAL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_risk_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      flag_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      speaker TEXT,
      evidence TEXT,
      confidence REAL DEFAULT 0,
      manager_review_recommended INTEGER DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intelligence_llm_results (
      import_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (import_id, call_id, job_id)
    );

    CREATE TABLE IF NOT EXISTS lead_intelligence (
      import_id TEXT NOT NULL,
      lead_key TEXT NOT NULL,
      lead_key_type TEXT NOT NULL,
      salesperson TEXT,
      source TEXT,
      business_segment TEXT,
      call_count INTEGER DEFAULT 0,
      max_score INTEGER DEFAULT 0,
      avg_score REAL DEFAULT 0,
      human_reached_count INTEGER DEFAULT 0,
      meaningful_attempt_count INTEGER DEFAULT 0,
      next_step_count INTEGER DEFAULT 0,
      risk_flag_count INTEGER DEFAULT 0,
      manager_review_count INTEGER DEFAULT 0,
      no_contact_count INTEGER DEFAULT 0,
      low_value_human_count INTEGER DEFAULT 0,
      repeated_short_attempt INTEGER DEFAULT 0,
      waste_risk INTEGER DEFAULT 0,
      high_quality_utilized INTEGER DEFAULT 0,
      reason TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (import_id, lead_key)
    );

    CREATE INDEX IF NOT EXISTS idx_call_intelligence_import_segment ON call_intelligence(import_id, business_segment);
    CREATE INDEX IF NOT EXISTS idx_call_intelligence_import_salesperson ON call_intelligence(import_id, salesperson);
    CREATE INDEX IF NOT EXISTS idx_call_intelligence_import_source ON call_intelligence(import_id, source);
    CREATE INDEX IF NOT EXISTS idx_call_intelligence_llm ON call_intelligence(import_id, llm_status);
    CREATE INDEX IF NOT EXISTS idx_lead_intelligence_import_salesperson ON lead_intelligence(import_id, salesperson);
    CREATE INDEX IF NOT EXISTS idx_lead_intelligence_import_source ON lead_intelligence(import_id, source);
  `);
  const callColumns = db.prepare("PRAGMA table_info(call_intelligence)").all().map((column) => column.name);
  if (!callColumns.includes("customer_id")) {
    db.exec("ALTER TABLE call_intelligence ADD COLUMN customer_id TEXT DEFAULT '';");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_call_intelligence_import_customer ON call_intelligence(import_id, customer_id);");
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("schema_version", DB_SCHEMA_VERSION);
}

function runTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function insertCallStatement(db) {
  return db.prepare(`
    INSERT INTO call_intelligence (
      import_id, call_id, input_hash, source_name, extraction_version, transcript_hash,
      lead_key, lead_key_type, customer_id, salesperson, user_id, source, business_segment, business_segment_label,
      call_direction, call_type, duration_seconds, transcript_quality, connected_to_human,
      decision_maker_status, overall_call_outcome, customer_sentiment, next_step_exists,
      risk_flag_exists, valid_no_sale, lead_utilization_score, salesperson_quality_score,
      manager_review_required, disposition_matches_transcript, llm_confidence, deterministic_confidence,
      brief_reason, evidence_snippet, llm_status, llm_job_id, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
}

function insertCallRecord(stmt, record, now) {
  stmt.run(
    record.importId,
    record.callId,
    record.inputHash,
    record.sourceName,
    record.extractionVersion,
    record.transcriptHash,
    record.leadKey,
    record.leadKeyType,
    record.customerId || "",
    record.salesperson,
    record.userId,
    record.source,
    record.businessSegment,
    record.businessSegmentLabel,
    record.callDirection,
    record.callType,
    record.durationSeconds,
    record.transcriptQuality,
    record.connectedToHuman,
    record.decisionMakerStatus,
    record.overallCallOutcome,
    record.customerSentiment,
    record.nextStepExists,
    record.riskFlagExists,
    record.validNoSale,
    record.leadUtilizationScore,
    record.salespersonQualityScore,
    record.managerReviewRequired,
    record.dispositionMatchesTranscript,
    record.llmConfidence,
    record.deterministicConfidence,
    record.briefReason,
    record.evidenceSnippet,
    record.llmStatus,
    record.llmJobId,
    now,
    now
  );
}

function businessSegmentForLead(records) {
  const segments = new Set(records.map((record) => record.businessSegment).filter(Boolean));
  if (segments.size === 1) return Array.from(segments)[0];
  return "mixed";
}

function buildLeadRecords(callRecords) {
  const groups = new Map();
  callRecords.forEach((record) => {
    if (!groups.has(record.leadKey)) groups.set(record.leadKey, []);
    groups.get(record.leadKey).push(record);
  });

  return Array.from(groups.entries()).map(([leadKey, records]) => {
    const callCount = records.length;
    const maxScore = Math.max(...records.map((record) => Number(record.leadUtilizationScore || 0)));
    const totalScore = records.reduce((sum, record) => sum + Number(record.leadUtilizationScore || 0), 0);
    const avgDuration = records.reduce((sum, record) => sum + Number(record.durationSeconds || 0), 0) / Math.max(1, callCount);
    const humanReachedCount = records.filter((record) => record.connectedToHuman).length;
    const meaningfulAttemptCount = records.filter((record) => Number(record.leadUtilizationScore || 0) >= 3).length;
    const nextStepCount = records.filter((record) => record.nextStepExists).length;
    const riskFlagCount = records.filter((record) => record.riskFlagExists).length;
    const managerReviewCount = records.filter((record) => record.managerReviewRequired).length;
    const noContactCount = records.filter((record) => Number(record.leadUtilizationScore || 0) <= 1).length;
    const lowValueHumanCount = records.filter((record) => record.connectedToHuman && Number(record.leadUtilizationScore || 0) <= 2).length;
    const repeatedShortAttempt = callCount >= 2 && avgDuration < 20 && maxScore <= 2;
    const wasteRisk = maxScore <= 2 || repeatedShortAttempt || (lowValueHumanCount > 0 && nextStepCount === 0);
    const highQualityUtilized = maxScore >= 4;
    const first = records[0];
    const reason = wasteRisk
      ? repeatedShortAttempt
        ? "Repeated short attempts without meaningful lead utilization."
        : lowValueHumanCount
          ? "Human contact appears likely, but no meaningful pitch, qualification, or next step was captured."
          : "All attempts appear to be no-answer, voicemail, unusable, or otherwise low-value."
      : highQualityUtilized
        ? "At least one call shows strong lead utilization or a useful next step."
        : "Lead has at least one basic meaningful attempt.";

    return {
      importId: first.importId,
      leadKey,
      leadKeyType: first.leadKeyType,
      salesperson: first.salesperson,
      source: first.source,
      businessSegment: businessSegmentForLead(records),
      callCount,
      maxScore,
      avgScore: totalScore / Math.max(1, callCount),
      humanReachedCount,
      meaningfulAttemptCount,
      nextStepCount,
      riskFlagCount,
      managerReviewCount,
      noContactCount,
      lowValueHumanCount,
      repeatedShortAttempt: repeatedShortAttempt ? 1 : 0,
      wasteRisk: wasteRisk ? 1 : 0,
      highQualityUtilized: highQualityUtilized ? 1 : 0,
      reason
    };
  });
}

function replaceImportIntelligence(analysis, options = {}) {
  const importId = options.importId || "current";
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  const now = new Date().toISOString();
  const callRows = analysis.drilldownRows || [];
  const insertedCalls = [];

  try {
    runTransaction(db, () => {
      const existingLlmRows = db.prepare(`
        SELECT
          call_id,
          llm_status,
          llm_job_id,
          llm_confidence,
          decision_maker_status,
          customer_sentiment,
          manager_review_required,
          risk_flag_exists,
          brief_reason
        FROM call_intelligence
        WHERE import_id = ?
          AND llm_status <> 'not_requested'
      `).all(importId);
      const existingLlmByCallId = new Map(existingLlmRows.map((row) => [row.call_id, row]));

      db.prepare("DELETE FROM intelligence_entities WHERE import_id = ? AND source = 'deterministic'").run(importId);
      db.prepare("DELETE FROM intelligence_events WHERE import_id = ? AND source = 'deterministic'").run(importId);
      db.prepare("DELETE FROM intelligence_risk_flags WHERE import_id = ? AND source = 'deterministic'").run(importId);
      db.prepare("DELETE FROM lead_intelligence WHERE import_id = ?").run(importId);
      db.prepare("DELETE FROM call_intelligence WHERE import_id = ?").run(importId);

      const insertCallRow = insertCallStatement(db);
      const insertEntity = db.prepare(`
        INSERT INTO intelligence_entities (import_id, call_id, entity_type, raw_value, normalized_value, speaker, evidence, confidence, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertEvent = db.prepare(`
        INSERT INTO intelligence_events (import_id, call_id, event_type, speaker, raw_value, normalized_value, follow_up_required, due_at, evidence, confidence, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFlag = db.prepare(`
        INSERT INTO intelligence_risk_flags (import_id, call_id, flag_type, severity, speaker, evidence, confidence, manager_review_recommended, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertLead = db.prepare(`
        INSERT INTO lead_intelligence (
          import_id, lead_key, lead_key_type, salesperson, source, business_segment, call_count,
          max_score, avg_score, human_reached_count, meaningful_attempt_count, next_step_count,
          risk_flag_count, manager_review_count, no_contact_count, low_value_human_count,
          repeated_short_attempt, waste_risk, high_quality_utilized, reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      callRows.forEach((call) => {
        const intelligence = buildCallIntelligence(call, {
          importId,
          inputHash: analysis.inputHash,
          sourceName: analysis.sourceName
        });
        const existingLlm = existingLlmByCallId.get(call.callId);
        if (existingLlm) {
          intelligence.call.llmStatus = existingLlm.llm_status || intelligence.call.llmStatus;
          intelligence.call.llmJobId = existingLlm.llm_job_id || intelligence.call.llmJobId;
          intelligence.call.llmConfidence = Number(existingLlm.llm_confidence || intelligence.call.llmConfidence || 0);
          if (existingLlm.llm_status === "completed") {
            intelligence.call.decisionMakerStatus = existingLlm.decision_maker_status || intelligence.call.decisionMakerStatus;
            intelligence.call.customerSentiment = existingLlm.customer_sentiment || intelligence.call.customerSentiment;
            intelligence.call.managerReviewRequired = existingLlm.manager_review_required || intelligence.call.managerReviewRequired ? 1 : 0;
            intelligence.call.riskFlagExists = existingLlm.risk_flag_exists || intelligence.call.riskFlagExists ? 1 : 0;
            intelligence.call.briefReason = existingLlm.brief_reason || intelligence.call.briefReason;
          }
        }
        insertCallRecord(insertCallRow, intelligence.call, now);
        insertedCalls.push(intelligence.call);
        intelligence.entities.forEach((entity) => insertEntity.run(
          importId,
          call.callId,
          entity.entityType,
          entity.rawValue,
          entity.normalizedValue,
          entity.speaker,
          entity.evidence,
          entity.confidence,
          entity.source,
          now
        ));
        intelligence.events.forEach((event) => insertEvent.run(
          importId,
          call.callId,
          event.eventType,
          event.speaker,
          event.rawValue,
          event.normalizedValue,
          event.followUpRequired,
          event.dueAt,
          event.evidence,
          event.confidence,
          event.source,
          now
        ));
        intelligence.riskFlags.forEach((flag) => insertFlag.run(
          importId,
          call.callId,
          flag.flagType,
          flag.severity,
          flag.speaker,
          flag.evidence,
          flag.confidence,
          flag.managerReviewRecommended,
          flag.source,
          now
        ));
      });

      buildLeadRecords(insertedCalls).forEach((lead) => insertLead.run(
        lead.importId,
        lead.leadKey,
        lead.leadKeyType,
        lead.salesperson,
        lead.source,
        lead.businessSegment,
        lead.callCount,
        lead.maxScore,
        lead.avgScore,
        lead.humanReachedCount,
        lead.meaningfulAttemptCount,
        lead.nextStepCount,
        lead.riskFlagCount,
        lead.managerReviewCount,
        lead.noContactCount,
        lead.lowValueHumanCount,
        lead.repeatedShortAttempt,
        lead.wasteRisk,
        lead.highQualityUtilized,
        lead.reason,
        now
      ));
    });

    return {
      dbPath,
      importId,
      callsIndexed: insertedCalls.length,
      summary: getIntelligenceSummary({ ...options, dbPath, importId })
    };
  } finally {
    db.close();
  }
}

function scopeWhere(filters = {}, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const clauses = [];
  const params = [];
  if (filters.importId) {
    clauses.push(`${prefix}import_id = ?`);
    params.push(filters.importId);
  }
  if (filters.businessSegment) {
    clauses.push(`${prefix}business_segment = ?`);
    params.push(filters.businessSegment);
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function requested(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getIntelligenceSummary(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  const filters = { importId: options.importId || null, businessSegment: options.businessSegment || "" };
  const callScope = scopeWhere(filters);
  const leadScope = scopeWhere(filters);

  try {
    const callTotals = db.prepare(`
      SELECT
        COUNT(*) AS callsIndexed,
        SUM(manager_review_required) AS managerReviewCalls,
        SUM(risk_flag_exists) AS riskFlagCalls,
        AVG(lead_utilization_score) AS avgCallUtilizationScore,
        SUM(CASE WHEN llm_status = 'queued' THEN 1 ELSE 0 END) AS llmQueued,
        SUM(CASE WHEN llm_status = 'completed' THEN 1 ELSE 0 END) AS llmCompleted,
        SUM(CASE WHEN llm_status = 'failed' THEN 1 ELSE 0 END) AS llmFailed,
        SUM(CASE WHEN llm_status = 'not_requested' THEN 1 ELSE 0 END) AS llmNotRequested
      FROM call_intelligence
      ${callScope.where}
    `).get(...callScope.params) || {};
    const leadTotals = db.prepare(`
      SELECT
        COUNT(*) AS leadsIndexed,
        SUM(waste_risk) AS wasteRiskLeads,
        SUM(high_quality_utilized) AS highQualityLeads,
        SUM(repeated_short_attempt) AS repeatedShortAttemptLeads,
        AVG(avg_score) AS avgLeadUtilizationScore
      FROM lead_intelligence
      ${leadScope.where}
    `).get(...leadScope.params) || {};
    const salespeople = db.prepare(`
      SELECT
        salesperson,
        COUNT(*) AS leads,
        SUM(waste_risk) AS wasteRiskLeads,
        SUM(high_quality_utilized) AS highQualityLeads,
        SUM(repeated_short_attempt) AS repeatedShortAttemptLeads,
        AVG(avg_score) AS avgScore
      FROM lead_intelligence
      ${leadScope.where}
      GROUP BY salesperson
      ORDER BY wasteRiskLeads DESC, repeatedShortAttemptLeads DESC, leads DESC, salesperson ASC
      LIMIT 20
    `).all(...leadScope.params);
    const sources = db.prepare(`
      SELECT
        source,
        COUNT(*) AS leads,
        SUM(waste_risk) AS wasteRiskLeads,
        SUM(high_quality_utilized) AS highQualityLeads,
        SUM(repeated_short_attempt) AS repeatedShortAttemptLeads,
        AVG(avg_score) AS avgScore
      FROM lead_intelligence
      ${leadScope.where}
      GROUP BY source
      ORDER BY wasteRiskLeads DESC, repeatedShortAttemptLeads DESC, leads DESC, source ASC
      LIMIT 20
    `).all(...leadScope.params);

    return {
      schemaVersion: "sales_dashboard_intelligence_summary.v1",
      dbPath,
      importId: filters.importId,
      businessSegment: filters.businessSegment || "",
      totals: {
        callsIndexed: Number(callTotals.callsIndexed || 0),
        leadsIndexed: Number(leadTotals.leadsIndexed || 0),
        wasteRiskLeads: Number(leadTotals.wasteRiskLeads || 0),
        highQualityLeads: Number(leadTotals.highQualityLeads || 0),
        repeatedShortAttemptLeads: Number(leadTotals.repeatedShortAttemptLeads || 0),
        managerReviewCalls: Number(callTotals.managerReviewCalls || 0),
        riskFlagCalls: Number(callTotals.riskFlagCalls || 0),
        avgCallUtilizationScore: Number(callTotals.avgCallUtilizationScore || 0),
        avgLeadUtilizationScore: Number(leadTotals.avgLeadUtilizationScore || 0),
        llmQueued: Number(callTotals.llmQueued || 0),
        llmCompleted: Number(callTotals.llmCompleted || 0),
        llmFailed: Number(callTotals.llmFailed || 0),
        llmNotRequested: Number(callTotals.llmNotRequested || 0)
      },
      salespeople: salespeople.map((row) => ({
        salesperson: row.salesperson || "Unknown",
        leads: Number(row.leads || 0),
        wasteRiskLeads: Number(row.wasteRiskLeads || 0),
        highQualityLeads: Number(row.highQualityLeads || 0),
        repeatedShortAttemptLeads: Number(row.repeatedShortAttemptLeads || 0),
        avgScore: Number(row.avgScore || 0),
        wasteRiskRate: row.leads ? Number(row.wasteRiskLeads || 0) / Number(row.leads) : 0
      })),
      sources: sources.map((row) => ({
        source: row.source || "Unknown source",
        leads: Number(row.leads || 0),
        wasteRiskLeads: Number(row.wasteRiskLeads || 0),
        highQualityLeads: Number(row.highQualityLeads || 0),
        repeatedShortAttemptLeads: Number(row.repeatedShortAttemptLeads || 0),
        avgScore: Number(row.avgScore || 0),
        wasteRiskRate: row.leads ? Number(row.wasteRiskLeads || 0) / Number(row.leads) : 0
      }))
    };
  } finally {
    db.close();
  }
}

function listCallIntelligence(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  const clauses = [];
  const params = [];
  if (options.importId) {
    clauses.push("c.import_id = ?");
    params.push(options.importId);
  }
  if (options.businessSegment) {
    clauses.push("c.business_segment = ?");
    params.push(options.businessSegment);
  }
  if (options.salesperson) {
    clauses.push("c.salesperson = ?");
    params.push(String(options.salesperson));
  }
  if (options.source) {
    clauses.push("c.source = ?");
    params.push(String(options.source));
  }
  if (options.customerId || options.customer_id) {
    clauses.push("c.customer_id = ?");
    params.push(String(options.customerId || options.customer_id));
  }
  if (options.llmStatus) {
    clauses.push("c.llm_status = ?");
    params.push(String(options.llmStatus));
  }
  const callIds = Array.isArray(options.callIds)
    ? options.callIds
    : String(options.callIds || "").split(",");
  const filteredCallIds = callIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 100);
  if (filteredCallIds.length) {
    clauses.push(`c.call_id IN (${filteredCallIds.map(() => "?").join(",")})`);
    params.push(...filteredCallIds);
  }
  if (requested(options.managerReview)) clauses.push("c.manager_review_required = 1");
  if (requested(options.riskFlag)) clauses.push("c.risk_flag_exists = 1");
  if (requested(options.wasteRisk)) clauses.push("COALESCE(l.waste_risk, 0) = 1");
  if (requested(options.highQuality)) clauses.push("COALESCE(l.high_quality_utilized, 0) = 1");
  if (requested(options.repeatedShortAttempt)) clauses.push("COALESCE(l.repeated_short_attempt, 0) = 1");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(Number(options.limit || 250), 5000));
  const offset = Math.max(0, Number(options.offset || 0));
  try {
    const rows = db.prepare(`
      SELECT
        c.*,
        COALESCE(l.waste_risk, 0) AS lead_waste_risk,
        COALESCE(l.high_quality_utilized, 0) AS lead_high_quality_utilized,
        COALESCE(l.repeated_short_attempt, 0) AS lead_repeated_short_attempt,
        l.reason AS lead_reason
      FROM call_intelligence c
      LEFT JOIN lead_intelligence l
        ON l.import_id = c.import_id
       AND l.lead_key = c.lead_key
      ${where}
      ORDER BY c.manager_review_required DESC, COALESCE(l.waste_risk, 0) DESC, c.lead_utilization_score ASC, c.call_id ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return attachLlmAuditDetails(db, rows);
  } finally {
    db.close();
  }
}

function attachLlmAuditDetails(db, rows) {
  if (!rows.length) return rows;
  const byImportId = new Map();
  rows.forEach((row) => {
    if (!byImportId.has(row.import_id)) byImportId.set(row.import_id, []);
    byImportId.get(row.import_id).push(row.call_id);
  });
  const keyFor = (importId, callId) => `${importId}\u0000${callId}`;
  const eventsByCall = new Map();
  const entitiesByCall = new Map();
  const flagsByCall = new Map();
  const resultsByCall = new Map();

  byImportId.forEach((callIds, importId) => {
    const placeholders = callIds.map(() => "?").join(",");
    db.prepare(`
      SELECT call_id, event_type, speaker, raw_value, normalized_value, follow_up_required, due_at, evidence, confidence
      FROM intelligence_events
      WHERE source = 'llm'
        AND import_id = ?
        AND call_id IN (${placeholders})
      ORDER BY call_id, id
    `).all(importId, ...callIds).forEach((event) => {
      const key = keyFor(importId, event.call_id);
      if (!eventsByCall.has(key)) eventsByCall.set(key, []);
      eventsByCall.get(key).push(event);
    });
    db.prepare(`
      SELECT call_id, entity_type, raw_value, normalized_value, speaker, evidence, confidence
      FROM intelligence_entities
      WHERE source = 'llm'
        AND import_id = ?
        AND call_id IN (${placeholders})
      ORDER BY call_id, id
    `).all(importId, ...callIds).forEach((entity) => {
      const key = keyFor(importId, entity.call_id);
      if (!entitiesByCall.has(key)) entitiesByCall.set(key, []);
      entitiesByCall.get(key).push(entity);
    });
    db.prepare(`
      SELECT call_id, flag_type, severity, speaker, evidence, confidence, manager_review_recommended
      FROM intelligence_risk_flags
      WHERE source = 'llm'
        AND import_id = ?
        AND call_id IN (${placeholders})
      ORDER BY call_id, id
    `).all(importId, ...callIds).forEach((flag) => {
      const key = keyFor(importId, flag.call_id);
      if (!flagsByCall.has(key)) flagsByCall.set(key, []);
      flagsByCall.get(key).push(flag);
    });
    db.prepare(`
      SELECT call_id, result_json, confidence, created_at
      FROM intelligence_llm_results
      WHERE import_id = ?
        AND call_id IN (${placeholders})
      ORDER BY call_id, created_at ASC, job_id ASC
    `).all(importId, ...callIds).forEach((result) => {
      resultsByCall.set(keyFor(importId, result.call_id), result);
    });
  });

  return rows.map((row) => {
    const key = keyFor(row.import_id, row.call_id);
    const result = resultsByCall.get(key) || {};
    const quality = llmResultQuality(result.result_json, row.llm_status);
    return {
      ...row,
      llm_events: eventsByCall.get(key) || [],
      llm_entities: entitiesByCall.get(key) || [],
      llm_risk_flags: flagsByCall.get(key) || [],
      llm_result_json: result.result_json || "",
      llm_result_created_at: result.created_at || "",
      llm_result_quality: quality.quality,
      llm_result_quality_label: quality.label,
      llm_result_needs_rerun: quality.needsRerun ? 1 : 0
    };
  });
}

function listLlmJobs(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  const clauses = [];
  const params = [];
  if (options.importId) {
    clauses.push("import_id = ?");
    params.push(options.importId);
  }
  clauses.push("llm_status = ?");
  params.push(options.llmStatus || "queued");
  if (options.businessSegment) {
    clauses.push("business_segment = ?");
    params.push(options.businessSegment);
  }
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 1000));
  try {
    return db.prepare(`
      SELECT import_id, call_id, llm_job_id, llm_status, business_segment, salesperson, source, updated_at
      FROM call_intelligence
      WHERE ${clauses.join(" AND ")}
        AND llm_job_id <> ''
      ORDER BY updated_at ASC, call_id ASC
      LIMIT ?
    `).all(...params, limit);
  } finally {
    db.close();
  }
}

function markLlmJobQueued(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  try {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE call_intelligence
      SET llm_status = 'queued', llm_job_id = ?, updated_at = ?
      WHERE import_id = ? AND call_id = ?
    `).run(options.jobId || "", now, options.importId || "current", options.callId || "");
  } finally {
    db.close();
  }
}

function markLlmJobFailed(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  try {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE call_intelligence
      SET llm_status = 'failed', llm_job_id = ?, brief_reason = COALESCE(NULLIF(?, ''), brief_reason), updated_at = ?
      WHERE import_id = ? AND call_id = ?
    `).run(options.jobId || "", options.reason || "", now, options.importId || "current", options.callId || "");
  } finally {
    db.close();
  }
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  const text = String(value).trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (nestedError) {
        return salvageExtractionJson(text) || { raw: text };
      }
    }
    return salvageExtractionJson(text) || { raw: text };
  }
}

function firstPresent(values) {
  return values.find((value) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim()));
}

function jsonValueSlice(text, valueStart) {
  const opening = text[valueStart];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
  if (!closing) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = valueStart; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) depth -= 1;
    if (depth === 0) return text.slice(valueStart, index + 1);
  }

  return "";
}

function parseJsonField(text, fieldName) {
  const pattern = new RegExp(`"${fieldName}"\\s*:`, "i");
  const match = pattern.exec(text);
  if (!match) return undefined;
  let valueStart = match.index + match[0].length;
  while (valueStart < text.length && /\s/.test(text[valueStart])) valueStart += 1;
  const slice = jsonValueSlice(text, valueStart);
  if (!slice) return undefined;
  try {
    return JSON.parse(slice);
  } catch (error) {
    return undefined;
  }
}

function salvageExtractionJson(text) {
  const summary = parseJsonField(text, "call_summary") || parseJsonField(text, "callSummary");
  const entities = parseJsonField(text, "entities");
  const events = parseJsonField(text, "events");
  const riskFlags = parseJsonField(text, "risk_flags") || parseJsonField(text, "riskFlags");
  const limitations = parseJsonField(text, "limitations");
  if (!summary && !entities && !events && !riskFlags) return null;
  return {
    ...(summary ? { call_summary: summary } : {}),
    entities: Array.isArray(entities) ? entities : [],
    events: Array.isArray(events) ? events : [],
    risk_flags: Array.isArray(riskFlags) ? riskFlags : [],
    limitations: Array.isArray(limitations) ? limitations : [],
    raw: text
  };
}

function hasExtractionShape(value) {
  return Boolean(value && typeof value === "object" && (
    value.call_summary ||
    value.callSummary ||
    Array.isArray(value.entities) ||
    Array.isArray(value.events) ||
    Array.isArray(value.risk_flags) ||
    Array.isArray(value.riskFlags)
  ));
}

function llmResultQuality(resultJson, llmStatus = "") {
  if (llmStatus !== "completed") {
    return { quality: llmStatus || "not_requested", label: llmStatus || "Not requested", needsRerun: false };
  }
  if (!resultJson) {
    return { quality: "missing", label: "Missing result", needsRerun: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(resultJson);
  } catch (error) {
    return { quality: "unparseable", label: "Unparseable", needsRerun: true };
  }

  if (parsed?.text === "") {
    return { quality: "empty_text", label: "Empty output", needsRerun: true };
  }
  if (hasExtractionShape(parsed) && parsed.raw) {
    return { quality: "salvaged_raw", label: "Salvaged", needsRerun: false };
  }
  if (hasExtractionShape(parsed)) {
    return { quality: "complete_json", label: "Complete", needsRerun: false };
  }
  if (parsed?.raw) {
    const salvaged = salvageExtractionJson(parsed.raw);
    if (hasExtractionShape(salvaged)) {
      return { quality: "salvage_available", label: "Salvage available", needsRerun: false };
    }
    return { quality: "raw_only", label: "Raw only", needsRerun: true };
  }

  return { quality: "no_summary", label: "No summary", needsRerun: true };
}

function extractionPayload(result, depth = 0) {
  const payload = parseMaybeJson(result);
  if (depth >= 5 || hasExtractionShape(payload) || !payload || typeof payload !== "object") {
    return payload;
  }

  const nested = firstPresent([
    payload.result,
    payload.output,
    payload.response,
    payload.data,
    payload.payload,
    payload.completion,
    payload.raw,
    payload.text,
    payload.message?.content,
    payload.choices?.[0]?.message?.content,
    payload.job?.result,
    payload.job?.result_payload,
    payload.job?.resultPayload,
    payload.job?.output,
    payload.job?.response,
    payload.job?.data,
    payload.job?.payload
  ]);

  return nested === undefined ? payload : extractionPayload(nested, depth + 1);
}

function sanitizeLlmExtractionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const events = Array.isArray(payload.events) ? payload.events : [];
  const safeEvents = events.filter((event) => {
    const eventType = event.event_type || event.eventType || "";
    if (eventType !== "payment_or_order_intent") return true;
    return isOfferPaymentOrOrderIntent(event);
  });
  if (safeEvents.length === events.length) return payload;

  const limitations = Array.isArray(payload.limitations) ? payload.limitations : [];
  return {
    ...payload,
    events: safeEvents,
    limitations: [
      ...limitations,
      "Dropped payment_or_order_intent because the evidence did not show payment/order intent for the offer."
    ]
  };
}

function saveLlmIntelligenceResult(options = {}) {
  const dbPath = resolveIntelligenceDbPath(options);
  const db = openIntelligenceDb({ ...options, dbPath });
  const importId = options.importId || "current";
  const callId = options.callId || "";
  const jobId = options.jobId || "";
  const payload = sanitizeLlmExtractionPayload(extractionPayload(options.result));
  const now = new Date().toISOString();
  if (!callId) throw new Error("callId is required");
  if (!jobId) throw new Error("jobId is required");

  try {
    runTransaction(db, () => {
      db.prepare("DELETE FROM intelligence_entities WHERE import_id = ? AND call_id = ? AND source = 'llm'").run(importId, callId);
      db.prepare("DELETE FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").run(importId, callId);
      db.prepare("DELETE FROM intelligence_risk_flags WHERE import_id = ? AND call_id = ? AND source = 'llm'").run(importId, callId);
      db.prepare("DELETE FROM intelligence_llm_results WHERE import_id = ? AND call_id = ?").run(importId, callId);
      db.prepare(`
        INSERT INTO intelligence_llm_results (import_id, call_id, job_id, result_json, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(importId, callId, jobId, JSON.stringify(payload), Number(payload.call_summary?.confidence || payload.confidence || 0), now);

      const insertEntity = db.prepare(`
        INSERT INTO intelligence_entities (import_id, call_id, entity_type, raw_value, normalized_value, speaker, evidence, confidence, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'llm', ?)
      `);
      const insertEvent = db.prepare(`
        INSERT INTO intelligence_events (import_id, call_id, event_type, speaker, raw_value, normalized_value, follow_up_required, due_at, evidence, confidence, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'llm', ?)
      `);
      const insertFlag = db.prepare(`
        INSERT INTO intelligence_risk_flags (import_id, call_id, flag_type, severity, speaker, evidence, confidence, manager_review_recommended, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'llm', ?)
      `);

      (Array.isArray(payload.entities) ? payload.entities : []).forEach((entity) => insertEntity.run(
        importId,
        callId,
        entity.entity_type || entity.entityType || "",
        entity.raw_value || entity.rawValue || "",
        entity.normalized_value || entity.normalizedValue || "",
        entity.speaker || "unknown",
        entity.evidence || "",
        Number(entity.confidence || 0),
        now
      ));
      (Array.isArray(payload.events) ? payload.events : []).forEach((event) => insertEvent.run(
        importId,
        callId,
        event.event_type || event.eventType || "",
        event.speaker || "unknown",
        event.raw_value || event.rawValue || "",
        event.normalized_value || event.normalizedValue || "",
        event.follow_up_required || event.followUpRequired ? 1 : 0,
        event.due_at || event.dueAt || "",
        event.evidence || "",
        Number(event.confidence || 0),
        now
      ));
      (Array.isArray(payload.risk_flags) ? payload.risk_flags : Array.isArray(payload.riskFlags) ? payload.riskFlags : []).forEach((flag) => insertFlag.run(
        importId,
        callId,
        flag.flag_type || flag.flagType || "",
        flag.severity || "medium",
        flag.speaker || "unknown",
        flag.evidence || "",
        Number(flag.confidence || 0),
        flag.manager_review_recommended || flag.managerReviewRecommended ? 1 : 0,
        now
      ));

      const summary = payload.call_summary || payload.callSummary || {};
      const riskFlags = Array.isArray(payload.risk_flags) ? payload.risk_flags : Array.isArray(payload.riskFlags) ? payload.riskFlags : [];
      const hasLlmRiskFlag = riskFlags.length > 0;
      const llmManagerReviewRequired = Boolean(summary.manager_review_required || summary.managerReviewRequired || riskFlags.some((flag) => flag.manager_review_recommended || flag.managerReviewRecommended));
      db.prepare(`
        UPDATE call_intelligence
        SET
          llm_status = 'completed',
          llm_job_id = ?,
          llm_confidence = ?,
          decision_maker_status = COALESCE(NULLIF(?, ''), decision_maker_status),
          customer_sentiment = COALESCE(NULLIF(?, ''), customer_sentiment),
          manager_review_required = CASE WHEN ? THEN 1 ELSE manager_review_required END,
          risk_flag_exists = CASE WHEN ? THEN 1 ELSE risk_flag_exists END,
          brief_reason = COALESCE(NULLIF(?, ''), brief_reason),
          updated_at = ?
        WHERE import_id = ? AND call_id = ?
      `).run(
        jobId,
        Number(summary.confidence || payload.confidence || 0),
        summary.decision_maker_status || summary.decisionMakerStatus || "",
        summary.customer_sentiment || summary.customerSentiment || "",
        llmManagerReviewRequired ? 1 : 0,
        hasLlmRiskFlag ? 1 : 0,
        summary.brief_reason || summary.briefReason || "",
        now,
        importId,
        callId
      );
    });

    return { ok: true, importId, callId, jobId, payload };
  } finally {
    db.close();
  }
}

module.exports = {
  DB_SCHEMA_VERSION,
  openIntelligenceDb,
  resolveIntelligenceDbPath,
  replaceImportIntelligence,
  getIntelligenceSummary,
  listCallIntelligence,
  listLlmJobs,
  markLlmJobFailed,
  markLlmJobQueued,
  saveLlmIntelligenceResult
};
