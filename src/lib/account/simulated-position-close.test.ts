import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  closeSimulatedPosition,
  SimulatedPositionValidationError,
} from "./simulated-positions";

const userId = "user-1";
const openPosition = {
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

function queryResult(data: unknown, error: unknown = null) {
  return {
    maybeSingle: vi.fn(async () => ({ data, error })),
    single: vi.fn(async () => ({ data, error })),
  };
}

function chainResult(result: ReturnType<typeof queryResult>) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: result.maybeSingle,
    select: vi.fn(() => chain),
    single: result.single,
  };

  return chain;
}

function supabaseMock({
  eventError = null,
  position = openPosition,
}: {
  eventError?: { message: string } | null;
  position?: typeof openPosition | null;
} = {}) {
  const positionSelect = chainResult(queryResult(position));
  const updatedPosition = {
    ...openPosition,
    contracts_remaining: 1,
    status: "partially_closed",
  };
  const positionUpdate = chainResult(queryResult(updatedPosition));
  const rollbackUpdate = chainResult(queryResult(openPosition));
  const event = {
    cash_delta: -50,
    created_at: "2026-07-02T21:00:00.000Z",
    event_type: "partial_close",
    id: "event-1",
    margin_delta: 0,
    metadata: {},
    paper_account_id: openPosition.paper_account_id,
    position_id: openPosition.id,
    price: 0.5,
    quantity: 1,
    realized_pnl_delta: 75,
    user_id: userId,
  };
  const eventInsert = chainResult(queryResult(event, eventError));

  const calls = {
    eventInsert: vi.fn(() => ({ select: eventInsert.select })),
    positionSelect,
    positionUpdate: vi.fn(() => positionUpdate),
    rollbackUpdate: vi.fn(() => rollbackUpdate),
    updatePayloads: [] as unknown[],
  };

  let updateCount = 0;
  const from = vi.fn((table: string) => {
    if (table === "simulated_positions") {
      return {
        select: positionSelect.select,
        update: vi.fn((payload: unknown) => {
          calls.updatePayloads.push(payload);
          updateCount += 1;
          return updateCount === 1
            ? calls.positionUpdate(payload)
            : calls.rollbackUpdate(payload);
        }),
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

describe("simulated position close store", () => {
  it("uses the atomic close RPC when available", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        event: { id: "event-1" },
        position: {
          ...openPosition,
          contracts_remaining: 1,
          status: "partially_closed",
        },
      },
      error: null,
    }));

    const result = await closeSimulatedPosition(
      { rpc } as unknown as SupabaseClient,
      userId,
      openPosition.id,
      {
        closePrice: 0.5,
        contractsToClose: 1,
        notes: "Taking half off",
      },
      new Date("2026-07-02T21:00:00.000Z"),
    );

    expect(rpc).toHaveBeenCalledWith("close_simulated_position_atomic", {
      p_close_price: 0.5,
      p_closed_at: "2026-07-02T21:00:00.000Z",
      p_contracts_to_close: 1,
      p_notes: "Taking half off",
      p_position_id: openPosition.id,
    });
    expect(result.position.status).toBe("partially_closed");
  });

  it("maps atomic close RPC domain errors to validation errors", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        message: "SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING: Contracts to close cannot exceed contracts remaining.",
      },
    }));

    await expect(closeSimulatedPosition(
      { rpc } as unknown as SupabaseClient,
      userId,
      openPosition.id,
      {
        closePrice: 0.5,
        contractsToClose: 3,
      },
    )).rejects.toMatchObject({
      code: "SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING",
      status: 400,
    });
  });

  it("partially closes an open position and records realized P/L", async () => {
    const { calls, client } = supabaseMock();

    const result = await closeSimulatedPosition(client, userId, openPosition.id, {
      closePrice: 0.5,
      contractsToClose: 1,
      notes: "Taking half off",
    }, new Date("2026-07-02T21:00:00.000Z"));

    expect(calls.positionSelect.eq).toHaveBeenCalledWith("id", openPosition.id);
    expect(calls.positionSelect.eq).toHaveBeenCalledWith("user_id", userId);
    expect(calls.updatePayloads[0]).toEqual({
      closed_at: null,
      contracts_remaining: 1,
      status: "partially_closed",
    });
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: -50,
      event_type: "partial_close",
      price: 0.5,
      quantity: 1,
      realized_pnl_delta: 75,
      user_id: userId,
    }));
    expect(result.position.status).toBe("partially_closed");
  });

  it("fully closes the remaining contracts", async () => {
    const partiallyClosedPosition = {
      ...openPosition,
      contracts_remaining: 1,
      status: "partially_closed",
    };
    const { calls, client } = supabaseMock({ position: partiallyClosedPosition });

    await closeSimulatedPosition(client, userId, openPosition.id, {
      closePrice: 0.25,
      closedAt: "2026-07-02T22:00:00.000Z",
      contractsToClose: 1,
    });

    expect(calls.updatePayloads[0]).toEqual({
      closed_at: "2026-07-02T22:00:00.000Z",
      contracts_remaining: 0,
      status: "closed",
    });
    expect(calls.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      cash_delta: -25,
      event_type: "full_close",
      realized_pnl_delta: 100,
    }));
  });

  it("rejects closing more contracts than remain open", async () => {
    const { calls, client } = supabaseMock();

    await expect(closeSimulatedPosition(client, userId, openPosition.id, {
      closePrice: 0.5,
      contractsToClose: 3,
    })).rejects.toMatchObject({
      code: "SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING",
      status: 400,
    });

    expect(calls.updatePayloads).toEqual([]);
    expect(calls.eventInsert).not.toHaveBeenCalled();
  });

  it("returns a not-found error when the position is not visible to the user", async () => {
    const { client } = supabaseMock({ position: null });

    await expect(closeSimulatedPosition(client, userId, "position-2", {
      closePrice: 0.5,
      contractsToClose: 1,
    })).rejects.toMatchObject({
      code: "SIMULATED_POSITION_NOT_FOUND",
      status: 404,
    });
  });

  it("rolls back position state if close event creation fails", async () => {
    const { calls, client } = supabaseMock({ eventError: { message: "nope" } });

    await expect(closeSimulatedPosition(client, userId, openPosition.id, {
      closePrice: 0.5,
      contractsToClose: 1,
    })).rejects.toThrow("Unable to create simulated position close event.");

    expect(calls.updatePayloads[0]).toEqual({
      closed_at: null,
      contracts_remaining: 1,
      status: "partially_closed",
    });
    expect(calls.updatePayloads[1]).toEqual({
      closed_at: null,
      contracts_remaining: 2,
      status: "open",
    });
  });

  it("exposes validation errors with status codes", () => {
    const error = new SimulatedPositionValidationError("NOPE", "Nope.", 409);

    expect(error.code).toBe("NOPE");
    expect(error.status).toBe(409);
  });
});
