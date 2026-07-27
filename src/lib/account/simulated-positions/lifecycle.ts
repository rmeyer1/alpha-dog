/** Lifecycle state transitions used by the facade's persistence orchestration. No database access. */
export function closeTransition(
  contractsRemaining: number,
  contractsToClose: number,
  closedAt: string,
) {
  const nextContractsRemaining = contractsRemaining - contractsToClose;
  return {
    closedAtForPosition: nextContractsRemaining === 0 ? closedAt : null,
    contractsRemaining: nextContractsRemaining,
    eventType: nextContractsRemaining === 0 ? "full_close" : "partial_close",
    status: nextContractsRemaining === 0 ? "closed" : "partially_closed",
  } as const;
}
