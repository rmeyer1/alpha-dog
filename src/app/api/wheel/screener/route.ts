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
import { analyzeTopWheelCompanies } from "@/lib/wheel/screener";
import { getRunningScreenerRefreshFallback } from "@/lib/wheel/screener-refresh";
import { getControlledWheelScreenerRead } from "@/lib/wheel/scanner-rollout";
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
      const controlled = await getControlledWheelScreenerRead(parsed.data);

      if (controlled.response) {
        return NextResponse.json(controlled.response);
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
        const run = await startObservedWorkflow(
          "wheel_screener",
          parsed.data,
          (args) => start(wheelScreenerWorkflow, args),
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
