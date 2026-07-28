import { z } from "zod";
import type {
  DeploymentHealth,
  DeploymentMode,
  MarketDataConfigurationError,
  ProviderConfigurationStatus,
} from "./env-types";

export type {
  DeploymentHealth,
  DeploymentMode,
  MarketDataConfigurationError,
  ProviderConfigurationStatus,
} from "./env-types";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const trimmedStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === ""
    ? undefined
    : typeof value === "string"
      ? value.trim()
      : value;

const optionalPositiveInteger = (defaultValue: string) =>
  z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(defaultValue)
    .transform((value, context) => {
      const parsed = Number(value);

      if (!Number.isInteger(parsed) || parsed <= 0) {
        context.addIssue({
          code: "custom",
          message: "Expected a positive integer.",
        });

        return z.NEVER;
      }

      return parsed;
    });

const deploymentModeSchema = z.enum(["demo", "development", "live"]);

const envSchema = z.object({
  ALPHA_DOG_DEPLOYMENT_MODE: z.preprocess(
    trimmedStringToUndefined,
    deploymentModeSchema.optional(),
  ),
  APCA_API_KEY_ID: z.string().optional(),
  APCA_API_SECRET_KEY: z.string().optional(),
  ALPACA_OPTIONS_FEED: z.preprocess(
    trimmedStringToUndefined,
    z.enum(["opra", "indicative"]),
  ).default("opra"),
  ALPACA_STOCK_FEED: z.preprocess(
    trimmedStringToUndefined,
    z.enum(["sip", "iex", "delayed_sip"]),
  ).default("sip"),
  ALPACA_MARKET_DATA_BASE_URL: z
    .string()
    .url()
    .default("https://data.alpaca.markets"),
  ALPACA_TRADING_BASE_URL: z
    .string()
    .url()
    .default("https://paper-api.alpaca.markets"),
  LOGO_DEV_BASE_URL: z
    .string()
    .url()
    .default("https://img.logo.dev"),
  LOGO_DEV_PUBLISHABLE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  ALPACA_MARKET_DATA_RATE_LIMIT_PER_MINUTE: optionalPositiveInteger("9500"),
  ALPACA_MARKET_DATA_MAX_CONCURRENCY: optionalPositiveInteger("24"),
  POLYMARKET_DATA_API_BASE_URL: z
    .string()
    .url()
    .default("https://data-api.polymarket.com"),
  POLYMARKET_GAMMA_API_BASE_URL: z
    .string()
    .url()
    .default("https://gamma-api.polymarket.com"),
  POLYMARKET_REFRESH_TTL_MINUTES: optionalPositiveInteger("15"),
  FINNHUB_API_BASE_URL: z
    .string()
    .url()
    .default("https://finnhub.io/api/v1"),
  FINNHUB_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  FINNHUB_EARNINGS_LOOKAHEAD_DAYS: optionalPositiveInteger("31"),
  TRADE_ANALYSIS_PROVIDER: z.enum(["openai"]).default("openai"),
  OPENAI_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  OPENAI_TRADE_ANALYSIS_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("gpt-5.4-mini"),
  API_ABUSE_HMAC_SECRET: z.preprocess(
    emptyStringToUndefined,
    z.string().min(32).optional(),
  ),
  ALPHA_DOG_APP_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  TURNSTILE_SECRET_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  WHEEL_SCREENER_LIVE_BATCH_SIZE: optionalPositiveInteger("32"),
  WHEEL_SCREENER_LIVE_CONCURRENCY: optionalPositiveInteger("8"),
  WHEEL_UNIVERSE_DEEP_SCAN_SIZE: optionalPositiveInteger("250"),
  WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE: optionalPositiveInteger("1000"),
  WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE: optionalPositiveInteger("100"),
  WHEEL_UNIVERSE_BACKGROUND_CANDIDATE_MAX_AGE_HOURS:
    optionalPositiveInteger("24"),
  WHEEL_UNIVERSE_BACKGROUND_COVERAGE_MAX_AGE_HOURS:
    optionalPositiveInteger("24"),
  WHEEL_UNIVERSE_BACKGROUND_MAX_RUNS: optionalPositiveInteger("4"),
  WHEEL_DEEP_SCAN_CLAIM_LIMIT: optionalPositiveInteger("625"),
  WHEEL_DEEP_SCAN_CLAIM_LEASE_SECONDS: optionalPositiveInteger("3600"),
  ALPHA_DOG_SUPABASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  SIGNAL_SCRIBE_SUPABASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default("https://kauwcybbiwsmmljovmit.supabase.co"),
  SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  SUPABASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  CRON_SECRET: z.preprocess(emptyStringToUndefined, z.string().optional()),
  WHEEL_SCREENER_REFRESH_PERSONAS: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("balanced_wheel"),
  WHEEL_SCREENER_REFRESH_STRATEGIES: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(
      "short_put,put_credit_spread,covered_call,call_credit_spread",
    ),
  WHEEL_SCREENER_REFRESH_MAX_RUNS: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("4"),
  WHEEL_SCREENER_WEEKEND_REFRESH_MAX_RUNS: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("4"),
  WHEEL_SCREENER_REFRESH_MIN_AGE_MINUTES: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("15"),
  EARNINGS_PROVIDER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppEnv = Omit<
  z.infer<typeof envSchema>,
  "ALPHA_DOG_DEPLOYMENT_MODE"
> & {
  ALPHA_DOG_DEPLOYMENT_MODE: DeploymentMode;
};

let cachedEnv: AppEnv | null = null;

function defaultDeploymentMode(source: NodeJS.ProcessEnv): DeploymentMode {
  return source.NODE_ENV === "production" ? "live" : "development";
}

export function parseAppEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(source);

  return {
    ...parsed,
    ALPHA_DOG_DEPLOYMENT_MODE:
      parsed.ALPHA_DOG_DEPLOYMENT_MODE ?? defaultDeploymentMode(source),
  };
}

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseAppEnv(process.env);
  }

  return cachedEnv;
}

