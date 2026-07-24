import {
  getDeploymentHealth,
  getEnv,
  type AppEnv,
} from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  observeProviderCall,
  privateProviderFetchTracing,
  providerHttpError,
  providerMalformedResponse,
  type ProviderName,
} from "./provider";
import {
  elapsedMilliseconds,
  monotonicNow,
} from "./telemetry";

const PROBE_TIMEOUT_MS = 1_500;
const PROBE_CACHE_TTL_MS = 30_000;
const FAILED_PROBE_CACHE_TTL_MS = 10_000;

export interface DependencyProbe {
  name: string;
  provider: ProviderName;
  required: boolean;
  run: (signal: AbortSignal) => Promise<void>;
}

interface ProbeResult {
  healthy: boolean;
  required: boolean;
}

export interface ReadinessSummary {
  checks: {
    optional: { healthy: number; total: number };
    required: { healthy: number; total: number };
  };
  durationMs: number;
  status: "not_ready" | "ready";
}

const UNAVAILABLE_READINESS_SUMMARY: ReadinessSummary = {
  checks: {
    optional: { healthy: 0, total: 0 },
    required: { healthy: 0, total: 0 },
  },
  durationMs: 0,
  status: "not_ready",
};

function safeJsonValidator(
  predicate: (value: unknown) => boolean,
  provider: string,
) {
  return async (response: Response) => {
    let body: unknown;

    try {
      body = await response.json();
    } catch (error) {
      throw providerMalformedResponse(
        `${provider} health response was malformed.`,
        error,
      );
    }

    if (!predicate(body)) {
      throw providerMalformedResponse(
        `${provider} health response was malformed.`,
      );
    }
  };
}

function fetchProbe(options: {
  headers?: HeadersInit;
  method?: "GET" | "HEAD";
  provider: ProviderName;
  url: URL;
  validate?: (response: Response) => Promise<void>;
}) {
  return async (signal: AbortSignal) => {
    await observeProviderCall(options.provider, "health", async () => {
      const response = await fetch(options.url, {
        cache: "no-store",
        headers: options.headers,
        method: options.method ?? "GET",
        opentelemetry: privateProviderFetchTracing,
        signal,
      });

      if (!response.ok) {
        throw providerHttpError(
          response.status,
          `${options.provider} health probe failed.`,
        );
      }

      await options.validate?.(response);
    });
  };
}

function alpacaProbe(env: AppEnv): DependencyProbe | null {
  if (!env.APCA_API_KEY_ID || !env.APCA_API_SECRET_KEY) return null;

  return {
    name: "market_data",
    provider: "alpaca",
    required: env.ALPHA_DOG_DEPLOYMENT_MODE !== "demo",
    run: fetchProbe({
      headers: {
        "APCA-API-KEY-ID": env.APCA_API_KEY_ID,
        "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY,
      },
      provider: "alpaca",
      url: new URL("/v2/clock", env.ALPACA_TRADING_BASE_URL),
      validate: safeJsonValidator(
        (value) =>
          Boolean(
            value &&
            typeof value === "object" &&
            "timestamp" in value,
          ),
        "Alpaca",
      ),
    }),
  };
}

function openAiProbe(env: AppEnv): DependencyProbe | null {
  if (!env.OPENAI_API_KEY) return null;

  return {
    name: "trade_analysis",
    provider: "openai",
    required: env.ALPHA_DOG_DEPLOYMENT_MODE === "live",
    run: fetchProbe({
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      provider: "openai",
      url: new URL(
        `/v1/models/${encodeURIComponent(env.OPENAI_TRADE_ANALYSIS_MODEL)}`,
        "https://api.openai.com",
      ),
      validate: safeJsonValidator(
        (value) =>
          Boolean(
            value &&
            typeof value === "object" &&
            "id" in value &&
            typeof value.id === "string",
          ),
        "OpenAI",
      ),
    }),
  };
}

