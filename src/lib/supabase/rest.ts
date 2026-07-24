import { getEnv } from "@/lib/env";
import {
  observeProviderCall,
  privateProviderFetchTracing,
  providerHttpError,
  providerMalformedResponse,
} from "@/lib/observability/provider";

interface SupabaseRequestOptions {
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  prefer?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SupabaseServiceConfig {
  serviceRoleKey: string;
  url: string;
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function getSupabaseServiceConfig(): SupabaseServiceConfig | null {
  const env = getEnv();
  const url = env.ALPHA_DOG_SUPABASE_URL ?? env.SUPABASE_URL;
  const serviceRoleKey =
    env.ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    serviceRoleKey,
    url: normalizeBaseUrl(url),
  };
}

function buildRestUrl(
  config: SupabaseServiceConfig,
  table: string,
  query?: SupabaseRequestOptions["query"],
) {
  const url = new URL(`/rest/v1/${table}`, config.url);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function parseSupabaseError(response: Response) {
  const body = await response.json().catch(() => null) as
    | { message?: string; details?: string; hint?: string; code?: string }
    | null;

  return [
    body?.message ?? `Supabase returned HTTP ${response.status}.`,
    body?.details,
    body?.hint,
    body?.code ? `code=${body.code}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function requestSupabaseRest<T>(
  table: string,
  options: SupabaseRequestOptions = {},
): Promise<T | null> {
  const config = getSupabaseServiceConfig();

  if (!config) {
    return null;
  }

  const operation = table
    .replaceAll("/", "_")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 64) || "rest_request";

  return observeProviderCall("supabase", operation, async () => {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const signal = options.signal && timeoutSignal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : options.signal ?? timeoutSignal;
    const response = await fetch(buildRestUrl(config, table, options.query), {
      method: options.method ?? "GET",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(options.prefer ? { Prefer: options.prefer } : {}),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      opentelemetry: privateProviderFetchTracing,
      signal,
    });

    if (!response.ok) {
      throw providerHttpError(
        response.status,
        await parseSupabaseError(response),
      );
    }

    const responseText = await response.text();

    if (!responseText) {
      return null;
    }

    try {
      return JSON.parse(responseText) as T;
    } catch (error) {
      throw providerMalformedResponse(
        "Supabase returned a malformed response.",
        error,
      );
    }
  });
}
