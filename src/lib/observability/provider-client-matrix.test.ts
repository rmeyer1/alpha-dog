import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderName, ProviderOutcome } from "./provider";

vi.mock("./alert-control-plane", () => ({
  scheduleAlertSample: vi.fn(),
}));

const providers = [
  "alpaca",
  "finnhub",
  "polymarket",
  "openai",
  "supabase",
] as const satisfies ProviderName[];
const outcomes = [
  "success",
  "http_error",
  "timeout",
  "malformed_response",
  "network_error",
] as const satisfies ProviderOutcome[];

function openAiSuccessBody() {
  return {
    output_text: JSON.stringify({
      chartRead: "Bullish trend above support.",
      confidence: 0.72,
      disclaimer:
        "This is for educational purposes and is not financial advice.",
      eventRisk: "No major event supplied.",
      invalidation: "Invalid below support.",
      managementPlan: ["Take partial profits early."],
      riskFlags: ["Single-name gap risk."],
      setupType: "Put credit spread support hold",
      summary: "Setup is acceptable only with defined risk.",
      targets: ["Hold above short strike."],
      verdict: "validate",
    }),
  };
}

function successBody(provider: ProviderName) {
  switch (provider) {
    case "alpaca":
      return {
        asset_class: "us_equity",
        exchange: "NASDAQ",
        status: "active",
        symbol: "AAPL",
        tradable: true,
      };
    case "finnhub":
      return { earningsCalendar: [] };
    case "polymarket":
    case "supabase":
      return [];
    case "openai":
      return openAiSuccessBody();
  }
}

function providerFetch(provider: ProviderName, outcome: ProviderOutcome) {
  const canary = `${provider}-${outcome}-secret@example.test?token=raw`;

  if (outcome === "timeout") {
    return vi.fn(async () => {
      throw new DOMException(canary, "TimeoutError");
    });
  }

  if (outcome === "network_error") {
    return vi.fn(async () => {
      throw new TypeError(canary);
    });
  }

  if (outcome === "malformed_response") {
    return vi.fn(async () => new Response(canary, { status: 200 }));
  }

  if (outcome === "http_error") {
    return vi.fn(async () => Response.json(
      { error: canary, message: canary },
      { status: 403 },
    ));
  }

  return vi.fn(async () => Response.json(successBody(provider)));
}

function stubProviderEnvironment() {
  vi.stubEnv("ALPHA_DOG_DEPLOYMENT_MODE", "development");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets");
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
  vi.stubEnv("FINNHUB_API_BASE_URL", "https://finnhub.io/api/v1");
  vi.stubEnv("POLYMARKET_DATA_API_BASE_URL", "https://data-api.polymarket.com");
  vi.stubEnv("OPENAI_API_KEY", "openai-key");
  vi.stubEnv("OPENAI_TRADE_ANALYSIS_MODEL", "gpt-5.4-mini");
  vi.stubEnv("TRADE_ANALYSIS_PROVIDER", "openai");
  vi.stubEnv("ALPHA_DOG_SUPABASE_URL", "https://alpha.supabase.co");
  vi.stubEnv("ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
}

async function invokeRealProvider(provider: ProviderName) {
  switch (provider) {
    case "alpaca": {
      const { getAlpacaAsset } = await import("@/lib/alpaca/client");

      return getAlpacaAsset("AAPL");
    }
    case "finnhub": {
      const { getFinnhubEarningsCalendar } = await import(
        "@/lib/finnhub/client"
      );

      return getFinnhubEarningsCalendar({
        from: "2026-07-01",
        to: "2026-07-31",
      });
    }
    case "polymarket": {
      const { fetchPolymarketLeaderboard } = await import(
        "@/lib/polymarket/client"
      );

      return fetchPolymarketLeaderboard({
        category: "OVERALL",
        forceRefresh: false,
        limit: 1,
        offset: 0,
        orderBy: "PNL",
        timePeriod: "WEEK",
      });
    }
    case "openai": {
      const { runTradeAnalysisProvider } = await import(
        "@/lib/trade-analysis/provider"
      );

      return runTradeAnalysisProvider({
        chartSource: "server_chart_indicators",
        messages: [
          { content: "system canary", role: "system" },
          { content: "user canary", role: "user" },
        ],
      });
    }
    case "supabase": {
      const { requestSupabaseRest } = await import("@/lib/supabase/rest");

      return requestSupabaseRest("paper_accounts", {
        query: { limit: 0, select: "id" },
      });
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("real provider client failure matrix", () => {
  it.each(
    providers.flatMap((provider) =>
      outcomes.map((outcome) => [provider, outcome] as const)
    ),
  )("%s emits a sanitized %s terminal event", async (provider, outcome) => {
    vi.resetModules();
    stubProviderEnvironment();
    const fetchMock = providerFetch(provider, outcome);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubGlobal("fetch", fetchMock);

    if (outcome === "success") {
      await expect(invokeRealProvider(provider)).resolves.toBeDefined();
    } else {
      await expect(invokeRealProvider(provider)).rejects.toBeDefined();
    }

    const records = [...info.mock.calls, ...warn.mock.calls]
      .map(([value]) => String(value))
      .filter((value) => value.includes('"event":"provider.request"'))
      .map((value) => JSON.parse(value))
      .filter((record) => record.provider === provider);

    expect(records).toEqual([
      expect.objectContaining({
        durationMs: expect.any(Number),
        operation: expect.any(String),
        outcome,
        provider,
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain(
      `${provider}-${outcome}-secret`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opentelemetry: {
          ignore: true,
          propagateContext: false,
        },
      }),
    );
  });
});
