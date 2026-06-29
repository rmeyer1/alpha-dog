import { getFinnhubBasicFinancials } from "@/lib/finnhub/client";
import {
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

  const metric = new URL(request.url).searchParams.get("metric") ?? "all";

  try {
    const metrics = await getFinnhubBasicFinancials({ metric, symbol });

    return jsonResponse({ metrics, symbol });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
