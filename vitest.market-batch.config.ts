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
        "src/lib/wheel/market-batch/domain.ts",
        "src/lib/wheel/market-batch/reader.ts",
        "src/lib/wheel/market-batch/repository.ts",
        "src/lib/wheel/market-batch/service.ts",
        "src/workflows/wheel-market-batch/index.ts",
        "src/workflows/wheel-market-batch/steps.ts",
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
      "src/lib/wheel/market-batch/domain.test.ts",
      "src/lib/wheel/market-batch/reader.test.ts",
      "src/lib/wheel/market-batch/repository.test.ts",
      "src/lib/wheel/market-batch/service.test.ts",
      "src/workflows/wheel-market-batch/index.test.ts",
      "src/workflows/wheel-market-batch/steps.test.ts",
    ],
  },
});
