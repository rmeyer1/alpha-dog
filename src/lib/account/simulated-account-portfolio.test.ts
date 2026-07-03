import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadAccountPortfolio } from "./simulated-account-portfolio";

function maybeSingleChain(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => chain),
  };

  return chain;
}

function eqOrderChain(data: unknown, error: unknown = null) {
  const chain = {
    eq: vi.fn(() => chain),
    order: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => chain),
  };

  return chain;
}

function inOrderChain(data: unknown, error: unknown = null) {
  const chain = {
    in: vi.fn(() => chain),
    order: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => chain),
  };

  return chain;
}

describe("simulated account portfolio loader", () => {
  it("loads account-owned rows and separates margin interest from option P/L", async () => {
    const account = maybeSingleChain({
      created_at: "2026-07-02T20:00:00.000Z",
      current_cash: "0",
      id: "paper-account-1",
      margin_balance: "500",
      margin_interest_rate: "0.05",
      starting_cash: "1000",
      updated_at: "2026-07-02T20:00:00.000Z",
      user_id: "user-1",
    });
    const positions = eqOrderChain([{
      closed_at: null,
      contracts_opened: 2,
      contracts_remaining: 2,
      created_at: "2026-07-02T20:00:00.000Z",
      expiration_date: "2026-08-21",
      id: "position-1",
      net_credit: "1.5",
      notes: null,
      opened_at: "2026-07-02T20:00:00.000Z",
      paper_account_id: "paper-account-1",
      source: "simulated",
      status: "open",
      strategy_type: "short_put",
      symbol: "AAPL",
      underlying_price_at_open: "201.25",
      updated_at: "2026-07-02T20:00:00.000Z",
      user_id: "user-1",
    }]);
    const legs = inOrderChain([{
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
      open_price: "1.5",
      option_type: "put",
      position_id: "position-1",
      quantity: 2,
      quote_as_of: null,
      rho: null,
      side: "short",
      snapshot: {},
      strike: "95",
      theta: null,
      vega: null,
      volume: null,
    }]);
    const events = eqOrderChain([
      {
        cash_delta: "300",
        created_at: "2026-07-02T20:00:00.000Z",
        event_type: "opened",
        id: "event-1",
        margin_delta: "0",
        metadata: {},
        paper_account_id: "paper-account-1",
        position_id: "position-1",
        price: "1.5",
        quantity: 2,
        realized_pnl_delta: "0",
        user_id: "user-1",
      },
      {
        cash_delta: "-4.25",
        created_at: "2026-07-03T20:00:00.000Z",
        event_type: "margin_interest",
        id: "event-2",
        margin_delta: "0",
        metadata: {},
        paper_account_id: "paper-account-1",
        position_id: "position-1",
        price: null,
        quantity: null,
        realized_pnl_delta: "0",
        user_id: "user-1",
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "paper_accounts") {
        return { select: account.select };
      }

      if (table === "simulated_positions") {
        return { select: positions.select };
      }

      if (table === "simulated_position_legs") {
        return { select: legs.select };
      }

      if (table === "simulated_position_events") {
        return { select: events.select };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const portfolio = await loadAccountPortfolio(
      { from } as unknown as SupabaseClient,
      "user-1",
    );

    expect(account.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(positions.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(legs.in).toHaveBeenCalledWith("position_id", ["position-1"]);
    expect(events.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(portfolio.openPositions).toHaveLength(1);
    expect(portfolio.historyPositions).toHaveLength(0);
    expect(portfolio.summary).toEqual(expect.objectContaining({
      cashBalance: 1295.75,
      marginBalance: 500,
      marginInterestAccrued: 4.25,
      realizedPnl: 0,
      totalPremiumCollected: 300,
      unrealizedPnl: null,
      unrealizedPnlStatus: "unavailable",
    }));
  });
});
