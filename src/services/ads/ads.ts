import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AdApplicationStatus,
  AdCampaignStatus,
  AdFormat,
  AdPriceModel,
  AdminPermission,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { hasAdminPermission } from "@/services/admin/permissions";
import { sanitizeAnnouncementText } from "@/services/announcements/announcements";
import {
  checkDestinationUrl,
  isAdPlacement,
  type AdPlacementName,
} from "@/services/ads/placements";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { databaseRule } from "@/services/projects/common";
import { uploadFile } from "@/services/uploads/pipeline";

/**
 * Advertising (Phase 6 Task 1, ADR-060). Businesses apply; an Admin with
 * ADVERTISER_MANAGEMENT approves the advertiser and each campaign before it
 * goes live (database-checked). Pricing fields are stored for the owner's
 * future model but nothing is billed (OD-11). Counts are private daily
 * aggregates, rate-limited, with no per-viewer data.
 */

type Admin = { profileId: string; legacyUserId: string; role: Role };
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; status: number };
const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

export const AD_CATEGORIES = [
  "SURVEYOR",
  "CONTRACTOR",
  "BROKER",
  "INSURER",
  "OTHER",
] as const;
export const AD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const AD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const clean = (value: unknown) =>
  typeof value === "string" ? sanitizeAnnouncementText(value).trim() : "";

async function manager(admin: Admin) {
  return (
    admin.role === Role.ADMIN &&
    (await hasAdminPermission(admin.profileId, AdminPermission.ADVERTISER_MANAGEMENT))
  );
}

// ── Applications (public) ────────────────────────────────────────────────

const applicationSchema = z.object({
  businessName: z
    .string()
    .transform(clean)
    .pipe(z.string().min(2, "Business name").max(120)),
  category: z.enum(AD_CATEGORIES, { error: "Choose what your business does" }),
  contactName: z.string().transform(clean).pipe(z.string().min(2, "Your name").max(120)),
  contactEmail: z.email("Enter a valid email").max(254),
  website: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : "")),
  preferredSlot: z.string().refine(isAdPlacement, "Choose a placement"),
  preferredFormat: z.enum(AdFormat, { error: "Choose a format" }),
  message: z
    .string()
    .optional()
    .transform((v) => clean(v ?? "").slice(0, 1000)),
});

export async function submitApplication(
  raw: unknown,
  requesterKey: string,
): Promise<Result<{ id: string }>> {
  const parsed = applicationSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the form");
  const input = parsed.data;
  if (
    !(await consumeRateLimits("ad_application", [
      { kind: "ip", identifier: requesterKey, windowSeconds: 86_400, limit: 5 },
      {
        kind: "email",
        identifier: input.contactEmail.toLowerCase(),
        windowSeconds: 86_400,
        limit: 3,
      },
    ]))
  ) {
    return bad("Too many applications today; try again tomorrow", 429);
  }
  let website: string | null = null;
  if (input.website) {
    const checked = checkDestinationUrl(input.website);
    if (!checked.ok) return bad(`Website: ${checked.error}`);
    website = checked.url;
  }
  const id = randomUUID();
  await db.advertiserApplication.create({
    data: {
      id,
      businessName: input.businessName,
      category: input.category,
      contactName: input.contactName,
      contactEmail: input.contactEmail.toLowerCase(),
      website,
      preferredSlot: input.preferredSlot as AdPlacementName,
      preferredFormat: input.preferredFormat,
      message: input.message || null,
    },
  });
  return { ok: true, id };
}

export async function decideApplication(
  admin: Admin,
  applicationId: string,
  approve: boolean,
  note: string,
): Promise<Result<{ advertiserId?: string }>> {
  if (!(await manager(admin))) return bad("Advertiser permission required", 403);
  const application = await db.advertiserApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) return bad("Application not found", 404);
  if (application.status !== AdApplicationStatus.SUBMITTED)
    return bad("Already decided", 409);
  const decisionNote = clean(note).slice(0, 500) || null;
  if (!approve && !decisionNote) return bad("Give a reason for declining");
  const advertiserId = approve ? randomUUID() : undefined;
  await db.$transaction(async (tx) => {
    await tx.advertiserApplication.update({
      where: { id: applicationId },
      data: {
        status: approve ? AdApplicationStatus.APPROVED : AdApplicationStatus.REJECTED,
        decidedBy: admin.profileId,
        decidedAt: new Date(),
        decisionNote,
      },
    });
    if (advertiserId) {
      await tx.advertiser.create({
        data: {
          id: advertiserId,
          businessName: application.businessName,
          category: application.category,
          contactEmail: application.contactEmail,
          website: application.website,
          applicationId,
          createdBy: admin.profileId,
        },
      });
    }
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: approve ? "ads.application_approved" : "ads.application_rejected",
    entity: "AdvertiserApplication",
    entityId: applicationId,
  });
  return { ok: true, advertiserId };
}

