import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import {
  observeProviderCall,
  privateProviderFetchTracing,
  providerHttpError,
  providerMalformedResponse,
} from "@/lib/observability/provider";
import { withProviderTimeout } from "@/lib/provider-timeout";
import { round } from "@/lib/wheel/calculations";
import {
  alpacaHeaders,
  fetchAlpacaJson as transportFetchAlpacaJson,
} from "./transport";
import {
  addAlpacaDays as addDays,
  alpacaStrikeBounds as strikeBoundsForOptionType,
  chunkAlpacaValues as chunk,
  classifyAlpacaTrend,
  formatAlpacaDate as formatDate,
  movingAverage,
  normalizeAlpacaSnapshotContract as normalizeSnapshotContract,
  parseAlpacaOptionSymbol as parseOptionSymbol,
  rsi14 as calculateRsi14,
} from "./normalization";
import type {
  AlpacaAsset,
  AlpacaBar,
  AlpacaBarsResponse,
  AlpacaContractsResponse,
  AlpacaLatestBarResponse,
  AlpacaMultiBarsResponse,
  AlpacaOptionContract,
  AlpacaOptionSnapshot,
  AlpacaSnapshotsResponse,
  AlpacaStockSnapshot,
  AlpacaStockSnapshotsResponse,
} from "./types";
import type {
  OptionType,
  RawOptionContract,
  UnderlyingContext,
  WheelCompanyStrategy,
  WheelFilters,
} from "@/lib/wheel/types";

export type {
  AlpacaAsset,
  AlpacaBar,
  AlpacaOptionSnapshot,
  AlpacaStockSnapshot,
} from "./types";

export interface AlpacaFeedProbeResult {
  ok: boolean;
  feed: "opra" | "indicative";
  ticker: string;
  status: number | null;
  message: string;
  sampleContractCount?: number;
}

export interface AlpacaWheelAsset {
  symbol: string;
  name: string;
  exchange: "NYSE" | "NASDAQ";
}

export type AlpacaStockFeed = "sip" | "iex" | "delayed_sip";

export interface AlpacaExplicitOptionSnapshotMetadata {
  contractSymbol: string;
  expirationDate: string;
  openInterest?: number | null;
  optionType: OptionType;
  strike: number;
}

interface LiveWheelMarketData {
  feed: "opra" | "indicative";
  underlying: UnderlyingContext;
  rawContracts: RawOptionContract[];
  asOf: string;
}

interface LiveWheelMarketDataCacheEntry {
  data: LiveWheelMarketData;
  freshUntilMs: number;
}
const ALPACA_OPTION_SNAPSHOT_LIMIT = 1000;
const LIVE_MARKET_DATA_CACHE_TTL_MS = 2 * 60 * 1000;

const liveMarketDataCache = new Map<string, LiveWheelMarketDataCacheEntry>();
const liveMarketDataInFlight = new Map<string, Promise<LiveWheelMarketData>>();

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

function cloneLiveMarketData(data: LiveWheelMarketData): LiveWheelMarketData {
  return structuredClone(data);
}

function buildLiveMarketDataCacheKey(
  ticker: string,
  filters: WheelFilters,
  strategy?: WheelCompanyStrategy,
) {
  const env = getEnv();

  return [
    "alpaca-live-wheel-market-data",
    "v1",
    env.ALPACA_OPTIONS_FEED,
    ticker.trim().toUpperCase(),
    strategy ?? "all",
    stableStringify(filters),
  ].join(":");
}

async function fetchAlpacaJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  return transportFetchAlpacaJson<T>(url, signal);
}

async function getAssetsByExchange(exchange: "NYSE" | "NASDAQ") {
  const env = getEnv();
  const url = new URL("/v2/assets", env.ALPACA_TRADING_BASE_URL);

  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");
  url.searchParams.set("exchange", exchange);
  url.searchParams.set("attributes", "has_options");

  return fetchAlpacaJson<AlpacaAsset[]>(url);
}

export async function getAlpacaAsset(ticker: string, signal?: AbortSignal) {
  const env = getEnv();
  const url = new URL(`/v2/assets/${ticker}`, env.ALPACA_TRADING_BASE_URL);

  return fetchAlpacaJson<AlpacaAsset>(url, signal);
}

