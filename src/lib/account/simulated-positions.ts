import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buybackCost,
  OPTION_CONTRACT_MULTIPLIER,
  premiumReceived,
  realizedPnlForClose,
} from "./simulated-accounting";
/** Public facade: contracts live in contracts.ts; persistence and lifecycle remain below. */
export {
  closeSimulatedPositionInputSchema,
  expireSimulatedPositionInputSchema,
  simulatedPositionInputSchema,
  SimulatedPositionValidationError,
} from "./simulated-positions/contracts";
export type {
  CloseSimulatedPositionInput,
  ExpireSimulatedPositionInput,
  SimulatedPositionInput,
} from "./simulated-positions/contracts";
import {
  SimulatedPositionValidationError,
  type CloseSimulatedPositionInput,
  type ExpireSimulatedPositionInput,
  type SimulatedPositionInput,
} from "./simulated-positions/contracts";
import {
  calculateNetCredit,
  expirationDateFromTimestamp,
  numberValue,
  openedAtTimestamp as normalizedOpenedAtTimestamp,
  openingCashDelta,
} from "./simulated-positions/domain";
import {
  getOrCreatePaperAccount,
  hasRpc,
  rpcOrThrow,
} from "./simulated-positions/repository";
import { closeTransition } from "./simulated-positions/lifecycle";

interface PaperAccountRow {
  current_cash?: number | string | null;
  id: string;
  margin_balance?: number | string | null;
  user_id?: string;
}

export interface SimulatedPositionRow {
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
  net_credit: number;
  notes: string | null;
  opened_at: string;
  paper_account_id: string;
  source: string;
  status: string;
  strategy_type: SimulatedPositionInput["strategyType"];
  symbol: string;
  underlying_price_at_open: number | null;
  updated_at: string;
  user_id: string;
}

interface SimulatedPositionLegRow {
  ask_price: number | null;
  bid_price: number | null;
  contract_symbol: string | null;
  current_mark: number | null;
  delta: number | null;
  expiration_date: string | null;
  gamma: number | null;
  id: string;
  implied_volatility: number | null;
  leg_index: number;
  mid_price: number | null;
  open_interest: number | null;
  open_price: number;
  option_type: "put" | "call" | null;
  position_id: string;
  quantity: number;
  quote_as_of: string | null;
  rho: number | null;
  side: "short" | "long";
  snapshot: Record<string, unknown>;
  strike: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
}

interface SimulatedPositionEventRow {
  cash_delta: number;
  created_at: string;
  event_type: string;
  id: string;
  margin_delta: number;
  metadata: Record<string, unknown>;
  paper_account_id: string;
  position_id: string;
  price: number;
  quantity: number;
  realized_pnl_delta: number;
  user_id: string;
}

interface SimulatedEquityLotRow {
  acquired_at: string;
  cost_basis: number;
  id: string;
  paper_account_id: string;
  shares: number;
  source_position_id: string | null;
  symbol: string;
  user_id: string;
}

type AssignableShortPutLeg = SimulatedPositionLegRow & {
  option_type: "put";
  side: "short";
  strike: number;
};

type AssignableShortCallLeg = SimulatedPositionLegRow & {
  option_type: "call";
  side: "short";
  strike: number;
};

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

const paperAccountColumns = [
  "id",
  "user_id",
  "current_cash",
  "margin_balance",
].join(",");

const equityLotColumns = [
  "id",
  "user_id",
  "paper_account_id",
  "symbol",
  "shares",
  "cost_basis",
  "source_position_id",
  "acquired_at",
].join(",");

function assertPositiveNetCredit(netCredit: number) {
  if (netCredit <= 0) {
    throw new SimulatedPositionValidationError(
      "INVALID_NET_CREDIT",
      "Position net credit must be greater than zero.",
    );
  }
}

function singleShortPutLeg(legs: SimulatedPositionLegRow[]): AssignableShortPutLeg | null {
  if (legs.length !== 1) {
    return null;
  }

  const [leg] = legs;

  if (
    leg.side !== "short" ||
    leg.option_type !== "put" ||
    leg.strike == null
  ) {
    return null;
  }

  return leg as AssignableShortPutLeg;
}