function finnhubProbe(env: AppEnv): DependencyProbe | null {
  if (!env.EARNINGS_PROVIDER_ENABLED || !env.FINNHUB_API_KEY) return null;
  const url = new URL("stock/profile2", env.FINNHUB_API_BASE_URL.endsWith("/")
    ? env.FINNHUB_API_BASE_URL
    : `${env.FINNHUB_API_BASE_URL}/`);

  url.searchParams.set("symbol", "AAPL");
  return {
    name: "earnings",
    provider: "finnhub",
    required: true,
    run: fetchProbe({
      headers: {
        "X-Finnhub-Token": env.FINNHUB_API_KEY,
      },
      provider: "finnhub",
      url,
      validate: safeJsonValidator(
        (value) => Boolean(value && typeof value === "object"),
        "Finnhub",
      ),
    }),
  };
}

function polymarketProbe(env: AppEnv): DependencyProbe {
  return {
    name: "prediction_market",
    provider: "polymarket",
    required: false,
    run: fetchProbe({
      method: "HEAD",
      provider: "polymarket",
      url: new URL("/", env.POLYMARKET_DATA_API_BASE_URL),
    }),
  };
}

function supabaseProbes(env: AppEnv): DependencyProbe[] {
  const url = env.ALPHA_DOG_SUPABASE_URL ?? env.SUPABASE_URL;
  const serviceRoleKey =
    env.ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY;
  const publicUrl = env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL;
  const publicKey =
    env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const probes: DependencyProbe[] = [];

  if (url && serviceRoleKey) {
    const restUrl = new URL("/rest/v1/paper_accounts", url);

    restUrl.searchParams.set("select", "id");
    restUrl.searchParams.set("limit", "0");
    probes.push({
      name: "database",
      provider: "supabase",
      required: env.ALPHA_DOG_DEPLOYMENT_MODE === "live",
      run: fetchProbe({
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        provider: "supabase",
        url: restUrl,
        validate: safeJsonValidator(
          (value) => Array.isArray(value) && value.length === 0,
          "Supabase",
        ),
      }),
    });
  }

  if (publicUrl && publicKey) {
    probes.push({
      name: "authentication",
      provider: "supabase",
      required: env.ALPHA_DOG_DEPLOYMENT_MODE === "live",
      run: fetchProbe({
        headers: { apikey: publicKey },
        provider: "supabase",
        url: new URL("/auth/v1/health", publicUrl),
        validate: safeJsonValidator(
          (value) =>
            Boolean(
              value &&
              typeof value === "object" &&
              "name" in value &&
              typeof value.name === "string",
            ),
          "Supabase",
        ),
      }),
    });
  }

  return probes;
}

export function configuredDependencyProbes(env = getEnv()) {
  return [
    alpacaProbe(env),
    openAiProbe(env),
    finnhubProbe(env),
    polymarketProbe(env),
    ...supabaseProbes(env),
  ].filter((probe): probe is DependencyProbe => probe != null);
}

async function runProbe(
  probe: DependencyProbe,
  timeoutMs: number,
): Promise<ProbeResult> {
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    await probe.run(signal);

    return { healthy: true, required: probe.required };
  } catch {
    return { healthy: false, required: probe.required };
  }
}

