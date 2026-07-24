export type DeploymentMode = "demo" | "development" | "live";

export type ProviderConfigurationStatus = {
  configured: boolean;
  detail: string;
  required: boolean;
};

export type DeploymentHealth = {
  issues: Array<{
    code: string;
    message: string;
    provider: keyof DeploymentHealth["providers"];
  }>;
  mode: DeploymentMode;
  providers: {
    alpaca: ProviderConfigurationStatus;
    earnings: ProviderConfigurationStatus;
    openai: ProviderConfigurationStatus;
    supabaseAuth: ProviderConfigurationStatus;
    supabaseServer: ProviderConfigurationStatus;
  };
  status: "degraded" | "demo" | "invalid" | "ready";
};

export type MarketDataConfigurationError = {
  code:
    | "ALPACA_CREDENTIALS_NOT_CONFIGURED"
    | "ALPHA_DOG_SUPABASE_NOT_CONFIGURED";
  message: string;
};
