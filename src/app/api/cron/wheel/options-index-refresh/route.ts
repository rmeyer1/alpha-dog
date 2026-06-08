import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  getEasternMarketHoursState,
  getOptionsIndexRefreshMaxRuns,
  getOptionsIndexRefreshMinAgeMs,
  getOptionsIndexRefreshRequests,
  getOptionsIndexWeekendRefreshMaxRuns,
  getScreenerRefreshDecision,
  type ScreenerRefreshDecision,
} from "@/lib/wheel/screener-refresh";
import type { WheelScreenerRequest } from "@/lib/wheel/types";
import { wheelScreenerWorkflow } from "@/workflows/wheel-screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
        code: "UNAUTHORIZED_OPTIONS_INDEX_REQUEST",
        message: "Options index refresh authorization failed.",
      },
    },
    { status: 401 },
  );
}

function verifyOptionsIndexRequest(request: Request) {
  const env = getEnv();
  const configuredSecrets = [
    env.OPTIONS_INDEX_CRON_SECRET,
    env.CRON_SECRET,
  ].filter((secret) => secret != null);

  if (configuredSecrets.length === 0) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error: {
            code: "OPTIONS_INDEX_CRON_SECRET_NOT_CONFIGURED",
            message:
              "OPTIONS_INDEX_CRON_SECRET must be configured for options index refreshes.",
          },
        },
        { status: 503 },
      );
    }

    return null;
  }

  const authorization = request.headers.get("authorization");

  return configuredSecrets.some((secret) => authorization === `Bearer ${secret}`)
    ? null
    : unauthorized();
}

function positiveIntegerParam(url: URL, key: string) {
  const parsed = Number.parseInt(url.searchParams.get(key) ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function handleRefresh(request: Request) {
  const authError = verifyOptionsIndexRequest(request);

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
            "Supabase service-role configuration is required for options index refresh.",
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
            "Alpaca credentials are required for live options index refresh.",
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
      message: "Options index refresh skipped outside US market hours.",
      started: [],
      skipped: [],
    });
  }

  const defaultMaxRuns = marketHours.isWeekendPrewarm
    ? getOptionsIndexWeekendRefreshMaxRuns()
    : getOptionsIndexRefreshMaxRuns();
  const minAgeMinutes = positiveIntegerParam(url, "minAgeMinutes");
  const maxRuns = Math.min(
    defaultMaxRuns,
    positiveIntegerParam(url, "maxRuns") ?? Number.MAX_SAFE_INTEGER,
  );
  const minAgeMs = minAgeMinutes == null
    ? getOptionsIndexRefreshMinAgeMs()
    : minAgeMinutes * 60 * 1000;
  const configuredRequests = getOptionsIndexRefreshRequests();
  const started: StartedRefresh[] = [];
  const decisions: ScreenerRefreshDecision[] = [];

  for (const refreshRequest of configuredRequests) {
    decisions.push(await getScreenerRefreshDecision(refreshRequest, minAgeMs));
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
    minAgeMinutes: Math.ceil(minAgeMs / 60_000),
    maxRuns,
    configuredCount: configuredRequests.length,
    dueCount: due.length,
    started,
    skipped,
    message:
      due.length === 0
        ? "Options index refresh skipped because all configured snapshots are fresh or running."
        : "Options index refresh evaluated configured snapshots.",
  });
}

export async function GET(request: Request) {
  return handleRefresh(request);
}

export async function POST(request: Request) {
  return handleRefresh(request);
}
