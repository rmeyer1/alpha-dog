import type { OptionType } from "../types";
import type { DeepScanWorkClaim } from "./model";

export function optionUnitsForDeepScanClaims(
  selectedSymbols: string[],
  optionTypes: OptionType[],
  claims: Array<Pick<DeepScanWorkClaim, "optionType" | "symbol">>,
) {
  const claimedUnits = new Set(
    claims.map((claim) => `${claim.symbol}:${claim.optionType}`),
  );

  return selectedSymbols.flatMap((symbol) =>
    optionTypes
      .filter((optionType) =>
        claimedUnits.has(`${symbol}:${optionType}`)
      )
      .map((optionType) => ({ optionType, symbol }))
  );
}
