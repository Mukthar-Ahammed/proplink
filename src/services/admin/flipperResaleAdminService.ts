import "server-only";

import { z } from "zod";
import {
  Role,
  FlipperResaleStatus,
  InvestorType,
  PropertyStatus,
  ListingSource,
} from "@/generated/prisma/enums";
import { AdminCaller } from "@/services/admin/kycAdminService";

// ─── Input Schemas ────────────────────────────────────────────────────────────

export const approveResaleSchema = z.object({
  resaleId: z.string().min(1, "resaleId is required"),
});

export type ApproveResaleInput = z.infer<typeof approveResaleSchema>;

export const rejectResaleSchema = z.object({
  resaleId: z.string().min(1, "resaleId is required"),
  rejectionReason: z
    .string()
    .trim()
    .min(5, "Please provide a rejection reason (minimum 5 characters)")
    .max(500),
  internalNotes: z.string().trim().max(2000).optional(),
});

export type RejectResaleInput = z.infer<typeof rejectResaleSchema>;

// ─── Result Type ──────────────────────────────────────────────────────────────

export type ResaleAdminResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

// ─── Admin Queue Item Type ────────────────────────────────────────────────────

export type AdminResaleQueueItem = {
  id: string;
  projectId: string;
  propertyId: string;
  propertyTitle: string;
  city: string;
  postcode: string;
  investorUserId: string;
  investorName: string;
  investorEmail: string;
  investorType: InvestorType | null;
  estimatedAskingPriceGBP: number;
  estimatedProfitGBP: number;
  status: FlipperResaleStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
};

// ─── Admin Resale Detail Type ─────────────────────────────────────────────────

export type AdminResaleDetail = AdminResaleQueueItem & {
  description: string | null;
  declaration: string | null;
  /** Admin-only internal notes. NEVER expose to Investor. */
  internalNotes: string | null;
  reviewedByUserId: string | null;
  /** Original acquisition price for financial context */
  agreedPriceGBP: number;
  /** Total refurbishment costs for financial context */
  totalCostsGBP: number;
  /** Refurbishment project status */
  projectStatus: string;
  createdAt: Date;
};

// ─── Guard ────────────────────────────────────────────────────────────────────

function requireActiveAdmin(caller: AdminCaller): string | null {
  if (!caller.active) return "Account is inactive";
  if (caller.role !== Role.ADMIN) return "Only Admin accounts can perform resale reviews";
  return null;
}

// ─── Admin Resale Queue ───────────────────────────────────────────────────────

// ─── Admin Resale Summary ─────────────────────────────────────────────────────

export type AdminResaleSummary = {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalCount: number;
  oldestPendingSubmittedAt: Date | null;
};

export async function getAdminResaleSummary(
  caller: AdminCaller,
): Promise<ResaleAdminResult<AdminResaleSummary>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const [pendingCount, approvedCount, rejectedCount, totalCount, oldestPending] =
    await Promise.all([
      db.flipperResale.count({ where: { status: FlipperResaleStatus.SUBMITTED } }),
      db.flipperResale.count({ where: { status: FlipperResaleStatus.APPROVED } }),
      db.flipperResale.count({ where: { status: FlipperResaleStatus.REJECTED } }),
      db.flipperResale.count(),
      db.flipperResale.findFirst({
        where: { status: FlipperResaleStatus.SUBMITTED },
        orderBy: { submittedAt: "asc" },
        select: { submittedAt: true },
      }),
    ]);

  return {
    ok: true,
    data: {
      pendingCount,
      approvedCount,
      rejectedCount,
      totalCount,
      oldestPendingSubmittedAt: oldestPending?.submittedAt ?? null,
    },
  };
}

// ─── Admin Resale Queue ───────────────────────────────────────────────────────

export type AdminResaleQueueParams = {
  status?: FlipperResaleStatus | "ALL";
  investorType?: InvestorType | "ALL";
  search?: string;
  sort?: "oldest" | "newest";
  page?: number;
  pageSize?: number;
};

