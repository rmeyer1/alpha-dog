import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceConfig } from "./rest";

export function getSupabaseAdminClient() {
  const config = getSupabaseServiceConfig();

  if (!config) {
    return null;
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
