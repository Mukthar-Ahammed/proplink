import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { authoriseTestAgent } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
const emails = vi.hoisted(() => [] as string[]);
vi.mock("@/services/email/mailer", () => ({
  sendPaymentFailedEmail: vi.fn(async ({ to }: { to: string }) => {
    emails.push(to);
  }),
}));

import { Role, SubscriptionStatus } from "@/generated/prisma/enums";
import { setBillingProviderForTests } from "@/services/billing";
import {
  MockBillingProvider,
  mockBillingEvent,
} from "@/services/billing/mockBillingProvider";
import {
  processBillingWebhook,
  setPlanPrice,
  startCheckout,
  subscriptionState,
  updateGraceDays,
} from "@/services/billing/subscriptions";

/**
 * Phase 3 Task 1 (migration 20261118160000) against the disposable local
 * Postgres with the mock provider: prices, the webhook flow end to end,
 * idempotency, forgery, ordering, dunning and the paying-roles rule.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  setBillingProviderForTests(new MockBillingProvider());
});

afterAll(async () => {
  setBillingProviderForTests(null);
  if (hasDb) await client.end();
});

type Person = { profileId: string; legacyUserId: string; role: Role; email: string };

async function person(
  role: "ADMIN" | "AGENT" | "LANDLORD" | "INVESTOR",
): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `billing-${profileId}`;
  const email = `billing-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Billing Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3 WHERE id = $1`,
    [profileId, role, legacyUserId],
  );
  if (role === "AGENT") await authoriseTestAgent(client, profileId);
  return { profileId, legacyUserId, role: role as Role, email };
}

async function deliver(
  type: string,
  data: Parameters<typeof mockBillingEvent>[0]["data"],
  created = new Date(),
  id?: string,
) {
  const event = mockBillingEvent({ type, data, created, id });
  return { ...(await processBillingWebhook(event.rawBody, event.headers)), event };
}

async function agentPlan(admin: Person) {
  expect(
    await setPlanPrice(admin, { audience: "AGENT", interval: "MONTH", amount: "49.99" }),
  ).toEqual({ ok: true });
  const { rows } = await client.query(
    `SELECT "providerPriceId", "amountGBP" FROM public.subscription_plans
     WHERE audience = 'AGENT' AND interval = 'MONTH' AND active`,
  );
  return rows[0] as { providerPriceId: string; amountGBP: number };
}

describe.skipIf(!hasDb)("subscriptions", () => {
  it("keeps one active price per plan; a change retires the old one", async () => {
    const admin = await person("ADMIN");
    const first = await agentPlan(admin);
    expect(first.amountGBP).toBe(4999);
    expect(
      await setPlanPrice(admin, { audience: "AGENT", interval: "MONTH", amount: "59" }),
    ).toEqual({ ok: true });
    const { rows } = await client.query(
      `SELECT "amountGBP", active FROM public.subscription_plans
       WHERE audience = 'AGENT' AND interval = 'MONTH' ORDER BY "createdAt" DESC LIMIT 2`,
    );
    expect(rows).toEqual([
      { amountGBP: 5900, active: true },
      { amountGBP: 4999, active: false },
    ]);
    expect(
      await setPlanPrice(admin, { audience: "AGENT", interval: "MONTH", amount: "0.50" }),
    ).toMatchObject({ ok: false });
    expect(
      await setPlanPrice(
        { ...admin, role: Role.AGENT },
        { audience: "AGENT", interval: "MONTH", amount: "10" },
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("subscribes through checkout and verified webhooks; replays and forgeries change nothing", async () => {
    const [admin, agent] = [await person("ADMIN"), await person("AGENT")];
    const plan = await agentPlan(admin);
    expect(await subscriptionState(agent)).toEqual({ state: "none" });

    const checkout = await startCheckout(agent, { audience: "AGENT", interval: "MONTH" });
    expect(checkout).toMatchObject({
      ok: true,
      url: expect.stringContaining("/account/billing/mock?checkout="),
    });

    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    await deliver("checkout.session.completed", {
      kind: "checkout_completed",
      profileId: agent.profileId,
      customerId,
      subscriptionId,
    });
    const created = await deliver("customer.subscription.created", {
      kind: "subscription",
      subscriptionId,
      customerId,
      profileId: agent.profileId,
      audience: "AGENT",
      status: SubscriptionStatus.ACTIVE,
      priceId: plan.providerPriceId,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });
    expect(created).toMatchObject({ status: 200, result: "applied" });
    expect(await subscriptionState(agent)).toMatchObject({
      state: "active",
      audience: "AGENT",
    });

    // Replay: same event id → no-op.
    const replay = await processBillingWebhook(
      created.event.rawBody,
      created.event.headers,
    );
    expect(replay).toEqual({ status: 200, result: "duplicate" });
    // Forgery: changed body or missing signature → 400 and nothing recorded.
    const forged = created.event.rawBody
      .replace("ACTIVE", "CANCELED")
      .replace(/"id":"[^"]+"/, '"id":"evt_forged"');
    expect(await processBillingWebhook(forged, created.event.headers)).toMatchObject({
      status: 400,
    });
    expect(
      await processBillingWebhook(created.event.rawBody, new Headers()),
    ).toMatchObject({ status: 400 });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.billing_webhook_events WHERE "eventId" = 'evt_forged'`,
    );
    expect(rows[0].n).toBe(0);

    // Already subscribed: no second checkout.
    expect(
      await startCheckout(agent, { audience: "AGENT", interval: "MONTH" }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("ignores out-of-order events and runs the failed-payment grace period", async () => {
    const [admin, agent] = [await person("ADMIN"), await person("AGENT")];
    const plan = await agentPlan(admin);
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const base = {
      kind: "subscription" as const,
      subscriptionId,
      customerId,
      profileId: agent.profileId,
      audience: "AGENT" as const,
      priceId: plan.providerPriceId,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      cancelAtPeriodEnd: false,
    };
    const t0 = new Date(Date.now() - 60_000);
    await deliver(
      "customer.subscription.updated",
      { ...base, status: SubscriptionStatus.ACTIVE },
      new Date(t0.getTime() + 2000),
    );
    // An older "incomplete" event arriving late must not roll it back.
    expect(
      await deliver(
        "customer.subscription.created",
        { ...base, status: SubscriptionStatus.INCOMPLETE },
        t0,
      ),
    ).toMatchObject({ result: "ignored" });
    expect(await subscriptionState(agent)).toMatchObject({ state: "active" });

    // Payment fails: grace period, user told once per event.
    await deliver(
      "invoice.payment_failed",
      { kind: "invoice_failed", subscriptionId, customerId },
      new Date(t0.getTime() + 3000),
    );
    await deliver(
      "customer.subscription.updated",
      { ...base, status: SubscriptionStatus.PAST_DUE },
      new Date(t0.getTime() + 4000),
    );
    expect(await subscriptionState(agent)).toMatchObject({ state: "grace" });
    expect(emails).toContain(agent.email);

    // Past the grace period: lapsed (chats read-only in Task 2).
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(await subscriptionState(agent, undefined, later)).toEqual({ state: "lapsed" });

    // Renewal succeeds: active again, dunning cleared.
    await deliver(
      "invoice.paid",
      { kind: "invoice_paid", subscriptionId },
      new Date(t0.getTime() + 5000),
    );
    await deliver(
      "customer.subscription.updated",
      { ...base, status: SubscriptionStatus.ACTIVE },
      new Date(t0.getTime() + 6000),
    );
    expect(await subscriptionState(agent, undefined, later)).toMatchObject({
      state: "active",
    });
    const { rows } = await client.query(
      `SELECT "pastDueSince" FROM public.subscriptions WHERE "providerSubscriptionId" = $1`,
      [subscriptionId],
    );
    expect(rows[0].pastDueSince).toBeNull();

    // Cancelled: lapsed.
    await deliver(
      "customer.subscription.deleted",
      { ...base, status: SubscriptionStatus.CANCELED },
      new Date(t0.getTime() + 7000),
    );
    expect(await subscriptionState(agent)).toEqual({ state: "lapsed" });
  });

  it("uses the Admin grace setting", async () => {
    const admin = await person("ADMIN");
    expect(await updateGraceDays(admin, "61")).toMatchObject({ ok: false });
    expect(await updateGraceDays(admin, "3")).toEqual({ ok: true });
    const { rows } = await client.query(
      `SELECT "graceDays" FROM public.billing_settings WHERE id = 1`,
    );
    expect(rows[0].graceDays).toBe(3);
    await updateGraceDays(admin, "7");
  });

  it("never bills Landlords: no checkout, events ignored, database refuses", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const plan = await agentPlan(admin);
    expect(await subscriptionState(landlord)).toEqual({ state: "not_required" });
    expect(
      await startCheckout(landlord, { audience: "AGENT", interval: "MONTH" }),
    ).toMatchObject({ ok: false, status: 403 });
    const subscriptionId = `sub_${randomUUID()}`;
    const result = await deliver("customer.subscription.created", {
      kind: "subscription",
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
      profileId: landlord.profileId,
      audience: "AGENT",
      status: SubscriptionStatus.ACTIVE,
      priceId: plan.providerPriceId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    expect(result).toMatchObject({ status: 200, result: "ignored" });
    await expect(
      client.query(
        `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
           "providerPriceId", status, "lastEventAt", "updatedAt")
         VALUES ($1, $2, 'AGENT', 'MONTH', 'mock', $3, 'p', 'ACTIVE', now(), now())`,
        [randomUUID(), landlord.profileId, `sub_${randomUUID()}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const { rows } = await client.query(
      `SELECT bool_and(c.relrowsecurity) AS rls, bool_or(has_table_privilege('anon', c.oid, 'SELECT')) AS anon
       FROM pg_class c WHERE c.oid IN ('public.subscriptions'::regclass, 'public.subscription_plans'::regclass,
         'public.billing_customers'::regclass, 'public.billing_webhook_events'::regclass, 'public.billing_settings'::regclass)`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false });
  });
});
