import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import { marketBatchRequestIdentity } from "../market-batch/domain";
import type { MarketBatchOptionStageSummary } from "../market-batch/model";
import { optionTypeForStrategy } from "../universe-scanner/candidate-domain";
import type { WheelScreenerRequest } from "../types";
import type {
  DeepScanWorkClaim,
  DeepScanWorkResult,
} from "./model";

export const DEEP_SCAN_COVERAGE_INTERVAL_MINUTES = 15;

export function deepScanCoverageIntervalStartedAt(
  date = new Date(),
  intervalMinutes = DEEP_SCAN_COVERAGE_INTERVAL_MINUTES,
) {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new RangeError("Coverage interval minutes must be positive.");
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  return new Date(
    Math.floor(date.getTime() / intervalMs) * intervalMs,
  ).toISOString();
}

export function deepScanCoverageWindowState(date = new Date()) {
  const marketSession = getUsEquitiesMarketState(date);
  const windowStartMinutes = 8 * 60;
  const windowEndMinutes = marketSession.closeMinutes;

  return {
    easternMinutes: marketSession.easternMinutes,
    isOpen:
      marketSession.isMarketDay &&
      windowEndMinutes != null &&
      marketSession.easternMinutes >= windowStartMinutes &&
      marketSession.easternMinutes < windowEndMinutes,
    isWeekday: !["Sat", "Sun"].includes(marketSession.weekday),
    marketSession,
    weekday: marketSession.weekday,
  };
}

export function requestsForDeepScanClaims(
  requests: WheelScreenerRequest[],
  claims: Array<Pick<DeepScanWorkClaim, "optionType">>,
) {
  const claimedTypes = new Set(claims.map((claim) => claim.optionType));
  const unique = new Map<string, WheelScreenerRequest>();

  for (const request of requests) {
    if (!claimedTypes.has(optionTypeForStrategy(request.strategy))) {
      continue;
    }

    const identity = marketBatchRequestIdentity(request);
    unique.set(JSON.stringify(identity), request);
  }

  return Array.from(unique.values());
}

export function resultsForDeepScanClaims(
  claims: DeepScanWorkClaim[],
  optionStages: MarketBatchOptionStageSummary[],
): DeepScanWorkResult[] {
  const stages = new Map(
    optionStages.map((stage) => [
      `${stage.symbol}:${stage.optionType}`,
      stage,
    ]),
  );

  return claims.map((claim) => {
    const stage = stages.get(`${claim.symbol}:${claim.optionType}`);

    if (!stage) {
      return {
        error: "Claimed underlying facts were unavailable.",
        leaseToken: claim.leaseToken,
        optionContractCount: 0,
        optionType: claim.optionType,
        outcome: "failed",
        symbol: claim.symbol,
      };
    }

    return {
      error: stage.error,
      leaseToken: claim.leaseToken,
      optionContractCount: stage.contractCount,
      optionType: claim.optionType,
      outcome: stage.error
        ? "provider_outage"
        : stage.contractCount > 0
          ? "complete"
          : "no_candidate",
      symbol: claim.symbol,
    };
  });
}

export interface SimulatedCoverageUnit {
  freshnessMs: number;
  id: string;
  nextDueMs: number;
  tierPriority: number;
}

export function simulateTieredCoverageWeek({
  capacity,
  instants,
  units,
}: {
  capacity: number;
  instants: Date[];
  units: SimulatedCoverageUnit[];
}) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("Simulation capacity must be positive.");
  }

  const state = units.map((unit) => ({
    ...unit,
    completedCount: 0,
    firstCompletedAtMs: null as number | null,
    maximumLatenessMs: 0,
  }));
  let closedDispatchCount = 0;
  let dispatchCount = 0;

  for (const instant of instants) {
    const window = deepScanCoverageWindowState(instant);

    if (!window.isOpen) {
      closedDispatchCount += 1;
      continue;
    }

    const nowMs = instant.getTime();
    const due = state
      .filter((unit) => unit.nextDueMs <= nowMs)
      .sort((left, right) =>
        left.tierPriority - right.tierPriority ||
        left.nextDueMs - right.nextDueMs ||
        left.id.localeCompare(right.id)
      )
      .slice(0, capacity);

    for (const unit of due) {
      unit.maximumLatenessMs = Math.max(
        unit.maximumLatenessMs,
        nowMs - unit.nextDueMs,
      );
      unit.completedCount += 1;
      unit.firstCompletedAtMs ??= nowMs;
      unit.nextDueMs = nowMs + unit.freshnessMs;
      dispatchCount += 1;
    }
  }

  return {
    closedDispatchCount,
    dispatchCount,
    units: state,
  };
}
