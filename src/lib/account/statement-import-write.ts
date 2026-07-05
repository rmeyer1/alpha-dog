import type { SupabaseClient } from "@supabase/supabase-js";
import { OPTION_CONTRACT_MULTIPLIER } from "./simulated-accounting";
import { getOrCreatePaperAccount } from "./simulated-positions";
import type { StatementImportRow } from "./statement-import-adapters";
import {
  reconcileImportedOptionRows,
  type OptionReconciliationGroup,
  type OptionReconciliationLeg,
} from "./statement-import-reconciliation";

type SimulatedPositionStatus = "closed" | "expired" | "open" | "partially_closed";
type SimulatedStrategyType =
  | "call_credit_spread"
  | "custom"
  | "put_credit_spread"
  | "short_put";

interface PlannedPosition {
  events: Record<string, unknown>[];
  externalSourceId: string;
  legs: Record<string, unknown>[];
  position: Record<string, unknown>;
}

interface PlannedEquityLot {
  acquiredAt: string;
  costBasis: number;
  rowIndex: number;
  shares: number;
  symbol: string;
}

export interface StatementImportWritePlan {
  dividendRows: StatementImportRow[];
  equityLots: PlannedEquityLot[];
  excludedRows: StatementImportRow[];
  optionPositions: PlannedPosition[];
  reviewGroups: OptionReconciliationGroup[];
  summary: {
    dividendsTracked: number;
    equityLots: number;
    excludedRows: number;
    optionPositions: number;
    reviewGroups: number;
  };
}

