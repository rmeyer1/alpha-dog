import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_AUTH_NOT_CONFIGURED,
  ACCOUNT_INVITE_FAILED,
  createManualAccount,
  manualAccountInputSchema,
  manualAccountInviteRedirectUrl,
  type ManualAccountSupabaseClient,
} from "./manual-account";
import { EMAIL_ALREADY_REGISTERED } from "./oauth";

function supabaseMock({
  existingProfile = null,
  inviteError = null,
}: {
  existingProfile?: { id: string } | null;
  inviteError?: { code?: string; message?: string } | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({
    data: existingProfile,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const inviteUserByEmail = vi.fn(async () => ({
    data: { user: inviteError ? null : { id: "auth-user-id" } },
    error: inviteError,
  }));

  return {
    client: {
      auth: { admin: { inviteUserByEmail } },
      from,
    } as unknown as ManualAccountSupabaseClient,
    from,
    inviteUserByEmail,
  };
}

const createInput = {
  email: "desk@example.com",
  firstName: "Ryan",
  lastName: "Meyer",
  redirectTo: "https://alpha.example/account?profile=complete",
};

describe("manual account creation", () => {
  it("validates, normalizes, and confines manual account input", () => {
    const parsed = manualAccountInputSchema.parse({
      captchaToken: " turnstile-token ",
      email: " Desk@Example.COM ",
      firstName: " Ryan ",
      lastName: " Meyer ",
      nextPath: "https://evil.example/steal",
    });

    expect(parsed).toEqual({
      captchaToken: "turnstile-token",
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
      nextPath: "/account",
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

  it("derives invite redirects from configured deployment origins", () => {
    expect(manualAccountInviteRedirectUrl(
      "https://attacker.example/api/auth/manual-account",
      "/screeners",
      {
        appUrl: "https://alpha.example",
        nodeEnv: "production",
      },
    )).toBe(
      "https://alpha.example/account?profile=complete&next=%2Fscreeners",
    );

    expect(manualAccountInviteRedirectUrl(
      "https://attacker.example/api/auth/manual-account",
      "https://evil.example/steal",
      {
        nodeEnv: "production",
        vercelProjectProductionUrl: "alpha-dog.vercel.app",
      },
    )).toBe(
      "https://alpha-dog.vercel.app/account?profile=complete&next=%2Faccount",
    );
  });

  it("fails closed without a trusted production origin", () => {
    expect(manualAccountInviteRedirectUrl(
      "https://attacker.example/api/auth/manual-account",
      "/screeners",
      { nodeEnv: "production" },
    )).toBeNull();
  });

  it("creates an invited auth user whose profile is created by the database trigger", async () => {
    const { client, from, inviteUserByEmail } = supabaseMock();

    const result = await createManualAccount(createInput, client);

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
          manual_account_invite: true,
        },
        redirectTo: createInput.redirectTo,
      },
    );
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate profiles before sending another invite", async () => {
    const { client, inviteUserByEmail } = supabaseMock({
      existingProfile: { id: "existing-user" },
    });

    const result = await createManualAccount(createInput, client);

    expect(result).toEqual({
      code: EMAIL_ALREADY_REGISTERED,
      email: "desk@example.com",
      status: "email_conflict",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("maps auth duplicate responses to internal email-conflict outcomes", async () => {
    const { client } = supabaseMock({
      inviteError: { code: "email_exists" },
    });

    await expect(createManualAccount(createInput, client)).resolves.toEqual({
      code: EMAIL_ALREADY_REGISTERED,
      email: "desk@example.com",
      status: "email_conflict",
    });
  });

  it("returns safe setup and invite errors", async () => {
    await expect(createManualAccount(createInput, null)).resolves.toEqual({
      code: ACCOUNT_AUTH_NOT_CONFIGURED,
      status: "error",
    });

    const { client } = supabaseMock({
      inviteError: { message: "Provider unavailable" },
    });

    await expect(createManualAccount(createInput, client)).resolves.toEqual({
      code: ACCOUNT_INVITE_FAILED,
      status: "error",
    });
  });
});
