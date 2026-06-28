import {
  getAlpacaAsset,
  getHistoricalDailyBars,
  getStockSnapshotBySymbol,
  type AlpacaAsset,
  type AlpacaBar,
  type AlpacaStockSnapshot,
} from "@/lib/alpaca/client";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { round } from "@/lib/wheel/calculations";

export type { AlpacaAsset, AlpacaBar, AlpacaStockSnapshot } from "@/lib/alpaca/client";

export interface CompanyProfile {
  ticker: string;
  market: EquityMarketProfile;
  signalScribe: SignalScribeProfile;
}

export interface EquityMarketProfile {
  status: "available" | "not_configured" | "error";
  message?: string;
  asset: AlpacaAsset | null;
  snapshot: AlpacaStockSnapshot | null;
  bars: AlpacaBar[];
  stats: EquityStats | null;
  asOf: string | null;
}

export interface EquityStats {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  weekReturn: number | null;
  monthReturn: number | null;
  threeMonthReturn: number | null;
  sixMonthReturn: number | null;
  yearReturn: number | null;
  high52Week: number | null;
  low52Week: number | null;
  averageVolume20Day: number | null;
  volumeVsAverage20Day: number | null;
}

export interface SignalScribeProfile {
  status: "available" | "not_configured" | "not_found" | "error";
  message?: string;
  company: SignalScribeCompany | null;
  filings: SignalScribeFiling[];
  analyses: SignalScribeAnalysis[];
  financialFacts: SignalScribeFinancialFact[];
  sections: SignalScribeSection[];
}

export interface SignalScribeCompany {
  id: string;
  ticker: string;
  cik: string;
  company_name: string;
  exchange: string | null;
  sic: string | null;
  sector: string | null;
  industry: string | null;
}

export interface SignalScribeFiling {
  id: string;
  accession_number: string;
  form_type: string;
  filing_date: string | null;
  report_date: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  sec_url: string | null;
  primary_document_url: string | null;
}

export interface SignalScribeAnalysis {
  id: string;
  accession_number: string;
  form_type: string;
  summary: string;
  business_summary: string | null;
  key_findings: unknown[];
  red_flags: unknown[];
  catalysts: unknown[];
  financial_summary: unknown[];
  management_tone: string | null;
  risk_score: number | string | null;
  quality_score: number | string | null;
  source_citations: unknown[];
  created_at: string;
}

export interface SignalScribeFinancialFact {
  id: string;
  metric_name: string;
  value: number | string | null;
  unit: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  accession_number: string | null;
}

