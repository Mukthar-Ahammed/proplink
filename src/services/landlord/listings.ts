import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  KycStatus,
  LandlordDesiredOutcome,
  LandlordListingFileKind,
  LandlordListingStatus,
  MandateStatus,
  LandlordPropertyKind,
  Role,
  UploadStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";

/**
 * Landlord listings (Phase 2 Task 1, ADR-034).
 *
 * Business rules: TRD LL-1 fields; Q5 drafts, editing, AI help (Task 2),
 * genuine listings backed by valid ownership documents; journey "Complete
 * KYC → create the listing → save as draft → Admin reviews in 30-60 minutes"
 * (Q6, Task 3); TRD matrix: Admin may create on a Landlord's behalf, the
 * Landlord confirms. Withdrawal while no mandate exists is OD-22.
 *
 * Every read and write is scoped by the listing's owner (no IDOR). Listings
 * are 100% private (TRD LL-2): nothing here is exposed publicly.
 */

export type LandlordActor = {
  profileId: string;
  legacyUserId: string;
  role: Role;
  kycStatus: KycStatus;
};
export type AdminActor = { profileId: string; legacyUserId: string };

export type ServiceResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string; status: number };

/** States in which the Landlord (or, before confirmation, an Admin) may edit. */
export const EDITABLE: readonly LandlordListingStatus[] = [
  LandlordListingStatus.DRAFT,
  LandlordListingStatus.REJECTED,
  LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION,
];
/** States from which a Landlord may withdraw (OD-22; mandates block it from Task 6). */
export const WITHDRAWABLE: readonly LandlordListingStatus[] = [
  LandlordListingStatus.SUBMITTED,
  LandlordListingStatus.APPROVED,
  LandlordListingStatus.REJECTED,
];

const clean = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) =>
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").trim(),
    )
    .pipe(z.string().max(max, `Keep it under ${max} characters`))
    .transform((value) => (value.length > 0 ? value : null));

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

export const listingFieldsSchema = z
  .object({
    title: z
      .string()
      .transform((v) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
      .pipe(z.string().min(3, "Give the listing a short title").max(120)),
    addressLine1: clean(200).optional(),
    city: clean(100).optional(),
    postcode: z
      .string()
      .max(20)
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => v === "" || POSTCODE.test(v), "Enter a valid UK postcode")
      .transform((v) => (v ? v : null))
      .optional(),
    propertyKind: z
      .enum([LandlordPropertyKind.PROPERTY, LandlordPropertyKind.LAND])
      .nullish(),
    propertyType: clean(60).optional(),
    description: clean(5000).optional(),
    defects: clean(3000).optional(),
    requiredWork: clean(3000).optional(),
    landAreaSqm: z.coerce
      .number()
      .int("Use whole square metres")
      .min(1)
      .max(100_000_000)
      .nullish(),
    desiredOutcome: z
      .enum([LandlordDesiredOutcome.REFURBISHMENT, LandlordDesiredOutcome.DEVELOPMENT_JV])
      .nullish(),
  })
  .strict();

export type ListingFields = z.infer<typeof listingFieldsSchema>;

function bad(error: string, status = 400) {
  return { ok: false as const, error, status };
}

function parseFields(raw: unknown) {
  const parsed = listingFieldsSchema.safeParse(raw);
  return parsed.success
    ? { ok: true as const, data: parsed.data }
    : bad(parsed.error.issues[0]?.message ?? "Check the form");
}

// ── Landlord: create, edit, files ─────────────────────────────────────────

export async function createDraft(
  actor: LandlordActor,
  raw: unknown,
): Promise<ServiceResult<{ id: string }>> {
  if (actor.role !== Role.LANDLORD) return bad("Only Landlords create listings", 403);
  const fields = parseFields(raw);
  if (!fields.ok) return fields;
  const id = randomUUID();
  await db.landlordListing.create({
    data: { id, ownerId: actor.profileId, createdBy: actor.profileId, ...fields.data },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "LANDLORD_LISTING_CREATED",
    entity: "LandlordListing",
    entityId: id,
  });
  return { ok: true, data: { id } };
}

/** The Landlord's own listing, or nothing (same answer for "not yours"). */
export async function getOwnListing(ownerId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return db.landlordListing.findFirst({
    where: { id, ownerId },
    include: { files: { orderBy: { createdAt: "asc" } } },
  });
}

