import { round } from "@/lib/wheel/calculations";
import type { OptionType, RawOptionContract, Trend } from "@/lib/wheel/types";
import type { AlpacaOptionContract, AlpacaOptionSnapshot } from "./types";

export function formatAlpacaDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function addAlpacaDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
export function chunkAlpacaValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
}
export function alpacaStrikeBounds(optionType: OptionType, price: number) {
  return {
    min: optionType === "put" ? price * 0.6 : price * 0.95,
    max: optionType === "put" ? price * 1.02 : price * 1.4,
  };
}
export function movingAverage(closes: number[], length: number) {
  if (closes.length < length) return null;
  return round(
    closes.slice(-length).reduce((sum, value) => sum + value, 0) / length,
    2,
  );
}
export function rsi14(closes: number[]) {
  if (closes.length < 15) return null;
  const changes = closes
    .slice(-15)
    .slice(1)
    .map(
      (close, index, values) =>
        close - (index === 0 ? closes.at(-15)! : values[index - 1]),
    );
  const gain =
    changes.reduce((sum, change) => sum + Math.max(change, 0), 0) /
    changes.length;
  const loss =
    changes.reduce((sum, change) => sum + Math.abs(Math.min(change, 0)), 0) /
    changes.length;
  return loss === 0 ? 100 : round(100 - 100 / (1 + gain / loss), 1);
}
export function classifyAlpacaTrend(
  price: number,
  ma20: number | null,
  ma50: number | null,
  ma200: number | null,
): Trend {
  if (ma20 != null && ma50 != null && ma200 != null) {
    if (price > ma20 && ma20 > ma50 && price > ma200) return "bullish";
    if ((price < ma20 && ma20 < ma50) || price < ma200) return "bearish";
  }
  return "neutral";
}
export function parseAlpacaOptionSymbol(symbol: string) {
  const parsed = /^(.+)(\d{6})([CP])(\d{8})$/.exec(symbol);
  if (!parsed) return null;
  const [, underlyingSymbol, rawDate, rawOptionType, rawStrike] = parsed;
  const strike = Number(rawStrike) / 1000;
  if (!Number.isFinite(strike)) return null;
  return {
    underlyingSymbol,
    expirationDate: `20${rawDate.slice(0, 2)}-${rawDate.slice(2, 4)}-${rawDate.slice(4, 6)}`,
    optionType: rawOptionType === "P" ? ("put" as const) : ("call" as const),
    strike,
  };
}
export function normalizeAlpacaSnapshotContract(
  symbol: string,
  snapshot: AlpacaOptionSnapshot,
  metadata?: AlpacaOptionContract,
): RawOptionContract | null {
  const parsed = parseAlpacaOptionSymbol(symbol);
  const bid = snapshot.latestQuote?.bp;
  const ask = snapshot.latestQuote?.ap;
  if (!parsed || bid == null || ask == null) return null;
  return {
    contractSymbol: symbol,
    optionType: metadata?.type ?? parsed.optionType,
    strike:
      metadata?.strike_price == null
        ? parsed.strike
        : Number(metadata.strike_price),
    expirationDate: metadata?.expiration_date ?? parsed.expirationDate,
    bid,
    ask,
    delta: snapshot.greeks?.delta ?? null,
    theta: snapshot.greeks?.theta ?? null,
    impliedVolatility: snapshot.impliedVolatility ?? null,
    volume: snapshot.dailyBar?.v ?? null,
    openInterest:
      metadata?.open_interest == null ? null : Number(metadata.open_interest),
  };
}
