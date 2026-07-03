import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { PATCH } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const updatePaperAccountSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/simulated-account-portfolio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account/simulated-account-portfolio")>();

  return {
    ...actual,
    updatePaperAccountSettings,
  };
});

function settingsRequest(body: unknown) {
  return new Request("https://alpha-dog.test/api/account/paper-account/settings", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

describe("PATCH /api/account/paper-account/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePaperAccountSettings.mockResolvedValue({
      currentCash: 5_000,
      id: "paper-account-1",
      startingCash: 5_000,
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await PATCH(settingsRequest({ startingCash: 5_000 }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(updatePaperAccountSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid settings payloads", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await PATCH(settingsRequest({ startingCash: -1 }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_PAPER_ACCOUNT_SETTINGS");
    expect(updatePaperAccountSettings).not.toHaveBeenCalled();
  });

  it("updates settings for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await PATCH(settingsRequest({
      currentCash: 5_000,
      marginInterestRate: 0.075,
      startingCash: 5_000,
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updatePaperAccountSettings).toHaveBeenCalledWith(supabase, "user-1", {
      currentCash: 5_000,
      marginInterestRate: 0.075,
      startingCash: 5_000,
    });
    expect(json.account.currentCash).toBe(5_000);
  });

  it("allows initializing an account with zero balances", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await PATCH(settingsRequest({
      currentCash: 0,
      startingCash: 0,
    }));

    expect(response.status).toBe(200);
    expect(updatePaperAccountSettings).toHaveBeenCalledWith(supabase, "user-1", {
      currentCash: 0,
      startingCash: 0,
    });
  });
});
