import { getFinnhubCompanyNews } from "@/lib/finnhub/client";
import {
  dateParam,
  invalidQueryResponse,
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

  const from = dateParam(request, "from");
  const to = dateParam(request, "to");

  if (from === null || to === null) {
    return invalidQueryResponse("Query params from/to must use YYYY-MM-DD format.");
  }

  return runProtectedFinnhubRequest(request, async (signal) => {
    const news = await getFinnhubCompanyNews({ from, signal, symbol, to });

    return { news, symbol };
  });
}
