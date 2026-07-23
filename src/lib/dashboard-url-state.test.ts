import { describe, expect, it } from "vitest";
import {
  parseTraderDashboardState,
  parseWheelDashboardState,
  serializeTraderDashboardState,
  serializeWheelDashboardState,
  type TraderDashboardUrlState,
  type WheelDashboardUrlState,
} from "./dashboard-url-state";

const wheelDefaults: WheelDashboardUrlState = {
  filters: {
    dteMin: 21,
    dteMax: 30,
    deltaMin: 0.15,
    deltaMax: 0.3,
    minPremiumYield: 0.01,
    minVolume: 100,
    minOpenInterest: 500,
    maxSpreadPctOfMid: 0.2,
    minSpreadReturnOnRisk: 0.25,
    maxSpreadWidth: 10,
    spreadLongLegCount: 3,
    excludeEarnings: true,
    includeWeeklies: false,
  },
  personaId: "balanced_wheel",
  screenerStrategy: "short_put",
  tab: "puts",
  ticker: "",
};

const traderDefaults: TraderDashboardUrlState = {
  filters: {
    category: "OVERALL",
    limit: 25,
    minValue: 10000,
    orderBy: "PNL",
    timePeriod: "WEEK",
  },
  tab: "smart",
  wallet: "",
};

describe("dashboard URL state", () => {
  it("round-trips every applied Wheel field", () => {
    const state: WheelDashboardUrlState = {
      ...wheelDefaults,
      filters: {
        ...wheelDefaults.filters,
        dteMin: 7,
        excludeEarnings: false,
        includeWeeklies: true,
      },
      personaId: "weekly_theta",
      screenerStrategy: "put_credit_spread",
      tab: "putSpreads",
      ticker: "aapl",
    };

    expect(
      parseWheelDashboardState(
        serializeWheelDashboardState(state),
        wheelDefaults,
        ["balanced_wheel", "weekly_theta"],
      ),
    ).toEqual({ ...state, ticker: "AAPL" });
  });

  it("falls back safely for malformed Wheel parameters", () => {
    const restored = parseWheelDashboardState(
      "?persona=unknown&tab=nope&f_dteMin=not-a-number&f_dteMax=1.5&f_deltaMin=-1",
      wheelDefaults,
      ["balanced_wheel"],
    );

    expect(restored).toEqual(wheelDefaults);
  });

  it("round-trips trader filters, tab, and wallet", () => {
    const state: TraderDashboardUrlState = {
      filters: {
        category: "CRYPTO",
        limit: 10,
        minValue: 50000,
        orderBy: "VOL",
        timePeriod: "MONTH",
      },
      tab: "lookup",
      wallet: "0xABCDEF",
    };

    expect(
      parseTraderDashboardState(
        serializeTraderDashboardState(state),
        traderDefaults,
      ),
    ).toEqual({ ...state, wallet: "0xabcdef" });
  });

  it("rejects trader numeric parameters outside the API contract", () => {
    const restored = parseTraderDashboardState(
      "?limit=2.5&minValue=10000001",
      traderDefaults,
    );

    expect(restored.filters.limit).toBe(traderDefaults.filters.limit);
    expect(restored.filters.minValue).toBe(traderDefaults.filters.minValue);
  });
});
