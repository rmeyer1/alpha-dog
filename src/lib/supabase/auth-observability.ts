export const AUTH_CORRELATION_HEADER = "x-alpha-dog-correlation-id";

const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]+$/;
const SAFE_PROVIDER_PATTERN = /^[a-z0-9_:-]+$/;

export function createAuthCorrelationId() {
  return crypto.randomUUID();
}

export function authCorrelationIdFromRequest(request: Request) {
  const value = request.headers.get(AUTH_CORRELATION_HEADER);

  return value?.trim() || createAuthCorrelationId();
}

export function safeAuthLogCode(code: string) {
  return SAFE_CODE_PATTERN.test(code) ? code : "UNKNOWN";
}

function safeAuthProvider(provider: string) {
  return SAFE_PROVIDER_PATTERN.test(provider) ? provider : "unknown";
}

export function logAuthAccountFailure({
  code,
  correlationId,
  operation,
  provider,
}: {
  code: string;
  correlationId: string;
  operation: string;
  provider?: string | null;
}) {
  console.warn("alpha_dog_auth_account_failure", {
    code: safeAuthLogCode(code),
    correlationId,
    operation,
    ...(provider ? { provider: safeAuthProvider(provider) } : {}),
  });
}
