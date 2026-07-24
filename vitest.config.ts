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
      exclude: [
        "src/lib/observability/**/*.test.ts",
      ],
      include: [
        "src/lib/observability/**/*.ts",
      ],
      provider: "v8",
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
    include: ["src/**/*.test.ts"],
  },
});
