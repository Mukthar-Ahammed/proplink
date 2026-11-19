import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runRetention } from "@/services/privacy/retention";

export const dynamic = "force-dynamic";

/**
 * Daily retention job (Phase 7 Task 4, ADR-065). Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`; without the secret it is off.
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
  const result = await runRetention();
  console.info(JSON.stringify({ event: "jobs.retention", ...result }));
  return NextResponse.json(result);
}
