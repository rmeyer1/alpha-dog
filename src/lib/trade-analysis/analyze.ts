import { getCompanyProfile } from "@/lib/company-profile";
import { buildChartContext } from "./chart";
import { saveTradeAnalysisRun } from "./audit";
import {
  buildTradeAnalysisMessages,
  TRADE_ANALYSIS_PROMPT_VERSION,
} from "./prompt";
import { runTradeAnalysisProvider } from "./provider";
import type {
  JsonValue,
  TradeAnalysisInput,
  TradeAnalysisResult,
  TradeAnalysisResponse,
  TradeAnalysisRunRecord,
} from "./types";

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function buildAuditRecord({
  chartSource,
  error,
  input,
  model,
  provider,
  rawResponse,
  result,
  status,
}: {
  chartSource: TradeAnalysisRunRecord["chart_source"];
  error: string | null;
  input: TradeAnalysisInput;
  model: string;
  provider: string;
  rawResponse: unknown;
  result: TradeAnalysisResult | null;
  status: TradeAnalysisRunRecord["status"];
}): TradeAnalysisRunRecord {
  return {
    candidate_identity: input.candidateIdentity,
    candidate_type: input.candidateType,
    chart_source: chartSource,
    confidence: result?.confidence ?? null,
    error,
    model,
    persona: input.persona.id,
    prompt_version: TRADE_ANALYSIS_PROMPT_VERSION,
    provider,
    request_payload: asJsonValue(input),
    response_payload: result ? asJsonValue(result) : asJsonValue(rawResponse),
    source: input.source,
    status,
    strategy: input.strategy,
    symbol: input.ticker,
    verdict: result?.verdict ?? null,
  };
}

export async function analyzeTradeCandidate(
  input: TradeAnalysisInput,
): Promise<TradeAnalysisResponse> {
  const profile = await getCompanyProfile(input.ticker);
  const internalChartContext = buildChartContext(input, profile);
  const chartSource = internalChartContext.source;
  const messages = buildTradeAnalysisMessages({
    chartFacts: internalChartContext.facts,
    input,
    profile,
  });

  try {
    const providerResult = await runTradeAnalysisProvider({
      chartSource,
      messages,
    });
    const auditId = await saveTradeAnalysisRun(
      buildAuditRecord({
        chartSource: providerResult.result.chartSource,
        error: null,
        input,
        model: providerResult.model,
        provider: providerResult.provider,
        rawResponse: providerResult.rawResponse,
        result: providerResult.result,
        status: "completed",
      }),
    );

    return {
      auditId,
      model: providerResult.model,
      provider: providerResult.provider,
      promptVersion: TRADE_ANALYSIS_PROMPT_VERSION,
      result: providerResult.result,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Trade analysis failed.";

    await saveTradeAnalysisRun(
      buildAuditRecord({
        chartSource,
        error: message,
        input,
        model: "unknown",
        provider: "openai",
        rawResponse: null,
        result: null,
        status: "failed",
      }),
    ).catch(() => null);

    throw error;
  }
}
