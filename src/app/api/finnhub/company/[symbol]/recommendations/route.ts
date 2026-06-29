import { getFinnhubRecommendationTrends } from "@/lib/finnhub/client";
import {
  invalidSymbolResponse,
  jsonResponse,
  providerErrorResponse,
  symbolFromContext,
  type SymbolRouteContext,
} from "../_utils";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: SymbolRouteContext) {
  const symbol = await symbolFromContext(context);

  if (!symbol) {
    return invalidSymbolResponse();
  }

  try {
    const recommendations = await getFinnhubRecommendationTrends({ symbol });

    return jsonResponse({ recommendations, symbol });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
