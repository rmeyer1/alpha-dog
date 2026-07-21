import { getEnv } from "@/lib/env";
import {
  demoActivityByWallet,
  demoClosedPositionsByWallet,
  demoLeaderboardRows,
  demoPositionsByWallet,
  demoValueByWallet,
} from "./fixtures";
import {
  leaderboardRowToTrader,
  normalizeLeaderboardRow,
  profileToWhaleCandidate,
  scoreWalletProfile,
} from "./scoring";
import type {
  PolymarketActivity,
  PolymarketActivityType,
  PolymarketClosedPosition,
  PolymarketDataFreshness,
  PolymarketLeaderboardRequest,
  PolymarketLeaderboardResponse,
  PolymarketLeaderboardRow,
  PolymarketMomentumRequest,
  PolymarketMomentumResponse,
  PolymarketPosition,
  PolymarketSharpPlaysRequest,
  PolymarketSharpPlaysResponse,
  PolymarketValue,
  PolymarketWalletRequest,
  PolymarketWhalesRequest,
  PolymarketWhalesResponse,
  SharpPlay,
  SharpPlayTrader,
  TraderWalletProfile,
} from "./types";

const leaderboardTtlMs = 3 * 60 * 1000;
const walletTtlMs = 10 * 60 * 1000;
const whalesTtlMs = 12 * 60 * 1000;
const sharpPlaysTtlMs = 10 * 60 * 1000;
const momentumTtlMs = 15 * 60 * 1000;
const leaderboardPageSize = 50;
const polymarketRetryCount = 2;
const polymarketRetryBaseDelayMs = 350;

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dataFreshness(
  source: PolymarketDataFreshness["source"],
  cachedUntil: string | null = null,
): PolymarketDataFreshness {
  return {
    asOf: new Date().toISOString(),
    cachedUntil,
    cacheStatus: source === "demo" ? "demo" : cachedUntil ? "fresh" : "live",
    source,
  };
}

function getDataApiBaseUrl() {
  return normalizeBaseUrl(getEnv().POLYMARKET_DATA_API_BASE_URL);
}

function buildDataApiUrl(
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {},
) {
  const url = new URL(path, getDataApiBaseUrl());

  for (const [key, value] of Object.entries(query)) {
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function parsePolymarketError(response: Response) {
  const body = await response.json().catch(() => null) as
    | { error?: string; message?: string }
    | null;

  return body?.message ?? body?.error ??
    `Polymarket returned HTTP ${response.status}.`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 3_000);
  }

  return polymarketRetryBaseDelayMs * 2 ** attempt;
}

async function requestPolymarket<T>(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  for (let attempt = 0; attempt <= polymarketRetryCount; attempt += 1) {
    const response = await fetch(buildDataApiUrl(path, query), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return await response.json() as T;
    }

    if (response.status === 429 && attempt < polymarketRetryCount) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    throw new Error(await parsePolymarketError(response));
  }

  throw new Error("Polymarket request failed.");
}

function normalizePosition(row: unknown): PolymarketPosition {
  const raw = row as Record<string, unknown>;

  return {
    asset: String(raw.asset ?? ""),
    avgPrice: numberValue(raw.avgPrice),
    cashPnl: numberValue(raw.cashPnl),
    conditionId: String(raw.conditionId ?? ""),
    curPrice: numberValue(raw.curPrice),
    currentValue: numberValue(raw.currentValue),
    endDate: nullableString(raw.endDate),
    eventSlug: nullableString(raw.eventSlug),
    icon: nullableString(raw.icon),
    initialValue: numberValue(raw.initialValue),
    negativeRisk: Boolean(raw.negativeRisk),
    oppositeAsset: nullableString(raw.oppositeAsset),
    oppositeOutcome: nullableString(raw.oppositeOutcome),
    outcome: String(raw.outcome ?? ""),
    outcomeIndex: raw.outcomeIndex == null ? null : numberValue(raw.outcomeIndex),
    percentPnl: numberValue(raw.percentPnl),
    percentRealizedPnl: numberValue(raw.percentRealizedPnl),
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    realizedPnl: numberValue(raw.realizedPnl),
    redeemable: Boolean(raw.redeemable),
    size: numberValue(raw.size),
    slug: String(raw.slug ?? ""),
    title: String(raw.title ?? "Untitled market"),
    totalBought: numberValue(raw.totalBought),
  };
}

