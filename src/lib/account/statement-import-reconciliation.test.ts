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

  it("flags ambiguous or unsupported groupings for review", () => {
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
    expect(groups.every((group) => group.status === "needs_review")).toBe(true);
    expect(groups.map((group) => group.reviewReason)).toEqual([
      "Standalone long option opens are out of MVP unless paired with a credit spread.",
      "Could not match option close or expiration row to an open position.",
    ]);
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

