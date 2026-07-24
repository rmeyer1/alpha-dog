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

import { createSupabaseRouteClient } from "./server";

interface CapturedServerClientOptions {
  cookies: {
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
    mocks.getSupabaseAuthConfig.mockReturnValue({
      anonKey: "test-publishable-key",
      url: "https://project-ref.supabase.co",
    });
    mocks.createServerClient.mockReturnValue({ auth: {} });
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
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
