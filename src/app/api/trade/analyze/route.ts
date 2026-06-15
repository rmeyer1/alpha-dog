import { NextResponse } from "next/server";
import { analyzeTradeCandidate } from "@/lib/trade-analysis/analyze";
import type { TradeAnalysisInput } from "@/lib/trade-analysis/types";
import { tradeAnalysisRequestSchema } from "@/lib/trade-analysis/validation";

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = tradeAnalysisRequestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_TRADE_ANALYSIS_REQUEST",
          message: "Trade analysis request is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  try {
    const response = await analyzeTradeCandidate(
      parsed.data as TradeAnalysisInput,
    );

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "TRADE_ANALYSIS_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unable to analyze this trade.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
