import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function stubLiveEnv() {
  vi.stubEnv("APCA_API_KEY_ID", "key");
  vi.stubEnv("APCA_API_SECRET_KEY", "secret");
  vi.stubEnv("ALPACA_MARKET_DATA_BASE_URL", "https://data.alpaca.markets");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
  vi.stubEnv("ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets");
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

const wheelFilters = {
  dteMin: 7,
  dteMax: 45,
  deltaMin: 0.15,
  deltaMax: 0.3,
  minPremiumYield: 0.01,
  minVolume: 0,
  minOpenInterest: 0,
  maxSpreadPctOfMid: 0.2,
  minSpreadReturnOnRisk: 0.2,
  maxSpreadWidth: 10,
  spreadLongLegCount: 3,
  excludeEarnings: false,
  includeWeeklies: true,
};

function mockLiveWheelMarketDataFetches(price = 100) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ bar: { c: price, t: "2026-06-05T20:00:00Z" } }))
    .mockResolvedValueOnce(
      jsonResponse({
        bars: Array.from({ length: 220 }, (_, index) => ({
          c: 90 + index * 0.05,
          h: 0,
          l: 0,
          o: 0,
          t: "2026-06-05T20:00:00Z",
          v: 1,
        })),
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        option_contracts: [
          {
            symbol: "AAPL260619P00095000",
            expiration_date: "2026-06-19",
            type: "put",
            strike_price: "95",
            open_interest: "500",
            tradable: true,
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        snapshots: {
          AAPL260619P00095000: {
            latestQuote: { bp: 1, ap: 1.1 },
            greeks: { delta: -0.24, theta: -0.04 },
            impliedVolatility: 0.35,
            dailyBar: { v: 100 },
          },
        },
      }),
    );
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("Alpaca client", () => {
  it("keeps optionable NYSE and NASDAQ assets when Alpaca omits asset_class", async () => {
    stubLiveEnv();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            symbol: "ZIP",
            name: "Zip Co.",
            status: "active",
            tradable: true,
            exchange: "NYSE",
            attributes: ["has_options"],
          },
          {
            symbol: "NOPE",
            name: "No Options Co.",
            status: "active",
            tradable: true,
            exchange: "NYSE",
            attributes: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            symbol: "AAPL",
            name: "Apple Inc.",
            status: "active",
            tradable: true,
            exchange: "NASDAQ",
            attributes: ["fractional_eh_enabled", "has_options"],
          },
        ]),
      );

    const { getWheelAssetUniverse } = await import("./client");

    await expect(getWheelAssetUniverse()).resolves.toEqual([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
      },
      {
        symbol: "ZIP",
        name: "Zip Co.",
        exchange: "NYSE",
      },
    ]);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches only put option contracts for cash-secured put analysis", async () => {
    stubLiveEnv();
    mockLiveWheelMarketDataFetches();

    const { getLiveWheelMarketData } = await import("./client");
    await getLiveWheelMarketData("AAPL", wheelFilters, "short_put");

    const contractUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/v2/options/contracts"));

    expect(contractUrls).toHaveLength(1);
    expect(contractUrls[0]).toContain("type=put");

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reuses live market data for repeated ticker requests", async () => {
    stubLiveEnv();
    mockLiveWheelMarketDataFetches();

    const { getLiveWheelMarketData } = await import("./client");
    const first = await getLiveWheelMarketData("AAPL", wheelFilters, "short_put");
    const second = await getLiveWheelMarketData("aapl", wheelFilters, "short_put");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(first.underlying.symbol).toBe("AAPL");
    expect(second.rawContracts).toHaveLength(1);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("coalesces simultaneous live market data requests", async () => {
    stubLiveEnv();
    mockLiveWheelMarketDataFetches();

    const { getLiveWheelMarketData } = await import("./client");
    await Promise.all([
      getLiveWheelMarketData("AAPL", wheelFilters, "short_put"),
      getLiveWheelMarketData("AAPL", wheelFilters, "short_put"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(4);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
