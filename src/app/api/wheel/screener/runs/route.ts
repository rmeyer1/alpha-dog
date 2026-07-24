import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import { startObservedWorkflow } from "@/lib/observability/workflow";
import {
  getEnv,
  getMarketDataConfigurationError,
  isDemoMode,
} from "@/lib/env";
import { getMaterializedWheelScreenerResponse } from "@/lib/wheel/materialized-screener";
import {
  cacheCompletedWheelScreenerResponse,
  getCachedWheelScreenerResponse,
} from "@/lib/wheel/screener";
import { getRunningScreenerRefreshFallback } from "@/lib/wheel/screener-refresh";
import { screenerRequestSchema } from "@/lib/wheel/validation";
import { wheelScreenerWorkflow } from "@/workflows/wheel-screener";

async function POSTHandler(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = screenerRequestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SCREENER_REQUEST",
          message: "Screener request is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const env = getEnv();
  const configurationError = getMarketDataConfigurationError(
    { requireSupabase: !isDemoMode(env) },
    env,
  );

  if (configurationError) {
    return NextResponse.json(
      {
        error: {
          ...configurationError,
          retryable: false,
        },
      },
      { status: 503 },
    );
  }

  try {
    const cached = await getCachedWheelScreenerResponse(parsed.data);

    if (cached) {
      return NextResponse.json({
        runId: "cached",
        status: "completed",
        result: cached,
      });
    }

    const materialized = await getMaterializedWheelScreenerResponse(parsed.data);

    if (materialized) {
      await cacheCompletedWheelScreenerResponse(parsed.data, materialized);

      return NextResponse.json({
        runId: "materialized",
        status: "completed",
        result: materialized,
      });
    }

    const runningFallback = await getRunningScreenerRefreshFallback(
      parsed.data,
    );

    if (runningFallback) {
      await cacheCompletedWheelScreenerResponse(parsed.data, runningFallback);

      return NextResponse.json({
        runId: "materialized-refreshing",
        status: "completed",
        result: runningFallback,
      });
    }

    const guard = await acquirePaidRouteGuard(request, "wheelScreenerStart");

    if (!guard.allowed) {
      return guard.response;
    }

    try {
      const run = await startObservedWorkflow(
        "wheel_screener",
        parsed.data,
        (args) => start(wheelScreenerWorkflow, args),
      );
      const status = await run.status;

      return guard.withAuthCookies(NextResponse.json({
        runId: run.runId,
        status,
        result: null,
      }));
    } finally {
      await guard.release();
    }
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_WORKFLOW_ERROR",
          message: "Unable to start wheel screener workflow.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/wheel/screener/runs" },
  POSTHandler,
);
