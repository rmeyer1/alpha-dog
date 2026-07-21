import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRobinhoodStatementCsv } from "./statement-import-adapters";
import { reconcileImportedOptionRows } from "./statement-import-reconciliation";
import {
  buildStatementImportWritePlan,
  StatementImportFinalizeError,
  writeStatementImportToPaperAccount,
} from "./statement-import-write";

const header = [
  "Activity Date",
  "Process Date",
  "Settle Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Quantity",
  "Price",
  "Amount",
].join(",");

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll("\"", "\"\"")}"`).join(",");
}

function parseRows(rows: string[][]) {
  return parseRobinhoodStatementCsv([
    header,
    ...rows.map(csvRow),
  ].join("\n")).rows;
}

describe("statement import paper-account write plan", () => {
  it("plans confirmed option groups as simulated positions, legs, and events", () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ],
    ]);
    const groups = reconcileImportedOptionRows(rows);
    const plan = buildStatementImportWritePlan(rows, groups);

    expect(plan.summary).toMatchObject({
      optionPositions: 1,
      reviewGroups: 0,
    });
    expect(plan.optionPositions[0].externalSourceId).toBe("option:0:position");
    expect(plan.optionPositions[0].position).toMatchObject({
      closed_at: "2026-06-10T00:00:00.000Z",
      contracts_opened: 1,
      contracts_remaining: 0,
      expiration_date: "2026-06-26",
      external_source_id: "option:0:position",
      net_credit: 2,
      source: "statement_import",
      status: "closed",
      strategy_type: "short_put",
      symbol: "NVDA",
    });
    expect(plan.optionPositions[0].legs[0]).toMatchObject({
      contract_symbol: "NVDA260626P00200000",
      open_price: 2,
      option_type: "put",
      quantity: 1,
      side: "short",
      strike: 200,
    });
    expect(plan.optionPositions[0].events).toEqual([
      expect.objectContaining({
        cash_delta: 200,
        event_type: "opened",
        price: 2,
        quantity: 1,
        realized_pnl_delta: 0,
      }),
      expect.objectContaining({
        cash_delta: -50,
        event_type: "full_close",
        price: 0.5,
        quantity: 1,
        realized_pnl_delta: 150,
      }),
    ]);
  });

  it("plans open credit spreads as current simulated positions", () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "AAPL 6/26/2026 Call $210.00",
        "STO",
        "1",
        "$1.10",
        "$110.00",
      ],
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "AAPL 6/26/2026 Call $220.00",
        "BTO",
        "1",
        "$0.40",
        "($40.00)",
      ],
    ]);
    const plan = buildStatementImportWritePlan(rows);

    expect(plan.optionPositions[0].position).toMatchObject({
      contracts_remaining: 1,
      net_credit: 0.7,
      status: "open",
      strategy_type: "call_credit_spread",
      symbol: "AAPL",
    });
    expect(plan.optionPositions[0].legs).toHaveLength(2);
    expect(plan.optionPositions[0].events[0]).toMatchObject({
      cash_delta: 70,
      event_type: "opened",
      quantity: 1,
    });
  });

  it("plans stock buys and sells as equity lots without using excluded cash rows", () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "AAPL",
        "Market buy",
        "Buy",
        "10",
        "$200.00",
        "($2,000.00)",
      ],
      [
        "6/3/2026",
        "6/3/2026",
        "6/4/2026",
        "AAPL",
        "Market sell",
        "Sell",
        "4",
        "$210.00",
        "$840.00",
      ],
      [
        "6/4/2026",
        "6/4/2026",
        "6/4/2026",
        "",
        "ACH deposit",
        "ACH",
        "",
        "",
        "$5,000.00",
      ],
    ]);
    const plan = buildStatementImportWritePlan(rows);

    expect(plan.equityLots).toEqual([
      {
        acquiredAt: "2026-06-01T00:00:00.000Z",
        costBasis: 200,
        rowIndex: 0,
        shares: 10,
        symbol: "AAPL",
      },
      {
        acquiredAt: "2026-06-03T00:00:00.000Z",
        costBasis: 210,
        rowIndex: 1,
        shares: -4,
        symbol: "AAPL",
      },
    ]);
    expect(plan.summary).toMatchObject({
      equityLots: 2,
      excludedRows: 1,
      optionPositions: 0,
    });
  });

  it("tracks dividends for reporting and keeps ambiguous option groups in review", () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "Cash dividend",
        "CDIV",
        "",
        "",
        "$12.00",
      ],
      [
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "Unsupported option memo",
        "STO",
        "1",
        "$0.50",
        "$50.00",
      ],
    ]);
    const plan = buildStatementImportWritePlan(rows);

    expect(plan.dividendRows).toHaveLength(1);
    expect(plan.reviewGroups).toHaveLength(1);
    expect(plan.summary).toMatchObject({
      dividendsTracked: 1,
      optionPositions: 0,
      reviewGroups: 1,
    });
  });

  it("finalizes planned ledger records through one atomic RPC with source fingerprints", async () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
      [
        "6/3/2026",
        "6/3/2026",
        "6/4/2026",
        "AAPL",
        "Market buy",
        "Buy",
        "10",
        "$200.00",
        "($2,000.00)",
      ],
    ]);
    const calls: Array<{ args: Record<string, unknown>; name: string }> = [];
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ args, name });

        return {
          data: {
            insertedEquityLots: 1,
            insertedEvents: 1,
            insertedPositions: 1,
            skippedEquityLots: 0,
            skippedPositions: 0,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const result = await writeStatementImportToPaperAccount(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      rows,
      reconcileImportedOptionRows(rows),
      "robinhood",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("finalize_statement_import_atomic");
    expect(calls[0].args.p_user_id).toBe("00000000-0000-0000-0000-000000000001");

    const positions = calls[0].args.p_positions as Array<{
      events: Array<{ metadata: { idempotencyKey: string; sourceFingerprint: string } }>;
      externalSourceId: string;
      position: { external_source_id: string };
    }>;
    const lots = calls[0].args.p_equity_lots as Array<{ sourceFingerprint: string }>;

    expect(positions).toHaveLength(1);
    expect(positions[0].externalSourceId).toMatch(/^[a-f0-9]{64}$/);
    expect(positions[0].position.external_source_id).toBe(positions[0].externalSourceId);
    expect(positions[0].events[0].metadata.sourceFingerprint).toBe(positions[0].externalSourceId);
    expect(positions[0].events[0].metadata.idempotencyKey).toContain(positions[0].externalSourceId);
    expect(lots[0].sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toMatchObject({
      insertedEquityLots: 1,
      insertedEvents: 1,
      insertedPositions: 1,
      skippedEquityLots: 0,
      skippedPositions: 0,
    });
  });

  it("keeps a position fingerprint stable when later lifecycle rows are present", async () => {
    const openRow = [
      "6/1/2026",
      "6/1/2026",
      "6/2/2026",
      "NVDA",
      "NVDA 6/26/2026 Put $200.00",
      "STO",
      "1",
      "$2.00",
      "$200.00",
    ];
    const closeRow = [
      "6/10/2026",
      "6/10/2026",
      "6/11/2026",
      "NVDA",
      "NVDA 6/26/2026 Put $200.00",
      "BTC",
      "1",
      "$0.50",
      "($50.00)",
    ];
    const fingerprints: string[] = [];
    const supabase = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        const positions = args.p_positions as Array<{ externalSourceId: string }>;
        fingerprints.push(positions[0].externalSourceId);

        return {
          data: {
            insertedEquityLots: 0,
            insertedEvents: positions.length,
            insertedPositions: positions.length,
            skippedEquityLots: 0,
            skippedPositions: 0,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const openRows = parseRows([openRow]);
    const closedRows = parseRows([openRow, closeRow]);

    await writeStatementImportToPaperAccount(supabase, "user-1", openRows);
    await writeStatementImportToPaperAccount(supabase, "user-1", closedRows);

    expect(fingerprints).toHaveLength(2);
    expect(fingerprints[1]).toBe(fingerprints[0]);
  });

  it("assigns distinct stable fingerprints to identical equity transactions", async () => {
    const equityRow = [
      "6/3/2026",
      "6/3/2026",
      "6/4/2026",
      "AAPL",
      "Market buy",
      "Buy",
      "10",
      "$200.00",
      "($2,000.00)",
    ];
    const fingerprintSets: string[][] = [];
    const supabase = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        const lots = args.p_equity_lots as Array<{ sourceFingerprint: string }>;
        fingerprintSets.push(lots.map((lot) => lot.sourceFingerprint));

        return {
          data: {
            insertedEquityLots: lots.length,
            insertedEvents: 0,
            insertedPositions: 0,
            skippedEquityLots: 0,
            skippedPositions: 0,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    const rows = parseRows([equityRow, equityRow]);

    await writeStatementImportToPaperAccount(supabase, "user-1", rows);
    await writeStatementImportToPaperAccount(supabase, "user-1", rows);

    expect(new Set(fingerprintSets[0]).size).toBe(2);
    expect(fingerprintSets[1]).toEqual(fingerprintSets[0]);
  });

  it("surfaces RPC failures as safe finalization errors", async () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
    ]);
    const supabase = {
      rpc: async () => ({
        data: null,
        error: { message: "duplicate key value includes sensitive raw row" },
      }),
    } as unknown as SupabaseClient;

    await expect(writeStatementImportToPaperAccount(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      rows,
      reconcileImportedOptionRows(rows),
      "robinhood",
    )).rejects.toMatchObject({
      code: "STATEMENT_IMPORT_FINALIZE_FAILED",
      message: "Unable to finalize statement import.",
    } satisfies Partial<StatementImportFinalizeError>);
  });

  it("rejects malformed RPC success payloads instead of reporting zero inserts", async () => {
    const rows = parseRows([
      [
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ],
    ]);
    const supabase = {
      rpc: async () => ({ data: {}, error: null }),
    } as unknown as SupabaseClient;

    await expect(writeStatementImportToPaperAccount(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      rows,
    )).rejects.toMatchObject({
      code: "STATEMENT_IMPORT_FINALIZE_FAILED",
      message: "Unable to finalize statement import.",
    } satisfies Partial<StatementImportFinalizeError>);
  });
});
