import "server-only";

import { z } from "zod";
import {
  Role,
  FlipperProjectStatus,
  FlipperResaleStatus,
} from "@/generated/prisma/enums";
import { FlipperCaller, hasFlipperCapability } from "./flipperService";

// ─── Input Schemas ────────────────────────────────────────────────────────────

export const createResaleSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  estimatedAskingPriceGBP: z
    .number()
    .int("Estimated asking price must be in integer pence")
    .positive("Estimated asking price must be positive"),
  description: z.string().trim().max(2000).optional(),
});

export type CreateResaleInput = z.infer<typeof createResaleSchema>;

export const updateResaleDraftSchema = z.object({
  resaleId: z.string().min(1, "resaleId is required"),
  estimatedAskingPriceGBP: z
    .number()
    .int("Estimated asking price must be in integer pence")
    .positive("Estimated asking price must be positive")
    .optional(),
  description: z.string().trim().max(2000).optional(),
  declaration: z
    .string()
    .trim()
    .min(10, "Declaration must be at least 10 characters")
    .max(2000)
    .optional(),
});

export type UpdateResaleDraftInput = z.infer<typeof updateResaleDraftSchema>;

export const submitResaleSchema = z.object({
  resaleId: z.string().min(1, "resaleId is required"),
  declaration: z
    .string()
    .trim()
    .min(
      10,
      "A declaration confirming listing accuracy is required (minimum 10 characters)",
    )
    .max(2000),
});

export type SubmitResaleInput = z.infer<typeof submitResaleSchema>;

// ─── Result Type ─────────────────────────────────────────────────────────────

export type FlipperResaleResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

// ─── Detail Type ─────────────────────────────────────────────────────────────

export type FlipperResaleDetail = {
  id: string;
  projectId: string;
  propertyId: string;
  propertyTitle: string;
  city: string;
  postcode: string;
  /** Acquisition cost — informational for profit calculation context */
  agreedPriceGBP: number;
  /** Total refurbishment cost — informational */
  totalCostsGBP: number;
  /** Server-calculated estimated profit = estimatedAskingPriceGBP - agreedPriceGBP - totalCostsGBP */
  estimatedProfitGBP: number;
  /** ⚠️ Clearly labelled ESTIMATED — not guaranteed */
  estimatedAskingPriceGBP: number;
  description: string | null;
  declaration: string | null;
  status: FlipperResaleStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  /** Safe rejection reason visible to the Investor; never shows internal notes */
  rejectionReason: string | null;
  createdAt: Date;
};

// ─── Guard ────────────────────────────────────────────────────────────────────

function requireFlipperEligible(caller: FlipperCaller): string | null {
  if (!caller.active) return "Account is inactive";
  if (caller.role !== Role.INVESTOR)
    return "Only Investor accounts can manage Flipper resale listings";
  if (!hasFlipperCapability(caller))
    return "Flipper resale is restricted to FLIPPER and BOTH investor subtypes";
  return null;
}

// ─── Helper: compute estimated profit (integer arithmetic only) ───────────────

function computeEstimatedProfit(params: {
  estimatedAskingPriceGBP: number;
  agreedPriceGBP: number;
  totalCostsGBP: number;
}): number {
  // No floating-point arithmetic; all values are integer pence
  return params.estimatedAskingPriceGBP - params.agreedPriceGBP - params.totalCostsGBP;
}

// ─── Create Resale Draft ──────────────────────────────────────────────────────

/**
 * Creates a new DRAFT resale listing linked to a COMPLETED refurbishment project.
 * One resale per project (enforced via the UNIQUE constraint on projectId).
 * Estimated profit is calculated server-side and stored — it is advisory only.
 */
