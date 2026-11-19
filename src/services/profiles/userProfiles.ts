import "server-only";

import { randomInt } from "node:crypto";
import { z } from "zod";

import { ProfileVisibility, Role, UploadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  historicalRoiVisible,
  trackRecord,
  type TrackRecordItem,
} from "@/services/profiles/trackRecord";

/**
 * LinkedIn-style profiles (Phase 1 Task 8, ADR-032; business Q4, TRD §5).
 *
 * Who sees what:
 * - Self and Admin: everything.
 * - Investors: PRIVATE (default) is hidden from everyone else except the
 *   project's Agent working under the Solicitor (`isProjectAgentFor`, which
 *   Phase 4 implements; until projects exist it is always false). PUBLIC shows
 *   only the anonymous platform ID, badge and general metrics. Co-Investors
 *   never see a private profile.
 * - Everyone else: public profile (name or company, photo, bio, location,
 *   specialisms, experience, badge, computed track record).
 * Email and phone are never part of any profile view.
 */

export type Viewer = { profileId: string; role: Role } | null;

const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generatePublicId(): string {
  let id = "PL-";
  for (let i = 0; i < 8; i += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

/**
 * Creates the profile record on first use. Investors start PRIVATE (Q4);
 * everyone else starts MEMBERS, "platform members only" (TRD PR-3, owner
 * choice 2026-11-18).
 */
export async function ensureUserProfile(profileId: string, role: Role) {
  const existing = await db.userProfile.findUnique({ where: { profileId } });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.userProfile.create({
        data: {
          profileId,
          publicId: generatePublicId(),
          visibility:
            role === Role.INVESTOR
              ? ProfileVisibility.PRIVATE
              : ProfileVisibility.MEMBERS,
        },
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
      const raced = await db.userProfile.findUnique({ where: { profileId } });
      if (raced) return raced;
    }
  }
  throw new Error("Could not allocate a profile ID");
}

/**
 * Whether `agentProfileId` is the Agent on a project this investor is part
 * of (Lead, nominee, interested or pledged). Such an
 * Agent sees the investor's full profile (Q4).
 */
export async function isProjectAgentFor(
  agentProfileId: string,
  investorProfileId: string,
): Promise<boolean> {
  const project = await db.investorProject.findFirst({
    where: {
      agentId: agentProfileId,
      OR: [
        { leadInvestorId: investorProfileId },
        { interests: { some: { investorId: investorProfileId, withdrawnAt: null } } },
        { nominations: { some: { investorId: investorProfileId } } },
        { pledges: { some: { investorId: investorProfileId } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(project);
}

// Track record moved to its own service in Phase 5 Task 5 (ADR-055).
export {
  NO_PROJECTS_YET,
  NOT_ENOUGH_DATA,
  trackRecord,
  type TrackRecordItem,
} from "@/services/profiles/trackRecord";

export type ProfileView =
  | {
      kind: "full" | "public";
      publicId: string;
      /** Server-side only: the reviews section looks reviews up by it. */
      profileId: string;
      role: Role;
      name: string;
      headline: string | null;
      bio: string | null;
      location: string | null;
      specialisms: string[];
      experience: string | null;
      photoFileId: string | null;
      verified: boolean;
      trackRecord: TrackRecordItem[];
      visibility: ProfileVisibility;
    }
  | {
      kind: "anonymous";
      publicId: string;
      profileId: string;
      role: Role;
      verified: boolean;
      trackRecord: TrackRecordItem[];
    }
  | {
      /** A members-only profile seen by a signed-out visitor: nothing else. */
      kind: "members_only";
      publicId: string;
    };

/** The one place profile visibility is decided. Null means "not found". */
export async function viewProfile(
  viewer: Viewer,
  publicId: string,
): Promise<ProfileView | null> {
  if (!/^PL-[0-9A-HJKMNP-TV-Z]{8}$/.test(publicId)) return null;
  const row = await db.userProfile.findUnique({
    where: { publicId },
    include: {
      profile: {
        select: {
          id: true,
          role: true,
          name: true,
          active: true,
          createdAt: true,
          legacyUserId: true,
          verificationBadge: { select: { profileId: true } },
        },
      },
    },
  });
  const target = row?.profile;
  if (!row || !target || !target.active || target.role === Role.ADMIN) return null;

  const isSelf = viewer?.profileId === target.id;
  const isAdmin = viewer?.role === Role.ADMIN;
  const isInvestor = target.role === Role.INVESTOR;
  const projectAgent =
    isInvestor && viewer?.role === Role.AGENT
      ? await isProjectAgentFor(viewer.profileId, target.id)
      : false;
  const full = isSelf || isAdmin || projectAgent;

  if (isInvestor && !full) {
    if (row.visibility === ProfileVisibility.PRIVATE) return null;
    return {
      kind: "anonymous",
      publicId: row.publicId,
      profileId: target.id,
      role: target.role,
      verified: Boolean(target.verificationBadge),
      trackRecord: await trackRecord(target, {
        includeRoi: await historicalRoiVisible(),
      }),
    };
  }

  if (!full && !viewer && row.visibility === ProfileVisibility.MEMBERS) {
    return { kind: "members_only", publicId: row.publicId };
  }

  return {
    kind: full ? "full" : "public",
    publicId: row.publicId,
    profileId: target.id,
    role: target.role,
    name: target.name ?? "PropLink member",
    headline: row.headline,
    bio: row.bio,
    location: row.location,
    specialisms: row.specialisms,
    experience: row.experience,
    photoFileId: row.photoFileId,
    verified: Boolean(target.verificationBadge),
    trackRecord: await trackRecord(target, { includeRoi: await historicalRoiVisible() }),
    visibility: row.visibility,
  };
}

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) =>
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, "").trim(),
    )
    .pipe(z.string().max(max, `Keep it under ${max} characters`))
    .transform((value) => (value.length > 0 ? value : null));

const updateSchema = z
  .object({
    headline: text(120),
    bio: text(2000),
    location: text(100),
    experience: text(2000),
    specialisms: z
      .string()
      .max(1000)
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.replace(/[\u0000-\u001f\u007f]+/g, "").trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(z.string().max(40, "Keep each specialism under 40 characters"))
          .max(10, "Choose up to 10 specialisms"),
      ),
    visibility: z
      .enum([
        ProfileVisibility.PUBLIC,
        ProfileVisibility.PRIVATE,
        ProfileVisibility.MEMBERS,
      ])
      .optional(),
    photoFileId: z.uuid().nullable().optional(),
  })
  .strict();

export type UpdateProfileResult = { ok: true } | { ok: false; error: string };

/** The signed-in user edits their own profile. Track record is not editable. */
export async function updateOwnProfile(
  actor: { profileId: string; role: Role },
  raw: unknown,
): Promise<UpdateProfileResult> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  }
  const { visibility, photoFileId, ...fields } = parsed.data;
  if (visibility === ProfileVisibility.PRIVATE && actor.role !== Role.INVESTOR) {
    return { ok: false, error: "Only investor profiles can be private" };
  }
  if (visibility === ProfileVisibility.MEMBERS && actor.role === Role.INVESTOR) {
    return { ok: false, error: "Investor profiles are private or anonymous public" };
  }
  if (photoFileId) {
    const file = await db.uploadedFile.findUnique({
      where: { id: photoFileId },
      select: { ownerId: true, purpose: true, status: true, previewable: true },
    });
    if (
      !file ||
      file.ownerId !== actor.profileId ||
      file.purpose !== "profile_photo" ||
      file.status !== UploadStatus.AVAILABLE ||
      !file.previewable
    ) {
      return { ok: false, error: "Upload a JPEG, PNG or WebP photo first" };
    }
  }
  await ensureUserProfile(actor.profileId, actor.role);
  await db.userProfile.update({
    where: { profileId: actor.profileId },
    data: {
      ...fields,
      ...(visibility ? { visibility } : {}),
      ...(photoFileId !== undefined ? { photoFileId } : {}),
    },
  });
  return { ok: true };
}
