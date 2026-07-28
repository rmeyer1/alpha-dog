import { emptyEarningsRiskContext } from "./earnings";
import {
  marketBatchRawContract,
  marketBatchRequestIdentity,
  marketBatchUnderlyingContext,
} from "./market-batch/domain";
import type {
  MarketBatchOptionRow,
  MarketBatchUnderlyingRow,
} from "./market-batch/model";
import type {
  DataFeed,
  RawOptionContract,
  Warning,
  WheelCompanyScore,
  WheelScreenerRequest,
} from "./types";
import {
  optionTypeForStrategy,
  selectBestCandidate,
} from "./universe-scanner/candidate-domain";

export const SCANNER_PARITY_FORMAT_VERSION = 1;
export const SCANNER_PARITY_SAMPLE_LIMIT = 10;

export type ScannerParityMismatchKind =
  | "eligibility"
  | "financial"
  | "ordering"
  | "score"
  | "warning";

export interface ScannerParityDiagnosticSample {
  fields: string[];
  identity: string;
  kind: ScannerParityMismatchKind;
}

export interface ScannerParityResult {
  candidateCount: {
    legacy: number;
    replacement: number;
  };
  exactMatch: boolean;
  formatVersion: typeof SCANNER_PARITY_FORMAT_VERSION;
  mismatchCount: number;
  mismatches: Record<ScannerParityMismatchKind, number>;
  samples: ScannerParityDiagnosticSample[];
}

export interface ScannerParitySurface {
  errors: string[];
  skippedCount: number;
  warnings: Warning[];
}

