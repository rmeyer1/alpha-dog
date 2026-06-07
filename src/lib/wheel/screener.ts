import { getWheelAssetUniverse } from "@/lib/alpaca/client";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { analyzeWheelCandidates } from "./analyze";
import { getPersona, mergeFilters } from "./personas";
import {
  getRuntimeCacheValue,
  setRuntimeCacheValue,
} from "./vercel-runtime-cache";
import type {
  CacheStatus,
  DataFeed,
  PersonaId,
  Warning,
  WheelAnalysisResponse,
  WheelCandidate,
  WheelCompanyCandidateSummary,
  WheelCompanyScore,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerRequest,
  WheelScreenerResponse,
  VerticalSpreadCandidate,
} from "./types";

const SCREENER_CACHE_VERSION = "v2";
const SCREENER_CACHE_FRESH_TTL_MS = 5 * 60 * 1000;
const SCREENER_CACHE_STALE_TTL_MS = 30 * 60 * 1000;
const SCREENER_UNIVERSE_CACHE_TTL_MS = 30 * 60 * 1000;
const SCREENER_ANALYSIS_RESULT_LIMIT = 5;
const SCREENER_CONCURRENCY = 1;
const DEFAULT_LIVE_BATCH_SIZE = 8;
const SCREENER_RATE_LIMIT_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

interface WheelScreenerAsset {
  symbol: string;
  name: string;
  exchange: "NYSE" | "NASDAQ";
}

interface ScreenerCacheEntry {
  response: WheelScreenerResponse;
  freshUntilMs: number;
  staleUntilMs: number;
}

interface ScreenerUniverseCacheEntry {
  assets: WheelScreenerAsset[];
  freshUntilMs: number;
}

const demoAssets: WheelScreenerAsset[] = [
  ["AAPL", "Apple Inc.", "NASDAQ"],
  ["MSFT", "Microsoft Corporation", "NASDAQ"],
  ["NVDA", "NVIDIA Corporation", "NASDAQ"],
  ["AMZN", "Amazon.com, Inc.", "NASDAQ"],
  ["META", "Meta Platforms, Inc.", "NASDAQ"],
  ["GOOGL", "Alphabet Inc.", "NASDAQ"],
  ["GOOG", "Alphabet Inc.", "NASDAQ"],
  ["TSLA", "Tesla, Inc.", "NASDAQ"],
  ["AVGO", "Broadcom Inc.", "NASDAQ"],
  ["COST", "Costco Wholesale Corporation", "NASDAQ"],
  ["NFLX", "Netflix, Inc.", "NASDAQ"],
  ["AMD", "Advanced Micro Devices, Inc.", "NASDAQ"],
  ["PEP", "PepsiCo, Inc.", "NASDAQ"],
  ["ADBE", "Adobe Inc.", "NASDAQ"],
  ["CSCO", "Cisco Systems, Inc.", "NASDAQ"],
  ["QCOM", "QUALCOMM Incorporated", "NASDAQ"],
  ["INTC", "Intel Corporation", "NASDAQ"],
  ["AMAT", "Applied Materials, Inc.", "NASDAQ"],
  ["TXN", "Texas Instruments Incorporated", "NASDAQ"],
  ["INTU", "Intuit Inc.", "NASDAQ"],
  ["BKNG", "Booking Holdings Inc.", "NASDAQ"],
  ["SBUX", "Starbucks Corporation", "NASDAQ"],
  ["GILD", "Gilead Sciences, Inc.", "NASDAQ"],
  ["MU", "Micron Technology, Inc.", "NASDAQ"],
  ["LRCX", "Lam Research Corporation", "NASDAQ"],
  ["PANW", "Palo Alto Networks, Inc.", "NASDAQ"],
  ["ISRG", "Intuitive Surgical, Inc.", "NASDAQ"],
  ["ADP", "Automatic Data Processing, Inc.", "NASDAQ"],
  ["VRTX", "Vertex Pharmaceuticals Incorporated", "NASDAQ"],
  ["MELI", "MercadoLibre, Inc.", "NASDAQ"],
  ["JPM", "JPMorgan Chase & Co.", "NYSE"],
  ["V", "Visa Inc.", "NYSE"],
  ["MA", "Mastercard Incorporated", "NYSE"],
  ["LLY", "Eli Lilly and Company", "NYSE"],
  ["UNH", "UnitedHealth Group Incorporated", "NYSE"],
  ["XOM", "Exxon Mobil Corporation", "NYSE"],
  ["WMT", "Walmart Inc.", "NYSE"],
  ["JNJ", "Johnson & Johnson", "NYSE"],
  ["PG", "The Procter & Gamble Company", "NYSE"],
  ["HD", "The Home Depot, Inc.", "NYSE"],
  ["BAC", "Bank of America Corporation", "NYSE"],
  ["KO", "The Coca-Cola Company", "NYSE"],
  ["CRM", "Salesforce, Inc.", "NYSE"],
  ["CVX", "Chevron Corporation", "NYSE"],
  ["ABBV", "AbbVie Inc.", "NYSE"],
  ["MRK", "Merck & Co., Inc.", "NYSE"],
  ["ORCL", "Oracle Corporation", "NYSE"],
  ["WFC", "Wells Fargo & Company", "NYSE"],
  ["MCD", "McDonald's Corporation", "NYSE"],
  ["DIS", "The Walt Disney Company", "NYSE"],
  ["IBM", "International Business Machines Corporation", "NYSE"],
  ["GE", "GE Aerospace", "NYSE"],
  ["NOW", "ServiceNow, Inc.", "NYSE"],
  ["UBER", "Uber Technologies, Inc.", "NYSE"],
  ["CAT", "Caterpillar Inc.", "NYSE"],
  ["GS", "The Goldman Sachs Group, Inc.", "NYSE"],
  ["BA", "The Boeing Company", "NYSE"],
  ["T", "AT&T Inc.", "NYSE"],
  ["VZ", "Verizon Communications Inc.", "NYSE"],
  ["F", "Ford Motor Company", "NYSE"],
].map(([symbol, name, exchange]) => ({
  symbol,
  name,
  exchange: exchange as "NYSE" | "NASDAQ",
}));

