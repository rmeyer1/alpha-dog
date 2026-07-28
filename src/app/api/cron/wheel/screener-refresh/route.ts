import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  getEnv,
  getMarketDataConfigurationError,
  isDemoMode,
} from "@/lib/env";
import { observeCronOperation } from "@/lib/observability/cron";
import { startObservedWorkflow } from "@/lib/observability/workflow";
import { scheduleAlertSample } from "@/lib/observability/alert-control-plane";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  getEasternMarketHoursState,
  getScheduledScreenerRefreshRequests,
  getScreenerRefreshDecision,
  getScreenerRefreshMaxRuns,
  getScreenerWeekendRefreshMaxRuns,
  summarizeScreenerRefreshDecisions,
  type ScreenerRefreshDecision,
} from "@/lib/wheel/screener-refresh";
import type { WheelScreenerRequest } from "@/lib/wheel/types";
import { wheelMarketBatchWorkflow } from "@/workflows/wheel-market-batch";

export const dynamic = "force-dynamic";

interface StartedRefresh {
  completionStatus: "complete" | "pending";
  enqueueStatus: "accepted";
  persona: WheelScreenerRequest["persona"];
  runId: string;
  status: string;
  strategy: WheelScreenerRequest["strategy"];
}

function refreshPriority(decision: ScreenerRefreshDecision) {
  if (decision.status !== "due") {
    return -1;
  }

  return decision.ageMs ?? Number.MAX_SAFE_INTEGER;
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
  const env = getEnv();
  const expectedSecret = env.CRON_SECRET;

  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error: {
            code: "CRON_SECRET_NOT_CONFIGURED",
            message: "CRON_SECRET must be configured for scheduled refreshes.",
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

async function handleRefresh(request: Request) {
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
            "Supabase service-role configuration is required for scheduled refresh.",
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
  const marketHours = getEasternMarketHoursState();

  if (!marketHours.isOpen && !marketHours.isWeekendPrewarm && !dryRun && !force) {
    return NextResponse.json({
      ok: true,
      skippedMarketHours: true,
      marketHours,
      message: "Screener refresh skipped outside US market hours.",
      started: [],
      skipped: [],
    });
  }

  const defaultMaxRuns = marketHours.isWeekendPrewarm
    ? getScreenerWeekendRefreshMaxRuns()
    : getScreenerRefreshMaxRuns();
  const maxRuns = Math.min(
    defaultMaxRuns,
    Number.parseInt(url.searchParams.get("maxRuns") ?? "", 10) ||
      Number.MAX_SAFE_INTEGER,
  );
  const started: StartedRefresh[] = [];
  const decisions = [];
  const configuredRequests = getScheduledScreenerRefreshRequests();

  for (const refreshRequest of configuredRequests) {
    const decision = await getScreenerRefreshDecision(refreshRequest);

    decisions.push(decision);
  }

  const due = decisions
    .filter((decision) =>
      decision.status === "due" ||
      (force && decision.status === "recent")
    )
    .sort((left, right) => refreshPriority(right) - refreshPriority(left));
  const skipped = decisions.filter((decision) => !due.includes(decision));

  const selected = dryRun ? [] : due.slice(0, maxRuns);
  skipped.push(...due.slice(selected.length));

  if (selected.length > 0) {
    const intervalMs = 15 * 60 * 1000;
    const intervalStartedAt = new Date(
      Math.floor(Date.now() / intervalMs) * intervalMs,
    ).toISOString();
    const run = await startObservedWorkflow(
      "wheel_market_batch",
      {
        intervalStartedAt,
        requests: selected.map((decision) => ({
          ...decision.request,
          forceRefresh: false,
        })),
      },
      (args) => start(wheelMarketBatchWorkflow, args),
    );
    const workflowStatus = await run.status;

    started.push(...selected.map((decision) => ({
        completionStatus:
          workflowStatus === "completed" ? "complete" as const : "pending" as const,
        enqueueStatus: "accepted" as const,
        persona: decision.request.persona,
        strategy: decision.request.strategy,
        runId: run.runId,
        status: workflowStatus,
      })));
  }

  const health = summarizeScreenerRefreshDecisions(decisions);

  scheduleAlertSample(
    "stale_screener_snapshot",
    health.maxAgeMinutes ?? (health.notConfiguredCount > 0 ? 31 : 0),
  );

  return NextResponse.json({
    ok: true,
    enqueueSucceeded: true,
    publicationCompleted:
      started.length > 0 &&
      started.every((run) => run.completionStatus === "complete"),
    dryRun,
    force,
    health,
    marketHours,
    maxRuns,
    configuredCount: configuredRequests.length,
    dueCount: due.length,
    started,
    skipped,
  });
}

async function GETHandler(request: Request) {
  return observeCronOperation(
    "wheel_screener_refresh",
    () => handleRefresh(request),
  );
}

async function POSTHandler(request: Request) {
  return observeCronOperation(
    "wheel_screener_refresh",
    () => handleRefresh(request),
  );
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/cron/wheel/screener-refresh" },
  GETHandler,
);

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/cron/wheel/screener-refresh" },
  POSTHandler,
);
