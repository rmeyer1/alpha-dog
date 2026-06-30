import type { SupabaseClient } from "@supabase/supabase-js";

export const LOGOUT_FAILED = "LOGOUT_FAILED";

export async function signOutSupabaseSession(supabase: SupabaseClient | null) {
  if (!supabase) {
    return { status: "signed_out" as const };
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      code: LOGOUT_FAILED,
      status: "error" as const,
    };
  }

  return { status: "signed_out" as const };
}
