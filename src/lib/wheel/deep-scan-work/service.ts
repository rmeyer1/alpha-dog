import { marketBatchRequestIdentity } from "../market-batch/domain";
import type { MarketBatchOptionStageSummary } from "../market-batch/model";
import { scoreSharedMarketBatchConsumer } from "../market-batch/service";
import { optionTypeForStrategy } from "../universe-scanner/candidate-domain";
import {
  deleteDeepScanCandidate,
  upsertDeepScanCandidates,
  upsertDeepScanCoverageRows,
} from "../universe-scanner/repository";
import type { WheelScreenerRequest } from "../types";
import type {
  DeepScanWorkClaim,
  TieredDeepScanCompatibilitySummary,
} from "./model";
import { heartbeatDeepScanWork } from "./repository";

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
  // Revalidate and extend every token inside the publication step so a
  // resumed stale workflow cannot touch the legacy reader tables.
  await heartbeatDeepScanWork({
    claims,
    leaseSeconds,
    ownerId,
  });

  let candidateCount = 0;
  let coverageRowCount = 0;
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
    const coverageRows: Parameters<typeof upsertDeepScanCoverageRows>[1] = [];

    await upsertDeepScanCandidates(context, null, scored.companies);
    candidateCount += scored.companies.length;

    for (const claim of requestClaims) {
      const company = companyBySymbol.get(claim.symbol);
      const stage = stageByUnit.get(`${claim.symbol}:${claim.optionType}`);

      if (!company) {
        await deleteDeepScanCandidate(context, claim.symbol);
      }

      coverageRows.push({
        bestScore: company?.score ?? null,
        error:
          stage?.error ??
          (stage ? null : "Claimed underlying facts were unavailable."),
        optionContractCount: stage?.contractCount ?? 0,
        runId: null,
        status: company
          ? "complete"
          : stage?.error || !stage
            ? "failed"
            : "no_candidate",
        symbol: claim.symbol,
      });
    }

    await upsertDeepScanCoverageRows(context, coverageRows);
    coverageRowCount += coverageRows.length;
  }

  return {
    candidateCount,
    consumerCount: requests.length,
    coverageRowCount,
  };
}
