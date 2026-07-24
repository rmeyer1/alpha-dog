import { describe, expect, it } from "vitest";
import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import { getMarketSessionView } from "./market-session-status";

describe("getMarketSessionView", () => {
  it("uses the shared calendar state for an early close", () => {
    const view = getMarketSessionView(
      getUsEquitiesMarketState(new Date("2026-11-27T17:45:00.000Z")),
    );

    expect(view.label).toBe("Open · early close");
    expect(view.detail).toContain("1:00 PM EST");
  });

  it("names exchange holidays instead of reporting a weekday session", () => {
    const view = getMarketSessionView(
      getUsEquitiesMarketState(new Date("2026-07-03T15:00:00.000Z")),
    );

    expect(view.label).toBe("Closed");
    expect(view.detail).toBe("Independence Day (observed)");
  });
});
