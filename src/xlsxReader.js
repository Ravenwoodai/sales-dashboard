"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_DEFLATE = 8;
const ZIP_STORE = 0;

const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58
]);

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrsFor(text) {
  const attrs = {};
  String(text || "").replace(/([A-Za-z_][\w:.-]*)="([^"]*)"/g, (_, key, value) => {
    attrs[key] = decodeXml(value);
    return "";
  });
  return attrs;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("Unable to read XLSX zip directory.");
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid XLSX zip directory.");
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8").replace(/\\/g, "/");
    entries.set(name, { compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  function readEntry(name) {
    const entry = entries.get(name.replace(/\\/g, "/"));
    if (!entry) return null;
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Invalid XLSX local header for ${name}.`);
    }
    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + fileNameLength + extraLength;
    const payload = buffer.slice(dataOffset, dataOffset + entry.compressedSize);
    if (entry.compression === ZIP_STORE) return payload;
    if (entry.compression === ZIP_DEFLATE) return zlib.inflateRawSync(payload);
    throw new Error(`Unsupported XLSX compression method ${entry.compression} for ${name}.`);
  }

  return {
    names: Array.from(entries.keys()),
    readText(name) {
      const payload = readEntry(name);
      return payload ? payload.toString("utf8") : null;
    }
  };
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml))) {
    const parts = [];
    String(itemMatch[1]).replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, text) => {
      parts.push(decodeXml(text));
      return "";
    });
    strings.push(parts.join(""));
  }
  return strings;
}

function looksLikeDateFormat(formatCode) {
  const code = String(formatCode || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .toLowerCase();
  if (!code || code === "general") return false;
  return /(^|[^a-z])[ymdhHs](?![a-z])/.test(code) || /d{1,4}|m{1,4}|y{2,4}|h{1,2}:/.test(code);
}

function parseStyles(xml) {
  if (!xml) return [];
  const customFormats = new Map();
  String(xml).replace(/<numFmt\b([^>]*)\/>/g, (_, attrText) => {
    const attrs = attrsFor(attrText);
    customFormats.set(Number(attrs.numFmtId), attrs.formatCode || "");
    return "";
  });

  const cellXfs = String(xml).match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return [];

  const styles = [];
  String(cellXfs[1]).replace(/<xf\b([^>]*)\/>/g, (_, attrText) => {
    const attrs = attrsFor(attrText);
    const numFmtId = Number(attrs.numFmtId || 0);
    const formatCode = customFormats.get(numFmtId) || "";
    styles.push({
      numFmtId,
      formatCode,
      isDateLike: BUILT_IN_DATE_FORMATS.has(numFmtId) || looksLikeDateFormat(formatCode)
    });
    return "";
  });
  return styles;
}

function parseWorkbookSheets(xml) {
  const sheets = [];
  String(xml || "").replace(/<sheet\b([^>]*)\/>/g, (_, attrText) => {
    const attrs = attrsFor(attrText);
    sheets.push({
      name: attrs.name || `Sheet ${sheets.length + 1}`,
      id: attrs["r:id"] || attrs.id || "",
      sheetId: attrs.sheetId || ""
    });
    return "";
  });
  return sheets;
}

function parseRelationships(xml) {
  const relationships = new Map();
  String(xml || "").replace(/<Relationship\b([^>]*)\/>/g, (_, attrText) => {
    const attrs = attrsFor(attrText);
    if (attrs.Id && attrs.Target) relationships.set(attrs.Id, attrs.Target);
    return "";
  });
  return relationships;
}

function normalizeWorkbookTarget(target) {
  const cleanTarget = String(target || "").replace(/\\/g, "/");
  if (!cleanTarget) return "xl/worksheets/sheet1.xml";
  if (cleanTarget.startsWith("/")) return cleanTarget.slice(1);
  if (cleanTarget.startsWith("xl/")) return cleanTarget;
  return path.posix.normalize(`xl/${cleanTarget}`);
}

function columnIndexFor(cellRef) {
  const letters = String(cellRef || "").match(/^[A-Z]+/i)?.[0] || "";
  if (!letters) return -1;
  return letters.toUpperCase().split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function excelSerialToDate(serial) {
  const numeric = Number(serial);
  if (!Number.isFinite(numeric)) return null;
  const milliseconds = Math.round(numeric * 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(1899, 11, 30) + milliseconds);
}

function formatExcelDate(serial, style = {}) {
  const date = excelSerialToDate(serial);
  if (!date || Number.isNaN(date.getTime())) return String(serial || "");
  const formatCode = String(style.formatCode || "").toLowerCase();
  const serialNumber = Number(serial);
  const hasWholeDate = Math.floor(serialNumber) > 0;
  const hasTime = /h|s/.test(formatCode) || (serialNumber % 1) !== 0;
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  if (!hasWholeDate) return time;
  return hasTime ? `${yyyy}-${mm}-${dd} ${time}` : `${yyyy}-${mm}-${dd}`;
}

function formatCellValue(raw, attrs, sharedStrings, styles) {
  if (raw === null || raw === undefined) return "";
  if (String(raw).trim() === "") return "";
  const type = attrs.t || "";
  const style = styles[Number(attrs.s || 0)] || {};

  if (type === "s") return sharedStrings[Number(raw)] || "";
  if (type === "str" || type === "inlineStr") return decodeXml(raw);
  if (type === "b") return String(raw) === "1" ? "TRUE" : "FALSE";
  if (style.isDateLike) return formatExcelDate(raw, style);

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && String(raw).trim() !== "") {
    return Number.isInteger(numeric) ? String(numeric) : String(numeric);
  }
  return decodeXml(raw);
}

function parseWorksheet(xml, sharedStrings, styles) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml))) {
    const values = [];
    const cellRegex = /<c\b([^>]*?)>([\s\S]*?)<\/c>|<c\b([^>]*?)\/>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrText = cellMatch[1] || cellMatch[3] || "";
      const attrs = attrsFor(attrText);
      const cellBody = cellMatch[2] || "";
      const columnIndex = columnIndexFor(attrs.r);
      const targetIndex = columnIndex >= 0 ? columnIndex : values.length;
      const inlineMatch = cellBody.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      const valueMatch = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      let raw = "";
      if (inlineMatch) {
        const parts = [];
        inlineMatch[1].replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, text) => {
          parts.push(decodeXml(text));
          return "";
        });
        raw = parts.join("");
      } else if (valueMatch) {
        raw = decodeXml(valueMatch[1]);
      }
      values[targetIndex] = formatCellValue(raw, attrs, sharedStrings, styles);
    }
    rows.push(values.map((value) => value ?? ""));
  }
  return rows;
}

function dedupeColumns(columns) {
  const seen = new Map();
  return columns.map((column, index) => {
    const base = String(column || `Column ${index + 1}`).trim() || `Column ${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function worksheetRowsToObjects(rows) {
  const header = dedupeColumns((rows[0] || []).map((value) => String(value || "").trim()));
  return {
    columns: header,
    rows: rows.slice(1)
      .filter((row) => row.some((value) => String(value || "").trim()))
      .map((row, rowIndex) => {
        const record = { __rowNumber: rowIndex + 2 };
        header.forEach((column, index) => {
          record[column] = row[index] ?? "";
        });
        return record;
      })
  };
}

function readXlsxWorksheet(filePath, options = {}) {
  const zip = readZipEntries(filePath);
  const workbookXml = zip.readText("xl/workbook.xml");
  if (!workbookXml) throw new Error("XLSX workbook is missing xl/workbook.xml.");
  const sheets = parseWorkbookSheets(workbookXml);
  if (!sheets.length) throw new Error("XLSX workbook does not contain any sheets.");
  const relationships = parseRelationships(zip.readText("xl/_rels/workbook.xml.rels"));
  const requested = options.sheetName
    ? sheets.find((sheet) => sheet.name === options.sheetName)
    : sheets[options.sheetIndex || 0];
  if (!requested) throw new Error(`XLSX sheet not found: ${options.sheetName || options.sheetIndex || 0}.`);
  const target = normalizeWorkbookTarget(relationships.get(requested.id) || `worksheets/sheet${requested.sheetId || 1}.xml`);
  const sheetXml = zip.readText(target);
  if (!sheetXml) throw new Error(`XLSX worksheet data not found: ${target}.`);
  const sharedStrings = parseSharedStrings(zip.readText("xl/sharedStrings.xml"));
  const styles = parseStyles(zip.readText("xl/styles.xml"));
  const rawRows = parseWorksheet(sheetXml, sharedStrings, styles);
  const { columns, rows } = worksheetRowsToObjects(rawRows);

  return {
    sourcePath: filePath,
    sheetName: requested.name,
    sheets: sheets.map((sheet) => sheet.name),
    columns,
    rows
  };
}

module.exports = {
  readXlsxWorksheet
};