export type AdminResaleQueueResult = {
  items: AdminResaleQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function getAdminResaleQueue(
  caller: AdminCaller,
  params?: AdminResaleQueueParams,
): Promise<ResaleAdminResult<AdminResaleQueueResult>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const statusFilter =
    params?.status && params.status !== "ALL"
      ? { status: params.status }
      : params?.status === "ALL"
        ? {}
        : { status: FlipperResaleStatus.SUBMITTED }; // Default: pending review only

  const investorTypeFilter =
    params?.investorType && params.investorType !== "ALL"
      ? {
          investor: {
            authProfile: {
              investorType: params.investorType,
            },
          },
        }
      : {};

  const searchFilter = params?.search?.trim()
    ? {
        OR: [
          {
            property: {
              title: { contains: params.search.trim(), mode: "insensitive" as const },
            },
          },
          {
            property: {
              city: { contains: params.search.trim(), mode: "insensitive" as const },
            },
          },
          {
            investor: {
              name: { contains: params.search.trim(), mode: "insensitive" as const },
            },
          },
          {
            investor: {
              email: { contains: params.search.trim(), mode: "insensitive" as const },
            },
          },
        ],
      }
    : {};

  const whereClause = {
    ...statusFilter,
    ...investorTypeFilter,
    ...searchFilter,
  };

  const sortOrder = params?.sort === "newest" ? ("desc" as const) : ("asc" as const);
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, params?.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const [total, resales] = await Promise.all([
    db.flipperResale.count({ where: whereClause }),
    db.flipperResale.findMany({
      where: whereClause,
      orderBy: { submittedAt: sortOrder },
      skip,
      take: pageSize,
      include: {
        property: { select: { id: true, title: true, city: true, postcode: true } },
        investor: {
          select: {
            id: true,
            name: true,
            email: true,
            authProfile: { select: { investorType: true } },
          },
        },
      },
    }),
  ]);

  const items: AdminResaleQueueItem[] = resales.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    propertyId: r.propertyId,
    propertyTitle: r.property.title,
    city: r.property.city,
    postcode: r.property.postcode,
    investorUserId: r.investorUserId,
    investorName: r.investor.name,
    investorEmail: r.investor.email,
    investorType: r.investor.authProfile?.investorType ?? null,
    estimatedAskingPriceGBP: r.estimatedAskingPriceGBP,
    estimatedProfitGBP: r.estimatedProfitGBP,
    status: r.status,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    rejectionReason: r.rejectionReason,
  }));

  const totalPages = Math.ceil(total / pageSize) || 1;

  return {
    ok: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages,
    },
  };
}

// ─── Admin Resale Detail ──────────────────────────────────────────────────────

/**
 * Returns full resale detail for Admin review, including internal notes.
 * NEVER exposed to Investors directly.
 */
export async function getAdminResaleDetail(
  caller: AdminCaller,
  resaleId: string,
): Promise<ResaleAdminResult<AdminResaleDetail>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: resaleId },
    include: {
      property: { select: { id: true, title: true, city: true, postcode: true } },
      investor: {
        select: {
          id: true,
          name: true,
          email: true,
          authProfile: { select: { investorType: true } },
        },
      },
      project: {
        include: {
          acquisition: { select: { agreedPriceGBP: true } },
          costs: { select: { amountGBP: true } },
        },
      },
    },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  const totalCostsGBP = resale.project.costs.reduce((sum, c) => sum + c.amountGBP, 0);

  return {
    ok: true,
    data: {
      id: resale.id,
      projectId: resale.projectId,
      propertyId: resale.propertyId,
      propertyTitle: resale.property.title,
      city: resale.property.city,
      postcode: resale.property.postcode,
      investorUserId: resale.investorUserId,
      investorName: resale.investor.name,
      investorEmail: resale.investor.email,
      investorType: resale.investor.authProfile?.investorType ?? null,
      estimatedAskingPriceGBP: resale.estimatedAskingPriceGBP,
      estimatedProfitGBP: resale.estimatedProfitGBP,
      description: resale.description,
      declaration: resale.declaration,
      internalNotes: resale.internalNotes, // Admin-only field
      rejectionReason: resale.rejectionReason,
      reviewedByUserId: resale.reviewedByUserId,
      status: resale.status,
      submittedAt: resale.submittedAt,
      reviewedAt: resale.reviewedAt,
      agreedPriceGBP: resale.project.acquisition.agreedPriceGBP,
      totalCostsGBP,
      projectStatus: resale.project.status,
      createdAt: resale.createdAt,
    },
  };
}

