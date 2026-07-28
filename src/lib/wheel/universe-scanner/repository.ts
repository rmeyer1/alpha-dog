import { getEnv } from "@/lib/env";
import { requestSupabaseRest } from "@/lib/supabase/rest";
import { mergeFilters } from "../personas";
import {
  heartbeatScannerLease,
  releaseScannerLease,
  type ScannerLease,
  upsertScannerRows,
  withDeadlockRetry,
} from "../scanner-concurrency";
import type {
  RawOptionContract,
  WheelCompanyScore,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "../types";
import { optionTypeForStrategy } from "./candidate-domain";
import type {
  DeepScanCheckpointRow,
  DeepScanContext,
  DeepScanCoverageRow,
  DeepScanRunSummary,
  KnownCandidateContractRow,
  OptionMarketSnapshotRow,
  RankedUnderlying,
  ReusableDeepScanRun,
  ScannerAsset,
  UnderlyingTechnicalRow,
  UniverseDeepScanCoverageResult,
  UniverseScanRunSummary,
} from "./model";

export async function getPreviousWinnerSymbols(limit: number) {
  if (limit <= 0) {
    return [];
  }

  const rows = await requestSupabaseRest<Array<{ symbol: string }>>(
    "wheel_option_candidates",
    {
      query: {
        select: "symbol",
        order: "score.desc,created_at.desc",
        limit,
      },
    },
  );

  return [...new Set((rows ?? []).map((row) => row.symbol))];
}

export async function getCachedTechnicals() {
  const rows = await requestSupabaseRest<UnderlyingTechnicalRow[]>(
    "wheel_underlying_technicals",
    {
      query: {
        select: "symbol,trend,rsi14,ma20,ma50,ma200,calculated_at",
        limit: 10000,
      },
    },
  );

  return new Map((rows ?? []).map((row) => [row.symbol, row]));
}

export async function upsertRows(
  table: string,
  rows: unknown[],
  onConflict: string,
) {
  await upsertScannerRows(table, rows, onConflict);
}

async function patchScannerRun(
  table: "wheel_universe_scan_runs" | "wheel_deep_scan_runs",
  body: Record<string, unknown>,
  runId: string,
) {
  await withDeadlockRetry(
    () =>
      requestSupabaseRest<null>(table, {
        method: "PATCH",
        body,
        prefer: "return=minimal",
        query: {
          id: `eq.${runId}`,
          status: "eq.running",
        },
      }),
    {
      onRetry: ({ attempt, delayMs }) => {
        console.warn("wheel_scanner_run_write_deadlock_retry", {
          attempt,
          delayMs,
          runId,
          table,
        });
      },
    },
  );
}

export async function persistUniverseAssets(assets: ScannerAsset[]) {
  await upsertRows(
    "wheel_underlying_universe",
    assets.map((asset) => ({
      symbol: asset.symbol,
      company_name: asset.name,
      exchange: asset.exchange,
      optionable: true,
      active: true,
      last_seen_at: new Date().toISOString(),
    })),
    "symbol",
  );
}

export async function persistStockSnapshots(
  runId: string | null,
  ranked: RankedUnderlying[],
) {
  await upsertRows(
    "wheel_underlying_snapshots",
    ranked.map((item) => ({
      symbol: item.asset.symbol,
      scan_run_id: runId,
      price: item.price,
      latest_trade_at: item.snapshot.latestTrade?.t ?? null,
      daily_volume: item.snapshot.dailyBar?.v ?? null,
      dollar_volume: item.dollarVolume,
      previous_close: item.snapshot.prevDailyBar?.c ?? null,
      pct_change: item.pctChange,
      snapshot: item.snapshot,
      captured_at: new Date().toISOString(),
    })),
    "symbol",
  );
}

export async function createUniverseScanRun(
  request: WheelScreenerRequest,
  lease: ScannerLease,
) {
  const rows = await requestSupabaseRest<Array<{ id: string }>>(
    "wheel_universe_scan_runs",
    {
      method: "POST",
      body: [
        {
          persona: request.persona,
          strategy: request.strategy,
          status: "running",
          filters: mergeFilters(request.persona, request.filters),
          deep_scan_size: getEnv().WHEEL_UNIVERSE_DEEP_SCAN_SIZE,
          heartbeat_at: new Date().toISOString(),
          lease_key: lease.leaseKey,
          lease_owner_id: lease.ownerId,
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

export async function heartbeatUniverseScanRun(
  runId: string | null,
  lease: ScannerLease,
) {
  await heartbeatScannerLease(lease);

  if (!runId) {
    return;
  }

  await patchScannerRun(
    "wheel_universe_scan_runs",
    { heartbeat_at: new Date().toISOString() },
    runId,
  );
}

export async function completeUniverseScanRun(
  runId: string | null,
  response: WheelScreenerResponse,
  summary: UniverseScanRunSummary,
) {
  if (!runId) {
    return;
  }

  await patchScannerRun(
    "wheel_universe_scan_runs",
    {
      status: "complete",
      completed_at: new Date().toISOString(),
      total_count: response.progress.totalCount,
      deep_scanned_count: response.progress.batchScreenedCount,
      scored_count: response.companies.length,
      error: response.errors[0] ?? null,
      summary,
    },
    runId,
  );
}

export async function failUniverseScanRun(
  runId: string | null,
  error: unknown,
  summary: UniverseScanRunSummary | null = null,
) {
  if (!runId) {
    return;
  }

  const body: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : "Universe scan failed.",
  };

  if (summary) {
    body.summary = summary;
  }

  await patchScannerRun("wheel_universe_scan_runs", body, runId);
}

export function optionMarketSnapshotRows(
  runId: string | null,
  symbol: string,
  contracts: RawOptionContract[],
) {
  const capturedAt = new Date().toISOString();

  return contracts.map(
    (contract): OptionMarketSnapshotRow => ({
      scan_run_id: runId,
      underlying_symbol: symbol,
      contract_symbol: contract.contractSymbol,
      option_type: contract.optionType,
      strike: contract.strike,
      expiration: contract.expirationDate,
      bid: contract.bid,
      ask: contract.ask,
      delta: contract.delta,
      theta: contract.theta,
      implied_volatility: contract.impliedVolatility,
      volume: contract.volume,
      open_interest: contract.openInterest,
      captured_at: capturedAt,
    }),
  );
}

export async function persistOptionMarketSnapshots(
  rows: OptionMarketSnapshotRow[],
) {
  await upsertRows("wheel_option_market_snapshots", rows, "contract_symbol");
}

export async function persistRankedCandidates(
  runId: string | null,
  companies: WheelCompanyScore[],
) {
  if (!runId || companies.length === 0) {
    return;
  }

  await upsertRows(
    "wheel_universe_ranked_candidates",
    companies.map((company) => ({
      scan_run_id: runId,
      rank: company.rank,
      symbol: company.ticker,
      company_name: company.name,
      exchange: company.exchange,
      score: company.score,
      strategy: company.bestCandidate.strategy,
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
      underlying_price: company.underlying.price,
      underlying_as_of: company.underlying.asOf,
      trend: company.underlying.trend,
      rsi14: company.underlying.rsi14,
      ma20: company.underlying.movingAverages.ma20,
      ma50: company.underlying.movingAverages.ma50,
      ma200: company.underlying.movingAverages.ma200,
      warnings: company.warnings,
      errors: company.errors,
    })),
    "scan_run_id,symbol,strategy",
  );
}

export async function getRecentCandidateRows(
  context: DeepScanContext,
  symbols: string[],
  minAsOf: string,
) {
  if (symbols.length === 0) {
    return [] as KnownCandidateContractRow[];
  }

  const inList = `in.(${symbols.map((value) => `"${value}"`).join(",")})`;

  return (
    (await requestSupabaseRest<KnownCandidateContractRow[]>(
      "wheel_deep_scan_candidates",
      {
        query: {
          select:
            "symbol,option_type,expiration,short_strike,long_strike,as_of",
          persona: `eq.${context.persona}`,
          strategy: `eq.${context.strategy}`,
          filter_key: `eq.${context.filterKey}`,
          symbol: inList,
          as_of: `gte.${minAsOf}`,
          order: "as_of.desc",
          limit: Math.max(symbols.length * 2, 100),
        },
      },
    )) ?? []
  );
}

export async function createDeepScanRun(
  context: DeepScanContext,
  batchSize: number,
  lease: ScannerLease,
) {
  const rows = await requestSupabaseRest<Array<{ id: string }>>(
    "wheel_deep_scan_runs",
    {
      method: "POST",
      body: [
        {
          persona: context.persona,
          strategy: context.strategy,
          filter_key: context.filterKey,
          filters: context.filters,
          status: "running",
          requested_batch_size: batchSize,
          heartbeat_at: new Date().toISOString(),
          lease_key: lease.leaseKey,
          lease_owner_id: lease.ownerId,
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

export async function heartbeatDeepScanRun(
  runId: string | null,
  lease: ScannerLease,
) {
  await heartbeatScannerLease(lease);

  if (!runId) {
    return;
  }

  await patchScannerRun(
    "wheel_deep_scan_runs",
    { heartbeat_at: new Date().toISOString() },
    runId,
  );
}

export async function completeDeepScanRun(
  runId: string | null,
  result: Pick<
    UniverseDeepScanCoverageResult,
    "candidateCount" | "errorCount" | "scannedCount" | "selectedCount"
  >,
  summary: DeepScanRunSummary,
) {
  if (!runId) {
    return;
  }

  await patchScannerRun(
    "wheel_deep_scan_runs",
    {
      status: "complete",
      completed_at: new Date().toISOString(),
      selected_count: result.selectedCount,
      scanned_count: result.scannedCount,
      candidate_count: result.candidateCount,
      error_count: result.errorCount,
      summary,
    },
    runId,
  );
}

export async function failDeepScanRun(
  runId: string | null,
  error: unknown,
  summary: DeepScanRunSummary | null = null,
) {
  if (!runId) {
    return;
  }

  const body: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : "Deep scan failed.",
  };

  if (summary) {
    body.summary = summary;
  }

  await patchScannerRun("wheel_deep_scan_runs", body, runId);
}

export async function checkpointDeepScanRun(
  runId: string | null,
  result: UniverseDeepScanCoverageResult,
  summary: DeepScanRunSummary,
) {
  if (!runId) {
    return;
  }

  await patchScannerRun(
    "wheel_deep_scan_runs",
    {
      heartbeat_at: new Date().toISOString(),
      workflow_result: result,
      summary,
    },
    runId,
  );
}

export async function getDeepScanCoverage(context: DeepScanContext) {
  const rows = await requestSupabaseRest<DeepScanCoverageRow[]>(
    "wheel_deep_scan_coverage",
    {
      query: {
        select:
          "symbol,status,last_scanned_at,option_contract_count,best_score,error",
        persona: `eq.${context.persona}`,
        strategy: `eq.${context.strategy}`,
        filter_key: `eq.${context.filterKey}`,
        limit: 10000,
      },
    },
  );

  return new Map((rows ?? []).map((row) => [row.symbol, row]));
}

export function deepScanCandidateRow(
  context: DeepScanContext,
  runId: string | null,
  company: WheelCompanyScore,
) {
  return {
    scan_run_id: runId,
    persona: context.persona,
    strategy: company.bestCandidate.strategy,
    filter_key: context.filterKey,
    symbol: company.ticker,
    company_name: company.name,
    exchange: company.exchange,
    score: company.score,
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
    as_of: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function upsertDeepScanCandidates(
  context: DeepScanContext,
  runId: string | null,
  companies: WheelCompanyScore[],
) {
  await upsertRows(
    "wheel_deep_scan_candidates",
    companies.map((company) => deepScanCandidateRow(context, runId, company)),
    "persona,strategy,filter_key,symbol",
  );
}

export async function deleteDeepScanCandidate(
  context: DeepScanContext,
  symbol: string,
) {
  await withDeadlockRetry(() =>
    requestSupabaseRest<null>("wheel_deep_scan_candidates", {
      method: "DELETE",
      prefer: "return=minimal",
      query: {
        persona: `eq.${context.persona}`,
        strategy: `eq.${context.strategy}`,
        filter_key: `eq.${context.filterKey}`,
        symbol: `eq.${symbol}`,
      },
    }),
  );
}

export async function upsertDeepScanCoverageRows(
  context: DeepScanContext,
  rows: Array<{
    bestScore: number | null;
    error: string | null;
    optionContractCount: number;
    runId: string | null;
    status: DeepScanCoverageRow["status"];
    symbol: string;
  }>,
) {
  const now = new Date().toISOString();

  await upsertRows(
    "wheel_deep_scan_coverage",
    rows.map((row) => ({
      symbol: row.symbol,
      persona: context.persona,
      strategy: context.strategy,
      filter_key: context.filterKey,
      status: row.status,
      scan_run_id: row.runId,
      last_scanned_at: now,
      option_contract_count: row.optionContractCount,
      best_score: row.bestScore,
      error: row.error,
      updated_at: now,
    })),
    "symbol,persona,strategy,filter_key",
  );
}

export async function getReusableDeepScanRun(lease: ScannerLease) {
  const rows = await requestSupabaseRest<ReusableDeepScanRun[]>(
    "wheel_deep_scan_runs",
    {
      query: {
        lease_key: `eq.${lease.leaseKey}`,
        lease_owner_id: `eq.${lease.ownerId}`,
        limit: 1,
        order: "started_at.desc",
        select: "id,workflow_result",
        status: "eq.running",
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function getDeepScanCheckpoint(runId: string) {
  const rows = await requestSupabaseRest<DeepScanCheckpointRow[]>(
    "wheel_deep_scan_runs",
    {
      query: {
        id: `eq.${runId}`,
        limit: 1,
        select: "status,summary,workflow_result,lease_key,lease_owner_id",
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function releaseDeepScanCheckpointLease(
  checkpoint: DeepScanCheckpointRow | null,
) {
  if (!checkpoint?.lease_key || !checkpoint.lease_owner_id) {
    return;
  }

  await releaseScannerLease({
    leaseKey: checkpoint.lease_key,
    ownerId: checkpoint.lease_owner_id,
  });
}
