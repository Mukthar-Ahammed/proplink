import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import { reportThread } from "@/services/chat/messages";

/** Report a chat (Phase 3 Task 3): opens a moderation case for Admin. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const { user } = authz.session;
  const result = await reportThread(
    { profileId: user.authUserId, role: user.role, legacyUserId: user.id },
    id,
    body?.reason,
  );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
