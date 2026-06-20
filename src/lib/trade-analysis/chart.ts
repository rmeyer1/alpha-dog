import type { AlpacaBar, CompanyProfile } from "@/lib/company-profile";
import { round } from "@/lib/wheel/calculations";
import type {
  JsonValue,
  TradeAnalysisChartSource,
  TradeAnalysisInput,
} from "./types";

interface ChartContext {
  facts: JsonValue;
  source: TradeAnalysisChartSource;
}

type NumericRecord = Record<string, JsonValue | undefined>;

function average(values: number[], decimals = 2) {
  if (values.length === 0) {
    return null;
  }

  return round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
    decimals,
  );
}

function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return null;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function returnPct(bars: AlpacaBar[], sessionsAgo: number) {
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

function movingAverage(closes: number[], length: number) {
  if (closes.length < length) {
    return null;
  }

  return average(closes.slice(-length));
}

function movingAverageSlopePct(closes: number[], length: number, lookback: number) {
  if (closes.length < length + lookback) {
    return null;
  }

  const current = movingAverage(closes, length);
  const prior = average(closes.slice(-(length + lookback), -lookback));

  if (current == null || prior == null || prior === 0) {
    return null;
  }

  return round((current - prior) / prior, 4);
}

function rsi14(closes: number[]) {
  if (closes.length < 15) {
    return null;
  }

  const changes = closes
    .slice(-15)
    .map((close, index, values) => {
      if (index === 0) {
        return 0;
      }

      return close - values[index - 1];
    })
    .slice(1);
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

function trueRanges(bars: AlpacaBar[]) {
  return bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].c;

    return Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - previousClose),
      Math.abs(bar.l - previousClose),
    );
  });
}

function averageTrueRange(bars: AlpacaBar[], length: number) {
  const ranges = trueRanges(bars);

  if (ranges.length < length) {
    return null;
  }

  return average(ranges.slice(-length));
}

function realizedVolatility(closes: number[], length: number) {
  if (closes.length < length + 1) {
    return null;
  }

  const returns = closes.slice(-(length + 1)).slice(1).map((close, index) => {
    const previous = closes.slice(-(length + 1))[index];

    return previous ? (close - previous) / previous : 0;
  });
  const dailyStdDev = standardDeviation(returns);

  return dailyStdDev == null ? null : round(dailyStdDev * Math.sqrt(252), 4);
}

function distancePct(price: number, level: number | null) {
  if (level == null || price === 0) {
    return null;
  }

  return round((level - price) / price, 4);
}

function numberOrNull(value: JsonValue | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function objectOrNull(value: JsonValue | undefined): NumericRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as NumericRecord;
}

function extractTradeLevels(input: TradeAnalysisInput) {
  const candidate = objectOrNull(input.candidate);
  const shortLeg = objectOrNull(candidate?.shortLeg);
  const longLeg = objectOrNull(candidate?.longLeg);
  const shortStrike =
    numberOrNull(shortLeg?.strike) ??
    numberOrNull(candidate?.shortStrike) ??
    numberOrNull(candidate?.strike);
  const longStrike =
    numberOrNull(longLeg?.strike) ?? numberOrNull(candidate?.longStrike);
  const breakeven =
    numberOrNull(candidate?.breakeven) ??
    numberOrNull(candidate?.breakEven) ??
    numberOrNull(candidate?.breakEvenPrice);
  const maxLoss = numberOrNull(candidate?.maxLoss);
  const maxProfit =
    numberOrNull(candidate?.maxProfit) ??
    numberOrNull(candidate?.netCredit) ??
    numberOrNull(candidate?.premiumReceived);

  return {
    breakeven,
    breakevenDistancePct: distancePct(input.underlying.price, breakeven),
    longStrike,
    longStrikeDistancePct: distancePct(input.underlying.price, longStrike),
    maxLoss,
    maxProfit,
    shortStrike,
    shortStrikeDistancePct: distancePct(input.underlying.price, shortStrike),
  };
}

function priceVsLevel(price: number, level: number | null) {
  if (level == null) {
    return null;
  }

  return price > level ? "above" : price < level ? "below" : "at";
}

function supportResistance(bars: AlpacaBar[]) {
  const recent = bars.slice(-60);

  if (recent.length === 0) {
    return {
      recentHigh: null,
      recentLow: null,
      twentyDayHigh: null,
      twentyDayLow: null,
    };
  }

  const last20 = recent.slice(-20);

  return {
    recentHigh: round(Math.max(...recent.map((bar) => bar.h)), 2),
    recentLow: round(Math.min(...recent.map((bar) => bar.l)), 2),
    twentyDayHigh: last20.length
      ? round(Math.max(...last20.map((bar) => bar.h)), 2)
      : null,
    twentyDayLow: last20.length
      ? round(Math.min(...last20.map((bar) => bar.l)), 2)
      : null,
  };
}

function nearestLevel({
  candidates,
  direction,
  price,
}: {
  candidates: Array<number | null>;
  direction: "support" | "resistance";
  price: number;
}) {
  const valid = candidates.filter(
    (candidate): candidate is number =>
      candidate != null &&
      (direction === "support" ? candidate <= price : candidate >= price),
  );

  if (valid.length === 0) {
    return null;
  }

  return direction === "support" ? Math.max(...valid) : Math.min(...valid);
}

