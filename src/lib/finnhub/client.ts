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

function asNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asIntegerOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function normalizeFinnhubEarningsEvent(
  row: FinnhubCalendarEarningsRow,
): FinnhubEarningsEvent | null {
  const symbol = row.symbol?.trim().toUpperCase();
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
  const env = getEnv();

  if (!env.FINNHUB_API_KEY) {
    throw new Error("FINNHUB_API_KEY is not configured.");
  }

  const baseUrl = env.FINNHUB_API_BASE_URL.endsWith("/")
    ? env.FINNHUB_API_BASE_URL
    : `${env.FINNHUB_API_BASE_URL}/`;
  const url = new URL("calendar/earnings", baseUrl);

  url.searchParams.set("from", options.from);
  url.searchParams.set("to", options.to);
  url.searchParams.set("token", env.FINNHUB_API_KEY);

  if (options.symbol) {
    url.searchParams.set("symbol", options.symbol.trim().toUpperCase());
  }

  const response = await fetch(url, {
    cache: "no-store",
    signal: options.signal,
  });

  const body = await response.json().catch(() => null) as
    | FinnhubCalendarEarningsResponse
    | null;

  if (!response.ok) {
    throw new Error(
      body?.error ?? `Finnhub earnings calendar returned HTTP ${response.status}.`,
    );
  }

  return (body?.earningsCalendar ?? [])
    .map(normalizeFinnhubEarningsEvent)
    .filter((event): event is FinnhubEarningsEvent => event != null);
}
