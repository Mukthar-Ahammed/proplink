import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  ChatAuthorizationAction,
  ChatContextType,
  ChatPairType,
  ChatThreadStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import {
  allowsPaidFeatures,
  audiencesFor,
  subscriptionState,
} from "@/services/billing/subscriptions";
import { sendChatAuthorisedEmail } from "@/services/email/mailer";
import { notifyProfile } from "@/services/landlord/marketplace";
import { coInvestorAlias, isProjectMember } from "@/services/projects/community";
import { photoUrlsFor } from "@/services/profiles/userProfiles";

/**
 * Chat threads and their authorisation (Phase 3 Task 2, ADR-043). A chat is
 * one-to-one and bound to a context. It opens only when Admin has authorised
 * it (except Buyer ↔ Agent, OD-15) AND every participant who must pay has an
 * active subscription (or is in grace); both are checked on every send. A
 * lapsed subscription makes the thread read-only until renewal.
 */

export type Viewer = { profileId: string; role: Role };

export type ThreadState = "pending" | "open" | "read_only" | "closed";

export type ThreadAccess =
  | { ok: false; status: 403 | 404 }
  | {
      ok: true;
      thread: Prisma.ChatThreadGetPayload<object>;
      state: ThreadState;
      canRead: boolean;
      canSend: boolean;
      /** Why sending is blocked, for the UI. */
      blocked: null | "pending" | "closed" | "your_subscription" | "their_subscription";
      counterpartId: string;
    };

const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

async function paysAndAllowed(profileId: string): Promise<boolean> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { role: true, active: true },
  });
  if (!profile?.active) return false;
  if (audiencesFor(profile.role).length === 0) return true;
  return allowsPaidFeatures(await subscriptionState({ profileId, role: profile.role }));
}

/**
 * The single access rule for a thread, used by every read and send. Former
 * participant B (Agent) loses access once a thread is closed (Q9); the
 * context owner (participant A) keeps the read-only history.
 */
export async function threadAccess(
  viewer: Viewer,
  threadId: string,
): Promise<ThreadAccess> {
  if (!z.uuid().safeParse(threadId).success) return { ok: false, status: 404 };
  const thread = await db.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) return { ok: false, status: 404 };
  const isA = thread.participantA === viewer.profileId;
  const isB = thread.participantB === viewer.profileId;
  // Same answer for "missing" and "not yours": no existence oracle.
  if (!isA && !isB) return { ok: false, status: 404 };
  const counterpartId = isA ? thread.participantB : thread.participantA;

  // Phase 4 (ADR-046): a project chat lasts while participant B is one of the
  // project's investors; after that B loses it and A keeps the history.
  const lapsedMember =
    thread.contextType === ChatContextType.PROJECT &&
    thread.status !== ChatThreadStatus.CLOSED &&
    !(await isProjectMember(thread.contextId, thread.participantB));
  if (lapsedMember) {
    if (isB) return { ok: false, status: 404 };
    return {
      ok: true,
      thread,
      state: "closed",
      canRead: true,
      canSend: false,
      blocked: "closed",
      counterpartId,
    };
  }

  if (thread.status === ChatThreadStatus.CLOSED) {
    if (isB) return { ok: false, status: 404 };
    return {
      ok: true,
      thread,
      state: "closed",
      canRead: true,
      canSend: false,
      blocked: "closed",
      counterpartId,
    };
  }
  if (thread.status === ChatThreadStatus.PENDING) {
    return {
      ok: true,
      thread,
      state: "pending",
      canRead: false,
      canSend: false,
      blocked: "pending",
      counterpartId,
    };
  }
  const mine = await paysAndAllowed(viewer.profileId);
  const theirs = await paysAndAllowed(counterpartId);
  if (thread.pairType === ChatPairType.BUYER_AGENT) {
    // OD-15: the Buyer never pays; the Agent needs a subscription to send.
    return {
      ok: true,
      thread,
      state: mine ? "open" : "read_only",
      canRead: true,
      canSend: mine,
      blocked: mine ? null : "your_subscription",
      counterpartId,
    };
  }
  const open = mine && theirs;
  return {
    ok: true,
    thread,
    state: open ? "open" : "read_only",
    canRead: true,
    canSend: open,
    blocked: open ? null : !mine ? "your_subscription" : "their_subscription",
    counterpartId,
  };
}

async function record(
  tx: Prisma.TransactionClient | typeof db,
  threadId: string,
  action: ChatAuthorizationAction,
  actorId: string | null,
  reason: string | null = null,
) {
  await tx.chatAuthorization.create({
    data: { id: randomUUID(), threadId, action, actorId, reason },
  });
}

