import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  getSupabaseServiceConfig: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
}));

vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: mocks.getSupabaseServiceConfig,
}));

import {
  ACCOUNT_DELETION_CONFIRMATION,
  authorizeAccountDeletion,
} from "./data-lifecycle";

const now = new Date("2026-07-27T12:00:00.000Z");
const user = {
  email: "desk@example.com",
  id: "user-1",
  last_sign_in_at: "2026-07-27T11:55:00.000Z",
} as User;
const input = {
  confirmation: ACCOUNT_DELETION_CONFIRMATION,
  email: "desk@example.com",
};

function requestRow(
  overrides: Partial<{
    expires_at: string;
    sessions_revoked_at: string | null;
    status: "authorized" | "completed" | "failed";
    user_id: string | null;
  }> = {},
) {
  return {
    application_data_deleted_at: null,
    attempt_count: 0,
    auth_user_deleted_at: null,
    confirmation_email_hash:
      "292da51eb42b1c2834564765382d72921c79aaf248a1e47965c6b1c207cdb000",
    expires_at: "2026-07-28T12:00:00.000Z",
    id: "request-1",
    result: {},
    sessions_revoked_at: null,
    status: "authorized" as const,
    token_hash: "token-hash",
    user_id: "user-1",
    ...overrides,
  };
}

function adminClient({
  insertData = requestRow(),
  insertError = null,
  retryData = null,
  retryError = null,
}: {
  insertData?: ReturnType<typeof requestRow> | null;
  insertError?: unknown;
  retryData?: ReturnType<typeof requestRow> | null;
  retryError?: unknown;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: retryData,
    error: retryError,
  });
  const retryEq = vi.fn(() => ({ maybeSingle }));
  const retrySelect = vi.fn(() => ({ eq: retryEq }));
  const single = vi.fn().mockResolvedValue({
    data: insertData,
    error: insertError,
  });
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const from = vi.fn(() => ({
    insert,
    select: retrySelect,
  }));
  const admin = { from } as unknown as SupabaseClient;

  mocks.getSupabaseAdminClient.mockReturnValue(admin);

  return {
    from,
    insert,
    maybeSingle,
    retryEq,
  };
}

