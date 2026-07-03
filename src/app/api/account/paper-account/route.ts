import { NextResponse, type NextRequest } from "next/server";
import { loadAccountPortfolio } from "@/lib/account/simulated-account-portfolio";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

export async function GET(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "paper account");
  }

  const portfolio = await loadAccountPortfolio(auth.supabase, auth.user.id);

  return copyAuthCookies(auth.response, NextResponse.json({
    account: portfolio.account,
    historyPositionCount: portfolio.historyPositions.length,
    openPositionCount: portfolio.openPositions.length,
    summary: portfolio.summary,
  }));
}