export async function getWheelAssetUniverse(): Promise<AlpacaWheelAsset[]> {
  const [nyseAssets, nasdaqAssets] = await Promise.all([
    getAssetsByExchange("NYSE"),
    getAssetsByExchange("NASDAQ"),
  ]);
  const seen = new Set<string>();

  return [...nyseAssets, ...nasdaqAssets]
    .filter((asset) => {
      if (
        (asset.asset_class != null && asset.asset_class !== "us_equity") ||
        asset.status !== "active" ||
        !asset.tradable ||
        (asset.exchange !== "NYSE" && asset.exchange !== "NASDAQ") ||
        !asset.attributes?.includes("has_options") ||
        !/^[A-Z0-9.-]+$/.test(asset.symbol)
      ) {
        return false;
      }

      if (seen.has(asset.symbol)) {
        return false;
      }

      seen.add(asset.symbol);

      return true;
    })
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name?.trim() || asset.symbol,
      exchange: asset.exchange as "NYSE" | "NASDAQ",
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function getOptionContractsPage(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
  pageToken?: string,
  signal?: AbortSignal,
) {
  const env = getEnv();
  const now = new Date();
  const url = new URL("/v2/options/contracts", env.ALPACA_TRADING_BASE_URL);
  const strikeBounds = strikeBoundsForOptionType(optionType, underlyingPrice);

  url.searchParams.set("underlying_symbols", ticker);
  url.searchParams.set("status", "active");
  url.searchParams.set("type", optionType);
  url.searchParams.set(
    "expiration_date_gte",
    formatDate(addDays(now, filters.dteMin)),
  );
  url.searchParams.set(
    "expiration_date_lte",
    formatDate(addDays(now, filters.dteMax)),
  );
  url.searchParams.set("strike_price_gte", String(round(strikeBounds.min, 2)));
  url.searchParams.set("strike_price_lte", String(round(strikeBounds.max, 2)));
  url.searchParams.set("limit", "10000");

  if (pageToken) {
    url.searchParams.set("page_token", pageToken);
  }

  return fetchAlpacaJson<AlpacaContractsResponse>(url, signal);
}

async function getOptionContracts(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
  signal?: AbortSignal,
) {
  const contracts: AlpacaOptionContract[] = [];
  let pageToken: string | undefined;

  do {
    const page = await getOptionContractsPage(
      ticker,
      optionType,
      filters,
      underlyingPrice,
      pageToken,
      signal,
    );
    contracts.push(...(page.option_contracts ?? []));
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);

  return contracts.filter((contract) => contract.tradable !== false);
}

async function getOptionChainSnapshotsPage(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
  feed: "opra" | "indicative",
  updatedSince?: string,
  pageToken?: string,
  signal?: AbortSignal,
) {
  const env = getEnv();
  const now = new Date();
  const url = new URL(
    `/v1beta1/options/snapshots/${ticker}`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );
  const strikeBounds = strikeBoundsForOptionType(optionType, underlyingPrice);

  url.searchParams.set("feed", feed);
  url.searchParams.set("limit", String(ALPACA_OPTION_SNAPSHOT_LIMIT));
  url.searchParams.set("type", optionType);
  url.searchParams.set(
    "expiration_date_gte",
    formatDate(addDays(now, filters.dteMin)),
  );
  url.searchParams.set(
    "expiration_date_lte",
    formatDate(addDays(now, filters.dteMax)),
  );
  url.searchParams.set("strike_price_gte", String(round(strikeBounds.min, 2)));
  url.searchParams.set("strike_price_lte", String(round(strikeBounds.max, 2)));

  if (updatedSince) {
    url.searchParams.set("updated_since", updatedSince);
  }

  if (pageToken) {
    url.searchParams.set("page_token", pageToken);
  }

  return fetchAlpacaJson<AlpacaSnapshotsResponse>(url, signal);
}

async function getOptionChainSnapshots(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
  feed: "opra" | "indicative",
  options: { signal?: AbortSignal; updatedSince?: string } = {},
) {
  const snapshots: Record<string, AlpacaOptionSnapshot> = {};
  let pageToken: string | undefined;

  do {
    const page = await getOptionChainSnapshotsPage(
      ticker,
      optionType,
      filters,
      underlyingPrice,
      feed,
      options.updatedSince,
      pageToken,
      options.signal,
    );
    Object.assign(snapshots, page.snapshots ?? {});
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);

  return snapshots;
}

async function getSnapshotsBySymbols(
  symbols: string[],
  feed: "opra" | "indicative",
  signal?: AbortSignal,
) {
  const env = getEnv();
  const snapshots: Record<string, AlpacaOptionSnapshot> = {};

  for (const symbolChunk of chunk(symbols, 100)) {
    const url = new URL(
      "/v1beta1/options/snapshots",
      env.ALPACA_MARKET_DATA_BASE_URL,
    );
    url.searchParams.set("feed", feed);
    url.searchParams.set("symbols", symbolChunk.join(","));

    const body = await fetchAlpacaJson<AlpacaSnapshotsResponse>(url, signal);
    Object.assign(snapshots, body.snapshots ?? {});
  }

  return snapshots;
}

export async function getLiveOptionSnapshotContractsBySymbols(
  metadata: AlpacaExplicitOptionSnapshotMetadata[],
  feed: "opra" | "indicative",
) {
  const metadataBySymbol = await getExplicitOptionContractMetadataBySymbol(
    metadata,
  );
  const snapshots = await getSnapshotsBySymbols(
    Array.from(metadataBySymbol.keys()),
    feed,
  );

  return Object.entries(snapshots)
    .map(([symbol, snapshot]) =>
      normalizeSnapshotContract(symbol, snapshot, metadataBySymbol.get(symbol))
    )
    .filter((contract) => contract != null);
}

export async function getStockSnapshotsBySymbols(
  symbols: string[],
  options: {
    chunkSize?: number;
    feed?: AlpacaStockFeed;
    signal?: AbortSignal;
  } = {},
) {
  const env = getEnv();
  const snapshots: Record<string, AlpacaStockSnapshot> = {};
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? 1000, 1000));

  await Promise.all(
    chunk(symbols, chunkSize).map(async (symbolChunk) => {
      const url = new URL(
        "/v2/stocks/snapshots",
        env.ALPACA_MARKET_DATA_BASE_URL,
      );

      url.searchParams.set("feed", options.feed ?? "sip");
      url.searchParams.set("symbols", symbolChunk.join(","));

      const body = await fetchAlpacaJson<AlpacaStockSnapshotsResponse>(
        url,
        options.signal,
      );
      const responseSnapshots = body.snapshots ??
        Object.fromEntries(
          Object.entries(body).filter(([key]) => key !== "message"),
        ) as Record<string, AlpacaStockSnapshot>;

      Object.assign(snapshots, responseSnapshots);
    }),
  );

  return snapshots;
}

