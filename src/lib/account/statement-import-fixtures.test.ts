import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBrokerStatementCsv } from "./statement-import-adapters";
import {
  duplicateStatementRowIndexes,
  duplicateStatementRowHashes,
  statementImportFileHash,
  statementImportRowHash,
} from "./statement-import-fingerprints";
import { reconcileImportedOptionRows } from "./statement-import-reconciliation";
import { buildStatementImportStagingPlan } from "./statement-import-staging";
import { buildStatementImportWritePlan } from "./statement-import-write";

const primaryCsv = readFileSync(
  "src/lib/account/fixtures/robinhood-statement-primary.csv",
  "utf8",
);
const overlapCsv = readFileSync(
  "src/lib/account/fixtures/robinhood-statement-overlap.csv",
  "utf8",
);

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function optionSourceAmountTotal(rowIndexes: number[], rows: ReturnType<typeof parseBrokerStatementCsv>["rows"]) {
  return sum(rowIndexes.map((rowIndex) => rows[rowIndex]?.amount ?? 0));
}

describe("broker statement import fixture QA", () => {
  it("parses sanitized Robinhood fixtures and validates required columns", () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);

    expect(parsed.broker).toBe("robinhood");
    expect(parsed.rows).toHaveLength(16);
    expect(parsed.rows[8]).toMatchObject({
      amount: -2000,
      classification: "equity",
      price: 200,
      quantity: 10,
      transCode: "Buy",
    });
    expect(parsed.rows[15]).toMatchObject({
      classification: "option",
      status: "needs_review",
    });
  });

  it("reconstructs options, stocks, dividends, ignored rows, and low-confidence review counts", () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const groups = reconcileImportedOptionRows(parsed.rows);
    const plan = buildStatementImportWritePlan(parsed.rows, groups);

    expect(plan.summary).toEqual({
      dividendsTracked: 1,
      equityLots: 2,
      excludedRows: 4,
      optionPositions: 3,
      reviewGroups: 1,
    });
    expect(plan.optionPositions.map((position) => position.position)).toEqual([
      expect.objectContaining({
        status: "closed",
        strategy_type: "short_put",
        symbol: "NVDA",
      }),
      expect.objectContaining({
        status: "closed",
        strategy_type: "put_credit_spread",
        symbol: "MSFT",
      }),
      expect.objectContaining({
        contracts_remaining: 1,
        status: "partially_closed",
        strategy_type: "short_put",
        symbol: "AAPL",
      }),
    ]);
    expect(plan.equityLots.map((lot) => [lot.symbol, lot.shares, lot.costBasis])).toEqual([
      ["AAPL", 10, 200],
      ["AAPL", -4, 210],
    ]);
  });

  it("reconciles imported option cash event totals against source Amount values", () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const plan = buildStatementImportWritePlan(parsed.rows);

    for (const position of plan.optionPositions) {
      for (const event of position.events) {
        const metadata = event.metadata as { importRowIndexes?: number[] };
        const sourceAmountTotal = optionSourceAmountTotal(
          metadata.importRowIndexes ?? [],
          parsed.rows,
        );

        expect(event.cash_delta).toBe(sourceAmountTotal);
      }
    }
  });

  it("detects duplicate files and overlapping duplicate rows", () => {
    const primary = parseBrokerStatementCsv(primaryCsv);
    const overlap = parseBrokerStatementCsv(overlapCsv);
    const primaryFileHash = statementImportFileHash(primary.broker, primaryCsv);

    expect(statementImportFileHash(primary.broker, primaryCsv)).toBe(primaryFileHash);
    expect(statementImportFileHash(overlap.broker, overlapCsv)).not.toBe(primaryFileHash);

    const existingRowHashes = new Set(
      primary.rows.map((row) => statementImportRowHash(primary.broker, row)),
    );
    const duplicateHashes = duplicateStatementRowHashes(
      overlap.broker,
      overlap.rows,
      existingRowHashes,
    );

    expect(duplicateHashes.size).toBe(1);
    expect(duplicateHashes).toContain(statementImportRowHash(overlap.broker, overlap.rows[0]));
  });

  it("excludes cross-file duplicate option rows before reconciliation", () => {
    const primary = parseBrokerStatementCsv(primaryCsv);
    const overlap = parseBrokerStatementCsv(overlapCsv);
    const existingRowHashes = new Set(
      primary.rows.map((row) => statementImportRowHash(primary.broker, row)),
    );
    const stagingPlan = buildStatementImportStagingPlan(
      overlap.broker,
      overlap.rows,
      reconcileImportedOptionRows(overlap.rows),
      existingRowHashes,
    );

    expect([...stagingPlan.duplicateRowIndexes]).toEqual([0]);
    expect(stagingPlan.plan.optionPositions).toHaveLength(1);
    expect(stagingPlan.plan.optionPositions[0]?.position).toEqual(
      expect.objectContaining({ symbol: "AMD" }),
    );
    expect(stagingPlan.groups.every((group) => !group.sourceRowIndexes.includes(0))).toBe(true);
  });

  it("keeps only the first identical option row within one upload", () => {
    const primary = parseBrokerStatementCsv(primaryCsv);
    const firstRow = primary.rows[0];
    const repeatedRows = [
      firstRow,
      { ...firstRow, rowIndex: firstRow.rowIndex + 100 },
    ];
    const duplicateIndexes = duplicateStatementRowIndexes(primary.broker, repeatedRows);
    const stagingPlan = buildStatementImportStagingPlan(
      primary.broker,
      repeatedRows,
      reconcileImportedOptionRows(repeatedRows),
      new Set(),
    );

    expect([...duplicateIndexes]).toEqual([firstRow.rowIndex + 100]);
    expect(stagingPlan.plan.optionPositions).toHaveLength(1);
    expect(stagingPlan.plan.optionPositions[0]?.position).toEqual(
      expect.objectContaining({ contracts_opened: 1 }),
    );
  });

  it("keeps unsupported rows from failing the full import", () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const groups = reconcileImportedOptionRows(parsed.rows);
    const reviewGroup = groups.find((group) => group.status === "needs_review");

    expect(reviewGroup).toEqual(expect.objectContaining({
      sourceRowIndexes: [15],
      status: "needs_review",
    }));
    expect(groups.filter((group) => group.status === "confirmed")).toHaveLength(3);
  });
});
