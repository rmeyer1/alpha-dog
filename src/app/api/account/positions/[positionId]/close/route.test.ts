import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const closeSimulatedPosition = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/simulated-positions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account/simulated-positions")>();

  return {
    ...actual,
    closeSimulatedPosition,
  };
});

function closeRequest(body: unknown) {
  return new Request("https://alpha-dog.test/api/account/positions/position-1/close", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const context = {
  params: Promise.resolve({ positionId: "position-1" }),
};

describe("POST /api/account/positions/[positionId]/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeSimulatedPosition.mockResolvedValue({
      event: { id: "event-1" },
      position: { id: "position-1", status: "partially_closed" },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(closeRequest({}), context);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(closeSimulatedPosition).not.toHaveBeenCalled();
  });

  it("rejects invalid close payloads", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await POST(closeRequest({
      closePrice: -1,
      contractsToClose: 0,
    }), context);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_SIMULATED_POSITION_CLOSE");
    expect(closeSimulatedPosition).not.toHaveBeenCalled();
  });

  it("closes a position for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await POST(closeRequest({
      closePrice: 0.5,
      contractsToClose: 1,
      notes: "Taking half off",
    }), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(closeSimulatedPosition).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "position-1",
      {
        closePrice: 0.5,
        contractsToClose: 1,
        notes: "Taking half off",
      },
    );
    expect(json.position.status).toBe("partially_closed");
  });
});
