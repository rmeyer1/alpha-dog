import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
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

export async function resolveAccountSession(
  supabase: SupabaseClient | null,
  response: NextResponse,
): Promise<AccountSessionResult> {
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

export async function getRequiredAccountSession(
  request: NextRequest,
  response: NextResponse,
): Promise<AccountSessionResult> {
  return resolveAccountSession(
    createSupabaseRouteClient(request, response),
    response,
  );
}

export function accountSessionErrorResponse(
  code: typeof UNAUTHENTICATED | typeof PROFILE_INCOMPLETE,
  feature = "this account feature",
) {
  return NextResponse.json(
    {
      error: {
        code,
        message: code === UNAUTHENTICATED
          ? `Sign in to use ${feature}.`
          : `Complete your account profile to use ${feature}.`,
      },
    },
    { status: code === UNAUTHENTICATED ? 401 : 403 },
  );
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
