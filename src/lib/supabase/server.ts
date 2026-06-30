import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "./auth";

export type RouteSupabaseClient = SupabaseClient;

export function createSupabaseRouteClient(
  request: NextRequest,
  response: NextResponse,
): RouteSupabaseClient | null {
  const config = getSupabaseAuthConfig();

  if (!config) {
    return null;
  }

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options as CookieOptions);
        });

        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });
}
