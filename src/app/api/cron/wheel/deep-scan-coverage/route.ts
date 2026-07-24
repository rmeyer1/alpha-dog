import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  getEnv,
  getMarketDataConfigurationError,
  isDemoMode,
} from "@/lib/env";
import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import { getScheduledScreenerRefreshRequests } from "@/lib/wheel/screener-refresh";
import type { UniverseDeepScanCoverageRequest } from "@/lib/wheel/universe-scanner";
import { wheelDeepScanWorkflow } from "@/workflows/wheel-deep-scan";

export const dynamic = "force-dynamic";

interface StartedDeepScan {
  completionStatus: "complete" | "pending";
  enqueueStatus: "accepted";
  persona: UniverseDeepScanCoverageRequest["persona"];
  runId: string;
  status: string;
  strategy: UniverseDeepScanCoverageRequest["strategy"];
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

function getEasternCoverageHoursState(date = new Date()) {
  const marketSession = getUsEquitiesMarketState(date);
  const windowStartMinutes = 8 * 60;
  const windowEndMinutes = marketSession.closeMinutes;

  return {
    easternMinutes: marketSession.easternMinutes,
    isOpen:
      marketSession.isMarketDay &&
      windowEndMinutes != null &&
      marketSession.easternMinutes >= windowStartMinutes &&
      marketSession.easternMinutes < windowEndMinutes,
    isWeekday: !["Sat", "Sun"].includes(marketSession.weekday),
    marketSession,
    weekday: marketSession.weekday,
  };
}

function requestForScan(
  request: ReturnType<typeof getScheduledScreenerRefreshRequests>[number],
  batchSize: number,
  forceRefresh: boolean,
): UniverseDeepScanCoverageRequest {
  return {
    batchSize,
    filters: request.filters,
    forceRefresh,
    persona: request.persona,
    strategy: request.strategy,
  };
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
      {
        error: {
          ...configurationError,
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const coverageHours = getEasternCoverageHoursState();

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

  const maxRuns = Math.min(
    env.WHEEL_UNIVERSE_BACKGROUND_MAX_RUNS,
    Number.parseInt(url.searchParams.get("maxRuns") ?? "", 10) ||
      Number.MAX_SAFE_INTEGER,
  );
  const batchSize =
    Number.parseInt(url.searchParams.get("batchSize") ?? "", 10) ||
    env.WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE;
  const configuredRequests = getScheduledScreenerRefreshRequests();
  const scanRequests = configuredRequests
    .slice(0, maxRuns)
    .map((scheduledRequest) =>
      requestForScan(scheduledRequest, batchSize, force)
    );
  const started: StartedDeepScan[] = [];

  if (!dryRun) {
    for (const scanRequest of scanRequests) {
      const run = await start(wheelDeepScanWorkflow, [{
        ...scanRequest,
        workflowIdempotencyKey: randomUUID(),
      }]);
      const workflowStatus = await run.status;

      started.push({
        completionStatus:
          workflowStatus === "completed" ? "complete" : "pending",
        enqueueStatus: "accepted",
        persona: scanRequest.persona,
        strategy: scanRequest.strategy,
        runId: run.runId,
        status: workflowStatus,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    enqueueSucceeded: true,
    publicationCompleted:
      started.length > 0 &&
      started.every((run) => run.completionStatus === "complete"),
    dryRun,
    force,
    coverageHours,
    batchSize,
    maxRuns,
    configuredCount: configuredRequests.length,
    started,
    planned: dryRun ? scanRequests : [],
  });
}

export async function GET(request: Request) {
  return handleDeepScanCoverage(request);
}

export async function POST(request: Request) {
  return handleDeepScanCoverage(request);
}
