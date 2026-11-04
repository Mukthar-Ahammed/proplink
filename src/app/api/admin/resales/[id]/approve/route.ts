import "server-only";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { approveFlipperResale } from "@/services/admin/flipperResaleAdminService";

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const authResult = await requireRole(Role.ADMIN);
  if (!authResult.ok) return authResult.response;

  const { id } = await props.params;

  const result = await approveFlipperResale(
    {
      userId: authResult.session.user.id,
      role: authResult.session.user.role,
      active: authResult.session.user.active ?? true,
    },
    { resaleId: id },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