export async function createFlipperResaleDraft(
  caller: FlipperCaller,
  input: CreateResaleInput,
): Promise<FlipperResaleResult<{ resaleId: string }>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const parse = createResaleSchema.safeParse(input);
  if (!parse.success) {
    return {
      ok: false,
      error: parse.error.issues[0]?.message ?? "Invalid resale parameters",
    };
  }

  const { db } = await import("@/lib/db");

  // Load the project with all data needed for profit calculation
  const project = await db.flipperProject.findUnique({
    where: { id: input.projectId },
    include: {
      acquisition: { select: { agreedPriceGBP: true } },
      costs: { select: { amountGBP: true } },
    },
  });

  if (!project) return { ok: false, error: "Refurbishment project not found" };

  // Investor Ownership Guard
  if (project.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this refurbishment project" };
  }

  // Precondition: Project must be COMPLETED before creating a resale listing
  if (project.status !== FlipperProjectStatus.COMPLETED) {
    return {
      ok: false,
      error:
        "A resale listing can only be created for a COMPLETED refurbishment project. Please ensure the project is marked as complete before proceeding.",
    };
  }

  // Prevent duplicate resale
  const existing = await db.flipperResale.findUnique({
    where: { projectId: input.projectId },
  });

  if (existing) {
    return {
      ok: false,
      error:
        "A resale listing already exists for this project. Update the existing draft instead.",
    };
  }

  // Server-side profit calculation (integer pence arithmetic only)
  const totalCostsGBP = project.costs.reduce((sum, c) => sum + c.amountGBP, 0);
  const estimatedProfitGBP = computeEstimatedProfit({
    estimatedAskingPriceGBP: input.estimatedAskingPriceGBP,
    agreedPriceGBP: project.acquisition.agreedPriceGBP,
    totalCostsGBP,
  });

  const resale = await db.flipperResale.create({
    data: {
      projectId: input.projectId,
      investorUserId: caller.userId,
      propertyId: project.propertyId,
      estimatedAskingPriceGBP: input.estimatedAskingPriceGBP,
      estimatedProfitGBP,
      description: input.description ?? null,
      status: FlipperResaleStatus.DRAFT,
    },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_RESALE_DRAFT_CREATED",
        entity: "FlipperResale",
        entityId: resale.id,
        metaJson: {
          projectId: input.projectId,
          estimatedAskingPriceGBP: input.estimatedAskingPriceGBP,
          estimatedProfitGBP,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log resale draft creation audit event:", err);
  }

  return { ok: true, data: { resaleId: resale.id } };
}

// ─── Update Resale Draft ──────────────────────────────────────────────────────

/**
 * Updates a DRAFT resale listing. Only the owner may edit their own DRAFT.
 * If estimatedAskingPriceGBP changes, estimatedProfitGBP is recalculated server-side.
 */
export async function updateFlipperResaleDraft(
  caller: FlipperCaller,
  input: UpdateResaleDraftInput,
): Promise<FlipperResaleResult<{ resaleId: string }>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const parse = updateResaleDraftSchema.safeParse(input);
  if (!parse.success) {
    return {
      ok: false,
      error: parse.error.issues[0]?.message ?? "Invalid update parameters",
    };
  }

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: input.resaleId },
    include: {
      project: {
        include: {
          acquisition: { select: { agreedPriceGBP: true } },
          costs: { select: { amountGBP: true } },
        },
      },
    },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  // Investor Ownership Guard
  if (resale.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this resale listing" };
  }

  // Status Guard: Only DRAFT resale can be edited
  if (resale.status !== FlipperResaleStatus.DRAFT) {
    return {
      ok: false,
      error:
        "Only DRAFT resale listings can be edited. A submitted listing cannot be changed.",
    };
  }

  // Recalculate profit if asking price changed
  let estimatedProfitGBP = resale.estimatedProfitGBP;
  const newAskingPrice = input.estimatedAskingPriceGBP ?? resale.estimatedAskingPriceGBP;
  if (input.estimatedAskingPriceGBP !== undefined) {
    const totalCostsGBP = resale.project.costs.reduce((sum, c) => sum + c.amountGBP, 0);
    estimatedProfitGBP = computeEstimatedProfit({
      estimatedAskingPriceGBP: newAskingPrice,
      agreedPriceGBP: resale.project.acquisition.agreedPriceGBP,
      totalCostsGBP,
    });
  }

  await db.flipperResale.update({
    where: { id: input.resaleId },
    data: {
      ...(input.estimatedAskingPriceGBP !== undefined
        ? { estimatedAskingPriceGBP: input.estimatedAskingPriceGBP, estimatedProfitGBP }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.declaration !== undefined ? { declaration: input.declaration } : {}),
      updatedAt: new Date(),
    },
  });

  return { ok: true, data: { resaleId: input.resaleId } };
}

// ─── Submit Resale for Admin Review ──────────────────────────────────────────

/**
 * Transitions a DRAFT resale listing to SUBMITTED.
 * Requires a non-empty declaration from the Investor.
 * Investor cannot go from SUBMITTED → APPROVED; only Admin can.
 */
export async function submitFlipperResale(
  caller: FlipperCaller,
  input: SubmitResaleInput,
): Promise<FlipperResaleResult<{ resaleId: string }>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const parse = submitResaleSchema.safeParse(input);
  if (!parse.success) {
    return {
      ok: false,
      error: parse.error.issues[0]?.message ?? "Invalid submission parameters",
    };
  }

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: input.resaleId },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  // Investor Ownership Guard
  if (resale.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this resale listing" };
  }

  // Status Guard
  if (resale.status !== FlipperResaleStatus.DRAFT) {
    return {
      ok: false,
      error: "Only DRAFT resale listings can be submitted for review",
    };
  }

  // Declaration Guard: must be set at time of submission
  const declaration = input.declaration.trim();
  if (declaration.length < 10) {
    return {
      ok: false,
      error: "A valid declaration is required to submit this resale listing for review",
    };
  }

  const now = new Date();

  // Race-safe atomic status update
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperResale"
    SET "status"      = 'SUBMITTED'::"FlipperResaleStatus",
        "declaration" = ${declaration},
        "submittedAt" = ${now},
        "updatedAt"   = ${now}
    WHERE "id" = ${input.resaleId}
      AND "status" = 'DRAFT'::"FlipperResaleStatus"
      AND "investorUserId" = ${caller.userId}
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error:
        "Resale listing could not be submitted (already submitted or race condition)",
    };
  }

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_RESALE_SUBMITTED",
        entity: "FlipperResale",
        entityId: input.resaleId,
        metaJson: { submittedAt: now.toISOString() },
      },
    });
  } catch (err) {
    console.error("Failed to log resale submission audit event:", err);
  }

  return { ok: true, data: { resaleId: input.resaleId } };
}

