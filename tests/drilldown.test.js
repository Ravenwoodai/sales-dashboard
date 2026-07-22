"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const { buildDrilldownResult } = require("../src/drilldown");
const { createServer } = require("../src/main");
const { readStore, saveBadLeadClaim } = require("../src/storage");
const { saveLlmIntelligenceResult } = require("../src/intelligenceDatabase");
const { renderEvaluationStudioPage, renderReportPage } = require("../src/dashboardRenderer");

const header = [
  "dialled_phone_number",
  "call_id",
  "UserID",
  "Mobile",
  "CallTotalSeconds",
  "call_date",
  "call_time",
  "ring_time_seconds",
  "call_duration_seconds",
  "AllocatedLeadID",
  "customer_id",
  "ContactId",
  "Baz_DetailedNotes",
  "transcription_text",
  "CallType",
  "call_direction",
  "NoSaleType",
  "CustomerCreatedBy",
  "CustomerCreatedByType",
  "CustomerCreateDate",
  "CustomerImportDate",
  "CustomerImportSource",
  "Salesperson",
  "Prefix",
  "CallerID",
  "IsNZCall",
  "CallRegion",
  "FoundContactID",
  "FoundCustomerID",
  "OrderCount"
];

function tempStorePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-drilldown-")), "state.json");
}

function assertAllTableHeadingsHaveHelp(html, pageLabel) {
  const headingCount = (html.match(/<th(?:\s|>)/g) || []).length;
  const helpCount = (html.match(/class="column-help"/g) || []).length;
  assert.ok(headingCount > 0, `${pageLabel} should render at least one data-table heading.`);
  assert.equal(helpCount, headingCount, `${pageLabel} should describe every data-table heading.`);
}

function row(overrides = {}) {
  const base = {
    dialled_phone_number: "4999999",
    call_id: "1",
    UserID: "10",
    Mobile: "1",
    CallTotalSeconds: "62",
    call_date: "1/07/2026",
    call_time: "09:00:00",
    ring_time_seconds: "2",
    call_duration_seconds: "60",
    AllocatedLeadID: "lead-1",
    customer_id: "customer-1",
    ContactId: "contact-1",
    Baz_DetailedNotes: "raw note",
    transcription_text: "Outbound call Customer: Please call me back later today. Agent: I will call you back.",
    CallType: "Click to dial",
    call_direction: "out",
    NoSaleType: "NULL",
    CustomerCreatedBy: "system",
    CustomerCreatedByType: "LG",
    CustomerCreateDate: "04:29.7",
    CustomerImportDate: "24:43.9",
    CustomerImportSource: "GoogleMaps",
    Salesperson: "Riley Example",
    Prefix: "NULL",
    CallerID: "MyMobile",
    IsNZCall: "NULL",
    CallRegion: "NULL",
    FoundContactID: "NULL",
    FoundCustomerID: "NULL",
    OrderCount: "NULL"
  };
  const values = { ...base, ...overrides };
  return header.map((field) => {
    const value = String(values[field] ?? "");
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
}

function csv(rows) {
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function typedCallbackPayload(callId, quote, timingRaw = "tomorrow", overrides = {}) {
  return {
    schema_version: "callback_opportunity.v2",
    evaluation_goal: "callback_opportunity",
    call_id: callId,
    status: "usable",
    confidence: 0.88,
    evidence_availability: "available",
    transcript_quality: "high",
    callback_state: "requested",
    next_action_channel: "call",
    timing_raw: timingRaw,
    customer_intent: "interest",
    objection: "",
    handover_summary: "Customer requested a callback.",
    evidence: [{ claim_type: "timing", speaker: "customer", quote }],
    manager_review_recommended: false,
    manager_summary: "Customer requested a callback.",
    limitations: [],
    findings: [],
    ...overrides
  };
}

function typedProcedurePayload(callId, quote, overrides = {}) {
  return {
    schema_version: "procedure_adherence.v2",
    evaluation_goal: "procedure_adherence",
    call_id: callId,
    status: "usable",
    confidence: 0.86,
    evidence_availability: "available",
    transcript_quality: "high",
    outcome: "evaluated_clear",
    strongest_issue_stage: "none",
    issue_summary: "",
    evidence: [{ claim_type: "procedure_clear", speaker: "customer", quote }],
    manager_review_recommended: false,
    manager_summary: "No material procedure issue was established.",
    limitations: [],
    findings: [],
    ...overrides
  };
}

async function withServer(csvText, fn, options = {}) {
  const storePath = tempStorePath();
  const csvPath = path.join(path.dirname(storePath), "sample.csv");
  fs.writeFileSync(csvPath, csvText, "utf8");
  const server = createServer({ csvPath, storePath, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn({ baseUrl, storePath });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Sales Opportunity Action Centre exposes only trusted transcript coverage while model actions are unavailable", async () => {
  await withServer(csv([
    row({ call_id: "opportunity-1", customer_id: "customer-opportunity-1", transcription_text: "Agent: I am calling on behalf of the local service. Customer: Please send the details." }),
    row({ call_id: "opportunity-2", customer_id: "", Salesperson: "Second Seller", CustomerImportSource: "Facebook", transcription_text: "Agent: Hello. Customer: Hello." })
  ]), async ({ baseUrl }) => {
    const htmlResponse = await fetch(`${baseUrl}/?view=opportunities&opportunityStage=transcript_available`);
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 200);
    assert.match(html, /Sales Opportunity Action Centre/);
    assert.match(html, /AI opportunity actions are unavailable/);
    assert.match(html, /Operational AI decisions[\s\S]*0/);
    assert.match(html, /AI action queues[\s\S]*0/);
    assert.doesNotMatch(html, /id="opportunity-funnel"|id="opportunity-actions"|id="opportunity-cohorts"/);

    const api = await fetch(`${baseUrl}/api/sales-opportunities?stage=transcript_available&limit=1`).then((response) => response.json());
    assert.equal(api.query.matchingRecords, 2);
    assert.equal(api.records.length, 1);
    assert.equal(api.funnel.find((stage) => stage.key === "transcript_available").count, 2);

    const briefResponse = await fetch(`${baseUrl}/api/sales-opportunities/brief?format=markdown`);
    const brief = await briefResponse.text();
    assert.equal(briefResponse.status, 200);
    assert.match(briefResponse.headers.get("content-disposition"), /sales-opportunity-action-centre-current\.md/);
    assert.match(brief, /Sales Opportunity Action Centre[^\n]*Unavailable/);
    assert.match(brief, /No local-model evaluator is promoted/);
    assert.doesNotMatch(brief, /Largest supported action pools/);

    const report = await fetch(`${baseUrl}/reports/sales-opportunity-action-centre-current`);
    assert.equal(report.status, 200);
    assert.match(await report.text(), /Unavailable/);
  });
});

test("call drill-down returns sanitized raw fields and full local transcript proof", () => {
  const analysis = analyzeCsvText(csv([row()]));
  const result = buildDrilldownResult(analysis, { metric: "calls.unique" });
  const retiredFollowUp = buildDrilldownResult(analysis, { metric: "calls.followUpRequired" });

  assert.equal(result.count, 1);
  assert.equal(result.rows[0].callId, "1");
  assert.equal(result.rows[0].customerId, "customer-1");
  assert.equal(result.rows[0].rawFields.dialled_phone_number, undefined);
  assert.equal(result.rows[0].rawFields.CustomerCreateDate, undefined);
  assert.equal(result.rows[0].rawFields.CustomerImportDate, undefined);
  assert.equal(result.rows[0].rawFields.NoSaleType, undefined);
  assert.equal(result.rows[0].rawFields.Baz_DetailedNotes, undefined);
  assert.match(result.rows[0].transcript, /Please call me back later today/);
  assert.equal(retiredFollowUp.count, 0);
  assert.equal(retiredFollowUp.authorityStatus, "unavailable");
});

test("transcript governance keeps automated quality and coaching unavailable", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "governance-usable",
      call_duration_seconds: "90",
      CallTotalSeconds: "92",
      transcription_text: "Outbound call Salesperson: I am calling about the annual community journal. Customer: Yes, please explain the offer and email the details."
    }),
    row({
      call_id: "governance-low",
      call_duration_seconds: "2",
      CallTotalSeconds: "3",
      transcription_text: "hello"
    }),
    row({
      call_id: "governance-unusable",
      call_duration_seconds: "0",
      CallTotalSeconds: "0",
      transcription_text: ""
    })
  ]));

  const usable = buildDrilldownResult(analysis, { metric: "calls.transcriptUsableForCoaching" });
  const reviewOnly = buildDrilldownResult(analysis, { metric: "calls.lowOrUnusableTranscript" });
  const unknown = buildDrilldownResult(analysis, { metric: "calls.unique", confidenceBand: "unknown" });

  assert.equal(usable.count, 0);
  assert.equal(usable.authorityStatus, "unavailable");
  assert.equal(reviewOnly.count, 0);
  assert.equal(reviewOnly.authorityStatus, "unavailable");
  assert.deepEqual(unknown.rows.map((item) => item.callId).sort(), ["governance-low", "governance-unusable", "governance-usable"]);
});

test("dashboard and Evaluation Studio expose drill-down links for backed aggregates and mark terminal metadata", async () => {
  await withServer(csv([row({ Salesperson: "Riley Example", CustomerImportSource: "GoogleMaps" })]), async ({ baseUrl }) => {
    const dashboard = await fetch(`${baseUrl}/?view=intelligence`).then((response) => response.text());
    assert.doesNotMatch(dashboard, /metric=calls\.transcriptUsableForCoaching/);
    assert.doesNotMatch(dashboard, /metric=calls\.lowOrUnusableTranscript/);
    assert.match(dashboard, /Semantic scorecards unavailable/);
    assert.match(dashboard, /Restricted Literal Transcript Triage/);
    assert.match(dashboard, /data-drilldown="not-applicable"/);
    assert.match(dashboard, /href="\/imports\/import_[^"&]+"/);
    assert.match(dashboard, /href="\/manager-reviews"/);
    const importHref = dashboard.match(/href="(\/imports\/import_[^"&]+)"/)[1];
    assert.equal((await fetch(`${baseUrl}${importHref}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/manager-reviews`)).status, 200);

    const studio = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(studio, /No model evaluation is available/);
    assert.match(studio, /Historical Model Outputs Grouped by Call/);
    assert.doesNotMatch(studio, /reportSignal=callbackOpportunities|reportSignal=possibleWasteIndicators|reportSignal=coachingOpportunities/);
    assert.doesNotMatch(studio, /<button type="submit">Run evaluation<\/button>/);
  });
});

