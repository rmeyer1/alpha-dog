import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_EMAIL_CONFLICT } from "./oauth";
import {
  completeAccountProfile,
  profileCompletionInputSchema,
  PROFILE_AUTH_NOT_CONFIGURED,
  PROFILE_MISSING_EMAIL,
  PROFILE_UNAUTHENTICATED,
  PROFILE_SAVE_FAILED,
} from "./profile-completion";

function user(overrides: Partial<User> = {}): User {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-06-30T00:00:00.000Z",
    email: "Desk@Example.com",
    id: "user-1",
    user_metadata: {},
    ...overrides,
  };
}

function supabaseMock({
  authError = null,
  currentUser = user(),
  upsertError = null,
}: {
  authError?: { message: string } | null;
  currentUser?: User | null;
  upsertError?: { code?: string } | null;
} = {}) {
  const getUser = vi.fn(async () => ({
    data: { user: currentUser },
    error: authError,
  }));
  const upsert = vi.fn(async () => ({ error: upsertError }));
  const from = vi.fn(() => ({ upsert }));

  return {
    client: {
      auth: { getUser },
      from,
    } as unknown as SupabaseClient,
    upsert,
  };
}

describe("profile completion", () => {
  it("validates required profile names", () => {
    const parsed = profileCompletionInputSchema.safeParse({
      firstName: "",
      lastName: " ",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.firstName).toBeDefined();
    expect(parsed.error?.flatten().fieldErrors.lastName).toBeDefined();
  });

  it("upserts a complete profile using session-derived identity fields", async () => {
    const { client, upsert } = supabaseMock({
      currentUser: user({
        app_metadata: { provider: "google" },
      }),
    });

    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, client)).resolves.toEqual({
      profile: {
        email: "desk@example.com",
        firstName: "Ryan",
        id: "user-1",
        lastName: "Meyer",
      },
      status: "complete",
    });
    expect(upsert).toHaveBeenCalledWith(
      {
        display_name: "Ryan Meyer",
        email: "desk@example.com",
        first_name: "Ryan",
        id: "user-1",
        last_name: "Meyer",
        primary_provider: "google",
      },
      { onConflict: "id" },
    );
  });

  it("returns stable setup and session errors", async () => {
    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, null)).resolves.toEqual({
      code: PROFILE_AUTH_NOT_CONFIGURED,
      status: "error",
    });

    const { client } = supabaseMock({
      authError: { message: "JWT expired" },
      currentUser: null,
    });

    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, client)).resolves.toEqual({
      code: PROFILE_UNAUTHENTICATED,
      status: "error",
    });
  });

  it("requires an email from Supabase Auth or user metadata", async () => {
    const { client } = supabaseMock({
      currentUser: user({ email: undefined, user_metadata: {} }),
    });

    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, client)).resolves.toEqual({
      code: PROFILE_MISSING_EMAIL,
      status: "error",
    });
  });

  it("maps database uniqueness and generic save failures safely", async () => {
    const duplicate = supabaseMock({ upsertError: { code: "23505" } });

    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, duplicate.client)).resolves.toEqual({
      code: ACCOUNT_EMAIL_CONFLICT,
      status: "error",
    });

    const generic = supabaseMock({ upsertError: { code: "OTHER" } });

    await expect(completeAccountProfile({
      firstName: "Ryan",
      lastName: "Meyer",
    }, generic.client)).resolves.toEqual({
      code: PROFILE_SAVE_FAILED,
      status: "error",
    });
  });
});
