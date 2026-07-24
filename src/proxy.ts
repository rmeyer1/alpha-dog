import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/session-middleware";

export async function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/account/:path*",
    "/api/account/:path*",
    "/api/presets/:path*",
    "/api/auth/account-state",
    "/api/auth/logout",
    "/api/auth/profile",
  ],
};
