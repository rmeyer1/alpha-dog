import { getFinnhubEarningsCalendar } from "@/lib/finnhub/client";
import { getEnv, hasFinnhubCredentials } from "@/lib/env";
import { requestSupabaseRest } from "@/lib/supabase/rest";

export interface EarningsEvent {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string | null;
  quarter: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  source: "finnhub";
  symbol: string;
  year: number | null;
}

export interface EarningsRiskContext {
  asOf: string | null;
  coverageThrough: string | null;
  events: EarningsEvent[];
  providerEnabled: boolean;
  symbol: string;
}

interface EarningsEventRow {
  as_of: string;
  earnings_date: string;
  eps_actual: number | string | null;
  eps_estimate: number | string | null;
  hour: string | null;
  quarter: number | null;
  revenue_actual: number | string | null;
  revenue_estimate: number | string | null;
  source: string;
  symbol: string;
  year: number | null;
}

interface EarningsRefreshRunRow {
  completed_at: string | null;
  to_date: string;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setUTCDate(next.getUTCDate() + days);

  return next;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function toNumberOrNull(value: number | string | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function fromRow(row: EarningsEventRow): EarningsEvent {
  return {
    date: row.earnings_date,
    epsActual: toNumberOrNull(row.eps_actual),
    epsEstimate: toNumberOrNull(row.eps_estimate),
    hour: row.hour,
    quarter: row.quarter,
    revenueActual: toNumberOrNull(row.revenue_actual),
    revenueEstimate: toNumberOrNull(row.revenue_estimate),
    source: "finnhub",
    symbol: normalizeSymbol(row.symbol),
    year: row.year,
  };
}

export function earningsProviderEnabled() {
  const env = getEnv();

  return env.EARNINGS_PROVIDER_ENABLED && hasFinnhubCredentials();
}

export function earningsRefreshWindow(now = new Date()) {
  const env = getEnv();
  const from = dateOnly(now);
  const lookaheadDays = Math.min(env.FINNHUB_EARNINGS_LOOKAHEAD_DAYS, 31);
  const to = dateOnly(addDays(now, lookaheadDays));

  return { from, to };
}

async function createRefreshRun(fromDate: string, toDate: string) {
  const rows = await requestSupabaseRest<Array<{ id: string }>>(
    "earnings_refresh_runs",
    {
      body: {
        from_date: fromDate,
        source: "finnhub",
        status: "running",
        to_date: toDate,
      },
      method: "POST",
      prefer: "return=representation",
    },
  );

  return rows?.[0]?.id ?? null;
}

async function completeRefreshRun(
  runId: string | null,
  summary: {
    eventsCount: number;
    fromDate: string;
    symbolsCount: number;
    toDate: string;
  },
) {
  if (!runId) {
    return;
  }

  await requestSupabaseRest<null>("earnings_refresh_runs", {
    body: {
      completed_at: new Date().toISOString(),
      events_count: summary.eventsCount,
      status: "completed",
      summary,
      symbols_count: summary.symbolsCount,
    },
    method: "PATCH",
    query: {
      id: `eq.${runId}`,
    },
  });
}

async function failRefreshRun(runId: string | null, error: unknown) {
  if (!runId) {
    return;
  }

  await requestSupabaseRest<null>("earnings_refresh_runs", {
    body: {
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Earnings refresh failed.",
      status: "failed",
    },
    method: "PATCH",
    query: {
      id: `eq.${runId}`,
    },
  });
}

export async function refreshFinnhubEarningsCache(options?: {
  from?: string;
  now?: Date;
  to?: string;
}) {
  if (!earningsProviderEnabled()) {
    throw new Error(
      "Finnhub earnings provider is disabled or FINNHUB_API_KEY is not configured.",
    );
  }

  const window = earningsRefreshWindow(options?.now);
  const from = options?.from ?? window.from;
  const to = options?.to ?? window.to;
  const runId = await createRefreshRun(from, to);

  try {
    const events = await getFinnhubEarningsCalendar({ from, to });
    const asOf = new Date().toISOString();
    const rows = events.map((event) => ({
      as_of: asOf,
      earnings_date: event.date,
      eps_actual: event.epsActual,
      eps_estimate: event.epsEstimate,
      hour: event.hour,
      quarter: event.quarter,
      revenue_actual: event.revenueActual,
      revenue_estimate: event.revenueEstimate,
      source: "finnhub",
      symbol: event.symbol,
      year: event.year,
    }));

    if (rows.length > 0) {
      await requestSupabaseRest<null>("earnings_events", {
        body: rows,
        method: "POST",
        prefer: "resolution=merge-duplicates",
        query: {
          on_conflict: "symbol,earnings_date,source",
        },
      });
    }

    const symbolsCount = new Set(events.map((event) => event.symbol)).size;
    const summary = {
      eventsCount: events.length,
      fromDate: from,
      symbolsCount,
      toDate: to,
    };

    await completeRefreshRun(runId, summary);

    return summary;
  } catch (error) {
    await failRefreshRun(runId, error);
    throw error;
  }
}

async function getLatestCoverage() {
  const rows = await requestSupabaseRest<EarningsRefreshRunRow[]>(
    "earnings_refresh_runs",
    {
      query: {
        completed_at: "not.is.null",
        limit: 1,
        order: "completed_at.desc",
        select: "to_date,completed_at",
        source: "eq.finnhub",
        status: "eq.completed",
      },
    },
  );

  return rows?.[0] ?? null;
}

export async function getCachedEarningsRiskContexts(
  symbols: string[],
  now = new Date(),
) {
  const normalizedSymbols = Array.from(
    new Set(symbols.map(normalizeSymbol).filter(Boolean)),
  );
  const providerEnabled = earningsProviderEnabled();
  const contexts = new Map<string, EarningsRiskContext>();

  for (const symbol of normalizedSymbols) {
    contexts.set(symbol, {
      asOf: null,
      coverageThrough: null,
      events: [],
      providerEnabled,
      symbol,
    });
  }

  if (!providerEnabled || normalizedSymbols.length === 0) {
    return contexts;
  }

  const coverage = await getLatestCoverage();

  if (!coverage) {
    return contexts;
  }

  const rows = await requestSupabaseRest<EarningsEventRow[]>("earnings_events", {
    query: {
      earnings_date: `gte.${dateOnly(now)}`,
      order: "earnings_date.asc",
      select:
        "symbol,earnings_date,hour,year,quarter,eps_estimate,eps_actual,revenue_estimate,revenue_actual,source,as_of",
      source: "eq.finnhub",
      symbol: `in.(${normalizedSymbols.join(",")})`,
    },
  });

  for (const symbol of normalizedSymbols) {
    const events = (rows ?? [])
      .filter((row) => normalizeSymbol(row.symbol) === symbol)
      .map(fromRow);
    const asOf = (rows ?? [])
      .filter((row) => normalizeSymbol(row.symbol) === symbol)
      .map((row) => row.as_of)
      .sort()
      .at(-1) ?? coverage.completed_at;

    contexts.set(symbol, {
      asOf,
      coverageThrough: coverage.to_date,
      events,
      providerEnabled,
      symbol,
    });
  }

  return contexts;
}

export function emptyEarningsRiskContext(symbol: string): EarningsRiskContext {
  return {
    asOf: null,
    coverageThrough: null,
    events: [],
    providerEnabled: earningsProviderEnabled(),
    symbol: normalizeSymbol(symbol),
  };
}
