import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const url = new URL(request.url);
  const startIndexParam = url.searchParams.get("startIndex");
  const startIndex = startIndexParam == null
    ? undefined
    : Number.parseInt(startIndexParam, 10);

  if (!runId) {
    return NextResponse.json(
      {
        error: {
          code: "MISSING_RUN_ID",
          message: "Workflow run ID is required.",
        },
      },
      { status: 400 },
    );
  }

  const guard = await acquirePaidRouteGuard(request, "wheelScreenerStatus");

  if (!guard.allowed) {
    return guard.response;
  }

  try {
    const run = getRun<unknown>(runId);

    if (!(await run.exists)) {
      return guard.withAuthCookies(NextResponse.json(
        {
          error: {
            code: "SCREENER_RUN_NOT_FOUND",
            message: "Wheel screener workflow run was not found.",
          },
        },
        { status: 404 },
      ));
    }

    return guard.withAuthCookies(new NextResponse(
      run.getReadable<Uint8Array>({
        startIndex: Number.isFinite(startIndex) ? startIndex : undefined,
      }),
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      },
    ));
  } catch {
    return guard.withAuthCookies(NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_STREAM_ERROR",
          message: "Unable to stream wheel screener workflow progress.",
          retryable: true,
        },
      },
      { status: 502 },
    ));
  } finally {
    // This lease bounds workflow stream setup. The stream itself is expected to
    // remain open and is protected by authentication plus the request budget.
    await guard.release();
  }
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/wheel/screener/runs/[runId]/stream" },
  GETHandler,
);