// ── Creation and closure (driven by the context's relationships) ────────

/**
 * Q10: an Agent's proposal (the interest step) creates a pending
 * Landlord ↔ Agent thread for Admin authorisation. Idempotent; a closed
 * thread is reopened as pending (and needs authorising again).
 */
export async function ensurePrivateListingThread(input: {
  listingId: string;
  landlordId: string;
  agentId: string;
  /** Why a closed thread reopens (it then waits for Admin authorisation). */
  reopenReason?: string;
}): Promise<string> {
  const key = {
    contextType: ChatContextType.PRIVATE_LISTING,
    contextId: input.listingId,
    participantA: input.landlordId,
    participantB: input.agentId,
  };
  const existing = await db.chatThread.findUnique({
    where: { contextType_contextId_participantA_participantB: key },
  });
  if (existing) {
    if (existing.status === ChatThreadStatus.CLOSED) {
      await db.$transaction(async (tx) => {
        await tx.chatThread.update({
          where: { id: existing.id },
          data: { status: ChatThreadStatus.PENDING, closedAt: null, closedReason: null },
        });
        await record(
          tx,
          existing.id,
          ChatAuthorizationAction.REOPENED,
          null,
          input.reopenReason ?? "Proposal sent again",
        );
      });
    }
    return existing.id;
  }
  const id = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      await tx.chatThread.create({
        data: {
          id,
          ...key,
          pairType: ChatPairType.LANDLORD_AGENT,
          requiresAuthorization: true,
        },
      });
      await record(
        tx,
        id,
        ChatAuthorizationAction.REQUESTED,
        null,
        "Agent sent a proposal",
      );
    });
    return id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await db.chatThread.findUnique({
        where: { contextType_contextId_participantA_participantB: key },
      });
      if (raced) return raced.id;
    }
    throw error;
  }
}

/**
 * Close the Landlord ↔ Agent thread when the Agent's relationship ends
 * (proposal declined or withdrawn, mandate ended; Q9). No-op if none.
 */
export async function closePrivateListingThread(
  listingId: string,
  agentId: string,
  reason: string,
  actorId: string | null = null,
) {
  const thread = await db.chatThread.findFirst({
    where: {
      contextType: ChatContextType.PRIVATE_LISTING,
      contextId: listingId,
      participantB: agentId,
      status: { not: ChatThreadStatus.CLOSED },
    },
  });
  if (!thread) return;
  await db.$transaction(async (tx) => {
    await tx.chatThread.update({
      where: { id: thread.id },
      data: {
        status: ChatThreadStatus.CLOSED,
        closedAt: new Date(),
        closedReason: reason,
      },
    });
    await record(tx, thread.id, ChatAuthorizationAction.CLOSED, actorId, reason);
  });
}

/**
 * Buyer ↔ Agent on a live retail listing (Task 7; OD-15 default: no Admin
 * authorisation; the Buyer never pays, the Agent needs a subscription to
 * send). Returns the thread, creating it open if new.
 */
export async function ensureRetailThread(
  buyer: Viewer,
  propertyId: string,
): Promise<
  { ok: true; threadId: string } | { ok: false; error: string; status: number }
> {
  if (buyer.role !== Role.BUYER) return bad("Only buyers start an enquiry chat", 403);
  if (typeof propertyId !== "string" || propertyId.length < 1 || propertyId.length > 64) {
    return bad("Property not available", 404);
  }
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: {
      status: true,
      listingSource: true,
      agentProfile: { select: { active: true, userId: true } },
    },
  });
  if (
    !property ||
    !["LIVE", "UNDER_OFFER"].includes(property.status) ||
    property.listingSource === "FLIPPER_RESALE" ||
    !property.agentProfile?.active
  ) {
    return bad("Property not available", 404);
  }
  const agent = await db.profile.findFirst({
    where: { legacyUserId: property.agentProfile.userId, role: Role.AGENT, active: true },
    select: { id: true },
  });
  if (!agent) return bad("Property not available", 404);
  const key = {
    contextType: ChatContextType.RETAIL_LISTING,
    contextId: propertyId,
    participantA: buyer.profileId,
    participantB: agent.id,
  };
  const existing = await db.chatThread.findUnique({
    where: { contextType_contextId_participantA_participantB: key },
  });
  if (existing) return { ok: true, threadId: existing.id };
  const id = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      await tx.chatThread.create({
        data: {
          id,
          ...key,
          pairType: ChatPairType.BUYER_AGENT,
          requiresAuthorization: false,
          status: ChatThreadStatus.AUTHORIZED,
          authorizedAt: new Date(),
        },
      });
      await record(
        tx,
        id,
        ChatAuthorizationAction.APPROVED,
        null,
        "Buyer enquiry (no authorisation needed)",
      );
    });
    return { ok: true, threadId: id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await db.chatThread.findUnique({
        where: { contextType_contextId_participantA_participantB: key },
      });
      if (raced) return { ok: true, threadId: raced.id };
    }
    throw error;
  }
}