export async function listOwnListings(ownerId: string) {
  return db.landlordListing.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      city: true,
      submittedAt: true,
      updatedAt: true,
      rejectionReason: true,
      createdBy: true,
    },
  });
}

export async function updateOwnListing(
  actor: LandlordActor,
  id: string,
  raw: unknown,
): Promise<ServiceResult> {
  const fields = parseFields(raw);
  if (!fields.ok) return fields;
  const result = await db.landlordListing.updateMany({
    where: { id, ownerId: actor.profileId, status: { in: [...EDITABLE] } },
    data: fields.data,
  });
  if (result.count === 0) return bad("This listing can't be edited now", 409);
  return { ok: true };
}

export async function attachFile(
  actor: { profileId: string },
  listingId: string,
  fileId: string,
  kind: LandlordListingFileKind,
  scope: { ownerId?: string } = {},
): Promise<ServiceResult> {
  if (!z.uuid().safeParse(fileId).success || !z.uuid().safeParse(listingId).success) {
    return bad("File not found", 404);
  }
  if (!Object.values(LandlordListingFileKind).includes(kind))
    return bad("Unknown file kind");
  const listing = await db.landlordListing.findFirst({
    where: { id: listingId, ...(scope.ownerId ? { ownerId: scope.ownerId } : {}) },
    select: { status: true, ownerId: true, createdBy: true },
  });
  if (!listing) return bad("Listing not found", 404);
  if (!EDITABLE.includes(listing.status))
    return bad("This listing can't be edited now", 409);
  const file = await db.uploadedFile.findUnique({
    where: { id: fileId },
    select: { ownerId: true, status: true, previewable: true },
  });
  if (
    !file ||
    file.ownerId !== actor.profileId ||
    file.status !== UploadStatus.AVAILABLE ||
    ![listing.ownerId, listing.createdBy].includes(file.ownerId)
  ) {
    return bad("Upload the file first", 404);
  }
  if (kind === LandlordListingFileKind.PHOTO && !file.previewable) {
    return bad("Photos must be JPEG, PNG or WebP images");
  }
  await db.landlordListingFile.upsert({
    where: { listingId_fileId: { listingId, fileId } },
    create: { listingId, fileId, kind },
    update: { kind },
  });
  return { ok: true };
}

export async function detachOwnFile(
  actor: LandlordActor,
  listingId: string,
  fileId: string,
): Promise<ServiceResult> {
  const listing = await getOwnListing(actor.profileId, listingId);
  if (!listing) return bad("Listing not found", 404);
  if (!EDITABLE.includes(listing.status))
    return bad("This listing can't be edited now", 409);
  await db.landlordListingFile.deleteMany({ where: { listingId, fileId } });
  return { ok: true };
}

/** What is still needed before submission (shown to the Landlord as a checklist). */
export function missingForSubmission(
  listing: {
    title: string;
    addressLine1: string | null;
    city: string | null;
    postcode: string | null;
    propertyKind: LandlordPropertyKind | null;
    description: string | null;
    requiredWork: string | null;
    landAreaSqm: number | null;
    desiredOutcome: LandlordDesiredOutcome | null;
  },
  files: { kind: LandlordListingFileKind }[],
): string[] {
  const missing: string[] = [];
  if (!listing.addressLine1 || !listing.city || !listing.postcode)
    missing.push("Full address");
  if (!listing.propertyKind) missing.push("Property or land");
  if (!listing.description) missing.push("Description");
  if (!listing.requiredWork) missing.push("Work required");
  if (!listing.desiredOutcome) missing.push("Desired outcome");
  if (listing.propertyKind === LandlordPropertyKind.LAND && !listing.landAreaSqm) {
    missing.push("Land area");
  }
  if (!files.some((f) => f.kind === LandlordListingFileKind.OWNERSHIP_DOCUMENT)) {
    missing.push("Ownership document (title deeds or Land Registry title)");
  }
  return missing;
}

export const KYC_REQUIRED_MESSAGE =
  "Verify your identity before submitting a listing. It only takes a few minutes.";

