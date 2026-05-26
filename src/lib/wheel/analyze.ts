import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getLiveWheelMarketData } from "@/lib/alpaca/client";
import { buildCandidate, buildVerticalSpreads } from "./calculations";
import { getDemoContracts, getDemoUnderlying } from "./mock-data";
import { getPersona, mergeFilters } from "./personas";
import { scoreCandidate, scoreVerticalSpreadCandidate } from "./scoring";
import type {
  DataFeed,
  PersonaId,
  Warning,
  WheelAnalysisRequest,
  WheelAnalysisResponse,
  WheelFilters,
} from "./types";

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function globalWarnings(feed: DataFeed, earningsEnabled: boolean): Warning[] {
  const warnings: Warning[] = [];

  if (feed === "demo") {
    warnings.push({
      type: "data_quality",
      severity: "info",
      message:
        "Demo data is active. Add Alpaca keys to .env.local before validating live market behavior.",
    });
  }

  if (feed === "indicative") {
    warnings.push({
      type: "data_quality",
      severity: "warning",
      message:
        "Indicative options feed selected. Confirm OPRA access before relying on live quotes.",
    });
  }

  if (!earningsEnabled) {
    warnings.push({
      type: "earnings",
      severity: "info",
      message: "Earnings provider is disabled. Verify earnings before trading.",
    });
  }

  return warnings;
}

function withRanks<T extends { score: number; rank: number }>(rows: T[]) {
  return rows
    .sort((left, right) => right.score - left.score)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

export async function analyzeWheelCandidates(
  request: WheelAnalysisRequest,
): Promise<WheelAnalysisResponse> {
  const env = getEnv();
  const ticker = normalizeTicker(request.ticker);
  const personaId: PersonaId = request.persona;
  const persona = getPersona(personaId);
  const filters: WheelFilters = mergeFilters(personaId, request.filters);
  const resultLimit = request.resultLimit ?? 25;
  const now = new Date();
  const useDemoData = env.USE_DEMO_DATA || !hasAlpacaCredentials();

  const demoUnderlying = useDemoData ? getDemoUnderlying(ticker) : null;
  const marketData = demoUnderlying
    ? {
        underlying: demoUnderlying,
        feed: "demo" as const,
        rawContracts: getDemoContracts(ticker, demoUnderlying),
        asOf: now.toISOString(),
      }
    : await getLiveWheelMarketData(ticker, filters);
  const { underlying, rawContracts } = marketData;
  const feed: DataFeed = marketData.feed;
  const candidates = rawContracts
    .map((contract) => buildCandidate(contract, underlying, filters, now))
    .filter((candidate) => candidate != null)
    .map((candidate) =>
      scoreCandidate(candidate, persona, filters, underlying),
    );
  const shortPuts = withRanks(
    candidates.filter((candidate) => candidate.optionType === "put"),
  ).slice(0, resultLimit);
  const coveredCalls = withRanks(
    candidates.filter((candidate) => candidate.optionType === "call"),
  ).slice(0, resultLimit);
  const putCreditSpreads = withRanks(
    buildVerticalSpreads(rawContracts, underlying, filters, "put", now).map(
      (candidate) =>
        scoreVerticalSpreadCandidate(candidate, persona, filters, underlying),
    ),
  ).slice(0, resultLimit);
  const callCreditSpreads = withRanks(
    buildVerticalSpreads(rawContracts, underlying, filters, "call", now).map(
      (candidate) =>
        scoreVerticalSpreadCandidate(candidate, persona, filters, underlying),
    ),
  ).slice(0, resultLimit);

  return {
    ticker,
    underlying,
    persona: {
      id: persona.id,
      name: persona.name,
      motto: persona.motto,
    },
    dataFreshness: {
      feed,
      cacheStatus: feed === "demo" ? "demo" : "fresh",
      asOf: marketData.asOf,
      nextSuggestedRefreshAt: addMinutes(now, 2),
    },
    shortPuts,
    coveredCalls,
    putCreditSpreads,
    callCreditSpreads,
    warnings: globalWarnings(feed, env.EARNINGS_PROVIDER_ENABLED),
    errors:
      candidates.length === 0 &&
      putCreditSpreads.length === 0 &&
      callCreditSpreads.length === 0
        ? ["No contracts matched the selected ticker, persona, and filters."]
        : [],
  };
}
