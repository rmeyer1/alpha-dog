import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function stubLiveEnv() {
  vi.stubEnv("APCA_API_KEY_ID", "key");
  vi.stubEnv("APCA_API_SECRET_KEY", "secret");
  vi.stubEnv("ALPACA_MARKET_DATA_BASE_URL", "https://data.alpaca.markets");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "opra");
  vi.stubEnv("ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets");
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  };
}

function errorResponse(status: number, body: unknown, headers = new Headers()) {
  return {
    ok: false,
    status,
    headers,
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

    const chainUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/v1beta1/options/snapshots/AAPL"));

    expect(chainUrls).toHaveLength(1);
    expect(chainUrls[0]).toContain("type=put");
    expect(chainUrls[0]).toContain("feed=opra");
    expect(chainUrls[0]).toContain("limit=1000");

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to explicit symbol snapshots when option chain snapshots fail", async () => {
    stubLiveEnv();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ bar: { c: 100, t: "2026-06-05T20:00:00Z" } }))
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
      .mockResolvedValueOnce(errorResponse(403, { message: "chain unavailable" }))
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

    const { getLiveWheelMarketData } = await import("./client");
    const data = await getLiveWheelMarketData("AAPL", wheelFilters, "short_put");
    const snapshotUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/v1beta1/options/snapshots"));

    expect(snapshotUrls).toHaveLength(2);
    expect(snapshotUrls[0]).toContain("/v1beta1/options/snapshots/AAPL");
    expect(snapshotUrls[0]).toContain("feed=opra");
    expect(snapshotUrls[1]).toContain("/v1beta1/options/snapshots?");
    expect(snapshotUrls[1]).toContain("feed=opra");
    expect(snapshotUrls[1]).toContain("symbols=AAPL260619P00095000");
    expect(data.rawContracts[0]).toMatchObject({
      contractSymbol: "AAPL260619P00095000",
      openInterest: 500,
    });

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches stock snapshots in symbol chunks", async () => {
    stubLiveEnv();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          AAPL: {
            latestTrade: { p: 100, t: "2026-06-05T20:00:00Z" },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          MSFT: {
            latestTrade: { p: 200, t: "2026-06-05T20:00:00Z" },
          },
        }),
      );

    const { getStockSnapshotsBySymbols } = await import("./client");
    const snapshots = await getStockSnapshotsBySymbols(["AAPL", "MSFT"], {
      chunkSize: 1,
      feed: "sip",
    });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/v2/stocks/snapshots");
    expect(urls[0]).toContain("symbols=AAPL");
    expect(urls[1]).toContain("symbols=MSFT");
    expect(snapshots.AAPL.latestTrade?.p).toBe(100);
    expect(snapshots.MSFT.latestTrade?.p).toBe(200);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches staged option snapshots without option contract metadata calls", async () => {
    stubLiveEnv();
    fetchMock.mockResolvedValueOnce(
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

    const { getLiveOptionSnapshotContracts } = await import("./client");
    const contracts = await getLiveOptionSnapshotContracts(
      "AAPL",
      wheelFilters,
      "short_put",
      100,
      "indicative",
    );
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/v1beta1/options/snapshots/AAPL");
    expect(urls[0]).not.toContain("/v2/options/contracts");
    expect(contracts[0]).toMatchObject({
      contractSymbol: "AAPL260619P00095000",
      openInterest: null,
    });

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
