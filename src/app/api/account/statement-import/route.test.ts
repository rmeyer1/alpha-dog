import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatementImportFinalizeError } from "@/lib/account/statement-import-write";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const createStatementImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/statement-import-staging", () => ({
  createStatementImport,
}));

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

function importRequest(csv: string, headers?: HeadersInit) {
  const formData = new FormData();
  formData.set("file", new File([csv], "robinhood.csv", { type: "text/csv" }));

  return new Request("https://alpha-dog.test/api/account/statement-import", {
    body: formData,
    headers,
    method: "POST",
  });
}

function importPayload(overrides: Record<string, unknown> = {}) {
  return {
    broker: "robinhood",
    fileHash: "file-hash",
    fileName: "robinhood.csv",
    importId: "import-1",
    isDuplicate: false,
    reviewGroups: [],
    status: "imported",
    summary: {
      dividendsTracked: 0,
      duplicateRows: 0,
      equityLots: 0,
      excludedRows: 0,
      failedRecords: 0,
      ignoredRows: 0,
      importedRecords: 1,
      insertedEquityLots: 0,
      insertedEvents: 2,
      insertedPositions: 1,
      optionPositions: 1,
      rejectedGroups: 0,
      reviewGroups: 0,
      skippedDuplicates: 0,
      stagedRows: 0,
      ...((overrides.summary as Record<string, unknown> | undefined) ?? {}),
    },
    ...overrides,
  };
}

describe("POST /api/account/statement-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStatementImport.mockResolvedValue(importPayload());
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(importRequest(header));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(createStatementImport).not.toHaveBeenCalled();
  });

  it("rejects missing CSV uploads", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await POST(new Request("https://alpha-dog.test/api/account/statement-import", {
      body: new FormData(),
      method: "POST",
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("STATEMENT_IMPORT_FILE_REQUIRED");
  });

  it("imports high-confidence statement rows and returns summary counts", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const csv = [
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ]),
      csvRow([
        "6/10/2026",
        "6/10/2026",
        "6/11/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "BTC",
        "1",
        "$0.50",
        "($50.00)",
      ]),
    ].join("\n");

    const response = await POST(importRequest(csv));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(createStatementImport).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "robinhood.csv",
      expect.stringContaining("Activity Date"),
      "robinhood",
      expect.arrayContaining([
        expect.objectContaining({ classification: "option" }),
      ]),
      expect.arrayContaining([
        expect.objectContaining({ status: "confirmed" }),
      ]),
    );
    expect(json.summary).toMatchObject({
      importedRecords: 1,
      insertedEvents: 2,
      insertedPositions: 1,
      optionPositions: 1,
      reviewGroups: 0,
      skippedDuplicates: 0,
    });
  });

  it("returns low-confidence groups without importing them", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });
    createStatementImport.mockResolvedValue(importPayload({
      reviewGroups: [
        {
          confidence: 0.2,
          decision: null,
          explanation: ["Option row is missing normalized contract, activity, quantity, or cash movement."],
          groupId: "group-1",
          groupKey: "review:0",
          reviewReason: "Option row is missing normalized contract, activity, quantity, or cash movement.",
          sourceRowIndexes: [0],
          status: "needs_review",
          strategyType: "unknown",
          symbol: "NVDA",
        },
      ],
      status: "needs_review",
      summary: { importedRecords: 0, insertedEvents: 0, insertedPositions: 0, optionPositions: 0, reviewGroups: 1, stagedRows: 1 },
    }));

    const csv = [
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "Unsupported option memo",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ]),
    ].join("\n");

    const response = await POST(importRequest(csv));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.summary.reviewGroups).toBe(1);
    expect(json.reviewGroups).toEqual([
      expect.objectContaining({
        reviewReason: "Option row is missing normalized contract, activity, quantity, or cash movement.",
        sourceRowIndexes: [0],
      }),
    ]);
  });
  it("returns a safe correlation id when finalization fails", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });
    createStatementImport.mockRejectedValue(
      new StatementImportFinalizeError(
        "STATEMENT_IMPORT_FINALIZE_FAILED",
        "Unable to finalize statement import.",
      ),
    );

    const csv = [
      header,
      csvRow([
        "6/1/2026",
        "6/1/2026",
        "6/2/2026",
        "NVDA",
        "NVDA 6/26/2026 Put $200.00",
        "STO",
        "1",
        "$2.00",
        "$200.00",
      ]),
    ].join("\n");

    const response = await POST(importRequest(csv));
    const json = await response.json();
    const correlationId = response.headers.get(
      "x-alpha-dog-correlation-id",
    );

    expect(response.status).toBe(500);
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.error).toEqual({
      code: "STATEMENT_IMPORT_FINALIZE_FAILED",
      correlationId,
      message: "Unable to finalize statement import.",
    });
  });
});
