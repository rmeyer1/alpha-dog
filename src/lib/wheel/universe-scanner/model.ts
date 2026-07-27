import type {
  AlpacaExplicitOptionSnapshotMetadata,
  AlpacaStockSnapshot,
} from "@/lib/alpaca/client";
import type { ScannerLease } from "../scanner-concurrency";
import type {
  DataFeed,
  OptionType,
  Trend,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerRequest,
} from "../types";

export interface ScannerAsset {
  symbol: string;
  name: string;
  exchange: "NYSE" | "NASDAQ";
}

export interface UnderlyingTechnicalRow {
  calculated_at: string;
  ma20: number | string | null;
  ma50: number | string | null;
  ma200: number | string | null;
  rsi14: number | string | null;
  symbol: string;
  trend: Trend;
}

export interface RankedUnderlying {
  asset: ScannerAsset;
  dollarVolume: number;
  pctChange: number | null;
  price: number;
  snapshot: AlpacaStockSnapshot;
  stockScore: number;
}

export interface OptionMarketSnapshotRow {
  ask: number;
  bid: number;
  captured_at: string;
  contract_symbol: string;
  delta: number | null;
  expiration: string;
  implied_volatility: number | null;
  open_interest: number | null;
  option_type: OptionType;
  scan_run_id: string | null;
  strike: number;
  theta: number | null;
  underlying_symbol: string;
  volume: number | null;
}

export interface KnownCandidateContractRow {
  as_of: string;
  expiration: string;
  long_strike: number | string | null;
  option_type: OptionType;
  short_strike: number | string;
  symbol: string;
}

export interface DeepScanCoverageRow {
  best_score: number | null;
  error: string | null;
  last_scanned_at: string | null;
  option_contract_count: number;
  status: "pending" | "complete" | "failed" | "no_candidate";
  symbol: string;
}

export interface DeepScanContext {
  filterKey: string;
  filters: WheelFilters;
  persona: WheelScreenerRequest["persona"];
  strategy: WheelCompanyStrategy;
}

export interface CandidateContractRefreshRequest {
  feed: Exclude<DataFeed, "demo">;
  filters: WheelFilters;
  incrementalDiscovery: boolean;
  knownMetadata: AlpacaExplicitOptionSnapshotMetadata[] | undefined;
  price: number;
  strategy: WheelCompanyStrategy;
  symbol: string;
  updatedSince?: string;
}

export interface TechnicalRefreshSummary {
  cachedFreshCount: number;
  refreshedCount: number;
  requestedCount: number;
}

export interface ContractRefreshSummary {
  contractsMissingOpenInterest: number;
  contractsReturned: number;
  discoveryContractsReturned: number;
  fullDiscoveryRan: boolean;
  incrementalDiscoveryRan: boolean;
  knownContractsRequested: number;
  knownContractsReturned: number;
  symbol: string;
}

export interface UniverseScanRunSummary {
  contracts: {
    contractsMissingOpenInterest: number;
    contractsReturned: number;
    discoveryContractsReturned: number;
    fullDiscoverySymbols: number;
    incrementalDiscoverySymbols: number;
    knownContractsRequested: number;
    knownContractsReturned: number;
    optionSnapshotRows: number;
    symbolsWithKnownContracts: number;
  };
  errors: {
    count: number;
    sample: string[];
  };
  scoring: {
    noCandidateCount: number;
    scoredCount: number;
    skippedCount: number;
  };
  technicals: TechnicalRefreshSummary;
  universe: {
    assetCount: number;
    deepScanSize: number;
    rankedCount: number;
    selectedDeepScanCount: number;
  };
}

export interface DeepScanRunSummary {
  contracts: UniverseScanRunSummary["contracts"];
  coverage: {
    failedCount: number;
    noCandidateCount: number;
    updatedCount: number;
  };
  errors: UniverseScanRunSummary["errors"];
  selection: {
    batchSize: number;
    selectedCount: number;
    staleBefore: string;
    totalEligibleCount: number;
  };
  technicals: TechnicalRefreshSummary;
}

export interface UniverseDeepScanCoverageRequest {
  batchSize?: number;
  filters?: Partial<WheelFilters>;
  forceRefresh?: boolean;
  persona: WheelScreenerRequest["persona"];
  strategy: WheelCompanyStrategy;
  workflowIdempotencyKey?: string;
}

export interface UniverseDeepScanCoverageResult {
  batchSize: number;
  candidateCount: number;
  errorCount: number;
  errors: string[];
  filterKey: string;
  persona: WheelScreenerRequest["persona"];
  runId: string | null;
  scannedCount: number;
  scannedSymbols: string[];
  selectedCount: number;
  skippedReason: string | null;
  staleBefore: string;
  strategy: WheelCompanyStrategy;
  totalEligibleCount: number;
}

export interface StagedUniverseDeepScanCoverage {
  result: UniverseDeepScanCoverageResult | null;
  runId: string | null;
}

export interface DeepScanCheckpointRow {
  lease_key: string | null;
  lease_owner_id: string | null;
  status: "running" | "complete" | "failed";
  summary: DeepScanRunSummary;
  workflow_result: UniverseDeepScanCoverageResult | null;
}

export interface ReusableDeepScanRun {
  id: string;
  workflow_result: UniverseDeepScanCoverageResult | null;
}

export interface ScannerRunLease {
  lease: ScannerLease;
  runId: string | null;
}
