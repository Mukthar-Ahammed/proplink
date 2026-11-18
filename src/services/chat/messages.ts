import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { ChatReportStatus, Role, UploadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import { threadAccess, type Viewer } from "@/services/chat/threads";
import { sendNewChatMessageEmail } from "@/services/email/mailer";
import { deliverOnce } from "@/services/notifications/deliveries";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";

/**
 * Chat messages (Phase 3 Tasks 3, 4 and 6; ADR-043). Every message goes
 * through `sendMessage`: rate limits, the thread's access rule (Admin
 * authorisation and subscriptions, on every send), sanitising, idempotent
 * persistence, then a private Realtime broadcast. Clients never write
 * directly. No edits or deletes. Attachments are the sender's own scanned
 * uploads and follow thread access.
 */

export const MAX_BODY = 4000;
export const MAX_ATTACHMENTS = 5;
/** New-message emails: at most one per thread per recipient per window. */
export const EMAIL_WINDOW_MINUTES = 15;

const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

/** Business limits: 20 per minute per thread, 200 per hour per user. */
export function sendLimits(profileId: string, threadId: string): LimitSpec[] {
  return [
    {
      kind: "user",
      identifier: `${profileId}:${threadId}`,
      windowSeconds: 60,
      limit: 20,
    },
    { kind: "user", identifier: profileId, windowSeconds: 3600, limit: 200 },
  ];
}

/** Plain text only: control characters removed (new lines kept), trimmed. */
export function cleanBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const sendSchema = z.object({
  body: z.unknown(),
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid message key"),
  attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS).default([]),
});

export type ChatMessageView = {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
  readAt: string | null;
  attachments: { fileId: string; name: string; url: string | null }[];
};

async function view(
  viewerId: string,
  message: Prisma.ChatThreadMessageGetPayload<{
    include: { attachments: { include: { file: { select: { originalName: true } } } } };
  }>,
): Promise<ChatMessageView> {
  return {
    id: message.id,
    threadId: message.threadId,
    senderId: message.senderId,
    body: message.body,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
    readAt: message.readAt?.toISOString() ?? null,
    attachments: await Promise.all(
      message.attachments.map(async (attachment) => {
        const link = await createGrantedDownloadLink(viewerId, attachment.fileId);
        return {
          fileId: attachment.fileId,
          name: attachment.file.originalName,
          url: link.ok ? link.url : null,
        };
      }),
    ),
  };
}

const withAttachments = {
  attachments: { include: { file: { select: { originalName: true } } } },
} as const;

export async function sendMessage(
  sender: Viewer,
  threadId: string,
  raw: unknown,
): Promise<
  | { ok: true; message: ChatMessageView; duplicate: boolean }
  | { ok: false; error: string; status: number }
