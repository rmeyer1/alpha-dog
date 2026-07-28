import { requestSupabaseRest } from "@/lib/supabase/rest";
import type {
  DeepScanWorkClaim,
  DeepScanWorkClaimRow,
  DeepScanWorkMetrics,
  DeepScanWorkPreview,
  DeepScanWorkPreviewRow,
  DeepScanWorkResult,
} from "./model";

function claimFromRow(row: DeepScanWorkClaimRow): DeepScanWorkClaim {
  return {
    attemptCount: row.attempt_count,
    coverageTier: row.coverage_tier,
    leaseAcquiredAt: row.lease_acquired_at,
    leaseExpiresAt: row.lease_expires_at,
    leaseOwnerId: row.lease_owner_id,
    leaseToken: row.lease_token,
    nextDueAt: row.next_due_at,
    optionType: row.option_type,
    symbol: row.symbol,
    tierPriority: row.tier_priority,
    tierRank: row.tier_rank,
  };
}

function previewFromRow(row: DeepScanWorkPreviewRow): DeepScanWorkPreview {
  return {
    coverageTier: row.coverage_tier,
    nextDueAt: row.next_due_at,
    optionType: row.option_type,
    symbol: row.symbol,
    tierPriority: row.tier_priority,
    tierRank: row.tier_rank,
  };
}

function claimIdentity(claim: DeepScanWorkClaim) {
  return {
    lease_token: claim.leaseToken,
    option_type: claim.optionType,
    symbol: claim.symbol,
  };
}

export async function syncDeepScanWorkQueue(now?: string) {
  return requestSupabaseRest<{
    active_symbols: number;
    eligible_units: number;
    synced_at: string;
    upserted_units: number;
  }>("rpc/sync_wheel_deep_scan_work_queue", {
    method: "POST",
    body: {
      p_now: now ?? null,
    },
  });
}

export async function claimDeepScanWork({
  force,
  leaseSeconds,
  limit,
  now,
  ownerId,
}: {
  force: boolean;
  leaseSeconds: number;
  limit: number;
  now?: string;
  ownerId: string;
}) {
  const rows = await requestSupabaseRest<DeepScanWorkClaimRow[]>(
    "rpc/claim_wheel_deep_scan_work",
    {
      method: "POST",
      body: {
        p_force: force,
        p_lease_seconds: leaseSeconds,
        p_limit: limit,
        p_now: now ?? null,
        p_owner_id: ownerId,
      },
    },
  );

  return (rows ?? []).map(claimFromRow);
}

export async function peekDeepScanWork({
  force,
  limit,
  now,
}: {
  force: boolean;
  limit: number;
  now?: string;
}) {
  const rows = await requestSupabaseRest<DeepScanWorkPreviewRow[]>(
    "rpc/peek_wheel_deep_scan_work",
    {
      method: "POST",
      body: {
        p_force: force,
        p_limit: limit,
        p_now: now ?? null,
      },
    },
  );

  return (rows ?? []).map(previewFromRow);
}

export async function heartbeatDeepScanWork({
  claims,
  leaseSeconds,
  now,
  ownerId,
}: {
  claims: DeepScanWorkClaim[];
  leaseSeconds: number;
  now?: string;
  ownerId: string;
}) {
  return requestSupabaseRest<{
    heartbeat_at: string;
    renewed_count: number;
  }>("rpc/heartbeat_wheel_deep_scan_work", {
    method: "POST",
    body: {
      p_claims: claims.map(claimIdentity),
      p_lease_seconds: leaseSeconds,
      p_now: now ?? null,
      p_owner_id: ownerId,
    },
  });
}

export async function publishDeepScanCompatibility({
  candidates,
  claims,
  coverage,
  leaseSeconds,
  now,
  ownerId,
}: {
  candidates: Record<string, unknown>[];
  claims: DeepScanWorkClaim[];
  coverage: Record<string, unknown>[];
  leaseSeconds: number;
  now?: string;
  ownerId: string;
}) {
  const result = await requestSupabaseRest<{
    candidate_count: number;
    coverage_row_count: number;
    published_at: string;
    renewed_count: number;
  }>("rpc/publish_wheel_deep_scan_compatibility", {
    method: "POST",
    body: {
      p_candidates: candidates,
      p_claims: claims.map(claimIdentity),
      p_coverage: coverage,
      p_lease_seconds: leaseSeconds,
      p_now: now ?? null,
      p_owner_id: ownerId,
    },
  });

  if (!result) {
    throw new Error("Deep-scan compatibility publication returned no result.");
  }

  return result;
}

export async function completeDeepScanWorkBatch({
  batchId,
  now,
  ownerId,
  results,
}: {
  batchId: string;
  now?: string;
  ownerId: string;
  results: DeepScanWorkResult[];
}) {
  const result = await requestSupabaseRest<{
    batch_id: string;
    completed_count: number;
    replayed_count: number;
    status: "complete";
  }>("rpc/complete_wheel_deep_scan_work_batch", {
    method: "POST",
    body: {
      p_batch_id: batchId,
      p_now: now ?? null,
      p_owner_id: ownerId,
      p_results: results.map((result) => ({
        error: result.error,
        lease_token: result.leaseToken,
        option_contract_count: result.optionContractCount,
        option_type: result.optionType,
        outcome: result.outcome,
        symbol: result.symbol,
      })),
    },
  });

  if (!result) {
    throw new Error("Deep-scan completion returned no result.");
  }

  return result;
}

export async function failDeepScanWorkBatch({
  batchId,
  claims,
  error,
  now,
  ownerId,
}: {
  batchId: string;
  claims: DeepScanWorkClaim[];
  error: string;
  now?: string;
  ownerId: string;
}) {
  return requestSupabaseRest<{
    batch_id: string;
    failed_count: number;
    stale_count: number;
    status: "failed";
  }>("rpc/fail_wheel_deep_scan_work_batch", {
    method: "POST",
    body: {
      p_batch_id: batchId,
      p_claims: claims.map(claimIdentity),
      p_error: error,
      p_now: now ?? null,
      p_owner_id: ownerId,
    },
  });
}

export async function getDeepScanWorkMetrics(now?: string) {
  return requestSupabaseRest<DeepScanWorkMetrics>(
    "rpc/get_wheel_deep_scan_work_metrics",
    {
      method: "POST",
      body: {
        p_now: now ?? null,
      },
    },
  );
}
