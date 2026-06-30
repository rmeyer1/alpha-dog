import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { LOGOUT_FAILED, signOutSupabaseSession } from "./logout";

function supabaseMock(error: { message: string } | null = null) {
  const signOut = vi.fn(async () => ({ error }));

  return {
    client: {
      auth: { signOut },
    } as unknown as SupabaseClient,
    signOut,
  };
}

describe("logout session helper", () => {
  it("treats missing Supabase config as already signed out", async () => {
    await expect(signOutSupabaseSession(null)).resolves.toEqual({
      status: "signed_out",
    });
  });

  it("clears the Supabase session", async () => {
    const { client, signOut } = supabaseMock();

    await expect(signOutSupabaseSession(client)).resolves.toEqual({
      status: "signed_out",
    });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("returns a stable safe error when Supabase sign-out fails", async () => {
    const { client } = supabaseMock({ message: "Network unavailable" });

    await expect(signOutSupabaseSession(client)).resolves.toEqual({
      code: LOGOUT_FAILED,
      status: "error",
    });
  });
});
