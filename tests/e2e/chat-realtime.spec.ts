import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

/**
 * Phase 3 exit gate (TRD acceptance criterion 4): a Landlord and a verified
 * Agent exchange messages on a private listing; outsiders can neither read
 * nor post; a message sent offline is delivered once when back online.
 *
 * The Landlord is created here the same way the seed creates accounts; the
 * Admin authorisation and the Agent's subscription are set up directly (the
 * Admin screen needs the owner's MFA; Stripe is mocked). Everything is
 * removed afterwards.
 */
test.skip(!hasDb, "requires the development database");

const PASSWORD = "Password123!";
const RUN = runId("chat").replace(/[^a-z0-9-]/gi, "");
const LANDLORD_EMAIL = `${RUN}@proplink.test`;
const LANDLORD_LEGACY = `legacy-${RUN}`;
const LISTING_ID = randomUUID();
const PROPOSAL_ID = randomUUID();
const THREAD_ID = randomUUID();
let landlordId = "";
let agentId = "";
let addedSubscription = false;

test.beforeAll(async () => {
  const [agent] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId" WHERE u.email = 'agent@proplink.test'`,
  );
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId" WHERE u.email = 'admin@proplink.test'`,
  );
  if (!agent || !admin) throw new Error("Seeded Agent or Admin missing");
  agentId = agent.id;

  await q(
    `INSERT INTO public."User" (id, email, name, role, "kycStatus", "passwordHash", "emailVerified", "gdprConsentAt")
     VALUES ($1, $2, $3, 'LANDLORD', 'APPROVED', 'not-used', now(), now())`,
    [LANDLORD_LEGACY, LANDLORD_EMAIL, `Landlord ${RUN}`],
  );
  const [auth] = await q<{ id: string }>(
    // Token columns must be '' (not NULL) or Supabase Auth cannot load the user.
    `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, aud, role, confirmation_token, recovery_token,
       email_change_token_new, email_change, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1,
       extensions.crypt($2, extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
       '', '', '', '', now(), now())
     RETURNING id`,
    [LANDLORD_EMAIL, PASSWORD],
  );
  landlordId = auth.id;
  await q(
    `INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false),
       'email', $3::text, now(), now(), now())`,
    [landlordId, LANDLORD_EMAIL, landlordId],
  );
  await q(
    `INSERT INTO public.profiles (id, "legacyUserId", role, name, "kycStatus", active)
     VALUES ($1, $2, 'LANDLORD', $3, 'APPROVED', true)
     ON CONFLICT (id) DO UPDATE SET "legacyUserId" = EXCLUDED."legacyUserId", role = 'LANDLORD',
       name = EXCLUDED.name, "kycStatus" = 'APPROVED', active = true`,
    [landlordId, LANDLORD_LEGACY, `Landlord ${RUN}`],
  );

  await q(
    `INSERT INTO public.landlord_listings (id, "ownerId", "createdBy", status, title, city,
       "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', $3, 'Leeds', now(), now(), $4, now())`,
    [LISTING_ID, landlordId, `Chat test ${RUN}`, admin.id],
  );
  await q(
    `INSERT INTO public.agent_proposals (id, "listingId", "agentId", "valuationGBP", "feeType", "feeBasisPoints",
       "contractMonths", terms, pitch, "updatedAt")
     VALUES ($1, $2, $3, 18000000, 'PERCENT', 125, 6, 'Manage the refurbishment and the sale.',
       'Specialists in Leeds terraces.', now())`,
    [PROPOSAL_ID, LISTING_ID, agentId],
  );
  await q(
    `INSERT INTO public.chat_threads (id, "contextType", "contextId", "pairType", "participantA", "participantB",
       status, "authorizedAt", "updatedAt")
     VALUES ($1, 'PRIVATE_LISTING', $2, 'LANDLORD_AGENT', $3, $4, 'AUTHORIZED', now(), now())`,
    [THREAD_ID, LISTING_ID, landlordId, agentId],
  );
  const existing = await q(
    `SELECT 1 FROM public.subscriptions WHERE "profileId" = $1 AND status = 'ACTIVE'`,
    [agentId],
  );
  if (existing.length === 0) {
    await q(
      `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
         "providerPriceId", status, "currentPeriodEnd", "lastEventAt", "updatedAt")
       VALUES ($1, $2, 'AGENT', 'MONTH', 'mock', $3, 'price_e2e', 'ACTIVE', now() + interval '30 days', now(), now())`,
      [randomUUID(), agentId, `sub_e2e_${RUN}`],
    );
    addedSubscription = true;
  }
});

