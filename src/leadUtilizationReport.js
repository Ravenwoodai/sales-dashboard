"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { sourceNameFor } = require("./sourceQuality");
const { clean, isMissing } = require("./transcriptEvaluator");
const { formatSourceDateTimeValue } = require("./dateTimeFormat");

const STABLE_LEAD_FIELDS = ["customer_id", "AllocatedLeadID", "ContactId", "FoundContactID", "FoundCustomerID"]
  .filter((field) => ENTITY_FIELDS.includes(field));
const NO_CONTACT_CLASSIFICATIONS = new Set(["no_answer", "system_audio", "voicemail", "unknown"]);

const CUSTOMER_CALLBACK_PATTERNS = [
  /\bcustomer\s*:\s*.{0,220}\bcall\s+me\s+back\b/i,
  /\bcustomer\s*:\s*.{0,220}\bring\s+me\s+back\b/i,
  /\bcustomer\s*:\s*.{0,220}\btry\s+me\s+(?:later|tomorrow|after|again)\b/i,
  /\bcustomer\s*:\s*.{0,220}\b(?:call|ring|try)\s+(?:back|again)\s+(?:later|tomorrow|after|then|this afternoon|later today)\b/i,
  /\bcustomer\s*:\s*.{0,220}\b(?:too busy|not now|not a good time|in a meeting).{0,100}\b(?:call|ring|try)\b/i
];