const screenerCache = new Map<string, ScreenerCacheEntry>();
let liveUniverseCache: ScreenerUniverseCacheEntry | null = null;

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entryValue]) =>
      `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function cloneResponse(response: WheelScreenerResponse): WheelScreenerResponse {
  return structuredClone(response);
}

function buildScreenerCacheKey({
  feed,
  filters,
  limit,
  personaId,
  strategy,
  universe,
}: {
  feed: DataFeed;
  filters: WheelFilters;
  limit: number;
  personaId: PersonaId;
  strategy: WheelCompanyStrategy;
  universe: "demo" | "live";
}) {
  return [
    "wheel-screener",
    SCREENER_CACHE_VERSION,
    universe,
    feed,
    personaId,
    strategy,
    String(limit),
    stableStringify(filters),
  ].join(":");
}

function getFreshScreenerCache(key: string, nowMs = Date.now()) {
  const entry = screenerCache.get(key);

  if (!entry || nowMs > entry.freshUntilMs) {
    return null;
  }

  const cacheStatus: CacheStatus =
    entry.response.dataFreshness.feed === "demo" ? "demo" : "fresh";

  return {
    ...cloneResponse(entry.response),
    dataFreshness: {
      ...entry.response.dataFreshness,
      cacheStatus,
      nextSuggestedRefreshAt: new Date(entry.freshUntilMs).toISOString(),
    },
    progress: {
      ...entry.response.progress,
      status: "complete" as const,
      resultScope: "complete" as const,
      nextCursor: null,
      processedCount: entry.response.progress.totalCount,
    },
  };
}

async function getFreshSharedScreenerCache(key: string, nowMs = Date.now()) {
  const memoryEntry = getFreshScreenerCache(key, nowMs);

  if (memoryEntry) {
    return memoryEntry;
  }

  const runtimeEntry = await getRuntimeCacheValue<ScreenerCacheEntry>(key);

  if (!runtimeEntry || nowMs > runtimeEntry.freshUntilMs) {
    return null;
  }

  screenerCache.set(key, {
    response: cloneResponse(runtimeEntry.response),
    freshUntilMs: runtimeEntry.freshUntilMs,
    staleUntilMs: runtimeEntry.staleUntilMs,
  });

  return getFreshScreenerCache(key, nowMs);
}

function getStaleScreenerCache(key: string, nowMs = Date.now()) {
  const entry = screenerCache.get(key);

  if (!entry) {
    return null;
  }

  if (nowMs > entry.staleUntilMs) {
    screenerCache.delete(key);

    return null;
  }

  const cacheStatus: CacheStatus =
    entry.response.dataFreshness.feed === "demo" ? "demo" : "stale";

  return {
    ...cloneResponse(entry.response),
    dataFreshness: {
      ...entry.response.dataFreshness,
      cacheStatus,
      nextSuggestedRefreshAt: null,
    },
    progress: {
      ...entry.response.progress,
      status: "complete" as const,
      resultScope: "complete" as const,
      nextCursor: null,
      processedCount: entry.response.progress.totalCount,
    },
  };
}

async function getStaleSharedScreenerCache(key: string, nowMs = Date.now()) {
  const memoryEntry = getStaleScreenerCache(key, nowMs);

  if (memoryEntry) {
    return memoryEntry;
  }

  const runtimeEntry = await getRuntimeCacheValue<ScreenerCacheEntry>(key);

  if (!runtimeEntry || nowMs > runtimeEntry.staleUntilMs) {
    return null;
  }

  screenerCache.set(key, {
    response: cloneResponse(runtimeEntry.response),
    freshUntilMs: runtimeEntry.freshUntilMs,
    staleUntilMs: runtimeEntry.staleUntilMs,
  });

  return getStaleScreenerCache(key, nowMs);
}

async function setScreenerCache(
  key: string,
  response: WheelScreenerResponse,
  nowMs = Date.now(),
) {
  const entry: ScreenerCacheEntry = {
    response: cloneResponse(response),
    freshUntilMs: nowMs + SCREENER_CACHE_FRESH_TTL_MS,
    staleUntilMs: nowMs + SCREENER_CACHE_STALE_TTL_MS,
  };

  screenerCache.set(key, entry);
  await setRuntimeCacheValue(key, entry, {
    name: "wheel-screener",
    tags: ["wheel-screener"],
    ttlSeconds: Math.ceil(SCREENER_CACHE_STALE_TTL_MS / 1000),
  });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );

  return results;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /429|too many requests|rate limit/i.test(error.message);
}

async function analyzeWheelCandidatesWithRetry(
  request: Parameters<typeof analyzeWheelCandidates>[0],
) {
  for (let attempt = 0; attempt <= SCREENER_RATE_LIMIT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await analyzeWheelCandidates(request);
    } catch (error) {
      const retryDelay = SCREENER_RATE_LIMIT_RETRY_DELAYS_MS[attempt];

      if (!isRateLimitError(error) || retryDelay == null) {
        throw error;
      }

      await wait(retryDelay);
    }
  }

  return analyzeWheelCandidates(request);
}

function summarizeContractCandidate(
  strategy: WheelCompanyStrategy,
  candidate: WheelCandidate,
): WheelCompanyCandidateSummary {
  return {
    strategy,
    score: candidate.score,
    expirationDate: candidate.expirationDate,
    dte: candidate.dte,
    shortStrike: candidate.strike,
    premiumYield: candidate.premiumYield,
    annualizedYield: candidate.annualizedYield,
    delta: candidate.delta,
    impliedVolatility: candidate.impliedVolatility,
    liquidityQuality: candidate.liquidityQuality,
    warningCount: candidate.warnings.length,
  };
}

function summarizeSpreadCandidate(
  strategy: WheelCompanyStrategy,
  candidate: VerticalSpreadCandidate,
): WheelCompanyCandidateSummary {
  return {
    strategy,
    score: candidate.score,
    expirationDate: candidate.expirationDate,
    dte: candidate.dte,
    shortStrike: candidate.shortLeg.strike,
    longStrike: candidate.longLeg.strike,
    returnOnRisk: candidate.returnOnRisk,
    annualizedReturnOnRisk: candidate.annualizedReturnOnRisk,
    delta: candidate.shortDelta,
    impliedVolatility: candidate.impliedVolatility,
    liquidityQuality: candidate.liquidityQuality,
    warningCount: candidate.warnings.length,
  };
}

export function selectCompanyCandidateForStrategy(
  response: WheelAnalysisResponse,
  strategy: WheelCompanyStrategy,
) {
  switch (strategy) {
    case "short_put":
      return response.shortPuts[0]
        ? summarizeContractCandidate("short_put", response.shortPuts[0])
        : null;
    case "put_credit_spread":
      return response.putCreditSpreads[0]
        ? summarizeSpreadCandidate(
            "put_credit_spread",
            response.putCreditSpreads[0],
          )
        : null;
    case "covered_call":
      return response.coveredCalls[0]
        ? summarizeContractCandidate("covered_call", response.coveredCalls[0])
        : null;
    case "call_credit_spread":
      return response.callCreditSpreads[0]
        ? summarizeSpreadCandidate(
            "call_credit_spread",
            response.callCreditSpreads[0],
          )
        : null;
  }
}

function warningKey(warning: Warning) {
  if (warning.message.startsWith("Live refresh failed; showing cached analysis")) {
    return `${warning.type}:${warning.severity}:live-analysis-stale-fallback`;
  }

  return `${warning.type}:${warning.severity}:${warning.message}`;
}

function mergeWarnings(responses: WheelAnalysisResponse[]) {
  const seen = new Set<string>();
  const warnings: Warning[] = [];

  for (const response of responses) {
    for (const warning of response.warnings) {
      const key = warningKey(warning);

      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(warning);
      }
    }
  }

  return warnings;
}

async function getUniverse(useDemoData: boolean) {
  if (useDemoData) {
    return demoAssets;
  }

  if (liveUniverseCache && Date.now() <= liveUniverseCache.freshUntilMs) {
    return [...liveUniverseCache.assets];
  }

  const priority = new Map(
    demoAssets.map((asset, index) => [asset.symbol, index]),
  );
  const assets = await getWheelAssetUniverse();
  const prioritizedAssets = assets.sort((left, right) => {
    const leftPriority = priority.get(left.symbol);
    const rightPriority = priority.get(right.symbol);

    if (leftPriority != null || rightPriority != null) {
      return (leftPriority ?? Number.MAX_SAFE_INTEGER) -
        (rightPriority ?? Number.MAX_SAFE_INTEGER);
    }

    return left.symbol.localeCompare(right.symbol);
  });

  liveUniverseCache = {
    assets: prioritizedAssets,
    freshUntilMs: Date.now() + SCREENER_UNIVERSE_CACHE_TTL_MS,
  };

  return [...prioritizedAssets];
}

function screenerCacheKeyForRequest(request: WheelScreenerRequest) {
  const env = getEnv();
  const personaId = request.persona;
  const strategy = request.strategy ?? "short_put";
  const filters = mergeFilters(personaId, request.filters);
  const limit = request.limit ?? 50;
  const useDemoData = env.USE_DEMO_DATA || !hasAlpacaCredentials();
  const feed: DataFeed = useDemoData ? "demo" : env.ALPACA_OPTIONS_FEED;

  return buildScreenerCacheKey({
    feed,
    filters,
    limit,
    personaId,
    strategy,
    universe: useDemoData ? "demo" : "live",
  });
}

export async function getCachedWheelScreenerResponse(
  request: WheelScreenerRequest,
) {
  if (request.forceRefresh || (request.cursor ?? 0) !== 0) {
    return null;
  }

  return getFreshSharedScreenerCache(screenerCacheKeyForRequest(request));
}

export async function cacheCompletedWheelScreenerResponse(
  request: WheelScreenerRequest,
  response: WheelScreenerResponse,
) {
  await setScreenerCache(screenerCacheKeyForRequest(request), {
    ...response,
    progress: {
      ...response.progress,
      status: "complete",
      resultScope: "complete",
      nextCursor: null,
      processedCount: response.progress.totalCount,
    },
  });
}

export async function analyzeTopWheelCompanies(
  request: WheelScreenerRequest,
): Promise<WheelScreenerResponse> {
  const env = getEnv();
  const personaId = request.persona;
  const strategy = request.strategy ?? "short_put";
  const persona = getPersona(personaId);
  const filters = mergeFilters(personaId, request.filters);
  const limit = request.limit ?? 50;
  const cursor = request.cursor ?? 0;
  const useDemoData = env.USE_DEMO_DATA || !hasAlpacaCredentials();
  const feed: DataFeed = useDemoData ? "demo" : env.ALPACA_OPTIONS_FEED;
  const requestedBatchSize =
    request.batchSize ?? (useDemoData ? demoAssets.length : DEFAULT_LIVE_BATCH_SIZE);
  const maxBatchSize = useDemoData ? 50 : DEFAULT_LIVE_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(requestedBatchSize, maxBatchSize));
  const cacheKey = screenerCacheKeyForRequest(request);

  if (cursor === 0 && !request.forceRefresh) {
    const fresh = await getFreshSharedScreenerCache(cacheKey);

    if (fresh) {
      return fresh;
    }
  }

  try {
    const now = new Date();
    const universe = await getUniverse(useDemoData);
    const batchStart = Math.min(cursor, universe.length);
    const batch = universe.slice(batchStart, batchStart + batchSize);
    const processedCount = batchStart + batch.length;
    const nextCursor =
      processedCount < universe.length ? processedCount : null;
    const errors: string[] = [];
    const responses: WheelAnalysisResponse[] = [];
    let skippedCount = 0;

    const scoredCompanies = await mapWithConcurrency(
      batch,
      SCREENER_CONCURRENCY,
      async (asset): Promise<WheelCompanyScore | null> => {
        try {
          const response = await analyzeWheelCandidatesWithRetry({
            ticker: asset.symbol,
            persona: personaId,
            strategy,
            filters,
            resultLimit: SCREENER_ANALYSIS_RESULT_LIMIT,
            forceRefresh: request.forceRefresh,
          });
          const bestCandidate = selectCompanyCandidateForStrategy(
            response,
            strategy,
          );

          responses.push(response);

          if (!bestCandidate) {
            skippedCount += 1;

            return null;
          }

          return {
            rank: 0,
            ticker: asset.symbol,
            name: asset.name,
            exchange: asset.exchange,
            score: bestCandidate.score,
            underlying: response.underlying,
            bestCandidate,
            warnings: response.warnings,
            errors: response.errors,
          };
        } catch (error) {
          skippedCount += 1;

          if (errors.length < 25) {
            errors.push(
              `${asset.symbol}: ${
                error instanceof Error ? error.message : "Analysis failed."
              }`,
            );
          }

          return null;
        }
      },
    );

    const companies = scoredCompanies
      .filter((company) => company != null)
      .sort((left, right) => right.score - left.score || left.ticker.localeCompare(right.ticker))
      .slice(0, limit)
      .map((company, index) => ({
        ...company,
        rank: index + 1,
      }));
    const response: WheelScreenerResponse = {
      persona: {
        id: persona.id,
        name: persona.name,
        motto: persona.motto,
      },
      dataFreshness: {
        feed,
        cacheStatus: feed === "demo" ? "demo" : "fresh",
        asOf: responses.at(-1)?.dataFreshness.asOf ?? now.toISOString(),
        nextSuggestedRefreshAt:
          nextCursor == null ? addMinutes(now, 5) : null,
      },
      companies,
      screenedCount: processedCount,
      skippedCount,
      progress: {
        status: nextCursor == null ? "complete" : "running",
        resultScope: "batch",
        cursor: batchStart,
        nextCursor,
        batchSize,
        batchScreenedCount: batch.length,
        processedCount,
        totalCount: universe.length,
      },
      warnings: mergeWarnings(responses),
      errors,
    };

    if (cursor === 0 && nextCursor == null) {
      await setScreenerCache(cacheKey, {
        ...response,
        progress: {
          ...response.progress,
          resultScope: "complete",
        },
      });
    }

    return response;
  } catch (error) {
    const stale = await getStaleSharedScreenerCache(cacheKey);

    if (stale) {
      return {
        ...stale,
        warnings: [
          {
            type: "data_quality",
            severity: "warning",
            message: `Live screener refresh failed; showing cached company rankings. ${
              error instanceof Error ? error.message : "Refresh failed."
            }`,
          },
          ...stale.warnings,
        ],
      };
    }

    throw error;
  }
}
