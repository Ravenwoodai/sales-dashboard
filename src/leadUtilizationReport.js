"use strict";

const { ENTITY_FIELDS } = require("./analysisConstants");
const { clean, isMissing } = require("./transcriptEvaluator");

const STABLE_LEAD_FIELDS = ["AllocatedLeadID", "ContactId", "customer_id", "FoundContactID", "FoundCustomerID"]
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
      source: isMissing(firstItem.row.CustomerImportSource) ? "Unknown source" : clean(firstItem.row.CustomerImportSource),
      stableLeadSource: group.stableLeadSource,
      stableLeadValue: group.stableLeadValue,
      primaryCallId: clean(firstItem.row.call_id),
      callIds: groupItems.map((call) => clean(call.row.call_id)).filter(Boolean),
      metricKeys: ["lead.stableLeadDaysWorked"],
      reason: "Stable lead-day worked.",
      evidence: evidenceSummary(firstItem, "Stable lead-day worked"),
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
        groupRecord.reason = "No probable live-human contact, but the lead was retried same day.";
      } else {
        totals.singleAttemptNoContact += 1;
        firstOwnerStats.singleAttemptNoContact += 1;
        firstOwnerStats.wastedLeadDayKeys.add(group.key);
        wastedLeadDayKeys.add(group.key);
        groupRecord.metricKeys.push("lead.singleAttemptNoContact", "lead.wastedLeadIndicators");
        groupRecord.reason = "Only one same-day attempt; no probable live-human contact.";
        addExample(firstOwnerStats, {
          callId: clean(firstItem.row.call_id),
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
          source: isMissing(item.row.CustomerImportSource) ? "Unknown source" : clean(item.row.CustomerImportSource),
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
        source: isMissing(item.row.CustomerImportSource) ? "Unknown source" : clean(item.row.CustomerImportSource),
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
        callbackRecord.reason = "Explicit callback duty had a later same-day call to the same stable lead target.";
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
      callbackRecord.reason = "Explicit callback duty found, but no later same-day call to the same stable lead target appears in the upload.";
      records.push(callbackRecord);
      if (!groupRecord.metricKeys.includes("lead.wastedLeadIndicators")) {
        groupRecord.metricKeys.push("lead.wastedLeadIndicators");
      }
      addExample(stats, {
        callId: clean(item.row.call_id),
        salesperson: owner,
        stableLeadSource: group.stableLeadSource,
        reason: "Explicit callback duty found, but no later same-day call to the same stable lead target appears in the upload.",
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
      callbackLeakage: "Explicit customer callback request or salesperson callback promise, with no later same-day call to the same stable lead target.",
      noContactLeakage: "A stable lead-day with only one attempt and no probable live-human contact.",
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
  const model = analysis.leadUtilization;
  if (!model) return null;

  const title = `Lead Utilization And Follow-Up Leakage - ${importRecord.sourceName}`;
  const topRisk = model.salespeople.slice(0, 8);
  const tableRows = model.salespeople.map((person) => tableRow([
    person.salesperson,
    formatNumber(person.stableLeadDaysWorked),
    formatNumber(person.callbackSameDayRequired),
    formatNumber(person.callbackCompletedSameDay),
    formatNumber(person.callbackMissedSameDay),
    formatPercent(person.callbackCompletionRate),
    formatNumber(person.noContactLeadDays),
    formatNumber(person.noContactRetriedSameDay),
    formatNumber(person.singleAttemptNoContact),
    formatNumber(person.wastedLeadIndicators),
    formatPercent(person.riskRate),
    person.utilizationScore === null ? "n/a" : formatNumber(person.utilizationScore)
  ]));

  const evidenceRows = model.evidenceSamples.map((example) => tableRow([
    example.salesperson,
    example.callId || "Unknown",
    example.stableLeadSource,
    example.reason,
    clean(example.evidence).replace(/\|/g, "/")
  ]));

  const content = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Import ID: ${importRecord.id}`,
    "",
    "## Privacy And Proof Standard",
    "This report does not use `dialled_phone_number` because that field is intentionally incomplete for security. Lead matching uses the first available stable source identifier from `AllocatedLeadID`, `ContactId`, `customer_id`, `FoundContactID`, or `FoundCustomerID`.",
    "",
    "The callback section uses a strict proof rule. It counts explicit customer callback requests or salesperson callback promises, and does not count ordinary script wording such as `later this year`.",
    "",
    "## Executive Answer",
    `- Stable lead-days reviewed: ${formatNumber(model.totals.stableLeadDaysWorked)}`,
    `- Calls without a stable lead ID excluded: ${formatNumber(model.totals.callsWithoutStableLead)}`,
    `- Explicit same-day or unspecified callback duties: ${formatNumber(model.totals.callbackSameDayRequired)}`,
    `- Callback duties followed up later the same day: ${formatNumber(model.totals.callbackCompletedSameDay)}`,
    `- Callback duties not followed up later the same day: ${formatNumber(model.totals.callbackMissedSameDay)}`,
    `- Callback duties with future wording requiring later upload: ${formatNumber(model.totals.callbackFutureNeedsUpload)}`,
    `- No-contact lead-days: ${formatNumber(model.totals.noContactLeadDays)}`,
    `- No-contact lead-days retried same day: ${formatNumber(model.totals.noContactRetriedSameDay)}`,
    `- Single-attempt/no-contact lead-days with no retry: ${formatNumber(model.totals.singleAttemptNoContact)}`,
    `- Potential wasted lead-day indicators: ${formatNumber(model.totals.wastedLeadIndicators)}`,
    `- Same-day callback completion rate: ${formatPercent(model.totals.callbackCompletionRate)}`,
    `- No-contact same-day retry coverage: ${formatPercent(model.totals.noContactRetryRate)}`,
    "",
    "## Highest Risk Salespeople",
    ...topRisk.map((person, index) => `${index + 1}. ${person.salesperson}: ${formatNumber(person.wastedLeadIndicators)} at-risk lead-day indicators (${formatNumber(person.callbackMissedSameDay)} missed callback, ${formatNumber(person.singleAttemptNoContact)} single-attempt/no-contact).`),
    "",
    "## Full Salesperson Table",
    tableRow([
      "Salesperson",
      "Lead-days worked",
      "Same-day callback req.",
      "Callback completed",
      "Callback missed",
      "Callback completion",
      "No-contact lead-days",
      "No-contact retried",
      "Single-attempt no-contact",
      "Potential wasted indicators",
      "Risk rate",
      "Utilization score"
    ]),
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...tableRows,
    "",
    "## Evidence Samples",
    tableRow(["Salesperson", "Call ID", "Lead key source", "Reason", "Proof summary"]),
    "| --- | --- | --- | --- | --- |",
    ...(evidenceRows.length ? evidenceRows : [tableRow(["None", "", "", "No at-risk examples in this import.", ""])]),
    "",
    "## How To Monitor This Going Forward",
    "1. Capture every scheduled CSV import into the dashboard store.",
    "2. Track stable lead-days, not redacted phone numbers.",
    "3. Use two daily leakage rules: explicit callback duties with no same-day follow-up, and single-attempt/no-contact lead-days.",
    "4. Split statuses into completed, missed, pending future upload, and insufficient stable ID.",
    "5. Score each salesperson on both callback completion and no-contact retry coverage, always showing sample size.",
    "6. Add manager review so false positives can be corrected, especially where follow-up happened outside the CSV by email, SMS, or another system.",
    "",
    "## Recommended Dashboard Metrics",
    "- Wasted lead-day indicators by salesperson",
    "- Same-day callback completion rate",
    "- No-contact retry coverage",
    "- Single-attempt/no-contact lead count",
    "- Future callback pending count",
    "- Team-covered callback count",
    "- Manager-confirmed false positives",
    "",
    "## Limitations",
    "This is strong for same-day monitoring. It cannot prove callbacks due on future days until later CSV files are imported, and it cannot prove email/SMS follow-up unless those actions are added as future source fields."
  ].join("\n");

  return {
    id: `report_${importRecord.id}_lead_utilization`,
    title,
    type: "lead_utilization_report",
    source: "system",
    format: "markdown",
    summary: `${formatNumber(model.totals.wastedLeadIndicators)} potential wasted lead-day indicators: ${formatNumber(model.totals.callbackMissedSameDay)} missed explicit callback follow-ups and ${formatNumber(model.totals.singleAttemptNoContact)} single-attempt/no-contact lead-days.`,
    content,
    metadata: {
      importId: importRecord.id,
      sourceName: importRecord.sourceName,
      inputHash: analysis.inputHash,
      generatedBy: "automatic_lead_utilization_report",
      privacy: "dialled_phone_number ignored",
      stableLeadFields: STABLE_LEAD_FIELDS,
      totals: model.totals
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
