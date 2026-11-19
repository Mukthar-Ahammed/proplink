import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getServerEnv } from "@/env";
import { expireMandates, remindMandatesEnding } from "@/services/landlord/mandates";

export const dynamic = "force-dynamic";

/**
 * Daily mandate housekeeping (owner decision OD-28): remind both parties 7
 * days before a mandate's agreed end date, and end mandates whose period has
 * passed unless an investor project still depends on them. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; without the secret configured the
 * job refuses to run.
 */
export async function GET(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Job not configured" }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const now = new Date();
  const reminders = await remindMandatesEnding(now);
  const expiry = await expireMandates(now);
  console.info(JSON.stringify({ event: "jobs.mandates", ...reminders, ...expiry }));
  return NextResponse.json({ ok: true, ...reminders, ...expiry });
}
