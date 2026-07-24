import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import { observedWorkflowArguments } from "@/lib/observability/workflow";
import {
  getEnv,
  getMarketDataConfigurationError,
  isDemoMode,
} from "@/lib/env";
import { getMaterializedWheelScreenerResponse } from "@/lib/wheel/materialized-screener";
import { analyzeTopWheelCompanies } from "@/lib/wheel/screener";
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
    if (!parsed.data.forceRefresh) {
      const materialized = await getMaterializedWheelScreenerResponse(
        parsed.data,
      );

      if (materialized) {
        return NextResponse.json(materialized);
      }
    }

    const liveUniverse = !isDemoMode(env);

    if (liveUniverse) {
      const runningFallback = await getRunningScreenerRefreshFallback(
        parsed.data,
      );

      if (runningFallback) {
        return NextResponse.json(runningFallback);
      }

      const guard = await acquirePaidRouteGuard(
        request,
        "wheelScreenerStart",
      );

      if (!guard.allowed) {
        return guard.response;
      }

      try {
        const run = await start(
          wheelScreenerWorkflow,
          await observedWorkflowArguments("wheel_screener", parsed.data),
        );

        return guard.withAuthCookies(NextResponse.json(
          {
            runId: run.runId,
            status: await run.status,
            result: null,
          },
          { status: 202 },
        ));
      } finally {
        await guard.release();
      }
    }

    const response = await analyzeTopWheelCompanies(parsed.data);

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_ERROR",
          message: "Unable to screen wheel companies.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/wheel/screener" },
  POSTHandler,
);