/**
 * Phase 4 (ADR-046): PROJECT threads. Agent ↔ Investor (deal enquiries and
 * updates) and Lead ↔ Co-Investor, each pending until Admin authorises and
 * then open only while both sides' subscriptions are active. The investor
 * side (participant B) must be one of the project's investors; the database
 * checks the same. `with`: "agent" or "lead" when an investor asks, or the
 * investor's profile id when the project's Agent or Lead asks.
 */
export async function ensureProjectThread(
  viewer: Viewer,
  projectId: string,
  withWhom: "agent" | "lead" | { investorId: string },
): Promise<
  { ok: true; threadId: string } | { ok: false; error: string; status: number }
> {
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const project = await db.investorProject.findFirst({
    where: { id: projectId, status: { not: "CLOSED" } },
    select: { agentId: true, leadInvestorId: true },
  });
  if (!project) return bad("Project not found", 404);

  let pair: { pairType: ChatPairType; participantA: string; participantB: string };
  if (withWhom === "agent" || withWhom === "lead") {
    if (viewer.role !== Role.INVESTOR) return bad("Only investors start this chat", 403);
    if (!(await isProjectMember(projectId, viewer.profileId))) {
      return bad("Register your interest in this project first", 403);
    }
    if (withWhom === "agent") {
      pair = {
        pairType: ChatPairType.AGENT_INVESTOR,
        participantA: project.agentId,
        participantB: viewer.profileId,
      };
    } else {
      if (!project.leadInvestorId || project.leadInvestorId === viewer.profileId) {
        return bad("This project has no other Lead Investor to message", 409);
      }
      pair = {
        pairType: ChatPairType.LEAD_CO_INVESTOR,
        participantA: project.leadInvestorId,
        participantB: viewer.profileId,
      };
    }
  } else {
    if (!z.uuid().safeParse(withWhom.investorId).success)
      return bad("Investor not found", 404);
    if (!(await isProjectMember(projectId, withWhom.investorId))) {
      return bad("That investor is not part of this project", 404);
    }
    if (viewer.role === Role.AGENT && viewer.profileId === project.agentId) {
      pair = {
        pairType: ChatPairType.AGENT_INVESTOR,
        participantA: viewer.profileId,
        participantB: withWhom.investorId,
      };
    } else if (
      viewer.role === Role.INVESTOR &&
      viewer.profileId === project.leadInvestorId &&
      withWhom.investorId !== viewer.profileId
    ) {
      pair = {
        pairType: ChatPairType.LEAD_CO_INVESTOR,
        participantA: viewer.profileId,
        participantB: withWhom.investorId,
      };
    } else {
      return bad("Only the project's Agent or Lead Investor can do this", 403);
    }
  }

  const key = {
    contextType: ChatContextType.PROJECT,
    contextId: projectId,
    participantA: pair.participantA,
    participantB: pair.participantB,
  };
  const existing = await db.chatThread.findUnique({
    where: { contextType_contextId_participantA_participantB: key },
  });
  if (existing) {
    if (existing.status === ChatThreadStatus.CLOSED) {
      await db.$transaction(async (tx) => {
        await tx.chatThread.update({
          where: { id: existing.id },
          data: { status: ChatThreadStatus.PENDING, closedAt: null, closedReason: null },
        });
        await record(
          tx,
          existing.id,
          ChatAuthorizationAction.REOPENED,
          viewer.profileId,
          "Asked again",
        );
      });
    }
    return { ok: true, threadId: existing.id };
  }
  const id = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      await tx.chatThread.create({
        data: { id, ...key, pairType: pair.pairType, requiresAuthorization: true },
      });
      await record(
        tx,
        id,
        ChatAuthorizationAction.REQUESTED,
        viewer.profileId,
        "Project chat requested",
      );
    });
    return { ok: true, threadId: id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await db.chatThread.findUnique({
        where: { contextType_contextId_participantA_participantB: key },
      });
      if (raced) return { ok: true, threadId: raced.id };
    }
    throw error;
  }
}

