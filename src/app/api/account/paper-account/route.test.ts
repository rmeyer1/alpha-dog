import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { GET } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const loadAccountPortfolio = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/simulated-account-portfolio", () => ({
  loadAccountPortfolio,
}));

describe("GET /api/account/paper-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAccountPortfolio.mockResolvedValue({
      account: { id: "paper-account-1", startingCash: 1_000 },
      summary: { cashBalance: 1_250, marginBalance: 0 },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await GET(new Request("https://alpha-dog.test/api/account/paper-account"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(loadAccountPortfolio).not.toHaveBeenCalled();
  });

  it("returns paper account and summary for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await GET(new Request("https://alpha-dog.test/api/account/paper-account"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(loadAccountPortfolio).toHaveBeenCalledWith(supabase, "user-1");
    expect(json.account.id).toBe("paper-account-1");
    expect(json.summary.cashBalance).toBe(1_250);
  });
});
