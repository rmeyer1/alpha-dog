import type {
  PersonaId,
  WheelCompanyStrategy,
  WheelFilters,
} from "@/lib/wheel/types";
import {
  polymarketCategories,
  polymarketOrderByValues,
  polymarketTimePeriods,
  type PolymarketCategory,
  type PolymarketOrderBy,
  type PolymarketTimePeriod,
} from "@/lib/polymarket/types";

export type WheelDashboardTab =
  | "puts"
  | "calls"
  | "putSpreads"
  | "callSpreads";

export interface WheelDashboardUrlState {
  filters: WheelFilters;
  personaId: PersonaId;
  screenerStrategy: WheelCompanyStrategy;
  tab: WheelDashboardTab;
  ticker: string;
}

export type TraderDashboardTab = "smart" | "whales" | "sharp" | "lookup";

export interface TraderAppliedFilters {
  category: PolymarketCategory;
  limit: number;
  minValue: number;
  orderBy: PolymarketOrderBy;
  timePeriod: PolymarketTimePeriod;
}

export interface TraderDashboardUrlState {
  filters: TraderAppliedFilters;
  tab: TraderDashboardTab;
  wallet: string;
}

const wheelStrategies: WheelCompanyStrategy[] = [
  "short_put",
  "covered_call",
  "put_credit_spread",
  "call_credit_spread",
];
const wheelTabs: WheelDashboardTab[] = [
  "puts",
  "calls",
  "putSpreads",
  "callSpreads",
];
const traderTabs: TraderDashboardTab[] = [
  "smart",
  "whales",
  "sharp",
  "lookup",
];

function numericParam(
  params: URLSearchParams,
  key: string,
  fallback: number,
  {
    integer = false,
    max = Number.POSITIVE_INFINITY,
    min = Number.NEGATIVE_INFINITY,
  }: {
    integer?: boolean;
    max?: number;
    min?: number;
  } = {},
): number {
  const rawValue = params.get(key);

  if (rawValue === null || rawValue.trim() === "") {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) &&
      (!integer || Number.isInteger(value)) &&
      value >= min &&
      value <= max
    ? value
    : fallback;
}

function booleanParam(
  params: URLSearchParams,
  key: string,
  fallback: boolean,
): boolean {
  const value = params.get(key);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function enumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return value && values.includes(value as T) ? value as T : fallback;
}

export function serializeWheelDashboardState(
  state: WheelDashboardUrlState,
): URLSearchParams {
  const params = new URLSearchParams({
    persona: state.personaId,
    strategy: state.screenerStrategy,
    tab: state.tab,
    f_dteMin: String(state.filters.dteMin),
    f_dteMax: String(state.filters.dteMax),
    f_deltaMin: String(state.filters.deltaMin),
    f_deltaMax: String(state.filters.deltaMax),
    f_minPremiumYield: String(state.filters.minPremiumYield),
    f_minVolume: String(state.filters.minVolume),
    f_minOpenInterest: String(state.filters.minOpenInterest),
    f_maxSpreadPctOfMid: String(state.filters.maxSpreadPctOfMid),
    f_minSpreadReturnOnRisk: String(state.filters.minSpreadReturnOnRisk),
    f_maxSpreadWidth: String(state.filters.maxSpreadWidth),
    f_spreadLongLegCount: String(state.filters.spreadLongLegCount),
    f_excludeEarnings: String(state.filters.excludeEarnings),
    f_includeWeeklies: String(state.filters.includeWeeklies),
  });

  if (state.ticker) {
    params.set("ticker", state.ticker.toUpperCase());
  }

  return params;
}