function normalizeClosedPosition(row: unknown): PolymarketClosedPosition {
  const raw = row as Record<string, unknown>;

  return {
    asset: String(raw.asset ?? ""),
    avgPrice: numberValue(raw.avgPrice),
    conditionId: String(raw.conditionId ?? ""),
    curPrice: numberValue(raw.curPrice),
    endDate: nullableString(raw.endDate),
    eventSlug: nullableString(raw.eventSlug),
    icon: nullableString(raw.icon),
    oppositeAsset: nullableString(raw.oppositeAsset),
    oppositeOutcome: nullableString(raw.oppositeOutcome),
    outcome: String(raw.outcome ?? ""),
    outcomeIndex: raw.outcomeIndex == null ? null : numberValue(raw.outcomeIndex),
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    realizedPnl: numberValue(raw.realizedPnl),
    slug: String(raw.slug ?? ""),
    timestamp: raw.timestamp == null ? null : numberValue(raw.timestamp),
    title: String(raw.title ?? "Untitled market"),
    totalBought: numberValue(raw.totalBought),
  };
}

function normalizeActivity(row: unknown): PolymarketActivity {
  const raw = row as Record<string, unknown>;

  return {
    asset: nullableString(raw.asset),
    conditionId: String(raw.conditionId ?? ""),
    eventSlug: nullableString(raw.eventSlug),
    icon: nullableString(raw.icon),
    outcome: nullableString(raw.outcome),
    outcomeIndex: raw.outcomeIndex == null ? null : numberValue(raw.outcomeIndex),
    price: raw.price == null ? null : numberValue(raw.price),
    profileImage: nullableString(raw.profileImage),
    profileImageOptimized: nullableString(raw.profileImageOptimized),
    proxyWallet: String(raw.proxyWallet ?? "").toLowerCase(),
    pseudonym: nullableString(raw.pseudonym),
    side: raw.side === "BUY" || raw.side === "SELL" ? raw.side : null,
    size: numberValue(raw.size),
    slug: nullableString(raw.slug),
    timestamp: raw.timestamp == null ? null : numberValue(raw.timestamp),
    title: String(raw.title ?? "Untitled market"),
    transactionHash: nullableString(raw.transactionHash),
    type: String(raw.type ?? "TRADE") as PolymarketActivityType,
    usdcSize: numberValue(raw.usdcSize),
    userName: nullableString(raw.name),
  };
}

function normalizeValue(row: unknown, wallet: string): PolymarketValue {
  const raw = row as Record<string, unknown>;

  return {
    user: String(raw.user ?? wallet).toLowerCase(),
    value: numberValue(raw.value),
  };
}

function sortDemoLeaderboard(request: PolymarketLeaderboardRequest) {
  return [...demoLeaderboardRows]
    .sort((left, right) =>
      request.orderBy === "VOL"
        ? right.vol - left.vol
        : right.pnl - left.pnl
    )
    .slice(request.offset, request.offset + request.limit)
    .map((row, index) => ({
      ...row,
      rank: request.offset + index + 1,
    }));
}

async function fetchLeaderboardRows(
  request: PolymarketLeaderboardRequest,
): Promise<PolymarketLeaderboardRow[]> {
  const env = getEnv();

  if (env.USE_DEMO_DATA) {
    return sortDemoLeaderboard(request);
  }

  return await requestPolymarket<unknown[]>("/v1/leaderboard", {
    category: request.category,
    limit: request.limit,
    offset: request.offset,
    orderBy: request.orderBy,
    timePeriod: request.timePeriod,
  }).then((rows) => rows.map(normalizeLeaderboardRow));
}

export async function fetchPolymarketLeaderboard(
  request: PolymarketLeaderboardRequest,
  cachedUntil: string | null = null,
): Promise<PolymarketLeaderboardResponse> {
  const env = getEnv();
  const rows = await fetchLeaderboardRows(request);

  return {
    dataFreshness: dataFreshness(env.USE_DEMO_DATA ? "demo" : "polymarket", cachedUntil),
    traders: rows.map(leaderboardRowToTrader),
  };
}

async function fetchPolymarketClosedPositions(
  wallet: string,
  {
    limit,
    sortBy,
    sortDirection,
  }: {
    limit: number;
    sortBy: "REALIZEDPNL" | "TIMESTAMP";
    sortDirection: "ASC" | "DESC";
  },
) {
  const env = getEnv();
  const normalizedWallet = wallet.toLowerCase();

  if (env.USE_DEMO_DATA) {
    return demoClosedPositionsByWallet[normalizedWallet] ?? [];
  }

  return await requestPolymarket<unknown[]>("/closed-positions", {
    limit,
    sortBy,
    sortDirection,
    user: normalizedWallet,
  }).then((rows) => rows.map(normalizeClosedPosition));
}

