"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const { buildDrilldownResult } = require("../src/drilldown");
const { createServer } = require("../src/main");
const { readStore } = require("../src/storage");
const { saveLlmIntelligenceResult } = require("../src/intelligenceDatabase");

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
  assert.match(result.rows[0].transcript, /Please call me back later today/);
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
    assert.match(html, /Active range[\s\S]*2026-07-01 09:00:00 to 2026-07-01 09:00:00/);
    assert.match(html, /Source call time \(timezone not supplied\)/);
    assert.match(html, /Last processed[\s\S]*UTC/);
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
    assert.match(html, /Raw NoSaleType/);
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
    assert.match(callHtml, /Raw imported NoSaleType[\s\S]*Raw imported/);
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
    assert.match(html, /Raw NoSaleType/);
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
    assert.equal(drilldown.rows.find((row) => row.callId === "review-call").importedNoSaleRaw, "Not Interested");

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
    assert.match(callHtml, /Raw imported NoSaleType/);
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
    assert.equal(summary.dateRange.sourceStart, "2026-07-01 23:30:00");
    assert.equal(summary.dateRange.sourceEnd, "2026-07-01 23:30:00");
    assert.equal(summary.dateRange.sourceTimezoneLabel, "Source call time (timezone not supplied)");
    assert.ok(summary.filterSummary.activeFilters.some((entry) => entry.key === "customerImportSource" && entry.display === "Not supplied"));
    assert.ok(summary.dataWindow.warnings.some((warning) => warning.code === "single_day_dataset"));
    assert.ok(summary.dataWindow.warnings.some((warning) => warning.code === "partial_day_dataset"));

    const proof = await fetch(`${baseUrl}/api/drilldown?metric=calls.unique&${query}`).then((response) => response.json());
    assert.equal(proof.count, 1);
    assert.equal(proof.rows[0].callId, "missing-source");

    const html = await fetch(`${baseUrl}/?${query}`).then((response) => response.text());
    assert.match(html, /Source call time \(timezone not supplied\)/);
    assert.match(html, /2026-07-01 23:30:00/);
    assert.match(html, /Not supplied/);
    assert.match(html, /Raw NoSaleType missing/);
    assert.doesNotMatch(html, /2026-06-30|2026-07-02|30\/06\/2026|2\/07\/2026/);
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
    assert.match(callHtml, /Readable Transcript/);
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
