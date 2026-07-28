import type {
  OptionType,
  WheelScreenerRequest,
} from "../types";
import type { MarketBatchOptionStageSummary } from "../market-batch/model";

export type DeepScanCoverageTier = "priority" | "daily" | "weekly";
export type DeepScanWorkOutcome =
  | "complete"
  | "no_candidate"
  | "failed"
  | "provider_outage";

export interface DeepScanWorkClaimRow {
  attempt_count: number;
  coverage_tier: DeepScanCoverageTier;
  lease_acquired_at: string;
  lease_expires_at: string;
  lease_owner_id: string;
  lease_token: string;
  next_due_at: string;
  option_type: OptionType;
  symbol: string;
  tier_priority: number;
  tier_rank: number;
}

export interface DeepScanWorkPreviewRow {
  coverage_tier: DeepScanCoverageTier;
  next_due_at: string;
  option_type: OptionType;
  symbol: string;
  tier_priority: number;
  tier_rank: number;
}

export interface DeepScanWorkClaim {
  attemptCount: number;
  coverageTier: DeepScanCoverageTier;
  leaseAcquiredAt: string;
  leaseExpiresAt: string;
  leaseOwnerId: string;
  leaseToken: string;
  nextDueAt: string;
  optionType: OptionType;
  symbol: string;
  tierPriority: number;
  tierRank: number;
}

export interface DeepScanWorkPreview {
  coverageTier: DeepScanCoverageTier;
  nextDueAt: string;
  optionType: OptionType;
  symbol: string;
  tierPriority: number;
  tierRank: number;
}

export interface DeepScanWorkResult {
  error: string | null;
  leaseToken: string;
  optionContractCount: number;
  optionType: OptionType;
  outcome: DeepScanWorkOutcome;
  symbol: string;
}

export interface DeepScanWorkMetrics {
  average_claim_latency_ms: number | null;
  average_completion_latency_ms: number | null;
  backlog_count: number;
  claimed_count: number;
  freshness: {
    failed: number;
    never_scanned: number;
    on_time: number;
    overdue: number;
  };
  measured_at: string;
  oldest_due_age_seconds: number;
  tiers: Array<{
    compliance_ratio: number;
    failed_count: number;
    freshness_seconds: number;
    never_scanned_count: number;
    on_time_count: number;
    overdue_count: number;
    priority: number;
    tier: DeepScanCoverageTier;
    total_count: number;
  }>;
  total_count: number;
}

export interface TieredDeepScanWorkflowInput {
  batchKey?: string;
  claims: DeepScanWorkClaim[];
  intervalStartedAt: string;
  leaseSeconds: number;
  ownerId: string;
  requests: WheelScreenerRequest[];
}

export interface TieredDeepScanCompatibilitySummary {
  candidateCount: number;
  consumerCount: number;
  coverageRowCount: number;
}

export interface TieredDeepScanWorkflowResult {
  batchId: string;
  compatibility: TieredDeepScanCompatibilitySummary;
  completedCount: number;
  errorCount: number;
  optionContractCount: number;
  status: "complete";
  workCount: number;
}

export interface TieredDeepScanFactSummary {
  errorCount: number;
  errors: string[];
  optionContractCount: number;
  optionStages: MarketBatchOptionStageSummary[];
}