function singleShortCallLeg(legs: SimulatedPositionLegRow[]): AssignableShortCallLeg | null {
  if (legs.length !== 1) {
    return null;
  }

  const [leg] = legs;

  if (
    leg.side !== "short" ||
    leg.option_type !== "call" ||
    leg.strike == null
  ) {
    return null;
  }

  return leg as AssignableShortCallLeg;
}

export { getOrCreatePaperAccount } from "./simulated-positions/repository";

export async function createSimulatedPosition(
  supabase: SupabaseClient,
  userId: string,
  input: SimulatedPositionInput,
  now = new Date(),
) {
  const dataProvenance = input.dataProvenance ?? {
    sourceMode: "unknown" as const,
  };

  if (hasRpc(supabase)) {
    const netCredit = calculateNetCredit(input);

    assertPositiveNetCredit(netCredit);

    return await rpcOrThrow<{
      event: SimulatedPositionEventRow;
      legs: SimulatedPositionLegRow[];
      paperAccount: PaperAccountRow;
      position: SimulatedPositionRow;
    }>(
      supabase,
      "open_simulated_position_atomic",
      {
        p_input: {
          ...input,
          netCredit,
          symbol: input.symbol.toUpperCase(),
        },
      },
      "Unable to create simulated position.",
    );
  }

  const paperAccount = await getOrCreatePaperAccount(supabase, userId);
  const openedAt = normalizedOpenedAtTimestamp(input.openedAt, now);
  const netCredit = calculateNetCredit(input);
  const symbol = input.symbol.toUpperCase();

  assertPositiveNetCredit(netCredit);

  const positionResult = await supabase
    .from("simulated_positions")
    .insert({
      contracts_opened: input.contracts,
      contracts_remaining: input.contracts,
      data_source_mode: dataProvenance.sourceMode,
      candidate_feed: dataProvenance.feed ?? null,
      candidate_cache_status: dataProvenance.cacheStatus ?? null,
      candidate_cache_source: dataProvenance.cacheSource ?? null,
      candidate_as_of: dataProvenance.asOf ?? null,
      expiration_date: input.expirationDate ?? null,
      net_credit: netCredit,
      notes: input.notes ?? null,
      opened_at: openedAt,
      paper_account_id: paperAccount.id,
      source: "simulated",
      status: "open",
      strategy_type: input.strategyType,
      symbol,
      underlying_price_at_open: input.underlyingPriceAtOpen ?? null,
      user_id: userId,
    })
    .select(positionColumns)
    .single();

  if (positionResult.error) {
    throw new Error("Unable to create simulated position.");
  }

  const position = positionResult.data as unknown as SimulatedPositionRow;

  try {
    const legRows = input.legs.map((leg, index) => ({
      ask_price: leg.askPrice ?? null,
      bid_price: leg.bidPrice ?? null,
      contract_symbol: leg.contractSymbol ?? null,
      current_mark: leg.currentMark ?? null,
      delta: leg.delta ?? null,
      expiration_date: leg.expirationDate ?? input.expirationDate ?? null,
      gamma: leg.gamma ?? null,
      implied_volatility: leg.impliedVolatility ?? null,
      leg_index: leg.legIndex ?? index,
      mid_price: leg.midPrice ?? null,
      open_interest: leg.openInterest ?? null,
      open_price: leg.openPrice,
      option_type: leg.optionType ?? null,
      position_id: position.id,
      quantity: leg.quantity ?? input.contracts,
      quote_as_of: leg.quoteAsOf ?? null,
      rho: leg.rho ?? null,
      side: leg.side,
      snapshot: leg.snapshot,
      strike: leg.strike ?? null,
      theta: leg.theta ?? null,
      vega: leg.vega ?? null,
      volume: leg.volume ?? null,
    }));

    const legsResult = await supabase
      .from("simulated_position_legs")
      .insert(legRows)
      .select(legColumns)
      .order("leg_index", { ascending: true });

    if (legsResult.error) {
      throw new Error("Unable to create simulated position legs.");
    }

    const cashDelta = openingCashDelta(netCredit, input.contracts);
    const eventResult = await supabase
      .from("simulated_position_events")
      .insert({
        cash_delta: cashDelta,
        event_type: "opened",
        margin_delta: 0,
        metadata: {
          candidateSnapshot: input.candidateSnapshot,
          dataProvenance,
          multiplier: OPTION_CONTRACT_MULTIPLIER,
          strategyType: input.strategyType,
        },
        paper_account_id: paperAccount.id,
        position_id: position.id,
        price: netCredit,
        quantity: input.contracts,
        realized_pnl_delta: 0,
        user_id: userId,
      })
      .select(eventColumns)
      .single();

    if (eventResult.error) {
      throw new Error("Unable to create simulated position opening event.");
    }

    return {
      event: eventResult.data as unknown as SimulatedPositionEventRow,
      legs: legsResult.data as unknown as SimulatedPositionLegRow[],
      paperAccount,
      position,
    };
  } catch (error) {
    await supabase
      .from("simulated_positions")
      .delete()
      .eq("id", position.id)
      .eq("user_id", userId);

    throw error;
  }
}

