import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  getEasternMarketHoursState,
  getScheduledScreenerRefreshRequests,
  getScreenerRefreshDecision,
  getScreenerRefreshMaxRuns,
  type ScreenerRefreshDecision,
} from "@/lib/wheel/screener-refresh";
import type { WheelScreenerRequest } from "@/lib/wheel/types";
import { wheelScreenerWorkflow } from "@/workflows/wheel-screener";

export const dynamic = "force-dynamic";

interface StartedRefresh {
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

  if (!env.USE_DEMO_DATA && !hasAlpacaCredentials()) {
    return NextResponse.json(
      {
        error: {
          code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
          message: "Alpaca credentials are required for live screener refresh.",
        },
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const marketHours = getEasternMarketHoursState();

  if (!marketHours.isOpen && !marketHours.isSundayPrewarm && !dryRun && !force) {
    return NextResponse.json({
      ok: true,
      skippedMarketHours: true,
      marketHours,
      message: "Screener refresh skipped outside US market hours.",
      started: [],
      skipped: [],
    });
  }

  const maxRuns = Math.min(
    getScreenerRefreshMaxRuns(),
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

  for (const decision of due) {
    const shouldStart =
      decision.status === "due" ||
      (force && decision.status === "recent");

    if (!shouldStart || dryRun || started.length >= maxRuns) {
      skipped.push(decision);
      continue;
    }

    const run = await start(wheelScreenerWorkflow, [
      {
        ...decision.request,
        forceRefresh: true,
      },
    ]);

    started.push({
      persona: decision.request.persona,
      strategy: decision.request.strategy,
      runId: run.runId,
      status: await run.status,
    });
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    force,
    marketHours,
    maxRuns,
    configuredCount: configuredRequests.length,
    dueCount: due.length,
    started,
    skipped,
  });
}

export async function GET(request: Request) {
  return handleRefresh(request);
}

export async function POST(request: Request) {
  return handleRefresh(request);
}
