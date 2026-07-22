"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { sourceNameFor } = require("./sourceQuality");
const { clean, isMissing } = require("./transcriptEvaluator");

const STABLE_LEAD_FIELDS = ["customer_id", "AllocatedLeadID", "ContactId", "FoundContactID", "FoundCustomerID"]
  .filter((field) => ENTITY_FIELDS.includes(field));
const LITERAL_NO_CONTACT_CLASSIFICATIONS = new Set(["no_answer", "system_audio", "voicemail"]);
const LITERAL_EVIDENCE_SIGNALS = new Set([
  "literal_no_answer",
  "literal_machine_voicemail",
  "literal_carrier_system",
  "ai_voice_assistant"
]);

function percent(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function dayKeyFor(item) {
  if (item.dateTime) return item.dateTime.toISOString().slice(0, 10);
  return clean(item.row.call_date) || "unknown-date";
}

function ownerFor(item) {
  return clean(item.row.Salesperson) || "Unknown";
}

function stableLeadFor(row) {
  for (const field of STABLE_LEAD_FIELDS) {
    const value = clean(row[field]);
    if (!isMissing(value)) return { source: field, value, key: `${field}:${value}` };
  }
  return null;
}

function customerIdFor(row) {
  const value = clean(row.customer_id);
  return isMissing(value) ? "" : value;
}

function exactLiteralEvidence(item) {
  const evidence = Array.isArray(item?.evaluation?.evidence) ? item.evaluation.evidence : [];
  return evidence.find((entry) => LITERAL_EVIDENCE_SIGNALS.has(entry.signal)) || null;
}

function literalEvidenceSummary(item, fallback) {
  const evidence = exactLiteralEvidence(item);
  return clean(evidence?.summary || evidence?.text) || fallback;
}

function literalEvidenceExcerpt(item) {
  return clean(exactLiteralEvidence(item)?.text).replace(/\s+/g, " ").slice(0, 220);
}

function isExplicitCallbackDuty() {
  return false;
}

function isLiteralNoContact(item) {
  return LITERAL_NO_CONTACT_CLASSIFICATIONS.has(clean(item?.evaluation?.contact?.classification))
    && Boolean(exactLiteralEvidence(item));
}

function getSalespersonStats(map, salesperson) {
  const key = salesperson || "Unknown";
  if (!map.has(key)) {
    map.set(key, {
      salesperson: key,
      calls: 0,
      stableLeadDayKeysWorked: new Set(),
      noContactLeadDayKeys: new Set(),
      noContactRetriedSameDay: 0,
      singleAttemptNoContact: 0,
      examples: []
    });
  }
  return map.get(key);
}

function buildLeadUtilizationModel(items = []) {
  const statsBySalesperson = new Map();
  const leadDayGroups = new Map();
  let callsWithoutStableLead = 0;
  let matchedCalls = 0;

  for (const item of items) {
    const stableLead = stableLeadFor(item.row);
    if (!stableLead) {
      callsWithoutStableLead += 1;
      continue;
    }
    const salesperson = ownerFor(item);
    const groupKey = `${dayKeyFor(item)}|${stableLead.key}`;
    const stats = getSalespersonStats(statsBySalesperson, salesperson);
    matchedCalls += 1;
    stats.calls += 1;
    stats.stableLeadDayKeysWorked.add(groupKey);
    if (!leadDayGroups.has(groupKey)) {
      leadDayGroups.set(groupKey, {
        key: groupKey,
        day: dayKeyFor(item),
        stableLeadSource: stableLead.source,
        stableLeadValue: stableLead.value,
        items: []
      });
    }
    leadDayGroups.get(groupKey).items.push(item);
  }

  let noContactLeadDays = 0;
  let noContactRetriedSameDay = 0;
  let singleAttemptNoContact = 0;
  const records = [];

  for (const group of leadDayGroups.values()) {
    const groupItems = [...group.items].sort((a, b) => {
      const aTime = a.dateTime ? a.dateTime.getTime() : 0;
      const bTime = b.dateTime ? b.dateTime.getTime() : 0;
      return aTime - bTime;
    });
    const firstItem = groupItems[0];
    const salesperson = ownerFor(firstItem);
    const stats = getSalespersonStats(statsBySalesperson, salesperson);
    const allLiteralNoContact = groupItems.length > 0 && groupItems.every(isLiteralNoContact);
    const record = {
      type: "lead_day",
      id: group.key,
      day: group.day,
      salesperson,
      source: sourceNameFor(firstItem.row),
      customerId: customerIdFor(firstItem.row),
      stableLeadSource: group.stableLeadSource,
      stableLeadValue: group.stableLeadValue,
      primaryCallId: clean(firstItem.row.call_id),
      callIds: groupItems.map((item) => clean(item.row.call_id)).filter(Boolean),
      metricKeys: ["lead.stableLeadDaysWorked"],
      reason: "Matched record worked.",
      evidence: literalEvidenceSummary(firstItem, "No literal no-contact evidence claimed."),
      evidenceExcerpt: literalEvidenceExcerpt(firstItem)
    };

    if (allLiteralNoContact) {
      noContactLeadDays += 1;
      stats.noContactLeadDayKeys.add(group.key);
      record.metricKeys.push("lead.noContactLeadDays");
      if (groupItems.length > 1) {
        noContactRetriedSameDay += 1;
        stats.noContactRetriedSameDay += 1;
        record.metricKeys.push("lead.noContactRetriedSameDay");
        record.reason = "Every same-day attempt has exact literal no-contact evidence, and the matched record was retried.";
      } else {
        singleAttemptNoContact += 1;
        stats.singleAttemptNoContact += 1;
        record.metricKeys.push("lead.singleAttemptNoContact");
        record.reason = "One same-day attempt has exact literal no-contact evidence.";
        if (stats.examples.length < 8) {
          stats.examples.push({
            callId: clean(firstItem.row.call_id),
            customerId: customerIdFor(firstItem.row),
            salesperson,
            stableLeadSource: group.stableLeadSource,
            reason: record.reason,
            evidence: record.evidence,
            evidenceExcerpt: record.evidenceExcerpt
          });
        }
      }
    }
    records.push(record);
  }

  const salespeople = Array.from(statsBySalesperson.values())
    .map((stats) => ({
      salesperson: stats.salesperson,
      calls: stats.calls,
      stableLeadDaysWorked: stats.stableLeadDayKeysWorked.size,
      noContactLeadDays: stats.noContactLeadDayKeys.size,
      noContactRetriedSameDay: stats.noContactRetriedSameDay,
      singleAttemptNoContact: stats.singleAttemptNoContact,
      noContactRetryRate: percent(stats.noContactRetriedSameDay, stats.noContactLeadDayKeys.size),
      examples: stats.examples
    }))
    .sort((a, b) => b.noContactLeadDays - a.noContactLeadDays || a.salesperson.localeCompare(b.salesperson));

  return {
    schemaVersion: "literal_no_contact_activity.v3",
    authorityStatus: "restricted_literal_activity_only",
    stableLeadFields: STABLE_LEAD_FIELDS,
    definitions: {
      literalNoContact: "Every included attempt has exact no-answer, machine-voicemail, carrier-system, or AI-assistant evidence. Blank and unknown transcripts are excluded.",
      activityOnly: "These counts do not establish callback failure, lead waste, under-utilisation, or salesperson performance.",
      callbackMeaning: "Not evaluated."
    },
    totals: {
      calls: matchedCalls,
      callsWithoutStableLead,
      stableLeadDaysWorked: leadDayGroups.size,
      noContactLeadDays,
      noContactRetriedSameDay,
      singleAttemptNoContact,
      noContactRetryRate: percent(noContactRetriedSameDay, noContactLeadDays),
      semanticCallbackMetrics: null,
      utilisationJudgement: null
    },
    salespeople,
    records,
    evidenceSamples: salespeople.flatMap((person) => person.examples).slice(0, 40)
  };
}

function buildLeadUtilizationReport() {
  return null;
}

module.exports = {
  STABLE_LEAD_FIELDS,
  buildLeadUtilizationModel,
  buildLeadUtilizationReport,
  isExplicitCallbackDuty
};
