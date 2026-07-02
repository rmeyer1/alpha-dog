import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

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

interface PaperAccountRow {
  id: string;
}

interface SimulatedPositionRow {
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
  event_type: "opened";
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

export class SimulatedPositionValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SimulatedPositionValidationError";
  }
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
  const paperAccount = await getOrCreatePaperAccount(supabase, userId);
  const openedAt = now.toISOString();
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