export async function getStockSnapshotBySymbol(
  symbol: string,
  options: { feed?: AlpacaStockFeed; signal?: AbortSignal } = {},
) {
  const snapshots = await getStockSnapshotsBySymbols([symbol], {
    chunkSize: 1,
    feed: options.feed,
    signal: options.signal,
  });

  return snapshots[symbol] ?? null;
}

export async function getHistoricalDailyBars(
  ticker: string,
  options: {
    adjustment?: "raw" | "split" | "dividend" | "all";
    daysBack?: number;
    feed?: AlpacaStockFeed;
    signal?: AbortSignal;
  } = {},
) {
  const env = getEnv();
  const url = new URL(
    `/v2/stocks/${ticker}/bars`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );

  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", formatDate(addDays(new Date(), -(options.daysBack ?? 520))));
  url.searchParams.set("limit", "10000");
  url.searchParams.set("adjustment", options.adjustment ?? "raw");
  url.searchParams.set("feed", options.feed ?? getEnv().ALPACA_STOCK_FEED);

  const body = await fetchAlpacaJson<AlpacaBarsResponse>(url, options.signal);

  return body.bars ?? [];
}

function mergeMultiBars(
  target: Record<string, AlpacaBar[]>,
  bars: AlpacaMultiBarsResponse["bars"],
) {
  if (!bars) {
    return;
  }

  if (Array.isArray(bars)) {
    return;
  }

  for (const [symbol, symbolBars] of Object.entries(bars)) {
    target[symbol] = [...(target[symbol] ?? []), ...symbolBars];
  }
}

