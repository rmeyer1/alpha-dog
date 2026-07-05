import type {
  StatementImportOptionActivity,
  StatementImportOptionContract,
  StatementImportRow,
} from "./statement-import-adapters";

type OptionSide = NonNullable<StatementImportOptionActivity["side"]>;
type OptionStrategyType =
  | "call_credit_spread"
  | "put_credit_spread"
  | "short_call"
  | "short_put";

interface ReconciliationCandidate {
  activity: StatementImportOptionActivity;
  amount: number;
  contract: StatementImportOptionContract;
  price: number | null;
  quantity: number;
  row: StatementImportRow;
  side: OptionSide;
}

export interface OptionReconciliationLeg {
  closeAmount: number;
  closePrice: number | null;
  closeRowIndexes: number[];
  closedQuantity: number;
  contract: StatementImportOptionContract;
  openAmount: number;
  openedAt: string;
  openPrice: number | null;
  openRowIndexes: number[];
  openedQuantity: number;
  remainingQuantity: number;
  side: OptionSide;
}

export interface OptionReconciliationEvent {
  amount: number;
  eventType: "close" | "expire" | "open";
  idempotencyKey: string;
  price: number | null;
  quantity: number;
  rowIndexes: number[];
}

export interface OptionReconciliationGroup {
  confidence: number;
  explanation: string[];
  groupKey: string;
  lifecycle: "closed" | "expired" | "open" | "partially_closed";
  legs: OptionReconciliationLeg[];
  paperPositionKey: string | null;
  pendingQuantity: number;
  reviewReason: string | null;
  sourceRowIndexes: number[];
  status: "confirmed" | "needs_review";
  strategyType: OptionStrategyType | "unknown";
  symbol: string | null;
  events: OptionReconciliationEvent[];
}

function dateValue(row: StatementImportRow) {
  return row.activityDate ?? row.processDate ?? row.settleDate ?? "";
}

function candidateSortKey(candidate: ReconciliationCandidate) {
  return [
    dateValue(candidate.row),
    String(candidate.row.rowIndex).padStart(8, "0"),
  ].join(":");
}

function optionCandidate(row: StatementImportRow): ReconciliationCandidate | null {
  if (
    row.classification !== "option" ||
    row.optionContract == null ||
    row.optionActivity == null ||
    row.optionActivity.side == null ||
    row.quantity == null ||
    row.quantity <= 0 ||
    row.amount == null
  ) {
    return null;
  }

  return {
    activity: row.optionActivity,
    amount: row.amount,
    contract: row.optionContract,
    price: row.price,
    quantity: row.quantity,
    row,
    side: row.optionActivity.side,
  };
}

function reviewGroup(row: StatementImportRow, reason: string): OptionReconciliationGroup {
  const groupKey = `review:${row.rowIndex}`;

  return {
    confidence: 0.2,
    events: [],
    explanation: [reason],
    groupKey,
    legs: [],
    lifecycle: "open",
    paperPositionKey: null,
    pendingQuantity: 0,
    reviewReason: reason,
    sourceRowIndexes: [row.rowIndex],
    status: "needs_review",
    strategyType: "unknown",
    symbol: row.optionContract?.underlying ?? row.instrument,
  };
}

function openBucketKey(candidate: ReconciliationCandidate) {
  return [
    dateValue(candidate.row),
    candidate.row.processDate ?? "",
    candidate.row.settleDate ?? "",
    candidate.contract.underlying,
    candidate.contract.expirationDate,
    candidate.contract.optionType,
  ].join("|");
}

function contractKey(contract: StatementImportOptionContract, side: OptionSide) {
  return [
    contract.underlying,
    contract.expirationDate,
    contract.optionType,
    contract.strike.toFixed(4),
    side,
  ].join("|");
}

function groupKeyForRows(prefix: string, rowIndexes: number[]) {
  return `${prefix}:${[...rowIndexes].sort((a, b) => a - b).join("-")}`;
}

function openLeg(candidate: ReconciliationCandidate): OptionReconciliationLeg {
  return {
    closeAmount: 0,
    closePrice: null,
    closeRowIndexes: [],
    closedQuantity: 0,
    contract: candidate.contract,
    openAmount: candidate.amount,
    openedAt: dateValue(candidate.row),
    openPrice: candidate.price,
    openRowIndexes: [candidate.row.rowIndex],
    openedQuantity: candidate.quantity,
    remainingQuantity: candidate.quantity,
    side: candidate.side,
  };
}

