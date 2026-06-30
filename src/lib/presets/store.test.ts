import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSavedPreset,
  deleteSavedPreset,
  getSavedPresetOwner,
  listSavedPresets,
  updateSavedPreset,
} from "./store";

const row = {
  base_persona_id: "balanced_wheel",
  created_at: "2026-06-30T14:00:00.000Z",
  filters: { dteMin: 21 },
  id: "preset-1",
  name: "Desk preset",
  updated_at: "2026-06-30T14:00:00.000Z",
  user_id: "user-1",
};

function queryResult(data: unknown, error: unknown = null) {
  const result = {
    eq: vi.fn(() => result),
    maybeSingle: vi.fn(async () => ({ data, error })),
    order: vi.fn(async () => ({ data, error })),
    select: vi.fn(() => result),
    single: vi.fn(async () => ({ data, error })),
  };

  return result;
}

function supabaseMock(data: unknown = row, error: unknown = null) {
  const result = queryResult(data, error);
  const insert = vi.fn(() => ({ select }));
  const select = vi.fn(() => ({ eq, order: result.order, single: result.single }));
  const eq = result.eq;
  const update = vi.fn(() => ({ eq }));
  const deleteFn = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({
    delete: deleteFn,
    insert,
    select,
    update,
  }));

  return {
    client: { from } as unknown as SupabaseClient,
    deleteFn,
    eq,
    from,
    insert,
    select,
    update,
  };
}

describe("saved preset Supabase store", () => {
  it("lists only presets for the authenticated user", async () => {
    const { client, eq } = supabaseMock([row]);

    const presets = await listSavedPresets(client, "user-1");

    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(presets).toEqual([
      {
        basePersona: "balanced_wheel",
        createdAt: "2026-06-30T14:00:00.000Z",
        filters: { dteMin: 21 },
        id: "preset-1",
        name: "Desk preset",
        updatedAt: "2026-06-30T14:00:00.000Z",
      },
    ]);
  });

  it("creates presets with server-derived user ownership", async () => {
    const { client, insert } = supabaseMock(row);

    await createSavedPreset(client, "user-1", {
      basePersona: "balanced_wheel",
      filters: { dteMin: 21 },
      name: "Desk preset",
    });

    expect(insert).toHaveBeenCalledWith({
      base_persona_id: "balanced_wheel",
      filters: { dteMin: 21 },
      name: "Desk preset",
      user_id: "user-1",
    });
  });

  it("scopes updates to preset id and authenticated user", async () => {
    const { client, eq, update } = supabaseMock(row);

    await updateSavedPreset(client, "user-1", "preset-1", {
      basePersona: "balanced_wheel",
      filters: { dteMin: 30 },
      name: "Updated",
    });

    expect(update).toHaveBeenCalledWith({
      base_persona_id: "balanced_wheel",
      filters: { dteMin: 30 },
      name: "Updated",
    });
    expect(eq).toHaveBeenCalledWith("id", "preset-1");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null when another user's preset is not visible for update", async () => {
    const { client } = supabaseMock(null);

    await expect(updateSavedPreset(client, "user-1", "preset-2", {
      basePersona: "balanced_wheel",
      filters: {},
      name: "No access",
    })).resolves.toBeNull();
  });

  it("scopes deletes to preset id and authenticated user", async () => {
    const { client, eq } = supabaseMock({ id: "preset-1" });

    await expect(deleteSavedPreset(client, "user-1", "preset-1"))
      .resolves.toBe(true);
    expect(eq).toHaveBeenCalledWith("id", "preset-1");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("can inspect owner with admin client for forbidden/not-found routing", async () => {
    const { client } = supabaseMock({ user_id: "user-2" });

    await expect(getSavedPresetOwner(client, "preset-1"))
      .resolves.toBe("user-2");
  });
});
