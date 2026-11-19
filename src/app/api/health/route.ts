import { NextResponse } from "next/server";

import { checkHealth } from "@/services/metrics/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health (Phase 7 Task 5). Public, read-only, rate limited as a
 * public read; 200 when the database answers, 503 otherwise.
 */
export async function GET() {
  const report = await checkHealth();
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
