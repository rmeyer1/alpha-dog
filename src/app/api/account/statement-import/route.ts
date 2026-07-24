import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse, type NextRequest } from "next/server";
import { parseBrokerStatementCsv, StatementImportAdapterError } from "@/lib/account/statement-import-adapters";
import { reconcileImportedOptionRows } from "@/lib/account/statement-import-reconciliation";
import {
  createStatementImport,
} from "@/lib/account/statement-import-staging";
import {
  StatementImportFinalizeError,
} from "@/lib/account/statement-import-write";
import { emitStatementImportTelemetry } from "@/lib/observability/import";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";
import {
  authCorrelationIdFromRequest,
  logAuthAccountFailure,
} from "@/lib/supabase/auth-observability";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

async function POSTHandler(request: NextRequest) {
  const correlationId = authCorrelationIdFromRequest(request);
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(
      auth.code,
      "statement import",
      authResponse,
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "STATEMENT_IMPORT_FILE_REQUIRED",
            message: "Upload a broker statement CSV file.",
          },
        },
        { status: 400 },
      ),
    );
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "STATEMENT_IMPORT_FILE_TOO_LARGE",
            message: "CSV file must be 2 MB or smaller.",
          },
        },
        { status: 400 },
      ),
    );
  }

  const csv = await file.text();

  try {
    await emitStatementImportTelemetry({ outcome: "started" });
    const parsed = parseBrokerStatementCsv(csv);
    const groups = reconcileImportedOptionRows(parsed.rows);
    const result = await createStatementImport(
      auth.supabase,
      auth.user.id,
      file.name,
      csv,
      parsed.broker,
      parsed.rows,
      groups,
    );
    await emitStatementImportTelemetry({ outcome: "finalized" });

    return copyAuthCookies(auth.response, NextResponse.json(result));
  } catch (error) {
    if (error instanceof StatementImportAdapterError) {
      await emitStatementImportTelemetry({
        error,
        errorCode: error.code,
        outcome: "failed",
      });
      return copyAuthCookies(
        auth.response,
        NextResponse.json(
          {
            error: {
              code: error.code,
              details: error.details,
              message: error.message,
            },
          },
          { status: 400 },
        ),
      );
    }

    if (error instanceof StatementImportFinalizeError) {
      await emitStatementImportTelemetry({
        alert: true,
        error,
        errorCode: error.code,
        outcome: "failed",
      });
      logAuthAccountFailure({
        code: error.code,
        correlationId,
        operation: "statement_import_finalize",
      });

      return copyAuthCookies(
        auth.response,
        NextResponse.json(
          {
            error: {
              code: error.code,
              correlationId,
              message: error.message,
            },
          },
          { status: 500 },
        ),
      );
    }

    await emitStatementImportTelemetry({
      error,
      errorCode: "STATEMENT_IMPORT_FAILED",
      outcome: "failed",
    });
    throw error;
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/account/statement-import" },
  POSTHandler,
);
