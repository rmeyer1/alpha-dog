import { beforeEach, describe, expect, it, vi } from "vitest";

const getFinnhubCompanyInsightsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/finnhub/client", () => ({
  getFinnhubCompanyInsights: getFinnhubCompanyInsightsMock,
}));

function routeContext(symbol = "aapl") {
  return {
    params: Promise.resolve({ symbol }),
  };
}

beforeEach(() => {
  vi.resetModules();
  getFinnhubCompanyInsightsMock.mockReset();
});

describe("GET /api/finnhub/company/[symbol]", () => {
  it("returns aggregate Finnhub company insights", async () => {
    getFinnhubCompanyInsightsMock.mockResolvedValue({
      earningsSurprises: [],
      metrics: { metric: {}, metricType: "all", series: {}, symbol: "AAPL" },
      news: [],
      profile: { name: "Apple Inc", ticker: "AAPL" },
      recommendations: [],
      symbol: "AAPL",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/finnhub/company/aapl?from=2026-06-01&to=2026-06-08"),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      profile: { name: "Apple Inc" },
      symbol: "AAPL",
    });
    expect(getFinnhubCompanyInsightsMock).toHaveBeenCalledWith({
      newsFrom: "2026-06-01",
      newsTo: "2026-06-08",
      symbol: "AAPL",
    });
  });

  it("rejects invalid symbols before calling Finnhub", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/finnhub/company/%20"),
      routeContext(" "),
    );

    expect(response.status).toBe(400);
    expect(getFinnhubCompanyInsightsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid date query params", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/finnhub/company/aapl?from=bad-date"),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(getFinnhubCompanyInsightsMock).not.toHaveBeenCalled();
  });
});
