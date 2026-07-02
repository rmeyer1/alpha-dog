import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { expireSimulatedPosition } from "./simulated-positions";

const userId = "user-1";
const position = {
  closed_at: null,
  contracts_opened: 2,
  contracts_remaining: 2,
  created_at: "2026-07-02T20:00:00.000Z",
  expiration_date: "2026-08-21",
  id: "position-1",
  net_credit: 1.25,
  notes: null,
  opened_at: "2026-07-02T20:15:00.000Z",
  paper_account_id: "paper-account-1",
  source: "simulated",
  status: "open",
  strategy_type: "short_put",
  symbol: "AAPL",
  underlying_price_at_open: 201.25,
  updated_at: "2026-07-02T20:00:00.000Z",
  user_id: userId,
};
const shortPutLeg = {
  ask_price: null,
  bid_price: null,
  contract_symbol: "AAPL260821P00190000",
  current_mark: null,
  delta: null,
  expiration_date: "2026-08-21",
  gamma: null,
  id: "leg-1",
  implied_volatility: null,
  leg_index: 0,
  mid_price: null,
  open_interest: null,
  open_price: 1.25,
  option_type: "put",
  position_id: position.id,
  quantity: 2,
  quote_as_of: null,
  rho: null,
  side: "short",
  snapshot: {},
  strike: 190,
  theta: null,
  vega: null,
  volume: null,
};
const account = {
  current_cash: 10_000,
  id: position.paper_account_id,
  margin_balance: 0,
  user_id: userId,
};

function singleResult(data: unknown, error: unknown = null) {
  return vi.fn(async () => ({ data, error }));
}

function selectMaybeChain(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: singleResult(data, error),
    select: vi.fn(() => chain),
  };

  return chain;
}

function selectSingleChain(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: singleResult(data, error),
  };

  return chain;
}

function selectOrderChain(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    order: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => chain),
  };

  return chain;
}

function supabaseMock({
  legs = [shortPutLeg],
  loadedPosition = position,
}: {
  legs?: unknown[];
  loadedPosition?: typeof position | null;
} = {}) {
  const positionSelect = selectMaybeChain(loadedPosition);
  const legSelect = selectOrderChain(legs);
  const accountSelect = selectSingleChain(account);
  const eventInsert = selectSingleChain({
    id: "event-1",
    position_id: position.id,
  });
  const equityInsert = selectSingleChain({
    acquired_at: "2026-08-21T21:00:00.000Z",
    cost_basis: 190,
    id: "lot-1",
    paper_account_id: account.id,
    shares: 200,
    source_position_id: position.id,
    symbol: "AAPL",
    user_id: userId,
  });
  const calls = {
    accountUpdatePayloads: [] as unknown[],
    equityInsert: vi.fn(() => ({ select: equityInsert.select })),
    eventInsert: vi.fn(() => ({ select: eventInsert.select })),
    positionUpdatePayloads: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === "simulated_positions") {
      return {
        select: positionSelect.select,
        update: vi.fn((payload: unknown) => {
          calls.positionUpdatePayloads.push(payload);
          return selectSingleChain({
            ...position,
            ...(payload as object),
          });
        }),
      };
    }

    if (table === "simulated_position_legs") {
      return {
        select: legSelect.select,
      };
    }

    if (table === "paper_accounts") {
      return {
        select: accountSelect.select,
        update: vi.fn((payload: unknown) => {
          calls.accountUpdatePayloads.push(payload);
          return selectSingleChain({
            ...account,
            ...(payload as object),
          });
        }),
      };
    }

    if (table === "simulated_position_events") {
      return {
        insert: calls.eventInsert,
      };
    }

    if (table === "simulated_equity_lots") {
      return {
        delete: vi.fn(() => selectSingleChain(null)),
        insert: calls.equityInsert,
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });

  return {
    calls,
    client: { from } as unknown as SupabaseClient,
    from,
  };
}

describe("simulated position expiration processing", () => {
  it("expires an OTM short put at zero and closes remaining contracts", async () => {
    const { calls, client } = supabaseMock();

    await expireSimulatedPosition(client, userId, position.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 200,
    });

    expect(calls.positionUpdatePayloads[0]).toEqual({
      closed_at: "2026-08-21T21:00:00.000Z",
      contracts_remaining: 0,
      status: "closed",
    });
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: 0,
      event_type: "expired",
      price: 0,
      quantity: 2,
      realized_pnl_delta: 250,
    }));
  });

  it("assigns an ITM short put into equity lots and margin deficit", async () => {
    const { calls, client } = supabaseMock();

    await expireSimulatedPosition(client, userId, position.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 180,
    });

    expect(calls.positionUpdatePayloads[0]).toEqual({
      closed_at: "2026-08-21T21:00:00.000Z",
      contracts_remaining: 0,
      status: "assigned",
    });
    expect(calls.accountUpdatePayloads[0]).toEqual({
      current_cash: 0,
      margin_balance: 28_000,
    });
    expect(calls.equityInsert).toHaveBeenCalledWith(expect.objectContaining({
      cost_basis: 190,
      shares: 200,
      source_position_id: position.id,
      symbol: "AAPL",
      user_id: userId,
    }));
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: -38_000,
      event_type: "assigned",
      margin_delta: 28_000,
      price: 190,
      quantity: 2,
      realized_pnl_delta: 250,
    }));
  });

  it("marks ambiguous expiration outcomes for manual review", async () => {
    const { calls, client } = supabaseMock({
      legs: [
        shortPutLeg,
        {
          ...shortPutLeg,
          id: "leg-2",
          side: "long",
          strike: 180,
        },
      ],
    });

    const result = await expireSimulatedPosition(client, userId, position.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 180,
    });

    expect(result.outcome).toBe("manual_review");
    expect(calls.positionUpdatePayloads[0]).toEqual({ status: "manual_review" });
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: 0,
      event_type: "manual_adjustment",
      realized_pnl_delta: 0,
    }));
  });

  it("rejects positions that have not reached expiration", async () => {
    const { calls, client } = supabaseMock();

    await expect(expireSimulatedPosition(client, userId, position.id, {
      expiredAt: "2026-08-20T21:00:00.000Z",
      underlyingPriceAtExpiration: 200,
    })).rejects.toMatchObject({
      code: "SIMULATED_POSITION_NOT_EXPIRED",
    });

    expect(calls.positionUpdatePayloads).toEqual([]);
    expect(calls.eventInsert).not.toHaveBeenCalled();
  });
});
