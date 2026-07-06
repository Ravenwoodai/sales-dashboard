"use strict";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headerRow = rows.shift();
  if (!headerRow || headerRow.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = headerRow.map((name, index) => {
    const cleaned = index === 0 ? name.replace(/^\uFEFF/, "") : name;
    return cleaned.trim();
  });

  const parsedRows = rows
    .filter((values) => values.some((value) => String(value || "").trim() !== ""))
    .map((values, rowIndex) => {
      const record = { __rowNumber: rowIndex + 2 };
      columns.forEach((column, columnIndex) => {
        record[column] = values[columnIndex] === undefined ? "" : values[columnIndex];
      });
      return record;
    });

  return { columns, rows: parsedRows };
}

module.exports = { parseCsv };
