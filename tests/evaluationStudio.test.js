"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildEvaluationStudioInput,
  buildEvaluationStudioReportRollups,
  buildManagerReviewPrefillCorrections,
  createDefaultEvaluationStudio,
  listEvaluationResults,
  quarantineEvaluationRun,
  resumeEvaluationRun,
  upsertEvaluationResult
} = require("../src/evaluationStudio");
const {
  archiveEvaluationKnowledgebaseEntry,
  dashboardPersistence,
  readStore,
  saveEvaluationKnowledgebaseEntry,
  saveEvaluationResult,
  saveEvaluationRun,
  saveEvaluationTemplate
} = require("../src/storage");

function tempStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-evaluation-studio-")), "state.json");
}

test("Evaluation Studio seeds Neuron knowledgebase and LatentPulse governance templates", () => {
  const studio = createDefaultEvaluationStudio();
  const kbSources = new Set(studio.knowledgebaseEntries.map((entry) => entry.sourceProject));
  const templateGoals = new Set(studio.evaluationTemplates.map((template) => template.evaluationGoal));

  assert.equal(kbSources.has("Neuron-Compute-Training"), true);
  assert.equal(kbSources.has("LatentPulse"), true);
  assert.equal(templateGoals.has("procedure_adherence"), true);
  assert.equal(templateGoals.has("objection_handling"), true);
  assert.equal(templateGoals.has("callback_opportunity"), true);
  assert.equal(templateGoals.has("lead_validity_utilisation"), true);
});

test("Evaluation Studio knowledgebase entries are versioned and archived non-destructively", () => {
  const storePath = tempStorePath();
  const created = saveEvaluationKnowledgebaseEntry({
    title: "Manager Callback Standard",
    category: "callback_handling",
    tags: "callback, follow up",
    content: "Confirm the best time, reason for callback, and next action.",
    updatedBy: "CEO"
  }, { storePath });

  assert.equal(created.entry.updatedBy, "local_manager");
  assert.equal(created.entry.isActive, true);
  assert.equal(created.entry.version, 1);

  const updated = saveEvaluationKnowledgebaseEntry({
    id: created.entry.id,
    title: "Manager Callback Standard",
    category: "callback_handling",
    tags: "callback, follow up",
    content: "Confirm timing, objection, next action, and handover notes.",
    actor: "<script>spoof()</script>"
  }, { storePath });

  assert.equal(updated.entry.version, 2);
  assert.equal(updated.entry.updatedBy, "local_manager");

  const archived = archiveEvaluationKnowledgebaseEntry(created.entry.id, { storePath });
  assert.equal(archived.entry.isActive, false);

  const store = readStore({ storePath });
  assert.equal(store.evaluationStudio.knowledgebaseEntries.some((entry) => entry.id === created.entry.id), true);
});

test("Evaluation Studio templates validate strict schemas and block parked-data concepts", () => {
  const storePath = tempStorePath();
  assert.throws(() => saveEvaluationTemplate({
    name: "Bad Schema",
    evaluationGoal: "procedure_adherence",
    instructions: "Return JSON.",
    outputSchema: "{not-json"
  }, { storePath }), /valid JSON/);

  assert.throws(() => saveEvaluationTemplate({
    name: "Bad Parked Data Template",
    evaluationGoal: "procedure_adherence",
    instructions: "Return JSON.",
    outputSchema: { allocationCoverage: "number" }
  }, { storePath }), /parked campaign\/allocation/);

  const saved = saveEvaluationTemplate({
    name: "Objection Review",
    evaluationGoal: "objection_handling",
    instructions: "Detect objection type and handling quality with evidence.",
    outputSchema: { objection_type: "string", handling_quality: "string", evidence: "string", confidence: "0-1" },
    updatedBy: "admin"
  }, { storePath });

  assert.equal(saved.template.evaluationGoal, "objection_handling");
  assert.equal(saved.template.updatedBy, "local_manager");
  assert.equal(saved.template.isActive, true);
});