export async function getHistoricalDailyBarsBySymbols(
  symbols: string[],
  options: {
    daysBack?: number;
    feed?: AlpacaStockFeed;
    symbolChunkSize?: number;
  } = {},
) {
  const env = getEnv();
  const barsBySymbol: Record<string, AlpacaBar[]> = {};
  const symbolChunkSize = Math.max(
    1,
    Math.min(options.symbolChunkSize ?? 40, 100),
  );

  await Promise.all(
    chunk(symbols, symbolChunkSize).map(async (symbolChunk) => {
      let pageToken: string | undefined;

      do {
        const url = new URL(
          "/v2/stocks/bars",
          env.ALPACA_MARKET_DATA_BASE_URL,
        );

        url.searchParams.set("symbols", symbolChunk.join(","));
        url.searchParams.set("timeframe", "1Day");
        url.searchParams.set(
          "start",
          formatDate(addDays(new Date(), -(options.daysBack ?? 520))),
        );
        url.searchParams.set("limit", "10000");
        url.searchParams.set("adjustment", "raw");
        url.searchParams.set("feed", options.feed ?? "sip");

        if (pageToken) {
          url.searchParams.set("page_token", pageToken);
        }

        const body = await fetchAlpacaJson<AlpacaMultiBarsResponse>(url);

        mergeMultiBars(barsBySymbol, body.bars);
        pageToken = body.next_page_token ?? undefined;
      } while (pageToken);
    }),
  );

  return barsBySymbol;
}

export async function getLatestStockBar(
  ticker: string,
  options: { feed?: AlpacaStockFeed; signal?: AbortSignal } = {},
) {
  const env = getEnv();
  const url = new URL(
    `/v2/stocks/${ticker}/bars/latest`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );

  url.searchParams.set("feed", options.feed ?? getEnv().ALPACA_STOCK_FEED);

  const body = await fetchAlpacaJson<AlpacaLatestBarResponse>(url, options.signal);

  return body.bar;
}

function optionTypesForStrategy(strategy?: WheelCompanyStrategy) {
  switch (strategy) {
    case "short_put":
    case "put_credit_spread":
      return ["put"] as const;
    case "covered_call":
    case "call_credit_spread":
      return ["call"] as const;
    default:
      return ["put", "call"] as const;
  }
}

function contractMetadataBySymbol(contracts: AlpacaOptionContract[]) {
  return new Map(contracts.map((contract) => [contract.symbol, contract]));
}

function explicitMetadataBySymbol(
  metadata: AlpacaExplicitOptionSnapshotMetadata[],
): Map<string, AlpacaOptionContract> {
  return new Map<string, AlpacaOptionContract>(
    metadata.map((contract) => [
      contract.contractSymbol,
      {
        symbol: contract.contractSymbol,
        expiration_date: contract.expirationDate,
        type: contract.optionType,
        strike_price: String(contract.strike),
        open_interest: contract.openInterest == null
          ? null
          : String(contract.openInterest),
        tradable: true,
      } satisfies AlpacaOptionContract,
    ]),
  );
}

function explicitContractMetadataGroups(
  metadata: AlpacaExplicitOptionSnapshotMetadata[],
) {
  const groups = new Map<string, AlpacaExplicitOptionSnapshotMetadata[]>();

  for (const contract of metadata) {
    const parsed = parseOptionSymbol(contract.contractSymbol);

    if (!parsed) {
      continue;
    }

    const key = [
      parsed.underlyingSymbol,
      contract.optionType,
      contract.expirationDate,
    ].join(":");

    groups.set(key, [...(groups.get(key) ?? []), contract]);
  }

  return Array.from(groups.values());
}

async function getExplicitOptionContractsPage(
  metadata: AlpacaExplicitOptionSnapshotMetadata[],
) {
  const parsed = parseOptionSymbol(metadata[0]?.contractSymbol ?? "");

  if (!parsed) {
    return [];
  }

  const env = getEnv();
  const strikes = metadata.map((contract) => contract.strike);
  const url = new URL("/v2/options/contracts", env.ALPACA_TRADING_BASE_URL);

  url.searchParams.set("underlying_symbols", parsed.underlyingSymbol);
  url.searchParams.set("status", "active");
  url.searchParams.set("type", metadata[0].optionType);
  url.searchParams.set("expiration_date_gte", metadata[0].expirationDate);
  url.searchParams.set("expiration_date_lte", metadata[0].expirationDate);
  url.searchParams.set("strike_price_gte", String(Math.min(...strikes)));
  url.searchParams.set("strike_price_lte", String(Math.max(...strikes)));
  url.searchParams.set("limit", "10000");

  const page = await fetchAlpacaJson<AlpacaContractsResponse>(url);
  const requestedSymbols = new Set(
    metadata.map((contract) => contract.contractSymbol),
  );

  return (page.option_contracts ?? []).filter((contract) =>
    requestedSymbols.has(contract.symbol) && contract.tradable !== false
  );
}

