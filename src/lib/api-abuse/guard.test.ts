import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequiredAccountSessionMock = vi.hoisted(() => vi.fn());
const requestSupabaseRestMock = vi.hoisted(() => vi.fn());
const getSupabaseServiceConfigMock = vi.hoisted(() => vi.fn());
const createSupabaseRouteClientMock = vi.hoisted(() => vi.fn());
const scheduleAlertSampleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ API_ABUSE_HMAC_SECRET: "a".repeat(32) }),
}));

vi.mock("@/lib/supabase/account-session", () => ({
  accountSessionErrorResponse: (code: string) => Response.json(
    { error: { code } },
    { status: code === "UNAUTHENTICATED" ? 401 : 403 },
  ),
  copyAuthCookies: (_source: Response, target: Response) => target,
  getRequiredAccountSession: getRequiredAccountSessionMock,
}));

vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: getSupabaseServiceConfigMock,
  requestSupabaseRest: requestSupabaseRestMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteClient: createSupabaseRouteClientMock,
}));
vi.mock("@/lib/observability/alert-control-plane", () => ({
  scheduleAlertSample: scheduleAlertSampleMock,
}));

function request() {
  return new Request("https://alpha-dog.test/api/trade/analyze", {
    headers: { "x-forwarded-for": "203.0.113.10" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  getRequiredAccountSessionMock.mockReset();
  requestSupabaseRestMock.mockReset();
  getSupabaseServiceConfigMock.mockReset();
  createSupabaseRouteClientMock.mockReset();
  scheduleAlertSampleMock.mockReset();
  getSupabaseServiceConfigMock.mockReturnValue({
    serviceRoleKey: "service-role-key",
    url: "https://alpha-dog.supabase.co",
  });
  getRequiredAccountSessionMock.mockResolvedValue({
    response: Response.json({}),
    user: { id: "11111111-1111-1111-1111-111111111111" },
  });
  createSupabaseRouteClientMock.mockReturnValue(null);
});

describe("paid route abuse guard", () => {
  it("requires an authenticated account for AI routes", async () => {
    getRequiredAccountSessionMock.mockResolvedValue({ code: "UNAUTHENTICATED" });

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "tradeAnalyze");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(401);
    }
    expect(requestSupabaseRestMock).not.toHaveBeenCalled();
  });

  it("acquires and releases a distributed concurrency lease", async () => {
    requestSupabaseRestMock
      .mockResolvedValueOnce({
        allowed: true,
        lease_id: "22222222-2222-2222-2222-222222222222",
      })
      .mockResolvedValueOnce(null);

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "tradeAnalyze");

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      await result.release();
    }
    expect(requestSupabaseRestMock).toHaveBeenNthCalledWith(
      1,
      "rpc/acquire_api_abuse_budget",
      expect.objectContaining({
        body: expect.objectContaining({
          p_concurrency_limit: 2,
          p_ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          p_route_key: "trade.analyze",
          p_user_id: "11111111-1111-1111-1111-111111111111",
        }),
      }),
    );
    expect(scheduleAlertSampleMock).toHaveBeenCalledWith(
      "paid_usage_anomaly",
      0,
    );
    expect(requestSupabaseRestMock).toHaveBeenNthCalledWith(
      2,
      "rpc/release_api_abuse_lease",
      expect.objectContaining({
        body: {
          p_lease_id: "22222222-2222-2222-2222-222222222222",
          p_route_key: "trade.analyze",
        },
      }),
    );
  });

  it.each([
    ["rate", "API_RATE_LIMITED"],
    ["concurrency", "API_CONCURRENCY_LIMITED"],
  ] as const)("returns stable 429 responses for %s limits", async (reason, code) => {
    requestSupabaseRestMock.mockResolvedValue({
      allowed: false,
      reason,
      retry_after_seconds: 17,
    });

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "tradeAnalyze");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("Retry-After")).toBe("17");
      expect(await result.response.json()).toMatchObject({ error: { code } });
    }
    expect(scheduleAlertSampleMock).toHaveBeenCalledWith(
      "paid_usage_anomaly",
      1,
    );
  });

  it("fails closed when the distributed limiter is unavailable", async () => {
    requestSupabaseRestMock.mockRejectedValue(new Error("database offline"));

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "tradeAnalyze");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(503);
      expect(await result.response.json()).toMatchObject({
        error: { code: "ABUSE_PROTECTION_UNAVAILABLE" },
      });
    }
    expect(scheduleAlertSampleMock).toHaveBeenCalledWith(
      "paid_usage_anomaly",
      1,
    );
  });

  it("fails closed when authentication cannot be verified", async () => {
    getRequiredAccountSessionMock.mockRejectedValue(new Error("auth offline"));

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "tradeAnalyze");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(503);
      expect(await result.response.json()).toMatchObject({
        error: { code: "ABUSE_PROTECTION_UNAVAILABLE" },
      });
    }
    expect(requestSupabaseRestMock).not.toHaveBeenCalled();
    expect(scheduleAlertSampleMock).toHaveBeenCalledWith(
      "paid_usage_anomaly",
      1,
    );
  });

  it("hides diagnostics in production before calling providers", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { acquirePaidRouteGuard } = await import("./guard");
    const result = await acquirePaidRouteGuard(request(), "alpacaFeedTest");

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(404);
    }
    expect(getRequiredAccountSessionMock).not.toHaveBeenCalled();
    expect(requestSupabaseRestMock).not.toHaveBeenCalled();
  });
});
