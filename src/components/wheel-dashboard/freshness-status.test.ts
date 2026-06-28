import { describe, expect, it } from "vitest";
import type { WheelAnalysisResponse } from "@/lib/wheel/types";
import { getFreshnessView } from "./freshness-status";

type DataFreshness = WheelAnalysisResponse["dataFreshness"];

const baseFreshness: DataFreshness = {
  asOf: "2026-06-27T22:36:00.000Z",
  cacheStatus: "fresh",
  feed: "opra",
  lastCompletedAt: "2026-06-27T22:36:00.000Z",
  lastStartedAt: "2026-06-27T22:35:00.000Z",
  nextSuggestedRefreshAt: "2026-06-27T22:38:00.000Z",
  source: "materialized",
};

describe("getFreshnessView", () => {
  it("promotes refreshStatus over cacheStatus for active refreshes", () => {
    const view = getFreshnessView(
      {
        ...baseFreshness,
        cacheStatus: "stale",
        refreshStatus: "refreshing",
      },
      "successStale",
    );

    expect(view.status).toBe("refreshing");
    expect(view.title).toBe("Refreshing");
    expect(view.detail).toContain("showing cached results");
  });

  it("explains failed refresh fallbacks without hiding completed results", () => {
    const view = getFreshnessView(
      {
        ...baseFreshness,
        cacheStatus: "stale",
        refreshStatus: "failed",
      },
      "successStale",
    );

    expect(view.status).toBe("failed");
    expect(view.title).toBe("Refresh failed");
    expect(view.detail).toContain("showing last completed results");
  });

  it("keeps demo data distinct from live freshness states", () => {
    const view = getFreshnessView(
      {
        ...baseFreshness,
        cacheStatus: "demo",
        feed: "demo",
      },
      "successFresh",
    );

    expect(view.status).toBe("demo");
    expect(view.title).toBe("Demo data");
  });
});
