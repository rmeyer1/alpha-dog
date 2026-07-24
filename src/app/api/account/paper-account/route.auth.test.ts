import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseRouteClient: vi.fn(),
  getUser: vi.fn(),
  loadAccountPortfolio: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteClient: mocks.createSupabaseRouteClient,
}));

vi.mock("@/lib/account/simulated-account-portfolio", () => ({
  loadAccountPortfolio: mocks.loadAccountPortfolio,
}));

import { GET } from "./route";

function request(headers?: HeadersInit) {
  return new NextRequest(
    "https://alpha-dog.test/api/account/paper-account",
    { headers },
  );
}

function supabaseClient({
  authError = null,
  userId = "user-1",
}: {
  authError?: { message: string } | null;
  userId?: string | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: {
      email: "desk@example.com",
      first_name: "Ryan",
      last_name: "Meyer",
    },
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  mocks.getUser.mockResolvedValueOnce({
    data: {
      user: userId
        ? {
          app_metadata: {},
          aud: "authenticated",
          created_at: "2026-07-23T00:00:00.000Z",
          id: userId,
          user_metadata: {},
        }
        : null,
    },
    error: authError,
  });

  return {
    auth: { getUser: mocks.getUser },
    from,
  } as unknown as SupabaseClient;
}

describe("GET /api/account/paper-account authoritative auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAccountPortfolio.mockResolvedValue({
      account: { id: "paper-account-1" },
      historyPositions: [],
      openPositions: [],
      positions: [],
      summary: { cashBalance: 1_000 },
    });
  });

  it("rejects a missing server-side session", async () => {
    mocks.createSupabaseRouteClient.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(mocks.loadAccountPortfolio).not.toHaveBeenCalled();
  });

  it("rejects an expired session after authoritative getUser validation", async () => {
    mocks.createSupabaseRouteClient.mockReturnValue(supabaseClient({
      authError: { message: "JWT expired" },
      userId: null,
    }));

    const response = await GET(request({
      cookie: "sb-project-ref-auth-token=expired",
    }));

    expect(response.status).toBe(401);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.loadAccountPortfolio).not.toHaveBeenCalled();
  });

  it("does not trust a crafted proxy-bypass header", async () => {
    mocks.createSupabaseRouteClient.mockReturnValue(supabaseClient({
      authError: { message: "JWT expired" },
      userId: null,
    }));

    const response = await GET(request({
      cookie: "sb-project-ref-auth-token=expired",
      "x-middleware-subrequest": "src/proxy:src/proxy:src/proxy",
    }));

    expect(response.status).toBe(401);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.loadAccountPortfolio).not.toHaveBeenCalled();
  });

  it("returns protected data and preserves refresh cookies and safety headers", async () => {
    const client = supabaseClient();
    mocks.createSupabaseRouteClient.mockImplementation((_request, response) => {
      response.cookies.set("sb-project-ref-auth-token.0", "refreshed");
      response.headers.set(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate, max-age=0",
      );
      response.headers.set("Expires", "0");
      response.headers.set("Pragma", "no-cache");
      return client;
    });

    const response = await GET(request({
      cookie: "sb-project-ref-auth-token=valid",
    }));

    expect(response.status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.loadAccountPortfolio).toHaveBeenCalledWith(client, "user-1");
    expect(response.cookies.get("sb-project-ref-auth-token.0")?.value)
      .toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
