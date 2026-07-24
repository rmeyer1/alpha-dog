import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseRouteClient: vi.fn(),
  getSupabaseAuthConfig: vi.fn(),
  getUser: vi.fn(),
  loadPaperAccountOverview: vi.fn(),
}));

vi.mock("./auth", () => ({
  getSupabaseAuthConfig: mocks.getSupabaseAuthConfig,
  isAccountProfileComplete: (profile: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null) => Boolean(
    profile?.email?.trim() &&
      profile.first_name?.trim() &&
      profile.last_name?.trim(),
  ),
}));

vi.mock("./server", () => ({
  createSupabaseRouteClient: mocks.createSupabaseRouteClient,
}));

vi.mock("@/lib/account/simulated-account-portfolio", () => ({
  loadPaperAccountOverview: mocks.loadPaperAccountOverview,
}));

import { GET as getPaperAccount } from "@/app/api/account/paper-account/route";
import {
  hasSupabaseSessionCookie,
  refreshSupabaseSession,
  shouldRefreshSession,
  supabaseAuthCookieName,
} from "./session-middleware";

const SUPABASE_URL = "https://project-ref.supabase.co";
const AUTH_COOKIE = "sb-project-ref-auth-token";

function request(pathname: string, cookie?: string) {
  return new NextRequest(`https://alpha-dog.test${pathname}`, cookie
    ? { headers: { cookie } }
    : undefined);
}

