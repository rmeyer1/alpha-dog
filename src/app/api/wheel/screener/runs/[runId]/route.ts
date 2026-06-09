import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import type {
  WheelScreenerResponse,
  WheelScreenerRunResponse,
} from "@/lib/wheel/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

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
    const run = getRun<WheelScreenerResponse>(runId);

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

    const status = await run.status;
    const result = status === "completed" ? await run.returnValue : null;
    const response: WheelScreenerRunResponse = {
      runId,
      status,
      result,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SCREENER_RUN_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load wheel screener workflow run.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
