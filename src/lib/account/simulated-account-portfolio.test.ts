import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createPositionCursor,
  parsePositionCursor,
} from "./pagination";
import {
  loadAccountPositionDetail,
  loadAccountPositionPage,
  loadPaperAccountOverview,
} from "./simulated-account-portfolio";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const positionIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const watermark = "2026-07-24T12:00:00.000Z";

function positionRow(
  id: string,
  openedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    candidate_as_of: null,
    candidate_cache_source: null,
    candidate_cache_status: null,
    candidate_feed: null,
    closed_at: null,
    contracts_opened: 2,
    contracts_remaining: 2,
    created_at: openedAt,
    data_source_mode: "unknown",
    expiration_date: "2026-08-21",
    id,
    net_credit: "1.5",
    notes: null,
    opened_at: openedAt,
    paper_account_id: "paper-account-1",
    source: "simulated",
    status: "open",
    strategy_type: "short_put",
    symbol: "AAPL",
    underlying_price_at_open: "201.25",
    updated_at: openedAt,
    user_id: ownerId,
    ...overrides,
  };
}

function legRow(positionId: string) {
  return {
    ask_price: "1.1",
    bid_price: "0.9",
    contract_symbol: "AAPL260821P00190000",
    current_mark: "1",
    delta: null,
    expiration_date: "2026-08-21",
    gamma: null,
    id: crypto.randomUUID(),
    implied_volatility: null,
    leg_index: 0,
    mid_price: "1",
    open_interest: null,
    open_price: "1.5",
    option_type: "put",
    position_id: positionId,
    quantity: 2,
    quote_as_of: null,
    rho: null,
    side: "short",
    snapshot: {},
    strike: "95",
    theta: null,
    vega: null,
    volume: null,
  };
}

function eventRow(
  id: string,
  positionId: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    cash_delta: "0",
    created_at: createdAt,
    event_type: "manual_adjustment",
    id,
    margin_delta: "0",
    metadata: { reason: "ambiguous_expiration_outcome" },
    paper_account_id: "paper-account-1",
    position_id: positionId,
    price: null,
    quantity: 2,
    realized_pnl_delta: "0",
    user_id: ownerId,
    ...overrides,
  };
}

function accountChain() {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: {
        created_at: "2026-07-01T00:00:00.000Z",
        current_cash: "1000",
        id: "paper-account-1",
        margin_balance: "500",
        margin_interest_rate: "0.05",
        starting_cash: "1000",
        updated_at: watermark,
        user_id: ownerId,
      },
      error: null,
    })),
    select: vi.fn(() => chain),
  };

  return chain;
}

function legsChain(data: unknown[]) {
  const chain = {
    in: vi.fn(() => chain),
    order: vi.fn(async () => ({ data, error: null })),
    select: vi.fn(() => chain),
  };

  return chain;
}

function detailChain(data: unknown) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
    select: vi.fn(() => chain),
  };

  return chain;
}