export async function runReadinessProbes(
  probes: DependencyProbe[],
  configurationReady = true,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ReadinessSummary> {
  const startedAt = monotonicNow();
  const results = await Promise.all(
    probes.map((probe) => runProbe(probe, timeoutMs)),
  );
  const required = results.filter((result) => result.required);
  const optional = results.filter((result) => !result.required);
  const requiredHealthy = required.filter((result) => result.healthy).length;
  const optionalHealthy = optional.filter((result) => result.healthy).length;
  const ready = configurationReady && requiredHealthy === required.length;

  return {
    checks: {
      optional: { healthy: optionalHealthy, total: optional.length },
      required: { healthy: requiredHealthy, total: required.length },
    },
    durationMs: elapsedMilliseconds(startedAt),
    status: ready ? "ready" : "not_ready",
  };
}

export async function refreshReadiness(env = getEnv()) {
  const configurationReady = getDeploymentHealth(env).status !== "invalid";
  return runReadinessProbes(
    configuredDependencyProbes(env),
    configurationReady,
  );
}

function safeCountPair(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { healthy?: unknown; total?: unknown };

  if (
    !Number.isInteger(candidate.healthy) ||
    !Number.isInteger(candidate.total) ||
    Number(candidate.healthy) < 0 ||
    Number(candidate.total) < Number(candidate.healthy)
  ) {
    return null;
  }

  return {
    healthy: Number(candidate.healthy),
    total: Number(candidate.total),
  };
}

function safeReadinessSummary(value: unknown): ReadinessSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    checks?: {
      optional?: unknown;
      required?: unknown;
    };
    durationMs?: unknown;
    status?: unknown;
  };
  const optional = safeCountPair(candidate.checks?.optional);
  const required = safeCountPair(candidate.checks?.required);

  if (
    !optional ||
    !required ||
    (candidate.status !== "ready" && candidate.status !== "not_ready") ||
    typeof candidate.durationMs !== "number" ||
    !Number.isFinite(candidate.durationMs) ||
    candidate.durationMs < 0
  ) {
    return null;
  }

  return {
    checks: { optional, required },
    durationMs: Math.min(
      30_000,
      Math.round(candidate.durationMs * 100) / 100,
    ),
    status: candidate.status,
  };
}

export async function getReadinessSummary(
  client: SupabaseClient | null = getSupabaseAdminClient(),
) {
  if (!client) {
    return UNAVAILABLE_READINESS_SUMMARY;
  }

  const { data, error } = await client
    .from("observability_readiness_state")
    .select("summary,expires_at")
    .eq("state_key", "current")
    .maybeSingle();

  if (error || !data) {
    return UNAVAILABLE_READINESS_SUMMARY;
  }

  const summary = safeReadinessSummary(data.summary);

  if (!summary) {
    return UNAVAILABLE_READINESS_SUMMARY;
  }

  return new Date(data.expires_at).getTime() > Date.now()
    ? summary
    : { ...summary, status: "not_ready" as const };
}

export async function refreshSharedReadinessSummary(options: {
  client?: SupabaseClient | null;
  refresh?: () => Promise<ReadinessSummary>;
} = {}) {
  const client = options.client === undefined
    ? getSupabaseAdminClient()
    : options.client;

  if (!client) {
    return UNAVAILABLE_READINESS_SUMMARY;
  }

  const owner = crypto.randomUUID();
  const claim = await client.rpc(
    "claim_observability_readiness_refresh",
    {
      p_lease_seconds: 10,
      p_owner: owner,
    },
  );

  if (claim.error || claim.data !== true) {
    return getReadinessSummary(client);
  }

  const summary = await (options.refresh ?? refreshReadiness)();
  const ttlMs = summary.status === "ready"
    ? PROBE_CACHE_TTL_MS
    : FAILED_PROBE_CACHE_TTL_MS;
  const completion = await client.rpc(
    "complete_observability_readiness_refresh",
    {
      p_owner: owner,
      p_status: summary.status,
      p_summary: summary,
      p_ttl_seconds: Math.ceil(ttlMs / 1_000),
    },
  );

  return completion.error || completion.data !== true
    ? UNAVAILABLE_READINESS_SUMMARY
    : summary;
}

export function getConfigurationSummary(env = getEnv()) {
  const health = getDeploymentHealth(env);
  const providers = Object.values(health.providers);
  const required = providers.filter((provider) => provider.required);
  const optional = providers.filter((provider) => !provider.required);

  return {
    checks: {
      optional: {
        configured: optional.filter((provider) => provider.configured).length,
        total: optional.length,
      },
      required: {
        configured: required.filter((provider) => provider.configured).length,
        total: required.length,
      },
    },
    mode: health.mode,
    status: health.status,
  };
}
