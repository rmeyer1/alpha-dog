import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { GET } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const loadAccountPositionDetail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/simulated-account-portfolio", () => ({
  loadAccountPositionDetail,
}));

const context = {
  params: Promise.resolve({ positionId: "position-1" }),
};

describe("GET /api/account/positions/[positionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAccountPositionDetail.mockResolvedValue({
      events: [{ id: "event-1" }],
      id: "position-1",
      legs: [{ id: "leg-1" }],
      status: "open",
      valuation: { unrealizedPnl: 120 },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await GET(new Request("https://alpha-dog.test/api/account/positions/position-1"), context);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(loadAccountPositionDetail).not.toHaveBeenCalled();
  });

  it("returns not found when the position is not visible", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });
    loadAccountPositionDetail.mockResolvedValue(null);

    const response = await GET(new Request("https://alpha-dog.test/api/account/positions/position-1"), context);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error.code).toBe("SIMULATED_POSITION_NOT_FOUND");
  });

  it("returns position detail with legs and events", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await GET(new Request("https://alpha-dog.test/api/account/positions/position-1"), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(loadAccountPositionDetail).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "position-1",
      {
        eventCursor: null,
        eventLimit: 50,
      },
    );
    expect(json.position.legs).toHaveLength(1);
    expect(json.position.events).toHaveLength(1);
  });

  it("rejects malformed event cursors before loading position data", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });

    const response = await GET(new Request(
      "https://alpha-dog.test/api/account/positions/position-1?eventCursor=not%2Bbase64",
    ), context);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_EVENT_CURSOR");
    expect(loadAccountPositionDetail).not.toHaveBeenCalled();
  });
});
