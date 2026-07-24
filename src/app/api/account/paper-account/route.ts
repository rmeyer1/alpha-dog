import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import { loadPaperAccountOverview } from "@/lib/account/simulated-account-portfolio";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

async function GETHandler(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "paper account", authResponse);
  }

  const portfolio = await loadPaperAccountOverview(auth.supabase, auth.user.id);

  return copyAuthCookies(auth.response, NextResponse.json({
    account: portfolio.account,
    historyPositionCount: portfolio.historyPositionCount,
    openPositionCount: portfolio.openPositionCount,
    summary: portfolio.summary,
  }));
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/account/paper-account" },
  GETHandler,
);
