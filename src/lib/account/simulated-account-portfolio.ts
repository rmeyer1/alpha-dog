import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  summarizePaperAccount,
  valueOpenPosition,
  type SimulatedAccountingLeg,
  type SimulatedAccountingPosition,
} from "./simulated-accounting";
import {
  AccountPaginationError,
  createEventCursor,
  createPositionCursor,
  type EventCursor,
  type PositionCollection,
  type PositionCursor,
} from "./pagination";

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
  candidate_as_of: string | null;
  candidate_cache_source: string | null;
  candidate_cache_status: string | null;
  candidate_feed: string | null;
  closed_at: string | null;
  contracts_opened: number;
  contracts_remaining: number;
  created_at: string;
  data_source_mode: "demo" | "live" | "unknown";
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

interface PortfolioSummaryRow {
  cash_balance: number | string;
  history_position_count: number | string;
  margin_balance: number | string;
  margin_interest_accrued: number | string;
  margin_interest_rate: number | string;
  open_exposure: number | string;
  open_position_count: number | string;
  position_watermark: string;
  realized_pnl: number | string;
  total_premium_collected: number | string;
  unrealized_pnl: number | string | null;
  unrealized_pnl_status: "available" | "unavailable";
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
  "data_source_mode",
  "candidate_feed",
  "candidate_cache_status",
  "candidate_cache_source",
  "candidate_as_of",
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
  const latest = lifecycleEvents.reduce<(typeof lifecycleEvents)[number] | null>(
    (current, entry) => {
      if (!current) {
        return entry;
      }

      const byCreatedAt = entry.event.createdAt.localeCompare(
        current.event.createdAt,
      );

      return byCreatedAt > 0 ||
          (byCreatedAt === 0 && entry.event.id.localeCompare(current.event.id) > 0)
        ? entry
        : current;
    },
    null,
  );

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
    dataProvenance: {
      asOf: row.candidate_as_of,
      cacheSource: row.candidate_cache_source,
      cacheStatus: row.candidate_cache_status,
      feed: row.candidate_feed,
      sourceMode: row.data_source_mode,
    },
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

export async function loadAccountPositionPage(
  supabase: SupabaseClient,
  userId: string,
  {
    cursor,
    limit,
    scope,
    watermark,
  }: {
    cursor: PositionCursor | null;
    limit: number;
    scope: PositionCollection;
    watermark: string;
  },
) {
  if (cursor && cursor.watermark !== watermark) {
    throw new AccountPaginationError(
      "STALE_POSITION_CURSOR",
      "The position list changed or its cursor expired. Refresh the position list.",
      409,
    );
  }

  const positions = await supabase.rpc("get_paper_account_position_page", {
    p_page_size: limit + 1,
    p_position_id: cursor?.id ?? null,
    p_scope: scope,
    p_sort_at: cursor?.sortAt ?? null,
  });

  if (positions.error) {
    throw new Error("Unable to load simulated positions.");
  }

  const rows = positions.data as unknown as PositionRow[];
  const hasNextPage = rows.length > limit;
  const visibleRows = rows.slice(0, limit);
  const visibleIds = visibleRows.map((position) => position.id);
  const [legRows, lifecycleRows] = await Promise.all([
    loadLegs(supabase, visibleIds),
    loadLatestLifecycleEvents(supabase, visibleIds),
  ]);
  const legsByPosition = groupByPositionId(legRows);
  const lifecycleByPosition = groupByPositionId(lifecycleRows.map(toEvent));
  const summaries = visibleRows.map((position) =>
    toPositionSummary(
      position,
      (legsByPosition.get(position.id) ?? []).map(toLeg),
      lifecycleByPosition.get(position.id) ?? [],
    )
  );
  const last = hasNextPage ? visibleRows.at(-1) : null;

  return {
    nextCursor: last
      ? createPositionCursor({
          id: last.id,
          ownerId: userId,
          scope,
          sortAt: last.opened_at,
          watermark,
        })
      : null,
    positions: summaries,
    scope,
  };
}

async function loadLatestLifecycleEvents(
  supabase: SupabaseClient,
  positionIds: string[],
) {
  if (positionIds.length === 0) {
    return [];
  }

  const events = await supabase.rpc(
    "get_latest_simulated_position_lifecycle_events",
    { p_position_ids: positionIds },
  );

  if (events.error) {
    throw new Error("Unable to load simulated position lifecycle.");
  }

  return events.data as unknown as EventRow[];
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

export async function loadPaperAccountOverview(
  supabase: SupabaseClient,
  userId: string,
) {
  const account = await getOrCreatePaperAccountDetail(supabase, userId);
  const aggregate = await supabase.rpc("get_paper_account_portfolio_summary");

  if (aggregate.error) {
    throw new Error("Unable to load paper account summary.");
  }

  const row = (Array.isArray(aggregate.data) ? aggregate.data[0] : aggregate.data) as
    | PortfolioSummaryRow
    | null;

  if (!row) {
    return {
      account,
      historyPositionCount: 0,
      openPositionCount: 0,
      positionWatermark: "1970-01-01T00:00:00.000Z",
      summary: summarizePaperAccount({
        account: {
          currentCash: account.currentCash,
          marginBalance: account.marginBalance,
          marginInterestRate: account.marginInterestRate,
          startingCash: account.startingCash,
        },
        events: [],
        positions: [],
      }),
    };
  }

  return {
    account,
    historyPositionCount: requiredNumber(row.history_position_count),
    openPositionCount: requiredNumber(row.open_position_count),
    positionWatermark: row.position_watermark,
    summary: {
      cashBalance: requiredNumber(row.cash_balance),
      marginBalance: requiredNumber(row.margin_balance),
      marginInterestAccrued: requiredNumber(row.margin_interest_accrued),
      marginInterestRate: requiredNumber(row.margin_interest_rate),
      openExposure: requiredNumber(row.open_exposure),
      realizedPnl: requiredNumber(row.realized_pnl),
      totalPremiumCollected: requiredNumber(row.total_premium_collected),
      unrealizedPnl: numberValue(row.unrealized_pnl),
      unrealizedPnlStatus: row.unrealized_pnl_status,
    },
  };
}

export async function loadAccountPositionDetail(
  supabase: SupabaseClient,
  userId: string,
  positionId: string,
  {
    eventCursor,
    eventLimit,
  }: {
    eventCursor: EventCursor | null;
    eventLimit: number;
  },
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
    supabase.rpc("get_simulated_position_event_page", {
      p_event_id: eventCursor?.id ?? null,
      p_page_size: eventLimit + 1,
      p_position_id: row.id,
      p_sort_at: eventCursor?.sortAt ?? null,
    }),
  ]);

  if (!Array.isArray(legs)) {
    throw new Error("Unable to load simulated position legs.");
  }

  if (events.error) {
    throw new Error("Unable to load simulated position events.");
  }

  const normalizedLegs = legs.map(toLeg);
  const eventRows = events.data as unknown as EventRow[];
  const hasNextEventPage = eventRows.length > eventLimit;
  const normalizedEvents = eventRows.slice(0, eventLimit).map(toEvent);
  const lastEvent = hasNextEventPage ? normalizedEvents.at(-1) : null;

  return {
    ...toPositionSummary(row, normalizedLegs, normalizedEvents),
    events: normalizedEvents,
    legs: normalizedLegs,
    nextEventCursor: lastEvent
      ? createEventCursor({
          id: lastEvent.id,
          ownerId: userId,
          positionId: row.id,
          sortAt: lastEvent.createdAt,
        })
      : null,
  };
}
