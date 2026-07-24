import type {
  UniverseDeepScanCoverageRequest,
  UniverseDeepScanCoverageResult,
} from "@/lib/wheel/universe-scanner";
import {
  completeDeepScanCoverageBatch,
  failDeepScanCoverageBatch,
  stageDeepScanCoverageBatch,
} from "./steps";

export async function wheelDeepScanWorkflow(
  request: UniverseDeepScanCoverageRequest,
): Promise<UniverseDeepScanCoverageResult> {
  "use workflow";

  if (!request.workflowIdempotencyKey) {
    throw new Error("Deep scan Workflow requires an idempotency key.");
  }

  const staged = await stageDeepScanCoverageBatch(
    request,
    request.workflowIdempotencyKey,
  );

  if (!staged.runId) {
    if (!staged.result) {
      throw new Error("Deep scan was not staged and returned no result.");
    }

    return staged.result;
  }

  try {
    return await completeDeepScanCoverageBatch(staged.runId);
  } catch (error) {
    await failDeepScanCoverageBatch(
      staged.runId,
      error instanceof Error ? error.message : "Deep scan publication failed.",
    );
    throw error;
  }
}
