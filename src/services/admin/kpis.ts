import "server-only";

import {
  ChatThreadStatus,
  DealStage,
  InvestorProjectStatus,
  KycSubmissionStatus,
  MandateStatus,
  PropertyStatus,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { reviewQueueMetrics } from "@/services/landlord/reviewQueue";

/**
 * Admin KPIs (Phase 6 Task 4, ADR-061): queue times, chat authorisations,
 * subscriptions and a 30-day funnel. Counts only; no personal data.
 */

const minutesSince = (date: Date | null | undefined, now: Date) =>
  date ? Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000)) : null;

export async function adminKpis(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [
    landlordQueue,
    kycWaiting,
    oldestKyc,
    retailWaiting,
    oldestRetail,
    chatsPending,
    oldestChat,
    subscriptions,
    signups,
    kycApproved,
    mandates,
    projectsPublished,
    projectsSold,
    offers,
    dealsCompleted,
  ] = await Promise.all([
    reviewQueueMetrics(now),
    db.kycSubmission.count({ where: { status: KycSubmissionStatus.SUBMITTED } }),
    db.kycSubmission.findFirst({
      where: { status: KycSubmissionStatus.SUBMITTED },
      orderBy: { submittedAt: "asc" },
      select: { submittedAt: true },
    }),
    db.property.count({ where: { status: PropertyStatus.PENDING_REVIEW } }),
    db.property.findFirst({
      where: { status: PropertyStatus.PENDING_REVIEW },
      orderBy: { submittedAt: "asc" },
      select: { submittedAt: true },
    }),
    db.chatThread.count({ where: { status: ChatThreadStatus.PENDING } }),
    db.chatThread.findFirst({
      where: { status: ChatThreadStatus.PENDING },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.billingSubscription.groupBy({
      by: ["audience", "status"],
      where: {
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      _count: { _all: true },
    }),
    db.profile.groupBy({
      by: ["role"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.kycSubmission.count({
      where: { status: KycSubmissionStatus.APPROVED, reviewedAt: { gte: since } },
    }),
    db.mandate.count({
      where: { acceptedAt: { gte: since }, status: { not: MandateStatus.OFFERED } },
    }),
    db.investorProject.count({ where: { publishedAt: { gte: since } } }),
    db.investorProject.count({
      where: { status: InvestorProjectStatus.SOLD, statusChangedAt: { gte: since } },
    }),
    db.offer.count({ where: { createdAt: { gte: since } } }),
    db.deal.count({ where: { stage: DealStage.COMPLETED, updatedAt: { gte: since } } }),
  ]);
  return {
    queues: [
      {
        name: "Landlord listing review",
        waiting: landlordQueue.waiting,
        oldestMinutes: landlordQueue.oldestMinutes || null,
        note:
          landlordQueue.withinLimitPct === null
            ? "No decisions in 7 days"
            : `${landlordQueue.withinLimitPct}% decided within the 60-minute target (7 days)`,
      },
      {
        name: "KYC exceptions",
        waiting: kycWaiting,
        oldestMinutes: minutesSince(oldestKyc?.submittedAt, now),
      },
      {
        name: "Retail listing moderation",
        waiting: retailWaiting,
        oldestMinutes: minutesSince(oldestRetail?.submittedAt, now),
      },
      {
        name: "Chat authorisations",
        waiting: chatsPending,
        oldestMinutes: minutesSince(oldestChat?.createdAt, now),
      },
    ],
    subscriptions: subscriptions.map((s) => ({
      audience: s.audience,
      status: s.status,
      count: s._count._all,
    })),
    funnel: {
      signupsByRole: signups.map((s) => ({ role: s.role, count: s._count._all })),
      kycApproved,
      mandatesAccepted: mandates,
      projectsPublished,
      projectsSold,
      offers,
      dealsCompleted,
    },
  };
}
