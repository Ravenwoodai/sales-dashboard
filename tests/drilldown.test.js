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

test("call drill-down returns sanitized raw fields and full local transcript proof", () => {
  const analysis = analyzeCsvText(csv([row()]));
  const result = buildDrilldownResult(analysis, { metric: "calls.followUpRequired" });

  assert.equal(result.count, 1);
  assert.equal(result.rows[0].callId, "1");
  assert.equal(result.rows[0].customerId, "customer-1");
  assert.equal(result.rows[0].rawFields.dialled_phone_number, undefined);
  assert.equal(result.rows[0].rawFields.CustomerCreateDate, undefined);
  assert.equal(result.rows[0].rawFields.CustomerImportDate, undefined);
  assert.equal(result.rows[0].rawFields.NoSaleType, undefined);
  assert.equal(result.rows[0].rawFields.Baz_DetailedNotes, undefined);
  assert.match(result.rows[0].transcript, /Please call me back later today/);
});

test("transcript governance drill-downs expose exact usable and review-only call sets", () => {
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
  const multipleBands = buildDrilldownResult(analysis, { metric: "calls.unique", confidenceBand: "low,unusable" });

  assert.deepEqual(usable.rows.map((item) => item.callId), ["governance-usable"]);
  assert.deepEqual(reviewOnly.rows.map((item) => item.callId).sort(), ["governance-low", "governance-unusable"]);
  assert.deepEqual(multipleBands.rows.map((item) => item.callId).sort(), ["governance-low", "governance-unusable"]);
});

