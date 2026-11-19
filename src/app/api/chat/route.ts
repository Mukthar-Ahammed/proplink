import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { sendMessage } from "@/services/chat/messages";
import { ensureRetailThread } from "@/services/chat/threads";

const startSchema = z.object({
  propertyId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(4000),
});

/**
 * A Buyer messages a listing's Agent (Phase 3 Task 7, ADR-043). Starts (or
 * continues) the Buyer ↔ Agent thread and sends the first message through the
 * same checked path as every chat message. Replies happen in /messages.
 */
export async function POST(request: Request) {
  const authz = await requireRole("BUYER");
  if (!authz.ok) return authz.response;
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const viewer = {
    profileId: authz.session.user.authUserId,
    role: authz.session.user.role,
  };
  const thread = await ensureRetailThread(viewer, parsed.data.propertyId);
  if (!thread.ok)
    return NextResponse.json({ error: thread.error }, { status: thread.status });
  const result = await sendMessage(viewer, thread.threadId, {
    body: parsed.data.body,
    clientMessageId: randomUUID(),
    attachmentIds: [],
  });
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { threadId: thread.threadId, message: result.message },
    { status: 201 },
  );
}
