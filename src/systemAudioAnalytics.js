"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { sourceNameFor } = require("./sourceQuality");
const { clean, isMissing } = require("./transcriptEvaluator");
const { businessRelationshipFor } = require("./businessRelationship");

const FUTURE_WINDOW_MS = 48 * 60 * 60 * 1000;

const SUBTYPE_LABELS = {
  call_screening: "Call Screening / AI Assistant",
  carrier_phone_system: "Carrier / Phone System",
  machine_voicemail: "Machine Voicemail",
  ambiguous_system_audio: "Ambiguous System Audio",
  none: "None"
};

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 0)) * 1000) / 10;
}

function entityKeys(row) {
  return ENTITY_FIELDS
    .map((field) => {
      const value = clean(row?.[field]);
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

function contactIdFor(item) {
  const value = clean(item?.row?.ContactId);
  return isMissing(value) ? "" : value;
}

function sourceFor(item) {
  const value = clean(item?.sourceAttribution?.customerImportSource);
  return isMissing(value) ? sourceNameFor(item?.row || {}) : value;
}

function businessSegmentFor(item) {
  return businessRelationshipFor(item?.row || {}).segment;
}

function businessSegmentLabel(segment) {
  if (segment === "warm") return "Warm Business";
  if (segment === "new") return "New Business";
  return "";
}

function salespersonFor(item) {
  return clean(item?.row?.Salesperson) || "Unknown";
}

function dateKeyFor(item) {
  if (item?.dateTime) return item.dateTime.toISOString().slice(0, 10);
  return clean(item?.row?.call_date) || "Unknown date";
}

function dateLabelFor(item) {
  return clean(item?.row?.call_date) || dateKeyFor(item);
}

function systemAudioFor(item) {
  const details = item?.evaluation?.systemAudio || {};
  return {
    detected: Boolean(details.detected || item?.evaluation?.contact?.classification === "system_audio" || item?.evaluation?.outcome?.localCategory === "system_audio"),
    subtype: details.subtype || (item?.evaluation?.contact?.classification === "system_audio" ? "ambiguous_system_audio" : "none"),
    label: details.label || SUBTYPE_LABELS[details.subtype] || "Ambiguous System Audio",
    category: details.category || "ambiguous",
    shouldTrackRecovery: false
  };
}

function screeningResponseFor(item) {
  return {
    handledSuccessfully: null,
    bailed: null,
    partial: null,
    tacticLabels: [],
    responseClassification: "detected_unscored"
  };
}

function laterMatchesFor(item, laterByKey) {
  const matches = entityKeys(item.row).flatMap((key) => laterByKey.get(key) || []);
  return Array.from(new Map(matches.map((match) => [callIdFor(match), match])).values())
    .filter((match) => callIdFor(match) !== callIdFor(item));
}

function seedGroup(name, extras = {}) {
  return {
    name,
    calls: 0,
    encounters: 0,
    callScreening: 0,
    carrierPhoneSystem: 0,
    machineVoicemail: 0,
    ambiguousSystemAudio: 0,
    handledSuccessfully: null,
    bailed: null,
    partial: null,
    futureHumanContact: null,
    futureMeaningfulConversation: null,
    insufficientFutureData: null,
    ...extras
  };
}

function addRecord(group, record) {
  group.encounters += 1;
  group.calls += 1;
  if (record.subtype === "call_screening") group.callScreening += 1;
  if (record.subtype === "carrier_phone_system") group.carrierPhoneSystem += 1;
  if (record.subtype === "machine_voicemail") group.machineVoicemail += 1;
  if (record.subtype === "ambiguous_system_audio") group.ambiguousSystemAudio += 1;
  if (record.handledSuccessfully) group.handledSuccessfully += 1;
  if (record.bailed) group.bailed += 1;
  if (record.partial) group.partial += 1;
  if (record.futureHumanContact) group.futureHumanContact += 1;
  if (record.futureMeaningfulConversation) group.futureMeaningfulConversation += 1;
  if (record.futureStatus === "insufficient_future_data") group.insufficientFutureData += 1;
}

function finalizeGroup(group) {
  return {
    ...group,
    callScreeningRate: percent(group.callScreening, group.encounters),
    carrierPhoneSystemRate: percent(group.carrierPhoneSystem, group.encounters),
    machineVoicemailRate: percent(group.machineVoicemail, group.encounters),
    ambiguousSystemAudioRate: percent(group.ambiguousSystemAudio, group.encounters),
    handledRate: null,
    bailRate: null,
    futureHumanContactRate: null,
    futureMeaningfulConversationRate: null
  };
}

function groupedRows(records, keyFn, seedFn) {
  const groups = new Map();
  records.forEach((record) => {
    const key = keyFn(record);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, seedFn(key, record));
    addRecord(groups.get(key), record);
  });
  return Array.from(groups.values()).map(finalizeGroup);
}

function buildSystemAudioRecords(items, maxDateTime) {
  const laterByKey = new Map();
  const records = [];

  [...items].reverse().forEach((item) => {
    const systemAudio = systemAudioFor(item);
    if (systemAudio.detected) {
      const laterMeaningful = null;
      const laterHuman = null;
      const futureCall = null;
      const screeningResponse = systemAudio.subtype === "call_screening" ? screeningResponseFor(item) : {
        handledSuccessfully: null,
        bailed: null,
        partial: null,
        tacticLabels: [],
        responseClassification: "not_applicable"
      };

      records.push({
        type: "system_audio",
        callId: callIdFor(item),
        customerId: customerIdFor(item),
        contactId: contactIdFor(item),
        date: clean(item.row.call_date),
        time: clean(item.row.call_time),
        dateTime: item.dateTime ? item.dateTime.toISOString() : "",
        salesperson: salespersonFor(item),
        source: sourceFor(item),
        businessSegment: businessSegmentFor(item),
        businessSegmentLabel: businessSegmentLabel(businessSegmentFor(item)),
        subtype: systemAudio.subtype,
        subtypeLabel: systemAudio.label,
        contactClassification: item.evaluation?.contact?.classification || "",
        localOutcome: item.evaluation?.outcome?.localCategory || "",
        transcriptQuality: item.evaluation?.transcript?.qualityBand || "",
        handledSuccessfully: screeningResponse.handledSuccessfully,
        bailed: screeningResponse.bailed,
        partial: screeningResponse.partial,
        responseClassification: screeningResponse.responseClassification,
        tacticLabels: screeningResponse.tacticLabels,
        futureHumanContact: null,
        futureMeaningfulConversation: null,
        futureStatus: "not_evaluated",
        futureCallId: futureCall ? callIdFor(futureCall) : "",
        transcriptPreview: item.evaluation?.preview || "",
        metricKeys: [
          "calls.systemAudio",
          `calls.systemAudio.${systemAudio.subtype}`,
          ""
        ].filter(Boolean)
      });
    }

    entityKeys(item.row).forEach((key) => {
      const existing = laterByKey.get(key) || [];
      existing.push(item);
      laterByKey.set(key, existing);
    });
  });

  return records.reverse();
}

function summarizeSystemAudioRecords(records, options = {}) {
  const rows = Array.isArray(records) ? records : [];
  const totals = finalizeGroup(rows.reduce((group, record) => {
    addRecord(group, record);
    return group;
  }, seedGroup("All system audio")));
  totals.totalCalls = Number(options.totalCalls || rows.length);
  totals.encounterRate = percent(totals.encounters, totals.totalCalls);

  const subtypeRows = groupedRows(
    rows,
    (record) => record.subtype,
    (subtype, record) => seedGroup(record.subtypeLabel, {
      subtype,
      subtypeLabel: record.subtypeLabel
    })
  ).sort((a, b) => b.encounters - a.encounters || a.name.localeCompare(b.name));

  const salespersonRows = groupedRows(
    rows,
    (record) => record.salesperson,
    (name) => seedGroup(name, { salesperson: name })
  ).sort((a, b) => b.encounters - a.encounters || b.bailRate - a.bailRate || a.salesperson.localeCompare(b.salesperson));

  const sourceRows = groupedRows(
    rows,
    (record) => record.source,
    (name) => seedGroup(name, { source: name })
  ).sort((a, b) => b.encounters - a.encounters || b.futureHumanContactRate - a.futureHumanContactRate || a.source.localeCompare(b.source));

  const trendRows = groupedRows(
    rows,
    (record) => record.date,
    (date, record) => seedGroup(date, {
      date,
      label: record.date
    })
  ).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const latestRows = [...rows].slice(-40).reverse();

  return {
    totals,
    subtypeRows,
    salespersonRows,
    sourceRows,
    trendRows,
    latestRows,
    records: rows
  };
}

function buildSystemAudioModel(items) {
  const dateTimes = items.map((item) => item.dateTime).filter(Boolean);
  const maxDateTime = dateTimes.length ? new Date(Math.max(...dateTimes.map((date) => date.getTime()))) : null;
  const records = buildSystemAudioRecords(items, maxDateTime);

  return {
    schemaVersion: "sales_dashboard_system_audio.v1",
    definitions: {
      encounter: "Exact system-audio wording detected in a permitted transcript context, including call screening, canonical carrier messages, and machine voicemail.",
      subtype: "Restricted literal category; blank or customer-spoken carrier wording is not enough.",
      recovered: "Not evaluated: a later matching call does not prove human contact or recovery.",
      handledSuccessfully: "Not evaluated: call-screening handling quality is outside the validated rule boundary."
    },
    ...summarizeSystemAudioRecords(records, { totalCalls: items.length })
  };
}

module.exports = {
  SUBTYPE_LABELS,
  buildSystemAudioModel,
  summarizeSystemAudioRecords
};
