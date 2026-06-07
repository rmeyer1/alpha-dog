import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { round } from "@/lib/wheel/calculations";
import type {
  OptionType,
  RawOptionContract,
  Trend,
  UnderlyingContext,
  WheelCompanyStrategy,
  WheelFilters,
} from "@/lib/wheel/types";

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

function alpacaHeaders() {
  const env = getEnv();

  if (!env.APCA_API_KEY_ID || !env.APCA_API_SECRET_KEY) {
    throw new Error("Alpaca credentials are not configured.");
  }

  return {
    "APCA-API-KEY-ID": env.APCA_API_KEY_ID,
    "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY,
  };
}

interface AlpacaOptionContract {
  symbol: string;
  expiration_date: string;
  type: OptionType;
  strike_price: string;
  open_interest?: string | null;
  tradable?: boolean;
}

interface AlpacaBar {
  c: number;
  h: number;
  l: number;
  o: number;
  t: string;
  v: number;
  vw?: number;
}

interface AlpacaOptionSnapshot {
  dailyBar?: AlpacaBar;
  greeks?: {
    delta?: number;
    theta?: number;
  };
  impliedVolatility?: number;
  latestQuote?: {
    ap?: number;
    bp?: number;
    t?: string;
  };
}

interface AlpacaContractsResponse {
  option_contracts?: AlpacaOptionContract[];
  next_page_token?: string | null;
  message?: string;
}

interface AlpacaSnapshotsResponse {
  snapshots?: Record<string, AlpacaOptionSnapshot>;
  next_page_token?: string | null;
  message?: string;
}

interface AlpacaBarsResponse {
  bars?: AlpacaBar[];
  message?: string;
}

interface AlpacaLatestBarResponse {
  bar?: AlpacaBar;
  message?: string;
}

interface AlpacaHttpErrorOptions {
  message: string;
  requestId: string | null;
  retryAfterMs: number | null;
  status: number;
}

interface AlpacaAsset {
  symbol: string;
  name?: string | null;
  exchange: string;
  asset_class: string;
  status: string;
  tradable: boolean;
  attributes?: string[];
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

const ALPACA_RETRY_DELAYS_MS = [250, 750, 1500, 3000];
const ALPACA_MAX_RETRY_AFTER_MS = 30 * 1000;
const ALPACA_OPTION_SNAPSHOT_LIMIT = 1000;
const LIVE_MARKET_DATA_CACHE_TTL_MS = 2 * 60 * 1000;

const liveMarketDataCache = new Map<string, LiveWheelMarketDataCacheEntry>();
const liveMarketDataInFlight = new Map<string, Promise<LiveWheelMarketData>>();

class AlpacaHttpError extends Error {
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;
  readonly status: number;

  constructor(options: AlpacaHttpErrorOptions) {
    super(options.message);
    this.name = "AlpacaHttpError";
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}

class AlpacaRequestLimiter {
  private activeCount = 0;
  private burstCapacity = 1;
  private queue: Array<(release: () => void) => void> = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;
  private refillTokensPerMs = 1 / 1000;
  private tokens = 1;
  private updatedAtMs = Date.now();

  acquire() {
    if (rateLimiterDisabled()) {
      return Promise.resolve(() => {});
    }

    this.configure();

    return new Promise<() => void>((resolve) => {
      this.queue.push(resolve);
      this.pump();
    });
  }

  private configure() {
    const env = getEnv();
    const rateLimitPerMinute = env.ALPACA_MARKET_DATA_RATE_LIMIT_PER_MINUTE;
    const maxConcurrency = env.ALPACA_MARKET_DATA_MAX_CONCURRENCY;
    const nextBurstCapacity = Math.max(
      1,
      Math.min(maxConcurrency * 2, Math.ceil(rateLimitPerMinute / 60)),
    );
    const nextRefillTokensPerMs = rateLimitPerMinute / 60_000;

    this.refill();
    this.burstCapacity = nextBurstCapacity;
    this.refillTokensPerMs = nextRefillTokensPerMs;
    this.tokens = Math.min(this.tokens, this.burstCapacity);
  }

  private refill(nowMs = Date.now()) {
    const elapsedMs = Math.max(0, nowMs - this.updatedAtMs);

    this.updatedAtMs = nowMs;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + elapsedMs * this.refillTokensPerMs,
    );
  }

  private scheduleRefill() {
    if (this.refillTimer || this.queue.length === 0) {
      return;
    }

    if (
      this.tokens >= 1 ||
      this.activeCount >= getEnv().ALPACA_MARKET_DATA_MAX_CONCURRENCY
    ) {
      return;
    }

    const waitMs = Math.max(
      1,
      Math.ceil((1 - this.tokens) / this.refillTokensPerMs),
    );

    this.refillTimer = setTimeout(() => {
      this.refillTimer = null;
      this.pump();
    }, waitMs);
  }