test("call proof page shows transcript timeline before detected signal excerpts", async () => {
  await withServer(csv([
    row({
      call_id: "timeline-proof",
      NoSaleType: "LEGACY_DISPOSITION_SENTINEL",
      Baz_DetailedNotes: "LEGACY_NOTE_SENTINEL",
      transcription_text: [
        "Outbound call Riley Example (CWA): Hello, I was calling about supporting the local volunteers.",
        "Customer: Yes, please call me back tomorrow morning and send the details.",
        "Riley Example (CWA): Thanks, I will send that and call tomorrow."
      ].join(" ")
    })
  ]), async ({ baseUrl }) => {
    const html = await fetch(`${baseUrl}/calls/timeline-proof`).then((response) => response.text());
    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.text());
    const drilldown = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique`).then((response) => response.text());
    const alerts = await fetch(`${baseUrl}/api/alerts`).then((response) => response.text());
    const imports = await fetch(`${baseUrl}/api/imports`).then((response) => response.text());
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.text());
    const timelineIndex = html.indexOf("Transcript Timeline");
    const signalsIndex = html.indexOf("Detected Signals");

    assert.ok(timelineIndex >= 0);
    assert.ok(signalsIndex > timelineIndex);
    assert.match(html, /Full source transcript in detected speaker-turn order/);
    assert.match(html, /signal cards below are excerpts only/i);
    assert.doesNotMatch(html, /Matched phrase:\s*<span class="mono">Customer:?<\/span>/i);
    for (const output of [html, summary, drilldown, alerts, imports, studio]) {
      assert.doesNotMatch(output, /LEGACY_DISPOSITION_SENTINEL|LEGACY_NOTE_SENTINEL/);
      assert.doesNotMatch(output, /NoSaleType|Baz_DetailedNotes|outcome_mismatch|imported_no_sale/i);
    }
  });
});

test("call drill-down supports New Business and Warm Business segments", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "1", OrderCount: "NULL" }),
    row({ call_id: "2", OrderCount: "0" }),
    row({ call_id: "3", OrderCount: "4" })
  ]));

  const warm = buildDrilldownResult(analysis, { metric: "calls.warmBusiness" });
  assert.equal(warm.count, 1);
  assert.equal(warm.rows[0].callId, "3");
  assert.equal(warm.rows[0].businessSegment, "warm");
  assert.equal(warm.rows[0].businessSegmentLabel, "Warm Business");
  assert.equal(warm.rows[0].orderCount, 4);

  const newOnly = buildDrilldownResult(analysis, { metric: "calls.unique", businessSegment: "new" });
  assert.equal(newOnly.count, 2);
  assert.equal(newOnly.filters.businessSegment, "new");
  assert.equal(newOnly.filters.businessSegmentLabel, "New Business");
  assert.deepEqual(newOnly.rows.map((item) => item.callId), ["1", "2"]);

  const warmAlias = buildDrilldownResult(analysis, { metric: "calls.unique", segment: "warm_business" });
  assert.equal(warmAlias.count, 1);
  assert.equal(warmAlias.rows[0].callId, "3");
});

test("source-quality drill-down filters New Business calls by Record Age threshold", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "old-new",
      call_date: "1/07/2026",
      CustomerImportSource: "GoogleMaps",
      CustomerImportDate: "1/01/2026",
      OrderCount: "NULL"
    }),
    row({
      call_id: "fresh-new",
      call_date: "1/07/2026",
      CustomerImportSource: "GoogleMaps",
      CustomerImportDate: "28/06/2026",
      OrderCount: "0"
    }),
    row({
      call_id: "manual-old-new",
      call_date: "1/07/2026",
      CustomerImportSource: "",
      CustomerImportDate: "",
      CustomerCreatedBy: "leadgen1",
      CustomerCreatedByType: "LG",
      CustomerCreateDate: "1/01/2026",
      OrderCount: "0"
    }),
    row({
      call_id: "old-warm",
      call_date: "1/07/2026",
      CustomerImportSource: "GoogleMaps",
      CustomerImportDate: "1/01/2026",
      OrderCount: "3"
    })
  ]));

  const result = buildDrilldownResult(analysis, {
    metric: "source.newBusinessRecordOlderThan",
    minImportAgeDays: "90"
  });

  assert.equal(result.title, "New Business Record Age Older Than 90 Days");
  assert.equal(result.count, 2);
  assert.deepEqual(result.rows.map((item) => item.callId), ["old-new", "manual-old-new"]);
  assert.equal(result.rows[0].businessSegment, "new");
  assert.equal(result.rows[0].daysSinceImport, 181);
  assert.equal(result.rows[0].daysSinceRecord, 181);
  assert.equal(result.rows[0].recordAgeBasisLabel, "Imported");
  assert.equal(result.rows[1].daysSinceImport, null);
  assert.equal(result.rows[1].daysSinceCreated, 181);
  assert.equal(result.rows[1].daysSinceRecord, 181);
  assert.equal(result.rows[1].recordAgeBasisLabel, "Created by LG");
  assert.equal(result.filters.minImportAgeDays, 90);

  const cohort = buildDrilldownResult(analysis, {
    metric: "calls.unique",
    recordAgeBucket: "181-365 days"
  });
  assert.deepEqual(cohort.rows.map((item) => item.callId), ["old-new", "manual-old-new", "old-warm"]);
  assert.equal(buildDrilldownResult(analysis, { metric: "source.recordAgeAvailable" }).count, 4);
});

test("AI call assistant drill-down exposes literal detections but no handling decisions", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "ai-bail",
      Salesperson: "Bail Seller",
      transcription_text: "Outbound call Bail Seller (CWA): It's Bail. Customer: Hi, I'm a call assistant recording this call. Please say who you are and why you're calling. I'll let them know."
    }),
    row({
      call_id: "ai-handled",
      Salesperson: "Strong Seller",
      transcription_text: "Outbound call Customer: Hi, I'm a call assistant recording this call. Please say who you are and why you're calling. Strong Seller (CWA): Hi, this is Sam from Countrywide Austral. The reason for my call is the official journal for the local area. Please ask them to call me back."
    })
  ]));

  const encounters = buildDrilldownResult(analysis, { metric: "calls.aiVoiceAssistant" });
  const bailed = buildDrilldownResult(analysis, { metric: "calls.aiVoiceAssistantBailed" });
  const handled = buildDrilldownResult(analysis, { metric: "calls.aiVoiceAssistantHandled", salesperson: "Strong Seller" });

  assert.equal(encounters.count, 2);
  assert.equal(bailed.count, 0);
  assert.equal(bailed.authorityStatus, "unavailable");
  assert.equal(handled.count, 0);
  assert.equal(handled.authorityStatus, "unavailable");
  assert.equal(encounters.rows.every((item) => item.aiVoiceAssistantHandledSuccessfully === null), true);
});

test("system audio drill-down filters literal subtypes and withholds recovery claims", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "screening",
      call_time: "09:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Voicemail: Hi, if you record your name and reason for calling, I'll see if this person is available. Please stay on the line. Screen Seller (CWA): This is Sam from Countrywide Austral calling about the official journal. Please call me back."
    }),
    row({
      call_id: "screening-future",
      call_time: "10:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Hi Sam, I got your message. Yes, send through the details. Screen Seller (CWA): Thanks, I will email it now."
    }),
    row({
      call_id: "carrier",
      call_time: "11:00:00",
      customer_id: "customer-carrier",
      AllocatedLeadID: "lead-carrier",
      Salesperson: "Carrier Seller",
      CustomerImportSource: "Facebook",
      transcription_text: "Outbound call Voicemail: The number you have called is busy."
    })
  ]));

  const all = buildDrilldownResult(analysis, { metric: "calls.systemAudio" });
  const screening = buildDrilldownResult(analysis, { metric: "calls.systemAudio.call_screening" });
  const recovered = buildDrilldownResult(analysis, { metric: "calls.systemAudioRecovered" });
  const carrier = buildDrilldownResult(analysis, { metric: "calls.systemAudio", systemAudioSubtype: "carrier_phone_system" });

  assert.equal(all.kind, "systemAudio");
  assert.equal(all.count, 2);
  assert.equal(screening.count, 1);
  assert.equal(screening.rows[0].subtypeLabel, "Call Screening / AI Assistant");
  assert.equal(screening.rows[0].handledSuccessfully, null);
  assert.equal(recovered.count, 0);
  assert.equal(recovered.authorityStatus, "unavailable");
  assert.equal(carrier.count, 1);
  assert.equal(carrier.rows[0].callId, "carrier");
});

test("retired generic transcript evaluation route cannot submit a model job", async () => {
  const fetchRequests = [];
  await withServer(csv([row({ call_id: "4" })]), async ({ baseUrl, storePath }) => {
    const response = await fetch(`${baseUrl}/api/ai/transcript-evaluation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: "4" })
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.equal(body.ok, false);
    assert.match(body.error, /retired/i);
    assert.equal(fetchRequests.length, 0);

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options) => {
      fetchRequests.push({ url, options });
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ job_id: "job-ai-4", status: "queued", links: { job: "/jobs/job-ai-4" } })
      };
    }
  });
});

test("branding logo endpoint serves the default and accepts local uploads", async () => {
  await withServer(csv([row({ call_id: "5" })]), async ({ baseUrl }) => {
    const defaultLogo = await fetch(`${baseUrl}/branding/logo`);
    assert.equal(defaultLogo.status, 200);
    assert.equal(defaultLogo.headers.get("content-type"), "image/png");

    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lX4ZKAAAAABJRU5ErkJggg==";
    const upload = await fetch(`${baseUrl}/api/branding/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${tinyPng}` })
    });
    const uploadBody = await upload.json();
    assert.equal(upload.status, 201);
    assert.equal(uploadBody.ok, true);

    const customLogo = await fetch(`${baseUrl}/branding/logo`);
    assert.equal(customLogo.status, 200);
    assert.equal(customLogo.headers.get("content-type"), "image/png");
    assert.equal((await customLogo.arrayBuffer()).byteLength, Buffer.from(tinyPng, "base64").length);
  });
});

test("dashboard parks configured allocation data outside active summary and navigation", async () => {
  const allocationDir = fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-allocation-"));
  const allocationPath = path.join(allocationDir, "allocations.csv");
  fs.writeFileSync(
    allocationPath,
    [
      "LEAD CAMPAIGN,QTY ALLOCATED,QTY ACTIONED,QTY REMAINING,DATE,SALES MANAGER,SALESPERSON,TYPE",
      "Fresh Leads,10,3,7,\"Jul 1, 2026\",Manager One,Riley Example,New Business"
    ].join("\n"),
    "utf8"
  );

  await withServer(csv([row({ call_id: "allocation-parked" })]), async ({ baseUrl }) => {
    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.allocationCoverage, undefined);
    assert.equal(summary.parkedAllocation, undefined);
    assert.equal(summary.activeDataSources.allocationImports, false);

    const allocations = await fetch(`${baseUrl}/api/allocations`).then((response) => response.json());
    assert.equal(allocations.status, "parked");
    assert.equal(allocations.excludedFromActiveAnalytics, true);
    assert.equal(allocations.activeMetricsAvailable, false);
    assert.equal(allocations.configured, true);
    assert.equal("totals" in allocations, false);
    assert.equal("campaignRows" in allocations, false);
    assert.equal("reconciliationRows" in allocations, false);

    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.allocations_loaded, false);
    assert.equal(health.allocation_active_metrics_available, false);

    const html = await fetch(baseUrl).then((response) => response.text());
    const literalActivityHtml = await fetch(`${baseUrl}/?view=follow_up`).then((response) => response.text());
    assert.doesNotMatch(html, /href="#allocations"/);
    assert.doesNotMatch(html, /Lead Allocation Coverage|Leads allocated|Leads remaining|QTY ACTIONED|Observed vs actioned|stable lead-days/i);
    assert.match(literalActivityHtml, /Literal No-Contact Activity/);
    assert.match(literalActivityHtml, /not a performance judgement/i);
    assert.match(literalActivityHtml, /do not measure[\s\S]*under-utilisation/i);
    assert.doesNotMatch(literalActivityHtml, /Potential lead under-utilisation/i);
  }, { allocationPath });
});

test("dashboard renders active dataset banner and call-data window warnings", async () => {
  await withServer(csv([
    row({ call_id: "dataset-1", call_date: "1/07/2026", call_time: "09:00:00" }),
    row({ call_id: "dataset-1", call_date: "1/07/2026", call_time: "09:05:00" })
  ]), async ({ baseUrl }) => {
    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    const html = await fetch(baseUrl).then((response) => response.text());

    assert.match(html, /Active Dataset/);
    assert.match(html, new RegExp(summary.persistence.currentImportId));
    assert.match(html, /sample\.csv/);
    assert.match(html, new RegExp(summary.inputHash.slice(0, 12)));
    assert.match(html, /Imported rows[\s\S]*2/);
    assert.match(html, /Deduplicated calls[\s\S]*1/);
    assert.match(html, /Duplicate rows ignored[\s\S]*1/);
    assert.match(html, /Active range[\s\S]*01\/07\/2026 09:00:00 AEST to 01\/07\/2026 09:00:00 AEST/);
    assert.match(html, /Source call time \(AEST\)/);
    assert.match(html, /Last processed[\s\S]*AEST/);
    assert.match(html, /Active call data only/);
    assert.match(html, /single source call date/i);
    assert.match(html, /only part of a source day/i);
    assert.match(html, /Trend alerts and comparisons need more history/i);
    assert.doesNotMatch(html, /Follow-up overdue status may be indeterminate/i);
    assert.match(html, /does not contain reliable confirmed sales, revenue, order value, close date, or true conversion outcome/i);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation reconciliation|stable lead-days|allocated-versus-called|campaign\/allocation|allocation coverage/i);
  });
});

