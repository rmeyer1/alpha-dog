import {
  clamp,
  qualityScore,
  round,
} from "./calculations";
import type {
  PersonaConfig,
  QualityLabel,
  ScoreBreakdown,
  ScoreWeights,
  UnderlyingContext,
  Warning,
  WheelCandidate,
  WheelFilters,
} from "./types";

function fitScore(value: number, min: number, max: number, tolerance: number) {
  if (value >= min && value <= max) {
    return 100;
  }

  const distance = value < min ? min - value : value - max;

  return clamp(100 - (distance / tolerance) * 100);
}

function yieldScore(candidate: WheelCandidate, filters: WheelFilters) {
  if (candidate.premiumYield < filters.minPremiumYield) {
    return clamp((candidate.premiumYield / filters.minPremiumYield) * 55);
  }

  const overTarget =
    (candidate.premiumYield - filters.minPremiumYield) /
    Math.max(filters.minPremiumYield, 0.0001);

  return clamp(72 + overTarget * 14, 0, 96);
}

function dteScore(candidate: WheelCandidate, filters: WheelFilters) {
  const midpoint = (filters.dteMin + filters.dteMax) / 2;
  const halfRange = Math.max((filters.dteMax - filters.dteMin) / 2, 1);
  const distance = Math.abs(candidate.dte - midpoint);

  return clamp(100 - (distance / halfRange) * 22, 65, 100);
}

function technicalScore(candidate: WheelCandidate, underlying: UnderlyingContext) {
  let score = 72;
  const { movingAverages, trend, rsi14 } = underlying;

  if (candidate.optionType === "put") {
    if (trend === "bullish") score += 12;
    if (trend === "bearish") score -= 28;
    if (movingAverages.ma50 != null && candidate.strike <= movingAverages.ma50) {
      score += 10;
    }
    if (movingAverages.ma200 != null && underlying.price < movingAverages.ma200) {
      score -= 16;
    }
    if (rsi14 != null && rsi14 <= 30) {
      score -= 8;
    }
  } else {
    if (trend === "bullish" && candidate.distanceFromSpotPct < 0.04) {
      score -= 18;
    }
    if (trend === "bearish") {
      score += 8;
    }
    if (rsi14 != null && rsi14 >= 70) {
      score += 7;
    }
  }

  return clamp(score);
}

function eventRiskScore(filters: WheelFilters) {
  return filters.excludeEarnings ? 82 : 90;
}

function volatilityScore(candidate: WheelCandidate) {
  const iv = candidate.impliedVolatility;

  if (iv == null) {
    return 65;
  }

  if (iv <= 0.45) {
    return 92;
  }

  if (iv <= 0.7) {
    return 76;
  }

  return 54;
}

function thetaEfficiencyScore(candidate: WheelCandidate) {
  if (candidate.theta == null) {
    return 55;
  }

  return clamp(Math.abs(candidate.theta) * 900, 35, 100);
}

function weightedScore(breakdown: ScoreBreakdown, weights: ScoreWeights) {
  const entries = Object.entries(weights) as Array<[
    keyof ScoreWeights,
    number,
  ]>;
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const totalScore = entries.reduce((sum, [key, weight]) => {
    const value = breakdown[key as keyof ScoreBreakdown];

    return sum + (typeof value === "number" ? value * weight : 0);
  }, 0);

  return Math.round(totalScore / totalWeight);
}

function warningForLiquidity(
  quality: QualityLabel,
  candidate: WheelCandidate,
): Warning | null {
  if (quality !== "weak" && quality !== "poor") {
    return null;
  }

  return {
    type: "liquidity",
    severity: quality === "poor" ? "danger" : "warning",
    message:
      candidate.spreadPctOfMid > 0.2
        ? "Wide spread - expected edge may be reduced by poor fills."
        : "Liquidity is below the preferred threshold for this preset.",
  };
}

export function scoreCandidate(
  candidate: WheelCandidate,
  persona: PersonaConfig,
  filters: WheelFilters,
  underlying: UnderlyingContext,
) {
  const absDelta = Math.abs(candidate.delta ?? 0);
  const deltaFit = candidate.delta == null
    ? 45
    : fitScore(absDelta, filters.deltaMin, filters.deltaMax, 0.2);
  const liquidity = qualityScore(candidate.liquidityQuality);
  const assignmentOrUpside =
    candidate.optionType === "put"
      ? qualityScore(candidate.assignmentQuality ?? "unknown")
      : qualityScore(candidate.upsideCapQuality ?? "unknown");
  const breakdown: ScoreBreakdown = {
    yield: yieldScore(candidate, filters),
    deltaFit,
    dteFit: dteScore(candidate, filters),
    liquidity,
    technicalFit: technicalScore(candidate, underlying),
    eventRisk: eventRiskScore(filters),
    volatilityRisk: volatilityScore(candidate),
    thetaEfficiency: thetaEfficiencyScore(candidate),
  };

  if (candidate.optionType === "put") {
    breakdown.assignmentQuality = assignmentOrUpside;
  } else {
    breakdown.upsideCapQuality = assignmentOrUpside;
  }

  const warnings = [
    warningForLiquidity(candidate.liquidityQuality, candidate),
    candidate.impliedVolatility != null && candidate.impliedVolatility >= 0.7
      ? {
          type: "volatility" as const,
          severity: "warning" as const,
          message:
            "High IV - premium is richer, but expected move and assignment risk are elevated.",
        }
      : null,
    candidate.optionType === "put" && underlying.trend === "bearish"
      ? {
          type: "trend" as const,
          severity: "warning" as const,
          message:
            "Bearish trend - avoid selling puts into weak structure unless intentionally aggressive.",
        }
      : null,
    candidate.optionType === "call" &&
    underlying.trend === "bullish" &&
    candidate.distanceFromSpotPct < 0.04
      ? {
          type: "upside_cap" as const,
          severity: "warning" as const,
          message: "Call strike may cap upside too tightly for current trend.",
        }
      : null,
  ].filter((warning): warning is Warning => warning != null);

  const roundedBreakdown: ScoreBreakdown = {
    yield: round(breakdown.yield, 1),
    deltaFit: round(breakdown.deltaFit, 1),
    dteFit: round(breakdown.dteFit, 1),
    liquidity: round(breakdown.liquidity, 1),
    technicalFit: round(breakdown.technicalFit, 1),
    eventRisk: round(breakdown.eventRisk, 1),
    volatilityRisk: round(breakdown.volatilityRisk, 1),
    assignmentQuality:
      breakdown.assignmentQuality == null
        ? undefined
        : round(breakdown.assignmentQuality, 1),
    upsideCapQuality:
      breakdown.upsideCapQuality == null
        ? undefined
        : round(breakdown.upsideCapQuality, 1),
    thetaEfficiency:
      breakdown.thetaEfficiency == null
        ? undefined
        : round(breakdown.thetaEfficiency, 1),
  };

  return {
    ...candidate,
    score: weightedScore(
      breakdown,
      persona.scoringWeights[candidate.optionType],
    ),
    scoreBreakdown: roundedBreakdown,
    warnings,
  };
}