test.afterAll(async () => {
  // Messages are append-only; the guard is bypassed only for this cleanup.
  await q(
    `ALTER TABLE public.chat_thread_messages DISABLE TRIGGER chat_thread_messages_guard`,
  );
  try {
    await q(`DELETE FROM public.chat_thread_messages WHERE "threadId" = $1`, [THREAD_ID]);
  } finally {
    await q(
      `ALTER TABLE public.chat_thread_messages ENABLE TRIGGER chat_thread_messages_guard`,
    );
  }
  await q(`DELETE FROM public.chat_reports WHERE "threadId" = $1`, [THREAD_ID]);
  await q(`DELETE FROM public.chat_authorizations WHERE "threadId" = $1`, [THREAD_ID]);
  await q(`DELETE FROM public.chat_threads WHERE id = $1`, [THREAD_ID]);
  await q(`DELETE FROM public.notification_deliveries WHERE "dedupeKey" LIKE $1`, [
    `chat:${THREAD_ID}:%`,
  ]);
  await q(`DELETE FROM public.agent_proposals WHERE id = $1`, [PROPOSAL_ID]);
  await q(`DELETE FROM public.landlord_listings WHERE id = $1`, [LISTING_ID]);
  if (addedSubscription)
    await q(`DELETE FROM public.subscriptions WHERE "providerSubscriptionId" = $1`, [
      `sub_e2e_${RUN}`,
    ]);
  await q(`DELETE FROM public.profiles WHERE id = $1`, [landlordId]);
  await q(`DELETE FROM auth.users WHERE id = $1`, [landlordId]);
  await q(`DELETE FROM public."User" WHERE id = $1`, [LANDLORD_LEGACY]);
  await closeDb();
});

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, PASSWORD);
  await page.goto(`/messages/${THREAD_ID}`);
  await page.waitForLoadState("networkidle");
  return page;
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("a Landlord and a verified Agent chat; outsiders cannot; offline sends arrive once", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const landlord = await signedIn(browser, LANDLORD_EMAIL);
  const agent = await signedIn(browser, "agent@proplink.test");

  const hello = `Hello from the landlord ${RUN}`;
  await send(landlord, hello);
  await expect(agent.getByTestId("chat-message").filter({ hasText: hello })).toBeVisible({
    timeout: 20_000,
  });

  const reply = `Reply from the agent ${RUN}`;
  await send(agent, reply);
  await expect(
    landlord.getByTestId("chat-message").filter({ hasText: reply }),
  ).toBeVisible({ timeout: 20_000 });

  // Outsider: a Buyer can neither open nor read nor post.
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await login(buyer, "buyer@proplink.test", PASSWORD);
  const pageResponse = await buyer.goto(`/messages/${THREAD_ID}`);
  expect(pageResponse?.status()).toBe(404);
  expect(
    (await buyer.request.get(`/api/chat/threads/${THREAD_ID}/messages`)).status(),
  ).toBe(404);
  // Same-origin (passes the proxy's origin check), so the chat service itself refuses.
  const post = await buyer.request.post(`/api/chat/threads/${THREAD_ID}/messages`, {
    headers: { "X-Proplink-Request": "1", Origin: new URL(buyer.url()).origin },
    data: { body: "intrusion", clientMessageId: randomUUID(), attachmentIds: [] },
  });
  expect(post.status()).toBe(404);

  // Offline queue: sent while offline, delivered once after reconnecting.
  const offline = `Sent while offline ${RUN}`;
  await agent.context().setOffline(true);
  await send(agent, offline);
  await expect(
    agent.getByTestId("chat-outgoing").filter({ hasText: offline }),
  ).toBeVisible();
  await agent.context().setOffline(false);
  await expect(
    landlord.getByTestId("chat-message").filter({ hasText: offline }),
  ).toBeVisible({ timeout: 30_000 });
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.chat_thread_messages WHERE "threadId" = $1 AND body = $2`,
    [THREAD_ID, offline],
  );
  expect(rows[0].n).toBe(1);
  expect(
    (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.chat_thread_messages WHERE body = 'intrusion'`,
      )
    )[0].n,
  ).toBe(0);
});
