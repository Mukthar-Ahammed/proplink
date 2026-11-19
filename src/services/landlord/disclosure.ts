import "server-only";

import { z } from "zod";

import { LandlordListingFileKind, MandateStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import type { ServiceResult } from "@/services/landlord/listings";
import {
  isVerifiedAgent,
  postcodeDistrict,
  proposalActionLimits,
  UNVERIFIED_AGENT_MESSAGE,
  type AgentActor,
} from "@/services/landlord/marketplace";

/**
 * Landlord data exposure control (Phase 2 Task 7, ADR-040; TRD AG-7). The
 * Agent on the active mandate chooses which Landlord data investors will see
 * when the property is published (Phase 4). Landlord personal details are
 * hidden by default. Some data is never exposable whatever the setting: the
 * Landlord's contact details, ownership documents, and the listing title the
 * Landlord wrote (the Agent writes the investor-facing title in Phase 4).
 */

export const DISCLOSURE_FIELDS = [
  { key: "showLandlordName", label: "Landlord's name", personal: true },
  { key: "showStreetAddress", label: "Street address", personal: true },
  {
    key: "showFullPostcode",
    label: "Full postcode (district is always shown)",
    personal: true,
  },
  { key: "showDescription", label: "Description", personal: false },
  { key: "showDefects", label: "Known defects", personal: false },
  { key: "showRequiredWork", label: "Work required", personal: false },
  { key: "showPhotos", label: "Photos", personal: false },
  {
    key: "showOtherDocuments",
    label: "Other documents (surveys, plans)",
    personal: false,
  },
] as const;

export type DisclosureKey = (typeof DISCLOSURE_FIELDS)[number]["key"];
export type Disclosure = Record<DisclosureKey, boolean>;

/** AG-7: personal details hidden by default. */
export const DISCLOSURE_DEFAULTS: Disclosure = {
  showLandlordName: false,
  showStreetAddress: false,
  showFullPostcode: false,
  showDescription: true,
  showDefects: true,
  showRequiredWork: true,
  showPhotos: true,
  showOtherDocuments: false,
};

export type DisclosableListing = {
  city: string | null;
  postcode: string | null;
  addressLine1: string | null;
  propertyKind: string | null;
  propertyType: string | null;
  landAreaSqm: number | null;
  desiredOutcome: string | null;
  description: string | null;
  defects: string | null;
  requiredWork: string | null;
  landlordName: string | null;
  files: { fileId: string; kind: LandlordListingFileKind | string }[];
};

/**
 * The redacted listing investors may see. Pure: Phase 4 publishing builds its
 * investor page from this, never from the raw listing.
 */
export function buildInvestorView(listing: DisclosableListing, disclosure: Disclosure) {
  return {
    city: listing.city,
    postcodeDistrict: postcodeDistrict(listing.postcode),
    postcode: disclosure.showFullPostcode ? listing.postcode : null,
    addressLine1: disclosure.showStreetAddress ? listing.addressLine1 : null,
    landlordName: disclosure.showLandlordName ? listing.landlordName : null,
    propertyKind: listing.propertyKind,
    propertyType: listing.propertyType,
    landAreaSqm: listing.landAreaSqm,
    desiredOutcome: listing.desiredOutcome,
    description: disclosure.showDescription ? listing.description : null,
    defects: disclosure.showDefects ? listing.defects : null,
    requiredWork: disclosure.showRequiredWork ? listing.requiredWork : null,
    photoFileIds: disclosure.showPhotos
      ? listing.files
          .filter((file) => file.kind === LandlordListingFileKind.PHOTO)
          .map((file) => file.fileId)
      : [],
    // Ownership documents are never exposable.
    documentFileIds: disclosure.showOtherDocuments
      ? listing.files
          .filter((file) => file.kind === LandlordListingFileKind.DOCUMENT)
          .map((file) => file.fileId)
      : [],
  };
}

const selectFlags = Object.fromEntries(
  DISCLOSURE_FIELDS.map((field) => [field.key, true]),
) as Record<DisclosureKey, true>;

/** The stored choice for a mandate, or the safe defaults. */
export async function disclosureFor(mandateId: string): Promise<Disclosure> {
  const stored = await db.mandateDisclosure.findUnique({
    where: { mandateId },
    select: selectFlags,
  });
  return stored ?? { ...DISCLOSURE_DEFAULTS };
}

/** Checkbox values: true, "on" or "true" means shown; anything else (or absent) hidden. */
export function parseDisclosure(raw: Record<string, unknown>): Disclosure {
  const shown = (value: unknown) => value === true || value === "on" || value === "true";
  return Object.fromEntries(
    DISCLOSURE_FIELDS.map((field) => [field.key, shown(raw[field.key])]),
  ) as Disclosure;
}

export async function updateDisclosure(
  agent: AgentActor,
  mandateId: string,
  raw: Record<string, unknown>,
): Promise<ServiceResult> {
  if (
    !(await consumeRateLimits("proposal_action", proposalActionLimits(agent.profileId)))
  ) {
    return { ok: false, error: "Too many actions; wait a minute", status: 429 };
  }
  if (!(await isVerifiedAgent(agent))) {
    return { ok: false, error: UNVERIFIED_AGENT_MESSAGE, status: 403 };
  }
  if (!z.uuid().safeParse(mandateId).success) {
    return { ok: false, error: "Mandate not found", status: 404 };
  }
  const mandate = await db.mandate.findFirst({
    where: { id: mandateId, agentId: agent.profileId, status: MandateStatus.ACTIVE },
    select: { id: true },
  });
  if (!mandate) {
    return {
      ok: false,
      error: "Only an active mandate's agent can change this",
      status: 409,
    };
  }
  const next = parseDisclosure(raw);
  const before = await disclosureFor(mandateId);
  await db.mandateDisclosure.upsert({
    where: { mandateId },
    create: { mandateId, ...next, updatedBy: agent.profileId },
    update: { ...next, updatedBy: agent.profileId },
  });
  const changed = DISCLOSURE_FIELDS.filter(
    (field) => before[field.key] !== next[field.key],
  ).map((field) => field.key);
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "MANDATE_DISCLOSURE_UPDATED",
    entity: "Mandate",
    entityId: mandateId,
    meta: { changed, after: next },
  });
  return { ok: true };
}
