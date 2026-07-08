"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCsvText } = require("../src/analysis");
const {
  getIntelligenceSummary,
  openIntelligenceDb,
  listCallIntelligence,
  markLlmJobQueued,
  replaceImportIntelligence,
  saveLlmIntelligenceResult
} = require("../src/intelligenceDatabase");

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
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sales-dashboard-intelligence-")), "state.json");
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
    transcription_text: "Outbound call Customer: Please call me back later today after 3pm. Agent: I will call you back.",
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

test("SQLite intelligence database stores call and lead waste rollups", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "good",
      AllocatedLeadID: "lead-good",
      customer_id: "customer-good",
      Salesperson: "Riley Example",
      CustomerImportSource: "GoogleMaps",
      transcription_text: "Outbound call Customer: Please call me back later today after 3pm. Agent: I will call you back."
    }),
    row({
      call_id: "waste",
      AllocatedLeadID: "lead-waste",
      customer_id: "customer-waste",
      Salesperson: "Casey Example",
      CustomerImportSource: "ColdList",
      CallTotalSeconds: "8",
      call_duration_seconds: "6",
      transcription_text: "Outbound call No answer.",
      NoSaleType: "Did Not Answer"
    })
  ]));

  const persisted = replaceImportIntelligence(analysis, { storePath, importId: "import-test" });
  const summary = getIntelligenceSummary({ storePath, importId: "import-test" });
  const calls = listCallIntelligence({ storePath, importId: "import-test" });
  const wasteCalls = listCallIntelligence({ storePath, importId: "import-test", wasteRisk: "1" });

  assert.equal(persisted.callsIndexed, 2);
  assert.equal(summary.totals.callsIndexed, 2);
  assert.equal(summary.totals.leadsIndexed, 2);
  assert.equal(summary.totals.wasteRiskLeads, 1);
  assert.equal(summary.totals.highQualityLeads, 1);
  assert.equal(calls.length, 2);
  assert.equal(wasteCalls.length, 1);
  assert.equal(wasteCalls[0].call_id, "waste");
  assert.equal(wasteCalls[0].customer_id, "customer-waste");
  assert.equal(calls.some((call) => call.call_id === "good" && call.customer_id === "customer-good"), true);
  assert.equal(calls.some((call) => call.call_id === "good" && call.lead_utilization_score >= 4), true);
  assert.equal(calls.some((call) => call.call_id === "waste" && call.lead_utilization_score <= 1), true);
});

test("SQLite intelligence database stores deterministic AI call assistant events", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "ai-handled",
      transcription_text: "Outbound call Customer: Hi, I'm a call assistant recording this call. Please say who you are and why you're calling. Riley Example (CWA): Hi, this is Riley from Countrywide Austral. The reason for my call is the official journal for the local area. Please ask them to call me back."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-ai" });
  const db = openIntelligenceDb({ storePath });
  try {
    const events = db.prepare(`
      SELECT event_type, normalized_value
      FROM intelligence_events
      WHERE import_id = ? AND call_id = ? AND source = 'deterministic'
      ORDER BY id
    `).all("import-ai", "ai-handled");
    assert.equal(events.some((event) => event.event_type === "ai_call_assistant_encountered"), true);
    assert.equal(events.some((event) => event.event_type === "ai_assistant_handled_well"), true);
    assert.equal(events.some((event) => event.event_type === "ai_assistant_tactic" && event.normalized_value === "Explained reason"), true);
  } finally {
    db.close();
  }
});

test("SQLite intelligence database stores completed local LLM extraction results", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "llm-call",
      AllocatedLeadID: "lead-llm",
      transcription_text: "Customer: Send me the details by email. Agent: I will email the information now."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-llm" });
  markLlmJobQueued({ storePath, importId: "import-llm", callId: "llm-call", jobId: "job-llm-1" });
  const saved = saveLlmIntelligenceResult({
    storePath,
    importId: "import-llm",
    callId: "llm-call",
    jobId: "job-llm-1",
    result: {
      job: {
        output: JSON.stringify({
          call_summary: {
            decision_maker_status: "reached",
            customer_sentiment: "interested",
            brief_reason: "Customer requested information by email.",
            confidence: 0.91
          },
          entities: [
            {
              entity_type: "communication_channel",
              raw_value: "email",
              normalized_value: "email",
              speaker: "customer",
              evidence: "Send me the details by email.",
              confidence: 0.9
            }
          ],
          events: [
            {
              event_type: "customer_requested_email",
              speaker: "customer",
              raw_value: "email",
              follow_up_required: true,
              evidence: "Send me the details by email.",
              confidence: 0.93
            }
          ],
          risk_flags: []
        })
      }
    }
  });

  const calls = listCallIntelligence({ storePath, importId: "import-llm" });
  const db = openIntelligenceDb({ storePath });
  try {
    const entities = db.prepare("SELECT * FROM intelligence_entities WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-llm", "llm-call");
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-llm", "llm-call");
    const results = db.prepare("SELECT * FROM intelligence_llm_results WHERE import_id = ? AND call_id = ?").all("import-llm", "llm-call");

    assert.equal(saved.ok, true);
    assert.equal(calls[0].llm_status, "completed");
    assert.equal(calls[0].llm_job_id, "job-llm-1");
    assert.equal(calls[0].decision_maker_status, "reached");
    assert.equal(calls[0].customer_sentiment, "interested");
    assert.equal(entities.length, 1);
    assert.equal(events.length, 1);
    assert.equal(results.length, 1);
  } finally {
    db.close();
  }

});

