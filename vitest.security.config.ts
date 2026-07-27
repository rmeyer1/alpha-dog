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
        "src/app/api/account/deletion/route.ts",
        "src/app/api/account/export/route.ts",
        "src/app/api/logos/[symbol]/route.ts",
        "src/app/api/wheel/screener/runs/[runId]/stream/route.ts",
        "src/lib/account/data-lifecycle-contract.ts",
        "src/lib/account/data-lifecycle.ts",
        "src/lib/company-date-time.ts",
        "src/lib/company-number.ts",
        "src/lib/http/read-bounded-body.ts",
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
      "src/app/api/account/deletion/route.test.ts",
      "src/app/api/account/export/route.test.ts",
      "src/app/api/logos/[symbol]/route.test.ts",
      "src/app/api/wheel/screener/runs/[runId]/stream/route.test.ts",
      "src/lib/account/data-lifecycle-execution.test.ts",
      "src/lib/account/data-lifecycle-authorization.test.ts",
      "src/lib/account/data-lifecycle.test.ts",
      "src/lib/company-date-time.test.ts",
      "src/lib/company-number.test.ts",
      "src/lib/http/read-bounded-body.test.ts",
      "src/lib/security/headers.test.ts",
      "src/lib/supabase/server.test.ts",
      "src/proxy.test.ts",
    ],
  },
});
