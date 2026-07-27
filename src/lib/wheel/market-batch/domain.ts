import { getNextUsEquitiesRefreshAt } from "@/lib/market/us-equities-calendar";
import { emptyEarningsRiskContext } from "../earnings";
import { getPersona, mergeFilters } from "../personas";
import type {
  DataFeed,
  OptionType,
  RawOptionContract,
  UnderlyingContext,
  Warning,
  WheelCompanyScore,
  WheelFilters,
  WheelScreenerRequest,
} from "../types";
import { optionTypeForStrategy, selectBestCandidate } from
  "../universe-scanner/candidate-domain";
import { parseNumber, stableStringify } from "../universe-scanner/domain";
import type {
  MarketBatchOptionRow,
  MarketBatchUnderlyingRow,
  ScoredMarketBatchConsumer,
} from "./model";

export function marketBatchRequestIdentity(request: WheelScreenerRequest) {
  const filters = mergeFilters(request.persona, request.filters);

  return {
    filterKey: stableStringify(filters),
    filters,
    persona: request.persona,
    strategy: request.strategy,
  };
}

export function buildSharedDiscoveryFilters(
  requests: WheelScreenerRequest[],
): WheelFilters {
  if (requests.length === 0) {
    throw new Error("A market batch requires at least one scoring consumer.");
  }

  const filters = requests.map(
    (request) => marketBatchRequestIdentity(request).filters,
  );

  return {
    dteMin: Math.min(...filters.map((item) => item.dteMin)),
    dteMax: Math.max(...filters.map((item) => item.dteMax)),
    deltaMin: Math.min(...filters.map((item) => item.deltaMin)),
    deltaMax: Math.max(...filters.map((item) => item.deltaMax)),
    minPremiumYield: Math.min(
      ...filters.map((item) => item.minPremiumYield),
    ),
    minVolume: Math.min(...filters.map((item) => item.minVolume)),
    minOpenInterest: Math.min(
      ...filters.map((item) => item.minOpenInterest),
    ),
    maxSpreadPctOfMid: Math.max(
      ...filters.map((item) => item.maxSpreadPctOfMid),
    ),
    minSpreadReturnOnRisk: Math.min(
      ...filters.map((item) => item.minSpreadReturnOnRisk),
    ),
    maxSpreadWidth: Math.max(
      ...filters.map((item) => item.maxSpreadWidth),
    ),
    spreadLongLegCount: Math.max(
      ...filters.map((item) => item.spreadLongLegCount),
    ),
    excludeEarnings: filters.every((item) => item.excludeEarnings),
    includeWeeklies: filters.some((item) => item.includeWeeklies),
  };
}

export function marketBatchOptionTypes(
  requests: WheelScreenerRequest[],
): OptionType[] {
  return Array.from(
    new Set(requests.map((request) => optionTypeForStrategy(request.strategy))),
  ).sort();
}

function numberOrNull(value: number | string | null) {
  return parseNumber(value);
}

export function marketBatchUnderlyingContext(
  row: MarketBatchUnderlyingRow,
): UnderlyingContext {
  const price = parseNumber(row.price);

  if (price == null || price <= 0) {
    throw new Error(`Market batch ${row.symbol} has an invalid stock price.`);
  }

  return {
    symbol: row.symbol,
    price,
    asOf: row.captured_at,
    trend: row.trend,
    rsi14: numberOrNull(row.rsi14),
    movingAverages: {
      ma20: numberOrNull(row.ma20),
      ma50: numberOrNull(row.ma50),
      ma200: numberOrNull(row.ma200),
    },
  };
}

export function marketBatchRawContract(
  row: MarketBatchOptionRow,
): RawOptionContract {
  const strike = parseNumber(row.strike);
  const bid = parseNumber(row.bid);
  const ask = parseNumber(row.ask);

  if (strike == null || bid == null || ask == null) {
    throw new Error(
      `Market batch contract ${row.contract_symbol} has invalid quote fields.`,
    );
  }

  return {
    contractSymbol: row.contract_symbol,
    optionType: row.option_type,
    strike,
    expirationDate: row.expiration,
    bid,
    ask,
    delta: numberOrNull(row.delta),
    theta: numberOrNull(row.theta),
    impliedVolatility: numberOrNull(row.implied_volatility),
    volume: numberOrNull(row.volume),
    openInterest: numberOrNull(row.open_interest),
  };
}

function marketBatchWarnings(
  feed: Exclude<DataFeed, "demo">,
  underlyings: MarketBatchUnderlyingRow[],
): Warning[] {
  const warnings: Warning[] = [];

  if (feed === "indicative") {
    warnings.push({
      type: "data_quality",
      severity: "warning",
      message:
        "Indicative options feed selected. Confirm OPRA access before relying on live quotes.",
    });
  }

  if (
    underlyings.every(
      (underlying) => !underlying.earnings_context.providerEnabled,
    )
  ) {
    warnings.push({
      type: "earnings",
      severity: "info",
      message: "Earnings provider is disabled. Verify earnings before trading.",
    });
  }

  return warnings;
}