const FINANCIAL_FIELDS = [
  "underlying.price",
  "bestCandidate.dte",
  "bestCandidate.shortStrike",
  "bestCandidate.longStrike",
  "bestCandidate.premiumReceived",
  "bestCandidate.premiumYield",
  "bestCandidate.annualizedYield",
  "bestCandidate.returnOnRisk",
  "bestCandidate.annualizedReturnOnRisk",
  "bestCandidate.delta",
  "bestCandidate.impliedVolatility",
  "bestCandidate.liquidityQuality",
] as const;

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValue(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(",")}}`;
}

function candidateIdentity(company: WheelCompanyScore) {
  const candidate = company.bestCandidate;

  return [
    company.ticker,
    candidate.strategy,
    candidate.expirationDate,
    candidate.shortStrike,
    candidate.longStrike ?? "",
  ].join(":");
}

function valueAtPath(company: WheelCompanyScore, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, company);
}

function changedFields(
  left: WheelCompanyScore,
  right: WheelCompanyScore,
  fields: readonly string[],
) {
  return fields.filter(
    (field) =>
      stableValue(valueAtPath(left, field)) !==
      stableValue(valueAtPath(right, field)),
  );
}

function warningValue(company: WheelCompanyScore) {
  return stableValue({
    candidate: company.bestCandidate.warnings ?? [],
    candidateCount: company.bestCandidate.warningCount,
    company: company.warnings,
    errors: company.errors,
  });
}

export function compareScannerCandidates(
  legacy: WheelCompanyScore[],
  replacement: WheelCompanyScore[],
  surfaces?: {
    legacy: ScannerParitySurface;
    replacement: ScannerParitySurface;
  },
): ScannerParityResult {
  const legacyByIdentity = new Map(
    legacy.map((company) => [candidateIdentity(company), company]),
  );
  const replacementByIdentity = new Map(
    replacement.map((company) => [candidateIdentity(company), company]),
  );
  const identities = Array.from(
    new Set([...legacyByIdentity.keys(), ...replacementByIdentity.keys()]),
  ).sort();
  const mismatches: ScannerParityResult["mismatches"] = {
    eligibility: 0,
    financial: 0,
    ordering: 0,
    score: 0,
    warning: 0,
  };
  const samples: ScannerParityDiagnosticSample[] = [];

  const record = (
    kind: ScannerParityMismatchKind,
    identity: string,
    fields: string[],
  ) => {
    mismatches[kind] += 1;
    if (samples.length < SCANNER_PARITY_SAMPLE_LIMIT) {
      samples.push({ fields: fields.slice(0, 12), identity, kind });
    }
  };

  for (const identity of identities) {
    const legacyCandidate = legacyByIdentity.get(identity);
    const replacementCandidate = replacementByIdentity.get(identity);

    if (!legacyCandidate || !replacementCandidate) {
      record("eligibility", identity, [
        legacyCandidate ? "replacement.missing" : "legacy.missing",
      ]);
      continue;
    }

    const financialFields = changedFields(
      legacyCandidate,
      replacementCandidate,
      FINANCIAL_FIELDS,
    );
    if (financialFields.length > 0) {
      record("financial", identity, financialFields);
    }

    const scoreFields = changedFields(
      legacyCandidate,
      replacementCandidate,
      ["score", "bestCandidate.score", "bestCandidate.scoreBreakdown"],
    );
    if (scoreFields.length > 0) {
      record("score", identity, scoreFields);
    }

    if (warningValue(legacyCandidate) !== warningValue(replacementCandidate)) {
      record("warning", identity, ["warnings"]);
    }

    if (
      legacyCandidate.rank !== replacementCandidate.rank &&
      financialFields.length === 0 &&
      scoreFields.length === 0
    ) {
      record("ordering", identity, ["rank"]);
    }
  }

  if (surfaces) {
    if (surfaces.legacy.skippedCount !== surfaces.replacement.skippedCount) {
      record("eligibility", "result", ["skippedCount"]);
    }
    if (stableValue(surfaces.legacy.errors) !== stableValue(surfaces.replacement.errors)) {
      record("eligibility", "result", ["errors"]);
    }
    if (
      stableValue(surfaces.legacy.warnings) !==
      stableValue(surfaces.replacement.warnings)
    ) {
      record("warning", "result", ["warnings"]);
    }
  }

  const mismatchCount = Object.values(mismatches).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    candidateCount: {
      legacy: legacy.length,
      replacement: replacement.length,
    },
    exactMatch: mismatchCount === 0,
    formatVersion: SCANNER_PARITY_FORMAT_VERSION,
    mismatchCount,
    mismatches,
    samples,
  };
}

export function legacyScannerParitySurface({
  factErrors,
  feed,
  legacyCompanies,
  underlyingRows,
}: {
  factErrors: string[];
  feed: Exclude<DataFeed, "demo">;
  legacyCompanies: WheelCompanyScore[];
  underlyingRows: MarketBatchUnderlyingRow[];
}): ScannerParitySurface {
  const warnings: Warning[] = [];

  if (feed === "indicative") {
    warnings.push({
      message:
        "Indicative options feed selected. Confirm OPRA access before relying on live quotes.",
      severity: "warning",
      type: "data_quality",
    });
  }
  if (
    underlyingRows.every(
      (underlying) => !underlying.earnings_context.providerEnabled,
    )
  ) {
    warnings.push({
      message: "Earnings provider is disabled. Verify earnings before trading.",
      severity: "info",
      type: "earnings",
    });
  }

  return {
    errors: factErrors.slice(0, 25),
    skippedCount: underlyingRows.length - legacyCompanies.length,
    warnings,
  };
}

/**
 * Runs the released scanner's candidate-selection shape over already-persisted
 * shared facts. This is intentionally independent of the replacement
 * market-batch loop while reusing the stable scoring primitives used by the
 * released scanner. It performs no provider I/O.
 */
export function scoreLegacyScannerFromMarketBatch({
  now,
  optionRows,
  request,
  underlyingRows,
}: {
  now: Date;
  optionRows: MarketBatchOptionRow[];
  request: WheelScreenerRequest;
  underlyingRows: MarketBatchUnderlyingRow[];
}) {
  const identity = marketBatchRequestIdentity(request);
  const optionType = optionTypeForStrategy(request.strategy);
  const contractsBySymbol = new Map<string, RawOptionContract[]>();

  for (const row of optionRows) {
    if (row.option_type !== optionType) continue;
    const contracts = contractsBySymbol.get(row.underlying_symbol) ?? [];
    contracts.push(marketBatchRawContract(row));
    contractsBySymbol.set(row.underlying_symbol, contracts);
  }

  return underlyingRows
    .filter((row) => row.selected_for_scoring)
    .sort((left, right) =>
      left.universe_rank - right.universe_rank ||
      left.symbol.localeCompare(right.symbol)
    )
    .map((row): WheelCompanyScore | null => {
      const underlying = marketBatchUnderlyingContext(row);
      const bestCandidate = selectBestCandidate(
        contractsBySymbol.get(row.symbol) ?? [],
        underlying,
        request.persona,
        request.strategy,
        identity.filters,
        row.earnings_context ?? emptyEarningsRiskContext(row.symbol),
        now,
      );

      if (!bestCandidate) return null;

      return {
        bestCandidate,
        errors: [],
        exchange: row.exchange,
        name: row.company_name,
        rank: 0,
        score: bestCandidate.score,
        ticker: row.symbol,
        underlying,
        warnings: [],
      };
    })
    .filter((company) => company != null)
    .sort((left, right) =>
      right.score - left.score || left.ticker.localeCompare(right.ticker)
    )
    .slice(0, request.limit ?? 50)
    .map((company, index) => ({ ...company, rank: index + 1 }));
}
