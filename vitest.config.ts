import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// `tests/unit` mocks the database everywhere; `tests/integration` runs
// against the real one (Task 3.1's search SQL is PostGIS/FTS/pg_trgm, which
// no mock can meaningfully verify) and skips itself when no DATABASE_URL is
// configured, so `npm run test` stays one command that is always green.
const SEEDED_SEARCH = "tests/integration/search-service.test.ts";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["tests/setup/env.ts"],
    // Database tests share one disposable Postgres with every other test file
    // running in parallel; give them room under that load.
    testTimeout: 30_000,
    // The seeded-search test asserts on the exact seeded catalogue. Other
    // database tests create live listings while they run (and retire their
    // Agents afterwards, which takes those listings out of search), so it runs
    // in a second group once everything else has finished (Phase 5).
    // Each project lists its own files: `extends` merges arrays.
    projects: [
      {
        extends: true,
        test: {
          name: "main",
          include: ["tests/{unit,integration}/**/*.test.{ts,tsx}"],
          exclude: [SEEDED_SEARCH],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "seeded-search",
          include: [SEEDED_SEARCH],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
