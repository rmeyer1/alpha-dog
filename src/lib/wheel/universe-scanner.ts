import {
  getLiveOptionSnapshotContractsBySymbols,
  getHistoricalDailyBarsBySymbols,
  getLiveOptionSnapshotContracts,
  getStockSnapshotsBySymbols,
  getWheelAssetUniverse,
  type AlpacaExplicitOptionSnapshotMetadata,
  type AlpacaBar,
  type AlpacaStockSnapshot,
} from "@/lib/alpaca/client";
import { getEnv } from "@/lib/env";
import {
  getSupabaseServiceConfig,
  requestSupabaseRest,
} from "@/lib/supabase/rest";
import {
  buildCandidate,
  buildVerticalSpreads,
  round,
} from "./calculations";
import {
  emptyEarningsRiskContext,
  earningsProviderEnabled,
  getCachedEarningsRiskContexts,
  type EarningsRiskContext,
} from "./earnings";
import { getPersona, mergeFilters } from "./personas";
import {
  hasKnownEarningsBeforeExpiration,
  scoreCandidate,
  scoreVerticalSpreadCandidate,
} from "./scoring";
import type {
  DataFeed,
  OptionType,
  QualityLabel,
  RawOptionContract,
  Trend,
  UnderlyingContext,
  Warning,
  WheelCandidate,
  WheelCompanyCandidateSummary,
  WheelCompanyScore,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "./types";

interface ScannerAsset {
  symbol: string;
  name: string;
  exchange: "NYSE" | "NASDAQ";
}

interface UnderlyingTechnicalRow {
  calculated_at: string;
  ma20: number | string | null;
  ma50: number | string | null;
  ma200: number | string | null;
  rsi14: number | string | null;
  symbol: string;
  trend: Trend;
}

interface RankedUnderlying {
  asset: ScannerAsset;
  dollarVolume: number;
  pctChange: number | null;
  price: number;
  snapshot: AlpacaStockSnapshot;
  stockScore: number;
}

interface OptionMarketSnapshotRow {
  ask: number;
  bid: number;
  captured_at: string;
  contract_symbol: string;
  delta: number | null;
  expiration: string;
  implied_volatility: number | null;
  open_interest: number | null;
  option_type: OptionType;
  scan_run_id: string | null;
  strike: number;
  theta: number | null;
  underlying_symbol: string;
  volume: number | null;
}

interface KnownCandidateContractRow {
  as_of: string;
  expiration: string;
  long_strike: number | string | null;
  option_type: OptionType;
  short_strike: number | string;
  symbol: string;
}

interface DeepScanCoverageRow {
  best_score: number | null;
  error: string | null;
  last_scanned_at: string | null;
  option_contract_count: number;
  status: "pending" | "complete" | "failed" | "no_candidate";
  symbol: string;
}

interface DeepScanContext {
  filterKey: string;
  filters: WheelFilters;
  persona: WheelScreenerRequest["persona"];
  strategy: WheelCompanyStrategy;
}

interface CandidateContractRefreshRequest {
  feed: Exclude<DataFeed, "demo">;
  filters: WheelFilters;
  incrementalDiscovery: boolean;
  knownMetadata: AlpacaExplicitOptionSnapshotMetadata[] | undefined;
  price: number;
  strategy: WheelCompanyStrategy;
  symbol: string;
  updatedSince?: string;
}

interface TechnicalRefreshSummary {
  cachedFreshCount: number;
  refreshedCount: number;
  requestedCount: number;
}

interface ContractRefreshSummary {
  contractsMissingOpenInterest: number;
  contractsReturned: number;
  discoveryContractsReturned: number;
  fullDiscoveryRan: boolean;
  incrementalDiscoveryRan: boolean;
  knownContractsRequested: number;
  knownContractsReturned: number;
  symbol: string;
}

interface UniverseScanRunSummary {
  contracts: {
    contractsMissingOpenInterest: number;
    contractsReturned: number;
    discoveryContractsReturned: number;
    fullDiscoverySymbols: number;
    incrementalDiscoverySymbols: number;
    knownContractsRequested: number;
    knownContractsReturned: number;
    optionSnapshotRows: number;
    symbolsWithKnownContracts: number;
  };
  errors: {
    count: number;
    sample: string[];
  };
  scoring: {
    noCandidateCount: number;
    scoredCount: number;
    skippedCount: number;
  };
  technicals: TechnicalRefreshSummary;
  universe: {
    assetCount: number;
    deepScanSize: number;
    rankedCount: number;
    selectedDeepScanCount: number;
  };
}

interface DeepScanRunSummary {
  contracts: UniverseScanRunSummary["contracts"];
  coverage: {
    failedCount: number;
    noCandidateCount: number;
    updatedCount: number;
  };
  errors: UniverseScanRunSummary["errors"];
  selection: {
    batchSize: number;
    selectedCount: number;
    staleBefore: string;
    totalEligibleCount: number;
  };
  technicals: TechnicalRefreshSummary;
}

export interface UniverseDeepScanCoverageRequest {
  batchSize?: number;
  filters?: Partial<WheelFilters>;
  forceRefresh?: boolean;
  persona: WheelScreenerRequest["persona"];
  strategy: WheelCompanyStrategy;
}

export interface UniverseDeepScanCoverageResult {
  batchSize: number;
  candidateCount: number;
  errorCount: number;
  errors: string[];
  filterKey: string;
  persona: WheelScreenerRequest["persona"];
  runId: string | null;
  scannedCount: number;
  scannedSymbols: string[];
  selectedCount: number;
  skippedReason: string | null;
  staleBefore: string;
  strategy: WheelCompanyStrategy;
  totalEligibleCount: number;
}

const TECHNICAL_REFRESH_TTL_MS = 20 * 60 * 60 * 1000;
const DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE = 1000;

const emptyContractSummary = (): UniverseScanRunSummary["contracts"] => ({
  contractsMissingOpenInterest: 0,
  contractsReturned: 0,
  discoveryContractsReturned: 0,
  fullDiscoverySymbols: 0,
  incrementalDiscoverySymbols: 0,
  knownContractsRequested: 0,
  knownContractsReturned: 0,
  optionSnapshotRows: 0,
  symbolsWithKnownContracts: 0,
});

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
      `${JSON.stringify(key)}:${stableStringify(entryValue)}`
    )
    .join(",")}}`;
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
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

function parseNumber(value: number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(closes: number[], length: number) {
  if (closes.length < length) {
    return null;
  }

  return round(average(closes.slice(-length)) ?? 0, 2);
}

function rsi14(closes: number[]) {
  if (closes.length < 15) {
    return null;
  }

  const changes = closes.slice(-15).map((close, index, values) => {
    if (index === 0) {
      return 0;
    }

    return close - values[index - 1];
  }).slice(1);
  const gains = changes.map((change) => Math.max(change, 0));
  const losses = changes.map((change) => Math.abs(Math.min(change, 0)));
  const avgGain = average(gains) ?? 0;
  const avgLoss = average(losses) ?? 0;

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;

  return round(100 - 100 / (1 + rs), 1);
}

function classifyTrend(
  price: number,
  ma20: number | null,
  ma50: number | null,
  ma200: number | null,
): Trend {
  if (ma20 != null && ma50 != null && ma200 != null) {
    if (price > ma20 && ma20 > ma50 && price > ma200) {
      return "bullish";
    }

    if ((price < ma20 && ma20 < ma50) || price < ma200) {
      return "bearish";
    }
  }

  return "neutral";
}

function snapshotPrice(snapshot: AlpacaStockSnapshot) {
  return snapshot.latestTrade?.p ?? snapshot.dailyBar?.c ?? null;
}

function snapshotAsOf(snapshot: AlpacaStockSnapshot) {
  return (
    snapshot.latestTrade?.t ??
    snapshot.latestQuote?.t ??
    snapshot.minuteBar?.t ??
    snapshot.dailyBar?.t ??
    new Date().toISOString()
  );
}

function priceChange(snapshot: AlpacaStockSnapshot, price: number) {
  const previousClose = snapshot.prevDailyBar?.c;

  if (!previousClose || previousClose <= 0) {
    return null;
  }

  return (price - previousClose) / previousClose;
}

function stockScore(snapshot: AlpacaStockSnapshot, price: number) {
  const volume = snapshot.dailyBar?.v ?? snapshot.minuteBar?.v ?? 0;
  const dollarVolume = Math.max(0, volume * price);
  const volumeScore = Math.log10(Math.max(dollarVolume, 1));
  const change = Math.abs(priceChange(snapshot, price) ?? 0);

  return volumeScore * 20 + Math.min(change * 100, 20);
}

function rankUnderlyingUniverse(
  assets: ScannerAsset[],
  snapshots: Record<string, AlpacaStockSnapshot>,
) {
  return assets
    .map((asset): RankedUnderlying | null => {
      const snapshot = snapshots[asset.symbol];
      const price = snapshot ? snapshotPrice(snapshot) : null;
      const volume = snapshot?.dailyBar?.v ?? snapshot?.minuteBar?.v ?? 0;

      if (!snapshot || price == null || price < 5 || volume < 100_000) {
        return null;
      }

      return {
        asset,
        dollarVolume: volume * price,
        pctChange: priceChange(snapshot, price),
        price,
        snapshot,
        stockScore: stockScore(snapshot, price),
      };
    })
    .filter((asset) => asset != null)
    .sort((left, right) =>
      right.stockScore - left.stockScore ||
      left.asset.symbol.localeCompare(right.asset.symbol)
    );
}

function rotatingDiscoverySlice(
  ranked: RankedUnderlying[],
  size: number,
  now = new Date(),
) {
  if (ranked.length === 0 || size <= 0) {
    return [];
  }

  const sorted = [...ranked].sort((left, right) =>
    left.asset.symbol.localeCompare(right.asset.symbol)
  );
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  const start = (bucket * size) % sorted.length;

  return Array.from({ length: Math.min(size, sorted.length) }, (_, index) =>
    sorted[(start + index) % sorted.length]
  );
}

async function getPreviousWinnerSymbols(limit: number) {
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

async function buildDeepScanUniverse(
  ranked: RankedUnderlying[],
  deepScanSize: number,
) {
  const previousWinnerTarget = Math.floor(deepScanSize * 0.15);
  const rotationTarget = Math.floor(deepScanSize * 0.15);
  const primaryTarget = deepScanSize - previousWinnerTarget - rotationTarget;
  const bySymbol = new Map(ranked.map((asset) => [asset.asset.symbol, asset]));
  const selected = new Map<string, RankedUnderlying>();

  for (const item of ranked.slice(0, primaryTarget)) {
    selected.set(item.asset.symbol, item);
  }

  for (const symbol of await getPreviousWinnerSymbols(previousWinnerTarget * 2)) {
    const item = bySymbol.get(symbol);

    if (item && selected.size < primaryTarget + previousWinnerTarget) {
      selected.set(symbol, item);
    }
  }

  for (const item of rotatingDiscoverySlice(ranked, rotationTarget * 2)) {
    if (selected.size >= deepScanSize) {
      break;
    }

    selected.set(item.asset.symbol, item);
  }

  for (const item of ranked) {
    if (selected.size >= deepScanSize) {
      break;
    }

    selected.set(item.asset.symbol, item);
  }

  return Array.from(selected.values()).slice(0, deepScanSize);
}

function technicalFromBars(symbol: string, price: number, bars: AlpacaBar[]) {
  const closes = bars.map((bar) => bar.c).filter(Number.isFinite);
  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  return {
    symbol,
    calculated_at: new Date().toISOString(),
    last_bar_at: bars.at(-1)?.t ?? null,
    ma20,
    ma50,
    ma200,
    rsi14: rsi14(closes),
    trend: classifyTrend(price, ma20, ma50, ma200),
  };
}

async function getCachedTechnicals() {
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

function technicalIsFresh(row: UnderlyingTechnicalRow | undefined) {
  if (!row) {
    return false;
  }

  return Date.now() - new Date(row.calculated_at).getTime() <=
    TECHNICAL_REFRESH_TTL_MS;
}

async function upsertRows(table: string, rows: unknown[], onConflict: string) {
  for (const rowChunk of chunk(rows, 500)) {
    if (rowChunk.length === 0) {
      continue;
    }

    await requestSupabaseRest<null>(table, {
      method: "POST",
      body: rowChunk,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: {
        on_conflict: onConflict,
      },
    });
  }
}

async function persistUniverseAssets(assets: ScannerAsset[]) {
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

async function persistStockSnapshots(
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

async function ensureTechnicals(deepScan: RankedUnderlying[]) {
  const cached = await getCachedTechnicals();
  const stale = deepScan.filter(
    (item) => !technicalIsFresh(cached.get(item.asset.symbol)),
  );
  const summary: TechnicalRefreshSummary = {
    cachedFreshCount: deepScan.length - stale.length,
    refreshedCount: 0,
    requestedCount: deepScan.length,
  };

  if (stale.length > 0) {
    const barsBySymbol = await getHistoricalDailyBarsBySymbols(
      stale.map((item) => item.asset.symbol),
      {
        daysBack: 520,
        feed: "sip",
      },
    );
    const computed = stale
      .map((item) => {
        const bars = barsBySymbol[item.asset.symbol] ?? [];

        return bars.length > 0
          ? technicalFromBars(item.asset.symbol, item.price, bars)
          : null;
      })
      .filter((technical) => technical != null);

    await upsertRows(
      "wheel_underlying_technicals",
      computed,
      "symbol",
    );

    for (const row of computed) {
      cached.set(row.symbol, row);
    }

    summary.refreshedCount = computed.length;
  }

  return { cached, summary };
}

function rowToUnderlyingContext(
  item: RankedUnderlying,
  technical: UnderlyingTechnicalRow | undefined,
): UnderlyingContext {
  return {
    symbol: item.asset.symbol,
    price: item.price,
    asOf: snapshotAsOf(item.snapshot),
    trend: technical?.trend ?? "neutral",
    rsi14: parseNumber(technical?.rsi14),
    movingAverages: {
      ma20: parseNumber(technical?.ma20),
      ma50: parseNumber(technical?.ma50),
      ma200: parseNumber(technical?.ma200),
    },
  };
}

function optionTypeForStrategy(strategy: WheelCompanyStrategy): OptionType {
  return strategy === "short_put" || strategy === "put_credit_spread"
    ? "put"
    : "call";
}

function optionContractSymbol(
  underlyingSymbol: string,
  expiration: string,
  optionType: OptionType,
  strike: number,
) {
  if (!/^[A-Z0-9]+$/.test(underlyingSymbol)) {
    return null;
  }

  const compactDate = expiration.replaceAll("-", "").slice(2);
  const typeCode = optionType === "put" ? "P" : "C";
  const strikeCode = Math.round(strike * 1000).toString().padStart(8, "0");

  return `${underlyingSymbol}${compactDate}${typeCode}${strikeCode}`;
}

function knownCandidateMetadata(
  row: KnownCandidateContractRow,
): AlpacaExplicitOptionSnapshotMetadata[] {
  const strikes = [
    parseNumber(row.short_strike),
    parseNumber(row.long_strike),
  ].filter((strike) => strike != null);

  return strikes
    .map((strike) => {
      const contractSymbol = optionContractSymbol(
        row.symbol,
        row.expiration,
        row.option_type,
        strike,
      );

      return contractSymbol
        ? {
            contractSymbol,
            expirationDate: row.expiration,
            openInterest: null,
            optionType: row.option_type,
            strike,
          }
        : null;
    })
    .filter((metadata) => metadata != null);
}

function premiumReceivedFromCredit(credit: number | null | undefined) {
  return credit == null ? undefined : Math.round(credit * 10000) / 100;
}

function uniqueContracts(contracts: RawOptionContract[]) {
  return Array.from(
    new Map(contracts.map((contract) => [contract.contractSymbol, contract]))
      .values(),
  );
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
    premiumReceived: premiumReceivedFromCredit(candidate.midpoint),
    premiumYield: candidate.premiumYield,
    annualizedYield: candidate.annualizedYield,
    delta: candidate.delta,
    impliedVolatility: candidate.impliedVolatility,
    liquidityQuality: candidate.liquidityQuality,
    warningCount: candidate.warnings.length,
  };
}

function selectBestCandidate(
  rawContracts: RawOptionContract[],
  underlying: UnderlyingContext,
  personaId: WheelScreenerRequest["persona"],
  strategy: WheelCompanyStrategy,
  filters: WheelFilters,
  earningsContext: EarningsRiskContext,
) {
  const now = new Date();
  const persona = getPersona(personaId);
  const candidates = rawContracts
    .map((contract) => buildCandidate(contract, underlying, filters, now))
    .filter((candidate) => candidate != null)
    .filter((candidate) =>
      !filters.excludeEarnings ||
      !hasKnownEarningsBeforeExpiration(
        candidate.expirationDate,
        earningsContext,
        now,
      )
    )
    .map((candidate) =>
      scoreCandidate(
        candidate,
        persona,
        filters,
        underlying,
        earningsContext,
        now,
      ),
    );

  switch (strategy) {
    case "short_put":
    case "covered_call": {
      const best = candidates
        .filter((candidate) => candidate.optionType === optionTypeForStrategy(strategy))
        .sort((left, right) => right.score - left.score)[0];

      return best ? summarizeContractCandidate(strategy, best) : null;
    }
    case "put_credit_spread":
    case "call_credit_spread": {
      const optionType = optionTypeForStrategy(strategy);
      const spread = buildVerticalSpreads(
        rawContracts,
        underlying,
        filters,
        optionType,
        now,
      )
        .filter((candidate) =>
          !filters.excludeEarnings ||
          !hasKnownEarningsBeforeExpiration(
            candidate.expirationDate,
            earningsContext,
            now,
          )
        )
        .map((candidate) =>
          scoreVerticalSpreadCandidate(
            candidate,
            persona,
            filters,
            underlying,
            earningsContext,
            now,
          ),
        )
        .sort((left, right) => right.score - left.score)[0];

      return spread
        ? {
            strategy,
            score: spread.score,
            expirationDate: spread.expirationDate,
            dte: spread.dte,
            shortStrike: spread.shortLeg.strike,
            longStrike: spread.longLeg.strike,
            premiumReceived: premiumReceivedFromCredit(spread.netCredit),
            returnOnRisk: spread.returnOnRisk,
            annualizedReturnOnRisk: spread.annualizedReturnOnRisk,
            delta: spread.shortDelta,
            impliedVolatility: spread.impliedVolatility,
            liquidityQuality: spread.liquidityQuality,
            warningCount: spread.warnings.length,
          }
        : null;
    }
  }
}

async function createUniverseScanRun(request: WheelScreenerRequest) {
  const rows = await requestSupabaseRest<Array<{ id: string }>>(
    "wheel_universe_scan_runs",
    {
      method: "POST",
      body: [{
        persona: request.persona,
        strategy: request.strategy,
        status: "running",
        filters: mergeFilters(request.persona, request.filters),
        deep_scan_size: getEnv().WHEEL_UNIVERSE_DEEP_SCAN_SIZE,
      }],
      prefer: "return=representation",
      query: {
        select: "id",
      },
    },
  );

  return rows?.[0]?.id ?? null;
}

async function completeUniverseScanRun(
  runId: string | null,
  response: WheelScreenerResponse,
  summary: UniverseScanRunSummary,
) {
  if (!runId) {
    return;
  }

  await requestSupabaseRest<null>("wheel_universe_scan_runs", {
    method: "PATCH",
    body: {
      status: "complete",
      completed_at: new Date().toISOString(),
      total_count: response.progress.totalCount,
      deep_scanned_count: response.progress.batchScreenedCount,
      scored_count: response.companies.length,
      error: response.errors[0] ?? null,
      summary,
    },
    prefer: "return=minimal",
    query: {
      id: `eq.${runId}`,
    },
  });
}

async function failUniverseScanRun(
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

  await requestSupabaseRest<null>("wheel_universe_scan_runs", {
    method: "PATCH",
    body,
    prefer: "return=minimal",
    query: {
      id: `eq.${runId}`,
    },
  });
}

function optionMarketSnapshotRows(
  runId: string | null,
  symbol: string,
  contracts: RawOptionContract[],
) {
  const capturedAt = new Date().toISOString();

  return contracts.map((contract): OptionMarketSnapshotRow => ({
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
    }));
}

async function persistOptionMarketSnapshots(rows: OptionMarketSnapshotRow[]) {
  await upsertRows(
    "wheel_option_market_snapshots",
    rows,
    "contract_symbol",
  );
}

async function persistRankedCandidates(
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

function deepScanContext(
  request: UniverseDeepScanCoverageRequest,
): DeepScanContext {
  const strategy = request.strategy ?? "short_put";
  const filters = mergeFilters(request.persona, request.filters);

  return {
    filterKey: stableStringify(filters),
    filters,
    persona: request.persona,
    strategy,
  };
}

function supabaseInList(values: string[]) {
  return `in.(${values.map((value) => `"${value}"`).join(",")})`;
}

async function getRecentKnownCandidateContracts(
  context: DeepScanContext,
  symbols: string[],
) {
  if (symbols.length === 0) {
    return new Map<string, AlpacaExplicitOptionSnapshotMetadata[]>();
  }

  const maxAgeHours = getEnv().WHEEL_UNIVERSE_BACKGROUND_CANDIDATE_MAX_AGE_HOURS;
  const minAsOf = new Date(
    Date.now() - maxAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const rows = await requestSupabaseRest<KnownCandidateContractRow[]>(
    "wheel_deep_scan_candidates",
    {
      query: {
        select: "symbol,option_type,expiration,short_strike,long_strike,as_of",
        persona: `eq.${context.persona}`,
        strategy: `eq.${context.strategy}`,
        filter_key: `eq.${context.filterKey}`,
        symbol: supabaseInList(symbols),
        as_of: `gte.${minAsOf}`,
        order: "as_of.desc",
        limit: Math.max(symbols.length * 2, 100),
      },
    },
  );
  const bySymbol = new Map<string, AlpacaExplicitOptionSnapshotMetadata[]>();

  for (const row of rows ?? []) {
    const metadata = knownCandidateMetadata(row);

    if (metadata.length > 0 && !bySymbol.has(row.symbol)) {
      bySymbol.set(row.symbol, metadata);
    }
  }

  return bySymbol;
}

async function getFastRefreshedKnownContracts(
  metadata: AlpacaExplicitOptionSnapshotMetadata[] | undefined,
  feed: DataFeed,
) {
  if (!metadata || metadata.length === 0 || feed === "demo") {
    return [];
  }

  return await getLiveOptionSnapshotContractsBySymbols(metadata, feed);
}

async function discoverCandidateContracts(
  request: CandidateContractRefreshRequest,
  options: { updatedSince?: string } = {},
) {
  if (!options.updatedSince) {
    return await getLiveOptionSnapshotContracts(
      request.symbol,
      request.filters,
      request.strategy,
      request.price,
      request.feed,
    );
  }

  return await getLiveOptionSnapshotContracts(
    request.symbol,
    request.filters,
    request.strategy,
    request.price,
    request.feed,
    options,
  );
}

async function refreshKnownCandidateContracts(
  request: CandidateContractRefreshRequest,
) {
  return await getFastRefreshedKnownContracts(
    request.knownMetadata,
    request.feed,
  );
}

async function refreshCandidateContracts(
  request: CandidateContractRefreshRequest,
): Promise<{ contracts: RawOptionContract[]; summary: ContractRefreshSummary }> {
  const knownContracts = await refreshKnownCandidateContracts(request);
  const knownContractsRequested = request.knownMetadata?.length ?? 0;
  let discoveryContracts: RawOptionContract[] = [];
  let fullDiscoveryRan = false;
  let incrementalDiscoveryRan = false;

  if (knownContracts.length === 0) {
    fullDiscoveryRan = true;
    discoveryContracts = await discoverCandidateContracts(request);
  } else if (request.incrementalDiscovery && request.updatedSince) {
    incrementalDiscoveryRan = true;
    discoveryContracts = await discoverCandidateContracts(request, {
      updatedSince: request.updatedSince,
    });
  }

  const contracts = uniqueContracts([...knownContracts, ...discoveryContracts]);

  return {
    contracts,
    summary: {
      contractsMissingOpenInterest: contracts.filter((contract) =>
        contract.openInterest == null
      ).length,
      contractsReturned: contracts.length,
      discoveryContractsReturned: discoveryContracts.length,
      fullDiscoveryRan,
      incrementalDiscoveryRan,
      knownContractsRequested,
      knownContractsReturned: knownContracts.length,
      symbol: request.symbol,
    },
  };
}

function addContractRefreshSummary(
  target: UniverseScanRunSummary["contracts"],
  summary: ContractRefreshSummary,
) {
  target.contractsMissingOpenInterest += summary.contractsMissingOpenInterest;
  target.contractsReturned += summary.contractsReturned;
  target.discoveryContractsReturned += summary.discoveryContractsReturned;
  target.knownContractsRequested += summary.knownContractsRequested;
  target.knownContractsReturned += summary.knownContractsReturned;

  if (summary.fullDiscoveryRan) {
    target.fullDiscoverySymbols += 1;
  }

  if (summary.incrementalDiscoveryRan) {
    target.incrementalDiscoverySymbols += 1;
  }

  if (summary.knownContractsRequested > 0) {
    target.symbolsWithKnownContracts += 1;
  }
}

async function createDeepScanRun(
  context: DeepScanContext,
  batchSize: number,
) {
  const rows = await requestSupabaseRest<Array<{ id: string }>>(
    "wheel_deep_scan_runs",
    {
      method: "POST",
      body: [{
        persona: context.persona,
        strategy: context.strategy,
        filter_key: context.filterKey,
        filters: context.filters,
        status: "running",
        requested_batch_size: batchSize,
      }],
      prefer: "return=representation",
      query: {
        select: "id",
      },
    },
  );

  return rows?.[0]?.id ?? null;
}

async function completeDeepScanRun(
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

  await requestSupabaseRest<null>("wheel_deep_scan_runs", {
    method: "PATCH",
    body: {
      status: "complete",
      completed_at: new Date().toISOString(),
      selected_count: result.selectedCount,
      scanned_count: result.scannedCount,
      candidate_count: result.candidateCount,
      error_count: result.errorCount,
      summary,
    },
    prefer: "return=minimal",
    query: {
      id: `eq.${runId}`,
    },
  });
}

async function failDeepScanRun(
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

  await requestSupabaseRest<null>("wheel_deep_scan_runs", {
    method: "PATCH",
    body,
    prefer: "return=minimal",
    query: {
      id: `eq.${runId}`,
    },
  });
}

async function getDeepScanCoverage(context: DeepScanContext) {
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

function coverageLastScannedMs(row: DeepScanCoverageRow | undefined) {
  if (!row?.last_scanned_at) {
    return 0;
  }

  const parsed = new Date(row.last_scanned_at).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

function selectDeepScanCoverageBatch(
  ranked: RankedUnderlying[],
  coverage: Map<string, DeepScanCoverageRow>,
  batchSize: number,
  staleBeforeMs: number,
  forceRefresh: boolean,
) {
  return ranked
    .filter((item) => {
      if (forceRefresh) {
        return true;
      }

      const row = coverage.get(item.asset.symbol);

      return !row || coverageLastScannedMs(row) < staleBeforeMs;
    })
    .sort((left, right) => {
      const leftCoverage = coverage.get(left.asset.symbol);
      const rightCoverage = coverage.get(right.asset.symbol);
      const leftNeverScanned = leftCoverage?.last_scanned_at ? 0 : 1;
      const rightNeverScanned = rightCoverage?.last_scanned_at ? 0 : 1;

      if (leftNeverScanned !== rightNeverScanned) {
        return rightNeverScanned - leftNeverScanned;
      }

      const scannedDiff =
        coverageLastScannedMs(leftCoverage) -
        coverageLastScannedMs(rightCoverage);

      return scannedDiff ||
        right.stockScore - left.stockScore ||
        left.asset.symbol.localeCompare(right.asset.symbol);
    })
    .slice(0, batchSize);
}

function deepScanCandidateRow(
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

async function upsertDeepScanCandidates(
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

async function deleteDeepScanCandidate(
  context: DeepScanContext,
  symbol: string,
) {
  await requestSupabaseRest<null>("wheel_deep_scan_candidates", {
    method: "DELETE",
    prefer: "return=minimal",
    query: {
      persona: `eq.${context.persona}`,
      strategy: `eq.${context.strategy}`,
      filter_key: `eq.${context.filterKey}`,
      symbol: `eq.${symbol}`,
    },
  });
}

async function upsertDeepScanCoverageRows(
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

function globalWarnings(feed: DataFeed): Warning[] {
  const warnings: Warning[] = [];

  if (feed === "indicative") {
    warnings.push({
        type: "data_quality",
        severity: "warning",
        message:
          "Indicative options feed selected. Confirm OPRA access before relying on live quotes.",
      });
  }

  if (!earningsProviderEnabled()) {
    warnings.push({
      type: "earnings",
      severity: "info",
      message: "Earnings provider is disabled. Verify earnings before trading.",
    });
  }

  return warnings;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

export async function analyzeStagedUniverseWheelCompanies(
  request: WheelScreenerRequest,
): Promise<WheelScreenerResponse> {
  if (!getSupabaseServiceConfig()) {
    throw new Error(
      "Alpha Dog Supabase service-role configuration is required for live universe scans.",
    );
  }

  const env = getEnv();
  const now = new Date();
  const strategy = request.strategy ?? "short_put";
  const filters = mergeFilters(request.persona, request.filters);
  const limit = request.limit ?? 50;
  const deepScanSize = env.WHEEL_UNIVERSE_DEEP_SCAN_SIZE;
  const feed = env.ALPACA_OPTIONS_FEED;
  const context = {
    filterKey: stableStringify(filters),
    filters,
    persona: request.persona,
    strategy,
  };
  const persona = getPersona(request.persona);
  const runId = await createUniverseScanRun({ ...request, strategy });
  let summary: UniverseScanRunSummary | null = null;

  try {
    const assets = await getWheelAssetUniverse();
    const snapshots = await getStockSnapshotsBySymbols(
      assets.map((asset) => asset.symbol),
      {
        chunkSize:
          env.WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE ??
          DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE,
        feed: env.ALPACA_STOCK_FEED,
      },
    );
    const ranked = rankUnderlyingUniverse(assets, snapshots);
    const deepScan = await buildDeepScanUniverse(ranked, deepScanSize);

    await persistUniverseAssets(assets);
    await persistStockSnapshots(runId, ranked);

    const { cached: technicals, summary: technicalSummary } =
      await ensureTechnicals(deepScan);
    const earningsContexts = await getCachedEarningsRiskContexts(
      deepScan.map((item) => item.asset.symbol),
      now,
    );
    const knownCandidateContracts = await getRecentKnownCandidateContracts(
      context,
      deepScan.map((item) => item.asset.symbol),
    );
    const errors: string[] = [];
    const optionSnapshotRows: OptionMarketSnapshotRow[] = [];
    let skippedCount = ranked.length - deepScan.length;
    let noCandidateCount = 0;
    summary = {
      contracts: emptyContractSummary(),
      errors: {
        count: 0,
        sample: [],
      },
      scoring: {
        noCandidateCount: 0,
        scoredCount: 0,
        skippedCount,
      },
      technicals: technicalSummary,
      universe: {
        assetCount: assets.length,
        deepScanSize,
        rankedCount: ranked.length,
        selectedDeepScanCount: deepScan.length,
      },
    };
    const runSummary = summary;

    const scored = await mapWithConcurrency(
      deepScan,
      env.ALPACA_MARKET_DATA_MAX_CONCURRENCY,
      async (item): Promise<WheelCompanyScore | null> => {
        try {
          const underlying = rowToUnderlyingContext(
            item,
            technicals.get(item.asset.symbol),
          );
          const { contracts, summary: contractSummary } =
            await refreshCandidateContracts(
              {
                feed,
                filters,
                incrementalDiscovery: false,
                knownMetadata: knownCandidateContracts.get(item.asset.symbol),
                price: item.price,
                strategy,
                symbol: item.asset.symbol,
              },
            );
          addContractRefreshSummary(runSummary.contracts, contractSummary);

          optionSnapshotRows.push(
            ...optionMarketSnapshotRows(runId, item.asset.symbol, contracts),
          );

          const bestCandidate = selectBestCandidate(
            contracts,
            underlying,
            request.persona,
            strategy,
            filters,
            earningsContexts.get(item.asset.symbol) ??
              emptyEarningsRiskContext(item.asset.symbol),
          );

          if (!bestCandidate) {
            skippedCount += 1;
            noCandidateCount += 1;

            return null;
          }

          return {
            rank: 0,
            ticker: item.asset.symbol,
            name: item.asset.name,
            exchange: item.asset.exchange,
            score: bestCandidate.score,
            underlying,
            bestCandidate: {
              ...bestCandidate,
              liquidityQuality:
                bestCandidate.liquidityQuality as QualityLabel,
            },
            warnings: [],
            errors: [],
          };
        } catch (error) {
          skippedCount += 1;

          if (errors.length < 25) {
            errors.push(
              `${item.asset.symbol}: ${
                error instanceof Error ? error.message : "Analysis failed."
              }`,
            );
          }

          return null;
        }
      },
    );
    const companies = scored
      .filter((company) => company != null)
      .sort((left, right) =>
        right.score - left.score || left.ticker.localeCompare(right.ticker)
      )
      .slice(0, limit)
      .map((company, index) => ({
        ...company,
        rank: index + 1,
      }));
    runSummary.contracts.optionSnapshotRows = optionSnapshotRows.length;
    runSummary.errors = {
      count: errors.length,
      sample: errors.slice(0, 5),
    };
    runSummary.scoring = {
      noCandidateCount,
      scoredCount: companies.length,
      skippedCount,
    };
    const response: WheelScreenerResponse = {
      persona: {
        id: persona.id,
        name: persona.name,
        motto: persona.motto,
      },
      dataFreshness: {
        feed,
        cacheStatus: "fresh",
        asOf: now.toISOString(),
        nextSuggestedRefreshAt: addMinutes(now, 15),
      },
      companies,
      screenedCount: ranked.length,
      skippedCount,
      progress: {
        status: "complete",
        resultScope: "complete",
        cursor: 0,
        nextCursor: null,
        batchSize: deepScan.length,
        batchScreenedCount: deepScan.length,
        processedCount: ranked.length,
        totalCount: ranked.length,
      },
      warnings: globalWarnings(feed),
      errors,
    };

    await persistOptionMarketSnapshots(optionSnapshotRows);
    await persistRankedCandidates(runId, companies);
    await completeUniverseScanRun(runId, response, runSummary);

    return response;
  } catch (error) {
    await failUniverseScanRun(runId, error, summary);
    throw error;
  }
}

export async function runUniverseDeepScanCoverage(
  request: UniverseDeepScanCoverageRequest,
): Promise<UniverseDeepScanCoverageResult> {
  if (!getSupabaseServiceConfig()) {
    throw new Error(
      "Alpha Dog Supabase service-role configuration is required for background universe deep scans.",
    );
  }

  const env = getEnv();
  const context = deepScanContext(request);
  const batchSize = request.batchSize ??
    env.WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE;
  const staleBeforeMs =
    Date.now() -
    env.WHEEL_UNIVERSE_BACKGROUND_COVERAGE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const staleBefore = new Date(staleBeforeMs).toISOString();
  const runId = await createDeepScanRun(context, batchSize);
  let summary: DeepScanRunSummary | null = null;

  try {
    const assets = await getWheelAssetUniverse();
    const snapshots = await getStockSnapshotsBySymbols(
      assets.map((asset) => asset.symbol),
      {
        chunkSize:
          env.WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE ??
          DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE,
        feed: env.ALPACA_STOCK_FEED,
      },
    );
    const ranked = rankUnderlyingUniverse(assets, snapshots);

    await persistUniverseAssets(assets);
    await persistStockSnapshots(null, ranked);

    const coverage = await getDeepScanCoverage(context);
    const selected = selectDeepScanCoverageBatch(
      ranked,
      coverage,
      batchSize,
      staleBeforeMs,
      request.forceRefresh === true,
    );
    summary = {
      contracts: emptyContractSummary(),
      coverage: {
        failedCount: 0,
        noCandidateCount: 0,
        updatedCount: 0,
      },
      errors: {
        count: 0,
        sample: [],
      },
      selection: {
        batchSize,
        selectedCount: selected.length,
        staleBefore,
        totalEligibleCount: ranked.length,
      },
      technicals: {
        cachedFreshCount: 0,
        refreshedCount: 0,
        requestedCount: 0,
      },
    };
    const runSummary = summary;

    if (selected.length === 0) {
      const result: UniverseDeepScanCoverageResult = {
        batchSize,
        candidateCount: 0,
        errorCount: 0,
        errors: [],
        filterKey: context.filterKey,
        persona: context.persona,
        runId,
        scannedCount: 0,
        scannedSymbols: [],
        selectedCount: 0,
        skippedReason:
          "No eligible symbols are due for background deep scan coverage.",
        staleBefore,
        strategy: context.strategy,
        totalEligibleCount: ranked.length,
      };

      await completeDeepScanRun(runId, result, runSummary);

      return result;
    }

    const { cached: technicals, summary: technicalSummary } =
      await ensureTechnicals(selected);
    runSummary.technicals = technicalSummary;
    const earningsContexts = await getCachedEarningsRiskContexts(
      selected.map((item) => item.asset.symbol),
    );
    const knownCandidateContracts = await getRecentKnownCandidateContracts(
      context,
      selected.map((item) => item.asset.symbol),
    );
    const optionSnapshotRows: OptionMarketSnapshotRow[] = [];
    const companies: WheelCompanyScore[] = [];
    const coverageRows: Parameters<typeof upsertDeepScanCoverageRows>[1] = [];
    const errors: string[] = [];

    await mapWithConcurrency(
      selected,
      env.ALPACA_MARKET_DATA_MAX_CONCURRENCY,
      async (item) => {
        let contractCount = 0;

        try {
          const underlying = rowToUnderlyingContext(
            item,
            technicals.get(item.asset.symbol),
          );
          const coverageRow = coverage.get(item.asset.symbol);
          const updatedSince = coverageRow?.last_scanned_at ?? undefined;
          const { contracts, summary: contractSummary } =
            await refreshCandidateContracts({
              feed: env.ALPACA_OPTIONS_FEED,
              filters: context.filters,
              incrementalDiscovery: true,
              knownMetadata: knownCandidateContracts.get(item.asset.symbol),
              price: item.price,
              strategy: context.strategy,
              symbol: item.asset.symbol,
              updatedSince,
            });
          addContractRefreshSummary(runSummary.contracts, contractSummary);

          contractCount = contracts.length;
          optionSnapshotRows.push(
            ...optionMarketSnapshotRows(null, item.asset.symbol, contracts),
          );

          const bestCandidate = selectBestCandidate(
            contracts,
            underlying,
            context.persona,
            context.strategy,
            context.filters,
            earningsContexts.get(item.asset.symbol) ??
              emptyEarningsRiskContext(item.asset.symbol),
          );

          if (!bestCandidate) {
            await deleteDeepScanCandidate(context, item.asset.symbol);
            runSummary.coverage.noCandidateCount += 1;
            coverageRows.push({
              bestScore: null,
              error: null,
              optionContractCount: contractCount,
              runId,
              status: "no_candidate",
              symbol: item.asset.symbol,
            });

            return;
          }

          const company: WheelCompanyScore = {
            rank: 0,
            ticker: item.asset.symbol,
            name: item.asset.name,
            exchange: item.asset.exchange,
            score: bestCandidate.score,
            underlying,
            bestCandidate: {
              ...bestCandidate,
              liquidityQuality:
                bestCandidate.liquidityQuality as QualityLabel,
            },
            warnings: [],
            errors: [],
          };

          companies.push(company);
          runSummary.coverage.updatedCount += 1;
          coverageRows.push({
            bestScore: company.score,
            error: null,
            optionContractCount: contractCount,
            runId,
            status: "complete",
            symbol: item.asset.symbol,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Deep scan failed.";

          await deleteDeepScanCandidate(context, item.asset.symbol);
          runSummary.coverage.failedCount += 1;
          coverageRows.push({
            bestScore: null,
            error: message,
            optionContractCount: contractCount,
            runId,
            status: "failed",
            symbol: item.asset.symbol,
          });

          if (errors.length < 25) {
            errors.push(`${item.asset.symbol}: ${message}`);
          }
        }
      },
    );

    const rankedCompanies = companies
      .sort((left, right) =>
        right.score - left.score || left.ticker.localeCompare(right.ticker)
      )
      .map((company, index) => ({
        ...company,
        rank: index + 1,
      }));

    await persistOptionMarketSnapshots(optionSnapshotRows);
    await upsertDeepScanCandidates(context, runId, rankedCompanies);
    await upsertDeepScanCoverageRows(context, coverageRows);
    runSummary.contracts.optionSnapshotRows = optionSnapshotRows.length;
    runSummary.errors = {
      count: errors.length,
      sample: errors.slice(0, 5),
    };

    const result: UniverseDeepScanCoverageResult = {
      batchSize,
      candidateCount: rankedCompanies.length,
      errorCount: errors.length,
      errors,
      filterKey: context.filterKey,
      persona: context.persona,
      runId,
      scannedCount: selected.length,
      scannedSymbols: selected.map((item) => item.asset.symbol),
      selectedCount: selected.length,
      skippedReason: null,
      staleBefore,
      strategy: context.strategy,
      totalEligibleCount: ranked.length,
    };

    await completeDeepScanRun(runId, result, runSummary);

    return result;
  } catch (error) {
    await failDeepScanRun(runId, error, summary);
    throw error;
  }
}