function userClient({
  accessToken = "access-token",
  authenticationTimestamp = Math.floor(
    new Date("2026-07-27T11:55:00.000Z").getTime() / 1_000,
  ),
  claimsSub = "user-1",
  profile = { email: "desk@example.com" },
  profileError = null,
  sessionError = null,
}: {
  accessToken?: string | null;
  authenticationTimestamp?: number | null;
  claimsSub?: string;
  profile?: { email: string } | null;
  profileError?: unknown;
  sessionError?: unknown;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: profile,
    error: profileError,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getSession = vi.fn().mockResolvedValue({
    data: {
      session: accessToken ? { access_token: accessToken } : null,
    },
    error: sessionError,
  });
  const getClaims = vi.fn().mockResolvedValue({
    data: {
      claims: {
        amr: authenticationTimestamp === null
          ? undefined
          : [{
              method: "password",
              timestamp: authenticationTimestamp,
            }],
        sub: claimsSub,
      },
    },
    error: null,
  });

  return {
    client: {
      auth: { getClaims, getSession },
      from,
    } as unknown as SupabaseClient,
    getClaims,
    getSession,
  };
}

describe("account deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseServiceConfig.mockReturnValue({
      serviceRoleKey: "service-secret",
      url: "https://supabase.test",
    });
  });

  it("fails closed when server-only deletion services are unavailable", async () => {
    mocks.getSupabaseAdminClient.mockReturnValue(null);

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: null,
      user: null,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_UNAVAILABLE",
      status: "error",
    });

    adminClient();
    mocks.getSupabaseServiceConfig.mockReturnValue(null);

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: null,
      user: null,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_UNAVAILABLE",
      status: "error",
    });
  });

  it("requires a recent authenticated session for a new request", async () => {
    adminClient();

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: null,
      user: null,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      status: "error",
    });

    const { client } = userClient({
      authenticationTimestamp: Math.floor(
        new Date("2026-07-27T11:49:59.000Z").getTime() / 1_000,
      ),
    });
    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: client,
      user,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      status: "error",
    });
  });

  it("does not accept another device's recent sign-in", async () => {
    adminClient();
    const wrongSubject = userClient({ claimsSub: "other-user" });

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: wrongSubject.client,
      user: {
        ...user,
        last_sign_in_at: now.toISOString(),
      },
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      status: "error",
    });
  });

  it("requires the persisted account email and a usable access token", async () => {
    adminClient();
    const mismatched = userClient({
      profile: { email: "other@example.com" },
    });

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: mismatched.client,
      user,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_INVALID_CONFIRMATION",
      status: "error",
    });

    const profileFailure = userClient({
      profile: null,
      profileError: { message: "unavailable" },
    });
    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: profileFailure.client,
      user,
    })).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_INVALID_CONFIRMATION",
    });

    const missingSession = userClient({ accessToken: null });
    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: missingSession.client,
      user,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      status: "error",
    });

    const failedSession = userClient({
      accessToken: null,
      sessionError: { message: "expired" },
    });
    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: failedSession.client,
      user,
    })).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
    });
  });

  it("creates a hashed, expiring durable authorization", async () => {
    const admin = adminClient();
    const { client } = userClient();
    const result = await authorizeAccountDeletion({
      input,
      now,
      supabase: client,
      user,
    });

    expect(result).toMatchObject({
      accessToken: "access-token",
      request: { id: "request-1" },
      status: "authorized",
      userId: "user-1",
    });
    expect(result.status === "authorized" && result.retryToken.length)
      .toBeGreaterThan(32);
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: "2026-07-28T12:00:00.000Z",
        reauthenticated_at: now.toISOString(),
        status: "authorized",
        user_id: "user-1",
      }),
    );
    const inserted = admin.insert.mock.calls[0]?.[0];
    expect(inserted.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted.user_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted.confirmation_email_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted.token_hash).not.toContain(result.status === "authorized"
      ? result.retryToken
      : "");
  });

  it("fails closed when durable request creation fails", async () => {
    adminClient({
      insertData: null,
      insertError: { message: "insert failed" },
    });
    const { client } = userClient();

    await expect(authorizeAccountDeletion({
      input,
      now,
      supabase: client,
      user,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_UNAVAILABLE",
      status: "error",
    });
  });

  it.each([
    [requestRow({ status: "completed" }), "completed"],
    [requestRow({ expires_at: now.toISOString() }), "expired"],
    [requestRow({ user_id: null }), "pseudonymous"],
  ])("rejects %s retry requests", async (retryData) => {
    adminClient({ retryData });

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: null,
      user: null,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_RETRY_EXPIRED",
      status: "error",
    });
  });

  it("requires the original confirmation email on retry", async () => {
    adminClient({ retryData: requestRow() });

    await expect(authorizeAccountDeletion({
      input: { ...input, email: "other@example.com" },
      now,
      retryCookie: "retry-token",
      supabase: null,
      user: null,
    })).resolves.toEqual({
      code: "ACCOUNT_DELETION_INVALID_CONFIRMATION",
      status: "error",
    });
  });

  it("resumes post-revocation stages without an ordinary session", async () => {
    adminClient({
      retryData: requestRow({
        sessions_revoked_at: "2026-07-27T11:59:00.000Z",
        status: "failed",
      }),
    });

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: null,
      user: null,
    })).resolves.toMatchObject({
      accessToken: null,
      retryToken: "retry-token",
      status: "authorized",
      userId: "user-1",
    });
  });

  it("reauthenticates pre-revocation retries and binds them to the owner", async () => {
    adminClient({ retryData: requestRow() });
    const { client } = userClient();

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: client,
      user: { ...user, id: "other-user" },
    })).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
    });

    const missingSession = userClient({ accessToken: null });
    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: missingSession.client,
      user,
    })).resolves.toMatchObject({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
    });

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: client,
      user,
    })).resolves.toMatchObject({
      accessToken: "access-token",
      retryToken: "retry-token",
      status: "authorized",
      userId: "user-1",
    });
  });

  it("falls back to a new authorization when an unknown retry token is supplied", async () => {
    const admin = adminClient({ retryData: null });
    const { client } = userClient();

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "unknown-token",
      supabase: client,
      user,
    })).resolves.toMatchObject({
      status: "authorized",
      userId: "user-1",
    });
    expect(admin.insert).toHaveBeenCalledOnce();
  });

  it("surfaces retry-store failures for the route boundary to contain", async () => {
    adminClient({ retryError: { message: "lookup failed" } });

    await expect(authorizeAccountDeletion({
      input,
      now,
      retryCookie: "retry-token",
      supabase: null,
      user: null,
    })).rejects.toEqual({ message: "lookup failed" });
  });
});
