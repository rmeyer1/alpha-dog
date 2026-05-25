import { z } from "zod";

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
