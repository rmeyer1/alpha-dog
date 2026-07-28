import {
  getStockSnapshotsBySymbols,
  getWheelAssetUniverse,
} from "@/lib/alpaca/client";
import { getEnv } from "@/lib/env";
import { emitTelemetry } from "@/lib/observability/telemetry";
import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import {
  emptyEarningsRiskContext,
  getCachedEarningsRiskContexts,
} from "../earnings";
import type {
  OptionType,
  WheelFilters,
  WheelScreenerRequest,
} from "../types";
import {
  buildDeepScanUniverse,
  ensureTechnicals,
  refreshCandidateContracts,
} from "../universe-scanner/market-service";
import {
  DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE,
  rankUnderlyingUniverse,
} from "../universe-scanner/domain";
import {
  buildSharedDiscoveryFilters,
  marketBatchKey,
  marketBatchRequestIdentity,
  scoreMarketBatchConsumer,
} from "./domain";
import {
  compareScannerCandidates,
  legacyScannerParitySurface,
  scoreLegacyScannerFromMarketBatch,
} from "../scanner-parity";
import type {
  MarketBatchIngestionSummary,
  MarketBatchMetric,
  MarketBatchOptionRow,
  MarketBatchOptionStageSummary,
  ScoredMarketBatchConsumer,
  ScoredMarketBatchConsumerProjections,
  MarketBatchUnderlyingRow,
  MarketBatchUnderlyingStageSummary,
  StagedMarketBatchSnapshot,
} from "./model";
import {
  checkpointMarketBatchOptionIngestion,
  checkpointMarketBatchUnderlyings,
  completeMarketBatch,
  completeMarketBatchFacts,
  createMarketBatch,
  createMarketBatchSnapshot,
  failMarketBatch,
  getMarketBatch,
  getMarketBatchOptionIngestion,
  persistMarketBatchOptions,
  persistMarketBatchUnderlyings,
  publishMarketBatchSnapshot,
  readMarketBatchOptions,
  readMarketBatchUnderlying,
  readMarketBatchUnderlyings,
  readScannerAssetsBySymbols,
  recordMarketBatchParityObservation,
  replaceMarketBatchSnapshotCandidates,
  upsertMarketBatchMetrics,
} from "./repository";

function metric(
  operation: MarketBatchMetric["operation"],
  {
    databaseRowsWritten = 0,
    durationMs,
    providerRequests = 0,
  }: {
    databaseRowsWritten?: number;
    durationMs: number;
    providerRequests?: number;
  },
): MarketBatchMetric {
  return {
    databaseRowsWritten,
    durationMs,
    operation,
    phase: "ingestion",
    providerRequests,
  };
}

function elapsed(startedAt: number) {
  return Math.max(0, performance.now() - startedAt);
}

function storedUnderlyingMetrics(
  batch: Awaited<ReturnType<typeof getMarketBatch>>,
) {
  const underlyings = batch?.summary.underlyings;

  if (
    !underlyings ||
    typeof underlyings !== "object" ||
    !("metrics" in underlyings) ||
    !Array.isArray(underlyings.metrics)
  ) {
    return [] as MarketBatchMetric[];
  }

  return underlyings.metrics as MarketBatchMetric[];
}

function storedMissingSymbols(
  batch: Awaited<ReturnType<typeof getMarketBatch>>,
) {
  const underlyings = batch?.summary.underlyings;

  if (
    !underlyings ||
    typeof underlyings !== "object" ||
    !("missingSymbols" in underlyings) ||
    !Array.isArray(underlyings.missingSymbols)
  ) {
    return [] as string[];
  }

  return underlyings.missingSymbols.filter(
    (symbol): symbol is string => typeof symbol === "string",
  );
}

export async function prepareSharedMarketBatch({
  batchKey,
  feed,
  intervalStartedAt,
}: {
  batchKey?: string;
  feed: "opra" | "indicative";
  intervalStartedAt: string;
}) {
  return createMarketBatch({
    batchKey: batchKey ?? marketBatchKey(intervalStartedAt, feed),
    feed,
    intervalStartedAt,
  });
}

