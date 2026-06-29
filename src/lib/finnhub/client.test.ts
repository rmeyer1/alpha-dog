import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFinnhubCompanyInsights,
  getFinnhubCompanyNews,
  getFinnhubDividends,
  getFinnhubEarningsCalendar,
  getFinnhubEarningsSurprises,
  getFinnhubRecommendationTrends,
  normalizeFinnhubEarningsEvent,
  normalizeFinnhubEarningsSurprise,
} from "./client";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("FINNHUB_API_KEY", "test-key");
});

describe("Finnhub client", () => {
  it("normalizes earnings calendar rows", () => {
    expect(
      normalizeFinnhubEarningsEvent({
        date: "2026-07-15",
        epsActual: undefined,
        epsEstimate: 1.23,
        hour: "AMC",
        quarter: 2,
        revenueActual: null,
        revenueEstimate: 123456,
        symbol: " aapl ",
        year: 2026,
      }),
    ).toEqual({
      date: "2026-07-15",
      epsActual: null,
      epsEstimate: 1.23,
      hour: "amc",
      quarter: 2,
      revenueActual: null,
      revenueEstimate: 123456,
      symbol: "AAPL",
      year: 2026,
    });
  });

  it("fetches earnings calendar with date-window params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        earningsCalendar: [
          {
            date: "2026-07-15",
            epsEstimate: 1.23,
            hour: "bmo",
            quarter: 2,
            symbol: "MSFT",
            year: 2026,
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const rows = await getFinnhubEarningsCalendar({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(url.pathname).toBe("/api/v1/calendar/earnings");
    expect(url.searchParams.get("from")).toBe("2026-07-01");
    expect(url.searchParams.get("to")).toBe("2026-07-31");
    expect(url.searchParams.get("token")).toBe("test-key");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "MSFT", hour: "bmo" });
  });

  it("normalizes earnings surprises", () => {
    expect(
      normalizeFinnhubEarningsSurprise({
        actual: 1.5,
        estimate: 1.2,
        period: "2026-03-31",
        quarter: 1,
        surprise: 0.3,
        surprisePercent: 25,
        symbol: " msft ",
        year: 2026,
      }),
    ).toEqual({
      actual: 1.5,
      estimate: 1.2,
      period: "2026-03-31",
      quarter: 1,
      surprise: 0.3,
      surprisePercent: 25,
      symbol: "MSFT",
      year: 2026,
    });
  });

  it("fetches selected follow-up endpoints with normalized params", async () => {
    const fetchMock = vi.fn((url: URL) => {
      switch (url.pathname) {
        case "/api/v1/stock/earnings":
          return Promise.resolve(Response.json([{
            actual: 1.5,
            estimate: 1.2,
            period: "2026-03-31",
            symbol: "AAPL",
          }]));
        case "/api/v1/stock/dividend2":
          return Promise.resolve(Response.json({
            data: [{ amount: 0.25, exDate: "2026-08-01" }],
            symbol: "AAPL",
          }));
        case "/api/v1/company-news":
          return Promise.resolve(Response.json([{
            datetime: 1782864000,
            headline: "Apple headline",
            id: 123,
            source: "Finnhub",
            url: "https://example.com/aapl",
          }]));
        case "/api/v1/stock/recommendation":
          return Promise.resolve(Response.json([{
            buy: 10,
            hold: 5,
            period: "2026-06-01",
            sell: 1,
            strongBuy: 7,
            strongSell: 0,
            symbol: "AAPL",
          }]));
        default:
          return Promise.resolve(Response.json({}));
      }
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getFinnhubEarningsSurprises({ limit: 4, symbol: "aapl" }),
    ).resolves.toMatchObject([{ symbol: "AAPL", actual: 1.5 }]);
    await expect(getFinnhubDividends({ symbol: "aapl" }))
      .resolves.toMatchObject([{ symbol: "AAPL", amount: 0.25 }]);
    await expect(
      getFinnhubCompanyNews({
        from: "2026-06-01",
        symbol: "aapl",
        to: "2026-06-08",
      }),
    ).resolves.toMatchObject([{ headline: "Apple headline" }]);
    await expect(getFinnhubRecommendationTrends({ symbol: "aapl" }))
      .resolves.toMatchObject([{ buy: 10, symbol: "AAPL" }]);

    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));

    expect(urls.map((url) => url.pathname)).toEqual([
      "/api/v1/stock/earnings",
      "/api/v1/stock/dividend2",
      "/api/v1/company-news",
      "/api/v1/stock/recommendation",
    ]);
    expect(urls[0].searchParams.get("limit")).toBe("4");
    expect(urls[2].searchParams.get("from")).toBe("2026-06-01");
  });

  it("builds aggregate company insights", async () => {
    const fetchMock = vi.fn((url: URL) => {
      switch (url.pathname) {
        case "/api/v1/stock/dividend2":
          return Promise.resolve(Response.json({
            data: [{ amount: 0.25, exDate: "2026-08-01" }],
            symbol: "AAPL",
          }));
        case "/api/v1/stock/earnings":
          return Promise.resolve(Response.json([{ symbol: "AAPL" }]));
        case "/api/v1/stock/metric":
          return Promise.resolve(Response.json({
            metric: { peNormalizedAnnual: 30 },
            metricType: "all",
            series: {},
            symbol: "AAPL",
          }));
        case "/api/v1/company-news":
          return Promise.resolve(Response.json([]));
        case "/api/v1/stock/profile2":
          return Promise.resolve(Response.json({
            country: "US",
            name: "Apple Inc",
            ticker: "AAPL",
          }));
        case "/api/v1/stock/recommendation":
          return Promise.resolve(Response.json([]));
        default:
          return Promise.resolve(Response.json({}));
      }
    });

    vi.stubGlobal("fetch", fetchMock);

    const insights = await getFinnhubCompanyInsights({
      newsFrom: "2026-06-01",
      newsTo: "2026-06-08",
      symbol: "aapl",
    });

    expect(insights).toMatchObject({
      dividends: [{ amount: 0.25 }],
      errors: [],
      metrics: { metric: { peNormalizedAnnual: 30 } },
      profile: { name: "Apple Inc" },
      symbol: "AAPL",
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("returns partial aggregate insights when one section is unavailable", async () => {
    const fetchMock = vi.fn((url: URL) => {
      if (url.pathname === "/api/v1/stock/dividend2") {
        return Promise.resolve(Response.json(
          { error: "You don't have access to this resource." },
          { status: 403 },
        ));
      }

      if (url.pathname === "/api/v1/stock/profile2") {
        return Promise.resolve(Response.json({
          name: "Apple Inc",
          ticker: "AAPL",
        }));
      }

      if (url.pathname === "/api/v1/stock/metric") {
        return Promise.resolve(Response.json({ metric: {}, series: {} }));
      }

      return Promise.resolve(Response.json([]));
    });

    vi.stubGlobal("fetch", fetchMock);

    const insights = await getFinnhubCompanyInsights({ symbol: "aapl" });

    expect(insights).toMatchObject({
      dividends: [],
      errors: [{
        message: "You don't have access to this resource.",
        section: "dividends",
      }],
      profile: { name: "Apple Inc" },
    });
  });
});
