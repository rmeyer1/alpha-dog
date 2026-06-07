import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  getScheduledScreenerRefreshRequests,
  getScreenerRefreshDecision,
  getScreenerRefreshMaxRuns,
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
  const maxRuns = Math.min(
    getScreenerRefreshMaxRuns(),
    Number.parseInt(url.searchParams.get("maxRuns") ?? "", 10) ||
      Number.MAX_SAFE_INTEGER,
  );
  const started: StartedRefresh[] = [];
  const skipped = [];
  const due = [];

  for (const refreshRequest of getScheduledScreenerRefreshRequests()) {
    const decision = await getScreenerRefreshDecision(refreshRequest);
    const shouldStart =
      decision.status === "due" ||
      (force && decision.status === "recent");

    if (shouldStart) {
      due.push(decision);
    }

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
    maxRuns,
    configuredCount: getScheduledScreenerRefreshRequests().length,
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
