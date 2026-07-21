import { NextResponse, type NextRequest } from "next/server";
import { parseBrokerStatementCsv, StatementImportAdapterError } from "@/lib/account/statement-import-adapters";
import { reconcileImportedOptionRows } from "@/lib/account/statement-import-reconciliation";
import {
  createStatementImport,
} from "@/lib/account/statement-import-staging";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "statement import");
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error: {
          code: "STATEMENT_IMPORT_FILE_REQUIRED",
          message: "Upload a broker statement CSV file.",
        },
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "STATEMENT_IMPORT_FILE_TOO_LARGE",
          message: "CSV file must be 2 MB or smaller.",
        },
      },
      { status: 400 },
    );
  }

  const csv = await file.text();

  try {
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

    return copyAuthCookies(auth.response, NextResponse.json(result));
  } catch (error) {
    if (error instanceof StatementImportAdapterError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            details: error.details,
            message: error.message,
          },
        },
        { status: 400 },
      );
    }

    throw error;
  }
}
