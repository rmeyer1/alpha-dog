import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";
import { POST } from "./route";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());
const finalizeStatementImport = vi.hoisted(() => vi.fn());
const getSupabaseAdminClient = vi.hoisted(() => vi.fn());
const waitUntil = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient,
}));
vi.mock("@vercel/functions", () => ({
  waitUntil,
}));

import {
  flushScheduledAlertSamplesForTests,
} from "@/lib/observability/alert-control-plane";

function request() {
  return new Request("https://alpha-dog.test/api/account/statement-import/import-1/finalize", {
    method: "POST",
  });
}

describe("POST /api/account/statement-import/:importId/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAdminClient.mockReturnValue(null);
    finalizeStatementImport.mockResolvedValue({
      importId: "import-1",
      status: "imported",
      summary: { importedRecords: 1, reviewGroups: 0 },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("traverses trigger, deduplication, and recovery through the real route adapter", async () => {
    vi.stubEnv("ALPHA_DOG_TEST_ALERT_CONTROL_PLANE", "true");
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {},
      user: { id: "user-1" },
    });

    const alertEvents = [
      [{
        alert_key: "import_finalization_failure",
        event_id: crypto.randomUUID(),
        outcome: "triggered",
        severity: "error",
      }],
      [],
      [{
        alert_key: "import_finalization_failure",
        event_id: crypto.randomUUID(),
        outcome: "recovered",
        severity: "info",
      }],
    ];
    const rpc = vi.fn(async () => ({
      data: alertEvents.shift() ?? [],
      error: null,
    }));
    getSupabaseAdminClient.mockReturnValue({ rpc });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    finalizeStatementImport
      .mockRejectedValueOnce(new Error("first finalization failure"))
      .mockRejectedValueOnce(new Error("duplicate finalization failure"))
      .mockResolvedValueOnce({
        importId: "import-1",
        status: "imported",
        summary: { importedRecords: 1, reviewGroups: 0 },
      });

    const firstFailure = await POST(request(), {
      params: Promise.resolve({ importId: "import-1" }),
    });
    const duplicateFailure = await POST(request(), {
      params: Promise.resolve({ importId: "import-1" }),
    });
    const recovery = await POST(request(), {
      params: Promise.resolve({ importId: "import-1" }),
    });

    await flushScheduledAlertSamplesForTests();

    expect(firstFailure.status).toBe(500);
    expect(duplicateFailure.status).toBe(500);
    expect(recovery.status).toBe(200);
    expect(rpc.mock.calls.map(([, parameters]) => parameters.p_value)).toEqual([
      1,
      1,
      0,
    ]);
    expect(waitUntil).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"alertKey":"import_finalization_failure"'),
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"recovered"'),
    );

    error.mockRestore();
    info.mockRestore();
  });
});