export async function fetchPolymarketWalletProfile(
  request: PolymarketWalletRequest,
  cachedUntil: string | null = null,
): Promise<TraderWalletProfile> {
  const env = getEnv();
  const wallet = request.wallet.toLowerCase();

  if (env.USE_DEMO_DATA) {
    const openPositions = demoPositionsByWallet[wallet] ?? [];
    const closedPositions = demoClosedPositionsByWallet[wallet] ?? [];
    const activity = demoActivityByWallet[wallet] ?? [];
    const valueRows = demoValueByWallet[wallet] ?? [{ user: wallet, value: 0 }];
    const totalValue = valueRows[0]?.value ?? 0;
    const scored = scoreWalletProfile({
      activity,
      closedPositions,
      openPositions,
      totalValue,
    });

    return {
      activity,
      closedPositions,
      dataFreshness: dataFreshness("demo", cachedUntil),
      openPositions,
      scores: scored.scores,
      summary: scored.summary,
      totalValue,
      wallet,
    };
  }

  const [positions, closedPositions, activity, values] = await Promise.all([
    requestPolymarket<unknown[]>("/positions", {
      limit: 50,
      user: wallet,
    }).then((rows) => rows.map(normalizePosition)),
    fetchPolymarketClosedPositions(wallet, {
      limit: 50,
      sortBy: "REALIZEDPNL",
      sortDirection: "DESC",
    }),
    requestPolymarket<unknown[]>("/activity", {
      limit: 100,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
      user: wallet,
    }).then((rows) => rows.map(normalizeActivity)),
    requestPolymarket<unknown[]>("/value", {
      user: wallet,
    }).then((rows) => rows.map((row) => normalizeValue(row, wallet))),
  ]);
  const totalValue = values[0]?.value ?? 0;
  const scored = scoreWalletProfile({
    activity,
    closedPositions,
    openPositions: positions,
    totalValue,
  });

  return {
    activity,
    closedPositions,
    dataFreshness: dataFreshness("polymarket", cachedUntil),
    openPositions: positions,
    scores: scored.scores,
    summary: scored.summary,
    totalValue,
    wallet,
  };
}

function dedupeLeaderboardRows(rows: PolymarketLeaderboardRow[]) {
  const byWallet = new Map<string, PolymarketLeaderboardRow>();

  for (const row of rows) {
    if (!row.proxyWallet) {
      continue;
    }

    const current = byWallet.get(row.proxyWallet);
    if (!current || row.pnl > current.pnl) {
      byWallet.set(row.proxyWallet, row);
    }
  }

  return Array.from(byWallet.values());
}

async function fetchMomentumLeaderboardRows(request: PolymarketMomentumRequest) {
  const pages = Math.ceil(request.scanDepth / leaderboardPageSize);
  const rows = await mapConcurrent(
    Array.from({ length: pages }, (_, page) => page),
    2,
    async (page) => {
      const limit = Math.min(
        leaderboardPageSize,
        request.scanDepth - page * leaderboardPageSize,
      );

      return await fetchLeaderboardRows({
        category: request.category,
        forceRefresh: request.forceRefresh,
        limit,
        offset: page * leaderboardPageSize,
        orderBy: request.orderBy,
        timePeriod: request.timePeriod,
      });
    },
  );

  return dedupeLeaderboardRows(rows.flat());
}

function scoreMomentum({
  closedPositions,
  minSampleSize,
  minWinRate,
  row,
}: {
  closedPositions: PolymarketClosedPosition[];
  minSampleSize: number;
  minWinRate: number;
  row: PolymarketLeaderboardRow;
}) {
  const sample = closedPositions.slice(0, minSampleSize);
  const sampleSize = sample.length;

  if (sampleSize < minSampleSize) {
    return null;
  }

  const winCount = sample.filter((position) => position.realizedPnl > 0).length;
  const lossCount = sample.filter((position) => position.realizedPnl < 0).length;
  const breakEvenCount = sampleSize - winCount - lossCount;
  const winRate = winCount / sampleSize;
  const samplePnl = sample.reduce(
    (total, position) => total + position.realizedPnl,
    0,
  );
  const noLossSample = lossCount === 0;

  if (samplePnl <= 0 || (!noLossSample && winRate < minWinRate)) {
    return null;
  }

  const labels = new Set(leaderboardRowToTrader(row).labels);
  if (noLossSample) {
    labels.add("No-loss sample");
  }
  if (winRate >= minWinRate) {
    labels.add("High win rate");
  }
  if (samplePnl > 10_000 || winRate >= 0.9) {
    labels.add("Hot streak");
  }
  labels.add("Recent momentum");

  const rankScore = Math.max(0, 100 - Math.min(row.rank, 500) / 5);
  const pnlScore = Math.min(100, Math.log10(Math.max(samplePnl, 1)) * 18);
  const momentumScore = Math.round(
    Math.min(
      100,
      winRate * 45 + (noLossSample ? 22 : 0) + pnlScore * 0.22 +
        rankScore * 0.12,
    ),
  );
  const lastTimestamp = sample.reduce(
    (latest, position) => Math.max(latest, position.timestamp ?? 0),
    0,
  );
  const trader = leaderboardRowToTrader(row);

  return {
    ...trader,
    breakEvenCount,
    labels: Array.from(labels),
    lastClosedAt: lastTimestamp > 0
      ? new Date(lastTimestamp * 1000).toISOString()
      : null,
    lossCount,
    momentumScore,
    samplePnl,
    sampleSize,
    scanRank: row.rank,
    winCount,
    winRate,
  };
}