export interface SignalScribeSection {
  id: string;
  filing_id: string;
  section_name: string;
  chunk_index: number;
  section_text: string;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function returnFromBars(bars: AlpacaBar[], sessionsAgo: number) {
  if (bars.length <= sessionsAgo) {
    return null;
  }

  const latest = bars.at(-1)?.c;
  const previous = bars.at(-(sessionsAgo + 1))?.c;

  if (!latest || !previous) {
    return null;
  }

  return round((latest - previous) / previous, 4);
}

function buildEquityStats(
  snapshot: AlpacaStockSnapshot | null,
  bars: AlpacaBar[],
): EquityStats | null {
  const latestBar = snapshot?.dailyBar ?? bars.at(-1);
  const previousBar = snapshot?.prevDailyBar ?? bars.at(-2);
  const price = snapshot?.latestTrade?.p ?? latestBar?.c ?? null;

  if (price == null) {
    return null;
  }

  const change = previousBar?.c == null ? null : round(price - previousBar.c, 2);
  const changePercent =
    previousBar?.c == null ? null : round((price - previousBar.c) / previousBar.c, 4);
  const lastYear = bars.slice(-252);
  const high52Week = lastYear.length
    ? Math.max(...lastYear.map((bar) => bar.h))
    : null;
  const low52Week = lastYear.length
    ? Math.min(...lastYear.map((bar) => bar.l))
    : null;
  const last20 = bars.slice(-20);
  const averageVolume20Day = last20.length
    ? Math.round(last20.reduce((sum, bar) => sum + bar.v, 0) / last20.length)
    : null;
  const volume = latestBar?.v ?? null;

  return {
    price,
    change,
    changePercent,
    weekReturn: returnFromBars(bars, 5),
    monthReturn: returnFromBars(bars, 21),
    threeMonthReturn: returnFromBars(bars, 63),
    sixMonthReturn: returnFromBars(bars, 126),
    yearReturn: returnFromBars(bars, 252),
    high52Week,
    low52Week,
    averageVolume20Day,
    volumeVsAverage20Day:
      volume == null || averageVolume20Day == null
        ? null
        : round(volume / averageVolume20Day, 2),
  };
}

async function getEquityMarketProfile(ticker: string): Promise<EquityMarketProfile> {
  if (!hasAlpacaCredentials()) {
    return {
      status: "not_configured",
      message: "Alpaca credentials are not configured.",
      asset: null,
      snapshot: null,
      bars: [],
      stats: null,
      asOf: null,
    };
  }

  try {
    const [assetResult, snapshotResult, barsResult] = await Promise.allSettled([
      getAlpacaAsset(ticker),
      getStockSnapshotBySymbol(ticker),
      getHistoricalDailyBars(ticker, {
        adjustment: "all",
        daysBack: 540,
      }),
    ]);
    const asset = assetResult.status === "fulfilled" ? assetResult.value : null;
    const snapshot =
      snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
    const bars = barsResult.status === "fulfilled" ? barsResult.value : [];

    if (!snapshot && bars.length === 0 && !asset) {
      const errors = [assetResult, snapshotResult, barsResult]
        .filter((result) => result.status === "rejected")
        .map((result) =>
          result.status === "rejected" && result.reason instanceof Error
            ? result.reason.message
            : "Alpaca request failed.",
        );

      throw new Error(errors[0] ?? "No Alpaca market data was returned.");
    }

    return {
      status: "available",
      asset,
      snapshot,
      bars,
      stats: buildEquityStats(snapshot, bars),
      asOf:
        snapshot?.latestTrade?.t ??
        snapshot?.dailyBar?.t ??
        bars.at(-1)?.t ??
        new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unable to load Alpaca data.",
      asset: null,
      snapshot: null,
      bars: [],
      stats: null,
      asOf: null,
    };
  }
}

function signalScribeConfig() {
  const env = getEnv();
  const url = env.SIGNAL_SCRIBE_SUPABASE_URL ?? env.SUPABASE_URL;
  const serviceRoleKey =
    env.SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY;

  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function fetchSignalScribeRows<T>(
  table: string,
  params: Record<string, string>,
) {
  const config = signalScribeConfig();

  if (!config) {
    return null;
  }

  const url = new URL(`/rest/v1/${table}`, config.url);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Supabase returned HTTP ${response.status}.`;

    throw new Error(message);
  }

  return Array.isArray(body) ? (body as T[]) : [];
}

function filingIdFilter(filings: SignalScribeFiling[]) {
  const ids = filings.slice(0, 3).map((filing) => filing.id);

  if (ids.length === 0) {
    return null;
  }

  return `in.(${ids.join(",")})`;
}

async function getSignalScribeProfile(
  ticker: string,
): Promise<SignalScribeProfile> {
  if (!signalScribeConfig()) {
    return {
      status: "not_configured",
      message:
        "Set SIGNAL_SCRIBE_SUPABASE_URL and SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY to load SEC filing intelligence.",
      company: null,
      filings: [],
      analyses: [],
      financialFacts: [],
      sections: [],
    };
  }

  try {
    const [companies, analysesByTicker] = await Promise.all([
      fetchSignalScribeRows<SignalScribeCompany>("companies", {
        select:
          "id,ticker,cik,company_name,exchange,sic,sector,industry",
        ticker: `eq.${ticker}`,
        limit: "1",
      }),
      fetchSignalScribeRows<SignalScribeAnalysis>("filing_analysis", {
        select:
          "id,accession_number,form_type,summary,business_summary,key_findings,red_flags,catalysts,financial_summary,management_tone,risk_score,quality_score,source_citations,created_at",
        company_ticker: `eq.${ticker}`,
        order: "created_at.desc",
        limit: "6",
      }),
    ]);
    const company = companies?.[0] ?? null;
    const [filings, financialFacts] = company
      ? await Promise.all([
          fetchSignalScribeRows<SignalScribeFiling>("filings", {
            select:
              "id,accession_number,form_type,filing_date,report_date,fiscal_year,fiscal_period,sec_url,primary_document_url",
            company_id: `eq.${company.id}`,
            order: "filing_date.desc.nullslast",
            limit: "12",
          }),
          fetchSignalScribeRows<SignalScribeFinancialFact>("financial_facts", {
            select:
              "id,metric_name,value,unit,fiscal_year,fiscal_period,accession_number",
            company_id: `eq.${company.id}`,
            order: "fiscal_year.desc.nullslast,fiscal_period.desc.nullslast",
            limit: "80",
          }),
        ])
      : [[], []];
    const filingFilter = filingIdFilter(filings ?? []);
    const sections = filingFilter
      ? await fetchSignalScribeRows<SignalScribeSection>("filing_sections", {
          select: "id,filing_id,section_name,chunk_index,section_text",
          filing_id: filingFilter,
          order: "created_at.desc",
          limit: "8",
        })
      : [];

    if (!company && (!analysesByTicker || analysesByTicker.length === 0)) {
      return {
        status: "not_found",
        company: null,
        filings: [],
        analyses: [],
        financialFacts: [],
        sections: [],
      };
    }

    return {
      status: "available",
      company,
      filings: filings ?? [],
      analyses: analysesByTicker ?? [],
      financialFacts: financialFacts ?? [],
      sections: sections ?? [],
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load signal-scribe data.",
      company: null,
      filings: [],
      analyses: [],
      financialFacts: [],
      sections: [],
    };
  }
}

export async function getCompanyProfile(tickerInput: string) {
  const ticker = normalizeTicker(tickerInput);
  const [market, signalScribe] = await Promise.all([
    getEquityMarketProfile(ticker),
    getSignalScribeProfile(ticker),
  ]);

  return {
    ticker,
    market,
    signalScribe,
  } satisfies CompanyProfile;
}
