import type {
  OptionType,
  QualityLabel,
  RawOptionContract,
  UnderlyingContext,
  WheelCandidate,
  WheelFilters,
} from "./types";

const dayMs = 24 * 60 * 60 * 1000;

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

export function getDte(expirationDate: string, now = new Date()) {
  const expiry = new Date(`${expirationDate}T16:00:00-04:00`);

  return Math.ceil((expiry.getTime() - now.getTime()) / dayMs);
}

export function midpoint(bid: number, ask: number) {
  return round((bid + ask) / 2, 3);
}

export function spread(bid: number, ask: number) {
  return round(ask - bid, 3);
}

export function premiumYield(
  optionType: OptionType,
  mid: number,
  strike: number,
  underlyingPrice: number,
) {
  return optionType === "put" ? mid / strike : mid / underlyingPrice;
}

export function annualizedYield(yieldValue: number, dte: number) {
  return dte > 0 ? yieldValue * (365 / dte) : 0;
}

export function liquidityQuality(
  openInterest: number | null,
  volume: number | null,
  spreadPctOfMid: number,
): QualityLabel {
  if (!Number.isFinite(spreadPctOfMid) || spreadPctOfMid > 0.35) {
    return "poor";
  }

  if (openInterest == null || volume == null) {
    return "unknown";
  }

  if (openInterest >= 500 && volume >= 200 && spreadPctOfMid <= 0.05) {
    return "excellent";
  }

  if (openInterest >= 250 && volume >= 100 && spreadPctOfMid <= 0.1) {
    return "good";
  }

  if (openInterest >= 100 && volume >= 50 && spreadPctOfMid <= 0.2) {
    return "acceptable";
  }

  return "weak";
}

export function qualityScore(quality: QualityLabel) {
  switch (quality) {
    case "excellent":
      return 100;
    case "good":
      return 86;
    case "acceptable":
      return 70;
    case "unknown":
      return 58;
    case "weak":
      return 38;
    case "poor":
      return 12;
  }
}

export function assignmentQuality(
  strike: number,
  breakeven: number,
  underlying: UnderlyingContext,
): QualityLabel {
  const { price, trend, movingAverages } = underlying;

  if (strike >= price) {
    return "poor";
  }

  if (
    trend !== "bearish" &&
    movingAverages.ma50 != null &&
    breakeven <= movingAverages.ma50
  ) {
    return "excellent";
  }

  if (trend !== "bearish" && strike < price) {
    return "good";
  }

  if (trend === "neutral") {
    return "acceptable";
  }

  return "weak";
}

export function upsideCapQuality(
  strike: number,
  midpointValue: number,
  underlying: UnderlyingContext,
): QualityLabel {
  const upsideRoom = (strike - underlying.price) / underlying.price;
  const calledAwayPrice = strike + midpointValue;

  if (strike <= underlying.price) {
    return "poor";
  }

  if (underlying.trend === "bullish" && upsideRoom < 0.03) {
    return "weak";
  }

  if (upsideRoom >= 0.08 && calledAwayPrice > underlying.price) {
    return "excellent";
  }

  if (upsideRoom >= 0.04) {
    return "good";
  }

  return "acceptable";
}

export function buildCandidate(
  raw: RawOptionContract,
  underlying: UnderlyingContext,
  filters: WheelFilters,
  now = new Date(),
): WheelCandidate | null {
  if (raw.bid <= 0 || raw.ask <= 0 || raw.ask < raw.bid) {
    return null;
  }

  const dte = getDte(raw.expirationDate, now);

  if (dte < filters.dteMin || dte > filters.dteMax) {
    return null;
  }

  if (raw.optionType === "put" && raw.strike >= underlying.price) {
    return null;
  }

  if (raw.optionType === "call" && raw.strike <= underlying.price) {
    return null;
  }

  const mid = midpoint(raw.bid, raw.ask);
  const spreadValue = spread(raw.bid, raw.ask);
  const spreadPctOfMid = mid > 0 ? spreadValue / mid : Number.POSITIVE_INFINITY;
  const yieldValue = premiumYield(
    raw.optionType,
    mid,
    raw.strike,
    underlying.price,
  );
  const distanceFromSpotPct =
    raw.optionType === "put"
      ? (underlying.price - raw.strike) / underlying.price
      : (raw.strike - underlying.price) / underlying.price;
  const breakeven = raw.optionType === "put" ? raw.strike - mid : undefined;
  const calledAwayPrice =
    raw.optionType === "call" ? raw.strike + mid : undefined;
  const candidateLiquidity = liquidityQuality(
    raw.openInterest,
    raw.volume,
    spreadPctOfMid,
  );
  const candidateAssignment =
    raw.optionType === "put" && breakeven != null
      ? assignmentQuality(raw.strike, breakeven, underlying)
      : undefined;
  const candidateUpside =
    raw.optionType === "call"
      ? upsideCapQuality(raw.strike, mid, underlying)
      : undefined;

  return {
    rank: 0,
    score: 0,
    contractSymbol: raw.contractSymbol,
    optionType: raw.optionType,
    strike: raw.strike,
    expirationDate: raw.expirationDate,
    dte,
    bid: raw.bid,
    ask: raw.ask,
    midpoint: mid,
    spread: spreadValue,
    spreadPctOfMid: round(spreadPctOfMid, 4),
    premiumYield: round(yieldValue, 4),
    annualizedYield: round(annualizedYield(yieldValue, dte), 4),
    delta: raw.delta,
    theta: raw.theta,
    impliedVolatility: raw.impliedVolatility,
    volume: raw.volume,
    openInterest: raw.openInterest,
    distanceFromSpotPct: round(distanceFromSpotPct, 4),
    breakeven: breakeven == null ? undefined : round(breakeven, 3),
    calledAwayPrice:
      calledAwayPrice == null ? undefined : round(calledAwayPrice, 3),
    assignmentQuality: candidateAssignment,
    upsideCapQuality: candidateUpside,
    liquidityQuality: candidateLiquidity,
    warnings: [],
    scoreBreakdown: {
      yield: 0,
      deltaFit: 0,
      dteFit: 0,
      liquidity: 0,
      technicalFit: 0,
      eventRisk: 100,
      volatilityRisk: 100,
    },
  };
}