export async function fetchPolymarketMomentum(
  request: PolymarketMomentumRequest,
  cachedUntil: string | null = null,
): Promise<PolymarketMomentumResponse> {
  const env = getEnv();
  const rows = await fetchMomentumLeaderboardRows(request);
  const candidates = await mapConcurrent(rows, 2, async (row) => {
    const closedPositions = await fetchPolymarketClosedPositions(row.proxyWallet, {
      limit: request.sampleSize,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    }).catch(() => null);

    if (!closedPositions) {
      return null;
    }

    const scored = scoreMomentum({
      closedPositions,
      minSampleSize: request.minSampleSize,
      minWinRate: request.minWinRate,
      row,
    });

    return scored
      ? {
          ...scored,
          category: request.category,
        }
      : null;
  });

  return {
    criteria: {
      category: request.category,
      limit: request.limit,
      minSampleSize: request.minSampleSize,
      minWinRate: request.minWinRate,
      orderBy: request.orderBy,
      sampleSize: request.sampleSize,
      scanDepth: request.scanDepth,
      timePeriod: request.timePeriod,
    },
    dataFreshness: dataFreshness(env.USE_DEMO_DATA ? "demo" : "polymarket", cachedUntil),
    traders: candidates
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        candidate != null
      )
      .sort((left, right) =>
        right.momentumScore - left.momentumScore ||
        right.samplePnl - left.samplePnl ||
        right.winRate - left.winRate
      )
      .slice(0, request.limit),
  };
}

async function fetchPolymarketOpenPositions(wallet: string) {
  const env = getEnv();
  const normalizedWallet = wallet.toLowerCase();

  if (env.USE_DEMO_DATA) {
    return demoPositionsByWallet[normalizedWallet] ?? [];
  }

  return await requestPolymarket<unknown[]>("/positions", {
    limit: 50,
    user: normalizedWallet,
  }).then((rows) => rows.map(normalizePosition));
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results: R[] = [];
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    }),
  );

  return results;
}

export async function fetchPolymarketWhales(
  request: PolymarketWhalesRequest,
  cachedUntil: string | null = null,
): Promise<PolymarketWhalesResponse> {
  const leaderboard = await fetchPolymarketLeaderboard(
    {
      ...request,
      limit: request.limit,
      offset: request.offset,
      orderBy: request.orderBy,
    },
    cachedUntil,
  );
  const leaderboardRows = leaderboard.traders.map((trader) => ({
    pnl: trader.pnl,
    profileImage: trader.profileImage,
    proxyWallet: trader.proxyWallet,
    rank: trader.rank,
    userName: trader.userName,
    verifiedBadge: trader.verifiedBadge,
    vol: trader.volume,
    xUsername: trader.xUsername,
  } satisfies PolymarketLeaderboardRow));
  const profiles = await mapConcurrent(leaderboardRows, 8, async (row) => {
    const profile = await fetchPolymarketWalletProfile({
      forceRefresh: request.forceRefresh,
      wallet: row.proxyWallet,
    });

    return profileToWhaleCandidate({
      leaderboardRow: row,
      profile,
    });
  });

  return {
    criteria: {
      category: request.category,
      minValue: request.minValue,
      orderBy: request.orderBy,
      timePeriod: request.timePeriod,
    },
    dataFreshness: leaderboard.dataFreshness,
    whales: profiles
      .filter((candidate) =>
        candidate.volume >= 500_000 || candidate.totalValue >= request.minValue
      )
      .sort((left, right) =>
        right.whaleScore - left.whaleScore ||
        right.scores.edgeScore - left.scores.edgeScore
      ),
  };
}

function groupPositionKey(position: PolymarketPosition) {
  const positionId = position.asset || String(position.outcomeIndex ?? position.outcome);

  return [
    position.conditionId,
    positionId,
  ].join(":");
}

