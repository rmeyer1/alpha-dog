import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const finalizeStatementImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/statement-import-staging", () => ({
  finalizeStatementImport,
}));

function request() {
  return new Request("https://alpha-dog.test/api/account/statement-import/import-1/finalize", {
    method: "POST",
  });
}

describe("POST /api/account/statement-import/:importId/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finalizeStatementImport.mockResolvedValue({
      importId: "import-1",
      status: "imported",
      summary: { importedRecords: 1, reviewGroups: 0 },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await POST(request(), { params: Promise.resolve({ importId: "import-1" }) });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(finalizeStatementImport).not.toHaveBeenCalled();
  });

  it("finalizes eligible groups for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await POST(request(), { params: Promise.resolve({ importId: "import-1" }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(finalizeStatementImport).toHaveBeenCalledWith(supabase, "user-1", "import-1");
    expect(json.status).toBe("imported");
  });

  it("returns a conflict while review groups remain unresolved", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });
    finalizeStatementImport.mockRejectedValue(
      new Error("Resolve all statement import review groups before finalizing."),
    );

    const response = await POST(request(), { params: Promise.resolve({ importId: "import-1" }) });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe("STATEMENT_IMPORT_REVIEW_INCOMPLETE");
  });
});