  private pump() {
    this.configure();

    const maxConcurrency = getEnv().ALPACA_MARKET_DATA_MAX_CONCURRENCY;

    while (
      this.queue.length > 0 &&
      this.activeCount < maxConcurrency &&
      this.tokens >= 1
    ) {
      const resolve = this.queue.shift();

      if (!resolve) {
        continue;
      }

      this.tokens -= 1;
      this.activeCount += 1;
      let released = false;
      resolve(() => {
        if (released) {
          return;
        }

        released = true;
        this.activeCount -= 1;
        this.pump();
      });
    }

    this.scheduleRefill();
  }
}

const alpacaRequestLimiter = new AlpacaRequestLimiter();

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function strikeBoundsForOptionType(
  optionType: OptionType,
  underlyingPrice: number,
) {
  return {
    min: optionType === "put" ? underlyingPrice * 0.6 : underlyingPrice * 0.95,
    max: optionType === "put" ? underlyingPrice * 1.02 : underlyingPrice * 1.4,
  };
}

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

function rateLimiterDisabled() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers | undefined) {
  if (!headers) {
    return null;
  }

  const retryAfter = headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds)) {
      return Math.min(ALPACA_MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
    }

    const retryAtMs = new Date(retryAfter).getTime();

    if (Number.isFinite(retryAtMs)) {
      return Math.min(
        ALPACA_MAX_RETRY_AFTER_MS,
        Math.max(0, retryAtMs - Date.now()),
      );
    }
  }

  const reset = headers.get("x-ratelimit-reset");

  if (!reset) {
    return null;
  }

  const resetNumber = Number(reset);

  if (!Number.isFinite(resetNumber)) {
    return null;
  }

  const resetMs = resetNumber < 10_000_000_000
    ? resetNumber * 1000
    : resetNumber;

  return Math.min(ALPACA_MAX_RETRY_AFTER_MS, Math.max(0, resetMs - Date.now()));
}

function shouldRetryAlpacaStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function alpacaErrorMessage(
  status: number,
  requestId: string | null,
  message: string | undefined,
) {
  const base = message ?? `Alpaca returned HTTP ${status}.`;

  return requestId ? `${base} Request ID: ${requestId}.` : base;
}

