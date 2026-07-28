import { requestSupabaseRest } from "@/lib/supabase/rest";
import { upsertScannerRows } from "../scanner-concurrency";
import type {
  DataFeed,
  WheelCompanyScore,
  WheelFilters,
  WheelScreenerRequest,
} from "../types";
import { optionTypeForStrategy } from "../universe-scanner/candidate-domain";
import type {
  CreateMarketBatchResult,
  MarketBatchIngestionSummary,
  MarketBatchMetric,
  MarketBatchOptionIngestionRow,
  MarketBatchOptionRow,
  MarketBatchRow,
  MarketBatchSnapshotResult,
  MarketBatchUnderlyingRow,
  StagedMarketBatchSnapshot,
} from "./model";
import type { ScannerAsset } from "../universe-scanner/model";

const UNDERLYING_SYMBOL_READ_CHUNK_SIZE = 100;

export async function readScannerAssetsBySymbols(
  symbols: string[],
): Promise<ScannerAsset[]> {
  const normalized = Array.from(
    new Set(
      symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ),
  );
  const rows: Array<{
    company_name: string;
    exchange: ScannerAsset["exchange"];
    symbol: string;
  }> = [];

  for (
    let offset = 0;
    offset < normalized.length;
    offset += UNDERLYING_SYMBOL_READ_CHUNK_SIZE
  ) {
    const chunk = normalized.slice(
      offset,
      offset + UNDERLYING_SYMBOL_READ_CHUNK_SIZE,
    );
    const result = await requestSupabaseRest<typeof rows>(
      "wheel_underlying_universe",
      {
        query: {
          active: "eq.true",
          optionable: "eq.true",
          select: "symbol,company_name,exchange",
          symbol: `in.(${chunk.map((symbol) => `"${symbol}"`).join(",")})`,
        },
      },
    );
    rows.push(...(result ?? []));
  }

  return rows.map((row) => ({
    exchange: row.exchange,
    name: row.company_name,
    symbol: row.symbol,
  }));
}

interface CreateBatchRpcResult {
  batch_id: string;
  batch_key: string;
  created: boolean;
  status: CreateMarketBatchResult["status"];
}

interface CreateSnapshotRpcResult {
  snapshot_id: string;
  status: "building" | "complete" | "failed";
}

const PAGE_SIZE = 1000;

async function readAllRows<T>(
  table: string,
  query: Record<string, string | number>,
) {
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await requestSupabaseRest<T[]>(table, {
      query: {
        ...query,
        limit: PAGE_SIZE,
        offset,
      },
    });

    rows.push(...(page ?? []));

    if ((page?.length ?? 0) < PAGE_SIZE) {
      return rows;
    }
  }
}

export async function createMarketBatch({
  batchKey,
  feed,
  intervalStartedAt,
}: {
  batchKey: string;
  feed: Exclude<DataFeed, "demo">;
  intervalStartedAt: string;
}): Promise<CreateMarketBatchResult> {
  const result = await requestSupabaseRest<CreateBatchRpcResult>(
    "rpc/create_wheel_market_batch",
    {
      method: "POST",
      body: {
        p_batch_key: batchKey,
        p_feed: feed,
        p_interval_started_at: intervalStartedAt,
      },
    },
  );

  if (!result) {
    throw new Error("Supabase did not return a wheel market batch identity.");
  }

  return {
    batchId: result.batch_id,
    batchKey: result.batch_key,
    created: result.created,
    status: result.status,
  };
}

