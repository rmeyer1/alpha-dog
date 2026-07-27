import { describe, expect, it } from "vitest";
import {
  dashboardRequestReducer,
  initialDashboardRequestState,
} from "./dashboard-request-state";

const identity = {
  filters: {} as never,
  personaId: "balanced" as never,
  screenerStrategy: "short_put" as const,
  tab: "puts" as const,
  ticker: "",
};
const freshness = { cacheStatus: "fresh" as const } as never;

describe("dashboardRequestReducer", () => {
  it("keeps visible results while a refresh is pending", () => {
    const loaded = dashboardRequestReducer(
      initialDashboardRequestState(identity),
      {
        type: "screenerLoaded",
        identity,
        response: { dataFreshness: freshness } as never,
      },
    );
    expect(
      dashboardRequestReducer(loaded, {
        type: "requestStarted",
        refresh: false,
      }).requestState,
    ).toBe("refreshing");
    expect(loaded.screenerResponse).not.toBeNull();
  });

  it("sets an error without discarding the prior response", () => {
    const loaded = dashboardRequestReducer(
      initialDashboardRequestState(identity),
      {
        type: "analysisLoaded",
        identity,
        response: { dataFreshness: freshness } as never,
      },
    );
    const failed = dashboardRequestReducer(loaded, {
      type: "requestFailed",
      message: "Network failed",
    });
    expect(failed).toMatchObject({
      error: "Network failed",
      requestState: "errorNoCache",
      response: loaded.response,
    });
  });
});
