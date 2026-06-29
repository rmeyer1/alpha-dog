import { z } from "zod";

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

const envSchema = z.object({
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
  ALPHA_DOG_SUPABASE_URL: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
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
    .default("1"),
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
  USE_DEMO_DATA: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}

export function hasAlpacaCredentials() {
  const env = getEnv();

  return Boolean(env.APCA_API_KEY_ID && env.APCA_API_SECRET_KEY);
}

export function hasFinnhubCredentials() {
  return Boolean(getEnv().FINNHUB_API_KEY);
}
