import { instrumentApiRoute } from "@/lib/observability/route";
import { getFinnhubRecommendationTrends } from "@/lib/finnhub/client";
import {
  invalidSymbolResponse,
  runProtectedFinnhubRequest,
  symbolFromContext,
  type SymbolRouteContext,
} from "../_utils";

export const dynamic = "force-dynamic";

async function GETHandler(request: Request, context: SymbolRouteContext) {
  const symbol = await symbolFromContext(context);

  if (!symbol) {
    return invalidSymbolResponse();
  }

  return runProtectedFinnhubRequest(request, async (signal) => {
    const recommendations = await getFinnhubRecommendationTrends({
      signal,
      symbol,
    });

    return { recommendations, symbol };
  });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/finnhub/company/[symbol]/recommendations" },
  GETHandler,
);
