import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  API_ABUSE_HMAC_SECRET: "a".repeat(32) as string | undefined,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" as string | undefined,
  TURNSTILE_SECRET_KEY: "secret-key" as string | undefined,
}));
const getServiceConfigMock = vi.hoisted(() => vi.fn());
const requestSupabaseRestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getEnv: () => envMock,
}));

vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: getServiceConfigMock,
  requestSupabaseRest: requestSupabaseRestMock,
}));

import {
  acquireManualAccountInviteGuard,
  getManualAccountChallengeUiConfig,
  manualAccountRequestIp,
  verifyManualAccountChallenge,
} from "./manual-account-protection";

function request(headers: Record<string, string> = {}) {
  return new Request("https://alpha.example/api/auth/manual-account", {
    headers,
    method: "POST",
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  envMock.API_ABUSE_HMAC_SECRET = "a".repeat(32);
  envMock.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
  envMock.TURNSTILE_SECRET_KEY = "secret-key";
  getServiceConfigMock.mockReset();
  requestSupabaseRestMock.mockReset();
  getServiceConfigMock.mockReturnValue({
    serviceRoleKey: "service-role-key",
    url: "https://alpha.supabase.co",
  });
});

describe("manual account invitation protection", () => {
  it("uses the platform client IP without logging or storing the raw value", () => {
    expect(manualAccountRequestIp(request({
      "x-forwarded-for": "198.51.100.2, 198.51.100.3",
      "x-vercel-forwarded-for": "203.0.113.10",
    }))).toBe("203.0.113.10");
  });

  it("acquires one atomic IP and email budget and releases its lease", async () => {
    requestSupabaseRestMock
      .mockResolvedValueOnce({
        allowed: true,
        lease_id: "22222222-2222-2222-2222-222222222222",
      })
      .mockResolvedValueOnce(null);

    const guard = await acquireManualAccountInviteGuard(
      request({ "x-forwarded-for": "203.0.113.10" }),
      "desk@example.com",
    );

    expect(guard.allowed).toBe(true);
    if (guard.allowed) {
      await guard.release();
    }

    const acquisition = requestSupabaseRestMock.mock.calls[0];
    expect(acquisition[0]).toBe("rpc/acquire_manual_account_invite_budget");
    expect(acquisition[1]).toMatchObject({
      body: {
        p_concurrency_limit: 4,
        p_email_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_email_limit: 2,
        p_email_window_seconds: 86_400,
        p_ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_ip_limit: 5,
        p_ip_window_seconds: 3_600,
      },
      method: "POST",
    });
    expect(JSON.stringify(acquisition)).not.toContain("desk@example.com");
    expect(JSON.stringify(acquisition)).not.toContain("203.0.113.10");
    expect(requestSupabaseRestMock).toHaveBeenNthCalledWith(
      2,
      "rpc/release_api_abuse_lease",
      expect.objectContaining({
        body: {
          p_lease_id: "22222222-2222-2222-2222-222222222222",
          p_route_key: "auth.manual_account",
        },
      }),
    );
  });

  it("distinguishes private throttling from protection outages internally", async () => {
    requestSupabaseRestMock.mockResolvedValueOnce({
      allowed: false,
      reason: "rate",
    });

    await expect(acquireManualAccountInviteGuard(
      request(),
      "desk@example.com",
    )).resolves.toEqual({ allowed: false, reason: "limited" });

    requestSupabaseRestMock.mockRejectedValueOnce(new Error("offline"));
    await expect(acquireManualAccountInviteGuard(
      request(),
      "desk@example.com",
    )).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("verifies Turnstile tokens server-side with the expected action", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      action: "manual-account",
      success: true,
    }));

    await expect(verifyManualAccountChallenge({
      fetchImpl: fetchImpl as typeof fetch,
      remoteIp: "203.0.113.10",
      token: "turnstile-token",
    })).resolves.toEqual({ status: "verified" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        body: expect.stringContaining('"response":"turnstile-token"'),
        method: "POST",
      }),
    );
  });

  it.each([
    [{ success: false }, "failed"],
    [{ action: "other-action", success: true }, "failed"],
  ] as const)("rejects invalid challenge result %#", async (body, status) => {
    const fetchImpl = vi.fn(async () => Response.json(body));

    await expect(verifyManualAccountChallenge({
      fetchImpl: fetchImpl as typeof fetch,
      remoteIp: "unknown",
      token: "turnstile-token",
    })).resolves.toEqual({ status });
  });

  it("fails closed in production when challenge configuration is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    envMock.NEXT_PUBLIC_TURNSTILE_SITE_KEY = undefined;
    envMock.TURNSTILE_SECRET_KEY = undefined;

    expect(getManualAccountChallengeUiConfig()).toEqual({
      required: true,
      siteKey: null,
    });
    await expect(verifyManualAccountChallenge({
      remoteIp: "unknown",
      token: undefined,
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("fails visibly when only one Turnstile key is configured", async () => {
    envMock.TURNSTILE_SECRET_KEY = undefined;

    expect(getManualAccountChallengeUiConfig()).toEqual({
      required: true,
      siteKey: "site-key",
    });
    await expect(verifyManualAccountChallenge({
      remoteIp: "unknown",
      token: "turnstile-token",
    })).resolves.toEqual({ status: "unavailable" });
  });
});
