import type {
  PolymarketActivity,
  PolymarketClosedPosition,
  PolymarketEvidenceLabel,
  PolymarketLeaderboardRow,
  PolymarketPosition,
  TraderRiskSummary,
  TraderScores,
  TraderSummary,
  TraderWalletProfile,
  WhaleCandidate,
} from "./types";

const dayMs = 24 * 60 * 60 * 1000;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function unixToIso(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

function scoreProfitability(pnl: number, volume: number) {
  if (volume <= 0) {
    return pnl > 0 ? 45 : 20;
  }

  const pnlPerVolume = pnl / volume;
  const pnlScore = clamp(50 + pnl / 5_000, 0, 80);
  const efficiencyScore = clamp(50 + pnlPerVolume * 600, 0, 100);

  return Math.round(pnlScore * 0.45 + efficiencyScore * 0.55);
}

function scoreActivity(volume: number, recentActivityCount = 0) {
  const volumeScore = clamp(Math.log10(Math.max(volume, 1)) * 13, 0, 80);
  const recentScore = clamp(recentActivityCount * 9, 0, 30);

  return Math.round(clamp(volumeScore + recentScore));
}

function scoreEdge({
  concentrationRatio,
  openCashPnl,
  pnl,
  realizedPnl,
  volume,
}: {
  concentrationRatio?: number;
  openCashPnl?: number;
  pnl: number;
  realizedPnl?: number;
  volume: number;
}) {
  const profitability = scoreProfitability(pnl, volume);
  const realizedSupport = realizedPnl == null
    ? profitability
    : clamp(50 + realizedPnl / 2_500, 0, 100);
  const openSupport = openCashPnl == null
    ? profitability
    : clamp(50 + openCashPnl / 2_500, 0, 100);
  const concentrationPenalty = concentrationRatio == null
    ? 0
    : concentrationRatio > 0.65
      ? 14
      : concentrationRatio > 0.45
        ? 7
        : 0;

  return Math.round(
    clamp(
      profitability * 0.5 + realizedSupport * 0.25 + openSupport * 0.25 -
        concentrationPenalty,
    ),
  );
}

function buildScores({
  concentrationRatio,
  openCashPnl,
  pnl,
  realizedPnl,
  recentActivityCount,
  volume,
}: {
  concentrationRatio?: number;
  openCashPnl?: number;
  pnl: number;
  realizedPnl?: number;
  recentActivityCount?: number;
  volume: number;
}): TraderScores {
  const profitabilityScore = scoreProfitability(pnl, volume);
  const activityScore = scoreActivity(volume, recentActivityCount);
  const edgeScore = scoreEdge({
    concentrationRatio,
    openCashPnl,
    pnl,
    realizedPnl,
    volume,
  });
  const alphaDogScore = Math.round(
    profitabilityScore * 0.42 + edgeScore * 0.38 + activityScore * 0.2,
  );

  return {
    activityScore,
    alphaDogScore,
    edgeScore,
    profitabilityScore,
  };
}

function evidenceLabels({
  concentrationRatio = 0,
  openPositionCount = 0,
  recentActivityCount = 0,
  totalValue = 0,
  volume,
  scores,
}: {
  concentrationRatio?: number;
  openPositionCount?: number;
  recentActivityCount?: number;
  scores: TraderScores;
  totalValue?: number;
  volume: number;
}) {
  const labels = new Set<PolymarketEvidenceLabel>();

  if (volume >= 500_000 || totalValue >= 25_000) {
    labels.add("Whale");
  }

  if (totalValue >= 100_000 && openPositionCount > 0) {
    labels.add("High-conviction whale");
  }

  if (scores.edgeScore >= 68 && scores.profitabilityScore >= 62) {
    labels.add("Capital with edge");
  }

  if (concentrationRatio >= 0.55) {
    labels.add("Concentrated exposure");
  }

  if (volume < 150_000 && openPositionCount + recentActivityCount < 3) {
    labels.add("Thin evidence");
  }

  if (recentActivityCount >= 3) {
    labels.add("Recent momentum");
  }

  return Array.from(labels);
}

export function normalizeLeaderboardRow(row: unknown): PolymarketLeaderboardRow {
  const raw = row as Record<string, unknown>;

  return {
    pnl: safeNumber(raw.pnl),
    profileImage: typeof raw.profileImage === "string" ? raw.profileImage : null,
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    rank: safeNumber(raw.rank),
    userName: String(raw.userName ?? "Unknown trader"),
    verifiedBadge: Boolean(raw.verifiedBadge),
    vol: safeNumber(raw.vol),
    xUsername: typeof raw.xUsername === "string" ? raw.xUsername : null,
  };
}

export function leaderboardRowToTrader(row: PolymarketLeaderboardRow): TraderSummary {
  const scores = buildScores({
    pnl: row.pnl,
    volume: row.vol,
  });

  return {
    labels: evidenceLabels({
      scores,
      volume: row.vol,
    }),
    pnl: row.pnl,
    pnlPerVolume: row.vol > 0 ? row.pnl / row.vol : null,
    profileImage: row.profileImage,
    proxyWallet: row.proxyWallet,
    rank: row.rank,
    scores,
    userName: row.userName,
    verifiedBadge: row.verifiedBadge,
    volume: row.vol,
    xUsername: row.xUsername,
  };
}

export function summarizeWallet({
  activity,
  closedPositions,
  openPositions,
}: {
  activity: PolymarketActivity[];
  closedPositions: PolymarketClosedPosition[];
  openPositions: PolymarketPosition[];
}): TraderRiskSummary {
  const totalOpenValue = openPositions.reduce(
    (total, position) => total + position.currentValue,
    0,
  );
  const topMarketValue = openPositions.reduce(
    (max, position) => Math.max(max, position.currentValue),
    0,
  );
  const openCashPnl = openPositions.reduce(
    (total, position) => total + position.cashPnl,
    0,
  );
  const realizedPnl = closedPositions.reduce(
    (total, position) => total + position.realizedPnl,
    0,
  ) +
    openPositions.reduce((total, position) => total + position.realizedPnl, 0);
  const positiveClosedPositions = closedPositions.filter((position) =>
    position.realizedPnl > 0
  ).length;
  const latestActivityTimestamp = activity.reduce(
    (latest, item) => Math.max(latest, item.timestamp ?? 0),
    0,
  );
  const recentCutoff = Date.now() - 7 * dayMs;
  const recentActivityCount = activity.filter((item) =>
    item.timestamp != null && item.timestamp * 1000 >= recentCutoff
  ).length;

  return {
    closedPositionCount: closedPositions.length,
    concentrationRatio: totalOpenValue > 0 ? topMarketValue / totalOpenValue : 0,
    lastActivityAt: unixToIso(latestActivityTimestamp),
    openCashPnl,
    openPositionCount: openPositions.length,
    positiveClosedPositionRate: closedPositions.length > 0
      ? positiveClosedPositions / closedPositions.length
      : null,
    realizedPnl,
    recentActivityCount,
    topMarketValue,
    totalOpenValue,
  };
}

export function scoreWalletProfile({
  activity,
  closedPositions,
  leaderboardRow,
  openPositions,
  totalValue,
}: {
  activity: PolymarketActivity[];
  closedPositions: PolymarketClosedPosition[];
  leaderboardRow?: PolymarketLeaderboardRow | null;
  openPositions: PolymarketPosition[];
  totalValue: number;
}) {
  const summary = summarizeWallet({
    activity,
    closedPositions,
    openPositions,
  });
  const volume = leaderboardRow?.vol ??
    activity.reduce((total, item) => total + item.usdcSize, 0);
  const pnl = leaderboardRow?.pnl ?? summary.realizedPnl + summary.openCashPnl;
  const scores = buildScores({
    concentrationRatio: summary.concentrationRatio,
    openCashPnl: summary.openCashPnl,
    pnl,
    realizedPnl: summary.realizedPnl,
    recentActivityCount: summary.recentActivityCount,
    volume,
  });
  const labels = evidenceLabels({
    concentrationRatio: summary.concentrationRatio,
    openPositionCount: summary.openPositionCount,
    recentActivityCount: summary.recentActivityCount,
    scores,
    totalValue,
    volume,
  });

  return {
    labels,
    pnl,
    scores,
    summary,
    volume,
  };
}

export function profileToWhaleCandidate({
  leaderboardRow,
  profile,
}: {
  leaderboardRow: PolymarketLeaderboardRow;
  profile: TraderWalletProfile;
}): WhaleCandidate {
  const scored = scoreWalletProfile({
    activity: profile.activity,
    closedPositions: profile.closedPositions,
    leaderboardRow,
    openPositions: profile.openPositions,
    totalValue: profile.totalValue,
  });
  const valueScore = clamp(Math.log10(Math.max(profile.totalValue, 1)) * 11);
  const volumeScore = clamp(Math.log10(Math.max(leaderboardRow.vol, 1)) * 8);
  const concentrationPenalty = profile.summary.concentrationRatio > 0.75
    ? 8
    : profile.summary.concentrationRatio > 0.55
      ? 4
      : 0;
  const whaleScore = Math.round(
    clamp(
      scored.scores.edgeScore * 0.46 + valueScore * 0.32 + volumeScore * 0.22 -
        concentrationPenalty,
    ),
  );

  return {
    labels: scored.labels,
    openCashPnl: profile.summary.openCashPnl,
    openPositionCount: profile.summary.openPositionCount,
    pnl: leaderboardRow.pnl,
    pnlPerVolume: leaderboardRow.vol > 0 ? leaderboardRow.pnl / leaderboardRow.vol : null,
    profileImage: leaderboardRow.profileImage,
    proxyWallet: leaderboardRow.proxyWallet,
    rank: leaderboardRow.rank,
    realizedPnl: profile.summary.realizedPnl,
    scores: scored.scores,
    topMarketValue: profile.summary.topMarketValue,
    totalOpenValue: profile.summary.totalOpenValue,
    totalValue: profile.totalValue,
    userName: leaderboardRow.userName,
    verifiedBadge: leaderboardRow.verifiedBadge,
    volume: leaderboardRow.vol,
    whaleScore,
    xUsername: leaderboardRow.xUsername,
  };
}
