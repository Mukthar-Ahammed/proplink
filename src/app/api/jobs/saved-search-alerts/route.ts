import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runSavedSearchAlerts } from "@/services/buyers/savedSearches";

export const dynamic = "force-dynamic";

/**
 * Saved-search alerts job (Phase 5 Task 3, ADR-056). Vercel Cron calls it
 * daily (vercel.json) with `Authorization: Bearer $CRON_SECRET`. Without the
 * secret configured the job is off (H5.5).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Scheduled jobs are not configured" },
      { status: 503 },
    );
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await runSavedSearchAlerts();
  console.info(JSON.stringify({ event: "jobs.saved_search_alerts", ...result }));
  return NextResponse.json(result);
}
