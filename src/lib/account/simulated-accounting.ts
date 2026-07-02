export const OPTION_CONTRACT_MULTIPLIER = 100;
export const DEFAULT_MARGIN_INTEREST_RATE = 0.05;

export type MarkStatus = "available" | "unavailable";

export interface SimulatedAccountingLeg {
  currentMark?: number | null;
  midPrice?: number | null;
  bidPrice?: number | null;
  askPrice?: number | null;
  openPrice: number;
  optionType?: "put" | "call" | null;
  quantity: number;
  side: "short" | "long";
  strike?: number | null;
}

export interface SimulatedAccountingPosition {
  contractsOpened: number;
  contractsRemaining: number;
  id: string;
  legs: SimulatedAccountingLeg[];
  netCredit: number;
  status: string;
  strategyType: string;
}

export interface SimulatedAccountingEvent {
  cashDelta?: number | null;
  eventType: string;
  marginDelta?: number | null;
  realizedPnlDelta?: number | null;
}

export interface SimulatedPaperAccount {
  currentCash?: number | null;
  marginBalance?: number | null;
  marginInterestRate?: number | null;
  startingCash: number;
}

export interface PositionValuation {
  markStatus: MarkStatus;
  markToClose: number | null;
  openExposure: number;
  premiumRemaining: number;
  unrealizedPnl: number | null;
}

export interface AccountSummary {
  cashBalance: number;
  marginBalance: number;
  marginInterestAccrued: number;
  marginInterestRate: number;
  openExposure: number;
  realizedPnl: number;
  totalPremiumCollected: number;
  unrealizedPnl: number | null;
  unrealizedPnlStatus: MarkStatus;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteOrZero(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function premiumReceived(
  openCredit: number,
  contracts: number,
  multiplier = OPTION_CONTRACT_MULTIPLIER,
) {
  return roundCurrency(openCredit * contracts * multiplier);
}

export function buybackCost(
  closePrice: number,
  closedContracts: number,
  multiplier = OPTION_CONTRACT_MULTIPLIER,
) {
  return roundCurrency(closePrice * closedContracts * multiplier);
}

export function realizedPnlForClose(
  openCredit: number,
  closePrice: number,
  closedContracts: number,
  multiplier = OPTION_CONTRACT_MULTIPLIER,
) {
  return roundCurrency(
    premiumReceived(openCredit, closedContracts, multiplier) -
      buybackCost(closePrice, closedContracts, multiplier),
  );
}

export function marginInterestRateForAccount(account: SimulatedPaperAccount) {
  return account.marginInterestRate ?? DEFAULT_MARGIN_INTEREST_RATE;
}

function legMark(leg: SimulatedAccountingLeg) {
  if (leg.currentMark != null) {
    return leg.currentMark;
  }

  if (leg.midPrice != null) {
    return leg.midPrice;
  }

  if (leg.bidPrice != null && leg.askPrice != null) {
    return (leg.bidPrice + leg.askPrice) / 2;
  }

  return null;
}

function netMarkToClosePerContract(position: SimulatedAccountingPosition) {
  if (position.contractsOpened <= 0) {
    return null;
  }

  let netMark = 0;

  for (const leg of position.legs) {
    const mark = legMark(leg);

    if (mark == null) {
      return null;
    }

    const quantityRatio = leg.quantity / position.contractsOpened;
    const sideMultiplier = leg.side === "short" ? 1 : -1;
    netMark += mark * quantityRatio * sideMultiplier;
  }

  return netMark;
}

function spreadWidthExposure(position: SimulatedAccountingPosition) {
  const shortLeg = position.legs.find((leg) => leg.side === "short" && leg.strike != null);
  const longLeg = position.legs.find((leg) => leg.side === "long" && leg.strike != null);

  if (!shortLeg?.strike || !longLeg?.strike) {
    return null;
  }

  return Math.abs(shortLeg.strike - longLeg.strike) *
    position.contractsRemaining *
    OPTION_CONTRACT_MULTIPLIER;
}

export function openExposureForPosition(position: SimulatedAccountingPosition) {
  if (position.contractsRemaining <= 0 || position.status === "closed") {
    return 0;
  }

  if (position.strategyType.endsWith("_spread")) {
    return roundCurrency(spreadWidthExposure(position) ?? 0);
  }

  const shortPut = position.legs.find((leg) =>
    leg.side === "short" && leg.optionType === "put" && leg.strike != null
  );

  if (shortPut?.strike) {
    return roundCurrency(
      shortPut.strike * position.contractsRemaining * OPTION_CONTRACT_MULTIPLIER,
    );
  }

  return 0;
}

export function valueOpenPosition(
  position: SimulatedAccountingPosition,
): PositionValuation {
  const premiumRemaining = premiumReceived(
    position.netCredit,
    position.contractsRemaining,
  );
  const openExposure = openExposureForPosition(position);

  if (position.contractsRemaining <= 0 || position.status === "closed") {
    return {
      markStatus: "available",
      markToClose: 0,
      openExposure: 0,
      premiumRemaining: 0,
      unrealizedPnl: 0,
    };
  }

  const markPerContract = netMarkToClosePerContract(position);

  if (markPerContract == null) {
    return {
      markStatus: "unavailable",
      markToClose: null,
      openExposure,
      premiumRemaining,
      unrealizedPnl: null,
    };
  }

  const markToClose = buybackCost(markPerContract, position.contractsRemaining);

  return {
    markStatus: "available",
    markToClose,
    openExposure,
    premiumRemaining,
    unrealizedPnl: roundCurrency(premiumRemaining - markToClose),
  };
}

export function summarizePaperAccount({
  account,
  events,
  positions,
}: {
  account: SimulatedPaperAccount;
  events: SimulatedAccountingEvent[];
  positions: SimulatedAccountingPosition[];
}): AccountSummary {
  const cashBalance = roundCurrency(
    account.startingCash +
      events.reduce((total, event) => total + finiteOrZero(event.cashDelta), 0),
  );
  const marginBalance = roundCurrency(
    finiteOrZero(account.marginBalance) +
      events.reduce((total, event) => total + finiteOrZero(event.marginDelta), 0),
  );
  const realizedPnl = roundCurrency(
    events.reduce((total, event) => total + finiteOrZero(event.realizedPnlDelta), 0),
  );
  const marginInterestAccrued = roundCurrency(
    events
      .filter((event) => event.eventType === "margin_interest")
      .reduce((total, event) => total + Math.abs(finiteOrZero(event.cashDelta)), 0),
  );
  const totalPremiumCollected = roundCurrency(
    events
      .filter((event) => event.eventType === "opened")
      .reduce((total, event) => total + Math.max(0, finiteOrZero(event.cashDelta)), 0),
  );
  const valuations = positions.map(valueOpenPosition);
  const hasUnavailableMarks = valuations.some((valuation) =>
    valuation.markStatus === "unavailable"
  );
  const unrealizedPnl = hasUnavailableMarks
    ? null
    : roundCurrency(
      valuations.reduce((total, valuation) => total + finiteOrZero(valuation.unrealizedPnl), 0),
    );

  return {
    cashBalance,
    marginBalance,
    marginInterestAccrued,
    marginInterestRate: marginInterestRateForAccount(account),
    openExposure: roundCurrency(
      valuations.reduce((total, valuation) => total + valuation.openExposure, 0),
    ),
    realizedPnl,
    totalPremiumCollected,
    unrealizedPnl,
    unrealizedPnlStatus: hasUnavailableMarks ? "unavailable" : "available",
  };
}
