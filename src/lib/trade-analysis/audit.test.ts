import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeAnalysisRunRecord } from "./types";

const requestSupabaseRestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: requestSupabaseRestMock,
}));

import { saveTradeAnalysisRun } from "./audit";

const record: TradeAnalysisRunRecord = {
  candidate_identity: {
    key: "AAPL260116P00180000",
    rank: 1,
    score: 82,
  },
  candidate_type: "contract",
  chart_source: "server_chart_indicators",
  confidence: 0.7,
  error: null,
  model: "gpt-5.4-mini",
  persona: "balanced_wheel",
  prompt_version: "paper-prophet-v1",
  provider: "openai",
  request_payload: { ticker: "AAPL" },
  response_payload: { verdict: "validate" },
  source: "wheel_dashboard",
  status: "completed",
  strategy: "short_put",
  symbol: "AAPL",
  verdict: "validate",
};

describe("trade analysis audit", () => {
  beforeEach(() => {
    requestSupabaseRestMock.mockReset();
  });

  it("inserts analysis runs and returns the audit id", async () => {
    requestSupabaseRestMock.mockResolvedValue([{ id: "run-1" }]);

    await expect(saveTradeAnalysisRun(record)).resolves.toBe("run-1");

    expect(requestSupabaseRestMock).toHaveBeenCalledWith("trade_analysis_runs", {
      body: record,
      method: "POST",
      prefer: "return=representation",
    });
  });
});