> {
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Invalid message");
  const body = cleanBody(parsed.data.body);
  if (body.length > MAX_BODY) return bad(`Keep messages under ${MAX_BODY} characters`);
  if (body.length === 0 && parsed.data.attachmentIds.length === 0) {
    return bad("Write a message or attach a file");
  }

  // Idempotent retry: the same key returns the stored message, no new limits spent.
  const existing = await db.chatThreadMessage
    .findUnique({
      where: {
        threadId_senderId_clientMessageId: {
          threadId,
          senderId: sender.profileId,
          clientMessageId: parsed.data.clientMessageId,
        },
      },
      include: withAttachments,
    })
    .catch(() => null);
  if (existing)
    return { ok: true, message: await view(sender.profileId, existing), duplicate: true };

  if (!(await consumeRateLimits("chat_send", sendLimits(sender.profileId, threadId)))) {
    return bad("You are sending messages too quickly; wait a moment", 429);
  }
  const access = await threadAccess(sender, threadId);
  if (!access.ok) return bad("Chat not found", access.status);
  if (!access.canSend) {
    const reasons = {
      pending: "PropLink has not authorised this chat yet",
      closed: "This chat is closed",
      your_subscription:
        "Your subscription is not active: this chat is read-only until you renew",
      their_subscription:
        "This chat is read-only until the other person renews their subscription",
    } as const;
    return bad(
      reasons[access.blocked ?? "closed"],
      access.blocked === "your_subscription" ? 402 : 403,
    );
  }

  if (parsed.data.attachmentIds.length > 0) {
    const files = await db.uploadedFile.findMany({
      where: {
        id: { in: parsed.data.attachmentIds },
        ownerId: sender.profileId,
        status: UploadStatus.AVAILABLE,
      },
      select: { id: true },
    });
    if (files.length !== new Set(parsed.data.attachmentIds).size) {
      return bad("Attach your own files once they have passed the security scan");
    }
  }

  const id = randomUUID();
  let stored;
  try {
    stored = await db.$transaction(async (tx) => {
      await tx.chatThreadMessage.create({
        data: {
          id,
          threadId,
          senderId: sender.profileId,
          body,
          clientMessageId: parsed.data.clientMessageId,
        },
      });
      for (const fileId of new Set(parsed.data.attachmentIds)) {
        await tx.chatMessageAttachment.create({ data: { messageId: id, fileId } });
      }
      await tx.chatThread.update({
        where: { id: threadId },
        data: { lastMessageAt: new Date() },
      });
      return tx.chatThreadMessage.findUniqueOrThrow({
        where: { id },
        include: withAttachments,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await db.chatThreadMessage.findUnique({
        where: {
          threadId_senderId_clientMessageId: {
            threadId,
            senderId: sender.profileId,
            clientMessageId: parsed.data.clientMessageId,
          },
        },
        include: withAttachments,
      });
      if (raced)
        return {
          ok: true,
          message: await view(sender.profileId, raced),
          duplicate: true,
        };
    }
    throw error;
  }

  await broadcast(threadId, "message", { id: stored.id, senderId: stored.senderId });
  await notifyRecipient(access.counterpartId, threadId);
  return { ok: true, message: await view(sender.profileId, stored), duplicate: false };
}

export async function listMessages(
  viewer: Viewer,
  threadId: string,
  options: { after?: string | null } = {},
) {
  const access = await threadAccess(viewer, threadId);
  if (!access.ok) return bad("Chat not found", access.status);
  if (!access.canRead)
    return { ok: true as const, access, messages: [] as ChatMessageView[] };
  const after =
    options.after && !Number.isNaN(Date.parse(options.after))
      ? new Date(options.after)
      : null;
  const messages = await db.chatThreadMessage.findMany({
    where: { threadId, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 500,
    include: withAttachments,
  });
  return {
    ok: true as const,
    access,
    messages: await Promise.all(
      messages.map((message) => view(viewer.profileId, message)),
    ),
  };
}

/** Read receipts: marks messages to the viewer as read (once). */
export async function markRead(viewer: Viewer, threadId: string) {
  const access = await threadAccess(viewer, threadId);
  if (!access.ok || !access.canRead) return bad("Chat not found", 404);
  const result = await db.chatThreadMessage.updateMany({
    where: { threadId, senderId: { not: viewer.profileId }, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count > 0) await broadcast(threadId, "read", { by: viewer.profileId });
  return { ok: true as const, marked: result.count };
}

// ── Reports and Admin access ─────────────────────────────────────────────

const reasonSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
  .pipe(z.string().min(10, "Tell us what happened (at least 10 characters)").max(1000));

export async function reportThread(
  viewer: Viewer & { legacyUserId: string },
  threadId: string,
  raw: unknown,
) {
  if (
    !(await consumeRateLimits("chat_report", [
      { kind: "user", identifier: viewer.profileId, windowSeconds: 3600, limit: 10 },
    ]))
  ) {
    return bad("Too many reports; try again later", 429);
  }
  const access = await threadAccess(viewer, threadId);
  if (!access.ok) return bad("Chat not found", access.status);
  const reason = reasonSchema.safeParse(raw);
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const id = randomUUID();
  await db.chatReport.create({
    data: { id, threadId, reporterId: viewer.profileId, reason: reason.data },
  });
  await writeAudit({
    actorUserId: viewer.legacyUserId,
    action: "CHAT_REPORTED",
    entity: "ChatThread",
    entityId: threadId,
    meta: { reportId: id },
  });
  return { ok: true as const };
}

export async function listOpenReports() {
  return db.chatReport.findMany({
    where: { status: ChatReportStatus.OPEN },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      reporter: { select: { name: true, role: true } },
      thread: { select: { id: true, pairType: true, status: true } },
    },
  });
}

type AdminActor = { profileId: string; legacyUserId: string; role: Role };

/**
 * Admin reads a reported chat. Every read is logged with its reason
 * (business: Admin read access is logged); Admin never sends.
 */
export async function adminReadThread(
  admin: AdminActor,
  threadId: string,
  rawReason: unknown,
) {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(threadId).success) return bad("Chat not found", 404);
  const reason = z
    .string()
    .trim()
    .min(5, "Give a reason for reading")
    .max(300)
    .safeParse(rawReason);
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const thread = await db.chatThread.findUnique({
    where: { id: threadId },
    include: { a: { select: { name: true } }, b: { select: { name: true } } },
  });
  if (!thread) return bad("Chat not found", 404);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "CHAT_ADMIN_READ",
    entity: "ChatThread",
    entityId: threadId,
    meta: { reason: reason.data },
  });
  const messages = await db.chatThreadMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: 1000,
    include: withAttachments,
  });
  return {
    ok: true as const,
    thread,
    messages: await Promise.all(
      messages.map((message) => view(admin.profileId, message)),
    ),
  };
}

