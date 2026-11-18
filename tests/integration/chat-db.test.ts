import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendNewProposalEmail: vi.fn(),
  sendChatAuthorisedEmail: vi.fn(),
  sendNewChatMessageEmail: vi.fn(),
  sendMandateEmail: vi.fn(),
}));

import { KycStatus, Role } from "@/generated/prisma/enums";
import {
  adminReadThread,
  listMessages,
  reportThread,
  sendMessage,
} from "@/services/chat/messages";
import { decideThreads, ensureRetailThread, threadAccess } from "@/services/chat/threads";
import { declineProposal, submitProposal } from "@/services/landlord/marketplace";

/**
 * Phase 3 Tasks 2-4 and 7 (migrations 20261118170000, 20261118180000) against
 * the disposable local Postgres: the pair matrix, both opening conditions,
 * read-only on lapse, outsiders, the Realtime join rule, idempotency,
 * append-only messages, attachments, reports and Buyer ↔ Agent threads.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await client.end();
});

type Person = { profileId: string; legacyUserId: string; role: Role };

async function person(
  role: "ADMIN" | "LANDLORD" | "AGENT" | "BUYER" | "INVESTOR",
): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `chat-${profileId}`;
  const email = `chat-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Chat Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3, name = $4 WHERE id = $1`,
    [profileId, role, legacyUserId, `${role} ${profileId.slice(0, 4)}`],
  );
  if (role === "LANDLORD") {
    await client.query(
      `WITH u AS (UPDATE public."User" SET "kycStatus" = 'APPROVED' WHERE id = $2 RETURNING 1)
       UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1`,
      [profileId, legacyUserId],
    );
  }
  if (role === "AGENT") {
    await client.query(
      `INSERT INTO public.agent_company_checks
         ("profileId", "companyNumber", "companyName", "companyStatus", result, provider, "checkedAt", "updatedAt")
       VALUES ($1, '12345678', 'PROPLINK DEMO ESTATES LIMITED', 'active', 'VERIFIED', 'mock', now(), now())`,
      [profileId],
    );
  }
  return { profileId, legacyUserId, role: role as Role };
}

async function subscribe(agent: Person, status = "ACTIVE") {
  await client.query(
    `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
       "providerPriceId", status, "currentPeriodEnd", "lastEventAt", "updatedAt")
     VALUES ($1, $2, 'AGENT', 'MONTH', 'mock', $3, 'price_test', $4::"SubscriptionStatus", now() + interval '30 days', now(), now())
     ON CONFLICT ("providerSubscriptionId") DO NOTHING`,
    [randomUUID(), agent.profileId, `sub_${agent.profileId}`, status],
  );
}

async function setSubscriptionStatus(agent: Person, status: string) {
  await client.query(
    `UPDATE public.subscriptions SET status = $2::"SubscriptionStatus", "pastDueSince" = NULL WHERE "profileId" = $1`,
    [agent.profileId, status],
  );
}

/** Landlord with an approved listing and an Agent whose proposal opened a pending thread. */
async function landlordAgentThread() {
  const [admin, landlord, agent] = [
    await person("ADMIN"),
    await person("LANDLORD"),
    await person("AGENT"),
  ];
  const listingId = randomUUID();
  await client.query(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, city, "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', 'Chat terrace', 'Leeds', now(), now(), $3, now())`,
    [listingId, landlord.profileId, admin.profileId],
  );
  const proposal = await submitProposal(agent, listingId, {
    valuation: "180000",
    feeType: "PERCENT",
    feePercent: "1.25",
    contractMonths: "6",
    terms: "We manage the refurbishment and the sale within six months.",
    pitch: "Specialists in distressed terraced housing in north Leeds.",
  });
  if (!proposal.ok) throw new Error(proposal.error);
  const { rows } = await client.query(
    `SELECT id, status FROM public.chat_threads WHERE "contextId" = $1 AND "participantB" = $2`,
    [listingId, agent.profileId],
  );
  return {
    admin,
    landlord,
    agent,
    listingId,
    proposalId: proposal.data.id,
    threadId: rows[0].id as string,
    status: rows[0].status as string,
  };
}

