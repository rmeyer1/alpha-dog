/** Supabase/RPC boundary for simulated-position lifecycle orchestration. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SimulatedPositionValidationError } from "./contracts";

type RpcResult<T> = { data: T | null; error: { message?: string } | null };
export type RpcCapableClient = SupabaseClient & {
  rpc?: <T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<RpcResult<T>>;
};
export type PaperAccountIdentity = { id: string };

export function hasRpc(supabase: SupabaseClient): supabase is RpcCapableClient {
  return typeof (supabase as RpcCapableClient).rpc === "function";
}
function validationStatusForCode(code: string) {
  return code === "SIMULATED_POSITION_NOT_FOUND" ? 404 : 400;
}
function throwRpcError(
  error: { message?: string },
  fallbackMessage: string,
): never {
  const message = error.message ?? fallbackMessage;
  const match = /^([A-Z0-9_]+):\s*(.+)$/.exec(message);
  if (match)
    throw new SimulatedPositionValidationError(
      match[1],
      match[2],
      validationStatusForCode(match[1]),
    );
  throw new Error(fallbackMessage);
}
export async function rpcOrThrow<T>(
  supabase: RpcCapableClient,
  fn: string,
  args: Record<string, unknown>,
  fallbackMessage: string,
) {
  const result = await supabase.rpc<T>(fn, args);
  if (result.error) throwRpcError(result.error, fallbackMessage);
  if (!result.data) throw new Error(fallbackMessage);
  return result.data;
}
export async function getOrCreatePaperAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<PaperAccountIdentity> {
  const existing = await supabase
    .from("paper_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) throw new Error("Unable to load paper account.");
  if (existing.data) return existing.data as PaperAccountIdentity;
  const created = await supabase
    .from("paper_accounts")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (created.error) throw new Error("Unable to create paper account.");
  return created.data as PaperAccountIdentity;
}
