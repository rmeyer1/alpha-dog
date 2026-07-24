import { instrumentApiRoute } from "@/lib/observability/route";
import { getFinnhubEarningsSurprises } from "@/lib/finnhub/client";
import {
  integerParam,
  invalidQueryResponse,
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

  const limit = integerParam(request, "limit", {
    defaultValue: 4,
    max: 16,
    min: 1,
  });

  if (limit === null) {
    return invalidQueryResponse("Query param limit must be an integer.");
  }

  return runProtectedFinnhubRequest(request, async (signal) => {
    const earningsSurprises = await getFinnhubEarningsSurprises({
      limit,
      signal,
      symbol,
    });

    return { earningsSurprises, symbol };
  });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/finnhub/company/[symbol]/earnings" },
  GETHandler,
);