test("SQLite intelligence database drops LLM payment intent when pay evidence is unrelated", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "llm-pay-mortgage",
      AllocatedLeadID: "lead-pay-mortgage",
      transcription_text: "Customer: I do not need the journal and I need to pay my mortgage."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-llm-pay-mortgage" });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-llm-pay-mortgage",
    callId: "llm-pay-mortgage",
    jobId: "job-llm-pay-mortgage-1",
    result: {
      call_summary: {
        customer_sentiment: "angry",
        brief_reason: "Customer complained about the call.",
        confidence: 0.84
      },
      entities: [],
      events: [
        {
          event_type: "payment_or_order_intent",
          speaker: "customer",
          raw_value: "pay",
          normalized_value: "pay",
          follow_up_required: true,
          evidence: "I do not need the journal and I need to pay my mortgage.",
          confidence: 0.76
        }
      ],
      risk_flags: []
    }
  });

  const db = openIntelligenceDb({ storePath });
  try {
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-llm-pay-mortgage", "llm-pay-mortgage");
    const result = db.prepare("SELECT result_json FROM intelligence_llm_results WHERE import_id = ? AND call_id = ?").get("import-llm-pay-mortgage", "llm-pay-mortgage");
    const payload = JSON.parse(result.result_json);
    assert.equal(events.length, 0);
    assert.equal(payload.events.some((event) => event.event_type === "payment_or_order_intent"), false);
    assert.ok(payload.limitations.some((item) => item.includes("Dropped payment_or_order_intent")));
  } finally {
    db.close();
  }
});

test("SQLite intelligence database keeps LLM payment intent when evidence shows offer order intent", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "llm-send-invoice",
      AllocatedLeadID: "lead-send-invoice",
      transcription_text: "Customer: Go ahead with the journal package and send me the invoice."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-llm-send-invoice" });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-llm-send-invoice",
    callId: "llm-send-invoice",
    jobId: "job-llm-send-invoice-1",
    result: {
      call_summary: {
        customer_sentiment: "interested",
        brief_reason: "Customer agreed to proceed and requested an invoice.",
        confidence: 0.9
      },
      entities: [],
      events: [
        {
          event_type: "payment_or_order_intent",
          speaker: "customer",
          raw_value: "go ahead with the journal package",
          normalized_value: "proceed",
          follow_up_required: true,
          evidence: "Go ahead with the journal package and send me the invoice.",
          confidence: 0.91
        }
      ],
      risk_flags: []
    }
  });

  const db = openIntelligenceDb({ storePath });
  try {
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-llm-send-invoice", "llm-send-invoice");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "payment_or_order_intent");
  } finally {
    db.close();
  }
});

test("SQLite intelligence database replaces stale LLM results for the same call", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "llm-replace-call",
      AllocatedLeadID: "lead-replace-call",
      transcription_text: "Customer: Go ahead with the journal package and send me the invoice."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-llm-replace" });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-llm-replace",
    callId: "llm-replace-call",
    jobId: "old-job",
    result: {
      call_summary: { brief_reason: "Old bad result.", confidence: 0.5 },
      entities: [],
      events: [
        {
          event_type: "payment_or_order_intent",
          raw_value: "pay",
          evidence: "pay",
          confidence: 0.5
        }
      ],
      risk_flags: []
    }
  });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-llm-replace",
    callId: "llm-replace-call",
    jobId: "new-job",
    result: {
      call_summary: { brief_reason: "New clean result.", confidence: 0.9 },
      entities: [],
      events: [
        {
          event_type: "customer_requested_invoice",
          raw_value: "send me the invoice",
          evidence: "Go ahead with the journal package and send me the invoice.",
          confidence: 0.9
        }
      ],
      risk_flags: []
    }
  });

  const db = openIntelligenceDb({ storePath });
  try {
    const resultRows = db.prepare("SELECT * FROM intelligence_llm_results WHERE import_id = ? AND call_id = ?").all("import-llm-replace", "llm-replace-call");
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-llm-replace", "llm-replace-call");
    const listed = listCallIntelligence({ storePath, importId: "import-llm-replace", callIds: "llm-replace-call" })[0];

    assert.equal(resultRows.length, 1);
    assert.equal(resultRows[0].job_id, "new-job");
    assert.match(resultRows[0].result_json, /New clean result/);
    assert.doesNotMatch(resultRows[0].result_json, /Old bad result/);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "customer_requested_invoice");
    assert.equal(listed.llm_job_id, "new-job");
    assert.match(listed.llm_result_json, /New clean result/);
  } finally {
    db.close();
  }
});

