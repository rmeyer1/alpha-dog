import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseRouteClient: vi.fn(),
  getSupabaseAuthConfig: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("./auth", () => ({
  getSupabaseAuthConfig: mocks.getSupabaseAuthConfig,
}));

vi.mock("./server", () => ({
  createSupabaseRouteClient: mocks.createSupabaseRouteClient,
}));

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
    mocks.createSupabaseRouteClient.mockImplementation((_request, response) => ({
      auth: {
        getUser: mocks.getUser.mockImplementationOnce(async () => {
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
  });

  it("preserves cookie rotation and deletion from the refresh response", async () => {
    mocks.createSupabaseRouteClient.mockImplementation((_request, response) => ({
      auth: {
        getUser: mocks.getUser.mockImplementationOnce(async () => {
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
