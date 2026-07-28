import type { EarningsRiskContext } from "../earnings";
import type {
  DataFeed,
  OptionType,
  PersonaId,
  QualityLabel,
  Trend,
  Warning,
  WheelCompanyScore,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "../types";

export type MarketBatchStatus =
  | "running"
  | "facts_ready"
  | "scoring"
  | "complete"
  | "failed";

export interface MarketBatchRow {
  asset_count: number;
  batch_key: string;
  error_count: number;
  feed: Exclude<DataFeed, "demo">;
  id: string;
  interval_started_at: string;
  option_contract_count: number;
  ranked_count: number;
  selected_count: number;
  snapshot_count: number;
  status: MarketBatchStatus;
  summary: Record<string, unknown>;
  underlyings_completed_at: string | null;
}

export interface CreateMarketBatchResult {
  batchId: string;
  batchKey: string;
  created: boolean;
  status: MarketBatchStatus;
}

export interface MarketBatchUnderlyingRow {
  batch_id: string;
  captured_at: string;
  company_name: string;
  daily_volume: number | string | null;
  dollar_volume: number | string | null;
  earnings_as_of: string | null;
  earnings_context: EarningsRiskContext;
  exchange: "NYSE" | "NASDAQ";
  latest_trade_at: string | null;
  ma20: number | string | null;
  ma50: number | string | null;
  ma200: number | string | null;
  pct_change: number | string | null;
  previous_close: number | string | null;
  price: number | string;
  rsi14: number | string | null;
  selected_for_scoring: boolean;
  stock_score: number | string;
  stock_snapshot: Record<string, unknown>;
  symbol: string;
  technical_as_of: string | null;
  trend: Trend;
  universe_rank: number;
}

export interface MarketBatchOptionRow {
  ask: number | string;
  batch_id: string;
  bid: number | string;
  captured_at: string;
  contract_symbol: string;
  delta: number | string | null;
  expiration: string;
  implied_volatility: number | string | null;
  open_interest: number | string | null;
  option_type: OptionType;
  strike: number | string;
  theta: number | string | null;
  underlying_symbol: string;
  volume: number | string | null;
}

export type MarketBatchMetricPhase =
  | "ingestion"
  | "scoring"
  | "publication";

export type MarketBatchMetricOperation =
  | "asset_universe"
  | "stock_snapshots"
  | "technical_bars"
  | "earnings"
  | "option_put"
  | "option_call"
  | "candidate_scoring"
  | "snapshot_publication";

export interface MarketBatchMetric {
  databaseRowsWritten: number;
  durationMs: number;
  operation: MarketBatchMetricOperation;
  phase: MarketBatchMetricPhase;
  providerRequests: number;
}

export interface MarketBatchIngestionSummary {
  assetCount: number;
  errorCount: number;
  errors: string[];
  metrics: MarketBatchMetric[];
  optionContractCount: number;
  rankedCount: number;
  selectedCount: number;
}

export interface MarketBatchUnderlyingStageSummary {
  assetCount: number;
  metrics: MarketBatchMetric[];
  missingSymbols: string[];
  rankedCount: number;
  selectedCount: number;
  selectedSymbols: string[];
}

export interface MarketBatchOptionStageSummary {
  contractCount: number;
  durationMs: number;
  error: string | null;
  optionType: OptionType;
  providerRequests: number;
  symbol: string;
}

export interface MarketBatchOptionIngestionRow {
  batch_id: string;
  completed_at: string;
  contract_count: number;
  duration_ms: number | string;
  error: string | null;
  option_type: OptionType;
  status: "complete" | "failed";
  symbol: string;
}

export interface MarketBatchSnapshotResult {
  candidateCount: number;
  response: WheelScreenerResponse;
  snapshotId: string;
}

export interface MarketBatchCurrentSnapshotRow {
  batch_id: string;
  published_at: string;
  snapshot_id: string;
}

export interface MarketBatchSnapshotRow {
  as_of: string;
  batch_id: string;
  candidate_count: number;
  completed_at: string | null;
  errors: string[];
  feed: Exclude<DataFeed, "demo">;
  id: string;
  next_suggested_refresh_at: string | null;
  screened_count: number;
  skipped_count: number;
  started_at: string;
  status: "building" | "complete" | "failed";
  warnings: Warning[];
}

export interface MarketBatchCandidateRow {
  annualized_return_on_risk: number | string | null;
  annualized_yield: number | string | null;
  as_of: string;
  company_name: string;
  delta: number | string | null;
  dte: number;
  errors: string[];
  exchange: "NYSE" | "NASDAQ";
  expiration: string;
  implied_volatility: number | string | null;
  liquidity_quality: QualityLabel;
  long_strike: number | string | null;
  ma20: number | string | null;
  ma50: number | string | null;
  ma200: number | string | null;
  option_type: OptionType;
  premium_received: number | string | null;
  premium_yield: number | string | null;
  rank: number;
  return_on_risk: number | string | null;
  rsi14: number | string | null;
  score: number;
  short_strike: number | string;
  snapshot_id: string;
  strategy: WheelCompanyStrategy;
  symbol: string;
  trend: Trend;
  underlying_as_of: string | null;
  underlying_price: number | string;
  warning_count: number;
  warnings: Warning[];
}

export interface StagedMarketBatchSnapshot {
  candidateCount: number;
  durationMs: number;
  errors: string[];
  screenedCount: number;
  skippedCount: number;
  snapshotId: string;
  warnings: WheelScreenerResponse["warnings"];
}

export interface SharedMarketBatchWorkflowInput {
  batchKey?: string;
  intervalStartedAt: string;
  requests: WheelScreenerRequest[];
}

export interface CompletedSharedMarketBatchWorkflowResult {
  batchId: string;
  ingestion: Omit<MarketBatchIngestionSummary, "metrics">;
  snapshots: Array<{
    candidateCount: number;
    persona: PersonaId;
    snapshotId: string;
    strategy: WheelCompanyStrategy;
  }>;
  status: "complete";
}

export interface DeduplicatedSharedMarketBatchWorkflowResult {
  batchId: string;
  canonicalStatus: MarketBatchStatus;
  status: "deduplicated";
}

export type SharedMarketBatchWorkflowResult =
  | CompletedSharedMarketBatchWorkflowResult
  | DeduplicatedSharedMarketBatchWorkflowResult;

export interface ScoredMarketBatchConsumer {
  companies: WheelCompanyScore[];
  filters: WheelFilters;
  response: WheelScreenerResponse;
}
