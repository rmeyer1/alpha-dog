import { describe, expect, it } from "vitest";
import {
  buybackCost,
  DEFAULT_MARGIN_INTEREST_RATE,
  openExposureForPosition,
  premiumReceived,
  realizedPnlForClose,
  summarizePaperAccount,
  valueOpenPosition,
  type SimulatedAccountingPosition,
} from "./simulated-accounting";

const openShortPut: SimulatedAccountingPosition = {
  contractsOpened: 2,
  contractsRemaining: 2,
  id: "position-1",
  legs: [{
    currentMark: 0.9,
    openPrice: 1.5,
    optionType: "put",
    quantity: 2,
    side: "short",
    strike: 95,
  }],
  netCredit: 1.5,
  status: "open",
  strategyType: "short_put",
};

describe("simulated account premium and P/L calculations", () => {
  it("uses multiplier 100 for premium received and buyback cost", () => {
    expect(premiumReceived(1.5, 2)).toBe(300);
    expect(buybackCost(0.5, 1)).toBe(50);
  });

  it("values a single-leg open position from current mark data", () => {
    const valuation = valueOpenPosition(openShortPut);

    expect(valuation).toEqual({
      markStatus: "available",
      markToClose: 180,
      openExposure: 19_000,
      premiumRemaining: 300,
      unrealizedPnl: 120,
    });
  });

  it("calculates realized P/L for partial closes", () => {
    expect(realizedPnlForClose(1.5, 0.5, 1)).toBe(100);
  });

  it("calculates realized P/L for full closes", () => {
    expect(realizedPnlForClose(1.5, 0.25, 2)).toBe(250);
  });

  it("values credit spreads using the net mark to close", () => {
    const spread: SimulatedAccountingPosition = {
      contractsOpened: 1,
      contractsRemaining: 1,
      id: "position-2",
      legs: [
        {
          currentMark: 1.8,
          openPrice: 2,
          optionType: "put",
          quantity: 1,
          side: "short",
          strike: 95,
        },
        {
          currentMark: 0.9,
          openPrice: 0.8,
          optionType: "put",
          quantity: 1,
          side: "long",
          strike: 90,
        },
      ],
      netCredit: 1.2,
      status: "open",
      strategyType: "put_credit_spread",
    };

    expect(valueOpenPosition(spread)).toEqual({
      markStatus: "available",
      markToClose: 90,
      openExposure: 500,
      premiumRemaining: 120,
      unrealizedPnl: 30,
    });
    expect(realizedPnlForClose(1.2, 0.4, 1)).toBe(80);
  });

  it("returns unavailable mark status instead of inventing missing mark data", () => {
    const valuation = valueOpenPosition({
      ...openShortPut,
      legs: [{
        openPrice: 1.5,
        optionType: "put",
        quantity: 2,
        side: "short",
        strike: 95,
      }],
    });

    expect(valuation.markStatus).toBe("unavailable");
    expect(valuation.markToClose).toBeNull();
    expect(valuation.unrealizedPnl).toBeNull();
  });

  it("separates account cash, realized P/L, unrealized P/L, margin, and margin interest", () => {
    const summary = summarizePaperAccount({
      account: {
        marginBalance: 500,
        startingCash: 1_000,
      },
      events: [
        {
          cashDelta: 300,
          eventType: "opened",
        },
        {
          cashDelta: -50,
          eventType: "partial_close",
          realizedPnlDelta: 100,
        },
        {
          cashDelta: -4.25,
          eventType: "margin_interest",
        },
        {
          eventType: "manual_adjustment",
          marginDelta: 25,
        },
      ],
      positions: [{
        ...openShortPut,
        contractsRemaining: 1,
      }],
    });

    expect(summary).toEqual({
      cashBalance: 1_245.75,
      marginBalance: 525,
      marginInterestAccrued: 4.25,
      marginInterestRate: DEFAULT_MARGIN_INTEREST_RATE,
      openExposure: 9_500,
      realizedPnl: 100,
      totalPremiumCollected: 300,
      unrealizedPnl: 60,
      unrealizedPnlStatus: "available",
    });
  });

  it("marks account unrealized P/L unavailable if any open position lacks marks", () => {
    const summary = summarizePaperAccount({
      account: {
        marginInterestRate: 0.075,
        startingCash: 0,
      },
      events: [],
      positions: [
        openShortPut,
        {
          ...openShortPut,
          id: "position-3",
          legs: [{
            openPrice: 1,
            optionType: "put",
            quantity: 1,
            side: "short",
            strike: 80,
          }],
        },
      ],
    });

    expect(summary.marginInterestRate).toBe(0.075);
    expect(summary.unrealizedPnl).toBeNull();
    expect(summary.unrealizedPnlStatus).toBe("unavailable");
  });

  it("returns zero exposure for closed positions", () => {
    expect(openExposureForPosition({
      ...openShortPut,
      contractsRemaining: 0,
      status: "closed",
    })).toBe(0);
  });
});
