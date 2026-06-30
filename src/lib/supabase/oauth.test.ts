import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ACCOUNT_EMAIL_CONFLICT,
  EMAIL_ALREADY_REGISTERED,
  accountAuthErrorUrl,
  accountProfileCompletionUrl,
  ensureOAuthAccountProfile,
  manualDuplicateEmailResult,
  oauthProfileFromUser,
  oauthProviderUserIdFromUser,
  parseOAuthProvider,
  recordOAuthAccountIdentity,
  safeRedirectPath,
} from "./oauth";

function user(overrides: Partial<User>): User {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-30T00:00:00.000Z",
    email: "desk@example.com",
    id: "00000000-0000-0000-0000-000000000001",
    user_metadata: {},
    ...overrides,
  };
}

function supabaseMock({
  existingProfile = null,
  insertError = null,
  upsertError = null,
}: {
  existingProfile?: unknown;
  insertError?: { code?: string } | null;
  upsertError?: { code?: string } | null;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: existingProfile,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: insertError }));
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const from = vi.fn((table: string) =>
    table === "account_identities"
      ? { upsert }
      : { insert, select },
  );

  return {
    client: { from } as unknown as SupabaseClient,
    insert,
    upsert,
  };
}

describe("oauth helpers", () => {
  it("accepts only supported providers", () => {
    expect(parseOAuthProvider("google")).toBe("google");
    expect(parseOAuthProvider("apple")).toBe("apple");
    expect(parseOAuthProvider("github")).toBeNull();
  });

  it("keeps redirects local to the app", () => {
    expect(safeRedirectPath("/screeners")).toBe("/screeners");
    expect(safeRedirectPath("https://evil.example")).toBe("/account");
    expect(safeRedirectPath("//evil.example")).toBe("/account");
  });

  it("maps Google profile fields into a complete account profile", () => {
    const profile = oauthProfileFromUser(user({
      app_metadata: { provider: "google" },
      user_metadata: {
        email: "Desk@Example.com",
        family_name: "Meyer",
        given_name: "Ryan",
        name: "Ryan Meyer",
      },
    }));

    expect(profile).toEqual({
      profile: {
        display_name: "Ryan Meyer",
        email: "desk@example.com",
        first_name: "Ryan",
        id: "00000000-0000-0000-0000-000000000001",
        last_name: "Meyer",
        primary_provider: "google",
      },
      status: "complete",
    });
  });

  it("routes Apple users with missing one-time name data to completion", () => {
    const profile = oauthProfileFromUser(user({
      app_metadata: { provider: "apple" },
      email: "relay@privaterelay.appleid.com",
      user_metadata: {},
    }));

    expect(profile).toEqual({
      email: "relay@privaterelay.appleid.com",
      firstName: null,
      lastName: null,
      provider: "apple",
      status: "needs_completion",
    });
  });

  it("does not create a duplicate profile for duplicate provider email", async () => {
    const { client } = supabaseMock({
      insertError: { code: "23505" },
    });

    const result = await ensureOAuthAccountProfile(client, user({
      app_metadata: { provider: "google" },
      email: "Desk@Example.com",
      user_metadata: {
        family_name: "Meyer",
        given_name: "Ryan",
      },
    }));

    expect(result).toEqual({
      code: ACCOUNT_EMAIL_CONFLICT,
      email: "desk@example.com",
      provider: "google",
      status: "email_conflict",
    });
  });

  it("creates one complete profile when none exists", async () => {
    const { client, insert, upsert } = supabaseMock({});

    const result = await ensureOAuthAccountProfile(client, user({
      app_metadata: { provider: "google" },
      identities: [{ id: "google-subject", provider: "google" }],
      user_metadata: {
        family_name: "Meyer",
        given_name: "Ryan",
      },
    }));

    expect(result.status).toBe("complete");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      {
        provider: "google",
        provider_email: "desk@example.com",
        provider_user_id: "google-subject",
        user_id: "00000000-0000-0000-0000-000000000001",
      },
      {
        ignoreDuplicates: true,
        onConflict: "provider,provider_user_id",
      },
    );
  });

  it("records linked providers for an existing authenticated profile", async () => {
    const { client, insert, upsert } = supabaseMock({
      existingProfile: {
        email: "desk@example.com",
        first_name: "Ryan",
        last_name: "Meyer",
      },
    });

    const result = await ensureOAuthAccountProfile(client, user({
      app_metadata: { provider: "google" },
      identities: [{ id: "google-subject", provider: "google" }],
      user_metadata: {
        family_name: "Meyer",
        given_name: "Ryan",
      },
    }));

    expect(result.status).toBe("complete");
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("keeps Apple relay or any future provider email distinct by normalization only", () => {
    expect(manualDuplicateEmailResult(" Desk@Example.com ")).toEqual({
      code: EMAIL_ALREADY_REGISTERED,
      email: "desk@example.com",
      status: "email_conflict",
    });
    expect(manualDuplicateEmailResult("relay@privaterelay.appleid.com"))
      .toEqual({
        code: EMAIL_ALREADY_REGISTERED,
        email: "relay@privaterelay.appleid.com",
        status: "email_conflict",
      });
  });

  it("uses provider subject identifiers for audit linking", async () => {
    expect(oauthProviderUserIdFromUser(user({
      identities: [{ id: "google-subject", provider: "google" }],
    }))).toBe("google-subject");

    const { client, upsert } = supabaseMock({});
    await recordOAuthAccountIdentity(client, user({
      app_metadata: { provider: "google" },
      identities: [{ identity_id: "google-identity", provider: "google" }],
    }));

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        provider_user_id: "google-identity",
      }),
      expect.objectContaining({
        ignoreDuplicates: true,
      }),
    );
  });

  it("builds safe account status URLs", () => {
    expect(
      accountAuthErrorUrl(
        "https://alpha.example/auth/callback",
        "oauth_cancelled",
        "/screeners",
      ).toString(),
    ).toBe("https://alpha.example/account?auth_error=oauth_cancelled&next=%2Fscreeners");

    expect(
      accountProfileCompletionUrl(
        "https://alpha.example/auth/callback",
        "/presets",
      ).toString(),
    ).toBe("https://alpha.example/account?profile=complete&next=%2Fpresets");
  });
});
