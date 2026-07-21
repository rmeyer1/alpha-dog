import { getFinnhubCompanyProfile } from "@/lib/finnhub/client";
import {
  invalidSymbolResponse,
  runProtectedFinnhubRequest,
  symbolFromContext,
  type SymbolRouteContext,
} from "../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: SymbolRouteContext) {
  const symbol = await symbolFromContext(context);

  if (!symbol) {
    return invalidSymbolResponse();
  }

  return runProtectedFinnhubRequest(request, async (signal) => {
    const profile = await getFinnhubCompanyProfile({ signal, symbol });

    return { profile, symbol };
  });
}
