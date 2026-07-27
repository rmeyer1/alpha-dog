import { getEnv, isDemoMode } from "@/lib/env";
import { requestSupabaseRest } from "@/lib/supabase/rest";
import { getPersona } from "../personas";
import type {
  CacheStatus,
  WheelCompanyScore,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "../types";
import { parseNumber } from "../universe-scanner/domain";
import { marketBatchRequestIdentity } from "./domain";
import type {
  MarketBatchCandidateRow,
  MarketBatchCurrentSnapshotRow,
  MarketBatchRow,
  MarketBatchSnapshotRow,
} from "./model";

const FRESH_TTL_MS = 15 * 60 * 1000;
const CANDIDATE_SELECT =
  "snapshot_id,rank,symbol,company_name,exchange,score,strategy,option_type,expiration,dte,short_strike,long_strike,premium_received,premium_yield,annualized_yield,return_on_risk,annualized_return_on_risk,delta,implied_volatility,liquidity_quality,warning_count,underlying_price,underlying_as_of,trend,rsi14,ma20,ma50,ma200,warnings,errors,as_of";

function cacheStatus(completedAt: string, nowMs: number): CacheStatus {
  return nowMs - new Date(completedAt).getTime() <= FRESH_TTL_MS
    ? "fresh"
    : "stale";
}

function candidateToCompany(row: MarketBatchCandidateRow): WheelCompanyScore {
  return {
    rank: row.rank,
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
    bestCandidate: {
      strategy: row.strategy,
      score: row.score,
      expirationDate: row.expiration,
      dte: row.dte,
      shortStrike: parseNumber(row.short_strike) ?? 0,
      longStrike: parseNumber(row.long_strike) ?? undefined,
      premiumReceived: parseNumber(row.premium_received) ?? undefined,
      premiumYield: parseNumber(row.premium_yield) ?? undefined,
      annualizedYield: parseNumber(row.annualized_yield) ?? undefined,
      returnOnRisk: parseNumber(row.return_on_risk) ?? undefined,
      annualizedReturnOnRisk:
        parseNumber(row.annualized_return_on_risk) ?? undefined,
      delta: parseNumber(row.delta),
      impliedVolatility: parseNumber(row.implied_volatility),
      liquidityQuality: row.liquidity_quality,
      warningCount: row.warning_count,
    },
    warnings: row.warnings,
    errors: row.errors,
  };
}

export async function getSharedMarketBatchScreenerResponse(
  request: WheelScreenerRequest,
  nowMs = Date.now(),
): Promise<WheelScreenerResponse | null> {
  if (request.forceRefresh || isDemoMode()) {
    return null;
  }

  const identity = marketBatchRequestIdentity(request);
  const feed = getEnv().ALPACA_OPTIONS_FEED;
  const pointers = await requestSupabaseRest<
    MarketBatchCurrentSnapshotRow[]
  >("wheel_market_batch_current_snapshots", {
    query: {
      feed: `eq.${feed}`,
      filter_key: `eq.${identity.filterKey}`,
      limit: 1,
      persona: `eq.${identity.persona}`,
      select: "batch_id,snapshot_id,published_at",
      strategy: `eq.${identity.strategy}`,
    },
  });
  const pointer = pointers?.[0];

  if (!pointer) {
    return null;
  }

  const batches = await requestSupabaseRest<
    Array<Pick<MarketBatchRow, "id" | "status">>
  >("wheel_market_batches", {
    query: {
      id: `eq.${pointer.batch_id}`,
      limit: 1,
      select: "id,status",
      status: "eq.complete",
    },
  });

  if (!batches?.[0]) {
    return null;
  }

  const snapshots = await requestSupabaseRest<MarketBatchSnapshotRow[]>(
    "wheel_market_batch_snapshots",
    {
      query: {
        batch_id: `eq.${pointer.batch_id}`,
        id: `eq.${pointer.snapshot_id}`,
        limit: 1,
        select:
          "id,batch_id,feed,status,screened_count,skipped_count,candidate_count,warnings,errors,as_of,next_suggested_refresh_at,started_at,completed_at",
        status: "eq.complete",
      },
    },
  );
  const snapshot = snapshots?.[0];

  if (!snapshot?.completed_at) {
    return null;
  }

  const offset = request.cursor ?? 0;
  const limit = request.limit ?? 50;
  const rows = await requestSupabaseRest<MarketBatchCandidateRow[]>(
    "wheel_market_batch_candidates",
    {
      query: {
        limit,
        offset,
        order: "rank.asc,symbol.asc",
        select: CANDIDATE_SELECT,
        snapshot_id: `eq.${snapshot.id}`,
      },
    },
  );
  const companies = (rows ?? []).map(candidateToCompany);
  const status = cacheStatus(snapshot.completed_at, nowMs);
  const persona = getPersona(request.persona);
  const nextOffset = offset + companies.length;

  return {
    persona: {
      id: persona.id,
      name: persona.name,
      motto: persona.motto,
    },
    dataFreshness: {
      ageMinutes: Math.max(
        0,
        Math.round((nowMs - new Date(snapshot.completed_at).getTime()) / 60_000),
      ),
      feed: snapshot.feed,
      cacheStatus: status,
      asOf: snapshot.as_of,
      lastCompletedAt: snapshot.completed_at,
      lastStartedAt: snapshot.started_at,
      nextSuggestedRefreshAt: snapshot.next_suggested_refresh_at,
      refreshStatus: status,
      source: "materialized",
    },
    companies,
    screenedCount: snapshot.screened_count,
    skippedCount: snapshot.skipped_count,
    progress: {
      status: "complete",
      resultScope: "complete",
      cursor: offset,
      nextCursor:
        nextOffset < snapshot.candidate_count ? nextOffset : null,
      batchSize: request.batchSize ?? 8,
      batchScreenedCount: companies.length,
      processedCount: snapshot.screened_count,
      totalCount: snapshot.screened_count,
    },
    warnings: snapshot.warnings,
    errors: snapshot.errors,
  };
}