test("SQLite intelligence database parses wrapped raw local LLM JSON", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "raw-llm-call",
      AllocatedLeadID: "lead-raw-llm",
      transcription_text: "Customer: Please call tomorrow. Agent: I will call tomorrow."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-raw-llm" });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-raw-llm",
    callId: "raw-llm-call",
    jobId: "job-raw-llm-1",
    result: {
      raw: JSON.stringify({
        call_summary: {
          customer_sentiment: "interested",
          brief_reason: "Customer asked for a callback.",
          confidence: 0.88
        },
        entities: [],
        events: [
          {
            event_type: "customer_requested_callback",
            speaker: "customer",
            raw_value: "Please call tomorrow",
            follow_up_required: true,
            evidence: "Customer: Please call tomorrow.",
            confidence: 0.9
          }
        ],
        risk_flags: [],
        limitations: []
      })
    }
  });

  const db = openIntelligenceDb({ storePath });
  try {
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-raw-llm", "raw-llm-call");
    const call = listCallIntelligence({ storePath, importId: "import-raw-llm", llmStatus: "completed" })[0];
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "customer_requested_callback");
    assert.equal(call.customer_sentiment, "interested");
  } finally {
    db.close();
  }

});

test("SQLite intelligence database salvages useful fields from truncated local LLM JSON", () => {
  const storePath = tempStorePath();
  const analysis = analyzeCsvText(csv([
    row({
      call_id: "truncated-llm-call",
      AllocatedLeadID: "lead-truncated-llm",
      transcription_text: "Customer: I am unhappy with the service. Agent: I will ask a manager to review this."
    })
  ]));

  replaceImportIntelligence(analysis, { storePath, importId: "import-truncated-llm" });
  saveLlmIntelligenceResult({
    storePath,
    importId: "import-truncated-llm",
    callId: "truncated-llm-call",
    jobId: "job-truncated-llm-1",
    result: {
      raw: `{
        "call_summary": {
          "customer_sentiment": "annoyed",
          "manager_review_required": true,
          "brief_reason": "Customer complaint needs manager review.",
          "confidence": 0.84
        },
        "entities": [],
        "events": [
          {
            "event_type": "manager_review_promised",
            "speaker": "salesperson",
            "raw_value": "manager to review",
            "follow_up_required": true,
            "evidence": "I will ask a manager to review this.",
            "confidence": 0.82
          }
        ],
        "risk_flags": [
          { "flag_type": "customer_complaint", "severity": "high", "speaker": "customer", "evidence": "I am unhappy"`
    }
  });

  const db = openIntelligenceDb({ storePath });
  try {
    const call = listCallIntelligence({ storePath, importId: "import-truncated-llm", llmStatus: "completed" })[0];
    const events = db.prepare("SELECT * FROM intelligence_events WHERE import_id = ? AND call_id = ? AND source = 'llm'").all("import-truncated-llm", "truncated-llm-call");
    const result = db.prepare("SELECT * FROM intelligence_llm_results WHERE import_id = ? AND call_id = ?").get("import-truncated-llm", "truncated-llm-call");

    assert.equal(call.customer_sentiment, "annoyed");
    assert.equal(call.manager_review_required, 1);
    assert.equal(call.llm_confidence, 0.84);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "manager_review_promised");
    assert.match(result.result_json, /Customer complaint needs manager review/);
  } finally {
    db.close();
  }

  replaceImportIntelligence(analysis, { storePath, importId: "import-truncated-llm" });
  const rebuiltCall = listCallIntelligence({ storePath, importId: "import-truncated-llm", llmStatus: "completed" })[0];
  assert.equal(rebuiltCall.manager_review_required, 1);
  assert.equal(rebuiltCall.risk_flag_exists, 1);
  assert.equal(rebuiltCall.llm_confidence, 0.84);
});
