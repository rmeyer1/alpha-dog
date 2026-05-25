import { round } from "./calculations";
import type { OptionType, RawOptionContract, Trend, UnderlyingContext } from "./types";

const tickerPrices: Record<string, number> = {
  AAPL: 192.34,
  MSFT: 421.18,
  NVDA: 126.42,
  TSLA: 178.72,
  SPY: 529.84,
  QQQ: 457.31,
};

function hashTicker(ticker: string) {
  return ticker
    .split("")
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

export function getDemoUnderlying(ticker: string): UnderlyingContext {
  const hash = hashTicker(ticker);
  const price = tickerPrices[ticker] ?? round(55 + (hash % 420) + (hash % 9) / 10);
  const trend: Trend = hash % 5 === 0 ? "bearish" : hash % 3 === 0 ? "neutral" : "bullish";
  const ma20 = round(price * (trend === "bullish" ? 0.985 : 1.01), 2);
  const ma50 = round(price * (trend === "bullish" ? 0.95 : 1.025), 2);
  const ma200 = round(price * (trend === "bearish" ? 1.07 : 0.91), 2);

  return {
    symbol: ticker,
    price,
    asOf: new Date().toISOString(),
    trend,
    rsi14: trend === "bullish" ? 61.4 : trend === "bearish" ? 38.2 : 51.6,
    movingAverages: {
      ma20,
      ma50,
      ma200,
    },
  };
}

function expirationDate(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);

  return date.toISOString().slice(0, 10);
}

function contractSymbol(
  ticker: string,
  optionType: OptionType,
  expiration: string,
  strike: number,
) {
  const yymmdd = expiration.slice(2).replaceAll("-", "");
  const type = optionType === "put" ? "P" : "C";
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, "0");

  return `${ticker}${yymmdd}${type}${strikeCode}`;
}

export function getDemoContracts(
  ticker: string,
  underlying: UnderlyingContext,
): RawOptionContract[] {
  const expirations = [9, 14, 23, 29, 38, 45].map(expirationDate);
  const putDeltas = [0.12, 0.17, 0.22, 0.28, 0.34, 0.41];
  const callDeltas = [0.14, 0.19, 0.25, 0.31, 0.37, 0.43];
  const contracts: RawOptionContract[] = [];

  for (const [expirationIndex, expiration] of expirations.entries()) {
    for (const [index, delta] of putDeltas.entries()) {
      const distance = 0.04 + index * 0.018 + expirationIndex * 0.002;
      const strike = round(underlying.price * (1 - distance), 2);
      const mid = round(strike * (0.006 + delta * 0.032 + expirationIndex * 0.0015), 2);
      const spread = index >= 4 ? 0.22 : index >= 2 ? 0.1 : 0.04;
      contracts.push({
        contractSymbol: contractSymbol(ticker, "put", expiration, strike),
        optionType: "put",
        strike,
        expirationDate: expiration,
        bid: round(mid - spread / 2, 2),
        ask: round(mid + spread / 2, 2),
        delta: -delta,
        theta: -round(0.035 + delta * 0.13, 3),
        impliedVolatility: round(0.25 + delta * 1.15 + expirationIndex * 0.015, 3),
        volume: 45 + index * 55 + expirationIndex * 18,
        openInterest: 90 + index * 120 + expirationIndex * 45,
      });
    }

    for (const [index, delta] of callDeltas.entries()) {
      const distance = 0.025 + index * 0.02 + expirationIndex * 0.002;
      const strike = round(underlying.price * (1 + distance), 2);
      const mid = round(underlying.price * (0.005 + delta * 0.03 + expirationIndex * 0.001), 2);
      const spread = index >= 4 ? 0.18 : index >= 2 ? 0.08 : 0.04;
      contracts.push({
        contractSymbol: contractSymbol(ticker, "call", expiration, strike),
        optionType: "call",
        strike,
        expirationDate: expiration,
        bid: round(mid - spread / 2, 2),
        ask: round(mid + spread / 2, 2),
        delta,
        theta: -round(0.028 + delta * 0.11, 3),
        impliedVolatility: round(0.24 + delta * 0.95 + expirationIndex * 0.013, 3),
        volume: 40 + index * 48 + expirationIndex * 20,
        openInterest: 80 + index * 105 + expirationIndex * 42,
      });
    }
  }

  return contracts;
}
