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

export interface AccountIdentity {
  createdAt: string | null;
  provider: string;
  providerEmail: string | null;
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
      identities: AccountIdentity[];
      lastName: string;
      presetCount: number;
      primaryProvider: string | null;
      profileUpdatedAt: string | null;
      status: "ready";
      userId: string;
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

  const identities = await supabase
    .from("account_identities")
    .select("provider, provider_email, created_at")
    .eq("user_id", user.id)
    .order("provider", { ascending: true });

  if (identities.error) {
    return {
      message: "Unable to load account identities.",
      status: "error",
    };
  }

  const presets = await supabase
    .from("saved_presets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (presets.error) {
    return {
      message: "Unable to load saved preset summary.",
      status: "error",
    };
  }

  return {
    email: completeProfile.email!,
    firstName: completeProfile.first_name!,
    identities: (identities.data ?? []).map((identity) => ({
      createdAt: identity.created_at ?? null,
      provider: identity.provider,
      providerEmail: identity.provider_email ?? null,
    })),
    lastName: completeProfile.last_name!,
    presetCount: presets.count ?? 0,
    primaryProvider: completeProfile.primary_provider,
    profileUpdatedAt: completeProfile.updated_at,
    status: "ready",
    userId: user.id,
  };
}
