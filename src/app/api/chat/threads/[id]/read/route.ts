import { NextResponse } from "next/server";

import { requireUser } from "@/lib/authz";
import { markRead } from "@/services/chat/messages";

/** Read receipts (Phase 3 Task 3): marks messages to the caller as read. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireUser();
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const result = await markRead(
    { profileId: authz.session.user.authUserId, role: authz.session.user.role },
    id,
  );
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ marked: result.marked });
}
