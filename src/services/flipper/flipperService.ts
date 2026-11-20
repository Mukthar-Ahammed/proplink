import "server-only";

import { z } from "zod";
import {
  KycStatus,
  Role,
  InvestorType,
  PropertyStatus,
  FlipperOpportunityStatus,
  FlipperOfferStatus,
  FlipperAcquisitionStatus,
} from "@/generated/prisma/enums";
import { isInvestorFinanciallyEligible } from "@/lib/authz";

// ─── Input Validation Schemas ────────────────────────────────────────────────

export const createFlipperOpportunitySchema = z.object({
  propertyId: z.string().min(1, "propertyId is required"),
});

export const submitFlipperOfferSchema = z.object({
  propertyId: z.string().min(1, "propertyId is required"),
  amountGBP: z
    .number()
    .int("Amount must be in integer pence")
    .positive("Offer amount must be positive")
    .max(1_000_000_000_00, "Offer amount exceeds maximum limit"),
});

export type SubmitFlipperOfferInput = z.infer<typeof submitFlipperOfferSchema>;

// ─── Caller Types ────────────────────────────────────────────────────────────

export type FlipperCaller = {
  userId: string;
  role: Role;
  investorType: InvestorType | null;
  kycStatus: KycStatus;
  active: boolean;
};

export type AgentCaller = {
  userId: string;
  role: Role;
  active: boolean;
};

export type FlipperServiceResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

// ─── Authorization Guards ────────────────────────────────────────────────────

export function hasFlipperCapability(caller: FlipperCaller): boolean {
  if (!caller.active) return false;
  if (caller.role !== Role.INVESTOR) return false;
  return (
    caller.investorType === InvestorType.FLIPPER ||
    caller.investorType === InvestorType.BOTH
  );
}

function requireFlipperSubtype(caller: FlipperCaller): string | null {
  if (!caller.active) return "Account is inactive";
  if (caller.role !== Role.INVESTOR)
    return "Only Investor accounts can access Flipper workspace";
  if (!hasFlipperCapability(caller)) {
    return "Flipper workspace is restricted to FLIPPER and BOTH investor subtypes";
  }
  return null;
}

function requireFlipperFinancialEligibility(caller: FlipperCaller): string | null {
  const subtypeGuard = requireFlipperSubtype(caller);
  if (subtypeGuard) return subtypeGuard;

  const eligible = isInvestorFinanciallyEligible(
    {
      role: caller.role,
      active: caller.active,
      investorType: caller.investorType,
      kycStatus: caller.kycStatus,
    },
    "FLIPPER",
  );

  if (!eligible) {
    return "KYC approval is required before submitting Flipper acquisition offers. Please complete identity verification.";
  }
  return null;
}

// ─── Create or Track Flipper Opportunity ──────────────────────────────────────

export async function createFlipperOpportunity(
  caller: FlipperCaller,
  propertyId: string,
): Promise<FlipperServiceResult<{ opportunityId: string }>> {
  const guard = requireFlipperSubtype(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: { agentProfile: true },
  });

  if (!property) return { ok: false, error: "Property not found" };
  if (
    property.status !== PropertyStatus.LIVE &&
    property.status !== PropertyStatus.UNDER_OFFER
  ) {
    return { ok: false, error: "Property is not currently available for evaluation" };
  }

  // Anti-Self Dealing Guard
  if (property.agentProfile && property.agentProfile.userId === caller.userId) {
    return {
      ok: false,
      error: "You cannot create a Flipper opportunity on your own listing",
    };
  }

  const opp = await db.flipperOpportunity.upsert({
    where: {
      investorUserId_propertyId: {
        investorUserId: caller.userId,
        propertyId,
      },
    },
    update: {},
    create: {
      investorUserId: caller.userId,
      propertyId,
      status: FlipperOpportunityStatus.SAVED,
    },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_OPPORTUNITY_CREATED",
        entity: "FlipperOpportunity",
        entityId: opp.id,
        metaJson: { propertyId },
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { opportunityId: opp.id } };
}

// ─── Workspace Summary ───────────────────────────────────────────────────────

