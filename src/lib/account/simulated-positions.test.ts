import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createSimulatedPosition,
  SimulatedPositionValidationError,
} from "./simulated-positions";

const userId = "user-1";
const account = { id: "paper-account-1" };
const position = {
  closed_at: null,
  contracts_opened: 2,
  contracts_remaining: 2,
  created_at: "2026-07-02T20:00:00.000Z",
  expiration_date: "2026-08-21",
  id: "position-1",
  net_credit: 1.25,
  notes: "Watch assignment risk",
  opened_at: "2026-07-02T20:15:00.000Z",
  paper_account_id: account.id,
  source: "simulated",
  status: "open",
  strategy_type: "short_put",
  symbol: "AAPL",
  underlying_price_at_open: 201.25,
  updated_at: "2026-07-02T20:00:00.000Z",
  user_id: userId,
};
const legs = [{ id: "leg-1", leg_index: 0, position_id: position.id }];
const event = {
  cash_delta: 250,
  created_at: "2026-07-02T20:00:00.000Z",
  event_type: "opened",
  id: "event-1",
  margin_delta: 0,
  metadata: {},
  paper_account_id: account.id,
  position_id: position.id,
  price: 1.25,
  quantity: 2,
  realized_pnl_delta: 0,
  user_id: userId,
};

function queryResult(data: unknown, error: unknown = null) {
  return {
    maybeSingle: vi.fn(async () => ({ data, error })),
    single: vi.fn(async () => ({ data, error })),
  };
}

