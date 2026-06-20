import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getLiveWheelMarketData } from "@/lib/alpaca/client";
import {
  buildAnalysisCacheKey,
  cachedEntryNextRefresh,
  getAnalysisCacheStore,
  getFreshRuntimeAnalysisCache,
  getStaleRuntimeAnalysisCache,
  setRuntimeAnalysisCache,
} from "./analysis-cache";
import { buildCandidate, buildVerticalSpreads } from "./calculations";
import { getDemoContracts, getDemoUnderlying } from "./mock-data";
import { getPersona, mergeFilters } from "./personas";
import { scoreCandidate, scoreVerticalSpreadCandidate } from "./scoring";
import type {
  DataFeed,
  PersonaId,
  Warning,
  WheelCompanyStrategy,
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
        "Demo data is active. Confirm live market-data access before validating market behavior.",
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

function strategyNeedsContracts(
  strategy: WheelCompanyStrategy | undefined,
  optionType: "put" | "call",
) {
  if (!strategy) {
    return true;
  }

  if (optionType === "put") {
    return strategy === "short_put" || strategy === "put_credit_spread";
  }

  return strategy === "covered_call" || strategy === "call_credit_spread";
}

function strategyNeedsSpreads(
  strategy: WheelCompanyStrategy | undefined,
  optionType: "put" | "call",
) {
  if (!strategy) {
    return true;
  }

  return optionType === "put"
    ? strategy === "put_credit_spread"
    : strategy === "call_credit_spread";
}

function applyCacheFreshness(
  response: WheelAnalysisResponse,
  cacheStatus: "fresh" | "stale",
  nextSuggestedRefreshAt: string | null,
  extraWarnings: Warning[] = [],
): WheelAnalysisResponse {
  return {
    ...response,
    dataFreshness: {
      ...response.dataFreshness,
      cacheStatus,
      nextSuggestedRefreshAt,
    },
    warnings: [...extraWarnings, ...response.warnings],
  };
}

function staleFallbackWarning(error: unknown, asOf: string): Warning {
  const reason = error instanceof Error ? error.message : "Live refresh failed.";

  return {
    type: "data_quality",
    severity: "warning",
    message: `Live refresh failed; showing cached analysis from ${asOf}. ${reason}`,
  };
}

async function computeWheelCandidates(
  options: {
    env: ReturnType<typeof getEnv>;
    filters: WheelFilters;
    now: Date;
    personaId: PersonaId;
    resultLimit: number;
    forceRefresh?: boolean;
    strategy?: WheelCompanyStrategy;
    ticker: string;
    useDemoData: boolean;
  },
): Promise<WheelAnalysisResponse> {
  const {
    env,
    filters,
    forceRefresh,
    now,
    personaId,
    resultLimit,
    strategy,
    ticker,
    useDemoData,
  } = options;
  const persona = getPersona(personaId);
  const demoUnderlying = useDemoData ? getDemoUnderlying(ticker) : null;
  const marketData = demoUnderlying
    ? {
        underlying: demoUnderlying,
        feed: "demo" as const,
        rawContracts: getDemoContracts(ticker, demoUnderlying),
        asOf: now.toISOString(),
      }
    : forceRefresh
      ? await getLiveWheelMarketData(ticker, filters, strategy, {
          forceRefresh: true,
        })
      : await getLiveWheelMarketData(ticker, filters, strategy);
  const { underlying, rawContracts } = marketData;
  const feed: DataFeed = marketData.feed;
  const candidates = rawContracts
    .map((contract) => buildCandidate(contract, underlying, filters, now))
    .filter((candidate) => candidate != null)
    .map((candidate) =>
      scoreCandidate(candidate, persona, filters, underlying),
    );
  const shortPuts = strategyNeedsContracts(strategy, "put")
    ? withRanks(
        candidates.filter((candidate) => candidate.optionType === "put"),
      ).slice(0, resultLimit)
    : [];
  const coveredCalls = strategyNeedsContracts(strategy, "call")
    ? withRanks(
        candidates.filter((candidate) => candidate.optionType === "call"),
      ).slice(0, resultLimit)
    : [];
  const putCreditSpreads = strategyNeedsSpreads(strategy, "put")
    ? withRanks(
        buildVerticalSpreads(rawContracts, underlying, filters, "put", now).map(
          (candidate) =>
            scoreVerticalSpreadCandidate(candidate, persona, filters, underlying),
        ),
      ).slice(0, resultLimit)
    : [];
  const callCreditSpreads = strategyNeedsSpreads(strategy, "call")
    ? withRanks(
        buildVerticalSpreads(rawContracts, underlying, filters, "call", now).map(
          (candidate) =>
            scoreVerticalSpreadCandidate(candidate, persona, filters, underlying),
        ),
      ).slice(0, resultLimit)
    : [];

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

export async function analyzeWheelCandidates(
  request: WheelAnalysisRequest,
): Promise<WheelAnalysisResponse> {
  const env = getEnv();
  const ticker = normalizeTicker(request.ticker);
  const personaId: PersonaId = request.persona;
  const filters: WheelFilters = mergeFilters(personaId, request.filters);
  const resultLimit = request.resultLimit ?? 25;
  const now = new Date();
  const useDemoData = env.USE_DEMO_DATA || !hasAlpacaCredentials();

  if (useDemoData) {
    return computeWheelCandidates({
      env,
      filters,
      forceRefresh: request.forceRefresh,
      now,
      personaId,
      resultLimit,
      strategy: request.strategy,
      ticker,
      useDemoData,
    });
  }

  const cacheKey = buildAnalysisCacheKey({
    feed: env.ALPACA_OPTIONS_FEED,
    filters,
    personaId,
    resultLimit,
    strategy: request.strategy,
    ticker,
  });
  const cache = getAnalysisCacheStore();

  if (!request.forceRefresh) {
    const freshEntry = cache.getFresh(cacheKey);

    if (freshEntry) {
      return applyCacheFreshness(
        freshEntry.response,
        "fresh",
        cachedEntryNextRefresh(freshEntry),
      );
    }

    const runtimeFreshEntry = await getFreshRuntimeAnalysisCache(cacheKey);

    if (runtimeFreshEntry) {
      cache.set(cacheKey, runtimeFreshEntry.response);

      return applyCacheFreshness(
        runtimeFreshEntry.response,
        "fresh",
        cachedEntryNextRefresh(runtimeFreshEntry),
      );
    }
  }

  try {
    const response = await computeWheelCandidates({
      env,
      filters,
      forceRefresh: request.forceRefresh,
      now,
      personaId,
      resultLimit,
      strategy: request.strategy,
      ticker,
      useDemoData,
    });

    cache.set(cacheKey, response);
    await setRuntimeAnalysisCache(cacheKey, response);

    return response;
  } catch (error) {
    const staleEntry = cache.getStale(cacheKey);

    if (staleEntry) {
      return applyCacheFreshness(
        staleEntry.response,
        "stale",
        null,
        [staleFallbackWarning(error, staleEntry.response.dataFreshness.asOf)],
      );
    }

    const runtimeStaleEntry = await getStaleRuntimeAnalysisCache(cacheKey);

    if (runtimeStaleEntry) {
      cache.set(cacheKey, runtimeStaleEntry.response);

      return applyCacheFreshness(
        runtimeStaleEntry.response,
        "stale",
        null,
        [
          staleFallbackWarning(
            error,
            runtimeStaleEntry.response.dataFreshness.asOf,
          ),
        ],
      );
    }

    throw error;
  }
}