test("Evaluation Studio templates allow safe custom evaluation goals", () => {
  const storePath = tempStorePath();
  const saved = saveEvaluationTemplate({
    name: "Payment Ask Quality Review",
    evaluationGoal: "payment_ask_quality",
    instructions: "Evaluate whether the payment or next-step ask was clear, evidence-backed, and fair.",
    outputSchema: { payment_ask_quality: "string", evidence: "string", confidence: "0-1" },
    updatedBy: "spoofed_actor"
  }, { storePath });

  assert.equal(saved.template.evaluationGoal, "payment_ask_quality");
  assert.equal(saved.template.updatedBy, "local_manager");
  assert.equal(saved.template.version, 1);

  assert.throws(() => saveEvaluationTemplate({
    name: "Parked Campaign Goal",
    evaluationGoal: "campaign_allocation_review",
    instructions: "Return JSON.",
    outputSchema: { finding: "string" }
  }, { storePath }), /parked campaign\/allocation/);
});

test("Evaluation Studio run records preserve template and knowledgebase versions", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const result = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 25 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 25
  }, { storePath });

  assert.equal(result.run.importId, "import-july-7");
  assert.equal(result.run.status, "queued");
  assert.equal(result.run.templateSnapshot.id, template.id);
  assert.equal(result.run.templateVersion, template.version);
  assert.equal(result.run.plannedCallCount, 25);
  assert.ok(result.run.knowledgebaseSnapshot.length >= 1);

  const persistence = dashboardPersistence(result.store, "import-july-7");
  assert.equal(persistence.evaluationStudio.summary.runs, 1);
  assert.equal(persistence.counts.evaluationRuns, 1);
});

test("Evaluation Studio run quarantine and resume are auditable non-destructive states", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const result = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 10 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 10
  }, { storePath });

  const quarantined = quarantineEvaluationRun(result.store.evaluationStudio, result.run.id, {
    reason: "Prompt output did not match schema.",
    now: "2026-07-10T09:30:00.000Z"
  });
  assert.equal(quarantined.run.status, "quarantined");
  assert.equal(quarantined.run.quarantineReason, "Prompt output did not match schema.");
  assert.equal(quarantined.run.quarantinedBy, "local_manager");
  assert.equal(quarantined.run.runHistory.length, 1);
  assert.equal(quarantined.run.runHistory[0].action, "quarantine");

  const resumed = resumeEvaluationRun(quarantined.studio, result.run.id, {
    reason: "Schema fixed.",
    now: "2026-07-10T09:35:00.000Z"
  });
  assert.equal(resumed.run.status, "queued");
  assert.equal(resumed.run.resumeCount, 1);
  assert.equal(resumed.run.resumedBy, "local_manager");
  assert.equal(resumed.run.quarantineReason, "");
  assert.equal(resumed.run.runHistory.length, 2);
  assert.equal(resumed.run.runHistory[1].action, "resume");

  const completed = {
    ...resumed.studio,
    evaluationRuns: resumed.studio.evaluationRuns.map((run) => run.id === result.run.id ? { ...run, status: "completed" } : run)
  };
  assert.throws(() => quarantineEvaluationRun(completed, result.run.id, { reason: "too late" }), /Completed Evaluation Studio runs cannot be quarantined/);
  assert.throws(() => resumeEvaluationRun(completed, result.run.id, { reason: "too late" }), /Completed Evaluation Studio runs do not need resume/);
});

test("Evaluation Studio task input keeps call AllocatedLeadID raw-only and excludes parked metrics", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "lead_validity_utilisation");
  const input = buildEvaluationStudioInput({
    callId: "call-1",
    salesperson: "Riley Example",
    date: "2026-07-01",
    time: "15:58:37",
    contactClassification: "voicemail",
    localOutcome: "no_contact",
    followUpStatus: "indeterminate",
    transcriptQuality: "medium",
    stableIds: [{ field: "AllocatedLeadID", value: "lead-raw-1" }],
    rawFields: {
      AllocatedLeadID: "lead-raw-1",
      "QTY ACTIONED": "999"
    },
    transcript: "Voicemail: Please leave a message."
  }, template, studio.knowledgebaseEntries, { importId: "import-july-7" });

  assert.equal(input.call_csv_context.AllocatedLeadID, "lead-raw-1");
  assert.equal("QTY ACTIONED" in input.call_csv_context, false);
  assert.match(JSON.stringify(input.guardrails), /Do not use parked campaign\/allocation imports/);
  assert.equal(input.evaluation_template.evaluation_goal, "lead_validity_utilisation");
});

