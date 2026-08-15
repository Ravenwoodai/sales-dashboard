"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { sourceNameFor } = require("./sourceQuality");
const { clean, isMissing } = require("./transcriptEvaluator");

const FUTURE_WINDOW_MS = 48 * 60 * 60 * 1000;

const TACTIC_LABELS = {
  stated_name: "Stated name",
  mentioned_company: "Mentioned company",
  explained_reason: "Explained reason",
  asked_for_callback: "Asked for callback",
  left_contact_detail: "Left contact detail",
  answered_prompt: "Answered assistant prompt",
  kept_message_concise: "Kept message concise"
};

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 10;
}

function entityKeys(row) {
  return ENTITY_FIELDS
    .map((field) => {
      const value = clean(row[field]);
      return isMissing(value) ? null : `${field}:${value}`;
    })
    .filter(Boolean);
}

function callIdFor(item) {
  return clean(item?.row?.call_id) || `row-${item?.row?.__rowNumber || "unknown"}`;
}

function customerIdFor(item) {
  const value = clean(item?.row?.customer_id);
  return isMissing(value) ? "" : value;
}

function sourceFor(item) {
  const value = clean(item?.sourceAttribution?.customerImportSource);
  return isMissing(value) ? sourceNameFor(item?.row || {}) : value;
}

function salespersonFor(item) {
  return clean(item?.row?.Salesperson) || "Unknown";
}

function dateKeyFor(item) {
  if (item?.dateTime) return item.dateTime.toISOString().slice(0, 10);
  const value = clean(item?.row?.call_date);
  return value || "Unknown date";
}

function dateLabelFor(item) {
  return clean(item?.row?.call_date) || dateKeyFor(item);
}

function aiAssistantFor(item) {
  return item?.evaluation?.aiVoiceAssistant || {};
}

function linkAiVoiceAssistantOutcomes(items, maxDateTime) {
  (items || []).forEach((item) => {
    const aiAssistant = aiAssistantFor(item);
    if (!aiAssistant.detected) return;
    aiAssistant.followThrough = {
      status: "not_evaluated",
      futureHumanContact: null,
      futureMeaningfulConversation: null,
      futureCallId: null
    };
  });
}

function seedGroup(name, extras = {}) {
  return {
    name,
    calls: 0,
    encounters: 0,
    highConfidenceEncounters: null,
    handledSuccessfully: null,
    bailed: null,
    partial: null,
    futureHumanContact: null,
    futureMeaningfulConversation: null,
    insufficientFutureData: null,
    totalResponseWords: null,
    tacticCounts: {},
    ...extras
  };
}

function addTactics(group, aiAssistant) {
  Object.entries(aiAssistant.tactics || {}).forEach(([key, present]) => {
    if (!present) return;
    if (!group.tacticCounts[key]) {
      group.tacticCounts[key] = {
        key,
        label: TACTIC_LABELS[key] || key,
        count: 0
      };
    }
    group.tacticCounts[key].count += 1;
  });
}

function addItemToGroup(group, item) {
  group.calls += 1;
  const aiAssistant = aiAssistantFor(item);
  if (!aiAssistant.detected) return;

  group.encounters += 1;
}

function topTactic(group) {
  return Object.values(group.tacticCounts || {}).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] || null;
}

function finalizeGroup(group) {
  const tactic = topTactic(group);
  return {
    ...group,
    encounterRate: percent(group.encounters, group.calls),
    highConfidenceRate: null,
    handledRate: null,
    bailRate: null,
    partialRate: null,
    futureHumanContactRate: null,
    futureMeaningfulConversationRate: null,
    insufficientFutureDataRate: null,
    averageResponseWords: null,
    topTactic: "Not evaluated",
    topTacticKey: tactic?.key || ""
  };
}

function groupedRows(items, keyFn, seedFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, seedFn(key, item));
    addItemToGroup(groups.get(key), item);
  });
  return Array.from(groups.values()).map(finalizeGroup);
}

function buildTacticRows(items) {
  return [];
}

function buildAiVoiceAssistantModel(items) {
  const totals = seedGroup("All calls");
  items.forEach((item) => addItemToGroup(totals, item));
  const finalizedTotals = finalizeGroup(totals);

  const trendRows = groupedRows(
    items,
    dateKeyFor,
    (key, item) => seedGroup(key, {
      date: key,
      label: dateLabelFor(item)
    })
  ).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const salespersonRows = groupedRows(
    items,
    salespersonFor,
    (name) => seedGroup(name, { salesperson: name })
  ).filter((row) => row.encounters > 0)
    .sort((a, b) => b.encounters - a.encounters || b.bailRate - a.bailRate || a.name.localeCompare(b.name));

  const sourceRows = groupedRows(
    items,
    sourceFor,
    (name) => seedGroup(name, { source: name })
  ).filter((row) => row.encounters > 0)
    .sort((a, b) => b.encounters - a.encounters || b.encounterRate - a.encounterRate || a.name.localeCompare(b.name));

  const tacticRows = buildTacticRows(items);
  const latestRows = items
    .filter((item) => aiAssistantFor(item).detected)
    .slice(-40)
    .reverse()
    .map((item) => {
      const aiAssistant = aiAssistantFor(item);
      return {
        callId: callIdFor(item),
        customerId: customerIdFor(item),
        date: clean(item.row.call_date),
        time: clean(item.row.call_time),
        salesperson: salespersonFor(item),
        source: sourceFor(item),
        confidence: null,
        responseClassification: aiAssistant.responseClassification,
        handledSuccessfully: aiAssistant.handledSuccessfully,
        bailed: aiAssistant.bailed,
        tacticLabels: aiAssistant.tacticLabels || [],
        futureStatus: aiAssistant.followThrough?.status || "",
        futureCallId: null,
        evidence: aiAssistant.evidence?.text || ""
      };
    });

  return {
    schemaVersion: "sales_dashboard_ai_voice_assistant.v1",
    definitions: {
      encounter: "Exact AI call-assistant or screened-call wording detected in a Customer, Voicemail, or unlabeled transcript turn.",
      bail: "Not evaluated.",
      handledSuccessfully: "Not evaluated.",
      futureHumanContact: "Not evaluated; a later matching call does not prove human contact or recovery."
    },
    totals: finalizedTotals,
    trendRows,
    salespersonRows,
    sourceRows,
    tacticRows,
    latestRows,
    topSuccessTactic: tacticRows.filter((row) => row.encounters >= 3).sort((a, b) => b.handledRate - a.handledRate || b.encounters - a.encounters)[0] || tacticRows[0] || null
  };
}

module.exports = {
  TACTIC_LABELS,
  buildAiVoiceAssistantModel,
  linkAiVoiceAssistantOutcomes
};
