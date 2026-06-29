import { getFinnhubEarningsSurprises } from "@/lib/finnhub/client";
import {
  integerParam,
  invalidQueryResponse,
  invalidSymbolResponse,
  jsonResponse,
  providerErrorResponse,
  symbolFromContext,
  type SymbolRouteContext,
} from "../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: SymbolRouteContext) {
  const symbol = await symbolFromContext(context);

  if (!symbol) {
    return invalidSymbolResponse();
  }

  const limit = integerParam(request, "limit", {
    defaultValue: 4,
    max: 16,
    min: 1,
  });

  if (limit === null) {
    return invalidQueryResponse("Query param limit must be an integer.");
  }

  try {
    const earningsSurprises = await getFinnhubEarningsSurprises({
      limit,
      symbol,
    });

    return jsonResponse({ earningsSurprises, symbol });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