export async function getMarketBatch(batchId: string) {
  const rows = await requestSupabaseRest<MarketBatchRow[]>(
    "wheel_market_batches",
    {
      query: {
        id: `eq.${batchId}`,
        limit: 1,
        select:
          "id,batch_key,interval_started_at,feed,status,asset_count,ranked_count,selected_count,option_contract_count,snapshot_count,error_count,summary,underlyings_completed_at",
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function persistMarketBatchUnderlyings(
  rows: MarketBatchUnderlyingRow[],
) {
  await upsertScannerRows(
    "wheel_market_batch_underlyings",
    rows,
    "batch_id,symbol",
  );
}

export async function persistMarketBatchOptions(
  rows: MarketBatchOptionRow[],
) {
  await upsertScannerRows(
    "wheel_market_batch_option_contracts",
    rows,
    "batch_id,contract_symbol",
  );
}

export async function checkpointMarketBatchUnderlyings(
  batchId: string,
  summary: {
    assetCount: number;
    metrics: MarketBatchMetric[];
    missingSymbols: string[];
    rankedCount: number;
    selectedCount: number;
    selectedSymbols: string[];
  },
) {
  await requestSupabaseRest(
    "rpc/checkpoint_wheel_market_batch_underlyings",
    {
      method: "POST",
      body: {
        p_asset_count: summary.assetCount,
        p_batch_id: batchId,
        p_ranked_count: summary.rankedCount,
        p_selected_count: summary.selectedCount,
        p_summary: {
          metrics: summary.metrics,
          missingSymbols: summary.missingSymbols,
          selectedSymbols: summary.selectedSymbols,
        },
      },
    },
  );
}

export async function getMarketBatchOptionIngestion(
  batchId: string,
  symbol: string,
  optionType: "put" | "call",
) {
  const rows = await requestSupabaseRest<MarketBatchOptionIngestionRow[]>(
    "wheel_market_batch_option_ingestions",
    {
      query: {
        batch_id: `eq.${batchId}`,
        limit: 1,
        option_type: `eq.${optionType}`,
        select:
          "batch_id,symbol,option_type,status,contract_count,error,duration_ms,completed_at",
        symbol: `eq.${symbol}`,
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function checkpointMarketBatchOptionIngestion(
  batchId: string,
  summary: {
    contractCount: number;
    durationMs: number;
    error: string | null;
    optionType: "put" | "call";
    symbol: string;
  },
) {
  await upsertScannerRows(
    "wheel_market_batch_option_ingestions",
    [{
      batch_id: batchId,
      symbol: summary.symbol,
      option_type: summary.optionType,
      status: summary.error ? "failed" : "complete",
      contract_count: summary.contractCount,
      error: summary.error,
      duration_ms: Math.max(
        0,
        Math.round(summary.durationMs * 1000) / 1000,
      ),
      completed_at: new Date().toISOString(),
    }],
    "batch_id,symbol,option_type",
  );
}

export async function upsertMarketBatchMetrics(
  batchId: string,
  metrics: MarketBatchMetric[],
) {
  await upsertScannerRows(
    "wheel_market_batch_metrics",
    metrics.map((metric) => ({
      batch_id: batchId,
      phase: metric.phase,
      operation: metric.operation,
      provider_requests: metric.providerRequests,
      database_rows_written: metric.databaseRowsWritten,
      duration_ms: Math.max(0, Math.round(metric.durationMs * 1000) / 1000),
      recorded_at: new Date().toISOString(),
    })),
    "batch_id,phase,operation",
  );
}

export async function completeMarketBatchFacts(
  batchId: string,
  summary: MarketBatchIngestionSummary,
) {
  await requestSupabaseRest("rpc/complete_wheel_market_batch_facts", {
    method: "POST",
    body: {
      p_asset_count: summary.assetCount,
      p_batch_id: batchId,
      p_error_count: summary.errorCount,
      p_option_contract_count: summary.optionContractCount,
      p_ranked_count: summary.rankedCount,
      p_selected_count: summary.selectedCount,
      p_summary: {
        errors: summary.errors,
        ingestion: {
          assetCount: summary.assetCount,
          errorCount: summary.errorCount,
          optionContractCount: summary.optionContractCount,
          rankedCount: summary.rankedCount,
          selectedCount: summary.selectedCount,
        },
      },
    },
  });
}

export async function readMarketBatchUnderlyings(batchId: string) {
  return readAllRows<MarketBatchUnderlyingRow>(
    "wheel_market_batch_underlyings",
    {
      batch_id: `eq.${batchId}`,
      order: "universe_rank.asc,symbol.asc",
      select:
        "batch_id,symbol,company_name,exchange,universe_rank,selected_for_scoring,stock_score,price,latest_trade_at,daily_volume,dollar_volume,previous_close,pct_change,stock_snapshot,trend,rsi14,ma20,ma50,ma200,technical_as_of,earnings_context,earnings_as_of,captured_at",
    },
  );
}

export async function readMarketBatchUnderlying(
  batchId: string,
  symbol: string,
) {
  const rows = await requestSupabaseRest<MarketBatchUnderlyingRow[]>(
    "wheel_market_batch_underlyings",
    {
      query: {
        batch_id: `eq.${batchId}`,
        limit: 1,
        select:
          "batch_id,symbol,company_name,exchange,universe_rank,selected_for_scoring,stock_score,price,latest_trade_at,daily_volume,dollar_volume,previous_close,pct_change,stock_snapshot,trend,rsi14,ma20,ma50,ma200,technical_as_of,earnings_context,earnings_as_of,captured_at",
        symbol: `eq.${symbol}`,
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function readMarketBatchOptions(batchId: string) {
  return readAllRows<MarketBatchOptionRow>(
    "wheel_market_batch_option_contracts",
    {
      batch_id: `eq.${batchId}`,
      order:
        "underlying_symbol.asc,option_type.asc,expiration.asc,strike.asc,contract_symbol.asc",
      select:
        "batch_id,contract_symbol,underlying_symbol,option_type,strike,expiration,bid,ask,delta,theta,implied_volatility,volume,open_interest,captured_at",
    },
  );
}

export async function createMarketBatchSnapshot({
  batchId,
  feed,
  filterKey,
  filters,
  request,
  response,
}: {
  batchId: string;
  feed: Exclude<DataFeed, "demo">;
  filterKey: string;
  filters: WheelFilters;
  request: WheelScreenerRequest;
  response: MarketBatchSnapshotResult["response"];
}) {
  const result = await requestSupabaseRest<CreateSnapshotRpcResult>(
    "rpc/create_wheel_market_batch_snapshot",
    {
      method: "POST",
      body: {
        p_as_of: response.dataFreshness.asOf,
        p_batch_id: batchId,
        p_feed: feed,
        p_filter_key: filterKey,
        p_filters: filters,
        p_next_suggested_refresh_at:
          response.dataFreshness.nextSuggestedRefreshAt,
        p_persona: request.persona,
        p_result_limit: request.limit ?? 50,
        p_strategy: request.strategy,
      },
    },
  );

  if (!result) {
    throw new Error("Supabase did not return a market batch snapshot.");
  }

  return result;
}

function candidateRow(snapshotId: string, company: WheelCompanyScore) {
  return {
    snapshot_id: snapshotId,
    rank: company.rank,
    symbol: company.ticker,
    company_name: company.name,
    exchange: company.exchange,
    score: company.score,
    strategy: company.bestCandidate.strategy,
    option_type: optionTypeForStrategy(company.bestCandidate.strategy),
    expiration: company.bestCandidate.expirationDate,
    dte: company.bestCandidate.dte,
    short_strike: company.bestCandidate.shortStrike,
    long_strike: company.bestCandidate.longStrike ?? null,
    premium_received: company.bestCandidate.premiumReceived ?? null,
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
    as_of: company.underlying.asOf,
  };
}

export async function replaceMarketBatchSnapshotCandidates(
  snapshotId: string,
  companies: WheelCompanyScore[],
) {
  await requestSupabaseRest<null>("wheel_market_batch_candidates", {
    method: "DELETE",
    query: {
      snapshot_id: `eq.${snapshotId}`,
    },
  });

  if (companies.length > 0) {
    await upsertScannerRows(
      "wheel_market_batch_candidates",
      companies.map((company) => candidateRow(snapshotId, company)),
      "snapshot_id,symbol,strategy",
    );
  }
}

export async function publishMarketBatchSnapshot(
  snapshot: StagedMarketBatchSnapshot,
) {
  const startedAt = performance.now();
  const result = await requestSupabaseRest<{
    batch_id: string;
    snapshot_id: string;
    staged: boolean;
    status: "complete";
  }>("rpc/publish_wheel_market_batch_snapshot", {
    method: "POST",
    body: {
      p_candidate_count: snapshot.candidateCount,
      p_errors: snapshot.errors,
      p_screened_count: snapshot.screenedCount,
      p_skipped_count: snapshot.skippedCount,
      p_snapshot_id: snapshot.snapshotId,
      p_warnings: snapshot.warnings,
    },
  });

  if (!result) {
    throw new Error("Supabase did not return a publication result.");
  }

  return {
    ...result,
    durationMs: performance.now() - startedAt,
  };
}

export async function completeMarketBatch(
  batchId: string,
  expectedSnapshotCount: number,
) {
  return await requestSupabaseRest<{
    batch_id: string;
    pointer_count: number;
    snapshot_count: number;
    status: "complete";
  }>("rpc/complete_wheel_market_batch", {
    method: "POST",
    body: {
      p_batch_id: batchId,
      p_expected_snapshot_count: expectedSnapshotCount,
    },
  });
}

export async function failMarketBatch(batchId: string, error: unknown) {
  await requestSupabaseRest("rpc/fail_wheel_market_batch", {
    method: "POST",
    body: {
      p_batch_id: batchId,
      p_error: (
        error instanceof Error ? error.message : "Market batch failed."
      ).slice(0, 1000),
    },
  });
}

export async function pruneMarketBatchHistory(completedBefore: string) {
  return requestSupabaseRest<number>(
    "rpc/prune_wheel_market_batch_history",
    {
      method: "POST",
      body: {
        p_completed_before: completedBefore,
      },
    },
  );
}
