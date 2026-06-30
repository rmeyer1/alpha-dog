import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthenticatedSupabaseUser,
  getBearerToken,
  getSupabaseAuthConfig,
  isAccountProfileComplete,
  normalizeAccountEmail,
} from "./auth";

describe("supabase auth helpers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL: "https://alpha.supabase.co/",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("normalizes account emails deterministically", () => {
    expect(normalizeAccountEmail("  User.Name+Desk@Example.COM  "))
      .toBe("user.name+desk@example.com");
  });

  it("keeps auth config separate from service-role config", () => {
    const config = getSupabaseAuthConfig();

    expect(config).toEqual({
      anonKey: "anon-key",
      url: "https://alpha.supabase.co",
    });
  });

  it("extracts bearer tokens only from bearer authorization headers", () => {
    expect(getBearerToken(new Request("https://example.com"))).toBeNull();
    expect(getBearerToken(new Request("https://example.com", {
      headers: { authorization: "Basic abc" },
    }))).toBeNull();
    expect(getBearerToken(new Request("https://example.com", {
      headers: { authorization: "Bearer session-token" },
    }))).toBe("session-token");
  });

  it("loads the current Supabase Auth user from the user endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      email: "desk@example.com",
      id: "00000000-0000-0000-0000-000000000001",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await getAuthenticatedSupabaseUser(
      new Request("https://example.com", {
        headers: { authorization: "Bearer session-token" },
      }),
    );

    expect(user).toEqual({
      email: "desk@example.com",
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://alpha.supabase.co/auth/v1/user"),
      {
        cache: "no-store",
        headers: {
          apikey: "anon-key",
          Authorization: "Bearer session-token",
        },
      },
    );
  });

  it("requires email, first name, and last name for complete profiles", () => {
    expect(isAccountProfileComplete(null)).toBe(false);
    expect(isAccountProfileComplete({
      email: "desk@example.com",
      first_name: " ",
      last_name: "Meyer",
    })).toBe(false);
    expect(isAccountProfileComplete({
      email: "desk@example.com",
      first_name: "Ryan",
      last_name: "Meyer",
    })).toBe(true);
  });
});
