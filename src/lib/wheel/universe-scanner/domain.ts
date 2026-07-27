import type { AlpacaBar, AlpacaStockSnapshot } from "@/lib/alpaca/client";
import { round } from "../calculations";
import type { UnderlyingContext } from "../types";
import type {
  DeepScanCoverageRow,
  RankedUnderlying,
  ScannerAsset,
  UnderlyingTechnicalRow,
} from "./model";

export const TECHNICAL_REFRESH_TTL_MS = 20 * 60 * 60 * 1000;
export const DEFAULT_STOCK_SNAPSHOT_CHUNK_SIZE = 1000;

export function stableStringify(value: unknown): string {
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
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );

  return results;
}

export function parseNumber(
  value: number | string | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
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

function classifyTrend(
  price: number,
  ma20: number | null,
  ma50: number | null,
  ma200: number | null,
) {
  if (ma20 != null && ma50 != null && ma200 != null) {
    if (price > ma20 && ma20 > ma50 && price > ma200) {
      return "bullish" as const;
    }

    if ((price < ma20 && ma20 < ma50) || price < ma200) {
      return "bearish" as const;
    }
  }

  return "neutral" as const;
}

function snapshotPrice(snapshot: AlpacaStockSnapshot) {
  return snapshot.latestTrade?.p ?? snapshot.dailyBar?.c ?? null;
}

function snapshotAsOf(snapshot: AlpacaStockSnapshot) {
  return (
    snapshot.latestTrade?.t ??
    snapshot.latestQuote?.t ??
    snapshot.minuteBar?.t ??
    snapshot.dailyBar?.t ??
    new Date().toISOString()
  );
}

function priceChange(snapshot: AlpacaStockSnapshot, price: number) {
  const previousClose = snapshot.prevDailyBar?.c;

  if (!previousClose || previousClose <= 0) {
    return null;
  }

  return (price - previousClose) / previousClose;
}

function stockScore(snapshot: AlpacaStockSnapshot, price: number) {
  const volume = snapshot.dailyBar?.v ?? snapshot.minuteBar?.v ?? 0;
  const dollarVolume = Math.max(0, volume * price);
  const volumeScore = Math.log10(Math.max(dollarVolume, 1));
  const change = Math.abs(priceChange(snapshot, price) ?? 0);

  return volumeScore * 20 + Math.min(change * 100, 20);
}

export function rankUnderlyingUniverse(
  assets: ScannerAsset[],
  snapshots: Record<string, AlpacaStockSnapshot>,
) {
  return assets
    .map((asset): RankedUnderlying | null => {
      const snapshot = snapshots[asset.symbol];
      const price = snapshot ? snapshotPrice(snapshot) : null;
      const volume = snapshot?.dailyBar?.v ?? snapshot?.minuteBar?.v ?? 0;

      if (!snapshot || price == null || price < 5 || volume < 100_000) {
        return null;
      }

      return {
        asset,
        dollarVolume: volume * price,
        pctChange: priceChange(snapshot, price),
        price,
        snapshot,
        stockScore: stockScore(snapshot, price),
      };
    })
    .filter((asset) => asset != null)
    .sort(
      (left, right) =>
        right.stockScore - left.stockScore ||
        left.asset.symbol.localeCompare(right.asset.symbol),
    );
}

export function rotatingDiscoverySlice(
  ranked: RankedUnderlying[],
  size: number,
  now = new Date(),
) {
  if (ranked.length === 0 || size <= 0) {
    return [];
  }

  const sorted = [...ranked].sort((left, right) =>
    left.asset.symbol.localeCompare(right.asset.symbol),
  );
  const bucket = Math.floor(now.getTime() / (15 * 60 * 1000));
  const start = (bucket * size) % sorted.length;

  return Array.from(
    { length: Math.min(size, sorted.length) },
    (_, index) => sorted[(start + index) % sorted.length],
  );
}

export function selectDeepScanUniverse(
  ranked: RankedUnderlying[],
  deepScanSize: number,
  previousWinnerSymbols: string[],
  now = new Date(),
) {
  const previousWinnerTarget = Math.floor(deepScanSize * 0.15);
  const rotationTarget = Math.floor(deepScanSize * 0.15);
  const primaryTarget = deepScanSize - previousWinnerTarget - rotationTarget;
  const bySymbol = new Map(ranked.map((asset) => [asset.asset.symbol, asset]));
  const selected = new Map<string, RankedUnderlying>();

  for (const item of ranked.slice(0, primaryTarget)) {
    selected.set(item.asset.symbol, item);
  }

  for (const symbol of previousWinnerSymbols) {
    const item = bySymbol.get(symbol);

    if (item && selected.size < primaryTarget + previousWinnerTarget) {
      selected.set(symbol, item);
    }
  }

  for (const item of rotatingDiscoverySlice(ranked, rotationTarget * 2, now)) {
    if (selected.size >= deepScanSize) {
      break;
    }

    selected.set(item.asset.symbol, item);
  }

  for (const item of ranked) {
    if (selected.size >= deepScanSize) {
      break;
    }

    selected.set(item.asset.symbol, item);
  }

  return Array.from(selected.values()).slice(0, deepScanSize);
}

export function technicalFromBars(
  symbol: string,
  price: number,
  bars: AlpacaBar[],
  now = new Date(),
) {
  const closes = bars.map((bar) => bar.c).filter(Number.isFinite);
  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);

  return {
    symbol,
    calculated_at: now.toISOString(),
    last_bar_at: bars.at(-1)?.t ?? null,
    ma20,
    ma50,
    ma200,
    rsi14: rsi14(closes),
    trend: classifyTrend(price, ma20, ma50, ma200),
  };
}

