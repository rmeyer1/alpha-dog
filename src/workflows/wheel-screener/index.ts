import { sleep } from "workflow";
import type {
  Warning,
  WheelCompanyScore,
  WheelScreenerRequest,
  WheelScreenerResponse,
} from "@/lib/wheel/types";
import {
  cacheScreenerResult,
  closeScreenerProgress,
  completeScreenerSnapshot,
  createScreenerSnapshot,
  failScreenerSnapshot,
  screenWheelCompaniesBatch,
  upsertScreenerSnapshotCandidates,
  writeScreenerProgress,
} from "./steps";

const workflowBatchSize = 32;
const workflowBatchDelay = "1s";

function warningKey(warning: Warning) {
  if (warning.message.startsWith("Live refresh failed; showing cached analysis")) {
    return `${warning.type}:${warning.severity}:live-analysis-stale-fallback`;
  }

  return `${warning.type}:${warning.severity}:${warning.message}`;
}

function mergeWarnings(current: Warning[], incoming: Warning[]) {
  const warnings = [...current];
  const seen = new Set(current.map(warningKey));

  for (const warning of incoming) {
    const key = warningKey(warning);

    if (!seen.has(key)) {
      seen.add(key);
      warnings.push(warning);
    }
  }

  return warnings;
}

function rankCompanyScores(
  current: WheelCompanyScore[],
  incoming: WheelCompanyScore[],
  limit: number,
) {
  const byTicker = new Map<string, WheelCompanyScore>();

  for (const company of [...current, ...incoming]) {
    const existing = byTicker.get(company.ticker);

    if (!existing || company.score > existing.score) {
      byTicker.set(company.ticker, company);
    }
  }

  return Array.from(byTicker.values())
    .sort((left, right) =>
      right.score - left.score || left.ticker.localeCompare(right.ticker)
    )
    .slice(0, limit)
    .map((company, index) => ({
      ...company,
      rank: index + 1,
    }));
}

function mergeScreenerResponse(
  current: WheelScreenerResponse | null,
  incoming: WheelScreenerResponse,
  limit: number,
) {
  if (!current || incoming.progress.resultScope === "complete") {
    return {
      ...incoming,
      companies: rankCompanyScores([], incoming.companies, limit),
    };
  }

  const companies = rankCompanyScores(
    current.companies,
    incoming.companies,
    limit,
  );
  const completed = incoming.progress.status === "complete";

  return {
    ...incoming,
    companies,
    screenedCount: incoming.progress.processedCount,
    skippedCount: current.skippedCount + incoming.skippedCount,
    warnings: mergeWarnings(current.warnings, incoming.warnings),
    errors:
      completed && companies.length === 0 &&
      current.errors.length + incoming.errors.length === 0
        ? ["No companies produced a matching wheel candidate."]
        : [...current.errors, ...incoming.errors].slice(0, 25),
  };
}

function completeProgress(response: WheelScreenerResponse) {
  return {
    ...response,
    progress: {
      ...response.progress,
      status: "complete" as const,
      resultScope: "complete" as const,
      nextCursor: null,
      processedCount: response.progress.totalCount,
    },
    screenedCount: response.progress.totalCount,
  };
}

export async function wheelScreenerWorkflow(
  request: WheelScreenerRequest,
): Promise<WheelScreenerResponse> {
  "use workflow";

  const limit = request.limit ?? 50;
  const batchSize = request.batchSize ?? workflowBatchSize;
  const batchResultLimit = Math.max(limit, batchSize);
  let cursor = request.cursor ?? 0;
  let aggregate: WheelScreenerResponse | null = null;
  const snapshotId = await createScreenerSnapshot(request);

  try {
    while (true) {
      const batchResponse = await screenWheelCompaniesBatch({
        ...request,
        cursor,
        batchSize,
        limit: batchResultLimit,
      });

      await upsertScreenerSnapshotCandidates(snapshotId, request, batchResponse);

      aggregate = mergeScreenerResponse(aggregate, batchResponse, limit);
      await writeScreenerProgress(aggregate);

      if (
        batchResponse.progress.resultScope === "complete" ||
        batchResponse.progress.nextCursor == null
      ) {
        const completed = completeProgress(aggregate);

        await writeScreenerProgress(completed);
        await completeScreenerSnapshot(snapshotId, completed);
        await cacheScreenerResult(request, completed);
        await closeScreenerProgress();

        return completed;
      }

      await sleep(workflowBatchDelay);
      cursor = batchResponse.progress.nextCursor;
    }
  } catch (error) {
    await failScreenerSnapshot(
      snapshotId,
      error instanceof Error ? error.message : "Screener workflow failed.",
    );
    throw error;
  }
}
