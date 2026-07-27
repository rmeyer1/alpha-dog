import type { SavedPositionLegSnapshot } from "@/components/wheel-dashboard/position-leg-snapshot";

export type PositionTab = "history" | "open";

export type PositionValuation = {
  markStatus: "available" | "unavailable";
  markToClose: number | null;
  openExposure: number;
  premiumRemaining: number;
  unrealizedPnl: number | null;
};

export type PositionDataProvenance = {
  asOf: string | null;
  cacheSource: string | null;
  cacheStatus: string | null;
  feed: string | null;
  sourceMode: "demo" | "live" | "unknown";
};

export type PositionLifecycleOutcome =
  | "assigned"
  | "called_away"
  | "expired_otm"
  | "manual_review";

export type PositionLifecycleSummary = {
  cashDelta: number;
  effectiveAt: string;
  eventId: string;
  eventType: string;
  marginDelta: number;
  metadata: Record<string, unknown>;
  outcome: PositionLifecycleOutcome;
  price: number | null;
  quantity: number | null;
  realizedPnlDelta: number;
};

export type PositionSummary = {
  closedAt: string | null;
  contractsOpened: number;
  contractsRemaining: number;
  dataProvenance: PositionDataProvenance;
  expirationDate: string | null;
  id: string;
  lifecycle: PositionLifecycleSummary | null;
  netCredit: number;
  notes: string | null;
  openedAt: string;
  source: string;
  status: string;
  strategyType: string;
  symbol: string;
  underlyingPriceAtOpen: number | null;
  valuation: PositionValuation;
};

export type PositionEvent = {
  cashDelta: number;
  createdAt: string;
  eventType: string;
  id: string;
  marginDelta: number;
  metadata: Record<string, unknown>;
  price: number | null;
  quantity: number | null;
  realizedPnlDelta: number;
};

export type PositionDetail = PositionSummary & {
  events: PositionEvent[];
  legs: SavedPositionLegSnapshot[];
  nextEventCursor: string | null;
};

export type PositionPage = {
  items: PositionSummary[];
  nextCursor: string | null;
  total: number;
};
export type PositionsPayload = {
  pages: { history: PositionPage; open: PositionPage };
};

export type LoadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      announcement: string;
      data: PositionsPayload;
      pageError: Partial<Record<PositionTab, string>>;
      pageLoading: PositionTab | null;
      status: "ready";
    };

export type DetailState =
  | { status: "idle" }
  | { id: string; status: "loading" }
  | { code?: string; message: string; status: "error" }
  | {
      data: PositionDetail;
      eventError?: string;
      eventsLoading?: boolean;
      status: "ready";
    };

export type CloseSubmitState =
  | { status: "idle" }
  | { message: string; stale?: boolean; status: "error" }
  | { message: string; status: "success" }
  | { status: "submitting" };
