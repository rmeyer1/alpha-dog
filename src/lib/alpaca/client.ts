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

interface AlpacaAsset {
  symbol: string;
  name?: string | null;
  exchange: string;
  asset_class: string;
  status: string;
  tradable: boolean;
  attributes?: string[];
}

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

async function fetchAlpacaJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: alpacaHeaders(),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(
      body?.message ?? `Alpaca returned HTTP ${response.status}.`,
    );
  }

  if (!body) {
    throw new Error("Alpaca returned an empty response.");
  }

  return body;
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
  const strikeMin =
    optionType === "put" ? underlyingPrice * 0.6 : underlyingPrice * 0.95;
  const strikeMax =
    optionType === "put" ? underlyingPrice * 1.02 : underlyingPrice * 1.4;

  url.searchParams.set("underlying_symbols", ticker);
  url.searchParams.set("status", "active");
  url.searchParams.set("type", optionType);
  url.searchParams.set("expiration_date_gte", formatDate(addDays(now, filters.dteMin)));
  url.searchParams.set("expiration_date_lte", formatDate(addDays(now, filters.dteMax)));
  url.searchParams.set("strike_price_gte", String(round(strikeMin, 2)));
  url.searchParams.set("strike_price_lte", String(round(strikeMax, 2)));
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

function normalizeContract(
  contract: AlpacaOptionContract,
  snapshot: AlpacaOptionSnapshot | undefined,
): RawOptionContract | null {
  const bid = snapshot?.latestQuote?.bp;
  const ask = snapshot?.latestQuote?.ap;

  if (bid == null || ask == null) {
    return null;
  }

  return {
    contractSymbol: contract.symbol,
    optionType: contract.type,
    strike: Number(contract.strike_price),
    expirationDate: contract.expiration_date,
    bid,
    ask,
    delta: snapshot?.greeks?.delta ?? null,
    theta: snapshot?.greeks?.theta ?? null,
    impliedVolatility: snapshot?.impliedVolatility ?? null,
    volume: snapshot?.dailyBar?.v ?? null,
    openInterest:
      contract.open_interest == null ? null : Number(contract.open_interest),
  };
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

export async function getLiveWheelMarketData(
  ticker: string,
  filters: WheelFilters,
  strategy?: WheelCompanyStrategy,
) {
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
  const contracts = (
    await Promise.all(
      optionTypesForStrategy(strategy).map((optionType) =>
        getOptionContracts(ticker, optionType, filters, price)
      ),
    )
  ).flat();
  const snapshots = await getSnapshotsBySymbols(
    contracts.map((contract) => contract.symbol),
    env.ALPACA_OPTIONS_FEED,
  );
  const rawContracts = contracts
    .map((contract) => normalizeContract(contract, snapshots[contract.symbol]))
    .filter((contract) => contract != null);

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
