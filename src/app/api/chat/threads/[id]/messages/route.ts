import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import { listMessages, sendMessage } from "@/services/chat/messages";

/**
 * Chat messages for one thread (Phase 3 Task 3, ADR-043). Thin: validate the
 * session, call the service, respond. Every check (participant, Admin
 * authorisation, subscriptions, rate limits, size, sanitising) is in the
 * service and runs on every request.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const viewer = {
    profileId: authz.session.user.authUserId,
    role: authz.session.user.role,
  };
  const result = await listMessages(viewer, id, {
    after: new URL(request.url).searchParams.get("after"),
  });
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    {
      state: result.access.state,
      canSend: result.access.canSend,
      blocked: result.access.blocked,
      messages: result.messages,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const viewer = {
    profileId: authz.session.user.authUserId,
    role: authz.session.user.role,
  };
  const result = await sendMessage(viewer, id, body);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { message: result.message, duplicate: result.duplicate },
    { status: result.duplicate ? 200 : 201 },
  );
}
