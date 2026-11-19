import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getServerEnv } from "@/env";
import { Prisma } from "@/generated/prisma/client";
import {
  BillingInterval,
  Role,
  SubscriptionAudience,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import {
  AGENT_AUTHORISATION_MESSAGE,
  hasNewFeatureAccess,
} from "@/services/agents/agentMigration";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import {
  BillingSignatureError,
  BillingUnavailableError,
  getBillingProvider,
  type BillingEvent,
} from "@/services/billing";
import { sendPaymentFailedEmail } from "@/services/email/mailer";
import { shouldNotify } from "@/services/notifications/preferences";

/**
 * Subscriptions (Phase 3 Task 1, ADR-042; Clarification Answers §D). Only
 * Agents, Lead Investors and Co-Investors pay; Landlords and Buyers never do.
 * Prices are Admin settings (OD-01). Subscription state changes only through
 * verified, idempotent webhooks.
 */

type Actor = {
  profileId: string;
  legacyUserId: string;
  role: Role;
  email?: string | null;
};
const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

export const PAID_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];
const DUNNING_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.UNPAID,
];

/** Which plans a role may hold. Landlords, Buyers and others: none. */
export function audiencesFor(role: Role): SubscriptionAudience[] {
  if (role === Role.AGENT) return [SubscriptionAudience.AGENT];
  if (role === Role.INVESTOR) {
    return [SubscriptionAudience.LEAD_INVESTOR, SubscriptionAudience.CO_INVESTOR];
  }
  return [];
}

// ── Settings and prices (Admin) ─────────────────────────────────────────

export async function getBillingSettings() {
  const row = await db.billingSettings.findUnique({ where: { id: 1 } });
  return { graceDays: row?.graceDays ?? 7 };
}

export function adminBillingLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 60 }];
}

export async function updateGraceDays(admin: Actor, raw: unknown) {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!(await consumeRateLimits("admin_billing", adminBillingLimits(admin.profileId)))) {
    return bad("Too many actions; wait a minute", 429);
  }
  const parsed = z.coerce.number().int().min(0).max(60).safeParse(raw);
  if (!parsed.success) return bad("Grace period: a whole number of days from 0 to 60");
  await db.billingSettings.upsert({
    where: { id: 1 },
    create: { id: 1, graceDays: parsed.data, updatedBy: admin.profileId },
    update: { graceDays: parsed.data, updatedBy: admin.profileId },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "BILLING_GRACE_DAYS_SET",
    entity: "BillingSettings",
    entityId: "1",
    meta: { graceDays: parsed.data },
  });
  return { ok: true as const };
}

export async function listActivePlans() {
  return db.subscriptionPlan.findMany({
    where: { active: true },
    orderBy: [{ audience: "asc" }, { interval: "asc" }],
  });
}

const POUNDS = /^\d{1,6}(?:\.\d{1,2})?$/;

/** "49.99" → 4999. */
export function poundsToPence(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!POUNDS.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

/**
 * Set a plan's price. Provider prices are immutable, so this creates a new
 * price and retires the old plan; existing subscribers keep their price.
 */
export async function setPlanPrice(
  admin: Actor,
  input: { audience: unknown; interval: unknown; amount: unknown },
) {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!(await consumeRateLimits("admin_billing", adminBillingLimits(admin.profileId)))) {
    return bad("Too many actions; wait a minute", 429);
  }
  const audience = z.enum(SubscriptionAudience).safeParse(input.audience);
  const interval = z.enum(BillingInterval).safeParse(input.interval);
  const pence = poundsToPence(input.amount);
  if (!audience.success || !interval.success) return bad("Choose a plan and an interval");
  if (pence === null || pence < 100 || pence > 10_000_000) {
    return bad("Price: an amount in pounds from £1 to £100,000");
  }
  const provider = getBillingProvider();
  let priceId: string;
  try {
    ({ priceId } = await provider.createPrice({
      audience: audience.data,
      interval: interval.data,
      amountPence: pence,
    }));
  } catch (error) {
    if (error instanceof BillingUnavailableError) {
      return bad("The payment provider is unavailable; try again shortly", 503);
    }
    throw error;
  }
  const id = randomUUID();
  await db.$transaction([
    db.subscriptionPlan.updateMany({
      where: { audience: audience.data, interval: interval.data, active: true },
      data: { active: false, retiredAt: new Date() },
    }),
    db.subscriptionPlan.create({
      data: {
        id,
        audience: audience.data,
        interval: interval.data,
        amountGBP: pence,
        provider: provider.name,
        providerPriceId: priceId,
        createdBy: admin.profileId,
      },
    }),
  ]);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "BILLING_PLAN_PRICE_SET",
    entity: "SubscriptionPlan",
    entityId: id,
    meta: { audience: audience.data, interval: interval.data, amountGBP: pence },
  });
  return { ok: true as const };
}

