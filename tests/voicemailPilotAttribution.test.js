"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_COLUMNS,
  buildVoicemailPilotAttributionReport,
  emptyVoicemailPilotAttributionReport
} = require("../src/voicemailPilotAttribution");

function call(overrides = {}) {
  return {
    callId: "out-1",
    direction: "out",
    localOutcome: "voicemail",
    dateTime: "2026-07-20T09:00:00.000Z",
    userId: "seller-1",
    salesperson: "Dylan",
    stableIds: [{ field: "customer_id", value: "customer-1" }],
    orderCount: 9,
    ...overrides
  };
}

function pilotRow(overrides = {}) {
  return {
    pilot_record_id: "pilot-1",
    pilot_arm: "treatment",
    pilot_assigned_at: "2026-07-20T08:00:00Z",
    pilot_currency: "AUD",
    voicemail_event_id: "vm-1",
    outbound_call_id: "out-1",
    message_status: "approved_left",
    message_template_version: "approved_v1",
    message_completed_at: "2026-07-20T09:01:00Z",
    callback_call_id: "in-1",
    callback_attribution_source: "telephony_event_link",
    handler_user_id: "seller-1",
    crm_lead_id: "customer-1",
    crm_sale_id: "sale-1",
    sale_status: "won",
    sale_recorded_at: "2026-07-20T11:00:00Z",
    gross_profit_minor_units: "12550",
    currency: "AUD",
    outcome_observation_completed_at: "2026-07-21T09:00:00Z",
    commercial_observation_completed_at: "2026-07-21T09:00:00Z",
    ...overrides
  };
}

function source(rows, columns = REQUIRED_COLUMNS) {
  return { sourceName: "pilot.csv", sourceType: "csv", sheetName: null, columns: [...columns], rows };
}

function linkedCalls() {
  return [
    call(),
    call({
      callId: "in-1",
      direction: "in",
      localOutcome: "unknown",
      dateTime: "2026-07-20T10:00:00.000Z"
    }),
    call({
      callId: "out-2",
      dateTime: "2026-07-20T09:30:00.000Z",
      userId: "seller-2",
      salesperson: "Alex",
      stableIds: [{ field: "customer_id", value: "customer-2" }]
    })
  ];
}

test("an unconfigured pilot is explicitly unavailable and has no authority", () => {
  const report = emptyVoicemailPilotAttributionReport({ configured: false });
  assert.equal(report.status, "not_configured");
  assert.equal(report.configured, false);
  assert.equal(report.contract.modelUsePermitted, false);
  assert.equal(report.contract.phoneMatchingPermitted, false);
  assert.equal(report.intentionToTreat.status, "not_available");
});

test("a schema-valid source with no assignments is not presented as ready evidence", () => {
  const report = buildVoicemailPilotAttributionReport(source([]), linkedCalls());
  assert.equal(report.status, "ready_empty");
  assert.equal(report.totals.inputRows, 0);
  assert.equal(report.intentionToTreat.status, "not_available");
});

test("strict source facts produce a complete two-arm intention-to-treat measurement", () => {
  const rows = [
    pilotRow(),
    pilotRow({
      pilot_record_id: "pilot-2",
      pilot_arm: "control",
      pilot_assigned_at: "2026-07-20T08:30:00Z",
      voicemail_event_id: "vm-2",
      outbound_call_id: "out-2",
      message_status: "not_left",
      message_template_version: "",
      message_completed_at: "",
      callback_call_id: "",
      callback_attribution_source: "",
      handler_user_id: "",
      crm_lead_id: "customer-2",
      crm_sale_id: "",
      sale_status: "",
      sale_recorded_at: "",
      gross_profit_minor_units: "",
      currency: "",
      outcome_observation_completed_at: "2026-07-21T09:30:00Z",
      commercial_observation_completed_at: "2026-07-21T09:30:00Z"
    })
  ];
  const report = buildVoicemailPilotAttributionReport(source(rows), linkedCalls());

  assert.equal(report.status, "ready");
  assert.equal(report.totals.acceptedAssignments, 2);
  assert.equal(report.totals.rejectedAssignments, 0);
  assert.equal(report.totals.callbacksObserved, 1);
  assert.equal(report.intentionToTreat.status, "measured_comparison");
  assert.equal(report.intentionToTreat.treatmentCallbackRate, 1);
  assert.equal(report.intentionToTreat.controlCallbackRate, 0);
  assert.equal(report.intentionToTreat.absoluteDifference, 1);
  assert.deepEqual(report.grossProfitByCurrency, [{
    currency: "AUD",
    assignedOpportunities: 2,
    totalMinorUnits: 12550,
    observedSales: 1,
    wonSalesWithProfit: 1,
    wonGrossProfitMinorUnits: 12550,
    commercialObservationComplete: 2,
    profitCompleteAssignments: 2,
    grossProfitStatus: "available_complete_equal_window",
    grossProfitPerAssignedMinorUnits: 6275,
    grossProfitPerWonSaleMinorUnits: 12550,
    commercialWindowDurationMs: 86400000
  }]);
  assert.equal(report.acceptedRecords[0].callback.handlerClass, "original_salesperson");
  assert.equal(report.acceptedRecords[0].sale.status, "observed");
  assert.equal(report.acceptedRecords[0].profit.status, "observed");
});

