import { instrumentApiRoute } from "@/lib/observability/route";
import { NextRequest, NextResponse } from "next/server";
import { loadAccountHubState } from "@/lib/supabase/account-hub";
import { accountNavStateFromHubState } from "@/lib/supabase/account-nav";
import { copyAuthCookies } from "@/lib/supabase/account-session";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

async function GETHandler(request: NextRequest) {
  const authResponse = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, authResponse);
  const state = await loadAccountHubState(supabase);

  return copyAuthCookies(
    authResponse,
    NextResponse.json({ account: accountNavStateFromHubState(state) }),
  );
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/auth/account-state" },
  GETHandler,
);
