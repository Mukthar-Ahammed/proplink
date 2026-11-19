import "server-only";

import { db } from "@/lib/db";

/**
 * Retention job (Phase 7 Task 4, ADR-065; docs/compliance/RETENTION.md).
 * Deletes short-lived operational data on a fixed schedule; never deletes
 * personal, legal or financial records automatically. Those are counted as
 * "due for review" so a person decides (legal holds apply). Periods are the
 * documented defaults pending the owner's confirmation (OD-26).
 */
export const RETENTION_DAYS = {
  securityEventCounts: 90,
  rateLimitWindows: 2,
  savedSearchAlerts: 90,
  usedVerificationTokens: 7,
  notificationDeliveries: 365,
  financialRecordsReview: 6 * 365,
} as const;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function runRetention(now = new Date()) {
  const [
    securityEvents,
    rateLimits,
    alerts,
    recoverySessions,
    tokens,
    deliveries,
    financialDue,
  ] = await Promise.all([
    db.securityEventCount.deleteMany({
      where: { bucket: { lt: daysAgo(now, RETENTION_DAYS.securityEventCounts) } },
    }),
    db.$executeRaw`
      DELETE FROM private.auth_rate_limits
      WHERE window_start < ${daysAgo(now, RETENTION_DAYS.rateLimitWindows)}
    `,
    db.savedSearchAlert.deleteMany({
      where: { createdAt: { lt: daysAgo(now, RETENTION_DAYS.savedSearchAlerts) } },
    }),
    db.mfaRecoverySession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.verificationToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { lt: daysAgo(now, RETENTION_DAYS.usedVerificationTokens) } },
        ],
      },
    }),
    db.notificationDelivery.deleteMany({
      where: { createdAt: { lt: daysAgo(now, RETENTION_DAYS.notificationDeliveries) } },
    }),
    // Not deleted: projects closed or sold more than six years ago, for review.
    db.investorProject.count({
      where: {
        status: { in: ["SOLD", "CLOSED"] },
        statusChangedAt: { lt: daysAgo(now, RETENTION_DAYS.financialRecordsReview) },
      },
    }),
  ]);
  return {
    deleted: {
      securityEventCounts: securityEvents.count,
      rateLimitWindows: Number(rateLimits),
      savedSearchAlerts: alerts.count,
      mfaRecoverySessions: recoverySessions.count,
      verificationTokens: tokens.count,
      notificationDeliveries: deliveries.count,
    },
    dueForReview: { financialRecordsOlderThanSixYears: financialDue },
  };
}