export async function closeSimulatedPosition(
  supabase: SupabaseClient,
  userId: string,
  positionId: string,
  input: CloseSimulatedPositionInput,
  now = new Date(),
) {
  if (hasRpc(supabase)) {
    return await rpcOrThrow<{
      event: SimulatedPositionEventRow;
      position: SimulatedPositionRow;
    }>(
      supabase,
      "close_simulated_position_atomic",
      {
        p_close_price: input.closePrice,
        p_closed_at: input.closedAt ?? now.toISOString(),
        p_contracts_to_close: input.contractsToClose,
        p_notes: input.notes ?? null,
        p_position_id: positionId,
      },
      "Unable to close simulated position.",
    );
  }

  const positionResult = await supabase
    .from("simulated_positions")
    .select(positionColumns)
    .eq("id", positionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (positionResult.error) {
    throw new Error("Unable to load simulated position.");
  }

  if (!positionResult.data) {
    throw new SimulatedPositionValidationError(
      "SIMULATED_POSITION_NOT_FOUND",
      "Simulated position was not found.",
      404,
    );
  }

  const position = positionResult.data as unknown as SimulatedPositionRow;

  if (position.contracts_remaining <= 0 || position.status === "closed") {
    throw new SimulatedPositionValidationError(
      "SIMULATED_POSITION_ALREADY_CLOSED",
      "Simulated position is already closed.",
    );
  }

  if (input.contractsToClose > position.contracts_remaining) {
    throw new SimulatedPositionValidationError(
      "SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING",
      "Contracts to close cannot exceed contracts remaining.",
    );
  }

  const closedAt = input.closedAt ?? now.toISOString();
  const { closedAtForPosition, contractsRemaining, eventType, status } = closeTransition(
    position.contracts_remaining,
    input.contractsToClose,
    closedAt,
  );
  const realizedPnlDelta = realizedPnlForClose(
    position.net_credit,
    input.closePrice,
    input.contractsToClose,
  );
  const cashDelta = -buybackCost(input.closePrice, input.contractsToClose);

  const updateResult = await supabase
    .from("simulated_positions")
    .update({
      closed_at: closedAtForPosition,
      contracts_remaining: contractsRemaining,
      status,
    })
    .eq("id", position.id)
    .eq("user_id", userId)
    .select(positionColumns)
    .single();

  if (updateResult.error) {
    throw new Error("Unable to update simulated position close state.");
  }

  const updatedPosition = updateResult.data as unknown as SimulatedPositionRow;

  try {
    const eventResult = await supabase
      .from("simulated_position_events")
      .insert({
        cash_delta: cashDelta,
        event_type: eventType,
        margin_delta: 0,
        metadata: {
          closedAt,
          multiplier: OPTION_CONTRACT_MULTIPLIER,
          notes: input.notes ?? null,
          previousContractsRemaining: position.contracts_remaining,
        },
        paper_account_id: position.paper_account_id,
        position_id: position.id,
        price: input.closePrice,
        quantity: input.contractsToClose,
        realized_pnl_delta: realizedPnlDelta,
        user_id: userId,
      })
      .select(eventColumns)
      .single();

    if (eventResult.error) {
      throw new Error("Unable to create simulated position close event.");
    }

    return {
      event: eventResult.data as unknown as SimulatedPositionEventRow,
      position: updatedPosition,
    };
  } catch (error) {
    await supabase
      .from("simulated_positions")
      .update({
        closed_at: position.closed_at,
        contracts_remaining: position.contracts_remaining,
        status: position.status,
      })
      .eq("id", position.id)
      .eq("user_id", userId);

    throw error;
  }
}

export async function expireSimulatedPosition(
  supabase: SupabaseClient,
  userId: string,
  positionId: string,
  input: ExpireSimulatedPositionInput,
  now = new Date(),
) {
  if (hasRpc(supabase)) {
    return await rpcOrThrow<{
      account?: PaperAccountRow;
      equityLot?: SimulatedEquityLotRow;
      event: SimulatedPositionEventRow;
      outcome: "assigned_put" | "called_away" | "expired_otm" | "manual_review";
      position: SimulatedPositionRow;
    }>(
      supabase,
      "expire_simulated_position_atomic",
      {
        p_expired_at: input.expiredAt ?? now.toISOString(),
        p_notes: input.notes ?? null,
        p_position_id: positionId,
        p_underlying_price_at_expiration: input.underlyingPriceAtExpiration,
      },
      "Unable to process simulated position expiration.",
    );
  }

  const expiredAt = input.expiredAt ?? now.toISOString();
  const expirationDate = expirationDateFromTimestamp(expiredAt);
  const positionResult = await supabase
    .from("simulated_positions")
    .select(positionColumns)
    .eq("id", positionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (positionResult.error) {
    throw new Error("Unable to load simulated position.");
  }

  if (!positionResult.data) {
    throw new SimulatedPositionValidationError(
      "SIMULATED_POSITION_NOT_FOUND",
      "Simulated position was not found.",
      404,
    );
  }

  const position = positionResult.data as unknown as SimulatedPositionRow;

  if (position.contracts_remaining <= 0 || position.status === "closed") {
    throw new SimulatedPositionValidationError(
      "SIMULATED_POSITION_ALREADY_CLOSED",
      "Simulated position is already closed.",
    );
  }

  if (position.expiration_date && position.expiration_date > expirationDate) {
    throw new SimulatedPositionValidationError(
      "SIMULATED_POSITION_NOT_EXPIRED",
      "Simulated position has not reached expiration yet.",
    );
  }

  const legsResult = await supabase
    .from("simulated_position_legs")
    .select(legColumns)
    .eq("position_id", position.id)
    .order("leg_index", { ascending: true });

  if (legsResult.error) {
    throw new Error("Unable to load simulated position legs.");
  }

  const legs = legsResult.data as unknown as SimulatedPositionLegRow[];
  const shortPut = singleShortPutLeg(legs);

  if (shortPut) {
    if (input.underlyingPriceAtExpiration >= shortPut.strike) {
      return expirePositionWorthless(
        supabase,
        userId,
        position,
        expiredAt,
        input.underlyingPriceAtExpiration,
        input.notes,
      );
    }

    return assignShortPut(
      supabase,
      userId,
      position,
      shortPut,
      expiredAt,
      input.underlyingPriceAtExpiration,
      input.notes,
    );
  }

  const shortCall = singleShortCallLeg(legs);

  if (position.strategy_type === "covered_call" && shortCall) {
    if (input.underlyingPriceAtExpiration <= shortCall.strike) {
      return expirePositionWorthless(
        supabase,
        userId,
        position,
        expiredAt,
        input.underlyingPriceAtExpiration,
        input.notes,
      );
    }

    return callAwayCoveredCall(
      supabase,
      userId,
      position,
      shortCall,
      expiredAt,
      input.underlyingPriceAtExpiration,
      input.notes,
    );
  }

  return markSimulatedPositionManualReview(
    supabase,
    userId,
    position,
    expiredAt,
    "ambiguous_expiration_outcome",
    input.notes,
  );
}

async function loadCallableEquityLot(
  supabase: SupabaseClient,
  userId: string,
  position: SimulatedPositionRow,
  sharesNeeded: number,
) {
  const lotsResult = await supabase
    .from("simulated_equity_lots")
    .select(equityLotColumns)
    .eq("paper_account_id", position.paper_account_id)
    .eq("user_id", userId)
    .eq("symbol", position.symbol)
    .order("acquired_at", { ascending: true });

  if (lotsResult.error) {
    throw new Error("Unable to load simulated equity lots for call-away.");
  }

  const lots = (lotsResult.data as unknown as SimulatedEquityLotRow[])
    .filter((lot) => numberValue(lot.shares) >= sharesNeeded);

  if (lots.length === 1) {
    return { lot: lots[0], reason: null };
  }

  return {
    lot: null,
    reason: lots.length === 0
      ? "missing_called_away_lot_context"
      : "ambiguous_called_away_lot_context",
  };
}

async function callAwayCoveredCall(
  supabase: SupabaseClient,
  userId: string,
  position: SimulatedPositionRow,
  shortCall: AssignableShortCallLeg,
  expiredAt: string,
  underlyingPriceAtExpiration: number,
  notes: string | undefined,
) {
  const shares = position.contracts_remaining * OPTION_CONTRACT_MULTIPLIER;
  const callableLot = await loadCallableEquityLot(
    supabase,
    userId,
    position,
    shares,
  );

  if (!callableLot.lot) {
    return markSimulatedPositionManualReview(
      supabase,
      userId,
      position,
      expiredAt,
      callableLot.reason,
      notes,
    );
  }

  const equityLot = callableLot.lot;
  const accountResult = await supabase
    .from("paper_accounts")
    .select(paperAccountColumns)
    .eq("id", position.paper_account_id)
    .eq("user_id", userId)
    .single();

  if (accountResult.error) {
    throw new Error("Unable to load paper account for call-away.");
  }

  const account = accountResult.data as unknown as PaperAccountRow;
  const currentCash = numberValue(account.current_cash);
  const currentMargin = numberValue(account.margin_balance);
  const previousLotShares = numberValue(equityLot.shares);
  const remainingLotShares = previousLotShares - shares;
  const calledAwayProceeds = shortCall.strike * shares;
  const lotCostBasis = numberValue(equityLot.cost_basis) * shares;
  const stockRealizedPnl = calledAwayProceeds - lotCostBasis;
  const realizedPnlDelta = premiumReceived(
    position.net_credit,
    position.contracts_remaining,
  ) + stockRealizedPnl;

  try {
    const positionUpdate = await supabase
      .from("simulated_positions")
      .update({
        closed_at: expiredAt,
        contracts_remaining: 0,
        status: "called_away",
      })
      .eq("id", position.id)
      .eq("user_id", userId)
      .select(positionColumns)
      .single();

    if (positionUpdate.error) {
      throw new Error("Unable to mark covered call as called away.");
    }

    const accountUpdate = await supabase
      .from("paper_accounts")
      .update({
        current_cash: currentCash + calledAwayProceeds,
        margin_balance: currentMargin,
      })
      .eq("id", account.id)
      .eq("user_id", userId)
      .select(paperAccountColumns)
      .single();

    if (accountUpdate.error) {
      throw new Error("Unable to update paper account for call-away.");
    }

    if (remainingLotShares > 0) {
      const lotUpdate = await supabase
        .from("simulated_equity_lots")
        .update({ shares: remainingLotShares })
        .eq("id", equityLot.id)
        .eq("user_id", userId)
        .select(equityLotColumns)
        .single();

      if (lotUpdate.error) {
        throw new Error("Unable to update simulated equity lot for call-away.");
      }
    } else {
      const lotDelete = await supabase
        .from("simulated_equity_lots")
        .delete()
        .eq("id", equityLot.id)
        .eq("user_id", userId);

      if (lotDelete.error) {
        throw new Error("Unable to remove simulated equity lot for call-away.");
      }
    }

    const eventResult = await supabase
      .from("simulated_position_events")
      .insert({
        cash_delta: calledAwayProceeds,
        event_type: "called_away",
        margin_delta: 0,
        metadata: {
          calledAwayAt: expiredAt,
          calledAwayPrice: shortCall.strike,
          calledAwayProceeds,
          costBasis: numberValue(equityLot.cost_basis),
          expiredAt,
          lotCostBasis,
          notes: notes ?? null,
          remainingLotShares,
          shares,
          sourceLotId: equityLot.id,
          sourcePositionId: equityLot.source_position_id,
          stockRealizedPnl,
          underlyingPriceAtExpiration,
        },
        paper_account_id: position.paper_account_id,
        position_id: position.id,
        price: shortCall.strike,
        quantity: position.contracts_remaining,
        realized_pnl_delta: realizedPnlDelta,
        user_id: userId,
      })
      .select(eventColumns)
      .single();

    if (eventResult.error) {
      throw new Error("Unable to create called-away event.");
    }

    return {
      account: accountUpdate.data as unknown as PaperAccountRow,
      equityLot,
      event: eventResult.data as unknown as SimulatedPositionEventRow,
      outcome: "called_away" as const,
      position: positionUpdate.data as unknown as SimulatedPositionRow,
    };
  } catch (error) {
    await supabase
      .from("paper_accounts")
      .update({
        current_cash: currentCash,
        margin_balance: currentMargin,
      })
      .eq("id", account.id)
      .eq("user_id", userId);

    await supabase
      .from("simulated_positions")
      .update({
        closed_at: position.closed_at,
        contracts_remaining: position.contracts_remaining,
        status: position.status,
      })
      .eq("id", position.id)
      .eq("user_id", userId);

    if (remainingLotShares > 0) {
      await supabase
        .from("simulated_equity_lots")
        .update({ shares: previousLotShares })
        .eq("id", equityLot.id)
        .eq("user_id", userId);
    } else {
      await supabase
        .from("simulated_equity_lots")
        .insert({
          acquired_at: equityLot.acquired_at,
          cost_basis: equityLot.cost_basis,
          id: equityLot.id,
          paper_account_id: equityLot.paper_account_id,
          shares: previousLotShares,
          source_position_id: equityLot.source_position_id,
          symbol: equityLot.symbol,
          user_id: equityLot.user_id,
        });
    }

    throw error;
  }
}

async function markSimulatedPositionManualReview(
  supabase: SupabaseClient,
  userId: string,
  position: SimulatedPositionRow,
  expiredAt: string,
  reason: string,
  notes: string | undefined,
) {
  const updateResult = await supabase
    .from("simulated_positions")
    .update({ status: "manual_review" })
    .eq("id", position.id)
    .eq("user_id", userId)
    .select(positionColumns)
    .single();

  if (updateResult.error) {
    throw new Error("Unable to mark simulated position for manual review.");
  }

  const eventResult = await supabase
    .from("simulated_position_events")
    .insert({
      cash_delta: 0,
      event_type: "manual_adjustment",
      margin_delta: 0,
      metadata: {
        expiredAt,
        notes: notes ?? null,
        reason,
      },
      paper_account_id: position.paper_account_id,
      position_id: position.id,
      price: 0,
      quantity: position.contracts_remaining,
      realized_pnl_delta: 0,
      user_id: userId,
    })
    .select(eventColumns)
    .single();

  if (eventResult.error) {
    throw new Error("Unable to create manual review event.");
  }

  return {
    event: eventResult.data as unknown as SimulatedPositionEventRow,
    outcome: "manual_review" as const,
    position: updateResult.data as unknown as SimulatedPositionRow,
  };
}

async function expirePositionWorthless(
  supabase: SupabaseClient,
  userId: string,
  position: SimulatedPositionRow,
  expiredAt: string,
  underlyingPriceAtExpiration: number,
  notes: string | undefined,
) {
  const realizedPnlDelta = premiumReceived(
    position.net_credit,
    position.contracts_remaining,
  );
  const updateResult = await supabase
    .from("simulated_positions")
    .update({
      closed_at: expiredAt,
      contracts_remaining: 0,
      status: "closed",
    })
    .eq("id", position.id)
    .eq("user_id", userId)
    .select(positionColumns)
    .single();

  if (updateResult.error) {
    throw new Error("Unable to close expired simulated position.");
  }

  const eventResult = await supabase
    .from("simulated_position_events")
    .insert({
      cash_delta: 0,
      event_type: "expired",
      margin_delta: 0,
      metadata: {
        expiredAt,
        notes: notes ?? null,
        outcome: "expired_otm",
        underlyingPriceAtExpiration,
      },
      paper_account_id: position.paper_account_id,
      position_id: position.id,
      price: 0,
      quantity: position.contracts_remaining,
      realized_pnl_delta: realizedPnlDelta,
      user_id: userId,
    })
    .select(eventColumns)
    .single();

  if (eventResult.error) {
    throw new Error("Unable to create expiration event.");
  }

  return {
    event: eventResult.data as unknown as SimulatedPositionEventRow,
    outcome: "expired_otm" as const,
    position: updateResult.data as unknown as SimulatedPositionRow,
  };
}

async function assignShortPut(
  supabase: SupabaseClient,
  userId: string,
  position: SimulatedPositionRow,
  shortPut: AssignableShortPutLeg,
  expiredAt: string,
  underlyingPriceAtExpiration: number,
  notes: string | undefined,
) {
  const accountResult = await supabase
    .from("paper_accounts")
    .select(paperAccountColumns)
    .eq("id", position.paper_account_id)
    .eq("user_id", userId)
    .single();

  if (accountResult.error) {
    throw new Error("Unable to load paper account for assignment.");
  }

  const account = accountResult.data as unknown as PaperAccountRow;
  const shares = position.contracts_remaining * OPTION_CONTRACT_MULTIPLIER;
  const assignmentCost = shortPut.strike * shares;
  const currentCash = numberValue(account.current_cash);
  const currentMargin = numberValue(account.margin_balance);
  const cashAfterAssignment = currentCash - assignmentCost;
  const marginDelta = Math.max(0, -cashAfterAssignment);
  const nextCash = Math.max(0, cashAfterAssignment);
  const nextMargin = currentMargin + marginDelta;
  const realizedPnlDelta = premiumReceived(
    position.net_credit,
    position.contracts_remaining,
  );
  let equityLot: SimulatedEquityLotRow | null = null;

  try {
    const positionUpdate = await supabase
      .from("simulated_positions")
      .update({
        closed_at: expiredAt,
        contracts_remaining: 0,
        status: "assigned",
      })
      .eq("id", position.id)
      .eq("user_id", userId)
      .select(positionColumns)
      .single();

    if (positionUpdate.error) {
      throw new Error("Unable to assign simulated position.");
    }

    const accountUpdate = await supabase
      .from("paper_accounts")
      .update({
        current_cash: nextCash,
        margin_balance: nextMargin,
      })
      .eq("id", account.id)
      .eq("user_id", userId)
      .select(paperAccountColumns)
      .single();

    if (accountUpdate.error) {
      throw new Error("Unable to update paper account for assignment.");
    }

    const lotResult = await supabase
      .from("simulated_equity_lots")
      .insert({
        acquired_at: expiredAt,
        cost_basis: shortPut.strike,
        paper_account_id: position.paper_account_id,
        shares,
        source_position_id: position.id,
        symbol: position.symbol,
        user_id: userId,
      })
      .select(equityLotColumns)
      .single();

    if (lotResult.error) {
      throw new Error("Unable to create simulated equity lot.");
    }

    equityLot = lotResult.data as unknown as SimulatedEquityLotRow;

    const eventResult = await supabase
      .from("simulated_position_events")
      .insert({
        cash_delta: -assignmentCost,
        event_type: "assigned",
        margin_delta: marginDelta,
        metadata: {
          assignmentCost,
          costBasis: shortPut.strike,
          expiredAt,
          notes: notes ?? null,
          shares,
          underlyingPriceAtExpiration,
        },
        paper_account_id: position.paper_account_id,
        position_id: position.id,
        price: shortPut.strike,
        quantity: position.contracts_remaining,
        realized_pnl_delta: realizedPnlDelta,
        user_id: userId,
      })
      .select(eventColumns)
      .single();

    if (eventResult.error) {
      throw new Error("Unable to create assignment event.");
    }

    return {
      account: accountUpdate.data as unknown as PaperAccountRow,
      equityLot,
      event: eventResult.data as unknown as SimulatedPositionEventRow,
      outcome: "assigned_put" as const,
      position: positionUpdate.data as unknown as SimulatedPositionRow,
    };
  } catch (error) {
    if (equityLot) {
      await supabase
        .from("simulated_equity_lots")
        .delete()
        .eq("id", equityLot.id)
        .eq("user_id", userId);
    }

    await supabase
      .from("paper_accounts")
      .update({
        current_cash: currentCash,
        margin_balance: currentMargin,
      })
      .eq("id", account.id)
      .eq("user_id", userId);

    await supabase
      .from("simulated_positions")
      .update({
        closed_at: position.closed_at,
        contracts_remaining: position.contracts_remaining,
        status: position.status,
      })
      .eq("id", position.id)
      .eq("user_id", userId);

    throw error;
  }
}