test("incomplete observation windows prevent a callback-lift result", () => {
  const rows = [
    pilotRow({ callback_call_id: "", callback_attribution_source: "", handler_user_id: "", crm_sale_id: "", sale_status: "", sale_recorded_at: "", gross_profit_minor_units: "", currency: "", outcome_observation_completed_at: "" }),
    pilotRow({
      pilot_record_id: "pilot-2",
      pilot_arm: "control",
      voicemail_event_id: "vm-2",
      outbound_call_id: "out-2",
      callback_call_id: "",
      callback_attribution_source: "",
      handler_user_id: "",
      crm_lead_id: "customer-2",
      crm_sale_id: "",
      sale_status: "",
      sale_recorded_at: "",
      gross_profit_minor_units: "",
      currency: "",
      outcome_observation_completed_at: ""
    })
  ];
  const report = buildVoicemailPilotAttributionReport(source(rows), linkedCalls());
  assert.equal(report.intentionToTreat.status, "not_available");
  assert.equal(report.intentionToTreat.reason, "all_assigned_records_require_resolved_callback_outcomes");
  assert.equal(report.arms[0].callbacksUnknownIncompleteWindow, 1);
  assert.equal(report.arms[1].callbacksUnknownIncompleteWindow, 1);
});

test("unequal outcome-window durations prevent a treatment-versus-control rate", () => {
  const rows = [
    pilotRow(),
    pilotRow({
      pilot_record_id: "pilot-2",
      pilot_arm: "control",
      pilot_assigned_at: "2026-07-20T08:30:00Z",
      voicemail_event_id: "vm-2",
      outbound_call_id: "out-2",
      message_status: "not_left",
      message_template_version: "",
      message_completed_at: "",
      callback_call_id: "",
      callback_attribution_source: "",
      handler_user_id: "",
      crm_lead_id: "customer-2",
      crm_sale_id: "",
      sale_status: "",
      sale_recorded_at: "",
      gross_profit_minor_units: "",
      currency: "",
      outcome_observation_completed_at: "2026-07-21T09:45:00Z"
    })
  ];
  const report = buildVoicemailPilotAttributionReport(source(rows), linkedCalls());
  assert.equal(report.intentionToTreat.status, "not_available");
  assert.equal(report.intentionToTreat.reason, "outcome_observation_windows_must_have_equal_duration");
  assert.equal(report.intentionToTreat.observationWindowDurationMs, null);
});

test("duplicate immutable assignment IDs reject every affected assignment", () => {
  const first = pilotRow({ callback_call_id: "", callback_attribution_source: "", handler_user_id: "", crm_sale_id: "", sale_status: "", sale_recorded_at: "", gross_profit_minor_units: "", currency: "" });
  const second = { ...first, pilot_arm: "control" };
  const report = buildVoicemailPilotAttributionReport(source([first, second]), linkedCalls());
  assert.equal(report.totals.acceptedAssignments, 0);
  assert.equal(report.totals.rejectedAssignments, 2);
  assert.ok(report.rejectedRecords.every((row) => row.reasons.includes("pilot_record_id_duplicate")));
  assert.ok(report.rejectedRecords.every((row) => row.reasons.includes("voicemail_event_id_duplicate")));
  assert.ok(report.rejectedRecords.every((row) => row.reasons.includes("outbound_call_id_duplicate")));
});

test("invalid downstream evidence is not scored without removing a valid assignment denominator", () => {
  const calls = [
    ...linkedCalls(),
    call({
      callId: "in-conflict",
      direction: "in",
      localOutcome: "unknown",
      dateTime: "2026-07-20T10:30:00.000Z",
      userId: "seller-9",
      stableIds: [{ field: "customer_id", value: "different-customer" }]
    })
  ];
  const row = pilotRow({
    message_template_version: "unapproved_v9",
    callback_call_id: "in-conflict",
    handler_user_id: "seller-1",
    crm_lead_id: "wrong-lead",
    sale_status: "pending",
    gross_profit_minor_units: "12.50",
    currency: "USD"
  });
  const report = buildVoicemailPilotAttributionReport(source([row]), calls);
  const accepted = report.acceptedRecords[0];
  assert.equal(report.totals.acceptedAssignments, 1);
  assert.equal(report.totals.rejectedAssignments, 0);
  assert.equal(report.status, "ready_with_exclusions");
  assert.equal(accepted.message.status, "not_scored");
  assert.equal(accepted.callback.status, "not_scored");
  assert.ok(accepted.callback.reasons.includes("callback_stable_id_conflict"));
  assert.ok(accepted.callback.reasons.includes("handler_user_id_does_not_match_inbound_source"));
  assert.equal(accepted.sale.status, "not_scored");
  assert.equal(accepted.profit.status, "not_scored");
  assert.ok(accepted.profit.reasons.includes("gross_profit_minor_units_not_integer"));
  assert.ok(accepted.profit.reasons.includes("gross_profit_currency_not_allowed"));
});