const msg = (body: string, key = randomUUID()) => ({
  body,
  clientMessageId: key,
  attachmentIds: [],
});

describe.skipIf(!hasDb)("chat", () => {
  it("opens only with Admin authorisation AND an active subscription, checked on every send", async () => {
    const { admin, landlord, agent, threadId, status } = await landlordAgentThread();
    expect(status).toBe("PENDING");
    expect(await sendMessage(landlord, threadId, msg("Hello"))).toMatchObject({
      ok: false,
      status: 403,
    });

    expect(await decideThreads(admin, [threadId], "APPROVE")).toEqual({
      ok: true,
      decided: 1,
    });
    // Authorised but the Agent has no subscription: read-only for both.
    expect(await sendMessage(agent, threadId, msg("Hi"))).toMatchObject({
      ok: false,
      status: 402,
    });
    expect(await sendMessage(landlord, threadId, msg("Hi"))).toMatchObject({
      ok: false,
      status: 403,
    });

    await subscribe(agent);
    const first = await sendMessage(landlord, threadId, msg("When can you visit?"));
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(await sendMessage(agent, threadId, msg("Tuesday works."))).toMatchObject({
      ok: true,
    });

    // Lapse mid-conversation: read-only until renewal, history still readable.
    await setSubscriptionStatus(agent, "CANCELED");
    expect(await sendMessage(agent, threadId, msg("Still there?"))).toMatchObject({
      ok: false,
      status: 402,
    });
    const read = await listMessages(landlord, threadId);
    expect(read.ok && read.access.state).toBe("read_only");
    expect(read.ok && read.messages).toHaveLength(2);
    await setSubscriptionStatus(agent, "ACTIVE");
    expect(await sendMessage(agent, threadId, msg("Renewed."))).toMatchObject({
      ok: true,
    });
  });

  it("keeps outsiders out (IDOR) and refuses them on the Realtime channel", async () => {
    const { admin, landlord, agent, threadId } = await landlordAgentThread();
    const outsider = await person("AGENT");
    await subscribe(outsider);
    expect(await sendMessage(outsider, threadId, msg("Let me in"))).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await listMessages(outsider, threadId)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await threadAccess(outsider, randomUUID())).toEqual({
      ok: false,
      status: 404,
    });

    const can = async (topic: string, uid: string) =>
      (
        await client.query(`SELECT public.proplink_can_join_thread($1, $2) AS ok`, [
          topic,
          uid,
        ])
      ).rows[0].ok;
    expect(await can(`thread:${threadId}`, landlord.profileId)).toBe(false); // pending
    await decideThreads(admin, [threadId], "APPROVE");
    expect(await can(`thread:${threadId}`, landlord.profileId)).toBe(true);
    expect(await can(`thread:${threadId}`, agent.profileId)).toBe(true);
    expect(await can(`thread:${threadId}`, outsider.profileId)).toBe(false);
    expect(await can(`thread:${threadId}`, admin.profileId)).toBe(false);
    expect(await can(`other:${threadId}`, landlord.profileId)).toBe(false);
    const grants = await client.query(
      `SELECT has_function_privilege('anon', 'public.proplink_can_join_thread(text, uuid)', 'EXECUTE') AS anon`,
    );
    expect(grants.rows[0].anon).toBe(false);
  });

  it("is idempotent, keeps text as text and never edits or deletes", async () => {
    const { admin, landlord, agent, threadId } = await landlordAgentThread();
    await decideThreads(admin, [threadId], "APPROVE");
    await subscribe(agent);
    const key = randomUUID();
    const xss = `<img src=x onerror=alert(1)>\u0000 <script>alert("x")</script>`;
    const first = await sendMessage(landlord, threadId, msg(xss, key));
    const retry = await sendMessage(landlord, threadId, msg(xss, key));
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (!first.ok || !retry.ok) return;
    expect(retry.message.id).toBe(first.message.id);
    // Stored as plain text (React renders it escaped); control characters removed.
    expect(first.message.body).toBe(
      `<img src=x onerror=alert(1)> <script>alert("x")</script>`,
    );
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.chat_thread_messages WHERE "threadId" = $1`,
      [threadId],
    );
    expect(rows[0].n).toBe(1);
    for (const sql of [
      `UPDATE public.chat_thread_messages SET body = 'edited' WHERE id = $1`,
      `DELETE FROM public.chat_thread_messages WHERE id = $1`,
    ]) {
      await expect(client.query(sql, [first.message.id])).rejects.toMatchObject({
        code: "23514",
      });
    }
    expect(await sendMessage(landlord, threadId, msg("x".repeat(4001)))).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await sendMessage(landlord, threadId, {
        body: "",
        clientMessageId: randomUUID(),
        attachmentIds: [],
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses every disallowed pair, and wrong relationships, in the database", async () => {
    const { landlord, agent, listingId } = await landlordAgentThread();
    const [buyer, investor, stranger] = [
      await person("BUYER"),
      await person("INVESTOR"),
      await person("AGENT"),
    ];
    const insert = `INSERT INTO public.chat_threads (id, "contextType", "contextId", "pairType", "participantA", "participantB", "updatedAt")
      VALUES ($1, $2::"ChatContextType", $3, $4::"ChatPairType", $5, $6, now())`;
    const cases: [string, string, string, string, string][] = [
      ["PRIVATE_LISTING", listingId, "BUYER_AGENT", landlord.profileId, agent.profileId],
      [
        "RETAIL_LISTING",
        listingId,
        "LANDLORD_AGENT",
        landlord.profileId,
        agent.profileId,
      ],
      [
        "PRIVATE_LISTING",
        listingId,
        "AGENT_INVESTOR",
        agent.profileId,
        investor.profileId,
      ],
      ["PROJECT", randomUUID(), "AGENT_INVESTOR", agent.profileId, investor.profileId],
      ["PROJECT", randomUUID(), "LEAD_CO_INVESTOR", investor.profileId, buyer.profileId],
      [
        "PRIVATE_LISTING",
        listingId,
        "LANDLORD_AGENT",
        landlord.profileId,
        landlord.profileId,
      ],
      [
        "PRIVATE_LISTING",
        listingId,
        "LANDLORD_AGENT",
        landlord.profileId,
        stranger.profileId,
      ],
      ["PRIVATE_LISTING", listingId, "LANDLORD_AGENT", buyer.profileId, agent.profileId],
      [
        "RETAIL_LISTING",
        "no-such-property",
        "BUYER_AGENT",
        buyer.profileId,
        agent.profileId,
      ],
    ];
    await client.query("BEGIN");
    try {
      for (const [context, contextId, pair, a, b] of cases) {
        await client.query("SAVEPOINT s");
        await expect(
          client.query(insert, [randomUUID(), context, contextId, pair, a, b]),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("closes the Agent's chat when the proposal is declined; the Landlord keeps the history", async () => {
    const { admin, landlord, agent, threadId, proposalId } = await landlordAgentThread();
    await decideThreads(admin, [threadId], "APPROVE");
    await subscribe(agent);
    await sendMessage(landlord, threadId, msg("Thanks for the proposal."));
    expect(
      await declineProposal({ ...landlord, kycStatus: KycStatus.APPROVED }, proposalId),
    ).toEqual({ ok: true });
    expect(await listMessages(agent, threadId)).toMatchObject({ ok: false, status: 404 });
    const kept = await listMessages(landlord, threadId);
    expect(kept.ok && kept.access.state).toBe("closed");
    expect(kept.ok && kept.messages).toHaveLength(1);
    expect(await sendMessage(landlord, threadId, msg("One more"))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("accepts only the sender's own scanned files, and attachments follow thread access", async () => {
    const { admin, landlord, agent, threadId } = await landlordAgentThread();
    await decideThreads(admin, [threadId], "APPROVE");
    await subscribe(agent);
    const file = async (owner: Person, status: string) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO public.uploaded_files (id, "ownerId", purpose, status, "originalName", "declaredType", "sizeBytes", sha256, "storageKey", "updatedAt")
         VALUES ($1, $2, 'document', $3::"UploadStatus", 'survey.pdf', 'application/pdf', 10, $4, $5, now())`,
        [
          id,
          owner.profileId,
          status,
          "a".repeat(64),
          status === "AVAILABLE" ? `files/${id}` : `quarantine/${id}`,
        ],
      );
      return id;
    };
    const mine = await file(landlord, "AVAILABLE");
    const theirs = await file(agent, "AVAILABLE");
    const infected = await file(landlord, "REJECTED_MALWARE");
    for (const ids of [[theirs], [infected]]) {
      expect(
        await sendMessage(landlord, threadId, {
          body: "file",
          clientMessageId: randomUUID(),
          attachmentIds: ids,
        }),
      ).toMatchObject({ ok: false, status: 400 });
    }
    const sent = await sendMessage(landlord, threadId, {
      body: "",
      clientMessageId: randomUUID(),
      attachmentIds: [mine],
    });
    expect(sent.ok && sent.message.attachments).toEqual([
      expect.objectContaining({
        fileId: mine,
        name: "survey.pdf",
        url: expect.stringContaining("/api/files/download?token="),
      }),
    ]);
    const agentView = await listMessages(agent, threadId);
    expect(agentView.ok && agentView.messages[0].attachments[0].url).toContain(
      "/api/files/download",
    );
    await client.query(
      `UPDATE public.chat_threads SET status = 'CLOSED', "closedAt" = now(), "closedReason" = 'Test end' WHERE id = $1`,
      [threadId],
    );
    expect(await listMessages(agent, threadId)).toMatchObject({ ok: false, status: 404 });
  });

  it("lets participants report a chat and logs every Admin read", async () => {
    const { admin, landlord, threadId } = await landlordAgentThread();
    const outsider = await person("BUYER");
    expect(
      await reportThread(outsider, threadId, "This is not my chat at all."),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await reportThread(landlord, threadId, "short")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await reportThread(landlord, threadId, "The agent was rude to me.")).toEqual({
      ok: true,
    });
    expect(await adminReadThread({ ...landlord }, threadId, "checking")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await adminReadThread(admin, threadId, "")).toMatchObject({ ok: false });
    expect(await adminReadThread(admin, threadId, "Reviewing the report")).toMatchObject({
      ok: true,
    });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public."AuditLog" WHERE action = 'CHAT_ADMIN_READ' AND "entityId" = $1`,
      [threadId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("opens Buyer ↔ Agent chats without authorisation; only the Agent needs a subscription", async () => {
    const { rows } = await client.query(
      `SELECT pr.id, p.id AS agent FROM public."Property" pr
       JOIN public."AgentProfile" ap ON ap.id = pr."agentProfileId" AND ap.active
       JOIN public.profiles p ON p."legacyUserId" = ap."userId" AND p.role = 'AGENT' AND p.active
       WHERE pr.status = 'LIVE' AND pr."listingSource" = 'AGENT' LIMIT 1`,
    );
    if (rows.length === 0) return; // the seed provides one
    const [propertyId, agentId] = [rows[0].id as string, rows[0].agent as string];
    const buyer = await person("BUYER");
    const agent = { profileId: agentId, legacyUserId: "", role: Role.AGENT };
    const thread = await ensureRetailThread(buyer, propertyId);
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    expect(
      (await ensureRetailThread(buyer, propertyId)) as { threadId: string },
    ).toMatchObject({ threadId: thread.threadId });
    expect(
      await sendMessage(buyer, thread.threadId, msg("Is it still available?")),
    ).toMatchObject({ ok: true });
    await client.query(`DELETE FROM public.subscriptions WHERE "profileId" = $1`, [
      agentId,
    ]);
    expect(await sendMessage(agent, thread.threadId, msg("Yes"))).toMatchObject({
      ok: false,
      status: 402,
    });
    expect(
      await ensureRetailThread({ ...buyer, role: Role.AGENT }, propertyId),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("migrated the legacy buyer messages into threads", async () => {
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM public."ChatMessage")::int AS legacy,
              (SELECT count(*) FROM public.chat_thread_messages WHERE "clientMessageId" LIKE 'legacy-%')::int AS copied`,
    );
    expect(rows[0].copied).toBeLessThanOrEqual(rows[0].legacy);
    if (rows[0].legacy > 0) expect(rows[0].copied).toBeGreaterThan(0);
  });
});
