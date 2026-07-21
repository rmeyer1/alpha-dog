import { NextResponse, type NextRequest } from "next/server";
import { finalizeStatementImport } from "@/lib/account/statement-import-staging";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{ importId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "statement import");
  }

  const { importId } = await context.params;

  try {
    const statementImport = await finalizeStatementImport(auth.supabase, auth.user.id, importId);

    return copyAuthCookies(auth.response, NextResponse.json(statementImport));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Resolve all")) {
      return copyAuthCookies(auth.response, NextResponse.json(
        {
          error: {
            code: "STATEMENT_IMPORT_REVIEW_INCOMPLETE",
            message: error.message,
          },
        },
        { status: 409 },
      ));
    }

    throw error;
  }
}