test("manager verification requires shared stable IDs while an immutable event link can survive missing IDs", () => {
  const calls = [
    call({ stableIds: [] }),
    call({ callId: "in-1", direction: "in", localOutcome: "unknown", dateTime: "2026-07-20T10:00:00.000Z", stableIds: [] })
  ];
  const noSale = { crm_lead_id: "", crm_sale_id: "", sale_status: "", sale_recorded_at: "", gross_profit_minor_units: "", currency: "" };
  const manager = buildVoicemailPilotAttributionReport(source([pilotRow({ ...noSale, callback_attribution_source: "manager_verified" })]), calls);
  assert.equal(manager.acceptedRecords[0].callback.status, "not_scored");
  assert.ok(manager.acceptedRecords[0].callback.reasons.includes("manager_verified_callback_requires_shared_stable_id"));

  const eventLinked = buildVoicemailPilotAttributionReport(source([pilotRow({ ...noSale, callback_attribution_source: "telephony_event_link" })]), calls);
  assert.equal(eventLinked.acceptedRecords[0].callback.status, "observed");
});

test("missing contract columns reject the entire source before joining records", () => {
  const columns = REQUIRED_COLUMNS.filter((column) => column !== "crm_sale_id");
  const report = buildVoicemailPilotAttributionReport(source([pilotRow()], columns), linkedCalls());
  assert.equal(report.status, "invalid_source");
  assert.equal(report.totals.inputRows, 1);
  assert.equal(report.totals.acceptedAssignments, 0);
  assert.deepEqual(report.fileErrors, ["required_column_missing:crm_sale_id"]);
});

test("OrderCount never contributes sale or profit evidence", () => {
  const row = pilotRow({ crm_sale_id: "", sale_status: "", sale_recorded_at: "", gross_profit_minor_units: "", currency: "" });
  const report = buildVoicemailPilotAttributionReport(source([row]), linkedCalls());
  assert.equal(report.acceptedRecords[0].sale.status, "not_observed_in_completed_window");
  assert.equal(report.acceptedRecords[0].profit.status, "not_recorded");
  assert.equal(report.totals.salesObserved, 0);
});

test("financial currency scope is required for per-assignment profit and never changes callback denominators", () => {
  const row = pilotRow({ pilot_currency: "", currency: "AUD" });
  const report = buildVoicemailPilotAttributionReport(source([row]), linkedCalls());
  assert.equal(report.totals.acceptedAssignments, 1);
  assert.equal(report.acceptedRecords[0].callback.status, "observed");
  assert.equal(report.acceptedRecords[0].financialScope.status, "not_scored");
  assert.equal(report.acceptedRecords[0].profit.status, "observed");
  assert.deepEqual(report.grossProfitByCurrency, [{
    currency: "AUD",
    assignedOpportunities: 0,
    totalMinorUnits: 12550,
    observedSales: 1,
    wonSalesWithProfit: 1,
    wonGrossProfitMinorUnits: 12550,
    commercialObservationComplete: 0,
    profitCompleteAssignments: 0,
    grossProfitStatus: "not_available_unequal_commercial_windows",
    grossProfitPerAssignedMinorUnits: null,
    grossProfitPerWonSaleMinorUnits: 12550,
    commercialWindowDurationMs: null
  }]);
});

test("gross-profit currency must match the opportunity currency", () => {
  const report = buildVoicemailPilotAttributionReport(source([pilotRow({ pilot_currency: "AUD", currency: "NZD" })]), linkedCalls());
  assert.equal(report.totals.acceptedAssignments, 1);
  assert.equal(report.acceptedRecords[0].financialScope.status, "observed");
  assert.equal(report.acceptedRecords[0].profit.status, "not_scored");
  assert.ok(report.acceptedRecords[0].profit.reasons.includes("gross_profit_currency_conflicts_with_pilot_currency"));
  assert.deepEqual(report.grossProfitByCurrency, [{
    currency: "AUD",
    assignedOpportunities: 1,
    totalMinorUnits: 0,
    observedSales: 0,
    wonSalesWithProfit: 0,
    wonGrossProfitMinorUnits: 0,
    commercialObservationComplete: 1,
    profitCompleteAssignments: 0,
    grossProfitStatus: "not_available_incomplete_commercial_evidence",
    grossProfitPerAssignedMinorUnits: null,
    grossProfitPerWonSaleMinorUnits: null,
    commercialWindowDurationMs: 86400000
  }]);
});
