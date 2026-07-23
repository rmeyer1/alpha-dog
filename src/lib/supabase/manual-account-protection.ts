import { createHmac, randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import {
  getSupabaseServiceConfig,
  requestSupabaseRest,
} from "@/lib/supabase/rest";

const MANUAL_ACCOUNT_ROUTE_KEY = "auth.manual_account";
const TURNSTILE_ACTION = "manual-account";
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const manualAccountInvitePolicy = {
  concurrencyLimit: 4,
  emailLimit: 2,
  emailWindowSeconds: 86_400,
  ipLimit: 5,
  ipWindowSeconds: 3_600,
  leaseSeconds: 20,
} as const;

interface InviteBudgetResult {
  allowed: boolean;
  lease_id?: string;
  reason?: "concurrency" | "rate";
  retry_after_seconds?: number;
}

export type ManualAccountInviteGuard =
  | {
      allowed: false;
      reason: "limited" | "unavailable";
    }
  | {
      allowed: true;
      release: () => Promise<void>;
    };

interface TurnstileValidationResponse {
  action?: string;
  success?: boolean;
}

export type ManualAccountChallengeResult =
  | { status: "verified" }
  | { status: "failed" }
  | { status: "unavailable" };

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function manualAccountRequestIp(request: Request) {
  return firstForwardedValue(request.headers.get("x-vercel-forwarded-for")) ??
    firstForwardedValue(request.headers.get("x-forwarded-for")) ??
    firstForwardedValue(request.headers.get("x-real-ip")) ??
    "unknown";
}

function hashScope(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function acquireManualAccountInviteGuard(
  request: Request,
  normalizedEmail: string,
): Promise<ManualAccountInviteGuard> {
  let config: ReturnType<typeof getSupabaseServiceConfig>;
  let hmacSecret: string | null | undefined;

  try {
    config = getSupabaseServiceConfig();
    hmacSecret = getEnv().API_ABUSE_HMAC_SECRET ?? config?.serviceRoleKey;
  } catch {
    return { allowed: false, reason: "unavailable" };
  }

  if (!config || !hmacSecret) {
    return { allowed: false, reason: "unavailable" };
  }

  const leaseId = randomUUID();
  let result: InviteBudgetResult | null;

  try {
    result = await requestSupabaseRest<InviteBudgetResult>(
      "rpc/acquire_manual_account_invite_budget",
      {
        body: {
          p_concurrency_limit: manualAccountInvitePolicy.concurrencyLimit,
          p_email_hash: hashScope(normalizedEmail, hmacSecret),
          p_email_limit: manualAccountInvitePolicy.emailLimit,
          p_email_window_seconds:
            manualAccountInvitePolicy.emailWindowSeconds,
          p_ip_hash: hashScope(manualAccountRequestIp(request), hmacSecret),
          p_ip_limit: manualAccountInvitePolicy.ipLimit,
          p_ip_window_seconds: manualAccountInvitePolicy.ipWindowSeconds,
          p_lease_id: leaseId,
          p_lease_seconds: manualAccountInvitePolicy.leaseSeconds,
        },
        method: "POST",
        timeoutMs: 3_000,
      },
    );
  } catch {
    return { allowed: false, reason: "unavailable" };
  }

  if (!result) {
    return { allowed: false, reason: "unavailable" };
  }

  if (!result.allowed) {
    return { allowed: false, reason: "limited" };
  }

  const acquiredLeaseId = result.lease_id ?? leaseId;

  return {
    allowed: true,
    async release() {
      try {
        await requestSupabaseRest("rpc/release_api_abuse_lease", {
          body: {
            p_lease_id: acquiredLeaseId,
            p_route_key: MANUAL_ACCOUNT_ROUTE_KEY,
          },
          method: "POST",
          timeoutMs: 2_000,
        });
      } catch {
        // The lease expires quickly; release failures must not expose request data.
      }
    },
  };
}

export function getManualAccountChallengeUiConfig() {
  const env = getEnv();
  const anyKeyConfigured = Boolean(
    env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || env.TURNSTILE_SECRET_KEY,
  );

  return {
    required: process.env.NODE_ENV === "production" || anyKeyConfigured,
    siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
  };
}

export async function verifyManualAccountChallenge({
  fetchImpl = fetch,
  remoteIp,
  signal,
  token,
}: {
  fetchImpl?: typeof fetch;
  remoteIp: string;
  signal?: AbortSignal;
  token: string | undefined;
}): Promise<ManualAccountChallengeResult> {
  let secretKey: string | undefined;

  try {
    secretKey = getEnv().TURNSTILE_SECRET_KEY;
  } catch {
    return { status: "unavailable" };
  }

  if (!secretKey) {
    return process.env.NODE_ENV === "production" ||
        Boolean(getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY)
      ? { status: "unavailable" }
      : { status: "verified" };
  }

  if (!token) {
    return { status: "failed" };
  }

  const timeoutSignal = AbortSignal.timeout(5_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      body: JSON.stringify({
        idempotency_key: randomUUID(),
        remoteip: remoteIp === "unknown" ? undefined : remoteIp,
        response: token,
        secret: secretKey,
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: combinedSignal,
    });

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const result = await response.json().catch(() => null) as
      | TurnstileValidationResponse
      | null;

    if (!result?.success || result.action !== TURNSTILE_ACTION) {
      return { status: "failed" };
    }

    return { status: "verified" };
  } catch {
    return { status: "unavailable" };
  }
}