// ── Campaigns (Admin) ────────────────────────────────────────────────────

const campaignSchema = z.object({
  advertiserId: z.uuid(),
  slot: z.string().refine(isAdPlacement, "Choose a placement"),
  format: z.enum(AdFormat),
  headline: z
    .string()
    .transform(clean)
    .pipe(
      z.string().min(3, "Headline: 3-60 characters").max(60, "Headline: 3-60 characters"),
    ),
  body: z
    .string()
    .transform(clean)
    .pipe(z.string().min(3, "Text: 3-140 characters").max(140, "Text: 3-140 characters")),
  destinationUrl: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  priceModel: z.enum(AdPriceModel).default(AdPriceModel.NONE),
  pricePounds: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : "")),
});

export async function createCampaign(
  admin: Admin,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  if (!(await manager(admin))) return bad("Advertiser permission required", 403);
  const parsed = campaignSchema.safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the campaign");
  const input = parsed.data;
  const destination = checkDestinationUrl(input.destinationUrl);
  if (!destination.ok) return bad(destination.error);
  if (input.endsAt <= input.startsAt) return bad("The end date must be after the start");
  let pricePence: bigint | null = null;
  if (input.priceModel !== AdPriceModel.NONE) {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(input.pricePounds))
      return bad("Price: pounds, e.g. 250 or 2.50");
    const [whole, fraction = ""] = input.pricePounds.split(".");
    pricePence = BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  }
  const advertiser = await db.advertiser.findUnique({
    where: { id: input.advertiserId },
  });
  if (!advertiser?.active) return bad("Advertiser not found", 404);
  if (input.format === AdFormat.IMAGE_BANNER) {
    return bad("Create an image banner by uploading its image first");
  }
  const id = randomUUID();
  await db.adCampaign.create({
    data: {
      id,
      advertiserId: input.advertiserId,
      slot: input.slot as AdPlacementName,
      format: input.format,
      headline: input.headline,
      body: input.body,
      destinationUrl: destination.url,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      priceModel: input.priceModel,
      pricePence,
      createdBy: admin.profileId,
    },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "ads.campaign_created",
    entity: "AdCampaign",
    entityId: id,
  });
  return { ok: true, id };
}

/** Uploads the banner image (quarantined and scanned) and attaches it. */
export async function attachCampaignImage(
  admin: Admin,
  campaignId: string,
  file: { bytes: Uint8Array; type: string; name: string },
): Promise<Result> {
  if (!(await manager(admin))) return bad("Advertiser permission required", 403);
  if (!AD_IMAGE_TYPES.includes(file.type)) return bad("Use a PNG, JPEG or WebP image");
  if (file.bytes.length > AD_IMAGE_MAX_BYTES) return bad("Images up to 2 MB");
  const campaign = await db.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== AdCampaignStatus.DRAFT) {
    return bad("Images are added to draft campaigns", 409);
  }
  const uploaded = await uploadFile(admin, {
    bytes: file.bytes,
    declaredType: file.type,
    originalName: file.name,
    purpose: "ad_creative",
  });
  if (!uploaded.ok) return bad(uploaded.error, uploaded.status);
  if (!uploaded.previewable) return bad("That file is not an image we can show", 400);
  await db.adCampaign.update({
    where: { id: campaignId },
    data: { format: AdFormat.IMAGE_BANNER, imageFileId: uploaded.fileId },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "ads.campaign_image",
    entity: "AdCampaign",
    entityId: campaignId,
  });
  return { ok: true };
}

const NEXT: Record<string, readonly AdCampaignStatus[]> = {
  DRAFT: [AdCampaignStatus.ACTIVE, AdCampaignStatus.ENDED],
  ACTIVE: [AdCampaignStatus.PAUSED, AdCampaignStatus.ENDED],
  PAUSED: [AdCampaignStatus.ACTIVE, AdCampaignStatus.ENDED],
  ENDED: [],
};

