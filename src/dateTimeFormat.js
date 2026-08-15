"use strict";

const AEST_TIME_ZONE = "Australia/Brisbane";
const AEST_TIME_ZONE_LABEL = "AEST";
const SOURCE_TIMEZONE_LABEL = "Source call time (AEST)";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseSourceDateParts(value) {
  const text = clean(value);
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) {
    const [, year, month, day] = match;
    return { year: Number(year), month: Number(month), day: Number(day) };
  }
  return null;
}

function parseSourceTimeParts(value) {
  const text = clean(value);
  if (!text) return { hour: 0, minute: 0, second: 0 };
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] || 0) };
}

function isoDateFromParts(parts = {}) {
  if (!parts.year || !parts.month || !parts.day) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function isoTimeFromParts(parts = {}) {
  return `${pad2(parts.hour || 0)}:${pad2(parts.minute || 0)}:${pad2(parts.second || 0)}`;
}

function sourceComparableFromParts(parts = {}) {
  const date = isoDateFromParts(parts);
  if (!date) return "";
  return `${date} ${isoTimeFromParts(parts)}`;
}

function formatSourceDateParts(parts = {}) {
  if (!parts.year || !parts.month || !parts.day) return "";
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

function formatSourceDateTimeParts(parts = {}, options = {}) {
  const date = formatSourceDateParts(parts);
  if (!date) return "";
  const time = isoTimeFromParts(parts);
  return `${date} ${time}${options.omitTimezone ? "" : ` ${AEST_TIME_ZONE_LABEL}`}`;
}

function formatSourceDateValue(value) {
  const parts = parseSourceDateParts(value);
  return parts ? formatSourceDateParts(parts) : clean(value);
}

function formatSourceDateTimeValue(dateValue, timeValue = "") {
  const dateText = clean(dateValue);
  const combined = !clean(timeValue)
    ? dateText.match(/^(.+?)[ T](\d{1,2}:\d{2}(?::\d{2})?)(?:\s+AEST)?$/i)
    : null;
  if (!clean(timeValue) && /\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}/.test(dateText) && /\bAEST\b/i.test(dateText)) {
    return dateText;
  }
  const dateParts = parseSourceDateParts(combined ? combined[1] : dateText);
  const timeParts = parseSourceTimeParts(clean(timeValue) || (combined ? combined[2] : ""));
  if (!dateParts || !timeParts) return [clean(dateValue), clean(timeValue)].filter(Boolean).join(" ");
  return formatSourceDateTimeParts({ ...dateParts, ...timeParts });
}

function formatAestDateTime(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return clean(value);
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: AEST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${AEST_TIME_ZONE_LABEL}`;
}

module.exports = {
  AEST_TIME_ZONE,
  AEST_TIME_ZONE_LABEL,
  SOURCE_TIMEZONE_LABEL,
  formatAestDateTime,
  formatSourceDateParts,
  formatSourceDateTimeParts,
  formatSourceDateTimeValue,
  formatSourceDateValue,
  isoDateFromParts,
  isoTimeFromParts,
  parseSourceDateParts,
  parseSourceTimeParts,
  sourceComparableFromParts
};
