import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeAccountDeletion: vi.fn(),
  createSupabaseRouteClient: vi.fn(),
  executeAccountDeletion: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/account/data-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/account/data-lifecycle")
  >();

  return {
    ...actual,
    authorizeAccountDeletion: mocks.authorizeAccountDeletion,
    executeAccountDeletion: mocks.executeAccountDeletion,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseRouteClient: mocks.createSupabaseRouteClient,
}));

import { POST } from "./route";

const body = {
  acknowledgedIrreversible: true,
  confirmation: "DELETE MY ACCOUNT",
  email: "desk@example.com",
};

function request(
  requestBody: unknown = body,
  {
    cookie,
    origin = "https://alpha-dog.test",
  }: {
    cookie?: string;
    origin?: string;
  } = {},
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: origin,
  });

  if (cookie) {
    headers.set("Cookie", cookie);
  }

  return new NextRequest("https://alpha-dog.test/api/account/deletion", {
    body: JSON.stringify(requestBody),
    headers,
    method: "POST",
  });
}

function malformedRequest() {
  return new NextRequest("https://alpha-dog.test/api/account/deletion", {
    body: "{",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://alpha-dog.test",
    },
    method: "POST",
  });
}

describe("POST /api/account/deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createSupabaseRouteClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
        signOut: mocks.signOut,
      },
    });
    mocks.authorizeAccountDeletion.mockResolvedValue({
      accessToken: "access-token",
      request: { id: "request-1" },
      retryToken: "retry-token",
      status: "authorized",
      userId: "user-1",
    });
    mocks.executeAccountDeletion.mockResolvedValue({
      requestId: "request-1",
      status: "deleted",
    });
  });

  it("rejects cross-origin requests before authentication", async () => {
    const response = await POST(request(body, {
      origin: "https://evil.example",
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.createSupabaseRouteClient).not.toHaveBeenCalled();
    expect(mocks.authorizeAccountDeletion).not.toHaveBeenCalled();
  });

  it("rejects requests without an Origin header", async () => {
    const incoming = request();
    incoming.headers.delete("origin");

    const response = await POST(incoming);

    expect(response.status).toBe(403);
    expect(mocks.createSupabaseRouteClient).not.toHaveBeenCalled();
    expect(mocks.authorizeAccountDeletion).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...body, acknowledgedIrreversible: false }],
    [{ ...body, confirmation: "delete my account" }],
    [{ ...body, email: "not-an-email" }],
    [{ confirmation: body.confirmation, email: body.email }],
  ])("requires the complete exact confirmation contract", async (invalidBody) => {
    const response = await POST(request(invalidBody));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "ACCOUNT_DELETION_INVALID_CONFIRMATION" },
    });
    expect(mocks.authorizeAccountDeletion).not.toHaveBeenCalled();
  });

  it("contains malformed JSON before protected work", async () => {
    const response = await POST(malformedRequest());

    expect(response.status).toBe(400);
    expect(mocks.authorizeAccountDeletion).not.toHaveBeenCalled();
  });

  it("contains authoritative-user lookup failures", async () => {
    mocks.getUser.mockRejectedValue(new Error("Auth unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.authorizeAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ user: null }),
    );
  });

  it("contains deletion-authorization service failures", async () => {
    mocks.authorizeAccountDeletion.mockRejectedValue(
      new Error("authorization store unavailable"),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "ACCOUNT_DELETION_UNAVAILABLE" },
    });
    expect(mocks.executeAccountDeletion).not.toHaveBeenCalled();
  });

  it("returns a reauthentication challenge without deleting data", async () => {
    mocks.authorizeAccountDeletion.mockResolvedValue({
      code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      status: "error",
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        code: "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED",
      },
    });
    expect(mocks.executeAccountDeletion).not.toHaveBeenCalled();
  });

  it("deletes the account, clears retry authorization, and signs out locally", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId: "request-1",
      status: "deleted",
    });
    expect(mocks.executeAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        retryToken: "retry-token",
        userId: "user-1",
      }),
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get("alpha-dog-account-deletion")?.value).toBe("");
  });

  it("keeps an opaque retry cookie when a staged deletion fails", async () => {
    mocks.executeAccountDeletion.mockRejectedValue(
      new Error("ACCOUNT_DELETION_APPLICATION_DATA_FAILED"),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: {
        code: "ACCOUNT_DELETION_UNAVAILABLE",
        retryable: true,
      },
    });
    expect(response.headers.get("set-cookie")).toContain(
      "alpha-dog-account-deletion=retry-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("passes retry authorization only from the path-scoped cookie", async () => {
    await POST(request(body, {
      cookie: "alpha-dog-account-deletion=existing-retry",
    }));

    expect(mocks.authorizeAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCookie: "existing-retry",
      }),
    );
  });

  it("does not turn a completed deletion into a failure when local sign-out races", async () => {
    mocks.signOut.mockRejectedValue(new Error("Auth row already removed"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "deleted" });
  });
});
