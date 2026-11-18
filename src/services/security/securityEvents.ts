import "server-only";

import { SecurityEventKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

/**
 * Security events (Phase 6 Task 4, ADR-061): per-minute counts by kind, no
 * personal data, so a flood cannot grow the table per request. Recording is
 * best effort and never throws into the request that triggered it.
 */
export async function recordSecurityEvent(kind: SecurityEventKind, now = new Date()) {
  try {
    const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await db.$executeRaw`
      INSERT INTO public.security_event_counts (kind, bucket, count)
      VALUES (${kind}::"SecurityEventKind", ${bucket}, 1)
      ON CONFLICT (kind, bucket) DO UPDATE SET count = public.security_event_counts.count + 1
    `;
  } catch {
    // Never let monitoring break the request.
  }
}

export const SECURITY_EVENT_LABELS: Record<SecurityEventKind, string> = {
  RATE_LIMITED: "Requests refused by rate limits",
  CSRF_REJECTED: "Cross-site requests refused",
  LOGIN_FAILED: "Failed sign-ins",
  WEBHOOK_REJECTED: "Webhooks rejected (bad signature or request)",
  WEBHOOK_FAILED: "Webhooks that failed to process",
  ADMIN_PERMISSION_DENIED: "Admin permission refusals",
};

/** Totals for the last 24 hours and 7 days, and an hourly series for 24 hours. */
export async function securityEventSummary(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await db.securityEventCount.findMany({
    where: { bucket: { gte: weekAgo } },
    select: { kind: true, bucket: true, count: true },
  });
  const kinds = Object.keys(SECURITY_EVENT_LABELS) as SecurityEventKind[];
  return kinds.map((kind) => {
    const mine = rows.filter((row) => row.kind === kind);
    const hourly = Array.from({ length: 24 }, (_, i) => {
      const start = new Date(now.getTime() - (24 - i) * 3_600_000);
      const end = new Date(start.getTime() + 3_600_000);
      return mine
        .filter((row) => row.bucket >= start && row.bucket < end)
        .reduce((sum, row) => sum + row.count, 0);
    });
    return {
      kind,
      label: SECURITY_EVENT_LABELS[kind],
      lastDay: mine
        .filter((row) => row.bucket >= dayAgo)
        .reduce((sum, row) => sum + row.count, 0),
      lastWeek: mine.reduce((sum, row) => sum + row.count, 0),
      hourly,
    };
  });
}
