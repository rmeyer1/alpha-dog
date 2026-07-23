import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.hoisted(() => vi.fn());
const getEnvMock = vi.hoisted(() => vi.fn());
const getMarketDataConfigurationErrorMock = vi.hoisted(() => vi.fn());
const isDemoModeMock = vi.hoisted(() => vi.fn());
const getMaterializedWheelScreenerResponseMock = vi.hoisted(() => vi.fn());
const analyzeTopWheelCompaniesMock = vi.hoisted(() => vi.fn());
const getRunningScreenerRefreshFallbackMock = vi.hoisted(() => vi.fn());
const acquirePaidRouteGuardMock = vi.hoisted(() => vi.fn());
const releaseGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: acquirePaidRouteGuardMock,
}));

vi.mock("workflow/api", () => ({
  start: startMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
  getMarketDataConfigurationError: getMarketDataConfigurationErrorMock,
  isDemoMode: isDemoModeMock,
}));

vi.mock("@/lib/wheel/materialized-screener", () => ({
  getMaterializedWheelScreenerResponse: getMaterializedWheelScreenerResponseMock,
}));

vi.mock("@/lib/wheel/screener", () => ({
  analyzeTopWheelCompanies: analyzeTopWheelCompaniesMock,
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

function screenerRequest() {
  return new Request("https://alpha-dog.test/api/wheel/screener", {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.resetModules();
  startMock.mockReset();
  getEnvMock.mockReset();
  getMarketDataConfigurationErrorMock.mockReset();
  isDemoModeMock.mockReset();
  getMaterializedWheelScreenerResponseMock.mockReset();
  analyzeTopWheelCompaniesMock.mockReset();
  getRunningScreenerRefreshFallbackMock.mockReset();
  acquirePaidRouteGuardMock.mockReset();
  releaseGuardMock.mockReset();
  acquirePaidRouteGuardMock.mockResolvedValue({
    allowed: true,
    release: releaseGuardMock,
    signal: new AbortController().signal,
    userId: "user-123",
    withAuthCookies: (response: Response) => response,
  });
  getEnvMock.mockReturnValue({ ALPHA_DOG_DEPLOYMENT_MODE: "live" });
  getMarketDataConfigurationErrorMock.mockReturnValue(null);
  isDemoModeMock.mockReturnValue(false);
});

describe("POST /api/wheel/screener", () => {
  it("does not return stored or demo candidates when live configuration is invalid", async () => {
    getMarketDataConfigurationErrorMock.mockReturnValue({
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      message: "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.",
    });

    const { POST } = await import("./route");
    const response = await POST(screenerRequest());

    expect(response.status).toBe(503);
    expect(getMaterializedWheelScreenerResponseMock).not.toHaveBeenCalled();
    expect(analyzeTopWheelCompaniesMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("serves a materialized cache hit without consuming a paid quota", async () => {
    getMaterializedWheelScreenerResponseMock.mockResolvedValue(fallbackResponse);

    const { POST } = await import("./route");
    const response = await POST(new Request(
      "https://alpha-dog.test/api/wheel/screener",
      {
        body: JSON.stringify({ ...requestBody, forceRefresh: false }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(acquirePaidRouteGuardMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("serves a running refresh fallback instead of starting a duplicate workflow", async () => {
    getRunningScreenerRefreshFallbackMock.mockResolvedValue(fallbackResponse);

    const { POST } = await import("./route");
    const response = await POST(screenerRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dataFreshness.refreshStatus).toBe("refreshing");
    expect(getRunningScreenerRefreshFallbackMock).toHaveBeenCalledWith(
      expect.objectContaining(requestBody),
    );
    expect(startMock).not.toHaveBeenCalled();
    expect(acquirePaidRouteGuardMock).not.toHaveBeenCalled();
  });

  it("starts a workflow when no running refresh fallback exists", async () => {
    getRunningScreenerRefreshFallbackMock.mockResolvedValue(null);
    startMock.mockResolvedValue({
      runId: "run-123",
      status: "running",
    });

    const { POST } = await import("./route");
    const response = await POST(screenerRequest());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      result: null,
      runId: "run-123",
      status: "running",
    });
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a workflow when the concurrency budget is exhausted", async () => {
    getRunningScreenerRefreshFallbackMock.mockResolvedValue(null);
    acquirePaidRouteGuardMock.mockResolvedValue({
      allowed: false,
      response: Response.json(
        { error: { code: "API_CONCURRENCY_LIMITED" } },
        { status: 429, headers: { "Retry-After": "10" } },
      ),
    });

    const { POST } = await import("./route");
    const response = await POST(screenerRequest());

    expect(response.status).toBe(429);
    expect(startMock).not.toHaveBeenCalled();
  });
});
