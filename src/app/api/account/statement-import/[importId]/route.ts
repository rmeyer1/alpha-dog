import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import { loadStatementImport } from "@/lib/account/statement-import-staging";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{ importId: string }>;
}

async function GETHandler(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "statement import",
      authResponse,
    );
  }

  const { importId } = await context.params;
  const statementImport = await loadStatementImport(auth.supabase, auth.user.id, importId);

  if (!statementImport) {
    return copyAuthCookies(auth.response, NextResponse.json(
      {
        error: {
          code: "STATEMENT_IMPORT_NOT_FOUND",
          message: "Statement import was not found.",
        },
      },
      { status: 404 },
    ));
  }

  return copyAuthCookies(auth.response, NextResponse.json(statementImport));
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/account/statement-import/[importId]" },
  GETHandler,
);