// ── Entitlement ──────────────────────────────────────────────────────────

export type SubscriptionState =
  | { state: "not_required" }
  | {
      state: "active";
      audience: SubscriptionAudience;
      periodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | { state: "grace"; audience: SubscriptionAudience; graceEndsAt: Date }
  | { state: "lapsed" }
  | { state: "none" };

/**
 * Whether this person may use subscription-gated features (chat sends in
 * Phase 3). Active or trialing → active; failed payment within the grace
 * period → grace (still allowed); anything else → lapsed or none.
 */
export async function subscriptionState(
  profile: { profileId: string; role: Role },
  audiences: readonly SubscriptionAudience[] = audiencesFor(profile.role),
  now: Date = new Date(),
): Promise<SubscriptionState> {
  if (audiencesFor(profile.role).length === 0) return { state: "not_required" };
  const rows = await db.billingSubscription.findMany({
    where: { profileId: profile.profileId, audience: { in: [...audiences] } },
    orderBy: { updatedAt: "desc" },
  });
  const paid = rows.find(
    (row) =>
      PAID_STATUSES.includes(row.status) &&
      (row.currentPeriodEnd === null || row.currentPeriodEnd > now),
  );
  if (paid) {
    return {
      state: "active",
      audience: paid.audience,
      periodEnd: paid.currentPeriodEnd,
      cancelAtPeriodEnd: paid.cancelAtPeriodEnd,
    };
  }
  const { graceDays } = await getBillingSettings();
  for (const row of rows) {
    if (DUNNING_STATUSES.includes(row.status) && row.pastDueSince) {
      const graceEndsAt = new Date(row.pastDueSince.getTime() + graceDays * 86_400_000);
      if (graceEndsAt > now)
        return { state: "grace", audience: row.audience, graceEndsAt };
    }
  }
  return rows.length > 0 ? { state: "lapsed" } : { state: "none" };
}

/** True when the person may use paid features now (active or in grace, or not required). */
export function allowsPaidFeatures(state: SubscriptionState): boolean {
  return (
    state.state === "not_required" || state.state === "active" || state.state === "grace"
  );
}

// ── Checkout and portal (subscriber) ────────────────────────────────────

export function checkoutLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 10 }];
}

