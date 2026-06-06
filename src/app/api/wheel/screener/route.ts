import { NextResponse } from "next/server";
import { analyzeTopWheelCompanies } from "@/lib/wheel/screener";
import { screenerRequestSchema } from "@/lib/wheel/validation";

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
