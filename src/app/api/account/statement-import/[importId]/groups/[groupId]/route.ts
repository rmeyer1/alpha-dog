import { NextResponse, type NextRequest } from "next/server";
import {
  decideStatementImportGroup,
  StatementImportReviewDecisionError,
} from "@/lib/account/statement-import-staging";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{ groupId: string; importId: string }>;
}

function isDecision(value: unknown): value is "confirmed" | "rejected" {
  return value === "confirmed" || value === "rejected";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "statement import",
      authResponse,
    );
  }

  const body = await request.json().catch(() => null) as { decision?: unknown } | null;

  if (!isDecision(body?.decision)) {
    return copyAuthCookies(auth.response, NextResponse.json(
      {
        error: {
          code: "INVALID_REVIEW_DECISION",
          message: "Review decision must be confirmed or rejected.",
        },
      },
      { status: 400 },
    ));
  }

  const { groupId, importId } = await context.params;
  try {
    const statementImport = await decideStatementImportGroup(
      auth.supabase,
      auth.user.id,
      importId,
      groupId,
      body.decision,
    );

    return copyAuthCookies(auth.response, NextResponse.json(statementImport));
  } catch (error) {
    if (error instanceof StatementImportReviewDecisionError) {
      return copyAuthCookies(auth.response, NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: 409 },
      ));
    }

    throw error;
  }
}
