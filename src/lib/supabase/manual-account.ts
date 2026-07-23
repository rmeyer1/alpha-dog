import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import {
  manualDuplicateEmailResult,
  safeRedirectPath,
} from "./oauth";
import { normalizeAccountEmail } from "./auth";

export const ACCOUNT_AUTH_NOT_CONFIGURED = "ACCOUNT_AUTH_NOT_CONFIGURED";
export const ACCOUNT_INVITE_FAILED = "ACCOUNT_INVITE_FAILED";

export const manualAccountInputSchema = z.object({
  captchaToken: z.string().trim().min(1).max(2_048).optional(),
  email: z
    .string()
    .trim()
    .max(320)
    .email()
    .transform((email) => normalizeAccountEmail(email)),
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  nextPath: z
    .string()
    .trim()
    .max(2_048)
    .optional()
    .transform((value) => safeRedirectPath(value ?? null)),
});

export type ManualAccountInput = z.input<typeof manualAccountInputSchema>;
export type ManualAccountData = z.output<typeof manualAccountInputSchema>;

export interface ManualAccountCreateData {
  email: string;
  firstName: string;
  lastName: string;
  redirectTo: string;
}

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
        | typeof ACCOUNT_INVITE_FAILED;
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

function inviteAlreadyExists(error: { code?: string; message?: string } | null) {
  return error?.code === "email_exists" ||
    error?.code === "user_already_exists" ||
    Boolean(error?.message?.toLowerCase().includes("already"));
}

function normalizedOrigin(value: string | undefined, addHttps = false) {
  if (!value) {
    return null;
  }

  try {
    const candidate = addHttps && !value.startsWith("http")
      ? `https://${value}`
      : value;
    const url = new URL(candidate);

    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function manualAccountInviteRedirectUrl(
  requestUrl: string,
  nextPath: string,
  options?: {
    appUrl?: string;
    nodeEnv?: string;
    vercelProjectProductionUrl?: string;
    vercelUrl?: string;
  },
) {
  let configuredOptions = options;

  if (!configuredOptions) {
    try {
      const env = getEnv();

      configuredOptions = {
        appUrl: env.ALPHA_DOG_APP_URL,
        nodeEnv: process.env.NODE_ENV,
        vercelProjectProductionUrl:
          process.env.VERCEL_PROJECT_PRODUCTION_URL,
        vercelUrl: process.env.VERCEL_URL,
      };
    } catch {
      return null;
    }
  }
  const trustedOrigin = normalizedOrigin(configuredOptions.appUrl) ??
    normalizedOrigin(configuredOptions.vercelProjectProductionUrl, true) ??
    normalizedOrigin(configuredOptions.vercelUrl, true) ??
    (configuredOptions.nodeEnv === "production"
      ? null
      : normalizedOrigin(new URL(requestUrl).origin));

  if (!trustedOrigin) {
    return null;
  }

  const redirect = new URL("/account", trustedOrigin);
  redirect.searchParams.set("profile", "complete");
  redirect.searchParams.set("next", safeRedirectPath(nextPath));

  return redirect.toString();
}

export async function createManualAccount(
  input: ManualAccountCreateData,
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
      manual_account_invite: true,
    },
    redirectTo: input.redirectTo,
  });

  if (invite.error || !invite.data.user) {
    return inviteAlreadyExists(invite.error)
      ? manualDuplicateEmailResult(input.email)
      : {
          code: ACCOUNT_INVITE_FAILED,
          status: "error",
        };
  }

  const userId = invite.data.user.id;

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
