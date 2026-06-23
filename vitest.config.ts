import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      // Entry points bind ports / have top-level side effects and are smoke-tested
      // via the integration test rather than unit-covered.
      exclude: ["src/server.ts", "src/http.ts"],
      // Lines/statements/functions are held above the 80% project bar; branch
      // coverage trails because of defensive `?? ""` fallbacks on glue code.
      thresholds: {
        lines: 85,
        functions: 82,
        statements: 83,
        branches: 63,
      },
    },
  },
});
