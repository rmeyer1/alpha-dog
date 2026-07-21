import { getFinnhubBasicFinancials } from "@/lib/finnhub/client";
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

  const metric = new URL(request.url).searchParams.get("metric") ?? "all";

  return runProtectedFinnhubRequest(request, async (signal) => {
    const metrics = await getFinnhubBasicFinancials({ metric, signal, symbol });

    return { metrics, symbol };
  });
}