export async function resolveReport(
  admin: AdminActor,
  reportId: string,
  rawResolution: unknown,
) {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(reportId).success) return bad("Report not found", 404);
  const resolution = z
    .string()
    .trim()
    .min(3, "Say what was done")
    .max(1000)
    .safeParse(rawResolution);
  if (!resolution.success)
    return bad(resolution.error.issues[0]?.message ?? "Say what was done");
  const result = await db.chatReport.updateMany({
    where: { id: reportId, status: ChatReportStatus.OPEN },
    data: {
      status: ChatReportStatus.RESOLVED,
      resolution: resolution.data,
      resolvedBy: admin.profileId,
      resolvedAt: new Date(),
    },
  });
  if (result.count === 0) return bad("This report is already resolved", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "CHAT_REPORT_RESOLVED",
    entity: "ChatReport",
    entityId: reportId,
    meta: { resolution: resolution.data },
  });
  return { ok: true as const };
}

// ── Realtime broadcast and notifications ─────────────────────────────────

let realtimeAvailable: boolean | null = null;

/**
 * Broadcast on the private channel `thread:<id>` through Supabase's
 * `realtime.send` (database-side; no service-role key). Only the two
 * participants can receive (RLS on realtime.messages). Where Realtime does
 * not exist (local test databases), clients fall back to polling.
 */
export async function broadcast(
  threadId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  try {
    if (realtimeAvailable === null) {
      const [row] = await db.$queryRaw<{ available: boolean }[]>`
        SELECT to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL AS available`;
      realtimeAvailable = Boolean(row?.available);
    }
    if (!realtimeAvailable) return;
    await db.$executeRaw`
      SELECT realtime.send(${JSON.stringify(payload)}::jsonb, ${event}, ${`thread:${threadId}`}, true)`;
  } catch {
    // Never fail a send because the live channel is down: clients poll too.
    console.error(JSON.stringify({ event: "chat.broadcast_failed" }));
  }
}

/** Task 6: one email per thread per recipient per window; never the message text. */
async function notifyRecipient(profileId: string, threadId: string) {
  const window = Math.floor(Date.now() / (EMAIL_WINDOW_MINUTES * 60_000));
  await deliverOnce({
    profileId,
    eventKey: "chat.message",
    dedupeKey: `chat:${threadId}:${window}`,
    send: (to) => sendNewChatMessageEmail({ to, threadId }),
  });
}
