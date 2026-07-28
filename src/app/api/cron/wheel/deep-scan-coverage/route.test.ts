import { beforeEach, describe, expect, it, vi } from "vitest";

const getScheduledScreenerRefreshRequestsMock = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn());
const workMocks = vi.hoisted(() => ({
  claim: vi.fn(),
  metrics: vi.fn(),
  peek: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/wheel-tiered-deep-scan", () => ({
  wheelTieredDeepScanWorkflow: {},
}));
vi.mock("@/lib/wheel/deep-scan-work/repository", () => ({
  claimDeepScanWork: workMocks.claim,
  getDeepScanWorkMetrics: workMocks.metrics,
  peekDeepScanWork: workMocks.peek,
  syncDeepScanWorkQueue: workMocks.sync,
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "cron-secret",
    WHEEL_DEEP_SCAN_CLAIM_LEASE_SECONDS: 3600,
    WHEEL_DEEP_SCAN_CLAIM_LIMIT: 625,
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
  vi.clearAllMocks();
  getScheduledScreenerRefreshRequestsMock.mockReset();
  startMock.mockReset();
  getScheduledScreenerRefreshRequestsMock.mockReturnValue([
    {
      filters: {},
      persona: "balanced_wheel",
      strategy: "short_put",
    },
  ]);
  workMocks.sync.mockResolvedValue({
    active_symbols: 1,
    eligible_units: 2,
  });
  workMocks.claim.mockResolvedValue([
    {
      attemptCount: 1,
      coverageTier: "priority",
      leaseAcquiredAt: "2026-07-23T15:00:00.000Z",
      leaseExpiresAt: "2026-07-23T16:00:00.000Z",
      leaseOwnerId: "owner",
      leaseToken: "00000000-0000-4000-8000-000000000002",
      nextDueAt: "2026-07-23T15:00:00.000Z",
      optionType: "put",
      symbol: "AAPL",
      tierPriority: 1,
      tierRank: 1,
    },
  ]);
  workMocks.peek.mockResolvedValue([]);
  workMocks.metrics.mockResolvedValue({
    backlog_count: 1,
    total_count: 2,
  });
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
        batchKey: expect.stringMatching(
          /^wheel-tiered-deep-scan:2026-07-23T15:00:00.000Z:[0-9a-f-]{36}$/,
        ),
        claims: [expect.objectContaining({ symbol: "AAPL" })],
        leaseSeconds: 3600,
        requests: [expect.objectContaining({ strategy: "short_put" })],
      });
      expect(workMocks.sync).toHaveBeenCalledOnce();
      expect(workMocks.claim).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 625 }),
      );
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
      expect(workMocks.sync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews due work without taking leases on a dry run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-23T15:10:00.000Z");
    workMocks.peek.mockResolvedValueOnce([
      {
        coverageTier: "daily",
        nextDueAt: "2026-07-23T15:00:00.000Z",
        optionType: "put",
        symbol: "MSFT",
        tierPriority: 2,
        tierRank: 300,
      },
    ]);

    try {
      const { GET } = await import("./route");
      const response = await GET(
        new Request(
          "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage?dryRun=true",
          { headers: { Authorization: "Bearer cron-secret" } },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        claimedCount: 1,
        dryRun: true,
        planned: {
          work: [expect.objectContaining({ symbol: "MSFT" })],
        },
        started: [],
      });
      expect(workMocks.claim).not.toHaveBeenCalled();
      expect(startMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unauthenticated cron requests before queue access", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage",
      ),
    );

    expect(response.status).toBe(401);
    expect(workMocks.sync).not.toHaveBeenCalled();
  });

  it("returns truthful empty-queue metrics without starting a workflow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-23T15:10:00.000Z");
    workMocks.claim.mockResolvedValueOnce([]);

    try {
      const { POST } = await import("./route");
      const response = await POST(
        new Request(
          "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage",
          {
            headers: { Authorization: "Bearer cron-secret" },
            method: "POST",
          },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        claimedCount: 0,
        publicationCompleted: false,
        started: [],
      });
      expect(startMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps claim controls and reports synchronous workflow completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-23T15:10:00.000Z");
    startMock.mockResolvedValueOnce({
      runId: "completed-run",
      status: "completed",
    });

    try {
      const { GET } = await import("./route");
      const response = await GET(
        new Request(
          "https://alpha-dog.vercel.app/api/cron/wheel/deep-scan-coverage?batchSize=5000&leaseSeconds=-1",
          { headers: { Authorization: "Bearer cron-secret" } },
        ),
      );
      const body = await response.json();

      expect(body).toMatchObject({
        batchSize: 1000,
        leaseSeconds: 3600,
        publicationCompleted: true,
        started: [{
          completionStatus: "complete",
          runId: "completed-run",
        }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
