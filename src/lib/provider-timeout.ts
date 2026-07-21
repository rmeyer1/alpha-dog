export function withProviderTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  return signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
}
