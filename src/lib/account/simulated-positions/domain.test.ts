import { describe, expect, it } from "vitest";
import {
  assignmentLedger,
  calledAwayLedger,
  calculateNetCredit,
  expirationOutcome,
  openedAtTimestamp,
} from "./domain";

describe("simulated-position domain calculations", () => {
  it("normalizes spread credits and opening dates without persistence", () => {
    expect(
      calculateNetCredit({
        contracts: 1,
        legs: [
          { openPrice: 2, side: "short", snapshot: {} },
          { openPrice: 0.75, side: "long", snapshot: {} },
        ],
        strategyType: "put_credit_spread",
        symbol: "AAPL",
      }),
    ).toBe(1.25);
    expect(
      openedAtTimestamp("2026-07-01", new Date("2026-07-03T20:15:00.000Z")),
    ).toBe("2026-07-01T12:00:00.000Z");
  });

  it("keeps assignment and called-away ledger totals deterministic", () => {
    expect(assignmentLedger(1_000, 0, 20, 1)).toMatchObject({
      assignmentCost: 2_000,
      marginDelta: 1_000,
      nextCash: 0,
      nextMargin: 1_000,
      shares: 100,
    });
    expect(calledAwayLedger(15, 20, 1, 1.25)).toMatchObject({
      calledAwayProceeds: 2_000,
      lotCostBasis: 1_500,
      stockRealizedPnl: 500,
      realizedPnlDelta: 625,
    });
  });

  it("classifies simple expiration outcomes", () => {
    expect(
      expirationOutcome(
        "short_put",
        { side: "short", option_type: "put", strike: 100 },
        99,
      ),
    ).toBe("assigned_put");
    expect(
      expirationOutcome(
        "covered_call",
        { side: "short", option_type: "call", strike: 100 },
        101,
      ),
    ).toBe("called_away");
    expect(expirationOutcome("put_credit_spread", null, 100)).toBe(
      "manual_review",
    );
  });
});