test("dashboard and Evaluation Studio expose drill-down links for backed aggregates and mark terminal metadata", async () => {
  await withServer(csv([row({ Salesperson: "Riley Example", CustomerImportSource: "GoogleMaps" })]), async ({ baseUrl }) => {
    const dashboard = await fetch(`${baseUrl}/?view=intelligence`).then((response) => response.text());
    assert.match(dashboard, /metric=calls\.transcriptUsableForCoaching/);
    assert.match(dashboard, /metric=calls\.lowOrUnusableTranscript/);
    assert.match(dashboard, /metric=calls\.unique&amp;salesperson=Riley\+Example/);
    assert.match(dashboard, /intelligenceQueue=repeated_short/);
    assert.match(dashboard, /data-drilldown="not-applicable"/);
    assert.match(dashboard, /href="\/imports\/import_[^"&]+"/);
    assert.match(dashboard, /href="\/manager-reviews"/);
    const importHref = dashboard.match(/href="(\/imports\/import_[^"&]+)"/)[1];
    assert.equal((await fetch(`${baseUrl}${importHref}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/manager-reviews`)).status, 200);

    const studio = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(studio, /reportSignal=callbackOpportunities/);
    assert.match(studio, /reportSignal=possibleWasteIndicators/);
    assert.match(studio, /reportSignal=coachingOpportunities/);
    assert.match(studio, /metric=calls\.transcriptAvailable/);
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

test("AI call assistant drill-down filters bail and handled encounters", () => {
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
  assert.equal(bailed.count, 1);
  assert.equal(bailed.rows[0].callId, "ai-bail");
  assert.equal(bailed.rows[0].aiVoiceAssistantBailed, true);
  assert.equal(handled.count, 1);
  assert.equal(handled.rows[0].callId, "ai-handled");
  assert.deepEqual(handled.rows[0].aiVoiceAssistantTactics.includes("Explained reason"), true);
});

test("system audio drill-down filters subtypes and recovery proof", () => {
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
      transcription_text: "Outbound call Customer: The number is busy."
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
  assert.equal(screening.rows[0].handledSuccessfully, true);
  assert.equal(recovered.count, 1);
  assert.equal(recovered.rows[0].futureCallId, "screening-future");
  assert.equal(carrier.count, 1);
  assert.equal(carrier.rows[0].callId, "carrier");
});

test("dashboard can submit a call transcript to the AI execution layer", async () => {
  const fetchRequests = [];
  await withServer(csv([row({ call_id: "4" })]), async ({ baseUrl, storePath }) => {
    const response = await fetch(`${baseUrl}/api/ai/transcript-evaluation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: "4" })
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.job.jobId, "job-ai-4");
    assert.equal(fetchRequests.length, 1);
    assert.equal(fetchRequests[0].url, "http://127.0.0.1:8080/run-task");

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 1);
    assert.equal(store.aiJobs[0].callId, "4");
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
    assert.doesNotMatch(html, /href="#allocations"/);
    assert.doesNotMatch(html, /Lead Allocation Coverage|Leads allocated|Leads remaining|QTY ACTIONED|Observed vs actioned|stable lead-days/i);
    assert.match(html, /No-Contact Utilisation Proof/);
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
    assert.match(html, /Follow-up overdue status may be indeterminate/i);
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
    assert.match(html, /not all calls are LLM-reviewed/i);
    assert.match(html, /Low\/unusable transcripts/);
    assert.doesNotMatch(html, /Raw NoSaleType|Baz_DetailedNotes/);
    assert.match(html, /Derived outcome/);
    assert.match(html, /Evidence unavailable/);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation reconciliation|stable lead-days|allocated-versus-called|campaign\/allocation|allocation coverage/i);

    const notRequestedHtml = await fetch(`${baseUrl}/?intelligenceQueue=llm_completed&llmStatus=not_requested&callIds=proof`).then((response) => response.text());
    assert.match(notRequestedHtml, /proof[\s\S]*Not requested/);
    assert.match(notRequestedHtml, /proof[\s\S]*Confidence unavailable/);
    assert.doesNotMatch(notRequestedHtml, /proof[\s\S]{0,800}LLM-reviewed/);

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
    assert.match(callHtml, /Deterministic derived outcome[\s\S]*Deterministic/);

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
    assert.match(html, /LLM-reviewed/);
    assert.match(html, /91%/);
    assert.doesNotMatch(intelligenceQueueHtml, /proof[\s\S]{0,800}Confidence unavailable/);
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
    assert.match(html, /Executive rates use filtered deduplicated calls/);
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
      transcription_text: "Outbound call Customer: This is a complaint and I want it reviewed. Agent: I understand.",
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
    assert.match(callHtml, /Deterministic derived outcome/);

    const dashboardHtml = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(dashboardHtml, /Manager-corrected/);
    assert.match(dashboardHtml, /Manager review is separate from alert lifecycle|Lifecycle workflow for call-data alerts/);

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

    const harvest = await fetch(`${baseUrl}/?view=harvest&salesperson=${encodeURIComponent("Workspace Seller")}`).then((response) => response.text());
    assert.match(harvest, /data-dashboard-view="harvest"/);
    assert.match(harvest, /Callback opportunities/);
    assert.match(harvest, /data-dashboard-view="team" hidden/);
    assert.match(harvest, /name="view" value="harvest"/);
    assert.match(harvest, /href="\/\?view=harvest#filters"/);
    assert.match(harvest, /salesperson=Workspace(?:%20|\+)Seller/);

    const records = await fetch(`${baseUrl}/?view=records`).then((response) => response.text());
    assert.match(records, /data-dashboard-view="records"/);
    assert.match(records, /Records &amp; Reports/);
    assert.match(records, /id="explorer"/);

    const studio = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(studio, /Evaluation Studio sections/);
    assert.match(studio, /href="#knowledgebase"/);
    assert.match(studio, /href="#runs"/);
    assert.match(studio, /class="studio-create"/);
    assert.match(studio, /Save as draft/);
    assert.match(studio, /Include in evaluations/);
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
  assert.equal(validOneDial.rows[0].oneDialBucketLabel, "Valid one-dial outcome");

  const riskyOneDial = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialRiskyNoContact",
    salesperson: "Seller B"
  });
  assert.equal(riskyOneDial.count, 1);
  assert.equal(riskyOneDial.rows[0].customerId, "customer-warm");
  assert.equal("spielDeliveredLikely" in riskyOneDial.rows[0], false);

  const oneDialNoContactNoLater = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialNoContactNoLater",
    salesperson: "Seller B"
  });
  assert.equal(oneDialNoContactNoLater.title, "Potential Lead Under-Utilisation");
  assert.equal(oneDialNoContactNoLater.count, 1);
  assert.equal(oneDialNoContactNoLater.rows[0].customerId, "customer-warm");
  assert.equal(oneDialNoContactNoLater.rows[0].noLaterCallByAnyone, true);

  const needsReviewOneDial = buildDrilldownResult(analysis, {
    metric: "reattempt.oneDialNeedsReview",
    salesperson: "Seller A"
  });
  assert.equal(needsReviewOneDial.title, "Ambiguous One-Dial Records Excluded");
  assert.equal(needsReviewOneDial.count, 1);
  assert.equal(needsReviewOneDial.rows[0].customerId, "customer-later");
  assert.match(needsReviewOneDial.rows[0].oneDialReason, /follow-up|verify/i);

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
    assert.match(drilldownHtml, /Callback requested or promised/);
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
    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(html, /Lead Reattempt Behaviour/);
    assert.match(html, /Reattempt Behaviour By Salesperson/);
    assert.match(html, /Patterns In What Gets Retried/);
    assert.match(html, /Reattempt Patterns By Source/);
    assert.match(html, /Reattempt Patterns By Region/);
    assert.match(html, /One-dial records/);
    assert.match(html, /Potential lead under-utilisation/);
    assert.match(html, /one-dial no-contact rows with no later matching call observed/i);
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

test("dashboard exposes lead harvest queue, API, and proof drilldown", async () => {
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
    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(html, /Lead Harvest Queue/);
    assert.match(html, /Lead Harvest Evidence Queue/);
    assert.match(html, /Harvest Objections/);
    assert.match(html, /Salesperson Handling/);
    assert.match(html, /Oldest/);
    assert.match(html, /View all/);
    assert.match(html, /positive callback candidates/i);
    assert.doesNotMatch(html, /QTY ACTIONED|allocation coverage|campaign allocation|stable lead-days/i);

    const api = await fetch(`${baseUrl}/api/lead-harvest?businessSegment=new&objectionType=needs_information_or_review`).then((response) => response.json());
    assert.equal(api.query.businessSegment, "new");
    assert.equal(api.query.objectionType, "needs_information_or_review");
    assert.equal(api.totals.newBusinessCandidateCalls, 1);
    assert.equal(api.totals.openNewBusinessCandidates, 1);
    assert.equal(api.records[0].objectionLabel, "Needs information / wants to review");
    assert.equal(api.records[0].salespersonHandlingType, "clear_next_step");
    assert.equal(api.records.some((record) => record.callId === "harvest-warm"), false);
    assert.equal(api.records.some((record) => record.callId === "harvest-terminal"), false);

    const queue = await fetch(`${baseUrl}/api/drilldown?metric=harvest.reviewQueue&businessSegment=new&sort=oldest&limit=1`).then((response) => response.json());
    assert.equal(queue.kind, "harvest");
    assert.equal(queue.count, 1);
    assert.equal(queue.limit, 1);
    assert.equal(queue.filters.sort, "oldest");
    assert.equal(queue.rows[0].callId, "harvest-open");
    assert.equal(queue.rows[0].status, "open_no_later_matching_call");
    assert.equal(queue.rows[0].objectionType, "needs_information_or_review");
    assert.equal(queue.rows[0].salespersonHandlingType, "clear_next_step");
    assert.match(queue.rows[0].handoverSummary, /Morgan|tomorrow/i);

    const later = await fetch(`${baseUrl}/api/drilldown?metric=harvest.laterObserved&businessSegment=new`).then((response) => response.json());
    assert.equal(later.count, 1);
    assert.equal(later.rows[0].laterCallId, "harvest-later-follow");
  });
});

test("dashboard exposes Evaluation Studio APIs, queued runs, and management UI", async () => {
  await withServer(csv([
    row({
      call_id: "studio-1",
      Salesperson: "Riley Example",
      transcription_text: "Outbound call Customer: I am interested but please call me back tomorrow. Agent: I can do that and will make a note."
    }),
    row({
      call_id: "studio-2",
      Salesperson: "Avery Filter",
      customer_id: "customer-2",
      AllocatedLeadID: "lead-2",
      ContactId: "contact-2",
      transcription_text: "Outbound call Customer: I am not sure this is for me. Agent: No worries, thanks for your time."
    })
  ]), async ({ baseUrl, storePath }) => {
    const initial = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    assert.equal(initial.summary.activeKnowledgebaseEntries >= 1, true);
    assert.equal(initial.summary.activeTemplates >= 1, true);
    assert.equal(initial.knowledgebaseEntries.some((entry) => entry.sourceProject === "Neuron-Compute-Training"), true);
    assert.equal(initial.evaluationTemplates.some((template) => template.evaluationGoal === "offer_acceptance_classification"), true);
    const initialPage = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(initialPage, /Choose calls and run an evaluation/);
    assert.match(initialPage, /Preview selection/);
    assert.match(initialPage, /Evaluation Results/);
    assert.match(initialPage, /Offer Acceptance \(Sale Signal\) Review/);
    assert.match(initialPage, /<option value="template_call_intelligence_foundation_v6" selected>Call Intelligence Foundation/);
    assert.doesNotMatch(initialPage, /Pending manager approval/);

    const kbResponse = await fetch(`${baseUrl}/api/evaluation-studio/knowledgebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Local Callback Standard",
        category: "callback_handling",
        tags: "callback,manager",
        content: "Capture requested timing, objection, and next action.",
        actor: "spoofed_manager"
      })
    }).then((response) => response.json());
    assert.equal(kbResponse.ok, true);
    assert.equal(kbResponse.knowledgebaseEntry.updatedBy, "local_user");
    assert.equal(kbResponse.knowledgebaseEntry.approvalStatus, "approved_current");

    const kbEditResponse = await fetch(`${baseUrl}/evaluation-studio/knowledgebase`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: kbResponse.knowledgebaseEntry.id,
        title: "Local Callback Standard Updated",
        category: "callback_handling",
        tags: "callback,manager,updated",
        content: "Updated callback standard from the dashboard form."
      }),
      redirect: "manual"
    });
    assert.equal(kbEditResponse.status, 303);
    const kbAfterEdit = await fetch(`${baseUrl}/api/evaluation-studio/knowledgebase?includeArchived=true`).then((response) => response.json());
    const editedKb = kbAfterEdit.knowledgebaseEntries.find((entry) => entry.id === kbResponse.knowledgebaseEntry.id);
    assert.equal(editedKb.title, "Local Callback Standard Updated");
    assert.equal(editedKb.version, 2);

    const templateResponse = await fetch(`${baseUrl}/api/evaluation-studio/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Callback Test Template",
        evaluationGoal: "callback_opportunity",
        instructions: "Return callback opportunity, timing, objection, evidence, and confidence.",
        outputSchema: { callback_opportunity: "boolean", evidence: "string", confidence: "0-1" },
        updatedBy: "spoofed_manager"
      })
    }).then((response) => response.json());
    assert.equal(templateResponse.ok, true);
    assert.equal(templateResponse.evaluationTemplate.updatedBy, "local_user");

    const preview = await fetch(`${baseUrl}/api/evaluation-studio/selection-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: templateResponse.evaluationTemplate.id,
        businessSegment: "new",
        evaluationState: "unevaluated",
        selectionMode: "oldest",
        limit: 1
      })
    }).then((response) => response.json());
    assert.equal(preview.ok, true);
    assert.equal(preview.matchingCalls, 1);
    assert.equal(preview.preview[0].callId, "studio-1");

    const templateEditResponse = await fetch(`${baseUrl}/evaluation-studio/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: templateResponse.evaluationTemplate.id,
        name: "Callback Test Template Updated",
        evaluationGoal: "callback_opportunity",
        tags: "callback,updated",
        instructions: "Updated instructions for callback opportunity testing.",
        outputSchema: JSON.stringify({ callback_requested: "boolean", evidence: "string", confidence: "0-1" })
      }),
      redirect: "manual"
    });
    assert.equal(templateEditResponse.status, 303);
    const templatesAfterEdit = await fetch(`${baseUrl}/api/evaluation-studio/templates?includeArchived=true`).then((response) => response.json());
    const editedTemplate = templatesAfterEdit.evaluationTemplates.find((template) => template.id === templateResponse.evaluationTemplate.id);
    assert.equal(editedTemplate.name, "Callback Test Template Updated");
    assert.equal(editedTemplate.version, 2);

    const customTemplateResponse = await fetch(`${baseUrl}/evaluation-studio/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Payment Ask Quality Review",
        evaluationGoal: "payment_ask_quality",
        tags: "payment,close",
        instructions: "Check whether the payment or next-step ask was clear and evidence-backed.",
        outputSchema: JSON.stringify({ payment_ask_quality: "string", evidence: "string", confidence: "0-1" })
      }),
      redirect: "manual"
    });
    assert.equal(customTemplateResponse.status, 303);
    const templatesAfterCustom = await fetch(`${baseUrl}/api/evaluation-studio/templates`).then((response) => response.json());
    assert.equal(templatesAfterCustom.evaluationTemplates.some((template) => template.evaluationGoal === "payment_ask_quality"), true);

    const runResponse = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: templateResponse.evaluationTemplate.id,
        limit: 2,
        businessSegment: "new"
      })
    }).then((response) => response.json());
    assert.equal(runResponse.ok, true);
    assert.equal(runResponse.evaluationRun.status, "queued");
    assert.equal(runResponse.evaluationRun.plannedCallCount, 2);
    assert.equal(runResponse.submitted, false);

    const quarantinedRun = await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runResponse.evaluationRun.id)}/quarantine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Prompt output needs schema review." })
    }).then((response) => response.json());
    assert.equal(quarantinedRun.ok, true);
    assert.equal(quarantinedRun.evaluationRun.status, "quarantined");
    assert.equal(quarantinedRun.evaluationRun.quarantinedBy, "local_user");
    assert.equal(quarantinedRun.evaluationRun.runHistory[0].action, "quarantine");

    const quarantinedRunHtml = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(quarantinedRunHtml, /Resume/);

    const resumedRun = await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runResponse.evaluationRun.id)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Ready to continue." })
    }).then((response) => response.json());
    assert.equal(resumedRun.ok, true);
    assert.equal(resumedRun.evaluationRun.status, "queued");
    assert.equal(resumedRun.evaluationRun.resumeCount, 1);
    assert.equal(resumedRun.evaluationRun.runHistory[1].action, "resume");

    const runHtmlBeforeResult = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(runHtmlBeforeResult, /Harvest results/);
    assert.match(runHtmlBeforeResult, /Quarantine/);
    assert.match(runHtmlBeforeResult, /history events/);

    const resultResponse = await fetch(`${baseUrl}/api/evaluation-studio/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: runResponse.evaluationRun.id,
        templateId: templateResponse.evaluationTemplate.id,
        jobId: "studio-job-1",
        result: {
          call_id: "studio-1",
          evaluation_goal: "callback_opportunity",
          status: "usable",
          confidence: 0.86,
          evidence_availability: "available",
          transcript_quality: "high",
          manager_summary: "Customer asked for a callback tomorrow; this is a reviewable opportunity, not a confirmed sale.",
          findings: [
            {
              field: "callback_requested",
              value: true,
              previous_display_value: "indeterminate",
              evidence: "Customer: I am interested but please call me back tomorrow.",
              confidence: 0.86,
              manager_review_recommended: true
            },
            {
              field: "callback_timing",
              value: "tomorrow",
              evidence: "Customer: please call me back tomorrow.",
              confidence: 0.83
            }
          ]
        }
      })
    }).then((response) => response.json());
    assert.equal(resultResponse.ok, true);
    assert.equal(resultResponse.evaluationResult.callId, "studio-1");
    assert.equal(resultResponse.evaluationResult.managerReviewRecommended, true);

    const secondResultResponse = await fetch(`${baseUrl}/api/evaluation-studio/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: runResponse.evaluationRun.id,
        templateId: customTemplateResponse.status === 303 ? templateResponse.evaluationTemplate.id : templateResponse.evaluationTemplate.id,
        jobId: "studio-job-2",
        result: {
          call_id: "studio-2",
          evaluation_goal: "coaching_opportunity",
          status: "usable",
          confidence: 0.72,
          evidence_availability: "partial",
          transcript_quality: "medium",
          manager_summary: "The close may need coaching review.",
          findings: [
            {
              field: "coaching_priority",
              value: "medium",
              evidence: "Agent: No worries, thanks for your time.",
              confidence: 0.72
            }
          ]
        }
      })
    }).then((response) => response.json());
    assert.equal(secondResultResponse.ok, true);
    assert.equal(secondResultResponse.evaluationResult.callId, "studio-2");

    const resultsResponse = await fetch(`${baseUrl}/api/evaluation-studio/results?currentOnly=true&reviewRecommended=true`).then((response) => response.json());
    assert.equal(resultsResponse.results.length, 1);
    assert.equal(resultsResponse.results[0].callId, "studio-1");
    assert.equal(resultsResponse.results[0].provenance, "evaluation_studio_local_model");

    const studioAfterResult = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    assert.equal(studioAfterResult.reportRollups.totals.callbackOpportunities, 1);
    assert.equal(studioAfterResult.reportRollups.totals.evaluatedCalls, 2);
    assert.equal(studioAfterResult.reportRollups.priorityExamples[0].callId, "studio-1");

    const rollupOnly = await fetch(`${baseUrl}/api/evaluation-studio/report-rollups?currentOnly=true`).then((response) => response.json());
    assert.equal(rollupOnly.reportRollups.totals.callbackOpportunities, 1);
    assert.equal(rollupOnly.reportRollups.scope.use, "Report-ready lead utilisation and coaching signals for manager review, not disciplinary proof.");

    const filteredRollup = await fetch(`${baseUrl}/api/evaluation-studio/report-rollups?currentOnly=true&salesperson=${encodeURIComponent("Riley Example")}`).then((response) => response.json());
    assert.equal(filteredRollup.reportRollups.scope.filteredCallIds, 1);
    assert.equal(filteredRollup.reportRollups.totals.evaluatedCalls, 1);
    assert.equal(filteredRollup.reportRollups.priorityExamples.every((row) => row.callId === "studio-1"), true);

    const filteredResults = await fetch(`${baseUrl}/api/evaluation-studio/results?currentOnly=true&salesperson=${encodeURIComponent("Riley Example")}`).then((response) => response.json());
    assert.equal(filteredResults.query.filteredCallIds, 1);
    assert.equal(filteredResults.query.matchingResults, 1);
    assert.equal(filteredResults.results[0].callId, "studio-1");

    const reviewHandoff = await fetch(`${baseUrl}/api/evaluation-studio/results/${encodeURIComponent(resultResponse.evaluationResult.id)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: "spoofed_reviewer",
        updatedBy: "admin",
        note: "<script>alert('review')</script>"
      })
    }).then((response) => response.json());
    assert.equal(reviewHandoff.ok, true);
    assert.equal(reviewHandoff.review.callId, "studio-1");
    assert.equal(reviewHandoff.review.reviewStatus, "review_needed");
    assert.equal(reviewHandoff.review.reviewScope, "follow_up");
    assert.equal(reviewHandoff.review.reviewedBy, "local_manager");
    assert.equal(reviewHandoff.review.source, "evaluation_studio");
    assert.equal(reviewHandoff.review.corrections.length, 0);
    assert.equal(reviewHandoff.review.suggestedCorrections.length, 2);
    assert.deepEqual(reviewHandoff.review.suggestedCorrections.map((item) => item.fieldName), ["follow_up_required", "follow_up_due_text"]);
    assert.equal(reviewHandoff.review.suggestedCorrections[0].managerSuggestedValue, "true");
    assert.match(reviewHandoff.review.signalName, /evaluation_studio:callback_opportunity/);
    assert.match(reviewHandoff.review.managerNotes, /Evaluation result ID/);
    assert.match(reviewHandoff.review.managerNotes, /Suggested correction prefill/);
    assert.match(reviewHandoff.review.managerNotes, /<script>alert\('review'\)<\/script>/);
    assert.equal(reviewHandoff.review.reviewHistory[0].actor, "local_manager");

    const callReviews = await fetch(`${baseUrl}/api/calls/studio-1/reviews`).then((response) => response.json());
    assert.equal(callReviews.reviews.length, 1);
    assert.equal(callReviews.reviews[0].reviewStatus, "review_needed");

    const dashboardHtml = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(dashboardHtml, /Evaluation Results/);
    assert.match(dashboardHtml, /href="\/evaluation-studio"/);
    assert.match(dashboardHtml, /Open Evaluation Studio/);
    assert.doesNotMatch(dashboardHtml, /Knowledgebase Entries/);
    assert.doesNotMatch(dashboardHtml, /evaluation-goal-options/);
    assert.doesNotMatch(dashboardHtml, /Test A Prompt/);
    assert.doesNotMatch(dashboardHtml, /Evaluation Evidence Queue/);
    assert.doesNotMatch(dashboardHtml, /QTY ACTIONED|stable lead-days|allocated-versus-called/i);

    const studioHtml = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(studioHtml, /Evaluation Studio/);
    assert.match(studioHtml, /<h3 id="knowledgebase-heading">Knowledgebase<\/h3>/);
    assert.match(studioHtml, /Load text file/);
    assert.match(studioHtml, /<h3 id="templates-heading">Evaluation templates<\/h3>/);
    assert.match(studioHtml, /evaluation-goal-options/);
    assert.match(studioHtml, /Payment Ask Quality Review/);
    assert.match(studioHtml, /Test one transcript first/);
    assert.match(studioHtml, /Results Needing Attention/);
    assert.match(studioHtml, /Report-Safe Evaluation Rollups/);
    assert.match(studioHtml, /Callback opportunities/);
    assert.match(studioHtml, /Manual check suggested/);
    assert.match(studioHtml, /Browse output/);
    assert.match(studioHtml, /Customer asked for a callback tomorrow|Customer: I am interested but please call me back tomorrow/);
    assert.doesNotMatch(studioHtml, /QTY ACTIONED|stable lead-days|allocated-versus-called/i);

    const callHtml = await fetch(`${baseUrl}/calls/studio-1`).then((response) => response.text());
    assert.match(callHtml, /Suggested prefill/);
    assert.match(callHtml, /follow_up_required/);
    assert.match(callHtml, /Suggested only; not a manager correction until confirmed/);

    const store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationRuns.length >= 1, true);
    assert.equal(store.evaluationStudio.evaluationResults.length, 2);
    assert.equal(store.managerReviews.length, 1);
    assert.equal(store.evaluationStudio.evaluationResults.some((result) => result.managerSummary === "Customer asked for a callback tomorrow; this is a reviewable opportunity, not a confirmed sale."), true);
  });
});

test("Evaluation Studio batch harvest stores completed jobs, marks failures, and blocks quarantined runs", async () => {
  const fetchRequests = [];
  await withServer(csv([
    row({
      call_id: "harvest-1",
      transcription_text: "Outbound call Customer: I am interested but need a call back tomorrow. Agent: I will call tomorrow."
    }),
    row({
      call_id: "harvest-2",
      transcription_text: "Outbound call Customer: I am not ready. Agent: I can follow up later if useful."
    })
  ]), async ({ baseUrl, storePath }) => {
    saveBadLeadClaim({
      lead_id: "lead-1",
      call_id: "harvest-1",
      claimed_reason: "wrong_number",
      claim_text: "The salesperson alleges that the recipient identified a wrong number."
    }, {
      submittedByUserId: "salesperson-17",
      submittedByRole: "salesperson",
      now: "2026-07-11T08:00:00.000Z"
    }, { storePath });
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity") || studio.evaluationTemplates[0];

    const runResponse = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        limit: "all",
        submitNow: true
      })
    });
    const runBody = await runResponse.json();
    assert.equal(runResponse.status, 202);
    assert.equal(runBody.ok, true);
    assert.equal(runBody.evaluationRun.status, "running");
    assert.equal(runBody.evaluationRun.queuedJobs.length, 2);
    const claimedCallRequest = fetchRequests
      .map((request) => JSON.parse(request.options.body))
      .find((requestBody) => requestBody.input?.source?.call_id === "harvest-1");
    assert.equal(claimedCallRequest.input.salesperson_allegation.match_basis, "call_id");
    assert.equal(claimedCallRequest.input.salesperson_allegation.claim.claimed_reason, "wrong_number");

    const quarantined = await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runBody.evaluationRun.id)}/quarantine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Pause before harvesting." })
    }).then((response) => response.json());
    assert.equal(quarantined.evaluationRun.status, "quarantined");

    const blockedHarvest = await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runBody.evaluationRun.id)}/harvest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const blockedBody = await blockedHarvest.json();
    assert.equal(blockedHarvest.status, 400);
    assert.match(blockedBody.error, /must be resumed/i);

    await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runBody.evaluationRun.id)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Ready to collect results." })
    });

    const harvestResponse = await fetch(`${baseUrl}/api/evaluation-studio/runs/${encodeURIComponent(runBody.evaluationRun.id)}/harvest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const harvestBody = await harvestResponse.json();
    assert.equal(harvestResponse.status, 200);
    assert.equal(harvestBody.ok, true);
    assert.equal(harvestBody.completed.length, 1);
    assert.equal(harvestBody.failed.length, 1);
    assert.equal(harvestBody.pending.length, 0);
    assert.equal(harvestBody.evaluationRun.status, "partially_completed");
    assert.equal(harvestBody.evaluationRun.completedCallCount, 1);
    assert.equal(harvestBody.evaluationRun.failedCallCount, 1);
    assert.equal(harvestBody.evaluationRun.queuedJobCount, 0);
    assert.equal(harvestBody.evaluationRun.runHistory.at(-1).action, "harvest");
    assert.equal(harvestBody.evaluationRun.runHistory.at(-1).actor, "local_user");

    const store = readStore({ storePath });
    const savedResults = store.evaluationStudio.evaluationResults.filter((result) => result.runId === runBody.evaluationRun.id);
    assert.equal(savedResults.length, 1);
    assert.equal(savedResults[0].callId, "harvest-1");
    assert.equal(savedResults[0].managerReviewRecommended, true);
    assert.equal(store.aiJobs.some((job) => job.jobId === "eval-job-harvest-1" && job.status === "completed"), true);
    assert.equal(store.aiJobs.some((job) => job.jobId === "eval-job-harvest-2" && job.status === "failed"), true);

    const html = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(html, /Harvest results/);
    assert.match(html, /Waiting to start|Results available; some jobs failed|Processing automatically/);
    assert.match(html, /Advanced/);
    assert.match(html, /data-evaluation-run-status/);
    assert.doesNotMatch(html, /QTY ACTIONED/);
    assert.doesNotMatch(html, /allocation coverage/i);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      fetchRequests.push({ url, options });
      if (String(url).endsWith("/run-task")) {
        const requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            job_id: `eval-job-${requestBody.metadata.source_record_id}`,
            status: "queued"
          })
        };
      }
      const jobId = decodeURIComponent(String(url).split("/jobs/")[1] || "");
      if (jobId === "eval-job-harvest-1") {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            job_id: jobId,
            status: "completed",
            result_payload: typedCallbackPayload(
              "harvest-1",
              "I am interested but need a call back tomorrow.",
              "tomorrow",
              {
                manager_review_recommended: true,
                manager_summary: "Customer showed interest and asked for a callback tomorrow."
              }
            )
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          job_id: jobId,
          status: "failed",
          error: "local model returned invalid JSON"
        })
      };
    }
  });

  assert.equal(fetchRequests.filter((request) => String(request.url).endsWith("/run-task")).length, 2);
  assert.equal(fetchRequests.filter((request) => String(request.url).includes("/jobs/")).length, 2);
});

