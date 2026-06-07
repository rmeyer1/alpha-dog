import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runningSnapshot = {
  id: "22222222-2222-2222-2222-222222222222",
  persona: "balanced_wheel",
  strategy: "short_put",
  filter_key: "{}",
  filters: {},
  feed: "indicative",
  status: "running",
  started_at: "2026-06-07T13:50:00.000Z",
  completed_at: null,
  total_count: 0,
  processed_count: 0,
  skipped_count: 0,
  error: null,
  created_at: "2026-06-07T13:50:00.000Z",
};

const completeSnapshot = {
  ...runningSnapshot,
  status: "complete",
  started_at: "2026-06-07T13:00:00.000Z",
  completed_at: "2026-06-07T13:40:00.000Z",
  created_at: "2026-06-07T13:00:00.000Z",
};

function stubLiveEnv() {
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
}

async function importRefresh() {
  return await import("./screener-refresh");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.setSystemTime("2026-06-07T14:00:00.000Z");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("screener refresh scheduling", () => {
  it("builds the default balanced strategy refresh matrix", async () => {
    const { getScheduledScreenerRefreshRequests } = await importRefresh();

    expect(getScheduledScreenerRefreshRequests()).toEqual([
      expect.objectContaining({
        persona: "balanced_wheel",
        strategy: "short_put",
        forceRefresh: true,
      }),
      expect.objectContaining({
        persona: "balanced_wheel",
        strategy: "put_credit_spread",
        forceRefresh: true,
      }),
      expect.objectContaining({
        persona: "balanced_wheel",
        strategy: "covered_call",
        forceRefresh: true,
      }),
      expect.objectContaining({
        persona: "balanced_wheel",
        strategy: "call_credit_spread",
        forceRefresh: true,
      }),
    ]);
  });

  it("detects Eastern market hours across daylight saving offsets", async () => {
    const { getEasternMarketHoursState } = await importRefresh();

    expect(
      getEasternMarketHoursState(new Date("2026-06-08T13:29:00.000Z")),
    ).toMatchObject({
      isMarketDay: true,
      isOpen: false,
      weekday: "Mon",
    });
    expect(
      getEasternMarketHoursState(new Date("2026-06-08T13:30:00.000Z")),
    ).toMatchObject({
      isMarketDay: true,
      isOpen: true,
      weekday: "Mon",
    });
    expect(
      getEasternMarketHoursState(new Date("2026-06-08T20:30:00.000Z")),
    ).toMatchObject({
      isMarketDay: true,
      isOpen: false,
      weekday: "Mon",
    });
    expect(
      getEasternMarketHoursState(new Date("2026-01-05T14:30:00.000Z")),
    ).toMatchObject({
      isMarketDay: true,
      isOpen: true,
      weekday: "Mon",
    });
  });

  it("does not query snapshots when Supabase service-role config is missing", async () => {
    const { getScreenerRefreshDecision } = await importRefresh();
    const decision = await getScreenerRefreshDecision({
      persona: "balanced_wheel",
      strategy: "short_put",
    });

    expect(decision.status).toBe("not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips matching recent running snapshots", async () => {
    stubLiveEnv();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([runningSnapshot]), { status: 200 }),
    );

    const { getScreenerRefreshDecision } = await importRefresh();
    const decision = await getScreenerRefreshDecision(
      {
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      45 * 60 * 1000,
    );

    expect(decision).toMatchObject({
      status: "running",
      snapshotId: runningSnapshot.id,
    });
  });

  it("skips recent completed snapshots and refreshes old snapshots", async () => {
    stubLiveEnv();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify([completeSnapshot]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ...completeSnapshot,
              completed_at: "2026-06-07T12:00:00.000Z",
              created_at: "2026-06-07T12:00:00.000Z",
            },
          ]),
          { status: 200 },
        ),
      );

    const { getScreenerRefreshDecision } = await importRefresh();
    const recent = await getScreenerRefreshDecision(
      {
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      45 * 60 * 1000,
    );
    const old = await getScreenerRefreshDecision(
      {
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      45 * 60 * 1000,
    );

    expect(recent.status).toBe("recent");
    expect(recent.ageMs).toBe(20 * 60 * 1000);
    expect(old.status).toBe("due");
    expect(old.ageMs).toBe(2 * 60 * 60 * 1000);
  });
});
