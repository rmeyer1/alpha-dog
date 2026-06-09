import {
  getHistoricalDailyBarsBySymbols,
  getLiveOptionSnapshotContracts,
  getStockSnapshotsBySymbols,
  getWheelAssetUniverse,
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
import { getPersona, mergeFilters } from "./personas";
import { scoreCandidate, scoreVerticalSpreadCandidate } from "./scoring";
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

const TECHNICAL_REFRESH_TTL_MS = 20 * 60 * 60 * 1000;
const DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE = 1000;

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
  }

  return cached;
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

function selectBestCandidate(
  rawContracts: RawOptionContract[],
  underlying: UnderlyingContext,
  personaId: WheelScreenerRequest["persona"],
  strategy: WheelCompanyStrategy,
  filters: WheelFilters,
) {
  const now = new Date();
  const persona = getPersona(personaId);
  const candidates = rawContracts
    .map((contract) => buildCandidate(contract, underlying, filters, now))
    .filter((candidate) => candidate != null)
    .map((candidate) =>
      scoreCandidate(candidate, persona, filters, underlying),
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
        .map((candidate) =>
          scoreVerticalSpreadCandidate(candidate, persona, filters, underlying),
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
    },
    prefer: "return=minimal",
    query: {
      id: `eq.${runId}`,
    },
  });
}

async function failUniverseScanRun(runId: string | null, error: unknown) {
  if (!runId) {
    return;
  }

  await requestSupabaseRest<null>("wheel_universe_scan_runs", {
    method: "PATCH",
    body: {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Universe scan failed.",
    },
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

function globalWarnings(feed: DataFeed): Warning[] {
  return feed === "indicative"
    ? [{
        type: "data_quality",
        severity: "warning",
        message:
          "Indicative options feed selected. Confirm OPRA access before relying on live quotes.",
      }]
    : [];
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
  const persona = getPersona(request.persona);
  const runId = await createUniverseScanRun({ ...request, strategy });

  try {
    const assets = await getWheelAssetUniverse();
    const snapshots = await getStockSnapshotsBySymbols(
      assets.map((asset) => asset.symbol),
      {
        chunkSize:
          env.WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE ??
          DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE,
        feed: "sip",
      },
    );
    const ranked = rankUnderlyingUniverse(assets, snapshots);
    const deepScan = await buildDeepScanUniverse(ranked, deepScanSize);

    await persistUniverseAssets(assets);
    await persistStockSnapshots(runId, ranked);

    const technicals = await ensureTechnicals(deepScan);
    const errors: string[] = [];
    const optionSnapshotRows: OptionMarketSnapshotRow[] = [];
    let skippedCount = ranked.length - deepScan.length;

    const scored = await mapWithConcurrency(
      deepScan,
      env.ALPACA_MARKET_DATA_MAX_CONCURRENCY,
      async (item): Promise<WheelCompanyScore | null> => {
        try {
          const underlying = rowToUnderlyingContext(
            item,
            technicals.get(item.asset.symbol),
          );
          const contracts = await getLiveOptionSnapshotContracts(
            item.asset.symbol,
            filters,
            strategy,
            item.price,
            feed,
          );

          optionSnapshotRows.push(
            ...optionMarketSnapshotRows(runId, item.asset.symbol, contracts),
          );

          const bestCandidate = selectBestCandidate(
            contracts,
            underlying,
            request.persona,
            strategy,
            filters,
          );

          if (!bestCandidate) {
            skippedCount += 1;

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
    await completeUniverseScanRun(runId, response);

    return response;
  } catch (error) {
    await failUniverseScanRun(runId, error);
    throw error;
  }
}