test("Evaluation Studio prompt test submits one call and stores completed local result", async () => {
  const fetchRequests = [];
  await withServer(csv([
    row({
      call_id: "prompt-test-call",
      transcription_text: "Outbound call Customer: I am interested, but I need to speak to my partner. Please call me back tomorrow. Agent: I will call tomorrow and note that."
    })
  ]), async ({ baseUrl, storePath }) => {
    saveBadLeadClaim({
      lead_id: "lead-1",
      call_id: "prompt-test-call",
      claimed_reason: "wrong_number",
      claim_text: "The salesperson alleges that the recipient identified a wrong number."
    }, {
      submittedByUserId: "salesperson-17",
      submittedByRole: "salesperson",
      now: "2026-07-11T08:00:00.000Z"
    }, { storePath });
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity") || studio.evaluationTemplates[0];

    const response = await fetch(`${baseUrl}/api/evaluation-studio/prompt-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        callId: "prompt-test-call",
        submitNow: true
      })
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.submitted, true);
    assert.equal(body.callId, "prompt-test-call");
    assert.equal(body.evaluationRun.runType, "prompt_test");
    assert.equal(body.evaluationRun.status, "completed");
    assert.equal(body.evaluationResult.callId, "prompt-test-call");
    assert.equal(body.evaluationResult.evaluationGoal, template.evaluationGoal);
    assert.equal(body.evaluationResult.provenance, "evaluation_studio_local_model");
    assert.equal(body.taskInput.source.call_id, "prompt-test-call");
    assert.equal("QTY ACTIONED" in body.taskInput.call_csv_context, false);
    assert.equal("salesperson_allegation" in body.taskInput, false);

    assert.equal(fetchRequests.length, 1);
    const requestBody = JSON.parse(fetchRequests[0].options.body);
    assert.equal(fetchRequests[0].url, "http://127.0.0.1:8080/run-task");
    assert.equal(requestBody.task_type, "sales_dashboard_evaluation_studio");
    assert.equal(requestBody.metadata.source_type, "evaluation_studio_prompt_test");
    assert.equal(requestBody.metadata.source_record_id, "prompt-test-call");
    assert.match(fetchRequests[0].options.headers["Idempotency-Key"], /evaluation-studio:dynamic-schema-v1/);
    assert.equal(requestBody.input.evaluation_template.id, template.id);
    assert.equal(requestBody.input.salesperson_allegation.match_basis, "call_id");
    assert.equal(requestBody.input.salesperson_allegation.claim.claimed_reason, "wrong_number");
    assert.equal("manager_decision" in requestBody.input.salesperson_allegation.claim, false);

    const store = readStore({ storePath });
    assert.equal(store.aiJobs.length, 1);
    assert.equal(store.aiJobs[0].taskType, "sales_dashboard_evaluation_studio");
    assert.equal(store.evaluationStudio.evaluationRuns[0].runType, "prompt_test");
    assert.equal(store.evaluationStudio.evaluationResults.length, 1);
    assert.doesNotMatch(JSON.stringify(store.aiJobs), /salesperson_allegation|trusted_bad_lead_claim_context/);
    assert.doesNotMatch(JSON.stringify(store.evaluationStudio.evaluationRuns), /salesperson_allegation|trusted_bad_lead_claim_context/);
    const proxiedJob = await fetch(`${baseUrl}/api/ai/jobs/prompt-test-job-1`).then((response) => response.json());
    assert.equal(proxiedJob.ok, true);
    assert.doesNotMatch(JSON.stringify(proxiedJob), /salesperson_allegation|trusted_bad_lead_claim_context|wrong_number/);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options) => {
      fetchRequests.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            job: {
              id: "prompt-test-job-1",
              status: "completed",
              input: {
                salesperson_allegation: {
                  availability: "present",
                  claim: { claimed_reason: "wrong_number" }
                }
              }
            }
          })
        };
      }
      const requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          job_id: "prompt-test-job-1",
          status: "completed",
          result_payload: typedCallbackPayload(
            requestBody.metadata.source_record_id,
            "I am interested, but I need to speak to my partner. Please call me back tomorrow.",
            "tomorrow",
            {
              confidence: 0.91,
              objection: "I need to speak to my partner.",
              manager_review_recommended: true,
              manager_summary: "Customer is interested and requested a callback tomorrow."
            }
          )
        })
      };
    }
  });
});

test("Evaluation Studio auto-harvests completed queued prompt tests on Studio API reads", async () => {
  const fetchRequests = [];
  await withServer(csv([
    row({
      call_id: "prompt-auto-harvest",
      transcription_text: "Outbound call Customer: I like the idea, please call me tomorrow. Agent: I will call tomorrow."
    })
  ]), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity") || studio.evaluationTemplates[0];

    const response = await fetch(`${baseUrl}/api/evaluation-studio/prompt-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        callId: "prompt-auto-harvest",
        submitNow: true
      })
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.evaluationRun.runType, "prompt_test");
    assert.equal(body.evaluationRun.status, "running");
    assert.equal(body.evaluationResult ?? null, null);

    let store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationRuns[0].status, "running");
    assert.equal(store.evaluationStudio.evaluationResults.length, 0);

    const progress = await fetch(`${baseUrl}/api/evaluation-studio/progress?currentOnly=true`).then((apiResponse) => apiResponse.json());
    assert.equal(progress.schemaVersion, "sales_dashboard_evaluation_studio_progress.v1");
    assert.equal(progress.autoHarvest.checkedRunCount, 1);
    assert.equal(progress.autoHarvest.harvested.length, 1);
    assert.equal(progress.autoHarvest.harvested[0].status, "completed");
    assert.equal(progress.evaluationRuns[0].status, "completed");
    assert.equal(progress.evaluationRuns[0].completedCallCount, 1);
    assert.equal(progress.evaluationRuns[0].hasPendingJobs, false);

    const refreshedStudio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((apiResponse) => apiResponse.json());
    assert.equal(refreshedStudio.autoHarvest.checkedRunCount, 0);
    assert.equal(refreshedStudio.summary.byStatus.completed, 1);
    assert.equal(refreshedStudio.evaluationRuns[0].status, "completed");
    assert.equal(refreshedStudio.evaluationResults.length, 1);
    assert.equal(refreshedStudio.evaluationResults[0].callId, "prompt-auto-harvest");

    const runsAfterHarvest = await fetch(`${baseUrl}/api/evaluation-studio/runs?importId=${encodeURIComponent(body.evaluationRun.importId)}`).then((apiResponse) => apiResponse.json());
    assert.equal(runsAfterHarvest.autoHarvest.checkedRunCount, 0);
    assert.equal(runsAfterHarvest.evaluationRuns[0].status, "completed");

    store = readStore({ storePath });
    assert.equal(store.evaluationStudio.evaluationRuns[0].status, "completed");
    assert.equal(store.evaluationStudio.evaluationRuns[0].runHistory.at(-1).action, "harvest");
    assert.equal(store.evaluationStudio.evaluationResults.length, 1);
    assert.equal(store.aiJobs.some((job) => job.jobId === "prompt-auto-harvest-job" && job.status === "completed"), true);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      fetchRequests.push({ url, options });
      if (String(url).endsWith("/run-task")) {
        const requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            job_id: `${requestBody.metadata.source_record_id}-job`,
            status: "queued"
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          job_id: "prompt-auto-harvest-job",
          status: "completed",
          result_payload: typedCallbackPayload(
            "prompt-auto-harvest",
            "I like the idea, please call me tomorrow.",
            "tomorrow",
            {
              confidence: 0.89,
              manager_review_recommended: true,
              manager_summary: "Customer gave a positive response and asked for a callback tomorrow."
            }
          )
        })
      };
    }
  });

  assert.equal(fetchRequests.filter((request) => String(request.url).endsWith("/run-task")).length, 1);
  assert.equal(fetchRequests.filter((request) => String(request.url).includes("/jobs/")).length, 1);
});

