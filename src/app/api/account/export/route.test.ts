import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHENTICATED } from "@/lib/supabase/account-session";

const getRequiredAccountSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/account-session", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/supabase/account-session")
  >();

  return {
    ...actual,
    getRequiredAccountSession,
  };
});

import { GET } from "./route";

function request() {
  return new NextRequest("https://alpha-dog.test/api/account/export");
}

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated account session", async () => {
    getRequiredAccountSession.mockResolvedValue({ code: UNAUTHENTICATED });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: UNAUTHENTICATED },
    });
  });

  it("returns a private, versioned JSON attachment for the current user", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profile: { email: "desk@example.com", id: "user-1" },
        presets: [],
      },
      error: null,
    });
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: { rpc },
      user: { id: "user-1" },
    });

    const response = await GET(request());
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("export_account_data");
    expect(document).toMatchObject({
      accountId: "user-1",
      format: "alpha-dog-account-export",
      records: {
        profile: { email: "desk@example.com", id: "user-1" },
      },
      schemaVersion: 1,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="alpha-dog-account-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("returns a generic error when the database export fails", async () => {
    getRequiredAccountSession.mockResolvedValue({
      response: NextResponse.next(),
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "private database detail" },
        }),
      },
      user: { id: "user-1" },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: "ACCOUNT_EXPORT_FAILED",
        message: "Unable to prepare your account export.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private database detail");
  });
});