describe("session proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAuthConfig.mockReturnValue({
      anonKey: "test-anon-key",
      url: SUPABASE_URL,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.createSupabaseRouteClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.loadPaperAccountOverview.mockResolvedValue({
      account: { id: "paper-account-1" },
      historyPositionCount: 0,
      openPositionCount: 0,
      summary: { cashBalance: 1_000 },
    });
  });

  it("refreshes only account pages and account-owned APIs", () => {
    expect(shouldRefreshSession("/account")).toBe(true);
    expect(shouldRefreshSession("/account/manual")).toBe(true);
    expect(shouldRefreshSession("/api/account/positions")).toBe(true);
    expect(shouldRefreshSession("/api/presets")).toBe(true);
    expect(shouldRefreshSession("/api/presets/preset-1")).toBe(true);
    expect(shouldRefreshSession("/api/auth/account-state")).toBe(true);
    expect(shouldRefreshSession("/api/auth/logout")).toBe(true);
    expect(shouldRefreshSession("/api/auth/profile")).toBe(true);
  });

  it("does not refresh public, OAuth, cron, or static routes", () => {
    expect(shouldRefreshSession("/")).toBe(false);
    expect(shouldRefreshSession("/screeners")).toBe(false);
    expect(shouldRefreshSession("/api/wheel/screener")).toBe(false);
    expect(shouldRefreshSession("/api/logos/AAPL")).toBe(false);
    expect(shouldRefreshSession("/api/finnhub/company/AAPL")).toBe(false);
    expect(shouldRefreshSession("/auth/callback")).toBe(false);
    expect(shouldRefreshSession("/api/auth/oauth/google")).toBe(false);
    expect(shouldRefreshSession("/api/auth/oauth/apple")).toBe(false);
    expect(shouldRefreshSession("/api/cron/wheel/screener-refresh")).toBe(false);
    expect(shouldRefreshSession("/_next/static/chunk.js")).toBe(false);
    expect(shouldRefreshSession("/favicon.ico")).toBe(false);
    expect(shouldRefreshSession("/images/logo.png")).toBe(false);
  });

  it("recognizes base and chunked Supabase auth cookies", () => {
    expect(supabaseAuthCookieName(SUPABASE_URL)).toBe(AUTH_COOKIE);
    expect(supabaseAuthCookieName("not a URL")).toBeNull();
    expect(
      hasSupabaseSessionCookie(
        request("/account", `${AUTH_COOKIE}=session`),
        SUPABASE_URL,
      ),
    ).toBe(true);
    expect(
      hasSupabaseSessionCookie(
        request("/account", `${AUTH_COOKIE}.0=chunk`),
        SUPABASE_URL,
      ),
    ).toBe(true);
    expect(
      hasSupabaseSessionCookie(
        request("/account", `${AUTH_COOKIE}.12=chunk`),
        SUPABASE_URL,
      ),
    ).toBe(true);
    expect(
      hasSupabaseSessionCookie(
        request("/account", "unrelated=value"),
        SUPABASE_URL,
      ),
    ).toBe(false);
    expect(
      hasSupabaseSessionCookie(
        request("/account", `${AUTH_COOKIE}=`),
        SUPABASE_URL,
      ),
    ).toBe(false);
  });

  it.each([
    `${AUTH_COOKIE}.backup=session`,
    `${AUTH_COOKIE}.01=session`,
    `${AUTH_COOKIE}.1.extra=session`,
    `${AUTH_COOKIE}.=-session`,
    `sb-other-project-auth-token=session`,
    `${AUTH_COOKIE}.0=`,
  ])("rejects empty, unrelated, or look-alike cookie %s", (cookie) => {
    expect(
      hasSupabaseSessionCookie(request("/account", cookie), SUPABASE_URL),
    ).toBe(false);
  });

  it("does not initialize Supabase or call Auth without a session cookie", async () => {
    await refreshSupabaseSession(request("/account"));

    expect(mocks.getSupabaseAuthConfig).toHaveBeenCalledOnce();
    expect(mocks.createSupabaseRouteClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not initialize Supabase for a look-alike auth cookie", async () => {
    await refreshSupabaseSession(
      request("/account", `${AUTH_COOKIE}.backup=session`),
    );

    expect(mocks.getSupabaseAuthConfig).toHaveBeenCalledOnce();
    expect(mocks.createSupabaseRouteClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not initialize Supabase for a public route even with a session cookie", async () => {
    await refreshSupabaseSession(
      request("/api/logos/AAPL", `${AUTH_COOKIE}=session`),
    );

    expect(mocks.getSupabaseAuthConfig).not.toHaveBeenCalled();
    expect(mocks.createSupabaseRouteClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("refreshes an authenticated request exactly once and preserves safety headers", async () => {
    mocks.createSupabaseRouteClient.mockImplementation((proxyRequest, response) => ({
      auth: {
        getUser: mocks.getUser.mockImplementationOnce(async () => {
          proxyRequest.cookies.set(AUTH_COOKIE, "refreshed");
          response.cookies.set(AUTH_COOKIE, "refreshed");
          response.headers.set(
            "Cache-Control",
            "private, no-cache, no-store, must-revalidate, max-age=0",
          );
          response.headers.set("Expires", "0");
          response.headers.set("Pragma", "no-cache");
          return {
            data: { user: { id: "user-1" } },
            error: null,
          };
        }),
      },
    }));

    const response = await refreshSupabaseSession(
      request("/api/presets", `${AUTH_COOKIE}=session`),
    );

    expect(mocks.createSupabaseRouteClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.cookies.get(AUTH_COOKIE)?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-middleware-request-cookie"))
      .toBe(`${AUTH_COOKIE}=refreshed`);
  });

  it("serializes cookie rotation and deletion for the current request", async () => {
    mocks.createSupabaseRouteClient.mockImplementation((proxyRequest, response) => ({
      auth: {
        getUser: mocks.getUser.mockImplementationOnce(async () => {
          proxyRequest.cookies.set(AUTH_COOKIE, "");
          proxyRequest.cookies.set(`${AUTH_COOKIE}.0`, "rotated");
          response.cookies.set(AUTH_COOKIE, "", { maxAge: 0 });
          response.cookies.set(`${AUTH_COOKIE}.0`, "rotated");
          return {
            data: { user: { id: "user-1" } },
            error: null,
          };
        }),
      },
    }));

    const response = await refreshSupabaseSession(
      request("/account", `${AUTH_COOKIE}=session`),
    );

    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.cookies.get(AUTH_COOKIE)?.value).toBe("");
    expect(response.cookies.get(`${AUTH_COOKIE}.0`)?.value).toBe("rotated");

    const downstreamRequest = request(
      "/account",
      response.headers.get("x-middleware-request-cookie") ?? undefined,
    );
    expect(downstreamRequest.cookies.get(AUTH_COOKIE)?.value).toBe("");
    expect(downstreamRequest.cookies.get(`${AUTH_COOKIE}.0`)?.value)
      .toBe("rotated");
  });

  it("forwards a rotated session to the authoritative protected handler", async () => {
    let proxyRefreshCalls = 0;
    let authoritativeCalls = 0;
    let redundantRefreshCalls = 0;

    mocks.createSupabaseRouteClient.mockImplementation(
      (currentRequest, currentResponse) => {
        if (mocks.createSupabaseRouteClient.mock.calls.length === 1) {
          return {
            auth: {
              getUser: async () => {
                proxyRefreshCalls += 1;
                currentRequest.cookies.set(AUTH_COOKIE, "refreshed");
                currentResponse.cookies.set(AUTH_COOKIE, "refreshed");
                currentResponse.headers.set(
                  "Cache-Control",
                  "private, no-cache, no-store, must-revalidate, max-age=0",
                );

                return {
                  data: { user: { id: "user-1" } },
                  error: null,
                };
              },
            },
          };
        }

        const forwardedCookie = currentRequest.cookies.get(AUTH_COOKIE)?.value;
        const getUser = async () => {
          authoritativeCalls += 1;

          if (forwardedCookie !== "refreshed") {
            redundantRefreshCalls += 1;
            return {
              data: { user: null },
              error: { message: "JWT expired" },
            };
          }

          return {
            data: {
              user: {
                app_metadata: {},
                aud: "authenticated",
                created_at: "2026-07-23T00:00:00.000Z",
                id: "user-1",
                user_metadata: {},
              },
            },
            error: null,
          };
        };
        const maybeSingle = async () => ({
          data: {
            email: "desk@example.com",
            first_name: "Ryan",
            last_name: "Meyer",
          },
          error: null,
        });

        return {
          auth: { getUser },
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle }),
            }),
          }),
        };
      },
    );

    const proxyResponse = await refreshSupabaseSession(
      request(
        "/api/account/paper-account",
        `${AUTH_COOKIE}=stale`,
      ),
    );
    const forwardedCookie = proxyResponse.headers.get(
      "x-middleware-request-cookie",
    );

    expect(forwardedCookie).toBe(`${AUTH_COOKIE}=refreshed`);

    const routeResponse = await getPaperAccount(
      request("/api/account/paper-account", forwardedCookie ?? undefined),
    );

    expect(routeResponse.status).toBe(200);
    expect(proxyRefreshCalls).toBe(1);
    expect(authoritativeCalls).toBe(1);
    expect(redundantRefreshCalls).toBe(0);
    expect(mocks.loadPaperAccountOverview).toHaveBeenCalledOnce();
  });

  it("fails open at the proxy boundary for an expired session", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("JWT expired"));

    const response = await refreshSupabaseSession(
      request("/account", `${AUTH_COOKIE}=expired`),
    );

    expect(response.status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