test("Evaluation Studio terminal semantic failures are harvested once and stop running", async () => {
  const fetchRequests = [];
  await withServer(csv([
    row({
      call_id: "prompt-terminal-schema-failure",
      transcription_text: "Outbound call Customer: Please email the information and call tomorrow. Agent: I will do that."
    })
  ]), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "lead_record_disposition_evidence_audit");
    assert.ok(template);

    const submitted = await fetch(`${baseUrl}/api/evaluation-studio/prompt-tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        callId: "prompt-terminal-schema-failure",
        submitNow: true
      })
    }).then((response) => response.json());
    assert.equal(submitted.evaluationRun.status, "running");

    const firstRefresh = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    assert.equal(firstRefresh.autoHarvest.checkedRunCount, 1);
    assert.equal(firstRefresh.autoHarvest.harvested[0].status, "failed");
    assert.equal(firstRefresh.evaluationRuns[0].status, "failed");
    assert.equal(firstRefresh.evaluationRuns[0].failedCallCount, 1);
    assert.equal(firstRefresh.evaluationRuns[0].errors.length, 1);
    assert.equal(firstRefresh.evaluationRuns[0].errors[0].category, "evaluator_semantic_validation_failed");
    assert.ok(firstRefresh.evaluationRuns[0].queuedJobs[0].terminalHandledAt);

    const firstStore = readStore({ storePath });
    const firstRun = firstStore.evaluationStudio.evaluationRuns[0];
    const firstHistoryCount = firstRun.runHistory.length;
    const firstErrorCount = firstRun.errors.length;

    const secondRefresh = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    assert.equal(secondRefresh.autoHarvest.checkedRunCount, 0);
    assert.equal(secondRefresh.evaluationRuns[0].status, "failed");

    const secondRun = readStore({ storePath }).evaluationStudio.evaluationRuns[0];
    assert.equal(secondRun.runHistory.length, firstHistoryCount);
    assert.equal(secondRun.errors.length, firstErrorCount);
    assert.equal(secondRun.queuedJobs[0].terminalFailureCategory, "evaluator_semantic_validation_failed");
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      fetchRequests.push({ url, options });
      if (String(url).endsWith("/run-task")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            job_id: "prompt-terminal-schema-failure-job",
            status: "queued"
          })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          job: {
            id: "prompt-terminal-schema-failure-job",
            status: "done",
            result_payload: {
              schema_version: "sales_dashboard_evaluation_result.v1",
              evaluation_goal: "lead_record_disposition_evidence_audit",
              call_id: "prompt-terminal-schema-failure",
              status: "usable",
              confidence: 0.8,
              findings: [],
              manager_summary: "Old generic output that must not be accepted."
            }
          }
        })
      };
    }
  });

  assert.equal(fetchRequests.filter((request) => String(request.url).endsWith("/run-task")).length, 1);
  assert.equal(fetchRequests.filter((request) => String(request.url).includes("/jobs/")).length, 1);
});

test("Call Intelligence Foundation automatically routes only eligible specialist evaluations", async () => {
  const fetchRequests = [];
  const callId = "foundation-routing-call";
  const transcript = "Outbound call Salesperson: I am calling on behalf of the local yearbook. Customer: Please send the information and call me tomorrow afternoon.";
  const foundationPayload = {
    schema_version: "call_intelligence_foundation.v3",
    evaluation_goal: "call_intelligence_foundation",
    call_id: callId,
    status: "usable",
    confidence: 0.9,
    evidence_availability: "available",
    transcript_quality: "high",
    contact_result: "live_decision_maker",
    decision_maker_status: "confirmed",
    conversation_stage: "purpose_explained",
    offer_presented: false,
    price_presented: false,
    objection_present: false,
    customer_outcome: "callback_requested",
    next_step_status: "actionable",
    follow_up_timing: "tomorrow afternoon",
    lead_record_signal: "none",
    called_on_behalf_of: "the local yearbook",
    commercial_context: { product_or_package: "", quoted_amount_available: false, quoted_amount: 0, currency: "unknown" },
    intelligence_lenses: {
      opportunity_status: "actionable",
      measurement_eligibility: "eligible",
      efficiency_status: "efficient_progression"
    },
    specialist_routes: {
      offer_acceptance_classification: false,
      callback_opportunity: false,
      objection_handling: false,
      procedure_adherence: false,
      lead_record_disposition_evidence_audit: false
    },
    evidence: [{
      supports: "called_on_behalf_of",
      speaker: "salesperson",
      quote: "I am calling on behalf of the local yearbook."
    }, {
      supports: "next_step_status",
      speaker: "customer",
      quote: "Please send the information and call me tomorrow afternoon."
    }],
    manager_review_recommended: false,
    manager_summary: "The customer requested information and an actionable callback.",
    limitations: [],
    findings: []
  };

  await withServer(csv([row({ call_id: callId, transcription_text: transcript })]), async ({ baseUrl, storePath }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const foundationTemplate = studio.evaluationTemplates.find((item) => item.evaluationGoal === "call_intelligence_foundation");
    assert.ok(foundationTemplate);

    const submitted = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: foundationTemplate.id,
        callIds: callId,
        selectionMode: "call_ids",
        evaluationState: "all",
        limit: 1,
        submitNow: true,
        autoRouteSpecialists: true
      })
    }).then((response) => response.json());
    assert.equal(submitted.evaluationRun.status, "running");

    const foundationRefresh = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const parent = foundationRefresh.evaluationRuns.find((run) => run.id === submitted.evaluationRun.id);
    assert.equal(parent.status, "completed");
    assert.equal(parent.specialistRouting.status, "completed");
    assert.deepEqual(parent.specialistRouting.childRuns.map((run) => run.goal).sort(), ["callback_opportunity", "procedure_adherence"]);
    assert.equal(parent.specialistRouting.requestedChecks, 2);
    assert.equal(foundationRefresh.evaluationResults.some((result) => result.evaluationGoal === "call_intelligence_foundation"), true);

    const specialistRefresh = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const goals = specialistRefresh.evaluationResults.map((result) => result.evaluationGoal);
    assert.equal(goals.includes("callback_opportunity"), true);
    assert.equal(goals.includes("procedure_adherence"), true);
    assert.equal(goals.includes("offer_acceptance_classification"), false);
    assert.equal(goals.includes("objection_handling"), false);
    assert.equal(goals.includes("lead_record_disposition_evidence_audit"), false);
    assert.equal(specialistRefresh.evaluationResults.every((result) => result.callIntelligence?.schemaVersion === "call_intelligence_aggregate.v1"), true);
    assert.equal(specialistRefresh.evaluationResults.every((result) => result.customerId === "customer-1"), true);
    const resultsApi = await fetch(`${baseUrl}/api/evaluation-studio/results?callId=${encodeURIComponent(callId)}&currentOnly=true`).then((response) => response.json());
    assert.equal(resultsApi.results.every((result) => result.callIntelligence?.schemaVersion === "call_intelligence_aggregate.v1"), true);
    assert.equal(resultsApi.results.every((result) => result.customerId === "customer-1"), true);
    assert.equal(specialistRefresh.foundationReport.totals.routedSpecialistChecks, 2);
    assert.equal(specialistRefresh.foundationReport.totals.completedSpecialistChecks, 2);
    const html = await fetch(`${baseUrl}/evaluation-studio`).then((response) => response.text());
    assert.match(html, /Opportunity, Measurement & Efficiency/);
    assert.match(html, /Automatically route Foundation results to the five specialist evaluators/);
    assert.match(html, /Call Intelligence Foundation/);
    assert.match(html, /Called on behalf of/);
    assert.match(html, /the local yearbook/);
    assert.match(html, /Callback timing/);
    assert.match(html, /tomorrow afternoon/);
    assert.match(html, /2 \/ 2/);
    assert.match(html, /foundationOpportunityStatus=actionable_or_accepted/);
    assert.match(html, /foundationMeasurementEligibility=eligible/);
    assert.match(html, /class="evaluation-result-card"/);
    assert.match(html, /data-evaluation-studio-progress/);
    assert.match(html, /\/api\/evaluation-studio\/progress\?currentOnly=true/);
    assert.match(html, /sales-dashboard-evaluation-studio-refresh-state\.v1/);
    assert.match(html, /completedCallCount/);
    assert.match(html, /window\.scrollTo/);

    const storedParent = readStore({ storePath }).evaluationStudio.evaluationRuns.find((run) => run.id === submitted.evaluationRun.id);
    assert.equal(storedParent.runHistory.some((event) => event.action === "route_specialists"), true);
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      fetchRequests.push({ url, options });
      if (String(url).endsWith("/run-task")) {
        const requestBody = JSON.parse(options.body);
        const goal = requestBody.metadata.evaluation_goal;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ job_id: `${goal}-job`, status: "queued" })
        };
      }
      const jobId = decodeURIComponent(String(url).split("/").at(-1));
      const goal = jobId.replace(/-job$/, "");
      const resultPayload = goal === "call_intelligence_foundation"
        ? foundationPayload
        : goal === "callback_opportunity"
          ? typedCallbackPayload(
              callId,
              "Please send the information and call me tomorrow afternoon.",
              "tomorrow afternoon"
            )
          : typedProcedurePayload(
              callId,
              "Please send the information and call me tomorrow afternoon."
            );
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ job: { id: jobId, status: "done", result_payload: resultPayload } })
      };
    }
  });

  assert.equal(fetchRequests.filter((request) => String(request.url).endsWith("/run-task")).length, 3);
});

test("large Evaluation Studio runs submit concurrently and auto-harvest in bounded chunks", async () => {
  let runTaskAttempts = 0;
  const calls = Array.from({ length: 101 }, (_, index) => row({
    call_id: `bounded-${String(index + 1).padStart(3, "0")}`,
    customer_id: `customer-bounded-${index + 1}`,
    AllocatedLeadID: `lead-bounded-${index + 1}`,
    transcription_text: "Outbound call Customer: Please send the information and call tomorrow. Agent: I will call tomorrow."
  }));
  await withServer(csv(calls), async ({ baseUrl }) => {
    const studio = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const template = studio.evaluationTemplates.find((item) => item.evaluationGoal === "callback_opportunity");
    const submitted = await fetch(`${baseUrl}/api/evaluation-studio/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: template.id,
        evaluationState: "all",
        selectionMode: "oldest",
        limit: 101,
        submitNow: true
      })
    }).then((response) => response.json());
    assert.equal(submitted.evaluationRun.queuedJobs.length, 101);
    assert.equal(runTaskAttempts, 102);

    const first = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const firstRun = first.evaluationRuns.find((run) => run.id === submitted.evaluationRun.id);
    assert.equal(first.autoHarvest.harvested[0].completed, 100);
    assert.equal(firstRun.completedCallCount, 100);
    assert.equal(firstRun.queuedJobCount, 1);
    assert.equal(firstRun.status, "running");

    const second = await fetch(`${baseUrl}/api/evaluation-studio?currentOnly=true`).then((response) => response.json());
    const secondRun = second.evaluationRuns.find((run) => run.id === submitted.evaluationRun.id);
    assert.equal(second.autoHarvest.harvested[0].completed, 1);
    assert.equal(secondRun.completedCallCount, 101);
    assert.equal(secondRun.queuedJobCount, 0);
    assert.equal(secondRun.status, "completed");
  }, {
    env: {
      SALES_DASHBOARD_AI_ENABLED: "true",
      SALES_DASHBOARD_AI_PROJECT_API_KEY: "project-key"
    },
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith("/run-task")) {
        runTaskAttempts += 1;
        if (runTaskAttempts === 1) throw new Error("fetch failed");
        const requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ job_id: `${requestBody.metadata.source_record_id}-job`, status: "queued" })
        };
      }
      const jobId = decodeURIComponent(String(url).split("/").at(-1));
      const callId = jobId.replace(/-job$/, "");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          job: {
            id: jobId,
            status: "done",
            result_payload: typedCallbackPayload(
              callId,
              "Please send the information and call tomorrow.",
              "tomorrow",
              { confidence: 0.85, manager_summary: "Customer requested information and a callback." }
            )
          }
        })
      };
    }
  });
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

