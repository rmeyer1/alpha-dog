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
        "src/app/api/cron/wheel/deep-scan-coverage/route.ts",
        "src/lib/wheel/deep-scan-work/domain.ts",
        "src/lib/wheel/deep-scan-work/repository.ts",
        "src/lib/wheel/deep-scan-work/service.ts",
        "src/workflows/wheel-tiered-deep-scan/index.ts",
        "src/workflows/wheel-tiered-deep-scan/steps.ts",
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
      "src/app/api/cron/wheel/deep-scan-coverage/route.test.ts",
      "src/lib/wheel/deep-scan-work/domain.test.ts",
      "src/lib/wheel/deep-scan-work/repository.test.ts",
      "src/lib/wheel/deep-scan-work/service.test.ts",
      "src/workflows/wheel-tiered-deep-scan/index.test.ts",
      "src/workflows/wheel-tiered-deep-scan/steps.test.ts",
    ],
  },
});
