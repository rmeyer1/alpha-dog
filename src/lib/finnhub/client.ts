import { getEnv } from "@/lib/env";

export type FinnhubEarningsHour = "bmo" | "amc" | "dmh" | string;

export interface FinnhubEarningsEvent {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: FinnhubEarningsHour | null;
  quarter: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number | null;
}

interface FinnhubCalendarEarningsRow {
  date?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  hour?: FinnhubEarningsHour | null;
  quarter?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  symbol?: string;
  year?: number | null;
}

interface FinnhubCalendarEarningsResponse {
  earningsCalendar?: FinnhubCalendarEarningsRow[];
  error?: string;
}

export interface FinnhubEarningsSurprise {
  actual: number | null;
  estimate: number | null;
  period: string | null;
  quarter: number | null;
  surprise: number | null;
  surprisePercent: number | null;
  symbol: string;
  year: number | null;
}

export interface FinnhubDividend {
  amount: number | null;
  exDate: string;
  symbol: string;
}

export interface FinnhubCompanyNewsItem {
  category: string | null;
  datetime: number | null;
  headline: string;
  id: number | null;
  image: string | null;
  related: string | null;
  source: string | null;
  summary: string | null;
  url: string;
}

export interface FinnhubCompanyProfile {
  country: string | null;
  currency: string | null;
  exchange: string | null;
  finnhubIndustry: string | null;
  ipo: string | null;
  logo: string | null;
  marketCapitalization: number | null;
  name: string | null;
  phone: string | null;
  shareOutstanding: number | null;
  ticker: string;
  weburl: string | null;
}

export interface FinnhubBasicFinancials {
  metric: Record<string, unknown>;
  metricType: string | null;
  series: Record<string, unknown>;
  symbol: string;
}

export interface FinnhubRecommendationTrend {
  buy: number | null;
  hold: number | null;
  period: string | null;
  sell: number | null;
  strongBuy: number | null;
  strongSell: number | null;
  symbol: string;
}

export interface FinnhubCompanyInsights {
  dividends: FinnhubDividend[];
  earningsSurprises: FinnhubEarningsSurprise[];
  errors: Array<{
    message: string;
    section: string;
  }>;
  metrics: FinnhubBasicFinancials;
  news: FinnhubCompanyNewsItem[];
  profile: FinnhubCompanyProfile;
  recommendations: FinnhubRecommendationTrend[];
  symbol: string;
}

interface FinnhubEarningsSurpriseRow {
  actual?: number | null;
  estimate?: number | null;
  period?: string | null;
  quarter?: number | null;
  surprise?: number | null;
  surprisePercent?: number | null;
  symbol?: string;
  year?: number | null;
}

interface FinnhubDividendsResponse {
  data?: Array<{
    amount?: number | null;
    exDate?: string | null;
  }>;
  symbol?: string;
}

interface FinnhubCompanyNewsRow {
  category?: string | null;
  datetime?: number | null;
  headline?: string | null;
  id?: number | null;
  image?: string | null;
  related?: string | null;
  source?: string | null;
  summary?: string | null;
  url?: string | null;
}

interface FinnhubCompanyProfileResponse {
  country?: string | null;
  currency?: string | null;
  exchange?: string | null;
  finnhubIndustry?: string | null;
  ipo?: string | null;
  logo?: string | null;
  marketCapitalization?: number | null;
  name?: string | null;
  phone?: string | null;
  shareOutstanding?: number | null;
  ticker?: string | null;
  weburl?: string | null;
}

interface FinnhubBasicFinancialsResponse {
  metric?: Record<string, unknown>;
  metricType?: string | null;
  series?: Record<string, unknown>;
  symbol?: string | null;
}

interface FinnhubRecommendationTrendRow {
  buy?: number | null;
  hold?: number | null;
  period?: string | null;
  sell?: number | null;
  strongBuy?: number | null;
  strongSell?: number | null;
  symbol?: string | null;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function asNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIntegerOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setUTCDate(next.getUTCDate() + days);

  return next;
}

function baseFinnhubUrl() {
  const env = getEnv();

  if (!env.FINNHUB_API_KEY) {
    throw new Error("FINNHUB_API_KEY is not configured.");
  }

  return {
    baseUrl: env.FINNHUB_API_BASE_URL.endsWith("/")
      ? env.FINNHUB_API_BASE_URL
      : `${env.FINNHUB_API_BASE_URL}/`,
    token: env.FINNHUB_API_KEY,
  };
}

async function requestFinnhubJson<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  signal?: AbortSignal,
) {
  const { baseUrl, token } = baseFinnhubUrl();
  const url = new URL(path, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("token", token);

  const response = await fetch(url, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => null) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    const errorMessage = body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      ? body.error
      : `Finnhub returned HTTP ${response.status}.`;

    throw new Error(
      errorMessage,
    );
  }

  return body as T;
}