export type FlipperWorkspaceSummary = {
  isKycApproved: boolean;
  opportunities: Array<{
    id: string;
    propertyId: string;
    propertyTitle: string;
    city: string;
    postcode: string;
    askingPriceGBP: number;
    propertyType: string;
    imageUrl: string | null;
    status: FlipperOpportunityStatus;
    createdAt: Date;
  }>;
  offers: Array<{
    id: string;
    opportunityId: string;
    propertyId: string;
    propertyTitle: string;
    amountGBP: number;
    status: FlipperOfferStatus;
    submittedAt: Date;
    respondedAt: Date | null;
    agentNotes: string | null;
  }>;
  acquisitions: Array<{
    id: string;
    offerId: string;
    propertyId: string;
    propertyTitle: string;
    agreedPriceGBP: number;
    status: FlipperAcquisitionStatus;
    createdAt: Date;
  }>;
};

export async function getFlipperWorkspace(
  caller: FlipperCaller,
): Promise<FlipperServiceResult<FlipperWorkspaceSummary>> {
  const guard = requireFlipperSubtype(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const [opps, offers, acquisitions] = await Promise.all([
    db.flipperOpportunity.findMany({
      where: { investorUserId: caller.userId },
      orderBy: { createdAt: "desc" },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            city: true,
            postcode: true,
            askingPriceGBP: true,
            propertyType: true,
            images: { take: 1, orderBy: { sortOrder: "asc" } },
          },
        },
      },
    }),
    db.flipperOffer.findMany({
      where: { investorUserId: caller.userId },
      orderBy: { submittedAt: "desc" },
      include: { property: { select: { title: true } } },
    }),
    db.flipperAcquisition.findMany({
      where: { investorUserId: caller.userId },
      orderBy: { createdAt: "desc" },
      include: { property: { select: { title: true } } },
    }),
  ]);

  return {
    ok: true,
    data: {
      isKycApproved: caller.kycStatus === KycStatus.APPROVED,
      opportunities: opps.map((o) => ({
        id: o.id,
        propertyId: o.propertyId,
        propertyTitle: o.property.title,
        city: o.property.city,
        postcode: o.property.postcode,
        askingPriceGBP: o.property.askingPriceGBP,
        propertyType: o.property.propertyType,
        imageUrl: o.property.images[0]?.url ?? null,
        status: o.status,
        createdAt: o.createdAt,
      })),
      offers: offers.map((off) => ({
        id: off.id,
        opportunityId: off.opportunityId,
        propertyId: off.propertyId,
        propertyTitle: off.property.title,
        amountGBP: off.amountGBP,
        status: off.status,
        submittedAt: off.submittedAt,
        respondedAt: off.respondedAt,
        agentNotes: off.agentNotes,
      })),
      acquisitions: acquisitions.map((acq) => ({
        id: acq.id,
        offerId: acq.offerId,
        propertyId: acq.propertyId,
        propertyTitle: acq.property.title,
        agreedPriceGBP: acq.agreedPriceGBP,
        status: acq.status,
        createdAt: acq.createdAt,
      })),
    },
  };
}

// ─── Submit Flipper Acquisition Offer ────────────────────────────────────────