export function parseWheelDashboardState(
  search: string | URLSearchParams,
  defaults: WheelDashboardUrlState,
  personaIds: readonly PersonaId[],
): WheelDashboardUrlState {
  const params = typeof search === "string"
    ? new URLSearchParams(search)
    : search;

  return {
    filters: {
      dteMin: numericParam(params, "f_dteMin", defaults.filters.dteMin, {
        integer: true,
        max: 365,
        min: 1,
      }),
      dteMax: numericParam(params, "f_dteMax", defaults.filters.dteMax, {
        integer: true,
        max: 730,
        min: 1,
      }),
      deltaMin: numericParam(params, "f_deltaMin", defaults.filters.deltaMin, {
        max: 1,
        min: 0,
      }),
      deltaMax: numericParam(params, "f_deltaMax", defaults.filters.deltaMax, {
        max: 1,
        min: 0,
      }),
      minPremiumYield: numericParam(
        params,
        "f_minPremiumYield",
        defaults.filters.minPremiumYield,
        { max: 1, min: 0 },
      ),
      minVolume: numericParam(
        params,
        "f_minVolume",
        defaults.filters.minVolume,
        { integer: true, min: 0 },
      ),
      minOpenInterest: numericParam(
        params,
        "f_minOpenInterest",
        defaults.filters.minOpenInterest,
        { integer: true, min: 0 },
      ),
      maxSpreadPctOfMid: numericParam(
        params,
        "f_maxSpreadPctOfMid",
        defaults.filters.maxSpreadPctOfMid,
        { max: 10, min: 0 },
      ),
      minSpreadReturnOnRisk: numericParam(
        params,
        "f_minSpreadReturnOnRisk",
        defaults.filters.minSpreadReturnOnRisk,
        { max: 5, min: 0 },
      ),
      maxSpreadWidth: numericParam(
        params,
        "f_maxSpreadWidth",
        defaults.filters.maxSpreadWidth,
        { max: 100, min: 1 },
      ),
      spreadLongLegCount: numericParam(
        params,
        "f_spreadLongLegCount",
        defaults.filters.spreadLongLegCount,
        { integer: true, max: 10, min: 1 },
      ),
      excludeEarnings: booleanParam(
        params,
        "f_excludeEarnings",
        defaults.filters.excludeEarnings,
      ),
      includeWeeklies: booleanParam(
        params,
        "f_includeWeeklies",
        defaults.filters.includeWeeklies,
      ),
    },
    personaId: enumParam(params, "persona", personaIds, defaults.personaId),
    screenerStrategy: enumParam(
      params,
      "strategy",
      wheelStrategies,
      defaults.screenerStrategy,
    ),
    tab: enumParam(params, "tab", wheelTabs, defaults.tab),
    ticker: (params.get("ticker") ?? defaults.ticker).trim().toUpperCase(),
  };
}

export function serializeTraderDashboardState(
  state: TraderDashboardUrlState,
): URLSearchParams {
  const params = new URLSearchParams({
    tab: state.tab,
    category: state.filters.category,
    timePeriod: state.filters.timePeriod,
    orderBy: state.filters.orderBy,
    limit: String(state.filters.limit),
    minValue: String(state.filters.minValue),
  });

  if (state.wallet) {
    params.set("wallet", state.wallet.toLowerCase());
  }

  return params;
}

export function parseTraderDashboardState(
  search: string | URLSearchParams,
  defaults: TraderDashboardUrlState,
): TraderDashboardUrlState {
  const params = typeof search === "string"
    ? new URLSearchParams(search)
    : search;

  return {
    filters: {
      category: enumParam(
        params,
        "category",
        polymarketCategories,
        defaults.filters.category,
      ),
      limit: numericParam(params, "limit", defaults.filters.limit, {
        integer: true,
        max: 50,
        min: 1,
      }),
      minValue: numericParam(params, "minValue", defaults.filters.minValue, {
        max: 10_000_000,
        min: 0,
      }),
      orderBy: enumParam(
        params,
        "orderBy",
        polymarketOrderByValues,
        defaults.filters.orderBy,
      ),
      timePeriod: enumParam(
        params,
        "timePeriod",
        polymarketTimePeriods,
        defaults.filters.timePeriod,
      ),
    },
    tab: enumParam(params, "tab", traderTabs, defaults.tab),
    wallet: (params.get("wallet") ?? defaults.wallet).trim().toLowerCase(),
  };
}
