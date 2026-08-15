"use strict";

const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { isExcludedPersonnel } = require("./personnelExclusions");

const APPROVED_SALES_HISTORY_SCHEMA_VERSION = "carma_approved_sales_history.v1";
const REQUIRED_TABLES = ["meta", "extraction_runs", "approved_sales_history"];

function unavailableHistory({ configured = false, error = "" } = {}) {
  return {
    configured,
    available: false,
    status: configured ? "unavailable" : "not_configured",
    error,
    schemaVersion: "",
    rows: [],
    definitions: {}
  };
}

function readApprovedSalesHistorySummary({ databasePath = "" } = {}) {
  if (!databasePath) return unavailableHistory({ configured: false });
  if (!fs.existsSync(databasePath)) {
    return unavailableHistory({
      configured: true,
      error: "Historical approved-sales evidence is unavailable."
    });
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map((row) => row.name)
    );
    const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missingTables.length) {
      throw new Error("Historical approved-sales contract is missing required tables.");
    }
    const meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM meta").all().map((row) => [row.key, row.value])
    );
    if (meta.schema_version !== APPROVED_SALES_HISTORY_SCHEMA_VERSION) {
      throw new Error("Historical approved-sales contract has an unsupported schema.");
    }
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
    if (integrity !== "ok" || foreignKeyIssues.length) {
      throw new Error("Historical approved-sales contract failed integrity validation.");
    }
    let rows = db.prepare(`
      SELECT
        r.period_id,
        r.period_start,
        r.period_end,
        r.all_order_count,
        r.new_customer_order_count,
        r.all_approved_value,
        r.new_customer_approved_value,
        r.matched_order_field_variation_count,
        r.classification_quality,
        r.reconciliation_status,
        COUNT(h.order_id) AS observed_all_order_count,
        COALESCE(SUM(h.is_new_customer), 0) AS observed_new_customer_order_count,
        COALESCE(ROUND(SUM(h.approved_value), 2), 0) AS observed_all_approved_value,
        COALESCE(ROUND(SUM(
          CASE WHEN h.is_new_customer = 1 THEN h.approved_value ELSE 0 END
        ), 2), 0) AS observed_new_customer_approved_value
      FROM extraction_runs r
      LEFT JOIN approved_sales_history h ON h.period_id = r.period_id
      GROUP BY
        r.period_id, r.period_start, r.period_end,
        r.all_order_count, r.new_customer_order_count,
        r.all_approved_value, r.new_customer_approved_value,
        r.matched_order_field_variation_count,
        r.classification_quality, r.reconciliation_status
      ORDER BY r.period_start DESC
    `).all().map((row) => {
      const countsReconcile = (
        Number(row.all_order_count) === Number(row.observed_all_order_count)
        && Number(row.new_customer_order_count)
          === Number(row.observed_new_customer_order_count)
      );
      const valuesReconcile = (
        Math.abs(
          Number(row.all_approved_value)
          - Number(row.observed_all_approved_value)
        ) <= 0.02
        && Math.abs(
          Number(row.new_customer_approved_value)
          - Number(row.observed_new_customer_approved_value)
        ) <= 0.02
      );
      return {
        periodId: row.period_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        period: `${row.period_start} to ${row.period_end}`,
        allApprovedOrders: Number(row.all_order_count),
        newCustomerOrders: Number(row.new_customer_order_count),
        newCustomerShare: Number(row.all_order_count)
          ? Math.round(
            (Number(row.new_customer_order_count) / Number(row.all_order_count))
            * 10000
          ) / 100
          : null,
        allApprovedValue: Number(row.all_approved_value),
        newCustomerApprovedValue: Number(row.new_customer_approved_value),
        matchedOrderFieldVariations: Number(
          row.matched_order_field_variation_count
        ),
        classificationQuality: row.classification_quality,
        reconciliationStatus: countsReconcile && valuesReconcile
          ? row.reconciliation_status
          : "normalized_output_mismatch",
        sourceLabel: "Carma approved-sales all + new-customer report views"
      };
    });
    if (rows.some((row) => row.reconciliationStatus === "normalized_output_mismatch")) {
      throw new Error("Historical approved-sales normalized rows do not reconcile.");
    }
    const historyColumns = new Set(
      db.prepare("PRAGMA table_info(approved_sales_history)").all()
        .map((column) => column.name)
    );
    if (historyColumns.has("actual_seller")) {
      const filteredByPeriod = new Map();
      db.prepare(`
        SELECT
          period_id,
          actual_seller,
          COUNT(*) AS order_count,
          SUM(is_new_customer) AS new_customer_order_count,
          SUM(approved_value) AS approved_value,
          SUM(CASE WHEN is_new_customer = 1 THEN approved_value ELSE 0 END) AS new_customer_approved_value
        FROM approved_sales_history
        GROUP BY period_id, actual_seller
      `).all().forEach((seller) => {
        if (!filteredByPeriod.has(seller.period_id)) {
          filteredByPeriod.set(seller.period_id, {
            eligible_order_count: 0,
            eligible_new_customer_order_count: 0,
            eligible_approved_value: 0,
            eligible_new_customer_approved_value: 0,
            excluded_order_count: 0,
            excluded_approved_value: 0
          });
        }
        const period = filteredByPeriod.get(seller.period_id);
        if (isExcludedPersonnel(seller.actual_seller)) {
          period.excluded_order_count += Number(seller.order_count || 0);
          period.excluded_approved_value += Number(seller.approved_value || 0);
          return;
        }
        period.eligible_order_count += Number(seller.order_count || 0);
        period.eligible_new_customer_order_count += Number(
          seller.new_customer_order_count || 0
        );
        period.eligible_approved_value += Number(seller.approved_value || 0);
        period.eligible_new_customer_approved_value += Number(
          seller.new_customer_approved_value || 0
        );
      });
      rows = rows.map((row) => {
        const filtered = filteredByPeriod.get(row.periodId);
        if (!filtered) return row;
        const allApprovedOrders = Number(filtered.eligible_order_count || 0);
        const newCustomerOrders = Number(filtered.eligible_new_customer_order_count || 0);
        return {
          ...row,
          sourceAllApprovedOrders: row.allApprovedOrders,
          sourceAllApprovedValue: row.allApprovedValue,
          allApprovedOrders,
          newCustomerOrders,
          newCustomerShare: allApprovedOrders
            ? Math.round((newCustomerOrders / allApprovedOrders) * 10000) / 100
            : null,
          allApprovedValue: Math.round(
            Number(filtered.eligible_approved_value || 0) * 100
          ) / 100,
          newCustomerApprovedValue: Math.round(
            Number(filtered.eligible_new_customer_approved_value || 0) * 100
          ) / 100,
          excludedPersonnelOrders: Number(filtered.excluded_order_count || 0),
          excludedPersonnelApprovedValue: Math.round(
            Number(filtered.excluded_approved_value || 0) * 100
          ) / 100,
          sourceLabel: "Carma approved-sales all + new-customer report views · configured personnel excluded"
        };
      });
    }
    return {
      configured: true,
      available: true,
      status: "available",
      error: "",
      schemaVersion: meta.schema_version,
      rows,
      definitions: {
        isNewCustomer: meta.new_customer_definition || "",
        nonMembershipMeaning: meta.non_membership_meaning || "",
        historicalMarkerCliffStart: meta.historical_marker_cliff_start || "",
        matchingRule: meta.matching_rule || "",
        personnelExclusionRule: historyColumns.has("actual_seller")
          ? "Source extraction totals are reconciled first; displayed historical aggregates then exclude configured personnel by exact normalized actual_seller."
          : "The retained historical contract does not expose actual_seller, so no historical personnel exclusion could be applied."
      }
    };
  } finally {
    db.close();
  }
}

module.exports = {
  APPROVED_SALES_HISTORY_SCHEMA_VERSION,
  readApprovedSalesHistorySummary,
  unavailableHistory
};
