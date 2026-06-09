import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import { getScheduledScreenerRefreshRequests } from "@/lib/wheel/screener-refresh";
import type { UniverseDeepScanCoverageRequest } from "@/lib/wheel/universe-scanner";
import { wheelDeepScanWorkflow } from "@/workflows/wheel-deep-scan";

export const dynamic = "force-dynamic";

const easternTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface StartedDeepScan {
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
  const parts = Object.fromEntries(
    easternTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = parts.weekday ?? "";
  const easternMinutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const windowStartMinutes = 8 * 60;
  const windowEndMinutes = 20 * 60;

  return {
    easternMinutes,
    isOpen:
      isWeekday &&
      easternMinutes >= windowStartMinutes &&
      easternMinutes < windowEndMinutes,
    isWeekday,
    weekday,
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

  if (!env.USE_DEMO_DATA && !hasAlpacaCredentials()) {
    return NextResponse.json(
      {
        error: {
          code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
          message:
            "Alpaca credentials are required for background deep scans.",
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
      message: "Deep scan coverage skipped outside 8 a.m.-8 p.m. New York time.",
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
      const run = await start(wheelDeepScanWorkflow, [scanRequest]);

      started.push({
        persona: scanRequest.persona,
        strategy: scanRequest.strategy,
        runId: run.runId,
        status: await run.status,
      });
    }
  }

  return NextResponse.json({
    ok: true,
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
