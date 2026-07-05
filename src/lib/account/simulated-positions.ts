import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buybackCost,
  OPTION_CONTRACT_MULTIPLIER,
  premiumReceived,
  realizedPnlForClose,
} from "./simulated-accounting";

const multiplier = 100;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const snapshotSchema = z.record(z.string(), z.unknown());
const optionalSnapshotSchema = snapshotSchema.optional().default({});

const optionalNonNegativeNumber = z.number().finite().min(0).optional();
const optionalGreek = z.number().finite().optional();

const simulatedPositionLegInputSchema = z.object({
  askPrice: optionalNonNegativeNumber,
  bidPrice: optionalNonNegativeNumber,
  contractSymbol: z.string().trim().min(1).max(80).optional(),
  currentMark: optionalNonNegativeNumber,
  delta: optionalGreek,
  expirationDate: dateSchema.optional(),
  gamma: optionalGreek,
  impliedVolatility: optionalNonNegativeNumber,
  legIndex: z.number().int().min(0).optional(),
  midPrice: optionalNonNegativeNumber,
  openInterest: z.number().int().min(0).optional(),
  openPrice: z.number().finite().min(0),
  optionType: z.enum(["put", "call"]).optional(),
  quantity: z.number().int().positive().optional(),
  quoteAsOf: z.string().datetime().optional(),
  rho: optionalGreek,
  side: z.enum(["short", "long"]),
  snapshot: optionalSnapshotSchema,
  strike: z.number().finite().positive().optional(),
  theta: optionalGreek,
  vega: optionalGreek,
  volume: z.number().int().min(0).optional(),
});

export const simulatedPositionInputSchema = z.object({
  candidateSnapshot: optionalSnapshotSchema,
  contracts: z.number().int().positive().max(1000),
  expirationDate: dateSchema.optional(),
  legs: z.array(simulatedPositionLegInputSchema).min(1).max(4),
  netCredit: z.number().finite().positive().optional(),
  notes: z.string().trim().max(2000).optional(),
  openedAt: dateSchema.optional(),
  strategyType: z.enum([
    "short_put",
    "covered_call",
    "put_credit_spread",
    "call_credit_spread",
  ]),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9.-]+$/)
    .transform((value) => value.toUpperCase()),
  underlyingPriceAtOpen: z.number().finite().positive().optional(),
}).superRefine((input, ctx) => {
  const expectedLegCount = input.strategyType.endsWith("_spread") ? 2 : 1;

  if (input.legs.length !== expectedLegCount) {
    ctx.addIssue({
      code: "custom",
      message: `${input.strategyType} requires ${expectedLegCount} leg${expectedLegCount === 1 ? "" : "s"}.`,
      path: ["legs"],
    });
  }

  if (input.strategyType.endsWith("_spread")) {
    const sides = new Set(input.legs.map((leg) => leg.side));

    if (!sides.has("short") || !sides.has("long")) {
      ctx.addIssue({
        code: "custom",
        message: "Credit spreads require one short leg and one long leg.",
        path: ["legs"],
      });
    }
  }
});

export type SimulatedPositionInput = z.infer<typeof simulatedPositionInputSchema>;

export const closeSimulatedPositionInputSchema = z.object({
  closedAt: z.string().datetime().optional(),
  closePrice: z.number().finite().min(0),
  contractsToClose: z.number().int().positive(),
  notes: z.string().trim().max(2000).optional(),
});

export type CloseSimulatedPositionInput = z.infer<typeof closeSimulatedPositionInputSchema>;

export const expireSimulatedPositionInputSchema = z.object({
  expiredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  underlyingPriceAtExpiration: z.number().finite().positive(),
});

export type ExpireSimulatedPositionInput = z.infer<typeof expireSimulatedPositionInputSchema>;

interface PaperAccountRow {
  current_cash?: number | string | null;
  id: string;
  margin_balance?: number | string | null;
  user_id?: string;
}

