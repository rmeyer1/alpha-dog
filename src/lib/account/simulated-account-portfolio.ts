import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  summarizePaperAccount,
  valueOpenPosition,
  type SimulatedAccountingEvent,
  type SimulatedAccountingLeg,
  type SimulatedAccountingPosition,
} from "./simulated-accounting";

export const paperAccountSettingsSchema = z.object({
  currentCash: z.number().finite().min(0).optional(),
  marginInterestRate: z.number().finite().min(0).max(1).optional(),
  startingCash: z.number().finite().min(0).optional(),
}).refine((input) => Object.keys(input).length > 0, {
  message: "At least one paper account setting is required.",
});

export type PaperAccountSettingsInput = z.infer<typeof paperAccountSettingsSchema>;

interface PaperAccountRow {
  created_at: string;
  current_cash: number | string;
  id: string;
  margin_balance: number | string;
  margin_interest_rate: number | string;
  starting_cash: number | string;
  updated_at: string;
  user_id: string;
}

interface PositionRow {
  closed_at: string | null;
  contracts_opened: number;
  contracts_remaining: number;
  created_at: string;
  expiration_date: string | null;
  id: string;
  net_credit: number | string;
  notes: string | null;
  opened_at: string;
  paper_account_id: string;
  source: string;
  status: string;
  strategy_type: string;
  symbol: string;
  underlying_price_at_open: number | string | null;
  updated_at: string;
  user_id: string;
}

interface LegRow {
  ask_price: number | string | null;
  bid_price: number | string | null;
  contract_symbol: string | null;
  current_mark: number | string | null;
  delta: number | string | null;
  expiration_date: string | null;
  gamma: number | string | null;
  id: string;
  implied_volatility: number | string | null;
  leg_index: number;
  mid_price: number | string | null;
  open_interest: number | string | null;
  open_price: number | string;
  option_type: "put" | "call" | null;
  position_id: string;
  quantity: number;
  quote_as_of: string | null;
  rho: number | string | null;
  side: "short" | "long";
  snapshot: Record<string, unknown>;
  strike: number | string | null;
  theta: number | string | null;
  vega: number | string | null;
  volume: number | string | null;
}

interface EventRow {
  cash_delta: number | string;
  created_at: string;
  event_type: string;
  id: string;
  margin_delta: number | string;
  metadata: Record<string, unknown>;
  paper_account_id: string;
  position_id: string;
  price: number | string | null;
  quantity: number | null;
  realized_pnl_delta: number | string;
  user_id: string;
}

const paperAccountColumns = [
  "id",
  "user_id",
  "starting_cash",
  "current_cash",
  "margin_balance",
  "margin_interest_rate",
  "created_at",
  "updated_at",
].join(",");

const positionColumns = [
  "id",
  "user_id",
  "paper_account_id",
  "source",
  "status",
  "strategy_type",
  "symbol",
  "opened_at",
  "closed_at",
  "contracts_opened",
  "contracts_remaining",
  "net_credit",
  "notes",
  "underlying_price_at_open",
  "expiration_date",
  "created_at",
  "updated_at",
].join(",");

const legColumns = [
  "id",
  "position_id",
  "leg_index",
  "side",
  "option_type",
  "contract_symbol",
  "strike",
  "expiration_date",
  "quantity",
  "open_price",
  "current_mark",
  "bid_price",
  "ask_price",
  "mid_price",
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
  "implied_volatility",
  "open_interest",
  "volume",
  "quote_as_of",
  "snapshot",
].join(",");

const eventColumns = [
  "id",
  "user_id",
  "paper_account_id",
  "position_id",
  "event_type",
  "quantity",
  "price",
  "cash_delta",
  "realized_pnl_delta",
  "margin_delta",
  "metadata",
  "created_at",
].join(",");