export function technicalIsFresh(
  row: UnderlyingTechnicalRow | undefined,
  nowMs = Date.now(),
) {
  if (!row) {
    return false;
  }

  return (
    nowMs - new Date(row.calculated_at).getTime() <= TECHNICAL_REFRESH_TTL_MS
  );
}

export function rowToUnderlyingContext(
  item: RankedUnderlying,
  technical: UnderlyingTechnicalRow | undefined,
): UnderlyingContext {
  return {
    symbol: item.asset.symbol,
    price: item.price,
    asOf: snapshotAsOf(item.snapshot),
    trend: technical?.trend ?? "neutral",
    rsi14: parseNumber(technical?.rsi14),
    movingAverages: {
      ma20: parseNumber(technical?.ma20),
      ma50: parseNumber(technical?.ma50),
      ma200: parseNumber(technical?.ma200),
    },
  };
}

function coverageLastScannedMs(row: DeepScanCoverageRow | undefined) {
  if (!row?.last_scanned_at) {
    return 0;
  }

  const parsed = new Date(row.last_scanned_at).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectDeepScanCoverageBatch(
  ranked: RankedUnderlying[],
  coverage: Map<string, DeepScanCoverageRow>,
  batchSize: number,
  staleBeforeMs: number,
  forceRefresh: boolean,
) {
  return ranked
    .filter((item) => {
      if (forceRefresh) {
        return true;
      }

      const row = coverage.get(item.asset.symbol);

      return !row || coverageLastScannedMs(row) < staleBeforeMs;
    })
    .sort((left, right) => {
      const leftCoverage = coverage.get(left.asset.symbol);
      const rightCoverage = coverage.get(right.asset.symbol);
      const leftNeverScanned = leftCoverage?.last_scanned_at ? 0 : 1;
      const rightNeverScanned = rightCoverage?.last_scanned_at ? 0 : 1;

      if (leftNeverScanned !== rightNeverScanned) {
        return rightNeverScanned - leftNeverScanned;
      }

      const scannedDiff =
        coverageLastScannedMs(leftCoverage) -
        coverageLastScannedMs(rightCoverage);

      return (
        scannedDiff ||
        right.stockScore - left.stockScore ||
        left.asset.symbol.localeCompare(right.asset.symbol)
      );
    })
    .slice(0, batchSize);
}