test("dashboard labels intelligence provenance confidence evidence and manager review state", async () => {
  await withServer(csv([
    row({ call_id: "proof", NoSaleType: "Did Not Answer" }),
    row({
      call_id: "no-evidence",
      transcription_text: "",
      CallTotalSeconds: "0",
      call_duration_seconds: "0",
      NoSaleType: ""
    })
  ]), async ({ baseUrl, storePath }) => {
    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    let html = await fetch(baseUrl).then((response) => response.text());

    assert.match(html, /Intelligence Provenance/);
    assert.match(html, /Deterministic/);
    assert.match(html, /Historical model outputs are excluded/i);
    assert.match(html, /Local-model operations[\s\S]*Disabled/);
    assert.match(html, /Semantic transcript decisions[\s\S]*Unavailable/);
    assert.doesNotMatch(html, /Raw NoSaleType|Baz_DetailedNotes/);
    assert.match(html, /Derived outcome/);
    assert.match(html, /Evidence unavailable/);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation reconciliation|stable lead-days|allocated-versus-called|campaign\/allocation|allocation coverage/i);

    const notRequestedHtml = await fetch(`${baseUrl}/?intelligenceQueue=llm_completed&llmStatus=not_requested&callIds=proof`).then((response) => response.text());
    assert.doesNotMatch(notRequestedHtml, /LLM-reviewed/);

    const reviewForm = new URLSearchParams({
      callId: "proof",
      importId: summary.persistence.currentImportId,
      status: "confirmed",
      confirmedOutcome: "callback_requested",
      notes: "Manager confirmed the deterministic signal."
    });
    const reviewResponse = await fetch(`${baseUrl}/reviews`, {
      method: "POST",
      body: reviewForm,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(reviewResponse.status, 303);

    const callHtml = await fetch(`${baseUrl}/calls/proof`).then((response) => response.text());
    assert.match(callHtml, /Manager review state[\s\S]*Manager-reviewed/);
    assert.doesNotMatch(callHtml, /Raw imported NoSaleType|Baz_DetailedNotes/);
    assert.match(callHtml, /Literal terminal state[\s\S]*Restricted literal rule/);

    saveLlmIntelligenceResult({
      storePath,
      importId: summary.persistence.currentImportId,
      callId: "proof",
      jobId: "job-proof-llm",
      result: {
        job: {
          output: JSON.stringify({
            call_summary: {
              decision_maker_status: "reached",
              customer_sentiment: "interested",
              brief_reason: "Customer requested a callback.",
              confidence: 0.91
            },
            entities: [],
            events: [
              {
                event_type: "customer_requested_callback",
                speaker: "customer",
                raw_value: "call me back",
                follow_up_required: true,
                evidence: "Please call me back later today.",
                confidence: 0.92
              }
            ],
            risk_flags: []
          })
        }
      }
    });

    html = await fetch(`${baseUrl}/?intelligenceQueue=llm_completed&llmStatus=completed`).then((response) => response.text());
    const intelligenceQueueHtml = html.slice(
      html.indexOf('id="intelligence-queue"'),
      html.indexOf('id="lead-utilization"') > 0 ? html.indexOf('id="lead-utilization"') : html.length
    );
    assert.match(html, /Local-model operations[\s\S]*Disabled/);
    assert.doesNotMatch(html, /LLM-reviewed|91%/);
    assert.doesNotMatch(intelligenceQueueHtml, /Customer requested a callback/);
  });
});

test("dashboard global filters keep summary drill-down explorer and alert counts consistent", async () => {
  await withServer(csv([
    row({
      call_id: "filter-a",
      Salesperson: "Seller A",
      customer_id: "customer-a",
      ContactId: "contact-a",
      call_time: "09:00:00",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Voicemail: You have reached the office. Please leave a message.",
      NoSaleType: "Did Not Answer"
    }),
    row({
      call_id: "filter-b",
      Salesperson: "Seller B",
      customer_id: "customer-b",
      ContactId: "contact-b",
      call_time: "10:00:00",
      CustomerImportSource: "Referral",
      transcription_text: "",
      CallTotalSeconds: "0",
      ring_time_seconds: "0",
      call_duration_seconds: "0",
      NoSaleType: ""
    }),
    row({
      call_id: "filter-c",
      Salesperson: "Seller A",
      customer_id: "customer-c",
      ContactId: "contact-c",
      call_time: "11:00:00",
      CustomerImportSource: "Referral",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    })
  ]), async ({ baseUrl }) => {
    const sellerQuery = `salesperson=${encodeURIComponent("Seller A")}`;
    const summary = await fetch(`${baseUrl}/api/summary?${sellerQuery}`).then((response) => response.json());
    assert.equal(summary.totals.uniqueCalls, 2);
    assert.equal(summary.datasetTotals.uniqueCalls, 3);
    assert.equal(summary.filterSummary.totalRecords, 3);
    assert.equal(summary.filterSummary.filteredRecords, 2);
    assert.equal(summary.filterSummary.excludedRecords, 1);
    assert.equal(summary.filterSummary.warnings[0].code, "very_low_sample");
    assert.deepEqual(summary.salespersonScorecards.map((item) => item.name), ["Seller A"]);
    assert.equal(summary.sourceQuality.totals.calls, 2);
    assert.equal(summary.alerts.length, 1);
    assert.equal(summary.alerts[0].callId, "filter-c");

    const calls = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique&${sellerQuery}`).then((response) => response.json());
    assert.equal(calls.count, summary.totals.uniqueCalls);
    assert.equal(calls.filterSummary.filteredRecords, 2);
    assert.deepEqual(calls.rows.map((item) => item.callId).sort(), ["filter-a", "filter-c"]);

    const risk = await fetch(`${baseUrl}/api/drilldown?metric=calls.riskReviews&${sellerQuery}`).then((response) => response.json());
    assert.equal(risk.count, summary.totals.riskReviews);
    assert.deepEqual(risk.rows.map((item) => item.callId), ["filter-c"]);

    const criticalSummary = await fetch(`${baseUrl}/api/summary?alertSeverity=critical`).then((response) => response.json());
    assert.equal(criticalSummary.totals.uniqueCalls, 1);
    assert.equal(criticalSummary.alerts.length, 1);
    assert.equal(criticalSummary.alerts[0].callId, "filter-c");

    const criticalDrilldown = await fetch(`${baseUrl}/api/drilldown?metric=alerts.critical&alertSeverity=critical`).then((response) => response.json());
    assert.equal(criticalDrilldown.count, criticalSummary.alerts.length);
    assert.equal(criticalDrilldown.rows[0].callId, "filter-c");

    const html = await fetch(`${baseUrl}/?${sellerQuery}`).then((response) => response.text());
    assert.match(html, /Global Filters/);
    assert.match(html, /Filtered calls[\s\S]*2/);
    assert.match(html, /Total calls[\s\S]*3/);
    assert.match(html, /Records excluded[\s\S]*1/);
    assert.match(html, /Salesperson[\s\S]*Seller A/);
    assert.match(html, /Very low sample size; rates may be unstable/);
    assert.match(html, /Activity rates use filtered deduplicated calls/);
    assert.doesNotMatch(html, /Raw NoSaleType|Baz_DetailedNotes/);
    assert.match(html, /Derived outcome/);
    assert.match(html, /href="\/drilldown\?(?=[^"]*metric=calls\.unique)(?=[^"]*salesperson=Seller(?:%20|\+)A)[^"]*"/);
    assert.doesNotMatch(html, /Seller B/);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation reconciliation|stable lead-days|allocated-versus-called|campaign\/allocation|allocation coverage/i);
  });
});

test("alert lifecycle API updates active counts, notes, history, and bulk-selected alerts", async () => {
  await withServer(csv([
    row({
      call_id: "alert-a",
      customer_id: "customer-a",
      ContactId: "contact-a",
      Salesperson: "Seller A",
      transcription_text: "Outbound call Customer: Please do not call me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    }),
    row({
      call_id: "alert-b",
      customer_id: "customer-b",
      ContactId: "contact-b",
      Salesperson: "Seller B",
      transcription_text: "Outbound call Customer: Remove me from your call list and do not contact me again. Agent: I understand.",
      NoSaleType: "Not Interested"
    })
  ]), async ({ baseUrl }) => {
    const initial = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.ok(initial.alerts.length >= 2);
    assert.equal(initial.alerts.every((alert) => alert.status === "new"), true);
    const initialActive = initial.alertLifecycleSummary.active;
    const first = initial.alerts[0];
    const second = initial.alerts.find((alert) => alert.id !== first.id);
    assert.ok(first.id);
    assert.ok(second.id);

    const acknowledged = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acknowledge", actor: "manager-a", note: "Review started." })
    }).then((response) => response.json());
    assert.equal(acknowledged.ok, true);
    assert.equal(acknowledged.alert.status, "acknowledged");
    assert.equal(acknowledged.alert.acknowledgedBy, "local_manager");
    assert.equal(acknowledged.alert.lifecycleHistory.at(-1).actor, "local_manager");
    assert.match(acknowledged.alert.managerNotes, /Review started/);

    let summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.alertLifecycleSummary.active, initialActive);
    assert.equal(summary.alerts.find((alert) => alert.id === first.id).status, "acknowledged");

    const inProgress = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "in_progress", actor: "manager-b" })
    }).then((response) => response.json());
    assert.equal(inProgress.alert.status, "in_progress");
    assert.equal(inProgress.alert.inProgressBy, "local_manager");
    summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.alertLifecycleSummary.active, initialActive);

    const resolved = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", actor: "manager-c", note: "Handled." })
    }).then((response) => response.json());
    assert.equal(resolved.alert.status, "resolved");
    assert.equal(resolved.alert.resolvedBy, "local_manager");
    summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.alertLifecycleSummary.active, initialActive - 1);
    assert.equal(summary.alerts.some((alert) => alert.id === first.id), false);

    const resolvedSummary = await fetch(`${baseUrl}/api/summary?alertStatus=resolved`).then((response) => response.json());
    assert.equal(resolvedSummary.alerts.some((alert) => alert.id === first.id && alert.status === "resolved"), true);
    const resolvedAlerts = await fetch(`${baseUrl}/api/alerts?alertStatus=resolved`).then((response) => response.json());
    assert.equal(resolvedAlerts.alerts.some((alert) => alert.id === first.id), true);

    const reopened = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", actor: "manager-d", note: "Needs more work." })
    }).then((response) => response.json());
    assert.equal(reopened.alert.status, "new");
    assert.equal(reopened.alert.reopenedBy, "local_manager");

    const falsePositive = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "false_positive", actor: "manager-e", note: "Rule too broad." })
    }).then((response) => response.json());
    assert.equal(falsePositive.alert.status, "false_positive");
    assert.equal(falsePositive.alert.falsePositiveBy, "local_manager");
    summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.alertLifecycleSummary.active, initialActive - 1);

    const history = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}/history`).then((response) => response.json());
    assert.equal(history.ok, true);
    assert.ok(history.lifecycleHistory.length >= 5);
    assert.equal(history.lifecycleHistory.every((entry) => entry.actor === "local_manager"), true);
    assert.match(history.managerNotes, /Rule too broad/);

    const invalid = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(first.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "not_valid" })
    });
    assert.equal(invalid.status, 400);

    const bulk = await fetch(`${baseUrl}/api/alerts/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertIds: [second.id], action: "dismiss", actor: "manager-bulk", note: "Selected only." })
    }).then((response) => response.json());
    assert.equal(bulk.ok, true);
    assert.deepEqual(bulk.alerts.map((alert) => alert.id), [second.id]);
    assert.equal(bulk.alerts[0].dismissedBy, "local_manager");

    const dismissedSummary = await fetch(`${baseUrl}/api/summary?alertStatus=dismissed`).then((response) => response.json());
    assert.equal(dismissedSummary.alerts.some((alert) => alert.id === second.id && alert.status === "dismissed"), true);
    const falsePositiveSummary = await fetch(`${baseUrl}/api/summary?alertStatus=false_positive`).then((response) => response.json());
    assert.equal(falsePositiveSummary.alerts.some((alert) => alert.id === first.id), true);

    const form = new URLSearchParams();
    form.set("alertId", second.id);
    form.set("action", "reopen");
    form.set("actor", "spoofed-form-manager");
    form.set("note", "Form path reopened.");
    form.set("returnTo", "/#alerts");
    const formResponse = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual"
    });
    assert.equal(formResponse.status, 303);
    const secondHistory = await fetch(`${baseUrl}/api/alerts/${encodeURIComponent(second.id)}/history`).then((response) => response.json());
    assert.equal(secondHistory.lifecycleHistory.at(-1).action, "reopen");
    assert.equal(secondHistory.lifecycleHistory.at(-1).actor, "local_manager");

    const noteForm = new URLSearchParams();
    noteForm.set("alertId", first.id);
    noteForm.set("action", "note");
    noteForm.set("actor", "spoofed-note-manager");
    noteForm.set("note", "<script>alert(1)</script>");
    noteForm.set("returnTo", "/?alertStatus=false_positive#alerts");
    const noteResponse = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: noteForm,
      redirect: "manual"
    });
    assert.equal(noteResponse.status, 303);

    const html = await fetch(`${baseUrl}/?alertStatus=false_positive`).then((response) => response.text());
    assert.match(html, /Alert Centre/);
    assert.match(html, /Likely false positive/);
    assert.match(html, /Rule too broad/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /Parked allocation-related alerts are excluded/);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation reconciliation|stable lead-days|allocated-versus-called|campaign allocation|allocation coverage/i);
  });
});

test("manager review governance API and UI preserve provenance and stay separate from alerts", async () => {
  await withServer(csv([
    row({
      call_id: "review-call",
      customer_id: "customer-review",
      NoSaleType: "Not Interested",
      transcription_text: "Outbound call Customer: This is a complaint and please do not call me again. Agent: I understand."
    }),
    row({
      call_id: "review-other",
      customer_id: "customer-other",
      NoSaleType: "NULL",
      transcription_text: "Outbound call Customer: Please email the information. Agent: I will send it."
    })
  ]), async ({ baseUrl, storePath }) => {
    const initialSummary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    const initialActiveAlerts = initialSummary.alertLifecycleSummary.active;
    const alert = initialSummary.alerts.find((item) => item.callId === "review-call");
    assert.ok(alert);

    const created = await fetch(`${baseUrl}/api/manager-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: "review-call",
        alertId: alert.id,
        action: "correct",
        reviewScope: "outcome",
        actor: "CEO",
        updatedBy: "admin",
        fieldName: "local_outcome_category",
        rawValue: "Not Interested",
        deterministicValue: "opt_out_or_compliance",
        previousDisplayValue: "opt_out_or_compliance",
        managerCorrectedValue: "complaint_opt_out_confirmed",
        correctionReason: "Manager confirmed complaint and opt-out.",
        evidenceAssessment: "evidence_accepted",
        note: "<script>alert(\"x\")</script>"
      })
    }).then((response) => response.json());

    assert.equal(created.ok, true);
    assert.equal(created.review.reviewStatus, "reviewed_corrected");
    assert.equal(created.review.reviewedBy, "local_manager");
    assert.equal(created.review.alertId, alert.id);
    assert.equal(created.review.corrections[0].previousDisplayValue, "opt_out_or_compliance");

    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.alertLifecycleSummary.active, initialActiveAlerts);
    assert.equal(summary.managerReviewGovernance.correctedCalls, 1);
    const drilldown = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique`).then((response) => response.json());
    assert.equal(drilldown.rows.find((row) => row.callId === "review-call").managerCorrectedOutcome, "complaint_opt_out_confirmed");
    assert.equal(drilldown.rows.find((row) => row.callId === "review-call").importedNoSaleRaw, undefined);

    const filtered = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique&managerReviewStatus=reviewed_corrected`).then((response) => response.json());
    assert.deepEqual(filtered.rows.map((row) => row.callId), ["review-call"]);
    const filteredSummary = await fetch(`${baseUrl}/api/summary?managerReviewStatus=reviewed_corrected`).then((response) => response.json());
    assert.equal(filteredSummary.managerReviewGovernance.correctedCalls, 1);

    const callReviews = await fetch(`${baseUrl}/api/calls/review-call/reviews`).then((response) => response.json());
    assert.equal(callReviews.reviews.length, 1);
    assert.equal(callReviews.reviews[0].reviewHistory[0].actor, "local_manager");

    const history = await fetch(`${baseUrl}/api/manager-reviews/${encodeURIComponent(created.review.reviewId)}/history`).then((response) => response.json());
    assert.equal(history.ok, true);
    assert.equal(history.reviewHistory[0].actor, "local_manager");

    const callHtml = await fetch(`${baseUrl}/calls/review-call`).then((response) => response.text());
    assert.match(callHtml, /Reviewed corrected/);
    assert.match(callHtml, /complaint_opt_out_confirmed/);
    assert.match(callHtml, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(callHtml, /<script>alert/);
    assert.doesNotMatch(callHtml, /Raw imported NoSaleType|Baz_DetailedNotes/);
    assert.match(callHtml, /Literal terminal state/);

    const dashboardHtml = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(dashboardHtml, /Manager-corrected/);
    assert.match(callHtml, /Manager review is separate from alert lifecycle/);

    const store = readStore({ storePath });
    assert.equal(store.managerReviews.length, 1);
    assert.equal(store.managerReviews[0].reviewedBy, "local_manager");
  });
});

