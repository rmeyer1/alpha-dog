import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { requestSupabaseRest } from "@/lib/supabase/rest";
import { getPersona, mergeFilters } from "./personas";
import type {
  CacheStatus,
  DataFeed,
  QualityLabel,
  Trend,
  Warning,
  WheelCompanyCandidateSummary,
  WheelCompanyScore,
  WheelCompanyStrategy,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "./types";

export const MATERIALIZED_FRESH_TTL_MS = 15 * 60 * 1000;
export const MATERIALIZED_STALE_TTL_MS = 2 * 60 * 60 * 1000;

export interface WheelScreenerSnapshotRow {
  id: string;
  persona: string;
  strategy: string;
  filter_key: string;
  filters: Record<string, unknown>;
  feed: DataFeed;
  status: "running" | "complete" | "failed";
  started_at: string;
  completed_at: string | null;
  total_count: number;
  processed_count: number;
  skipped_count: number;
  error: string | null;
  created_at: string;
}

interface WheelOptionCandidateRow {
  snapshot_id?: string;
  persona: string;
  strategy: WheelCompanyStrategy;
  symbol: string;
  company_name: string;
  exchange: "NYSE" | "NASDAQ";
  score: number;
  option_type: "put" | "call";
  expiration: string;
  dte: number;
  short_strike: number | string;
  long_strike: number | string | null;
  premium_yield: number | string | null;
  annualized_yield: number | string | null;
  return_on_risk: number | string | null;
  annualized_return_on_risk: number | string | null;
  delta: number | string | null;
  implied_volatility: number | string | null;
  liquidity_quality: QualityLabel;
  warning_count: number;
  underlying_price: number | string;
  underlying_as_of: string | null;
  trend: Trend;
  rsi14: number | string | null;
  ma20: number | string | null;
  ma50: number | string | null;
  ma200: number | string | null;
  warnings: Warning[];
  errors: string[];
  as_of: string;
}

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

function getRequestContext(request: WheelScreenerRequest) {
  const env = getEnv();
  const useDemoData = env.USE_DEMO_DATA || !hasAlpacaCredentials();
  const feed: DataFeed = useDemoData ? "demo" : env.ALPACA_OPTIONS_FEED;
  const filters = mergeFilters(request.persona, request.filters);

  return {
    feed,
    filters,
    filterKey: stableStringify(filters),
    persona: getPersona(request.persona),
    strategy: request.strategy ?? "short_put",
  };
}

function parseNumber(value: number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  return typeof value === "number" ? value : Number(value);
}

function displayLiquidityQuality(quality: QualityLabel): QualityLabel {
  return quality === "unknown" ? "weak" : quality;
}

function rankCompanyScores(
  rows: WheelCompanyScore[],
  offset: number,
  limit: number,
) {
  const byTicker = new Map<string, WheelCompanyScore>();

  for (const row of rows) {
    const existing = byTicker.get(row.ticker);

    if (!existing || row.score > existing.score) {
      byTicker.set(row.ticker, row);
    }
  }

  return Array.from(byTicker.values())
    .sort((left, right) =>
      right.score - left.score || left.ticker.localeCompare(right.ticker)
    )
    .slice(offset, offset + limit)
    .map((company, index) => ({
      ...company,
      rank: offset + index + 1,
    }));
}

function cacheStatusForSnapshot(
  snapshot: Pick<WheelScreenerSnapshotRow, "completed_at" | "feed">,
  nowMs = Date.now(),
): CacheStatus | null {
  if (snapshot.feed === "demo") {
    return "demo";
  }

  if (!snapshot.completed_at) {
    return null;
  }

  const ageMs = nowMs - new Date(snapshot.completed_at).getTime();

  if (ageMs <= MATERIALIZED_FRESH_TTL_MS) {
    return "fresh";
  }

  if (ageMs <= MATERIALIZED_STALE_TTL_MS) {
    return "stale";
  }

  return null;
}

export function materializedSnapshotAgeMs(
  snapshot: Pick<WheelScreenerSnapshotRow, "completed_at" | "created_at">,
  nowMs = Date.now(),
) {
  return nowMs -
    new Date(snapshot.completed_at ?? snapshot.created_at).getTime();
}

function optionTypeForStrategy(strategy: WheelCompanyStrategy) {
  return strategy === "short_put" || strategy === "put_credit_spread"
    ? "put"
    : "call";
}

function nextSuggestedRefreshAt(
  snapshot: Pick<WheelScreenerSnapshotRow, "completed_at" | "feed">,
) {
  if (snapshot.feed === "demo" || !snapshot.completed_at) {
    return null;
  }

  return new Date(
    new Date(snapshot.completed_at).getTime() + MATERIALIZED_FRESH_TTL_MS,
  ).toISOString();
}

function rowToCompanyScore(
  row: WheelOptionCandidateRow,
  rank: number,
): WheelCompanyScore {
  const bestCandidate: WheelCompanyCandidateSummary = {
    strategy: row.strategy,
    score: row.score,
    expirationDate: row.expiration,
    dte: row.dte,
    shortStrike: parseNumber(row.short_strike) ?? 0,
    longStrike: parseNumber(row.long_strike) ?? undefined,
    premiumYield: parseNumber(row.premium_yield) ?? undefined,
    annualizedYield: parseNumber(row.annualized_yield) ?? undefined,
    returnOnRisk: parseNumber(row.return_on_risk) ?? undefined,
    annualizedReturnOnRisk:
      parseNumber(row.annualized_return_on_risk) ?? undefined,
    delta: parseNumber(row.delta),
    impliedVolatility: parseNumber(row.implied_volatility),
    liquidityQuality: displayLiquidityQuality(row.liquidity_quality),
    warningCount: row.warning_count,
  };

  return {
    rank,
    ticker: row.symbol,
    name: row.company_name,
    exchange: row.exchange,
    score: row.score,
    underlying: {
      symbol: row.symbol,
      price: parseNumber(row.underlying_price) ?? 0,
      asOf: row.underlying_as_of ?? row.as_of,
      trend: row.trend,
      rsi14: parseNumber(row.rsi14),
      movingAverages: {
        ma20: parseNumber(row.ma20),
        ma50: parseNumber(row.ma50),
        ma200: parseNumber(row.ma200),
      },
    },
    bestCandidate,
    warnings: row.warnings ?? [],
    errors: row.errors ?? [],
  };
}

function companyScoreToCandidateRow(
  snapshotId: string,
  request: WheelScreenerRequest,
  company: WheelCompanyScore,
): WheelOptionCandidateRow {
  return {
    snapshot_id: snapshotId,
    persona: request.persona,
    strategy: company.bestCandidate.strategy,
    symbol: company.ticker,
    company_name: company.name,
    exchange: company.exchange,
    score: company.score,
    option_type: optionTypeForStrategy(company.bestCandidate.strategy),
    expiration: company.bestCandidate.expirationDate,
    dte: company.bestCandidate.dte,
    short_strike: company.bestCandidate.shortStrike,
    long_strike: company.bestCandidate.longStrike ?? null,
    premium_yield: company.bestCandidate.premiumYield ?? null,
    annualized_yield: company.bestCandidate.annualizedYield ?? null,
    return_on_risk: company.bestCandidate.returnOnRisk ?? null,
    annualized_return_on_risk:
      company.bestCandidate.annualizedReturnOnRisk ?? null,
    delta: company.bestCandidate.delta,
    implied_volatility: company.bestCandidate.impliedVolatility,
    liquidity_quality: company.bestCandidate.liquidityQuality,
    warning_count: company.bestCandidate.warningCount,
    underlying_price: company.underlying.price,
    underlying_as_of: company.underlying.asOf,
    trend: company.underlying.trend,
    rsi14: company.underlying.rsi14,
    ma20: company.underlying.movingAverages.ma20,
    ma50: company.underlying.movingAverages.ma50,
    ma200: company.underlying.movingAverages.ma200,
    warnings: company.warnings,
    errors: company.errors,
    as_of: new Date().toISOString(),
  };
}

export async function getMaterializedWheelScreenerResponse(
  request: WheelScreenerRequest,
): Promise<WheelScreenerResponse | null> {
  if (request.forceRefresh) {
    return null;
  }

  const { feed, filterKey, persona, strategy } = getRequestContext(request);
  const offset = request.cursor ?? 0;
  const snapshots = await requestSupabaseRest<WheelScreenerSnapshotRow[]>(
    "wheel_screener_snapshots",
    {
      query: {
        select:
          "id,persona,strategy,filter_key,filters,feed,status,started_at,completed_at,total_count,processed_count,skipped_count,error,created_at",
        persona: `eq.${request.persona}`,
        strategy: `eq.${strategy}`,
        filter_key: `eq.${filterKey}`,
        feed: `eq.${feed}`,
        status: "eq.complete",
        order: "completed_at.desc",
        limit: 1,
      },
    },
  );
  const snapshot = snapshots?.[0];
  const cacheStatus = snapshot ? cacheStatusForSnapshot(snapshot) : null;

  if (!snapshot || !cacheStatus) {
    return null;
  }

  const limit = request.limit ?? 50;
  const candidateReadLimit = offset === 0 ? Math.max(limit * 4, 200) : limit;
  const rows = await requestSupabaseRest<WheelOptionCandidateRow[]>(
    "wheel_option_candidates",
    {
      query: {
        select:
          "snapshot_id,persona,strategy,symbol,company_name,exchange,score,option_type,expiration,dte,short_strike,long_strike,premium_yield,annualized_yield,return_on_risk,annualized_return_on_risk,delta,implied_volatility,liquidity_quality,warning_count,underlying_price,underlying_as_of,trend,rsi14,ma20,ma50,ma200,warnings,errors,as_of",
        snapshot_id: `eq.${snapshot.id}`,
        strategy: `eq.${strategy}`,
        order: "score.desc,symbol.asc",
        limit: candidateReadLimit,
        offset: offset === 0 ? 0 : offset,
      },
    },
  );
  const recentDeepRows = offset === 0
    ? await getRecentDeepScanCandidateRows({
        filterKey,
        limit: candidateReadLimit,
        persona: request.persona,
        strategy,
      })
    : [];

  const companies = offset === 0
    ? rankCompanyScores(
        [
          ...(rows ?? []).map((row, index) =>
            rowToCompanyScore(row, index + 1)
          ),
          ...recentDeepRows.map((row, index) =>
            rowToCompanyScore(row, (rows?.length ?? 0) + index + 1)
          ),
        ],
        0,
        limit,
      )
    : (rows ?? []).map((row, index) =>
        rowToCompanyScore(row, offset + index + 1)
      );
  const asOf = snapshot.completed_at ?? snapshot.created_at;

  return {
    persona: {
      id: persona.id,
      name: persona.name,
      motto: persona.motto,
    },
    dataFreshness: {
      feed: snapshot.feed,
      cacheStatus,
      asOf,
      nextSuggestedRefreshAt: nextSuggestedRefreshAt(snapshot),
    },
    companies,
    screenedCount: snapshot.total_count,
    skippedCount: snapshot.skipped_count,
    progress: {
      status: "complete",
      resultScope: "complete",
      cursor: offset,
      nextCursor: companies.length === limit ? offset + limit : null,
      batchSize: request.batchSize ?? 8,
      batchScreenedCount: companies.length,
      processedCount: snapshot.processed_count,
      totalCount: snapshot.total_count,
    },
    warnings: [],
    errors: snapshot.error ? [snapshot.error] : [],
  };
}

async function getRecentDeepScanCandidateRows({
  filterKey,
  limit,
  persona,
  strategy,
}: {
  filterKey: string;
  limit: number;
  persona: WheelScreenerRequest["persona"];
  strategy: WheelCompanyStrategy;
}) {
  const maxAgeHours = getEnv().WHEEL_UNIVERSE_BACKGROUND_CANDIDATE_MAX_AGE_HOURS;
  const minAsOf = new Date(
    Date.now() - maxAgeHours * 60 * 60 * 1000,
  ).toISOString();

  return await requestSupabaseRest<WheelOptionCandidateRow[]>(
    "wheel_deep_scan_candidates",
    {
      query: {
        select:
          "persona,strategy,symbol,company_name,exchange,score,option_type,expiration,dte,short_strike,long_strike,premium_yield,annualized_yield,return_on_risk,annualized_return_on_risk,delta,implied_volatility,liquidity_quality,warning_count,underlying_price,underlying_as_of,trend,rsi14,ma20,ma50,ma200,warnings,errors,as_of",
        persona: `eq.${persona}`,
        strategy: `eq.${strategy}`,
        filter_key: `eq.${filterKey}`,
        as_of: `gte.${minAsOf}`,
        order: "score.desc,symbol.asc",
        limit,
      },
    },
  ) ?? [];
}

export async function getLatestMaterializedWheelScreenerSnapshot(
  request: WheelScreenerRequest,
) {
  const { feed, filterKey, strategy } = getRequestContext(request);
  const rows = await requestSupabaseRest<WheelScreenerSnapshotRow[]>(
    "wheel_screener_snapshots",
    {
      query: {
        select:
          "id,persona,strategy,filter_key,filters,feed,status,started_at,completed_at,total_count,processed_count,skipped_count,error,created_at",
        persona: `eq.${request.persona}`,
        strategy: `eq.${strategy}`,
        filter_key: `eq.${filterKey}`,
        feed: `eq.${feed}`,
        status: "in.(running,complete)",
        order: "created_at.desc",
        limit: 1,
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function createMaterializedWheelScreenerSnapshot(
  request: WheelScreenerRequest,
) {
  const { feed, filterKey, filters, strategy } = getRequestContext(request);
  const rows = await requestSupabaseRest<Pick<WheelScreenerSnapshotRow, "id">[]>(
    "wheel_screener_snapshots",
    {
      method: "POST",
      body: [
        {
          persona: request.persona,
          strategy,
          filter_key: filterKey,
          filters,
          feed,
          status: "running",
        },
      ],
      prefer: "return=representation",
      query: {
        select: "id",
      },
    },
  );

  return rows?.[0]?.id ?? null;
}

export async function upsertMaterializedWheelScreenerCandidates(
  snapshotId: string | null,
  request: WheelScreenerRequest,
  response: WheelScreenerResponse,
) {
  if (!snapshotId || response.companies.length === 0) {
    return;
  }

  await requestSupabaseRest<null>("wheel_option_candidates", {
    method: "POST",
    body: response.companies.map((company) =>
      companyScoreToCandidateRow(snapshotId, request, company),
    ),
    prefer: "resolution=merge-duplicates,return=minimal",
    query: {
      on_conflict: "snapshot_id,symbol,strategy",
    },
  });
}

export async function completeMaterializedWheelScreenerSnapshot(
  snapshotId: string | null,
  response: WheelScreenerResponse,
) {
  if (!snapshotId) {
    return;
  }

  await requestSupabaseRest<null>("wheel_screener_snapshots", {
    method: "PATCH",
    body: {
      status: "complete",
      completed_at: new Date().toISOString(),
      total_count: response.progress.totalCount,
      processed_count: response.progress.processedCount,
      skipped_count: response.skippedCount,
      error: response.errors[0] ?? null,
    },
    prefer: "return=minimal",
    query: {
      id: `eq.${snapshotId}`,
    },
  });
}

export async function failMaterializedWheelScreenerSnapshot(
  snapshotId: string | null,
  error: unknown,
) {
  if (!snapshotId) {
    return;
  }

  await requestSupabaseRest<null>("wheel_screener_snapshots", {
    method: "PATCH",
    body: {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Screener workflow failed.",
    },
    prefer: "return=minimal",
    query: {
      id: `eq.${snapshotId}`,
    },
  });
}
