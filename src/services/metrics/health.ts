import "server-only";

import { db } from "@/lib/db";

/**
 * Health check (Phase 7 Task 5, docs/performance/RESILIENCE.md). Answers
 * "can this instance serve requests?" for uptime monitors and the platform.
 * The only dependency every page needs is the database; providers have
 * mocks or fail closed on their own and are shown at Admin → Integrations.
 * Reports no hostnames, versions of dependencies or error text.
 */

const DATABASE_TIMEOUT_MS = 2_000;

export type HealthReport = {
  status: "ok" | "unavailable";
  checks: { database: { ok: boolean; ms: number } };
  release: string | null;
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("health check timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(): Promise<HealthReport> {
  const started = Date.now();
  let ok = true;
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS);
  } catch {
    ok = false;
  }
  return {
    status: ok ? "ok" : "unavailable",
    checks: { database: { ok, ms: Date.now() - started } },
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
}
