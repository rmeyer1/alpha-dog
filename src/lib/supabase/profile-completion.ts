import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeAccountEmail } from "./auth";
import {
  ACCOUNT_EMAIL_CONFLICT,
  oauthProviderFromUser,
} from "./oauth";

export const PROFILE_AUTH_NOT_CONFIGURED = "PROFILE_AUTH_NOT_CONFIGURED";
export const PROFILE_UNAUTHENTICATED = "PROFILE_UNAUTHENTICATED";
export const PROFILE_MISSING_EMAIL = "PROFILE_MISSING_EMAIL";
export const PROFILE_SAVE_FAILED = "PROFILE_SAVE_FAILED";

export const profileCompletionInputSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
});

export type ProfileCompletionInput = z.output<typeof profileCompletionInputSchema>;

export type ProfileCompletionResult =
  | {
      profile: {
        email: string;
        firstName: string;
        id: string;
        lastName: string;
      };
      status: "complete";
    }
  | {
      code:
        | typeof ACCOUNT_EMAIL_CONFLICT
        | typeof PROFILE_AUTH_NOT_CONFIGURED
        | typeof PROFILE_MISSING_EMAIL
        | typeof PROFILE_SAVE_FAILED
        | typeof PROFILE_UNAUTHENTICATED;
      status: "error";
    };

function emailFromUser(user: User) {
  const metadataEmail = typeof user.user_metadata?.email === "string"
    ? user.user_metadata.email
    : null;

  return user.email ?? metadataEmail;
}

export async function completeAccountProfile(
  input: ProfileCompletionInput,
  supabase: SupabaseClient | null,
): Promise<ProfileCompletionResult> {
  if (!supabase) {
    return {
      code: PROFILE_AUTH_NOT_CONFIGURED,
      status: "error",
    };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      code: PROFILE_UNAUTHENTICATED,
      status: "error",
    };
  }

  const email = emailFromUser(data.user);

  if (!email) {
    return {
      code: PROFILE_MISSING_EMAIL,
      status: "error",
    };
  }

  const normalizedEmail = normalizeAccountEmail(email);
  const profile = {
    display_name: `${input.firstName} ${input.lastName}`,
    email: normalizedEmail,
    first_name: input.firstName,
    id: data.user.id,
    last_name: input.lastName,
    primary_provider: oauthProviderFromUser(data.user),
  };

  const { error: upsertError } = await supabase
    .from("account_profiles")
    .upsert(profile, { onConflict: "id" });

  if (upsertError) {
    return {
      code: upsertError.code === "23505"
        ? ACCOUNT_EMAIL_CONFLICT
        : PROFILE_SAVE_FAILED,
      status: "error",
    };
  }

  return {
    profile: {
      email: normalizedEmail,
      firstName: input.firstName,
      id: data.user.id,
      lastName: input.lastName,
    },
    status: "complete",
  };
}
