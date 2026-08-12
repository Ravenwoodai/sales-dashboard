"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readTabularFileColumns } = require("../src/sourceFile");
const { evaluateCall } = require("../src/transcriptEvaluator");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? (index += 1, next) : true;
  }
  return result;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const ARGS = parseArgs(process.argv.slice(2));
for (const required of ["current-report", "source-config", "trend-history", "output"]) {
  if (!ARGS[required]) throw new Error(`Missing required --${required} argument.`);
}
const CURRENT_REPORT_PATH = path.resolve(String(ARGS["current-report"]));
const SOURCE_CONFIG_PATH = path.resolve(String(ARGS["source-config"]));
const TREND_HISTORY_PATH = path.resolve(String(ARGS["trend-history"]));
const OUTPUT_PATH = path.resolve(String(ARGS.output));
const LEAD_TYPE_SCOPE = clean(ARGS["lead-type-scope"]);
const CURRENT_REPORT = JSON.parse(fs.readFileSync(CURRENT_REPORT_PATH, "utf8"));
const SOURCE_CONFIG = JSON.parse(fs.readFileSync(SOURCE_CONFIG_PATH, "utf8"));
const TREND_HISTORY = JSON.parse(fs.readFileSync(TREND_HISTORY_PATH, "utf8"));
const CURRENT_START = CURRENT_REPORT.reportingPeriod?.startDate;
const CURRENT_END = CURRENT_REPORT.reportingPeriod?.endDate;
const POLICY_KEY = CURRENT_REPORT.ongoingTrends?.policyKey;
if (!CURRENT_START || !CURRENT_END || !POLICY_KEY) {
  throw new Error("Current Lead Utilisation report is missing its reporting period or exclusion-policy key.");
}

const latestByPeriod = new Map();
for (const snapshot of TREND_HISTORY.snapshots || []) {
  if (!snapshot.qaPassed || snapshot.exclusionPolicy?.key !== POLICY_KEY) continue;
  if (!snapshot.period?.startDate || snapshot.period.startDate > CURRENT_START) continue;
  latestByPeriod.set(snapshot.period.startDate, snapshot);
}
const selectedSnapshots = [...latestByPeriod.values()]
  .sort((a, b) => a.period.startDate.localeCompare(b.period.startDate))
  .slice(-3);
if (selectedSnapshots.length !== 3 || selectedSnapshots.at(-1)?.period?.startDate !== CURRENT_START) {
  throw new Error("Call Activity requires the current Lead Utilisation snapshot and two prior QA-passed weeks under the same exclusion policy.");
}

const weeklyCallSources = (SOURCE_CONFIG.callSources || [])
  .filter((source) => source.role === "weekly_supplement" && source.path)
  .map((source) => ({ ...source, path: path.resolve(String(source.path)) }));
