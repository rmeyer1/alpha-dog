import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { PATCH } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const decideStatementImportGroup = vi.hoisted(() => vi.fn());
const StatementImportReviewDecisionError = vi.hoisted(() =>
  class StatementImportReviewDecisionError extends Error {
    readonly code = "STATEMENT_IMPORT_GROUP_NOT_CONFIRMABLE";
  }
);

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/account-session")>();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

vi.mock("@/lib/account/statement-import-staging", () => ({
  decideStatementImportGroup,
  StatementImportReviewDecisionError,
}));

function request(body: unknown) {
  return new Request("https://alpha-dog.test/api/account/statement-import/import-1/groups/group-1", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

const context = {
  params: Promise.resolve({ groupId: "group-1", importId: "import-1" }),
};

describe("PATCH /api/account/statement-import/:importId/groups/:groupId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decideStatementImportGroup.mockResolvedValue({
      importId: "import-1",
      reviewGroups: [{ decision: "confirmed", groupId: "group-1" }],
      status: "needs_review",
      summary: { reviewGroups: 0 },
    });
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await PATCH(request({ decision: "confirmed" }), context);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe(UNAUTHENTICATED);
    expect(decideStatementImportGroup).not.toHaveBeenCalled();
  });

  it("rejects invalid decisions", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const response = await PATCH(request({ decision: "maybe" }), context);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_REVIEW_DECISION");
    expect(decideStatementImportGroup).not.toHaveBeenCalled();
  });

  it("persists a review decision for the authenticated user", async () => {
    const supabase = {};
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase,
      user: { id: "user-1" },
    });

    const response = await PATCH(request({ decision: "confirmed" }), context);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(decideStatementImportGroup).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "import-1",
      "group-1",
      "confirmed",
    );
    expect(json.reviewGroups[0].decision).toBe("confirmed");
  });

  it("returns a conflict when a review group cannot be confirmed", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });
    decideStatementImportGroup.mockRejectedValue(
      new StatementImportReviewDecisionError("Reject this incomplete group instead."),
    );

    const response = await PATCH(request({ decision: "confirmed" }), context);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error.code).toBe("STATEMENT_IMPORT_GROUP_NOT_CONFIRMABLE");
  });
});