// ─── Resubmit Rejected Resale ─────────────────────────────────────────────────

/**
 * After an Admin rejects a resale listing, the Investor may resubmit.
 * The rejected listing is reset to DRAFT so the Investor can update it before
 * resubmitting.
 */
export async function resubmitFlipperResale(
  caller: FlipperCaller,
  resaleId: string,
): Promise<FlipperResaleResult<{ resaleId: string }>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: resaleId },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };
  if (resale.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this resale listing" };
  }

  // Only REJECTED listings can be resubmitted
  if (resale.status !== FlipperResaleStatus.REJECTED) {
    return {
      ok: false,
      error:
        "Only REJECTED resale listings can be resubmitted. Please contact support if you believe this is incorrect.",
    };
  }

  const now = new Date();

  // Atomically reset to DRAFT and clear review decision fields
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperResale"
    SET "status"          = 'DRAFT'::"FlipperResaleStatus",
        "rejectionReason" = NULL,
        "reviewedAt"      = NULL,
        "reviewedByUserId"= NULL,
        "submittedAt"     = NULL,
        "updatedAt"       = ${now}
    WHERE "id" = ${resaleId}
      AND "status" = 'REJECTED'::"FlipperResaleStatus"
      AND "investorUserId" = ${caller.userId}
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error: "Resale listing could not be reset (race condition or status changed)",
    };
  }

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_RESALE_RESUBMIT_RESET",
        entity: "FlipperResale",
        entityId: resaleId,
      },
    });
  } catch (err) {
    console.error("Failed to log resale resubmit audit event:", err);
  }

  return { ok: true, data: { resaleId } };
}

// ─── Get Resale Detail (Investor View) ───────────────────────────────────────

/**
 * Returns the full resale listing for the owning Investor.
 * NEVER exposes internalNotes to the Investor.
 */
export async function getFlipperResaleDetail(
  caller: FlipperCaller,
  resaleId: string,
): Promise<FlipperResaleResult<FlipperResaleDetail>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const resale = await db.flipperResale.findUnique({
    where: { id: resaleId },
    include: {
      property: { select: { title: true, city: true, postcode: true } },
      project: {
        include: {
          acquisition: { select: { agreedPriceGBP: true } },
          costs: { select: { amountGBP: true } },
        },
      },
    },
  });

  if (!resale) return { ok: false, error: "Resale listing not found" };

  // Investor Isolation Guard
  if (resale.investorUserId !== caller.userId) {
    return {
      ok: false,
      error: "Forbidden: Investor A cannot access Investor B's resale listing",
    };
  }

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
      agreedPriceGBP: resale.project.acquisition.agreedPriceGBP,
      totalCostsGBP,
      estimatedProfitGBP: resale.estimatedProfitGBP,
      estimatedAskingPriceGBP: resale.estimatedAskingPriceGBP,
      description: resale.description,
      declaration: resale.declaration,
      status: resale.status,
      submittedAt: resale.submittedAt,
      reviewedAt: resale.reviewedAt,
      rejectionReason: resale.rejectionReason, // safe - never includes internalNotes
      createdAt: resale.createdAt,
    },
  };
}

// ─── List Investor Resales ────────────────────────────────────────────────────

export type FlipperResaleSummary = {
  id: string;
  projectId: string;
  propertyId: string;
  propertyTitle: string;
  estimatedAskingPriceGBP: number;
  estimatedProfitGBP: number;
  status: FlipperResaleStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
};

export async function listInvestorResales(
  caller: FlipperCaller,
): Promise<FlipperResaleResult<FlipperResaleSummary[]>> {
  const guard = requireFlipperEligible(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const resales = await db.flipperResale.findMany({
    where: { investorUserId: caller.userId },
    orderBy: { createdAt: "desc" },
    include: {
      property: { select: { id: true, title: true } },
    },
  });

  return {
    ok: true,
    data: resales.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      propertyId: r.propertyId,
      propertyTitle: r.property.title,
      estimatedAskingPriceGBP: r.estimatedAskingPriceGBP,
      estimatedProfitGBP: r.estimatedProfitGBP,
      status: r.status,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
    })),
  };
}
