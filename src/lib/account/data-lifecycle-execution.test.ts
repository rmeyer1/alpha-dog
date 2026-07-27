import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient,
}));

import { executeAccountDeletion } from "./data-lifecycle";

function request(
  overrides: Partial<{
    application_data_deleted_at: string | null;
    attempt_count: number;
    auth_user_deleted_at: string | null;
    sessions_revoked_at: string | null;
  }> = {},
) {
  return {
    application_data_deleted_at: null,
    attempt_count: 0,
    auth_user_deleted_at: null,
    confirmation_email_hash: "email-hash",
    expires_at: "2026-07-28T12:00:00.000Z",
    id: "request-1",
    result: null,
    sessions_revoked_at: null,
    status: "authorized" as const,
    token_hash: "token-hash",
    user_id: "user-1",
    ...overrides,
  };
}

function authorization(
  requestOverrides: Parameters<typeof request>[0] = {},
) {
  return {
    accessToken: "access-token",
    request: request(requestOverrides),
    retryToken: "retry-token",
    status: "authorized" as const,
    userId: "user-1",
  };
}

function adminClient({
  authDeleteError = null,
  rpcError = null,
  signOutError = null,
}: {
  authDeleteError?: unknown;
  rpcError?: unknown;
  signOutError?: unknown;
} = {}) {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn().mockResolvedValue({
    data: {
      identitiesDeleted: 1,
      profilesDeleted: 1,
    },
    error: rpcError,
  });
  const signOut = vi.fn().mockResolvedValue({ error: signOutError });
  const deleteUser = vi.fn().mockResolvedValue({ error: authDeleteError });
  const admin = {
    auth: {
      admin: {
        deleteUser,
        signOut,
      },
    },
    from,
    rpc,
  };

  getSupabaseAdminClient.mockReturnValue(admin);

  return {
    deleteUser,
    eq,
    rpc,
    signOut,
    update,
  };
}

describe("retry-safe account deletion execution", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists each destructive stage before advancing", async () => {
    const admin = adminClient();

    await expect(executeAccountDeletion(authorization(), now)).resolves
      .toEqual({
        requestId: "request-1",
        status: "deleted",
      });

    expect(admin.signOut).toHaveBeenCalledWith("access-token", "global");
    expect(admin.rpc).toHaveBeenCalledWith(
      "delete_account_application_data",
      { p_user_id: "user-1" },
    );
    expect(admin.deleteUser).toHaveBeenCalledWith("user-1", false);
    expect(admin.update.mock.calls.map(([values]) => values))
      .toEqual([
        {
          attempt_count: 1,
          last_error_code: null,
        },
        {
          sessions_revoked_at: now.toISOString(),
          status: "sessions_revoked",
        },
        {
          application_data_deleted_at: now.toISOString(),
          result: {
            identitiesDeleted: 1,
            profilesDeleted: 1,
          },
          status: "application_data_deleted",
        },
        {
          auth_user_deleted_at: now.toISOString(),
          status: "auth_user_deleted",
        },
        {
          completed_at: now.toISOString(),
          last_error_code: null,
          result: {
            identitiesDeleted: 1,
            profilesDeleted: 1,
          },
          status: "completed",
          token_hash: null,
          user_id: null,
        },
      ]);
  });

  it("resumes after completed stages without repeating them", async () => {
    const admin = adminClient({
      authDeleteError: {
        code: "user_not_found",
        status: 404,
      },
    });
    const resumed = authorization({
      application_data_deleted_at: "2026-07-27T11:58:00.000Z",
      attempt_count: 2,
      sessions_revoked_at: "2026-07-27T11:57:00.000Z",
    });
    resumed.accessToken = null;
    resumed.request.result = {
      identitiesDeleted: 1,
      profilesDeleted: 1,
    };

    await expect(executeAccountDeletion(resumed, now)).resolves
      .toMatchObject({ status: "deleted" });

    expect(admin.signOut).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.deleteUser).toHaveBeenCalledOnce();
    expect(admin.update.mock.calls[0]?.[0]).toEqual({
      attempt_count: 3,
      last_error_code: null,
    });
    expect(admin.update.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      token_hash: null,
      user_id: null,
    });
  });

  it("records a bounded failure code and leaves the request retryable", async () => {
    const admin = adminClient({
      signOutError: { status: 500 },
    });

    await expect(executeAccountDeletion(authorization(), now))
      .rejects.toThrow("ACCOUNT_DELETION_SESSION_REVOCATION_FAILED");

    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
    expect(admin.update.mock.calls.at(-1)?.[0]).toEqual({
      last_error_code: "ACCOUNT_DELETION_SESSION_REVOCATION_FAILED",
      status: "failed",
    });
  });

  it("treats a specific missing-session code as an idempotent retry", async () => {
    const admin = adminClient({
      signOutError: {
        code: "session_not_found",
        status: 403,
      },
    });

    await expect(executeAccountDeletion(authorization(), now)).resolves
      .toMatchObject({ status: "deleted" });

    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(admin.deleteUser).toHaveBeenCalledOnce();
  });

  it("does not treat an authorization failure as an already-revoked session", async () => {
    const admin = adminClient({
      signOutError: {
        code: "not_admin",
        status: 403,
      },
    });

    await expect(executeAccountDeletion(authorization(), now))
      .rejects.toThrow("ACCOUNT_DELETION_SESSION_REVOCATION_FAILED");

    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("does not treat an invalid Auth deletion as an already-missing user", async () => {
    const admin = adminClient({
      authDeleteError: {
        code: "validation_failed",
        status: 422,
      },
    });

    await expect(executeAccountDeletion(authorization(), now))
      .rejects.toThrow("ACCOUNT_DELETION_AUTH_USER_FAILED");

    expect(admin.deleteUser).toHaveBeenCalledOnce();
    expect(admin.update.mock.calls.at(-1)?.[0]).toEqual({
      last_error_code: "ACCOUNT_DELETION_AUTH_USER_FAILED",
      status: "failed",
    });
  });
});
