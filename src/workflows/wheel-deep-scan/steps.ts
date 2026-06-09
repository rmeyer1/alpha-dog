import {
  runUniverseDeepScanCoverage,
  type UniverseDeepScanCoverageRequest,
} from "@/lib/wheel/universe-scanner";

export async function runDeepScanCoverageBatch(
  request: UniverseDeepScanCoverageRequest,
) {
  "use step";

  return runUniverseDeepScanCoverage(request);
}
