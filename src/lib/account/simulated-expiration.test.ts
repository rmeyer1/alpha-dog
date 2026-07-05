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
const coveredCallPosition = {
  ...position,
  id: "position-call-1",
  net_credit: 2.5,
  strategy_type: "covered_call",
};
const shortCallLeg = {
  ...shortPutLeg,
  contract_symbol: "AAPL260821C00210000",
  id: "call-leg-1",
  option_type: "call",
  position_id: coveredCallPosition.id,
  strike: 210,
};
const account = {
  current_cash: 10_000,
  id: position.paper_account_id,
  margin_balance: 0,
  user_id: userId,
};
const equityLot = {
  acquired_at: "2026-07-01T20:00:00.000Z",
  cost_basis: 180,
  id: "lot-1",
  paper_account_id: account.id,
  shares: 300,
  source_position_id: "assigned-put-position-1",
  symbol: "AAPL",
  user_id: userId,
};
type PositionFixture = typeof position;

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

function deleteChain(error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    then: (resolve: (value: { error: unknown }) => unknown) => {
      return Promise.resolve({ error }).then(resolve);
    },
  };

  return chain;
}

function supabaseMock({
  equityLots = [equityLot],
  legs = [shortPutLeg],
  loadedPosition = position,
}: {
  equityLots?: unknown[];
  legs?: unknown[];
  loadedPosition?: PositionFixture | null;
} = {}) {
  const positionSelect = selectMaybeChain(loadedPosition);
  const legSelect = selectOrderChain(legs);
  const accountSelect = selectSingleChain(account);
  const equityLotSelect = selectOrderChain(equityLots);
  const eventInsert = selectSingleChain({
    id: "event-1",
    position_id: loadedPosition?.id ?? position.id,
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
    equityLotDelete: vi.fn(() => deleteChain()),
    equityInsert: vi.fn(() => ({ select: equityInsert.select })),
    equityLotUpdatePayloads: [] as unknown[],
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
            ...(loadedPosition ?? position),
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
        delete: calls.equityLotDelete,
        insert: calls.equityInsert,
        select: equityLotSelect.select,
        update: vi.fn((payload: unknown) => {
          calls.equityLotUpdatePayloads.push(payload);
          return selectSingleChain({
            ...equityLot,
            ...(payload as object),
          });
        }),
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
  it("uses the atomic expiration RPC when available", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        event: { id: "event-1" },
        outcome: "expired_otm",
        position: {
          ...position,
          contracts_remaining: 0,
          status: "closed",
        },
      },
      error: null,
    }));

    const result = await expireSimulatedPosition(
      { rpc } as unknown as SupabaseClient,
      userId,
      position.id,
      {
        expiredAt: "2026-08-21T21:00:00.000Z",
        notes: "Expired worthless",
        underlyingPriceAtExpiration: 200,
      },
    );

    expect(rpc).toHaveBeenCalledWith("expire_simulated_position_atomic", {
      p_expired_at: "2026-08-21T21:00:00.000Z",
      p_notes: "Expired worthless",
      p_position_id: position.id,
      p_underlying_price_at_expiration: 200,
    });
    expect(result.outcome).toBe("expired_otm");
  });

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

  it("expires an OTM covered call at zero with premium retained", async () => {
    const { calls, client } = supabaseMock({
      legs: [shortCallLeg],
      loadedPosition: coveredCallPosition,
    });

    const result = await expireSimulatedPosition(client, userId, coveredCallPosition.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 205,
    });

    expect(result.outcome).toBe("expired_otm");
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
      realized_pnl_delta: 500,
    }));
  });

  it("calls away an ITM covered call against a matching equity lot", async () => {
    const { calls, client } = supabaseMock({
      equityLots: [equityLot],
      legs: [shortCallLeg],
      loadedPosition: coveredCallPosition,
    });

    const result = await expireSimulatedPosition(client, userId, coveredCallPosition.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 220,
    });

    expect(result.outcome).toBe("called_away");
    expect(calls.positionUpdatePayloads[0]).toEqual({
      closed_at: "2026-08-21T21:00:00.000Z",
      contracts_remaining: 0,
      status: "called_away",
    });
    expect(calls.accountUpdatePayloads[0]).toEqual({
      current_cash: 52_000,
      margin_balance: 0,
    });
    expect(calls.equityLotUpdatePayloads[0]).toEqual({ shares: 100 });
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: 42_000,
      event_type: "called_away",
      margin_delta: 0,
      price: 210,
      quantity: 2,
      realized_pnl_delta: 6_500,
    }));
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        calledAwayPrice: 210,
        calledAwayProceeds: 42_000,
        costBasis: 180,
        remainingLotShares: 100,
        shares: 200,
        sourceLotId: "lot-1",
        sourcePositionId: "assigned-put-position-1",
        stockRealizedPnl: 6_000,
        underlyingPriceAtExpiration: 220,
      }),
    }));
  });

  it("marks ITM covered calls for manual review when no matching lot exists", async () => {
    const { calls, client } = supabaseMock({
      equityLots: [],
      legs: [shortCallLeg],
      loadedPosition: coveredCallPosition,
    });

    const result = await expireSimulatedPosition(client, userId, coveredCallPosition.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 220,
    });

    expect(result.outcome).toBe("manual_review");
    expect(calls.positionUpdatePayloads[0]).toEqual({ status: "manual_review" });
    expect(calls.equityLotUpdatePayloads).toEqual([]);
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "manual_adjustment",
      metadata: expect.objectContaining({
        reason: "missing_called_away_lot_context",
      }),
    }));
  });

  it("marks ITM covered calls for manual review when lot context is ambiguous", async () => {
    const { calls, client } = supabaseMock({
      equityLots: [
        equityLot,
        { ...equityLot, id: "lot-2", source_position_id: "assigned-put-position-2" },
      ],
      legs: [shortCallLeg],
      loadedPosition: coveredCallPosition,
    });

    const result = await expireSimulatedPosition(client, userId, coveredCallPosition.id, {
      expiredAt: "2026-08-21T21:00:00.000Z",
      underlyingPriceAtExpiration: 220,
    });

    expect(result.outcome).toBe("manual_review");
    expect(calls.positionUpdatePayloads[0]).toEqual({ status: "manual_review" });
    expect(calls.equityLotUpdatePayloads).toEqual([]);
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "manual_adjustment",
      metadata: expect.objectContaining({
        reason: "ambiguous_called_away_lot_context",
      }),
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
