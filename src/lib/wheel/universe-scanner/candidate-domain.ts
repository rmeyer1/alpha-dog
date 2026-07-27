import type { AlpacaExplicitOptionSnapshotMetadata } from "@/lib/alpaca/client";
import { buildCandidate, buildVerticalSpreads } from "../calculations";
import type { EarningsRiskContext } from "../earnings";
import { getPersona } from "../personas";
import {
  hasKnownEarningsBeforeExpiration,
  scoreCandidate,
  scoreVerticalSpreadCandidate,
} from "../scoring";
import type {
  OptionType,
  RawOptionContract,
  UnderlyingContext,
  WheelCandidate,
  WheelCompanyCandidateSummary,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerRequest,
} from "../types";
import { parseNumber } from "./domain";
import type { KnownCandidateContractRow } from "./model";

export function optionTypeForStrategy(
  strategy: WheelCompanyStrategy,
): OptionType {
  return strategy === "short_put" || strategy === "put_credit_spread"
    ? "put"
    : "call";
}

export function optionContractSymbol(
  underlyingSymbol: string,
  expiration: string,
  optionType: OptionType,
  strike: number,
) {
  if (!/^[A-Z0-9]+$/.test(underlyingSymbol)) {
    return null;
  }

  const compactDate = expiration.replaceAll("-", "").slice(2);
  const typeCode = optionType === "put" ? "P" : "C";
  const strikeCode = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");

  return `${underlyingSymbol}${compactDate}${typeCode}${strikeCode}`;
}

export function knownCandidateMetadata(
  row: KnownCandidateContractRow,
): AlpacaExplicitOptionSnapshotMetadata[] {
  const strikes = [
    parseNumber(row.short_strike),
    parseNumber(row.long_strike),
  ].filter((strike) => strike != null);

  return strikes
    .map((strike) => {
      const contractSymbol = optionContractSymbol(
        row.symbol,
        row.expiration,
        row.option_type,
        strike,
      );

      return contractSymbol
        ? {
            contractSymbol,
            expirationDate: row.expiration,
            openInterest: null,
            optionType: row.option_type,
            strike,
          }
        : null;
    })
    .filter((metadata) => metadata != null);
}

export function premiumReceivedFromCredit(credit: number | null | undefined) {
  return credit == null ? undefined : Math.round(credit * 10000) / 100;
}

export function uniqueContracts(contracts: RawOptionContract[]) {
  return Array.from(
    new Map(
      contracts.map((contract) => [contract.contractSymbol, contract]),
    ).values(),
  );
}

function summarizeContractCandidate(
  strategy: WheelCompanyStrategy,
  candidate: WheelCandidate,
): WheelCompanyCandidateSummary {
  return {
    strategy,
    score: candidate.score,
    expirationDate: candidate.expirationDate,
    dte: candidate.dte,
    shortStrike: candidate.strike,
    premiumReceived: premiumReceivedFromCredit(candidate.midpoint),
    premiumYield: candidate.premiumYield,
    annualizedYield: candidate.annualizedYield,
    delta: candidate.delta,
    impliedVolatility: candidate.impliedVolatility,
    liquidityQuality: candidate.liquidityQuality,
    warningCount: candidate.warnings.length,
  };
}

export function selectBestCandidate(
  rawContracts: RawOptionContract[],
  underlying: UnderlyingContext,
  personaId: WheelScreenerRequest["persona"],
  strategy: WheelCompanyStrategy,
  filters: WheelFilters,
  earningsContext: EarningsRiskContext,
  now = new Date(),
) {
  const persona = getPersona(personaId);
  const candidates = rawContracts
    .map((contract) => buildCandidate(contract, underlying, filters, now))
    .filter((candidate) => candidate != null)
    .filter(
      (candidate) =>
        !filters.excludeEarnings ||
        !hasKnownEarningsBeforeExpiration(
          candidate.expirationDate,
          earningsContext,
          now,
        ),
    )
    .map((candidate) =>
      scoreCandidate(
        candidate,
        persona,
        filters,
        underlying,
        earningsContext,
        now,
      ),
    );

  switch (strategy) {
    case "short_put":
    case "covered_call": {
      const best = candidates
        .filter(
          (candidate) =>
            candidate.optionType === optionTypeForStrategy(strategy),
        )
        .sort((left, right) => right.score - left.score)[0];

      return best ? summarizeContractCandidate(strategy, best) : null;
    }
    case "put_credit_spread":
    case "call_credit_spread": {
      const optionType = optionTypeForStrategy(strategy);
      const spread = buildVerticalSpreads(
        rawContracts,
        underlying,
        filters,
        optionType,
        now,
      )
        .filter(
          (candidate) =>
            !filters.excludeEarnings ||
            !hasKnownEarningsBeforeExpiration(
              candidate.expirationDate,
              earningsContext,
              now,
            ),
        )
        .map((candidate) =>
          scoreVerticalSpreadCandidate(
            candidate,
            persona,
            filters,
            underlying,
            earningsContext,
            now,
          ),
        )
        .sort((left, right) => right.score - left.score)[0];

      return spread
        ? {
            strategy,
            score: spread.score,
            expirationDate: spread.expirationDate,
            dte: spread.dte,
            shortStrike: spread.shortLeg.strike,
            longStrike: spread.longLeg.strike,
            premiumReceived: premiumReceivedFromCredit(spread.netCredit),
            returnOnRisk: spread.returnOnRisk,
            annualizedReturnOnRisk: spread.annualizedReturnOnRisk,
            delta: spread.shortDelta,
            impliedVolatility: spread.impliedVolatility,
            liquidityQuality: spread.liquidityQuality,
            warningCount: spread.warnings.length,
          }
        : null;
    }
  }
}
