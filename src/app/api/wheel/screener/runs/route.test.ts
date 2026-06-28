import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.hoisted(() => vi.fn());
const getEnvMock = vi.hoisted(() => vi.fn());
const hasAlpacaCredentialsMock = vi.hoisted(() => vi.fn());
const getSupabaseServiceConfigMock = vi.hoisted(() => vi.fn());
const getMaterializedWheelScreenerResponseMock = vi.hoisted(() => vi.fn());
const cacheCompletedWheelScreenerResponseMock = vi.hoisted(() => vi.fn());
const getCachedWheelScreenerResponseMock = vi.hoisted(() => vi.fn());
const getRunningScreenerRefreshFallbackMock = vi.hoisted(() => vi.fn());

vi.mock("workflow/api", () => ({
  start: startMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
  hasAlpacaCredentials: hasAlpacaCredentialsMock,
}));

vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: getSupabaseServiceConfigMock,
}));

vi.mock("@/lib/wheel/materialized-screener", () => ({
  getMaterializedWheelScreenerResponse: getMaterializedWheelScreenerResponseMock,
}));

vi.mock("@/lib/wheel/screener", () => ({
  cacheCompletedWheelScreenerResponse: cacheCompletedWheelScreenerResponseMock,
  getCachedWheelScreenerResponse: getCachedWheelScreenerResponseMock,
}));

vi.mock("@/lib/wheel/screener-refresh", () => ({
  getRunningScreenerRefreshFallback: getRunningScreenerRefreshFallbackMock,
}));

vi.mock("@/workflows/wheel-screener", () => ({
  wheelScreenerWorkflow: {},
}));

const requestBody = {
  forceRefresh: true,
  limit: 50,
  persona: "balanced_wheel",
  strategy: "short_put",
};

const fallbackResponse = {
  companies: [],
  dataFreshness: {
    asOf: "2026-06-07T13:03:00.000Z",
    cacheStatus: "stale",
    feed: "indicative",
    nextSuggestedRefreshAt: null,
    refreshStatus: "refreshing",
    source: "materialized",
  },
  errors: [],
  persona: {
    id: "balanced_wheel",
    motto: "Balanced",
    name: "Balanced Wheel",
  },
  progress: {
    batchScreenedCount: 0,
    batchSize: 8,
    cursor: 0,
    nextCursor: null,
    processedCount: 0,
    resultScope: "complete",
    status: "complete",
    totalCount: 0,
  },
  screenedCount: 0,
  skippedCount: 0,
  warnings: [],
};

function runRequest() {
  return new Request("https://alpha-dog.test/api/wheel/screener/runs", {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.resetModules();
  startMock.mockReset();
  getEnvMock.mockReset();
  hasAlpacaCredentialsMock.mockReset();
  getSupabaseServiceConfigMock.mockReset();
  getMaterializedWheelScreenerResponseMock.mockReset();
  cacheCompletedWheelScreenerResponseMock.mockReset();
  getCachedWheelScreenerResponseMock.mockReset();
  getRunningScreenerRefreshFallbackMock.mockReset();
  getEnvMock.mockReturnValue({ USE_DEMO_DATA: false });
  hasAlpacaCredentialsMock.mockReturnValue(true);
  getSupabaseServiceConfigMock.mockReturnValue({
    serviceRoleKey: "service-role-key",
    url: "https://alpha-dog.supabase.co",
  });
  getCachedWheelScreenerResponseMock.mockResolvedValue(null);
  getMaterializedWheelScreenerResponseMock.mockResolvedValue(null);
});

describe("POST /api/wheel/screener/runs", () => {
  it("returns a completed fallback instead of starting a duplicate workflow", async () => {
    getRunningScreenerRefreshFallbackMock.mockResolvedValue(fallbackResponse);

    const { POST } = await import("./route");
    const response = await POST(runRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      result: {
        dataFreshness: {
          refreshStatus: "refreshing",
        },
      },
      runId: "materialized-refreshing",
      status: "completed",
    });
    expect(cacheCompletedWheelScreenerResponseMock).toHaveBeenCalledWith(
      expect.objectContaining(requestBody),
      fallbackResponse,
    );
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts a workflow when no running refresh fallback exists", async () => {
    getRunningScreenerRefreshFallbackMock.mockResolvedValue(null);
    startMock.mockResolvedValue({
      runId: "run-123",
      status: "running",
    });

    const { POST } = await import("./route");
    const response = await POST(runRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      result: null,
      runId: "run-123",
      status: "running",
    });
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
