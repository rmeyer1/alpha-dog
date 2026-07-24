import { instrumentApiRoute } from "@/lib/observability/route";
import { getFinnhubCompanyProfile } from "@/lib/finnhub/client";
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
    const profile = await getFinnhubCompanyProfile({ signal, symbol });

    return { profile, symbol };
  });
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/finnhub/company/[symbol]/profile" },
  GETHandler,
);
