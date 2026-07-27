import {
  getStockSnapshotsBySymbols,
  getWheelAssetUniverse,
} from "@/lib/alpaca/client";
import { getEnv } from "@/lib/env";
import { getNextUsEquitiesRefreshAt } from "@/lib/market/us-equities-calendar";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  emptyEarningsRiskContext,
  earningsProviderEnabled,
  getCachedEarningsRiskContexts,
} from "./earnings";
import { getPersona, mergeFilters } from "./personas";
import {
  acquireScannerLease,
  releaseScannerLease,
  scannerOwnerId,
} from "./scanner-concurrency";
import type {
  DataFeed,
  QualityLabel,
  Warning,
  WheelCompanyScore,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "./types";
import {
  selectBestCandidate,
} from "./universe-scanner/candidate-domain";
import {
  DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE,
  mapWithConcurrency,
  rankUnderlyingUniverse,
  rowToUnderlyingContext,
  selectDeepScanCoverageBatch,
  stableStringify,
} from "./universe-scanner/domain";
import {
  addContractRefreshSummary,
  buildDeepScanUniverse,
  deepScanContext,
  ensureTechnicals,
  getRecentKnownCandidateContracts,
  refreshCandidateContracts,
} from "./universe-scanner/market-service";
import type {
  DeepScanRunSummary,
  OptionMarketSnapshotRow,
  StagedUniverseDeepScanCoverage,
  UniverseDeepScanCoverageRequest,
  UniverseDeepScanCoverageResult,
  UniverseScanRunSummary,
} from "./universe-scanner/model";
import {
  checkpointDeepScanRun,
  completeDeepScanRun,
  completeUniverseScanRun,
  createDeepScanRun,
  createUniverseScanRun,
  deleteDeepScanCandidate,
  failDeepScanRun,
  failUniverseScanRun,
  getDeepScanCheckpoint,
  getDeepScanCoverage,
  getReusableDeepScanRun,
  heartbeatDeepScanRun,
  heartbeatUniverseScanRun,
  optionMarketSnapshotRows,
  persistOptionMarketSnapshots,
  persistRankedCandidates,
  persistStockSnapshots,
  persistUniverseAssets,
  releaseDeepScanCheckpointLease,
  upsertDeepScanCandidates,
  upsertDeepScanCoverageRows,
} from "./universe-scanner/repository";

export type {
  StagedUniverseDeepScanCoverage,
  UniverseDeepScanCoverageRequest,
  UniverseDeepScanCoverageResult,
} from "./universe-scanner/model";

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
  const leaseResult = await acquireScannerLease({
    context,
    intervalMinutes: 15,
    scanKind: "universe",
  });

  if (!leaseResult.acquired) {
    throw new Error(
      `A matching universe scan is already active. Retry after ${leaseResult.retryAfterSeconds} seconds.`,
    );
  }

  const lease = leaseResult;
  let runId: string | null = null;
  let summary: UniverseScanRunSummary | null = null;

  try {
    runId = await createUniverseScanRun({ ...request, strategy }, lease);
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
    await heartbeatUniverseScanRun(runId, lease);

    const { cached: technicals, summary: technicalSummary } =
      await ensureTechnicals(deepScan);
    await heartbeatUniverseScanRun(runId, lease);
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
        nextSuggestedRefreshAt: getNextUsEquitiesRefreshAt(
          now,
          15 * 60 * 1000,
        ),
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
    await heartbeatUniverseScanRun(runId, lease);
    await completeUniverseScanRun(runId, response, runSummary);

    return response;
  } catch (error) {
    await failUniverseScanRun(runId, error, summary);
    throw error;
  } finally {
    await releaseScannerLease(lease).catch((error) => {
      console.warn("wheel_universe_scan_lease_release_failed", {
        error: error instanceof Error ? error.name : "UnknownError",
        runId,
      });
    });
  }
}