export async function startCheckout(
  actor: Actor,
  input: { audience: unknown; interval: unknown },
): Promise<{ ok: true; url: string } | { ok: false; error: string; status: number }> {
  const allowed = audiencesFor(actor.role);
  if (allowed.length === 0) return bad("Your account does not need a subscription", 403);
  // OD-27 (Q2): an existing (pre-invite) Agent subscribes once PropLink has
  // authorised the account; invited Agents pass straight away.
  if (actor.role === Role.AGENT) {
    if (!(await hasNewFeatureAccess(actor.profileId))) {
      return bad(AGENT_AUTHORISATION_MESSAGE, 403);
    }
  }
  if (!(await consumeRateLimits("billing_checkout", checkoutLimits(actor.profileId)))) {
    return bad("Too many attempts; wait a minute", 429);
  }
  const audience = z.enum(SubscriptionAudience).safeParse(input.audience);
  const interval = z.enum(BillingInterval).safeParse(input.interval);
  if (!audience.success || !allowed.includes(audience.data) || !interval.success) {
    return bad("Choose one of your plans");
  }
  const current = await subscriptionState(actor, [audience.data]);
  if (current.state === "active" || current.state === "grace") {
    return bad(
      "You already have this subscription. Use Manage billing to change it.",
      409,
    );
  }
  const plan = await db.subscriptionPlan.findFirst({
    where: { audience: audience.data, interval: interval.data, active: true },
  });
  if (!plan) return bad("This plan is not available yet", 409);
  const customer = await db.billingCustomer.findUnique({
    where: { profileId: actor.profileId },
  });
  const email =
    actor.email ??
    (
      await db.profile.findUnique({
        where: { id: actor.profileId },
        select: { legacyUser: { select: { email: true } } },
      })
    )?.legacyUser?.email ??
    "";
  const origin = getServerEnv().APP_ORIGIN ?? "http://localhost:3000";
  try {
    const session = await getBillingProvider().createCheckoutSession({
      profileId: actor.profileId,
      audience: audience.data,
      email,
      customerId: customer?.providerCustomerId ?? null,
      priceId: plan.providerPriceId,
      successUrl: `${origin}/account/billing?checkout=success`,
      cancelUrl: `${origin}/account/billing?checkout=cancelled`,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    if (error instanceof BillingUnavailableError) {
      return bad("The payment provider is unavailable; try again shortly", 503);
    }
    throw error;
  }
}

export async function openBillingPortal(
  actor: Actor,
): Promise<{ ok: true; url: string } | { ok: false; error: string; status: number }> {
  if (audiencesFor(actor.role).length === 0)
    return bad("No billing for your account", 403);
  if (!(await consumeRateLimits("billing_checkout", checkoutLimits(actor.profileId)))) {
    return bad("Too many attempts; wait a minute", 429);
  }
  const customer = await db.billingCustomer.findUnique({
    where: { profileId: actor.profileId },
  });
  if (!customer) return bad("Subscribe first; then you can manage billing here", 409);
  const origin = getServerEnv().APP_ORIGIN ?? "http://localhost:3000";
  try {
    const session = await getBillingProvider().createPortalSession({
      customerId: customer.providerCustomerId,
      returnUrl: `${origin}/account/billing`,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    if (error instanceof BillingUnavailableError) {
      return bad("The payment provider is unavailable; try again shortly", 503);
    }
    throw error;
  }
}

// ── Webhooks ─────────────────────────────────────────────────────────────

export const WEBHOOK_MAX_BYTES = 256 * 1024;

export type WebhookResult =
  | { status: 200; result: "applied" | "duplicate" | "ignored" }
  | { status: 400; error: string };

/**
 * Verify, record and apply one provider event. The event row and its effects
 * commit together: a replay is a no-op; a failure records nothing, so the
 * provider retries. Older events never overwrite newer state.
 */
export async function processBillingWebhook(
  rawBody: string,
  headers: Headers,
): Promise<WebhookResult> {
  const provider = getBillingProvider();
  let event: BillingEvent;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof BillingSignatureError || error instanceof SyntaxError) {
      console.warn(
        JSON.stringify({ event: "billing_webhook.rejected", provider: provider.name }),
      );
      return { status: 400, error: "Invalid signature" };
    }
    throw error;
  }

  let notifyFailure: string | null = null;
  try {
    const outcome = await db.$transaction(async (tx) => {
      await tx.billingWebhookEvent.create({
        data: {
          eventId: event.id,
          provider: provider.name,
          type: event.type.slice(0, 100),
          eventCreatedAt: event.created,
        },
      });
      const applied = await applyEvent(tx, provider.name, event);
      if (applied.notifyPaymentFailed) notifyFailure = applied.notifyPaymentFailed;
      return applied.result;
    });
    console.info(
      JSON.stringify({ event: "billing_webhook.processed", type: event.type, outcome }),
    );
    if (notifyFailure) await notifyPaymentFailed(notifyFailure);
    return { status: 200, result: outcome };
  } catch (error) {
    // Only a recorded event is a duplicate; any other conflict rolls back and
    // is re-thrown, so the provider retries instead of the event being lost.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (await db.billingWebhookEvent.findUnique({ where: { eventId: event.id } }))
    ) {
      return { status: 200, result: "duplicate" };
    }
    throw error;
  }
}

type Tx = Prisma.TransactionClient;

async function applyEvent(
  tx: Tx,
  provider: string,
  event: BillingEvent,
): Promise<{ result: "applied" | "ignored"; notifyPaymentFailed?: string }> {
  const data = event.data;
  switch (data.kind) {
    case "checkout_completed": {
      if (!data.profileId || !data.customerId) return { result: "ignored" };
      const profile = await tx.profile.findUnique({
        where: { id: data.profileId },
        select: { role: true },
      });
      if (!profile || audiencesFor(profile.role).length === 0)
        return { result: "ignored" };
      const existing = await tx.billingCustomer.findUnique({
        where: { providerCustomerId: data.customerId },
      });
      if (existing && existing.profileId !== data.profileId) return { result: "ignored" };
      await tx.billingCustomer.upsert({
        where: { profileId: data.profileId },
        create: {
          profileId: data.profileId,
          provider,
          providerCustomerId: data.customerId,
        },
        update: {},
      });
      return { result: "applied" };
    }
    case "subscription": {
      const plan = await tx.subscriptionPlan.findUnique({
        where: { providerPriceId: data.priceId },
      });
      const customer = data.customerId
        ? await tx.billingCustomer.findUnique({
            where: { providerCustomerId: data.customerId },
          })
        : null;
      const profileId = data.profileId ?? customer?.profileId ?? null;
      const audience = data.audience ?? plan?.audience ?? null;
      if (!profileId || !audience) return { result: "ignored" };
      const profile = await tx.profile.findUnique({
        where: { id: profileId },
        select: { role: true },
      });
      if (!profile || !audiencesFor(profile.role).includes(audience)) {
        return { result: "ignored" };
      }
      const existing = await tx.billingSubscription.findUnique({
        where: { providerSubscriptionId: data.subscriptionId },
      });
      // Out of order: never let an older event overwrite newer state.
      if (existing && existing.lastEventAt > event.created) return { result: "ignored" };
      const dunning = DUNNING_STATUSES.includes(data.status);
      const fields = {
        status: data.status,
        providerPriceId: data.priceId,
        interval: plan?.interval ?? existing?.interval ?? BillingInterval.MONTH,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        pastDueSince: dunning ? (existing?.pastDueSince ?? event.created) : null,
        lastEventAt: event.created,
      };
      if (existing) {
        await tx.billingSubscription.update({ where: { id: existing.id }, data: fields });
      } else {
        await tx.billingSubscription.create({
          data: {
            id: randomUUID(),
            profileId,
            audience,
            provider,
            providerSubscriptionId: data.subscriptionId,
            ...fields,
          },
        });
      }
      if (data.customerId && !customer) {
        await tx.billingCustomer.upsert({
          where: { profileId },
          create: { profileId, provider, providerCustomerId: data.customerId },
          update: {},
        });
      }
      return { result: "applied" };
    }
    case "invoice_failed": {
      if (!data.subscriptionId) return { result: "ignored" };
      const existing = await tx.billingSubscription.findUnique({
        where: { providerSubscriptionId: data.subscriptionId },
      });
      if (!existing) return { result: "ignored" };
      if (!existing.pastDueSince) {
        await tx.billingSubscription.update({
          where: { id: existing.id },
          data: { pastDueSince: event.created },
        });
      }
      return { result: "applied", notifyPaymentFailed: existing.profileId };
    }
    case "invoice_paid": {
      if (!data.subscriptionId) return { result: "ignored" };
      const existing = await tx.billingSubscription.findUnique({
        where: { providerSubscriptionId: data.subscriptionId },
      });
      if (!existing || existing.lastEventAt > event.created) return { result: "ignored" };
      await tx.billingSubscription.update({
        where: { id: existing.id },
        data: { pastDueSince: null },
      });
      return { result: "applied" };
    }
    default:
      return { result: "ignored" };
  }
}

/** Mandatory notice (business: failed payments notify the user). Never throws. */
async function notifyPaymentFailed(profileId: string) {
  try {
    const profile = await db.profile.findUnique({
      where: { id: profileId },
      select: { id: true, role: true, legacyUser: { select: { email: true } } },
    });
    const to = profile?.legacyUser?.email;
    if (!profile || !to || !(await shouldNotify(profile, "billing.payment", "email")))
      return;
    const { graceDays } = await getBillingSettings();
    await sendPaymentFailedEmail({ to, graceDays });
  } catch {
    console.error(JSON.stringify({ event: "billing.notify_failed" }));
  }
}

// ── Admin overview ───────────────────────────────────────────────────────

export async function subscriptionOverview() {
  const [byStatus, recent] = await Promise.all([
    db.billingSubscription.groupBy({
      by: ["audience", "status"],
      _count: { _all: true },
    }),
    db.billingSubscription.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        audience: true,
        interval: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        pastDueSince: true,
        updatedAt: true,
        profile: { select: { name: true, role: true } },
      },
    }),
  ]);
  return { byStatus, recent };
}
