import csv
import hashlib
import json
import os
import re
from pathlib import Path
import pdfplumber


OUTPUT_ROOT = Path(os.environ.get(
    "ALLOCATION_PARSER_OUTPUT_ROOT",
    Path(__file__).resolve().parent / "allocation-parser",
)).resolve()
MANIFEST_PATH = OUTPUT_ROOT / "manifest.json"
ALLOCATION_INDEX_PATH = OUTPUT_ROOT / "allocation-index.json"
ALLOCATION_JSONL_PATH = OUTPUT_ROOT / "allocation-history.jsonl"
ALLOCATION_CSV_PATH = OUTPUT_ROOT / "allocation-history.csv"
PARSE_MANIFEST_PATH = OUTPUT_ROOT / "allocation-parse-manifest.json"

COLUMN_LIMITS = (65, 175, 285, 385, 625, 715)
COLUMN_NAMES = (
    "historyId",
    "created",
    "inactivated",
    "salesManager",
    "description",
    "sent",
    "recipient",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def group_words_by_line(words, tolerance=2.5):
    groups = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        for group in groups:
            if abs(group["top"] - word["top"]) <= tolerance:
                group["words"].append(word)
                group["top"] = sum(item["top"] for item in group["words"]) / len(
                    group["words"]
                )
                break
        else:
            groups.append({"top": word["top"], "words": [word]})
    return sorted(groups, key=lambda group: group["top"])


def column_index(x0):
    for index, limit in enumerate(COLUMN_LIMITS):
        if x0 < limit:
            return index
    return len(COLUMN_LIMITS)


def split_columns(words):
    columns = [[] for _ in COLUMN_NAMES]
    for word in sorted(words, key=lambda item: item["x0"]):
        columns[column_index(word["x0"])].append(word["text"])
    return [" ".join(parts).strip() for parts in columns]


def parse_page_rows(page, page_number):
    words = page.extract_words(
        x_tolerance=1,
        y_tolerance=2,
        keep_blank_chars=False,
    )
    parsed = []
    current = None
    current_top = None
    for group in group_words_by_line(words):
        ordered = sorted(group["words"], key=lambda item: item["x0"])
        if not ordered:
            continue
        first_text = ordered[0]["text"]
        is_row_start = (
            re.fullmatch(r"\d+", first_text) is not None
            and ordered[0]["x0"] < COLUMN_LIMITS[0]
        )
        if is_row_start:
            values = split_columns(ordered)
            current = dict(zip(COLUMN_NAMES, values))
            current["page"] = page_number
            parsed.append(current)
            current_top = group["top"]
            continue

        if current is None or current_top is None:
            continue
        if group["top"] - current_top > 18:
            continue
        line_text = " ".join(word["text"] for word in ordered)
        if (
            "Lead Allocation History for:" in line_text
            or "Owning Sales Manager:" in line_text
            or "Lead Source:" in line_text
            or ("Created" in line_text and "Sales Manager" in line_text)
        ):
            continue
        continuation = split_columns(ordered)
        for name, value in zip(COLUMN_NAMES, continuation):
            if value:
                current[name] = f"{current[name]} {value}".strip()
        current_top = group["top"]
    return parsed


def parse_header(text, fallback_customer_id, fallback_customer_name):
    title_match = re.search(
        r"Lead Allocation History for:\s*(.*?)\s*:\s*(\d+)",
        text,
    )
    owner_match = re.search(
        r"Owning Sales Manager:\s*(.*?)\s+Owning Salesperson:\s*(.*)",
        text,
    )
    source_match = re.search(
        r"Lead Source:\s*(.*?)\s+Lead Import date:\s*(.*)",
        text,
    )
    return {
        "customerId": (
            title_match.group(2).strip() if title_match else fallback_customer_id
        ),
        "customerName": (
            title_match.group(1).strip()
            if title_match
            else fallback_customer_name
        ),
        "owningSalesManager": (
            owner_match.group(1).strip() if owner_match else ""
        ),
        "owningSalesperson": (
            owner_match.group(2).strip() if owner_match else ""
        ),
        "leadSource": source_match.group(1).strip() if source_match else "",
        "leadImportDate": (
            source_match.group(2).strip() if source_match else ""
        ),
        "titleMatched": title_match is not None,
    }


def row_key(row):
    return tuple(row[name] for name in COLUMN_NAMES)


manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
order_ids = manifest["orderIds"]
records = manifest["records"]
allocation_index = []
all_rows = []
failures = []
total_pages = 0

for index, order_id in enumerate(order_ids, start=1):
    try:
        record = records[order_id]
        if record["status"] != "complete":
            raise ValueError(f"Order manifest status is {record['status']}")
        record_path = Path(record["recordPath"])
        record_data = json.loads(record_path.read_text(encoding="utf-8"))
        pdf_path = Path(record["allocationPath"])
        if not pdf_path.exists() or pdf_path.stat().st_size <= 0:
            raise ValueError("Allocation PDF is missing or empty")
        if pdf_path.read_bytes()[:5] != b"%PDF-":
            raise ValueError("Allocation file has no PDF signature")

        raw_page_text = []
        raw_rows = []
        rows = []
        page_row_counts = []
        with pdfplumber.open(pdf_path) as pdf:
            if len(pdf.pages) == 0:
                raise ValueError("Allocation PDF has zero pages")
            total_pages += len(pdf.pages)
            for page_number, page in enumerate(pdf.pages, start=1):
                text = page.extract_text(layout=True) or ""
                raw_page_text.append({"page": page_number, "text": text})
                page_rows = parse_page_rows(page, page_number)
                raw_rows.extend(page_rows)
                if page_rows and rows and row_key(page_rows[0]) == row_key(rows[-1]):
                    page_rows = page_rows[1:]
                rows.extend(page_rows)
                page_row_counts.append(
                    {"page": page_number, "rows": len(page_rows)}
                )

        first_text = raw_page_text[0]["text"]
        header = parse_header(
            first_text,
            str(record["customerId"]),
            str(record["customerName"]),
        )
        if not header["titleMatched"]:
            raise ValueError("Allocation PDF title was not parsed")
        if header["customerId"] != str(record["customerId"]):
            raise ValueError(
                f"Customer ID mismatch: PDF {header['customerId']}, "
                f"order record {record['customerId']}"
            )
        explicit_null_placeholder = any(
            re.search(r"(?im)^\s*null\s+null\b", item["text"])
            for item in raw_page_text
        )
        if not rows and not explicit_null_placeholder:
            raise ValueError(
                "Allocation PDF contains neither history rows nor the explicit null placeholder"
            )
        if any(not re.fullmatch(r"\d+", row["historyId"]) for row in rows):
            raise ValueError("One or more allocation History IDs are not numeric")

        allocation = {
            "schemaVersion": "APPROVED-SALES-ALLOCATION-1",
            "orderId": order_id,
            "sourcePdf": str(pdf_path),
            "sourcePdfBytes": pdf_path.stat().st_size,
            "sourcePdfSha256": sha256(pdf_path),
            "pages": len(raw_page_text),
            **{key: value for key, value in header.items() if key != "titleMatched"},
            "pageRowCounts": page_row_counts,
            "rawRowCount": len(raw_rows),
            "boundaryDeduplicatedRowCount": len(rows),
            "historyStatus": "rows" if rows else "empty",
            "explicitNullPlaceholder": explicit_null_placeholder,
            "rows": rows,
            "rawRows": raw_rows,
            "rawPageText": raw_page_text,
            "validation": {
                "pdfSignature": True,
                "titleParsed": True,
                "customerIdMatchesOrder": True,
                "allHistoryIdsNumeric": True,
                "rowsOrExplicitNullPlaceholder": bool(rows)
                or explicit_null_placeholder,
            },
        }
        allocation_path = pdf_path.parent / "allocation.json"
        allocation_path.write_text(
            json.dumps(allocation, indent=2),
            encoding="utf-8",
        )
        allocation_index.append(
            {
                "orderId": order_id,
                "customerId": header["customerId"],
                "customerName": header["customerName"],
                "owningSalesManager": header["owningSalesManager"],
                "owningSalesperson": header["owningSalesperson"],
                "leadSource": header["leadSource"],
                "leadImportDate": header["leadImportDate"],
                "pages": allocation["pages"],
                "rows": len(rows),
                "historyStatus": allocation["historyStatus"],
                "explicitNullPlaceholder": explicit_null_placeholder,
                "allocationJsonPath": str(allocation_path),
                "allocationPdfPath": str(pdf_path),
                "pdfBytes": pdf_path.stat().st_size,
                "pdfSha256": allocation["sourcePdfSha256"],
            }
        )
        for row_index, row in enumerate(rows, start=1):
            all_rows.append(
                {
                    "orderId": order_id,
                    "customerId": header["customerId"],
                    "customerName": header["customerName"],
                    "owningSalesManager": header["owningSalesManager"],
                    "owningSalesperson": header["owningSalesperson"],
                    "leadSource": header["leadSource"],
                    "leadImportDate": header["leadImportDate"],
                    "allocationRow": row_index,
                    **row,
                }
            )
    except Exception as error:
        failures.append({"orderId": order_id, "error": str(error)})

    if index % 25 == 0 or index == len(order_ids):
        print(
            f"[PARSE] {index}/{len(order_ids)} PDFs; "
            f"parsed={len(allocation_index)}; failures={len(failures)}"
        )

ALLOCATION_INDEX_PATH.write_text(
    json.dumps(
        {
            "schemaVersion": "APPROVED-SALES-ALLOCATION-INDEX-1",
            "sourceManifest": str(MANIFEST_PATH),
            "orders": len(allocation_index),
            "allocationRows": len(all_rows),
            "items": allocation_index,
        },
        indent=2,
    ),
    encoding="utf-8",
)

with ALLOCATION_JSONL_PATH.open("w", encoding="utf-8", newline="\n") as stream:
    for row in all_rows:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")

csv_headers = [
    "orderId",
    "customerId",
    "customerName",
    "owningSalesManager",
    "owningSalesperson",
    "leadSource",
    "leadImportDate",
    "allocationRow",
    "historyId",
    "created",
    "inactivated",
    "salesManager",
    "description",
    "sent",
    "recipient",
    "page",
]
with ALLOCATION_CSV_PATH.open("w", encoding="utf-8-sig", newline="") as stream:
    writer = csv.DictWriter(stream, fieldnames=csv_headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(all_rows)

parse_manifest = {
    "processVersion": "APPROVED-SALES-ALLOCATION-PARSER-1",
    "sourceOrders": len(order_ids),
    "parsedOrders": len(allocation_index),
    "failedOrders": len(failures),
    "ordersWithHistoryRows": sum(
        1 for item in allocation_index if item["historyStatus"] == "rows"
    ),
    "ordersWithEmptyHistory": sum(
        1 for item in allocation_index if item["historyStatus"] == "empty"
    ),
    "totalPdfPages": total_pages,
    "allocationRows": len(all_rows),
    "allocationIndexPath": str(ALLOCATION_INDEX_PATH),
    "allocationJsonlPath": str(ALLOCATION_JSONL_PATH),
    "allocationCsvPath": str(ALLOCATION_CSV_PATH),
    "failures": failures,
}
PARSE_MANIFEST_PATH.write_text(
    json.dumps(parse_manifest, indent=2),
    encoding="utf-8",
)
print(json.dumps(parse_manifest, indent=2))

if failures:
    raise SystemExit(1)