function supabaseMock({
  existingAccount = account,
  legError = null,
}: {
  existingAccount?: typeof account | null;
  legError?: { message: string } | null;
} = {}) {
  const paperSelectResult = queryResult(existingAccount);
  const paperCreateResult = queryResult(account);
  const positionCreateResult = queryResult(position);
  const legsCreateResult = {
    order: vi.fn(async () => ({ data: legs, error: legError })),
  };
  const eventCreateResult = queryResult(event);

  const calls = {
    deleteEq: vi.fn(() => calls.deleteBuilder),
    deleteFn: vi.fn(() => calls.deleteBuilder),
    deleteBuilder: {} as { eq: ReturnType<typeof vi.fn> },
    eventInsert: vi.fn(() => ({ select: calls.eventSelect })),
    eventSelect: vi.fn(() => ({ single: eventCreateResult.single })),
    legsInsert: vi.fn(() => ({ select: calls.legsSelect })),
    legsSelect: vi.fn(() => ({ order: legsCreateResult.order })),
    paperEq: vi.fn(() => ({ maybeSingle: paperSelectResult.maybeSingle })),
    paperInsert: vi.fn(() => ({ select: calls.paperInsertSelect })),
    paperInsertSelect: vi.fn(() => ({ single: paperCreateResult.single })),
    paperSelect: vi.fn(() => ({ eq: calls.paperEq })),
    positionInsert: vi.fn(() => ({ select: calls.positionSelect })),
    positionSelect: vi.fn(() => ({ single: positionCreateResult.single })),
  };
  calls.deleteBuilder = { eq: calls.deleteEq };

  const from = vi.fn((table: string) => {
    if (table === "paper_accounts") {
      return {
        insert: calls.paperInsert,
        select: calls.paperSelect,
      };
    }

    if (table === "simulated_positions") {
      return {
        delete: calls.deleteFn,
        insert: calls.positionInsert,
      };
    }

    if (table === "simulated_position_legs") {
      return {
        insert: calls.legsInsert,
      };
    }

    if (table === "simulated_position_events") {
      return {
        insert: calls.eventInsert,
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

describe("simulated position store", () => {
  it("uses the atomic open RPC when available", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        event,
        legs,
        paperAccount: account,
        position,
      },
      error: null,
    }));

    const result = await createSimulatedPosition(
      { rpc } as unknown as SupabaseClient,
      userId,
      {
        candidateSnapshot: { score: 82 },
        contracts: 2,
        expirationDate: "2026-08-21",
        legs: [{
          askPrice: 1.3,
          bidPrice: 1.2,
          contractSymbol: "AAPL260821P00190000",
          delta: -0.28,
          expirationDate: "2026-08-21",
          openPrice: 1.25,
          optionType: "put",
          side: "short",
          strike: 190,
        }],
        notes: "Watch assignment risk",
        strategyType: "short_put",
        symbol: "aapl",
        underlyingPriceAtOpen: 201.25,
      },
    );

    expect(rpc).toHaveBeenCalledWith("open_simulated_position_atomic", {
      p_input: expect.objectContaining({
        contracts: 2,
        netCredit: 1.25,
        strategyType: "short_put",
        symbol: "AAPL",
      }),
    });
    expect(result.position).toBe(position);
  });

  it("creates a single-leg premium-selling position for the authenticated user", async () => {
    const { calls, client } = supabaseMock();

    const result = await createSimulatedPosition(client, userId, {
      candidateSnapshot: { score: 82 },
      contracts: 2,
      expirationDate: "2026-08-21",
      legs: [{
        askPrice: 1.3,
        bidPrice: 1.2,
        contractSymbol: "AAPL260821P00190000",
        delta: -0.28,
        expirationDate: "2026-08-21",
        openPrice: 1.25,
        optionType: "put",
        side: "short",
        strike: 190,
      }],
      netCredit: 1.25,
      notes: "Watch assignment risk",
      strategyType: "short_put",
      symbol: "aapl",
      underlyingPriceAtOpen: 201.25,
    }, new Date("2026-07-02T20:15:00.000Z"));

    expect(calls.positionInsert).toHaveBeenCalledWith(expect.objectContaining({
      contracts_opened: 2,
      contracts_remaining: 2,
      net_credit: 1.25,
      opened_at: "2026-07-02T20:15:00.000Z",
      paper_account_id: account.id,
      status: "open",
      strategy_type: "short_put",
      symbol: "AAPL",
      user_id: userId,
    }));
    expect(calls.legsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        leg_index: 0,
        open_price: 1.25,
        position_id: position.id,
        quantity: 2,
        side: "short",
      }),
    ]);
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: 250,
      event_type: "opened",
      paper_account_id: account.id,
      position_id: position.id,
      price: 1.25,
      quantity: 2,
      user_id: userId,
    }));
    expect(result.position).toBe(position);
  });

  it("initializes a default paper account when the user does not have one", async () => {
    const { calls, client } = supabaseMock({ existingAccount: null });

    await createSimulatedPosition(client, userId, {
      contracts: 1,
      legs: [{
        openPrice: 1,
        optionType: "put",
        side: "short",
        strike: 190,
      }],
      strategyType: "short_put",
      symbol: "MSFT",
    });

    expect(calls.paperInsert).toHaveBeenCalledWith({ user_id: userId });
  });

  it("uses the provided open date when creating a position", async () => {
    const { calls, client } = supabaseMock();

    await createSimulatedPosition(client, userId, {
      contracts: 1,
      legs: [{
        openPrice: 1,
        optionType: "call",
        side: "short",
        strike: 210,
      }],
      openedAt: "2026-07-01",
      strategyType: "covered_call",
      symbol: "AAPL",
    }, new Date("2026-07-03T20:15:00.000Z"));

    expect(calls.positionInsert).toHaveBeenCalledWith(expect.objectContaining({
      opened_at: "2026-07-01T12:00:00.000Z",
    }));
  });

  it("derives spread net credit from short and long leg open prices", async () => {
    const { calls, client } = supabaseMock();

    await createSimulatedPosition(client, userId, {
      contracts: 1,
      expirationDate: "2026-08-21",
      legs: [
        {
          openPrice: 2,
          optionType: "put",
          side: "short",
          strike: 190,
        },
        {
          openPrice: 0.75,
          optionType: "put",
          side: "long",
          strike: 180,
        },
      ],
      strategyType: "put_credit_spread",
      symbol: "AAPL",
    });

    expect(calls.positionInsert).toHaveBeenCalledWith(expect.objectContaining({
      net_credit: 1.25,
    }));
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: 125,
      price: 1.25,
    }));
  });

  it("rejects debit positions when net credit is derived from legs", async () => {
    const { calls, client } = supabaseMock();

    await expect(createSimulatedPosition(client, userId, {
      contracts: 1,
      legs: [
        {
          openPrice: 0.5,
          optionType: "put",
          side: "short",
          strike: 190,
        },
        {
          openPrice: 0.75,
          optionType: "put",
          side: "long",
          strike: 180,
        },
      ],
      strategyType: "put_credit_spread",
      symbol: "AAPL",
    })).rejects.toBeInstanceOf(SimulatedPositionValidationError);

    expect(calls.positionInsert).not.toHaveBeenCalled();
  });

  it("cleans up the position when child writes fail", async () => {
    const { calls, client } = supabaseMock({ legError: { message: "nope" } });

    await expect(createSimulatedPosition(client, userId, {
      contracts: 1,
      legs: [{
        openPrice: 1,
        optionType: "put",
        side: "short",
        strike: 190,
      }],
      strategyType: "short_put",
      symbol: "AAPL",
    })).rejects.toThrow("Unable to create simulated position legs.");

    expect(calls.deleteFn).toHaveBeenCalled();
    expect(calls.deleteEq).toHaveBeenCalledWith("id", position.id);
    expect(calls.deleteEq).toHaveBeenCalledWith("user_id", userId);
  });
});
