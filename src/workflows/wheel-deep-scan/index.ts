import type {
  UniverseDeepScanCoverageRequest,
  UniverseDeepScanCoverageResult,
} from "@/lib/wheel/universe-scanner";
import { runDeepScanCoverageBatch } from "./steps";

export async function wheelDeepScanWorkflow(
  request: UniverseDeepScanCoverageRequest,
): Promise<UniverseDeepScanCoverageResult> {
  "use workflow";

  return runDeepScanCoverageBatch(request);
}
