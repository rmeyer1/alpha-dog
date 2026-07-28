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
        "src/lib/wheel/scanner-parity.ts",
        "src/lib/wheel/scanner-rollout.ts",
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
      "src/lib/wheel/scanner-parity.test.ts",
      "src/lib/wheel/scanner-rollout.test.ts",
    ],
  },
});
