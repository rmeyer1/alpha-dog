import { describe, expect, it, vi } from "vitest";

describe("wheel analysis", () => {
  it("returns deterministic demo-mode result groups without Alpaca credentials", async () => {
    vi.resetModules();
    vi.stubEnv("USE_DEMO_DATA", "true");
    vi.stubEnv("EARNINGS_PROVIDER_ENABLED", "false");

    const { analyzeWheelCandidates } = await import("./analyze");
    const response = await analyzeWheelCandidates({
      ticker: "aapl",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    expect(response.ticker).toBe("AAPL");
    expect(response.dataFreshness.cacheStatus).toBe("demo");
    expect(response.dataFreshness.feed).toBe("demo");
    expect(response.shortPuts).toHaveLength(5);
    expect(response.coveredCalls).toHaveLength(5);
    expect(response.putCreditSpreads).toEqual(expect.any(Array));
    expect(response.callCreditSpreads).toEqual(expect.any(Array));
    expect(response.warnings.map((warning) => warning.type)).toEqual(
      expect.arrayContaining(["data_quality", "earnings"]),
    );

    vi.unstubAllEnvs();
  });
});