function classifyTrend({
  ma20,
  ma50,
  ma200,
  price,
}: {
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  price: number;
}) {
  if (ma20 == null || ma50 == null || ma200 == null) {
    return "insufficient_data";
  }

  if (price > ma20 && ma20 > ma50 && ma50 > ma200) {
    return "bullish_alignment";
  }

  if (price < ma20 && ma20 < ma50 && ma50 < ma200) {
    return "bearish_alignment";
  }

  if (price > ma50 && ma50 > ma200) {
    return "constructive";
  }

  if (price < ma50 && ma50 < ma200) {
    return "weak";
  }

  return "mixed";
}

export function buildChartContext(
  input: TradeAnalysisInput,
  profile: CompanyProfile,
): ChartContext {
  const bars = profile.market.bars;
  const closes = bars.map((bar) => bar.c);
  const volumes = bars.map((bar) => bar.v);
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const last20Volume = average(volumes.slice(-20));
  const currentVolume = latest?.v ?? null;
  const volumeVsAverage20Day =
    currentVolume == null || last20Volume == null
      ? null
      : round(currentVolume / last20Volume, 2);
  const price = input.underlying.price;
  const ma20 = input.underlying.movingAverages.ma20 ?? movingAverage(closes, 20);
  const ma50 = input.underlying.movingAverages.ma50 ?? movingAverage(closes, 50);
  const ma200 =
    input.underlying.movingAverages.ma200 ?? movingAverage(closes, 200);
  const levels = supportResistance(bars);
  const atr14 = averageTrueRange(bars, 14);
  const nearestSupport = nearestLevel({
    candidates: [levels.twentyDayLow, levels.recentLow, ma20, ma50, ma200],
    direction: "support",
    price,
  });
  const nearestResistance = nearestLevel({
    candidates: [levels.twentyDayHigh, levels.recentHigh, ma20, ma50, ma200],
    direction: "resistance",
    price,
  });

  return {
    source: "server_chart_indicators",
    facts: {
      barsAvailable: bars.length,
      latestBar: latest
        ? {
            close: latest.c,
            high: latest.h,
            low: latest.l,
            open: latest.o,
            time: latest.t,
            volume: latest.v,
          }
        : null,
      movingAverages: {
        ma20: input.underlying.movingAverages.ma20 ?? ma20,
        ma50: input.underlying.movingAverages.ma50 ?? ma50,
        ma200: input.underlying.movingAverages.ma200 ?? ma200,
      },
      momentum: {
        rsi14: input.underlying.rsi14 ?? rsi14(closes),
        ma20Slope20Sessions: movingAverageSlopePct(closes, 20, 20),
        ma50Slope20Sessions: movingAverageSlopePct(closes, 50, 20),
      },
      price,
      priceLocation: {
        ma20DistancePct: distancePct(price, ma20),
        ma50DistancePct: distancePct(price, ma50),
        ma200DistancePct: distancePct(price, ma200),
        priceVsMa20: priceVsLevel(price, ma20),
        priceVsMa50: priceVsLevel(price, ma50),
        priceVsMa200: priceVsLevel(price, ma200),
        aboveMa20: ma20 == null ? null : price > ma20,
        aboveMa50: ma50 == null ? null : price > ma50,
        aboveMa200: ma200 == null ? null : price > ma200,
      },
      returns: {
        oneWeek: returnPct(bars, 5),
        oneMonth: returnPct(bars, 21),
        threeMonth: returnPct(bars, 63),
      },
      sessionChange:
        latest?.c == null || previous?.c == null
          ? null
          : round((latest.c - previous.c) / previous.c, 4),
      supportResistance: {
        ...levels,
        nearestResistance,
        nearestResistanceDistancePct: distancePct(price, nearestResistance),
        nearestSupport,
        nearestSupportDistancePct: distancePct(price, nearestSupport),
      },
      tradeLevels: extractTradeLevels(input),
      trend: {
        dashboardTrend: input.underlying.trend,
        indicatorTrend: classifyTrend({ ma20, ma50, ma200, price }),
      },
      volatility: {
        atr14,
        atr14Pct: atr14 == null ? null : round(atr14 / price, 4),
        averageDailyRange20Pct:
          bars.length < 20
            ? null
            : average(
                bars
                  .slice(-20)
                  .map((bar) => (bar.h - bar.l) / Math.max(bar.c, 0.01)),
                4,
              ),
        latestDailyRangePct: latest
          ? round((latest.h - latest.l) / Math.max(latest.c, 0.01), 4)
          : null,
        realizedVolatility20Day: realizedVolatility(closes, 20),
        realizedVolatility60Day: realizedVolatility(closes, 60),
      },
      volume: {
        current: currentVolume,
        average20Day: last20Volume,
        expansion: volumeVsAverage20Day == null
          ? null
          : volumeVsAverage20Day >= 1.5
            ? "elevated"
            : volumeVsAverage20Day <= 0.7
              ? "light"
              : "normal",
        volumeVsAverage20Day,
      },
    },
  };
}
