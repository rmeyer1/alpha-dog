import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  manualDuplicateEmailResult,
} from "./oauth";
import { normalizeAccountEmail } from "./auth";

export const ACCOUNT_AUTH_NOT_CONFIGURED = "ACCOUNT_AUTH_NOT_CONFIGURED";
export const ACCOUNT_INVITE_FAILED = "ACCOUNT_INVITE_FAILED";
export const ACCOUNT_PROFILE_CREATE_FAILED = "ACCOUNT_PROFILE_CREATE_FAILED";

export const manualAccountInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((email) => normalizeAccountEmail(email)),
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  redirectTo: z.string().url().optional(),
});

export type ManualAccountInput = z.input<typeof manualAccountInputSchema>;
export type ManualAccountData = z.output<typeof manualAccountInputSchema>;

export interface ManualAccountSuccess {
  account: {
    email: string;
    firstName: string;
    id: string;
    lastName: string;
  };
  status: "invite_sent";
}

export type ManualAccountResult =
  | ManualAccountSuccess
  | ReturnType<typeof manualDuplicateEmailResult>
  | {
      code:
        | typeof ACCOUNT_AUTH_NOT_CONFIGURED
        | typeof ACCOUNT_INVITE_FAILED
        | typeof ACCOUNT_PROFILE_CREATE_FAILED;
      status: "error";
    };

export type ManualAccountSupabaseClient = SupabaseClient;

async function emailAlreadyRegistered(
  supabase: ManualAccountSupabaseClient,
  email: string,
) {
  const { data, error } = await supabase
    .from("account_profiles")
    .select("id")
    .eq("normalized_email", email)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to validate account email.");
  }

  return Boolean(data);
}

async function cleanupAuthUser(
  supabase: ManualAccountSupabaseClient,
  userId: string,
) {
  await supabase.auth.admin.deleteUser(userId).catch(() => null);
}

export async function createManualAccount(
  input: ManualAccountData,
  supabase: ManualAccountSupabaseClient | null,
): Promise<ManualAccountResult> {
  if (!supabase) {
    return {
      code: ACCOUNT_AUTH_NOT_CONFIGURED,
      status: "error",
    };
  }

  if (await emailAlreadyRegistered(supabase, input.email)) {
    return manualDuplicateEmailResult(input.email);
  }

  const invite = await supabase.auth.admin.inviteUserByEmail(input.email, {
    data: {
      first_name: input.firstName,
      last_name: input.lastName,
    },
    ...(input.redirectTo ? { redirectTo: input.redirectTo } : {}),
  });

  if (invite.error || !invite.data.user) {
    return invite.error?.message?.toLowerCase().includes("already")
      ? manualDuplicateEmailResult(input.email)
      : {
          code: ACCOUNT_INVITE_FAILED,
          status: "error",
        };
  }

  const userId = invite.data.user.id;
  const profile = await supabase.from("account_profiles").insert({
    email: input.email,
    first_name: input.firstName,
    id: userId,
    last_name: input.lastName,
    primary_provider: "email",
  });

  if (profile.error) {
    await cleanupAuthUser(supabase, userId);

    return profile.error.code === "23505"
      ? manualDuplicateEmailResult(input.email)
      : {
          code: ACCOUNT_PROFILE_CREATE_FAILED,
          status: "error",
        };
  }

  return {
    account: {
      email: input.email,
      firstName: input.firstName,
      id: userId,
      lastName: input.lastName,
    },
    status: "invite_sent",
  };
}
