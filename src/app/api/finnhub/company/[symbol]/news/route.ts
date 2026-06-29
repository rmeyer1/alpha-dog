import { getFinnhubCompanyNews } from "@/lib/finnhub/client";
import {
  dateParam,
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

  const from = dateParam(request, "from");
  const to = dateParam(request, "to");

  if (from === null || to === null) {
    return invalidQueryResponse("Query params from/to must use YYYY-MM-DD format.");
  }

  try {
    const news = await getFinnhubCompanyNews({ from, symbol, to });

    return jsonResponse({ news, symbol });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
