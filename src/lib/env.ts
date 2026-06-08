import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

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
  ALPACA_OPTIONS_FEED: z.enum(["opra", "indicative"]).default("opra"),
  ALPACA_MARKET_DATA_BASE_URL: z
    .string()
    .url()
    .default("https://data.alpaca.markets"),
  ALPACA_TRADING_BASE_URL: z
    .string()
    .url()
    .default("https://paper-api.alpaca.markets"),
  ALPACA_MARKET_DATA_RATE_LIMIT_PER_MINUTE: optionalPositiveInteger("9500"),
  ALPACA_MARKET_DATA_MAX_CONCURRENCY: optionalPositiveInteger("24"),
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
