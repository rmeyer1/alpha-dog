import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

import { runTradeAnalysisProvider } from "./provider";

describe("trade analysis provider", () => {
  beforeEach(() => {
    getEnvMock.mockReturnValue({
      OPENAI_API_KEY: "sk-test",
      OPENAI_TRADE_ANALYSIS_MODEL: "gpt-5.4-mini",
      TRADE_ANALYSIS_PROVIDER: "openai",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          output_text: JSON.stringify({
            chartRead: "Bullish trend above support.",
            confidence: 0.72,
            disclaimer: "This is for educational purposes and is not financial advice.",
            eventRisk: "No major event supplied.",
            invalidation: "Invalid below support.",
            managementPlan: ["Take partial profits early."],
            riskFlags: ["Single-name gap risk."],
            setupType: "Put credit spread support hold",
            summary: "Setup is acceptable only with defined risk.",
            targets: ["Hold above short strike."],
            verdict: "validate",
          }),
        }),
        ok: true,
      }),
    );
  });

  it("parses structured OpenAI output", async () => {
    const response = await runTradeAnalysisProvider({
      chartSource: "server_chart_indicators",
      messages: [
        { content: "system", role: "system" },
        { content: "user", role: "user" },
      ],
    });

    expect(response.result.verdict).toBe("validate");
    expect(response.result.chartSource).toBe("server_chart_indicators");
    expect(response.model).toBe("gpt-5.4-mini");
  });

  it("does not send external tool configuration", async () => {
    await runTradeAnalysisProvider({
      chartSource: "server_chart_indicators",
      messages: [
        { content: "system", role: "system" },
        { content: "user", role: "user" },
      ],
    });

    const requestBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0][1]?.body),
    ) as { tools?: unknown[] };

    expect(requestBody.tools).toBeUndefined();
  });
});