export function normalizeFinnhubEarningsEvent(
  row: FinnhubCalendarEarningsRow,
): FinnhubEarningsEvent | null {
  const symbol = row.symbol == null ? null : normalizeSymbol(row.symbol);
  const date = row.date?.trim();

  if (!symbol || !date) {
    return null;
  }

  return {
    date,
    epsActual: asNumberOrNull(row.epsActual),
    epsEstimate: asNumberOrNull(row.epsEstimate),
    hour: row.hour?.trim().toLowerCase() || null,
    quarter: asIntegerOrNull(row.quarter),
    revenueActual: asNumberOrNull(row.revenueActual),
    revenueEstimate: asNumberOrNull(row.revenueEstimate),
    symbol,
    year: asIntegerOrNull(row.year),
  };
}

export async function getFinnhubEarningsCalendar(options: {
  from: string;
  to: string;
  signal?: AbortSignal;
  symbol?: string;
}) {
  const body = await requestFinnhubJson<FinnhubCalendarEarningsResponse>(
    "calendar/earnings",
    {
      from: options.from,
      symbol: options.symbol == null
        ? undefined
        : normalizeSymbol(options.symbol),
      to: options.to,
    },
    options.signal,
  );

  return (body?.earningsCalendar ?? [])
    .map(normalizeFinnhubEarningsEvent)
    .filter((event): event is FinnhubEarningsEvent => event != null);
}

export function normalizeFinnhubEarningsSurprise(
  row: FinnhubEarningsSurpriseRow,
): FinnhubEarningsSurprise | null {
  const symbol = row.symbol == null ? null : normalizeSymbol(row.symbol);

  if (!symbol) {
    return null;
  }

  return {
    actual: asNumberOrNull(row.actual),
    estimate: asNumberOrNull(row.estimate),
    period: asStringOrNull(row.period),
    quarter: asIntegerOrNull(row.quarter),
    surprise: asNumberOrNull(row.surprise),
    surprisePercent: asNumberOrNull(row.surprisePercent),
    symbol,
    year: asIntegerOrNull(row.year),
  };
}

export async function getFinnhubEarningsSurprises(options: {
  limit?: number;
  signal?: AbortSignal;
  symbol: string;
}) {
  const body = await requestFinnhubJson<FinnhubEarningsSurpriseRow[]>(
    "stock/earnings",
    {
      limit: options.limit,
      symbol: normalizeSymbol(options.symbol),
    },
    options.signal,
  );

  return (body ?? [])
    .map(normalizeFinnhubEarningsSurprise)
    .filter((event): event is FinnhubEarningsSurprise => event != null);
}

export async function getFinnhubDividends(options: {
  signal?: AbortSignal;
  symbol: string;
}) {
  const symbol = normalizeSymbol(options.symbol);
  const body = await requestFinnhubJson<FinnhubDividendsResponse>(
    "stock/dividend2",
    { symbol },
    options.signal,
  );

  return (body?.data ?? [])
    .map((row): FinnhubDividend | null => {
      const exDate = asStringOrNull(row.exDate);

      return exDate
        ? {
            amount: asNumberOrNull(row.amount),
            exDate,
            symbol,
          }
        : null;
    })
    .filter((row): row is FinnhubDividend => row != null);
}

export async function getFinnhubCompanyNews(options: {
  from?: string;
  signal?: AbortSignal;
  symbol: string;
  to?: string;
}) {
  const to = options.to ?? dateOnly(new Date());
  const from = options.from ?? dateOnly(addDays(new Date(`${to}T00:00:00.000Z`), -7));
  const body = await requestFinnhubJson<FinnhubCompanyNewsRow[]>(
    "company-news",
    {
      from,
      symbol: normalizeSymbol(options.symbol),
      to,
    },
    options.signal,
  );

  return (body ?? [])
    .map((row): FinnhubCompanyNewsItem | null => {
      const headline = asStringOrNull(row.headline);
      const url = asStringOrNull(row.url);

      return headline && url
        ? {
            category: asStringOrNull(row.category),
            datetime: asIntegerOrNull(row.datetime),
            headline,
            id: asIntegerOrNull(row.id),
            image: asStringOrNull(row.image),
            related: asStringOrNull(row.related),
            source: asStringOrNull(row.source),
            summary: asStringOrNull(row.summary),
            url,
          }
        : null;
    })
    .filter((row): row is FinnhubCompanyNewsItem => row != null);
}

