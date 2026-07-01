import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadAccountHubState } from "./account-hub";

function user(overrides: Partial<User> = {}): User {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-30T00:00:00.000Z",
    email: "desk@example.com",
    id: "user-1",
    user_metadata: {},
    ...overrides,
  };
}

function supabaseMock({
  authError = null,
  currentUser = user(),
  identities = [],
  identityError = null,
  presetCount = 0,
  presetError = null,
  profile = {
    created_at: "2026-06-30T00:00:00.000Z",
    display_name: "Ryan Meyer",
    email: "desk@example.com",
    first_name: "Ryan",
    last_name: "Meyer",
    primary_provider: "google",
    updated_at: "2026-06-30T01:00:00.000Z",
  },
  profileError = null,
}: {
  authError?: { message: string } | null;
  currentUser?: User | null;
  identities?: unknown[];
  identityError?: { message: string } | null;
  presetCount?: number;
  presetError?: { message: string } | null;
  profile?: unknown;
  profileError?: { message: string } | null;
} = {}) {
  const getUser = vi.fn(async () => ({
    data: { user: currentUser },
    error: authError,
  }));

  const from = vi.fn((table: string) => {
    if (table === "account_profiles") {
      const maybeSingle = vi.fn(async () => ({
        data: profile,
        error: profileError,
      }));
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));

      return { select };
    }

    if (table === "account_identities") {
      const order = vi.fn(async () => ({
        data: identities,
        error: identityError,
      }));
      const eq = vi.fn(() => ({ order }));
      const select = vi.fn(() => ({ eq }));

      return { select };
    }

    const eq = vi.fn(async () => ({
      count: presetCount,
      error: presetError,
    }));
    const select = vi.fn(() => ({ eq }));

    return { select };
  });

  return {
    client: {
      auth: { getUser },
      from,
    } as unknown as SupabaseClient,
    from,
  };
}

describe("account hub state", () => {
  it("returns unauthenticated without Supabase config", async () => {
    await expect(loadAccountHubState(null)).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("returns unauthenticated for missing or expired sessions", async () => {
    const { client } = supabaseMock({
      authError: { message: "JWT expired" },
      currentUser: null,
    });

    await expect(loadAccountHubState(client)).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("routes incomplete profiles to completion state", async () => {
    const { client } = supabaseMock({
      profile: {
        created_at: null,
        display_name: null,
        email: "desk@example.com",
        first_name: "Ryan",
        last_name: "",
        primary_provider: "google",
        updated_at: null,
      },
    });

    await expect(loadAccountHubState(client)).resolves.toEqual({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "",
      missingFields: ["last name"],
      status: "incomplete_profile",
      userId: "user-1",
    });
  });

  it("returns complete account state with provider and preset summaries", async () => {
    const { client } = supabaseMock({
      identities: [
        {
          created_at: "2026-06-30T02:00:00.000Z",
          provider: "google",
          provider_email: "desk@example.com",
        },
      ],
      presetCount: 2,
    });

    await expect(loadAccountHubState(client)).resolves.toEqual({
      email: "desk@example.com",
      firstName: "Ryan",
      identities: [
        {
          createdAt: "2026-06-30T02:00:00.000Z",
          provider: "google",
          providerEmail: "desk@example.com",
        },
      ],
      lastName: "Meyer",
      presetCount: 2,
      primaryProvider: "google",
      profileUpdatedAt: "2026-06-30T01:00:00.000Z",
      status: "ready",
      userId: "user-1",
    });
  });

  it("returns a visible error state when account data cannot load", async () => {
    const { client } = supabaseMock({
      profileError: { message: "RLS denied" },
    });

    await expect(loadAccountHubState(client)).resolves.toEqual({
      message: "Unable to load account profile.",
      status: "error",
    });
  });
});
