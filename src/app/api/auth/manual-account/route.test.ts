import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireGuardMock = vi.hoisted(() => vi.fn());
const createManualAccountMock = vi.hoisted(() => vi.fn());
const getAdminClientMock = vi.hoisted(() => vi.fn());
const inviteRedirectMock = vi.hoisted(() => vi.fn());
const logFailureMock = vi.hoisted(() => vi.fn());
const releaseMock = vi.hoisted(() => vi.fn());
const verifyChallengeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/manual-account", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/supabase/manual-account")
  >();

  return {
    ...original,
    createManualAccount: createManualAccountMock,
    manualAccountInviteRedirectUrl: inviteRedirectMock,
  };
});

vi.mock("@/lib/supabase/manual-account-protection", () => ({
  acquireManualAccountInviteGuard: acquireGuardMock,
  manualAccountRequestIp: () => "203.0.113.10",
  verifyManualAccountChallenge: verifyChallengeMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: getAdminClientMock,
}));

vi.mock("@/lib/supabase/auth-observability", () => ({
  authCorrelationIdFromRequest: () => "correlation-1",
  logAuthAccountFailure: logFailureMock,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://alpha.example/api/auth/manual-account", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    method: "POST",
  });
}

const validBody = {
  captchaToken: "turnstile-token",
  email: "desk@example.com",
  firstName: "Ryan",
  lastName: "Meyer",
  nextPath: "/screeners",
};

beforeEach(() => {
  acquireGuardMock.mockReset();
  createManualAccountMock.mockReset();
  getAdminClientMock.mockReset();
  inviteRedirectMock.mockReset();
  logFailureMock.mockReset();
  releaseMock.mockReset();
  verifyChallengeMock.mockReset();

  acquireGuardMock.mockResolvedValue({
    allowed: true,
    release: releaseMock,
  });
  getAdminClientMock.mockReturnValue({ admin: true });
  inviteRedirectMock.mockReturnValue(
    "https://alpha.example/account?profile=complete&next=%2Fscreeners",
  );
  verifyChallengeMock.mockResolvedValue({ status: "verified" });
  createManualAccountMock.mockResolvedValue({
    account: {
      email: "desk@example.com",
      firstName: "Ryan",
      id: "auth-user-id",
      lastName: "Meyer",
    },
    status: "invite_sent",
  });
});

describe("POST /api/auth/manual-account", () => {
  it("returns validation details before protected work", async () => {
    const response = await POST(request({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_MANUAL_ACCOUNT" },
    });
    expect(acquireGuardMock).not.toHaveBeenCalled();
  });

  it("derives the redirect and returns only a generic accepted response", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      correlationId: "correlation-1",
      message: "If this email is eligible, an invitation will arrive shortly.",
      status: "accepted",
    });
    expect(inviteRedirectMock).toHaveBeenCalledWith(
      "https://alpha.example/api/auth/manual-account",
      "/screeners",
    );
    expect(createManualAccountMock).toHaveBeenCalledWith(
      {
        email: "desk@example.com",
        firstName: "Ryan",
        lastName: "Meyer",
        redirectTo:
          "https://alpha.example/account?profile=complete&next=%2Fscreeners",
      },
      { admin: true },
    );
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("makes new, existing, and throttled addresses indistinguishable", async () => {
    const newResponse = await POST(request(validBody));
    const newPayload = await newResponse.json();

    createManualAccountMock.mockResolvedValueOnce({
      code: "EMAIL_ALREADY_REGISTERED",
      email: "desk@example.com",
      status: "email_conflict",
    });
    const existingResponse = await POST(request(validBody));
    const existingPayload = await existingResponse.json();

    acquireGuardMock.mockResolvedValueOnce({
      allowed: false,
      reason: "limited",
    });
    const limitedResponse = await POST(request(validBody));
    const limitedPayload = await limitedResponse.json();

    expect(existingResponse.status).toBe(newResponse.status);
    expect(limitedResponse.status).toBe(newResponse.status);
    expect(existingPayload).toEqual(newPayload);
    expect(limitedPayload).toEqual(newPayload);
  });

  it("does not accept caller-controlled absolute destinations", async () => {
    await POST(request({
      ...validBody,
      nextPath: "https://evil.example/steal",
    }));

    expect(inviteRedirectMock).toHaveBeenCalledWith(
      "https://alpha.example/api/auth/manual-account",
      "/account",
    );
  });

  it("rejects failed bot challenges and releases the invite lease", async () => {
    verifyChallengeMock.mockResolvedValue({ status: "failed" });

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "BOT_CHALLENGE_FAILED" },
    });
    expect(createManualAccountMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["redirect", 503],
    ["guard", 503],
    ["challenge", 503],
  ] as const)("fails closed when %s protection is unavailable", async (part, status) => {
    if (part === "redirect") {
      inviteRedirectMock.mockReturnValue(null);
    } else if (part === "guard") {
      acquireGuardMock.mockResolvedValue({
        allowed: false,
        reason: "unavailable",
      });
    } else {
      verifyChallengeMock.mockResolvedValue({ status: "unavailable" });
    }

    const response = await POST(request(validBody));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      error: { code: "MANUAL_ACCOUNT_UNAVAILABLE" },
    });
  });

  it("keeps genuine provider failures generic and correlated", async () => {
    createManualAccountMock.mockResolvedValue({
      code: "ACCOUNT_INVITE_FAILED",
      status: "error",
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "ACCOUNT_INVITE_FAILED",
        correlationId: "correlation-1",
        message: "Manual account creation failed.",
      },
    });
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
