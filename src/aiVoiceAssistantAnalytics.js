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
  const keyToLaterItems = new Map();

  [...items].reverse().forEach((item) => {
    const aiAssistant = aiAssistantFor(item);
    const keys = entityKeys(item.row);
    const laterMatches = keys.flatMap((key) => keyToLaterItems.get(key) || []);
    const uniqueLaterMatches = Array.from(new Map(laterMatches.map((match) => [callIdFor(match), match])).values());

    if (aiAssistant.detected) {
      const laterMeaningful = uniqueLaterMatches.find((match) => match.evaluation?.contact?.meaningfulConversation);
      const laterHuman = laterMeaningful || uniqueLaterMatches.find((match) => match.evaluation?.contact?.probableLiveHuman);
      const futureCall = laterMeaningful || laterHuman || null;
      const insufficientFutureData = !futureCall && (!item.dateTime || !maxDateTime || maxDateTime.getTime() - item.dateTime.getTime() < FUTURE_WINDOW_MS);

      aiAssistant.followThrough = {
        status: futureCall
          ? laterMeaningful ? "future_meaningful_conversation" : "future_human_contact"
          : insufficientFutureData ? "insufficient_future_data" : "not_seen_in_future_data",
        futureHumanContact: Boolean(laterHuman),
        futureMeaningfulConversation: Boolean(laterMeaningful),
        futureCallId: futureCall ? callIdFor(futureCall) : ""
      };
    }

    keys.forEach((key) => {
      const existing = keyToLaterItems.get(key) || [];
      existing.push(item);
      keyToLaterItems.set(key, existing);
    });
  });
}

function seedGroup(name, extras = {}) {
  return {
    name,
    calls: 0,
    encounters: 0,
    highConfidenceEncounters: 0,
    handledSuccessfully: 0,
    bailed: 0,
    partial: 0,
    futureHumanContact: 0,
    futureMeaningfulConversation: 0,
    insufficientFutureData: 0,
    totalResponseWords: 0,
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
  if (Number(aiAssistant.confidence || 0) >= 0.85) group.highConfidenceEncounters += 1;
  if (aiAssistant.handledSuccessfully) group.handledSuccessfully += 1;
  else if (aiAssistant.bailed) group.bailed += 1;
  else group.partial += 1;
  if (aiAssistant.followThrough?.futureHumanContact) group.futureHumanContact += 1;
  if (aiAssistant.followThrough?.futureMeaningfulConversation) group.futureMeaningfulConversation += 1;
  if (aiAssistant.followThrough?.status === "insufficient_future_data") group.insufficientFutureData += 1;
  group.totalResponseWords += Number(aiAssistant.responseWordCount || 0);
  addTactics(group, aiAssistant);
}

function topTactic(group) {
  const row = Object.values(group.tacticCounts || {}).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
  return row ? row.label : "No clear tactic";
}

function finalizeGroup(group) {
  return {
    ...group,
    encounterRate: percent(group.encounters, group.calls),
    highConfidenceRate: percent(group.highConfidenceEncounters, group.encounters),
    handledRate: percent(group.handledSuccessfully, group.encounters),
    bailRate: percent(group.bailed, group.encounters),
    partialRate: percent(group.partial, group.encounters),
    futureHumanContactRate: percent(group.futureHumanContact, group.encounters),
    futureMeaningfulConversationRate: percent(group.futureMeaningfulConversation, group.encounters),
    insufficientFutureDataRate: percent(group.insufficientFutureData, group.encounters),
    averageResponseWords: group.encounters ? Math.round(group.totalResponseWords / group.encounters) : 0,
    topTactic: topTactic(group)
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
  const groups = new Map();
  items.forEach((item) => {
    const aiAssistant = aiAssistantFor(item);
    if (!aiAssistant.detected) return;

    Object.entries(aiAssistant.tactics || {}).forEach(([key, present]) => {
      if (!present) return;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: TACTIC_LABELS[key] || key,
          encounters: 0,
          handledSuccessfully: 0,
          bailed: 0,
          futureHumanContact: 0,
          futureMeaningfulConversation: 0
        });
      }
      const group = groups.get(key);
      group.encounters += 1;
      if (aiAssistant.handledSuccessfully) group.handledSuccessfully += 1;
      if (aiAssistant.bailed) group.bailed += 1;
      if (aiAssistant.followThrough?.futureHumanContact) group.futureHumanContact += 1;
      if (aiAssistant.followThrough?.futureMeaningfulConversation) group.futureMeaningfulConversation += 1;
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      handledRate: percent(group.handledSuccessfully, group.encounters),
      bailRate: percent(group.bailed, group.encounters),
      futureHumanContactRate: percent(group.futureHumanContact, group.encounters),
      futureMeaningfulConversationRate: percent(group.futureMeaningfulConversation, group.encounters)
    }))
    .sort((a, b) => b.encounters - a.encounters || b.handledRate - a.handledRate || a.label.localeCompare(b.label));
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
        confidence: aiAssistant.confidence,
        responseClassification: aiAssistant.responseClassification,
        handledSuccessfully: aiAssistant.handledSuccessfully,
        bailed: aiAssistant.bailed,
        tacticLabels: aiAssistant.tacticLabels || [],
        futureStatus: aiAssistant.followThrough?.status || "",
        futureCallId: aiAssistant.followThrough?.futureCallId || "",
        evidence: aiAssistant.evidence?.text || ""
      };
    });

  return {
    schemaVersion: "sales_dashboard_ai_voice_assistant.v1",
    definitions: {
      encounter: "Explicit AI call-assistant or screened-call language detected in the transcript.",
      bail: "AI assistant encountered but the salesperson did not leave a useful name, reason, callback, or contact-detail response.",
      handledSuccessfully: "Salesperson gave a structured response, usually combining reason for calling with identification, callback, or contact details.",
      futureHumanContact: "A later call to the same stable customer/lead/contact reached a probable live human in the available data."
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
