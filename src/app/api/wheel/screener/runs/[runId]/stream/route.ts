import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

export async function GET(
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

  try {
    const run = getRun<unknown>(runId);

    if (!(await run.exists)) {
      return NextResponse.json(
        {
          error: {
            code: "SCREENER_RUN_NOT_FOUND",
            message: "Wheel screener workflow run was not found.",
          },
        },
        { status: 404 },
      );
    }

    return new Response(
      run.getReadable<Uint8Array>({
        startIndex: Number.isFinite(startIndex) ? startIndex : undefined,
      }),
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_STREAM_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to stream wheel screener workflow progress.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
