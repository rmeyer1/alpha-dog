import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { GET } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const loadStatementImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/statement-import-staging", () => ({
  loadStatementImport,
}));

function request() {
  return new Request("https://alpha-dog.test/api/account/statement-import/import-1");
}

describe("GET /api/account/statement-import/:importId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadStatementImport.mockResolvedValue({
      broker: "robinhood",
      fileName: "robinhood.csv",
      importId: "import-1",
      reviewGroups: [],
      status: "needs_review",
      summary: { reviewGroups: 1 },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await GET(request(), { params: Promise.resolve({ importId: "import-1" }) });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(loadStatementImport).not.toHaveBeenCalled();
  });

  it("loads an import for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await GET(request(), { params: Promise.resolve({ importId: "import-1" }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(loadStatementImport).toHaveBeenCalledWith(supabase, "user-1", "import-1");
    expect(json.importId).toBe("import-1");
  });
});
