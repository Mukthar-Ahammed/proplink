import "server-only";

import { randomUUID } from "node:crypto";

import { NotificationDeliveryStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { shouldNotify } from "@/services/notifications/preferences";

/**
 * Exactly-once email delivery for chain announcements (Phase 2 Task 8,
 * ADR-041). The row is claimed first (unique per recipient, event, dedupe key
 * and channel), so a repeated or concurrent announcement never emails the same
 * person twice. Preferences are respected; failures are recorded, never
 * thrown. The message itself is never stored.
 */

export type DeliveryOutcome = "sent" | "skipped" | "failed" | "duplicate";

export async function deliverOnce(params: {
  profileId: string;
  eventKey: string;
  dedupeKey: string;
  send: (to: string) => Promise<void>;
}): Promise<DeliveryOutcome> {
  const id = randomUUID();
  // INSERT ... ON CONFLICT DO NOTHING: an existing claim is a normal outcome,
  // not an error. (Phase 7 Task 5: re-announcing to hundreds of recipients
  // through the unique-violation path intermittently killed the test worker.)
  const claimed = await db.notificationDelivery.createMany({
    data: [
      {
        id,
        profileId: params.profileId,
        eventKey: params.eventKey,
        dedupeKey: params.dedupeKey,
        channel: "email",
      },
    ],
    skipDuplicates: true,
  });
  if (claimed.count === 0) return "duplicate";
  const finish = (status: NotificationDeliveryStatus) =>
    db.notificationDelivery.update({ where: { id }, data: { status } });
  try {
    const profile = await db.profile.findUnique({
      where: { id: params.profileId },
      select: {
        id: true,
        role: true,
        active: true,
        legacyUser: { select: { email: true } },
      },
    });
    const to = profile?.legacyUser?.email;
    if (
      !profile?.active ||
      !to ||
      !(await shouldNotify(profile, params.eventKey, "email"))
    ) {
      await finish(NotificationDeliveryStatus.SKIPPED);
      return "skipped";
    }
    await params.send(to);
    await finish(NotificationDeliveryStatus.SENT);
    return "sent";
  } catch {
    try {
      await finish(NotificationDeliveryStatus.FAILED);
    } catch {
      // Recording the failure must not turn into a thrown error either.
    }
    console.error(
      JSON.stringify({
        event: "notification.delivery_failed",
        eventKey: params.eventKey,
      }),
    );
    return "failed";
  }
}
