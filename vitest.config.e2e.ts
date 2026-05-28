import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/e2e/**/*.e2e.test.ts"],
    // No coverage thresholds for E2E — these tests are about server behavior,
    // not source coverage. Coverage is owned by the unit suite.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share Greenmail; disable file-level parallelism so files run
    // sequentially and don't trip over each other's IMAP state.
    fileParallelism: false,
    maxConcurrency: 1,
    pool: "forks",
    forks: { singleFork: true },
    retry: 0,
    reporters: ["default"],
  },
});