async function executeUniverseDeepScanCoverage(
  request: UniverseDeepScanCoverageRequest,
  deferCompletion: boolean,
  idempotencyKey?: string,
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
  const leaseResult = await acquireScannerLease({
    context,
    intervalMinutes: 60,
    ownerId: idempotencyKey ? scannerOwnerId(idempotencyKey) : undefined,
    scanKind: "deep_scan",
  });

  if (!leaseResult.acquired) {
    return {
      batchSize,
      candidateCount: 0,
      errorCount: 0,
      errors: [],
      filterKey: context.filterKey,
      persona: context.persona,
      runId: null,
      scannedCount: 0,
      scannedSymbols: [],
      selectedCount: 0,
      skippedReason:
        `A matching deep scan is already active; retry after ${leaseResult.retryAfterSeconds} seconds.`,
      staleBefore,
      strategy: context.strategy,
      totalEligibleCount: 0,
    };
  }

  const lease = leaseResult;
  let runId: string | null = null;
  let summary: DeepScanRunSummary | null = null;
  let retainLeaseForWorkflow = false;

  try {
    const reusableRun = idempotencyKey
      ? await getReusableDeepScanRun(lease)
      : null;

    if (reusableRun?.workflow_result) {
      retainLeaseForWorkflow = true;
      return reusableRun.workflow_result;
    }

    runId = reusableRun?.id ??
      await createDeepScanRun(context, batchSize, lease);
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
    await heartbeatDeepScanRun(runId, lease);

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

      if (deferCompletion) {
        await checkpointDeepScanRun(runId, result, runSummary);
        retainLeaseForWorkflow = true;
      } else {
        await completeDeepScanRun(runId, result, runSummary);
      }

      return result;
    }

    const { cached: technicals, summary: technicalSummary } =
      await ensureTechnicals(selected);
    await heartbeatDeepScanRun(runId, lease);
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
    await heartbeatDeepScanRun(runId, lease);
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

    if (deferCompletion) {
      await checkpointDeepScanRun(runId, result, runSummary);
      retainLeaseForWorkflow = true;
    } else {
      await completeDeepScanRun(runId, result, runSummary);
    }

    return result;
  } catch (error) {
    await failDeepScanRun(runId, error, summary);
    throw error;
  } finally {
    if (!retainLeaseForWorkflow) {
      await releaseScannerLease(lease).catch((error) => {
        console.warn("wheel_deep_scan_lease_release_failed", {
          error: error instanceof Error ? error.name : "UnknownError",
          runId,
        });
      });
    }
  }
}

export async function runUniverseDeepScanCoverage(
  request: UniverseDeepScanCoverageRequest,
) {
  return executeUniverseDeepScanCoverage(request, false);
}

export async function stageUniverseDeepScanCoverage(
  request: UniverseDeepScanCoverageRequest,
  idempotencyKey: string,
): Promise<StagedUniverseDeepScanCoverage> {
  const result = await executeUniverseDeepScanCoverage(
    request,
    true,
    idempotencyKey,
  );

  return {
    result: result.runId ? null : result,
    runId: result.runId,
  };
}

export async function completeStagedUniverseDeepScanCoverage(
  runId: string,
) {
  const checkpoint = await getDeepScanCheckpoint(runId);

  if (!checkpoint?.workflow_result) {
    throw new Error(`Deep scan workflow checkpoint ${runId} is unavailable.`);
  }

  if (checkpoint.status === "failed") {
    throw new Error(`Deep scan workflow checkpoint ${runId} has failed.`);
  }

  if (checkpoint.status === "running") {
    await completeDeepScanRun(
      runId,
      checkpoint.workflow_result,
      checkpoint.summary,
    );
  }

  await releaseDeepScanCheckpointLease(checkpoint);

  return checkpoint.workflow_result;
}

export async function failStagedUniverseDeepScanCoverage(
  runId: string,
  error: unknown,
) {
  const checkpoint = await getDeepScanCheckpoint(runId);

  await failDeepScanRun(runId, error, checkpoint?.summary ?? null);
  await releaseDeepScanCheckpointLease(checkpoint);
}
