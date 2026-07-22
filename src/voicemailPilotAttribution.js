"use strict";

const APPROVED_MESSAGE_TEMPLATE_VERSIONS = Object.freeze(["approved_v1"]);
const ALLOWED_CURRENCIES = Object.freeze(["AUD", "NZD"]);
const PILOT_ARMS = Object.freeze(["treatment", "control"]);
const MESSAGE_STATUSES = Object.freeze(["approved_left", "other_left", "not_left", "unknown"]);
const CALLBACK_ATTRIBUTION_SOURCES = Object.freeze(["telephony_event_link", "crm_event_link", "manager_verified"]);
const SALE_STATUSES = Object.freeze(["won", "lost", "pending", "reversed"]);
const REQUIRED_COLUMNS = Object.freeze([
  "pilot_record_id",
  "pilot_arm",
  "pilot_assigned_at",
  "pilot_currency",
  "voicemail_event_id",
  "outbound_call_id",
  "message_status",
  "message_template_version",
  "message_completed_at",
  "callback_call_id",
  "callback_attribution_source",
  "handler_user_id",
  "crm_lead_id",
  "crm_sale_id",
  "sale_status",
  "sale_recorded_at",
  "gross_profit_minor_units",
  "currency",
  "outcome_observation_completed_at",
  "commercial_observation_completed_at"
]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function isoTimestamp(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? { text, milliseconds } : null;
}

function callTime(call = {}) {
  const milliseconds = Date.parse(clean(call.dateTime));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function sourceUserId(call = {}) {
  return clean(call.userId || call.rawFields?.UserID);
}

function stableIdValues(call = {}) {
  return new Set((Array.isArray(call.stableIds) ? call.stableIds : [])
    .map((item) => clean(item?.value))
    .filter(Boolean));
}

function sharedStableIds(left = {}, right = {}) {
  const leftIds = new Map((Array.isArray(left.stableIds) ? left.stableIds : [])
    .map((item) => [clean(item?.field), clean(item?.value)])
    .filter(([field, value]) => field && value));
  return (Array.isArray(right.stableIds) ? right.stableIds : [])
    .map((item) => ({ field: clean(item?.field), value: clean(item?.value) }))
    .filter((item) => item.field && item.value && leftIds.get(item.field) === item.value);
}

function duplicateIndexes(rows, field) {
  const indexesByValue = new Map();
  rows.forEach((row, index) => {
    const value = clean(row?.[field]);
    if (!value) return;
    if (!indexesByValue.has(value)) indexesByValue.set(value, []);
    indexesByValue.get(value).push(index);
  });
  const duplicates = new Set();
  indexesByValue.forEach((indexes) => {
    if (indexes.length > 1) indexes.forEach((index) => duplicates.add(index));
  });
  return duplicates;
}

function reason(code, detail = "") {
  return detail ? `${code}:${detail}` : code;
}

function emptyArm(arm) {
  return {
    arm,
    assigned: 0,
    approvedMessages: 0,
    otherMessages: 0,
    messagesNotLeft: 0,
    messageUnknown: 0,
    messageNotScored: 0,
    callbacksObserved: 0,
    callbacksNotObservedInCompletedWindow: 0,
    callbacksUnknownIncompleteWindow: 0,
    callbacksNotScored: 0,
    callbackOutcomesResolved: 0,
    recordedCallbacksPerAssigned: null,
    resolvedCallbackRate: null,
    callbackRateStatus: "not_available",
    callbackEndpointWindowIncomplete: 0,
    originalSalespersonHandling: 0,
    differentSalespersonHandling: 0,
    handlerUnknown: 0,
    salesWon: 0,
    salesLost: 0,
    salesPending: 0,
    salesReversed: 0,
    saleNotScored: 0,
    financialScopeNotScored: 0,
    commercialObservationIncomplete: 0,
    commercialScopeNotScored: 0,
    grossProfitByCurrency: []
  };
}

function emptyReport(options = {}) {
  const configured = options.configured === true;
  return {
    schemaVersion: "sales_dashboard_voicemail_pilot_attribution.v1",
    status: configured ? (options.status || "load_error") : "not_configured",
    configured,
    source: {
      sourceName: clean(options.sourceName),
      sourceType: clean(options.sourceType),
      sheetName: clean(options.sheetName)
    },
    fileErrors: Array.isArray(options.fileErrors) ? options.fileErrors : [],
    contract: {
      requiredColumns: [...REQUIRED_COLUMNS],
      approvedMessageTemplateVersions: [...APPROVED_MESSAGE_TEMPLATE_VERSIONS],
      allowedCurrencies: [...ALLOWED_CURRENCIES],
      phoneMatchingPermitted: false,
      modelUsePermitted: false,
      orderCountPermittedAsSaleEvidence: false
    },
    totals: {
      inputRows: 0,
      acceptedAssignments: 0,
      rejectedAssignments: 0,
      measureNotScored: 0,
      callbacksObserved: 0,
      salesObserved: 0
    },
    arms: PILOT_ARMS.map(emptyArm),
    attributionSources: CALLBACK_ATTRIBUTION_SOURCES.map((source) => ({ source, callbacks: 0 })),
    grossProfitByCurrency: [],
    intentionToTreat: {
      status: "not_available",
      reason: configured ? "no_valid_assignments" : "pilot_source_not_configured",
      treatmentCallbackRate: null,
      controlCallbackRate: null,
      absoluteDifference: null,
      interpretation: "No causal claim is available. Source-system preassignment, complete outcome windows and experimental design must all be established."
    },
    acceptedRecords: [],
    rejectedRecords: [],
    provenance: {
      authority: "source facts and deterministic rules only",
      noInference: true,
      rules: [
        "Every assignment is linked by exact call ID; phone matching is prohibited.",
        "A no-callback outcome requires an explicit completed observation timestamp.",
        "OrderCount, transcript wording and model output are never sale evidence.",
        "Currencies remain separate and are never converted or combined."
      ]
    }
  };
}

function assignmentValidation(row, index, callsById, duplicateSets) {
  const errors = [];
  const pilotRecordId = clean(row.pilot_record_id);
  const pilotArm = normalized(row.pilot_arm);
  const voicemailEventId = clean(row.voicemail_event_id);
  const outboundCallId = clean(row.outbound_call_id);
  const assignedAt = isoTimestamp(row.pilot_assigned_at);
  const outboundCall = callsById.get(outboundCallId) || null;

  if (!pilotRecordId) errors.push("pilot_record_id_missing");
  if (!PILOT_ARMS.includes(pilotArm)) errors.push("pilot_arm_invalid");
  if (!assignedAt) errors.push("pilot_assigned_at_invalid_iso8601");
  if (!voicemailEventId) errors.push("voicemail_event_id_missing");
  if (!outboundCallId) errors.push("outbound_call_id_missing");
  if (duplicateSets.pilotRecord.has(index)) errors.push("pilot_record_id_duplicate");
  if (duplicateSets.voicemailEvent.has(index)) errors.push("voicemail_event_id_duplicate");
  if (duplicateSets.outboundCall.has(index)) errors.push("outbound_call_id_duplicate");
  if (!outboundCall) errors.push("outbound_call_id_not_in_active_import");

  if (outboundCall) {
    if (normalized(outboundCall.direction) !== "out") errors.push("outbound_call_direction_not_out");
    if (normalized(outboundCall.localOutcome) !== "voicemail") errors.push("outbound_call_not_exact_deterministic_voicemail");
    const outboundTime = callTime(outboundCall);
    if (outboundTime === null) errors.push("outbound_call_source_time_unavailable");
    if (assignedAt && outboundTime !== null && assignedAt.milliseconds > outboundTime) {
      errors.push("pilot_assignment_after_outbound_call");
    }
  }

  return { errors, pilotRecordId, pilotArm, voicemailEventId, outboundCallId, assignedAt, outboundCall };
}

function messageValidation(row, outboundTime) {
  const errors = [];
  const status = normalized(row.message_status);
  const templateVersion = clean(row.message_template_version);
  const completedAtText = clean(row.message_completed_at);
  const completedAt = completedAtText ? isoTimestamp(completedAtText) : null;

  if (!MESSAGE_STATUSES.includes(status)) errors.push("message_status_invalid");
  if (status === "approved_left" && !APPROVED_MESSAGE_TEMPLATE_VERSIONS.includes(templateVersion)) {
    errors.push("approved_message_template_version_not_allowed");
  }
  if (["approved_left", "other_left"].includes(status)) {
    if (!completedAt) errors.push("message_completed_at_required_valid_iso8601");
    if (completedAt && outboundTime !== null && completedAt.milliseconds < outboundTime) {
      errors.push("message_completed_before_outbound_call");
    }
  } else if (completedAtText) {
    errors.push("message_completed_at_conflicts_with_message_status");
  }

  return {
    status: errors.length ? "not_scored" : "observed",
    value: status,
    templateVersion,
    completedAt: completedAt?.text || "",
    reasons: errors
  };
}

function financialScopeValidation(row) {
  const currency = clean(row.pilot_currency).toUpperCase();
  const errors = [];
  if (!ALLOWED_CURRENCIES.includes(currency)) errors.push("pilot_currency_not_allowed");
  return {
    status: errors.length ? "not_scored" : "observed",
    currency: errors.length ? "" : currency,
    reasons: errors
  };
}

function commercialScopeValidation(row, assignment) {
  const completedAtText = clean(row.commercial_observation_completed_at);
  if (!completedAtText) {
    return { status: "unknown_incomplete_window", completedAt: "", reasons: [] };
  }
  const completedAt = isoTimestamp(completedAtText);
  const errors = [];
  if (!completedAt) errors.push("commercial_observation_completed_at_invalid_iso8601");
  const outboundTime = callTime(assignment.outboundCall);
  if (completedAt && outboundTime !== null && completedAt.milliseconds < outboundTime) {
    errors.push("commercial_observation_completed_before_outbound_call");
  }
  return {
    status: errors.length ? "not_scored" : "observed",
    completedAt: errors.length ? "" : completedAt?.text || "",
    reasons: errors
  };
}

function callbackValidation(row, assignment, callsById, duplicateCallbackIndexes, index) {
  const callbackCallId = clean(row.callback_call_id);
  const attributionSource = normalized(row.callback_attribution_source);
  const handlerUserId = clean(row.handler_user_id);
  const observationText = clean(row.outcome_observation_completed_at);
  const observationCompletedAt = observationText ? isoTimestamp(observationText) : null;
  const outboundTime = callTime(assignment.outboundCall);
  const errors = [];

  if (observationText && !observationCompletedAt) errors.push("outcome_observation_completed_at_invalid_iso8601");
  if (observationCompletedAt && outboundTime !== null && observationCompletedAt.milliseconds < outboundTime) {
    errors.push("outcome_observation_completed_before_outbound_call");
  }

  if (!callbackCallId) {
    if (attributionSource) errors.push("callback_attribution_source_without_callback_call_id");
    if (handlerUserId) errors.push("handler_user_id_without_callback_call_id");
    if (errors.length) {
      return { status: "not_scored", callId: "", attributionSource, reasons: errors, handlerClass: "not_scored", observationCompletedAt: observationCompletedAt?.text || "" };
    }
    return {
      status: observationCompletedAt ? "not_observed_in_completed_window" : "unknown_incomplete_window",
      callId: "",
      attributionSource: "",
      reasons: [],
      handlerClass: "not_applicable",
      observationCompletedAt: observationCompletedAt?.text || ""
    };
  }

  if (!CALLBACK_ATTRIBUTION_SOURCES.includes(attributionSource)) errors.push("callback_attribution_source_invalid");
  if (duplicateCallbackIndexes.has(index)) errors.push("callback_call_id_linked_to_multiple_pilot_records");
  const callbackCall = callsById.get(callbackCallId) || null;
  if (!callbackCall) errors.push("callback_call_id_not_in_active_import");
  if (callbackCall) {
    if (normalized(callbackCall.direction) !== "in") errors.push("callback_call_direction_not_in");
    const callbackTime = callTime(callbackCall);
    if (callbackTime === null) errors.push("callback_call_source_time_unavailable");
    if (callbackTime !== null && outboundTime !== null && callbackTime <= outboundTime) errors.push("callback_not_later_than_outbound_call");
    if (observationCompletedAt && callbackTime !== null && observationCompletedAt.milliseconds < callbackTime) {
      errors.push("outcome_observation_completed_before_callback_call");
    }

    const outboundStable = stableIdValues(assignment.outboundCall);
    const callbackStable = stableIdValues(callbackCall);
    const shared = sharedStableIds(assignment.outboundCall, callbackCall);
    if (outboundStable.size && callbackStable.size && !shared.length) errors.push("callback_stable_id_conflict");
    if ((!outboundStable.size || !callbackStable.size) && attributionSource === "manager_verified") {
      errors.push("manager_verified_callback_requires_shared_stable_id");
    }

    const callbackUserId = sourceUserId(callbackCall);
    if (handlerUserId && (!callbackUserId || handlerUserId !== callbackUserId)) errors.push("handler_user_id_does_not_match_inbound_source");
  }

  if (errors.length) {
    return { status: "not_scored", callId: callbackCallId, attributionSource, reasons: errors, handlerClass: "not_scored", observationCompletedAt: observationCompletedAt?.text || "" };
  }

  const outboundUserId = sourceUserId(assignment.outboundCall);
  const callbackUserId = sourceUserId(callbackCall);
  const outboundSalesperson = normalized(assignment.outboundCall.salesperson);
  const callbackSalesperson = normalized(callbackCall.salesperson);
  let handlerClass = "unknown";
  if (outboundUserId && callbackUserId) handlerClass = outboundUserId === callbackUserId ? "original_salesperson" : "different_salesperson";
  else if (outboundSalesperson && callbackSalesperson && outboundSalesperson !== "unknown" && callbackSalesperson !== "unknown") {
    handlerClass = outboundSalesperson === callbackSalesperson ? "original_salesperson" : "different_salesperson";
  }

  return {
    status: "observed",
    callId: callbackCallId,
    sourceTime: clean(callbackCall.dateTime),
    attributionSource,
    reasons: [],
    handlerUserId: callbackUserId,
    handlerSalesperson: clean(callbackCall.salesperson),
    handlerClass,
    observationCompletedAt: observationCompletedAt?.text || "",
    sharedStableIds: sharedStableIds(assignment.outboundCall, callbackCall)
  };
}

function commercialValidation(row, assignment, callback, financialScope, commercialScope, duplicateSaleIndexes, index) {
  const crmLeadId = clean(row.crm_lead_id);
  const crmSaleId = clean(row.crm_sale_id);
  const saleStatus = normalized(row.sale_status);
  const saleRecordedText = clean(row.sale_recorded_at);
  const grossProfitText = clean(row.gross_profit_minor_units);
  const currency = clean(row.currency).toUpperCase();
  const saleErrors = [];
  const profitErrors = [];

  if (crmLeadId) {
    const values = stableIdValues(assignment.outboundCall);
    const callbackCall = callback.callId ? callback.call : null;
    if (callbackCall) stableIdValues(callbackCall).forEach((value) => values.add(value));
    if (!values.has(crmLeadId)) saleErrors.push("crm_lead_id_not_found_in_linked_call_stable_ids");
  }

  if (!crmSaleId) {
    if (saleStatus || saleRecordedText) saleErrors.push("sale_fields_without_crm_sale_id");
    if (grossProfitText || currency) profitErrors.push("gross_profit_fields_without_crm_sale_id");
    return {
      sale: { status: saleErrors.length ? "not_scored" : commercialScope.status === "observed" ? "not_observed_in_completed_window" : "not_recorded", crmLeadId, crmSaleId: "", value: "", recordedAt: "", reasons: saleErrors },
      profit: { status: profitErrors.length ? "not_scored" : "not_recorded", minorUnits: null, currency: "", reasons: profitErrors }
    };
  }

  if (duplicateSaleIndexes.has(index)) saleErrors.push("crm_sale_id_linked_to_multiple_pilot_records");
  if (!SALE_STATUSES.includes(saleStatus)) saleErrors.push("sale_status_invalid");
  const saleRecordedAt = isoTimestamp(saleRecordedText);
  if (!saleRecordedAt) saleErrors.push("sale_recorded_at_required_valid_iso8601");
  const outboundTime = callTime(assignment.outboundCall);
  if (saleRecordedAt && outboundTime !== null && saleRecordedAt.milliseconds < outboundTime) saleErrors.push("sale_recorded_before_outbound_call");
  const commercialCompletedAt = isoTimestamp(commercialScope.completedAt);
  if (saleRecordedAt && commercialCompletedAt && saleRecordedAt.milliseconds > commercialCompletedAt.milliseconds) {
    saleErrors.push("sale_recorded_after_commercial_observation_completed");
  }

  let grossProfitMinorUnits = null;
  if (grossProfitText) {
    if (!/^-?\d+$/.test(grossProfitText)) profitErrors.push("gross_profit_minor_units_not_integer");
    else {
      grossProfitMinorUnits = Number(grossProfitText);
      if (!Number.isSafeInteger(grossProfitMinorUnits)) profitErrors.push("gross_profit_minor_units_out_of_safe_range");
    }
    if (!crmSaleId) profitErrors.push("gross_profit_without_crm_sale_id");
    if (!["won", "reversed"].includes(saleStatus)) profitErrors.push("gross_profit_sale_status_not_won_or_reversed");
    if (!ALLOWED_CURRENCIES.includes(currency)) profitErrors.push("gross_profit_currency_not_allowed");
    if (financialScope.status === "observed" && currency && currency !== financialScope.currency) {
      profitErrors.push("gross_profit_currency_conflicts_with_pilot_currency");
    }
  } else if (currency) {
    profitErrors.push("currency_without_gross_profit");
  }
  if ((grossProfitText || currency) && saleErrors.length) profitErrors.push("gross_profit_blocked_by_invalid_sale_evidence");

  return {
    sale: {
      status: saleErrors.length ? "not_scored" : "observed",
      crmLeadId,
      crmSaleId,
      value: saleStatus,
      recordedAt: saleRecordedAt?.text || "",
      reasons: saleErrors
    },
    profit: {
      status: grossProfitText ? (profitErrors.length ? "not_scored" : "observed") : (profitErrors.length ? "not_scored" : "not_recorded"),
      minorUnits: profitErrors.length ? null : grossProfitMinorUnits,
      currency: profitErrors.length ? "" : currency,
      reasons: [...new Set(profitErrors)]
    }
  };
}

function currencyRollup(bucket, currency) {
  let row = bucket.find((item) => item.currency === currency);
  if (!row) {
    row = {
      currency,
      assignedOpportunities: 0,
      totalMinorUnits: 0,
      observedSales: 0,
      wonSalesWithProfit: 0,
      wonGrossProfitMinorUnits: 0,
      commercialObservationComplete: 0,
      profitCompleteAssignments: 0,
      grossProfitStatus: "not_available",
      grossProfitPerAssignedMinorUnits: null,
      grossProfitPerWonSaleMinorUnits: null
    };
    bucket.push(row);
  }
  return row;
}

function addProfit(bucket, currency, minorUnits, saleStatus) {
  const row = currencyRollup(bucket, currency);
  row.totalMinorUnits += minorUnits;
  row.observedSales += 1;
  if (saleStatus === "won") {
    row.wonSalesWithProfit += 1;
    row.wonGrossProfitMinorUnits += minorUnits;
  }
}

function finalizeCurrencyRollups(rows) {
  rows.forEach((row) => {
    const durations = new Set(row._commercialWindowDurations || []);
    const completeCoverage = row.assignedOpportunities > 0
      && row.profitCompleteAssignments === row.assignedOpportunities
      && durations.size === 1;
    row.grossProfitStatus = completeCoverage
      ? "available_complete_equal_window"
      : row.profitCompleteAssignments < row.assignedOpportunities
        ? "not_available_incomplete_commercial_evidence"
        : "not_available_unequal_commercial_windows";
    row.commercialWindowDurationMs = durations.size === 1 ? Array.from(durations)[0] : null;
    row.grossProfitPerAssignedMinorUnits = completeCoverage
      ? row.totalMinorUnits / row.assignedOpportunities
      : null;
    row.grossProfitPerWonSaleMinorUnits = row.wonSalesWithProfit > 0
      ? row.wonGrossProfitMinorUnits / row.wonSalesWithProfit
      : null;
    delete row._commercialWindowDurations;
  });
  rows.sort((left, right) => left.currency.localeCompare(right.currency));
}

function summarize(records) {
  const arms = PILOT_ARMS.map(emptyArm);
  const armByName = new Map(arms.map((arm) => [arm.arm, arm]));
  const attributionSources = CALLBACK_ATTRIBUTION_SOURCES.map((source) => ({ source, callbacks: 0 }));
  const attributionByName = new Map(attributionSources.map((row) => [row.source, row]));
  const grossProfitByCurrency = [];
  let measureNotScored = 0;

  records.forEach((record) => {
    const arm = armByName.get(record.pilotArm);
    arm.assigned += 1;
    if (record.financialScope.status === "observed") {
      currencyRollup(arm.grossProfitByCurrency, record.financialScope.currency).assignedOpportunities += 1;
      currencyRollup(grossProfitByCurrency, record.financialScope.currency).assignedOpportunities += 1;
    } else {
      arm.financialScopeNotScored += 1;
      measureNotScored += 1;
    }

    if (record.commercialScope.status === "observed") {
      const outboundTime = Date.parse(clean(record.outboundCall?.sourceTime));
      const completedTime = Date.parse(clean(record.commercialScope.completedAt));
      const duration = Number.isFinite(outboundTime) && Number.isFinite(completedTime) ? completedTime - outboundTime : null;
      if (record.financialScope.status === "observed") {
        const armCurrency = currencyRollup(arm.grossProfitByCurrency, record.financialScope.currency);
        const totalCurrency = currencyRollup(grossProfitByCurrency, record.financialScope.currency);
        armCurrency.commercialObservationComplete += 1;
        totalCurrency.commercialObservationComplete += 1;
        if (!Array.isArray(armCurrency._commercialWindowDurations)) armCurrency._commercialWindowDurations = [];
        if (!Array.isArray(totalCurrency._commercialWindowDurations)) totalCurrency._commercialWindowDurations = [];
        if (duration !== null) {
          armCurrency._commercialWindowDurations.push(duration);
          totalCurrency._commercialWindowDurations.push(duration);
        }
        const profitComplete = record.sale.status === "not_observed_in_completed_window"
          || (record.sale.status === "observed" && (!["won", "reversed"].includes(record.sale.value) || record.profit.status === "observed"));
        if (profitComplete) {
          armCurrency.profitCompleteAssignments += 1;
          totalCurrency.profitCompleteAssignments += 1;
        }
      }
    } else if (record.commercialScope.status === "not_scored") {
      arm.commercialScopeNotScored += 1;
      measureNotScored += 1;
    } else {
      arm.commercialObservationIncomplete += 1;
    }
    if (record.message.status === "not_scored") {
      arm.messageNotScored += 1;
      measureNotScored += 1;
    } else if (record.message.value === "approved_left") arm.approvedMessages += 1;
    else if (record.message.value === "other_left") arm.otherMessages += 1;
    else if (record.message.value === "not_left") arm.messagesNotLeft += 1;
    else arm.messageUnknown += 1;

    if (record.callback.status === "observed") {
      arm.callbacksObserved += 1;
      if (record.callback.observationCompletedAt) arm.callbackOutcomesResolved += 1;
      else arm.callbackEndpointWindowIncomplete += 1;
      attributionByName.get(record.callback.attributionSource).callbacks += 1;
      if (record.callback.handlerClass === "original_salesperson") arm.originalSalespersonHandling += 1;
      else if (record.callback.handlerClass === "different_salesperson") arm.differentSalespersonHandling += 1;
      else arm.handlerUnknown += 1;
    } else if (record.callback.status === "not_observed_in_completed_window") {
      arm.callbacksNotObservedInCompletedWindow += 1;
      arm.callbackOutcomesResolved += 1;
    } else if (record.callback.status === "unknown_incomplete_window") arm.callbacksUnknownIncompleteWindow += 1;
    else {
      arm.callbacksNotScored += 1;
      measureNotScored += 1;
    }

    if (record.sale.status === "observed") {
      if (record.sale.value === "won") arm.salesWon += 1;
      else if (record.sale.value === "lost") arm.salesLost += 1;
      else if (record.sale.value === "pending") arm.salesPending += 1;
      else if (record.sale.value === "reversed") arm.salesReversed += 1;
    } else if (record.sale.status === "not_scored") {
      arm.saleNotScored += 1;
      measureNotScored += 1;
    }

    if (record.profit.status === "observed") {
      addProfit(arm.grossProfitByCurrency, record.profit.currency, record.profit.minorUnits, record.sale.value);
      addProfit(grossProfitByCurrency, record.profit.currency, record.profit.minorUnits, record.sale.value);
    } else if (record.profit.status === "not_scored") measureNotScored += 1;
  });

  arms.forEach((arm) => {
    arm.recordedCallbacksPerAssigned = ratio(arm.callbacksObserved, arm.assigned);
    if (arm.assigned > 0 && arm.callbackOutcomesResolved === arm.assigned) {
      arm.callbackRateStatus = "available_complete_window";
      arm.resolvedCallbackRate = ratio(arm.callbacksObserved, arm.assigned);
    }
    finalizeCurrencyRollups(arm.grossProfitByCurrency);
  });
  finalizeCurrencyRollups(grossProfitByCurrency);

  const treatment = armByName.get("treatment");
  const control = armByName.get("control");
  const observationWindowDurations = records
    .map((record) => {
      const outbound = Date.parse(clean(record.outboundCall?.sourceTime));
      const completed = Date.parse(clean(record.callback?.observationCompletedAt));
      return Number.isFinite(outbound) && Number.isFinite(completed) ? completed - outbound : null;
    })
    .filter((duration) => duration !== null);
  const uniqueObservationWindowDurations = new Set(observationWindowDurations);
  let intentionToTreat;
  if (!treatment.assigned || !control.assigned) {
    intentionToTreat = { status: "not_available", reason: "both_preassigned_arms_required", treatmentCallbackRate: null, controlCallbackRate: null, absoluteDifference: null };
  } else if (treatment.callbackRateStatus !== "available_complete_window" || control.callbackRateStatus !== "available_complete_window") {
    intentionToTreat = { status: "not_available", reason: "all_assigned_records_require_resolved_callback_outcomes", treatmentCallbackRate: null, controlCallbackRate: null, absoluteDifference: null };
  } else if (uniqueObservationWindowDurations.size !== 1) {
    intentionToTreat = { status: "not_available", reason: "outcome_observation_windows_must_have_equal_duration", treatmentCallbackRate: null, controlCallbackRate: null, absoluteDifference: null };
  } else {
    intentionToTreat = {
      status: "measured_comparison",
      reason: "preassignment_and_complete_observation_windows_present",
      treatmentCallbackRate: treatment.resolvedCallbackRate,
      controlCallbackRate: control.resolvedCallbackRate,
      absoluteDifference: treatment.resolvedCallbackRate - control.resolvedCallbackRate
    };
  }
  intentionToTreat.observationWindowDurationMs = uniqueObservationWindowDurations.size === 1
    ? Array.from(uniqueObservationWindowDurations)[0]
    : null;
  intentionToTreat.interpretation = "This is an intention-to-treat measurement, not proof of causation. Causal interpretation still requires a documented random assignment process and valid pilot operations.";

  return { arms, attributionSources, grossProfitByCurrency, measureNotScored, intentionToTreat };
}

function buildVoicemailPilotAttributionReport(source = {}, calls = [], options = {}) {
  const configured = options.configured !== false;
  if (!configured) return emptyReport({ configured: false });
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const columns = Array.isArray(source.columns) ? source.columns.map(clean) : [];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missingColumns.length) {
    const report = emptyReport({
      configured: true,
      status: "invalid_source",
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      sheetName: source.sheetName,
      fileErrors: missingColumns.map((column) => reason("required_column_missing", column))
    });
    report.totals.inputRows = rows.length;
    return report;
  }

  const callsById = new Map((Array.isArray(calls) ? calls : []).map((call) => [clean(call.callId), call]).filter(([id]) => id));
  const duplicateSets = {
    pilotRecord: duplicateIndexes(rows, "pilot_record_id"),
    voicemailEvent: duplicateIndexes(rows, "voicemail_event_id"),
    outboundCall: duplicateIndexes(rows, "outbound_call_id")
  };
  const duplicateCallbackIndexes = duplicateIndexes(rows, "callback_call_id");
  const duplicateSaleIndexes = duplicateIndexes(rows, "crm_sale_id");
  const acceptedRecords = [];
  const rejectedRecords = [];

  rows.forEach((row, index) => {
    const assignment = assignmentValidation(row, index, callsById, duplicateSets);
    if (assignment.errors.length) {
      rejectedRecords.push({
        rowNumber: index + 2,
        pilotRecordId: assignment.pilotRecordId,
        outboundCallId: assignment.outboundCallId,
        status: "not_scored",
        reasons: assignment.errors
      });
      return;
    }

    const outboundTime = callTime(assignment.outboundCall);
    const message = messageValidation(row, outboundTime);
    const callback = callbackValidation(row, assignment, callsById, duplicateCallbackIndexes, index);
    callback.call = callback.callId ? (callsById.get(callback.callId) || null) : null;
    const financialScope = financialScopeValidation(row);
    const commercialScope = commercialScopeValidation(row, assignment);
    const commercial = commercialValidation(row, assignment, callback, financialScope, commercialScope, duplicateSaleIndexes, index);
    delete callback.call;
    acceptedRecords.push({
      rowNumber: index + 2,
      pilotRecordId: assignment.pilotRecordId,
      pilotArm: assignment.pilotArm,
      pilotAssignedAt: assignment.assignedAt.text,
      voicemailEventId: assignment.voicemailEventId,
      outboundCall: {
        callId: assignment.outboundCallId,
        sourceTime: clean(assignment.outboundCall.dateTime),
        userId: sourceUserId(assignment.outboundCall),
        salesperson: clean(assignment.outboundCall.salesperson)
      },
      financialScope,
      commercialScope,
      message,
      callback,
      sale: commercial.sale,
      profit: commercial.profit
    });
  });

  const summary = summarize(acceptedRecords);
  const report = emptyReport({
    configured: true,
    status: rows.length === 0
      ? "ready_empty"
      : rejectedRecords.length || summary.measureNotScored
        ? "ready_with_exclusions"
        : "ready",
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    sheetName: source.sheetName
  });
  report.totals = {
    inputRows: rows.length,
    acceptedAssignments: acceptedRecords.length,
    rejectedAssignments: rejectedRecords.length,
    measureNotScored: summary.measureNotScored,
    callbacksObserved: acceptedRecords.filter((record) => record.callback.status === "observed").length,
    salesObserved: acceptedRecords.filter((record) => record.sale.status === "observed").length
  };
  report.arms = summary.arms;
  report.attributionSources = summary.attributionSources;
  report.grossProfitByCurrency = summary.grossProfitByCurrency;
  report.intentionToTreat = summary.intentionToTreat;
  report.acceptedRecords = acceptedRecords;
  report.rejectedRecords = rejectedRecords;
  return report;
}

function voicemailPilotLoadError(error, sourceName = "") {
  return emptyReport({
    configured: true,
    status: "load_error",
    sourceName,
    fileErrors: ["pilot_source_read_failed"],
    loadError: error
  });
}

module.exports = {
  ALLOWED_CURRENCIES,
  APPROVED_MESSAGE_TEMPLATE_VERSIONS,
  CALLBACK_ATTRIBUTION_SOURCES,
  MESSAGE_STATUSES,
  PILOT_ARMS,
  REQUIRED_COLUMNS,
  SALE_STATUSES,
  buildVoicemailPilotAttributionReport,
  emptyVoicemailPilotAttributionReport: emptyReport,
  voicemailPilotLoadError
};
