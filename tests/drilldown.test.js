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
  assert.equal(result.rows[0].rawFields.dialled_phone_number, undefined);
  assert.equal(result.rows[0].rawFields.CustomerCreateDate, undefined);
  assert.equal(result.rows[0].rawFields.CustomerImportDate, undefined);
  assert.match(result.rows[0].transcript, /Please call me back later today/);
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

    const drilldownHtml = await fetch(`${baseUrl}/drilldown?metric=calls.unique`).then((response) => response.text());
    assert.match(drilldownHtml, /Unique Calls/);
    assert.match(drilldownHtml, /\/calls\/3/);
    assert.match(drilldownHtml, /Full JSON/);
    assert.match(drilldownHtml, /Proof/);
    assert.match(drilldownHtml, /Callback requested or promised/);
    assert.doesNotMatch(drilldownHtml, /Please call me back later today/);

    const callHtml = await fetch(`${baseUrl}/calls/3`).then((response) => response.text());
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
    assert.equal(store.managerReviews[0].status, "incorrect");
  });
});
