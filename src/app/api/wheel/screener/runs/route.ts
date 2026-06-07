import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getCachedWheelScreenerResponse } from "@/lib/wheel/screener";
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
    const cached = await getCachedWheelScreenerResponse(parsed.data);

    if (cached) {
      return NextResponse.json({
        runId: "cached",
        status: "completed",
        result: cached,
      });
    }

    const run = await start(wheelScreenerWorkflow, [parsed.data]);
    const status = await run.status;

    return NextResponse.json({
      runId: run.runId,
      status,
      result: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_WORKFLOW_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to start wheel screener workflow.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
