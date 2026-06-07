import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const envSchema = z.object({
  APCA_API_KEY_ID: z.string().optional(),
  APCA_API_SECRET_KEY: z.string().optional(),
  ALPACA_OPTIONS_FEED: z.enum(["opra", "indicative"]).default("indicative"),
  ALPACA_MARKET_DATA_BASE_URL: z
    .string()
    .url()
    .default("https://data.alpaca.markets"),
  ALPACA_TRADING_BASE_URL: z
    .string()
    .url()
    .default("https://paper-api.alpaca.markets"),
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
  WHEEL_SCREENER_REFRESH_MIN_AGE_MINUTES: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default("45"),
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
