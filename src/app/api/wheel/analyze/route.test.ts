import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const acquirePaidRouteGuardMock = vi.hoisted(() => vi.fn());
const analyzeWheelCandidatesMock = vi.hoisted(() => vi.fn());
const getCachedWheelAnalysisMock = vi.hoisted(() => vi.fn());
const getEnvMock = vi.hoisted(() => vi.fn());
const hasAlpacaCredentialsMock = vi.hoisted(() => vi.fn());
const persistAuthenticatedAnalysisRequestMock = vi.hoisted(() => vi.fn());
const releaseGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: acquirePaidRouteGuardMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
  hasAlpacaCredentials: hasAlpacaCredentialsMock,
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
  hasAlpacaCredentialsMock.mockReset();
  persistAuthenticatedAnalysisRequestMock.mockReset();
  releaseGuardMock.mockReset();
  getEnvMock.mockReturnValue({ USE_DEMO_DATA: false });
  hasAlpacaCredentialsMock.mockReturnValue(true);
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