export async function submitFlipperOffer(
  caller: FlipperCaller,
  input: SubmitFlipperOfferInput,
): Promise<FlipperServiceResult<{ offerId: string }>> {
  const guard = requireFlipperFinancialEligibility(caller);
  if (guard) return { ok: false, error: guard };

  const parse = submitFlipperOfferSchema.safeParse(input);
  if (!parse.success) {
    return {
      ok: false,
      error: parse.error.issues[0]?.message ?? "Invalid offer parameters",
    };
  }

  const { db } = await import("@/lib/db");

  const property = await db.property.findUnique({
    where: { id: input.propertyId },
    include: { agentProfile: true },
  });

  if (!property) return { ok: false, error: "Property not found" };
  if (
    property.status !== PropertyStatus.LIVE &&
    property.status !== PropertyStatus.UNDER_OFFER
  ) {
    return { ok: false, error: "Property is not available for acquisition offers" };
  }

  // Anti-Self Dealing Guard
  if (property.agentProfile && property.agentProfile.userId === caller.userId) {
    return {
      ok: false,
      error: "You cannot submit an acquisition offer on your own listing",
    };
  }

  // Prevent duplicate active SUBMITTED offer
  const existingActive = await db.flipperOffer.findFirst({
    where: {
      investorUserId: caller.userId,
      propertyId: input.propertyId,
      status: FlipperOfferStatus.SUBMITTED,
    },
  });

  if (existingActive) {
    return {
      ok: false,
      error:
        "You already have an active submitted offer on this property. Please wait for the agent to respond or withdraw your current offer.",
    };
  }

  // Upsert Opportunity first
  const opp = await db.flipperOpportunity.upsert({
    where: {
      investorUserId_propertyId: {
        investorUserId: caller.userId,
        propertyId: input.propertyId,
      },
    },
    update: { status: FlipperOpportunityStatus.OFFER_SUBMITTED },
    create: {
      investorUserId: caller.userId,
      propertyId: input.propertyId,
      status: FlipperOpportunityStatus.OFFER_SUBMITTED,
    },
  });

  // Create Offer
  const offer = await db.flipperOffer.create({
    data: {
      opportunityId: opp.id,
      investorUserId: caller.userId,
      propertyId: input.propertyId,
      amountGBP: input.amountGBP,
      status: FlipperOfferStatus.SUBMITTED,
    },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_OFFER_SUBMITTED",
        entity: "FlipperOffer",
        entityId: offer.id,
        metaJson: { propertyId: input.propertyId, amountGBP: input.amountGBP },
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { offerId: offer.id } };
}

// ─── Withdraw Flipper Offer ─────────────────────────────────────────────────

export async function withdrawFlipperOffer(
  caller: FlipperCaller,
  offerId: string,
): Promise<FlipperServiceResult<{ offerId: string }>> {
  const guard = requireFlipperSubtype(caller);
  if (guard) return { ok: false, error: guard };

  const { db } = await import("@/lib/db");

  const offer = await db.flipperOffer.findUnique({
    where: { id: offerId },
  });

  if (!offer) return { ok: false, error: "Offer not found" };
  if (offer.investorUserId !== caller.userId) {
    return { ok: false, error: "Forbidden: You do not own this offer" };
  }
  if (offer.status !== FlipperOfferStatus.SUBMITTED) {
    return { ok: false, error: "Only SUBMITTED offers can be withdrawn" };
  }

  const now = new Date();

  await db.$transaction([
    db.flipperOffer.update({
      where: { id: offerId },
      data: { status: FlipperOfferStatus.WITHDRAWN, updatedAt: now },
    }),
    db.flipperOpportunity.update({
      where: { id: offer.opportunityId },
      data: { status: FlipperOpportunityStatus.WITHDRAWN, updatedAt: now },
    }),
  ]);

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: caller.userId,
        action: "FLIPPER_OFFER_WITHDRAWN",
        entity: "FlipperOffer",
        entityId: offerId,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { offerId } };
}

// ─── Agent Accept Flipper Offer ──────────────────────────────────────────────

export async function acceptFlipperOffer(
  agentCaller: AgentCaller,
  offerId: string,
): Promise<FlipperServiceResult<{ acquisitionId: string }>> {
  if (!agentCaller.active || agentCaller.role !== Role.AGENT) {
    return { ok: false, error: "Only active Agent accounts can accept Flipper offers" };
  }

  const { db } = await import("@/lib/db");

  const offer = await db.flipperOffer.findUnique({
    where: { id: offerId },
    include: {
      property: {
        include: { agentProfile: true },
      },
    },
  });

  if (!offer) return { ok: false, error: "Offer not found" };

  // Agent Ownership Guard
  if (
    !offer.property.agentProfile ||
    offer.property.agentProfile.userId !== agentCaller.userId
  ) {
    return {
      ok: false,
      error: "Forbidden: Agent A cannot manage offers for Agent B's listing",
    };
  }

  if (offer.status !== FlipperOfferStatus.SUBMITTED) {
    return { ok: false, error: "Offer is no longer pending decision" };
  }

  const now = new Date();

  // Race-safe atomic update
  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperOffer"
    SET "status" = 'ACCEPTED'::"FlipperOfferStatus",
        "respondedAt" = ${now},
        "updatedAt" = ${now}
    WHERE "id" = ${offerId}
      AND "status" = 'SUBMITTED'::"FlipperOfferStatus"
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error: "Offer is no longer pending decision (race condition or already decided)",
    };
  }

  // Transaction: Update opportunity + Create FlipperAcquisition
  const [, acq] = await db.$transaction([
    db.flipperOpportunity.update({
      where: { id: offer.opportunityId },
      data: { status: FlipperOpportunityStatus.OFFER_ACCEPTED, updatedAt: now },
    }),
    db.flipperAcquisition.create({
      data: {
        offerId: offer.id,
        opportunityId: offer.opportunityId,
        investorUserId: offer.investorUserId,
        propertyId: offer.propertyId,
        agreedPriceGBP: offer.amountGBP,
        status: FlipperAcquisitionStatus.PENDING_COMPLETION,
      },
    }),
  ]);

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: agentCaller.userId,
        action: "FLIPPER_OFFER_ACCEPTED",
        entity: "FlipperOffer",
        entityId: offerId,
        metaJson: { acquisitionId: acq.id, agreedPriceGBP: offer.amountGBP },
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { acquisitionId: acq.id } };
}