async function fetchAlpacaJson<T>(url: URL): Promise<T> {
  for (let attempt = 0; attempt <= ALPACA_RETRY_DELAYS_MS.length; attempt += 1) {
    const release = await alpacaRequestLimiter.acquire();
    let released = false;

    try {
      const response = await fetch(url, {
        headers: alpacaHeaders(),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | (T & { message?: string })
        | null;
      const requestId = response.headers?.get("x-request-id") ?? null;

      if (response.ok) {
        if (!body) {
          throw new Error("Alpaca returned an empty response.");
        }

        return body;
      }

      const error = new AlpacaHttpError({
        message: alpacaErrorMessage(response.status, requestId, body?.message),
        requestId,
        retryAfterMs: parseRetryAfterMs(response.headers),
        status: response.status,
      });

      if (
        attempt < ALPACA_RETRY_DELAYS_MS.length &&
        shouldRetryAlpacaStatus(response.status)
      ) {
        release();
        released = true;
        await wait(error.retryAfterMs ?? ALPACA_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      throw error;
    } finally {
      if (!released) {
        release();
      }
    }
  }

  throw new Error("Alpaca request failed after retries.");
}

async function getAssetsByExchange(exchange: "NYSE" | "NASDAQ") {
  const env = getEnv();
  const url = new URL("/v2/assets", env.ALPACA_TRADING_BASE_URL);

  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");
  url.searchParams.set("exchange", exchange);

  return fetchAlpacaJson<AlpacaAsset[]>(url);
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

  return fetchAlpacaJson<AlpacaContractsResponse>(url);
}

async function getOptionContracts(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
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
  pageToken?: string,
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

  if (pageToken) {
    url.searchParams.set("page_token", pageToken);
  }

  return fetchAlpacaJson<AlpacaSnapshotsResponse>(url);
}

async function getOptionChainSnapshots(
  ticker: string,
  optionType: OptionType,
  filters: WheelFilters,
  underlyingPrice: number,
  feed: "opra" | "indicative",
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
      pageToken,
    );
    Object.assign(snapshots, page.snapshots ?? {});
    pageToken = page.next_page_token ?? undefined;
  } while (pageToken);

  return snapshots;
}

async function getSnapshotsBySymbols(symbols: string[], feed: "opra" | "indicative") {
  const env = getEnv();
  const snapshots: Record<string, AlpacaOptionSnapshot> = {};

  for (const symbolChunk of chunk(symbols, 100)) {
    const url = new URL(
      "/v1beta1/options/snapshots",
      env.ALPACA_MARKET_DATA_BASE_URL,
    );
    url.searchParams.set("feed", feed);
    url.searchParams.set("symbols", symbolChunk.join(","));

    const body = await fetchAlpacaJson<AlpacaSnapshotsResponse>(url);
    Object.assign(snapshots, body.snapshots ?? {});
  }

  return snapshots;
}

async function getHistoricalDailyBars(ticker: string) {
  const env = getEnv();
  const url = new URL(
    `/v2/stocks/${ticker}/bars`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );

  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", formatDate(addDays(new Date(), -520)));
  url.searchParams.set("limit", "10000");
  url.searchParams.set("adjustment", "raw");
  url.searchParams.set("feed", "iex");

  const body = await fetchAlpacaJson<AlpacaBarsResponse>(url);

  return body.bars ?? [];
}

async function getLatestStockBar(ticker: string) {
  const env = getEnv();
  const url = new URL(
    `/v2/stocks/${ticker}/bars/latest`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );

  url.searchParams.set("feed", "iex");

  const body = await fetchAlpacaJson<AlpacaLatestBarResponse>(url);

  return body.bar;
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

function parseOptionSymbol(symbol: string) {
  const parsed = /^(.+)(\d{6})([CP])(\d{8})$/.exec(symbol);

  if (!parsed) {
    return null;
  }

  const [, , rawDate, rawOptionType, rawStrike] = parsed;
  const year = Number(rawDate.slice(0, 2));
  const month = rawDate.slice(2, 4);
  const day = rawDate.slice(4, 6);
  const strike = Number(rawStrike) / 1000;

  if (!Number.isFinite(strike)) {
    return null;
  }

  return {
    expirationDate: `20${year.toString().padStart(2, "0")}-${month}-${day}`,
    optionType: rawOptionType === "P" ? "put" as const : "call" as const,
    strike,
  };
}

function normalizeSnapshotContract(
  symbol: string,
  snapshot: AlpacaOptionSnapshot,
  contractMetadata?: AlpacaOptionContract,
): RawOptionContract | null {
  const parsed = parseOptionSymbol(symbol);
  const bid = snapshot.latestQuote?.bp;
  const ask = snapshot.latestQuote?.ap;

  if (!parsed || bid == null || ask == null) {
    return null;
  }

  return {
    contractSymbol: symbol,
    optionType: contractMetadata?.type ?? parsed.optionType,
    strike: contractMetadata?.strike_price == null
      ? parsed.strike
      : Number(contractMetadata.strike_price),
    expirationDate: contractMetadata?.expiration_date ?? parsed.expirationDate,
    bid,
    ask,
    delta: snapshot.greeks?.delta ?? null,
    theta: snapshot.greeks?.theta ?? null,
    impliedVolatility: snapshot.impliedVolatility ?? null,
    volume: snapshot.dailyBar?.v ?? null,
    openInterest:
      contractMetadata?.open_interest == null
        ? null
        : Number(contractMetadata.open_interest),
  };
}

function contractMetadataBySymbol(contracts: AlpacaOptionContract[]) {
  return new Map(contracts.map((contract) => [contract.symbol, contract]));
}

async function getContractsForOptionTypes(
  ticker: string,
  optionTypes: readonly OptionType[],
  filters: WheelFilters,
  underlyingPrice: number,
) {
  return (
    await Promise.all(
      optionTypes.map((optionType) =>
        getOptionContracts(ticker, optionType, filters, underlyingPrice),
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
) {
  const optionTypes = optionTypesForStrategy(strategy);
  const [metadataResult, chainResult] = await Promise.allSettled([
    getContractsForOptionTypes(ticker, optionTypes, filters, underlyingPrice),
    getChainSnapshotsForOptionTypes(
      ticker,
      optionTypes,
      filters,
      underlyingPrice,
      feed,
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

export async function getLiveWheelMarketData(
  ticker: string,
  filters: WheelFilters,
  strategy?: WheelCompanyStrategy,
  options: { forceRefresh?: boolean } = {},
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

  const inFlight = fetchLiveWheelMarketData(ticker, filters, strategy)
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
): Promise<LiveWheelMarketData> {
  const env = getEnv();
  const [latestBar, historicalBars] = await Promise.all([
    getLatestStockBar(ticker),
    getHistoricalDailyBars(ticker),
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
    trend: classifyTrend(price, ma20, ma50, ma200),
    rsi14: rsi14(closes),
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
  const url = new URL(
    `/v1beta1/options/snapshots/${ticker}`,
    env.ALPACA_MARKET_DATA_BASE_URL,
  );
  url.searchParams.set("feed", feed);
  url.searchParams.set("limit", "10");

  try {
    const response = await fetch(url, {
      headers: alpacaHeaders(),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | { snapshots?: Record<string, unknown>; message?: string }
      | null;

    if (!response.ok) {
      return {
        ok: false,
        feed,
        ticker,
        status: response.status,
        message:
          body?.message ??
          `Alpaca returned HTTP ${response.status} for ${feed} feed.`,
      };
    }

    return {
      ok: true,
      feed,
      ticker,
      status: response.status,
      message: `${feed} feed is reachable for ${ticker}.`,
      sampleContractCount: Object.keys(body?.snapshots ?? {}).length,
    };
  } catch (error) {
    return {
      ok: false,
      feed,
      ticker,
      status: null,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error while probing Alpaca feed.",
    };
  }
}
