import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/session-middleware";

export async function middleware(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