// ─── Approve Resale Listing ───────────────────────────────────────────────────

/**
 * Admin approves a SUBMITTED resale listing → APPROVED.
 * Race-safe via conditional raw SQL update.
 * Admins cannot self-approve (if the Admin is also an Investor — a guard we enforce).
 */
export async function approveFlipperResale(
  caller: AdminCaller,
  input: ApproveResaleInput,
): Promise<ResaleAdminResult<{ resaleId: string; resalePropertyId?: string }>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const parse = approveResaleSchema.safeParse(input);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Invalid parameters" };
  }

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: input.resaleId },
    select: {
      id: true,
      investorUserId: true,
      status: true,
      propertyId: true,
      estimatedAskingPriceGBP: true,
      description: true,
      resalePropertyId: true,
    },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  // Anti-self-approval guard (protects against Admin == Investor edge-case)
  if (resale.investorUserId === caller.userId) {
    return { ok: false, error: "Admins cannot approve their own resale listings" };
  }

  // Idempotency check: if already published with a resalePropertyId, return existing
  if (resale.status === FlipperResaleStatus.APPROVED && resale.resalePropertyId) {
    return {
      ok: true,
      data: { resaleId: input.resaleId, resalePropertyId: resale.resalePropertyId },
    };
  }

  // State invariant
  if (resale.status !== FlipperResaleStatus.SUBMITTED) {
    return {
      ok: false,
      error: "Only SUBMITTED resale listings can be approved",
    };
  }

  const now = new Date();

  // Fetch original acquisition property to copy physical attributes (title, address, location, etc.)
  const origProperty = await db.property.findUnique({
    where: { id: resale.propertyId },
    include: { images: true },
  });

  if (!origProperty) {
    return { ok: false, error: "Original property reference not found" };
  }

  // Create a DISTINCT new Property record for the resale marketplace listing.
  // Note: agentProfileId is null (no Agent ownership cloned); listingSource = FLIPPER_RESALE.
  const newResaleListing = await db.property.create({
    data: {
      agentProfileId: null,
      listingSource: ListingSource.FLIPPER_RESALE,
      title: origProperty.title,
      description: resale.description ?? origProperty.description,
      status: PropertyStatus.LIVE,
      addressLine1: origProperty.addressLine1,
      city: origProperty.city,
      region: origProperty.region,
      postcode: origProperty.postcode,
      propertyType: origProperty.propertyType,
      bedrooms: origProperty.bedrooms,
      askingPriceGBP: resale.estimatedAskingPriceGBP,
      targetRoiPct: origProperty.targetRoiPct,
      epcRating: origProperty.epcRating,
      epcCertUrl: origProperty.epcCertUrl,
      floorPlanUrl: origProperty.floorPlanUrl,
      publishedAt: now,
    },
  });

  // Copy images if original property had images
  if (origProperty.images && origProperty.images.length > 0) {
    try {
      await db.propertyImage.createMany({
        data: origProperty.images.map((img) => ({
          propertyId: newResaleListing.id,
          url: img.url,
          sortOrder: img.sortOrder,
        })),
      });
    } catch (err) {
      console.error("Failed to copy images to resale property listing:", err);
    }
  }

  // Atomic race-safe update — only succeeds if status is still SUBMITTED and resalePropertyId is NULL
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperResale"
    SET "status"           = 'APPROVED'::"FlipperResaleStatus",
        "resalePropertyId" = ${newResaleListing.id},
        "reviewedAt"       = ${now},
        "reviewedByUserId" = ${caller.userId},
        "updatedAt"        = ${now}
    WHERE "id" = ${input.resaleId}
      AND "status" = 'SUBMITTED'::"FlipperResaleStatus"
      AND "resalePropertyId" IS NULL
  `;

  if (updatedCount === 0) {
    // If a race occurred, delete the orphaned resale listing row
    try {
      await db.property.delete({ where: { id: newResaleListing.id } });
    } catch {
      // Ignore cleanup error
    }

    // Re-check if another concurrent request succeeded
    try {
      const reCheck = await db.flipperResale.findUnique({
        where: { id: input.resaleId },
        select: { status: true, resalePropertyId: true },
      });

      if (reCheck?.status === FlipperResaleStatus.APPROVED && reCheck.resalePropertyId) {
        return {
          ok: true,
          data: { resaleId: input.resaleId, resalePropertyId: reCheck.resalePropertyId },
        };
      }
    } catch {
      // Ignore findUnique error in mock environment
    }

    return {
      ok: false,
      error:
        "Resale listing is no longer pending review (race condition or already decided)",
    };
  }

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_RESALE_APPROVED",
        entity: "FlipperResale",
        entityId: input.resaleId,
        metaJson: {
          investorUserId: resale.investorUserId,
          approvedAt: now.toISOString(),
          reviewerUserId: caller.userId,
          originalPropertyId: resale.propertyId,
          resalePropertyId: newResaleListing.id,
          askingPriceGBP: resale.estimatedAskingPriceGBP,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log resale approval audit event:", err);
  }

  return {
    ok: true,
    data: { resaleId: input.resaleId, resalePropertyId: newResaleListing.id },
  };
}

// ─── Reject Resale Listing ────────────────────────────────────────────────────

/**
 * Admin rejects a SUBMITTED resale listing → REJECTED.
 * A safe rejectionReason is stored and visible to the Investor.
 * Optional internalNotes are Admin-only and NEVER exposed to the Investor.
 */
export async function rejectFlipperResale(
  caller: AdminCaller,
  input: RejectResaleInput,
): Promise<ResaleAdminResult<{ resaleId: string }>> {
  const guard = requireActiveAdmin(caller);
  if (guard) return { ok: false, error: guard };

  const parse = rejectResaleSchema.safeParse(input);
  if (!parse.success) {
    return {
      ok: false,
      error: parse.error.issues[0]?.message ?? "Invalid rejection parameters",
    };
  }

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: input.resaleId },
    select: { id: true, investorUserId: true, status: true },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  if (resale.status !== FlipperResaleStatus.SUBMITTED) {
    return {
      ok: false,
      error: "Only SUBMITTED resale listings can be rejected",
    };
  }

  const now = new Date();

  // Race-safe conditional update
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperResale"
    SET "status"           = 'REJECTED'::"FlipperResaleStatus",
        "rejectionReason"  = ${input.rejectionReason},
        "internalNotes"    = ${input.internalNotes ?? null},
        "reviewedAt"       = ${now},
        "reviewedByUserId" = ${caller.userId},
        "updatedAt"        = ${now}
    WHERE "id" = ${input.resaleId}
      AND "status" = 'SUBMITTED'::"FlipperResaleStatus"
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error:
        "Resale listing is no longer pending review (race condition or already decided)",
    };
  }

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_RESALE_REJECTED",
        entity: "FlipperResale",
        entityId: input.resaleId,
        metaJson: {
          investorUserId: resale.investorUserId,
          rejectedAt: now.toISOString(),
          rejectionReason: input.rejectionReason,
          reviewerUserId: caller.userId,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log resale rejection audit event:", err);
  }

  return { ok: true, data: { resaleId: input.resaleId } };
}
