import { describe, expect, it } from "vitest";
import {
  knownCandidateMetadata,
  optionContractSymbol,
  optionTypeForStrategy,
  premiumReceivedFromCredit,
  uniqueContracts,
} from "./candidate-domain";

describe("universe scanner candidate domain", () => {
  it("maps strategies and OCC contract symbols deterministically", () => {
    expect(optionTypeForStrategy("short_put")).toBe("put");
    expect(optionTypeForStrategy("call_credit_spread")).toBe("call");
    expect(optionContractSymbol("AAPL", "2026-06-29", "put", 95)).toBe(
      "AAPL260629P00095000",
    );
    expect(optionContractSymbol("AAPL!", "2026-06-29", "put", 95)).toBeNull();
  });

  it("normalizes persisted candidate legs into explicit metadata", () => {
    expect(
      knownCandidateMetadata({
        as_of: "2026-06-08T15:45:00.000Z",
        expiration: "2026-06-29",
        long_strike: "90",
        option_type: "put",
        short_strike: "95",
        symbol: "AAPL",
      }),
    ).toEqual([
      {
        contractSymbol: "AAPL260629P00095000",
        expirationDate: "2026-06-29",
        openInterest: null,
        optionType: "put",
        strike: 95,
      },
      {
        contractSymbol: "AAPL260629P00090000",
        expirationDate: "2026-06-29",
        openInterest: null,
        optionType: "put",
        strike: 90,
      },
    ]);
  });

  it("preserves the last contract for a duplicate symbol and credit units", () => {
    const first = {
      ask: 1.1,
      bid: 1,
      contractSymbol: "AAPL260629P00095000",
      delta: -0.2,
      expirationDate: "2026-06-29",
      impliedVolatility: 0.3,
      openInterest: 100,
      optionType: "put" as const,
      strike: 95,
      theta: -0.03,
      volume: 10,
    };
    const replacement = { ...first, ask: 1.2 };

    expect(uniqueContracts([first, replacement])).toEqual([replacement]);
    expect(premiumReceivedFromCredit(1.2345)).toBe(123.45);
    expect(premiumReceivedFromCredit(null)).toBeUndefined();
  });
});
