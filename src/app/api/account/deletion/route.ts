import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_COOKIE,
  ACCOUNT_DELETION_INVALID_CONFIRMATION,
  ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED,
  ACCOUNT_DELETION_RETRY_EXPIRED,
  ACCOUNT_DELETION_RETRY_HOURS,
  ACCOUNT_DELETION_UNAVAILABLE,
  authorizeAccountDeletion,
  executeAccountDeletion,
  type AccountDeletionAuthorization,
} from "@/lib/account/data-lifecycle";
import { copyAuthCookies } from "@/lib/supabase/account-session";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  acknowledgedIrreversible: z.literal(true),
  confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION),
  email: z.string().email().max(320),
}).strict();

function deletionCookie(
  response: NextResponse,
  value: string,
  maxAge = ACCOUNT_DELETION_RETRY_HOURS * 60 * 60,
) {
  response.cookies.set(ACCOUNT_DELETION_COOKIE, value, {
    httpOnly: true,
    maxAge,
    path: "/api/account/deletion",
    priority: "high",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

function errorResponse(
  code:
    | typeof ACCOUNT_DELETION_INVALID_CONFIRMATION
    | typeof ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED
    | typeof ACCOUNT_DELETION_RETRY_EXPIRED
    | typeof ACCOUNT_DELETION_UNAVAILABLE,
) {
  const status = code === ACCOUNT_DELETION_INVALID_CONFIRMATION
    ? 400
    : code === ACCOUNT_DELETION_UNAVAILABLE
      ? 503
      : 401;
  const message = code === ACCOUNT_DELETION_INVALID_CONFIRMATION
    ? `Enter your account email and the exact phrase ${ACCOUNT_DELETION_CONFIRMATION}.`
    : code === ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED
      ? "Sign out and sign back in, then retry within 10 minutes."
      : code === ACCOUNT_DELETION_RETRY_EXPIRED
        ? "The deletion retry authorization expired. Sign in again to restart."
        : "Account deletion is temporarily unavailable.";

  return NextResponse.json(
    {
      error: {
        code,
        message,
        retryable: code === ACCOUNT_DELETION_UNAVAILABLE,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
      status,
    },
  );
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

async function POSTHandler(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      {
        error: {
          code: "ACCOUNT_DELETION_ORIGIN_REJECTED",
          message: "Account deletion must be requested from this application.",
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
        status: 403,
      },
    );
  }

  const input = requestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!input.success) {
    return errorResponse(ACCOUNT_DELETION_INVALID_CONFIRMATION);
  }

  const authResponse = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, authResponse);
  const auth = supabase
    ? await supabase.auth.getUser().catch(() => ({
        data: { user: null },
        error: null,
      }))
    : { data: { user: null }, error: null };
  const retryCookie = request.cookies.get(ACCOUNT_DELETION_COOKIE)?.value;
  const authorization: AccountDeletionAuthorization =
    await authorizeAccountDeletion({
    input: input.data,
    retryCookie,
    supabase,
    user: auth.error ? null : auth.data.user,
  }).catch(() => ({
    code: ACCOUNT_DELETION_UNAVAILABLE,
    status: "error" as const,
  }));

  if (authorization.status === "error") {
    const response = errorResponse(authorization.code);

    if (authorization.code === ACCOUNT_DELETION_RETRY_EXPIRED) {
      deletionCookie(response, "", 0);
    }

    return copyAuthCookies(authResponse, response);
  }

  try {
    const result = await executeAccountDeletion(authorization);
    const response = NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });

    deletionCookie(response, "", 0);
    await supabase?.auth.signOut({ scope: "local" }).catch(() => null);

    return copyAuthCookies(authResponse, response);
  } catch {
    const response = errorResponse(ACCOUNT_DELETION_UNAVAILABLE);

    deletionCookie(response, authorization.retryToken);

    return copyAuthCookies(authResponse, response);
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/account/deletion" },
  POSTHandler,
);
