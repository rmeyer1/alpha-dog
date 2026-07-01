import { NextRequest, NextResponse } from "next/server";
import { loadAccountHubState } from "@/lib/supabase/account-hub";
import { accountNavStateFromHubState } from "@/lib/supabase/account-nav";
import { copyAuthCookies } from "@/lib/supabase/account-session";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const authResponse = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, authResponse);
  const state = await loadAccountHubState(supabase);

  return copyAuthCookies(
    authResponse,
    NextResponse.json({ account: accountNavStateFromHubState(state) }),
  );
}
