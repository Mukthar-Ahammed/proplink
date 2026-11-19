import "server-only";

import { z } from "zod";

import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  eventsForRole,
  getNotificationEvent,
  type NotificationChannel,
} from "@/services/notifications/catalogue";

/**
 * Notification preferences (Phase 1 Task 10, ADR-029). Defaults live in the
 * catalogue; only a user's changes are stored. Mandatory events are always
 * on, whatever is stored.
 */

export type PreferenceRow = {
  key: string;
  label: string;
  description: string;
  mandatory: boolean;
  deliveredInPhase: number;
  inApp: boolean;
  email: boolean;
};

export async function getPreferences(
  profileId: string,
  role: Role,
): Promise<PreferenceRow[]> {
  const events = eventsForRole(role);
  const stored = await db.notificationPreference.findMany({
    where: { profileId, eventKey: { in: events.map((e) => e.key) } },
    select: { eventKey: true, inApp: true, email: true },
  });
  const byKey = new Map(stored.map((row) => [row.eventKey, row]));
  return events.map((event) => {
    const saved = byKey.get(event.key);
    return {
      key: event.key,
      label: event.label,
      description: event.description,
      mandatory: event.mandatory,
      deliveredInPhase: event.deliveredInPhase,
      inApp: event.mandatory ? true : (saved?.inApp ?? event.defaults.inApp),
      email: event.mandatory ? true : (saved?.email ?? event.defaults.email),
    };
  });
}

const updateSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            key: z.string().min(3).max(64),
            inApp: z.boolean(),
            email: z.boolean(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type UpdateResult = { ok: true; saved: number } | { ok: false; error: string };

/**
 * Saves the signed-in user's choices. Unknown events, events not offered to
 * the user's role, and mandatory events are rejected or ignored; a choice
 * equal to the default removes the stored row.
 */
export async function updatePreferences(
  actor: { profileId: string; role: Role },
  raw: unknown,
): Promise<UpdateResult> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check your choices and try again" };

  const allowed = new Set(eventsForRole(actor.role).map((e) => e.key));
  for (const choice of parsed.data.preferences) {
    if (!allowed.has(choice.key)) {
      return { ok: false, error: "One of these notifications is not available to you" };
    }
  }

  let saved = 0;
  await db.$transaction(async (tx) => {
    for (const choice of parsed.data.preferences) {
      const event = getNotificationEvent(choice.key);
      if (!event || event.mandatory) continue;
      const isDefault =
        choice.inApp === event.defaults.inApp && choice.email === event.defaults.email;
      if (isDefault) {
        await tx.notificationPreference.deleteMany({
          where: { profileId: actor.profileId, eventKey: choice.key },
        });
      } else {
        await tx.notificationPreference.upsert({
          where: {
            profileId_eventKey: { profileId: actor.profileId, eventKey: choice.key },
          },
          create: {
            profileId: actor.profileId,
            eventKey: choice.key,
            inApp: choice.inApp,
            email: choice.email,
          },
          update: { inApp: choice.inApp, email: choice.email },
        });
      }
      saved += 1;
    }
  });
  return { ok: true, saved };
}

/**
 * For senders in later phases: whether to deliver `eventKey` on `channel` to
 * this profile. Unknown events and events not offered to the role are never
 * delivered; mandatory events always are.
 */
export async function shouldNotify(
  profile: { id: string; role: Role },
  eventKey: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const event = getNotificationEvent(eventKey);
  if (!event || !event.roles.includes(profile.role)) return false;
  if (event.mandatory) return true;
  const saved = await db.notificationPreference.findUnique({
    where: { profileId_eventKey: { profileId: profile.id, eventKey } },
    select: { inApp: true, email: true },
  });
  return saved ? saved[channel] : event.defaults[channel];
}
