import type { OptionType } from "@/lib/wheel/types";

/** Wire shapes returned by Alpaca. Kept separate from application domain types. */
export interface AlpacaOptionContract {
  symbol: string;
  expiration_date: string;
  type: OptionType;
  strike_price: string;
  open_interest?: string | null;
  tradable?: boolean;
}

export interface AlpacaBar {
  c: number;
  h: number;
  l: number;
  o: number;
  t: string;
  v: number;
  vw?: number;
}

export interface AlpacaOptionSnapshot {
  dailyBar?: AlpacaBar;
  greeks?: { delta?: number; theta?: number };
  impliedVolatility?: number;
  latestQuote?: { ap?: number; bp?: number; t?: string };
}

export interface AlpacaContractsResponse {
  option_contracts?: AlpacaOptionContract[];
  next_page_token?: string | null;
  message?: string;
}

export interface AlpacaSnapshotsResponse {
  snapshots?: Record<string, AlpacaOptionSnapshot>;
  next_page_token?: string | null;
  message?: string;
}

export interface AlpacaBarsResponse {
  bars?: AlpacaBar[];
  message?: string;
}
export interface AlpacaMultiBarsResponse {
  bars?: Record<string, AlpacaBar[]> | AlpacaBar[];
  next_page_token?: string | null;
  message?: string;
}
export interface AlpacaLatestBarResponse {
  bar?: AlpacaBar;
  message?: string;
}

export interface AlpacaStockSnapshot {
  dailyBar?: AlpacaBar;
  latestQuote?: {
    ap?: number;
    as?: number;
    bp?: number;
    bs?: number;
    t?: string;
  };
  latestTrade?: { p?: number; s?: number; t?: string };
  minuteBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}
export interface AlpacaStockSnapshotsResponse {
  snapshots?: Record<string, AlpacaStockSnapshot>;
  message?: string;
}

export interface AlpacaAsset {
  id?: string;
  symbol: string;
  name?: string | null;
  exchange: string;
  asset_class: string;
  status: string;
  tradable: boolean;
  easy_to_borrow?: boolean;
  fractionable?: boolean;
  maintenance_margin_requirement?: number | string | null;
  marginable?: boolean;
  shortable?: boolean;
  attributes?: string[];
}