function numberValue(value: number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(value: number | string | null | undefined) {
  return numberValue(value) ?? 0;
}

function toPaperAccount(row: PaperAccountRow) {
  return {
    createdAt: row.created_at,
    currentCash: requiredNumber(row.current_cash),
    id: row.id,
    marginBalance: requiredNumber(row.margin_balance),
    marginInterestRate: requiredNumber(row.margin_interest_rate),
    startingCash: requiredNumber(row.starting_cash),
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function toLeg(row: LegRow) {
  return {
    askPrice: numberValue(row.ask_price),
    bidPrice: numberValue(row.bid_price),
    contractSymbol: row.contract_symbol,
    currentMark: numberValue(row.current_mark),
    delta: numberValue(row.delta),
    expirationDate: row.expiration_date,
    gamma: numberValue(row.gamma),
    id: row.id,
    impliedVolatility: numberValue(row.implied_volatility),
    legIndex: row.leg_index,
    midPrice: numberValue(row.mid_price),
    openInterest: numberValue(row.open_interest),
    openPrice: requiredNumber(row.open_price),
    optionType: row.option_type,
    positionId: row.position_id,
    quantity: row.quantity,
    quoteAsOf: row.quote_as_of,
    rho: numberValue(row.rho),
    side: row.side,
    snapshot: row.snapshot ?? {},
    strike: numberValue(row.strike),
    theta: numberValue(row.theta),
    vega: numberValue(row.vega),
    volume: numberValue(row.volume),
  };
}

function toEvent(row: EventRow) {
  return {
    cashDelta: requiredNumber(row.cash_delta),
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    marginDelta: requiredNumber(row.margin_delta),
    metadata: row.metadata ?? {},
    paperAccountId: row.paper_account_id,
    positionId: row.position_id,
    price: numberValue(row.price),
    quantity: row.quantity,
    realizedPnlDelta: requiredNumber(row.realized_pnl_delta),
    userId: row.user_id,
  };
}

function toAccountingLeg(leg: ReturnType<typeof toLeg>): SimulatedAccountingLeg {
  return {
    askPrice: leg.askPrice,
    bidPrice: leg.bidPrice,
    currentMark: leg.currentMark,
    midPrice: leg.midPrice,
    openPrice: leg.openPrice,
    optionType: leg.optionType,
    quantity: leg.quantity,
    side: leg.side,
    strike: leg.strike,
  };
}

function toAccountingPosition(
  row: PositionRow,
  legs: ReturnType<typeof toLeg>[],
): SimulatedAccountingPosition {
  return {
    contractsOpened: row.contracts_opened,
    contractsRemaining: row.contracts_remaining,
    id: row.id,
    legs: legs.map(toAccountingLeg),
    netCredit: requiredNumber(row.net_credit),
    status: row.status,
    strategyType: row.strategy_type,
  };
}

function toAccountingEvent(event: ReturnType<typeof toEvent>): SimulatedAccountingEvent {
  return {
    cashDelta: event.cashDelta,
    eventType: event.eventType,
    marginDelta: event.marginDelta,
    realizedPnlDelta: event.realizedPnlDelta,
  };
}

function stringMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function lifecycleEffectiveAt(event: ReturnType<typeof toEvent>) {
  return stringMetadataValue(event.metadata, "expiredAt") ??
    stringMetadataValue(event.metadata, "assignedAt") ??
    stringMetadataValue(event.metadata, "calledAwayAt") ??
    event.createdAt;
}

function lifecycleOutcome(
  position: PositionRow,
  event: ReturnType<typeof toEvent>,
) {
  if (event.eventType === "expired" && event.metadata.outcome === "expired_otm") {
    return "expired_otm";
  }

  if (event.eventType === "assigned") {
    return "assigned";
  }

  if (event.eventType === "called_away") {
    return "called_away";
  }

  if (
    event.eventType === "manual_adjustment" &&
    position.status === "manual_review"
  ) {
    return "manual_review";
  }

  return null;
}

function lifecycleSummary(
  position: PositionRow,
  events: ReturnType<typeof toEvent>[],
) {
  const lifecycleEvents = events
    .map((event) => ({
      event,
      outcome: lifecycleOutcome(position, event),
    }))
    .filter((entry): entry is {
      event: ReturnType<typeof toEvent>;
      outcome: "assigned" | "called_away" | "expired_otm" | "manual_review";
    } => entry.outcome != null);
  const latest = lifecycleEvents.at(-1);

  if (!latest) {
    return null;
  }

  return {
    cashDelta: latest.event.cashDelta,
    effectiveAt: lifecycleEffectiveAt(latest.event),
    eventId: latest.event.id,
    eventType: latest.event.eventType,
    marginDelta: latest.event.marginDelta,
    metadata: latest.event.metadata,
    outcome: latest.outcome,
    price: latest.event.price,
    quantity: latest.event.quantity,
    realizedPnlDelta: latest.event.realizedPnlDelta,
  };
}

function toPositionSummary(
  row: PositionRow,
  legs: ReturnType<typeof toLeg>[],
  events: ReturnType<typeof toEvent>[] = [],
) {
  const accountingPosition = toAccountingPosition(row, legs);

  return {
    closedAt: row.closed_at,
    contractsOpened: row.contracts_opened,
    contractsRemaining: row.contracts_remaining,
    createdAt: row.created_at,
    expirationDate: row.expiration_date,
    id: row.id,
    lifecycle: lifecycleSummary(row, events),
    netCredit: requiredNumber(row.net_credit),
    notes: row.notes,
    openedAt: row.opened_at,
    paperAccountId: row.paper_account_id,
    source: row.source,
    status: row.status,
    strategyType: row.strategy_type,
    symbol: row.symbol,
    underlyingPriceAtOpen: numberValue(row.underlying_price_at_open),
    updatedAt: row.updated_at,
    userId: row.user_id,
    valuation: valueOpenPosition(accountingPosition),
  };
}

function groupByPositionId<T extends { position_id?: string; positionId?: string }>(
  rows: T[],
) {
  return rows.reduce((grouped, row) => {
    const positionId = row.position_id ?? row.positionId;

    if (!positionId) {
      return grouped;
    }

    const values = grouped.get(positionId) ?? [];
    values.push(row);
    grouped.set(positionId, values);
    return grouped;
  }, new Map<string, T[]>());
}

export async function getOrCreatePaperAccountDetail(
  supabase: SupabaseClient,
  userId: string,
) {
  const existing = await supabase
    .from("paper_accounts")
    .select(paperAccountColumns)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw new Error("Unable to load paper account.");
  }

  if (existing.data) {
    return toPaperAccount(existing.data as unknown as PaperAccountRow);
  }

  const created = await supabase
    .from("paper_accounts")
    .insert({ user_id: userId })
    .select(paperAccountColumns)
    .single();

  if (created.error) {
    throw new Error("Unable to create paper account.");
  }

  return toPaperAccount(created.data as unknown as PaperAccountRow);
}

export async function updatePaperAccountSettings(
  supabase: SupabaseClient,
  userId: string,
  input: PaperAccountSettingsInput,
) {
  const account = await getOrCreatePaperAccountDetail(supabase, userId);
  const update = {
    ...(input.currentCash !== undefined ? { current_cash: input.currentCash } : {}),
    ...(input.marginInterestRate !== undefined
      ? { margin_interest_rate: input.marginInterestRate }
      : {}),
    ...(input.startingCash !== undefined ? { starting_cash: input.startingCash } : {}),
  };

  const updated = await supabase
    .from("paper_accounts")
    .update(update)
    .eq("id", account.id)
    .eq("user_id", userId)
    .select(paperAccountColumns)
    .single();

  if (updated.error) {
    throw new Error("Unable to update paper account settings.");
  }

  return toPaperAccount(updated.data as unknown as PaperAccountRow);
}

async function loadPositions(supabase: SupabaseClient, userId: string) {
  const positions = await supabase
    .from("simulated_positions")
    .select(positionColumns)
    .eq("user_id", userId)
    .order("opened_at", { ascending: false });

  if (positions.error) {
    throw new Error("Unable to load simulated positions.");
  }

  return positions.data as unknown as PositionRow[];
}

async function loadLegs(supabase: SupabaseClient, positionIds: string[]) {
  if (positionIds.length === 0) {
    return [];
  }

  const legs = await supabase
    .from("simulated_position_legs")
    .select(legColumns)
    .in("position_id", positionIds)
    .order("leg_index", { ascending: true });

  if (legs.error) {
    throw new Error("Unable to load simulated position legs.");
  }

  return legs.data as unknown as LegRow[];
}

async function loadEvents(supabase: SupabaseClient, userId: string) {
  const events = await supabase
    .from("simulated_position_events")
    .select(eventColumns)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (events.error) {
    throw new Error("Unable to load simulated position events.");
  }

  return events.data as unknown as EventRow[];
}

export async function loadAccountPortfolio(
  supabase: SupabaseClient,
  userId: string,
) {
  const account = await getOrCreatePaperAccountDetail(supabase, userId);
  const positions = await loadPositions(supabase, userId);
  const positionIds = positions.map((position) => position.id);
  const [legRows, eventRows] = await Promise.all([
    loadLegs(supabase, positionIds),
    loadEvents(supabase, userId),
  ]);
  const legsByPosition = groupByPositionId(legRows);
  const events = eventRows.map(toEvent);
  const eventsByPosition = groupByPositionId(events);
  const summaries = positions.map((position) =>
    toPositionSummary(
      position,
      (legsByPosition.get(position.id) ?? []).map(toLeg),
      eventsByPosition.get(position.id) ?? [],
    )
  );
  const accountingPositions = positions.map((position) =>
    toAccountingPosition(position, (legsByPosition.get(position.id) ?? []).map(toLeg))
  );
  const summary = summarizePaperAccount({
    account: {
      currentCash: account.currentCash,
      marginBalance: account.marginBalance,
      marginInterestRate: account.marginInterestRate,
      startingCash: account.startingCash,
    },
    events: events.map(toAccountingEvent),
    positions: accountingPositions,
  });

  return {
    account,
    historyPositions: summaries.filter((position) =>
      !["open", "partially_closed"].includes(position.status)
    ),
    openPositions: summaries.filter((position) =>
      ["open", "partially_closed"].includes(position.status)
    ),
    positions: summaries,
    summary,
  };
}

export async function loadAccountPositionDetail(
  supabase: SupabaseClient,
  userId: string,
  positionId: string,
) {
  const position = await supabase
    .from("simulated_positions")
    .select(positionColumns)
    .eq("id", positionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (position.error) {
    throw new Error("Unable to load simulated position.");
  }

  if (!position.data) {
    return null;
  }

  const row = position.data as unknown as PositionRow;
  const [legs, events] = await Promise.all([
    loadLegs(supabase, [row.id]),
    supabase
      .from("simulated_position_events")
      .select(eventColumns)
      .eq("position_id", row.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  if (!Array.isArray(legs)) {
    throw new Error("Unable to load simulated position legs.");
  }

  if (events.error) {
    throw new Error("Unable to load simulated position events.");
  }

  const normalizedLegs = legs.map(toLeg);
  const normalizedEvents = (events.data as unknown as EventRow[]).map(toEvent);

  return {
    ...toPositionSummary(row, normalizedLegs, normalizedEvents),
    events: normalizedEvents,
    legs: normalizedLegs,
  };
}
