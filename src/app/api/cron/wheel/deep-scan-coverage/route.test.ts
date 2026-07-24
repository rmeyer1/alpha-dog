import { beforeEach, describe, expect, it, vi } from "vitest";

const getScheduledScreenerRefreshRequestsMock = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn());

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/wheel-deep-scan", () => ({
  wheelDeepScanWorkflow: {},
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret",
    WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE: 25,
    WHEEL_UNIVERSE_BACKGROUND_MAX_RUNS: 1,
  }),
  getMarketDataConfigurationError: () => null,
  isDemoMode: () => false,
}));
vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: () => ({
    serviceRoleKey: "service-role-key",
    url: "https://alpha-dog.supabase.co",
  }),
}));
vi.mock("@/lib/wheel/screener-refresh", () => ({
  getScheduledScreenerRefreshRequests:
    getScheduledScreenerRefreshRequestsMock,
}));

beforeEach(() => {
  getScheduledScreenerRefreshRequestsMock.mockReset();
  startMock.mockReset();
  getScheduledScreenerRefreshRequestsMock.mockReturnValue([
    {
      filters: {},
      persona: "balanced_wheel",
      strategy: "short_put",
    },
  ]);
  startMock.mockResolvedValue({
    runId: "deep-workflow-run-id",
    status: "running",
  });
});

describe("scheduled deep scan coverage", () => {
  it("reports enqueue acceptance separately from publication completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-23T15:10:00.000Z");

    try {
      const { GET } = await import("./route");
      const response = await GET(
        new Request(
          "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage",
          { headers: { Authorization: "Bearer cron-secret" } },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        enqueueSucceeded: true,
        publicationCompleted: false,
        started: [
          {
            completionStatus: "pending",
            enqueueStatus: "accepted",
            runId: "deep-workflow-run-id",
            status: "running",
          },
        ],
      });
      expect(startMock).toHaveBeenCalledOnce();
      expect(startMock.mock.calls[0][1][0]).toMatchObject({
        workflowIdempotencyKey: expect.stringMatching(
          /^[0-9a-f-]{36}$/,
        ),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["holiday", "2026-07-03T15:10:00.000Z"],
    ["after an early close", "2026-11-27T18:10:00.000Z"],
  ])("skips provider work on %s", async (_label, instant) => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);

    try {
      const { GET } = await import("./route");
      const response = await GET(
        new Request(
          "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage",
          { headers: { Authorization: "Bearer cron-secret" } },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        skippedCoverageHours: true,
        started: [],
      });
      expect(body.coverageHours.marketSession.isOpen).toBe(false);
      expect(startMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
