import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { isAccountProfileComplete } from "./auth";
import { createSupabaseRouteClient } from "./server";

export const UNAUTHENTICATED = "UNAUTHENTICATED";
export const PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE";

export interface AccountSession {
  response: NextResponse;
  supabase: SupabaseClient;
  user: User;
}

export type AccountSessionResult =
  | AccountSession
  | { code: typeof UNAUTHENTICATED | typeof PROFILE_INCOMPLETE };

export async function getRequiredAccountSession(
  request: NextRequest,
  response: NextResponse,
): Promise<AccountSessionResult> {
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return { code: UNAUTHENTICATED };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { code: UNAUTHENTICATED };
  }

  const profile = await supabase
    .from("account_profiles")
    .select("email, first_name, last_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile.error || !isAccountProfileComplete(profile.data)) {
    return { code: PROFILE_INCOMPLETE };
  }

  return {
    response,
    supabase,
    user: data.user,
  };
}

export function copyAuthCookies(
  source: NextResponse,
  target: NextResponse,
) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });

  return target;
}
