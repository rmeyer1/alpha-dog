import { describe, expect, it } from "vitest";
import { parseRobinhoodStatementCsv } from "./statement-import-adapters";
import { reconcileImportedOptionRows } from "./statement-import-reconciliation";

const header = [
  "Activity Date",
  "Process Date",
  "Settle Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Quantity",
  "Price",
  "Amount",
].join(",");

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll("\"", "\"\"")}"`).join(",");
}

function parseRows(rows: string[][]) {
  return parseRobinhoodStatementCsv([
    header,
    ...rows.map(csvRow),
  ].join("\n")).rows;
}

describe("statement import option reconciliation", () => {
  it("reconstructs a closed single-leg short option trade", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      confidence: 0.85,
      lifecycle: "closed",
      pendingQuantity: 0,
      status: "confirmed",
      strategyType: "short_put",
      symbol: "NVDA",
    });
    expect(groups[0].legs[0]).toMatchObject({
      closeAmount: -50,
      closedQuantity: 1,
      openAmount: 200,
      openedQuantity: 1,
      remainingQuantity: 0,
      side: "short",
    });
    expect(groups[0].events.map((event) => event.eventType)).toEqual(["open", "close"]);
    expect(groups[0].paperPositionKey).toBe("option:0:position");
  });

  it("reconstructs a clear put credit spread and matching close", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $190.00",
        "BTO",
        "1",
        "$0.75",
        "($75.00)",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $190.00",
        "STC",
        "1",
        "$0.10",
        "$10.00",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      confidence: 0.95,
      lifecycle: "closed",
      pendingQuantity: 0,
      status: "confirmed",
      strategyType: "put_credit_spread",
      symbol: "NVDA",
    });
    expect(groups[0].legs).toHaveLength(2);
    expect(groups[0].legs.map((leg) => leg.remainingQuantity)).toEqual([0, 0]);
    expect(groups[0].sourceRowIndexes).toEqual([0, 1, 2, 3]);
    expect(groups[0].events.map((event) => event.eventType)).toEqual([
      "open",
      "close",
      "close",
    ]);
    expect(groups[0].explanation.join(" ")).toContain("high-confidence credit spread");
  });

  it("reconstructs an open call credit spread", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "AAPL 6/26/2026 Call $210.00",
        "STO",
        "1",
        "$1.10",
        "$110.00",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "AAPL 6/26/2026 Call $220.00",
        "BTO",
        "1",
        "$0.40",
        "($40.00)",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      lifecycle: "open",
      pendingQuantity: 1,
      status: "confirmed",
      strategyType: "call_credit_spread",
    });
  });

  it("supports partial closes", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "2",
        "$2.00",
        "$400.00",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      lifecycle: "partially_closed",
      pendingQuantity: 1,
      status: "confirmed",
    });
    expect(groups[0].legs[0]).toMatchObject({
      closedQuantity: 1,
      openedQuantity: 2,
      remainingQuantity: 1,
    });
  });

  it("aggregates same-contract partial fills before matching spread legs", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "ANET",
        "ANET 1/15/2027 Call $200.00",
        "STO",
        "1",
        "$10.60",
        "$1,060.00",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "ANET",
        "ANET 1/15/2027 Call $200.00",
        "STO",
        "3",
        "$10.40",
        "$3,120.00",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "ANET",
        "ANET 1/15/2027 Call $210.00",
        "BTO",
        "1",
        "$8.95",
        "($895.00)",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "ANET",
        "ANET 1/15/2027 Call $210.00",
        "BTO",
        "3",
        "$8.65",
        "($2,595.00)",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      lifecycle: "open",
      pendingQuantity: 4,
      status: "confirmed",
      strategyType: "call_credit_spread",
    });
    expect(groups[0].sourceRowIndexes).toEqual([0, 1, 2, 3]);
    expect(groups[0].legs.map((leg) => ({
      amount: leg.openAmount,
      quantity: leg.openedQuantity,
      rows: leg.openRowIndexes,
      side: leg.side,
      strike: leg.contract.strike,
    }))).toEqual([
      { amount: 4180, quantity: 4, rows: [0, 1], side: "short", strike: 200 },
      { amount: -3490, quantity: 4, rows: [2, 3], side: "long", strike: 210 },
    ]);
  });

  it("matches Robinhood option expiration rows with blank cash movement", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "4/1/2026",
        "4/1/2026",
        "4/2/2026",
        "CIFR",
        "CIFR 4/10/2026 Put $13.50",
        "STO",
        "1",
        "$1.23",
        "$122.95",
      ],
      [
        "4/10/2026",
        "4/10/2026",
        "4/13/2026",
        "CIFR",
        "Option Expiration for CIFR 4/10/2026 Put $13.50",
        "OEXP",
        "1",
        "",
        "",
      ],
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      lifecycle: "expired",
      pendingQuantity: 0,
      status: "confirmed",
      strategyType: "short_put",
    });
    expect(groups[0].events.at(-1)).toMatchObject({
      amount: 0,
      eventType: "expire",
      rowIndexes: [1],
    });
  });

  it("ignores debit option spreads instead of importing the short leg", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "5/12/2026",
        "5/12/2026",
        "5/13/2026",
        "NVDA",
        "NVDA 6/18/2026 Call $230.00",
        "BTO",
        "1",
        "$4.31",
        "($431.00)",
      ],
      [
        "5/12/2026",
        "5/12/2026",
        "5/13/2026",
        "NVDA",
        "NVDA 6/18/2026 Call $240.00",
        "STO",
        "1",
        "$2.66",
        "$266.00",
      ],
      [
        "5/20/2026",
        "5/20/2026",
        "5/21/2026",
        "NVDA",
        "NVDA 6/18/2026 Call $230.00",
        "STC",
        "1",
        "$7.45",
        "$745.00",
      ],
    ]));

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.status === "ignored")).toBe(true);
    expect(groups.map((group) => group.sourceRowIndexes)).toEqual([[0, 1], [2]]);
    expect(groups[0].explanation).toEqual([
      "Standalone long/debit option spreads are outside the paper-account import scope.",
    ]);
  });

  it("ignores unsupported long-option opens and flags unmatched short closes for review", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTO",
        "1",
        "$2.00",
        "($200.00)",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $190.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
    ]));

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.status)).toEqual(["ignored", "needs_review"]);
    expect(groups[0].explanation).toEqual([
      "Standalone long option opens are outside the paper-account import scope.",
    ]);
    expect(groups[1].reviewReason).toBe("Could not match option close or expiration row to an open position.");
  });

  it("uses deterministic idempotency keys for generated paper-account artifacts", () => {
    const groups = reconcileImportedOptionRows(parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
    ]));

    expect(groups[0].paperPositionKey).toBe("option:0:position");
    expect(groups[0].events.map((event) => event.idempotencyKey)).toEqual([
      "option:0:open",
      "option:0:close:1",
    ]);
  });
});
