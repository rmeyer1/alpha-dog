const SENSITIVE_KEY_PATTERN =
  /authorization|body|cause|cookie|credential|email|header|key|prompt|query|row|secret|stack|token|url|wallet/i;
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const WALLET_PATTERN = /\b0x[a-fA-F0-9]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const CANARY_PATTERN = /\b[A-Za-z0-9._:@/?=&-]*canary[A-Za-z0-9._:@/?=&-]*\b/gi;
const MAX_DEPTH = 8;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_SAFE_STRING_LENGTH = 500;

function redactString(value: string) {
  return value
    .slice(0, MAX_SAFE_STRING_LENGTH)
    .replace(URL_PATTERN, "[redacted-url]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(WALLET_PATTERN, "[redacted-wallet]")
    .replace(BEARER_PATTERN, "[redacted-token]")
    .replace(JWT_PATTERN, "[redacted-token]")
    .replace(CANARY_PATTERN, "[redacted]");
}

export function redactSensitiveValue(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (depth >= MAX_DEPTH) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redactSensitiveValue(item, "", depth + 1));
  }

  if (value instanceof Error) {
    return {
      errorClass: value.name,
    };
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactSensitiveValue(entryValue, entryKey, depth + 1),
        ]),
    );
  }

  return "[redacted]";
}

export async function redactApiErrorResponse(response: Response) {
  if (
    response.status < 400 ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return response;
  }

  let body: unknown;

  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);

  headers.delete("content-length");

  return new Response(JSON.stringify(redactSensitiveValue(body)), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
