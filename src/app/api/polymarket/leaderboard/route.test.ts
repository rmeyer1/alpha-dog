import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const acquirePaidRouteGuardMock = vi.hoisted(() => vi.fn());
const releaseGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: acquirePaidRouteGuardMock,
}));

function jsonResponse(body: unknown) {
  return {
    json: async () => body,
    ok: true,
    status: 200,
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  acquirePaidRouteGuardMock.mockReset();
  releaseGuardMock.mockReset();
  acquirePaidRouteGuardMock.mockResolvedValue({
    allowed: true,
    release: releaseGuardMock,
    signal: new AbortController().signal,
    userId: null,
    withAuthCookies: (response: Response) => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("POLYMARKET_DATA_API_BASE_URL", "https://data-api.polymarket.com");
});

describe("polymarket leaderboard route", () => {
  it("returns normalized leaderboard data", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          pnl: 100,
          proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
          rank: 1,
          userName: "Signal",
          vol: 1000,
        },
      ]),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "https://alpha.test/api/polymarket/leaderboard?category=OVERALL&timePeriod=WEEK&orderBy=PNL&limit=25",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.traders[0].userName).toBe("Signal");
    expect(acquirePaidRouteGuardMock).toHaveBeenCalledWith(
      expect.any(Request),
      "polymarketCacheMiss",
    );
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid requests", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha.test/api/polymarket/leaderboard?limit=500"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_POLYMARKET_LEADERBOARD_REQUEST");
  });

  it("does not consume another paid quota for a cache hit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          pnl: 100,
          proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
          rank: 1,
          userName: "Signal",
          vol: 1000,
        },
      ]),
    );

    const { GET } = await import("./route");
    const url =
      "https://alpha.test/api/polymarket/leaderboard?category=OVERALL&timePeriod=WEEK&orderBy=PNL&limit=24";

    expect((await GET(new Request(url))).status).toBe(200);
    expect((await GET(new Request(url))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(acquirePaidRouteGuardMock).toHaveBeenCalledTimes(1);
  });

  it("uses the authenticated budget for force refreshes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "https://alpha.test/api/polymarket/leaderboard?forceRefresh=true",
      ),
    );

    expect(response.status).toBe(200);
    expect(acquirePaidRouteGuardMock).toHaveBeenCalledWith(
      expect.any(Request),
      "polymarketForceRefresh",
    );
  });
});