export async function stageSharedMarketBatchUnderlyings(
  batchId: string,
  requestedSymbols?: string[],
): Promise<MarketBatchUnderlyingStageSummary> {
  const existingBatch = await getMarketBatch(batchId);

  if (!existingBatch) {
    throw new Error("Wheel market batch was not found.");
  }

  if (existingBatch.status === "failed") {
    throw new Error("Wheel market batch has already failed.");
  }

  if (existingBatch.underlyings_completed_at) {
    const rows = await readMarketBatchUnderlyings(batchId);
    const selectedSymbols = rows
      .filter((row) => row.selected_for_scoring)
      .map((row) => row.symbol);

    return {
      assetCount: existingBatch.asset_count,
      metrics: storedUnderlyingMetrics(existingBatch),
      missingSymbols: storedMissingSymbols(existingBatch),
      rankedCount: existingBatch.ranked_count,
      selectedCount: existingBatch.selected_count,
      selectedSymbols,
    };
  }

  const env = getEnv();
  const assetStartedAt = performance.now();
  const normalizedRequestedSymbols = requestedSymbols == null
    ? null
    : Array.from(
        new Set(
          requestedSymbols
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean),
        ),
      );
  const assets = normalizedRequestedSymbols == null
    ? await getWheelAssetUniverse()
    : await readScannerAssetsBySymbols(normalizedRequestedSymbols);
  const assetDurationMs = elapsed(assetStartedAt);
  const snapshotChunkSize =
    env.WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE ??
    DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE;
  const stockStartedAt = performance.now();
  const snapshots = await getStockSnapshotsBySymbols(
    assets.map((asset) => asset.symbol),
    {
      chunkSize: snapshotChunkSize,
      feed: env.ALPACA_STOCK_FEED,
    },
  );
  const stockDurationMs = elapsed(stockStartedAt);
  const ranked = rankUnderlyingUniverse(assets, snapshots);
  const requestedSet = normalizedRequestedSymbols == null
    ? null
    : new Set(normalizedRequestedSymbols);
  const deepScan = requestedSet == null
    ? await buildDeepScanUniverse(
        ranked,
        env.WHEEL_UNIVERSE_DEEP_SCAN_SIZE,
      )
    : ranked.filter((item) => requestedSet.has(item.asset.symbol));
  const selectedSymbols = deepScan.map((item) => item.asset.symbol);
  const selectedSet = new Set(selectedSymbols);
  const missingSymbols = normalizedRequestedSymbols?.filter(
    (symbol) => !selectedSet.has(symbol),
  ) ?? [];
  const technicalStartedAt = performance.now();
  const { cached: technicals, summary: technicalSummary } =
    await ensureTechnicals(deepScan);
  const technicalDurationMs = elapsed(technicalStartedAt);
  const earningsStartedAt = performance.now();
  const earnings = await getCachedEarningsRiskContexts(
    selectedSymbols,
    new Date(existingBatch.interval_started_at),
  );
  const earningsDurationMs = elapsed(earningsStartedAt);
  const capturedAt = new Date().toISOString();
  const rows = ranked.map(
    (item, index): MarketBatchUnderlyingRow => {
      const technical = technicals.get(item.asset.symbol);
      const earningsContext =
        earnings.get(item.asset.symbol) ??
        emptyEarningsRiskContext(item.asset.symbol);

      return {
        batch_id: batchId,
        captured_at: capturedAt,
        company_name: item.asset.name,
        daily_volume: item.snapshot.dailyBar?.v ?? null,
        dollar_volume: item.dollarVolume,
        earnings_as_of: earningsContext.asOf,
        earnings_context: earningsContext,
        exchange: item.asset.exchange,
        latest_trade_at: item.snapshot.latestTrade?.t ?? null,
        ma20: technical?.ma20 ?? null,
        ma50: technical?.ma50 ?? null,
        ma200: technical?.ma200 ?? null,
        pct_change: item.pctChange,
        previous_close: item.snapshot.prevDailyBar?.c ?? null,
        price: item.price,
        rsi14: technical?.rsi14 ?? null,
        selected_for_scoring: selectedSet.has(item.asset.symbol),
        stock_score: item.stockScore,
        stock_snapshot: item.snapshot as unknown as Record<string, unknown>,
        symbol: item.asset.symbol,
        technical_as_of: technical?.calculated_at ?? null,
        trend: technical?.trend ?? "neutral",
        universe_rank: index + 1,
      };
    },
  );
  const metrics = [
    metric("asset_universe", {
      durationMs: assetDurationMs,
      providerRequests: normalizedRequestedSymbols == null ? 1 : 0,
    }),
    metric("stock_snapshots", {
      databaseRowsWritten: rows.length,
      durationMs: stockDurationMs,
      providerRequests:
        assets.length === 0 ? 0 : Math.ceil(assets.length / snapshotChunkSize),
    }),
    metric("technical_bars", {
      databaseRowsWritten: technicalSummary.refreshedCount,
      durationMs: technicalDurationMs,
      providerRequests: technicalSummary.refreshedCount > 0 ? 1 : 0,
    }),
    metric("earnings", {
      durationMs: earningsDurationMs,
      providerRequests: 0,
    }),
  ];

  await persistMarketBatchUnderlyings(rows);
  const summary = {
    assetCount: assets.length,
    metrics,
    missingSymbols,
    rankedCount: ranked.length,
    selectedCount: deepScan.length,
    selectedSymbols,
  };
  await checkpointMarketBatchUnderlyings(batchId, summary);

  return summary;
}

