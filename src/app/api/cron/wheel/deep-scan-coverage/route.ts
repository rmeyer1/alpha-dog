import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  getEnv,
  getMarketDataConfigurationError,
  isDemoMode,
} from "@/lib/env";
import {
  deepScanCoverageIntervalStartedAt,
  deepScanCoverageWindowState,
  requestsForDeepScanClaims,
} from "@/lib/wheel/deep-scan-work/domain";
import {
  claimDeepScanWork,
  getDeepScanWorkMetrics,
  peekDeepScanWork,
  syncDeepScanWorkQueue,
} from "@/lib/wheel/deep-scan-work/repository";
import type { DeepScanWorkClaim } from "@/lib/wheel/deep-scan-work/model";
import { instrumentApiRoute } from "@/lib/observability/route";
import { observeCronOperation } from "@/lib/observability/cron";
import { startObservedWorkflow } from "@/lib/observability/workflow";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import { getScheduledScreenerRefreshRequests } from
  "@/lib/wheel/screener-refresh";
import { wheelTieredDeepScanWorkflow } from
  "@/workflows/wheel-tiered-deep-scan";

export const dynamic = "force-dynamic";

interface StartedDeepScan {
  claimedCount: number;
  completionStatus: "complete" | "pending";
  consumerCount: number;
  enqueueStatus: "accepted";
  optionTypes: Array<DeepScanWorkClaim["optionType"]>;
  runId: string;
  status: string;
}

function unauthorized() {
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED_CRON_REQUEST",
        message: "Cron authorization failed.",
      },
    },
    { status: 401 },
  );
}

function verifyCronRequest(request: Request) {
  const expectedSecret = getEnv().CRON_SECRET;

  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error: {
            code: "CRON_SECRET_NOT_CONFIGURED",
            message: "CRON_SECRET must be configured for scheduled scans.",
          },
        },
        { status: 503 },
      );
    }

    return null;
  }

  return request.headers.get("authorization") === `Bearer ${expectedSecret}`
    ? null
    : unauthorized();
}

function boundedPositiveInteger(
  value: string | null,
  fallback: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Math.min(
    maximum,
    Number.isInteger(parsed) && parsed > 0 ? parsed : fallback,
  );
}

async function handleDeepScanCoverage(request: Request) {
  const authError = verifyCronRequest(request);

  if (authError) {
    return authError;
  }

  const env = getEnv();

  if (!getSupabaseServiceConfig()) {
    return NextResponse.json(
      {
        error: {
          code: "SUPABASE_SERVICE_ROLE_NOT_CONFIGURED",
          message:
            "Supabase service-role configuration is required for background deep scans.",
        },
      },
      { status: 503 },
    );
  }

  const configurationError = getMarketDataConfigurationError({}, env);

  if (!isDemoMode(env) && configurationError) {
    return NextResponse.json(
      { error: { ...configurationError } },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const coverageHours = deepScanCoverageWindowState();

  if (!coverageHours.isOpen && !dryRun && !force) {
    return NextResponse.json({
      ok: true,
      skippedCoverageHours: true,
      coverageHours,
      message:
        "Deep scan coverage skipped outside the current US equities session.",
      started: [],
    });
  }

  const claimLimit = boundedPositiveInteger(
    url.searchParams.get("batchSize"),
    env.WHEEL_DEEP_SCAN_CLAIM_LIMIT,
    1000,
  );
  const leaseSeconds = boundedPositiveInteger(
    url.searchParams.get("leaseSeconds"),
    env.WHEEL_DEEP_SCAN_CLAIM_LEASE_SECONDS,
    7200,
  );
  const configuredRequests = getScheduledScreenerRefreshRequests();
  const sync = await syncDeepScanWorkQueue();
  const ownerId = randomUUID();
  const preview = dryRun
    ? await peekDeepScanWork({ force, limit: claimLimit })
    : [];
  const claims: DeepScanWorkClaim[] = dryRun
    ? []
    : await claimDeepScanWork({
        force,
        leaseSeconds,
        limit: claimLimit,
        ownerId,
      });
  const plannedWork = dryRun ? preview : claims;
  const scanRequests = requestsForDeepScanClaims(
    configuredRequests,
    plannedWork,
  );
  const started: StartedDeepScan[] = [];

  if (!dryRun && claims.length > 0) {
    if (scanRequests.length === 0) {
      throw new Error(
        "No configured screener consumer matches the claimed option types.",
      );
    }

    const intervalStartedAt = deepScanCoverageIntervalStartedAt();
    const run = await startObservedWorkflow(
      "wheel_deep_scan",
      {
        batchKey:
          `wheel-tiered-deep-scan:${intervalStartedAt}:${ownerId}`,
        claims,
        intervalStartedAt,
        leaseSeconds,
        ownerId,
        requests: scanRequests,
      },
      (args) => start(wheelTieredDeepScanWorkflow, args),
    );
    const workflowStatus = await run.status;

    started.push({
      claimedCount: claims.length,
      completionStatus:
        workflowStatus === "completed" ? "complete" : "pending",
      consumerCount: scanRequests.length,
      enqueueStatus: "accepted",
      optionTypes: Array.from(
        new Set(claims.map((claim) => claim.optionType)),
      ).sort(),
      runId: run.runId,
      status: workflowStatus,
    });
  }

  const metrics = await getDeepScanWorkMetrics();

  return NextResponse.json({
    ok: true,
    enqueueSucceeded: true,
    publicationCompleted:
      started.length > 0 &&
      started.every((run) => run.completionStatus === "complete"),
    dryRun,
    force,
    coverageHours,
    batchSize: claimLimit,
    leaseSeconds,
    maxRuns: 1,
    configuredCount: configuredRequests.length,
    claimedCount: plannedWork.length,
    sharedMarketData: true,
    sync,
    metrics,
    started,
    planned: dryRun
      ? {
          consumers: scanRequests,
          work: plannedWork,
        }
      : null,
  });
}

async function GETHandler(request: Request) {
  return observeCronOperation(
    "wheel_deep_scan_coverage",
    () => handleDeepScanCoverage(request),
  );
}

async function POSTHandler(request: Request) {
  return observeCronOperation(
    "wheel_deep_scan_coverage",
    () => handleDeepScanCoverage(request),
  );
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/cron/wheel/deep-scan-coverage" },
  GETHandler,
);

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/cron/wheel/deep-scan-coverage" },
  POSTHandler,
);