export interface StatementImportWriteResult {
  insertedEquityLots: number;
  insertedEvents: number;
  insertedPositions: number;
  skippedEquityLots: number;
  skippedPositions: number;
  summary: StatementImportWritePlan["summary"];
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toTimestamp(date: string | null | undefined) {
  return date ? `${date}T00:00:00.000Z` : new Date(0).toISOString();
}

function normalizedTransCode(row: StatementImportRow) {
  return row.transCode?.trim().toUpperCase() ?? "";
}

function optionContractSymbol(leg: OptionReconciliationLeg) {
  const expiration = leg.contract.expirationDate.slice(2).replaceAll("-", "");
  const typeCode = leg.contract.optionType === "put" ? "P" : "C";
  const strikeCode = Math.round(leg.contract.strike * 1000).toString().padStart(8, "0");

  return `${leg.contract.underlying}${expiration}${typeCode}${strikeCode}`;
}

function statusForGroup(group: OptionReconciliationGroup): SimulatedPositionStatus {
  if (group.lifecycle === "expired") {
    return "expired";
  }

  if (group.lifecycle === "closed") {
    return "closed";
  }

  if (group.lifecycle === "partially_closed") {
    return "partially_closed";
  }

  return "open";
}

function strategyTypeForGroup(group: OptionReconciliationGroup): SimulatedStrategyType {
  if (
    group.strategyType === "call_credit_spread" ||
    group.strategyType === "put_credit_spread" ||
    group.strategyType === "short_put"
  ) {
    return group.strategyType;
  }

  return "custom";
}

function openAmountForGroup(group: OptionReconciliationGroup) {
  return group.legs.reduce((total, leg) => total + leg.openAmount, 0);
}

function openedQuantityForGroup(group: OptionReconciliationGroup) {
  return Math.max(...group.legs.map((leg) => leg.openedQuantity));
}

function closeDateForGroup(group: OptionReconciliationGroup, rowsByIndex: Map<number, StatementImportRow>) {
  const closeRowIndexes = group.events
    .filter((event) => event.eventType !== "open")
    .flatMap((event) => event.rowIndexes);
  const lastRowIndex = closeRowIndexes.at(-1);
  const lastRow = lastRowIndex == null ? null : rowsByIndex.get(lastRowIndex);

  return lastRow ? toTimestamp(lastRow.activityDate ?? lastRow.processDate ?? lastRow.settleDate) : null;
}

function closeEventType(
  group: OptionReconciliationGroup,
  eventIndex: number,
): "expired" | "full_close" | "partial_close" {
  const event = group.events[eventIndex];

  if (event.eventType === "expire") {
    return "expired";
  }

  const laterCloseEvents = group.events.slice(eventIndex + 1).some((candidate) =>
    candidate.eventType !== "open"
  );

  return group.pendingQuantity === 0 && !laterCloseEvents ? "full_close" : "partial_close";
}

function realizedPnlForEvent(group: OptionReconciliationGroup, eventRowIndex: number, quantity: number, amount: number) {
  const leg = group.legs.find((candidate) => candidate.closeRowIndexes.includes(eventRowIndex));

  if (!leg || leg.openedQuantity <= 0) {
    return 0;
  }

  const allocatedOpenAmount = (leg.openAmount / leg.openedQuantity) * quantity;
  return roundCurrency(allocatedOpenAmount + amount);
}

function optionPositionForGroup(
  group: OptionReconciliationGroup,
  rowsByIndex: Map<number, StatementImportRow>,
): PlannedPosition | null {
  if (group.status !== "confirmed" || !group.paperPositionKey || group.legs.length === 0) {
    return null;
  }

  const contractsOpened = openedQuantityForGroup(group);
  const openAmount = openAmountForGroup(group);
  const netCredit = roundCurrency(openAmount / contractsOpened / OPTION_CONTRACT_MULTIPLIER);

  if (contractsOpened <= 0 || netCredit < 0) {
    return null;
  }

  const openedAt = toTimestamp(group.legs[0]?.openedAt);
  const closedAt = group.lifecycle === "open" || group.lifecycle === "partially_closed"
    ? null
    : closeDateForGroup(group, rowsByIndex);

  const position = {
    closed_at: closedAt,
    contracts_opened: contractsOpened,
    contracts_remaining: group.pendingQuantity,
    expiration_date: group.legs[0]?.contract.expirationDate ?? null,
    external_source_id: group.paperPositionKey,
    net_credit: netCredit,
    notes: `Imported from broker statement rows ${group.sourceRowIndexes.join(", ")}.`,
    opened_at: openedAt,
    source: "statement_import",
    status: statusForGroup(group),
    strategy_type: strategyTypeForGroup(group),
    symbol: group.symbol,
    underlying_price_at_open: null,
  };

  const legs = group.legs.map((leg, index) => ({
    contract_symbol: optionContractSymbol(leg),
    expiration_date: leg.contract.expirationDate,
    leg_index: index,
    open_price: leg.openPrice ?? 0,
    option_type: leg.contract.optionType,
    quantity: leg.openedQuantity,
    side: leg.side,
    snapshot: {
      importCloseRowIndexes: leg.closeRowIndexes,
      importOpenRowIndexes: leg.openRowIndexes,
      source: "statement_import",
    },
    strike: leg.contract.strike,
  }));

  const events = group.events.map((event, index) => {
    const rowIndex = event.rowIndexes[0];
    const row = rowIndex == null ? null : rowsByIndex.get(rowIndex);
    const eventType = event.eventType === "open" ? "opened" : closeEventType(group, index);
    const realizedPnlDelta = event.eventType === "open"
      ? 0
      : realizedPnlForEvent(group, rowIndex ?? -1, event.quantity, event.amount);

    return {
      cash_delta: event.amount,
      created_at: toTimestamp(row?.activityDate ?? row?.processDate ?? row?.settleDate),
      event_type: eventType,
      margin_delta: 0,
      metadata: {
        idempotencyKey: event.idempotencyKey,
        importGroupKey: group.groupKey,
        importRowIndexes: event.rowIndexes,
        source: "statement_import",
      },
      price: event.price,
      quantity: event.quantity,
      realized_pnl_delta: realizedPnlDelta,
    };
  });

  return {
    events,
    externalSourceId: group.paperPositionKey,
    legs,
    position,
  };
}

function equityLotForRow(row: StatementImportRow): PlannedEquityLot | null {
  if (
    row.classification !== "equity" ||
    row.instrument == null ||
    row.quantity == null ||
    row.quantity <= 0 ||
    row.amount == null
  ) {
    return null;
  }

  const transCode = normalizedTransCode(row);
  const sideMultiplier = transCode === "SELL" ? -1 : 1;
  const price = row.price ?? Math.abs(row.amount / row.quantity);

  return {
    acquiredAt: toTimestamp(row.activityDate ?? row.processDate ?? row.settleDate),
    costBasis: roundCurrency(price),
    rowIndex: row.rowIndex,
    shares: row.quantity * sideMultiplier,
    symbol: row.instrument.toUpperCase(),
  };
}

export function buildStatementImportWritePlan(
  rows: StatementImportRow[],
  groups = reconcileImportedOptionRows(rows),
): StatementImportWritePlan {
  const rowsByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const optionPositions = groups
    .map((group) => optionPositionForGroup(group, rowsByIndex))
    .filter((position) => position != null);
  const equityLots = rows
    .map(equityLotForRow)
    .filter((lot) => lot != null);
  const dividendRows = rows.filter((row) => row.classification === "dividend");
  const excludedRows = rows.filter((row) =>
    row.classification === "out_of_scope" || row.classification === "cash"
  );
  const reviewGroups = groups.filter((group) => group.status === "needs_review");

  return {
    dividendRows,
    equityLots,
    excludedRows,
    optionPositions,
    reviewGroups,
    summary: {
      dividendsTracked: dividendRows.length,
      equityLots: equityLots.length,
      excludedRows: excludedRows.length,
      optionPositions: optionPositions.length,
      reviewGroups: reviewGroups.length,
    },
  };
}

async function existingPosition(
  supabase: SupabaseClient,
  userId: string,
  externalSourceId: string,
) {
  const result = await supabase
    .from("simulated_positions")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "statement_import")
    .eq("external_source_id", externalSourceId)
    .maybeSingle();

