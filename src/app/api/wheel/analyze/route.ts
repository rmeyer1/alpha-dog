import { NextRequest, NextResponse } from "next/server";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import { getEnv, hasAlpacaCredentials } from "@/lib/env";
import { persistAuthenticatedAnalysisRequest } from "@/lib/wheel/analysis-audit";
import {
  analyzeWheelCandidates,
  getCachedWheelAnalysis,
} from "@/lib/wheel/analyze";
import { analyzeRequestSchema } from "@/lib/wheel/validation";

function analysisErrorResponse() {
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ANALYSIS_ERROR",
        message: "Unable to analyze wheel candidates.",
        retryable: true,
      },
    },
    { status: 502 },
  );
}

export async function POST(request: NextRequest) {
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

  const env = getEnv();
  const usesPaidProvider = !env.USE_DEMO_DATA && hasAlpacaCredentials();

  if (!usesPaidProvider) {
    try {
      const response = await analyzeWheelCandidates(parsed.data);
      await persistAuthenticatedAnalysisRequest(request, parsed.data).catch(() => null);

      return NextResponse.json(response);
    } catch {
      return analysisErrorResponse();
    }
  }

  const cached = await getCachedWheelAnalysis(parsed.data);

  if (cached) {
    await persistAuthenticatedAnalysisRequest(request, parsed.data).catch(() => null);

    return NextResponse.json(cached);
  }

  const guard = await acquirePaidRouteGuard(request, "wheelAnalyze");

  if (!guard.allowed) {
    return guard.response;
  }

  try {
    const response = await analyzeWheelCandidates(parsed.data, {
      signal: guard.signal,
      skipCache: true,
    });
    await persistAuthenticatedAnalysisRequest(request, parsed.data).catch(() => null);

    return guard.withAuthCookies(NextResponse.json(response));
  } catch {
    return guard.withAuthCookies(analysisErrorResponse());
  } finally {
    await guard.release();
  }
}