export function scoreMarketBatchConsumer({
  factErrors = [],
  feed,
  now = new Date(),
  optionRows,
  request,
  underlyingRows,
}: {
  factErrors?: string[];
  feed: Exclude<DataFeed, "demo">;
  now?: Date;
  optionRows: MarketBatchOptionRow[];
  request: WheelScreenerRequest;
  underlyingRows: MarketBatchUnderlyingRow[];
}): ScoredMarketBatchConsumer {
  const identity = marketBatchRequestIdentity(request);
  const persona = getPersona(request.persona);
  const limit = request.limit ?? 50;
  const selected = underlyingRows
    .filter((row) => row.selected_for_scoring)
    .sort((left, right) =>
      left.universe_rank - right.universe_rank ||
      left.symbol.localeCompare(right.symbol)
    );
  const optionType = optionTypeForStrategy(request.strategy);
  const contractsBySymbol = new Map<string, RawOptionContract[]>();

  for (const row of optionRows) {
    if (row.option_type !== optionType) {
      continue;
    }

    const contracts = contractsBySymbol.get(row.underlying_symbol) ?? [];
    contracts.push(marketBatchRawContract(row));
    contractsBySymbol.set(row.underlying_symbol, contracts);
  }

  let noCandidateCount = 0;
  const companies = selected
    .map((row): WheelCompanyScore | null => {
      const underlying = marketBatchUnderlyingContext(row);
      const bestCandidate = selectBestCandidate(
        contractsBySymbol.get(row.symbol) ?? [],
        underlying,
        request.persona,
        request.strategy,
        identity.filters,
        row.earnings_context ?? emptyEarningsRiskContext(row.symbol),
        now,
      );

      if (!bestCandidate) {
        noCandidateCount += 1;
        return null;
      }

      return {
        rank: 0,
        ticker: row.symbol,
        name: row.company_name,
        exchange: row.exchange,
        score: bestCandidate.score,
        underlying,
        bestCandidate,
        warnings: [],
        errors: [],
      };
    })
    .filter((company) => company != null)
    .sort((left, right) =>
      right.score - left.score || left.ticker.localeCompare(right.ticker)
    )
    .slice(0, limit)
    .map((company, index) => ({
      ...company,
      rank: index + 1,
    }));
  const asOf = underlyingRows
    .map((row) => row.captured_at)
    .sort()
    .at(-1) ?? now.toISOString();
  const skippedCount =
    underlyingRows.length - selected.length + noCandidateCount;
  const response = {
    persona: {
      id: persona.id,
      name: persona.name,
      motto: persona.motto,
    },
    dataFreshness: {
      feed,
      cacheStatus: "fresh" as const,
      asOf,
      nextSuggestedRefreshAt: getNextUsEquitiesRefreshAt(
        new Date(asOf),
        15 * 60 * 1000,
      ),
    },
    companies,
    screenedCount: underlyingRows.length,
    skippedCount,
    progress: {
      status: "complete" as const,
      resultScope: "complete" as const,
      cursor: 0,
      nextCursor: null,
      batchSize: selected.length,
      batchScreenedCount: selected.length,
      processedCount: underlyingRows.length,
      totalCount: underlyingRows.length,
    },
    warnings: marketBatchWarnings(feed, underlyingRows),
    errors: factErrors.slice(0, 25),
  };

  return {
    companies,
    filters: identity.filters,
    response,
  };
}

export interface MarketBatchWorkEstimate {
  databaseRows: number;
  providerRequests: number;
}

export function estimateScannerWork({
  assetCount,
  consumers,
  contractsPerOptionType,
  shared,
  symbolCount,
}: {
  assetCount: number;
  consumers: WheelScreenerRequest[];
  contractsPerOptionType: number;
  shared: boolean;
  symbolCount: number;
}): MarketBatchWorkEstimate {
  const optionTypes = marketBatchOptionTypes(consumers);

  if (shared) {
    return {
      providerRequests: 2 + symbolCount * optionTypes.length,
      databaseRows:
        assetCount +
        symbolCount +
        symbolCount * optionTypes.length * contractsPerOptionType,
    };
  }

  return {
    providerRequests: consumers.length * (2 + symbolCount),
    databaseRows:
      consumers.length * (assetCount + symbolCount) +
      symbolCount * contractsPerOptionType * consumers.length,
  };
}

export function marketBatchKey(
  intervalStartedAt: string,
  feed: Exclude<DataFeed, "demo">,
) {
  return `wheel-market-batch:${feed}:${intervalStartedAt}`;
}
