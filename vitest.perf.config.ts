import { defineConfig } from "vitest/config";
import path from "node:path";

// Phase 7 Task 5: performance checks, run on demand with `npm run test:perf`
// against the disposable test database (never part of `npm run test`).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup/env.ts"],
    include: ["tests/perf/**/*.perf.test.ts"],
    env: { RUN_PERF: "1" },
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