/** When a project closes, its chats close too (history stays with participant A). */
export async function closeProjectThreads(
  projectId: string,
  reason: string,
  actorId: string | null = null,
  /** Only this investor's threads (they stopped being one of the project's investors). */
  investorId?: string,
) {
  if (investorId && (await isProjectMember(projectId, investorId))) return;
  const threads = await db.chatThread.findMany({
    where: {
      contextType: ChatContextType.PROJECT,
      contextId: projectId,
      status: { not: ChatThreadStatus.CLOSED },
      ...(investorId ? { participantB: investorId } : {}),
    },
    select: { id: true },
  });
  for (const thread of threads) {
    await db.$transaction(async (tx) => {
      await tx.chatThread.update({
        where: { id: thread.id },
        data: {
          status: ChatThreadStatus.CLOSED,
          closedAt: new Date(),
          closedReason: reason,
        },
      });
      await record(tx, thread.id, ChatAuthorizationAction.CLOSED, actorId, reason);
    });
  }
}

/**
 * What a participant sees as the other person's name. Lead ↔ Co-Investor
 * chats never show names, because investors' profiles are private (Q4). The
 * Lead (participant A) sees the co-investor's project alias, the same one as
 * on the Lead's project page (ADR-079). The co-investor sees "Lead Investor",
 * since a project has only one.
 */
export function counterpartLabel(
  thread: {
    pairType: ChatPairType;
    contextId: string;
    participantA: string;
    participantB: string;
  },
  viewerId: string,
  counterpartName: string | null,
): string {
  if (thread.pairType === ChatPairType.LEAD_CO_INVESTOR) {
    return thread.participantA === viewerId
      ? coInvestorAlias(thread.contextId, thread.participantB)
      : "Lead Investor";
  }
  return counterpartName ?? "PropLink member";
}

// ── Listing for participants ─────────────────────────────────────────────

export async function listThreadsFor(viewer: Viewer) {
  const threads = await db.chatThread.findMany({
    where: {
      OR: [
        { participantA: viewer.profileId },
        { participantB: viewer.profileId, status: { not: ChatThreadStatus.CLOSED } },
      ],
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
    include: {
      a: {
        select: {
          id: true,
          name: true,
          verificationBadge: { select: { profileId: true } },
        },
      },
      b: {
        select: {
          id: true,
          name: true,
          verificationBadge: { select: { profileId: true } },
        },
      },
      _count: {
        select: {
          messages: { where: { readAt: null, senderId: { not: viewer.profileId } } },
        },
      },
    },
  });
  const titles = await contextTitles(threads);
  const counterpartIdOf = (thread: (typeof threads)[number]) =>
    thread.participantA === viewer.profileId ? thread.participantB : thread.participantA;
  // Lead/co-investor chats are anonymised (aliases), so never show a photo there.
  const photos = await photoUrlsFor(
    viewer,
    threads
      .filter((thread) => thread.pairType !== ChatPairType.LEAD_CO_INVESTOR)
      .map(counterpartIdOf),
  );
  return threads.map((thread) => ({
    id: thread.id,
    counterpartPhotoUrl:
      thread.pairType === ChatPairType.LEAD_CO_INVESTOR
        ? null
        : (photos.get(counterpartIdOf(thread)) ?? null),
    pairType: thread.pairType,
    status: thread.status,
    title: titles.get(`${thread.contextType}:${thread.contextId}`) ?? "Conversation",
    counterpart: counterpartLabel(
      thread,
      viewer.profileId,
      thread.participantA === viewer.profileId ? thread.b.name : thread.a.name,
    ),
    // Verified badge (ADR-027) beside the counterpart's name or role label.
    counterpartVerified: Boolean(
      (thread.participantA === viewer.profileId ? thread.b : thread.a).verificationBadge,
    ),
    unread: thread._count.messages,
    lastMessageAt: thread.lastMessageAt,
  }));
}

/** Titles for thread lists; private-listing titles come from the Landlord service. */
export async function contextTitles(
  threads: { contextType: ChatContextType; contextId: string }[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const listingIds = threads
    .filter((t) => t.contextType === ChatContextType.PRIVATE_LISTING)
    .map((t) => t.contextId);
  const propertyIds = threads
    .filter((t) => t.contextType === ChatContextType.RETAIL_LISTING)
    .map((t) => t.contextId);
  if (listingIds.length > 0) {
    const { listingTitles } = await import("@/services/landlord/listings");
    for (const [id, title] of await listingTitles(listingIds)) {
      titles.set(`${ChatContextType.PRIVATE_LISTING}:${id}`, title);
    }
  }
  const projectIds = threads
    .filter((t) => t.contextType === ChatContextType.PROJECT)
    .map((t) => t.contextId);
  if (projectIds.length > 0) {
    const projects = await db.investorProject.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, title: true },
    });
    for (const project of projects) {
      titles.set(`${ChatContextType.PROJECT}:${project.id}`, project.title);
    }
  }
  if (propertyIds.length > 0) {
    const properties = await db.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, title: true },
    });
    for (const property of properties) {
      titles.set(`${ChatContextType.RETAIL_LISTING}:${property.id}`, property.title);
    }
  }
  return titles;
}

