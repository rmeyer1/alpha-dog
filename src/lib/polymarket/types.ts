export const polymarketCategories = [
  "OVERALL",
  "POLITICS",
  "SPORTS",
  "CRYPTO",
  "CULTURE",
  "MENTIONS",
  "WEATHER",
  "ECONOMICS",
  "TECH",
  "FINANCE",
] as const;

export const polymarketTimePeriods = ["DAY", "WEEK", "MONTH", "ALL"] as const;
export const polymarketOrderByValues = ["PNL", "VOL"] as const;

export type PolymarketCategory = typeof polymarketCategories[number];
export type PolymarketTimePeriod = typeof polymarketTimePeriods[number];
export type PolymarketOrderBy = typeof polymarketOrderByValues[number];
export type PolymarketCacheStatus = "fresh" | "live" | "demo";

export type PolymarketEvidenceLabel =
  | "Whale"
  | "High-conviction whale"
  | "Capital with edge"
  | "Concentrated exposure"
  | "Thin evidence"
  | "Recent momentum";

export interface PolymarketDataFreshness {
  asOf: string;
  cacheStatus: PolymarketCacheStatus;
  cachedUntil: string | null;
  source: "polymarket" | "demo";
}

export interface PolymarketLeaderboardRequest {
  category: PolymarketCategory;
  forceRefresh: boolean;
  limit: number;
  offset: number;
  orderBy: PolymarketOrderBy;
  timePeriod: PolymarketTimePeriod;
}

export interface PolymarketWalletRequest {
  forceRefresh: boolean;
  wallet: string;
}

export interface PolymarketWhalesRequest extends PolymarketLeaderboardRequest {
  minValue: number;
}

export interface PolymarketSharpPlaysRequest
  extends PolymarketLeaderboardRequest {
  minTraders: number;
}

export interface PolymarketLeaderboardRow {
  pnl: number;
  profileImage: string | null;
  proxyWallet: string;
  rank: number;
  userName: string;
  verifiedBadge: boolean;
  vol: number;
  xUsername: string | null;
}

export interface TraderScores {
  activityScore: number;
  alphaDogScore: number;
  edgeScore: number;
  profitabilityScore: number;
}

export interface TraderSummary {
  labels: PolymarketEvidenceLabel[];
  pnl: number;
  pnlPerVolume: number | null;
  profileImage: string | null;
  proxyWallet: string;
  rank: number;
  scores: TraderScores;
  userName: string;
  verifiedBadge: boolean;
  volume: number;
  xUsername: string | null;
}

export interface PolymarketPosition {
  asset: string;
  avgPrice: number;
  cashPnl: number;
  conditionId: string;
  curPrice: number;
  currentValue: number;
  endDate: string | null;
  eventSlug: string | null;
  icon: string | null;
  initialValue: number;
  negativeRisk: boolean;
  oppositeAsset: string | null;
  oppositeOutcome: string | null;
  outcome: string;
  outcomeIndex: number | null;
  percentPnl: number;
  percentRealizedPnl: number;
  proxyWallet: string;
  realizedPnl: number;
  redeemable: boolean;
  size: number;
  slug: string;
  title: string;
  totalBought: number;
}

export interface PolymarketClosedPosition {
  asset: string;
  avgPrice: number;
  conditionId: string;
  curPrice: number;
  endDate: string | null;
  eventSlug: string | null;
  icon: string | null;
  oppositeAsset: string | null;
  oppositeOutcome: string | null;
  outcome: string;
  outcomeIndex: number | null;
  proxyWallet: string;
  realizedPnl: number;
  slug: string;
  timestamp: number | null;
  title: string;
  totalBought: number;
}

export type PolymarketActivityType =
  | "TRADE"
  | "SPLIT"
  | "MERGE"
  | "REDEEM"
  | "REWARD"
  | "CONVERSION"
  | "MAKER_REBATE"
  | "REFERRAL_REWARD";

export interface PolymarketActivity {
  asset: string | null;
  conditionId: string;
  eventSlug: string | null;
  icon: string | null;
  outcome: string | null;
  outcomeIndex: number | null;
  price: number | null;
  profileImage: string | null;
  profileImageOptimized: string | null;
  proxyWallet: string;
  pseudonym: string | null;
  side: "BUY" | "SELL" | null;
  size: number;
  slug: string | null;
  timestamp: number | null;
  title: string;
  transactionHash: string | null;
  type: PolymarketActivityType;
  usdcSize: number;
  userName: string | null;
}

export interface PolymarketValue {
  user: string;
  value: number;
}

export interface TraderCategoryExposure {
  label: string;
  value: number;
}

export interface TraderRiskSummary {
  closedPositionCount: number;
  concentrationRatio: number;
  lastActivityAt: string | null;
  openCashPnl: number;
  openPositionCount: number;
  positiveClosedPositionRate: number | null;
  realizedPnl: number;
  recentActivityCount: number;
  topMarketValue: number;
  totalOpenValue: number;
}

export interface TraderWalletProfile {
  activity: PolymarketActivity[];
  closedPositions: PolymarketClosedPosition[];
  dataFreshness: PolymarketDataFreshness;
  openPositions: PolymarketPosition[];
  scores: TraderScores;
  summary: TraderRiskSummary;
  totalValue: number;
  wallet: string;
}

export interface PolymarketLeaderboardResponse {
  dataFreshness: PolymarketDataFreshness;
  traders: TraderSummary[];
}

export interface WhaleCandidate extends TraderSummary {
  openCashPnl: number;
  openPositionCount: number;
  realizedPnl: number;
  totalOpenValue: number;
  totalValue: number;
  topMarketValue: number;
  whaleScore: number;
}

export interface PolymarketWhalesResponse {
  criteria: {
    category: PolymarketCategory;
    minValue: number;
    orderBy: PolymarketOrderBy;
    timePeriod: PolymarketTimePeriod;
  };
  dataFreshness: PolymarketDataFreshness;
  whales: WhaleCandidate[];
}

export interface SharpPlayTrader {
  avgPrice: number;
  cashPnl: number;
  currentValue: number;
  pnl: number;
  profileImage: string | null;
  proxyWallet: string;
  rank: number;
  size: number;
  userName: string;
  verifiedBadge: boolean;
  volume: number;
}

export interface SharpPlay {
  asset: string;
  avgEntry: number;
  conditionId: string;
  convictionScore: number;
  curPrice: number;
  endDate: string | null;
  eventSlug: string | null;
  id: string;
  labels: string[];
  outcome: string;
  outcomeIndex: number | null;
  slug: string;
  title: string;
  totalCashPnl: number;
  totalSize: number;
  totalValue: number;
  traderCount: number;
  traders: SharpPlayTrader[];
}

export interface PolymarketSharpPlaysResponse {
  criteria: {
    category: PolymarketCategory;
    minTraders: number;
    orderBy: PolymarketOrderBy;
    timePeriod: PolymarketTimePeriod;
  };
  dataFreshness: PolymarketDataFreshness;
  plays: SharpPlay[];
}
