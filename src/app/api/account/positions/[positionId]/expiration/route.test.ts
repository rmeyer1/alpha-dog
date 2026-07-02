import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const expireSimulatedPosition = vi.hoisted(() => vi.fn());

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
    expireSimulatedPosition,
  };
});

function expirationRequest(body: unknown) {
  return new Request("https://alpha-dog.test/api/account/positions/position-1/expiration", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const context = {
  params: Promise.resolve({ positionId: "position-1" }),
};

describe("POST /api/account/positions/[positionId]/expiration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expireSimulatedPosition.mockResolvedValue({
      event: { id: "event-1" },
      outcome: "expired_otm",
      position: { id: "position-1", status: "closed" },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(expirationRequest({}), context);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(expireSimulatedPosition).not.toHaveBeenCalled();
  });

  it("rejects invalid expiration payloads", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await POST(expirationRequest({
      underlyingPriceAtExpiration: -1,
    }), context);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_SIMULATED_POSITION_EXPIRATION");
    expect(expireSimulatedPosition).not.toHaveBeenCalled();
  });

  it("processes expiration for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await POST(expirationRequest({
      expiredAt: "2026-08-21T21:00:00.000Z",
      notes: "Expiry run",
      underlyingPriceAtExpiration: 200,
    }), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(expireSimulatedPosition).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "position-1",
      {
        expiredAt: "2026-08-21T21:00:00.000Z",
        notes: "Expiry run",
        underlyingPriceAtExpiration: 200,
      },
    );
    expect(json.outcome).toBe("expired_otm");
  });
});
