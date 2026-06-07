import { getWritable } from "workflow";
import {
  analyzeTopWheelCompanies,
  cacheCompletedWheelScreenerResponse,
} from "@/lib/wheel/screener";
import {
  completeMaterializedWheelScreenerSnapshot,
  createMaterializedWheelScreenerSnapshot,
  failMaterializedWheelScreenerSnapshot,
  upsertMaterializedWheelScreenerCandidates,
} from "@/lib/wheel/materialized-screener";
import type {
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "@/lib/wheel/types";

export async function screenWheelCompaniesBatch(
  request: WheelScreenerRequest,
) {
  "use step";

  return analyzeTopWheelCompanies(request);
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
) {
  "use step";

  await cacheCompletedWheelScreenerResponse(request, response);
}

export async function createScreenerSnapshot(request: WheelScreenerRequest) {
  "use step";

  return createMaterializedWheelScreenerSnapshot(request);
}

export async function upsertScreenerSnapshotCandidates(
  snapshotId: string | null,
  request: WheelScreenerRequest,
  response: WheelScreenerResponse,
) {
  "use step";

  await upsertMaterializedWheelScreenerCandidates(
    snapshotId,
    request,
    response,
  );
}

export async function completeScreenerSnapshot(
  snapshotId: string | null,
  response: WheelScreenerResponse,
) {
  "use step";

  await completeMaterializedWheelScreenerSnapshot(snapshotId, response);
}

export async function failScreenerSnapshot(
  snapshotId: string | null,
  errorMessage: string,
) {
  "use step";

  await failMaterializedWheelScreenerSnapshot(snapshotId, errorMessage);
}
