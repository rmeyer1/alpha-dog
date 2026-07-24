import { beforeEach, describe, expect, it, vi } from "vitest";

const getEasternMarketHoursStateMock = vi.hoisted(() => vi.fn());
const getScheduledScreenerRefreshRequestsMock = vi.hoisted(() => vi.fn());
const getScreenerRefreshDecisionMock = vi.hoisted(() => vi.fn());
const startMock = vi.hoisted(() => vi.fn());

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/wheel-screener", () => ({
  wheelScreenerWorkflow: {},
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CRON_SECRET: "cron-secret" }),
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
  getEasternMarketHoursState: getEasternMarketHoursStateMock,
  getScheduledScreenerRefreshRequests:
    getScheduledScreenerRefreshRequestsMock,
  getScreenerRefreshDecision: getScreenerRefreshDecisionMock,
  getScreenerRefreshMaxRuns: () => 4,
  getScreenerWeekendRefreshMaxRuns: () => 4,
  summarizeScreenerRefreshDecisions: () => ({ dueCount: 1 }),
}));

beforeEach(() => {
  getEasternMarketHoursStateMock.mockReset();
  getScheduledScreenerRefreshRequestsMock.mockReset();
  getScreenerRefreshDecisionMock.mockReset();
  startMock.mockReset();

  getEasternMarketHoursStateMock.mockReturnValue({
    easternMinutes: 600,
    isMarketDay: true,
    isOpen: true,
    isWeekendPrewarm: false,
    weekday: "Thu",
  });
  const request = {
    persona: "balanced_wheel",
    strategy: "short_put",
  };
  getScheduledScreenerRefreshRequestsMock.mockReturnValue([request]);
  getScreenerRefreshDecisionMock.mockResolvedValue({
    ageMs: 60 * 60 * 1000,
    reason: "due",
    request,
    snapshotId: null,
    status: "due",
  });
  startMock.mockResolvedValue({
    runId: "workflow-run-id",
    status: "running",
  });
});

describe("scheduled screener refresh", () => {
  it("reports enqueue acceptance separately from publication completion", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.vercel.app/api/cron/wheel/screener-refresh", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
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
          runId: "workflow-run-id",
          status: "running",
        },
      ],
    });
    expect(startMock).toHaveBeenCalledOnce();
  });
});
