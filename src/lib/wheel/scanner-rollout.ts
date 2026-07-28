import { emitTelemetry } from "@/lib/observability/telemetry";
import { requestSupabaseRest } from "@/lib/supabase/rest";
import { getMaterializedWheelScreenerResponse } from "./materialized-screener";
import { getSharedMarketBatchScreenerResponse } from "./market-batch/reader";
import type {
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "./types";

export type WheelScannerReadSource = "legacy" | "replacement";

interface ScannerRolloutControlRow {
  observation_started_on: string | null;
  read_source: WheelScannerReadSource;
  updated_at: string;
}

export interface ControlledWheelScreenerRead {
  fallback: boolean;
  requestedSource: WheelScannerReadSource;
  response: WheelScreenerResponse | null;
  source: WheelScannerReadSource | null;
}

export async function getWheelScannerReadSource():
  Promise<WheelScannerReadSource> {
  try {
    const rows = await requestSupabaseRest<ScannerRolloutControlRow[]>(
      "wheel_scanner_rollout_control",
      {
        query: {
          id: "eq.true",
          limit: 1,
          select: "read_source,observation_started_on,updated_at",
        },
      },
    );

    return rows?.[0]?.read_source === "replacement"
      ? "replacement"
      : "legacy";
  } catch (error) {
    emitTelemetry({
      error,
      event: "wheel.scanner_rollout_control",
      outcome: "legacy_fail_safe",
      severity: "warn",
    });
    return "legacy";
  }
}

export async function getControlledWheelScreenerRead(
  request: WheelScreenerRequest,
): Promise<ControlledWheelScreenerRead> {
  const requestedSource = await getWheelScannerReadSource();

  if (requestedSource === "legacy") {
    return {
      fallback: false,
      requestedSource,
      response: await getMaterializedWheelScreenerResponse(request),
      source: "legacy",
    };
  }

  const replacement = await getSharedMarketBatchScreenerResponse(request);

  if (replacement) {
    emitTelemetry({
      event: "wheel.scanner_rollout_read",
      operation: "replacement",
      outcome: "selected",
    });
    return {
      fallback: false,
      requestedSource,
      response: replacement,
      source: "replacement",
    };
  }

  const legacy = await getMaterializedWheelScreenerResponse(request);

  emitTelemetry({
    event: "wheel.scanner_rollout_read",
    operation: "replacement",
    outcome: legacy ? "legacy_fallback" : "unavailable",
    severity: legacy ? "warn" : "error",
  });

  return {
    fallback: Boolean(legacy),
    requestedSource,
    response: legacy,
    source: legacy ? "legacy" : null,
  };
}