  if (result.error) {
    throw new Error("Unable to check existing imported position.");
  }

  return result.data as { id: string } | null;
}

async function existingEquityLot(
  supabase: SupabaseClient,
  userId: string,
  paperAccountId: string,
  lot: PlannedEquityLot,
) {
  const result = await supabase
    .from("simulated_equity_lots")
    .select("id")
    .eq("user_id", userId)
    .eq("paper_account_id", paperAccountId)
    .eq("symbol", lot.symbol)
    .eq("shares", lot.shares)
    .eq("cost_basis", lot.costBasis)
    .eq("acquired_at", lot.acquiredAt)
    .is("source_position_id", null)
    .maybeSingle();

  if (result.error) {
    throw new Error("Unable to check existing imported equity lot.");
  }

  return result.data as { id: string } | null;
}

export async function writeStatementImportToPaperAccount(
  supabase: SupabaseClient,
  userId: string,
  rows: StatementImportRow[],
  groups = reconcileImportedOptionRows(rows),
): Promise<StatementImportWriteResult> {
  const paperAccount = await getOrCreatePaperAccount(supabase, userId);
  const plan = buildStatementImportWritePlan(rows, groups);
  let insertedPositions = 0;
  let insertedEvents = 0;
  let skippedPositions = 0;
  let insertedEquityLots = 0;
  let skippedEquityLots = 0;

  for (const planned of plan.optionPositions) {
    if (await existingPosition(supabase, userId, planned.externalSourceId)) {
      skippedPositions += 1;
      continue;
    }

    const positionResult = await supabase
      .from("simulated_positions")
      .insert({
        ...planned.position,
        paper_account_id: paperAccount.id,
        user_id: userId,
      })
      .select("id,paper_account_id")
      .single();

    if (positionResult.error || !positionResult.data) {
      throw new Error("Unable to create imported simulated position.");
    }

    const position = positionResult.data as { id: string; paper_account_id: string };

    const legsResult = await supabase
      .from("simulated_position_legs")
      .insert(planned.legs.map((leg) => ({
        ...leg,
        position_id: position.id,
      })));

    if (legsResult.error) {
      throw new Error("Unable to create imported simulated position legs.");
    }

    const eventsResult = await supabase
      .from("simulated_position_events")
      .insert(planned.events.map((event) => ({
        ...event,
        paper_account_id: paperAccount.id,
        position_id: position.id,
        user_id: userId,
      })));

    if (eventsResult.error) {
      throw new Error("Unable to create imported simulated position events.");
    }

    insertedPositions += 1;
    insertedEvents += planned.events.length;
  }

  for (const lot of plan.equityLots) {
    if (await existingEquityLot(supabase, userId, paperAccount.id, lot)) {
      skippedEquityLots += 1;
      continue;
    }

    const lotResult = await supabase
      .from("simulated_equity_lots")
      .insert({
        acquired_at: lot.acquiredAt,
        cost_basis: lot.costBasis,
        paper_account_id: paperAccount.id,
        shares: lot.shares,
        source_position_id: null,
        symbol: lot.symbol,
        user_id: userId,
      });

    if (lotResult.error) {
      throw new Error("Unable to create imported simulated equity lot.");
    }

    insertedEquityLots += 1;
  }

  return {
    insertedEquityLots,
    insertedEvents,
    insertedPositions,
    skippedEquityLots,
    skippedPositions,
    summary: plan.summary,
  };
}

