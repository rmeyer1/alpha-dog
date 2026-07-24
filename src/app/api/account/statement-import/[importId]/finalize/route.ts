import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import { finalizeStatementImport } from "@/lib/account/statement-import-staging";
import { emitStatementImportTelemetry } from "@/lib/observability/import";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

interface RouteContext {
  params: Promise<{ importId: string }>;
}

async function POSTHandler(request: NextRequest, context: RouteContext) {
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

  try {
    await emitStatementImportTelemetry({
      operation: "statement_import_finalize",
      outcome: "started",
    });
    const statementImport = await finalizeStatementImport(auth.supabase, auth.user.id, importId);
    await emitStatementImportTelemetry({
      alert: true,
      operation: "statement_import_finalize",
      outcome: "finalized",
    });

    return copyAuthCookies(auth.response, NextResponse.json(statementImport));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Resolve all")) {
      await emitStatementImportTelemetry({
        error,
        errorCode: "STATEMENT_IMPORT_REVIEW_INCOMPLETE",
        operation: "statement_import_finalize",
        outcome: "failed",
      });
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

    await emitStatementImportTelemetry({
      alert: true,
      error,
      errorCode: "STATEMENT_IMPORT_FINALIZE_FAILED",
      operation: "statement_import_finalize",
      outcome: "failed",
    });
    throw error;
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/account/statement-import/[importId]/finalize" },
  POSTHandler,
);