export async function getFinnhubCompanyProfile(options: {
  signal?: AbortSignal;
  symbol: string;
}) {
  const symbol = normalizeSymbol(options.symbol);
  const body = await requestFinnhubJson<FinnhubCompanyProfileResponse>(
    "stock/profile2",
    { symbol },
    options.signal,
  );

  return {
    country: asStringOrNull(body?.country),
    currency: asStringOrNull(body?.currency),
    exchange: asStringOrNull(body?.exchange),
    finnhubIndustry: asStringOrNull(body?.finnhubIndustry),
    ipo: asStringOrNull(body?.ipo),
    logo: asStringOrNull(body?.logo),
    marketCapitalization: asNumberOrNull(body?.marketCapitalization),
    name: asStringOrNull(body?.name),
    phone: asStringOrNull(body?.phone),
    shareOutstanding: asNumberOrNull(body?.shareOutstanding),
    ticker: asStringOrNull(body?.ticker) ?? symbol,
    weburl: asStringOrNull(body?.weburl),
  } satisfies FinnhubCompanyProfile;
}

export async function getFinnhubBasicFinancials(options: {
  metric?: string;
  signal?: AbortSignal;
  symbol: string;
}) {
  const symbol = normalizeSymbol(options.symbol);
  const body = await requestFinnhubJson<FinnhubBasicFinancialsResponse>(
    "stock/metric",
    {
      metric: options.metric ?? "all",
      symbol,
    },
    options.signal,
  );

  return {
    metric: body?.metric ?? {},
    metricType: asStringOrNull(body?.metricType),
    series: body?.series ?? {},
    symbol: asStringOrNull(body?.symbol) ?? symbol,
  } satisfies FinnhubBasicFinancials;
}

export async function getFinnhubRecommendationTrends(options: {
  signal?: AbortSignal;
  symbol: string;
}) {
  const body = await requestFinnhubJson<FinnhubRecommendationTrendRow[]>(
    "stock/recommendation",
    { symbol: normalizeSymbol(options.symbol) },
    options.signal,
  );

  return (body ?? []).map((row) => ({
    buy: asIntegerOrNull(row.buy),
    hold: asIntegerOrNull(row.hold),
    period: asStringOrNull(row.period),
    sell: asIntegerOrNull(row.sell),
    strongBuy: asIntegerOrNull(row.strongBuy),
    strongSell: asIntegerOrNull(row.strongSell),
    symbol: asStringOrNull(row.symbol) ?? normalizeSymbol(options.symbol),
  } satisfies FinnhubRecommendationTrend));
}

export async function getFinnhubCompanyInsights(options: {
  newsFrom?: string;
  newsTo?: string;
  signal?: AbortSignal;
  symbol: string;
}) {
  const symbol = normalizeSymbol(options.symbol);
  const [
    dividendsResult,
    earningsSurprisesResult,
    metricsResult,
    newsResult,
    profileResult,
    recommendationsResult,
  ] = await Promise.allSettled([
    getFinnhubDividends({ signal: options.signal, symbol }),
    getFinnhubEarningsSurprises({ limit: 4, signal: options.signal, symbol }),
    getFinnhubBasicFinancials({ signal: options.signal, symbol }),
    getFinnhubCompanyNews({
      from: options.newsFrom,
      signal: options.signal,
      symbol,
      to: options.newsTo,
    }),
    getFinnhubCompanyProfile({ signal: options.signal, symbol }),
    getFinnhubRecommendationTrends({ signal: options.signal, symbol }),
  ]);
  const errors: FinnhubCompanyInsights["errors"] = [];

  function valueOrDefault<T>(
    section: string,
    result: PromiseSettledResult<T>,
    fallback: T,
  ) {
    if (result.status === "fulfilled") {
      return result.value;
    }

    errors.push({
      message: result.reason instanceof Error
        ? result.reason.message
        : "Finnhub section request failed.",
      section,
    });

    return fallback;
  }

  return {
    dividends: valueOrDefault("dividends", dividendsResult, []),
    earningsSurprises: valueOrDefault(
      "earningsSurprises",
      earningsSurprisesResult,
      [],
    ),
    errors,
    metrics: valueOrDefault("metrics", metricsResult, {
      metric: {},
      metricType: null,
      series: {},
      symbol,
    }),
    news: valueOrDefault("news", newsResult, []),
    profile: valueOrDefault("profile", profileResult, {
      country: null,
      currency: null,
      exchange: null,
      finnhubIndustry: null,
      ipo: null,
      logo: null,
      marketCapitalization: null,
      name: null,
      phone: null,
      shareOutstanding: null,
      ticker: symbol,
      weburl: null,
    }),
    recommendations: valueOrDefault(
      "recommendations",
      recommendationsResult,
      [],
    ),
    symbol,
  } satisfies FinnhubCompanyInsights;
}