export async function stageSharedMarketBatchOptions({
  batchId,
  filters,
  optionType,
  symbol,
}: {
  batchId: string;
  filters: WheelFilters;
  optionType: OptionType;
  symbol: string;
}): Promise<MarketBatchOptionStageSummary> {
  const checkpoint = await getMarketBatchOptionIngestion(
    batchId,
    symbol,
    optionType,
  );

  if (checkpoint) {
    return {
      contractCount: checkpoint.contract_count,
      durationMs: Number(checkpoint.duration_ms),
      error: checkpoint.error,
      optionType,
      providerRequests: 1,
      symbol,
    };
  }

  const underlying = await readMarketBatchUnderlying(batchId, symbol);

  if (!underlying?.selected_for_scoring) {
    throw new Error(
      `Market batch ${batchId} has no selected underlying ${symbol}.`,
    );
  }

  const price = Number(underlying.price);
  const batch = await getMarketBatch(batchId);

  if (!batch || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Market batch ${symbol} has invalid persisted facts.`);
  }

  const startedAt = performance.now();

  let contracts: Awaited<
    ReturnType<typeof refreshCandidateContracts>
  >["contracts"];

  try {
    ({ contracts } = await refreshCandidateContracts({
      feed: batch.feed,
      filters,
      incrementalDiscovery: false,
      knownMetadata: undefined,
      price,
      strategy: optionType === "put" ? "short_put" : "covered_call",
      symbol,
    }));
  } catch (error) {
    const message = `${symbol} ${optionType}: ${
      error instanceof Error ? error.message : "option discovery failed"
    }`.slice(0, 1000);
    const summary = {
      contractCount: 0,
      durationMs: elapsed(startedAt),
      error: message,
      optionType,
      providerRequests: 1,
      symbol,
    };
    await checkpointMarketBatchOptionIngestion(batchId, summary);

    return summary;
  }

  const capturedAt = new Date().toISOString();
  const rows = contracts.map(
    (contract): MarketBatchOptionRow => ({
      ask: contract.ask,
      batch_id: batchId,
      bid: contract.bid,
      captured_at: capturedAt,
      contract_symbol: contract.contractSymbol,
      delta: contract.delta,
      expiration: contract.expirationDate,
      implied_volatility: contract.impliedVolatility,
      open_interest: contract.openInterest,
      option_type: contract.optionType,
      strike: contract.strike,
      theta: contract.theta,
      underlying_symbol: symbol,
      volume: contract.volume,
    }),
  );

  await persistMarketBatchOptions(rows);
  const summary = {
    contractCount: rows.length,
    durationMs: elapsed(startedAt),
    error: null,
    optionType,
    providerRequests: 1,
    symbol,
  };
  await checkpointMarketBatchOptionIngestion(batchId, summary);

  return summary;
}

export async function finalizeSharedMarketBatchFacts({
  batchId,
  optionStages,
  underlyingStage,
}: {
  batchId: string;
  optionStages: MarketBatchOptionStageSummary[];
  underlyingStage: MarketBatchUnderlyingStageSummary;
}): Promise<MarketBatchIngestionSummary> {
  const errors = optionStages
    .map((stage) => stage.error)
    .filter((error) => error != null);
  const failedOptionType = ([...new Set(
    optionStages.map((stage) => stage.optionType),
  )] as OptionType[]).find((optionType) =>
    optionStages
      .filter((stage) => stage.optionType === optionType)
      .every((stage) => stage.error != null)
  );

  if (failedOptionType) {
    throw new Error(
      `Every shared ${failedOptionType} option-ingestion operation failed.`,
    );
  }

  const optionMetrics = (["put", "call"] as const)
    .map((optionType) => {
      const stages = optionStages.filter(
        (stage) => stage.optionType === optionType,
      );

      if (stages.length === 0) {
        return null;
      }

      return metric(optionType === "put" ? "option_put" : "option_call", {
        databaseRowsWritten: stages.reduce(
          (total, stage) => total + stage.contractCount,
          0,
        ),
        durationMs: stages.reduce(
          (total, stage) => total + stage.durationMs,
          0,
        ),
        providerRequests: stages.reduce(
          (total, stage) => total + stage.providerRequests,
          0,
        ),
      });
    })
    .filter((entry) => entry != null);
  const summary: MarketBatchIngestionSummary = {
    assetCount: underlyingStage.assetCount,
    errorCount: errors.length,
    errors,
    metrics: [...underlyingStage.metrics, ...optionMetrics],
    optionContractCount: optionStages.reduce(
      (total, stage) => total + stage.contractCount,
      0,
    ),
    rankedCount: underlyingStage.rankedCount,
    selectedCount: underlyingStage.selectedCount,
  };

  await upsertMarketBatchMetrics(batchId, summary.metrics);
  await completeMarketBatchFacts(batchId, summary);

  return summary;
}

export async function finalizeSharedMarketCoverageFacts({
  batchId,
  optionStages,
  underlyingStage,
}: {
  batchId: string;
  optionStages: MarketBatchOptionStageSummary[];
  underlyingStage: MarketBatchUnderlyingStageSummary;
}): Promise<MarketBatchIngestionSummary> {
  const errors = optionStages
    .map((stage) => stage.error)
    .filter((error) => error != null);
  const optionMetrics = (["put", "call"] as const)
    .map((optionType) => {
      const stages = optionStages.filter(
        (stage) => stage.optionType === optionType,
      );

      return stages.length === 0
        ? null
        : metric(optionType === "put" ? "option_put" : "option_call", {
            databaseRowsWritten: stages.reduce(
              (total, stage) => total + stage.contractCount,
              0,
            ),
            durationMs: stages.reduce(
              (total, stage) => total + stage.durationMs,
              0,
            ),
            providerRequests: stages.reduce(
              (total, stage) => total + stage.providerRequests,
              0,
            ),
          });
    })
    .filter((entry) => entry != null);
  const summary: MarketBatchIngestionSummary = {
    assetCount: underlyingStage.assetCount,
    errorCount: errors.length,
    errors,
    metrics: [...underlyingStage.metrics, ...optionMetrics],
    optionContractCount: optionStages.reduce(
      (total, stage) => total + stage.contractCount,
      0,
    ),
    rankedCount: underlyingStage.rankedCount,
    selectedCount: underlyingStage.selectedCount,
  };

  await upsertMarketBatchMetrics(batchId, summary.metrics);
  await completeMarketBatchFacts(batchId, summary);

  return summary;
}

function batchFactErrors(batch: Awaited<ReturnType<typeof getMarketBatch>>) {
  const errors = batch?.summary.errors;

  return Array.isArray(errors)
    ? errors.filter((error): error is string => typeof error === "string")
    : [];
}

export async function scoreSharedMarketBatchConsumerProjections(
  batchId: string,
  request: WheelScreenerRequest,
): Promise<{
  batch: NonNullable<Awaited<ReturnType<typeof getMarketBatch>>>;
  projections: ScoredMarketBatchConsumerProjections;
}> {
  const [batch, underlyingRows, optionRows] = await Promise.all([
    getMarketBatch(batchId),
    readMarketBatchUnderlyings(batchId),
    readMarketBatchOptions(batchId),
  ]);

  if (!batch || !["facts_ready", "scoring", "complete"].includes(batch.status)) {
    throw new Error("Wheel market batch facts are not ready for scoring.");
  }

  const factErrors = batchFactErrors(batch);
  const scored = scoreMarketBatchConsumer({
    factErrors,
    feed: batch.feed,
    now: new Date(batch.interval_started_at),
    optionRows,
    request,
    underlyingRows,
  });
  const legacyCompanies = scoreLegacyScannerFromMarketBatch({
    now: new Date(batch.interval_started_at),
    optionRows,
    request,
    underlyingRows,
  });
  const legacySurface = legacyScannerParitySurface({
    factErrors,
    feed: batch.feed,
    legacyCompanies,
    underlyingRows,
  });
  const legacy: ScoredMarketBatchConsumer = {
    companies: legacyCompanies,
    filters: scored.filters,
    response: {
      ...scored.response,
      companies: legacyCompanies,
      errors: legacySurface.errors,
      skippedCount: legacySurface.skippedCount,
      warnings: legacySurface.warnings,
    },
  };
  const parity = compareScannerCandidates(
    legacyCompanies,
    scored.companies,
    {
      legacy: legacySurface,
      replacement: {
        errors: scored.response.errors,
        skippedCount: scored.response.skippedCount,
        warnings: scored.response.warnings,
      },
    },
  );

  await recordMarketBatchParityObservation({
    batchId,
    filterKey: marketBatchRequestIdentity(request).filterKey,
    marketDay: getUsEquitiesMarketState(
      new Date(batch.interval_started_at),
    ).isMarketDay,
    persona: request.persona,
    result: parity,
    strategy: request.strategy,
  });
  emitTelemetry({
    event: "wheel.scanner_parity",
    operation: request.strategy,
    outcome: parity.exactMatch ? "exact" : "mismatch",
    severity: parity.exactMatch ? "info" : "warn",
  });

  return {
    batch,
    projections: {
      legacy,
      replacement: scored,
    },
  };
}

export async function scoreSharedMarketBatchConsumer(
  batchId: string,
  request: WheelScreenerRequest,
) {
  return (
    await scoreSharedMarketBatchConsumerProjections(batchId, request)
  ).projections.replacement;
}

export async function stageScoredMarketBatchSnapshotProjection(
  batchId: string,
  request: WheelScreenerRequest,
  feed: NonNullable<Awaited<ReturnType<typeof getMarketBatch>>>["feed"],
  scored: ScoredMarketBatchConsumer,
): Promise<StagedMarketBatchSnapshot> {
  const startedAt = performance.now();
  const identity = marketBatchRequestIdentity(request);
  const snapshot = await createMarketBatchSnapshot({
    batchId,
    feed,
    filterKey: identity.filterKey,
    filters: identity.filters,
    request,
    response: scored.response,
  });

  if (snapshot.status === "failed") {
    throw new Error("Wheel market batch snapshot has already failed.");
  }

  if (snapshot.status === "building") {
    await replaceMarketBatchSnapshotCandidates(
      snapshot.snapshot_id,
      scored.companies,
    );
  }

  return {
    candidateCount: scored.companies.length,
    durationMs: elapsed(startedAt),
    errors: scored.response.errors,
    screenedCount: scored.response.screenedCount,
    skippedCount: scored.response.skippedCount,
    snapshotId: snapshot.snapshot_id,
    warnings: scored.response.warnings,
  };
}

export async function stageScoredMarketBatchSnapshot(
  batchId: string,
  request: WheelScreenerRequest,
): Promise<StagedMarketBatchSnapshot> {
  const { batch, projections } =
    await scoreSharedMarketBatchConsumerProjections(batchId, request);

  return stageScoredMarketBatchSnapshotProjection(
    batchId,
    request,
    batch.feed,
    projections.replacement,
  );
}

export async function publishScoredMarketBatchSnapshot(
  snapshot: StagedMarketBatchSnapshot,
) {
  return publishMarketBatchSnapshot(snapshot);
}

export async function finishSharedMarketBatch({
  batchId,
  candidateRowsWritten,
  publicationDurationMs,
  scoringDurationMs,
  snapshotCount,
}: {
  batchId: string;
  candidateRowsWritten: number;
  publicationDurationMs: number;
  scoringDurationMs: number;
  snapshotCount: number;
}) {
  await upsertMarketBatchMetrics(batchId, [
    {
      databaseRowsWritten: candidateRowsWritten,
      durationMs: scoringDurationMs,
      operation: "candidate_scoring",
      phase: "scoring",
      providerRequests: 0,
    },
    {
      databaseRowsWritten: snapshotCount,
      durationMs: publicationDurationMs,
      operation: "snapshot_publication",
      phase: "publication",
      providerRequests: 0,
    },
  ]);
  await completeMarketBatch(batchId, snapshotCount);
}

export async function markSharedMarketBatchFailed(
  batchId: string,
  error: unknown,
) {
  await failMarketBatch(batchId, error);
}

export function sharedMarketBatchDiscoveryFilters(
  requests: WheelScreenerRequest[],
) {
  return buildSharedDiscoveryFilters(requests);
}
