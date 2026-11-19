import "server-only";

import { db } from "@/lib/db";

/**
 * Deliveries and webhooks (Phase 7 Task 5): the retry signals an operator
 * watches. Emails and saved-search alerts are sent by PropLink and marked
 * FAILED when the provider refuses them; webhooks are retried by each
 * provider until PropLink answers 2xx, and every accepted event is recorded
 * once (idempotency tables), so "last received" shows whether they arrive.
 * Counts only; no personal data.
 */

const HOUR = 3_600_000;
export const STUCK_EMAIL_MINUTES = 15;
export const STUCK_ALERT_HOURS = 26; // the alert job runs daily

export type DeliveryRow = {
  name: string;
  value: string;
  attention: boolean;
};

export type WebhookRow = {
  provider: string;
  last24h: number;
  minutesAgo: number | null;
};

export async function deliveryHealth(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * HOUR);
  const [
    emailsFailed,
    emailsSent,
    emailsStuck,
    alertsFailed,
    alertsStuck,
    billing24,
    billingLast,
    kyc24,
    kycLast,
    esign24,
    esignLast,
  ] = await Promise.all([
    db.notificationDelivery.count({
      where: { status: "FAILED", createdAt: { gte: dayAgo } },
    }),
    db.notificationDelivery.count({
      where: { status: "SENT", createdAt: { gte: dayAgo } },
    }),
    db.notificationDelivery.count({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(now.getTime() - STUCK_EMAIL_MINUTES * 60_000) },
      },
    }),
    db.savedSearchAlert.count({
      where: { status: "FAILED", createdAt: { gte: dayAgo } },
    }),
    db.savedSearchAlert.count({
      where: {
        status: "QUEUED",
        createdAt: { lt: new Date(now.getTime() - STUCK_ALERT_HOURS * HOUR) },
      },
    }),
    db.billingWebhookEvent.count({ where: { receivedAt: { gte: dayAgo } } }),
    db.billingWebhookEvent.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.kycWebhookEvent.count({ where: { receivedAt: { gte: dayAgo } } }),
    db.kycWebhookEvent.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    db.eSignWebhookEvent.count({ where: { receivedAt: { gte: dayAgo } } }),
    db.eSignWebhookEvent.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
  ]);

  const deliveries: DeliveryRow[] = [
    {
      name: "Emails sent (24 h)",
      value: String(emailsSent),
      attention: false,
    },
    {
      name: "Emails failed (24 h)",
      value: String(emailsFailed),
      attention: emailsFailed > 0,
    },
    {
      name: `Emails waiting over ${STUCK_EMAIL_MINUTES} min`,
      value: String(emailsStuck),
      attention: emailsStuck > 0,
    },
    {
      name: "Saved-search alerts failed (24 h)",
      value: String(alertsFailed),
      attention: alertsFailed > 0,
    },
    {
      name: `Saved-search alerts queued over ${STUCK_ALERT_HOURS} h`,
      value: String(alertsStuck),
      attention: alertsStuck > 0,
    },
  ];
  const minutesAgo = (at: Date | undefined) =>
    at ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000)) : null;
  const webhooks: WebhookRow[] = [
    {
      provider: "Stripe (subscriptions)",
      last24h: billing24,
      minutesAgo: minutesAgo(billingLast?.receivedAt),
    },
    {
      provider: "KYC provider",
      last24h: kyc24,
      minutesAgo: minutesAgo(kycLast?.receivedAt),
    },
    {
      provider: "E-signature",
      last24h: esign24,
      minutesAgo: minutesAgo(esignLast?.receivedAt),
    },
  ];
  return { deliveries, webhooks };
}
