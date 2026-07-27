import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["src/**/*.test.ts"],
      include: [
        "src/app/api/logos/[symbol]/route.ts",
        "src/app/api/wheel/screener/runs/[runId]/stream/route.ts",
        "src/lib/security/headers.ts",
        "src/lib/supabase/server.ts",
        "src/proxy.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        perFile: true,
        statements: 80,
      },
    },
    environment: "node",
    globals: false,
    include: [
      "src/app/api/logos/[symbol]/route.test.ts",
      "src/app/api/wheel/screener/runs/[runId]/stream/route.test.ts",
      "src/lib/security/headers.test.ts",
      "src/lib/supabase/server.test.ts",
      "src/proxy.test.ts",
    ],
  },
});