test("report APIs and library hide parked or stale historical reports by default", async () => {
  await withServer(csv([
    row({ call_id: "report-a" })
  ]), async ({ baseUrl, storePath }) => {
    const reportsToSave = [
      {
        id: "active_report",
        title: "Raw Call Field Context",
        type: "field_context",
        summary: "AllocatedLeadID is preserved as a raw call CSV matching field.",
        content: "# Raw Call Field Context\n\nAllocatedLeadID remains raw entity context only."
      },
      {
        id: "stale_stable_target_report",
        title: "Average Calls Per Stable Target By Salesperson",
        type: "salesperson_repeat_call_report",
        summary: "Team average per stable target.",
        content: "# Average Calls Per Stable Target By Salesperson\n\nstable lead-days were reviewed."
      },
      {
        id: "stale_allocation_report",
        title: "Lead Allocation Coverage",
        type: "allocation_report",
        summary: "Leads allocated and leads remaining.",
        content: "# Lead Allocation Coverage\n\nQTY ACTIONED rows."
      }
    ];

    for (const report of reportsToSave) {
      const response = await fetch(`${baseUrl}/api/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report)
      });
      assert.equal(response.status, 201);
      const saved = await response.json();
      if (report.id === "active_report") {
        assert.equal(saved.report.id, "active_report");
        assert.equal(saved.reportHidden, false);
      } else {
        assert.equal(saved.report, null);
        assert.equal(saved.reportHidden, true);
      }
    }

    const reports = await fetch(`${baseUrl}/api/reports`).then((response) => response.json());
    const reportIds = reports.reports.map((report) => report.id);
    assert.ok(reportIds.includes("active_report"));
    assert.equal(reportIds.includes("stale_stable_target_report"), false);
    assert.equal(reportIds.includes("stale_allocation_report"), false);
    assert.ok(reports.hiddenReports >= 2);

    const activeDetail = await fetch(`${baseUrl}/api/reports/active_report`).then((response) => response.json());
    assert.equal(activeDetail.report.id, "active_report");
    assert.match(activeDetail.report.content, /AllocatedLeadID/);

    const staleDetail = await fetch(`${baseUrl}/api/reports/stale_stable_target_report`);
    assert.equal(staleDetail.status, 404);
    const staleViewer = await fetch(`${baseUrl}/reports/stale_stable_target_report`);
    assert.equal(staleViewer.status, 404);
    const staleViewerHtml = await staleViewer.text();
    assert.doesNotMatch(staleViewerHtml, /Average Calls Per Stable Target/);

    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(html, /Raw Call Field Context/);
    assert.doesNotMatch(html, /Average Calls Per Stable Target|Lead Allocation Coverage|QTY ACTIONED|stable lead-days/i);

    const store = readStore({ storePath });
    assert.ok(store.reports.some((report) => report.id === "stale_stable_target_report"));
    assert.ok(store.reports.some((report) => report.id === "stale_allocation_report"));
  });
});

test("dashboard date and missing-value filters use source call dates and explicit buckets", async () => {
  await withServer(csv([
    row({
      call_id: "early",
      call_date: "1/07/2026",
      call_time: "00:30:00",
      CustomerImportSource: "GoogleMaps"
    }),
    row({
      call_id: "missing-source",
      call_date: "1/07/2026",
      call_time: "23:30:00",
      CustomerImportSource: "",
      Baz_DetailedNotes: "",
      NoSaleType: "",
      transcription_text: "",
      CallTotalSeconds: "0",
      ring_time_seconds: "0",
      call_duration_seconds: "0"
    }),
    row({
      call_id: "next-day",
      call_date: "2/07/2026",
      call_time: "01:00:00",
      CustomerImportSource: "Referral"
    })
  ]), async ({ baseUrl }) => {
    const query = "dateFrom=2026-07-01&dateTo=2026-07-01&customerImportSource=Not%20supplied";
    const summary = await fetch(`${baseUrl}/api/summary?${query}`).then((response) => response.json());
    assert.equal(summary.totals.uniqueCalls, 1);
    assert.equal(summary.filterSummary.filteredRecords, 1);
    assert.equal(summary.dateRange.sourceStart, "01/07/2026 23:30:00 AEST");
    assert.equal(summary.dateRange.sourceEnd, "01/07/2026 23:30:00 AEST");
    assert.equal(summary.dateRange.sourceTimezoneLabel, "Source call time (AEST)");
    assert.ok(summary.filterSummary.activeFilters.some((entry) => entry.key === "customerImportSource" && entry.display === "Not supplied"));
    assert.ok(summary.dataWindow.warnings.some((warning) => warning.code === "single_day_dataset"));
    assert.ok(summary.dataWindow.warnings.some((warning) => warning.code === "partial_day_dataset"));

    const proof = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique&${query}`).then((response) => response.json());
    assert.equal(proof.count, 1);
    assert.equal(proof.rows[0].callId, "missing-source");

    const html = await fetch(`${baseUrl}/?${query}`).then((response) => response.text());
    assert.match(html, /Source call time \(AEST\)/);
    assert.match(html, /01\/07\/2026 23:30:00 AEST/);
    assert.match(html, /Not supplied/);
    assert.doesNotMatch(html, /Raw NoSaleType missing|Baz notes/);
    assert.doesNotMatch(html, /2026-06-30|2026-07-02|30\/06\/2026|(?:^|[^0-9])2\/07\/2026/);
  });
});

test("dashboard empty filter results show a clear empty state and reset path", async () => {
  await withServer(csv([
    row({ call_id: "only-call", Salesperson: "Seller A" })
  ]), async ({ baseUrl }) => {
    const summary = await fetch(`${baseUrl}/api/summary?salesperson=Missing%20Seller`).then((response) => response.json());
    assert.equal(summary.totals.uniqueCalls, 0);
    assert.equal(summary.filterSummary.filteredRecords, 0);
    assert.equal(summary.filterSummary.warnings[0].code, "empty_filter_result");

    const proof = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique&salesperson=Missing%20Seller`).then((response) => response.json());
    assert.equal(proof.count, 0);

    const html = await fetch(`${baseUrl}/?salesperson=Missing%20Seller`).then((response) => response.text());
    assert.match(html, /No calls match the selected filters/);
    assert.match(html, /Clear filters/);
    assert.match(html, /filtered-no-data-body/);
    assert.match(html, /href="\/#filters"/);

    const reset = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(reset.totals.uniqueCalls, 1);
    assert.equal(reset.filterSummary.filteredRecords, 1);
  });
});

test("dashboard workspaces focus manager workflows and preserve filter context", async () => {
  await withServer(csv([
    row({
      call_id: "workspace-call",
      Salesperson: "Workspace Seller",
      customer_id: "workspace-customer",
      ContactId: "workspace-contact",
      CustomerImportSource: "Referral",
      transcription_text: "Outbound call Customer: Please call me back tomorrow. Agent: I will follow up tomorrow.",
      NoSaleType: ""
    })
  ]), async ({ baseUrl }) => {
    const overview = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(overview, /data-dashboard-view="overview"/);
    assert.match(overview, /What Needs Attention/);
    assert.match(overview, /Sales Dashboard workspaces/);
    assert.match(overview, /Evaluation Studio/);

    const followUp = await fetch(`${baseUrl}/?view=follow_up&salesperson=${encodeURIComponent("Workspace Seller")}`).then((response) => response.text());
    assert.match(followUp, /data-dashboard-view="follow_up"/);
    assert.match(followUp, /Literal No-Contact Activity/);
    assert.match(followUp, /name="view" value="follow_up"/);
    assert.match(followUp, /href="\/\?view=follow_up#filters"/);
    assert.match(followUp, /salesperson=Workspace(?:%20|\+)Seller/);
    assert.doesNotMatch(followUp, /Callback opportunities|Lead Harvest Queue/);

    const retiredHarvest = await fetch(`${baseUrl}/?view=harvest`).then((response) => response.text());
    assert.match(retiredHarvest, /data-dashboard-view="overview"/);

    const records = await fetch(`${baseUrl}/?view=records`).then((response) => response.text());
    assert.match(records, /data-dashboard-view="records"/);
    assert.match(records, /Records &amp; Reports/);
    assert.match(records, /id="explorer"/);

    const studio = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(studio, /Evaluation Studio sections/);
    assert.match(studio, /href="#knowledgebase"/);
    assert.match(studio, /href="#runs"/);
    assert.doesNotMatch(studio, /class="studio-create"|Save as draft|Include in evaluations/);
    assert.match(studio, /No model evaluation is available/);
  });
});

test("lead drill-down returns lead-day records behind single-attempt no-contact metrics", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "2",
      AllocatedLeadID: "lead-no-contact",
      customer_id: "customer-no-contact",
      ContactId: "contact-no-contact",
      call_duration_seconds: "10",
      CallTotalSeconds: "12",
      transcription_text: "Outbound call Voicemail: You have reached the office. Please leave a message."
    })
  ]));
  const result = buildDrilldownResult(analysis, { metric: "lead.singleAttemptNoContact" });

  assert.equal(result.kind, "lead");
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].primaryCallId, "2");
  assert.deepEqual(result.rows[0].callIds, ["2"]);
});

test("lead reattempt drill-down returns customer anchors and exact call proof", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "a1",
      call_time: "09:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a2",
      call_time: "10:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a3",
      call_time: "09:30:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller A",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      OrderCount: "0"
    }),
    row({
      call_id: "b1",
      call_time: "11:00:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller B",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      transcription_text: "Outbound call Customer: Sorry, you have got the wrong number. Agent: No worries, thanks for letting me know.",
      OrderCount: "0"
    }),
    row({
      call_id: "b2",
      call_time: "12:00:00",
      customer_id: "customer-warm",
      AllocatedLeadID: "lead-warm",
      ContactId: "contact-warm",
      Salesperson: "Seller B",
      CustomerImportSource: "Referral",
      CallRegion: "QLD",
      transcription_text: "[No answer]",
      call_duration_seconds: "0",
      OrderCount: "2"
    })
  ]));

  const retried = buildDrilldownResult(analysis, {
    metric: "reattempt.personalRetried",
    salesperson: "Seller A"
  });
  assert.equal(retried.kind, "reattempt");
  assert.equal(retried.count, 1);
  assert.equal(retried.rows[0].customerId, "customer-retried");
  assert.deepEqual(retried.rows[0].callIds, ["a1", "a2"]);

  const oneAndDone = buildDrilldownResult(analysis, {
    metric: "reattempt.oneAndDone",
    salesperson: "Seller A",
    source: "GoogleMaps",
    region: "VIC"
  });
  assert.equal(oneAndDone.count, 1);
  assert.equal(oneAndDone.rows[0].customerId, "customer-later");
  assert.deepEqual(oneAndDone.rows[0].laterCallIdsByAnyone, ["b1"]);
  assert.equal(oneAndDone.rows[0].noLaterCallByAnyone, false);
  assert.equal(oneAndDone.rows[0].oneDialBucket, "needs_review");

  const validOneDial = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialValidOutcome",
    salesperson: "Seller B"
  });
  assert.equal(validOneDial.count, 1);
  assert.equal(validOneDial.rows[0].customerId, "customer-later");
  assert.equal(validOneDial.rows[0].oneDialBucketLabel, "Literal terminal one-dial state");

  const retiredRiskyOneDial = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialRiskyNoContact",
    salesperson: "Seller B"
  });
  assert.equal(retiredRiskyOneDial.count, 0);
  assert.equal(retiredRiskyOneDial.authorityStatus, "unavailable");

  const oneDialNoContactNoLater = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialLiteralNoContactNoLater",
    salesperson: "Seller B"
  });
  assert.equal(oneDialNoContactNoLater.title, "Literal One-Dial No-Contact With No Later Match");
  assert.equal(oneDialNoContactNoLater.count, 1);
  assert.equal(oneDialNoContactNoLater.rows[0].customerId, "customer-warm");
  assert.equal(oneDialNoContactNoLater.rows[0].noLaterCallByAnyone, true);

  const needsReviewOneDial = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialNeedsReview",
    salesperson: "Seller A"
  });
  assert.equal(needsReviewOneDial.title, "One-Dial Records Without A Validated Literal State");
  assert.equal(needsReviewOneDial.count, 1);
  assert.equal(needsReviewOneDial.rows[0].customerId, "customer-later");
  assert.match(needsReviewOneDial.rows[0].oneDialReason, /semantic meaning is not evaluated/i);

  const noLater = buildDrilldownResult(analysis, {
    metric: "reattempt.noLaterCallByAnyone",
    salesperson: "Seller B"
  });
  assert.equal(noLater.count, 2);
  assert.deepEqual(noLater.rows.map((item) => item.customerId).sort(), ["customer-later", "customer-warm"]);

  const warmOnly = buildDrilldownResult(analysis, {
    metric: "reattempt.leadsTouched",
    businessSegment: "warm"
  });
  assert.equal(warmOnly.count, 1);
  assert.equal(warmOnly.rows[0].customerId, "customer-warm");
  assert.equal(warmOnly.filters.businessSegmentLabel, "Warm Business");

  const sellerMax = buildDrilldownResult(analysis, {
    metric: "reattempt.maxAttemptsOnOneLead",
    salesperson: "Seller B",
    maxAttempts: "1"
  });
  assert.equal(sellerMax.count, 2);
  assert.equal(sellerMax.filters.maxAttempts, 1);
});

test("drill-down supports pagination across proof rows", () => {
  const analysis = analyzeCsvText(csv([
    row({ call_id: "10", AllocatedLeadID: "lead-10", customer_id: "customer-10", ContactId: "contact-10" }),
    row({ call_id: "11", AllocatedLeadID: "lead-11", customer_id: "customer-11", ContactId: "contact-11" }),
    row({ call_id: "12", AllocatedLeadID: "lead-12", customer_id: "customer-12", ContactId: "contact-12" })
  ]));
  const result = buildDrilldownResult(analysis, { metric: "calls.unique", limit: "1", offset: "1" });

  assert.equal(result.count, 3);
  assert.equal(result.displayedCount, 1);
  assert.equal(result.previousOffset, 0);
  assert.equal(result.nextOffset, 2);
  assert.equal(result.rows[0].callId, "11");
});

test("dashboard drill-down pages expose proof links and manager review saving", async () => {
  await withServer(csv([row({ call_id: "3" })]), async ({ baseUrl, storePath }) => {
    const summary = await fetch(`${baseUrl}/api/summary`).then((response) => response.json());
    assert.equal(summary.drilldownRows, undefined);
    assert.equal(summary.businessSegmentViews.new.drilldownRows, undefined);

    const drilldownHtml = await fetch(`${baseUrl}/drilldown?metric=calls.unique`).then((response) => response.text());
    assert.match(drilldownHtml, /Unique Calls/);
    assert.match(drilldownHtml, /Customer ID/);
    assert.match(drilldownHtml, /customer-1/);
    assert.match(drilldownHtml, /\/calls\/3/);
    assert.match(drilldownHtml, /Full JSON/);
    assert.match(drilldownHtml, /Proof/);
    assert.doesNotMatch(drilldownHtml, /Callback requested or promised/);
    assert.doesNotMatch(drilldownHtml, /Follow-up signal|Callback timing|Callback status/i);
    assert.doesNotMatch(drilldownHtml, /Please call me back later today/);

    const callHtml = await fetch(`${baseUrl}/calls/3`).then((response) => response.text());
    assert.match(callHtml, /Customer ID/);
    assert.match(callHtml, /customer-1/);
    assert.match(callHtml, /Sanitized Raw Source Fields/);
    assert.doesNotMatch(callHtml, /4999999/);
    assert.match(callHtml, /Transcript Timeline/);
    assert.match(callHtml, /Detected Signals/);
    assert.match(callHtml, /Raw Transcript/);

    const form = new URLSearchParams({
      callId: "3",
      status: "incorrect",
      confirmedOutcome: "false_positive",
      notes: "Manager challenged the drill-down result."
    });
    const reviewResponse = await fetch(`${baseUrl}/reviews`, {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual"
    });
    assert.equal(reviewResponse.status, 303);

    const store = readStore({ storePath });
    assert.equal(store.managerReviews.length, 1);
    assert.equal(store.managerReviews[0].status, "reviewed_corrected");
    assert.equal(store.managerReviews[0].reviewedBy, "local_manager");
  });
});

test("dashboard renders Not available when customer id is missing", async () => {
  await withServer(csv([row({ call_id: "missing-customer", customer_id: "NULL" })]), async ({ baseUrl }) => {
    const drilldownHtml = await fetch(`${baseUrl}/drilldown?metric=calls.unique`).then((response) => response.text());
    const callHtml = await fetch(`${baseUrl}/calls/missing-customer`).then((response) => response.text());

    assert.match(drilldownHtml, /Customer ID/);
    assert.match(drilldownHtml, /Not available/);
    assert.match(drilldownHtml, /ContactId:/);
    assert.match(drilldownHtml, /contact-1/);
    assert.match(callHtml, /Customer ID/);
    assert.match(callHtml, /Not available/);
    assert.match(callHtml, /ContactId backup/);
    assert.match(callHtml, /contact-1/);
  });
});

test("dashboard business segment filter scopes visible dashboard results", async () => {
  await withServer(csv([
    row({
      call_id: "20",
      Salesperson: "New Seller",
      CustomerImportSource: "New Source",
      OrderCount: "NULL"
    }),
    row({
      call_id: "21",
      Salesperson: "Warm Seller",
      CustomerImportSource: "Warm Source",
      OrderCount: "3"
    })
  ]), async ({ baseUrl }) => {
    const warmHtml = await fetch(`${baseUrl}/?businessSegment=warm`).then((response) => response.text());

    assert.match(warmHtml, /Warm Business results only/);
    assert.match(warmHtml, /Warm Business view/);
    assert.match(warmHtml, /Warm Seller/);
    assert.match(warmHtml, /Warm Source/);
    assert.match(warmHtml, /href="\/drilldown\?metric=calls.unique&amp;businessSegment=warm"/);
    assert.doesNotMatch(warmHtml, /New Seller/);
    assert.doesNotMatch(warmHtml, /New Source/);

    const warmSourceQuality = await fetch(`${baseUrl}/api/source-quality?businessSegment=warm`).then((response) => response.json());
    assert.equal(warmSourceQuality.query.businessSegment, "warm");
    assert.equal(warmSourceQuality.totals.calls, 1);
    assert.equal(warmSourceQuality.sourceRows[0].name, "Warm Source");

    const warmAiAssistants = await fetch(`${baseUrl}/api/ai-voice-assistants?businessSegment=warm`).then((response) => response.json());
    assert.equal(warmAiAssistants.query.businessSegment, "warm");
    assert.equal(warmAiAssistants.totals.calls, 1);
  });
});

test("dashboard exposes lead reattempt tables, pattern links, and filtered API rollups", async () => {
  await withServer(csv([
    row({
      call_id: "a1",
      call_time: "09:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a2",
      call_time: "10:00:00",
      customer_id: "customer-retried",
      AllocatedLeadID: "lead-retried",
      ContactId: "contact-retried",
      Salesperson: "Seller A",
      CustomerImportSource: "Web",
      CallRegion: "NSW",
      OrderCount: "0"
    }),
    row({
      call_id: "a3",
      call_time: "09:30:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller A",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      OrderCount: "0"
    }),
    row({
      call_id: "b1",
      call_time: "11:00:00",
      customer_id: "customer-later",
      AllocatedLeadID: "lead-later",
      ContactId: "contact-later",
      Salesperson: "Seller B",
      CustomerImportSource: "GoogleMaps",
      CallRegion: "VIC",
      OrderCount: "0"
    }),
    row({
      call_id: "b2",
      call_time: "12:00:00",
      customer_id: "customer-warm",
      AllocatedLeadID: "lead-warm",
      ContactId: "contact-warm",
      Salesperson: "Seller B",
      CustomerImportSource: "Referral",
      CallRegion: "QLD",
      OrderCount: "2"
    })
  ]), async ({ baseUrl }) => {
    const html = await fetch(`${baseUrl}/?view=follow_up`).then((response) => response.text());
    assert.match(html, /Lead Reattempt Behaviour/);
    assert.match(html, /Reattempt Behaviour By Salesperson/);
    assert.match(html, /Patterns In What Gets Retried/);
    assert.match(html, /Reattempt Patterns By Source/);
    assert.match(html, /Reattempt Patterns By Region/);
    assert.match(html, /One-dial records/);
    assert.match(html, /Literal one-dial no-contact/);
    assert.match(html, /no later match/i);
    assert.match(html, /do not measure[\s\S]*under-utilisation/i);
    assert.doesNotMatch(html, /Potential lead under-utilisation/i);
    assert.doesNotMatch(html, /One-and-done|One-And-Done/i);
    assert.match(html, /metric=reattempt\.personalRetried/);
    assert.match(html, /maxAttempts=2/);

    const filtered = await fetch(`${baseUrl}/api/lead-reattempts?businessSegment=new&source=GoogleMaps`).then((response) => response.json());
    assert.equal(filtered.query.businessSegment, "new");
    assert.equal(filtered.query.source, "GoogleMaps");
    assert.equal(filtered.query.matchingRecords, 2);
    assert.equal(filtered.totals.leadsTouched, 2);
    assert.equal(filtered.totals.oneAndDoneRate, 100);
    assert.equal(filtered.sourceRows.length, 1);
    assert.equal(filtered.sourceRows[0].source, "GoogleMaps");

    const proof = await fetch(`${baseUrl}/api/drilldown?metric=reattempt.oneAndDone&source=GoogleMaps&region=VIC`).then((response) => response.json());
    assert.equal(proof.kind, "reattempt");
    assert.equal(proof.count, 2);
    assert.equal(proof.rows[0].source, "GoogleMaps");
    assert.equal(proof.rows[0].region, "VIC");
    assert.ok(proof.rows.every((item) => item.customerId === "customer-later"));
  });
});

test("dashboard retires semantic lead harvest UI, API, and proof drilldowns", async () => {
  await withServer(csv([
    row({
      call_id: "harvest-open",
      call_time: "09:00:00",
      customer_id: "customer-harvest-open",
      AllocatedLeadID: "lead-harvest-open",
      ContactId: "contact-harvest-open",
      Salesperson: "Seller A",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Yeah 100%, send the information and call me back tomorrow morning. My name is Morgan. Agent: I will send it and follow up tomorrow.",
      OrderCount: "0"
    }),
    row({
      call_id: "harvest-later",
      call_time: "10:00:00",
      customer_id: "customer-harvest-later",
      AllocatedLeadID: "lead-harvest-later",
      ContactId: "contact-harvest-later",
      Salesperson: "Seller A",
      CustomerImportSource: "Facebook",
      transcription_text: "Outbound call Customer: Sounds good, the owner Serge is back next week, call him back Monday afternoon. Agent: Perfect, I will call back then.",
      OrderCount: "0"
    }),
    row({
      call_id: "harvest-later-follow",
      call_time: "11:00:00",
      customer_id: "customer-harvest-later",
      AllocatedLeadID: "lead-harvest-later",
      ContactId: "contact-harvest-later",
      Salesperson: "Seller B",
      CustomerImportSource: "Facebook",
      transcription_text: "Outbound call Customer: Hi, I can talk about the email now. Agent: Thanks for taking the call.",
      OrderCount: "0"
    }),
    row({
      call_id: "harvest-warm",
      call_time: "12:00:00",
      customer_id: "customer-harvest-warm",
      AllocatedLeadID: "lead-harvest-warm",
      ContactId: "contact-harvest-warm",
      Salesperson: "Seller C",
      CustomerImportSource: "Referral",
      transcription_text: "Outbound call Customer: Yes please send the quote and call me back tomorrow. Agent: I will call back tomorrow.",
      OrderCount: "4"
    }),
    row({
      call_id: "harvest-terminal",
      call_time: "13:00:00",
      customer_id: "customer-harvest-terminal",
      AllocatedLeadID: "lead-harvest-terminal",
      ContactId: "contact-harvest-terminal",
      Salesperson: "Seller D",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: No thanks, not interested and do not call again. Agent: Understood.",
      OrderCount: "0"
    })
  ]), async ({ baseUrl }) => {
    const html = await fetch(`${baseUrl}/?view=overview`).then((response) => response.text());
    assert.doesNotMatch(html, /Lead Harvest Queue|Lead Harvest Evidence Queue|positive callback candidates/i);

    const apiResponse = await fetch(`${baseUrl}/api/lead-harvest?businessSegment=new&objectionType=needs_information_or_review`);
    assert.equal(apiResponse.status, 410);
    const api = await apiResponse.json();
    assert.equal(api.status, "retired");

    const queue = await fetch(`${baseUrl}/api/drilldown?metric=harvest.reviewQueue&businessSegment=new`).then((response) => response.json());
    assert.equal(queue.count, 0);
    assert.equal(queue.authorityStatus, "unavailable");

    const later = await fetch(`${baseUrl}/api/drilldown?metric=harvest.laterObserved&businessSegment=new`).then((response) => response.json());
    assert.equal(later.count, 0);
    assert.equal(later.authorityStatus, "unavailable");
  });
});

test("dashboard exposes the Evaluation Studio research archive while model operations are quarantined", async () => {
  const externalRequests = [];
  await withServer(csv([
    row({
      call_id: "studio-1",
      Salesperson: "Riley Example",
      transcription_text: "Outbound call Customer: I am interested but please call me back tomorrow. Agent: I can do that and will make a note."
    })
  ]), async ({ baseUrl, storePath }) => {
    const initial = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    assert.equal(initial.summary.activeKnowledgebaseEntries >= 1, true);
    assert.equal(initial.summary.activeTemplates >= 1, true);

    const capability = await fetch(`${baseUrl}/api/local-model-capabilities`).then((response) => response.json());
    assert.equal(capability.ok, true);
    assert.equal(capability.capabilityPolicy.liveSubmissionPermitted, false);
    assert.deepEqual(capability.capabilityPolicy.promotedCapabilityIds, []);

    const page = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(page, /No model evaluation is available/);
    assert.match(page, /Historical Model Outputs Grouped by Call/);
    assert.match(page, /research-only|research only/i);
    assert.doesNotMatch(page, /<button type="submit">Run evaluation<\/button>/);
    assert.doesNotMatch(page, /Test one transcript first/);

    const knowledgebaseResponse = await fetch(`${baseUrl}/api/evaluation-studio/knowledgebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Local Callback Standard",
        category: "callback_handling",
        content: "Capture requested timing, objection, and next action."
      })
    });
    const knowledgebase = await knowledgebaseResponse.json();
    assert.equal(knowledgebaseResponse.status, 423);
    assert.equal(knowledgebase.ok, false);
    assert.equal(knowledgebase.code, "EVALUATION_STUDIO_RESEARCH_ARCHIVE_LOCKED");

    const templateMutation = await fetch(`${baseUrl}/api/evaluation-studio/templates/template_call_intelligence_foundation_v6`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unsafe archive mutation" })
    });
    assert.equal(templateMutation.status, 423);

    const archiveReview = await fetch(`${baseUrl}/api/evaluation-studio/results/historical-result/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_review_needed" })
    });
    assert.equal(archiveReview.status, 423);

    const semanticFeedback = await fetch(`${baseUrl}/api/evaluation-studio/results/historical-result/semantic-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "incorrect" })
    });
    assert.equal(semanticFeedback.status, 423);

    const quarantineMutation = await fetch(`${baseUrl}/api/evaluation-studio/runs/historical-run/quarantine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "archive should not mutate" })
    });
    assert.equal(quarantineMutation.status, 423);

    const template = initial.evaluationTemplates.find((item) => item.evaluationGoal === "call_intelligence_foundation");
    const runResponse = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, limit: 1, submitNow: true })
    });
    const runBody = await runResponse.json();
    assert.equal(runResponse.status, 423);
    assert.equal(runBody.ok, false);
    assert.match(runBody.error, /capability|promoted|quarantin/i);

    const promptResponse = await fetch(`${baseUrl}/api/evaluation-studio/prompt-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, callId: "studio-1", submitNow: true })
    });
    assert.equal(promptResponse.status, 423);

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 0);
    assert.equal(store.evaluationStudio.knowledgebaseEntries.some((entry) => entry.title === "Local Callback Standard"), false);
    assert.equal(store.evaluationStudio.evaluationRuns.length, 0);
    assert.equal(store.evaluationStudio.evaluationResults.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("Execution Layer must not be contacted while capabilities are quarantined.");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("Evaluation Studio batch submission fails closed before jobs or network calls", async () => {
  const externalRequests = [];
  await withServer(csv([
    row({ call_id: "harvest-1", transcription_text: "Customer: Please call tomorrow. Agent: I will." }),
    row({ call_id: "harvest-2", transcription_text: "Customer: No thank you. Agent: Understood." })
  ]), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");

    const response = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, limit: "all", submitNow: true })
    });
    const body = await response.json();

    assert.equal(response.status, 423);
    assert.equal(body.ok, false);
    assert.match(body.error, /capability|promoted|quarantin/i);

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 0);
    assert.equal(store.evaluationStudio.evaluationRuns.length, 0);
    assert.equal(store.evaluationStudio.evaluationResults.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("unexpected Execution Layer request");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("Evaluation Studio one-call tests fail closed before jobs or network calls", async () => {
  const externalRequests = [];
  await withServer(csv([
    row({ call_id: "prompt-test-call", transcription_text: "Customer: Call tomorrow. Agent: I will call tomorrow." })
  ]), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");

    const response = await fetch(`${baseUrl}/api/evaluation-studio/prompt-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, callId: "prompt-test-call", submitNow: true })
    });
    const body = await response.json();

    assert.equal(response.status, 423);
    assert.equal(body.ok, false);
    assert.match(body.error, /capability|promoted|quarantin/i);

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 0);
    assert.equal(store.evaluationStudio.evaluationRuns.length, 0);
    assert.equal(store.evaluationStudio.evaluationResults.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("unexpected Execution Layer request");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("Evaluation Studio reads do not poll historical jobs while capability quarantine is active", async () => {
  const externalRequests = [];
  await withServer(csv([
    row({ call_id: "no-auto-harvest", transcription_text: "Customer: Hello. Agent: Hello." })
  ]), async ({ baseUrl }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    assert.equal(studio.autoHarvest.checkedRunCount, 0);
    assert.deepEqual(studio.autoHarvest.harvested, []);

    const progress = await fetch(`${baseUrl}/api/evaluation-studio/progress?currentOnly=true`).then((response) => response.json());
    assert.equal(progress.autoHarvest.checkedRunCount, 0);
    assert.deepEqual(progress.autoHarvest.harvested, []);

    const results = await fetch(`${baseUrl}/api/evaluation-studio/results?currentOnly=true`).then((response) => response.json());
    assert.equal(results.autoHarvest.checkedRunCount, 0);
    assert.deepEqual(results.autoHarvest.harvested, []);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("historical jobs must not be polled");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("direct Evaluation Studio result ingestion is retired and cannot forge provenance", async () => {
  await withServer(csv([
    row({ call_id: "forged-result", transcription_text: "Customer: Maybe. Agent: Thank you." })
  ]), async ({ baseUrl, storePath }) => {
    const response = await fetch(`${baseUrl}/api/evaluation-studio/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: "forged-result",
        jobId: "forged-job",
        result: {
          call_id: "forged-result",
          evaluation_goal: "offer_acceptance_classification",
          status: "usable",
          model_metadata: {
            execution_layer_verified: true,
            provider_model_digest: "forged",
            capability_register_hash: "forged"
          }
        }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.equal(body.ok, false);
    assert.match(body.error, /Direct Evaluation Studio result ingestion is retired/);

    const store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationResults.length, 0);
    assert.equal(store.aiJobs.length, 0);
  });
});