// ── Admin authorisation ──────────────────────────────────────────────────

type AdminActor = { profileId: string; legacyUserId: string; role: Role };

export async function listPendingThreads() {
  const threads = await db.chatThread.findMany({
    where: { status: ChatThreadStatus.PENDING, requiresAuthorization: true },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      a: { select: { name: true, role: true } },
      b: { select: { name: true, role: true } },
    },
  });
  const titles = await contextTitles(threads);
  return threads.map((thread) => ({
    ...thread,
    title: titles.get(`${thread.contextType}:${thread.contextId}`) ?? "Conversation",
  }));
}

const reasonSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(3, "Give a short reason")
      .max(500, "Keep the reason under 500 characters"),
  );

/** Approve or reject pending threads, one or many at once (bulk queue). */
export async function decideThreads(
  admin: AdminActor,
  rawIds: unknown,
  decision: "APPROVE" | "REJECT",
  rawReason?: unknown,
): Promise<{ ok: true; decided: number } | { ok: false; error: string; status: number }> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  const ids = z.array(z.uuid()).min(1).max(100).safeParse(rawIds);
  if (!ids.success) return bad("Choose at least one chat");
  let reason: string | null = null;
  if (decision === "REJECT") {
    const parsed = reasonSchema.safeParse(rawReason ?? "");
    if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Give a reason");
    reason = parsed.data;
  }
  const decided: string[] = [];
  const now = new Date();
  for (const id of ids.data) {
    const changed = await db.$transaction(async (tx) => {
      const result = await tx.chatThread.updateMany({
        where: { id, status: ChatThreadStatus.PENDING },
        data:
          decision === "APPROVE"
            ? { status: ChatThreadStatus.AUTHORIZED, authorizedAt: now }
            : { status: ChatThreadStatus.CLOSED, closedAt: now, closedReason: reason },
      });
      if (result.count === 0) return false;
      await record(
        tx,
        id,
        decision === "APPROVE"
          ? ChatAuthorizationAction.APPROVED
          : ChatAuthorizationAction.REJECTED,
        admin.profileId,
        reason,
      );
      return true;
    });
    if (changed) decided.push(id);
  }
  if (decided.length > 0) {
    await writeAudit({
      actorUserId: admin.legacyUserId,
      action: decision === "APPROVE" ? "CHAT_AUTHORIZED" : "CHAT_AUTHORIZATION_REJECTED",
      entity: "ChatThread",
      entityId: decided.join(",").slice(0, 190),
      meta: { threadIds: decided, ...(reason ? { reason } : {}) },
    });
  }
  if (decision === "APPROVE") {
    const threads = await db.chatThread.findMany({
      where: { id: { in: decided } },
      select: { id: true, participantA: true, participantB: true },
    });
    for (const thread of threads) {
      for (const profileId of [thread.participantA, thread.participantB]) {
        await notifyProfile(profileId, "chat.authorised", (to) =>
          sendChatAuthorisedEmail({ to, threadId: thread.id }),
        );
      }
    }
  }
  return { ok: true, decided: decided.length };
}

/** Admin withdraws an authorised (or pending) chat with a reason. */
export async function revokeThread(
  admin: AdminActor,
  threadId: string,
  rawReason: unknown,
) {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(threadId).success) return bad("Chat not found", 404);
  const reason = reasonSchema.safeParse(rawReason ?? "");
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const changed = await db.$transaction(async (tx) => {
    const result = await tx.chatThread.updateMany({
      where: { id: threadId, status: { not: ChatThreadStatus.CLOSED } },
      data: {
        status: ChatThreadStatus.CLOSED,
        closedAt: new Date(),
        closedReason: reason.data,
      },
    });
    if (result.count === 0) return false;
    await record(
      tx,
      threadId,
      ChatAuthorizationAction.REVOKED,
      admin.profileId,
      reason.data,
    );
    return true;
  });
  if (!changed) return bad("This chat is already closed", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "CHAT_REVOKED",
    entity: "ChatThread",
    entityId: threadId,
    meta: { reason: reason.data },
  });
  return { ok: true as const };
}
