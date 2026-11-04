import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { cancelFlipperAcquisition } from "@/services/flipper/flipperProjectService";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.AGENT);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  const result = await cancelFlipperAcquisition(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, acquisitionId: result.data.acquisitionId });
}