test("Evaluation Studio stores versioned evidence-backed model results", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const first = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.84,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer showed interest and asked for a callback tomorrow.",
      findings: [
        {
          field: "callback_requested",
          value: true,
          evidence: "Customer: Please call me back tomorrow.",
          confidence: 0.88,
          manager_review_recommended: true
        }
      ],
      limitations: ["No confirmed sale or revenue data is available."]
    }
  });

  assert.equal(first.result.callId, "call-1");
  assert.equal(first.result.confidenceBand, "high");
  assert.equal(first.result.managerReviewRecommended, true);
  assert.equal(first.result.findings[0].evidence, "Customer: Please call me back tomorrow.");

  const second = upsertEvaluationResult(first.studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "insufficient_evidence",
      confidence: 0.42,
      evidence_availability: "partial",
      transcript_quality: "low",
      manager_summary: "Callback signal is possible but transcript evidence is weak.",
      findings: [{ field: "callback_requested", value: "possible", evidence: "call me", confidence: 0.42 }]
    }
  });

  const allResults = listEvaluationResults(second.studio, { importId: "import-july-7", includeSuperseded: true });
  const latestResults = listEvaluationResults(second.studio, { importId: "import-july-7" });
  assert.equal(allResults.length, 2);
  assert.equal(latestResults.length, 1);
  assert.equal(latestResults[0].status, "insufficient_evidence");
  assert.equal(latestResults[0].resultVersion, 2);
});

test("Evaluation Studio builds safe manager-review correction prefill from allowed findings only", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const saved = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.82,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer asked for a callback tomorrow.",
      findings: [
        {
          field: "callback_requested",
          value: true,
          previous_display_value: "indeterminate",
          evidence: "Customer: please call me back tomorrow.",
          confidence: 0.82,
          manager_review_recommended: true
        },
        {
          field: "callback_timing",
          value: "tomorrow afternoon",
          evidence: "Customer: tomorrow afternoon works.",
          confidence: 0.79
        },
        {
          field: "objection_type",
          value: "affordability",
          evidence: "Customer: I cannot afford it today.",
          confidence: 0.86
        }
      ]
    }
  });

  const suggestions = buildManagerReviewPrefillCorrections(saved.result);
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.fieldName), ["follow_up_required", "follow_up_due_text"]);
  assert.equal(suggestions[0].managerSuggestedValue, "true");
  assert.equal(suggestions[0].previousDisplayValue, "indeterminate");
  assert.equal(suggestions[1].managerSuggestedValue, "tomorrow afternoon");
  assert.equal(suggestions.some((item) => item.fieldName === "objection_type"), false);
  assert.match(suggestions[0].note, /Suggested only/);
});

test("Evaluation Studio result validation blocks parked allocation report concepts", () => {
  const studio = createDefaultEvaluationStudio();
  const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "lead_validity_utilisation");

  assert.throws(() => upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-1",
    templateId: template.id,
    result: {
      call_id: "call-1",
      evaluation_goal: "lead_validity_utilisation",
      status: "usable",
      confidence: 0.7,
      evidence_availability: "available",
      transcript_quality: "medium",
      findings: [{ field: "allocation_coverage", value: "bad", evidence: "Old allocation coverage wording." }]
    }
  }), /parked campaign\/allocation/);
});