export interface SimulatedPositionRow {
  closed_at: string | null;
  contracts_opened: number;
  contracts_remaining: number;
  created_at: string;
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

function calculateNetCredit(input: SimulatedPositionInput) {
  if (input.netCredit !== undefined) {
    return input.netCredit;
  }

  return input.legs.reduce((total, leg) => {
    return total + (leg.side === "short" ? leg.openPrice : -leg.openPrice);
  }, 0);
}

function assertPositiveNetCredit(netCredit: number) {
  if (netCredit <= 0) {
    throw new SimulatedPositionValidationError(
      "INVALID_NET_CREDIT",
      "Position net credit must be greater than zero.",
    );
  }
}

function numberValue(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function expirationDateFromTimestamp(timestamp: string) {
  return timestamp.slice(0, 10);
}

function openedAtTimestamp(input: SimulatedPositionInput, now: Date) {
  if (!input.openedAt) {
    return now.toISOString();
  }

  return `${input.openedAt}T12:00:00.000Z`;
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

export class SimulatedPositionValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SimulatedPositionValidationError";
  }
}

type RpcResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type RpcCapableClient = SupabaseClient & {
  rpc?: <T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<RpcResult<T>>;
};

function hasRpc(supabase: SupabaseClient): supabase is RpcCapableClient {
  return typeof (supabase as RpcCapableClient).rpc === "function";
}

function validationStatusForCode(code: string) {
  return code === "SIMULATED_POSITION_NOT_FOUND" ? 404 : 400;
}

function throwRpcError(error: { message?: string }, fallbackMessage: string): never {
  const message = error.message ?? fallbackMessage;
  const match = /^([A-Z0-9_]+):\s*(.+)$/.exec(message);

  if (match) {
    throw new SimulatedPositionValidationError(
      match[1],
      match[2],
      validationStatusForCode(match[1]),
    );
  }

  throw new Error(fallbackMessage);
}

async function rpcOrThrow<T>(
  supabase: RpcCapableClient,
  fn: string,
  args: Record<string, unknown>,
  fallbackMessage: string,
) {
  const result = await supabase.rpc<T>(fn, args);

  if (result.error) {
    throwRpcError(result.error, fallbackMessage);
  }

  if (!result.data) {
    throw new Error(fallbackMessage);
  }

  return result.data;
}

export async function getOrCreatePaperAccount(
  supabase: SupabaseClient,
  userId: string,
) {
  const existing = await supabase
    .from("paper_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw new Error("Unable to load paper account.");
  }

  if (existing.data) {
    return existing.data as unknown as PaperAccountRow;
  }

  const created = await supabase
    .from("paper_accounts")
    .insert({ user_id: userId })
    .select("id")
    .single();

  if (created.error) {
    throw new Error("Unable to create paper account.");
  }

  return created.data as unknown as PaperAccountRow;
}

export async function createSimulatedPosition(
  supabase: SupabaseClient,
  userId: string,
  input: SimulatedPositionInput,
  now = new Date(),
) {
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
  const openedAt = openedAtTimestamp(input, now);
  const netCredit = calculateNetCredit(input);
  const symbol = input.symbol.toUpperCase();

  assertPositiveNetCredit(netCredit);

  const positionResult = await supabase
    .from("simulated_positions")
    .insert({
      contracts_opened: input.contracts,
      contracts_remaining: input.contracts,
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

    const cashDelta = netCredit * input.contracts * multiplier;
    const eventResult = await supabase
      .from("simulated_position_events")
      .insert({
        cash_delta: cashDelta,
        event_type: "opened",
        margin_delta: 0,
        metadata: {
          candidateSnapshot: input.candidateSnapshot,
          multiplier,
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
  const contractsRemaining = position.contracts_remaining - input.contractsToClose;
  const status = contractsRemaining === 0 ? "closed" : "partially_closed";
  const closedAtForPosition = contractsRemaining === 0 ? closedAt : null;
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
        event_type: contractsRemaining === 0 ? "full_close" : "partial_close",
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
      outcome: "assigned_put" | "expired_otm" | "manual_review";
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

  if (!shortPut) {
    return markSimulatedPositionManualReview(
      supabase,
      userId,
      position,
      expiredAt,
      "ambiguous_expiration_outcome",
      input.notes,
    );
  }

  if (input.underlyingPriceAtExpiration >= shortPut.strike) {
    return expireShortPutWorthless(
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

async function expireShortPutWorthless(
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