const WEEKS = selectedSnapshots.map((snapshot) => {
  const start = snapshot.period.startDate;
  const end = snapshot.period.endDate;
  const sourceEnd = addDays(start, 6);
  const pattern = new RegExp(`WeeklyCallExport_${start}_to_${sourceEnd}(?:_[A-Fa-f0-9]+)?\\.csv$`);
  const matches = weeklyCallSources.filter((source) => pattern.test(path.basename(source.path)) && fs.existsSync(source.path));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one retained weekly call source for ${start} to ${sourceEnd}; found ${matches.length}.`);
  }
  return { start, end, sourceEnd, calls: matches[0].path, snapshot };
});
const FIELDS = [
  "call_id", "call_date", "call_time", "Salesperson", "call_direction", "CallType",
  "CallTotalSeconds", "ring_time_seconds", "call_duration_seconds", "AllocatedLeadID",
  "transcription_text", "ReportLeadType",
];
const LITERAL_NO_CONTACT = new Set(["no_answer", "voicemail", "system_audio"]);

function clean(value) {
  return String(value ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
}

function key(value) {
  return clean(value).toLowerCase();
}

function isoDate(value) {
  const text = clean(value);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  // Parameterized weekly exports use the proven month-first slash convention.
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function clock(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const ampm = (match[4] || "").toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second, minuteOfDay: hour * 60 + minute + second / 60 };
}

function number(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function direction(value) {
  const text = key(value);
  if (text === "out" || text === "outbound" || text.includes("outbound")) return "outbound";
  if (text === "in" || text === "inbound" || text.includes("inbound")) return "inbound";
  return text || "unknown";
}

function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function round(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(digits));
}

function distribution(values) {
  return {
    count: values.length,
    mean: round(mean(values), 1),
    p10: round(quantile(values, 0.10), 1),
    p25: round(quantile(values, 0.25), 1),
    median: round(quantile(values, 0.50), 1),
    p75: round(quantile(values, 0.75), 1),
    p90: round(quantile(values, 0.90), 1),
    p95: round(quantile(values, 0.95), 1),
    p99: round(quantile(values, 0.99), 1),
    max: values.length ? Math.max(...values) : null,
  };
}

function frequency(rows, getter) {
  const counts = new Map();
  rows.forEach((row) => {
    const label = getter(row);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function loadWeek(definition) {
  const report = definition.snapshot;
  const roster = new Map(report.people.map((item) => [key(item.salesperson), {
    salesperson: clean(item.salesperson),
    manager: clean(item.manager) || "Unknown",
  }]));
  const parsed = readTabularFileColumns(definition.calls, FIELDS);
  const seen = new Map();
  let duplicateRows = 0;
  let duplicateConflicts = 0;
  let missingCallId = 0;
  for (const raw of parsed.rows) {
    const callId = clean(raw.call_id);
    if (!callId) {
      missingCallId += 1;
      continue;
    }
    if (seen.has(callId)) {
      duplicateRows += 1;
      const prior = seen.get(callId);
      const fingerprint = (row) => FIELDS.map((field) => clean(row[field])).join("\u0000");
      if (fingerprint(prior) !== fingerprint(raw)) duplicateConflicts += 1;
      continue;
    }
    seen.set(callId, raw);
  }
  const uniqueRows = [...seen.values()];
  const directionCounts = frequency(uniqueRows, (row) => direction(row.call_direction));
  const typeCounts = frequency(uniqueRows, (row) => clean(row.CallType) || "Unknown").slice(0, 20);
  let invalidDate = 0;
  let invalidTime = 0;
  let invalidDuration = 0;
  let relationEligible = 0;
  let relationMatches = 0;
  let policyExcludedOutboundCalls = 0;
  const calls = [];
  for (const raw of uniqueRows) {
    const date = isoDate(raw.call_date);
    const time = clock(raw.call_time);
    const talk = number(raw.call_duration_seconds);
    const ring = number(raw.ring_time_seconds);
    const total = number(raw.CallTotalSeconds);
    if (!date) invalidDate += 1;
    if (!time) invalidTime += 1;
    if (talk === null) invalidDuration += 1;
    if (talk !== null && ring !== null && total !== null) {
      relationEligible += 1;
      if (Math.abs(total - ring - talk) < 0.0001) relationMatches += 1;
    }
    if (!date || !time || date < definition.start || date > definition.end) continue;
    if (LEAD_TYPE_SCOPE && clean(raw.ReportLeadType) !== LEAD_TYPE_SCOPE) continue;
    const person = roster.get(key(raw.Salesperson));
    if (!person || direction(raw.call_direction) !== "outbound") {
      if (direction(raw.call_direction) === "outbound") policyExcludedOutboundCalls += 1;
      continue;
    }
    const contactClassification = clean(evaluateCall(raw).contact?.classification) || "unknown";
    calls.push({
      callId: clean(raw.call_id),
      date,
      hour: time.hour,
      minuteOfDay: time.minuteOfDay,
      person: person.salesperson,
      personKey: key(person.salesperson),
      manager: person.manager,
      talk,
      ring,
      total,
      callType: clean(raw.CallType) || "Unknown",
      allocatedLeadIdPresent: Boolean(clean(raw.AllocatedLeadID)),
      contactClassification,
      literalNoContact: LITERAL_NO_CONTACT.has(contactClassification),
      transcriptPresent: Boolean(clean(raw.transcription_text)),
    });
  }
  return {
    ...definition,
    report,
    roster,
    calls,
    quality: {
      sourceRows: parsed.rows.length,
      uniqueCallIds: uniqueRows.length,
      duplicateRows,
      duplicateConflicts,
      missingCallId,
      invalidDate,
      invalidTime,
      invalidDuration,
      durationRelationEligible: relationEligible,
      durationRelationMatches: relationMatches,
      durationRelationMatchRate: round(rate(relationMatches, relationEligible), 6),
      directionCounts,
      topCallTypes: typeCounts,
      reportRosterPeople: roster.size,
      includedMondayFridayOutboundCalls: calls.length,
      policyExcludedOutboundCalls,
      expectedReportOutboundCalls: report.overall.outboundCalls,
      reportReconciliation: calls.length === report.overall.outboundCalls,
    },
  };
}

function groupBy(rows, getter) {
  const groups = new Map();
  rows.forEach((row) => {
    const groupKey = getter(row);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  });
  return groups;
}

function formatMinute(minute) {
  if (minute === null || minute === undefined) return null;
  const rounded = Math.round(minute);
  const hour = Math.floor(rounded / 60) % 24;
  const mins = rounded % 60;
  return `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function metrics(rows) {
  const observed = rows.filter((row) => row.talk !== null);
  const positive = observed.filter((row) => row.talk > 0);
  const positiveDurations = positive.map((row) => row.talk);
  const nonLiteral = observed.filter((row) => !row.literalNoContact);
  const nonLiteralPositive = nonLiteral.filter((row) => row.talk > 0);
  const nonLiteralPositiveDurations = nonLiteralPositive.map((row) => row.talk);
  const literalNoContact = observed.filter((row) => row.literalNoContact);
  const calendarDayCount = new Set(rows.map((row) => row.date)).size;
  const days = groupBy(rows, (row) => `${row.personKey}\u0000${row.date}`);
  const dayMetrics = [];
  const allInterCallGapSeconds = [];
  const velocityQuartiles = [0, 0, 0, 0];
  const velocityPositive = [0, 0, 0, 0];
  const velocityShort = [0, 0, 0, 0];
  let eligibleVelocityDays = 0;
  for (const [, dayRowsUnsorted] of days.entries()) {
    const date = dayRowsUnsorted[0].date;
    const dayRows = [...dayRowsUnsorted].sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    const first = dayRows[0].minuteOfDay;
    const last = dayRows[dayRows.length - 1].minuteOfDay;
    const spanMinutes = Math.max(0, last - first);
    const coreFirst = quantile(dayRows.map((row) => row.minuteOfDay), 0.05);
    const coreLast = quantile(dayRows.map((row) => row.minuteOfDay), 0.95);
    const coreSpanMinutes = Math.max(0, coreLast - coreFirst);
    const coreRows = dayRows.filter((row) => row.minuteOfDay >= coreFirst && row.minuteOfDay <= coreLast);
    const gaps = dayRows.slice(1).map((row, index) => row.minuteOfDay - dayRows[index].minuteOfDay);
    allInterCallGapSeconds.push(...gaps.map((gap) => gap * 60));
    const slots15 = frequency(dayRows, (row) => String(Math.floor(row.minuteOfDay / 15))).map((item) => item.count);
    let longestShortRun = 0;
    let currentShortRun = 0;
    let longestVeryShortOrZeroRun = 0;
    let currentVeryShortOrZeroRun = 0;
    for (const row of dayRows) {
      currentShortRun = row.talk > 0 && row.talk < 30 ? currentShortRun + 1 : 0;
      currentVeryShortOrZeroRun = row.talk !== null && row.talk <= 10 ? currentVeryShortOrZeroRun + 1 : 0;
      longestShortRun = Math.max(longestShortRun, currentShortRun);
      longestVeryShortOrZeroRun = Math.max(longestVeryShortOrZeroRun, currentVeryShortOrZeroRun);
    }
    const quartiles = [0, 0, 0, 0];
    const qPositive = [0, 0, 0, 0];
    const qShort = [0, 0, 0, 0];
    if (dayRows.length >= 20 && coreSpanMinutes >= 240) {
      eligibleVelocityDays += 1;
      for (const row of coreRows) {
        const relative = coreSpanMinutes ? (row.minuteOfDay - coreFirst) / coreSpanMinutes : 0;
        const q = Math.min(3, Math.floor(relative * 4));
        quartiles[q] += 1;
        velocityQuartiles[q] += 1;
        if (row.talk > 0) {
          qPositive[q] += 1;
          velocityPositive[q] += 1;
          if (row.talk < 30) {
            qShort[q] += 1;
            velocityShort[q] += 1;
          }
        }
      }
    }
    dayMetrics.push({
      date,
      calls: dayRows.length,
      firstMinute: first,
      lastMinute: last,
      spanHours: spanMinutes / 60,
      coreStartMinute: coreFirst,
      coreEndMinute: coreLast,
      coreSpanHours: coreSpanMinutes / 60,
      longestGapMinutes: gaps.length ? Math.max(...gaps) : 0,
      gapsAtLeast60Minutes: gaps.filter((gap) => gap >= 60).length,
      maxCallsIn15Minutes: slots15.length ? Math.max(...slots15) : 0,
      longestShortPositiveRun: longestShortRun,
      longestVeryShortOrZeroRun,
      velocityQuartiles: quartiles,
      q1ToQ4VelocityRatio: rate(quartiles[3], quartiles[0]),
      q1PositiveRate: rate(qPositive[0], quartiles[0]),
      q4PositiveRate: rate(qPositive[3], quartiles[3]),
      q1ShortPositiveShare: rate(qShort[0], qPositive[0]),
      q4ShortPositiveShare: rate(qShort[3], qPositive[3]),
    });
  }
  const hourly = [];
  for (let hour = 6; hour <= 20; hour += 1) {
    const hourRows = rows.filter((row) => row.hour === hour);
    const hourPositive = hourRows.filter((row) => row.talk > 0);
    hourly.push({
      hour,
      calls: hourRows.length,
      share: round(rate(hourRows.length, rows.length), 5),
      positiveRate: round(rate(hourPositive.length, hourRows.length), 5),
      shortPositiveShare: round(rate(hourPositive.filter((row) => row.talk < 30).length, hourPositive.length), 5),
      medianPositiveSeconds: round(quantile(hourPositive.map((row) => row.talk), 0.5), 1),
    });
  }
  const halfHourly = [];
  for (let slot = 12; slot <= 41; slot += 1) {
    const slotRows = rows.filter((row) => Math.floor(row.minuteOfDay / 30) === slot);
    const slotPositive = slotRows.filter((row) => row.talk > 0);
    halfHourly.push({
      time: formatMinute(slot * 30),
      calls: slotRows.length,
      callsPerActiveDay: round(rate(slotRows.length, calendarDayCount), 2),
      positiveRate: round(rate(slotPositive.length, slotRows.length), 5),
      shortPositiveShare: round(rate(slotPositive.filter((row) => row.talk < 30).length, slotPositive.length), 5),
    });
  }
  const q1 = velocityQuartiles[0];
  const q4 = velocityQuartiles[3];
  return {
    calls: rows.length,
    durationObserved: observed.length,
    positiveDurationCalls: positive.length,
    zeroDurationCalls: observed.filter((row) => row.talk === 0).length,
    zeroDurationRate: round(rate(observed.filter((row) => row.talk === 0).length, observed.length), 5),
    positiveDurationRate: round(rate(positive.length, observed.length), 5),
    transcriptPresentCalls: observed.filter((row) => row.transcriptPresent).length,
    transcriptPresentRate: round(rate(observed.filter((row) => row.transcriptPresent).length, observed.length), 5),
    positiveDurationTranscriptRate: round(rate(positive.filter((row) => row.transcriptPresent).length, positive.length), 5),
    literalNoContactCalls: literalNoContact.length,
    literalNoContactShare: round(rate(literalNoContact.length, observed.length), 5),
    literalNoContactBreakdown: frequency(literalNoContact, (row) => row.contactClassification),
    contactClassificationBreakdown: frequency(observed, (row) => row.contactClassification),
    nonLiteralCalls: nonLiteral.length,
    nonLiteralPositiveCalls: nonLiteralPositive.length,
    nonLiteralPositiveRate: round(rate(nonLiteralPositive.length, nonLiteral.length), 5),
    veryShortPositiveCalls: positive.filter((row) => row.talk <= 10).length,
    veryShortPositiveShare: round(rate(positive.filter((row) => row.talk <= 10).length, positive.length), 5),
    shortPositiveCalls: positive.filter((row) => row.talk < 30).length,
    shortPositiveShare: round(rate(positive.filter((row) => row.talk < 30).length, positive.length), 5),
    shortPositiveTranscriptRate: round(rate(
      positive.filter((row) => row.talk < 30 && row.transcriptPresent).length,
      positive.filter((row) => row.talk < 30).length,
    ), 5),
    shortPositiveLiteralNoContactCalls: positive.filter((row) => row.talk < 30 && row.literalNoContact).length,
    shortPositiveLiteralNoContactShare: round(rate(
      positive.filter((row) => row.talk < 30 && row.literalNoContact).length,
      positive.filter((row) => row.talk < 30).length,
    ), 5),
    nonLiteralShortPositiveCalls: nonLiteralPositive.filter((row) => row.talk < 30).length,
    nonLiteralShortPositiveShare: round(rate(nonLiteralPositive.filter((row) => row.talk < 30).length, nonLiteralPositive.length), 5),
    long5MinuteCalls: positive.filter((row) => row.talk >= 300).length,
    long5MinuteShare: round(rate(positive.filter((row) => row.talk >= 300).length, positive.length), 5),
    long5MinuteTranscriptRate: round(rate(
      positive.filter((row) => row.talk >= 300 && row.transcriptPresent).length,
      positive.filter((row) => row.talk >= 300).length,
    ), 5),
    long10MinuteCalls: positive.filter((row) => row.talk >= 600).length,
    long10MinuteShare: round(rate(positive.filter((row) => row.talk >= 600).length, positive.length), 5),
    extreme20MinuteCalls: positive.filter((row) => row.talk >= 1200).length,
    extreme20MinuteShare: round(rate(positive.filter((row) => row.talk >= 1200).length, positive.length), 5),
    totalTalkHours: round(positiveDurations.reduce((sum, value) => sum + value, 0) / 3600, 2),
    allDurationDistribution: distribution(observed.map((row) => row.talk)),
    positiveDurationDistribution: distribution(positiveDurations),
    nonLiteralPositiveDurationDistribution: distribution(nonLiteralPositiveDurations),
    ringDurationDistribution: distribution(rows.map((row) => row.ring).filter((value) => value !== null)),
    activeDays: calendarDayCount,
    personDays: days.size,
    callsPerActiveDay: round(rate(rows.length, calendarDayCount), 1),
    callsPerPersonDay: round(rate(rows.length, days.size), 1),
    medianFirstCallTime: formatMinute(quantile(dayMetrics.map((day) => day.firstMinute), 0.5)),
    medianLastCallTime: formatMinute(quantile(dayMetrics.map((day) => day.lastMinute), 0.5)),
    medianActiveSpanHours: round(quantile(dayMetrics.map((day) => day.spanHours), 0.5), 2),
    medianCoreActiveSpanHours: round(quantile(dayMetrics.map((day) => day.coreSpanHours), 0.5), 2),
    medianLongestGapMinutes: round(quantile(dayMetrics.map((day) => day.longestGapMinutes), 0.5), 1),
    daysWith60MinuteGap: dayMetrics.filter((day) => day.gapsAtLeast60Minutes > 0).length,
    interCallStartGapDistributionSeconds: distribution(allInterCallGapSeconds),
    rapidStartGapUnder60SecondsRate: round(rate(allInterCallGapSeconds.filter((gap) => gap < 60).length, allInterCallGapSeconds.length), 5),
    rapidStartGapUnder120SecondsRate: round(rate(allInterCallGapSeconds.filter((gap) => gap < 120).length, allInterCallGapSeconds.length), 5),
    medianDailyMaxCallsIn15Minutes: round(quantile(dayMetrics.map((day) => day.maxCallsIn15Minutes), 0.5), 1),
    maximumCallsIn15Minutes: dayMetrics.length ? Math.max(...dayMetrics.map((day) => day.maxCallsIn15Minutes)) : 0,
    medianDailyLongestShortPositiveRun: round(quantile(dayMetrics.map((day) => day.longestShortPositiveRun), 0.5), 1),
    maximumShortPositiveRun: dayMetrics.length ? Math.max(...dayMetrics.map((day) => day.longestShortPositiveRun)) : 0,
    medianDailyLongestVeryShortOrZeroRun: round(quantile(dayMetrics.map((day) => day.longestVeryShortOrZeroRun), 0.5), 1),
    maximumVeryShortOrZeroRun: dayMetrics.length ? Math.max(...dayMetrics.map((day) => day.longestVeryShortOrZeroRun)) : 0,
    outside0830To1730Calls: rows.filter((row) => row.minuteOfDay < 510 || row.minuteOfDay >= 1050).length,
    outside0830To1730Share: round(rate(rows.filter((row) => row.minuteOfDay < 510 || row.minuteOfDay >= 1050).length, rows.length), 5),
    clickToDialCalls: rows.filter((row) => key(row.callType) === "click to dial").length,
    manualCalls: rows.filter((row) => key(row.callType) === "manual call").length,
    manualCallShare: round(rate(rows.filter((row) => key(row.callType) === "manual call").length, rows.length), 5),
    eligibleVelocityDays,
    velocityQuartileCalls: velocityQuartiles,
    lateToEarlyVelocityRatio: round(rate(q4, q1), 4),
    q1PositiveRate: round(rate(velocityPositive[0], q1), 5),
    q4PositiveRate: round(rate(velocityPositive[3], q4), 5),
    q1ShortPositiveShare: round(rate(velocityShort[0], velocityPositive[0]), 5),
    q4ShortPositiveShare: round(rate(velocityShort[3], velocityPositive[3]), 5),
    lateVelocityCollapseDays: dayMetrics.filter((day) => day.q1ToQ4VelocityRatio !== null && day.q1ToQ4VelocityRatio < 0.6).length,
    allocatedLeadIdPresentCalls: rows.filter((row) => row.allocatedLeadIdPresent).length,
    allocatedLeadIdPresentShare: round(rate(rows.filter((row) => row.allocatedLeadIdPresent).length, rows.length), 5),
    hourly,
    halfHourly,
    dayMetrics,
  };
}

function summaryMetric(metric) {
  const copy = { ...metric };
  delete copy.hourly;
  delete copy.halfHourly;
  delete copy.dayMetrics;
  return copy;
}

function metricRows(week) {
  return [...groupBy(week.calls, (row) => row.personKey).entries()].map(([personKey, rows]) => ({
    personKey,
    salesperson: rows[0].person,
    manager: rows[0].manager,
    ...metrics(rows),
  }));
}

function dailyTotals(rows) {
  return [...groupBy(rows, (row) => row.date).entries()]
    .map(([date, dayRows]) => {
      const observed = dayRows.filter((row) => row.talk !== null);
      const positive = observed.filter((row) => row.talk > 0);
      return {
        date,
        calls: dayRows.length,
        salespeople: new Set(dayRows.map((row) => row.personKey)).size,
        positiveDurationRate: round(rate(positive.length, observed.length), 5),
        shortPositiveShare: round(rate(positive.filter((row) => row.talk < 30).length, positive.length), 5),
        literalNoContactShare: round(rate(observed.filter((row) => row.literalNoContact).length, observed.length), 5),
        talkHours: round(positive.reduce((sum, row) => sum + row.talk, 0) / 3600, 2),
        hourlyCalls: frequency(dayRows, (row) => String(row.hour)).map((item) => ({ hour: Number(item.label), calls: item.count })).sort((a, b) => a.hour - b.hour),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function baseline(current, priorByWeek) {
  const qualifies = (row) => Boolean(row && row.calls >= 100 && row.nonLiteralPositiveCalls >= 20 && row.activeDays >= 3);
  const eligibleHistory = priorByWeek.filter(qualifies);
  const previous = priorByWeek[priorByWeek.length - 1];
  const prior = qualifies(previous) ? [previous] : [];
  const avg = (field) => mean(prior.map((row) => row[field]).filter((value) => value !== null));
  const delta = (value, priorValue, digits) => priorValue === null ? null : round(value - priorValue, digits);
  const priorMedianPositive = mean(prior.map((row) => row.positiveDurationDistribution.median).filter((value) => value !== null));
  const priorNonLiteralMedian = mean(prior.map((row) => row.nonLiteralPositiveDurationDistribution.median).filter((value) => value !== null));
  return {
    priorWeeks: eligibleHistory.length,
    previousComparable: prior.length === 1,
    callsPerActiveDayDelta: delta(current.callsPerActiveDay, avg("callsPerActiveDay"), 1),
    medianPositiveDurationDeltaSeconds: delta(current.positiveDurationDistribution.median, priorMedianPositive, 1),
    nonLiteralMedianPositiveDurationDeltaSeconds: delta(current.nonLiteralPositiveDurationDistribution.median, priorNonLiteralMedian, 1),
    shortPositiveShareDelta: delta(current.shortPositiveShare, avg("shortPositiveShare"), 5),
    nonLiteralShortPositiveShareDelta: delta(current.nonLiteralShortPositiveShare, avg("nonLiteralShortPositiveShare"), 5),
    zeroDurationRateDelta: delta(current.zeroDurationRate, avg("zeroDurationRate"), 5),
    literalNoContactShareDelta: delta(current.literalNoContactShare, avg("literalNoContactShare"), 5),
    long5MinuteShareDelta: delta(current.long5MinuteShare, avg("long5MinuteShare"), 5),
    lateToEarlyVelocityRatioDelta: delta(current.lateToEarlyVelocityRatio, avg("lateToEarlyVelocityRatio"), 4),
  };
}

function rank(rows, field, directionMultiplier = -1, eligibility = () => true, limit = 10) {
  return rows
    .filter((row) => eligibility(row) && row[field] !== null && row[field] !== undefined)
    .sort((a, b) => directionMultiplier * (a[field] - b[field]) || a.salesperson.localeCompare(b.salesperson))
    .slice(0, limit)
    .map((row) => ({
      salesperson: row.salesperson,
      manager: row.manager,
      calls: row.calls,
      positiveDurationCalls: row.positiveDurationCalls,
      activeDays: row.activeDays,
      value: row[field],
      priorDelta: row.priorBaseline || null,
    }));
}

const weeks = WEEKS.map(loadWeek);
const weekMetrics = weeks.map((week) => {
  const people = metricRows(week);
  const teams = [...groupBy(week.calls, (row) => row.manager).entries()].map(([manager, rows]) => ({
    manager,
    ...metrics(rows),
  }));
  return {
    period: `${week.start}_to_${week.end}`,
    start: week.start,
    end: week.end,
    quality: week.quality,
    overall: metrics(week.calls),
    people,
    teams,
  };
});

const current = weekMetrics[weekMetrics.length - 1];
const prior = weekMetrics.slice(0, -1);
const priorMaps = prior.map((week) => new Map(week.people.map((row) => [row.personKey, row])));
for (const row of current.people) row.priorBaseline = baseline(row, priorMaps.map((map) => map.get(row.personKey)));

const personEligibility = (row) => row.calls >= 100 && row.nonLiteralPositiveCalls >= 20 && row.activeDays >= 3;
const velocityEligibility = (row) => personEligibility(row) && row.eligibleVelocityDays >= 3;
const comparisonEligibility = (row) => personEligibility(row) && row.priorBaseline?.previousComparable;
const result = {
  schemaVersion: "call_activity_analysis.v1",
  generatedAt: new Date().toISOString(),
  scope: {
    periods: WEEKS.map((week) => [week.start, week.end]),
    currentPeriod: [WEEKS.at(-1).start, WEEKS.at(-1).end],
    callSourceEnvelopeEnds: WEEKS.map((week) => week.sourceEnd),
    exclusionPolicyKey: POLICY_KEY,
    leadType: LEAD_TYPE_SCOPE || null,
    population: `${LEAD_TYPE_SCOPE ? `${LEAD_TYPE_SCOPE} only. ` : ""}Monday-Friday outbound calls for the exact salesperson roster retained by each Lead Utilisation report. Excluded: ${CURRENT_REPORT.exclusions?.display || "the Lead Utilisation exclusion policy"}.`,
    durationDefinition: "call_duration_seconds; zero is kept separate and positive duration is not treated as proof of human contact",
    sampleGate: "100+ outbound calls, 20+ positive-duration calls and 3+ active days; velocity also requires 3+ person-days with 20+ calls across a 4+ hour active span",
  },
  weeks: weekMetrics.map((week) => ({
    ...week,
    overall: summaryMetric(week.overall),
    people: week.people.map((row) => ({ ...summaryMetric(row), dayMetrics: undefined })),
    teams: week.teams.map(summaryMetric),
  })),
  currentHourly: current.overall.hourly,
  currentHalfHourly: current.overall.halfHourly,
  currentDaily: dailyTotals(weeks[weeks.length - 1].calls),
  currentTeams: current.teams.map((row) => ({ manager: row.manager, ...summaryMetric(row) })),
  currentPeople: current.people.map((row) => ({ ...summaryMetric(row), hourly: row.hourly, halfHourly: row.halfHourly })),
  reviewSignals: {
    qualifiedPeople: current.people.filter(personEligibility).length,
    velocityQualifiedPeople: current.people.filter(velocityEligibility).length,
    lowestMedianPositiveDuration: rank(current.people, "positiveDurationDistribution", -1),
    highestShortPositiveShare: rank(current.people, "shortPositiveShare", -1, personEligibility),
    highestNonLiteralShortPositiveShare: rank(current.people, "nonLiteralShortPositiveShare", -1, personEligibility),
    highestVeryShortPositiveShare: rank(current.people, "veryShortPositiveShare", -1, personEligibility),
    highestZeroDurationRate: rank(current.people, "zeroDurationRate", -1, personEligibility),
    highestLiteralNoContactShare: rank(current.people, "literalNoContactShare", -1, personEligibility),
    highestLong5MinuteShare: rank(current.people, "long5MinuteShare", -1, personEligibility),
    lowestLateToEarlyVelocityRatio: rank(current.people, "lateToEarlyVelocityRatio", 1, velocityEligibility),
    largestNonLiteralShortShareRegressionVsPrior: rank(current.people.map((row) => ({ ...row, shortShareDelta: row.priorBaseline.nonLiteralShortPositiveShareDelta })), "shortShareDelta", -1, comparisonEligibility),
    largestNonLiteralDurationRegressionVsPrior: rank(current.people.map((row) => ({ ...row, durationDelta: row.priorBaseline.nonLiteralMedianPositiveDurationDeltaSeconds })), "durationDelta", 1, comparisonEligibility),
    largestCallsPerDayRegressionVsPrior: rank(current.people.map((row) => ({ ...row, callsPerDayDelta: row.priorBaseline.callsPerActiveDayDelta })), "callsPerDayDelta", 1, comparisonEligibility),
  },
  caveats: [
    "Positive call duration is telephony activity evidence, not proof that a human answered or that a quality conversation occurred.",
    "A low late-day call count can reflect rostered hours, leave, meetings, coaching, administration or lead availability; it is a review prompt, not proof of fatigue.",
    "Long calls may be strong conversations, voicemail/system audio, holds or recording anomalies; duration alone cannot score quality.",
    "Only three comparable retained weeks exist, so personal change signals are provisional and are not statistical outlier claims.",
    "Call clocks are interpreted as the source AEST wall-clock convention used by the existing report model.",
  ],
};

// Replace the one nested distribution field with its median for the requested rank.
result.reviewSignals.lowestMedianPositiveDuration = current.people
  .filter(personEligibility)
  .sort((a, b) => a.positiveDurationDistribution.median - b.positiveDurationDistribution.median || a.salesperson.localeCompare(b.salesperson))
  .slice(0, 10)
  .map((row) => ({
    salesperson: row.salesperson,
    manager: row.manager,
    calls: row.calls,
    positiveDurationCalls: row.positiveDurationCalls,
    activeDays: row.activeDays,
    value: row.positiveDurationDistribution.median,
    priorDelta: row.priorBaseline,
  }));
result.reviewSignals.lowestNonLiteralMedianPositiveDuration = current.people
  .filter(personEligibility)
  .sort((a, b) => a.nonLiteralPositiveDurationDistribution.median - b.nonLiteralPositiveDurationDistribution.median || a.salesperson.localeCompare(b.salesperson))
  .slice(0, 10)
  .map((row) => ({
    salesperson: row.salesperson,
    manager: row.manager,
    calls: row.calls,
    positiveDurationCalls: row.nonLiteralPositiveCalls,
    activeDays: row.activeDays,
    value: row.nonLiteralPositiveDurationDistribution.median,
    priorDelta: row.priorBaseline,
  }));

const qualityFailures = weeks.flatMap((week) => {
  const checks = [];
  if (!week.quality.reportReconciliation) checks.push(`${week.start}: outbound-call count does not reconcile to Lead Utilisation`);
  if (week.quality.duplicateConflicts !== 0) checks.push(`${week.start}: conflicting duplicate call IDs`);
  if (week.quality.missingCallId !== 0) checks.push(`${week.start}: call rows without call IDs`);
  return checks;
});
if (qualityFailures.length) {
  throw new Error(`Call Activity analysis failed closed: ${qualityFailures.join("; ")}`);
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT_PATH,
  weeks: weeks.map((week) => week.quality),
  currentOverall: summaryMetric(current.overall),
  qualifiedPeople: result.reviewSignals.qualifiedPeople,
  velocityQualifiedPeople: result.reviewSignals.velocityQualifiedPeople,
}, null, 2));