test("Evaluation Studio result persistence updates run counts and evidence queues", () => {
  const storePath = tempStorePath();
  const store = readStore({ storePath });
  const template = store.evaluationStudio.evaluationTemplates.find((item) => item.evaluationGoal === "objection_handling");
  const run = saveEvaluationRun({
    templateId: template.id,
    callSelection: { businessSegment: "new", limit: 2 }
  }, {
    importId: "import-july-7",
    plannedCallCount: 2
  }, { storePath }).run;

  const saved = saveEvaluationResult({
    importId: "import-july-7",
    runId: run.id,
    templateId: template.id,
    jobId: "job-1",
    result: {
      call_id: "call-1",
      evaluation_goal: "objection_handling",
      status: "usable",
      confidence: 0.81,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer raised affordability and salesperson acknowledged it.",
      findings: [{ field: "objection_type", value: "affordability", evidence: "Customer: I cannot afford it right now.", confidence: 0.81, manager_review_recommended: true }]
    }
  }, { storePath });

  assert.equal(saved.result.provenance, "evaluation_studio_local_model");
  assert.equal(saved.result.updatedBy, "local_manager");
  assert.equal(saved.result.knowledgebaseIds.length >= 1, true);
  assert.equal(saved.result.knowledgebaseVersions.length, saved.result.knowledgebaseIds.length);
  assert.equal(saved.result.knowledgebaseVersions.every((entry) => entry.id && entry.version >= 1), true);

  const persisted = readStore({ storePath });
  const persistedRun = persisted.evaluationStudio.evaluationRuns.find((item) => item.id === run.id);
  assert.equal(persistedRun.completedCallCount, 1);
  assert.equal(persistedRun.failedCallCount, 0);
  assert.equal(persisted.evaluationStudio.evaluationResults.length, 1);

  const persistence = dashboardPersistence(persisted, "import-july-7");
  assert.equal(persistence.counts.evaluationResults, 1);
  assert.equal(persistence.counts.evaluationReviewRecommendedResults, 1);
  assert.equal(persistence.evaluationStudio.evidenceQueue.length, 1);
  assert.equal(persistence.evaluationStudio.evidenceQueue[0].callId, "call-1");
  assert.equal(persistence.evaluationStudio.reportRollups.totals.objectionsDetected, 1);
});

test("Evaluation Studio report rollups produce report-safe lead utilisation and coaching signals", () => {
  const studio = createDefaultEvaluationStudio();
  const callbackTemplate = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
  const coachingTemplate = studio.evaluationTemplates.find((item) => item.evaluationGoal === "coaching_opportunity")
    || studio.evaluationTemplates.find((item) => item.evaluationGoal === "procedure_adherence");
  const first = upsertEvaluationResult(studio, {
    importId: "import-july-7",
    runId: "run-callback",
    templateId: callbackTemplate.id,
    jobId: "job-callback",
    result: {
      call_id: "call-callback",
      evaluation_goal: "callback_opportunity",
      status: "usable",
      confidence: 0.9,
      evidence_availability: "available",
      transcript_quality: "high",
      manager_summary: "Customer wanted a callback and gave an affordability objection.",
      manager_review_recommended: true,
      findings: [
        { field: "callback_requested", value: true, evidence: "Customer: call me back tomorrow.", confidence: 0.9, manager_review_recommended: true },
        { field: "objection_type", value: "budget_affordability", evidence: "Customer: I cannot afford it this week.", confidence: 0.86 },
        { field: "lead_utilisation_status", value: "possible_under_utilised", evidence: "Customer: call me back tomorrow.", confidence: 0.82 }
      ]
    }
  });
  const second = upsertEvaluationResult(first.studio, {
    importId: "import-july-7",
    runId: "run-coaching",
    templateId: coachingTemplate.id,
    jobId: "job-coaching",
    result: {
      call_id: "call-coaching",
      evaluation_goal: "coaching_opportunity",
      status: "usable",
      confidence: 0.72,
      evidence_availability: "partial",
      transcript_quality: "medium",
      manager_summary: "The close may need coaching review.",
      findings: [
        { field: "coaching_priority", value: "medium", evidence: "Agent ended without confirming next step.", confidence: 0.72 },
        { field: "stage_failure", value: "close", evidence: "Agent: no worries, take care.", confidence: 0.7 }
      ]
    }
  });

  const rollups = buildEvaluationStudioReportRollups(second.studio, { importId: "import-july-7" });
  assert.equal(rollups.totals.evaluatedCalls, 2);
  assert.equal(rollups.totals.callbackOpportunities, 1);
  assert.equal(rollups.totals.objectionsDetected, 1);
  assert.equal(rollups.totals.possibleWasteIndicators, 1);
  assert.equal(rollups.totals.coachingOpportunities, 2);
  assert.equal(rollups.priorityExamples.some((row) => row.reportLanguage === "possible waste indicator"), true);
  assert.equal(rollups.warnings.some((warning) => /confirmed sales/i.test(warning)), true);
  assert.equal(/QTY ACTIONED|allocation coverage|stable lead-days/i.test(JSON.stringify(rollups)), false);
});
