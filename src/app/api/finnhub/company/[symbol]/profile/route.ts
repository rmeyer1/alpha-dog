import { getFinnhubCompanyProfile } from "@/lib/finnhub/client";
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
    const profile = await getFinnhubCompanyProfile({ symbol });

    return jsonResponse({ profile, symbol });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
