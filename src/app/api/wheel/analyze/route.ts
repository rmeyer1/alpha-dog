import { NextResponse } from "next/server";
import { analyzeWheelCandidates } from "@/lib/wheel/analyze";
import { analyzeRequestSchema } from "@/lib/wheel/validation";

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = analyzeRequestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ANALYSIS_REQUEST",
          message: "Analysis request is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const response = await analyzeWheelCandidates(parsed.data);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ANALYSIS_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to analyze wheel candidates.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