test("Foundation and specialist routing remain blocked until every exact capability is promoted", async () => {
  const externalRequests = [];
  await withServer(csv([
    row({ call_id: "foundation-route-blocked", transcription_text: "Customer: Call tomorrow. Agent: I will call tomorrow." })
  ]), async ({ baseUrl, storePath }) => {
    const recovery = await fetch(`${baseUrl}/api/evaluation-studio/specialist-recovery`).then((response) => response.json());
    assert.equal(recovery.ok, true);
    assert.equal(recovery.blocked, true);
    assert.equal(recovery.backlog.totalChecks, 0);
    assert.equal(recovery.backlog.researchInventoryExcluded, true);
    assert.equal(recovery.nextBatch, null);

    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const foundation = studio.evaluationTemplates.find((item) => item.evaluationGoal === "call_intelligence_foundation");
    const response = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: foundation.id,
        callIds: ["foundation-route-blocked"],
        submitNow: true,
        autoRouteSpecialists: true
      })
    });
    assert.equal(response.status, 423);

    const store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationRuns.length, 0);
    assert.equal(store.aiJobs.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("routing must not contact the Execution Layer");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("large Evaluation Studio requests are blocked before selection can create model work", async () => {
  const externalRequests = [];
  const calls = Array.from({ length: 101 }, (_, index) => row({
    call_id: `large-blocked-${index + 1}`,
    transcription_text: `Customer: Transcript ${index + 1}. Agent: Thank you.`
  }));
  await withServer(csv(calls), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "call_intelligence_foundation");
    const response = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: template.id, limit: 101, submitNow: true })
    });

    assert.equal(response.status, 423);
    const store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationRuns.length, 0);
    assert.equal(store.aiJobs.length, 0);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      externalRequests.push({ url, options });
      throw new Error("large quarantined request reached the Execution Layer");
    }
  });
  assert.equal(externalRequests.length, 0);
});

