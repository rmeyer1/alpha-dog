import type { CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getSupabaseAuthConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("./auth", () => ({
  getSupabaseAuthConfig: mocks.getSupabaseAuthConfig,
}));

import {
  createSupabaseRouteClient,
  secureSupabaseCookieOptions,
} from "./server";

interface CapturedServerClientOptions {
  cookies: {
    getAll: () => Array<{
      name: string;
      value: string;
    }>;
    setAll: (
      cookies: Array<{
        name: string;
        options: CookieOptions;
        value: string;
      }>,
      headers: Record<string, string>,
    ) => Promise<void> | void;
  };
}

describe("Supabase route client response propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getSupabaseAuthConfig.mockReturnValue({
      anonKey: "test-publishable-key",
      url: "https://project-ref.supabase.co",
    });
    mocks.createServerClient.mockReturnValue({ auth: {} });
  });

  it("returns null when Supabase authentication is not configured", () => {
    mocks.getSupabaseAuthConfig.mockReturnValue(null);

    const request = new NextRequest("https://alpha-dog.test/account");
    const response = NextResponse.next({ request });

    expect(createSupabaseRouteClient(request, response)).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("exposes request cookies to the Supabase SSR client", () => {
    const request = new NextRequest("https://alpha-dog.test/account", {
      headers: {
        cookie: "sb-project-ref-auth-token=stale; preference=compact",
      },
    });
    const response = NextResponse.next({ request });

    createSupabaseRouteClient(request, response);

    const options = mocks.createServerClient.mock.calls[0]?.[2] as
      | CapturedServerClientOptions
      | undefined;

    expect(options?.cookies.getAll()).toEqual([
      { name: "sb-project-ref-auth-token", value: "stale" },
      { name: "preference", value: "compact" },
    ]);
  });

  it("copies refreshed cookies to the request and response with cache-safety headers", async () => {
    const request = new NextRequest("https://alpha-dog.test/account", {
      headers: {
        cookie: "sb-project-ref-auth-token=stale",
      },
    });
    const response = NextResponse.next({ request });

    expect(createSupabaseRouteClient(request, response)).not.toBeNull();

    const options = mocks.createServerClient.mock.calls[0]?.[2] as
      | CapturedServerClientOptions
      | undefined;

    expect(options).toBeDefined();
    await options?.cookies.setAll(
      [
        {
          name: "sb-project-ref-auth-token",
          options: { maxAge: 0, path: "/" },
          value: "",
        },
        {
          name: "sb-project-ref-auth-token.0",
          options: { httpOnly: false, path: "/", sameSite: "lax" },
          value: "rotated",
        },
      ],
      {
        "Cache-Control":
          "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );

    expect(request.cookies.get("sb-project-ref-auth-token")?.value).toBe("");
    expect(request.cookies.get("sb-project-ref-auth-token.0")?.value)
      .toBe("rotated");
    expect(response.cookies.get("sb-project-ref-auth-token")?.value).toBe("");
    expect(response.cookies.get("sb-project-ref-auth-token.0")?.value)
      .toBe("rotated");
    expect(response.cookies.get("sb-project-ref-auth-token")).toMatchObject({
      httpOnly: false,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(response.cookies.get("sb-project-ref-auth-token.0")).toMatchObject({
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("documents and enforces the Supabase SSR cookie boundary", () => {
    expect(
      secureSupabaseCookieOptions(
        {
          httpOnly: true,
          path: undefined,
          sameSite: false,
          secure: false,
        },
        true,
      ),
    ).toMatchObject({
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      secure: true,
    });

    expect(
      secureSupabaseCookieOptions(
        {
          domain: "alpha-dog.test",
          maxAge: 3600,
          path: "/",
          sameSite: "strict",
          secure: false,
        },
        false,
      ),
    ).toMatchObject({
      domain: "alpha-dog.test",
      httpOnly: false,
      maxAge: 3600,
      path: "/",
      sameSite: "strict",
      secure: false,
    });
  });
});
