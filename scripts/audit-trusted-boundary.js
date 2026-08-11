"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { localModelCapabilitySummary } = require("../src/localModelCapability");

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return Number(Object.values(row || {})[0] || 0);
}

function integrity(db) {
  const row = db.prepare("PRAGMA integrity_check").get();
  return String(row?.integrity_check || Object.values(row || {})[0] || "unknown");
}

function countActiveJobs(jobs = []) {
  const active = new Set(["accepted", "pending", "queued", "running"]);
  return jobs.filter((job) => active.has(String(job?.status || "").toLowerCase())).length;
}

function auditTrustedBoundary(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const statePath = path.resolve(options.statePath || path.join(root, "data", "store", "state.json"));
  const intelligencePath = path.resolve(options.intelligencePath || path.join(root, "data", "store", "intelligence.sqlite"));
  const evaluationPath = path.resolve(options.evaluationPath || path.join(root, "data", "store", "evaluation-studio.sqlite"));
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const importId = String(options.importId || state.imports?.[0]?.id || "");
  if (!importId) throw new Error("No active import ID is available for the trusted-boundary audit.");

  const capability = localModelCapabilitySummary();
  const intelligence = new DatabaseSync(intelligencePath, { readOnly: true });
  const evaluation = new DatabaseSync(evaluationPath, { readOnly: true });

  try {
    const callSemanticPredicate = [
      "transcript_quality IS NOT NULL",
      "connected_to_human IS NOT NULL",
      "decision_maker_status IS NOT NULL",
      "customer_sentiment IS NOT NULL",
      "next_step_exists IS NOT NULL",
      "valid_no_sale IS NOT NULL",
      "lead_utilization_score IS NOT NULL",
      "salesperson_quality_score IS NOT NULL",
      "disposition_matches_transcript IS NOT NULL",
      "llm_confidence IS NOT NULL",
      "deterministic_confidence IS NOT NULL"
    ].join(" OR ");
    const leadSemanticPredicate = [
      "max_score IS NOT NULL",
      "avg_score IS NOT NULL",
      "human_reached_count IS NOT NULL",
      "meaningful_attempt_count IS NOT NULL",
      "next_step_count IS NOT NULL",
      "low_value_human_count IS NOT NULL",
      "repeated_short_attempt IS NOT NULL",
      "waste_risk IS NOT NULL",
      "high_quality_utilized IS NOT NULL"
    ].join(" OR ");

    const outcomeRows = intelligence.prepare(`
      SELECT COALESCE(overall_call_outcome, 'unknown') AS outcome, COUNT(*) AS count
      FROM call_intelligence
      WHERE import_id = ?
      GROUP BY COALESCE(overall_call_outcome, 'unknown')
      ORDER BY outcome
    `).all(importId);
    const permittedOutcomes = new Set(["unknown", "no_answer", "voicemail", "system_audio", "wrong_number", "not_interested", "opt_out"]);
    const unexpectedOutcomes = outcomeRows.filter((row) => !permittedOutcomes.has(String(row.outcome)));

    const report = {
      schemaVersion: "sales_dashboard_trusted_boundary_audit.v1",
      auditedAt: new Date().toISOString(),
      importId,
      capability: {
        programStatus: capability.programStatus,
        capabilityCount: capability.capabilityCount,
        promotedCapabilityIds: capability.promotedCapabilityIds,
        liveSubmissionPermitted: capability.liveSubmissionPermitted,
        operationalConsumptionPermitted: capability.operationalConsumptionPermitted
      },
      intelligence: {
        integrity: integrity(intelligence),
        calls: scalar(intelligence, "SELECT COUNT(*) FROM call_intelligence WHERE import_id = ?", importId),
        callsNotNotRequested: scalar(intelligence, "SELECT COUNT(*) FROM call_intelligence WHERE import_id = ? AND llm_status <> 'not_requested'", importId),
        callsWithSemanticValues: scalar(intelligence, `SELECT COUNT(*) FROM call_intelligence WHERE import_id = ? AND (${callSemanticPredicate})`, importId),
        outcomes: Object.fromEntries(outcomeRows.map((row) => [row.outcome, Number(row.count)])),
        unexpectedOutcomes,
        entities: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_entities WHERE import_id = ?", importId),
        eventsWithoutEvidence: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_events WHERE import_id = ? AND (evidence IS NULL OR TRIM(evidence) = '')", importId),
        eventsWithFollowUpDecision: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_events WHERE import_id = ? AND follow_up_required IS NOT NULL", importId),
        eventsWithDueAt: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_events WHERE import_id = ? AND due_at IS NOT NULL AND TRIM(due_at) <> ''", importId),
        eventsWithConfidence: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_events WHERE import_id = ? AND confidence IS NOT NULL", importId),
        risksWithoutEvidence: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_risk_flags WHERE import_id = ? AND (evidence IS NULL OR TRIM(evidence) = '')", importId),
        risksWithConfidence: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_risk_flags WHERE import_id = ? AND confidence IS NOT NULL", importId),
        leadsWithSemanticValues: scalar(intelligence, `SELECT COUNT(*) FROM lead_intelligence WHERE import_id = ? AND (${leadSemanticPredicate})`, importId),
        archivedModelRowsForActiveImport: scalar(intelligence, "SELECT COUNT(*) FROM intelligence_llm_results WHERE import_id = ?", importId)
      },
      evaluationStudio: {
        integrity: integrity(evaluation),
        totalRuns: scalar(evaluation, "SELECT COUNT(*) FROM evaluation_runs"),
        currentImportRuns: scalar(evaluation, "SELECT COUNT(*) FROM evaluation_runs WHERE import_id = ?", importId),
        activeRuns: scalar(evaluation, "SELECT COUNT(*) FROM evaluation_runs WHERE status IN ('accepted', 'pending', 'queued', 'running')"),
        totalResults: scalar(evaluation, "SELECT COUNT(*) FROM evaluation_results"),
        currentImportResults: scalar(evaluation, "SELECT COUNT(*) FROM evaluation_results WHERE import_id = ?", importId)
      },
      state: {
        aiJobs: Array.isArray(state.aiJobs) ? state.aiJobs.length : 0,
        activeAiJobs: countActiveJobs(state.aiJobs),
        quarantinedAiJobs: (state.aiJobs || []).filter((job) => String(job?.status || "").toLowerCase() === "quarantined").length
      }
    };

    const violations = [];
    if (report.capability.promotedCapabilityIds.length !== 0) violations.push("promoted_capability_present");
    if (report.capability.liveSubmissionPermitted) violations.push("live_submission_permitted");
    if (report.capability.operationalConsumptionPermitted) violations.push("operational_consumption_permitted");
    if (report.intelligence.integrity !== "ok") violations.push("intelligence_integrity_failed");
    if (report.evaluationStudio.integrity !== "ok") violations.push("evaluation_studio_integrity_failed");
    if (report.intelligence.callsNotNotRequested !== 0) violations.push("active_import_llm_status_present");
    if (report.intelligence.callsWithSemanticValues !== 0) violations.push("active_call_semantics_present");
    if (report.intelligence.unexpectedOutcomes.length !== 0) violations.push("unexpected_literal_outcome");
    if (report.intelligence.entities !== 0) violations.push("active_semantic_entities_present");
    if (report.intelligence.eventsWithoutEvidence !== 0) violations.push("literal_event_missing_evidence");
    if (report.intelligence.eventsWithFollowUpDecision !== 0 || report.intelligence.eventsWithDueAt !== 0 || report.intelligence.eventsWithConfidence !== 0) {
      violations.push("active_event_semantics_present");
    }
    if (report.intelligence.risksWithoutEvidence !== 0) violations.push("literal_risk_missing_evidence");
    if (report.intelligence.risksWithConfidence !== 0) violations.push("active_risk_confidence_present");
    if (report.intelligence.leadsWithSemanticValues !== 0) violations.push("active_lead_semantics_present");
    if (report.intelligence.archivedModelRowsForActiveImport !== 0) violations.push("active_import_model_archive_rows_present");
    if (report.evaluationStudio.activeRuns !== 0) violations.push("active_evaluation_run_present");
    if (report.state.activeAiJobs !== 0) violations.push("active_ai_job_present");
    report.violations = violations;
    report.ok = violations.length === 0;
    return report;
  } finally {
    intelligence.close();
    evaluation.close();
  }
}

if (require.main === module) {
  try {
    const report = auditTrustedBoundary();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { auditTrustedBoundary };
