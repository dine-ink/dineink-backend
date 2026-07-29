import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests (*.integration.test.ts) hit the real configured
    // database and are excluded from the default fast unit-test run —
    // run them explicitly via `npm run test:integration`.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
