import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAccountProfileComplete } from "./auth";

interface AccountProfileRow {
  created_at: string | null;
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_provider: string | null;
  updated_at: string | null;
}

export interface AccountPresetSummary {
  basePersona: string;
  id: string;
  name: string;
  updatedAt: string | null;
}

interface AccountPresetRow {
  base_persona_id: string;
  id: string;
  name: string;
  updated_at: string | null;
}

export type AccountHubState =
  | { status: "unauthenticated" }
  | {
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      missingFields: string[];
      status: "incomplete_profile";
      userId: string;
    }
  | {
      email: string;
      firstName: string;
      lastName: string;
      presetCount: number;
      presets: AccountPresetSummary[];
      status: "ready";
    }
  | {
      message: string;
      status: "error";
    };

function missingProfileFields(profile: AccountProfileRow | null) {
  const fields: string[] = [];

  if (!profile?.email?.trim()) {
    fields.push("email");
  }

  if (!profile?.first_name?.trim()) {
    fields.push("first name");
  }

  if (!profile?.last_name?.trim()) {
    fields.push("last name");
  }

  return fields;
}

function fallbackEmail(user: User) {
  return user.email ?? null;
}

export async function loadAccountHubState(
  supabase: SupabaseClient | null,
): Promise<AccountHubState> {
  if (!supabase) {
    return { status: "unauthenticated" };
  }

  const auth = await supabase.auth.getUser();

  if (auth.error || !auth.data.user) {
    return { status: "unauthenticated" };
  }

  const user = auth.data.user;
  const profile = await supabase
    .from("account_profiles")
    .select("email, first_name, last_name, display_name, primary_provider, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle<AccountProfileRow>();

  if (profile.error) {
    return {
      message: "Unable to load account profile.",
      status: "error",
    };
  }

  if (!profile.data || !isAccountProfileComplete(profile.data)) {
    return {
      email: profile.data?.email ?? fallbackEmail(user),
      firstName: profile.data?.first_name ?? null,
      lastName: profile.data?.last_name ?? null,
      missingFields: missingProfileFields(profile.data),
      status: "incomplete_profile",
      userId: user.id,
    };
  }

  const completeProfile = profile.data;

  const presets = await supabase
    .from("saved_presets")
    .select("id, name, base_persona_id, updated_at", { count: "exact" })
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(4);

  if (presets.error) {
    return {
      message: "Unable to load saved preset summary.",
      status: "error",
    };
  }

  return {
    email: completeProfile.email!,
    firstName: completeProfile.first_name!,
    lastName: completeProfile.last_name!,
    presetCount: presets.count ?? 0,
    presets: ((presets.data ?? []) as AccountPresetRow[]).map((preset) => ({
      basePersona: preset.base_persona_id,
      id: preset.id,
      name: preset.name,
      updatedAt: preset.updated_at,
    })),
    status: "ready",
  };
}