function strategyTypeForSingle(candidate: ReconciliationCandidate): OptionStrategyType {
  return candidate.contract.optionType === "put" ? "short_put" : "short_call";
}

function spreadStrategyType(shortLeg: ReconciliationCandidate): OptionStrategyType {
  return shortLeg.contract.optionType === "put" ? "put_credit_spread" : "call_credit_spread";
}

function isCreditSpreadPair(shortLeg: ReconciliationCandidate, longLeg: ReconciliationCandidate) {
  if (
    shortLeg.contract.underlying !== longLeg.contract.underlying ||
    shortLeg.contract.expirationDate !== longLeg.contract.expirationDate ||
    shortLeg.contract.optionType !== longLeg.contract.optionType ||
    shortLeg.quantity !== longLeg.quantity
  ) {
    return false;
  }

  if (shortLeg.contract.optionType === "put") {
    return shortLeg.contract.strike > longLeg.contract.strike;
  }

  return shortLeg.contract.strike < longLeg.contract.strike;
}

function confirmedGroup({
  confidence,
  explanation,
  legs,
  strategyType,
}: {
  confidence: number;
  explanation: string[];
  legs: OptionReconciliationLeg[];
  strategyType: OptionStrategyType;
}): OptionReconciliationGroup {
  const sourceRowIndexes = legs.flatMap((leg) => leg.openRowIndexes);
  const groupKey = groupKeyForRows("option", sourceRowIndexes);
  const openAmount = legs.reduce((total, leg) => total + leg.openAmount, 0);
  const openedQuantity = Math.max(...legs.map((leg) => leg.openedQuantity));
  const symbol = legs[0]?.contract.underlying ?? null;

  return {
    confidence,
    events: [{
      amount: openAmount,
      eventType: "open",
      idempotencyKey: `${groupKey}:open`,
      price: legs[0]?.openPrice ?? null,
      quantity: openedQuantity,
      rowIndexes: sourceRowIndexes,
    }],
    explanation,
    groupKey,
    legs,
    lifecycle: "open",
    paperPositionKey: `${groupKey}:position`,
    pendingQuantity: openedQuantity,
    reviewReason: null,
    sourceRowIndexes,
    status: "confirmed",
    strategyType,
    symbol,
  };
}

function markGroupForReview(group: OptionReconciliationGroup, reason: string) {
  group.confidence = Math.min(group.confidence, 0.5);
  group.explanation.push(reason);
  group.paperPositionKey = null;
  group.reviewReason = reason;
  group.status = "needs_review";
}

function reconcileOpenBucket(candidates: ReconciliationCandidate[]) {
  const groups: OptionReconciliationGroup[] = [];
  const used = new Set<number>();
  const shorts = candidates.filter((candidate) =>
    candidate.activity.action === "open_short" && candidate.side === "short"
  );
  const longs = candidates.filter((candidate) =>
    candidate.activity.action === "open_long" && candidate.side === "long"
  );

  for (const shortLeg of shorts) {
    const matchingLongs = longs.filter((longLeg) =>
      !used.has(longLeg.row.rowIndex) && isCreditSpreadPair(shortLeg, longLeg)
    );

    if (matchingLongs.length === 1) {
      const longLeg = matchingLongs[0];
      used.add(shortLeg.row.rowIndex);
      used.add(longLeg.row.rowIndex);
      groups.push(confirmedGroup({
        confidence: 0.95,
        explanation: [
          "Grouped as a high-confidence credit spread: same date, underlying, expiration, option type, matching quantity, complementary open codes, and valid strike relationship.",
        ],
        legs: [openLeg(shortLeg), openLeg(longLeg)],
        strategyType: spreadStrategyType(shortLeg),
      }));
    } else if (matchingLongs.length > 1) {
      used.add(shortLeg.row.rowIndex);
      groups.push(reviewGroup(
        shortLeg.row,
        "Multiple possible long hedge legs matched this short option open.",
      ));
    }
  }

  for (const shortLeg of shorts) {
    if (used.has(shortLeg.row.rowIndex)) {
      continue;
    }

    used.add(shortLeg.row.rowIndex);
    groups.push(confirmedGroup({
      confidence: 0.85,
      explanation: [
        "Grouped as a single-leg short option trade: open short code with normalized contract and quantity.",
      ],
      legs: [openLeg(shortLeg)],
      strategyType: strategyTypeForSingle(shortLeg),
    }));
  }

  for (const longLeg of longs) {
    if (used.has(longLeg.row.rowIndex)) {
      continue;
    }

    groups.push(reviewGroup(
      longLeg.row,
      "Standalone long option opens are out of MVP unless paired with a credit spread.",
    ));
  }

  return groups;
}

