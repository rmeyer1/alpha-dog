import { describe, expect, it } from "vitest";
import {
  leaderboardRowToTrader,
  profileToWhaleCandidate,
  scoreWalletProfile,
} from "./scoring";
import type {
  PolymarketActivity,
  PolymarketClosedPosition,
  PolymarketLeaderboardRow,
  PolymarketPosition,
  TraderWalletProfile,
} from "./types";

const leaderboardRow: PolymarketLeaderboardRow = {
  pnl: 120000,
  profileImage: null,
  proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
  rank: 4,
  userName: "MacroHawk",
  verifiedBadge: true,
  vol: 900000,
  xUsername: null,
};

const openPositions: PolymarketPosition[] = [
  {
    asset: "1",
    avgPrice: 0.4,
    cashPnl: 25000,
    conditionId:
      "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917",
    curPrice: 0.55,
    currentValue: 110000,
    endDate: null,
    eventSlug: null,
    icon: null,
    initialValue: 85000,
    negativeRisk: false,
    oppositeAsset: null,
    oppositeOutcome: "No",
    outcome: "Yes",
    outcomeIndex: 0,
    percentPnl: 0.29,
    percentRealizedPnl: 0,
    proxyWallet: leaderboardRow.proxyWallet,
    realizedPnl: 5000,
    redeemable: false,
    size: 200000,
    slug: "market",
    title: "Market",
    totalBought: 85000,
  },
];

const closedPositions: PolymarketClosedPosition[] = [
  {
    asset: "2",
    avgPrice: 0.3,
    conditionId:
      "0xaa22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917",
    curPrice: 1,
    endDate: null,
    eventSlug: null,
    icon: null,
    oppositeAsset: null,
    oppositeOutcome: "No",
    outcome: "Yes",
    outcomeIndex: 0,
    proxyWallet: leaderboardRow.proxyWallet,
    realizedPnl: 22000,
    slug: "closed",
    timestamp: 1780000000,
    title: "Closed",
    totalBought: 30000,
  },
];

const activity: PolymarketActivity[] = Array.from({ length: 4 }, (_, index) => ({
  asset: "1",
  conditionId: openPositions[0].conditionId,
  eventSlug: null,
  icon: null,
  outcome: "Yes",
  outcomeIndex: 0,
  price: 0.55,
  profileImage: null,
  profileImageOptimized: null,
  proxyWallet: leaderboardRow.proxyWallet,
  pseudonym: null,
  side: "BUY",
  size: 1000,
  slug: "market",
  timestamp: Math.floor(Date.now() / 1000) - index * 3600,
  title: "Market",
  transactionHash: `0x${index}`,
  type: "TRADE",
  usdcSize: 550,
  userName: "MacroHawk",
}));

describe("polymarket scoring", () => {
  it("scores leaderboard rows and applies edge labels", () => {
    const trader = leaderboardRowToTrader(leaderboardRow);

    expect(trader.pnlPerVolume).toBeCloseTo(0.1333, 3);
    expect(trader.labels).toContain("Whale");
    expect(trader.labels).toContain("Capital with edge");
    expect(trader.scores.alphaDogScore).toBeGreaterThan(60);
  });

  it("scores wallet profiles using exposure, activity, and realized PnL", () => {
    const scored = scoreWalletProfile({
      activity,
      closedPositions,
      leaderboardRow,
      openPositions,
      totalValue: 140000,
    });

    expect(scored.summary.totalOpenValue).toBe(110000);
    expect(scored.summary.recentActivityCount).toBe(4);
    expect(scored.labels).toContain("High-conviction whale");
    expect(scored.labels).toContain("Recent momentum");
  });

  it("converts profiles to sorted whale candidates", () => {
    const scored = scoreWalletProfile({
      activity,
      closedPositions,
      leaderboardRow,
      openPositions,
      totalValue: 140000,
    });
    const profile: TraderWalletProfile = {
      activity,
      closedPositions,
      dataFreshness: {
        asOf: new Date().toISOString(),
        cachedUntil: null,
        cacheStatus: "live",
        source: "polymarket",
      },
      openPositions,
      scores: scored.scores,
      summary: scored.summary,
      totalValue: 140000,
      wallet: leaderboardRow.proxyWallet,
    };
    const candidate = profileToWhaleCandidate({ leaderboardRow, profile });

    expect(candidate.whaleScore).toBeGreaterThan(40);
    expect(candidate.whaleScore).toBeLessThan(100);
    expect(candidate.totalValue).toBe(140000);
  });
});