describe("bounded simulated account portfolio loading", () => {
  it("overfetches one row, batches visible legs and lifecycle, and emits a stable cursor", async () => {
    const rows = [
      positionRow(positionIds[0], "2026-07-24T11:00:00.000Z", {
        status: "closed",
      }),
      positionRow(positionIds[1], "2026-07-24T10:00:00.000Z", {
        status: "manual_review",
      }),
      positionRow(positionIds[2], "2026-07-24T09:00:00.000Z", {
        status: "closed",
      }),
    ];
    const legs = legsChain([legRow(positionIds[0]), legRow(positionIds[1])]);
    const lifecycle = eventRow(
      "44444444-4444-4444-8444-444444444444",
      positionIds[1],
      "2026-07-24T11:30:00.000Z",
    );
    const rpc = vi.fn(async (name: string, args?: unknown) => {
      if (name === "get_paper_account_position_page") {
        expect(args).toEqual({
          p_page_size: 3,
          p_position_id: null,
          p_scope: "history",
          p_sort_at: null,
        });
        return { data: rows, error: null };
      }

      expect(name).toBe("get_latest_simulated_position_lifecycle_events");
      expect(args).toEqual({ p_position_ids: positionIds.slice(0, 2) });
      return { data: [lifecycle], error: null };
    });
    const from = vi.fn((table: string) => {
      if (table === "simulated_position_legs") {
        return { select: legs.select };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await loadAccountPositionPage(
      { from, rpc } as unknown as SupabaseClient,
      ownerId,
      { cursor: null, limit: 2, scope: "history", watermark },
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(legs.in).toHaveBeenCalledWith(
      "position_id",
      positionIds.slice(0, 2),
    );
    expect(result.positions).toHaveLength(2);
    expect(result.positions[1].lifecycle).toEqual(expect.objectContaining({
      eventId: lifecycle.id,
      outcome: "manual_review",
    }));
    expect(result.nextCursor).not.toBeNull();
    expect(parsePositionCursor(
      result.nextCursor,
      "history",
      ownerId,
    )).toEqual(expect.objectContaining({
      id: positionIds[1],
      sortAt: "2026-07-24T10:00:00.000Z",
      watermark,
    }));
  });

  it("returns a terminal null cursor without loading invisible rows", async () => {
    const rows = [
      positionRow(positionIds[0], "2026-07-24T11:00:00.000Z"),
    ];
    const legs = legsChain([legRow(positionIds[0])]);
    const from = vi.fn(() => ({ select: legs.select }));
    const rpc = vi.fn(async (name: string) => ({
      data: name === "get_paper_account_position_page" ? rows : [],
      error: null,
    }));

    const result = await loadAccountPositionPage(
      { from, rpc } as unknown as SupabaseClient,
      ownerId,
      { cursor: null, limit: 2, scope: "open", watermark },
    );

    expect(result.nextCursor).toBeNull();
    expect(result.positions).toHaveLength(1);
  });

  it("uses every descending sort column for tied-timestamp middle pages", async () => {
    const sortAt = "2026-07-24T11:00:00.000Z";
    const encoded = createPositionCursor({
      id: positionIds[1],
      ownerId,
      scope: "open",
      sortAt,
      watermark,
    });
    const cursor = parsePositionCursor(encoded, "open", ownerId);
    const rows = [
      positionRow(positionIds[2], sortAt),
    ];
    const legs = legsChain([legRow(positionIds[2])]);
    const from = vi.fn(() => ({ select: legs.select }));
    const rpc = vi.fn(async (name: string) => ({
      data: name === "get_paper_account_position_page" ? rows : [],
      error: null,
    }));

    await loadAccountPositionPage(
      { from, rpc } as unknown as SupabaseClient,
      ownerId,
      { cursor, limit: 25, scope: "open", watermark },
    );

    expect(rpc).toHaveBeenCalledWith(
      "get_paper_account_position_page",
      {
        p_page_size: 26,
        p_position_id: positionIds[1],
        p_scope: "open",
        p_sort_at: sortAt,
      },
    );
  });

  it("rejects a changed collection watermark before any position query", async () => {
    const encoded = createPositionCursor({
      id: positionIds[0],
      ownerId,
      scope: "history",
      sortAt: "2026-07-24T11:00:00.000Z",
      watermark: "2026-07-24T11:30:00.000Z",
    });
    const cursor = parsePositionCursor(encoded, "history", ownerId);
    const from = vi.fn();

    await expect(loadAccountPositionPage(
      { from, rpc: vi.fn() } as unknown as SupabaseClient,
      ownerId,
      { cursor, limit: 25, scope: "history", watermark },
    )).rejects.toEqual(expect.objectContaining({
      code: "STALE_POSITION_CURSOR",
      status: 409,
    }));
    expect(from).not.toHaveBeenCalled();
  });

  it("loads account-wide summary through one RPC without list or event reads", async () => {
    const account = accountChain();
    const from = vi.fn((table: string) => {
      expect(table).toBe("paper_accounts");
      return { select: account.select };
    });
    const rpc = vi.fn(async () => ({
      data: [{
        cash_balance: "1245.75",
        history_position_count: "10000",
        margin_balance: "525",
        margin_interest_accrued: "4.25",
        margin_interest_rate: "0.05",
        open_exposure: "9500",
        open_position_count: "3",
        position_watermark: watermark,
        realized_pnl: "100",
        total_premium_collected: "300",
        unrealized_pnl: null,
        unrealized_pnl_status: "unavailable",
      }],
      error: null,
    }));

    const result = await loadPaperAccountOverview(
      { from, rpc } as unknown as SupabaseClient,
      ownerId,
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_paper_account_portfolio_summary");
    expect(from).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      historyPositionCount: 10_000,
      openPositionCount: 3,
      positionWatermark: watermark,
      summary: expect.objectContaining({
        cashBalance: 1245.75,
        marginInterestAccrued: 4.25,
        unrealizedPnl: null,
        unrealizedPnlStatus: "unavailable",
      }),
    }));
  });

  it("paginates detail events by the complete timestamp and UUID tuple", async () => {
    const row = positionRow(positionIds[0], "2026-07-24T11:00:00.000Z");
    const position = detailChain(row);
    const legs = legsChain([legRow(positionIds[0])]);
    const eventRows = [
      eventRow(
        "55555555-5555-4555-8555-555555555555",
        positionIds[0],
        "2026-07-24T12:00:00.000Z",
        { event_type: "opened" },
      ),
      eventRow(
        "44444444-4444-4444-8444-444444444444",
        positionIds[0],
        "2026-07-24T11:00:00.000Z",
      ),
    ];
    const rpc = vi.fn(async (name: string, args: unknown) => {
      expect(name).toBe("get_simulated_position_event_page");
      expect(args).toEqual({
        p_event_id: null,
        p_page_size: 2,
        p_position_id: positionIds[0],
        p_sort_at: null,
      });
      return { data: eventRows, error: null };
    });
    const from = vi.fn((table: string) => {
      if (table === "simulated_positions") {
        return { select: position.select };
      }

      if (table === "simulated_position_legs") {
        return { select: legs.select };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await loadAccountPositionDetail(
      { from, rpc } as unknown as SupabaseClient,
      ownerId,
      positionIds[0],
      { eventCursor: null, eventLimit: 1 },
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(result?.events).toHaveLength(1);
    expect(result?.nextEventCursor).not.toBeNull();
  });
});
