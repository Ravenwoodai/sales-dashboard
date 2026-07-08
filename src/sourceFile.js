"use strict";

const fs = require("fs");
const path = require("path");
const { parseCsv } = require("./csvParser");
const { readXlsxWorksheet } = require("./xlsxReader");

function csvEscape(value) {
  const text = String(value === undefined || value === null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(columns, rows) {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  return `${header}\n${body}${body ? "\n" : ""}`;
}

function readTabularFile(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xlsx") {
    const workbook = readXlsxWorksheet(filePath, options);
    return {
      sourceType: "xlsx",
      sourceName: path.basename(filePath),
      sheetName: workbook.sheetName,
      columns: workbook.columns,
      rows: workbook.rows,
      csvText: rowsToCsv(workbook.columns, workbook.rows)
    };
  }

  const csvText = fs.readFileSync(filePath, "utf8");
  const parsed = parseCsv(csvText);
  return {
    sourceType: "csv",
    sourceName: path.basename(filePath),
    sheetName: null,
    columns: parsed.columns,
    rows: parsed.rows,
    csvText
  };
}

module.exports = {
  readTabularFile,
  rowsToCsv
};
