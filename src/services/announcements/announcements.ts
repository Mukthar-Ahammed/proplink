import "server-only";

import { z } from "zod";

import { AnnouncementKind, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";

/**
 * Admin announcements (Phase 1 Task 3, business Q1): promotional banners and
 * platform updates shown inside portals, starting with the Agent dashboard.
 *
 * Plain text only. Markup characters and links are rejected rather than
 * escaped, so an announcement can never carry third-party content. This is
 * PropLink's own messaging and is kept separate from paid advertising
 * (Phase 6). The database enforces the same rules (ADR-023).
 */

const LINK_PATTERN = /(https?:\/\/|www\.)/i;
const MARKUP_PATTERN = /[<>]/;

const LINE_FEED = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

/** Control, bidi-override and zero-width characters, which have no place in a notice. */
function isUnsafeCodePoint(code: number): boolean {
  return (
    (code <= 0x1f && code !== 0x0a) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Normalises text: Unicode NFKC, no unsafe characters, at most one blank line. */
export function sanitizeAnnouncementText(value: string): string {
  const unixLines = value
    .normalize("NFKC")
    .split(CARRIAGE_RETURN + LINE_FEED)
    .join(LINE_FEED)
    .split(CARRIAGE_RETURN)
    .join(LINE_FEED);
  const safe = Array.from(unixLines)
    .filter((char) => !isUnsafeCodePoint(char.codePointAt(0) ?? 0))
    .join("");
  const lines = safe.split(LINE_FEED);
  const collapsed: string[] = [];
  for (const line of lines) {
    const blank = line.trim() === "";
    const previousBlank =
      collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "";
    if (blank && previousBlank) continue;
    collapsed.push(line);
  }
  return collapsed.join(LINE_FEED).trim();
}

const plainText = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(sanitizeAnnouncementText)
    .pipe(
      z
        .string()
        .min(min, `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`)
        .refine((text) => !MARKUP_PATTERN.test(text), `${label} cannot contain < or >`)
        .refine((text) => !LINK_PATTERN.test(text), `${label} cannot contain links`),
    );

export const announcementSchema = z
  .object({
    kind: z.enum([AnnouncementKind.BANNER, AnnouncementKind.UPDATE]),
    title: plainText(3, 120, "Title"),
    body: plainText(1, 1000, "Message"),
    audienceRoles: z
      .array(z.enum(Object.values(Role) as [Role, ...Role[]]))
      .min(1, "Choose at least one audience")
      .transform((roles) => [...new Set(roles)]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((value) => !value.endsAt || value.endsAt > value.startsAt, {
    message: "The end date must be after the start date",
    path: ["endsAt"],
  });

type AdminActor = { profileId: string; legacyUserId: string };

export type AnnouncementResult =
  { ok: true; id: string } | { ok: false; error: string; status: number };

export async function createAnnouncement(
  actor: AdminActor,
  raw: unknown,
): Promise<AnnouncementResult> {
  const parsed = announcementSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid announcement",
      status: 400,
    };
  }
  const created = await db.announcement.create({
    data: {
      ...parsed.data,
      endsAt: parsed.data.endsAt ?? null,
      createdBy: actor.profileId,
    },
    select: { id: true },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "ANNOUNCEMENT_CREATED",
    entity: "Announcement",
    entityId: created.id,
    meta: { kind: parsed.data.kind, audienceRoles: parsed.data.audienceRoles },
  });
  return { ok: true, id: created.id };
}

export async function archiveAnnouncement(
  actor: AdminActor,
  id: string,
): Promise<AnnouncementResult> {
  const result = await db.announcement.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0)
    return { ok: false, error: "Announcement not found", status: 404 };
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "ANNOUNCEMENT_ARCHIVED",
    entity: "Announcement",
    entityId: id,
  });
  return { ok: true, id };
}

/** Announcements a role should see right now, newest first. */
export async function listActiveAnnouncements(role: Role, now = new Date()) {
  return db.announcement.findMany({
    where: {
      archivedAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      audienceRoles: { has: role },
    },
    orderBy: { startsAt: "desc" },
    take: 10,
    select: { id: true, kind: true, title: true, body: true, startsAt: true },
  });
}

export async function listAnnouncementsForAdmin() {
  return db.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      title: true,
      audienceRoles: true,
      startsAt: true,
      endsAt: true,
      archivedAt: true,
    },
  });
}
