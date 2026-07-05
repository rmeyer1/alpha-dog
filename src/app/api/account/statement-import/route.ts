import { NextResponse, type NextRequest } from "next/server";
import { parseBrokerStatementCsv, StatementImportAdapterError } from "@/lib/account/statement-import-adapters";
import { reconcileImportedOptionRows } from "@/lib/account/statement-import-reconciliation";
import {
  buildStatementImportWritePlan,
  writeStatementImportToPaperAccount,
} from "@/lib/account/statement-import-write";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function reviewGroupsForResponse(
  groups: ReturnType<typeof reconcileImportedOptionRows>,
) {
  return groups
    .filter((group) => group.status === "needs_review")
    .map((group) => ({
      confidence: group.confidence,
      explanation: group.explanation,
      groupKey: group.groupKey,
      reviewReason: group.reviewReason,
      sourceRowIndexes: group.sourceRowIndexes,
      strategyType: group.strategyType,
      symbol: group.symbol,
    }));
}

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
    const plan = buildStatementImportWritePlan(parsed.rows, groups);
    const result = await writeStatementImportToPaperAccount(
      auth.supabase,
      auth.user.id,
      parsed.rows,
      groups,
    );

    return copyAuthCookies(auth.response, NextResponse.json({
      broker: parsed.broker,
      fileName: file.name,
      reviewGroups: reviewGroupsForResponse(groups),
      summary: {
        dividendsTracked: plan.summary.dividendsTracked,
        equityLots: plan.summary.equityLots,
        excludedRows: plan.summary.excludedRows,
        ignoredRows: plan.summary.excludedRows,
        importedRecords: result.insertedPositions + result.insertedEquityLots,
        insertedEquityLots: result.insertedEquityLots,
        insertedEvents: result.insertedEvents,
        insertedPositions: result.insertedPositions,
        optionPositions: plan.summary.optionPositions,
        reviewGroups: plan.summary.reviewGroups,
        skippedDuplicates: result.skippedPositions + result.skippedEquityLots,
      },
    }));
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

