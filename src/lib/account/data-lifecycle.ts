import {
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import type {
  JwtPayload,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getSupabaseServiceConfig,
} from "@/lib/supabase/rest";
import {
  ACCOUNT_DATA_RETENTION_POLICY,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_REAUTH_MINUTES,
  ACCOUNT_DELETION_RETRY_HOURS,
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
} from "./data-lifecycle-contract";

export {
  ACCOUNT_DATA_RETENTION_POLICY,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_COOKIE,
  ACCOUNT_DELETION_REAUTH_MINUTES,
  ACCOUNT_DELETION_RETRY_HOURS,
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
} from "./data-lifecycle-contract";

export const ACCOUNT_DELETION_INVALID_CONFIRMATION =
  "ACCOUNT_DELETION_INVALID_CONFIRMATION";
export const ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED =
  "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED";
export const ACCOUNT_DELETION_RETRY_EXPIRED =
  "ACCOUNT_DELETION_RETRY_EXPIRED";
export const ACCOUNT_DELETION_UNAVAILABLE = "ACCOUNT_DELETION_UNAVAILABLE";
export const ACCOUNT_EXPORT_FAILED = "ACCOUNT_EXPORT_FAILED";

interface AccountDeletionRequestRow {
  application_data_deleted_at: string | null;
  attempt_count: number;
  auth_user_deleted_at: string | null;
  confirmation_email_hash: string;
  expires_at: string;
  id: string;
  result: Record<string, unknown> | null;
  sessions_revoked_at: string | null;
  status:
    | "application_data_deleted"
    | "auth_user_deleted"
    | "authorized"
    | "completed"
    | "failed"
    | "sessions_revoked";
  token_hash: string | null;
  user_id: string | null;
}

interface DeletionConfirmation {
  confirmation: string;
  email: string;
}

interface AuthorizedDeletion {
  accessToken: string | null;
  request: AccountDeletionRequestRow;
  retryToken: string;
  status: "authorized";
  userId: string;
}

export type AccountDeletionAuthorization =
  | AuthorizedDeletion
  | {
      code:
        | typeof ACCOUNT_DELETION_INVALID_CONFIRMATION
        | typeof ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED
        | typeof ACCOUNT_DELETION_RETRY_EXPIRED
        | typeof ACCOUNT_DELETION_UNAVAILABLE;
      status: "error";
    };

export interface AccountDeletionResult {
  requestId: string;
  status: "deleted";
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function privateDigest(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function retryToken() {
  return randomBytes(32).toString("base64url");
}

function isoAfterHours(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 60 * 60 * 1_000).toISOString();
}

function authErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

function alreadyRevokedError(error: unknown) {
  return ["refresh_token_not_found", "session_not_found"].includes(
    authErrorCode(error) ?? "",
  );
}

function missingAuthUserError(error: unknown) {
  return authErrorCode(error) === "user_not_found";
}

export function hasRecentAccountAuthentication(
  claims: Pick<JwtPayload, "amr" | "sub">,
  userId: string,
  now = new Date(),
) {
  if (claims.sub !== userId || !Array.isArray(claims.amr)) {
    return false;
  }

  const latestAuthentication = claims.amr.reduce<number | null>(
    (latest, entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        entry.method === "anonymous" ||
        entry.method === "token_refresh" ||
        !Number.isFinite(entry.timestamp)
      ) {
        return latest;
      }

      return latest === null
        ? entry.timestamp
        : Math.max(latest, entry.timestamp);
    },
    null,
  );

  if (latestAuthentication === null) {
    return false;
  }

  const authenticatedAt = latestAuthentication * 1_000;

  return authenticatedAt <= now.getTime() &&
    now.getTime() - authenticatedAt <=
      ACCOUNT_DELETION_REAUTH_MINUTES * 60 * 1_000;
}

export function validAccountDeletionConfirmation(
  input: DeletionConfirmation,
  accountEmail: string,
) {
  return input.confirmation === ACCOUNT_DELETION_CONFIRMATION &&
    normalizedEmail(input.email) === normalizedEmail(accountEmail);
}

export function createAccountExportDocument(
  accountId: string,
  records: unknown,
  exportedAt = new Date(),
) {
  return {
    accountId,
    exportedAt: exportedAt.toISOString(),
    format: ACCOUNT_EXPORT_FORMAT,
    records,
    retentionPolicy: ACCOUNT_DATA_RETENTION_POLICY,
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
  };
}

async function getRecentAccountAccessToken(
  supabase: SupabaseClient,
  user: User,
  now: Date,
) {
  const session = await supabase.auth.getSession();

  if (session.error || !session.data.session?.access_token) {
    return null;
  }

  const claims = await supabase.auth.getClaims(
    session.data.session.access_token,
  );

  if (
    claims.error ||
    !claims.data?.claims ||
    !hasRecentAccountAuthentication(claims.data.claims, user.id, now)
  ) {
    return null;
  }

  return session.data.session.access_token;
}

async function loadDeletionRequest(
  admin: SupabaseClient,
  rawToken: string,
) {
  const result = await admin
    .from("account_deletion_requests")
    .select(
      "id, user_id, token_hash, confirmation_email_hash, status, attempt_count, expires_at, sessions_revoked_at, application_data_deleted_at, auth_user_deleted_at, result",
    )
    .eq("token_hash", sha256(rawToken))
    .maybeSingle<AccountDeletionRequestRow>();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function authorizeRetry(
  admin: SupabaseClient,
  secret: string,
  rawToken: string,
  input: DeletionConfirmation,
  now: Date,
  supabase: SupabaseClient | null,
  user: User | null,
): Promise<AccountDeletionAuthorization | null> {
  const request = await loadDeletionRequest(admin, rawToken);

  if (!request) {
    return null;
  }

  if (
    request.status === "completed" ||
    !request.user_id ||
    Date.parse(request.expires_at) <= now.getTime()
  ) {
    return {
      code: ACCOUNT_DELETION_RETRY_EXPIRED,
      status: "error",
    };
  }

  if (
    input.confirmation !== ACCOUNT_DELETION_CONFIRMATION ||
    privateDigest(secret, normalizedEmail(input.email)) !==
      request.confirmation_email_hash
  ) {
    return {
      code: ACCOUNT_DELETION_INVALID_CONFIRMATION,
      status: "error",
    };
  }

  let accessToken: string | null = null;

  if (!request.sessions_revoked_at) {
    if (!supabase || !user || user.id !== request.user_id) {
      return {
        code: ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED,
        status: "error",
      };
    }

    accessToken = await getRecentAccountAccessToken(supabase, user, now);

    if (!accessToken) {
      return {
        code: ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED,
        status: "error",
      };
    }
  }

  return {
    accessToken,
    request,
    retryToken: rawToken,
    status: "authorized",
    userId: request.user_id,
  };
}

export async function authorizeAccountDeletion({
  input,
  now = new Date(),
  retryCookie,
  supabase,
  user,
}: {
  input: DeletionConfirmation;
  now?: Date;
  retryCookie?: string | null;
  supabase: SupabaseClient | null;
  user: User | null;
}): Promise<AccountDeletionAuthorization> {
  const serviceConfig = getSupabaseServiceConfig();
  const admin = getSupabaseAdminClient();

  if (!serviceConfig || !admin) {
    return {
      code: ACCOUNT_DELETION_UNAVAILABLE,
      status: "error",
    };
  }

  if (retryCookie) {
    const retry = await authorizeRetry(
      admin,
      serviceConfig.serviceRoleKey,
      retryCookie,
      input,
      now,
      supabase,
      user,
    );

    if (retry) {
      return retry;
    }
  }

  if (!supabase || !user) {
    return {
      code: ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED,
      status: "error",
    };
  }

  const profile = await supabase
    .from("account_profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle<{ email: string }>();

  if (
    profile.error ||
    !profile.data ||
    !validAccountDeletionConfirmation(input, profile.data.email)
  ) {
    return {
      code: ACCOUNT_DELETION_INVALID_CONFIRMATION,
      status: "error",
    };
  }

  const accessToken = await getRecentAccountAccessToken(
    supabase,
    user,
    now,
  );

  if (!accessToken) {
    return {
      code: ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED,
      status: "error",
    };
  }

  const rawToken = retryToken();
  const insert = await admin
    .from("account_deletion_requests")
    .insert({
      confirmation_email_hash: privateDigest(
        serviceConfig.serviceRoleKey,
        normalizedEmail(profile.data.email),
      ),
      expires_at: isoAfterHours(now, ACCOUNT_DELETION_RETRY_HOURS),
      reauthenticated_at: now.toISOString(),
      status: "authorized",
      token_hash: sha256(rawToken),
      user_fingerprint: privateDigest(
        serviceConfig.serviceRoleKey,
        user.id,
      ),
      user_id: user.id,
    })
    .select(
      "id, user_id, token_hash, confirmation_email_hash, status, attempt_count, expires_at, sessions_revoked_at, application_data_deleted_at, auth_user_deleted_at, result",
    )
    .single<AccountDeletionRequestRow>();

  if (insert.error || !insert.data) {
    return {
      code: ACCOUNT_DELETION_UNAVAILABLE,
      status: "error",
    };
  }

  return {
    accessToken,
    request: insert.data,
    retryToken: rawToken,
    status: "authorized",
    userId: user.id,
  };
}

async function updateDeletionRequest(
  admin: SupabaseClient,
  requestId: string,
  values: Record<string, unknown>,
) {
  const result = await admin
    .from("account_deletion_requests")
    .update(values)
    .eq("id", requestId);

  if (result.error) {
    throw result.error;
  }
}

async function markDeletionFailure(
  admin: SupabaseClient,
  requestId: string,
  code: string,
) {
  await updateDeletionRequest(admin, requestId, {
    last_error_code: code,
    status: "failed",
  }).catch(() => null);
}

export async function executeAccountDeletion(
  authorization: AuthorizedDeletion,
  now = new Date(),
): Promise<AccountDeletionResult> {
  const admin = getSupabaseAdminClient();

  if (!admin) {
    throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
  }

  const { request, userId } = authorization;
  let applicationResult = request.result ?? {};

  try {
    await updateDeletionRequest(admin, request.id, {
      attempt_count: request.attempt_count + 1,
      last_error_code: null,
    });

    if (!request.sessions_revoked_at) {
      if (authorization.accessToken) {
        const signOut = await admin.auth.admin.signOut(
          authorization.accessToken,
          "global",
        );

        if (signOut.error && !alreadyRevokedError(signOut.error)) {
          throw new Error("ACCOUNT_DELETION_SESSION_REVOCATION_FAILED");
        }
      }

      await updateDeletionRequest(admin, request.id, {
        sessions_revoked_at: now.toISOString(),
        status: "sessions_revoked",
      });
    }

    if (!request.application_data_deleted_at) {
      const applicationDelete = await admin.rpc(
        "delete_account_application_data",
        { p_user_id: userId },
      );

      if (applicationDelete.error) {
        throw new Error("ACCOUNT_DELETION_APPLICATION_DATA_FAILED");
      }

      applicationResult = applicationDelete.data as Record<string, unknown> ??
        {};
      await updateDeletionRequest(admin, request.id, {
        application_data_deleted_at: now.toISOString(),
        result: applicationResult,
        status: "application_data_deleted",
      });
    }

    if (!request.auth_user_deleted_at) {
      const authDelete = await admin.auth.admin.deleteUser(userId, false);

      if (authDelete.error && !missingAuthUserError(authDelete.error)) {
        throw new Error("ACCOUNT_DELETION_AUTH_USER_FAILED");
      }

      await updateDeletionRequest(admin, request.id, {
        auth_user_deleted_at: now.toISOString(),
        status: "auth_user_deleted",
      });
    }

    await updateDeletionRequest(admin, request.id, {
      completed_at: now.toISOString(),
      last_error_code: null,
      result: applicationResult,
      status: "completed",
      token_hash: null,
      user_id: null,
    });

    return {
      requestId: request.id,
      status: "deleted",
    };
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : ACCOUNT_DELETION_UNAVAILABLE;

    await markDeletionFailure(admin, request.id, code);
    throw error;
  }
}
