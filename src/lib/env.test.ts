import { describe, expect, it } from "vitest";
import {
  getDeploymentHealth,
  getMarketDataConfigurationError,
  parseAppEnv,
} from "./env";

const validLiveEnvironment: NodeJS.ProcessEnv = {
  ALPHA_DOG_DEPLOYMENT_MODE: "live",
  ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  ALPHA_DOG_SUPABASE_URL: "https://alpha-dog.supabase.co",
  APCA_API_KEY_ID: "alpaca-key",
  APCA_API_SECRET_KEY: "alpaca-secret",
  NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY: "publishable-key",
  NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL: "https://alpha-dog.supabase.co",
  NODE_ENV: "production",
  OPENAI_API_KEY: "openai-key",
};

describe("deployment environment matrix", () => {
  it("uses sample data only when demo mode is selected explicitly", () => {
    const env = parseAppEnv({
      ALPHA_DOG_DEPLOYMENT_MODE: "demo",
      NODE_ENV: "production",
    });

    expect(env.ALPHA_DOG_DEPLOYMENT_MODE).toBe("demo");
    expect(getDeploymentHealth(env)).toMatchObject({
      issues: [],
      mode: "demo",
      status: "demo",
    });
    expect(getMarketDataConfigurationError({}, env)).toBeNull();
  });

  it("defaults non-production runtimes to development without enabling demo data", () => {
    const env = parseAppEnv({ NODE_ENV: "test" });

    expect(env.ALPHA_DOG_DEPLOYMENT_MODE).toBe("development");
    expect(getDeploymentHealth(env).status).toBe("degraded");
    expect(getMarketDataConfigurationError({}, env)?.code).toBe(
      "ALPACA_CREDENTIALS_NOT_CONFIGURED",
    );
  });

  it("accepts a fully configured live deployment", () => {
    const env = parseAppEnv(validLiveEnvironment);

    expect(getDeploymentHealth(env)).toMatchObject({
      issues: [],
      mode: "live",
      status: "ready",
    });
    expect(
      getMarketDataConfigurationError({ requireSupabase: true }, env),
    ).toBeNull();
  });

  it("fails a live deployment closed with actionable provider messages", () => {
    const env = parseAppEnv({
      ALPHA_DOG_DEPLOYMENT_MODE: "live",
      NODE_ENV: "production",
    });
    const health = getDeploymentHealth(env);

    expect(health.status).toBe("invalid");
    expect(health.issues.map((issue) => issue.provider)).toEqual([
      "alpaca",
      "openai",
      "supabaseAuth",
      "supabaseServer",
    ]);
    expect(getMarketDataConfigurationError({}, env)).toEqual({
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      message: expect.stringContaining("APCA_API_KEY_ID"),
    });
  });

  it("defaults production to live and ignores the retired implicit demo flag", () => {
    const env = parseAppEnv({
      NODE_ENV: "production",
      USE_DEMO_DATA: "true",
    });

    expect(env.ALPHA_DOG_DEPLOYMENT_MODE).toBe("live");
    expect(getDeploymentHealth(env).status).toBe("invalid");
  });
});
