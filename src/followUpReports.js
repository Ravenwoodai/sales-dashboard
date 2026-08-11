"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { readTabularFileColumns } = require("./sourceFile");

const DEFAULT_REQUIRED_ATTEMPTS = 4;
const DEFAULT_GRACE_DAYS = 3;
const MIN_REQUIRED_ATTEMPTS = 2;
const MAX_REQUIRED_ATTEMPTS = 10;
const MAX_GRACE_DAYS = 30;
const ALLOCATION_EVIDENCE_COLUMNS = [
  "CustomerID",
  "FullName",
  "SalesManager",
  "DateSentToSalesperson_Date",
  "DateSentToSalesperson_Time",
  "AllocationName",
  "AllocationItemID"
];

const LITERAL_NO_CONTACT_STATES = new Set([
  "no_answer",
  "voicemail",
  "system_audio"
]);

const LITERAL_TERMINAL_STATES = new Set([
  "wrong_number",
  "opt_out",
  "not_interested"
]);

const MANAGER_TERMINAL_STATES = new Set([
  "closed",
  "dismissed",
  "follow_up_not_required",
  "no_follow_up_required",
  "not_required",
  "opt_out",
  "wrong_number",
  "not_interested"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase().replace(/[-\s]+/g, "_");
}

function normalizedPerson(value) {
  return clean(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 1000) / 10;
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return ["1", "true", "yes", "y", "dismissed", "complete", "completed"].includes(normalized(value));
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(dateValue, timeValue = "") {
  const date = clean(dateValue);
  let match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let year;
  let month;
  let day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return "";
    [, day, month, year] = match;
  }
  const timeMatch = clean(timeValue).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = timeMatch?.[1] || "00";
  const minute = timeMatch?.[2] || "00";
  const second = timeMatch?.[3] || "00";
  return `${year.padStart(4, "0")}${month.padStart(2, "0")}${day.padStart(2, "0")}${hour.padStart(2, "0")}${minute}${second}`;
}

function buildAllocationOwnershipEvidence(rows = [], options = {}) {
  const records = [];
  let invalidRows = 0;
  (rows || []).forEach((row) => {
    const customerId = clean(row.CustomerID);
    const salesperson = clean(row.FullName);
    const sentDate = clean(row.DateSentToSalesperson_Date);
    const sentTime = clean(row.DateSentToSalesperson_Time);
    const sentKey = localDateKey(sentDate, sentTime);
    if (!customerId || !salesperson || !sentKey) {
      invalidRows += 1;
      return;
    }
    records.push({
      customerId,
      salesperson,
      sentDate,
      sentTime,
      sentKey,
      manager: clean(row.SalesManager),
      allocationName: clean(row.AllocationName),
      allocationItemId: clean(row.AllocationItemID),
      proofRule: "Exact Customer ID + exact normalized full salesperson label; allocation sent at or before the first observed call."
    });
  });
  return {
    schemaVersion: "sales_dashboard_follow_up_allocation_evidence.v1",
    configured: options.configured !== false,
    available: records.length > 0,
    status: records.length ? "available" : options.configured === false ? "not_configured" : "no_valid_rows",
    sourceType: "dedicated_weekly_sent_event_allocation_export",
    records,
    totals: {
      inputRows: (rows || []).length,
      validRows: records.length,
      invalidRows
    }
  };
}

function loadFollowUpAllocationEvidence(allocationLogPath = "") {
  const configured = Boolean(clean(allocationLogPath));
  if (!configured) return buildAllocationOwnershipEvidence([], { configured: false });
  if (!fs.existsSync(allocationLogPath)) {
    return {
      ...buildAllocationOwnershipEvidence([], { configured: true }),
      status: "source_unavailable"
    };
  }
  try {
    const source = readTabularFileColumns(allocationLogPath, ALLOCATION_EVIDENCE_COLUMNS);
    const evidence = buildAllocationOwnershipEvidence(source.rows, { configured: true });
    const missingColumns = ALLOCATION_EVIDENCE_COLUMNS.filter((column) => !source.columns.includes(column));
    return {
      ...evidence,
      available: evidence.available && missingColumns.length === 0,
      status: missingColumns.length ? "required_columns_missing" : evidence.status,
      missingColumns
    };
  } catch {
    return {
      ...buildAllocationOwnershipEvidence([], { configured: true }),
      status: "source_read_error"
    };
  }
}

function daysBetween(startValue, endValue) {
  const start = validDate(startValue);
  const end = validDate(endValue);
  if (!start || !end || end < start) return null;
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function latestTimestamp(records = [], fallback = "") {
  const timestamps = records
    .flatMap((record) => record.callProof || [])
    .map((call) => validDate(call.dateTime))
    .filter(Boolean)
    .map((date) => date.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : fallback;
}

function reviewMapFor(analysis = {}) {
  return new Map((analysis.drilldownRows || []).map((row) => [clean(row.callId || row.call_id), row]));
}

function allocationIndexFor(evidence = {}) {
  const index = new Map();
  if (!evidence?.available) return index;
  (evidence.records || []).forEach((record) => {
    const key = `${clean(record.customerId)}\u0000${normalizedPerson(record.salesperson)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  });
  index.forEach((records) => records.sort((a, b) => a.sentKey.localeCompare(b.sentKey)));
  return index;
}

function allocationEvidenceFor(record, context) {
  const customerId = clean(record.customerId);
  const salesperson = clean(record.salesperson);
  const firstCall = record.callProof?.[0] || {};
  const firstCallKey = localDateKey(firstCall.date, firstCall.time);
  if (!customerId || !salesperson || !firstCallKey) return null;
  const matches = context.allocationIndex.get(`${customerId}\u0000${normalizedPerson(salesperson)}`) || [];
  const qualifying = matches.filter((allocation) => allocation.sentKey <= firstCallKey);
  return qualifying[qualifying.length - 1] || null;
}

function managerExclusionFor(record, reviewByCallId) {
  for (const callId of record.callIds || []) {
    const review = reviewByCallId.get(clean(callId));
    if (!review) continue;
    const correctedOutcome = normalized(review.managerCorrectedOutcome);
    const correctedFollowUp = normalized(review.managerCorrectedFollowUpStatus);
    if (
      truthy(review.managerFollowUpDismissed)
      || MANAGER_TERMINAL_STATES.has(correctedOutcome)
      || MANAGER_TERMINAL_STATES.has(correctedFollowUp)
    ) {
      return {
        callId,
        reviewId: clean(review.managerReviewId),
        status: clean(review.managerReviewStatus),
        reason: clean(review.managerReviewNotes)
          || `Manager overlay recorded ${correctedOutcome || correctedFollowUp || "follow-up dismissed"}.`
      };
    }
  }
  return null;
}

function literalTerminalFor(record) {
  for (const call of record.callProof || []) {
    const outcome = normalized(call.localOutcome);
    const contact = normalized(call.contactClassification);
    const state = LITERAL_TERMINAL_STATES.has(outcome)
      ? outcome
      : LITERAL_TERMINAL_STATES.has(contact) ? contact : "";
    if (state) {
      return {
        state,
        callId: clean(call.callId),
        evidence: clean(call.evidenceText || call.evidenceSummary)
      };
    }
  }
  return null;
}

function noContactState(call = {}) {
  const contact = normalized(call.contactClassification);
  const outcome = normalized(call.localOutcome);
  if (LITERAL_NO_CONTACT_STATES.has(contact)) return contact;
  if (LITERAL_NO_CONTACT_STATES.has(outcome)) return outcome;
  return "";
}

function statusLabel(status) {
  const labels = {
    evidence_backed_follow_up_candidate: "Evidence-backed follow-up candidate",
    waiting_observation_window: "Waiting for observation window",
    observed_attempt_cycle: "Required attempt cycle observed",
    later_call_by_other_observed: "Later call by another salesperson observed",
    literal_terminal_exclusion: "Literal terminal exclusion",
    manager_terminal_exclusion: "Manager-documented exclusion",
    ambiguous_excluded: "Ambiguous / excluded"
  };
  return labels[status] || status;
}

function classifyRecord(record, context) {
  const calls = record.callProof || [];
  const personalAttempts = Number(record.personalCallCount || calls.length || 0);
  const literalTerminal = literalTerminalFor(record);
  const managerExclusion = managerExclusionFor(record, context.reviewByCallId);
  const allocationEvidence = allocationEvidenceFor(record, context);
  const allLiteralNoContact = Boolean(calls.length) && calls.every((call) => Boolean(noContactState(call)));
  const anyLiteralNoContact = calls.some((call) => Boolean(noContactState(call)));
  const lastCall = calls[calls.length - 1] || {};
  const lastCallAt = clean(lastCall.dateTime || record.lastCallAt);
  const observedDaysAfterLastAttempt = daysBetween(lastCallAt, context.sourceWindowEnd);
  const waitingForWindow = observedDaysAfterLastAttempt === null
    || observedDaysAfterLastAttempt < context.graceDays;
  const laterAfterLast = Boolean(record.laterCallAfterPersonalLastByAnyone);
  const nextRequiredAttempt = personalAttempts < context.requiredAttempts
    ? personalAttempts + 1
    : null;

  let reportStatus = "ambiguous_excluded";
  let statusReason = "At least one call lacks a closed literal no-contact or terminal state, so no automated follow-up finding is made.";
  let exclusionBasis = "semantic_state_unavailable";

  if (managerExclusion) {
    reportStatus = "manager_terminal_exclusion";
    statusReason = "A manager-authored review overlay records that further follow-up is not required.";
    exclusionBasis = "manager_review_overlay";
  } else if (literalTerminal) {
    reportStatus = "literal_terminal_exclusion";
    statusReason = `Exact direct-customer ${literalTerminal.state.replace(/_/g, " ")} evidence excludes this record from follow-up candidates.`;
    exclusionBasis = `restricted_literal_${literalTerminal.state}`;
  } else if (!allLiteralNoContact) {
    reportStatus = "ambiguous_excluded";
    statusReason = anyLiteralNoContact
      ? "The call chain contains both literal no-contact and unknown call meaning; it is excluded from automated assessment."
      : "No closed literal no-contact state was established; the record is excluded from automated assessment.";
  } else if (personalAttempts >= context.requiredAttempts) {
    reportStatus = "observed_attempt_cycle";
    statusReason = `${personalAttempts} same-salesperson literal no-contact attempts are observed; the configured ${context.requiredAttempts}-attempt cycle is present.`;
    exclusionBasis = "";
  } else if (laterAfterLast) {
    reportStatus = "later_call_by_other_observed";
    statusReason = "A later exact-ID call by another salesperson is observed after this salesperson's last attempt; ownership or reassignment cannot be inferred.";
    exclusionBasis = "later_other_salesperson_activity";
  } else if (waitingForWindow) {
    reportStatus = "waiting_observation_window";
    statusReason = observedDaysAfterLastAttempt === null
      ? "The source window is insufficient to measure elapsed observation time after the last attempt."
      : `Only ${observedDaysAfterLastAttempt} full day${observedDaysAfterLastAttempt === 1 ? "" : "s"} of later source data are observed; the configured grace window is ${context.graceDays} days.`;
    exclusionBasis = "unmatured_observation_window";
  } else {
    reportStatus = "evidence_backed_follow_up_candidate";
    statusReason = `${personalAttempts} literal no-contact attempt${personalAttempts === 1 ? "" : "s"} observed, no later exact-ID call found after the last personal attempt within the selected data, and attempt ${nextRequiredAttempt} is required by the configured policy.`;
    exclusionBasis = "";
  }

  return {
    ...record,
    personalAttempts,
    attemptBand: personalAttempts >= 4 ? "4_plus" : String(personalAttempts || 0),
    allLiteralNoContact,
    anyLiteralNoContact,
    literalTerminal,
    managerExclusion,
    allocationEvidence,
    allocationOwnershipEstablished: Boolean(allocationEvidence),
    ownershipBasis: allocationEvidence
      ? "exact_weekly_allocation_before_first_call"
      : "observed_caller_only",
    observedDaysAfterLastAttempt,
    nextRequiredAttempt,
    reportStatus,
    reportStatusLabel: statusLabel(reportStatus),
    statusReason,
    exclusionBasis,
    evidenceAuthority: reportStatus === "manager_terminal_exclusion"
      ? "manager_authored_overlay"
      : "source_fields_exact_ids_and_restricted_literal_rules"
  };
}

function seedSalesperson(salesperson) {
  return {
    salesperson,
    matchedRecords: 0,
    personallyRetriedRecords: 0,
    oneAttemptRecords: 0,
    twoAttemptRecords: 0,
    threeAttemptRecords: 0,
    fourPlusAttemptRecords: 0,
    clearNoContactChains: 0,
    clearNoContactRetriedRecords: 0,
    allocationBackedRecords: 0,
    allocationBackedClearNoContactChains: 0,
    allocationBackedCandidates: 0,
    evidenceBackedCandidates: 0,
    waitingObservationWindow: 0,
    observedAttemptCycle: 0,
    laterCallByOtherObserved: 0,
    literalTerminalExclusions: 0,
    managerTerminalExclusions: 0,
    ambiguousExcluded: 0
  };
}

function addRecordToSummary(summary, record) {
  summary.matchedRecords += 1;
  if (record.personalAttempts >= 2) summary.personallyRetriedRecords += 1;
  if (record.personalAttempts === 1) summary.oneAttemptRecords += 1;
  if (record.personalAttempts === 2) summary.twoAttemptRecords += 1;
  if (record.personalAttempts === 3) summary.threeAttemptRecords += 1;
  if (record.personalAttempts >= 4) summary.fourPlusAttemptRecords += 1;
  if (record.allLiteralNoContact) summary.clearNoContactChains += 1;
  if (record.allLiteralNoContact && record.personalAttempts >= 2) summary.clearNoContactRetriedRecords += 1;
  if (record.allocationOwnershipEstablished) summary.allocationBackedRecords += 1;
  if (record.allocationOwnershipEstablished && record.allLiteralNoContact) {
    summary.allocationBackedClearNoContactChains += 1;
  }
  if (record.allocationOwnershipEstablished && record.reportStatus === "evidence_backed_follow_up_candidate") {
    summary.allocationBackedCandidates += 1;
  }
  if (record.reportStatus === "evidence_backed_follow_up_candidate") summary.evidenceBackedCandidates += 1;
  if (record.reportStatus === "waiting_observation_window") summary.waitingObservationWindow += 1;
  if (record.reportStatus === "observed_attempt_cycle") summary.observedAttemptCycle += 1;
  if (record.reportStatus === "later_call_by_other_observed") summary.laterCallByOtherObserved += 1;
  if (record.reportStatus === "literal_terminal_exclusion") summary.literalTerminalExclusions += 1;
  if (record.reportStatus === "manager_terminal_exclusion") summary.managerTerminalExclusions += 1;
  if (record.reportStatus === "ambiguous_excluded") summary.ambiguousExcluded += 1;
}

function finalizeSummary(summary) {
  return {
    ...summary,
    personalRetryRate: percent(summary.personallyRetriedRecords, summary.matchedRecords),
    clearNoContactRetryRate: percent(summary.clearNoContactRetriedRecords, summary.clearNoContactChains),
    assessableRecordCount:
      summary.clearNoContactChains
      + summary.literalTerminalExclusions
      + summary.managerTerminalExclusions,
    candidateShareOfClearNoContact: percent(summary.evidenceBackedCandidates, summary.clearNoContactChains)
  };
}

function buildFollowUpReports(analysis = {}, options = {}) {
  const records = analysis.leadReattempt?.records || [];
  const requiredAttempts = boundedInteger(
    options.requiredAttempts,
    DEFAULT_REQUIRED_ATTEMPTS,
    MIN_REQUIRED_ATTEMPTS,
    MAX_REQUIRED_ATTEMPTS
  );
  const graceDays = boundedInteger(options.graceDays, DEFAULT_GRACE_DAYS, 0, MAX_GRACE_DAYS);
  const sourceWindowEnd = clean(analysis.dateRange?.end)
    || latestTimestamp(records);
  const context = {
    requiredAttempts,
    graceDays,
    sourceWindowEnd,
    reviewByCallId: reviewMapFor(analysis),
    allocationIndex: allocationIndexFor(options.allocationEvidence)
  };
  const classifiedRecords = records.map((record) => classifyRecord(record, context));
  const team = seedSalesperson("All salespeople");
  const bySalesperson = new Map();
  classifiedRecords.forEach((record) => {
    addRecordToSummary(team, record);
    if (!bySalesperson.has(record.salesperson)) {
      bySalesperson.set(record.salesperson, seedSalesperson(record.salesperson));
    }
    addRecordToSummary(bySalesperson.get(record.salesperson), record);
  });
  const salespersonRows = Array.from(bySalesperson.values())
    .map(finalizeSummary)
    .sort((a, b) => a.salesperson.localeCompare(b.salesperson));

  return {
    schemaVersion: "sales_dashboard_follow_up_reports.v1",
    generatedAt: options.generatedAt || new Date().toISOString(),
    sourceName: clean(analysis.sourceName) || "Active call import",
    sourceWindow: {
      start: clean(analysis.dateRange?.start),
      end: sourceWindowEnd,
      display: clean(analysis.dateRange?.display),
      timezone: clean(analysis.dateRange?.sourceTimezoneLabel) || "Source call time"
    },
    policy: {
      requiredAttempts,
      reattemptRequiredAfterAttempts: Array.from(
        { length: Math.max(0, requiredAttempts - 1) },
        (_, index) => index + 1
      ),
      graceDays,
      candidateRule: "Every observed same-salesperson call in the chain is an exact literal no-contact state; the configured observation window has elapsed; fewer than the required attempts exist; and no later exact-ID call by anyone is observed after the salesperson's last attempt within the selected data.",
      literalNoContactStates: Array.from(LITERAL_NO_CONTACT_STATES),
      literalTerminalExclusions: Array.from(LITERAL_TERMINAL_STATES),
      managerExclusionRule: "A manager-authored correction may exclude a record when it explicitly records follow-up dismissed/not required or a terminal outcome."
    },
    authority: {
      level: "observed_activity_evidence",
      allocationOwnershipEstablished: classifiedRecords.some((record) => record.allocationOwnershipEstablished),
      allocationEvidenceStatus: options.allocationEvidence?.status || "not_configured",
      allocationEvidenceSource: options.allocationEvidence?.sourceType || "",
      statement: "The call export proves observed caller activity. Allocation ownership is established only per record by an exact Customer ID + exact full salesperson label + allocation-before-call match. Candidate rows are evidence-backed review items, not automatic non-compliance or disciplinary findings.",
      unknownRule: "Blank, mixed, or semantically ambiguous transcripts are excluded from candidate findings.",
      matchingRule: "Exact permitted stable IDs only; phone values and fuzzy names are never used."
    },
    dataQuality: {
      callsWithoutStableLead: Number(analysis.leadReattempt?.totals?.callsWithoutStableLead || 0),
      sourceWindowEndAvailable: Boolean(sourceWindowEnd),
      dayCount: Number(analysis.dataWindow?.dayCount || 0),
      partialDay: Boolean(analysis.dataWindow?.partialDay),
      singleDay: Boolean(analysis.dataWindow?.singleDay)
    },
    totals: finalizeSummary(team),
    salespersonRows,
    records: classifiedRecords
  };
}

function buildIndividualFollowUpReport(analysis = {}, salesperson, options = {}) {
  const overview = buildFollowUpReports(analysis, options);
  const requested = clean(salesperson);
  if (!requested) {
    return {
      ...overview,
      available: false,
      code: "SALESPERSON_REQUIRED",
      error: "A salesperson must be selected to generate an individual report.",
      salesperson: "",
      summary: finalizeSummary(seedSalesperson("")),
      records: []
    };
  }
  const salespersonRow = overview.salespersonRows.find((row) => row.salesperson === requested);
  if (!salespersonRow) {
    return {
      ...overview,
      available: false,
      code: "SALESPERSON_NOT_FOUND",
      error: "The selected salesperson has no matched records in the active report scope.",
      salesperson: requested,
      summary: finalizeSummary(seedSalesperson(requested)),
      records: []
    };
  }
  const statusOrder = {
    evidence_backed_follow_up_candidate: 0,
    waiting_observation_window: 1,
    later_call_by_other_observed: 2,
    observed_attempt_cycle: 3,
    literal_terminal_exclusion: 4,
    manager_terminal_exclusion: 5,
    ambiguous_excluded: 6
  };
  const records = overview.records
    .filter((record) => record.salesperson === requested)
    .sort((a, b) => (
      (statusOrder[a.reportStatus] ?? 99) - (statusOrder[b.reportStatus] ?? 99)
      || clean(b.lastCallAt).localeCompare(clean(a.lastCallAt))
      || clean(a.stableLeadKey).localeCompare(clean(b.stableLeadKey))
    ));
  return {
    ...overview,
    schemaVersion: "sales_dashboard_individual_follow_up_report.v1",
    available: true,
    code: "AVAILABLE",
    salesperson: requested,
    summary: salespersonRow,
    records
  };
}

function safeCell(value) {
  return clean(value).replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function reportId(prefix, source, salesperson = "") {
  const digest = crypto.createHash("sha256")
    .update(`${prefix}|${clean(source.inputHash)}|${clean(source.sourceWindow?.start)}|${clean(source.sourceWindow?.end)}|${normalized(salesperson)}`)
    .digest("hex")
    .slice(0, 16);
  return `${prefix}_${digest}`;
}

function reportScopeQuery(analysis = {}) {
  return { ...(analysis.filterState?.query || {}) };
}

function chartRows(summary = {}) {
  return {
    status: [
      { label: "Needs another call", value: Number(summary.evidenceBackedCandidates || 0), tone: "warning", explanation: "Only clear voicemail, phone-system or no-answer evidence was found, the waiting period has passed, and the attempt plan is not complete." },
      { label: "Still waiting", value: Number(summary.waitingObservationWindow || 0), tone: "notice", explanation: "There are not yet enough later days in the selected data to decide whether another call is due." },
      { label: "Attempt plan completed", value: Number(summary.observedAttemptCycle || 0), tone: "success", explanation: "The configured number of calls is visible in the selected data." },
      { label: "Later call by someone else", value: Number(summary.laterCallByOtherObserved || 0), tone: "neutral", explanation: "Another salesperson later called the same exact record. Ownership or reassignment is not guessed." },
      { label: "Closed by clear evidence", value: Number(summary.literalTerminalExclusions || 0) + Number(summary.managerTerminalExclusions || 0), tone: "neutral", explanation: "A direct customer response or manager review says another call is not required." },
      { label: "Not assessed automatically", value: Number(summary.ambiguousExcluded || 0), tone: "neutral", explanation: "The call meaning was blank, mixed or unclear, so the report makes no recommendation." }
    ],
    attempts: [
      { label: "1 call seen", value: Number(summary.oneAttemptRecords || 0), tone: "warning" },
      { label: "2 calls seen", value: Number(summary.twoAttemptRecords || 0), tone: "notice" },
      { label: "3 calls seen", value: Number(summary.threeAttemptRecords || 0), tone: "notice" },
      { label: "4+ calls seen", value: Number(summary.fourPlusAttemptRecords || 0), tone: "success" }
    ]
  };
}

function overviewReportRecord(overview, analysis = {}) {
  const policy = overview.policy || {};
  const scopeQuery = reportScopeQuery(analysis);
  const header = [
    "| Salesperson | Records called | Called more than once | Clear voicemail / no-answer | Needs another call | Still waiting | Attempt plan completed | Not assessed automatically | Individual report |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  ];
  const rows = (overview.salespersonRows || []).map((row) => {
    const query = new URLSearchParams({
      ...scopeQuery,
      reportSalesperson: row.salesperson,
      requiredAttempts: String(policy.requiredAttempts),
      graceDays: String(policy.graceDays)
    });
    return `| ${safeCell(row.salesperson)} | ${row.matchedRecords} | ${row.personallyRetriedRecords} | ${row.clearNoContactChains} | ${row.evidenceBackedCandidates} | ${row.waitingObservationWindow} | ${row.observedAttemptCycle} | ${row.ambiguousExcluded} | [Open](/reports/follow-up-individual?${query.toString()}) |`;
  });
  const distributionHeader = [
    "| Salesperson | 1 attempt | 2 attempts | 3 attempts | 4+ attempts |",
    "| --- | ---: | ---: | ---: | ---: |"
  ];
  const distributionRows = (overview.salespersonRows || []).map((row) => (
    `| ${safeCell(row.salesperson)} | ${row.oneAttemptRecords} | ${row.twoAttemptRecords} | ${row.threeAttemptRecords} | ${row.fourPlusAttemptRecords} |`
  ));
  return {
    id: reportId("follow_up_overview", { ...overview, inputHash: analysis.inputHash }),
    title: "Salesperson Reattempt Evidence Overview",
    type: "follow_up_overview",
    source: overview.sourceName,
    createdAt: overview.generatedAt,
    updatedAt: overview.generatedAt,
    summary: `${overview.totals.evidenceBackedCandidates} records need review for another call under the selected attempt policy. This is activity evidence, not a staff performance judgement.`,
    controls: {
      action: "/reports/follow-up-overview",
      dateFrom: analysis.filterState?.dateFrom || "",
      dateTo: analysis.filterState?.dateTo || "",
      requiredAttempts: policy.requiredAttempts,
      graceDays: policy.graceDays
    },
    charts: chartRows(overview.totals),
    content: [
      "## What this report tells you",
      `This report looks for records where every observed call ended in a clearly recognised voicemail, phone system or no-answer result. A record is shown as needing another call only when fewer than ${policy.requiredAttempts} calls are visible, at least ${policy.graceDays} full later days are present, and no later call to the same exact record is found within the selected data.`,
      `The selected source period is ${overview.sourceWindow.display || `${overview.sourceWindow.start || "unknown"} to ${overview.sourceWindow.end || "unknown"}`}. Change the dates above to rebuild both the totals and individual reports.`,
      "These are review items, not automatic non-compliance or disciplinary findings. The report cannot prove who owned a record unless exact allocation evidence is shown, and it never matches by phone number or a similar-looking name.",
      "## Team overview",
      ...header,
      ...rows,
      "## Calls seen for each salesperson",
      ...distributionHeader,
      ...distributionRows,
      "## Why some records are not counted as needing another call",
      `- ${overview.totals.waitingObservationWindow} records are still inside the ${policy.graceDays}-day waiting period.`,
      `- ${overview.totals.literalTerminalExclusions + overview.totals.managerTerminalExclusions} records have clear terminal or manager-reviewed evidence.`,
      `- ${overview.totals.ambiguousExcluded} records were not assessed automatically because the evidence was blank, mixed or unclear.`,
      `- ${overview.dataQuality.callsWithoutStableLead} calls do not contain a permitted stable record ID and cannot be linked safely.`
    ].join("\n")
  };
}

function callLinks(record) {
  return (record.callProof || [])
    .map((call, index) => `[${index + 1}: ${safeCell(call.date || call.dateTime || call.callId)}](/calls/${encodeURIComponent(call.callId)})`)
    .join(" ");
}

function evidenceSummary(record) {
  const excerpts = (record.callProof || [])
    .map((call) => clean(call.evidenceText || call.evidenceSummary))
    .filter(Boolean);
  return excerpts.length ? safeCell(excerpts.join(" / ")) : "No closed literal excerpt";
}

function individualReportRecord(individual, analysis = {}) {
  if (!individual.available) return null;
  const summary = individual.summary;
  const tableHeader = [
    "| Status | Ownership | Match key | Attempts | Next attempt | Last call | Observation | Calls | Evidence / justification |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- | --- |"
  ];
  const rows = (individual.records || []).map((record) => {
    const observation = record.observedDaysAfterLastAttempt === null
      ? "Unknown"
      : `${record.observedDaysAfterLastAttempt} days`;
    const ownership = record.allocationOwnershipEstablished
      ? `Exact allocation ${safeCell(record.allocationEvidence.sentDate)}`
      : "Observed caller only";
    return `| ${safeCell(record.reportStatusLabel)} | ${ownership} | ${safeCell(`${record.stableLeadSource}:${record.stableLeadValue}`)} | ${record.personalAttempts} | ${record.nextRequiredAttempt || "n/a"} | ${safeCell(record.lastCallAt || "Unknown")} | ${observation} | ${callLinks(record)} | ${safeCell(record.statusReason)} ${evidenceSummary(record)} |`;
  });
  const candidateRows = individual.records.filter((record) => record.reportStatus === "evidence_backed_follow_up_candidate");
  return {
    id: reportId("follow_up_individual", { ...individual, inputHash: analysis.inputHash }, individual.salesperson),
    title: `Individual Reattempt Evidence - ${individual.salesperson}`,
    type: "follow_up_individual",
    source: individual.sourceName,
    createdAt: individual.generatedAt,
    updatedAt: individual.generatedAt,
    summary: `${summary.evidenceBackedCandidates} records need review for another call under the selected policy. This is activity evidence, not an automatic performance finding.`,
    controls: {
      action: "/reports/follow-up-individual",
      salesperson: individual.salesperson,
      dateFrom: analysis.filterState?.dateFrom || "",
      dateTo: analysis.filterState?.dateTo || "",
      requiredAttempts: individual.policy.requiredAttempts,
      graceDays: individual.policy.graceDays
    },
    charts: chartRows(summary),
    content: [
      "## What this report tells you",
      `This report shows the exact call activity recorded for ${safeCell(individual.salesperson)} during ${individual.sourceWindow.display || `${individual.sourceWindow.start || "unknown"} to ${individual.sourceWindow.end || "unknown"}`}.`,
      `A record needs review for another call only when all visible calls ended in a recognised voicemail, phone system or no-answer result, fewer than ${individual.policy.requiredAttempts} calls are visible, the ${individual.policy.graceDays}-day waiting period has passed, and no later exact-ID call is present within the selected data.`,
      "This is not an automatic judgement about the salesperson. Open the call links and review the source evidence before deciding what to do.",
      "## Plain-English summary",
      `- ${summary.matchedRecords} records have at least one call by this salesperson in the selected period.`,
      `- ${summary.personallyRetriedRecords} were called more than once by this salesperson.`,
      `- ${summary.evidenceBackedCandidates} need review for another call under the selected policy.`,
      `- ${summary.waitingObservationWindow} are still waiting for enough later data.`,
      `- ${summary.observedAttemptCycle} already show the full attempt plan.`,
      `- ${summary.ambiguousExcluded} were not assessed automatically because their meaning is unclear.`,
      "## Records needing review for another call",
      ...(candidateRows.length
        ? [
          ...tableHeader,
          ...candidateRows.map((record) => {
            const observation = record.observedDaysAfterLastAttempt === null ? "Unknown" : `${record.observedDaysAfterLastAttempt} days`;
            const ownership = record.allocationOwnershipEstablished
              ? `Exact allocation ${safeCell(record.allocationEvidence.sentDate)}`
              : "Observed caller only";
            return `| ${safeCell(record.reportStatusLabel)} | ${ownership} | ${safeCell(`${record.stableLeadSource}:${record.stableLeadValue}`)} | ${record.personalAttempts} | ${record.nextRequiredAttempt || "n/a"} | ${safeCell(record.lastCallAt || "Unknown")} | ${observation} | ${callLinks(record)} | ${safeCell(record.statusReason)} ${evidenceSummary(record)} |`;
          })
        ]
        : ["No records need another call under the selected evidence rule."]),
      "## Full record-by-record evidence",
      ...tableHeader,
      ...rows,
      "## Important limits",
      "The report links records only through permitted exact IDs. It does not use phone numbers or fuzzy name matching.",
      `Calls without a permitted stable ID in this scope: ${individual.dataQuality.callsWithoutStableLead}. Allocation ownership is ${individual.authority.allocationEvidenceStatus === "available" ? "shown only where an exact allocation-before-call match exists" : "not established by the configured evidence"}.`
    ].join("\n")
  };
}

module.exports = {
  DEFAULT_GRACE_DAYS,
  DEFAULT_REQUIRED_ATTEMPTS,
  LITERAL_NO_CONTACT_STATES,
  LITERAL_TERMINAL_STATES,
  buildAllocationOwnershipEvidence,
  buildFollowUpReports,
  buildIndividualFollowUpReport,
  individualReportRecord,
  loadFollowUpAllocationEvidence,
  overviewReportRecord
};
