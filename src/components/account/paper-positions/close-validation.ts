export type ClosePositionValidationResult =
  | { valid: true }
  | { message: string; stale?: boolean; valid: false };

export function validateClosePositionInput({
  closePrice,
  closedAt,
  contracts,
  remainingContracts,
}: {
  closePrice: string;
  closedAt: string;
  contracts: string;
  remainingContracts: number;
}): ClosePositionValidationResult {
  const contractsToClose = Number(contracts);
  const parsedClosePrice = Number(closePrice);
  if (!Number.isInteger(contractsToClose) || contractsToClose <= 0)
    return {
      message: "Contracts bought back must be a whole number above zero.",
      valid: false,
    };
  if (contractsToClose > remainingContracts)
    return {
      message: "Contracts bought back cannot exceed the remaining quantity.",
      stale: true,
      valid: false,
    };
  if (!Number.isFinite(parsedClosePrice) || parsedClosePrice < 0)
    return { message: "Buyback price must be zero or greater.", valid: false };
  if (!closedAt) return { message: "Close date is required.", valid: false };
  return { valid: true };
}
