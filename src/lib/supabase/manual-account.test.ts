import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_AUTH_NOT_CONFIGURED,
  ACCOUNT_INVITE_FAILED,
  ACCOUNT_PROFILE_CREATE_FAILED,
  createManualAccount,
  manualAccountInputSchema,
  type ManualAccountSupabaseClient,
} from "./manual-account";
import { EMAIL_ALREADY_REGISTERED } from "./oauth";

function supabaseMock({
  existingProfile = null,
  inviteError = null,
  profileError = null,
}: {
  existingProfile?: { id: string } | null;
  inviteError?: { message?: string } | null;
  profileError?: { code?: string } | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: existingProfile,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: profileError }));
  const from = vi.fn(() => ({ insert, select }));
  const inviteUserByEmail = vi.fn(async () => ({
    data: { user: inviteError ? null : { id: "auth-user-id" } },
    error: inviteError,
  }));
  const deleteUser = vi.fn(async () => ({ error: null }));

  return {
    client: {
      auth: { admin: { deleteUser, inviteUserByEmail } },
      from,
    } as unknown as ManualAccountSupabaseClient,
    deleteUser,
    insert,
    inviteUserByEmail,
  };
}

describe("manual account creation", () => {
  it("validates and normalizes manual account input", () => {
    const parsed = manualAccountInputSchema.parse({
      email: " Desk@Example.COM ",
      firstName: " Ryan ",
      lastName: " Meyer ",
    });

    expect(parsed).toEqual({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    });
  });

  it("returns validation errors for missing required fields and invalid email", () => {
    const parsed = manualAccountInputSchema.safeParse({
      email: "not-an-email",
      firstName: "",
      lastName: "",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.email).toBeDefined();
    expect(parsed.error?.flatten().fieldErrors.firstName).toBeDefined();
    expect(parsed.error?.flatten().fieldErrors.lastName).toBeDefined();
  });

  it("creates an invite user and exactly one account profile", async () => {
    const { client, insert, inviteUserByEmail } = supabaseMock();

    const result = await createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, client);

    expect(result).toEqual({
      account: {
        email: "desk@example.com",
        firstName: "Ryan",
        id: "auth-user-id",
        lastName: "Meyer",
      },
      status: "invite_sent",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      "desk@example.com",
      {
        data: {
          first_name: "Ryan",
          last_name: "Meyer",
        },
      },
    );
    expect(insert).toHaveBeenCalledWith({
      email: "desk@example.com",
      first_name: "Ryan",
      id: "auth-user-id",
      last_name: "Meyer",
      primary_provider: "email",
    });
  });

  it("blocks duplicate emails before creating an auth user", async () => {
    const { client, inviteUserByEmail } = supabaseMock({
      existingProfile: { id: "existing-user" },
    });

    const result = await createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, client);

    expect(result).toEqual({
      code: EMAIL_ALREADY_REGISTERED,
      email: "desk@example.com",
      status: "email_conflict",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("maps auth duplicate responses to reusable email conflict errors", async () => {
    const { client } = supabaseMock({
      inviteError: { message: "User already registered" },
    });

    const result = await createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, client);

    expect(result).toEqual({
      code: EMAIL_ALREADY_REGISTERED,
      email: "desk@example.com",
      status: "email_conflict",
    });
  });

  it("cleans up the auth user when profile creation fails", async () => {
    const { client, deleteUser } = supabaseMock({
      profileError: { code: "OTHER" },
    });

    const result = await createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, client);

    expect(result).toEqual({
      code: ACCOUNT_PROFILE_CREATE_FAILED,
      status: "error",
    });
    expect(deleteUser).toHaveBeenCalledWith("auth-user-id");
  });

  it("returns safe setup and invite errors", async () => {
    await expect(createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, null)).resolves.toEqual({
      code: ACCOUNT_AUTH_NOT_CONFIGURED,
      status: "error",
    });

    const { client } = supabaseMock({
      inviteError: { message: "Provider unavailable" },
    });

    await expect(createManualAccount({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    }, client)).resolves.toEqual({
      code: ACCOUNT_INVITE_FAILED,
      status: "error",
    });
  });
});
