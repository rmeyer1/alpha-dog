import { NextResponse, type NextRequest } from "next/server";
import { loadAccountPositionDetail } from "@/lib/account/simulated-account-portfolio";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{
    positionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { positionId } = await context.params;
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "simulated positions",
      authResponse,
    );
  }

  const position = await loadAccountPositionDetail(
    auth.supabase,
    auth.user.id,
    positionId,
  );

  if (!position) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "SIMULATED_POSITION_NOT_FOUND",
            message: "Simulated position was not found.",
          },
        },
        { status: 404 },
      ),
    );
  }

  return copyAuthCookies(auth.response, NextResponse.json({ position }));
}
