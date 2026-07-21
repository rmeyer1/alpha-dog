export type PaidRouteAccess =
  | "authenticated-only"
  | "anonymous-with-quota"
  | "internal-only"
  | "public-cacheable";

export interface PaidRoutePolicy {
  access: PaidRouteAccess;
  concurrencyLimit: number;
  ipLimit: number;
  leaseSeconds: number;
  providerTimeoutMs: number;
  routeKey: string;
  userLimit: number;
  windowSeconds: number;
}

export const paidRoutePolicies = {
  alpacaFeedTest: {
    access: "internal-only",
    concurrencyLimit: 2,
    ipLimit: 10,
    leaseSeconds: 20,
    providerTimeoutMs: 10_000,
    routeKey: "alpaca.feed_test",
    userLimit: 10,
    windowSeconds: 300,
  },
  finnhubCompany: {
    access: "anonymous-with-quota",
    concurrencyLimit: 8,
    ipLimit: 30,
    leaseSeconds: 20,
    providerTimeoutMs: 10_000,
    routeKey: "finnhub.company",
    userLimit: 60,
    windowSeconds: 300,
  },
  logoCacheMiss: {
    access: "public-cacheable",
    concurrencyLimit: 12,
    ipLimit: 120,
    leaseSeconds: 10,
    providerTimeoutMs: 5_000,
    routeKey: "logo.cache_miss",
    userLimit: 240,
    windowSeconds: 300,
  },
  polymarketCacheMiss: {
    access: "public-cacheable",
    concurrencyLimit: 6,
    ipLimit: 30,
    leaseSeconds: 30,
    providerTimeoutMs: 15_000,
    routeKey: "polymarket.cache_miss",
    userLimit: 60,
    windowSeconds: 300,
  },
  polymarketForceRefresh: {
    access: "authenticated-only",
    concurrencyLimit: 4,
    ipLimit: 12,
    leaseSeconds: 30,
    providerTimeoutMs: 15_000,
    routeKey: "polymarket.force_refresh",
    userLimit: 6,
    windowSeconds: 300,
  },
  tradeAnalyze: {
    access: "authenticated-only",
    concurrencyLimit: 2,
    ipLimit: 16,
    leaseSeconds: 60,
    providerTimeoutMs: 45_000,
    routeKey: "trade.analyze",
    userLimit: 8,
    windowSeconds: 60,
  },
  wheelAnalyze: {
    access: "authenticated-only",
    concurrencyLimit: 2,
    ipLimit: 20,
    leaseSeconds: 45,
    providerTimeoutMs: 30_000,
    routeKey: "wheel.analyze",
    userLimit: 10,
    windowSeconds: 300,
  },
  wheelScreenerStart: {
    access: "authenticated-only",
    concurrencyLimit: 2,
    ipLimit: 8,
    leaseSeconds: 30,
    providerTimeoutMs: 20_000,
    routeKey: "wheel.screener_start",
    userLimit: 4,
    windowSeconds: 900,
  },
  wheelScreenerStatus: {
    access: "authenticated-only",
    concurrencyLimit: 20,
    ipLimit: 240,
    leaseSeconds: 30,
    providerTimeoutMs: 15_000,
    routeKey: "wheel.screener_status",
    userLimit: 120,
    windowSeconds: 300,
  },
} as const satisfies Record<string, PaidRoutePolicy>;

export type PaidRoutePolicyKey = keyof typeof paidRoutePolicies;