async function getExplicitOptionContractMetadataBySymbol(
  metadata: AlpacaExplicitOptionSnapshotMetadata[],
) {
  const bySymbol = explicitMetadataBySymbol(metadata);

  if (metadata.length === 0) {
    return bySymbol;
  }

  try {
    const enrichedContracts = (
      await Promise.all(
        explicitContractMetadataGroups(metadata).map((group) =>
          getExplicitOptionContractsPage(group)
        ),
      )
    ).flat();

    for (const contract of enrichedContracts) {
      bySymbol.set(contract.symbol, contract);
    }
  } catch {
    // Open-interest enrichment is best effort; preserve quote refreshes.
  }

  return bySymbol;
}

async function getContractsForOptionTypes(
  ticker: string,
  optionTypes: readonly OptionType[],
  filters: WheelFilters,
  underlyingPrice: number,
  signal?: AbortSignal,
) {
  return (
    await Promise.all(
      optionTypes.map((optionType) =>
        getOptionContracts(ticker, optionType, filters, underlyingPrice, signal),
      ),
    )
  ).flat();
}

async function getChainSnapshotsForOptionTypes(
  ticker: string,
  optionTypes: readonly OptionType[],
  filters: WheelFilters,
  underlyingPrice: number,
  feed: "opra" | "indicative",
  options: { signal?: AbortSignal; updatedSince?: string } = {},
) {
  const snapshots: Record<string, AlpacaOptionSnapshot> = {};

  await Promise.all(
    optionTypes.map(async (optionType) => {
      Object.assign(
        snapshots,
        await getOptionChainSnapshots(
          ticker,
          optionType,
          filters,
          underlyingPrice,
          feed,
          options,
        ),
      );
    }),
  );

  return snapshots;
}

async function getLiveOptionContracts(
  ticker: string,
  filters: WheelFilters,
  strategy: WheelCompanyStrategy | undefined,
  underlyingPrice: number,
  feed: "opra" | "indicative",
  signal?: AbortSignal,
) {
  const optionTypes = optionTypesForStrategy(strategy);
  const [metadataResult, chainResult] = await Promise.allSettled([
    getContractsForOptionTypes(
      ticker,
      optionTypes,
      filters,
      underlyingPrice,
      signal,
    ),
    getChainSnapshotsForOptionTypes(
      ticker,
      optionTypes,
      filters,
      underlyingPrice,
      feed,
      { signal },
    ),
  ]);
  const contracts =
    metadataResult.status === "fulfilled" ? metadataResult.value : [];
  let snapshots =
    chainResult.status === "fulfilled" ? chainResult.value : {};

  if (Object.keys(snapshots).length === 0 && contracts.length > 0) {
    snapshots = await getSnapshotsBySymbols(
      contracts.map((contract) => contract.symbol),
      feed,
      signal,
    );
  }

  if (Object.keys(snapshots).length === 0) {
    if (chainResult.status === "rejected") {
      throw chainResult.reason;
    }

    if (metadataResult.status === "rejected") {
      throw metadataResult.reason;
    }
  }

  const metadata = contractMetadataBySymbol(contracts);

  return Object.entries(snapshots)
    .map(([symbol, snapshot]) =>
      normalizeSnapshotContract(symbol, snapshot, metadata.get(symbol))
    )
    .filter((contract) => contract != null);
}

export async function getLiveOptionSnapshotContracts(
  ticker: string,
  filters: WheelFilters,
  strategy: WheelCompanyStrategy | undefined,
  underlyingPrice: number,
  feed: "opra" | "indicative",
  options: { updatedSince?: string } = {},
) {
  const snapshots = await getChainSnapshotsForOptionTypes(
    ticker,
    optionTypesForStrategy(strategy),
    filters,
    underlyingPrice,
    feed,
    options,
  );

  return Object.entries(snapshots)
    .map(([symbol, snapshot]) => normalizeSnapshotContract(symbol, snapshot))
    .filter((contract) => contract != null);
}

