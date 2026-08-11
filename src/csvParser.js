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

function parseCsvColumns(text, selectedColumns = []) {
  const requested = new Set(
    selectedColumns.map((column) => String(column || "").trim()).filter(Boolean)
  );
  const rows = [];
  let columns = [];
  let selectedByIndex = new Map();
  let headerValues = [];
  let record = {};
  let field = "";
  let columnIndex = 0;
  let inQuotes = false;
  let headerParsed = false;
  let hasSelectedValue = false;

  const capturesCurrentField = () => !headerParsed || selectedByIndex.has(columnIndex);
  const finishField = () => {
    if (!headerParsed) {
      headerValues.push(field);
    } else if (selectedByIndex.has(columnIndex)) {
      const column = selectedByIndex.get(columnIndex);
      record[column] = field;
      if (String(field || "").trim()) hasSelectedValue = true;
    }
    field = "";
    columnIndex += 1;
  };
  const finishRow = () => {
    finishField();
    if (!headerParsed) {
      const sourceColumns = headerValues.map((name, index) => {
        const cleaned = index === 0 ? name.replace(/^\uFEFF/, "") : name;
        return cleaned.trim();
      });
      selectedByIndex = new Map(
        sourceColumns
          .map((column, index) => [index, column])
          .filter(([, column]) => requested.has(column))
      );
      columns = sourceColumns.filter((column) => requested.has(column));
      headerParsed = true;
    } else if (hasSelectedValue) {
      record.__rowNumber = rows.length + 2;
      rows.push(record);
    }
    headerValues = [];
    record = {};
    field = "";
    columnIndex = 0;
    hasSelectedValue = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        if (capturesCurrentField()) field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else if (capturesCurrentField()) {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      finishField();
      continue;
    }
    if (char === "\n") {
      finishRow();
      continue;
    }
    if (char !== "\r" && capturesCurrentField()) {
      field += char;
    }
  }

  if (field.length > 0 || columnIndex > 0 || Object.keys(record).length > 0) {
    finishRow();
  }

  return { columns, rows };
}

module.exports = { parseCsv, parseCsvColumns };
