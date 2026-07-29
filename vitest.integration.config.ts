import { defineConfig } from "vitest/config";

// Integration tests hit the real configured database (src/config/prisma.ts)
// and are deliberately excluded from the default `npm test` run — that one
// stays fast and DB-free. Run these explicitly with `npm run test:integration`.
// Each test file is responsible for creating its own isolated fixture data
// (a fresh restaurant) and deleting it afterward — never touching existing rows.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test FILE otherwise runs as its own worker process, each with its
    // own Prisma/pg connection pool — with enough integration files, that
    // multiplies past Postgres's own server-side connection ceiling (a
    // "too many clients already" error, not a client-side pool timeout) even
    // though every individual pool stays under its own `max`. Running files
    // sequentially in one process keeps total connections bounded to a
    // single pool's `max`, regardless of how many integration files exist.
    fileParallelism: false,
  },
});