test("dashboard exposes system audio audit section and API", async () => {
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
    const html = await fetch(`${baseUrl}/`).then((response) => response.text());
    assert.match(html, /System Audio Audit/);
    assert.match(html, /System Audio Subtypes/);
    assert.match(html, /System Audio By Salesperson/);
    assert.match(html, /Latest System Audio Proof/);

    const api = await fetch(`${baseUrl}/api/system-audio?subtype=call_screening`).then((response) => response.json());
    assert.equal(api.query.subtype, "call_screening");
    assert.equal(api.totals.encounters, 1);
    assert.equal(api.records[0].futureCallId, "screening-future");

    const proofHtml = await fetch(`${baseUrl}/drilldown?metric=calls.systemAudioRecovered`).then((response) => response.text());
    assert.match(proofHtml, /System audio proof/);
    assert.match(proofHtml, /Future call/);
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
  assert.match(html, /authoritative current outcome and summary/i);
  assert.match(html, /It is not the probability that payment or fulfilment occurred/);
});

test("Evaluation Studio presents Offer Acceptance outcomes and reportable rates instead of generic audit fields", () => {
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
});

test("Foundation result cards surface authoritative acceptance and always show Customer ID", () => {
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

  assert.match(html, /Customer accepted offer/);
  assert.match(html, /Authoritative Offer Acceptance/);
  assert.match(html, /95\.0%/);
  assert.match(html, /High confidence/);
  assert.match(html, /Model-reported confidence \(audit\)/);
  assert.match(html, /uncalibrated/);
  assert.match(html, /Customer ID:[\s\S]*customer-accepted-42/);
  assert.match(html, /Customer ID:[\s\S]*Not available/);
  assert.match(html, /Record summary/);
  assert.equal((html.match(/data-call-id="foundation-accepted-display"/g) || []).length, 1);
  assert.match(html, /2 evaluations:/);
  assert.match(html, /Evaluation Results Grouped by Call/);
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
    const drilldownHtml = await fetch(`${baseUrl}/drilldown?metric=calls.meaningfulConversation`).then((response) => response.text());
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
