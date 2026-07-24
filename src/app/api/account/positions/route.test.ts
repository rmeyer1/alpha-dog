import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_INCOMPLETE, UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { GET, POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const createSimulatedPosition = vi.hoisted(() => vi.fn());
const loadAccountPositionPage = vi.hoisted(() => vi.fn());
const loadPaperAccountOverview = vi.hoisted(() => vi.fn());

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
    createSimulatedPosition,
  };
});

vi.mock("@/lib/account/simulated-account-portfolio", () => ({
  loadAccountPositionPage,
  loadPaperAccountOverview,
}));

function positionRequest(body: unknown) {
  return new Request("https://alpha-dog.test/api/account/positions", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/account/positions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimulatedPosition.mockResolvedValue({
      event: { id: "event-1" },
      legs: [{ id: "leg-1" }],
      paperAccount: { id: "paper-account-1" },
      position: { id: "position-1" },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(positionRequest({}));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(createSimulatedPosition).not.toHaveBeenCalled();
  });

  it("requires a completed account profile", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: PROFILE_INCOMPLETE });

    const response = await POST(positionRequest({}));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe(PROFILE_INCOMPLETE);
    expect(createSimulatedPosition).not.toHaveBeenCalled();
  });

  it("rejects invalid simulated position payloads", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await POST(positionRequest({
      contracts: 0,
      legs: [],
      strategyType: "short_put",
      symbol: "",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_SIMULATED_POSITION");
    expect(createSimulatedPosition).not.toHaveBeenCalled();
  });

  it("creates a simulated position for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await POST(positionRequest({
      candidateSnapshot: { score: 82 },
      contracts: 2,
      dataProvenance: {
        asOf: "2026-07-03T20:00:00.000Z",
        cacheSource: "materialized",
        cacheStatus: "stale",
        feed: "opra",
        sourceMode: "live",
      },
      expirationDate: "2026-08-21",
      legs: [{
        openPrice: 1.25,
        optionType: "put",
        side: "short",
        strike: 190,
      }],
      netCredit: 1.25,
      openedAt: "2026-07-03",
      strategyType: "short_put",
      symbol: "aapl",
    }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createSimulatedPosition).toHaveBeenCalledWith(
      supabase,
      "user-1",
      expect.objectContaining({
        contracts: 2,
        dataProvenance: expect.objectContaining({
          cacheSource: "materialized",
          cacheStatus: "stale",
          feed: "opra",
          sourceMode: "live",
        }),
        openedAt: "2026-07-03",
        strategyType: "short_put",
        symbol: "AAPL",
      }),
    );
    expect(json.position.id).toBe("position-1");
  });
});

describe("GET /api/account/positions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPaperAccountOverview.mockResolvedValue({
      historyPositionCount: 1,
      openPositionCount: 1,
      positionWatermark: "2026-07-24T12:00:00.000Z",
      summary: { cashBalance: 1_000 },
    });
    loadAccountPositionPage.mockImplementation(
      (_supabase, _userId, input: { scope: "history" | "open" }) =>
        Promise.resolve({
          nextCursor: `${input.scope}-next`,
          positions: input.scope === "open"
            ? [{ id: "position-1", status: "open" }]
            : [{ id: "position-2", status: "closed" }],
          scope: input.scope,
        }),
    );
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await GET(new Request("https://alpha-dog.test/api/account/positions"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(loadPaperAccountOverview).not.toHaveBeenCalled();
    expect(loadAccountPositionPage).not.toHaveBeenCalled();
  });

  it("returns independently paged open and historical positions", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await GET(new Request("https://alpha-dog.test/api/account/positions"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(loadPaperAccountOverview).toHaveBeenCalledWith(supabase, "user-1");
    expect(loadAccountPositionPage).toHaveBeenCalledTimes(2);
    expect(loadAccountPositionPage).toHaveBeenCalledWith(
      supabase,
      "user-1",
      {
        cursor: null,
        limit: 25,
        scope: "open",
        watermark: "2026-07-24T12:00:00.000Z",
      },
    );
    expect(json.openPositions).toHaveLength(1);
    expect(json.historyPositions).toHaveLength(1);
    expect(json.pages.open).toEqual({
      items: [{ id: "position-1", status: "open" }],
      nextCursor: "open-next",
      total: 1,
    });
    expect(json.pages.history.total).toBe(1);
    expect(json.summary.cashBalance).toBe(1_000);
  });

  it("loads only the requested collection on load-more requests", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await GET(new Request(
      "https://alpha-dog.test/api/account/positions?scope=history&historyPageSize=10",
    ));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(loadAccountPositionPage).toHaveBeenCalledTimes(1);
    expect(loadAccountPositionPage).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ limit: 10, scope: "history" }),
    );
    expect(json.pages.open).toBeUndefined();
    expect(json.openPositions).toBeUndefined();
  });

  it("rejects malformed cursor and page state before portfolio queries", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });

    const malformedCursor = await GET(new Request(
      "https://alpha-dog.test/api/account/positions?scope=open&openCursor=not%2Bbase64",
    ));
    const malformedJson = await malformedCursor.json();

    expect(malformedCursor.status).toBe(400);
    expect(malformedJson.error.code).toBe("INVALID_POSITION_CURSOR");
    expect(loadPaperAccountOverview).not.toHaveBeenCalled();
    expect(loadAccountPositionPage).not.toHaveBeenCalled();

    const invalidPage = await GET(new Request(
      "https://alpha-dog.test/api/account/positions?openPageSize=101",
    ));
    const invalidPageJson = await invalidPage.json();

    expect(invalidPage.status).toBe(400);
    expect(invalidPageJson.error.code).toBe("INVALID_PAGE_SIZE");
    expect(loadPaperAccountOverview).not.toHaveBeenCalled();
  });
});
