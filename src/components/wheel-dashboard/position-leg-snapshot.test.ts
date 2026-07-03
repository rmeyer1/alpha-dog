import { describe, expect, it } from "vitest";
import {
  legSnapshotFromSavedLeg,
  legSnapshotFromSpreadLeg,
  unavailableLabel,
} from "./position-leg-snapshot";

describe("position leg snapshots", () => {
  it("normalizes live spread legs for reusable display", () => {
    const snapshot = legSnapshotFromSpreadLeg({
      expirationDate: "2026-08-21",
      leg: {
        ask: 2.05,
        bid: 1.95,
        contractSymbol: "AAPL260821P00190000",
        delta: -0.28,
        impliedVolatility: 0.31,
        midpoint: 2,
        openInterest: 300,
        strike: 190,
        theta: -0.04,
        volume: 120,
      },
      optionType: "put",
      side: "short",
    });

    expect(snapshot).toMatchObject({
      askPrice: 2.05,
      bidPrice: 1.95,
      contractSymbol: "AAPL260821P00190000",
      expirationDate: "2026-08-21",
      midPrice: 2,
      optionType: "put",
      side: "short",
      strike: 190,
    });
  });

  it("normalizes saved position legs without live candidate data", () => {
    const snapshot = legSnapshotFromSavedLeg({
      askPrice: null,
      bidPrice: 1.2,
      contractSymbol: "AAPL260821C00210000",
      delta: null,
      expirationDate: "2026-08-21",
      impliedVolatility: null,
      midPrice: null,
      openInterest: 0,
      openPrice: 1.25,
      optionType: "call",
      quantity: 2,
      side: "short",
      strike: 210,
      theta: 0,
      volume: null,
    });

    expect(snapshot).toMatchObject({
      askPrice: null,
      contractSymbol: "AAPL260821C00210000",
      openInterest: 0,
      openPrice: 1.25,
      quantity: 2,
      theta: 0,
    });
  });

  it("distinguishes missing values from zero values", () => {
    expect(unavailableLabel(null)).toBe("Unavailable");
    expect(unavailableLabel(undefined)).toBe("Unavailable");
    expect(unavailableLabel(0)).toBe("0");
  });
});