export async function getLiveWheelMarketData(
  ticker: string,
  filters: WheelFilters,
  strategy?: WheelCompanyStrategy,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
): Promise<LiveWheelMarketData> {
  const cacheKey = buildLiveMarketDataCacheKey(ticker, filters, strategy);
  const cached = liveMarketDataCache.get(cacheKey);
  const nowMs = Date.now();

  if (!options.forceRefresh && cached && nowMs <= cached.freshUntilMs) {
    return cloneLiveMarketData(cached.data);
  }

  if (!options.forceRefresh) {
    const inFlight = liveMarketDataInFlight.get(cacheKey);

    if (inFlight) {
      return cloneLiveMarketData(await inFlight);
    }
  }

  const inFlight = fetchLiveWheelMarketData(
    ticker,
    filters,
    strategy,
    options.signal,
  )
    .then((data) => {
      liveMarketDataCache.set(cacheKey, {
        data: cloneLiveMarketData(data),
        freshUntilMs: Date.now() + LIVE_MARKET_DATA_CACHE_TTL_MS,
      });

      return data;
    })
    .finally(() => {
      liveMarketDataInFlight.delete(cacheKey);
    });

  liveMarketDataInFlight.set(cacheKey, inFlight);

  return cloneLiveMarketData(await inFlight);
}

async function fetchLiveWheelMarketData(
  ticker: string,
  filters: WheelFilters,
  strategy?: WheelCompanyStrategy,
  signal?: AbortSignal,
): Promise<LiveWheelMarketData> {
  const env = getEnv();
  const [latestBar, historicalBars] = await Promise.all([
    getLatestStockBar(ticker, { signal }),
    getHistoricalDailyBars(ticker, { signal }),
  ]);
  const closes = historicalBars.map((bar) => bar.c).filter(Number.isFinite);
  const fallbackPrice = closes.at(-1);
  const price = latestBar?.c ?? fallbackPrice;

  if (price == null) {
    throw new Error("Unable to resolve latest underlying price from Alpaca.");
  }

  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const underlying: UnderlyingContext = {
    symbol: ticker,
    price,
    asOf: latestBar?.t ?? historicalBars.at(-1)?.t ?? new Date().toISOString(),
    trend: classifyAlpacaTrend(price, ma20, ma50, ma200),
    rsi14: calculateRsi14(closes),
    movingAverages: {
      ma20,
      ma50,
      ma200,
    },
  };
  const rawContracts = await getLiveOptionContracts(
    ticker,
    filters,
    strategy,
    price,
    env.ALPACA_OPTIONS_FEED,
    signal,
  );

  return {
    feed: env.ALPACA_OPTIONS_FEED,
    underlying,
    rawContracts,
    asOf: new Date().toISOString(),
  };
}

export async function probeOptionsFeed(
  ticker: string,
  feed: "opra" | "indicative",
  signal?: AbortSignal,
): Promise<AlpacaFeedProbeResult> {
  if (!hasAlpacaCredentials()) {
    return {
      ok: false,
      feed,
      ticker,
      status: null,
      message: "Alpaca credentials are not configured.",
    };
  }

  const env = getEnv();
  const providerSignal = withProviderTimeout(signal, 10_000);
  const url = new URL(
    `/v1beta1/options/snapshots/${ticker}`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );
  url.searchParams.set("feed", feed);
  url.searchParams.set("limit", "10");
  let status: number | null = null;

  try {
    return await observeProviderCall("alpaca", "feed_probe", async () => {
      const response = await fetch(url, {
        headers: alpacaHeaders(),
        cache: "no-store",
        opentelemetry: privateProviderFetchTracing,
        signal: providerSignal,
      });
      status = response.status;
      let body: { snapshots?: Record<string, unknown> } | null = null;

      try {
        body = await response.json() as {
          snapshots?: Record<string, unknown>;
        };
      } catch (error) {
        if (response.ok) {
          throw providerMalformedResponse(
            "Alpaca returned a malformed response.",
            error,
          );
        }
      }

      if (!response.ok) {
        throw providerHttpError(
          response.status,
          `Alpaca returned HTTP ${response.status}.`,
        );
      }

      if (!body) {
        throw providerMalformedResponse(
          "Alpaca returned an empty response.",
        );
      }

      return {
        ok: true,
        feed,
        ticker,
        status: response.status,
        message: `${feed} feed is reachable for ${ticker}.`,
        sampleContractCount: Object.keys(body.snapshots ?? {}).length,
      };
    });
  } catch {
    return {
      ok: false,
      feed,
      ticker,
      status,
      message: "Unable to probe the Alpaca options feed.",
    };
  }
}