/** Approve (go live), pause, resume or end. Going live records the approving Admin. */
export async function setCampaignStatus(
  admin: Admin,
  campaignId: string,
  raw: string,
): Promise<Result> {
  if (!(await manager(admin))) return bad("Advertiser permission required", 403);
  const campaign = await db.adCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return bad("Campaign not found", 404);
  const to = raw as AdCampaignStatus;
  if (!NEXT[campaign.status]?.includes(to))
    return bad("That change is not possible", 409);
  try {
    await db.adCampaign.update({
      where: { id: campaignId },
      data: {
        status: to,
        ...(to === AdCampaignStatus.ACTIVE
          ? { approvedBy: admin.profileId, approvedAt: new Date() }
          : {}),
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(rule.message || "Refused", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: `ads.campaign_${to.toLowerCase()}`,
    entity: "AdCampaign",
    entityId: campaignId,
  });
  return { ok: true };
}

// ── Serving ──────────────────────────────────────────────────────────────

export type ServedAd = {
  id: string;
  format: AdFormat;
  headline: string;
  body: string;
  advertiser: string;
  hasImage: boolean;
};

/** One live ad for a designated slot (least shown today first), or null. */
export async function pickAd(
  slot: AdPlacementName,
  now = new Date(),
): Promise<ServedAd | null> {
  if (!isAdPlacement(slot)) return null;
  const live = await db.adCampaign.findMany({
    where: {
      slot,
      status: AdCampaignStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
      advertiser: { active: true },
    },
    select: {
      id: true,
      format: true,
      headline: true,
      body: true,
      imageFileId: true,
      advertiser: { select: { businessName: true } },
      stats: { where: { day: dayOf(now) }, select: { impressions: true } },
    },
    take: 20,
  });
  if (live.length === 0) return null;
  live.sort((a, b) => (a.stats[0]?.impressions ?? 0) - (b.stats[0]?.impressions ?? 0));
  const ad = live[0];
  return {
    id: ad.id,
    format: ad.format,
    headline: ad.headline,
    body: ad.body,
    advertiser: ad.advertiser.businessName,
    hasImage: Boolean(ad.imageFileId),
  };
}

const dayOf = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

/** Counts an impression or click at most once per visitor key per campaign per hour. */
export async function recordAdEvent(
  campaignId: string,
  kind: "impression" | "click",
  visitorKey: string,
  now = new Date(),
): Promise<boolean> {
  const counted = await consumeRateLimits(`ad_${kind}`, [
    {
      kind: "ip",
      identifier: `${visitorKey}:${campaignId}`,
      windowSeconds: 3600,
      limit: 1,
    },
  ]);
  if (!counted) return false;
  const day = dayOf(now);
  await db.adDailyStat.upsert({
    where: { campaignId_day: { campaignId, day } },
    create: {
      campaignId,
      day,
      impressions: kind === "impression" ? 1 : 0,
      clicks: kind === "click" ? 1 : 0,
    },
    update:
      kind === "impression"
        ? { impressions: { increment: 1 } }
        : { clicks: { increment: 1 } },
  });
  return true;
}

/** The stored, validated destination of a live campaign (for the click redirect). */
export async function liveDestination(campaignId: string, now = new Date()) {
  if (!z.uuid().safeParse(campaignId).success) return null;
  const campaign = await db.adCampaign.findFirst({
    where: {
      id: campaignId,
      status: AdCampaignStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: { destinationUrl: true, imageFileId: true },
  });
  if (!campaign) return null;
  const checked = checkDestinationUrl(campaign.destinationUrl);
  return checked.ok ? { url: checked.url, imageFileId: campaign.imageFileId } : null;
}

// ── Admin reading ────────────────────────────────────────────────────────

export async function adsOverview(admin: Admin) {
  if (!(await manager(admin))) return null;
  const [applications, advertisers, campaigns] = await Promise.all([
    db.advertiserApplication.findMany({
      where: { status: AdApplicationStatus.SUBMITTED },
      orderBy: { createdAt: "asc" },
    }),
    db.advertiser.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.adCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        advertiser: { select: { businessName: true } },
        stats: { select: { impressions: true, clicks: true } },
      },
    }),
  ]);
  return {
    applications,
    advertisers,
    campaigns: campaigns.map((c) => ({
      ...c,
      impressions: c.stats.reduce((sum, s) => sum + s.impressions, 0),
      clicks: c.stats.reduce((sum, s) => sum + s.clicks, 0),
    })),
  };
}