function applyCloseOrExpiration(
  group: OptionReconciliationGroup,
  candidate: ReconciliationCandidate,
) {
  const leg = group.legs.find((candidateLeg) =>
    candidateLeg.remainingQuantity > 0 &&
    candidateLeg.openedAt <= dateValue(candidate.row) &&
    candidateLeg.side === candidate.side &&
    contractKey(candidateLeg.contract, candidateLeg.side) ===
      contractKey(candidate.contract, candidate.side)
  );

  if (!leg) {
    return false;
  }

  if (candidate.quantity > leg.remainingQuantity) {
    markGroupForReview(
      group,
      "Close or expiration quantity exceeds the remaining open quantity.",
    );
    return true;
  }

  leg.closeAmount += candidate.amount;
  leg.closePrice = candidate.price;
  leg.closeRowIndexes.push(candidate.row.rowIndex);
  leg.closedQuantity += candidate.quantity;
  leg.remainingQuantity -= candidate.quantity;
  group.sourceRowIndexes.push(candidate.row.rowIndex);
  group.sourceRowIndexes.sort((left, right) => left - right);

  const eventType = candidate.activity.effect === "expire" ? "expire" : "close";
  group.events.push({
    amount: candidate.amount,
    eventType,
    idempotencyKey: `${group.groupKey}:${eventType}:${candidate.row.rowIndex}`,
    price: candidate.price,
    quantity: candidate.quantity,
    rowIndexes: [candidate.row.rowIndex],
  });

  const remainingQuantity = Math.max(...group.legs.map((groupLeg) => groupLeg.remainingQuantity));
  const openedQuantity = Math.max(...group.legs.map((groupLeg) => groupLeg.openedQuantity));
  group.pendingQuantity = remainingQuantity;

  if (remainingQuantity === 0) {
    group.lifecycle = eventType === "expire" ? "expired" : "closed";
  } else if (remainingQuantity < openedQuantity) {
    group.lifecycle = "partially_closed";
  }

  group.explanation.push(
    `${eventType === "expire" ? "Matched expiration" : "Matched close"} row ${candidate.row.rowIndex} by normalized contract, side, quantity, and date order.`,
  );

  return true;
}

export function reconcileImportedOptionRows(
  rows: StatementImportRow[],
): OptionReconciliationGroup[] {
  const groups: OptionReconciliationGroup[] = [];
  const reviewRows: OptionReconciliationGroup[] = [];
  const openBuckets = new Map<string, ReconciliationCandidate[]>();
  const closeCandidates: ReconciliationCandidate[] = [];

  for (const row of rows) {
    if (row.classification !== "option") {
      continue;
    }

    const candidate = optionCandidate(row);

    if (!candidate) {
      reviewRows.push(reviewGroup(
        row,
        "Option row is missing normalized contract, activity, quantity, or cash movement.",
      ));
      continue;
    }

    if (candidate.activity.effect === "open") {
      const key = openBucketKey(candidate);
      openBuckets.set(key, [...(openBuckets.get(key) ?? []), candidate]);
    } else {
      closeCandidates.push(candidate);
    }
  }

  for (const candidates of openBuckets.values()) {
    groups.push(...reconcileOpenBucket(
      [...candidates].sort((left, right) => candidateSortKey(left).localeCompare(candidateSortKey(right))),
    ));
  }

  const confirmedGroups = groups
    .filter((group) => group.status === "confirmed")
    .sort((left, right) =>
      (left.sourceRowIndexes[0] ?? 0) - (right.sourceRowIndexes[0] ?? 0)
    );

  for (const candidate of closeCandidates.sort((left, right) =>
    candidateSortKey(left).localeCompare(candidateSortKey(right))
  )) {
    const matched = confirmedGroups.some((group) => applyCloseOrExpiration(group, candidate));

    if (!matched) {
      reviewRows.push(reviewGroup(
        candidate.row,
        "Could not match option close or expiration row to an open position.",
      ));
    }
  }

  return [...groups, ...reviewRows].sort((left, right) =>
    (left.sourceRowIndexes[0] ?? 0) - (right.sourceRowIndexes[0] ?? 0)
  );
}
