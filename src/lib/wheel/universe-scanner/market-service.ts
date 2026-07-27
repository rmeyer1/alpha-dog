import {
  getHistoricalDailyBarsBySymbols,
  getLiveOptionSnapshotContracts,
  getLiveOptionSnapshotContractsBySymbols,
  type AlpacaExplicitOptionSnapshotMetadata,
} from "@/lib/alpaca/client";
import { getEnv } from "@/lib/env";
import { mergeFilters } from "../personas";
import type { DataFeed, RawOptionContract } from "../types";
import { knownCandidateMetadata, uniqueContracts } from "./candidate-domain";
import {
  selectDeepScanUniverse,
  stableStringify,
  technicalFromBars,
  technicalIsFresh,
} from "./domain";
import type {
  CandidateContractRefreshRequest,
  ContractRefreshSummary,
  DeepScanContext,
  RankedUnderlying,
  TechnicalRefreshSummary,
  UniverseDeepScanCoverageRequest,
  UniverseScanRunSummary,
} from "./model";
import {
  getCachedTechnicals,
  getPreviousWinnerSymbols,
  getRecentCandidateRows,
  upsertRows,
} from "./repository";

export async function buildDeepScanUniverse(
  ranked: RankedUnderlying[],
  deepScanSize: number,
) {
  const previousWinnerTarget = Math.floor(deepScanSize * 0.15);
  const previousWinners = await getPreviousWinnerSymbols(
    previousWinnerTarget * 2,
  );

  return selectDeepScanUniverse(ranked, deepScanSize, previousWinners);
}

export async function ensureTechnicals(deepScan: RankedUnderlying[]) {
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

    await upsertRows("wheel_underlying_technicals", computed, "symbol");

    for (const row of computed) {
      cached.set(row.symbol, row);
    }

    summary.refreshedCount = computed.length;
  }

  return { cached, summary };
}

export function deepScanContext(
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

export async function getRecentKnownCandidateContracts(
  context: DeepScanContext,
  symbols: string[],
) {
  if (symbols.length === 0) {
    return new Map<string, AlpacaExplicitOptionSnapshotMetadata[]>();
  }

  const maxAgeHours =
    getEnv().WHEEL_UNIVERSE_BACKGROUND_CANDIDATE_MAX_AGE_HOURS;
  const minAsOf = new Date(
    Date.now() - maxAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const rows = await getRecentCandidateRows(context, symbols, minAsOf);
  const bySymbol = new Map<string, AlpacaExplicitOptionSnapshotMetadata[]>();

  for (const row of rows) {
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

export async function refreshCandidateContracts(
  request: CandidateContractRefreshRequest,
): Promise<{
  contracts: RawOptionContract[];
  summary: ContractRefreshSummary;
}> {
  const knownContracts = await getFastRefreshedKnownContracts(
    request.knownMetadata,
    request.feed,
  );
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
      contractsMissingOpenInterest: contracts.filter(
        (contract) => contract.openInterest == null,
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

export function addContractRefreshSummary(
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
