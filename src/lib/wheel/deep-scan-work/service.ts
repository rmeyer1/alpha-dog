import { marketBatchRequestIdentity } from "../market-batch/domain";
import type { MarketBatchOptionStageSummary } from "../market-batch/model";
import { scoreSharedMarketBatchConsumer } from "../market-batch/service";
import { optionTypeForStrategy } from "../universe-scanner/candidate-domain";
import {
  deepScanCandidateRow,
} from "../universe-scanner/repository";
import type { WheelScreenerRequest } from "../types";
import type {
  DeepScanWorkClaim,
  TieredDeepScanCompatibilitySummary,
} from "./model";
import {
  heartbeatDeepScanWork,
  publishDeepScanCompatibility,
} from "./repository";

export async function publishTieredDeepScanCompatibility({
  batchId,
  claims,
  leaseSeconds,
  optionStages,
  ownerId,
  requests,
}: {
  batchId: string;
  claims: DeepScanWorkClaim[];
  leaseSeconds: number;
  optionStages: MarketBatchOptionStageSummary[];
  ownerId: string;
  requests: WheelScreenerRequest[];
}): Promise<TieredDeepScanCompatibilitySummary> {
  // Renew early to avoid scoring work that is already stale. The publication
  // RPC revalidates and locks the same tokens again at the mutation boundary.
  await heartbeatDeepScanWork({
    claims,
    leaseSeconds,
    ownerId,
  });

  let candidateCount = 0;
  let coverageRowCount = 0;
  const candidateRows: Record<string, unknown>[] = [];
  const coverageRows: Record<string, unknown>[] = [];
  const stageByUnit = new Map(
    optionStages.map((stage) => [
      `${stage.symbol}:${stage.optionType}`,
      stage,
    ]),
  );

  for (const request of requests) {
    const optionType = optionTypeForStrategy(request.strategy);
    const requestClaims = claims.filter(
      (claim) => claim.optionType === optionType,
    );

    if (requestClaims.length === 0) {
      continue;
    }

    const identity = marketBatchRequestIdentity(request);
    const context = {
      filterKey: identity.filterKey,
      filters: identity.filters,
      persona: request.persona,
      strategy: request.strategy,
    };
    const scored = await scoreSharedMarketBatchConsumer(batchId, {
      ...request,
      limit: requestClaims.length,
    });
    const companyBySymbol = new Map(
      scored.companies.map((company) => [company.ticker, company]),
    );
    candidateRows.push(
      ...scored.companies.map((company) =>
        deepScanCandidateRow(context, null, company)
      ),
    );
    candidateCount += scored.companies.length;

    for (const claim of requestClaims) {
      const company = companyBySymbol.get(claim.symbol);
      const stage = stageByUnit.get(`${claim.symbol}:${claim.optionType}`);

      coverageRows.push({
        best_score: company?.score ?? null,
        error:
          stage?.error ??
          (stage ? null : "Claimed underlying facts were unavailable."),
        filter_key: context.filterKey,
        option_contract_count: stage?.contractCount ?? 0,
        option_type: claim.optionType,
        persona: context.persona,
        scan_run_id: null,
        status: company
          ? "complete"
          : stage?.error || !stage
            ? "failed"
            : "no_candidate",
        strategy: context.strategy,
        symbol: claim.symbol,
      });
    }

    coverageRowCount += requestClaims.length;
  }

  await publishDeepScanCompatibility({
    candidates: candidateRows,
    claims,
    coverage: coverageRows,
    leaseSeconds,
    ownerId,
  });

  return {
    candidateCount,
    consumerCount: requests.length,
    coverageRowCount,
  };
}
