import "server-only";

import { z } from "zod";

import {
  EpcRating,
  InvestorProjectStatus,
  ListingSource,
  PropertyStatus,
  PropertyType,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import type { ServiceResult } from "@/services/landlord/listings";
import { poundsToPence } from "@/services/landlord/marketplace";
import { transitionStatus } from "@/services/listings/listingService";
import { geocodePostcode } from "@/services/maps";
import { bad, databaseRule, type Actor } from "@/services/projects/common";
import { recordSale } from "@/services/projects/settlement";
import { projectRelation } from "@/services/projects/works";

/**
 * Re-listing a completed project for sale and marking it sold (Phase 5
 * Tasks 1 and 1a, ADR-052; TRD AG-5, acceptance criterion 5). The project's
 * Agent re-lists it as an ordinary retail listing of their agency (address
 * from the source listing, now a public sale), which goes to Admin review
 * like every listing and is linked to the project so its history is kept.
 * The project moves to "Listed for sale". When it sells, the Agent marks it
 * sold with the price: the Phase 4 sale record is created (net profit from
 * the itemised costs) and the listing becomes SOLD; the Solicitor then
 * confirms and settles (ADR-050).
 */

const relistSchema = z.object({
  title: z.string().trim().min(5, "Title: at least 5 characters").max(120),
  description: z.string().trim().min(20, "Description: at least 20 characters").max(5000),
  askingPrice: z.unknown().transform((raw, ctx): bigint => {
    const pence = poundsToPence(raw);
    if (pence === null || pence <= BigInt(0)) {
      ctx.addIssue({ code: "custom", message: "Asking price: enter pounds" });
      return z.NEVER;
    }
    return pence;
  }),
  bedrooms: z.coerce.number().int().min(0).max(50),
  propertyType: z.enum(PropertyType, { error: "Choose a property type" }),
  epcRating: z.enum(EpcRating, { error: "Choose the EPC rating" }),
  region: z.string().trim().min(2, "Region is required").max(80),
  pricingSafeguardAck: z.literal(true, {
    error:
      "Confirm the pricing safeguard (the seller has been told the price may change)",
  }),
});

const MAX_RETAIL_PENCE = BigInt(2_147_483_647); // the legacy Property column is a 32-bit integer

export async function relistProject(
  agent: Actor,
  projectId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ propertyId: string }>> {
  // The project's Agent, or an Admin on their behalf (TRD matrix: "Admin:
  // audited"). The listing always belongs to the project's Agent's agency.
  if (agent.role !== Role.AGENT && agent.role !== Role.ADMIN) {
    return bad("Only the project's Agent or an Admin lists it for sale", 403);
  }
  const relation = await projectRelation(agent, projectId);
  if (relation !== "AGENT" && relation !== "ADMIN") return bad("Project not found", 404);
  const parsed = relistSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the listing");
  const input = parsed.data;
  if (input.askingPrice > MAX_RETAIL_PENCE) return bad("Asking price is too large");
  const project = await db.investorProject.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      status: true,
      agentId: true,
      agent: { select: { legacyUserId: true } },
      retailListing: { select: { propertyId: true } },
      listing: { select: { addressLine1: true, city: true, postcode: true } },
    },
  });
  if (project.retailListing) return bad("This project is already listed for sale", 409);
  if (
    project.status !== InvestorProjectStatus.COMPLETED &&
    project.status !== InvestorProjectStatus.LISTED_FOR_SALE
  ) {
    return bad("A project is re-listed once its works are complete", 409);
  }
  const { addressLine1, city, postcode } = project.listing;
  if (!addressLine1 || !city || !postcode) {
    return bad("The source listing has no full address to list", 409);
  }
  const agentUserId = project.agent.legacyUserId;
  if (!agentUserId) return bad("The project's Agent has no agency profile", 409);
  const agency = await db.agentProfile.findFirst({
    where: { userId: agentUserId, active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!agency) {
    return bad(
      relation === "ADMIN"
        ? "The project's Agent has no active agency profile"
        : "Set up your agency profile before listing",
      409,
    );
  }

  let propertyId = "";
  try {
    await db.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          agentProfileId: agency.id,
          listingSource: ListingSource.INVESTOR_PROJECT,
          title: input.title,
          description: input.description,
          addressLine1,
          city,
          region: input.region,
          postcode,
          propertyType: input.propertyType,
          bedrooms: input.bedrooms,
          askingPriceGBP: Number(input.askingPrice),
          epcRating: input.epcRating,
          pricingSafeguardAckAt: now,
          // Straight to Admin review: re-listed projects go live only once approved.
          status: PropertyStatus.PENDING_REVIEW,
          submittedAt: now,
        },
        select: { id: true },
      });
      propertyId = property.id;
      await tx.projectRetailListing.create({
        data: { projectId, propertyId, createdBy: project.agentId },
      });
      if (project.status === InvestorProjectStatus.COMPLETED) {
        await tx.investorProject.update({
          where: { id: projectId },
          data: { status: InvestorProjectStatus.LISTED_FOR_SALE },
        });
      }
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(`The project can't be listed: ${rule.message}`, 409);
    throw error;
  }
  try {
    const geo = await geocodePostcode(postcode);
    await db.$executeRaw`
      UPDATE "Property" SET "location" = ST_SetSRID(ST_MakePoint(${geo.lng}, ${geo.lat}), 4326)
      WHERE "id" = ${propertyId}
    `;
  } catch {
    // The map pin is optional; the listing still goes to review.
  }
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_RELISTED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: {
      propertyId,
      ...(relation === "ADMIN" ? { onBehalfOfAgent: project.agentId } : {}),
    },
  });
  return { ok: true, data: { propertyId } };
}

/**
 * The Agent marks the re-listed property sold with the final price: the sale
 * record is created (the Solicitor confirms and settles next) and the listing
 * becomes SOLD (through Under offer, as the listing state machine requires).
 */
export async function markProjectSold(
  agent: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult<{ saleId: string }>> {
  if ((await projectRelation(agent, projectId)) !== "AGENT")
    return bad("Project not found", 404);
  const link = await db.projectRetailListing.findUnique({
    where: { projectId },
    select: { propertyId: true, property: { select: { status: true } } },
  });
  if (!link) return bad("Re-list the project before marking it sold", 409);
  const status = link.property.status;
  if (status !== PropertyStatus.LIVE && status !== PropertyStatus.UNDER_OFFER) {
    return bad("Only a live listing can be marked sold (Admin approves it first)", 409);
  }
  const sale = await recordSale(agent, projectId, raw);
  if (!sale.ok) return sale;
  if (status === PropertyStatus.LIVE) {
    await transitionStatus({
      actorUserId: agent.legacyUserId,
      actorRole: Role.AGENT,
      propertyId: link.propertyId,
      to: PropertyStatus.UNDER_OFFER,
    });
  }
  await transitionStatus({
    actorUserId: agent.legacyUserId,
    actorRole: Role.AGENT,
    propertyId: link.propertyId,
    to: PropertyStatus.SOLD,
  });
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_PROPERTY_SOLD",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { propertyId: link.propertyId, saleId: sale.data.saleId },
  });
  return sale;
}

/** The project's retail listing, for its pages. */
export async function retailListingFor(projectId: string) {
  return db.projectRetailListing.findUnique({
    where: { projectId },
    select: {
      propertyId: true,
      property: {
        select: {
          status: true,
          askingPriceGBP: true,
          title: true,
          rejectionReason: true,
        },
      },
    },
  });
}
