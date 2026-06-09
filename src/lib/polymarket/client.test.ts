import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

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
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("POLYMARKET_DATA_API_BASE_URL", "https://data-api.polymarket.com");
});

describe("polymarket client", () => {
  it("constructs Data API URLs with query parameters", async () => {
    const { buildDataApiUrl } = await import("./client");
    const url = buildDataApiUrl("/v1/leaderboard", {
      category: "OVERALL",
      limit: 25,
      orderBy: "PNL",
    });

    expect(String(url)).toContain("https://data-api.polymarket.com/v1/leaderboard");
    expect(url.searchParams.get("category")).toBe("OVERALL");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("normalizes leaderboard rows from the live API", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          pnl: "125.5",
          profileImage: "https://example.com/avatar.png",
          proxyWallet: "0x56687BF447DB6Ffa42FfE2204a05Edaa20F55839",
          rank: "7",
          userName: "Signal",
          verifiedBadge: true,
          vol: "1000",
          xUsername: "signal",
        },
      ]),
    );

    const { fetchPolymarketLeaderboard } = await import("./client");
    const response = await fetchPolymarketLeaderboard({
      category: "OVERALL",
      forceRefresh: false,
      limit: 25,
      offset: 0,
      orderBy: "PNL",
      timePeriod: "WEEK",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.traders[0]).toMatchObject({
      pnl: 125.5,
      proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
      rank: 7,
      userName: "Signal",
      volume: 1000,
    });
  });

  it("loads wallet profiles with partial fan-out data", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ user: "0x1", value: "42" }]));

    const { fetchPolymarketWalletProfile } = await import("./client");
    const profile = await fetchPolymarketWalletProfile({
      forceRefresh: false,
      wallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(profile.totalValue).toBe(42);
    expect(profile.openPositions).toEqual([]);
  });

  it("aggregates sharp plays in demo mode", async () => {
    vi.resetModules();
    vi.stubEnv("USE_DEMO_DATA", "true");

    const { fetchPolymarketSharpPlays } = await import("./client");
    const response = await fetchPolymarketSharpPlays({
      category: "OVERALL",
      forceRefresh: false,
      limit: 25,
      minTraders: 3,
      offset: 0,
      orderBy: "PNL",
      timePeriod: "WEEK",
    });

    expect(response.plays).toHaveLength(1);
    expect(response.plays[0]).toMatchObject({
      outcome: "Yes",
      traderCount: 3,
    });
    expect(response.plays[0].labels).toContain("3 smart traders");
  });
});