function sharpPlayLabels(play: Pick<SharpPlay, "totalCashPnl" | "totalValue" | "traderCount">) {
  const labels = [`${play.traderCount} smart traders`];

  if (play.totalValue >= 100_000) {
    labels.push("High shared exposure");
  }

  if (play.totalCashPnl > 0) {
    labels.push("Positive consensus PnL");
  }

  return labels;
}

function buildSharpPlay(
  id: string,
  positions: Array<{
    position: PolymarketPosition;
    trader: PolymarketLeaderboardRow;
  }>,
): SharpPlay {
  const first = positions[0].position;
  const traders: SharpPlayTrader[] = positions
    .map(({ position, trader }) => ({
      avgPrice: position.avgPrice,
      cashPnl: position.cashPnl,
      currentValue: position.currentValue,
      pnl: trader.pnl,
      profileImage: trader.profileImage,
      proxyWallet: trader.proxyWallet,
      rank: trader.rank,
      size: position.size,
      userName: trader.userName,
      verifiedBadge: trader.verifiedBadge,
      volume: trader.vol,
    }))
    .sort((left, right) =>
      right.currentValue - left.currentValue || left.rank - right.rank
    );
  const totalValue = traders.reduce(
    (total, trader) => total + trader.currentValue,
    0,
  );
  const totalCashPnl = traders.reduce(
    (total, trader) => total + trader.cashPnl,
    0,
  );
  const totalSize = traders.reduce((total, trader) => total + trader.size, 0);
  const avgEntry = totalSize > 0
    ? traders.reduce(
        (total, trader) => total + trader.avgPrice * trader.size,
        0,
      ) / totalSize
    : 0;
  const traderCount = traders.length;
  const convictionScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        traderCount * 14 + Math.log10(Math.max(totalValue, 1)) * 8 +
          (totalCashPnl > 0 ? 12 : 0),
      ),
    ),
  );
  const play = {
    asset: first.asset,
    avgEntry,
    conditionId: first.conditionId,
    convictionScore,
    curPrice: first.curPrice,
    endDate: first.endDate,
    eventSlug: first.eventSlug,
    id,
    labels: [],
    outcome: first.outcome,
    outcomeIndex: first.outcomeIndex,
    slug: first.slug,
    title: first.title,
    totalCashPnl,
    totalSize,
    totalValue,
    traderCount,
    traders,
  };

  return {
    ...play,
    labels: sharpPlayLabels(play),
  };
}

export async function fetchPolymarketSharpPlays(
  request: PolymarketSharpPlaysRequest,
  cachedUntil: string | null = null,
): Promise<PolymarketSharpPlaysResponse> {
  const leaderboard = await fetchPolymarketLeaderboard(request, cachedUntil);
  const leaderboardRows = leaderboard.traders.map((trader) => ({
    pnl: trader.pnl,
    profileImage: trader.profileImage,
    proxyWallet: trader.proxyWallet,
    rank: trader.rank,
    userName: trader.userName,
    verifiedBadge: trader.verifiedBadge,
    vol: trader.volume,
    xUsername: trader.xUsername,
  } satisfies PolymarketLeaderboardRow));
  const positionGroups = new Map<
    string,
    Array<{ position: PolymarketPosition; trader: PolymarketLeaderboardRow }>
  >();

  await mapConcurrent(leaderboardRows, 8, async (trader) => {
    const positions = await fetchPolymarketOpenPositions(trader.proxyWallet);

    for (const position of positions) {
      if (position.currentValue <= 0 || !position.conditionId) {
        continue;
      }

      const key = groupPositionKey(position);
      const group = positionGroups.get(key) ?? [];
      group.push({ position, trader });
      positionGroups.set(key, group);
    }
  });

  return {
    criteria: {
      category: request.category,
      minTraders: request.minTraders,
      orderBy: request.orderBy,
      timePeriod: request.timePeriod,
    },
    dataFreshness: leaderboard.dataFreshness,
    plays: Array.from(positionGroups.entries())
      .filter(([, positions]) => positions.length >= request.minTraders)
      .map(([id, positions]) => buildSharpPlay(id, positions))
      .sort((left, right) =>
        right.traderCount - left.traderCount ||
        right.totalValue - left.totalValue ||
        right.convictionScore - left.convictionScore
      ),
  };
}

export const polymarketTtlMs = {
  leaderboard: leaderboardTtlMs,
  momentum: momentumTtlMs,
  sharpPlays: sharpPlaysTtlMs,
  wallet: walletTtlMs,
  whales: whalesTtlMs,
};

export { buildDataApiUrl };