const AGENT_PROMISE_PATTERNS = [
  /\b(?:agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:\s*.{0,220}\b(?:i|we)(?:'ll| will)\s+(?:give\s+you\s+a\s+)?(?:call|ring)\s+(?:back|later|tomorrow|then|after|again)\b/i,
  /\b(?:agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:\s*.{0,220}\b(?:i|we)(?:'ll| will)\s+try\s+(?:you|again)\b/i,
  /\b(?:agent|[A-Z][A-Za-z' -]{1,60}\s+\(CWA\))\s*:\s*.{0,220}\b(?:i|we)(?:'ll| will)\s+follow\s+up\b/i
];

const GENERIC_CALLBACK_PATTERNS = [
  /\bcall\s+me\s+back\b/i,
  /\bring\s+me\s+back\b/i,
  /\btry\s+me\s+(?:later|tomorrow|after|again)\b/i,
  /\b(?:i|we)(?:'ll| will)\s+(?:give\s+you\s+a\s+)?(?:call|ring)\s+(?:back|later|tomorrow|then|after|again)\b/i,
  /\b(?:i|we)(?:'ll| will)\s+try\s+(?:you|again)\b/i,
  /\b(?:i|we)(?:'ll| will)\s+follow\s+up\b/i,
  /\b(?:call|ring|try)\s+(?:back|again)\s+(?:later|tomorrow|after|then|this afternoon|later today)\b/i
];

const FUTURE_DUE_PATTERNS = [
  /\btomorrow\b/i,
  /\bnext\s+(?:business\s+day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:call|ring|try|follow\s+up).{0,80}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.{0,80}\b(?:call|ring|try|follow\s+up)\b/i
];

function percent(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatPercent(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatModelPercent(value) {
  return value === null || value === undefined ? "n/a" : `${Number(value || 0).toFixed(1)}%`;
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
    if (!isMissing(value)) {
      return {
        source: field,
        value,
        key: `${field}:${value}`
      };
    }
  }
  return null;
}

function customerIdFor(row) {
  const value = clean(row.customer_id);
  return isMissing(value) ? "" : value;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isExplicitCallbackDuty(item) {
  if (!item.evaluation.contact.probableLiveHuman) return false;

  const text = clean(item.row.transcription_text).replace(/\s+/g, " ");
  if (!text) return false;

  return hasAny(text, CUSTOMER_CALLBACK_PATTERNS) ||
    hasAny(text, AGENT_PROMISE_PATTERNS) ||
    hasAny(text, GENERIC_CALLBACK_PATTERNS);
}

function isFutureCallbackDue(item) {
  const text = clean(item.row.transcription_text).replace(/\s+/g, " ");
  return hasAny(text, FUTURE_DUE_PATTERNS);
}

function evidenceSummary(item, fallback = "") {
  const followUpEvidence = item.evaluation.evidence.find((evidence) => evidence.signal === "follow_up");
  if (followUpEvidence?.summary) return followUpEvidence.summary;
  return fallback || "Open the call proof to review transcript evidence";
}

function evidenceExcerpt(item, fallback = "") {
  const followUpEvidence = item.evaluation.evidence.find((evidence) => evidence.signal === "follow_up");
  const source = clean(followUpEvidence?.text || item.evaluation.preview || item.row.transcription_text || fallback).replace(/\s+/g, " ");
  return source.slice(0, 220);
}

function isNoContact(item) {
  return !item.evaluation.contact.probableLiveHuman ||
    NO_CONTACT_CLASSIFICATIONS.has(item.evaluation.contact.classification);
}

function createStats(name) {
  return {
    salesperson: name,
    calls: 0,
    stableLeadDayKeysWorked: new Set(),
    callbackRequests: 0,
    callbackSameDayRequired: 0,
    callbackCompletedSameDay: 0,
    callbackMissedSameDay: 0,
    callbackFutureNeedsUpload: 0,
    teamCoveredCallbacks: 0,
    noContactLeadDayKeys: new Set(),
    noContactRetriedSameDay: 0,
    singleAttemptNoContact: 0,
    wastedLeadDayKeys: new Set(),
    examples: []
  };
}

function addExample(stats, example) {
  if (stats.examples.length < 8) {
    stats.examples.push(example);
  }
}

function getStats(statsBySalesperson, name) {
  const salesperson = name || "Unknown";
  if (!statsBySalesperson.has(salesperson)) {
    statsBySalesperson.set(salesperson, createStats(salesperson));
  }
  return statsBySalesperson.get(salesperson);
}

function laterSameDayCall(groupItems, index) {
  const item = groupItems[index];
  return groupItems.slice(index + 1).find((candidate) => {
    if (!item.dateTime || !candidate.dateTime) return true;
    return candidate.dateTime.getTime() > item.dateTime.getTime();
  }) || null;
}

function serialiseStats(stats) {
  const stableLeadDaysWorked = stats.stableLeadDayKeysWorked.size;
  const noContactLeadDays = stats.noContactLeadDayKeys.size;
  const callbackCompletionRate = percent(stats.callbackCompletedSameDay, stats.callbackSameDayRequired);
  const noContactRetryRate = percent(stats.noContactRetriedSameDay, noContactLeadDays);
  const riskRate = percent(stats.wastedLeadDayKeys.size, stableLeadDaysWorked);
  const utilizationScore = riskRate === null ? null : Math.max(0, Math.round((1 - riskRate) * 100));

  return {
    salesperson: stats.salesperson,
    calls: stats.calls,
    stableLeadDaysWorked,
    callbackRequests: stats.callbackRequests,
    callbackSameDayRequired: stats.callbackSameDayRequired,
    callbackCompletedSameDay: stats.callbackCompletedSameDay,
    callbackMissedSameDay: stats.callbackMissedSameDay,
    callbackFutureNeedsUpload: stats.callbackFutureNeedsUpload,
    teamCoveredCallbacks: stats.teamCoveredCallbacks,
    noContactLeadDays,
    noContactRetriedSameDay: stats.noContactRetriedSameDay,
    singleAttemptNoContact: stats.singleAttemptNoContact,
    wastedLeadIndicators: stats.wastedLeadDayKeys.size,
    callbackCompletionRate,
    noContactRetryRate,
    riskRate,
    utilizationScore,
    examples: stats.examples
  };
}

function buildLeadUtilizationModel(items) {
  const statsBySalesperson = new Map();
  const leadDayGroups = new Map();
  const totals = {
    calls: 0,
    callsWithoutStableLead: 0,
    stableLeadDaysWorked: 0,
    callbackRequests: 0,
    callbackSameDayRequired: 0,
    callbackCompletedSameDay: 0,
    callbackMissedSameDay: 0,
    callbackFutureNeedsUpload: 0,
    teamCoveredCallbacks: 0,
    noContactLeadDays: 0,
    noContactRetriedSameDay: 0,
    singleAttemptNoContact: 0,
    wastedLeadIndicators: 0
  };
  const wastedLeadDayKeys = new Set();
  const records = [];

  items.forEach((item) => {
    const stableLead = stableLeadFor(item.row);
    if (!stableLead) {
      totals.callsWithoutStableLead += 1;
      return;
    }

    const owner = ownerFor(item);
    const stats = getStats(statsBySalesperson, owner);
    const groupKey = `${dayKeyFor(item)}|${stableLead.key}`;

    totals.calls += 1;
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
    leadDayGroups.get(groupKey).items.push({ ...item, stableLeadSource: stableLead.source });
  });

  totals.stableLeadDaysWorked = leadDayGroups.size;

  leadDayGroups.forEach((group) => {
    const groupItems = group.items.sort((a, b) => {
      const aTime = a.dateTime ? a.dateTime.getTime() : 0;
      const bTime = b.dateTime ? b.dateTime.getTime() : 0;
      return aTime - bTime;
    });
    const firstItem = groupItems[0];
    const firstOwner = ownerFor(firstItem);
    const firstOwnerStats = getStats(statsBySalesperson, firstOwner);
    const noLiveHumanAllDay = groupItems.every(isNoContact);
    const groupRecord = {
      type: "lead_day",
      id: group.key,
      day: group.day,
      salesperson: firstOwner,
      source: sourceNameFor(firstItem.row),
      customerId: customerIdFor(firstItem.row),
      stableLeadSource: group.stableLeadSource,
      stableLeadValue: group.stableLeadValue,
      primaryCallId: clean(firstItem.row.call_id),
      callIds: groupItems.map((call) => clean(call.row.call_id)).filter(Boolean),
      metricKeys: ["lead.stableLeadDaysWorked"],
      reason: "Matched record worked.",
      evidence: evidenceSummary(firstItem, "Matched record worked"),
      evidenceExcerpt: evidenceExcerpt(firstItem)
    };

    if (noLiveHumanAllDay) {
      totals.noContactLeadDays += 1;
      firstOwnerStats.noContactLeadDayKeys.add(group.key);
      groupRecord.metricKeys.push("lead.noContactLeadDays");

      if (groupItems.length > 1) {
        totals.noContactRetriedSameDay += 1;
        firstOwnerStats.noContactRetriedSameDay += 1;
        groupRecord.metricKeys.push("lead.noContactRetriedSameDay");
        groupRecord.reason = "No probable live-human contact, but the matched record was retried same day.";
      } else {
        totals.singleAttemptNoContact += 1;
        firstOwnerStats.singleAttemptNoContact += 1;
        firstOwnerStats.wastedLeadDayKeys.add(group.key);
        wastedLeadDayKeys.add(group.key);
        groupRecord.metricKeys.push("lead.singleAttemptNoContact", "lead.wastedLeadIndicators");
        groupRecord.reason = "Only one same-day attempt; no probable live-human contact.";
        addExample(firstOwnerStats, {
          callId: clean(firstItem.row.call_id),
          customerId: customerIdFor(firstItem.row),
          salesperson: firstOwner,
          stableLeadSource: group.stableLeadSource,
          reason: "Only one same-day attempt; no probable live-human contact.",
          evidence: evidenceSummary(firstItem, "No live-human contact found; only one same-day attempt"),
          evidenceExcerpt: evidenceExcerpt(firstItem, "No contact evidence")
        });
      }
    }

    groupItems.forEach((item, index) => {
      if (!isExplicitCallbackDuty(item)) return;

      const owner = ownerFor(item);
      const stats = getStats(statsBySalesperson, owner);
      stats.callbackRequests += 1;
      totals.callbackRequests += 1;

      if (isFutureCallbackDue(item)) {
        stats.callbackFutureNeedsUpload += 1;
        totals.callbackFutureNeedsUpload += 1;
        records.push({
          type: "callback_duty",
          id: `${group.key}|callback|${clean(item.row.call_id)}`,
          day: group.day,
          salesperson: owner,
          source: sourceNameFor(item.row),
          customerId: customerIdFor(item.row),
          stableLeadSource: group.stableLeadSource,
          stableLeadValue: group.stableLeadValue,
          primaryCallId: clean(item.row.call_id),
          callIds: groupItems.map((call) => clean(call.row.call_id)).filter(Boolean),
          metricKeys: ["lead.callbackFutureNeedsUpload"],
          reason: "Explicit callback duty points to a future day and requires a later upload.",
          evidence: evidenceSummary(item, "Callback duty points to a future day"),
          evidenceExcerpt: evidenceExcerpt(item)
        });
        return;
      }

      stats.callbackSameDayRequired += 1;
      totals.callbackSameDayRequired += 1;
      const callbackRecord = {
        type: "callback_duty",
        id: `${group.key}|callback|${clean(item.row.call_id)}`,
        day: group.day,
        salesperson: owner,
        source: sourceNameFor(item.row),
        customerId: customerIdFor(item.row),
        stableLeadSource: group.stableLeadSource,
        stableLeadValue: group.stableLeadValue,
        primaryCallId: clean(item.row.call_id),
        callIds: groupItems.map((call) => clean(call.row.call_id)).filter(Boolean),
        metricKeys: ["lead.callbackSameDayRequired"],
        reason: "Explicit callback duty found.",
        evidence: evidenceSummary(item, "Explicit callback duty found"),
        evidenceExcerpt: evidenceExcerpt(item)
      };

      const laterCall = laterSameDayCall(groupItems, index);
      if (laterCall) {
        stats.callbackCompletedSameDay += 1;
        totals.callbackCompletedSameDay += 1;
        callbackRecord.metricKeys.push("lead.callbackCompletedSameDay");
        callbackRecord.matchedCallId = clean(laterCall.row.call_id);
        callbackRecord.reason = "Explicit callback duty had a later same-day call to the same matched target.";
        if (ownerFor(laterCall) !== owner) {
          stats.teamCoveredCallbacks += 1;
          totals.teamCoveredCallbacks += 1;
        }
        records.push(callbackRecord);
        return;
      }

      stats.callbackMissedSameDay += 1;
      totals.callbackMissedSameDay += 1;
      stats.wastedLeadDayKeys.add(group.key);
      wastedLeadDayKeys.add(group.key);
      callbackRecord.metricKeys.push("lead.callbackMissedSameDay");
      callbackRecord.reason = "Explicit callback duty found, but no later same-day call to the same matched target appears in the upload.";
      records.push(callbackRecord);
      if (!groupRecord.metricKeys.includes("lead.wastedLeadIndicators")) {
        groupRecord.metricKeys.push("lead.wastedLeadIndicators");
      }
      addExample(stats, {
        callId: clean(item.row.call_id),
        customerId: customerIdFor(item.row),
        salesperson: owner,
        stableLeadSource: group.stableLeadSource,
        reason: "Explicit callback duty found, but no later same-day call to the same matched target appears in the upload.",
        evidence: evidenceSummary(item, "Explicit callback duty found"),
        evidenceExcerpt: evidenceExcerpt(item, "Callback evidence")
      });
    });

    records.push(groupRecord);
  });

  totals.wastedLeadIndicators = wastedLeadDayKeys.size;
  totals.callbackCompletionRate = percent(totals.callbackCompletedSameDay, totals.callbackSameDayRequired);
  totals.noContactRetryRate = percent(totals.noContactRetriedSameDay, totals.noContactLeadDays);
  totals.riskRate = percent(totals.wastedLeadIndicators, totals.stableLeadDaysWorked);

  const salespeople = Array.from(statsBySalesperson.values())
    .map(serialiseStats)
    .sort((a, b) => b.wastedLeadIndicators - a.wastedLeadIndicators || b.callbackMissedSameDay - a.callbackMissedSameDay || b.singleAttemptNoContact - a.singleAttemptNoContact || a.salesperson.localeCompare(b.salesperson));

  return {
    schemaVersion: "lead_utilization.v1",
    stableLeadFields: STABLE_LEAD_FIELDS,
    definitions: {
      callbackLeakage: "Explicit customer callback request or salesperson callback promise, with no later same-day call to the same matched target.",
      noContactLeakage: "A matched record with only one attempt and no probable live-human contact.",
      futureCallback: "Callback wording points to a future day, so the item requires a later CSV upload before it can be judged."
    },
    totals,
    salespeople,
    records,
    evidenceSamples: salespeople.flatMap((person) => person.examples).slice(0, 40)
  };
}

function tableRow(values) {
  return `| ${values.join(" | ")} |`;
}

function buildLeadUtilizationReport(analysis, importRecord) {
  const model = analysis.leadReattempt;
  if (!model) return null;

  const title = `Lead Utilization No-Contact Risk - ${importRecord.sourceName}`;
  const salespersonRows = model.salespersonRows || [];
  const topRisk = [...salespersonRows]
    .sort((a, b) => b.oneDialNoContactNoLaterLeads - a.oneDialNoContactNoLaterLeads || b.oneDialNoContactNoLaterRate - a.oneDialNoContactNoLaterRate || a.salesperson.localeCompare(b.salesperson));
  const tableRows = salespersonRows.map((person) => tableRow([
    person.salesperson,
    formatNumber(person.leadsTouched),
    formatNumber(person.oneAndDoneLeads),
    formatNumber(person.riskyOneDialNoContactLeads),
    formatNumber(person.oneDialNoContactNoLaterLeads),
    formatModelPercent(person.oneDialNoContactNoLaterRate),
    formatModelPercent(person.personalRetryRate),
    formatNumber(person.validOneDialOutcomeLeads),
    formatNumber(person.oneDialNeedsReviewLeads)
  ]));

  const evidenceRows = (model.records || [])
    .filter((record) => (record.metricKeys || []).includes("reattempt.oneDialNoContactNoLater"))
    .slice(0, 40)
    .map((record) => {
      const firstCall = record.callProof?.[0] || {};
      return tableRow([
        record.salesperson,
        record.firstCallId || record.primaryCallId || "Unknown",
        record.stableLeadSource || "Stable ID",
        formatSourceDateTimeValue(firstCall.date, firstCall.time) || clean(record.firstCallAt),
        clean(firstCall.contactClassification || record.oneDialBucketLabel).replace(/\|/g, "/"),
        clean(record.oneDialReason || "One-dial no-contact with no later matching call observed").replace(/\|/g, "/")
      ]);
    });

  const topRows = topRisk.slice(0, 12)
    .map((person, index) => `${index + 1}. ${person.salesperson}: ${formatNumber(person.oneDialNoContactNoLaterLeads)} one-dial no-contact records with no later matching call observed (${formatModelPercent(person.oneDialNoContactNoLaterRate)} of dialed matched records).`);

  const totals = model.totals || {};
  const content = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Import ID: ${importRecord.id}`,
    "",
    "## Privacy And Proof Standard",
    "This report does not use `dialled_phone_number` because that field is intentionally incomplete for security. Matching uses stable source identifiers such as `customer_id`, `AllocatedLeadID`, `ContactId`, `FoundContactID`, or `FoundCustomerID`.",
    "",
    "This report intentionally avoids judging live conversations or ambiguous outcomes. The reportable signal is one dial, clear no-contact evidence or no usable speech evidence, and no later matching call observed for the same stable customer/contact/lead ID.",
    "",
    "## No-Contact Utilisation Answer",
    `- Matched records dialed: ${formatNumber(totals.leadsTouched)}`,
    `- Calls without a matching ID excluded: ${formatNumber(totals.callsWithoutStableLead)}`,
    `- Records dialed once: ${formatNumber(totals.oneAndDoneLeads)}`,
    `- One-dial no-contact records: ${formatNumber(totals.riskyOneDialNoContactLeads)}`,
    `- Potential lead under-utilisation: ${formatNumber(totals.oneDialNoContactNoLaterLeads)} one-dial no-contact records with no later matching call observed`,
    `- Valid one-dial outcomes excluded: ${formatNumber(totals.validOneDialOutcomeLeads)}`,
    `- Ambiguous one-dial records excluded: ${formatNumber(totals.oneDialNeedsReviewLeads)}`,
    "",
    "## Highest No-Contact Utilisation Risk",
    ...topRows,
    "",
    "## Full Salesperson Table",
    tableRow([
      "Salesperson",
      "Records dialed",
      "One-dial records",
      "One-dial no-contact",
      "No-contact, no later",
      "Issue rate",
      "Retry coverage",
      "Valid one-dial outcomes",
      "Ambiguous excluded"
    ])
  ];
  content.push(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...tableRows,
    "",
    "## Evidence Samples",
    tableRow(["Salesperson", "Call ID", "Lead key source", "Source call time", "No-contact evidence", "Proof summary"]),
    "| --- | --- | --- | --- | --- | --- |",
    ...(evidenceRows.length ? evidenceRows : [tableRow(["None", "", "", "", "No at-risk examples in this import.", ""])]),
    "",
    "## Recommended Dashboard Metrics",
    "- Potential lead under-utilisation by salesperson",
    "- One-dial no-contact records",
    "- No-contact/no-later records",
    "- Matched records dialed",
    "- Ambiguous one-dial records excluded from ranking",
    "- Manager-confirmed false positives",
    "",
    "## Limitations",
    "This is strong for no-contact process review. It does not claim confirmed sales, revenue, close rate, or true conversion outcome, and it does not judge live conversations or ambiguous records."
  );
  const contentText = content.join("\n");

  return {
    id: `report_${importRecord.id}_lead_utilization`,
    title,
    type: "lead_utilization_report",
    source: "system",
    format: "markdown",
    summary: `${formatNumber(totals.oneDialNoContactNoLaterLeads)} one-dial no-contact records with no later matching call observed.`,
    content: contentText,
    metadata: {
      importId: importRecord.id,
      sourceName: importRecord.sourceName,
      inputHash: analysis.inputHash,
      generatedBy: "automatic_lead_utilization_report",
      privacy: "dialled_phone_number ignored",
      stableLeadFields: STABLE_LEAD_FIELDS,
      totals
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  STABLE_LEAD_FIELDS,
  buildLeadUtilizationModel,
  buildLeadUtilizationReport,
  isExplicitCallbackDuty
};
