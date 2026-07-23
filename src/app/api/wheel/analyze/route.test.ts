import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const acquirePaidRouteGuardMock = vi.hoisted(() => vi.fn());
const analyzeWheelCandidatesMock = vi.hoisted(() => vi.fn());
const getCachedWheelAnalysisMock = vi.hoisted(() => vi.fn());
const getEnvMock = vi.hoisted(() => vi.fn());
const getMarketDataConfigurationErrorMock = vi.hoisted(() => vi.fn());
const isDemoModeMock = vi.hoisted(() => vi.fn());
const persistAuthenticatedAnalysisRequestMock = vi.hoisted(() => vi.fn());
const releaseGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: acquirePaidRouteGuardMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
  getMarketDataConfigurationError: getMarketDataConfigurationErrorMock,
  isDemoMode: isDemoModeMock,
}));

vi.mock("@/lib/wheel/analysis-audit", () => ({
  persistAuthenticatedAnalysisRequest: persistAuthenticatedAnalysisRequestMock,
}));

vi.mock("@/lib/wheel/analyze", () => ({
  analyzeWheelCandidates: analyzeWheelCandidatesMock,
  getCachedWheelAnalysis: getCachedWheelAnalysisMock,
}));

const requestBody = {
  forceRefresh: false,
  persona: "balanced_wheel",
  ticker: "AAPL",
};

function request() {
  return new NextRequest("https://alpha-dog.test/api/wheel/analyze", {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.resetModules();
  acquirePaidRouteGuardMock.mockReset();
  analyzeWheelCandidatesMock.mockReset();
  getCachedWheelAnalysisMock.mockReset();
  getEnvMock.mockReset();
  getMarketDataConfigurationErrorMock.mockReset();
  isDemoModeMock.mockReset();
  persistAuthenticatedAnalysisRequestMock.mockReset();
  releaseGuardMock.mockReset();
  getEnvMock.mockReturnValue({ ALPHA_DOG_DEPLOYMENT_MODE: "live" });
  getMarketDataConfigurationErrorMock.mockReturnValue(null);
  isDemoModeMock.mockReturnValue(false);
  getCachedWheelAnalysisMock.mockResolvedValue(null);
  persistAuthenticatedAnalysisRequestMock.mockResolvedValue(null);
  acquirePaidRouteGuardMock.mockResolvedValue({
    allowed: true,
    release: releaseGuardMock,
    signal: new AbortController().signal,
    userId: "user-123",
    withAuthCookies: (response: Response) => response,
  });
});

describe("POST /api/wheel/analyze", () => {
  it("fails closed before reading cache or demo data when live credentials are missing", async () => {
    getMarketDataConfigurationErrorMock.mockReturnValue({
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      message: "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.",
    });

    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      retryable: false,
    });
    expect(getCachedWheelAnalysisMock).not.toHaveBeenCalled();
    expect(analyzeWheelCandidatesMock).not.toHaveBeenCalled();
  });

  it("returns a cache hit without consuming a paid quota", async () => {
    getCachedWheelAnalysisMock.mockResolvedValue({ ticker: "AAPL" });

    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(acquirePaidRouteGuardMock).not.toHaveBeenCalled();
    expect(analyzeWheelCandidatesMock).not.toHaveBeenCalled();
  });

  it("does not call Alpaca when the live budget is rejected", async () => {
    acquirePaidRouteGuardMock.mockResolvedValue({
      allowed: false,
      response: Response.json(
        { error: { code: "API_RATE_LIMITED" } },
        { status: 429 },
      ),
    });

    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(analyzeWheelCandidatesMock).not.toHaveBeenCalled();
  });

  it("passes the timeout signal to a permitted live analysis", async () => {
    analyzeWheelCandidatesMock.mockResolvedValue({ ticker: "AAPL" });

    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(analyzeWheelCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining(requestBody),
      {
        signal: expect.any(AbortSignal),
        skipCache: true,
      },
    );
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });
});
