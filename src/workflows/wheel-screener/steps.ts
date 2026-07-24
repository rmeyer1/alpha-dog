import { getWritable } from "workflow";
import {
  analyzeTopWheelCompanies,
  cacheCompletedWheelScreenerResponse,
} from "@/lib/wheel/screener";
import type { DurableTelemetryContext } from "@/lib/observability/context";
import {
  emitWorkflowTelemetry,
  runWithDurableTelemetryContext,
} from "@/lib/observability/workflow";
import {
  completeMaterializedWheelScreenerSnapshot,
  createMaterializedWheelScreenerSnapshot,
  failMaterializedWheelScreenerSnapshot,
  heartbeatMaterializedWheelScreenerSnapshot,
  upsertMaterializedWheelScreenerCandidates,
} from "@/lib/wheel/materialized-screener";
import type {
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "@/lib/wheel/types";

export async function screenWheelCompaniesBatch(
  request: WheelScreenerRequest,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  return runWithDurableTelemetryContext(
    telemetryContext,
    () => analyzeTopWheelCompanies(request),
  );
}

export async function writeScreenerProgress(
  response: WheelScreenerResponse,
) {
  "use step";

  const writable = getWritable<Uint8Array>();
  const writer = writable.getWriter();
  const encoded = new TextEncoder().encode(`${JSON.stringify(response)}\n`);

  await writer.write(encoded);
  writer.releaseLock();
}

export async function closeScreenerProgress() {
  "use step";

  await getWritable<Uint8Array>().close();
}

export async function cacheScreenerResult(
  request: WheelScreenerRequest,
  response: WheelScreenerResponse,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () => cacheCompletedWheelScreenerResponse(request, response),
  );
}

export async function createScreenerSnapshot(
  request: WheelScreenerRequest,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  return runWithDurableTelemetryContext(
    telemetryContext,
    () => createMaterializedWheelScreenerSnapshot(request),
  );
}

export async function upsertScreenerSnapshotCandidates(
  snapshotId: string | null,
  request: WheelScreenerRequest,
  response: WheelScreenerResponse,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () =>
      upsertMaterializedWheelScreenerCandidates(
        snapshotId,
        request,
        response,
      ),
  );
}

export async function completeScreenerSnapshot(
  snapshotId: string | null,
  response: WheelScreenerResponse,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () => completeMaterializedWheelScreenerSnapshot(snapshotId, response),
  );
}

export async function heartbeatScreenerSnapshot(
  snapshotId: string | null,
  response: WheelScreenerResponse,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () => heartbeatMaterializedWheelScreenerSnapshot(snapshotId, response),
  );
}

export async function failScreenerSnapshot(
  snapshotId: string | null,
  errorMessage: string,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () => failMaterializedWheelScreenerSnapshot(snapshotId, errorMessage),
  );
}

export async function recordScreenerWorkflowLifecycle(
  telemetryContext: DurableTelemetryContext,
  phase: "completed" | "failed" | "resumed",
) {
  "use step";

  await runWithDurableTelemetryContext(telemetryContext, (normalized) =>
    emitWorkflowTelemetry({
      context: normalized,
      phase,
      workflow: "wheel_screener",
    })
  );
}
