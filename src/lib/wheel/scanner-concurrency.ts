import { createHash, randomUUID } from "node:crypto";
import { requestSupabaseRest } from "@/lib/supabase/rest";

const DEADLOCK_RETRY_DELAYS_MS = [40, 120, 280] as const;
const DEFAULT_SCAN_LEASE_SECONDS = 60 * 60;

type ScannerKind = "universe" | "deep_scan";

interface ScannerLeaseRpcResult {
  acquired: boolean;
  expires_at: string;
  owner_id: string;
  retry_after_seconds: number;
}

interface ScannerHeartbeatRpcResult {
  expires_at?: string;
  renewed: boolean;
}

export interface ScannerLease {
  acquired: true;
  contextKey: string;
  expiresAt: string;
  intervalStartedAt: string;
  leaseKey: string;
  leaseSeconds: number;
  ownerId: string;
  scanKind: ScannerKind;
}

export interface RejectedScannerLease {
  acquired: false;
  expiresAt: string;
  retryAfterSeconds: number;
}

export type ScannerLeaseResult = ScannerLease | RejectedScannerLease;

interface UpsertOptions {
  chunkSize?: number;
  onRetry?: (metadata: {
    attempt: number;
    delayMs: number;
    error: Error;
  }) => void;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) =>
      `${JSON.stringify(key)}:${stableStringify(entry)}`
    )
    .join(",")}}`;
}

function rowConflictKey(row: unknown, columns: string[]) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Scanner upsert rows must be objects.");
  }

  const record = row as Record<string, unknown>;

  return columns.map((column) => stableStringify(record[column])).join("\u0000");
}

export function sortRowsByConflictKey<T>(
  rows: T[],
  onConflict: string,
): T[] {
  const columns = onConflict
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);

  if (columns.length === 0) {
    throw new Error("Scanner upserts require conflict-key columns.");
  }

  return rows
    .map((row, index) => ({
      index,
      key: rowConflictKey(row, columns),
      row,
    }))
    .sort((left, right) =>
      left.key.localeCompare(right.key) || left.index - right.index
    )
    .map(({ row }) => row);
}

export function isPostgresDeadlock(error: unknown): error is Error {
  return error instanceof Error &&
    (/\b40P01\b/i.test(error.message) ||
      /\bdeadlock detected\b/i.test(error.message));
}

export async function withDeadlockRetry<T>(
  operation: () => Promise<T>,
  {
    onRetry,
    random = Math.random,
    sleep = wait,
  }: Pick<UpsertOptions, "onRetry" | "random" | "sleep"> = {},
) {
  for (
    let attempt = 0;
    attempt <= DEADLOCK_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const baseDelay = DEADLOCK_RETRY_DELAYS_MS[attempt];

      if (!isPostgresDeadlock(error) || baseDelay == null) {
        throw error;
      }

      const jitter = Math.floor(Math.max(0, Math.min(1, random())) * baseDelay);
      const delayMs = baseDelay + jitter;

      onRetry?.({
        attempt: attempt + 1,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Unreachable scanner deadlock retry state.");
}

export async function upsertScannerRows(
  table: string,
  rows: unknown[],
  onConflict: string,
  {
    chunkSize = 500,
    onRetry,
    random,
    sleep,
  }: UpsertOptions = {},
) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("Scanner upsert chunk size must be a positive integer.");
  }

  const orderedRows = sortRowsByConflictKey(rows, onConflict);

  for (let index = 0; index < orderedRows.length; index += chunkSize) {
    const rowChunk = orderedRows.slice(index, index + chunkSize);

    await withDeadlockRetry(
      () =>
        requestSupabaseRest<null>(table, {
          method: "POST",
          body: rowChunk,
          prefer: "resolution=merge-duplicates,return=minimal",
          query: {
            on_conflict: onConflict,
          },
        }),
      {
        onRetry: (metadata) => {
          console.warn("wheel_scanner_deadlock_retry", {
            attempt: metadata.attempt,
            chunkIndex: Math.floor(index / chunkSize),
            delayMs: metadata.delayMs,
            rowCount: rowChunk.length,
            table,
          });
          onRetry?.(metadata);
        },
        random,
        sleep,
      },
    );
  }
}

function intervalStart(date: Date, intervalMinutes: number) {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new Error("Scanner lease interval must be a positive integer.");
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  return new Date(
    Math.floor(date.getTime() / intervalMs) * intervalMs,
  ).toISOString();
}

function contextDigest(contextKey: string) {
  return createHash("sha256").update(contextKey).digest("hex");
}

export function scannerOwnerId(idempotencyKey: string) {
  const digits = contextDigest(idempotencyKey).slice(0, 32).split("");

  digits[12] = "5";
  digits[16] = (
    (Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8
  ).toString(16);

  return [
    digits.slice(0, 8).join(""),
    digits.slice(8, 12).join(""),
    digits.slice(12, 16).join(""),
    digits.slice(16, 20).join(""),
    digits.slice(20).join(""),
  ].join("-");
}

export async function acquireScannerLease({
  context,
  intervalMinutes,
  leaseSeconds = DEFAULT_SCAN_LEASE_SECONDS,
  now = new Date(),
  ownerId = randomUUID(),
  scanKind,
}: {
  context: unknown;
  intervalMinutes: number;
  leaseSeconds?: number;
  now?: Date;
  ownerId?: string;
  scanKind: ScannerKind;
}): Promise<ScannerLeaseResult> {
  const contextKey = stableStringify(context);
  const intervalStartedAt = intervalStart(now, intervalMinutes);
  const leaseKey = [
    scanKind,
    contextDigest(contextKey),
  ].join(":");
  const result = await requestSupabaseRest<ScannerLeaseRpcResult>(
    "rpc/acquire_wheel_scan_lease",
    {
      method: "POST",
      body: {
        p_context_key: contextKey,
        p_interval_started_at: intervalStartedAt,
        p_lease_key: leaseKey,
        p_lease_seconds: leaseSeconds,
        p_owner_id: ownerId,
        p_scan_kind: scanKind,
      },
    },
  );

  if (!result) {
    throw new Error("Supabase did not return a scanner lease result.");
  }

  if (!result.acquired) {
    return {
      acquired: false,
      expiresAt: result.expires_at,
      retryAfterSeconds: Math.max(1, result.retry_after_seconds),
    };
  }

  return {
    acquired: true,
    contextKey,
    expiresAt: result.expires_at,
    intervalStartedAt,
    leaseKey,
    leaseSeconds,
    ownerId,
    scanKind,
  };
}

export async function heartbeatScannerLease(lease: ScannerLease) {
  const result = await requestSupabaseRest<ScannerHeartbeatRpcResult>(
    "rpc/heartbeat_wheel_scan_lease",
    {
      method: "POST",
      body: {
        p_lease_key: lease.leaseKey,
        p_lease_seconds: lease.leaseSeconds,
        p_owner_id: lease.ownerId,
      },
    },
  );

  if (!result?.renewed) {
    throw new Error("Scanner lease ownership was lost before completion.");
  }

  return result.expires_at ?? lease.expiresAt;
}

export async function releaseScannerLease(
  lease: Pick<ScannerLease, "leaseKey" | "ownerId">,
) {
  await requestSupabaseRest<boolean>("rpc/release_wheel_scan_lease", {
    method: "POST",
    body: {
      p_lease_key: lease.leaseKey,
      p_owner_id: lease.ownerId,
    },
  });
}
