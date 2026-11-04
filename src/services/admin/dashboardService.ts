import "server-only";

import { db } from "@/lib/db";
import {
  KycSubmissionStatus,
  PropertyStatus,
  FlipperResaleStatus,
} from "@/generated/prisma/enums";

// ─── KPI Snapshot ─────────────────────────────────────────────────────────────

export type DashboardKpis = {
  /** Pending KYC submissions awaiting Admin review */
  pendingKyc: number;
  /** Listings currently in PENDING_REVIEW moderation queue */
  pendingModeration: number;
  /** Flipper resale requests awaiting Admin approval */
  pendingResales: number;
  /** Total registered users across all roles */
  totalUsers: number;
  /** Total LIVE marketplace listings (agent + resale) */
  liveListings: number;
};

/** Run all counts in parallel — safe to call from Server Components. */
export async function getDashboardKpis(): Promise<DashboardKpis> {
  const [
    pendingKyc,
    pendingModeration,
    pendingResales,
    totalUsers,
    liveListings,
  ] = await Promise.all([
    db.kycSubmission.count({
      where: { status: KycSubmissionStatus.SUBMITTED },
    }),
    db.property.count({
      where: { status: PropertyStatus.PENDING_REVIEW },
    }),
    db.flipperResale.count({
      where: { status: FlipperResaleStatus.SUBMITTED },
    }),
    db.user.count(),
    db.property.count({
      where: { status: PropertyStatus.LIVE },
    }),
  ]);

  return {
    pendingKyc,
    pendingModeration,
    pendingResales,
    totalUsers,
    liveListings,
  };
}

// ─── "Requires Attention" Stream ─────────────────────────────────────────────

export type AttentionItemKind =
  | "KYC_SUBMITTED"
  | "LISTING_PENDING"
  | "RESALE_SUBMITTED";

export type AttentionItem = {
  id: string;
  kind: AttentionItemKind;
  title: string;
  subtitle: string;
  href: string;
  /** ISO timestamp of the event that created this item */
  at: string;
};

/**
 * Returns the most-urgent items across all queues, oldest-first so Admin
 * works through the backlog in submission order.  Capped at 12 total.
 */
export async function getAttentionItems(): Promise<AttentionItem[]> {
  const [kycItems, moderationItems, resaleItems] = await Promise.all([
    // KYC queue — oldest SUBMITTED first
    db.kycSubmission.findMany({
      where: { status: KycSubmissionStatus.SUBMITTED },
      orderBy: { submittedAt: "asc" },
      take: 5,
      select: {
        id: true,
        submittedAt: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        documents: { select: { id: true } },
      },
    }),

    // Moderation queue — oldest submitted first
    db.property.findMany({
      where: { status: PropertyStatus.PENDING_REVIEW },
      orderBy: { submittedAt: "asc" },
      take: 5,
      select: {
        id: true,
        title: true,
        city: true,
        submittedAt: true,
        agentProfile: { include: { user: { select: { name: true } } } },
      },
    }),

    // Resale queue — oldest submitted first
    db.flipperResale.findMany({
      where: { status: FlipperResaleStatus.SUBMITTED },
      orderBy: { submittedAt: "asc" },
      take: 5,
      select: {
        id: true,
        submittedAt: true,
        estimatedAskingPriceGBP: true,
        property: { select: { title: true, city: true } },
        investor: { select: { name: true } },
      },
    }),
  ]);

  const items: AttentionItem[] = [];

  for (const k of kycItems) {
    items.push({
      id: k.id,
      kind: "KYC_SUBMITTED",
      title: `KYC: ${k.user.name}`,
      subtitle: `${k.documents.length} doc${k.documents.length !== 1 ? "s" : ""} · ${k.user.email}`,
      href: `/admin/kyc`,
      at: (k.submittedAt ?? k.createdAt).toISOString(),
    });
  }

  for (const p of moderationItems) {
    const agentName = p.agentProfile?.user?.name ?? "Unknown agent";
    items.push({
      id: p.id,
      kind: "LISTING_PENDING",
      title: `Listing: ${p.title}`,
      subtitle: `${p.city} · by ${agentName}`,
      href: `/admin/moderation`,
      at: (p.submittedAt ?? new Date(0)).toISOString(),
    });
  }

  for (const r of resaleItems) {
    items.push({
      id: r.id,
      kind: "RESALE_SUBMITTED",
      title: `Resale: ${r.property.title}`,
      subtitle: `${r.property.city} · by ${r.investor.name} · £${r.estimatedAskingPriceGBP.toLocaleString()}`,
      // Links to /admin/resales/[id] (implemented in Phase A4)
      href: `/admin/resales/${r.id}`,
      at: (r.submittedAt ?? new Date(0)).toISOString(),
    });
  }

  // Sort oldest first so urgent items surface at the top
  items.sort((a, b) => a.at.localeCompare(b.at));

  return items.slice(0, 12);
}
