import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { parseBrokerStatementCsv } from "./statement-import-adapters";
import { reconcileImportedOptionRows } from "./statement-import-reconciliation";
import {
  createStatementImport,
  decideStatementImportGroup,
  StatementImportReviewDecisionError,
} from "./statement-import-staging";
import { buildStatementImportWritePlan } from "./statement-import-write";

type QueryResult = { data: unknown; error: unknown };

function supabaseWithResults(results: Record<string, QueryResult[]>) {
  const calls: Array<{ args: unknown[]; method: string; table: string }> = [];

  function nextResult(table: string) {
    const result = results[table]?.shift();

    if (!result) {
      throw new Error(`Missing mock result for ${table}.`);
    }

    return result;
  }

  function builder(table: string) {
    const query = {
      delete(...args: unknown[]) {
        calls.push({ args, method: "delete", table });
        return query;
      },
      eq(...args: unknown[]) {
        calls.push({ args, method: "eq", table });
        return query;
      },
      in(...args: unknown[]) {
        calls.push({ args, method: "in", table });
        return query;
      },
      insert(...args: unknown[]) {
        calls.push({ args, method: "insert", table });
        return query;
      },
      maybeSingle() {
        calls.push({ args: [], method: "maybeSingle", table });
        return Promise.resolve(nextResult(table));
      },
      neq(...args: unknown[]) {
        calls.push({ args, method: "neq", table });
        return query;
      },
      order(...args: unknown[]) {
        calls.push({ args, method: "order", table });
        return Promise.resolve(nextResult(table));
      },
      select(...args: unknown[]) {
        calls.push({ args, method: "select", table });
        return query;
      },
      single() {
        calls.push({ args: [], method: "single", table });
        return Promise.resolve(nextResult(table));
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(nextResult(table)).then(onfulfilled, onrejected);
      },
      update(...args: unknown[]) {
        calls.push({ args, method: "update", table });
        return query;
      },
    };

    return query;
  }

  return {
    calls,
    supabase: {
      from(table: string) {
        calls.push({ args: [], method: "from", table });
        return builder(table);
      },
    } as unknown as SupabaseClient,
  };
}

const primaryCsv = readFileSync(
  "src/lib/account/fixtures/robinhood-statement-primary.csv",
  "utf8",
);

describe("statement import staging", () => {
  it("removes an incomplete parent import when staging rows fails", async () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const groups = reconcileImportedOptionRows(parsed.rows);
    const { calls, supabase } = supabaseWithResults({
      statement_import_rows: [
        { data: [], error: null },
        { data: null, error: { message: "insert failed" } },
      ],
      statement_imports: [
        { data: null, error: null },
        {
          data: {
            broker: parsed.broker,
            file_hash: "file-hash",
            file_name: "statement.csv",
            id: "import-1",
            status: "needs_review",
            summary: {},
          },
          error: null,
        },
        { data: null, error: null },
      ],
    });

    await expect(createStatementImport(
      supabase,
      "user-1",
      "statement.csv",
      primaryCsv,
      parsed.broker,
      parsed.rows,
      groups,
    )).rejects.toThrow("Unable to stage statement import rows.");

    expect(calls).toEqual(expect.arrayContaining([
      { args: [], method: "delete", table: "statement_imports" },
      { args: ["id", "import-1"], method: "eq", table: "statement_imports" },
    ]));
  });

  it("restores rejected rows and a stable position key when confirming", async () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const confirmableGroup = reconcileImportedOptionRows(parsed.rows)
      .find((group) => group.status === "confirmed");

    expect(confirmableGroup).toBeDefined();

    const metadata = {
      ...confirmableGroup!,
      paperPositionKey: null,
      status: "needs_review" as const,
    };
    const { calls, supabase } = supabaseWithResults({
      statement_import_review_audit: [{ data: null, error: null }],
      statement_import_rows: [
        { data: null, error: null },
        { data: [], error: null },
      ],
      statement_imports: [{
        data: {
          broker: parsed.broker,
          file_hash: "file-hash",
          file_name: "statement.csv",
          id: "import-1",
          status: "needs_review",
          summary: {},
        },
        error: null,
      }],
      statement_reconciliation_groups: [
        { data: { metadata, status: "rejected" }, error: null },
        { data: null, error: null },
        { data: [], error: null },
      ],
    });

    await decideStatementImportGroup(
      supabase,
      "user-1",
      "import-1",
      "group-1",
      "confirmed",
    );

    const groupUpdate = calls.find((call) =>
      call.table === "statement_reconciliation_groups" && call.method === "update"
    );
    const rowUpdate = calls.find((call) =>
      call.table === "statement_import_rows" && call.method === "update"
    );

    expect(groupUpdate?.args[0]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        paperPositionKey: `${metadata.groupKey}:position`,
        status: "confirmed",
      }),
      status: "confirmed",
    }));
    expect(rowUpdate?.args[0]).toEqual({ status: "staged" });
    const updatedMetadata = (groupUpdate?.args[0] as {
      metadata: typeof metadata;
    }).metadata;

    expect(buildStatementImportWritePlan(parsed.rows, [updatedMetadata]).optionPositions)
      .toHaveLength(1);
    expect(calls).toEqual(expect.arrayContaining([
      { args: ["status", "duplicate"], method: "neq", table: "statement_import_rows" },
    ]));
  });

  it("refuses to confirm groups without normalized legs and events", async () => {
    const parsed = parseBrokerStatementCsv(primaryCsv);
    const incompleteGroup = reconcileImportedOptionRows(parsed.rows)
      .find((group) => group.status === "needs_review");

    expect(incompleteGroup).toBeDefined();

    const { supabase } = supabaseWithResults({
      statement_reconciliation_groups: [{
        data: { metadata: incompleteGroup, status: "needs_review" },
        error: null,
      }],
    });

    await expect(decideStatementImportGroup(
      supabase,
      "user-1",
      "import-1",
      "group-1",
      "confirmed",
    )).rejects.toBeInstanceOf(StatementImportReviewDecisionError);
  });
});
