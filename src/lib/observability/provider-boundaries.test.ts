import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const boundaries = {
  alpaca: "src/lib/alpaca/client.ts",
  finnhub: "src/lib/finnhub/client.ts",
  openai: "src/lib/trade-analysis/provider.ts",
  polymarket: "src/lib/polymarket/client.ts",
  supabase: "src/lib/supabase/rest.ts",
} as const;

describe("provider boundary inventory", () => {
  it("keeps all five provider clients behind the shared telemetry boundary", () => {
    for (const [provider, file] of Object.entries(boundaries)) {
      const source = readFileSync(join(process.cwd(), file), "utf8");

      expect(source, file).toContain(
        'from "@/lib/observability/provider"',
      );
      expect(source, file).toContain(`observeProviderCall("${provider}"`);
    }
  });

  it("covers direct Supabase auth and Signal Scribe Data API calls", () => {
    for (const file of [
      "src/lib/company-profile.ts",
      "src/lib/supabase/auth.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");

      expect(source, file).toContain('observeProviderCall("supabase"');
      expect(source, file).toContain(
        'from "@/lib/observability/provider"',
      );
    }
  });

  it("suppresses automatic raw-URL spans for every server provider fetch", () => {
    for (const file of [
      "src/app/api/logos/[symbol]/route.ts",
      "src/lib/alpaca/client.ts",
      "src/lib/company-profile.ts",
      "src/lib/finnhub/client.ts",
      "src/lib/observability/health.ts",
      "src/lib/polymarket/client.ts",
      "src/lib/supabase/auth.ts",
      "src/lib/supabase/rest.ts",
      "src/lib/trade-analysis/provider.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const fetchCalls = source.match(/\bfetch\(/g) ?? [];
      const privateTracing = source.match(
        /opentelemetry: privateProviderFetchTracing/g,
      ) ?? [];

      expect(fetchCalls.length, file).toBeGreaterThan(0);
      expect(privateTracing.length, file).toBe(fetchCalls.length);
    }
  });
});
