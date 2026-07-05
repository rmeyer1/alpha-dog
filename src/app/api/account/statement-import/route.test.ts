import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const writeStatementImportToPaperAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/statement-import-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account/statement-import-write")>();

  return {
    ...actual,
    writeStatementImportToPaperAccount,
  };
});

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

function importRequest(csv: string) {
  const formData = new FormData();
  formData.set("file", new File([csv], "robinhood.csv", { type: "text/csv" }));

  return new Request("https://alpha-dog.test/api/account/statement-import", {
    body: formData,
    method: "POST",
  });
}

describe("POST /api/account/statement-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeStatementImportToPaperAccount.mockResolvedValue({
      insertedEquityLots: 0,
      insertedEvents: 2,
      insertedPositions: 1,
      skippedEquityLots: 0,
      skippedPositions: 0,
      summary: {},
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(importRequest(header));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(writeStatementImportToPaperAccount).not.toHaveBeenCalled();
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
    expect(writeStatementImportToPaperAccount).toHaveBeenCalledWith(
      supabase,
      "user-1",
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
    writeStatementImportToPaperAccount.mockResolvedValue({
      insertedEquityLots: 0,
      insertedEvents: 0,
      insertedPositions: 0,
      skippedEquityLots: 0,
      skippedPositions: 0,
      summary: {},
    });

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
});