export function hasAlpacaCredentials(env = getEnv()) {
  return Boolean(env.APCA_API_KEY_ID && env.APCA_API_SECRET_KEY);
}

export function hasAlphaDogSupabaseServiceConfig(env = getEnv()) {
  return Boolean(
    env.ALPHA_DOG_SUPABASE_URL &&
      env.ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function hasAlphaDogSupabaseAuthConfig(env = getEnv()) {
  return Boolean(
    env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL &&
      (
        env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
  );
}

export function hasFinnhubCredentials(env = getEnv()) {
  return Boolean(env.FINNHUB_API_KEY);
}

export function isDemoMode(env = getEnv()) {
  return env.ALPHA_DOG_DEPLOYMENT_MODE === "demo";
}

export function getMarketDataConfigurationError(
  options: { requireSupabase?: boolean } = {},
  env = getEnv(),
): MarketDataConfigurationError | null {
  if (isDemoMode(env)) {
    return null;
  }

  if (!hasAlpacaCredentials(env)) {
    return {
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      message:
        "Live market data is unavailable because Alpaca credentials are not configured. Set APCA_API_KEY_ID and APCA_API_SECRET_KEY, or explicitly select ALPHA_DOG_DEPLOYMENT_MODE=demo for labeled sample data.",
    };
  }

  if (options.requireSupabase && !hasAlphaDogSupabaseServiceConfig(env)) {
    return {
      code: "ALPHA_DOG_SUPABASE_NOT_CONFIGURED",
      message:
        "Live screener storage is unavailable because ALPHA_DOG_SUPABASE_URL and ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY are not configured.",
    };
  }

  return null;
}

export function getDeploymentHealth(env = getEnv()): DeploymentHealth {
  const mode = env.ALPHA_DOG_DEPLOYMENT_MODE;
  const demo = mode === "demo";
  const live = mode === "live";
  const providers = {
    alpaca: {
      configured: hasAlpacaCredentials(env),
      detail: hasAlpacaCredentials(env)
        ? "Live equity and options credentials configured."
        : "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.",
      required: !demo,
    },
    earnings: {
      configured:
        !env.EARNINGS_PROVIDER_ENABLED || hasFinnhubCredentials(env),
      detail: env.EARNINGS_PROVIDER_ENABLED
        ? hasFinnhubCredentials(env)
          ? "Finnhub earnings provider configured."
          : "Set FINNHUB_API_KEY or disable EARNINGS_PROVIDER_ENABLED."
        : "Earnings provider disabled.",
      required: env.EARNINGS_PROVIDER_ENABLED,
    },
    openai: {
      configured: Boolean(env.OPENAI_API_KEY),
      detail: env.OPENAI_API_KEY
        ? "Trade-analysis provider configured."
        : "Set OPENAI_API_KEY for trade analysis.",
      required: live,
    },
    supabaseAuth: {
      configured: hasAlphaDogSupabaseAuthConfig(env),
      detail: hasAlphaDogSupabaseAuthConfig(env)
        ? "Browser authentication configuration available."
        : "Set NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL and a public Supabase key.",
      required: live,
    },
    supabaseServer: {
      configured: hasAlphaDogSupabaseServiceConfig(env),
      detail: hasAlphaDogSupabaseServiceConfig(env)
        ? "Server-side persistence configuration available."
        : "Set ALPHA_DOG_SUPABASE_URL and ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY.",
      required: live,
    },
  } satisfies DeploymentHealth["providers"];
  const issues = (
    Object.entries(providers) as Array<
      [keyof typeof providers, ProviderConfigurationStatus]
    >
  )
    .filter(([, provider]) => provider.required && !provider.configured)
    .map(([provider, configuration]) => ({
      code: `MISSING_${provider.replace(/([A-Z])/g, "_$1").toUpperCase()}_CONFIG`,
      message: configuration.detail,
      provider,
    }));

  return {
    issues,
    mode,
    providers,
    status: demo
      ? "demo"
      : issues.length === 0
        ? "ready"
        : live
          ? "invalid"
          : "degraded",
  };
}
