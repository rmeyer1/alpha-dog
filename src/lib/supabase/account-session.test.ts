import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  PROFILE_INCOMPLETE,
  resolveAccountSession,
  UNAUTHENTICATED,
} from "./account-session";

function user(): User {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-30T00:00:00.000Z",
    id: "user-1",
    user_metadata: {},
  };
}

function supabaseMock({
  authError = null,
  profile = {
    email: "desk@example.com",
    first_name: "Ryan",
    last_name: "Meyer",
  },
  profileError = null,
  userData = user(),
}: {
  authError?: { message: string } | null;
  profile?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  profileError?: { message: string } | null;
  userData?: User | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: profile,
    error: profileError,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi.fn(async () => ({
    data: { user: userData },
    error: authError,
  }));

  return {
    client: {
      auth: { getUser },
      from,
    } as unknown as SupabaseClient,
    getUser,
  };
}

describe("account session guards", () => {
  it("rejects missing Supabase auth config as unauthenticated", async () => {
    await expect(resolveAccountSession(null, NextResponse.next()))
      .resolves.toEqual({ code: UNAUTHENTICATED });
  });

  it("rejects expired or missing sessions as unauthenticated", async () => {
    const { client } = supabaseMock({
      authError: { message: "JWT expired" },
      userData: null,
    });

    await expect(resolveAccountSession(client, NextResponse.next()))
      .resolves.toEqual({ code: UNAUTHENTICATED });
  });

  it("rejects sessions with incomplete profiles", async () => {
    const { client } = supabaseMock({
      profile: {
        email: "desk@example.com",
        first_name: "Ryan",
        last_name: "",
      },
    });

    await expect(resolveAccountSession(client, NextResponse.next()))
      .resolves.toEqual({ code: PROFILE_INCOMPLETE });
  });

  it("returns the authoritative Supabase user for complete profiles", async () => {
    const response = NextResponse.next();
    const { client } = supabaseMock();

    const result = await resolveAccountSession(client, response);

    expect("code" in result).toBe(false);
    if (!("code" in result)) {
      expect(result.response).toBe(response);
      expect(result.supabase).toBe(client);
      expect(result.user.id).toBe("user-1");
    }
  });

  it("uses stable account-required error envelopes", async () => {
    const unauthenticated = accountSessionErrorResponse(UNAUTHENTICATED);
    const incomplete = accountSessionErrorResponse(PROFILE_INCOMPLETE);

    await expect(unauthenticated.json()).resolves.toEqual({
      error: {
        code: UNAUTHENTICATED,
        message: "Sign in to use this account feature.",
      },
    });
    expect(unauthenticated.status).toBe(401);

    await expect(incomplete.json()).resolves.toEqual({
      error: {
        code: PROFILE_INCOMPLETE,
        message: "Complete your account profile to use this account feature.",
      },
    });
    expect(incomplete.status).toBe(403);
  });

  it("copies refreshed cookies and cache-safety headers onto protected responses", () => {
    const source = NextResponse.next();
    source.cookies.set("sb-project-ref-auth-token.0", "refreshed");
    source.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    source.headers.set("Expires", "0");
    source.headers.set("Pragma", "no-cache");
    source.headers.set("X-Internal-Auth-Trace", "do-not-copy");

    const response = copyAuthCookies(
      source,
      NextResponse.json({ status: "ok" }),
    );

    expect(response.cookies.get("sb-project-ref-auth-token.0")?.value)
      .toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-internal-auth-trace")).toBeNull();
  });

  it("preserves cleared auth cookies and safety headers on auth errors", () => {
    const source = NextResponse.next();
    source.cookies.set("sb-project-ref-auth-token", "", { maxAge: 0 });
    source.headers.set("Cache-Control", "private, no-store");
    source.headers.set("Expires", "0");
    source.headers.set("Pragma", "no-cache");

    const response = accountSessionErrorResponse(
      UNAUTHENTICATED,
      "saved presets",
      source,
    );

    expect(response.status).toBe(401);
    expect(response.cookies.get("sb-project-ref-auth-token")?.value).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
