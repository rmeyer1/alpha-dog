import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import { getMaterializedWheelScreenerResponse } from "@/lib/wheel/materialized-screener";
import { analyzeTopWheelCompanies } from "@/lib/wheel/screener";
import { getRunningScreenerRefreshFallback } from "@/lib/wheel/screener-refresh";
import { screenerRequestSchema } from "@/lib/wheel/validation";
import { wheelScreenerWorkflow } from "@/workflows/wheel-screener";

export async function POST(request: Request) {
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

  try {
    if (!parsed.data.forceRefresh) {
      const materialized = await getMaterializedWheelScreenerResponse(
        parsed.data,
      );

      if (materialized) {
        return NextResponse.json(materialized);
      }
    }

    const env = getEnv();
    const liveUniverse = !env.USE_DEMO_DATA && hasAlpacaCredentials();

    if (liveUniverse) {
      if (!getSupabaseServiceConfig()) {
        return NextResponse.json(
          {
            error: {
              code: "ALPHA_DOG_SUPABASE_NOT_CONFIGURED",
              message:
                "Alpha Dog Supabase service-role configuration is required before running a live universe scan.",
              retryable: false,
            },
          },
          { status: 503 },
        );
      }

      const runningFallback = await getRunningScreenerRefreshFallback(
        parsed.data,
      );

      if (runningFallback) {
        return NextResponse.json(runningFallback);
      }

      const run = await start(wheelScreenerWorkflow, [parsed.data]);

      return NextResponse.json(
        {
          runId: run.runId,
          status: await run.status,
          result: null,
        },
        { status: 202 },
      );
    }

    const response = await analyzeTopWheelCompanies(parsed.data);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to screen wheel companies.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
