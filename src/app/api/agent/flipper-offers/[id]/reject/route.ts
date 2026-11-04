import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { rejectFlipperOffer } from "@/services/flipper/flipperService";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.AGENT);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  let body: { agentNotes?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await rejectFlipperOffer(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    id,
    body.agentNotes,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, offerId: result.data.offerId });
}
