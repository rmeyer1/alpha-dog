/** Pure normalization, financial calculations, and expiration decisions. No I/O. */
import {
  OPTION_CONTRACT_MULTIPLIER,
  premiumReceived,
} from "../simulated-accounting";
import type { SimulatedPositionInput } from "./contracts";

export const multiplier = OPTION_CONTRACT_MULTIPLIER;

export function calculateNetCredit(input: SimulatedPositionInput) {
  return (
    input.netCredit ??
    input.legs.reduce(
      (total, leg) =>
        total + (leg.side === "short" ? leg.openPrice : -leg.openPrice),
      0,
    )
  );
}
export function normalizedSymbol(symbol: string) {
  return symbol.toUpperCase();
}
export function openedAtTimestamp(openedAt: string | undefined, now: Date) {
  return openedAt ? `${openedAt}T12:00:00.000Z` : now.toISOString();
}
export function expirationDateFromTimestamp(timestamp: string) {
  return timestamp.slice(0, 10);
}
export function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function openingCashDelta(netCredit: number, contracts: number) {
  return netCredit * contracts * multiplier;
}
export function expirationPremiumPnl(netCredit: number, contracts: number) {
  return premiumReceived(netCredit, contracts);
}
export function assignmentLedger(
  currentCash: number,
  currentMargin: number,
  strike: number,
  contracts: number,
) {
  const shares = contracts * multiplier;
  const assignmentCost = strike * shares;
  const cashAfterAssignment = currentCash - assignmentCost;
  const marginDelta = Math.max(0, -cashAfterAssignment);
  return {
    assignmentCost,
    marginDelta,
    nextCash: Math.max(0, cashAfterAssignment),
    nextMargin: currentMargin + marginDelta,
    shares,
  };
}
export function calledAwayLedger(
  costBasis: number,
  strike: number,
  contracts: number,
  netCredit: number,
) {
  const shares = contracts * multiplier;
  const calledAwayProceeds = strike * shares;
  const lotCostBasis = costBasis * shares;
  const stockRealizedPnl = calledAwayProceeds - lotCostBasis;
  return {
    calledAwayProceeds,
    lotCostBasis,
    realizedPnlDelta:
      expirationPremiumPnl(netCredit, contracts) + stockRealizedPnl,
    shares,
    stockRealizedPnl,
  };
}
export function expirationOutcome(
  strategyType: string,
  leg: {
    side: string;
    option_type: string | null;
    strike: number | null;
  } | null,
  underlying: number,
) {
  if (leg?.side === "short" && leg.option_type === "put" && leg.strike != null)
    return underlying >= leg.strike ? "expired_otm" : "assigned_put";
  if (
    strategyType === "covered_call" &&
    leg?.side === "short" &&
    leg.option_type === "call" &&
    leg.strike != null
  )
    return underlying <= leg.strike ? "expired_otm" : "called_away";
  return "manual_review";
}