/**
 * Sends the listing to the Admin review queue. Requires approved KYC
 * (journey: "Complete KYC") and a complete listing with an ownership
 * document (Q5). For an Admin-created listing this is the Landlord's
 * confirmation (TRD matrix).
 */
export async function submitOwnListing(
  actor: LandlordActor,
  id: string,
): Promise<ServiceResult> {
  if (actor.kycStatus !== KycStatus.APPROVED) return bad(KYC_REQUIRED_MESSAGE, 403);
  const listing = await getOwnListing(actor.profileId, id);
  if (!listing) return bad("Listing not found", 404);
  if (!EDITABLE.includes(listing.status))
    return bad("This listing is already submitted", 409);
  const missing = missingForSubmission(listing, listing.files);
  if (missing.length > 0) return bad(`Still needed: ${missing.join(", ")}`);

  const wasOnBehalf =
    listing.status === LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION;
  const result = await db.landlordListing.updateMany({
    where: { id, ownerId: actor.profileId, status: listing.status },
    data: {
      status: LandlordListingStatus.SUBMITTED,
      submittedAt: new Date(),
      rejectionReason: null,
    },
  });
  if (result.count === 0) return bad("This listing changed; reload and try again", 409);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: wasOnBehalf ? "LANDLORD_LISTING_CONFIRMED" : "LANDLORD_LISTING_SUBMITTED",
    entity: "LandlordListing",
    entityId: id,
    meta: { resubmission: listing.status === LandlordListingStatus.REJECTED },
  });
  return { ok: true };
}

/** OD-22: withdraw while no mandate exists. History is kept; no hard delete. */
export async function withdrawOwnListing(
  actor: LandlordActor,
  id: string,
): Promise<ServiceResult> {
  const result = await db.landlordListing.updateMany({
    where: {
      id,
      ownerId: actor.profileId,
      status: { in: [...WITHDRAWABLE] },
      // OD-22: never while a mandate is offered or active (also a database trigger).
      mandates: {
        none: { status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] } },
      },
    },
    data: { status: LandlordListingStatus.WITHDRAWN, withdrawnAt: new Date() },
  });
  if (result.count === 0) return bad("This listing can't be withdrawn now", 409);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "LANDLORD_LISTING_WITHDRAWN",
    entity: "LandlordListing",
    entityId: id,
  });
  return { ok: true };
}

/** Drafts that were never submitted may be deleted by the Landlord who wrote them. */
export async function deleteOwnDraft(
  actor: LandlordActor,
  id: string,
): Promise<ServiceResult> {
  const result = await db.landlordListing.deleteMany({
    where: {
      id,
      ownerId: actor.profileId,
      createdBy: actor.profileId,
      status: LandlordListingStatus.DRAFT,
      submittedAt: null,
    },
  });
  if (result.count === 0) return bad("Only unsubmitted drafts can be deleted", 409);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "LANDLORD_LISTING_DRAFT_DELETED",
    entity: "LandlordListing",
    entityId: id,
  });
  return { ok: true };
}

// ── Admin on a Landlord's behalf (TRD matrix) ─────────────────────────────

const onBehalfSchema = z
  .object({ landlordEmail: z.email().max(320), fields: z.unknown() })
  .strict();

/**
 * Admin creates a listing owned by a Landlord. It waits for the Landlord's
 * confirmation (their own submission, which also requires their KYC).
 */
export async function createOnBehalf(
  actor: AdminActor,
  raw: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = onBehalfSchema.safeParse(raw);
  if (!parsed.success) return bad("Enter the Landlord's email");
  const fields = parseFields(parsed.data.fields);
  if (!fields.ok) return fields;
  const landlord = await db.profile.findFirst({
    where: {
      role: Role.LANDLORD,
      active: true,
      legacyUser: { email: parsed.data.landlordEmail.trim().toLowerCase() },
    },
    select: { id: true },
  });
  if (!landlord) return bad("No active Landlord account has that email", 404);
  const id = randomUUID();
  await db.landlordListing.create({
    data: {
      id,
      ownerId: landlord.id,
      createdBy: actor.profileId,
      status: LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION,
      ...fields.data,
    },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "LANDLORD_LISTING_CREATED_ON_BEHALF",
    entity: "LandlordListing",
    entityId: id,
    meta: { landlordProfileId: landlord.id },
  });
  return { ok: true, data: { id } };
}