test("Evaluation Studio fills the requested batch from transcript-bearing calls before applying the limit", async () => {
  const calls = [
    row({ call_id: "no-transcript-oldest", call_date: "01/07/2026", call_time: "08:00:00", transcription_text: "" }),
    row({ call_id: "with-transcript-next", call_date: "01/07/2026", call_time: "08:01:00", transcription_text: "Customer: Hello. Agent: I am calling about a local community publication." })
  ];
  await withServer(csv(calls), async ({ baseUrl }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "call_intelligence_foundation");
    const preview = await fetch(`${baseUrl}/api/evaluation-studio/selection-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        evaluationState: "unevaluated",
        selectionMode: "oldest",
        limit: 1
      })
    }).then((response) => response.json());

    assert.equal(preview.matchingCalls, 1);
    assert.equal(preview.preview[0].callId, "with-transcript-next");
  });
});

test("dashboard exposes literal system-audio API without semantic recovery claims", async () => {
  await withServer(csv([
    row({
      call_id: "screening",
      call_time: "09:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Voicemail: Hi, if you record your name and reason for calling, I'll see if this person is available. Please stay on the line. Screen Seller (CWA): This is Sam from Countrywide Austral calling about the official journal. Please call me back."
    }),
    row({
      call_id: "screening-future",
      call_time: "10:00:00",
      customer_id: "customer-screening",
      AllocatedLeadID: "lead-screening",
      Salesperson: "Screen Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Hi Sam, I got your message. Yes, send through the details. Screen Seller (CWA): Thanks, I will email it now."
    }),
    row({
      call_id: "carrier",
      call_time: "11:00:00",
      customer_id: "customer-carrier",
      AllocatedLeadID: "lead-carrier",
      Salesperson: "Carrier Seller",
      CustomerImportSource: "Facebook",
      transcription_text: "Outbound call Customer: The number is busy."
    })
  ]), async ({ baseUrl }) => {
    const html = await fetch(`${baseUrl}/?view=intelligence`).then((response) => response.text());
    assert.match(html, /Restricted Literal Transcript Triage/);

    const api = await fetch(`${baseUrl}/api/system-audio?subtype=call_screening`).then((response) => response.json());
    assert.equal(api.query.subtype, "call_screening");
    assert.equal(api.totals.encounters, 1);
    assert.equal(api.records[0].futureCallId, "");
    assert.equal("recovered" in api.records[0], false);

    const proofHtml = await fetch(`${baseUrl}/drilldown?metric=calls.systemAudioRecovered`).then((response) => response.text());
    assert.match(proofHtml, /live-human recovery meaning is not evaluated/i);
    assert.doesNotMatch(proofHtml, /screening-future/);
  });
});

test("Evaluation Studio presents lead-record results as a concise decision with deduplicated evidence", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "display-result",
      transcription_text: "Customer: Please send the information to info@example.com. Agent: I will send that through."
    })
  ]));
  const repeatedEvidence = "Customer: Please send the information to info@example.com.";
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 1, activeTemplates: 0, activeKnowledgebaseEntries: 0 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      resultQuery: { matchingResults: 1, offset: 0, limit: 25 },
      evaluationResults: [{
        id: "result-display",
        callId: "display-result",
        evaluationGoal: "lead_record_disposition_evidence_audit",
        status: "usable",
        confidence: 0.86,
        evidenceAvailability: "available",
        managerSummary: "A real contact was reached and requested information by email.",
        auditAssessment: {
          recordEvidence: { classification: "no_supporting_evidence", reason: "none" },
          allegationAssessment: { assessment: "absent" },
          recommendation: "continue_normal_workflow"
        },
        findings: [
          { field: "contact_evidence", value: "customer", evidence: repeatedEvidence },
          { field: "record_evidence_classification", value: "no_supporting_evidence", evidence: repeatedEvidence },
          { field: "record_invalid_reason", value: "none", evidence: repeatedEvidence }
        ]
      }]
    }
  });

  assert.match(html, /Keep this lead active/);
  assert.match(html, /No evidence the record is invalid/);
  assert.match(html, /The call contains usable evidence, but nothing indicates that the lead record is invalid/);
  assert.match(html, /A real contact was reached and requested information by email/);
  assert.match(html, /Continue normal workflow/);
  assert.doesNotMatch(html, /<dt>Salesperson allegation<\/dt>/);
  assert.equal((html.match(/Customer: Please send the information to info@example\.com\./g) || []).length, 1);
  assert.match(html, /class="evaluation-result-card"/);
  assert.match(html, /class="evaluation-result-facts"/);
  assert.match(html, /Open transcript/);
  assert.match(html, /Evidence sufficient/);
  assert.match(html, /Historical research[^<]*not a decision/i);
  assert.match(html, /Archived model claim \(not a decision\)/);
  assert.doesNotMatch(html, /<span>Lead record decision<\/span>/);
  assert.match(html, /not a current customer outcome, score, finding, or action/i);
});

test("Evaluation Studio labels historical untyped specialists without inventing a pass or lead-record decision", () => {
  const analysis = analyzeCsvText(csv([row({
    call_id: "legacy-specialist-display",
    transcription_text: "Customer: Please call tomorrow. Agent: I will call tomorrow."
  })]));
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 1 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      resultQuery: { matchingResults: 1, offset: 0, limit: 25 },
      evaluationResults: [{
        id: "legacy-callback-result",
        callId: "legacy-specialist-display",
        evaluationGoal: "callback_opportunity",
        status: "usable",
        evidenceAvailability: "available",
        managerSummary: "Legacy callback output.",
        evaluationAudit: { validationStatus: "legacy_generic_contract" },
        findings: [{ field: "callback", value: "string", evidence: "Customer: Please call tomorrow." }]
      }]
    }
  });
  assert.match(html, /Historical untyped result/);
  assert.match(html, /Rerun with the active v2 specialist template/);
  assert.match(html, /must not be read as evaluated-clear or issue-found/);
  assert.doesNotMatch(html, /Promoted lead record decision/);
});

test("Evaluation Studio quarantines historical Offer Acceptance output without an operational rate", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "accepted-display",
      Salesperson: "Seller A",
      CustomerImportSource: "Referral",
      call_date: "16/07/2026",
      transcription_text: "Salesperson: The package is $550. Customer: Yes, please book that for us."
    })
  ]));
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 1, activeTemplates: 1, activeKnowledgebaseEntries: 0 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [{
        id: "offer-display-run",
        runType: "batch",
        templateSnapshot: { name: "Offer Acceptance (Sale Signal) Review" }
      }],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      offerAcceptanceReport: {
        totals: { classified: 1, accepted: 1, followUpOnly: 0, noSaleSignal: 0, acceptanceRate: 1 },
        bySalesperson: [{ label: "Seller A", classified: 1, accepted: 1, followUpOnly: 0, noSaleSignal: 0, acceptanceRate: 1 }],
        bySource: [{ label: "Referral", classified: 1, accepted: 1, followUpOnly: 0, noSaleSignal: 0, acceptanceRate: 1 }],
        byDate: [{ label: "16/07/2026", classified: 1, accepted: 1, followUpOnly: 0, noSaleSignal: 0, acceptanceRate: 1 }],
        latestRun: { planned: 1, classified: 1, failed: 0, failureReasons: [] }
      },
      resultQuery: { matchingResults: 1, offset: 0, limit: 25 },
      evaluationResults: [{
        id: "accepted-result",
        runId: "offer-display-run",
        callId: "accepted-display",
        evaluationGoal: "offer_acceptance_classification",
        templateVersion: 2,
        status: "usable",
        confidence: 0.95,
        evidenceAvailability: "available",
        managerSummary: "The customer explicitly accepted the presented $550 package.",
        acceptanceAssessment: {
          category: 3,
          classification: "customer_accepted_offer",
          offerPresented: true,
          customerCommitment: "explicit_unconditional_agreement",
          unresolvedCondition: false,
          offerEvidence: { quote: "The package is $550.", summary: "A $550 package was presented." },
          customerResponseEvidence: { quote: "Yes, please book that for us.", summary: "The customer asked to book the offer." }
        }
      }]
    }
  });

  const operationalReportVisible = html.includes("Offer Acceptance Performance");
  if (operationalReportVisible) {
  assert.match(html, /Offer Acceptance Performance/);
  assert.match(html, /Offer acceptance rate/);
  assert.match(html, /100\.0%/);
  assert.match(html, /Customer accepted offer/);
  assert.match(html, /Customer ID:[\s\S]*customer-1/);
  assert.match(html, /Record summary/);
  assert.match(html, /This records acceptance of the offer/);
  assert.match(html, /Offer Acceptance \(Sale Signal\) Review/);
  assert.match(html, /Batch evaluation · Template v2/);
  assert.match(html, /Seller A/);
  assert.match(html, /Referral/);
  assert.match(html, /Accepted ÷ Classified/);
  assert.match(html, /Offer acceptance result/);
  assert.match(html, /class="evaluation-result-card"/);
  assert.match(html, /evaluationGoal=offer_acceptance_classification&amp;acceptanceClassification=customer_accepted_offer/);
  assert.match(html, /salesperson=Seller\+A/);
  assert.match(html, /customerImportSource=Referral/);
  assert.match(html, /dateFrom=2026-07-16&amp;dateTo=2026-07-16/);
  assert.doesNotMatch(html, />Not Supplied</);
  assert.doesNotMatch(html, />usable</i);
  }
  assert.equal(operationalReportVisible, false);
  assert.match(html, /Operational AI reporting is unavailable/);
  assert.match(html, /Archived model claim: Customer accepted offer/);
  assert.match(html, /Historical offer acceptance classification research output/i);
  assert.match(html, /Archived model claim \(not a decision\)/);
  assert.doesNotMatch(html, /Promoted offer acceptance result/);
  assert.match(html, /Customer ID:[\s\S]*customer-1/);
  assert.match(html, /class="evaluation-result-card"/);
});

test("Foundation and Offer cards retain research claims without presenting authoritative acceptance", () => {
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "foundation-accepted-display",
      customer_id: "customer-accepted-42",
      Salesperson: "Seller B",
      transcription_text: "Salesperson: The supporter package is $550. Customer: Yes, I will pay next Wednesday."
    }),
    row({
      call_id: "foundation-no-customer-display",
      customer_id: "",
      transcription_text: "Salesperson: I can send the information. Customer: Please email it."
    })
  ]));
  const acceptedAssessment = {
    category: 3,
    classification: "customer_accepted_offer",
    offerPresented: true,
    customerCommitment: "explicit_unconditional_agreement",
    unresolvedCondition: false
  };
  const foundationAssessment = {
    calledOnBehalfOf: "ACT Emergency Service Volunteers",
    followUpTiming: "next Wednesday",
    intelligenceLenses: {
      opportunity_status: "actionable",
      measurement_eligibility: "eligible",
      efficiency_status: "efficient_progression"
    },
    specialistRoutes: { offer_acceptance_classification: true }
  };
  const html = renderEvaluationStudioPage(analysis, {
    studioView: {
      summary: { results: 3 },
      knowledgebaseEntries: [],
      evaluationTemplates: [],
      evaluationRuns: [],
      evidenceQueue: [],
      reportRollups: { totals: {}, signalRows: [], priorityExamples: [] },
      offerAcceptanceReport: { totals: {}, bySalesperson: [], bySource: [], byDate: [] },
      foundationReport: { totals: {}, rates: {}, bySalesperson: [], bySource: [], byDate: [], byCalledOnBehalfOf: [] },
      resultQuery: { matchingResults: 3, matchingCalls: 2, offset: 0, limit: 25 },
      evaluationResults: [{
        id: "foundation-accepted-result",
        callId: "foundation-accepted-display",
        evaluationGoal: "call_intelligence_foundation",
        status: "usable",
        confidence: 0.92,
        evidenceAvailability: "available",
        managerSummary: "Foundation found an actionable next step.",
        foundationAssessment,
        offerAcceptanceContext: {
          sourceResultId: "offer-result",
          acceptanceAssessment: acceptedAssessment,
          managerSummary: "The customer accepted the offer and agreed to pay next Wednesday.",
          confidence: 0.95,
          evidenceAvailability: "available",
          status: "usable"
        }
      }, {
        id: "offer-accepted-result",
        callId: "foundation-accepted-display",
        evaluationGoal: "offer_acceptance_classification",
        status: "usable",
        confidence: 0.95,
        evidenceAvailability: "available",
        managerSummary: "The customer accepted the offer and agreed to pay next Wednesday.",
        acceptanceAssessment: acceptedAssessment
      }, {
        id: "foundation-no-customer-result",
        callId: "foundation-no-customer-display",
        evaluationGoal: "call_intelligence_foundation",
        status: "usable",
        confidence: 0.8,
        evidenceAvailability: "available",
        managerSummary: "The customer requested information.",
        foundationAssessment
      }]
    }
  });

  assert.match(html, /Archived model claim: Customer accepted offer/);
  assert.doesNotMatch(html, /Authoritative Offer Acceptance|Promoted Offer Acceptance result/);
  assert.match(html, /95\.0%/);
  assert.match(html, /High confidence/);
  assert.match(html, /Model-reported confidence \(audit\)/);
  assert.match(html, /uncalibrated/);
  assert.match(html, /Customer ID:[\s\S]*customer-accepted-42/);
  assert.match(html, /Customer ID:[\s\S]*Not available/);
  assert.match(html, /Record summary/);
  assert.equal((html.match(/data-call-id="foundation-accepted-display"/g) || []).length, 1);
  assert.match(html, /2 evaluations:/);
  assert.match(html, /Historical Model Outputs Grouped by Call/);
});

test("all UI data-table headings provide accessible descriptions", async () => {
  await withServer(csv([
    row({
      call_id: "heading-help-call",
      customer_id: "heading-help-customer",
      AllocatedLeadID: "heading-help-lead",
      Salesperson: "Heading Help Seller",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Please send the information and call me tomorrow. Agent: I will send it and call tomorrow."
    })
  ]), async ({ baseUrl }) => {
    const dashboardHtml = await fetch(`${baseUrl}/`).then((response) => response.text());
    const drilldownHtml = await fetch(`${baseUrl}/drilldown?metric=calls.unique`).then((response) => response.text());
    const callHtml = await fetch(`${baseUrl}/calls/heading-help-call`).then((response) => response.text());

    assertAllTableHeadingsHaveHelp(dashboardHtml, "Sales Dashboard");
    assertAllTableHeadingsHaveHelp(drilldownHtml, "Drilldown");
    assertAllTableHeadingsHaveHelp(callHtml, "Call detail");
  });

  const reportHtml = renderReportPage({
    id: "heading-help-report",
    title: "Heading Help Report",
    type: "report",
    content: "| Salesperson | Calls | Confidence |\n| --- | ---: | ---: |\n| Example | 3 | 80% |"
  });
  assertAllTableHeadingsHaveHelp(reportHtml, "Report viewer");
  assert.match(reportHtml, /The salesperson associated with the call records represented by this row/);
});

test("Validation Lab creates benchmark-only unseen drafts and labels without opening archive or model mutations", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => row({
    call_id: String(71000000 + index),
    customer_id: `validation-customer-${index}`,
    ContactId: `validation-contact-${index}`,
    call_time: `09:${String(index).padStart(2, "0")}:00`,
    Salesperson: `Validation Seller ${index % 3}`,
    transcription_text: `Validation Seller ${index % 3} (CWA): Direct seller quote ${index}. Customer: Direct customer quote ${index}.`
  }));
  let modelRequests = 0;
  await withServer(csv(rows), async ({ baseUrl, storePath }) => {
    const before = readStore({ storePath });
    const beforeArchive = {
      jobs: before.aiJobs.length,
      runs: before.evaluationStudio.evaluationRuns.length,
      results: before.evaluationStudio.evaluationResults.length
    };
    const createResponse = await fetch(`${baseUrl}/evaluation-studio/validation-lab/manifests`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Exact fact smoke",
        partition: "smoke",
        capabilityId: "future_materially_different_exact_fact_v1",
        sampleSize: "10",
        exactFact: "one exact closed fact",
        productUse: "research comparison only",
        minimumDecisionAccuracy: "0.95",
        minimumEvidenceIntegrity: "1",
        minimumCoverage: "0.9",
        minimumExactQuotesPerDecision: "1"
      }),
      redirect: "manual"
    });
    assert.equal(createResponse.status, 303);
    const payload = await fetch(`${baseUrl}/api/evaluation-studio/validation-lab`).then((response) => response.json());
    assert.equal(payload.ok, true);
    assert.equal(payload.validationLab.summary.manifests, 1);
    assert.equal(payload.validationLab.manifests[0].examples.length, 10);
    assert.equal(payload.validationLab.manifests[0].labelBatch.length, 5);
    assert.equal(payload.validationLab.operationalUsePermitted, false);
    const manifest = payload.validationLab.manifests[0];
    const first = manifest.labelBatch[0];
    const labelResponse = await fetch(`${baseUrl}/evaluation-studio/validation-lab/manifests/${encodeURIComponent(manifest.id)}/labels`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        callId: first.callId,
        expectedDecision: "present",
        caseType: "positive",
        supportStatus: "supported",
        controllingReason: "The selected direct quote controls the frozen label.",
        evidenceTurnIndex: "0"
      }),
      redirect: "manual"
    });
    assert.equal(labelResponse.status, 303);
    const afterLabel = await fetch(`${baseUrl}/api/evaluation-studio/validation-lab`).then((response) => response.json());
    assert.equal(afterLabel.validationLab.summary.confirmedLabels, 1);
    const studioHtml = await fetch(`${baseUrl}/evaluation-studio?manifestId=${encodeURIComponent(manifest.id)}`).then((response) => response.text());
    assert.match(studioHtml, /What each evaluator is actually allowed to do/);
    assert.match(studioHtml, /Voicemail and later inbound evidence/);
    assert.match(studioHtml, /Benchmark Builder and Human Truth/);
    assert.match(studioHtml, /Historical Research — read only, authority none/);
    assert.match(studioHtml, /Direct-quote question/);
    assert.doesNotMatch(studioHtml, /Choose calls and run an evaluation|Submit test|Automatically route Foundation/);

    const lockedArchive = await fetch(`${baseUrl}/api/evaluation-studio/knowledgebase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "must remain locked", content: "not written" })
    });
    assert.equal(lockedArchive.status, 423);
    const after = readStore({ storePath });
    assert.deepEqual({
      jobs: after.aiJobs.length,
      runs: after.evaluationStudio.evaluationRuns.length,
      results: after.evaluationStudio.evaluationResults.length
    }, beforeArchive);
    assert.equal(modelRequests, 0);
  }, {
    fetchImpl: async () => {
      modelRequests += 1;
      throw new Error("Validation Lab must not contact the model service");
    }
  });
});
