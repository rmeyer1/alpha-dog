import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { analyzeRequestSchema } from "./validation";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { isAccountProfileComplete } from "@/lib/supabase/auth";

export async function persistAuthenticatedAnalysisRequest(
  request: NextRequest,
  input: z.infer<typeof analyzeRequestSchema>,
) {
  const response = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return;
  }

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return;
  }

  const profile = await supabase
    .from("account_profiles")
    .select("email, first_name, last_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile.error || !isAccountProfileComplete(profile.data)) {
    return;
  }

  await supabase.from("analysis_requests").insert({
    cache_status: null,
    feed: null,
    filters: input.filters ?? {},
    persona_id: input.persona,
    ticker: input.ticker,
    user_id: data.user.id,
  });
}