// ─── Agent Reject Flipper Offer ──────────────────────────────────────────────

export async function rejectFlipperOffer(
  agentCaller: AgentCaller,
  offerId: string,
  agentNotes?: string,
): Promise<FlipperServiceResult<{ offerId: string }>> {
  if (!agentCaller.active || agentCaller.role !== Role.AGENT) {
    return { ok: false, error: "Only active Agent accounts can reject Flipper offers" };
  }

  const { db } = await import("@/lib/db");

  const offer = await db.flipperOffer.findUnique({
    where: { id: offerId },
    include: {
      property: {
        include: { agentProfile: true },
      },
    },
  });

  if (!offer) return { ok: false, error: "Offer not found" };

  if (
    !offer.property.agentProfile ||
    offer.property.agentProfile.userId !== agentCaller.userId
  ) {
    return {
      ok: false,
      error: "Forbidden: Agent A cannot manage offers for Agent B's listing",
    };
  }

  if (offer.status !== FlipperOfferStatus.SUBMITTED) {
    return { ok: false, error: "Offer is no longer pending decision" };
  }

  const now = new Date();

  const updatedCount = await db.$executeRaw`
    UPDATE public."FlipperOffer"
    SET "status" = 'REJECTED'::"FlipperOfferStatus",
        "respondedAt" = ${now},
        "agentNotes" = ${agentNotes ?? null},
        "updatedAt" = ${now}
    WHERE "id" = ${offerId}
      AND "status" = 'SUBMITTED'::"FlipperOfferStatus"
  `;

  if (updatedCount === 0) {
    return {
      ok: false,
      error: "Offer is no longer pending decision (race condition or already decided)",
    };
  }

  await db.flipperOpportunity.update({
    where: { id: offer.opportunityId },
    data: { status: FlipperOpportunityStatus.DECLINED, updatedAt: now },
  });

  // Audit
  try {
    await db.auditLog.create({
      data: {
        actorUserId: agentCaller.userId,
        action: "FLIPPER_OFFER_REJECTED",
        entity: "FlipperOffer",
        entityId: offerId,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }

  return { ok: true, data: { offerId } };
}

// ─── Agent Offer Queue for Agent's Properties ───────────────────────────────

export type AgentFlipperOfferListItem = {
  id: string;
  propertyId: string;
  propertyTitle: string;
  investorName: string;
  investorEmail: string;
  amountGBP: number;
  status: FlipperOfferStatus;
  submittedAt: Date;
  respondedAt: Date | null;
  agentNotes: string | null;
};

export async function getAgentFlipperOffers(
  agentCaller: AgentCaller,
): Promise<FlipperServiceResult<AgentFlipperOfferListItem[]>> {
  if (!agentCaller.active || agentCaller.role !== Role.AGENT) {
    return {
      ok: false,
      error: "Only active Agent accounts can access agent Flipper offers",
    };
  }

  const { db } = await import("@/lib/db");

  const offers = await db.flipperOffer.findMany({
    where: {
      property: {
        agentProfile: {
          userId: agentCaller.userId,
        },
      },
    },
    orderBy: { submittedAt: "desc" },
    include: {
      property: { select: { id: true, title: true } },
      investor: { select: { name: true, email: true } },
    },
  });

  return {
    ok: true,
    data: offers.map((off) => ({
      id: off.id,
      propertyId: off.propertyId,
      propertyTitle: off.property.title,
      investorName: off.investor.name,
      investorEmail: off.investor.email,
      amountGBP: off.amountGBP,
      status: off.status,
      submittedAt: off.submittedAt,
      respondedAt: off.respondedAt,
      agentNotes: off.agentNotes,
    })),
  };
}
