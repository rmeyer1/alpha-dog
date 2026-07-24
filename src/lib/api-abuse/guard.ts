import { createHmac, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { emitTelemetry } from "@/lib/observability/telemetry";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";
import { requestSupabaseRest, getSupabaseServiceConfig } from "@/lib/supabase/rest";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { paidRoutePolicies, type PaidRoutePolicyKey } from "./policies";

interface AbuseBudgetResult {
  allowed: boolean;
  lease_id?: string | null;
  reason?: "concurrency" | "rate";
  retry_after_seconds?: number;
}

export interface AcquiredPaidRouteGuard {
  allowed: true;
  release: () => Promise<void>;
  signal: AbortSignal;
  userId: string | null;
  withAuthCookies: (response: NextResponse) => NextResponse;
}

export interface RejectedPaidRouteGuard {
  allowed: false;
  response: NextResponse;
}

export type PaidRouteGuard = AcquiredPaidRouteGuard | RejectedPaidRouteGuard;

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  return request.headers.get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim() || forwarded || request.headers.get("x-real-ip") || "unknown";
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "ABUSE_PROTECTION_UNAVAILABLE",
        message: "This operation is temporarily unavailable.",
        retryable: true,
      },
    },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

function rejectedResponse(result: AbuseBudgetResult) {
  const retryAfter = Math.max(1, Math.ceil(result.retry_after_seconds ?? 1));
  const concurrencyLimited = result.reason === "concurrency";

  return NextResponse.json(
    {
      error: {
        code: concurrencyLimited
          ? "API_CONCURRENCY_LIMITED"
          : "API_RATE_LIMITED",
        message: concurrencyLimited
          ? "Too many operations are already running."
          : "This route's request quota has been reached.",
        retryAfterSeconds: retryAfter,
        retryable: true,
      },
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

async function optionalUserId(
  request: NextRequest,
  authResponse: NextResponse,
) {
  const supabase = createSupabaseRouteClient(request, authResponse);

  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase.auth.getUser();

    return error ? null : data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function acquirePaidRouteGuard(
  request: Request,
  policyKey: PaidRoutePolicyKey,
): Promise<PaidRouteGuard> {
  const policy = paidRoutePolicies[policyKey];

  if (policy.access === "internal-only" && process.env.NODE_ENV === "production") {
    emitTelemetry({
      errorCode: "NOT_FOUND",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: "access_denied",
      severity: "warn",
    });
    return {
      allowed: false,
      response: NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Not found." } },
        { status: 404 },
      ),
    };
  }

  const nextRequest = request instanceof NextRequest
    ? request
    : new NextRequest(request.url, { headers: request.headers });
  const authResponse = NextResponse.next();
  let userId: string | null = null;

  try {
    if (policy.access === "authenticated-only" || policy.access === "internal-only") {
      const auth = await getRequiredAccountSession(nextRequest, authResponse);

      if ("code" in auth) {
        emitTelemetry({
          errorCode: auth.code,
          event: "paid_route.guard",
          operation: policy.routeKey,
          outcome: "authentication_denied",
          severity: "warn",
        });
        return {
          allowed: false,
          response: copyAuthCookies(
            authResponse,
            accountSessionErrorResponse(auth.code, "this protected operation"),
          ),
        };
      }

      userId = auth.user.id;
    } else {
      userId = await optionalUserId(nextRequest, authResponse);
    }
  } catch (error) {
    console.warn("api_abuse_auth_unavailable", {
      error: error instanceof Error ? error.name : "UnknownError",
      route: policy.routeKey,
    });
    emitTelemetry({
      error,
      errorCode: "AUTH_UNAVAILABLE",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: "unavailable",
      severity: "warn",
    });

    return {
      allowed: false,
      response: copyAuthCookies(authResponse, unavailableResponse()),
    };
  }

  let serviceConfig: ReturnType<typeof getSupabaseServiceConfig>;
  let hmacSecret: string | null | undefined;

  try {
    serviceConfig = getSupabaseServiceConfig();
    hmacSecret = getEnv().API_ABUSE_HMAC_SECRET ?? serviceConfig?.serviceRoleKey;
  } catch {
    serviceConfig = null;
    hmacSecret = null;
  }

  if (!serviceConfig || !hmacSecret) {
    emitTelemetry({
      errorCode: "ABUSE_PROTECTION_UNAVAILABLE",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: "unavailable",
      severity: "warn",
    });
    return {
      allowed: false,
      response: copyAuthCookies(authResponse, unavailableResponse()),
    };
  }

  const ipHash = createHmac("sha256", hmacSecret)
    .update(requestIp(request))
    .digest("hex");
  const requestedLeaseId = randomUUID();
  let result: AbuseBudgetResult | null;

  try {
    result = await requestSupabaseRest<AbuseBudgetResult>(
      "rpc/acquire_api_abuse_budget",
      {
        body: {
          p_concurrency_limit: policy.concurrencyLimit,
          p_ip_hash: ipHash,
          p_ip_limit: policy.ipLimit,
          p_lease_id: requestedLeaseId,
          p_lease_seconds: policy.leaseSeconds,
          p_route_key: policy.routeKey,
          p_user_id: userId,
          p_user_limit: policy.userLimit,
          p_window_seconds: policy.windowSeconds,
        },
        method: "POST",
        timeoutMs: 3_000,
      },
    );
  } catch (error) {
    console.warn("api_abuse_guard_unavailable", {
      error: error instanceof Error ? error.name : "UnknownError",
      route: policy.routeKey,
    });
    emitTelemetry({
      error,
      errorCode: "ABUSE_PROTECTION_UNAVAILABLE",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: "unavailable",
      severity: "warn",
    });

    return {
      allowed: false,
      response: copyAuthCookies(authResponse, unavailableResponse()),
    };
  }

  if (!result) {
    emitTelemetry({
      errorCode: "ABUSE_PROTECTION_UNAVAILABLE",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: "unavailable",
      severity: "warn",
    });
    return {
      allowed: false,
      response: copyAuthCookies(authResponse, unavailableResponse()),
    };
  }

  if (!result.allowed) {
    emitTelemetry({
      errorCode: result.reason === "concurrency"
        ? "API_CONCURRENCY_LIMITED"
        : "API_RATE_LIMITED",
      event: "paid_route.guard",
      operation: policy.routeKey,
      outcome: result.reason === "concurrency"
        ? "concurrency_limited"
        : "rate_limited",
      severity: "warn",
    });
    return {
      allowed: false,
      response: copyAuthCookies(authResponse, rejectedResponse(result)),
    };
  }

  const leaseId = result.lease_id ?? requestedLeaseId;

  emitTelemetry({
    event: "paid_route.guard",
    operation: policy.routeKey,
    outcome: "allowed",
  });

  return {
    allowed: true,
    signal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(policy.providerTimeoutMs),
    ]),
    userId,
    withAuthCookies(response) {
      return copyAuthCookies(authResponse, response);
    },
    async release() {
      try {
        await requestSupabaseRest("rpc/release_api_abuse_lease", {
          body: {
            p_lease_id: leaseId,
            p_route_key: policy.routeKey,
          },
          method: "POST",
          timeoutMs: 2_000,
        });
      } catch (error) {
        console.warn("api_abuse_lease_release_failed", {
          error: error instanceof Error ? error.name : "UnknownError",
          route: policy.routeKey,
        });
        emitTelemetry({
          error,
          errorCode: "LEASE_RELEASE_FAILED",
          event: "paid_route.guard",
          operation: policy.routeKey,
          outcome: "release_failed",
          severity: "warn",
        });
      }
    },
  };
}
