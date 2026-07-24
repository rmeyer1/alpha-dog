import {
  completeStagedUniverseDeepScanCoverage,
  failStagedUniverseDeepScanCoverage,
  stageUniverseDeepScanCoverage,
  type UniverseDeepScanCoverageRequest,
} from "@/lib/wheel/universe-scanner";

export async function stageDeepScanCoverageBatch(
  request: UniverseDeepScanCoverageRequest,
  idempotencyKey: string,
) {
  "use step";

  return stageUniverseDeepScanCoverage(request, idempotencyKey);
}

export async function completeDeepScanCoverageBatch(runId: string) {
  "use step";

  return completeStagedUniverseDeepScanCoverage(runId);
}

export async function failDeepScanCoverageBatch(
  runId: string,
  errorMessage: string,
) {
  "use step";

  await failStagedUniverseDeepScanCoverage(runId, new Error(errorMessage));
}
